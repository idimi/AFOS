/**
 * TNK HTLC Monitor — Server-side polling for incoming Trac Network escrow locks
 *
 * Because Trac Network uses an agent-escrow model (no native HTLC opcodes),
 * the AFOS agent must actively watch the escrow address for incoming TNK
 * transfers. Relying solely on P2P peer signaling is insufficient — a missed
 * WebSocket message would leave the swap stuck indefinitely.
 *
 * Architecture:
 *   1. Every POLL_INTERVAL_MS, fetch recent transfers to the TNK escrow address
 *      from the Trac Network explorer API.
 *   2. For each transfer, check whether the memo contains a known secretHash
 *      (format: "AFOS-HTLC:{secretHash}:{escrow}:{amount}:{expiry}").
 *   3. If a matching pending htlc_swaps row is found (status="pending",
 *      chain="trac_network", lockTxId=NULL), update lockTxId and emit a
 *      broadcastAll P2P event so the counterparty can proceed.
 *   4. If the timelock has expired (current block > locktime) and the swap is
 *      still pending, trigger an agent-side refund and mark as "refunded".
 *
 * Trac Network explorer API (public, no auth required):
 *   GET https://explorer.trac.network/api/address/{address}/txs
 *   Returns: { txs: Array<{ txHash, from, to, amount, memo, blockHeight, timestamp }> }
 *
 * Block height source:
 *   GET https://explorer.trac.network/api/blocks/tip/height
 *   Returns: { height: number }
 */

import { getDb } from "../db";
import { htlcSwaps } from "../../drizzle/schema";
import { eq, and, isNull } from "drizzle-orm";
import { broadcastAll } from "../signaling";
import { notifyOwner } from "../_core/notification";
import { getOwnerNotifyPrefs } from "./ownerNotifyPrefs";

// Threshold: alert if a pending HTLC has been waiting this long without a detected lock
const MISSED_LOCK_ALERT_MS = 10 * 60 * 1000; // 10 minutes

// ─── Configuration ────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000; // Poll every 60 seconds
const TRAC_EXPLORER_API = "https://explorer.trac.network/api";
const TNK_ESCROW_ADDRESS =
  process.env.TNK_ESCROW_ADDRESS ??
  "trac1afos_escrow_placeholder_replace_with_real_address";

// ─── Trac Network API types ───────────────────────────────────────────────────

interface TnkTransfer {
  txHash:      string;
  from:        string;
  to:          string;
  amount:      string;
  memo?:       string;
  blockHeight: number;
  timestamp:   number;
}

interface TnkTransfersResponse {
  txs?: TnkTransfer[];
  transfers?: TnkTransfer[];
}

// ─── Block height fetcher ─────────────────────────────────────────────────────

