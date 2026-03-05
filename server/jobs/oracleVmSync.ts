/**
 * Oracle VM Swap Status Sync Job
 *
 * Polls the IntercomSwap Oracle VM /api/swaps endpoint every 60 seconds and
 * back-fills the local swapAnalytics table for any completed swaps that were
 * never recorded locally (e.g. browser-initiated swaps that bypassed the
 * executeAgentSwap tRPC procedure, or swaps that failed to record due to a
 * transient error).
 *
 * De-duplication strategy:
 *   - Each Oracle VM swap has a unique `rfqId` (UUID).
 *   - Before inserting, we check whether a row with that rfqId already exists.
 *   - If it does, we skip the insert (idempotent).
 *   - If a row exists with a matching txId but no rfqId, we back-fill the rfqId.
 *
 * Called from:
 *   - server/_core/index.ts on startup (10s delay, then every 60s)
 *
 * Oracle VM swap structure (status = "executed"):
 *   { rfqId, route, fromToken, toToken, inAmount, outAmount, rate,
 *     platformFeeBps, feeUsd, timestamp, id, status, createdAt, completedAt }
 */

import { getDb } from "../db";
import { swapAnalytics } from "../../drizzle/schema";
import { eq, or } from "drizzle-orm";

const ORACLE_API = process.env.ORACLE_API_URL ?? "http://141.253.123.101:4000";

// ─── Oracle VM API types ──────────────────────────────────────────────────────

interface OracleSwap {
  rfqId:          string;
  id:             string;
  route:          "dex" | "p2p" | string;
  fromToken:      string;
  toToken:        string;
  inAmount:       number;
  outAmount?:     number;
  rate?:          number;
  platformFeeBps: number;
  feeUsd:         number;
  p2pQuotes?:     number;
  dexRoute?:      string;
  timestamp:      number;
  status:         "quoted" | "executed" | string;
  createdAt:      number;
  completedAt?:   number;
}

interface OracleSwapsResponse {
  completed?: OracleSwap[];
  pending?:   OracleSwap[];
}

// ─── Token → chain mapping (best-effort) ─────────────────────────────────────

function tokenToChain(token: string): "bitcoin" | "ethereum" | "solana" {
  const t = token.toUpperCase();
  if (t === "BTC" || t === "WBTC") return "bitcoin";
  if (t === "ETH" || t === "WETH" || t === "USDC" || t === "DAI") return "ethereum";
  return "solana"; // SOL, USDT (Solana), USDC (Solana), etc.
}

function routeLabel(swap: OracleSwap): string {
  if (swap.route === "p2p") return "IntercomSwap P2P";
  if (swap.dexRoute) return `Jupiter DEX (${swap.dexRoute})`;
  return "Jupiter DEX";
}

// ─── Main sync function ───────────────────────────────────────────────────────

export interface OracleVmSyncResult {
  checked:   boolean;
  inserted:  number;
  skipped:   number;
  backfilled: number;
  error?:    string;
}

export async function runOracleVmSync(): Promise<OracleVmSyncResult> {
  const db = await getDb();
  if (!db) return { checked: false, inserted: 0, skipped: 0, backfilled: 0, error: "no-db" };

  // 1. Fetch completed swaps from Oracle VM
  let completedSwaps: OracleSwap[] = [];
  try {
    const res = await fetch(`${ORACLE_API}/api/swaps`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { checked: false, inserted: 0, skipped: 0, backfilled: 0, error: `oracle-http-${res.status}` };
    }
    const data = await res.json() as OracleSwapsResponse;
    completedSwaps = data.completed ?? [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { checked: false, inserted: 0, skipped: 0, backfilled: 0, error: `oracle-fetch: ${msg}` };
  }

  if (completedSwaps.length === 0) {
    return { checked: true, inserted: 0, skipped: 0, backfilled: 0 };
  }

  let inserted  = 0;
  let skipped   = 0;
  let backfilled = 0;

  for (const swap of completedSwaps) {
    if (!swap.rfqId) continue; // malformed entry

    try {
      // 2. Check if this rfqId already exists in swapAnalytics
      const [existing] = await db
        .select({ id: swapAnalytics.id, rfqId: swapAnalytics.rfqId })
        .from(swapAnalytics)
        .where(eq(swapAnalytics.rfqId, swap.rfqId))
        .limit(1);

      if (existing) {
        skipped++;
        continue;
      }

      // 3. Also check if a row with rfqId=NULL but matching txId exists
      //    (a row recorded locally before rfqId was added to the schema)
      const [byTxId] = await db
        .select({ id: swapAnalytics.id })
        .from(swapAnalytics)
        .where(eq(swapAnalytics.txId, swap.rfqId))
        .limit(1);

      if (byTxId) {
        // Back-fill the rfqId on the existing row
        await db
          .update(swapAnalytics)
          .set({ rfqId: swap.rfqId })
          .where(eq(swapAnalytics.id, byTxId.id));
        backfilled++;
        continue;
      }

      // 4. Insert a new analytics row for this Oracle VM swap
      const fromChain = tokenToChain(swap.fromToken);
      const toChain   = tokenToChain(swap.toToken);
      const settlementMs = swap.completedAt && swap.createdAt
        ? swap.completedAt - swap.createdAt
        : undefined;
      const feeUsd = swap.feeUsd > 0 ? String(swap.feeUsd) : undefined;
      const feeBps = swap.platformFeeBps ?? 20;

      await db.insert(swapAnalytics).values({
        fromChain,
        toChain,
        fromToken:      swap.fromToken.toUpperCase(),
        toToken:        swap.toToken.toUpperCase(),
        amount:         String(swap.inAmount),
        route:          routeLabel(swap),
        status:         "completed",
        settlementMs,
        txId:           swap.rfqId, // use rfqId as txId since no on-chain txHash is available
        rfqId:          swap.rfqId,
        outAmount:      swap.outAmount != null ? String(swap.outAmount) : undefined,
        platformFeeUsd: feeUsd,
        feeBps,
        createdAt:      swap.createdAt ? new Date(swap.createdAt) : new Date(),
      });
      inserted++;
    } catch (err) {
      // Log but continue — don't let one bad row stop the whole sync
      console.error(`[OracleVmSync] Error processing rfqId ${swap.rfqId}:`, err);
    }
  }

  return { checked: true, inserted, skipped, backfilled };
}
