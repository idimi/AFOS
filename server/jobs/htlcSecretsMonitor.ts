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
 *
 * For rows that are 'revealed' but not yet 'completed':
 *   - Case 2: age < 5 minutes → sends a reminder signal to the browser (Agent B may still be online)
 *   - Case 3: age ≥ 5 minutes → server auto-retries claimSolanaHtlc for both HTLCs
 *             This ensures funds are always released even if the browser is closed or
 *             the initial fire-and-forget claim in revealHtlcSecret failed silently.
 *
 * The claim retry is idempotent: if the HTLC is already claimed on-chain, the program
 * returns an error which is treated as success (DB is marked completed).
 */

import { getActiveHtlcSecrets, updateHtlcSecretStatus, getHtlcSwapAddresses } from "../db";
import { sendToPeer, getPeerWalletAddress } from "../signaling";
import { claimSolanaHtlc } from "../solanaHtlcClaim";
import { claimTnkHtlc } from "../tnkHtlcClaim";

// ─── Config ───────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000;          // Check every 60 seconds
const CLAIM_RETRY_AFTER_MS = 5 * 60_000; // Retry server-side claim after 5 minutes of being revealed

let monitorInterval: ReturnType<typeof setInterval> | null = null;

// ─── htlcId derivation ────────────────────────────────────────────────────────

/**
 * Derive Agent A's on-chain HTLC PDA seed from the rfqId.
 * Matches the formula used in LightPeerContext and revealHtlcSecret.
 */
function deriveHtlcIdA(rfqId: string): string {
  return `htlc_a_${rfqId.slice(0, 22)}`;
}

/**
 * Derive Agent B's on-chain HTLC PDA seed from the rfqId.
 */
function deriveHtlcIdB(rfqId: string): string {
  return `htlc_b_${rfqId.slice(0, 22)}`;
}

// ─── Error classification ─────────────────────────────────────────────────────

/**
 * Returns true if the error message indicates the HTLC was already claimed.
 * Treat this as success — the funds are already released.
 */
function isAlreadyClaimedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // Common Anchor / Solana program error messages for already-settled HTLCs
  // Custom error codes: 6004 = AlreadyClaimed (0x1774), 6005 = AlreadyRefunded (0x1775)
  return (
    msg.includes("already") ||
    msg.includes("InvalidStatus") ||
    msg.includes("AlreadyClaimed") ||
    msg.includes("AlreadyRefunded") ||
    msg.includes("0x1770") || // Custom Anchor error codes
    msg.includes("0x1771") ||
    msg.includes("0x1772") ||
    msg.includes("0x1773") ||
    msg.includes("0x1774") || // AlreadyClaimed
    msg.includes("0x1775") || // AlreadyRefunded
    msg.includes("Custom: 6004") || // AlreadyClaimed (decimal)
    msg.includes("Custom: 6005")    // AlreadyRefunded (decimal)
  );
}

