/**
 * HTLC Timeout Monitor — Background poller for all three chains
 *
 * Watches pending HTLCs in the htlc_swaps table and auto-triggers refund
 * when the CLTV timelock expires, preventing locked funds from being stuck
 * if a counterparty goes offline.
 *
 * Architecture (same pattern for all 3 chains):
 *   1. Poll htlc_swaps WHERE status = 'pending' every POLL_INTERVAL_MS
 *   2. For each pending HTLC, fetch the current block height / slot from the chain
 *   3. If currentBlock >= locktime → trigger refund procedure
 *   4. On success → update status to 'refunded', set refundTxId + refundedAt
 *   5. On failure → log error, leave as 'pending' (retry next poll)
 *
 * Chain-specific block height sources:
 *   Bitcoin:  mempool.space /api/blocks/tip/height
 *   Ethereum: public RPC eth_blockNumber (Cloudflare or Infura)
 *   Solana:   public RPC getSlot (mainnet-beta)
 */

import { getDb } from "./db";
import { htlcSwaps, swapAnalytics } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import type { SupportedChain } from "@shared/const";
import { refundSolanaHtlc } from "./solanaHtlcRefund";

// ─── Configuration ────────────────────────────────────────────────────────────
// Helius webhooks handle real-time HTLC events (claim/refund/lock).
// This poller is now a reconciliation pass to catch any events Helius may have
// missed during downtime. 10-minute interval is sufficient.
const POLL_INTERVAL_MS = 10 * 60_000; // Reconciliation pass every 10 minutes
const BTC_MEMPOOL_API  = "https://mempool.space/api";
const ETH_RPC_URL      = process.env.ETH_RPC_URL || "https://cloudflare-eth.com";
const SOL_RPC_URL      = process.env.SOL_RPC_URL || "https://api.mainnet-beta.solana.com";

// ─── Chain block height fetchers ─────────────────────────────────────────────

