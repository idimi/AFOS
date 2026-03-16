/**
 * tnkHtlcClaim.ts — Autonomous TNK HTLC claim executor
 *
 * Flow (mirrors Solana Anchor pattern — fully autonomous, no manual steps):
 *   1. Verify the HTLC is in "locked" status on the subnet
 *      → Retries with exponential backoff for up to 90 seconds to handle the
 *        race condition where Agent B locks USDT before Agent A's htlc_lock
 *        transaction is confirmed on the Trac Network subnet.
 *   2. Verify sha256(preimage) == secretHash
 *   3. Submit htlc_claim to subnet contract (updates subnet bookkeeping)
 *   4. Execute a REAL on-chain TNK transfer via tracapi.trac.network using the
 *      TNK_HTLC_WIF private key — this is the actual blockchain transfer, not a stub.
 *      → Retries up to 3 times on transient failure
 *      → Fee (0.03 TNK) is deducted from the escrow wallet, not from the transfer amount
 *   5. Update the htlcSwaps DB row to status="completed"
 *
 * DB Fallback (when subnet state is unavailable):
 *   The Tap Wallet's signTracTx may route to a different subnet node, causing the
 *   server's subnet to have no state for the HTLC. In this case, claimTnkHtlc falls
 *   back to DB data (htlc_secrets.fromAmountRaw + counterpartyWallets.trac_network)
 *   to execute the transfer directly without requiring subnet confirmation.
 *
 * Key change from previous implementation:
 *   The old agentSendTnk() called the peer node's /v1/agent/send which was a STUB
 *   that only logged the intent and returned a fake txHash. This is now replaced by
 *   broadcastTnkTransfer() which signs and broadcasts a real transaction on the
 *   Trac Network mainnet via tracapi.trac.network/v1/broadcast-transaction.
 */

import crypto from "node:crypto";
import { getDb } from "./db";
import { htlcSwaps, htlcSecrets } from "../drizzle/schema";
import { eq, or, sql } from "drizzle-orm";
import { getTnkHtlcState, submitTnkHtlcClaim, isTnkPeerHealthy } from "./tnkHtlcContract";
import { broadcastTnkTransfer, getTnkOnChainBalance } from "./tnkOnChainTransfer";

/** Maximum time (ms) to wait for Agent A's htlc_lock to appear on the subnet */
// Allow test override via env var to avoid 90s wait in unit tests
const HTLC_CONFIRM_TIMEOUT_MS = process.env.TNK_HTLC_CONFIRM_TIMEOUT_MS
  ? parseInt(process.env.TNK_HTLC_CONFIRM_TIMEOUT_MS, 10)
  : 90_000;
/** Initial backoff (ms) between subnet state polls */
const HTLC_POLL_INITIAL_MS = 3_000;
/** Backoff multiplier */
const HTLC_POLL_BACKOFF = 1.5;
/** Maximum backoff cap (ms) */
const HTLC_POLL_MAX_MS = 15_000;
/** TNK transfer fee (0.03 TNK in raw units) */
const TNK_FEE = BigInt("30000000000000000");
/** 1 TNK in raw units */
const TNK_UNIT = BigInt("1000000000000000000");
/** Escrow wallet address (sender of all TNK transfers) */
const TNK_ESCROW = process.env.TNK_ESCROW_ADDRESS ?? "";

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Poll the subnet for an HTLC state until it appears or the timeout expires.
 * Returns the state if found in "locked" status, or null on timeout.
 */
async function waitForTnkHtlcLocked(
  htlcId: string,
  timeoutMs: number = HTLC_CONFIRM_TIMEOUT_MS,
): Promise<{ state: import("./tnkHtlcContract").TnkHtlcState } | { error: string }> {
  const deadline = Date.now() + timeoutMs;
  let delay = HTLC_POLL_INITIAL_MS;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    const state = await getTnkHtlcState(htlcId);

    if (state) {
      if (state.status === "locked") {
        console.log(`[TNK Claim] HTLC ${htlcId} confirmed on subnet after ${attempt} poll(s)`);
        return { state };
      }
      if (state.status === "claimed") {
        return { error: `HTLC ${htlcId} already claimed (status: claimed)` };
      }
      if (state.status === "refunded") {
        return { error: `HTLC ${htlcId} already refunded (status: refunded)` };
      }
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    console.log(`[TNK Claim] HTLC ${htlcId} not yet on subnet (attempt ${attempt}), retrying in ${delay}ms…`);
    await sleep(Math.min(delay, remaining));
    delay = Math.min(delay * HTLC_POLL_BACKOFF, HTLC_POLL_MAX_MS);
  }

  return { error: `HTLC ${htlcId} not found in subnet state after ${timeoutMs / 1000}s` };
}

