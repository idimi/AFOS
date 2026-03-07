/**
 * Analytics Router — Swap Analytics Dashboard Backend
 *
 * Provides DB-backed metrics for the swap analytics dashboard:
 *   - Swap volume by chain (BTC / ETH / SOL / TNK)
 *   - Average settlement time per route
 *   - HTLC success / refund ratio
 *   - Peer reputation leaderboard (P2P peers ranked by completed swaps)
 *   - Recent swap history
 *   - Route distribution (P2P vs aggregator)
 */

import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { swapAnalytics, htlcSwaps, peerReputation } from "../../drizzle/schema";
import { eq, and, gte, sql, desc, count, avg } from "drizzle-orm";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sinceMs(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const analyticsRouter = router({
  /**
   * Overall swap volume metrics.
   * Returns total volume (USD), swap count, and breakdown by chain for the given time window.
   */
  volumeByChain: publicProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { byChain: [], totalSwaps: 0, totalUsd: 0, days: input.days };
      const since = sinceMs(input.days);

      const rows = await db
        .select({
          fromChain: swapAnalytics.fromChain,
          toChain:   swapAnalytics.toChain,
          swapCount: count(swapAnalytics.id),
          totalUsd:  sql<string>`COALESCE(SUM(CAST(${swapAnalytics.amountUsd} AS DECIMAL(20,6))), 0)`,
        })
        .from(swapAnalytics)
        .where(
          and(
            eq(swapAnalytics.status, "completed"),
            gte(swapAnalytics.createdAt, since)
          )
        )
        .groupBy(swapAnalytics.fromChain, swapAnalytics.toChain);

      // Aggregate by chain
      const chainMap: Record<string, { swapCount: number; totalUsd: number }> = {};
      for (const row of rows) {
        const key = row.fromChain;
        if (!chainMap[key]) chainMap[key] = { swapCount: 0, totalUsd: 0 };
        chainMap[key].swapCount += Number(row.swapCount);
        chainMap[key].totalUsd  += parseFloat(row.totalUsd ?? "0");
      }

      const chains = ["bitcoin", "ethereum", "solana", "trac_network"] as const;
      const byChain = chains.map(chain => ({
        chain,
        swapCount: chainMap[chain]?.swapCount ?? 0,
        totalUsd:  chainMap[chain]?.totalUsd  ?? 0,
      }));

      const totalSwaps = byChain.reduce((s, c) => s + c.swapCount, 0);
      const totalUsd   = byChain.reduce((s, c) => s + c.totalUsd,  0);

      return { byChain, totalSwaps, totalUsd, days: input.days };
    }),

  /**
   * Average settlement time per route.
   * Returns mean milliseconds from quote to settlement for each route type.
   */
  settlementTime: publicProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const since = sinceMs(input.days);

      const rows = await db
        .select({
          route:     swapAnalytics.route,
          avgMs:     avg(swapAnalytics.settlementMs),
          swapCount: count(swapAnalytics.id),
        })
        .from(swapAnalytics)
        .where(
          and(
            eq(swapAnalytics.status, "completed"),
            gte(swapAnalytics.createdAt, since)
          )
        )
        .groupBy(swapAnalytics.route)
        .orderBy(avg(swapAnalytics.settlementMs));

      return rows.map(r => ({
        route:     r.route,
        avgMs:     Math.round(Number(r.avgMs) || 0),
        swapCount: Number(r.swapCount),
      }));
    }),

  /**
   * HTLC success / refund ratio.
   * Returns counts of completed, refunded, failed, and pending HTLCs.
   */
  htlcRatio: publicProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { totals: {}, byChain: {}, total: 0, successRate: "0.0", refundRate: "0.0", days: input.days };
      const since = sinceMs(input.days);

      const rows = await db
        .select({
          status:    htlcSwaps.status,
          chain:     htlcSwaps.chain,
          swapCount: count(htlcSwaps.id),
        })
        .from(htlcSwaps)
        .where(gte(htlcSwaps.createdAt, since))
        .groupBy(htlcSwaps.status, htlcSwaps.chain);

      // Build status totals
      const totals: Record<string, number> = {
        pending:   0,
        completed: 0,
        refunded:  0,
        expired:   0,
      };
      const byChain: Record<string, Record<string, number>> = {};

      for (const row of rows) {
        totals[row.status] = (totals[row.status] ?? 0) + Number(row.swapCount);
        if (!byChain[row.chain]) byChain[row.chain] = {};
        byChain[row.chain][row.status] = (byChain[row.chain][row.status] ?? 0) + Number(row.swapCount);
      }

      const total = Object.values(totals).reduce((a, b) => a + b, 0);
      const successRate = total > 0 ? ((totals.completed / total) * 100).toFixed(1) : "0.0";
      const refundRate  = total > 0 ? ((totals.refunded  / total) * 100).toFixed(1) : "0.0";

      return { totals, byChain, total, successRate, refundRate, days: input.days };
    }),

  /**
   * Unified peer leaderboard.
   * Merges swap history (volume, swap count, settlement time) with peerReputation
   * data (score, origin layer, avg latency, last seen) into a single ranked table.
   * Peers with reputation data but no swap history are included (score-only rows).
   * Sort order: reputation score desc by default.
   */
  peerLeaderboard: publicProcedure
    .input(z.object({
      days:    z.number().int().min(1).max(365).default(30),
      limit:   z.number().int().min(1).max(50).default(25),
      sortBy:  z.enum(['score', 'swaps', 'volume', 'latency']).default('score'),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const since = sinceMs(input.days);

      // 1. Swap history aggregated by peerId
      const swapRows = await db
        .select({
          peerId:    swapAnalytics.peerId,
          swapCount: count(swapAnalytics.id),
          totalUsd:  sql<string>`COALESCE(SUM(CAST(${swapAnalytics.amountUsd} AS DECIMAL(20,6))), 0)`,
          avgSettlementMs: avg(swapAnalytics.settlementMs),
        })
        .from(swapAnalytics)
        .where(
          and(
            eq(swapAnalytics.status, 'completed'),
            gte(swapAnalytics.createdAt, since),
            sql`${swapAnalytics.peerId} IS NOT NULL`
          )
        )
        .groupBy(swapAnalytics.peerId);

      // 2. All reputation records
      const repRows = await db
        .select()
        .from(peerReputation)
        .orderBy(desc(peerReputation.score));

      // 3. Build a map of peerId → reputation
      const repMap = new Map(repRows.map(r => [r.peerId, r]));

      // 4. Build a map of peerId → swap stats
      const swapMap = new Map(swapRows.map(r => [r.peerId ?? '', r]));

      // 5. Union: start with all peers that have reputation data,
      //    then add any swap-only peers not yet in reputation table.
      const allPeerIds = new Set([
        ...repRows.map(r => r.peerId),
        ...swapRows.map(r => r.peerId ?? '').filter(Boolean),
      ]);

      const merged = Array.from(allPeerIds).map(peerId => {
        const rep  = repMap.get(peerId);
        const swap = swapMap.get(peerId);
        const avgLatencyMs = rep && rep.successfulPings > 0
          ? Math.round(rep.totalLatencyMs / rep.successfulPings)
          : null;
        return {
          peerId,
          alias:           rep?.alias ?? null,
          origin:          rep?.origin ?? 'unknown',
          score:           rep?.score ?? null,
          successfulSwaps: rep?.successfulSwaps ?? 0,
          failedPings:     rep?.failedPings ?? 0,
          successfulPings: rep?.successfulPings ?? 0,
          avgLatencyMs,
          lastSeenAt:      rep?.lastSeenAt ?? null,
          // From swap history
          swapCount:       Number(swap?.swapCount ?? 0),
          totalUsd:        parseFloat(swap?.totalUsd ?? '0'),
          avgSettlementMs: Math.round(Number(swap?.avgSettlementMs) || 0),
        };
      });

      // 6. Sort
      merged.sort((a, b) => {
        if (input.sortBy === 'swaps')   return b.swapCount - a.swapCount;
        if (input.sortBy === 'volume')  return b.totalUsd - a.totalUsd;
        if (input.sortBy === 'latency') {
          const la = a.avgLatencyMs ?? 99999;
          const lb = b.avgLatencyMs ?? 99999;
          return la - lb; // lowest latency first
        }
        // default: score desc (nulls last)
        const sa = a.score ?? -1;
        const sb = b.score ?? -1;
        return sb - sa;
      });

      return merged.slice(0, input.limit).map((r, i) => ({ rank: i + 1, ...r }));
    }),

  /**
   * Route distribution.
   * Returns swap counts and volume split by route type (P2P vs aggregators).
   */
  routeDistribution: publicProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const since = sinceMs(input.days);

      const rows = await db
        .select({
          route:     swapAnalytics.route,
          swapCount: count(swapAnalytics.id),
          totalUsd:  sql<string>`COALESCE(SUM(CAST(${swapAnalytics.amountUsd} AS DECIMAL(20,6))), 0)`,
        })
        .from(swapAnalytics)
        .where(
          and(
            eq(swapAnalytics.status, "completed"),
            gte(swapAnalytics.createdAt, since)
          )
        )
        .groupBy(swapAnalytics.route)
        .orderBy(desc(count(swapAnalytics.id)));

      const total = rows.reduce((s, r) => s + Number(r.swapCount), 0);

      return rows.map(r => ({
        route:      r.route,
        swapCount:  Number(r.swapCount),
        totalUsd:   parseFloat(r.totalUsd ?? "0"),
        percentage: total > 0 ? ((Number(r.swapCount) / total) * 100).toFixed(1) : "0.0",
      }));
    }),

  /**
   * Recent swap history.
   * Returns the latest N completed swaps for the activity feed.
   */
  recentSwaps: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const rows = await db
        .select()
        .from(swapAnalytics)
        .orderBy(desc(swapAnalytics.createdAt))
        .limit(input.limit);

      return rows;
    }),

  /**
   * Summary stats card — single object for the top-of-page KPI strip.
   */
  summary: publicProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { totalSwaps: 0, totalUsd: 0, avgSettlementMs: 0, htlcSuccessRate: "0.0", htlcRefundRate: "0.0", p2pRatio: "0.0", days: input.days };
      const since = sinceMs(input.days);

      const [volumeRow] = await db
        .select({
          totalSwaps: count(swapAnalytics.id),
          totalUsd:   sql<string>`COALESCE(SUM(CAST(${swapAnalytics.amountUsd} AS DECIMAL(20,6))), 0)`,
          avgMs:      avg(swapAnalytics.settlementMs),
        })
        .from(swapAnalytics)
        .where(
          and(
            eq(swapAnalytics.status, "completed"),
            gte(swapAnalytics.createdAt, since)
          )
        );

      const [htlcRow] = await db
        .select({
          total:     count(htlcSwaps.id),
          completed: sql<string>`SUM(CASE WHEN ${htlcSwaps.status} = 'completed' THEN 1 ELSE 0 END)`,
          refunded:  sql<string>`SUM(CASE WHEN ${htlcSwaps.status} = 'refunded' THEN 1 ELSE 0 END)`,
        })
        .from(htlcSwaps)
        .where(gte(htlcSwaps.createdAt, since));

      const [p2pRow] = await db
        .select({
          p2pCount: sql<string>`SUM(CASE WHEN ${swapAnalytics.route} LIKE '%P2P%' OR ${swapAnalytics.route} LIKE '%IntercomSwap%' THEN 1 ELSE 0 END)`,
          total:    count(swapAnalytics.id),
        })
        .from(swapAnalytics)
        .where(
          and(
            eq(swapAnalytics.status, "completed"),
            gte(swapAnalytics.createdAt, since)
          )
        );

      const totalSwaps  = Number(volumeRow?.totalSwaps ?? 0);
      const totalUsd    = parseFloat(volumeRow?.totalUsd ?? "0");
      const avgMs       = Math.round(Number(volumeRow?.avgMs) || 0);
      const htlcTotal   = Number(htlcRow?.total ?? 0);
      const htlcSuccess = Number(htlcRow?.completed ?? 0);
      const htlcRefund  = Number(htlcRow?.refunded  ?? 0);
      const p2pCount    = Number(p2pRow?.p2pCount ?? 0);
      const p2pTotal    = Number(p2pRow?.total ?? 0);

      return {
        totalSwaps,
        totalUsd,
        avgSettlementMs: avgMs,
        htlcSuccessRate: htlcTotal > 0 ? ((htlcSuccess / htlcTotal) * 100).toFixed(1) : "0.0",
        htlcRefundRate:  htlcTotal > 0 ? ((htlcRefund  / htlcTotal) * 100).toFixed(1) : "0.0",
        p2pRatio:        p2pTotal  > 0 ? ((p2pCount    / p2pTotal)  * 100).toFixed(1) : "0.0",
        days:            input.days,
      };
    }),

  /**
   * Peer detail — full history for a single peer.
   * Returns reputation record, all completed swaps, and HTLC channel history.
   */
  peerDetail: publicProcedure
    .input(z.object({ peerId: z.string().min(1) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;

      // 1. Reputation record (lifetime stats)
      const [rep] = await db
        .select()
        .from(peerReputation)
        .where(eq(peerReputation.peerId, input.peerId))
        .limit(1);

      // 2. All completed swaps with this peer (most recent first)
      const swaps = await db
        .select()
        .from(swapAnalytics)
        .where(
          and(
            eq(swapAnalytics.peerId, input.peerId),
            eq(swapAnalytics.status, 'completed')
          )
        )
        .orderBy(desc(swapAnalytics.createdAt))
        .limit(50);

      // 3. HTLC channel history with this peer
      const channels = await db
        .select()
        .from(htlcSwaps)
        .where(eq(htlcSwaps.peerId, input.peerId))
        .orderBy(desc(htlcSwaps.createdAt))
        .limit(20);

      // 4. Ping timeline — derive from reputation signals
      const avgLatencyMs = rep && rep.successfulPings > 0
        ? Math.round(rep.totalLatencyMs / rep.successfulPings)
        : null;
      const totalPings = (rep?.successfulPings ?? 0) + (rep?.failedPings ?? 0);
      const uptimePct = totalPings > 0
        ? Math.round((rep!.successfulPings / totalPings) * 100)
        : null;

      return {
        reputation: rep ?? null,
        avgLatencyMs,
        uptimePct,
        totalPings,
        swaps,
        channels,
        swapCount:  swaps.length,
        totalUsd:   swaps.reduce((s, sw) => s + parseFloat(sw.amountUsd ?? '0'), 0),
      };
    }),

  /**
   * Platform fee revenue summary.
   * Returns total fees collected, broken down by route type (P2P vs DEX) and time window.
   */
  feeRevenue: publicProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return {
        totalFeeUsd: 0, p2pFeeUsd: 0, dexFeeUsd: 0,
        totalSwaps: 0, p2pSwaps: 0, dexSwaps: 0,
        avgFeeUsd: 0, days: input.days,
        recentFees: [],
      };
      const since = sinceMs(input.days);

      // Total fee revenue
      const [totals] = await db
        .select({
          totalSwaps:  count(swapAnalytics.id),
          totalFeeUsd: sql<string>`COALESCE(SUM(CAST(${swapAnalytics.platformFeeUsd} AS DECIMAL(20,8))), 0)`,
          p2pSwaps:    sql<string>`SUM(CASE WHEN ${swapAnalytics.feeBps} = 15 THEN 1 ELSE 0 END)`,
          p2pFeeUsd:   sql<string>`COALESCE(SUM(CASE WHEN ${swapAnalytics.feeBps} = 15 THEN CAST(${swapAnalytics.platformFeeUsd} AS DECIMAL(20,8)) ELSE 0 END), 0)`,
          dexSwaps:    sql<string>`SUM(CASE WHEN ${swapAnalytics.feeBps} = 20 THEN 1 ELSE 0 END)`,
          dexFeeUsd:   sql<string>`COALESCE(SUM(CASE WHEN ${swapAnalytics.feeBps} = 20 THEN CAST(${swapAnalytics.platformFeeUsd} AS DECIMAL(20,8)) ELSE 0 END), 0)`,
        })
        .from(swapAnalytics)
        .where(
          and(
            eq(swapAnalytics.status, "completed"),
            gte(swapAnalytics.createdAt, since)
          )
        );

      // Recent fee events (last 20)
      const recentFees = await db
        .select({
          id:            swapAnalytics.id,
          fromToken:     swapAnalytics.fromToken,
          toToken:       swapAnalytics.toToken,
          amount:        swapAnalytics.amount,
          route:         swapAnalytics.route,
          feeBps:        swapAnalytics.feeBps,
          feeAmountOut:  swapAnalytics.feeAmountOut,
          platformFeeUsd: swapAnalytics.platformFeeUsd,
          createdAt:     swapAnalytics.createdAt,
        })
        .from(swapAnalytics)
        .where(
          and(
            eq(swapAnalytics.status, "completed"),
            gte(swapAnalytics.createdAt, since)
          )
        )
        .orderBy(desc(swapAnalytics.createdAt))
        .limit(20);

      const totalSwaps  = Number(totals?.totalSwaps ?? 0);
      const totalFeeUsd = parseFloat(totals?.totalFeeUsd ?? "0");
      const p2pSwaps    = Number(totals?.p2pSwaps ?? 0);
      const p2pFeeUsd   = parseFloat(totals?.p2pFeeUsd ?? "0");
      const dexSwaps    = Number(totals?.dexSwaps ?? 0);
      const dexFeeUsd   = parseFloat(totals?.dexFeeUsd ?? "0");

      return {
        totalFeeUsd,
        p2pFeeUsd,
        dexFeeUsd,
        totalSwaps,
        p2pSwaps,
        dexSwaps,
        avgFeeUsd: totalSwaps > 0 ? totalFeeUsd / totalSwaps : 0,
        days: input.days,
        recentFees,
      };
    }),

  /**
   * Top trading pairs by swap count and volume.
   * Returns the top N fromToken→toToken pairs for the given time window.
   */
  topPairs: publicProcedure
    .input(z.object({
      days:  z.number().int().min(1).max(365).default(30),
      limit: z.number().int().min(1).max(20).default(10),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const since = sinceMs(input.days);

      const rows = await db
        .select({
          fromToken: swapAnalytics.fromToken,
          toToken:   swapAnalytics.toToken,
          swapCount: count(swapAnalytics.id),
          totalUsd:  sql<string>`COALESCE(SUM(CAST(${swapAnalytics.amountUsd} AS DECIMAL(20,6))), 0)`,
        })
        .from(swapAnalytics)
        .where(
          and(
            eq(swapAnalytics.status, "completed"),
            gte(swapAnalytics.createdAt, since)
          )
        )
        .groupBy(swapAnalytics.fromToken, swapAnalytics.toToken)
        .orderBy(desc(count(swapAnalytics.id)))
        .limit(input.limit);

      const totalSwaps = rows.reduce((s, r) => s + Number(r.swapCount), 0);
      return rows.map(r => ({
        pair:      `${r.fromToken} \u2192 ${r.toToken}`,
        fromToken: r.fromToken,
        toToken:   r.toToken,
        swapCount: Number(r.swapCount),
        totalUsd:  parseFloat(r.totalUsd ?? "0"),
        pct:       totalSwaps > 0 ? Math.round((Number(r.swapCount) / totalSwaps) * 100) : 0,
      }));
    }),

  /**
   * Platform-wide user stats.
   * Returns unique wallet count (active in last 30d), total wallets ever seen,
   * and average swap size.
   */
  userStats: publicProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { totalWallets: 0, activeWallets: 0, avgSwapUsd: 0 };
      const since = sinceMs(input.days);

      // Total unique wallets seen in swap analytics (via peerId as proxy)
      const [totRow] = await db
        .select({
          totalWallets: sql<string>`COUNT(DISTINCT ${swapAnalytics.peerId})`,
          avgSwapUsd:   sql<string>`COALESCE(AVG(CAST(${swapAnalytics.amountUsd} AS DECIMAL(20,6))), 0)`,
        })
        .from(swapAnalytics)
        .where(eq(swapAnalytics.status, "completed"));

      const [activeRow] = await db
        .select({
          activeWallets: sql<string>`COUNT(DISTINCT ${swapAnalytics.peerId})`,
        })
        .from(swapAnalytics)
        .where(
          and(
            eq(swapAnalytics.status, "completed"),
            gte(swapAnalytics.createdAt, since)
          )
        );

      return {
        totalWallets:  Number(totRow?.totalWallets ?? 0),
        activeWallets: Number(activeRow?.activeWallets ?? 0),
        avgSwapUsd:    parseFloat(totRow?.avgSwapUsd ?? "0"),
      };
    }),

  /**
   * Manually trigger the fee revenue alert check.
   * Returns whether an alert was fired and the current daily total.
   * Safe to call repeatedly — idempotent (max one notification per calendar day).
   */
  checkFeeAlert: publicProcedure.mutation(async () => {
    const { runFeeRevenueAlert } = await import("../jobs/feeRevenueAlert");
    return runFeeRevenueAlert();
  }),
});
