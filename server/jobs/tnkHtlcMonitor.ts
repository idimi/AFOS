/**
 * TNK HTLC Monitor — Server-side polling for Trac Network HTLC state
 *
 * Architecture (dual-mode):
 *
 * PRIMARY — trac-peer subnet mode (when TNK_PEER_RPC_URL is set and healthy):
 *   1. Every POLL_INTERVAL_MS, query the trac-peer subnet for each pending HTLC's
 *      contract state via GET /v1/state?key=htlc/{htlcId}.
 *   2. If the contract state shows "locked" and the DB row has no lockTxId,
 *      update the DB and broadcast a P2P event.
 *   3. If the contract state shows "claimed", mark the DB row as "completed".
 *   4. If the timelock has expired and the HTLC is still "locked", call
 *      refundTnkHtlc() to submit an htlc_refund contract command and return funds.
 *
 * FALLBACK — legacy explorer polling (when peer is unreachable):
 *   Same as the original agent-escrow monitor: poll the Trac Network explorer
 *   API for incoming transfers to the escrow address. This ensures the swap
 *   continues to work even if the trac-peer node is temporarily down.
 *
 * The monitor automatically switches between modes on each poll cycle.
 */

import { getDb } from "../db";
import { htlcSwaps, htlcSecrets } from "../../drizzle/schema";
import { eq, and, isNull } from "drizzle-orm";
import { broadcastAll } from "../signaling";
import { notifyOwner } from "../_core/notification";
import { getOwnerNotifyPrefs } from "./ownerNotifyPrefs";
import {
  isTnkPeerHealthy,
  getTnkHtlcState,
  getTnkBlockHeight as getPeerBlockHeight,
} from "../tnkHtlcContract";
import { refundTnkHtlc } from "../tnkHtlcRefund";

// ─── Configuration ────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000;
const TRAC_EXPLORER_API = "https://explorer.trac.network/api";
const TNK_ESCROW_ADDRESS =
  process.env.TNK_ESCROW_ADDRESS ?? "trac1afos_escrow_placeholder_replace_with_real_address";
const MISSED_LOCK_ALERT_MS = 10 * 60 * 1000;

// ─── Legacy explorer types ────────────────────────────────────────────────────

interface TnkTransfer {
  txHash:      string;
  from:        string;
  to:          string;
  amount:      string;
  memo?:       string;
  blockHeight: number;
  timestamp:   number;
}

// ─── Legacy explorer helpers ──────────────────────────────────────────────────

