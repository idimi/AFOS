/**
 * HTLC Secrets Expiry Monitor
 *
 * Runs every 60 seconds and checks `htlc_secrets` rows where:
 *   - status is still 'locked' (Agent A has not yet revealed the secret)
 *   - expiresAt has passed (the swap window has expired)
 *
 * On expiry it:
 *   1. Marks the row as 'expired' in the DB
 *   2. Sends an htlc_expired signaling message to both parties (if online)
 *   3. Notifies the project owner via the Manus notification service
 *
 * For rows that are 'revealed' but not yet 'completed' (Agent B has not claimed),
 * it sends a reminder signaling message so the browser can re-show the Claim button.
 */

import { getActiveHtlcSecrets, updateHtlcSecretStatus } from "../db";
import { sendToPeer } from "../signaling";
import { notifyOwner } from "../_core/notification";

const POLL_INTERVAL_MS = 60_000; // 1 minute
let monitorInterval: ReturnType<typeof setInterval> | null = null;

async function runHtlcSecretsCheck(): Promise<void> {
  let rows;
  try {
    rows = await getActiveHtlcSecrets();
  } catch (err) {
    console.warn("[HtlcSecretsMonitor] DB query failed:", err);
    return;
  }

  const now = BigInt(Date.now());

  for (const row of rows) {
    try {
      const expiresAt = BigInt(row.expiresAt);

      // ── Case 1: locked + expired ─────────────────────────────────────────────
      if (row.status === "locked" && expiresAt < now) {
        console.log(
          `[HtlcSecretsMonitor] Expiring locked HTLC secret rfqId=${row.rfqId} ` +
          `(expired ${Math.round((Number(now) - Number(expiresAt)) / 1000)}s ago)`
        );

        // Mark as expired in the DB
        await updateHtlcSecretStatus(row.rfqId, "expired");

        // Notify both parties via signaling if they are online
        const expiredMsg = {
          type: "htlc_expired",
          rfqId: row.rfqId,
          fromChain: row.fromChain,
          toChain: row.toChain,
          expiresAt: Number(expiresAt),
          lockTxId: row.lockTxId ?? undefined,
          reason: "swap_window_expired",
          message: "The HTLC swap window has expired. Both parties may now refund their locked funds.",
        };

        // Notify Agent A (requester) — identified by counterpartyPeerId stored in the row
        // Note: the row's counterpartyPeerId is Agent B's peer ID from Agent A's perspective.
        // We broadcast to both so both sides can trigger refund UI.
        if (row.counterpartyPeerId) {
          const sentToB = sendToPeer(row.counterpartyPeerId, expiredMsg);
          if (sentToB) {
            console.log(`[HtlcSecretsMonitor] Sent htlc_expired to Agent B peer=${row.counterpartyPeerId}`);
          }
        }

        // Notify project owner
        try {
          await notifyOwner({
            title: "⏰ HTLC Swap Expired",
            content:
              `RFQ ${row.rfqId} expired without settlement.\n` +
              `Chain: ${row.fromChain} → ${row.toChain}\n` +
              `Counterparty peer: ${row.counterpartyPeerId ?? "unknown"}\n` +
              `Expired at: ${new Date(Number(expiresAt)).toISOString()}`,
          });
        } catch {
          // Non-critical — notification failure should not break the monitor
        }
      }

      // ── Case 2: revealed but not yet completed — send reminder ───────────────
      if (row.status === "revealed" && expiresAt > now) {
        // Secret was revealed (Agent A claimed) but Agent B hasn't claimed yet.
        // Re-broadcast the secret so the browser can re-show the Claim button
        // (handles page reloads or missed WebSocket messages).
        if (row.counterpartyPeerId) {
          const reminderMsg = {
            type: "htlc_secret_reminder",
            rfqId: row.rfqId,
            secretHex: row.secretHex,
            expiresAt: Number(expiresAt),
            message: "Secret reminder: Agent A has already revealed the secret. Please claim your funds.",
          };
          const sent = sendToPeer(row.counterpartyPeerId, reminderMsg);
          if (sent) {
            console.log(
              `[HtlcSecretsMonitor] Sent htlc_secret_reminder to Agent B peer=${row.counterpartyPeerId} rfqId=${row.rfqId}`
            );
          }
        }
      }
    } catch (err) {
      console.error(`[HtlcSecretsMonitor] Error processing rfqId=${row.rfqId}:`, err);
    }
  }
}

/**
 * Start the HTLC secrets expiry monitor.
 * Safe to call multiple times — only one interval is created.
 */
export function startHtlcSecretsMonitor(): void {
  if (monitorInterval) return;

  console.log("[HtlcSecretsMonitor] Starting — polling every 60s");

  // Run immediately on startup (after a short delay for DB pool warm-up)
  setTimeout(() => runHtlcSecretsCheck().catch(console.error), 5_000);

  monitorInterval = setInterval(
    () => runHtlcSecretsCheck().catch(console.error),
    POLL_INTERVAL_MS
  );
}

/** Stop the monitor (useful for tests). */
export function stopHtlcSecretsMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}
