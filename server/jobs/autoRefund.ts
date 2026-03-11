/**
 * autoRefund.ts — Background job that scans all chains for expired HTLCs
 *
 * Runs every 5 minutes. For each expired HTLC:
 *   - If the HTLC was locked by the server's own key (SOL_HTLC_KEY / ETH_HTLC_KEY):
 *     → Auto-submits the refund transaction on-chain
 *     → Updates the DB record to status = 'refunded'
 *   - If the HTLC was locked by a user wallet:
 *     → Sends an owner notification so the operator knows a user has a claimable refund
 *     → Does NOT auto-refund (user must sign from their own wallet)
 *
 * The job is idempotent — it skips HTLCs already marked as 'refunded' in the DB.
 *
 * Solana scanning strategy: DB-first + getAccountInfo (avoids getProgramAccounts which
 * times out on the public RPC). Queries the DB for pending Solana HTLCs, then verifies
 * each one on-chain with getAccountInfo (fast, ~150ms per call).
 */

import { getDb } from "../db.js";
import { htlcSwaps } from "../../drizzle/schema.js";
import { eq, and, inArray } from "drizzle-orm";
import { notifyOwner } from "../_core/notification.js";

const AFOS_HTLC_PROGRAM_ID = "XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW";
const SOL_RPC_URL = process.env.SOL_RPC_URL || process.env.VITE_SOL_RPC_URL || "https://solana-rpc.publicnode.com";

// ─── Solana on-chain scanner (DB-first + getAccountInfo) ─────────────────────

interface OnChainHtlc {
  htlcId: string;
  pdaAddress: string;
  senderAddress: string;
  amountHuman: string;
  token: string;
  chain: string;
  timelockExpiry: number;
  timelockExpired: boolean;
  secretHash: string;
}

async function parseHtlcAccountData(raw: Buffer, pdaAddress: string): Promise<OnChainHtlc | null> {
  try {
    if (raw.length < 153) return null;

    const htlcIdRaw = raw.slice(8, 40);
    const nullIdx = htlcIdRaw.indexOf(0);
    const htlcId = htlcIdRaw.slice(0, nullIdx >= 0 ? nullIdx : 32).toString("utf8");

    const { PublicKey } = await import("@solana/web3.js");
    const sender = new PublicKey(raw.slice(40, 72)).toBase58();
    const secretHashHex = raw.slice(104, 136).toString("hex");
    const timelock = Number(raw.readBigInt64LE(136));
    const amountLamports = raw.readBigUInt64LE(144);
    const status = raw[152];

    if (status !== 0) return null; // 0 = active/locked

    const nowSec = Math.floor(Date.now() / 1000);
    const timelockExpired = timelock > 0 && timelock < nowSec;
    if (!timelockExpired) return null; // only expired ones

    return {
      htlcId,
      pdaAddress,
      senderAddress: sender,
      amountHuman: (Number(amountLamports) / 1e9).toFixed(6),
      token: "SOL",
      chain: "solana",
      timelockExpiry: timelock,
      timelockExpired: true,
      secretHash: secretHashHex,
    };
  } catch {
    return null;
  }
}

async function scanSolanaExpiredHtlcs(): Promise<OnChainHtlc[]> {
  try {
    const db = await getDb();
    if (!db) return [];

    // Query DB for all pending/locked Solana HTLCs
    const pendingRows = await db
      .select({
        htlcAddress: htlcSwaps.htlcAddress,
        rfqId: htlcSwaps.rfqId,
        senderAddress: htlcSwaps.senderAddress,
        chain: htlcSwaps.chain,
      })
      .from(htlcSwaps)
      .where(
        and(
          eq(htlcSwaps.chain, "solana"),
          eq(htlcSwaps.status, "pending")
        )
      );

    if (pendingRows.length === 0) return [];

    const results: OnChainHtlc[] = [];

    // Check each HTLC on-chain with getAccountInfo (fast, ~150ms per call)
    for (const row of pendingRows) {
      if (!row.htlcAddress) continue;
      try {
        const body = JSON.stringify({
          jsonrpc: "2.0", id: 1,
          method: "getAccountInfo",
          params: [row.htlcAddress, { encoding: "base64" }],
        });

        const resp = await fetch(SOL_RPC_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(10000),
        });

        const json = await resp.json() as {
          result?: { value?: { data: [string, string] } | null }
        };

        const accountData = json.result?.value?.data;
        if (!accountData) continue; // account doesn't exist or was closed

        const raw = Buffer.from(accountData[0], "base64");
        const htlc = await parseHtlcAccountData(raw, row.htlcAddress);
        if (htlc) {
          results.push(htlc);
        }
      } catch {
        // skip this HTLC if RPC call fails
      }
    }

    return results;
  } catch (err) {
    console.warn("[AutoRefund] Solana scan failed:", err);
    return [];
  }
}