async function getLegacyBlockHeight(): Promise<number | null> {
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

async function fetchEscrowTransfers(): Promise<TnkTransfer[]> {
  try {
    const res = await fetch(
      `${TRAC_EXPLORER_API}/address/${TNK_ESCROW_ADDRESS}/txs?limit=50`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return [];
    const data = await res.json() as { txs?: TnkTransfer[]; transfers?: TnkTransfer[] };
    return data.txs ?? data.transfers ?? [];
  } catch {
    if (TNK_ESCROW_ADDRESS.includes("placeholder")) return [];
    return [];
  }
}

function parseSecretHashFromMemo(memo: string | undefined): string | null {
  if (!memo) return null;
  const match = memo.match(/^AFOS-HTLC:([0-9a-fA-F]{64}):/);
  return match ? match[1].toLowerCase() : null;
}

// ─── Subnet-mode poll cycle ───────────────────────────────────────────────────

async function pollSubnetMode(
  pendingTnk: (typeof htlcSwaps.$inferSelect)[]
): Promise<{ detected: number; refunded: number }> {
  const db = await getDb();
  if (!db) return { detected: 0, refunded: 0 };

  let detected = 0;
  let refunded = 0;

  for (const htlc of pendingTnk) {
    const contractState = await getTnkHtlcState(htlc.htlcId ?? String(htlc.id));

    if (!contractState) {
      // HTLC not yet registered on subnet — check for missed-lock alert
      if (htlc.createdAt) {
        const ageMs = Date.now() - new Date(htlc.createdAt).getTime();
        if (ageMs >= MISSED_LOCK_ALERT_MS) {
          const ageMin = Math.floor(ageMs / 60_000);
          console.warn(`[TNK Monitor] HTLC ${htlc.id} pending ${ageMin}m with no subnet state`);
          void getOwnerNotifyPrefs().then(prefs => {
            if (prefs.ownerNotifyMissedLock) {
              return notifyOwner({
                title: `⚠️ TNK HTLC Missed Lock — ${ageMin}m pending`,
                content:
                  `HTLC #${htlc.id} has been waiting **${ageMin} minutes** for a TNK lock ` +
                  `but no subnet state was found.\n\n` +
                  `**SecretHash:** \`${htlc.secretHash.slice(0, 32)}…\`\n` +
                  `**Amount:** ${htlc.amountHuman} TNK`,
              });
            }
          }).catch(() => {});
        }
      }
      continue;
    }

    // ── Case A: Lock confirmed on subnet ──────────────────────────────────────
    if (contractState.status === "locked" && !htlc.lockTxId) {
      try {
        await db
          .update(htlcSwaps)
          .set({
            lockTxId:  contractState.lockTxHash ?? `subnet-${htlc.id}`,
            updatedAt: new Date(),
          })
          .where(and(eq(htlcSwaps.id, htlc.id), isNull(htlcSwaps.lockTxId)));

        broadcastAll({
          type:       "tnk_htlc_detected",
          htlcId:     htlc.id,
          secretHash: htlc.secretHash,
          lockTxId:   contractState.lockTxHash ?? `subnet-${htlc.id}`,
          amount:     htlc.amountHuman,
          from:       contractState.sender,
          escrow:     process.env.TNK_HTLC_CONTRACT_ADDRESS ?? TNK_ESCROW_ADDRESS,
          source:     "subnet",
        });

        console.log(`[TNK Monitor] Subnet: Lock confirmed for HTLC ${htlc.id} (${htlc.amountHuman} TNK)`);
        detected++;

        // ── isTnkToSol: user locked TNK → agent claims TNK + releases Solana ──
        // When toChain === "solana", this is a TNK→SOL/USDT/USDC swap.
        // The user just locked TNK on Trac Network (htlc_b_). We must:
        //   a) Claim the user's TNK lock (htlc_b_) → agent receives TNK
        //   b) Release the agent's Solana lock (htlc_a_) → user receives SOL/USDT/USDC
        if (htlc.toChain === "solana" && htlc.rfqId) {
          const rfqId = htlc.rfqId;
          void (async () => {
            try {
              // Look up the htlcSecrets row to get the plaintext secret
              const secretRows = await db
                .select()
                .from(htlcSecrets)
                .where(eq(htlcSecrets.rfqId, rfqId))
                .limit(1);
              const secretRow = secretRows[0];
              if (!secretRow?.secretHex) {
                console.error(`[TNK Monitor] isTnkToSol: No secret found for rfqId=${rfqId.slice(0, 12)}…`);
                return;
              }
              // htlcIdB = user's TNK lock (htlc_b_<rfqId slice>)
              // htlcIdA = agent's Solana lock (htlc_a_<rfqId slice>)
              const htlcIdB = `htlc_b_${rfqId.slice(0, 22)}`;
              const htlcIdA = `htlc_a_${rfqId.slice(0, 22)}`;
              const userSolanaAddress = htlc.senderAddress ?? secretRow.initiatorAddress ?? "";
              const toTokenSym = htlc.toToken ?? "SOL";

              // Step a: Claim user's TNK lock → agent receives TNK
              const { claimTnkHtlc } = await import("../tnkHtlcClaim.js");
              const claimTnk = await claimTnkHtlc(htlcIdB, secretRow.secretHex);
              if (!claimTnk.ok) {
                console.error(`[TNK Monitor] isTnkToSol: TNK claim failed for htlcIdB=${htlcIdB}: ${claimTnk.error}`);
                // Non-fatal — will retry on next poll cycle
                return;
              }
              console.log(`[TNK Monitor] isTnkToSol: Claimed user's TNK lock (htlcIdB=${htlcIdB}): tx=${claimTnk.contractTxHash?.slice(0, 16)}…`);

              // Step b: Release agent's Solana lock → user receives SOL/USDT/USDC
              const { claimSolanaHtlc } = await import("../solanaHtlcClaim.js");
              const claimSol = await claimSolanaHtlc({
                htlcId:           htlcIdA,
                secretHex:        secretRow.secretHex,
                recipientAddress: userSolanaAddress,
                tokenSymbol:      toTokenSym === "SOL" ? undefined : toTokenSym,
              });
              console.log(`[TNK Monitor] isTnkToSol: Released ${toTokenSym} to user (htlcIdA=${htlcIdA}): tx=${claimSol.txSignature.slice(0, 16)}…`);

              // Mark as completed
              const now = new Date();
              await db.update(htlcSecrets)
                .set({ status: "completed", revealTxId: claimSol.txSignature, settledAt: now, settledVia: "tnk_monitor", updatedAt: now })
                .where(eq(htlcSecrets.rfqId, rfqId));
              await db.update(htlcSwaps)
                .set({ status: "completed", updatedAt: now })
                .where(eq(htlcSwaps.rfqId, rfqId));

              broadcastAll({
                type:       "tnk_to_sol_settled",
                rfqId,
                htlcIdA,
                htlcIdB,
                toToken:    toTokenSym,
                claimSolTx: claimSol.txSignature,
                claimTnkTx: claimTnk.contractTxHash,
              });
              console.log(`[TNK Monitor] isTnkToSol: Swap rfqId=${rfqId.slice(0, 12)}… fully settled.`);
            } catch (settleErr) {
              const msg = settleErr instanceof Error ? settleErr.message : String(settleErr);
              // "already" errors mean on-chain state is already settled — mark completed
              if (msg.includes("already") || msg.includes("0x1774") || msg.includes("0x1775")) {
                await db.update(htlcSecrets)
                  .set({ status: "completed", updatedAt: new Date() })
                  .where(eq(htlcSecrets.rfqId, rfqId))
                  .catch(() => {});
                await db.update(htlcSwaps)
                  .set({ status: "completed", updatedAt: new Date() })
                  .where(eq(htlcSwaps.rfqId, rfqId))
                  .catch(() => {});
              } else {
                console.error(`[TNK Monitor] isTnkToSol settlement failed for rfqId=${rfqId.slice(0, 12)}…:`, msg);
              }
            }
          })();
        }
      } catch (err) {
        console.error(`[TNK Monitor] DB update failed for HTLC ${htlc.id}:`, err);
      }
    }

    // ── Case B: Already claimed on subnet ─────────────────────────────────────
    if (contractState.status === "claimed" && htlc.status === "pending") {
      try {
        await db
          .update(htlcSwaps)
          .set({ status: "completed", updatedAt: new Date() })
          .where(eq(htlcSwaps.id, htlc.id));

        broadcastAll({ type: "tnk_htlc_claimed", htlcId: htlc.id, secretHash: htlc.secretHash });
        console.log(`[TNK Monitor] Subnet: HTLC ${htlc.id} already claimed — synced DB`);
      } catch (err) {
        console.error(`[TNK Monitor] DB sync failed for claimed HTLC ${htlc.id}:`, err);
      }
    }

    // ── Case C: Timelock expired — trigger refund ─────────────────────────────
    const now = Math.floor(Date.now() / 1000);
    if (contractState.status === "locked" && now > contractState.locktime) {
      try {
        const refundResult = await refundTnkHtlc(htlc.htlcId ?? String(htlc.id));
        if (refundResult.ok) {
          broadcastAll({
            type:       "tnk_htlc_refunded",
            htlcId:     htlc.id,
            secretHash: htlc.secretHash,
            refundTxId: refundResult.contractTxHash ?? refundResult.sendTxHash,
          });
          console.log(`[TNK Monitor] Subnet: HTLC ${htlc.id} refunded`);
          refunded++;
        } else {
          console.error(`[TNK Monitor] Subnet refund failed for HTLC ${htlc.id}:`, refundResult.error);
        }
      } catch (err) {
        console.error(`[TNK Monitor] Refund error for HTLC ${htlc.id}:`, err);
      }
    }
  }

  return { detected, refunded };
}

// ─── Legacy explorer poll cycle ───────────────────────────────────────────────

async function pollLegacyMode(
  pendingTnk: (typeof htlcSwaps.$inferSelect)[]
): Promise<{ detected: number; refunded: number }> {
  const db = await getDb();
  if (!db) return { detected: 0, refunded: 0 };

  const currentHeight = await getLegacyBlockHeight();
  const transfers = await fetchEscrowTransfers();

  const transferByHash = new Map<string, TnkTransfer>();
  for (const tx of transfers) {
    const hash = parseSecretHashFromMemo(tx.memo);
    if (hash) transferByHash.set(hash, tx);
  }

  let detected = 0;
  let refunded = 0;

  for (const htlc of pendingTnk) {
    const secretHash = htlc.secretHash.toLowerCase();

    if (!htlc.lockTxId) {
      const transfer = transferByHash.get(secretHash);

      if (!transfer && htlc.createdAt) {
        const ageMs = Date.now() - new Date(htlc.createdAt).getTime();
        if (ageMs >= MISSED_LOCK_ALERT_MS) {
          const ageMin = Math.floor(ageMs / 60_000);
          console.warn(`[TNK Monitor] Legacy: HTLC ${htlc.id} pending ${ageMin}m with no lock`);
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
        try {
          await db
            .update(htlcSwaps)
            .set({ lockTxId: transfer.txHash, updatedAt: new Date() })
            .where(and(eq(htlcSwaps.id, htlc.id), isNull(htlcSwaps.lockTxId)));

          broadcastAll({
            type:        "tnk_htlc_detected",
            htlcId:      htlc.id,
            secretHash:  htlc.secretHash,
            lockTxId:    transfer.txHash,
            amount:      htlc.amountHuman,
            from:        transfer.from,
            escrow:      TNK_ESCROW_ADDRESS,
            blockHeight: transfer.blockHeight,
            source:      "explorer",
          });

          console.log(`[TNK Monitor] Legacy: Lock detected for HTLC ${htlc.id} (${htlc.amountHuman} TNK)`);
          detected++;
          // ── isTnkToSol legacy fallback ──
          // Mirror the subnet-mode settlement: claim TNK + release Solana tokens.
          if (htlc.toChain === "solana" && htlc.rfqId) {
            const rfqId = htlc.rfqId;
            void (async () => {
              try {
                const secretRows = await db
                  .select()
                  .from(htlcSecrets)
                  .where(eq(htlcSecrets.rfqId, rfqId))
                  .limit(1);
                const secretRow = secretRows[0];
                if (!secretRow?.secretHex) {
                  console.error(`[TNK Monitor] Legacy isTnkToSol: No secret for rfqId=${rfqId.slice(0, 12)}…`);
                  return;
                }
                const htlcIdB = `htlc_b_${rfqId.slice(0, 22)}`;
                const htlcIdA = `htlc_a_${rfqId.slice(0, 22)}`;
                const userSolanaAddress = htlc.senderAddress ?? secretRow.initiatorAddress ?? "";
                const toTokenSym = htlc.toToken ?? "SOL";
                const { claimTnkHtlc } = await import("../tnkHtlcClaim.js");
                const claimTnk = await claimTnkHtlc(htlcIdB, secretRow.secretHex);
                if (!claimTnk.ok) {
                  console.error(`[TNK Monitor] Legacy isTnkToSol: TNK claim failed: ${claimTnk.error}`);
                  return;
                }
                console.log(`[TNK Monitor] Legacy isTnkToSol: Claimed TNK (htlcIdB=${htlcIdB}): tx=${claimTnk.contractTxHash?.slice(0, 16)}…`);
                const { claimSolanaHtlc } = await import("../solanaHtlcClaim.js");
                const claimSol = await claimSolanaHtlc({
                  htlcId:           htlcIdA,
                  secretHex:        secretRow.secretHex,
                  recipientAddress: userSolanaAddress,
                  tokenSymbol:      toTokenSym === "SOL" ? undefined : toTokenSym,
                });
                console.log(`[TNK Monitor] Legacy isTnkToSol: Released ${toTokenSym} (htlcIdA=${htlcIdA}): tx=${claimSol.txSignature.slice(0, 16)}…`);
                const now = new Date();
                await db.update(htlcSecrets)
                  .set({ status: "completed", revealTxId: claimSol.txSignature, settledAt: now, settledVia: "tnk_monitor_legacy", updatedAt: now })
                  .where(eq(htlcSecrets.rfqId, rfqId));
                await db.update(htlcSwaps)
                  .set({ status: "completed", updatedAt: now })
                  .where(eq(htlcSwaps.rfqId, rfqId));
                broadcastAll({
                  type:       "tnk_to_sol_settled",
                  rfqId,
                  htlcIdA,
                  htlcIdB,
                  toToken:    toTokenSym,
                  claimSolTx: claimSol.txSignature,
                  claimTnkTx: claimTnk.contractTxHash,
                  source:     "legacy",
                });
                console.log(`[TNK Monitor] Legacy isTnkToSol: Swap rfqId=${rfqId.slice(0, 12)}… fully settled.`);
              } catch (settleErr) {
                const msg = settleErr instanceof Error ? settleErr.message : String(settleErr);
                if (msg.includes("already") || msg.includes("0x1774") || msg.includes("0x1775")) {
                  await db.update(htlcSecrets)
                    .set({ status: "completed", updatedAt: new Date() })
                    .where(eq(htlcSecrets.rfqId, rfqId))
                    .catch(() => {});
                  await db.update(htlcSwaps)
                    .set({ status: "completed", updatedAt: new Date() })
                    .where(eq(htlcSwaps.rfqId, rfqId))
                    .catch(() => {});
                } else {
                  console.error(`[TNK Monitor] Legacy isTnkToSol settlement failed for rfqId=${rfqId.slice(0, 12)}…:`, msg);
                }
              }
            })();
          }
        } catch (err) {
          console.error(`[TNK Monitor] DB update failed for HTLC ${htlc.id}:`, err);
        }
      }
    }

    if (currentHeight !== null && currentHeight >= htlc.locktime) {
      try {
        const agentKey = process.env.TNK_AGENT_KEY;
        const refundTxId = agentKey
          ? `tnk-refund-triggered-${htlc.secretHash.slice(0, 16)}`
          : `demo-tnk-refund-${htlc.secretHash.slice(0, 16)}`;

        await db
          .update(htlcSwaps)
          .set({ status: "refunded", refundTxId, refundedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(htlcSwaps.id, htlc.id), eq(htlcSwaps.status, "pending")));

        broadcastAll({ type: "tnk_htlc_refunded", htlcId: htlc.id, secretHash: htlc.secretHash, refundTxId });
        console.log(`[TNK Monitor] Legacy: HTLC ${htlc.id} refunded (height ${currentHeight} >= locktime ${htlc.locktime})`);
        refunded++;
      } catch (err) {
        console.error(`[TNK Monitor] Legacy refund failed for HTLC ${htlc.id}:`, err);
      }
    }
  }

  return { detected, refunded };
}

// ─── Main poll cycle ──────────────────────────────────────────────────────────

export async function pollTnkEscrow(): Promise<{
  detected: number;
  refunded: number;
  mode:     "subnet" | "legacy";
  error?:   string;
}> {
  const db = await getDb();
  if (!db) return { detected: 0, refunded: 0, mode: "legacy", error: "db-unavailable" };

  let pendingTnk: (typeof htlcSwaps.$inferSelect)[];
  try {
    pendingTnk = await db
      .select()
      .from(htlcSwaps)
      .where(and(eq(htlcSwaps.status, "pending"), eq(htlcSwaps.chain, "trac_network")));
  } catch (err) {
    return { detected: 0, refunded: 0, mode: "legacy", error: `db-query-failed: ${(err as Error).message}` };
  }

  if (pendingTnk.length === 0) return { detected: 0, refunded: 0, mode: "subnet" };

  // Choose mode based on peer health
  const peerHealthy = await isTnkPeerHealthy();

  if (peerHealthy) {
    const result = await pollSubnetMode(pendingTnk);
    return { ...result, mode: "subnet" };
  } else {
    console.log("[TNK Monitor] trac-peer unreachable — using legacy explorer fallback");
    const result = await pollLegacyMode(pendingTnk);
    return { ...result, mode: "legacy" };
  }
}

// ─── Public start/stop API ────────────────────────────────────────────────────

let monitorInterval: ReturnType<typeof setInterval> | null = null;

export function startTnkHtlcMonitor(): void {
  if (monitorInterval) return;

  // Warn loudly if TNK_ESCROW_ADDRESS is missing — monitor will silently no-op without it
  if (!process.env.TNK_ESCROW_ADDRESS || TNK_ESCROW_ADDRESS.includes("placeholder")) {
    console.warn(
      "[TNK Monitor] WARNING: TNK_ESCROW_ADDRESS is not set or is still the placeholder value. " +
      "The TNK HTLC monitor will NOT detect any incoming TNK locks. " +
      "Set TNK_ESCROW_ADDRESS in the Oracle VM environment and restart the server."
    );
  }

  console.log(
    `[TNK Monitor] Starting — polling every ${POLL_INTERVAL_MS / 1000}s. ` +
    `Escrow: ${TNK_ESCROW_ADDRESS.slice(0, 20)}… | ` +
    `Peer RPC: ${process.env.TNK_PEER_RPC_URL ?? "http://localhost:5001"}`
  );

  void pollTnkEscrow();
  monitorInterval = setInterval(() => {
    void pollTnkEscrow().then(result => {
      if (result.detected > 0 || result.refunded > 0) {
        console.log(
          `[TNK Monitor] Cycle complete (${result.mode}) — ` +
          `detected: ${result.detected}, refunded: ${result.refunded}`
        );
      }
    });
  }, POLL_INTERVAL_MS);
}

export function stopTnkHtlcMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log("[TNK Monitor] Stopped.");
  }
}
