/**
 * tnkHtlcRefund.ts — Autonomous TNK HTLC refund executor
 *
 * Flow:
 *   1. Verify the HTLC is in "locked" status and timelock has expired
 *   2. Submit htlc_refund to the subnet contract
 *   3. Execute sendTNK via the peer's /v1/agent/send to return funds to sender
 *   4. Update the htlcSwaps DB row to status="refunded"
 */

import { getDb } from "./db";
import { htlcSwaps } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { getTnkHtlcState, submitTnkHtlcRefund, isTnkPeerHealthy } from "./tnkHtlcContract";

const getPeerRpcUrl = () => process.env.TNK_PEER_RPC_URL ?? "http://localhost:5001";
const getServerSecret = () => process.env.AFOS_SERVER_SECRET ?? "";

async function agentSendTnk(params: {
  from: string;
  to: string;
  amount: string;
}): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const res = await fetch(`${getPeerRpcUrl()}/v1/agent/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Afos-Secret": getServerSecret(),
      },
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

export interface TnkRefundResult {
  ok: boolean;
  contractTxHash?: string;
  sendTxHash?: string;
  error?: string;
}

/**
 * Refund a locked TNK HTLC after the timelock has expired.
 */
export async function refundTnkHtlc(htlcId: string): Promise<TnkRefundResult> {
  const healthy = await isTnkPeerHealthy();
  if (!healthy) {
    return { ok: false, error: "trac-peer-unreachable" };
  }

  const contractState = await getTnkHtlcState(htlcId);
  if (!contractState) {
    return { ok: false, error: `HTLC ${htlcId} not found in subnet state` };
  }
  if (contractState.status !== "locked") {
    return { ok: false, error: `HTLC ${htlcId} not refundable (status: ${contractState.status})` };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= contractState.locktime) {
    const remaining = contractState.locktime - now;
    return { ok: false, error: `HTLC ${htlcId} timelock not expired (${remaining}s remaining)` };
  }

  const refundResult = await submitTnkHtlcRefund({ htlcId });
  if (!refundResult.ok) {
    return { ok: false, error: `Contract refund failed: ${refundResult.error}` };
  }
  const contractTxHash = (refundResult.result as { txHash?: string })?.txHash;

  const contractAddress = process.env.TNK_HTLC_CONTRACT_ADDRESS ?? contractState.recipient;
  const sendResult = await agentSendTnk({
    from: contractAddress,
    to: contractState.sender,
    amount: contractState.amountRaw,
  });

  if (!sendResult.success) {
    console.error(
      `[TNK Refund] CRITICAL: Contract refunded but sendTNK failed for HTLC ${htlcId}:`,
      sendResult.error
    );
  }

  try {
    const db = await getDb();
    if (db) {
      await db
        .update(htlcSwaps)
        .set({ status: "refunded", updatedAt: new Date() })
        .where(eq(htlcSwaps.htlcId, htlcId));
    }
  } catch (dbErr) {
    console.error(`[TNK Refund] DB update failed for HTLC ${htlcId}:`, dbErr);
  }

  console.log(
    `[TNK Refund] HTLC ${htlcId} refunded. ` +
    `contractTx=${contractTxHash?.slice(0, 16)}... ` +
    `sendTx=${sendResult.txHash?.slice(0, 16)}...`
  );

  return { ok: true, contractTxHash, sendTxHash: sendResult.txHash };
}