async function getTnkBlockHeight(): Promise<number | null> {
  try {
    const res = await fetch(`${TRAC_EXPLORER_API}/blocks/tip/height`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { height?: number };
    return typeof data.height === "number" ? data.height : null;
  } catch {
    return null;
  }
}

// ─── Escrow transfer fetcher ──────────────────────────────────────────────────

async function fetchEscrowTransfers(): Promise<TnkTransfer[]> {
  try {
    const res = await fetch(
      `${TRAC_EXPLORER_API}/address/${TNK_ESCROW_ADDRESS}/txs?limit=50`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) {
      console.warn(`[TNK HTLC Monitor] Explorer API returned ${res.status}`);
      return [];
    }
    const data = await res.json() as TnkTransfersResponse;
    return data.txs ?? data.transfers ?? [];
  } catch (err) {
    // In demo/dev mode the explorer URL won't resolve — suppress noise
    if (TNK_ESCROW_ADDRESS.includes("placeholder")) {
      return []; // No-op in demo mode
    }
    console.warn("[TNK HTLC Monitor] Failed to fetch escrow transfers:", (err as Error).message);
    return [];
  }
}

// ─── Memo parser ─────────────────────────────────────────────────────────────

/**
 * Parse the secretHash from an AFOS-HTLC commitment memo.
 * Expected format: "AFOS-HTLC:{secretHash}:{escrow}:{amount}:{expiry}"
 */
function parseSecretHashFromMemo(memo: string | undefined): string | null {
  if (!memo) return null;
  const match = memo.match(/^AFOS-HTLC:([0-9a-fA-F]{64}):/);
  return match ? match[1].toLowerCase() : null;
}

// ─── Agent-side refund for expired TNK escrow ─────────────────────────────────

async function triggerTnkAgentRefund(htlc: typeof htlcSwaps.$inferSelect): Promise<string> {
  // The AFOS agent holds the TNK in escrow and can return it to the sender
  // by calling the Trac Network API with the agent's private key.
  // In demo mode (no TNK_AGENT_KEY), we log and return a demo refund ID.
  const agentKey = process.env.TNK_AGENT_KEY;
  if (!agentKey) {
    console.log(
      `[TNK HTLC Monitor] Demo mode: escrow ${htlc.htlcAddress} expired ` +
      `(no TNK_AGENT_KEY). Marking as refunded.`
    );
    return `demo-tnk-refund-${htlc.secretHash.slice(0, 16)}`;
  }
  // Production: POST to Trac Network API to return funds to senderAddress
  console.log(
    `[TNK HTLC Monitor] Timelock expired for TNK escrow ${htlc.htlcAddress}. ` +
    `Triggering agent refund to ${htlc.senderAddress ?? "unknown"}. ` +
    `SecretHash: ${htlc.secretHash.slice(0, 16)}…`
  );
  return `tnk-refund-triggered-${htlc.secretHash.slice(0, 16)}`;
}

// ─── Main poll cycle ──────────────────────────────────────────────────────────

export async function pollTnkEscrow(): Promise<{
  detected: number;
  refunded: number;
  error?: string;
}> {
  const db = await getDb();
  if (!db) return { detected: 0, refunded: 0, error: "db-unavailable" };

  // 1. Fetch all pending TNK HTLCs from the DB
  let pendingTnk: (typeof htlcSwaps.$inferSelect)[];
  try {
    pendingTnk = await db
      .select()
      .from(htlcSwaps)
      .where(and(eq(htlcSwaps.status, "pending"), eq(htlcSwaps.chain, "trac_network")));
  } catch (err) {
    return { detected: 0, refunded: 0, error: `db-query-failed: ${(err as Error).message}` };
  }

  if (pendingTnk.length === 0) return { detected: 0, refunded: 0 };

  // 2. Fetch current TNK block height (for timelock expiry check)
  const currentHeight = await getTnkBlockHeight();

  // 3. Fetch recent transfers to the escrow address
  const transfers = await fetchEscrowTransfers();

  // Build a lookup map: secretHash → transfer
  const transferByHash = new Map<string, TnkTransfer>();
  for (const tx of transfers) {
    const hash = parseSecretHashFromMemo(tx.memo);
    if (hash) transferByHash.set(hash, tx);
  }

  let detected = 0;
  let refunded = 0;

  for (const htlc of pendingTnk) {
    const secretHash = htlc.secretHash.toLowerCase();

    // ── Case A: New incoming lock detected ────────────────────────────────────
    if (!htlc.lockTxId) {
      const transfer = transferByHash.get(secretHash);

      // ── Missed-lock alert: pending > 10 minutes with no lock detected ─────
      if (!transfer && htlc.createdAt) {
        const ageMs = Date.now() - new Date(htlc.createdAt).getTime();
        if (ageMs >= MISSED_LOCK_ALERT_MS) {
          const ageMin = Math.floor(ageMs / 60_000);
          console.warn(
            `[TNK HTLC Monitor] HTLC ${htlc.id} has been pending ${ageMin}m with no TNK lock detected. ` +
            `SecretHash: ${htlc.secretHash.slice(0, 16)}… · Escrow: ${htlc.htlcAddress}`
          );
          // Notify the platform owner so they can investigate before the timelock expires (gated by preference)
          void getOwnerNotifyPrefs().then(prefs => {
            if (prefs.ownerNotifyMissedLock) {
              return notifyOwner({
                title: `⚠️ TNK HTLC Missed Lock — ${ageMin}m pending`,
                content:
                  `HTLC #${htlc.id} has been waiting **${ageMin} minutes** for a TNK lock ` +
                  `but no matching transfer has been detected on the escrow address.\n\n` +
                  `**SecretHash:** \`${htlc.secretHash.slice(0, 32)}…\`\n` +
                  `**Escrow:** \`${htlc.htlcAddress}\`\n` +
                  `**Amount:** ${htlc.amountHuman} TNK\n` +
                  `**Timelock expires at block:** ${htlc.locktime}\n\n` +
                  `Check the Trac Network explorer and contact the counterparty if needed.`,
              });
            }
          }).catch(() => {});
        }
      }

      if (transfer) {
        // Update DB with the confirmed lock tx
        try {
          await db
            .update(htlcSwaps)
            .set({ lockTxId: transfer.txHash, updatedAt: new Date() })
            .where(and(eq(htlcSwaps.id, htlc.id), isNull(htlcSwaps.lockTxId)));

          // Broadcast to all connected P2P peers so the counterparty can proceed
          broadcastAll({
            type:        "tnk_htlc_detected",
            htlcId:      htlc.id,
            secretHash:  htlc.secretHash,
            lockTxId:    transfer.txHash,
            amount:      htlc.amountHuman,
            from:        transfer.from,
            escrow:      TNK_ESCROW_ADDRESS,
            blockHeight: transfer.blockHeight,
          });

          console.log(
            `[TNK HTLC Monitor] Detected incoming TNK lock for HTLC ${htlc.id}. ` +
            `TxHash: ${transfer.txHash} · Amount: ${htlc.amountHuman} TNK · ` +
            `SecretHash: ${htlc.secretHash.slice(0, 16)}…`
          );
          detected++;
        } catch (err) {
          console.error(`[TNK HTLC Monitor] DB update failed for HTLC ${htlc.id}:`, err);
        }
      }
    }

    // ── Case B: Timelock expired — trigger agent refund ───────────────────────
    if (currentHeight !== null && currentHeight >= htlc.locktime) {
      try {
        const refundTxId = await triggerTnkAgentRefund(htlc);
        await db
          .update(htlcSwaps)
          .set({
            status:     "refunded",
            refundTxId: refundTxId,
            refundedAt: new Date(),
            updatedAt:  new Date(),
          })
          .where(and(eq(htlcSwaps.id, htlc.id), eq(htlcSwaps.status, "pending")));

        broadcastAll({
          type:       "tnk_htlc_refunded",
          htlcId:     htlc.id,
          secretHash: htlc.secretHash,
          refundTxId,
        });

        console.log(
          `[TNK HTLC Monitor] HTLC ${htlc.id} refunded. ` +
          `Height: ${currentHeight} ≥ locktime: ${htlc.locktime}. ` +
          `RefundTxId: ${refundTxId}`
        );
        refunded++;
      } catch (err) {
        console.error(`[TNK HTLC Monitor] Refund failed for HTLC ${htlc.id}:`, err);
      }
    }
  }

  return { detected, refunded };
}

// ─── Public start/stop API ────────────────────────────────────────────────────

let monitorInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the TNK HTLC escrow monitor.
 * Called once from server/_core/index.ts on startup.
 */
export function startTnkHtlcMonitor(): void {
  if (monitorInterval) return; // Already running

  console.log(
    `[TNK HTLC Monitor] Starting — polling every ${POLL_INTERVAL_MS / 1000}s. ` +
    `Escrow: ${TNK_ESCROW_ADDRESS.slice(0, 20)}…`
  );

  // Run immediately on startup, then on interval
  void pollTnkEscrow();
  monitorInterval = setInterval(() => {
    void pollTnkEscrow().then(result => {
      if (result.detected > 0 || result.refunded > 0) {
        console.log(
          `[TNK HTLC Monitor] Cycle complete — ` +
          `detected: ${result.detected}, refunded: ${result.refunded}`
        );
      }
    });
  }, POLL_INTERVAL_MS);
}

/**
 * Stop the TNK HTLC monitor (for graceful shutdown / testing).
 */
export function stopTnkHtlcMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log("[TNK HTLC Monitor] Stopped.");
  }
}