async function getBtcBlockHeight(): Promise<number | null> {
  try {
    const res = await fetch(`${BTC_MEMPOOL_API}/blocks/tip/height`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return parseInt(await res.text(), 10);
  } catch {
    return null;
  }
}

async function getEthBlockNumber(): Promise<number | null> {
  try {
    const res = await fetch(ETH_RPC_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
      signal:  AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { result?: string };
    if (!data.result) return null;
    return parseInt(data.result, 16);
  } catch {
    return null;
  }
}

async function getSolSlot(): Promise<number | null> {
  try {
    const res = await fetch(SOL_RPC_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot", params: [{ commitment: "finalized" }] }),
      signal:  AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { result?: number };
    return data.result ?? null;
  } catch {
    return null;
  }
}

// ─── Chain height cache (refreshed each poll cycle) ──────────────────────────
interface ChainHeights {
  bitcoin:     number | null;
  ethereum:    number | null;
  solana:      number | null;
  trac_network: number | null;
}

async function fetchAllChainHeights(): Promise<ChainHeights> {
  const [btc, eth, sol] = await Promise.allSettled([
    getBtcBlockHeight(),
    getEthBlockNumber(),
    getSolSlot(),
  ]);
  return {
    bitcoin:      btc.status  === "fulfilled" ? btc.value  : null,
    ethereum:     eth.status  === "fulfilled" ? eth.value  : null,
    solana:       sol.status  === "fulfilled" ? sol.value  : null,
    trac_network: null, // Trac Network uses agent-escrow; no block-height polling needed
  };
}

// ─── Refund triggers ─────────────────────────────────────────────────────────

/**
 * Attempt BTC HTLC refund via mempool.space.
 * In production: calls btcHtlc.htlcRefund with the stored secretHash.
 * In demo mode (no BTC_HTLC_WIF): logs the expiry and marks as expired.
 */
async function triggerBtcRefund(htlc: typeof htlcSwaps.$inferSelect): Promise<string | null> {
  // BTC_HTLC_WIF is the dedicated HTLC escrow key; fall back to BTC_AGENT_WIF for backwards compatibility
  const agentWif = process.env.BTC_HTLC_WIF ?? process.env.BTC_AGENT_WIF;
  if (!agentWif) {
    // No server key — user must claim manually. Do NOT mark DB as refunded.
    console.log(`[HTLC Monitor] [BTC] HTLC ${htlc.htlcAddress} expired. No BTC_HTLC_WIF — user must claim manually.`);
    return null;
  }
  // Server has the key — TODO: implement real on-chain BTC refund tx.
  // Return null until real tx submission is implemented to avoid false DB updates.
  console.log(
    `[HTLC Monitor] [BTC] CLTV expired for HTLC ${htlc.htlcAddress}. ` +
    `Server key available but on-chain refund not yet implemented in monitor. ` +
    `SecretHash: ${htlc.secretHash.slice(0, 16)}…`
  );
  return null;
}

/**
 * Attempt ETH HTLC refund by calling the HTLC contract's refund() function.
 * In demo mode (no ETH_HTLC_KEY): logs the expiry and marks as expired.
 */
async function triggerEthRefund(htlc: typeof htlcSwaps.$inferSelect): Promise<string | null> {
  // ETH_HTLC_KEY is the dedicated HTLC escrow key; fall back to ETH_AGENT_KEY for backwards compatibility
  const agentKey = process.env.ETH_HTLC_KEY ?? process.env.ETH_AGENT_KEY;
  if (!agentKey) {
    // No server key — user must claim manually. Do NOT mark DB as refunded.
    console.log(`[HTLC Monitor] [ETH] HTLC ${htlc.htlcAddress} expired. No ETH_HTLC_KEY — user must claim manually.`);
    return null;
  }
  // Server has the key — TODO: implement real on-chain ETH refund tx.
  // Return null until real tx submission is implemented to avoid false DB updates.
  console.log(
    `[HTLC Monitor] [ETH] Block timeout reached for HTLC contract ${htlc.htlcAddress}. ` +
    `Server key available but on-chain refund not yet implemented in monitor. ` +
    `SecretHash: ${htlc.secretHash.slice(0, 16)}…`
  );
  return null;
}

/**
 * Attempt SOL HTLC refund by closing the PDA after timelock expiry.
 * In demo mode (no SOL_HTLC_KEY): logs the expiry and marks as expired.
 */
async function triggerSolRefund(htlc: typeof htlcSwaps.$inferSelect): Promise<string | null> {
  // SOL_HTLC_KEY is the dedicated HTLC escrow key; fall back to SOL_AGENT_KEY for backwards compatibility
  const agentKey = process.env.SOL_HTLC_KEY ?? process.env.SOL_AGENT_KEY;
  if (!agentKey) {
    // No server-side key — this HTLC belongs to a user who must claim it themselves.
    // Log the expiry but do NOT mark as refunded in the DB.
    // The user will see it in the Refunds tab and can claim it manually.
    console.log(
      `[HTLC Monitor] [SOL] HTLC PDA ${htlc.htlcAddress} expired. ` +
      `No SOL_HTLC_KEY — user must claim manually from the Refunds tab.`
    );
    return null; // null = no DB update, leave as pending
  }

  // Server has the HTLC key — attempt the actual on-chain refund tx via refundSolanaHtlc.
  // htlcId is stored in htlc.htlcId (the PDA seed string, e.g. "htlc_a_rfq_1773...").
  // tokenSymbol is derived from toToken if it differs from the native SOL.
  const htlcId = htlc.htlcId ?? htlc.htlcAddress;
  const nativeToken = "SOL";
  const tokenSymbol = (htlc.toToken && htlc.toToken.toUpperCase() !== nativeToken)
    ? htlc.toToken.toUpperCase()
    : undefined;

  try {
    console.log(
      `[HTLC Monitor] [SOL] Triggering server-side refund for HTLC ${htlcId}` +
      (tokenSymbol ? ` (token: ${tokenSymbol})` : "") + "…"
    );
    const result = await refundSolanaHtlc({ htlcId, tokenSymbol });
    console.log(`[HTLC Monitor] [SOL] Refund tx confirmed: ${result.txSignature} | htlcId=${htlcId}`);
    return result.txSignature;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[HTLC Monitor] [SOL] Server-side refund failed for HTLC ${htlcId}: ${msg}`);
    // Leave as pending — user can still claim manually from the Refunds tab
    return null;
  }
}

// ─── Main poll cycle ──────────────────────────────────────────────────────────

async function pollPendingHtlcs(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[HTLC Monitor] Database not available — skipping poll cycle.");
    return;
  }
  let pending: (typeof htlcSwaps.$inferSelect)[];
  try {
    pending = await db
      .select()
      .from(htlcSwaps)
      .where(eq(htlcSwaps.status, "pending"));
  } catch (err) {
    console.error("[HTLC Monitor] DB query failed:", err);
    return;
  }

  if (pending.length === 0) return;

  // Fetch current block heights for all chains that have pending HTLCs
  const chainsNeeded = new Set(pending.map(h => h.chain));
  const heights: ChainHeights = { bitcoin: null, ethereum: null, solana: null, trac_network: null };

  if (chainsNeeded.has("bitcoin"))  heights.bitcoin  = await getBtcBlockHeight();
  if (chainsNeeded.has("ethereum")) heights.ethereum = await getEthBlockNumber();
  if (chainsNeeded.has("solana"))   heights.solana   = await getSolSlot();

  console.log(
    `[HTLC Monitor] Checking ${pending.length} pending HTLC(s). ` +
    `Heights: BTC=${heights.bitcoin ?? "N/A"} ETH=${heights.ethereum ?? "N/A"} SOL=${heights.solana ?? "N/A"}`
  );

  const nowSec = Math.floor(Date.now() / 1000);

  for (const htlc of pending) {
    // Solana HTLCs use Unix timestamps (not slot numbers) for timelock.
    // If locktime > 1_000_000_000 it's almost certainly a Unix timestamp (year 2001+).
    // Use wall-clock comparison for Solana; block height comparison for BTC/ETH.
    const isSolanaTimestamp = htlc.chain === "solana" && htlc.locktime > 1_000_000_000;

    if (isSolanaTimestamp) {
      // Unix timestamp comparison
      if (nowSec < htlc.locktime) {
        const remaining = htlc.locktime - nowSec;
        console.log(
          `[HTLC Monitor] [${htlc.chain.toUpperCase()}] HTLC ${htlc.id} still active. ` +
          `Locktime: ${new Date(htlc.locktime * 1000).toISOString()}, Remaining: ${remaining}s`
        );
        continue;
      }
      // Timelock expired — fall through to trigger refund
      console.log(
        `[HTLC Monitor] [${htlc.chain.toUpperCase()}] HTLC ${htlc.id} EXPIRED (timestamp)! ` +
        `Locktime: ${new Date(htlc.locktime * 1000).toISOString()}, Now: ${new Date(nowSec * 1000).toISOString()}. Triggering refund…`
      );
    } else {
      const currentHeight = heights[htlc.chain];
      if (currentHeight === null) {
        console.warn(`[HTLC Monitor] Cannot fetch block height for ${htlc.chain} — skipping HTLC ${htlc.id}`);
        continue;
      }

      // Check if the timelock has expired
      if (currentHeight < htlc.locktime) {
        const remaining = htlc.locktime - currentHeight;
        console.log(
          `[HTLC Monitor] [${htlc.chain.toUpperCase()}] HTLC ${htlc.id} still active. ` +
          `Locktime: ${htlc.locktime}, Current: ${currentHeight}, Remaining: ${remaining} blocks/slots`
        );
        continue;
      }

      // Timelock expired — fall through to trigger refund
      console.log(
        `[HTLC Monitor] [${htlc.chain.toUpperCase()}] HTLC ${htlc.id} EXPIRED! ` +
        `Locktime: ${htlc.locktime}, Current: ${currentHeight}. Triggering refund…`
      );
    }

    let refundTxId: string | null = null;
    try {
      if (htlc.chain === "bitcoin")  refundTxId = await triggerBtcRefund(htlc);
      if (htlc.chain === "ethereum") refundTxId = await triggerEthRefund(htlc);
      if (htlc.chain === "solana") {
        // Only refund HTLCs locked by the agent (htlc_a_* prefix).
        // htlc_b_* rows are Agent B's (counterparty) locks — the server cannot
        // refund them with SOL_HTLC_KEY (WrongSender). Agent B must refund their own.
        const htlcIdStr = htlc.htlcId ?? htlc.htlcAddress ?? "";
        const isCounterpartyLock = htlcIdStr.startsWith("htlc_b_");
        if (isCounterpartyLock) {
          console.log(
            `[HTLC Monitor] [SOL] Skipping refund for ${htlcIdStr} — ` +
            `counterparty lock (htlc_b_*); Agent B must refund their own HTLC.`
          );
          refundTxId = null;
        } else {
          refundTxId = await triggerSolRefund(htlc);
        }
      }
    } catch (err) {
      console.error(`[HTLC Monitor] Refund trigger failed for HTLC ${htlc.id}:`, err);
      continue;
    }

    // Only update DB if a real on-chain refund tx was submitted.
    // null means the refund could not be executed (user-owned HTLC, or tx failed).
    // Leave as 'pending' so the user can claim it manually from the Refunds tab.
    if (refundTxId === null) {
      console.log(
        `[HTLC Monitor] [${htlc.chain.toUpperCase()}] HTLC ${htlc.id} expired but no server refund tx — ` +
        `leaving as pending for user to claim manually.`
      );
      continue;
    }

    // Update DB record — htlcSwaps + matching swapAnalytics row
    try {
      const db2 = await getDb();
      if (!db2) continue;
      await db2
        .update(htlcSwaps)
        .set({
          status:     "refunded",
          refundTxId: refundTxId,
          refundedAt: new Date(),
          updatedAt:  new Date(),
        })
        .where(and(eq(htlcSwaps.id, htlc.id), eq(htlcSwaps.status, "pending")));

      // Mirror status to swapAnalytics via lockTxId
      if (htlc.lockTxId) {
        await db2
          .update(swapAnalytics)
          .set({ status: "refunded" })
          .where(eq(swapAnalytics.txId, htlc.lockTxId));
      }

      console.log(
        `[HTLC Monitor] [${htlc.chain.toUpperCase()}] HTLC ${htlc.id} marked as refunded. ` +
        `RefundTxId: ${refundTxId}`
      );
    } catch (err) {
      console.error(`[HTLC Monitor] DB update failed for HTLC ${htlc.id}:`, err);
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

let monitorInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the HTLC timeout monitor.
 * Called once from server/_core/index.ts on startup.
 */
export function startHtlcMonitor(): void {
  if (monitorInterval) return; // Already running

  console.log(`[HTLC Monitor] Starting — polling every ${POLL_INTERVAL_MS / 1000}s`);

  // Run immediately on startup, then on interval
  void pollPendingHtlcs();
  monitorInterval = setInterval(() => {
    void pollPendingHtlcs();
  }, POLL_INTERVAL_MS);
}

/**
 * Stop the HTLC timeout monitor (for graceful shutdown / testing).
 */
export function stopHtlcMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log("[HTLC Monitor] Stopped.");
  }
}

/**
 * Manually record a new HTLC lock in the database.
 * Called by executeBtcSwap / executeEthSwap / buildSwapTx after locking funds.
 */
export async function recordHtlcLock(params: {
  chain:              SupportedChain;
  htlcAddress:        string;
  secretHash:         string;
  lockTxId?:          string;
  amountRaw:          string;
  amountHuman:        string;
  locktime:           number;
  peerId?:            string;
  rfqId?:             string;
  toToken?:           string;
  toChain?:           SupportedChain;
  senderAddress?:     string;
  /** Single-chain counterparty address (same chain as this lock) */
  counterpartyAddress?: string;
  /** Full multi-chain wallet map for the counterparty — enables cross-chain auto-claim */
  counterpartyWallets?: { solana?: string; ethereum?: string; bitcoin?: string; trac_network?: string };
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(htlcSwaps).values({
    chain:               params.chain,
    htlcAddress:         params.htlcAddress,
    secretHash:          params.secretHash,
    lockTxId:            params.lockTxId,
    amountRaw:           params.amountRaw,
    amountHuman:         params.amountHuman,
    locktime:            params.locktime,
    status:              "pending",
    peerId:              params.peerId,
    rfqId:               params.rfqId,
    toToken:             params.toToken,
    toChain:             params.toChain,
    senderAddress:       params.senderAddress,
    counterpartyAddress: params.counterpartyAddress,
    counterpartyWallets: params.counterpartyWallets,
  });
  return (result as { insertId: number }).insertId;
}

/**
 * Mark an HTLC as completed (secret revealed, funds claimed).
 * Also updates the matching swapAnalytics row to "completed" via lockTxId.
 */
export async function markHtlcCompleted(secretHash: string, txId?: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // 1. Update htlcSwaps status
  await db
    .update(htlcSwaps)
    .set({ status: "completed", refundTxId: txId, updatedAt: new Date() })
    .where(and(eq(htlcSwaps.secretHash, secretHash), eq(htlcSwaps.status, "pending")));
  // 2. Mirror to swapAnalytics via lockTxId
  const [htlcRow] = await db
    .select({ lockTxId: htlcSwaps.lockTxId })
    .from(htlcSwaps)
    .where(eq(htlcSwaps.secretHash, secretHash))
    .limit(1);
  if (htlcRow?.lockTxId) {
    await db
      .update(swapAnalytics)
      .set({ status: "completed" })
      .where(eq(swapAnalytics.txId, htlcRow.lockTxId));
  }
}

/**
 * Record a swap in the analytics table.
 */
export async function recordSwapAnalytic(params: {
  fromChain:      SupportedChain;
  toChain:        SupportedChain;
  fromToken:      string;
  toToken:        string;
  amount:         string;
  amountUsd?:     string;
  route:          string;
  status:         "completed" | "failed" | "refunded";
  settlementMs?:  number;
  txId?:          string;
  peerId?:        string;
  platformFeeUsd?: string;  // fee in USD
  feeBps?:         number;  // 15 for P2P, 20 for DEX
  feeAmountOut?:   string;  // fee in output token units
  walletAddress?:  string;  // user's wallet address for per-user history
  rfqId?:          string;  // Oracle VM RFQ ID for de-duplication
  outAmount?:      string;  // output amount in human-readable units
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(swapAnalytics).values(params);
}


