/**
 * htlcRecovery router
 *
 * Procedures for recovering funds stuck in HTLC PDAs.
 *
 * - getStuckHtlcs: Scan the DB for unclaimed/unrefunded HTLCs and check
 *   their on-chain state to identify recoverable funds.
 *   Also includes an on-chain scanner that queries program accounts directly.
 * - buildRefundTx: Return a serialized refund transaction that the sender's
 *   wallet can sign to recover funds after the timelock expires.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { htlcSecrets } from "../../drizzle/schema";
import { and, or, eq } from "drizzle-orm";
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  AFOS_HTLC_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
  SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
  deriveHtlcPda,
  deriveAta,
  htlcIdToBytes,
  buildRefundInstruction,
} from "../../client/src/lib/afosHtlcProgram";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SOL_RPC_URL =
  process.env.VITE_SOL_RPC_URL || "https://solana-rpc.publicnode.com";

const USDT_MINT = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

function getMintForSymbol(symbol: string | null | undefined): PublicKey | null {
  if (!symbol) return null;
  const s = symbol.toUpperCase();
  if (s === "USDT") return USDT_MINT;
  if (s === "USDC") return USDC_MINT;
  return null;
}

/**
 * Decode HtlcState from raw account data (Anchor layout).
 * Returns null if the data is too short or doesn't match.
 */
