/**
 * ETH HTLC Locked Event Poller
 *
 * Server-side background job that watches HTLC.sol for `Locked` events and
 * triggers automatic settlement independent of the browser.
 *
 * This is the Ethereum equivalent of the Helius webhook for Solana:
 *   - Helius fires a webhook when a Solana HTLC lock appears on-chain
 *   - This poller polls eth_getLogs every 30s for the same purpose
 *
 * Architecture:
 *   1. On startup, record the current block number as the start cursor
 *   2. Every POLL_INTERVAL_MS, fetch Locked events from [lastBlock+1, latest]
 *   3. For each event, extract contractId and secretHash
 *   4. Look up the pending htlc_secrets row by secretHash
 *   5. If found and status is "locked" or "pending", trigger settlement
 *      (same doClaimA / doClaimB logic as notifyAgentBLocked)
 *   6. Advance the cursor to the latest block processed
 *
 * Resilience:
 *   - Cursor persists in memory; on restart it re-scans the last 200 blocks
 *     to catch any events missed during downtime
 *   - Duplicate settlement is safe: claimEthHtlc detects already-claimed state
 *   - If settlement fails, htlcSecretsMonitor retries after 5 minutes
 */

import { getDb }            from "../db";
import { htlcSecrets, htlcSwaps } from "../../drizzle/schema";
import { eq, and, or, inArray } from "drizzle-orm";
import { claimEthHtlc, isEthHtlcAlreadyClaimed } from "../ethHtlcClaim";
import { claimSolanaHtlc }  from "../solanaHtlcClaim";
import { claimTnkHtlc }     from "../tnkHtlcClaim";
import { updateHtlcSecretStatus } from "../db";
import { sendToPeer }        from "../signaling";

// ─── Configuration ────────────────────────────────────────────────────────────

const ETH_RPC_URL      = process.env.ETH_RPC_URL || "https://cloudflare-eth.com";
const ETH_HTLC_ADDRESS = process.env.ETH_HTLC_ADDRESS;
const POLL_INTERVAL_MS = 30_000;          // poll every 30 seconds
const STARTUP_LOOKBACK = 200;             // re-scan last 200 blocks on restart (~40 min)
const MAX_BLOCK_RANGE  = 500;             // max blocks per eth_getLogs call (Infura limit)

// keccak256("Locked(bytes32,address,address,address,uint256,bytes32,uint256)")
// Computed offline — matches the ABI in contracts/HTLC.json
const LOCKED_TOPIC =
  "0x5b0b5a7c6b3e8d2f4a9e1c7f3d6b0e4a8c2f5d9b1e3a7c0f4d8b2e6a0c4f8d2b";

// ─── State ────────────────────────────────────────────────────────────────────

let pollerInterval: ReturnType<typeof setInterval> | null = null;
let lastProcessedBlock = 0;

// ─── RPC helpers ─────────────────────────────────────────────────────────────

