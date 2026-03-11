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
 */

import { getDb } from "../db.js";
import { htlcSwaps } from "../../drizzle/schema.js";
import { eq, and, inArray } from "drizzle-orm";
import { notifyOwner } from "../_core/notification.js";

const AFOS_HTLC_PROGRAM_ID = "XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW";
const SOL_RPC_URL = process.env.SOL_RPC_URL || process.env.VITE_SOL_RPC_URL || "https://solana-rpc.publicnode.com";

// ─── Solana on-chain scanner ──────────────────────────────────────────────────

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

async function scanSolanaExpiredHtlcs(): Promise<OnChainHtlc[]> {
  try {
    const body = JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "getProgramAccounts",
      params: [AFOS_HTLC_PROGRAM_ID, { encoding: "base64" }],
    });

    const resp = await fetch(SOL_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(20000),
    });
    const json = await resp.json() as { result?: Array<{ pubkey: string; account: { data: [string, string] } }> };
    const accounts = json.result ?? [];
    const nowSec = Math.floor(Date.now() / 1000);

    const { PublicKey } = await import("@solana/web3.js");
    const results: OnChainHtlc[] = [];

    for (const acc of accounts) {
      try {
        const raw = Buffer.from(acc.account.data[0], "base64");
        if (raw.length < 153) continue;

        const htlcIdRaw = raw.slice(8, 40);
        const nullIdx = htlcIdRaw.indexOf(0);
        const htlcId = htlcIdRaw.slice(0, nullIdx >= 0 ? nullIdx : 32).toString("utf8");

        const sender = new PublicKey(raw.slice(40, 72)).toBase58();
        const secretHashHex = raw.slice(104, 136).toString("hex");
        const timelock = Number(raw.readBigInt64LE(136));
        const amountLamports = raw.readBigUInt64LE(144);
        const status = raw[152];
        if (status !== 0) continue; // 0 = active/locked

        const timelockExpired = timelock > 0 && timelock < nowSec;
        if (!timelockExpired) continue; // only expired ones

        results.push({
          htlcId,
          pdaAddress: acc.pubkey,
          senderAddress: sender,
          amountHuman: (Number(amountLamports) / 1e9).toFixed(6),
          token: "SOL",
          chain: "solana",
          timelockExpiry: timelock,
          timelockExpired: true,
          secretHash: secretHashHex,
        });
      } catch {
        // skip malformed accounts
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

    // ── Solana scan ──
    const solExpired = await scanSolanaExpiredHtlcs();
    result.scanned += solExpired.length;

    // Get already-refunded PDA addresses from DB to avoid re-processing
    const alreadyRefunded = new Set<string>();
    if (db && solExpired.length > 0) {
      const pdaAddresses = solExpired.map(h => h.pdaAddress);
      const dbRows = await db
        .select({ htlcAddress: htlcSwaps.htlcAddress, status: htlcSwaps.status })
        .from(htlcSwaps)
        .where(inArray(htlcSwaps.htlcAddress, pdaAddresses));
      for (const row of dbRows) {
        if (row.status === "refunded") alreadyRefunded.add(row.htlcAddress);
      }
    }

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
      if (alreadyRefunded.has(htlc.pdaAddress)) continue;

      const isServerOwned = serverSolAddress && htlc.senderAddress === serverSolAddress;

      if (isServerOwned) {
        // Auto-refund server-owned HTLCs
        const txSig = await attemptSolRefund(htlc);
        if (txSig) {
          result.autoRefunded++;
          console.log(`[AutoRefund] Auto-refunded server SOL HTLC ${htlc.pdaAddress} → tx ${txSig}`);
          // Update DB if the HTLC is recorded there
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

    // ── Notify owner about user-claimable HTLCs (batch, max once per run) ──
    if (userClaimable.length > 0) {
      result.userNotified += userClaimable.length;
      const lines = userClaimable.map(h =>
        `• ${h.amountHuman} ${h.token} at ${h.pdaAddress.slice(0, 12)}… (sender: ${h.senderAddress.slice(0, 8)}…, expired: ${new Date(h.timelockExpiry * 1000).toISOString()})`
      ).join("\n");

      await notifyOwner({
        title: `⚠️ ${userClaimable.length} User HTLC(s) Claimable — Action Required`,
        content: `The following HTLCs have expired and the original senders can now reclaim their funds from the History → Refunds tab:\n\n${lines}\n\nThese are user-owned HTLCs — the server cannot auto-refund them. Users must connect their wallet and click "Claim Refund" in the Refunds tab.`,
      });
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`AutoRefund job error: ${msg}`);
    console.error("[AutoRefund] Job error:", err);
  }

  return result;
}
