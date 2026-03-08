/**
 * History Router — Wallet-Scoped Swap History
 *
 * Provides per-wallet history for the History page:
 *   - list:       paginated swap history (from swapAnalytics), filtered by walletAddresses
 *   - stats:      summary stats (volume, fees, success rate) for the wallet(s)
 *   - openTrades: pending HTLC locks (from htlcSwaps), filtered by senderAddress
 *   - refunds:    expired/refunded HTLCs (from htlcSwaps), filtered by senderAddress
 *
 * When walletAddresses is empty → operator/global view (all records).
 * When walletAddresses is provided → wallet-scoped view (only that wallet's records).
 */
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { swapAnalytics, htlcSwaps } from "../../drizzle/schema";
import { eq, and, gte, desc, count, inArray, or, sql, like } from "drizzle-orm";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sinceDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const historyRouter = router({
  /**
   * Paginated swap history from swapAnalytics.
   * Wallet-scoped when walletAddresses provided, global otherwise.
   */
  list: publicProcedure
    .input(z.object({
      walletAddresses: z.array(z.string()).default([]),
      status:          z.enum(["all", "completed", "failed", "refunded"]).default("all"),
      days:            z.number().int().min(1).max(365).default(90),
      search:          z.string().max(100).default(""),
      limit:           z.number().int().min(1).max(100).default(50),
      offset:          z.number().int().min(0).default(0),
      // Admin-only flag: pass true to see all swaps regardless of wallet connection.
      // When false (default) and no walletAddresses provided, returns empty.
      adminGlobalView: z.boolean().default(false),
      // Optional chain filter — "all" returns all chains.
      chain:           z.enum(["all", "bitcoin", "ethereum", "solana", "trac_network"]).default("all"),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { rows: [], total: 0, isWalletScoped: false };

      const since = sinceDate(input.days);
      const isWalletScoped = input.walletAddresses.length > 0;

      // Guard: never show all rows to unauthenticated / no-wallet users.
      // Only admins explicitly passing adminGlobalView=true bypass this.
      if (!isWalletScoped && !input.adminGlobalView) {
        return { rows: [], total: 0, isWalletScoped: false };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conditions: any[] = [gte(swapAnalytics.createdAt, since)];

      if (input.status !== "all") {
        conditions.push(
          eq(swapAnalytics.status, input.status as "completed" | "failed" | "refunded")
        );
      }
      if (input.chain !== "all") {
        conditions.push(
          eq(swapAnalytics.fromChain, input.chain as "bitcoin" | "ethereum" | "solana" | "trac_network")
        );
      }
      if (isWalletScoped) {
        conditions.push(inArray(swapAnalytics.walletAddress, input.walletAddresses));
      }
      // Server-side full-text search across token names, peer ID, and tx hash
      if (input.search.trim()) {
        const q = `%${input.search.trim()}%`;
        conditions.push(
          or(
            like(swapAnalytics.fromToken, q),
            like(swapAnalytics.toToken, q),
            like(swapAnalytics.peerId, q),
            like(swapAnalytics.txId, q),
          )
        );
      }

      const where = and(...conditions);

      const [countRow] = await db
        .select({ total: count(swapAnalytics.id) })
        .from(swapAnalytics)
        .where(where);

      const rows = await db
        .select()
        .from(swapAnalytics)
        .where(where)
        .orderBy(desc(swapAnalytics.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return {
        rows,
        total: Number(countRow?.total ?? 0),
        isWalletScoped,
      };
    }),

  /**
   * Summary stats for the wallet(s) — shown in the stats strip at the top of the Swaps tab.
   */
  stats: publicProcedure
    .input(z.object({
      walletAddresses: z.array(z.string()).default([]),
      days:            z.number().int().min(1).max(365).default(90),
      adminGlobalView: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { totalSwaps: 0, totalVolumeUsd: 0, totalFeesUsd: 0, successRate: "0.0", isWalletScoped: false, tnkSwaps: 0, tnkVolumeUsd: 0, tnkFeesUsd: 0 };

      const since = sinceDate(input.days);
      const isWalletScoped = input.walletAddresses.length > 0;

      // Guard: return zero stats when no wallet connected and not admin global view
      if (!isWalletScoped && !input.adminGlobalView) {
        return { totalSwaps: 0, totalVolumeUsd: 0, totalFeesUsd: 0, successRate: "0.0", isWalletScoped: false, tnkSwaps: 0, tnkVolumeUsd: 0, tnkFeesUsd: 0 };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conditions: any[] = [gte(swapAnalytics.createdAt, since)];
      if (isWalletScoped) {
        conditions.push(inArray(swapAnalytics.walletAddress, input.walletAddresses));
      }

      const [row] = await db
        .select({
          totalSwaps:     count(swapAnalytics.id),
          totalVolumeUsd: sql<string>`COALESCE(SUM(CAST(${swapAnalytics.amountUsd} AS DECIMAL(20,6))), 0)`,
          totalFeesUsd:   sql<string>`COALESCE(SUM(CAST(${swapAnalytics.platformFeeUsd} AS DECIMAL(20,6))), 0)`,
          completedCount: sql<string>`SUM(CASE WHEN ${swapAnalytics.status} = 'completed' THEN 1 ELSE 0 END)`,
          // TNK-specific aggregates (fromChain = trac_network)
          tnkSwaps:       sql<string>`SUM(CASE WHEN ${swapAnalytics.fromChain} = 'trac_network' THEN 1 ELSE 0 END)`,
          tnkVolumeUsd:   sql<string>`COALESCE(SUM(CASE WHEN ${swapAnalytics.fromChain} = 'trac_network' THEN CAST(${swapAnalytics.amountUsd} AS DECIMAL(20,6)) ELSE 0 END), 0)`,
          tnkFeesUsd:     sql<string>`COALESCE(SUM(CASE WHEN ${swapAnalytics.fromChain} = 'trac_network' THEN CAST(${swapAnalytics.platformFeeUsd} AS DECIMAL(20,6)) ELSE 0 END), 0)`,
        })
        .from(swapAnalytics)
        .where(and(...conditions));

      const totalSwaps = Number(row?.totalSwaps ?? 0);
      const completedCount = Number(row?.completedCount ?? 0);
      const successRate = totalSwaps > 0 ? ((completedCount / totalSwaps) * 100).toFixed(1) : "0.0";

      return {
        totalSwaps,
        totalVolumeUsd: parseFloat(row?.totalVolumeUsd ?? "0"),
        totalFeesUsd:   parseFloat(row?.totalFeesUsd ?? "0"),
        successRate,
        isWalletScoped,
        tnkSwaps:    Number(row?.tnkSwaps ?? 0),
        tnkVolumeUsd: parseFloat(row?.tnkVolumeUsd ?? "0"),
        tnkFeesUsd:   parseFloat(row?.tnkFeesUsd ?? "0"),
      };
    }),

  /**
   * Active HTLC locks — "Open Trades" tab.
   * If walletAddresses provided → filter by senderAddress.
   * Otherwise → return all pending HTLCs (operator view).
   */
  openTrades: publicProcedure
    .input(z.object({
      walletAddresses: z.array(z.string()).default([]),
      search:          z.string().max(100).default(""),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { trades: [], isWalletScoped: false };

      const isWalletScoped = input.walletAddresses.length > 0;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conditions: any[] = [eq(htlcSwaps.status, "pending")];
      if (isWalletScoped) {
        conditions.push(inArray(htlcSwaps.senderAddress, input.walletAddresses));
      }
      if (input.search.trim()) {
        const q = `%${input.search.trim()}%`;
        conditions.push(
          or(
            like(htlcSwaps.peerId, q),
            like(htlcSwaps.htlcAddress, q),
            like(htlcSwaps.toToken, q),
            like(htlcSwaps.senderAddress, q),
          )
        );
      }

      const trades = await db
        .select()
        .from(htlcSwaps)
        .where(and(...conditions))
        .orderBy(desc(htlcSwaps.createdAt))
        .limit(100);

      return { trades, isWalletScoped };
    }),

  /**
   * Export all matching swaps as CSV (no pagination limit).
   * Respects the same wallet-scoping, status, date, and search filters as `list`.
   * Returns a CSV string — the client triggers a browser download.
   */
  exportCsv: publicProcedure
    .input(z.object({
      walletAddresses: z.array(z.string()).default([]),
      status:          z.enum(["all", "completed", "failed", "refunded"]).default("all"),
      days:            z.number().int().min(1).max(365).default(90),
      search:          z.string().max(100).default(""),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { csv: "" };

      const since = sinceDate(input.days);
      const isWalletScoped = input.walletAddresses.length > 0;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conditions: any[] = [gte(swapAnalytics.createdAt, since)];

      if (input.status !== "all") {
        conditions.push(
          eq(swapAnalytics.status, input.status as "completed" | "failed" | "refunded")
        );
      }
      if (isWalletScoped) {
        conditions.push(inArray(swapAnalytics.walletAddress, input.walletAddresses));
      }
      if (input.search.trim()) {
        const q = `%${input.search.trim()}%`;
        conditions.push(
          or(
            like(swapAnalytics.fromToken, q),
            like(swapAnalytics.toToken, q),
            like(swapAnalytics.peerId, q),
            like(swapAnalytics.txId, q),
          )
        );
      }

      const rows = await db
        .select()
        .from(swapAnalytics)
        .where(and(...conditions))
        .orderBy(desc(swapAnalytics.createdAt))
        .limit(10000); // safety cap

      // Build CSV
      const headers = [
        "Date", "From Token", "To Token", "Amount", "Out Amount",
        "Amount USD", "Status", "Route", "Peer ID", "Tx ID",
        "Platform Fee USD", "Wallet Address",
      ];
      const escape = (v: unknown) => {
        const s = v == null ? "" : String(v);
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      };
      const csvLines = [
        headers.join(","),
        ...rows.map(r => [
          r.createdAt ? new Date(r.createdAt).toISOString() : "",
          escape(r.fromToken),
          escape(r.toToken),
          escape(r.amount),
          escape(r.outAmount),
          escape(r.amountUsd),
          escape(r.status),
          escape(r.route),
          escape(r.peerId),
          escape(r.txId),
          escape(r.platformFeeUsd),
          escape(r.walletAddress),
        ].join(",")),
      ];

      return { csv: csvLines.join("\n") };
    }),

  /**
   * Refundable / refunded HTLCs — "Refunds" tab.
   * If walletAddresses provided → filter by senderAddress.
   */
  refunds: publicProcedure
    .input(z.object({
      walletAddresses: z.array(z.string()).default([]),
      search:          z.string().max(100).default(""),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { refunds: [], isWalletScoped: false };

      const isWalletScoped = input.walletAddresses.length > 0;

      const statusCondition = or(
        eq(htlcSwaps.status, "refunded"),
        eq(htlcSwaps.status, "expired"),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conditions: any[] = [statusCondition];
      if (isWalletScoped) {
        conditions.push(inArray(htlcSwaps.senderAddress, input.walletAddresses));
      }
      if (input.search.trim()) {
        const q = `%${input.search.trim()}%`;
        conditions.push(
          or(
            like(htlcSwaps.peerId, q),
            like(htlcSwaps.htlcAddress, q),
            like(htlcSwaps.toToken, q),
            like(htlcSwaps.senderAddress, q),
          )
        );
      }

      const refunds = await db
        .select()
        .from(htlcSwaps)
        .where(and(...conditions))
        .orderBy(desc(htlcSwaps.createdAt))
        .limit(100);

      return { refunds, isWalletScoped };
    }),

  /** Get a single HTLC swap row by its DB id for the detail drawer */
  htlcDetail: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const rows = await db
        .select()
        .from(htlcSwaps)
        .where(eq(htlcSwaps.id, input.id))
        .limit(1);
      return rows[0] ?? null;
    }),

  /** Write the refundTxId back to an htlcSwaps row after a successful on-chain refund */
  updateHtlcRefund: publicProcedure
    .input(z.object({
      htlcAddress: z.string(),
      refundTxId:  z.string(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: false };
      await db
        .update(htlcSwaps)
        .set({
          refundTxId:  input.refundTxId,
          status:      "refunded",
          refundedAt:  new Date(),
          updatedAt:   new Date(),
        })
        .where(eq(htlcSwaps.htlcAddress, input.htlcAddress));
      return { success: true };
    }),
});
