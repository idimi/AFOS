/**
 * tnkHtlcClaim.ts — Autonomous TNK HTLC claim executor
 *
 * Flow:
 *   1. Verify the HTLC is in "locked" status on the subnet
 *      → Retries with exponential backoff for up to 90 seconds to handle the
 *        race condition where Agent B locks USDT before Agent A's htlc_lock
 *        transaction is confirmed on the Trac Network subnet.
 *   2. Verify sha256(preimage) == secretHash
 *   3. Submit htlc_claim to the subnet contract
 *   4. Execute sendTNK via the peer's /v1/agent/send to release funds to recipient
 *      → Retries up to 3 times on transient failure
 *   5. Update the htlcSwaps DB row to status="completed"
 */

import crypto from "node:crypto";
import { getDb } from "./db";
import { htlcSwaps } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { getTnkHtlcState, submitTnkHtlcClaim, isTnkPeerHealthy } from "./tnkHtlcContract";

const PEER_RPC_URL = () => process.env.TNK_PEER_RPC_URL ?? "http://localhost:5001";
const AFOS_SERVER_SECRET = () => process.env.AFOS_SERVER_SECRET ?? "";

/** Maximum time (ms) to wait for Agent A's htlc_lock to appear on the subnet */
const HTLC_CONFIRM_TIMEOUT_MS = 90_000;
/** Initial backoff (ms) between subnet state polls */
const HTLC_POLL_INITIAL_MS = 3_000;
/** Backoff multiplier */
const HTLC_POLL_BACKOFF = 1.5;
/** Maximum backoff cap (ms) */
const HTLC_POLL_MAX_MS = 15_000;

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

async function agentSendTnk(params: {
  from: string; to: string; amount: string;
}, maxRetries = 3): Promise<{ success: boolean; txHash?: string; error?: string }> {
  let lastError = "";
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${PEER_RPC_URL()}/v1/agent/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Afos-Secret": AFOS_SERVER_SECRET() },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        lastError = `sendTNK HTTP ${res.status}: ${text.slice(0, 200)}`;
        if (attempt < maxRetries) {
          console.warn(`[TNK Claim] agentSendTnk attempt ${attempt} failed: ${lastError} — retrying…`);
          await sleep(2_000 * attempt);
          continue;
        }
        return { success: false, error: lastError };
      }
      return res.json() as Promise<{ success: boolean; txHash?: string }>;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < maxRetries) {
        console.warn(`[TNK Claim] agentSendTnk attempt ${attempt} threw: ${lastError} — retrying…`);
        await sleep(2_000 * attempt);
        continue;
      }
      return { success: false, error: lastError };
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

export async function claimTnkHtlc(htlcId: string, preimage: string): Promise<TnkClaimResult> {
  const healthy = await isTnkPeerHealthy();
  if (!healthy) {
    return { ok: false, error: "trac-peer-unreachable" };
  }

  // Wait for Agent A's htlc_lock to be confirmed on the subnet (up to 90s)
  const waitResult = await waitForTnkHtlcLocked(htlcId);
  if ("error" in waitResult) {
    return { ok: false, error: waitResult.error };
  }
  const contractState = waitResult.state;

  const computedHash = sha256Hex(preimage);
  if (computedHash !== contractState.secretHash) {
    return { ok: false, error: `Preimage mismatch: sha256=${computedHash} != ${contractState.secretHash}` };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > contractState.locktime) {
    return { ok: false, error: `HTLC ${htlcId} timelock expired (locktime=${contractState.locktime}, now=${now})` };
  }

  const claimResult = await submitTnkHtlcClaim({ htlcId, preimage });
  if (!claimResult.ok) {
    return { ok: false, error: `Contract claim failed: ${claimResult.error}` };
  }
  const contractTxHash = (claimResult.result as { txHash?: string })?.txHash;

  const sendResult = await agentSendTnk({
    from: contractState.sender,
    to: contractState.recipient,
    amount: contractState.amountRaw,
  });

  if (!sendResult.success) {
    console.error(`[TNK Claim] CRITICAL: Contract claimed but sendTNK failed for HTLC ${htlcId}:`, sendResult.error);
  }

  try {
    const db = await getDb();
    if (db) {
      await db.update(htlcSwaps)
        .set({ status: "completed", lockTxId: contractTxHash ?? sendResult.txHash ?? null, updatedAt: new Date() })
        .where(eq(htlcSwaps.htlcId, htlcId));
    }
  } catch (dbErr) {
    console.error(`[TNK Claim] DB update failed for HTLC ${htlcId}:`, dbErr);
  }

  console.log(`[TNK Claim] HTLC ${htlcId} claimed. contractTx=${contractTxHash?.slice(0,16)}… sendTx=${sendResult.txHash?.slice(0,16)}…`);
  return { ok: true, contractTxHash, sendTxHash: sendResult.txHash };
}
