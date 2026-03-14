/**
 * tnkHtlcClaim.ts — Autonomous TNK HTLC claim executor
 *
 * Flow:
 *   1. Verify the HTLC is in "locked" status on the subnet
 *   2. Verify sha256(preimage) == secretHash
 *   3. Submit htlc_claim to the subnet contract
 *   4. Execute sendTNK via the peer's /v1/agent/send to release funds to recipient
 *   5. Update the htlcSwaps DB row to status="completed"
 */

import crypto from "node:crypto";
import { getDb } from "./db";
import { htlcSwaps } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { getTnkHtlcState, submitTnkHtlcClaim, isTnkPeerHealthy } from "./tnkHtlcContract";

const PEER_RPC_URL = () => process.env.TNK_PEER_RPC_URL ?? "http://localhost:5001";
const AFOS_SERVER_SECRET = () => process.env.AFOS_SERVER_SECRET ?? "";

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

async function agentSendTnk(params: {
  from: string; to: string; amount: string;
}): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const res = await fetch(`${PEER_RPC_URL()}/v1/agent/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Afos-Secret": AFOS_SERVER_SECRET() },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { success: false, error: `sendTNK HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    return res.json() as Promise<{ success: boolean; txHash?: string }>;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
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

  const contractState = await getTnkHtlcState(htlcId);
  if (!contractState) {
    return { ok: false, error: `HTLC ${htlcId} not found in subnet state` };
  }
  if (contractState.status !== "locked") {
    return { ok: false, error: `HTLC ${htlcId} is not claimable (status: ${contractState.status})` };
  }

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

  console.log(`[TNK Claim] HTLC ${htlcId} claimed. contractTx=${contractTxHash?.slice(0,16)}... sendTx=${sendResult.txHash?.slice(0,16)}...`);
  return { ok: true, contractTxHash, sendTxHash: sendResult.txHash };
}
