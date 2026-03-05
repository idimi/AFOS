/**
 * Oracle VM Swap Status Sync Job
 *
 * Polls the IntercomSwap Oracle VM /api/swaps endpoint every 60 seconds and:
 *   1. Back-fills swapAnalytics for completed swaps never recorded locally.
 *   2. Back-fills rfqId on existing rows where txId matches an Oracle VM rfqId.
 *   3. Updates admin_config.lastOracleSyncAt + lastSyncInserted after each run.
 *
 * De-duplication strategy:
 *   - Each Oracle VM swap has a unique `rfqId` (UUID).
 *   - Before inserting, check whether a row with that rfqId already exists → skip.
 *   - If a row exists with rfqId=NULL but txId = rfqId → back-fill rfqId only.
 *   - Otherwise → insert a new row.
 *
 * Called from:
 *   - server/_core/index.ts on startup (15s delay, then every 60s)
 */

import { getDb } from "../db";
import { swapAnalytics, adminConfig } from "../../drizzle/schema";
import { eq, isNull, and } from "drizzle-orm";

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

// ─── Persist sync status to admin_config ─────────────────────────────────────

async function persistSyncStatus(inserted: number): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    // Ensure admin_config row exists (id = 1)
    const [existing] = await db
      .select({ id: adminConfig.id })
      .from(adminConfig)
      .limit(1);
    if (existing) {
      await db
        .update(adminConfig)
        .set({ lastOracleSyncAt: new Date(), lastSyncInserted: inserted })
        .where(eq(adminConfig.id, existing.id));
    } else {
      await db.insert(adminConfig).values({
        lastOracleSyncAt: new Date(),
        lastSyncInserted: inserted,
      });
    }
  } catch (err) {
    // Non-fatal — sync still ran, just couldn't persist the timestamp
    console.warn("[OracleVmSync] Could not persist sync status:", err);
  }
}

// ─── Main sync function ───────────────────────────────────────────────────────

export interface OracleVmSyncResult {
  checked:    boolean;
  inserted:   number;
  skipped:    number;
  backfilled: number;
  error?:     string;
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
    await persistSyncStatus(0);
    return { checked: true, inserted: 0, skipped: 0, backfilled: 0 };
  }

  let inserted   = 0;
  let skipped    = 0;
  let backfilled = 0;

  for (const swap of completedSwaps) {
    if (!swap.rfqId) continue; // malformed entry

    try {
      // 2. Check if this rfqId already exists in swapAnalytics
      const [existingByRfq] = await db
        .select({ id: swapAnalytics.id })
        .from(swapAnalytics)
        .where(eq(swapAnalytics.rfqId, swap.rfqId))
        .limit(1);

      if (existingByRfq) {
        skipped++;
        continue;
      }

      // 3. Back-fill: check if a row exists with rfqId=NULL but txId = rfqId
      //    (recorded before rfqId column was added, or recorded with rfqId as txId)
      const [existingByTxId] = await db
        .select({ id: swapAnalytics.id, rfqId: swapAnalytics.rfqId })
        .from(swapAnalytics)
        .where(
          and(
            eq(swapAnalytics.txId, swap.rfqId),
            isNull(swapAnalytics.rfqId)
          )
        )
        .limit(1);

      if (existingByTxId) {
        // Back-fill rfqId and outAmount on the existing row
        await db
          .update(swapAnalytics)
          .set({
            rfqId:     swap.rfqId,
            outAmount: swap.outAmount != null ? String(swap.outAmount) : undefined,
          })
          .where(eq(swapAnalytics.id, existingByTxId.id));
        backfilled++;
        continue;
      }

      // 4. Insert a new analytics row for this Oracle VM swap
      const fromChain    = tokenToChain(swap.fromToken);
      const toChain      = tokenToChain(swap.toToken);
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
        txId:           swap.rfqId,
        rfqId:          swap.rfqId,
        outAmount:      swap.outAmount != null ? String(swap.outAmount) : undefined,
        platformFeeUsd: feeUsd,
        feeBps,
        createdAt:      swap.createdAt ? new Date(swap.createdAt) : new Date(),
      });
      inserted++;
    } catch (err) {
      console.error(`[OracleVmSync] Error processing rfqId ${swap.rfqId}:`, err);
    }
  }

  // 5. Persist sync status to admin_config for the Settings diagnostics card
  await persistSyncStatus(inserted);

  return { checked: true, inserted, skipped, backfilled };
}