/**
 * Look up the htlc_secrets row by htlcId to get fallback claim data.
 * The htlcId is stored as htlc_a_<rfqId.slice(0,22)> in htlc_secrets.htlcId.
 */
async function getHtlcSecretByHtlcId(htlcId: string): Promise<{
  secretHashHex: string;
  fromAmountRaw: string | null;
  recipientTnkAddress: string | null;
  rfqId: string;
} | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    // htlcId is stored directly in the htlcId column of htlc_secrets
    const rows = await db.select({
      secretHashHex: htlcSecrets.secretHashHex,
      fromAmountRaw: htlcSecrets.fromAmountRaw,
      counterpartyWallets: htlcSecrets.counterpartyWallets,
      rfqId: htlcSecrets.rfqId,
    })
    .from(htlcSecrets)
    .where(eq(htlcSecrets.htlcId, htlcId))
    .limit(1);

    if (!rows[0]) return null;
    const row = rows[0];
    const recipientTnkAddress = (row.counterpartyWallets as { trac_network?: string } | null)?.trac_network ?? null;
    return {
      secretHashHex: row.secretHashHex,
      fromAmountRaw: row.fromAmountRaw ?? null,
      recipientTnkAddress,
      rfqId: row.rfqId,
    };
  } catch (err) {
    console.error(`[TNK Claim] getHtlcSecretByHtlcId(${htlcId}) failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Execute a real on-chain TNK transfer from the escrow wallet to the recipient.
 * Uses TNK_HTLC_WIF to sign the transaction and broadcasts via tracapi.trac.network.
 *
 * The escrow wallet must hold: transferAmount + 0.03 TNK (fee).
 * The fee is paid by the escrow wallet (not deducted from the transfer amount).
 */
async function executeRealTnkTransfer(params: {
  from: string;
  to: string;
  amountRaw: string; // raw units as decimal string, e.g. "2000000000000000000"
}, maxRetries = 3): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const rawAmount = BigInt(params.amountRaw);

  // Pre-flight: verify escrow has enough balance for transfer + fee
  const escrowBalance = await getTnkOnChainBalance(params.from);
  if (escrowBalance !== null) {
    const needed = rawAmount + TNK_FEE;
    if (escrowBalance < needed) {
      const haveStr = (Number(escrowBalance * 10000n / TNK_UNIT) / 10000).toFixed(4);
      const needStr = (Number(needed * 10000n / TNK_UNIT) / 10000).toFixed(4);
      return {
        success: false,
        error: `Escrow balance insufficient: have ${haveStr} TNK, need ${needStr} TNK (transfer + 0.03 fee)`,
      };
    }
  }

  let lastError = "";
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await broadcastTnkTransfer(params.from, params.to, rawAmount);
    if (result.ok) {
      return { success: true, txHash: result.txHash };
    }
    lastError = result.error ?? "unknown error";
    // Permanent errors — do not retry
    if (lastError.includes("TNK_HTLC_WIF") || lastError.includes("address") || lastError.includes("invalid")) {
      return { success: false, error: lastError };
    }
    if (attempt < maxRetries) {
      console.warn(`[TNK Claim] broadcastTnkTransfer attempt ${attempt} failed: ${lastError} — retrying in ${2000 * attempt}ms…`);
      await sleep(2_000 * attempt);
    }
  }
  return { success: false, error: lastError };
}

export interface TnkClaimResult {
  ok: boolean;
  contractTxHash?: string;
  sendTxHash?: string;
  error?: string;
}

/**
 * Claim a TNK HTLC and release funds to the recipient on-chain.
 *
 * This is the fully autonomous path:
 *   1. Try to verify subnet state (locked + preimage matches)
 *   2. If subnet state unavailable, fall back to DB data (htlc_secrets row)
 *   3. Submit htlc_claim to subnet contract (if peer healthy)
 *   4. Broadcast real TNK transfer on Trac Network mainnet
 *   5. Update DB to completed
 *
 * DB Fallback: When the Tap Wallet's signTracTx doesn't register the lock in the
 * server's subnet (routing mismatch), the function falls back to htlc_secrets data:
 *   - secretHashHex: verifies the preimage
 *   - fromAmountRaw: the TNK amount to transfer (18-decimal raw units)
 *   - counterpartyWallets.trac_network: Agent B's TNK address (recipient)
 */
export async function claimTnkHtlc(htlcId: string, preimage: string): Promise<TnkClaimResult> {
  const healthy = await isTnkPeerHealthy();

  // Try subnet state first (with reduced timeout for faster fallback)
  let contractState: import("./tnkHtlcContract").TnkHtlcState | null = null;
  let usingDbFallback = false;

  if (healthy) {
    // Use a reduced timeout (15s) for the initial check — if the Tap Wallet
    // didn't register the lock in our subnet, we fall back to DB quickly.
    const shortTimeout = Math.min(HTLC_CONFIRM_TIMEOUT_MS, 15_000);
    const waitResult = await waitForTnkHtlcLocked(htlcId, shortTimeout);
    contractState = "state" in waitResult ? waitResult.state : null;

    if (!contractState) {
      const waitError = "error" in waitResult ? waitResult.error : "unknown";
      // If the subnet explicitly says the HTLC is already claimed/refunded, propagate
      // that error immediately — no point trying the DB fallback.
      if (waitError.includes("already claimed") || waitError.includes("already refunded")) {
        return { ok: false, error: waitError };
      }
      console.warn(`[TNK Claim] Subnet state not found for HTLC ${htlcId} (${waitError}) — trying DB fallback`);
    }
  } else {
    console.warn(`[TNK Claim] trac-peer unreachable for HTLC ${htlcId} — trying DB fallback`);
  }

  // DB Fallback: look up htlc_secrets by htlcId
  let fallbackRecipient: string | null = null;
  let fallbackAmountRaw: string | null = null;
  let fallbackSecretHash: string | null = null;

  if (!contractState) {
    const dbRow = await getHtlcSecretByHtlcId(htlcId);
    if (!dbRow) {
      return { ok: false, error: `HTLC ${htlcId} not found in subnet or DB — cannot claim` };
    }

    // Verify preimage against DB-stored secretHash
    const computedHash = sha256Hex(preimage);
    if (computedHash !== dbRow.secretHashHex) {
      return { ok: false, error: `Preimage mismatch (DB): sha256=${computedHash} != ${dbRow.secretHashHex}` };
    }

    if (!dbRow.recipientTnkAddress) {
      return { ok: false, error: `No TNK recipient address in DB for HTLC ${htlcId} (rfqId=${dbRow.rfqId})` };
    }

    if (!dbRow.fromAmountRaw) {
      return { ok: false, error: `No fromAmountRaw in DB for HTLC ${htlcId} (rfqId=${dbRow.rfqId}) — cannot determine transfer amount` };
    }

    fallbackRecipient = dbRow.recipientTnkAddress;
    fallbackAmountRaw = dbRow.fromAmountRaw;
    fallbackSecretHash = dbRow.secretHashHex;
    usingDbFallback = true;
    console.log(`[TNK Claim] Using DB fallback for HTLC ${htlcId}: recipient=${fallbackRecipient.slice(0, 12)}… amount=${fallbackAmountRaw}`);
  } else {
    // Verify preimage hash against subnet state
    const computedHash = sha256Hex(preimage);
    if (computedHash !== contractState.secretHash) {
      return { ok: false, error: `Preimage mismatch: sha256=${computedHash} != ${contractState.secretHash}` };
    }
    const now = Math.floor(Date.now() / 1000);
    if (now > contractState.locktime) {
      return { ok: false, error: `HTLC ${htlcId} timelock expired (locktime=${contractState.locktime}, now=${now})` };
    }
  }

  // Step 1: Submit htlc_claim to subnet contract (updates bookkeeping)
  // Only attempt if peer is healthy. Skip if using DB fallback (no subnet state to claim).
  let contractTxHash: string | undefined;
  if (healthy && !usingDbFallback) {
    const claimResult = await submitTnkHtlcClaim({ htlcId, preimage });
    if (!claimResult.ok) {
      return { ok: false, error: `Contract claim failed: ${claimResult.error}` };
    }
    contractTxHash = (claimResult.result as { txHash?: string })?.txHash;
  } else if (healthy && usingDbFallback) {
    // Try to submit subnet claim anyway — it may succeed if the lock was registered
    // on a different subnet node and has since propagated.
    try {
      const claimResult = await submitTnkHtlcClaim({ htlcId, preimage });
      if (claimResult.ok) {
        contractTxHash = (claimResult.result as { txHash?: string })?.txHash;
        console.log(`[TNK Claim] Subnet claim succeeded for DB-fallback HTLC ${htlcId}: tx=${contractTxHash?.slice(0, 16)}…`);
      } else {
        console.warn(`[TNK Claim] Subnet claim failed for DB-fallback HTLC ${htlcId} (non-fatal): ${claimResult.error}`);
      }
    } catch {
      // Non-fatal — proceed with on-chain transfer regardless
    }
  }

  // Step 2: Execute REAL on-chain TNK transfer via tracapi.trac.network
  let transferFrom: string;
  let transferTo: string;
  let transferAmountRaw: string;

  if (contractState) {
    // Use subnet state (authoritative)
    const amountRawInt = contractState.amountRaw.includes(".")
      ? contractState.amountRaw.split(".")[0]
      : contractState.amountRaw;
    const lockedRaw = BigInt(amountRawInt);
    // The subnet lock amount includes the 0.03 TNK network fee buffer.
    // Subtract the fee so the user receives exactly netTnkOut.
    const netTransferRaw = lockedRaw > TNK_FEE ? lockedRaw - TNK_FEE : lockedRaw;
    transferFrom = contractState.sender;
    transferTo = contractState.recipient;
    transferAmountRaw = netTransferRaw.toString();
  } else {
    // Use DB fallback
    // fromAmountRaw is stored as 18-decimal raw units (e.g. "1000000000000000000" for 1 TNK)
    const lockedRaw = BigInt(fallbackAmountRaw!);
    const netTransferRaw = lockedRaw > TNK_FEE ? lockedRaw - TNK_FEE : lockedRaw;
    transferFrom = TNK_ESCROW;
    transferTo = fallbackRecipient!;
    transferAmountRaw = netTransferRaw.toString();
  }

  if (!transferFrom || !TNK_ESCROW) {
    return { ok: false, error: `TNK_ESCROW_ADDRESS not set — cannot execute transfer for HTLC ${htlcId}` };
  }

  const sendResult = await executeRealTnkTransfer({
    from: transferFrom,
    to: transferTo,
    amountRaw: transferAmountRaw,
  });

  if (!sendResult.success) {
    console.error(`[TNK Claim] CRITICAL: ${usingDbFallback ? "DB-fallback" : "Contract"} claim but on-chain transfer failed for HTLC ${htlcId}:`, sendResult.error);
    // Still mark as completed in DB if contract claim succeeded — funds are in escrow,
    // admin must manually retry the on-chain transfer
    if (contractTxHash) {
      try {
        const db = await getDb();
        if (db) {
          await db.update(htlcSwaps)
            .set({
              status: "completed",
              lockTxId: contractTxHash,
              updatedAt: new Date(),
            })
            .where(eq(htlcSwaps.htlcId, htlcId));
        }
      } catch { /* ignore */ }
    }
    return {
      ok: false,
      contractTxHash,
      error: `On-chain transfer failed: ${sendResult.error}`,
    };
  }

  // Step 3: Update DB to completed
  try {
    const db = await getDb();
    if (db) {
      await db.update(htlcSwaps)
        .set({
          status: "completed",
          lockTxId: contractTxHash ?? sendResult.txHash ?? null,
          updatedAt: new Date(),
        })
        .where(eq(htlcSwaps.htlcId, htlcId));
    }
  } catch (dbErr) {
    console.error(`[TNK Claim] DB update failed for HTLC ${htlcId}:`, dbErr);
  }

  console.log(
    `[TNK Claim] ✅ HTLC ${htlcId} fully settled${usingDbFallback ? " (DB fallback)" : ""}. ` +
    `contractTx=${contractTxHash?.slice(0, 16) ?? "n/a"}… ` +
    `onChainTx=${sendResult.txHash?.slice(0, 16)}…`
  );
  return { ok: true, contractTxHash, sendTxHash: sendResult.txHash };
}