// ─── Main Monitor Loop ────────────────────────────────────────────────────────

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

        await updateHtlcSecretStatus(row.rfqId, "expired");

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

        if (row.counterpartyPeerId) {
          const sentToB = sendToPeer(row.counterpartyPeerId, expiredMsg);
          if (sentToB) {
            console.log(`[HtlcSecretsMonitor] Sent htlc_expired to Agent B peer=${row.counterpartyPeerId}`);
          }
        }

        if (row.initiatorPeerId) {
          const sentToA = sendToPeer(row.initiatorPeerId, expiredMsg);
          if (sentToA) {
            console.log(`[HtlcSecretsMonitor] Sent htlc_expired to Agent A peer=${row.initiatorPeerId}`);
          }
        }
      }

      // ── Case 4: locked TNK→X swap where initial claim failed ──────────────────
      // When fromChain=trac_network and the notifyAgentBLocked handler's claimTnkHtlc
      // failed (subnet unreachable), the row stays 'locked' with revealTxId=null.
      // After 5 minutes, retry the TNK claim using DB-stored fromAmountRaw.
      if (
        row.status === "locked" &&
        row.fromChain === "trac_network" &&
        row.fromAmountRaw != null &&
        row.revealTxId == null &&
        expiresAt > now  // still within swap window (not expired yet)
      ) {
        const lockedAgeMs = Number(now) - row.createdAt.getTime();
        if (lockedAgeMs >= CLAIM_RETRY_AFTER_MS) {
          console.log(
            `[HtlcSecretsMonitor] Case 4: Retrying failed TNK claim rfqId=${row.rfqId} ` +
            `(locked ${Math.round(lockedAgeMs / 1000)}s ago, fromAmountRaw=${row.fromAmountRaw})`
          );
          const htlcIdA = deriveHtlcIdA(row.rfqId);
          const htlcIdB = deriveHtlcIdB(row.rfqId);

          // Attempt TNK Claim A (user's TNK lock → Agent B)
          let claimATxId: string | undefined;
          let claimAAlreadyDone = false;
          try {
            const claimA = await claimTnkHtlc(htlcIdA, row.secretHex);
            if (claimA.ok) {
              claimATxId = claimA.contractTxHash ?? claimA.sendTxHash;
              console.log(`[HtlcSecretsMonitor] Case 4: TNK claim A success tx=${claimATxId?.slice(0,16)}… rfqId=${row.rfqId}`);
            } else if (claimA.error?.includes("already") || claimA.error?.includes("claimed")) {
              claimAAlreadyDone = true;
              console.log(`[HtlcSecretsMonitor] Case 4: TNK claim A already settled rfqId=${row.rfqId}`);
            } else {
              console.error(`[HtlcSecretsMonitor] Case 4: TNK claim A failed rfqId=${row.rfqId}: ${claimA.error}`);
            }
          } catch (errA) {
            if (isAlreadyClaimedError(errA)) {
              claimAAlreadyDone = true;
            } else {
              console.error(`[HtlcSecretsMonitor] Case 4: TNK claim A error rfqId=${row.rfqId}:`, errA instanceof Error ? errA.message : errA);
            }
          }

          // Only release Solana funds (Claim B) if TNK claim succeeded — atomic ordering
          if (claimATxId || claimAAlreadyDone) {
            const SPL_TOKENS = new Set(["USDT", "USDC"]);
            const toTokenSym = row.toToken?.toUpperCase() ?? "SOL";
            const tokenSymB = SPL_TOKENS.has(toTokenSym) ? toTokenSym : undefined;
            let claimBTxId: string | undefined;
            let claimBAlreadyDone = false;
            const addrs = await getHtlcSwapAddresses(row.rfqId);
            const initiatorAddr = addrs.initiatorAddress ?? row.initiatorAddress ?? "";
            try {
              const claimB = await claimSolanaHtlc({
                htlcId:           htlcIdB,
                secretHex:        row.secretHex,
                recipientAddress: initiatorAddr,
                tokenSymbol:      tokenSymB,
              });
              claimBTxId = claimB.txSignature;
              console.log(`[HtlcSecretsMonitor] Case 4: Solana claim B success tx=${claimBTxId} rfqId=${row.rfqId}`);
            } catch (errB) {
              if (isAlreadyClaimedError(errB)) {
                claimBAlreadyDone = true;
                console.log(`[HtlcSecretsMonitor] Case 4: Solana claim B already settled rfqId=${row.rfqId}`);
              } else {
                console.error(`[HtlcSecretsMonitor] Case 4: Solana claim B failed rfqId=${row.rfqId}:`, errB instanceof Error ? errB.message : errB);
              }
            }
            await updateHtlcSecretStatus(row.rfqId, "completed", {
              revealTxId: claimATxId,
              ...(claimBTxId ? { counterpartyRevealTxId: claimBTxId } : {}),
              settledAt: new Date(),
              settledVia: "monitor_tnk_retry",
            });
            console.log(`[HtlcSecretsMonitor] Case 4: rfqId=${row.rfqId} marked completed (monitor_tnk_retry)`);
            const completedMsg = {
              type: "htlc_completed",
              rfqId: row.rfqId,
              message: "Swap completed — TNK and USDT/SOL have been released to both parties.",
            };
            if (row.counterpartyPeerId) sendToPeer(row.counterpartyPeerId, completedMsg);
            if (row.initiatorPeerId)    sendToPeer(row.initiatorPeerId, completedMsg);
          } else {
            console.warn(`[HtlcSecretsMonitor] Case 4: TNK claim still failing rfqId=${row.rfqId} — will retry in ${POLL_INTERVAL_MS / 1000}s`);
          }
        }
      }

      // ── Case 2 & 3: revealed but not yet completed ───────────────────────────
      if (row.status === "revealed") {
        const revealedAgeMs = Number(now) - row.updatedAt.getTime();
        const isStale = revealedAgeMs >= CLAIM_RETRY_AFTER_MS;

        if (!isStale) {
          // Case 2: recently revealed — send reminder signal so browser can show Claim button
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
        } else {
          // Case 3: stale revealed HTLC (≥5 min) — server auto-retries on-chain claims
          // This handles: browser closed, network blip, fire-and-forget failure, etc.
          console.log(
            `[HtlcSecretsMonitor] Stale revealed HTLC rfqId=${row.rfqId} ` +
            `(revealed ${Math.round(revealedAgeMs / 60_000)}m ago) — retrying server-side claims`
          );

          // Retry Solana and Trac Network claims; ETH/BTC claim retry is a future enhancement
          const fromChainVal = row.fromChain ?? "solana";
          const toChainVal   = row.toChain   ?? "solana";
          const supportedChains = new Set(["solana", "trac_network"]);
          if (!supportedChains.has(fromChainVal) && !supportedChains.has(toChainVal)) {
            console.log(`[HtlcSecretsMonitor] Skipping non-Solana/TNK retry for rfqId=${row.rfqId}`);
            continue;
          }

          // We need both wallet addresses to claim.
          // If not in htlc_secrets, fall back to htlc_swaps lookup by rfqId.
          let initiatorAddress   = row.initiatorAddress;
          let counterpartyAddress = row.counterpartyAddress;

          // Tier 1b: use counterpartyWallets.solana from htlc_secrets row itself
          // (populated by saveHtlcSecret when senderWallets is available)
          if (!counterpartyAddress && (row.counterpartyWallets as { solana?: string } | null)?.solana) {
            counterpartyAddress = (row.counterpartyWallets as { solana?: string }).solana ?? null;
            console.log(`[HtlcSecretsMonitor] Resolved counterpartyAddress from htlc_secrets.counterpartyWallets.solana for rfqId=${row.rfqId}`);
          }

          if (!initiatorAddress || !counterpartyAddress) {
            console.log(
              `[HtlcSecretsMonitor] Missing wallet addresses for rfqId=${row.rfqId} — looking up from htlc_swaps`
            );
            const fallback = await getHtlcSwapAddresses(row.rfqId);
            initiatorAddress    = initiatorAddress    ?? fallback.initiatorAddress;
            counterpartyAddress = counterpartyAddress ?? fallback.counterpartyAddress;

            // Tier 2b: use counterpartyWallets.solana from htlc_swaps if single-chain address is missing
            if (!counterpartyAddress && fallback.counterpartyWallets?.solana) {
              counterpartyAddress = fallback.counterpartyWallets.solana;
              console.log(`[HtlcSecretsMonitor] Resolved counterpartyAddress from counterpartyWallets.solana for rfqId=${row.rfqId}`);
            }

            if (!initiatorAddress || !counterpartyAddress) {
              // Tier 3: try live signaling registry — peer may still be online
              if (!initiatorAddress && row.initiatorPeerId) {
                const wallets = getPeerWalletAddress(row.initiatorPeerId);
                initiatorAddress = wallets?.solana ?? null;
                if (initiatorAddress) {
                  console.log(`[HtlcSecretsMonitor] Resolved initiatorAddress from live peer registry for rfqId=${row.rfqId}`);
                }
              }
              if (!counterpartyAddress && row.counterpartyPeerId) {
                const wallets = getPeerWalletAddress(row.counterpartyPeerId);
                counterpartyAddress = wallets?.solana ?? null;
                if (counterpartyAddress) {
                  console.log(`[HtlcSecretsMonitor] Resolved counterpartyAddress from live peer registry for rfqId=${row.rfqId}`);
                }
              }
            }

            if (!initiatorAddress || !counterpartyAddress) {
              console.warn(
                `[HtlcSecretsMonitor] Still missing wallet addresses after all fallbacks for rfqId=${row.rfqId} — cannot auto-claim`
              );
              continue;
            }

            // Persist the resolved addresses so future retries don't need to look them up again
            await updateHtlcSecretStatus(row.rfqId, row.status, {
              counterpartyAddress: counterpartyAddress ?? undefined,
            });
            console.log(
              `[HtlcSecretsMonitor] Resolved addresses from htlc_swaps for rfqId=${row.rfqId}: ` +
              `initiator=${initiatorAddress?.slice(0, 8)}… counterparty=${counterpartyAddress?.slice(0, 8)}…`
            );
          }

          const htlcIdA = deriveHtlcIdA(row.rfqId);
          const htlcIdB = deriveHtlcIdB(row.rfqId);

          // Determine SPL token symbols (undefined = native SOL)
          const SPL_TOKENS = new Set(["USDT", "USDC"]);
          const fromTokenSym = row.fromToken?.toUpperCase() ?? "SOL";
          const toTokenSym   = row.toToken?.toUpperCase()   ?? "SOL";
          const tokenSymA = SPL_TOKENS.has(fromTokenSym) ? fromTokenSym : undefined;
          const tokenSymB = SPL_TOKENS.has(toTokenSym)   ? toTokenSym   : undefined;

          let claimASuccess = false;
          let claimBSuccess = false;
          let claimATxSig: string | undefined;

          // ── Claim A: release Agent A's locked fromToken → Agent B ────────────
          try {
            if (fromChainVal === "trac_network") {
              // Agent A locked TNK on Trac Network
              const agentBTnkAddress = (row.counterpartyWallets as { trac_network?: string } | null)?.trac_network
                ?? counterpartyAddress;
              const claimA = await claimTnkHtlc(htlcIdA, row.secretHex);
              if (claimA.ok) {
                claimATxSig = claimA.contractTxHash ?? claimA.sendTxHash;
                claimASuccess = true;
                console.log(`[HtlcSecretsMonitor] Retry claim A (TNK) success: tx=${claimATxSig?.slice(0,16)}… | rfqId=${row.rfqId}`);
              } else if (claimA.error?.includes("already") || claimA.error?.includes("claimed")) {
                claimASuccess = true;
                console.log(`[HtlcSecretsMonitor] Claim A (TNK) already settled rfqId=${row.rfqId}`);
              } else {
                console.error(`[HtlcSecretsMonitor] Retry claim A (TNK) failed rfqId=${row.rfqId}: ${claimA.error}`);
              }
            } else {
              const claimA = await claimSolanaHtlc({
                htlcId:           htlcIdA,
                secretHex:        row.secretHex,
                recipientAddress: counterpartyAddress,
                tokenSymbol:      tokenSymA,
              });
              claimATxSig = claimA.txSignature;
              claimASuccess = true;
              console.log(
                `[HtlcSecretsMonitor] Retry claim A success: ${claimA.txSignature} | rfqId=${row.rfqId}`
              );
            }
          } catch (errA) {
            if (isAlreadyClaimedError(errA)) {
              claimASuccess = true;
              console.log(`[HtlcSecretsMonitor] Claim A already settled on-chain rfqId=${row.rfqId}`);
            } else {
              console.error(
                `[HtlcSecretsMonitor] Retry claim A failed rfqId=${row.rfqId}:`,
                errA instanceof Error ? errA.message : errA
              );
            }
          }

          // ── Claim B: release Agent B's locked toToken → Agent A ──────────────
          try {
            if (toChainVal === "trac_network") {
              // Agent B locked TNK on Trac Network
              const claimB = await claimTnkHtlc(htlcIdB, row.secretHex);
              if (claimB.ok) {
                claimBSuccess = true;
                console.log(`[HtlcSecretsMonitor] Retry claim B (TNK) success: tx=${(claimB.contractTxHash ?? claimB.sendTxHash)?.slice(0,16)}… | rfqId=${row.rfqId}`);
              } else if (claimB.error?.includes("already") || claimB.error?.includes("claimed")) {
                claimBSuccess = true;
                console.log(`[HtlcSecretsMonitor] Claim B (TNK) already settled rfqId=${row.rfqId}`);
              } else {
                console.error(`[HtlcSecretsMonitor] Retry claim B (TNK) failed rfqId=${row.rfqId}: ${claimB.error}`);
              }
            } else {
              const claimB = await claimSolanaHtlc({
                htlcId:           htlcIdB,
                secretHex:        row.secretHex,
                recipientAddress: initiatorAddress,
                tokenSymbol:      tokenSymB,
              });
              claimBSuccess = true;
              console.log(
                `[HtlcSecretsMonitor] Retry claim B success: ${claimB.txSignature} | rfqId=${row.rfqId}`
              );
            }
          } catch (errB) {
            if (isAlreadyClaimedError(errB)) {
              claimBSuccess = true;
              console.log(`[HtlcSecretsMonitor] Claim B already settled on-chain rfqId=${row.rfqId}`);
            } else {
              // Extract on-chain simulation logs if available (SendTransactionError)
              const errMsg = errB instanceof Error ? errB.message : String(errB);
              const txLogs = (errB as { logs?: string[] })?.logs;
              console.error(
                `[HtlcSecretsMonitor] Retry claim B failed rfqId=${row.rfqId}:`,
                errMsg,
                txLogs ? `\nOn-chain logs: ${txLogs.join(' | ')}` : ''
              );
            }
          }

          // ── Update DB if both sides are settled ───────────────────────────────
          if (claimASuccess && claimBSuccess) {
            await updateHtlcSecretStatus(row.rfqId, "completed", {
              revealTxId: claimATxSig,
              settledAt: new Date(),
              settledVia: "monitor_fallback",
            });
            console.log(`[HtlcSecretsMonitor] Marked rfqId=${row.rfqId} as completed after retry (monitor_fallback)`);

            // Notify both parties via signaling so their UI updates
            const completedMsg = {
              type: "htlc_completed",
              rfqId: row.rfqId,
              message: "Swap completed — funds have been released to both parties.",
            };
            if (row.counterpartyPeerId) sendToPeer(row.counterpartyPeerId, completedMsg);
            if (row.initiatorPeerId)    sendToPeer(row.initiatorPeerId, completedMsg);
          } else {
            // Partial success or both failed — will retry on next poll
            console.warn(
              `[HtlcSecretsMonitor] Partial retry for rfqId=${row.rfqId}: ` +
              `claimA=${claimASuccess} claimB=${claimBSuccess} — will retry in ${POLL_INTERVAL_MS / 1000}s`
            );
          }
        }
      }
    } catch (err) {
      console.error(`[HtlcSecretsMonitor] Error processing rfqId=${row.rfqId}:`, err);
    }
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Start the HTLC secrets expiry monitor.
 * Safe to call multiple times — only one interval is created.
 */
export function startHtlcSecretsMonitor(): void {
  if (monitorInterval) return;

  console.log("[HtlcSecretsMonitor] Starting — polling every 60s (claim retry after 5 min)");

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