function decodeHtlcState(data: Buffer): {
  htlcId: string;
  sender: string;
  recipient: string;
  secretHash: string;
  timelock: number;
  amountLamports: bigint;
  tokenMint: string;
  claimed: boolean;
  refunded: boolean;
  bump: number;
} | null {
  if (data.length < 219) return null;
  let offset = 8; // skip discriminator

  const htlcIdBytes = data.slice(offset, offset + 32);
  const htlcId = Buffer.from(htlcIdBytes).toString("utf8").replace(/\0/g, "");
  offset += 32;

  const senderBytes = data.slice(offset, offset + 32);
  const sender = new PublicKey(senderBytes).toBase58();
  offset += 32;

  const recipientBytes = data.slice(offset, offset + 32);
  const recipient = new PublicKey(recipientBytes).toBase58();
  offset += 32;

  const secretHash = data.slice(offset, offset + 32).toString("hex");
  offset += 32;

  const timelock = Number(data.readBigInt64LE(offset));
  offset += 8;

  const amountLamports = data.readBigUInt64LE(offset);
  offset += 8;

  const tokenMintBytes = data.slice(offset, offset + 32);
  const tokenMint = new PublicKey(tokenMintBytes).toBase58();
  offset += 32;

  const claimed = data[offset] !== 0;
  const refunded = data[offset + 1] !== 0;
  const bump = data[offset + 2];

  return {
    htlcId,
    sender,
    recipient,
    secretHash,
    timelock,
    amountLamports,
    tokenMint,
    claimed,
    refunded,
    bump,
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const htlcRecoveryRouter = router({
  /**
   * Scan the DB for locked HTLCs and check their on-chain state.
   * Also scans on-chain program accounts directly (safety net).
   * Returns a list of recoverable HTLCs with their current status.
   */
  getStuckHtlcs: protectedProcedure.query(async ({ ctx }) => {
    const now = Date.now();
    const connection = new Connection(SOL_RPC_URL, "confirmed");
    const results: Array<{
      rfqId: string | null;
      htlcId: string;
      pdaAddress: string;
      sender: string;
      recipient: string;
      amountSol: number;
      amountLamports: string;
      tokenMint: string | null;
      tokenSymbol: string;
      timelock: number;
      timelockExpired: boolean;
      claimed: boolean;
      refunded: boolean;
      dbStatus: string | null;
      fromToken: string | null;
      toToken: string | null;
    }> = [];
    const seen = new Set<string>();

    // ─── Phase 1: DB-based scan ─────────────────────────────────────────
    const db = await getDb();
    if (db) {
      const rows = await db
        .select()
        .from(htlcSecrets)
        .limit(100);

      for (const row of rows) {
        const rfqId = row.rfqId ?? "";

        // Build candidate htlcId strings matching the frontend formula:
        //   htlcId = "htlc_a_" + rfqId.slice(0, 22)
        //   htlcId = "htlc_b_" + rfqId.slice(0, 22)
        // This is the EXACT formula used in LightPeerContext.tsx during lock.
        const candidateHtlcIds: string[] = [];

        // Primary candidates: match frontend formula exactly
        if (rfqId) {
          candidateHtlcIds.push(`htlc_a_${rfqId.slice(0, 22)}`);
          candidateHtlcIds.push(`htlc_b_${rfqId.slice(0, 22)}`);
        }

        // Also try the stored htlcId (may have been saved with wrong prefix)
        if (row.htlcId) {
          candidateHtlcIds.push(row.htlcId);
        }

        // Also try with different truncation lengths (safety net)
        if (rfqId) {
          candidateHtlcIds.push(`htlc_a_${rfqId.slice(0, 25)}`);
          candidateHtlcIds.push(`htlc_b_${rfqId.slice(0, 25)}`);
          candidateHtlcIds.push(`htlc_a_${rfqId}`);
          candidateHtlcIds.push(`htlc_b_${rfqId}`);
        }

        // Deduplicate (htlcIdToBytes truncates to 32 chars anyway)
        const uniqueCandidates = Array.from(new Set(candidateHtlcIds));

        for (const htlcIdCandidate of uniqueCandidates) {
          const htlcIdBytes = htlcIdToBytes(htlcIdCandidate);
          const [htlcPda] = deriveHtlcPda(htlcIdBytes);
          const pdaStr = htlcPda.toBase58();

          if (seen.has(pdaStr)) continue;
          seen.add(pdaStr);

          let onChainState = null;
          try {
            const accountInfo = await connection.getAccountInfo(htlcPda);
            if (accountInfo && accountInfo.owner.equals(AFOS_HTLC_PROGRAM_ID)) {
              onChainState = decodeHtlcState(Buffer.from(accountInfo.data));
            }
          } catch (err) {
            console.warn(`[HtlcRecovery] RPC error for PDA ${pdaStr}:`, (err as Error).message);
          }

          if (!onChainState) continue;
          if (onChainState.claimed || onChainState.refunded) continue;

          const timelockExpired = now / 1000 >= onChainState.timelock;
          const amountSol = Number(onChainState.amountLamports) / 1e9;
          const isNativeSol =
            onChainState.tokenMint === "11111111111111111111111111111111";

          results.push({
            rfqId: row.rfqId ?? null,
            htlcId: onChainState.htlcId || htlcIdCandidate,
            pdaAddress: pdaStr,
            sender: onChainState.sender,
            recipient: onChainState.recipient,
            amountSol,
            amountLamports: onChainState.amountLamports.toString(),
            tokenMint: isNativeSol ? null : onChainState.tokenMint,
            tokenSymbol: isNativeSol ? "SOL" : (row.fromToken ?? "TOKEN"),
            timelock: onChainState.timelock,
            timelockExpired,
            claimed: onChainState.claimed,
            refunded: onChainState.refunded,
            dbStatus: row.status,
            fromToken: row.fromToken,
            toToken: row.toToken,
          });
          break; // Found a valid PDA for this row, stop trying candidates
        }
      }
    }

    // ─── Phase 2: On-chain scanner (safety net for HTLCs not in DB) ─────
    try {
      const programAccounts = await connection.getProgramAccounts(
        AFOS_HTLC_PROGRAM_ID,
        {
          filters: [
            { dataSize: 219 }, // HTLC account size
          ],
        }
      );

      for (const { pubkey, account } of programAccounts) {
        const pdaStr = pubkey.toBase58();
        if (seen.has(pdaStr)) continue;
        seen.add(pdaStr);

        const state = decodeHtlcState(Buffer.from(account.data));
        if (!state) continue;
        if (state.claimed || state.refunded) continue;

        const timelockExpired = now / 1000 >= state.timelock;
        const amountSol = Number(state.amountLamports) / 1e9;
        const isNativeSol =
          state.tokenMint === "11111111111111111111111111111111";

        results.push({
          rfqId: null,
          htlcId: state.htlcId,
          pdaAddress: pdaStr,
          sender: state.sender,
          recipient: state.recipient,
          amountSol,
          amountLamports: state.amountLamports.toString(),
          tokenMint: isNativeSol ? null : state.tokenMint,
          tokenSymbol: isNativeSol ? "SOL" : "TOKEN",
          timelock: state.timelock,
          timelockExpired,
          claimed: state.claimed,
          refunded: state.refunded,
          dbStatus: null,
          fromToken: null,
          toToken: null,
        });
      }
    } catch (err) {
      console.warn("[HtlcRecovery] On-chain scanner error:", (err as Error).message);
      // Non-fatal — DB-based results still returned
    }

    return results;
  }),

  /**
   * Build a serialized refund transaction for a specific HTLC PDA.
   * The sender's wallet must sign and submit it.
   * Only available after the timelock has expired.
   */
  buildRefundTx: protectedProcedure
    .input(
      z.object({
        htlcId: z.string(),
        senderAddress: z.string(),
        tokenMint: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const connection = new Connection(SOL_RPC_URL, "confirmed");

      const htlcIdBytes = htlcIdToBytes(input.htlcId);
      const [htlcPda] = deriveHtlcPda(htlcIdBytes);

      // Verify the HTLC is on-chain and timelock has expired
      const accountInfo = await connection.getAccountInfo(htlcPda);
      if (!accountInfo) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `HTLC PDA ${htlcPda.toBase58()} not found on-chain`,
        });
      }

      const state = decodeHtlcState(Buffer.from(accountInfo.data));
      if (!state) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to decode HTLC state",
        });
      }

      if (state.claimed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This HTLC has already been claimed",
        });
      }

      if (state.refunded) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This HTLC has already been refunded",
        });
      }

      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec < state.timelock) {
        const remaining = state.timelock - nowSec;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Timelock has not expired yet. ${Math.ceil(remaining / 60)} minutes remaining.`,
        });
      }

      const senderPubkey = new PublicKey(input.senderAddress);
      const tokenMint = input.tokenMint
        ? new PublicKey(input.tokenMint)
        : undefined;

      const refundIx = buildRefundInstruction({
        sender: senderPubkey,
        htlcId: htlcIdBytes,
        tokenMint,
      });

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");

      const tx = new Transaction();
      tx.recentBlockhash = blockhash;
      tx.feePayer = senderPubkey;

      // Add priority fee
      tx.add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5000 }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 }),
        refundIx,
      );

      // Serialize for frontend wallet signing
      const serialized = tx
        .serialize({ requireAllSignatures: false })
        .toString("base64");

      return {
        serializedTx: serialized,
        htlcPda: htlcPda.toBase58(),
        amountSol: Number(state.amountLamports) / 1e9,
        amountLamports: state.amountLamports.toString(),
        tokenMint: input.tokenMint ?? null,
        lastValidBlockHeight,
      };
    }),
});
