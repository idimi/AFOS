/**
 * htlcRecovery router
 *
 * Procedures for recovering funds stuck in HTLC PDAs.
 *
 * - getStuckHtlcs: Scan the DB for unclaimed/unrefunded HTLCs and check
 *   their on-chain state to identify recoverable funds.
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
  process.env.VITE_SOL_RPC_URL || "https://api.mainnet-beta.solana.com";

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
   * Returns a list of recoverable HTLCs with their current status.
   * Public (any authenticated user can see their own stuck HTLCs).
   */
  getStuckHtlcs: protectedProcedure.query(async ({ ctx }) => {
    const now = Date.now();

    // Fetch all non-completed HTLC secrets from DB
    // Broaden filter: include any status that isn't explicitly completed/refunded
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select()
      .from(htlcSecrets)
      .limit(100);

    const connection = new Connection(SOL_RPC_URL, "confirmed");
    const results = [];
    const seen = new Set<string>();

    for (const row of rows) {
      // Derive candidate htlcId strings from rfqId
      // The on-chain PDA uses "htlc_a_" prefix + first 24 chars of rfqId (without "rfq_" prefix)
      // e.g. rfqId="rfq_1773205346880_lp-3dcc9" => htlcIdA="htlc_a_rfq_1773205346880_lp-3"
      const rfqId = row.rfqId ?? "";
      const rfqSuffix = rfqId.startsWith("rfq_") ? rfqId.slice(4) : rfqId;

      // Build candidate htlcId strings to try (different truncations)
      const candidateHtlcIds = [
        row.htlcId, // stored value (may be truncated)
        `htlc_a_rfq_${rfqSuffix}`,
        `htlc_a_${rfqId}`,
        `htlc_b_rfq_${rfqSuffix}`,
        `htlc_b_${rfqId}`,
      ].filter(Boolean) as string[];

      for (const htlcIdCandidate of candidateHtlcIds) {
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
        } catch {
          // RPC error — skip
        }

        if (!onChainState) continue;
        if (onChainState.claimed || onChainState.refunded) continue;

        const timelockExpired = now / 1000 >= onChainState.timelock;
        const amountSol = Number(onChainState.amountLamports) / 1e9;
        const isNativeSol =
          onChainState.tokenMint === "11111111111111111111111111111111";

        results.push({
          rfqId: row.rfqId,
          htlcId: htlcIdCandidate,
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