// ─── Attempt server-side SOL refund ──────────────────────────────────────────

async function attemptSolRefund(htlc: OnChainHtlc): Promise<string | null> {
  const solHtlcKey = process.env.SOL_HTLC_KEY;
  if (!solHtlcKey) return null;

  try {
    const { Keypair, Connection, Transaction, TransactionInstruction, PublicKey, SystemProgram } = await import("@solana/web3.js");
    const { Buffer } = await import("buffer");

    // Derive keypair from base58 private key
    const bs58 = await import("bs58");
    const secretKey = bs58.default.decode(solHtlcKey);
    const keypair = Keypair.fromSecretKey(secretKey);

    // Only auto-refund if the server key is the sender
    if (keypair.publicKey.toBase58() !== htlc.senderAddress) {
      return null; // user-owned HTLC — cannot auto-refund
    }

    const connection = new Connection(SOL_RPC_URL, "confirmed");
    const programId = new PublicKey(AFOS_HTLC_PROGRAM_ID);
    const pdaPubkey = new PublicKey(htlc.pdaAddress);

    // Build refund instruction (discriminator for "refund" = sha256("global:refund")[0:8])
    const REFUND_DISCRIMINATOR = Buffer.from([11, 26, 96, 127, 137, 156, 172, 218]);
    const ix = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: pdaPubkey, isSigner: false, isWritable: true },
        { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: REFUND_DISCRIMINATOR,
    });

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: keypair.publicKey });
    tx.add(ix);
    tx.sign(keypair);

    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
  } catch (err) {
    console.warn("[AutoRefund] SOL refund attempt failed:", err);
    return null;
  }
}

// ─── Main job function ────────────────────────────────────────────────────────

export interface AutoRefundResult {
  scanned: number;
  autoRefunded: number;
  userNotified: number;
  errors: string[];
}

export async function runAutoRefund(): Promise<AutoRefundResult> {
  const result: AutoRefundResult = { scanned: 0, autoRefunded: 0, userNotified: 0, errors: [] };

  try {
    const db = await getDb();

    // ── Solana scan (DB-first + getAccountInfo) ──
    const solExpired = await scanSolanaExpiredHtlcs();
    result.scanned += solExpired.length;

    const solHtlcKey = process.env.SOL_HTLC_KEY;
    let serverSolAddress: string | null = null;
    if (solHtlcKey) {
      try {
        const bs58 = await import("bs58");
        const { Keypair } = await import("@solana/web3.js");
        const keypair = Keypair.fromSecretKey(bs58.default.decode(solHtlcKey));
        serverSolAddress = keypair.publicKey.toBase58();
      } catch { /* ignore */ }
    }

    const userClaimable: OnChainHtlc[] = [];

    for (const htlc of solExpired) {
      const isServerOwned = serverSolAddress && htlc.senderAddress === serverSolAddress;

      if (isServerOwned) {
        // Auto-refund server-owned HTLCs
        const txSig = await attemptSolRefund(htlc);
        if (txSig) {
          result.autoRefunded++;
          console.log(`[AutoRefund] Auto-refunded server SOL HTLC ${htlc.pdaAddress} → tx ${txSig}`);
          // Update DB record to refunded
          if (db) {
            await db
              .update(htlcSwaps)
              .set({ status: "refunded", refundTxId: txSig, refundedAt: new Date() })
              .where(eq(htlcSwaps.htlcAddress, htlc.pdaAddress));
          }
        } else {
          result.errors.push(`Failed to auto-refund SOL HTLC ${htlc.pdaAddress}`);
        }
      } else {
        // User-owned — collect for notification
        userClaimable.push(htlc);
      }
    }

    // User-claimable HTLCs are surfaced in the Refunds tab — no owner notification needed.
    if (userClaimable.length > 0) {
      result.userNotified += userClaimable.length;
      console.log(`[AutoRefund] ${userClaimable.length} user-claimable HTLC(s) — visible in Refunds tab.`);
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`AutoRefund job error: ${msg}`);
    console.error("[AutoRefund] Job error:", err);
  }

  return result;
}