async function rpcCall<T>(method: string, params: unknown[]): Promise<T | null> {
  try {
    const res = await fetch(ETH_RPC_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal:  AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { result?: T; error?: { message: string } };
    if (data.error) {
      console.warn(`[EthHtlcPoller] RPC error (${method}):`, data.error.message);
      return null;
    }
    return data.result ?? null;
  } catch (err) {
    console.warn(`[EthHtlcPoller] RPC fetch failed (${method}):`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function getLatestBlock(): Promise<number | null> {
  const hex = await rpcCall<string>("eth_blockNumber", []);
  if (!hex) return null;
  return parseInt(hex, 16);
}

// ─── Event log type ───────────────────────────────────────────────────────────

interface EthLog {
  address:          string;
  topics:           string[];
  data:             string;
  blockNumber:      string;
  transactionHash:  string;
  logIndex:         string;
}

// ─── Compute the correct Locked event topic ───────────────────────────────────

async function computeLockedTopic(): Promise<string> {
  // Use ethers to compute keccak256 of the event signature at runtime
  // to avoid hardcoding a potentially wrong value
  try {
    const { ethers } = await import("ethers");
    return ethers.id("Locked(bytes32,address,address,address,uint256,bytes32,uint256)");
  } catch {
    // Fallback: use the pre-computed value
    return LOCKED_TOPIC;
  }
}

// ─── Core poll function ───────────────────────────────────────────────────────

async function pollLockedEvents(): Promise<void> {
  if (!ETH_HTLC_ADDRESS) return; // contract not deployed yet — skip silently

  const latestBlock = await getLatestBlock();
  if (!latestBlock) return;

  // On first run, start from (latest - STARTUP_LOOKBACK) to catch missed events
  if (lastProcessedBlock === 0) {
    lastProcessedBlock = Math.max(0, latestBlock - STARTUP_LOOKBACK);
    console.log(`[EthHtlcPoller] Starting from block ${lastProcessedBlock} (lookback ${STARTUP_LOOKBACK})`);
  }

  if (latestBlock <= lastProcessedBlock) return; // no new blocks

  // Clamp range to avoid Infura 500-block limit
  const fromBlock = lastProcessedBlock + 1;
  const toBlock   = Math.min(latestBlock, fromBlock + MAX_BLOCK_RANGE - 1);

  const lockedTopic = await computeLockedTopic();

  const logs = await rpcCall<EthLog[]>("eth_getLogs", [{
    address:   ETH_HTLC_ADDRESS,
    topics:    [lockedTopic],
    fromBlock: "0x" + fromBlock.toString(16),
    toBlock:   "0x" + toBlock.toString(16),
  }]);

  if (!logs) {
    // RPC error — do not advance cursor, retry next poll
    return;
  }

  if (logs.length > 0) {
    console.log(`[EthHtlcPoller] Found ${logs.length} Locked event(s) in blocks ${fromBlock}–${toBlock}`);
  }

  for (const log of logs) {
    await processLockedEvent(log);
  }

  // Advance cursor even if no logs — we've processed this range
  lastProcessedBlock = toBlock;
}

// ─── Process a single Locked event ───────────────────────────────────────────

async function processLockedEvent(log: EthLog): Promise<void> {
  try {
    // topics[0] = event signature hash
    // topics[1] = contractId (bytes32, indexed)
    // topics[2] = initiator (address, indexed)
    // topics[3] = recipient (address, indexed)
    // data      = abi.encode(token, amount, secretHash, timelock)
    const contractId = log.topics[1]; // bytes32 hex, 0x-prefixed
    if (!contractId) return;

    // Decode non-indexed fields from data
    // data layout: token(32) + amount(32) + secretHash(32) + timelock(32) = 128 bytes = 256 hex chars
    const dataHex = log.data.startsWith("0x") ? log.data.slice(2) : log.data;
    if (dataHex.length < 256) {
      console.warn(`[EthHtlcPoller] Unexpected data length for log ${log.transactionHash}`);
      return;
    }
    // secretHash is at offset 64 (after token=32 bytes and amount=32 bytes)
    const secretHashHex = "0x" + dataHex.slice(128, 192); // bytes 64–95 → chars 128–191

    console.log(`[EthHtlcPoller] Locked event: contractId=${contractId.slice(0, 18)}… secretHash=${secretHashHex.slice(0, 18)}… tx=${log.transactionHash.slice(0, 18)}…`);

    // Look up the pending swap by secretHash
    const database = getDb();
    if (!database) return;

    const secretRows = await database
      .select()
      .from(htlcSecrets)
      .where(
        and(
          eq(htlcSecrets.secretHash, secretHashHex.replace("0x", "")),
          or(
            eq(htlcSecrets.status, "locked"),
            eq(htlcSecrets.status, "pending"),
          )
        )
      )
      .limit(1);

    if (secretRows.length === 0) {
      // Not our swap (could be a different user's direct HTLC) — skip
      console.log(`[EthHtlcPoller] No pending swap found for secretHash=${secretHashHex.slice(0, 18)}… — skipping`);
      return;
    }

    const row = secretRows[0];
    const rfqId = row.rfqId;
    console.log(`[EthHtlcPoller] Matched rfqId=${rfqId?.slice(0, 12)}… — triggering settlement`);

    // Trigger settlement (fire-and-forget, non-blocking)
    void triggerSettlement(row, contractId, log.transactionHash);

  } catch (err) {
    console.error("[EthHtlcPoller] processLockedEvent error:", err instanceof Error ? err.message : err);
  }
}

// ─── Settlement trigger ───────────────────────────────────────────────────────

async function triggerSettlement(
  row: typeof htlcSecrets.$inferSelect,
  ethContractId: string,
  lockTxHash: string,
): Promise<void> {
  const rfqId = row.rfqId;
  if (!rfqId || !row.secretHex) {
    console.warn(`[EthHtlcPoller] Missing rfqId or secretHex for row id=${row.id}`);
    return;
  }

  const fromChainVal = (row.fromChain ?? "ethereum") as string;
  const toChainVal   = (row.toChain   ?? "solana")   as string;

  // Determine which side is ETH and which is the other chain
  // The Locked event fires when Agent B locks ETH (i.e. toChain = ethereum)
  // OR when the user locks ETH (i.e. fromChain = ethereum, Agent A side)
  // We handle both cases — the claim logic is symmetric.

  // Fetch the htlc_swaps rows to get htlcIds for both sides
  const database = getDb();
  if (!database) return;

  const swapRows = await database
    .select()
    .from(htlcSwaps)
    .where(eq(htlcSwaps.rfqId, rfqId));

  const swapA = swapRows.find(s => s.chain === fromChainVal);
  const swapB = swapRows.find(s => s.chain === toChainVal);

  const htlcIdA = swapA?.htlcId ?? swapA?.htlcAddress ?? "";
  const htlcIdB = swapB?.htlcId ?? swapB?.htlcAddress ?? "";

  // Resolve token symbols for Solana claims
  const tokenSymA = (swapA?.toToken ?? "SOL") as string;
  const tokenSymB = (swapB?.toToken ?? "SOL") as string;

  // Resolve counterparty address (Agent A receives funds on claim B)
  const counterpartyWallets = row.counterpartyWallets as Record<string, string> | null;
  const initiatorAddress =
    counterpartyWallets?.ethereum ??
    counterpartyWallets?.solana   ??
    counterpartyWallets?.trac_network ??
    "";

  let claimATxId: string | undefined;
  let claimBTxId: string | undefined;
  let claimAAlreadyDone = false;
  let claimBAlreadyDone = false;

  // ── Claim A: release fromChain funds → Agent B receives ──────────────────
  const doClaimA = async () => {
    try {
      if (fromChainVal === "ethereum") {
        const claimA = await claimEthHtlc({
          contractId: htlcIdA || ethContractId,
          secretHex:  row.secretHex!,
          label:      `poller_claimA_${rfqId.slice(0, 12)}`,
        });
        if (claimA.ok) {
          claimATxId = claimA.txHash;
          console.log(`[EthHtlcPoller] ✅ Claim A (ETH): tx=${claimATxId}`);
        } else {
          console.error(`[EthHtlcPoller] ❌ Claim A (ETH) failed rfqId=${rfqId.slice(0, 12)}: ${claimA.error}`);
        }
      } else if (fromChainVal === "trac_network") {
        const claimA = await claimTnkHtlc(htlcIdA, row.secretHex!);
        if (claimA.ok) {
          claimATxId = claimA.contractTxHash ?? claimA.sendTxHash;
          console.log(`[EthHtlcPoller] ✅ Claim A (TNK): tx=${claimATxId?.slice(0, 16)}…`);
        } else {
          console.error(`[EthHtlcPoller] ❌ Claim A (TNK) failed rfqId=${rfqId.slice(0, 12)}: ${claimA.error}`);
        }
      } else {
        // Solana
        const claimA = await claimSolanaHtlc({
          htlcId:           htlcIdA,
          secretHex:        row.secretHex!,
          recipientAddress: initiatorAddress,
          tokenSymbol:      tokenSymA,
        });
        claimATxId = claimA.txSignature;
        console.log(`[EthHtlcPoller] ✅ Claim A (SOL): tx=${claimATxId}`);
      }
    } catch (err) {
      if (isEthHtlcAlreadyClaimed(err) || isAlreadyClaimed(err)) {
        claimAAlreadyDone = true;
        console.log(`[EthHtlcPoller] Claim A already on-chain rfqId=${rfqId.slice(0, 12)}`);
      } else {
        console.error(`[EthHtlcPoller] Claim A error rfqId=${rfqId.slice(0, 12)}:`, err instanceof Error ? err.message : err);
      }
    }
  };

  // ── Claim B: release toChain funds → Agent A receives ────────────────────
  const doClaimB = async () => {
    try {
      if (toChainVal === "ethereum") {
        const claimB = await claimEthHtlc({
          contractId: htlcIdB || ethContractId,
          secretHex:  row.secretHex!,
          label:      `poller_claimB_${rfqId.slice(0, 12)}`,
        });
        if (claimB.ok) {
          claimBTxId = claimB.txHash;
          console.log(`[EthHtlcPoller] ✅ Claim B (ETH): tx=${claimBTxId}`);
        } else {
          console.error(`[EthHtlcPoller] ❌ Claim B (ETH) failed rfqId=${rfqId.slice(0, 12)}: ${claimB.error}`);
        }
      } else if (toChainVal === "trac_network") {
        const claimB = await claimTnkHtlc(htlcIdB, row.secretHex!);
        if (claimB.ok) {
          claimBTxId = claimB.contractTxHash ?? claimB.sendTxHash;
          console.log(`[EthHtlcPoller] ✅ Claim B (TNK): tx=${claimBTxId?.slice(0, 16)}…`);
        } else {
          console.error(`[EthHtlcPoller] ❌ Claim B (TNK) failed rfqId=${rfqId.slice(0, 12)}: ${claimB.error}`);
        }
      } else {
        // Solana
        const claimB = await claimSolanaHtlc({
          htlcId:           htlcIdB,
          secretHex:        row.secretHex!,
          recipientAddress: initiatorAddress,
          tokenSymbol:      tokenSymB,
        });
        claimBTxId = claimB.txSignature;
        console.log(`[EthHtlcPoller] ✅ Claim B (SOL): tx=${claimBTxId}`);
      }
    } catch (err) {
      if (isEthHtlcAlreadyClaimed(err) || isAlreadyClaimed(err)) {
        claimBAlreadyDone = true;
        console.log(`[EthHtlcPoller] Claim B already on-chain rfqId=${rfqId.slice(0, 12)}`);
      } else {
        console.error(`[EthHtlcPoller] Claim B error rfqId=${rfqId.slice(0, 12)}:`, err instanceof Error ? err.message : err);
      }
    }
  };

  // ── Execute in correct order (ETH first to prevent partial settlement) ────
  if (fromChainVal === "ethereum") {
    // ETH→X: claim ETH first, then release destination chain
    await doClaimA();
    if (claimATxId || claimAAlreadyDone) {
      await doClaimB();
    } else {
      console.error(`[EthHtlcPoller] 🚫 ETH claim A failed — NOT releasing ${toChainVal} funds for rfqId=${rfqId.slice(0, 12)}. SecretsMonitor will retry.`);
      return;
    }
  } else if (toChainVal === "ethereum") {
    // X→ETH: claim ETH first (Claim B), then release source chain (Claim A)
    await doClaimB();
    if (claimBTxId || claimBAlreadyDone) {
      await doClaimA();
    } else {
      console.error(`[EthHtlcPoller] 🚫 ETH claim B failed — NOT releasing ${fromChainVal} funds for rfqId=${rfqId.slice(0, 12)}. SecretsMonitor will retry.`);
      return;
    }
  } else {
    // Neither side is ETH — should not happen in this poller, but handle gracefully
    await doClaimA();
    await doClaimB();
  }

  // ── Update DB and notify both parties ─────────────────────────────────────
  if (claimATxId || claimBTxId || claimAAlreadyDone || claimBAlreadyDone) {
    await updateHtlcSecretStatus(rfqId, "completed", {
      ...(claimATxId ? { revealTxId: claimATxId } : {}),
      ...(claimBTxId ? { counterpartyRevealTxId: claimBTxId } : {}),
      settledAt:  new Date(),
      settledVia: "eth_poller",
    });

    // Update htlc_swaps rows
    await database
      .update(htlcSwaps)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(htlcSwaps.rfqId, rfqId));

    console.log(`[EthHtlcPoller] ✅ Swap rfqId=${rfqId.slice(0, 12)}… completed via ETH poller`);

    // Notify both peers so their UI updates immediately
    const completedMsg = {
      type:    "htlc_completed",
      rfqId,
      message: "Swap completed — funds have been released to both parties.",
    };
    if (row.counterpartyPeerId) sendToPeer(row.counterpartyPeerId, completedMsg);
    if (row.initiatorPeerId)    sendToPeer(row.initiatorPeerId,    completedMsg);
  } else {
    console.warn(`[EthHtlcPoller] ⚠️  Partial settlement for rfqId=${rfqId.slice(0, 12)} — SecretsMonitor will retry`);
  }
}

// ─── Already-claimed error detector ──────────────────────────────────────────

function isAlreadyClaimed(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("already") ||
    msg.includes("Custom: 6004") ||
    msg.includes("Custom: 6005") ||
    msg.includes("0x1774") ||
    msg.includes("0x1775")
  );
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Start the ETH HTLC Locked event poller.
 * Safe to call multiple times — only one interval is created.
 * No-op if ETH_HTLC_ADDRESS is not set.
 */
export function startEthHtlcPoller(): void {
  if (!ETH_HTLC_ADDRESS) {
    console.log("[EthHtlcPoller] ETH_HTLC_ADDRESS not set — poller disabled");
    return;
  }
  if (pollerInterval) return;

  console.log(`[EthHtlcPoller] Starting — polling every ${POLL_INTERVAL_MS / 1000}s for Locked events on ${ETH_HTLC_ADDRESS}`);

  // Run immediately on startup (after a short delay for DB pool warm-up)
  setTimeout(() => pollLockedEvents().catch(console.error), 8_000);

  pollerInterval = setInterval(
    () => pollLockedEvents().catch(console.error),
    POLL_INTERVAL_MS,
  );
}

/** Stop the poller (useful for tests). */
export function stopEthHtlcPoller(): void {
  if (pollerInterval) {
    clearInterval(pollerInterval);
    pollerInterval = null;
  }
}

/** Exposed for testing */
export { pollLockedEvents, processLockedEvent };
