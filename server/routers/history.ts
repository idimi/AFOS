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
import { recordHtlcLock, recordSwapAnalytic, markHtlcCompleted } from "../htlcMonitor";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sinceDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const historyRouter = router({
  /**
   * Record a completed or failed P2P atomic swap from the client.
   * Inserts into both htlcSwaps (for Open Trades / Refunds tabs) and swapAnalytics (for History tab).
   * Called by useP2PSwap when a swap reaches "complete" or "failed" phase.
   */
  recordP2PSwap: publicProcedure
    .input(z.object({
      rfqId:          z.string(),
      role:           z.enum(["requester", "maker"]),
      status:         z.enum(["completed", "failed", "refunded"]),
      fromChain:      z.enum(["bitcoin", "ethereum", "solana"]),
      toChain:        z.enum(["bitcoin", "ethereum", "solana"]),
      fromToken:      z.string(),
      toToken:        z.string(),
      fromAmount:     z.number(),
      toAmount:       z.number(),
      rate:           z.number(),
      peerId:         z.string().optional(),
      walletAddress:  z.string().optional(),
      lockTxHashA:    z.string().optional(),
      lockTxHashB:    z.string().optional(),
      escrowAddressA: z.string().optional(),
      escrowAddressB: z.string().optional(),
      secretHash:     z.string().optional(),
      timelockA:      z.number().optional(),
      timelockB:      z.number().optional(),
      settlementMs:   z.number().optional(),
      errorReason:    z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        // 1. Record the HTLC lock for the side this user initiated
        const chain = input.role === "requester" ? input.fromChain : input.toChain;
        const lockTxId = input.role === "requester" ? input.lockTxHashA : input.lockTxHashB;
        const escrowAddress = input.role === "requester" ? input.escrowAddressA : input.escrowAddressB;
        const locktime = input.role === "requester" ? (input.timelockA ?? 0) : (input.timelockB ?? 0);
        const amountHuman = input.role === "requester"
          ? String(input.fromAmount)
          : String(input.toAmount);

        if (escrowAddress && input.secretHash) {
          await recordHtlcLock({
            chain,
            htlcAddress:   escrowAddress,
            secretHash:    input.secretHash,
            lockTxId:      lockTxId,
            amountRaw:     String(Math.round(input.fromAmount * 1e9)),
            amountHuman,
            locktime,
            peerId:        input.peerId,
            rfqId:         input.rfqId,
            toToken:       input.toToken,
            toChain:       input.toChain,
            senderAddress: input.walletAddress,
          });
        }

        // 2. If completed, mark HTLC as done
        if (input.status === "completed" && input.secretHash) {
          await markHtlcCompleted(input.secretHash, lockTxId);
        }

        // 3. Record in swapAnalytics for the History tab
        const settlementMs = input.settlementMs ?? (input.status === "completed" ? 30000 : undefined);
        await recordSwapAnalytic({
          fromChain:     input.fromChain,
          toChain:       input.toChain,
          fromToken:     input.fromToken,
          toToken:       input.toToken,
          amount:        String(input.fromAmount),
          route:         "p2p",
          status:        input.status,
          settlementMs,
          txId:          lockTxId,
          peerId:        input.peerId,
          feeBps:        15,
          walletAddress: input.walletAddress,
          rfqId:         input.rfqId,
          outAmount:     String(input.toAmount),
        });

        return { ok: true };
      } catch (err) {
        console.error("[recordP2PSwap] Error:", err);
        return { ok: false, error: String(err) };
      }
    }),

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
      if (!db) return { totalSwaps: 0, totalVolumeUsd: 0, totalFeesUsd: 0, successRate: "0.0", isWalletScoped: false };

      const since = sinceDate(input.days);
      const isWalletScoped = input.walletAddresses.length > 0;

      // Guard: return zero stats when no wallet connected and not admin global view
      if (!isWalletScoped && !input.adminGlobalView) {
        return { totalSwaps: 0, totalVolumeUsd: 0, totalFeesUsd: 0, successRate: "0.0", isWalletScoped: false };
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

  /**
   * Fetch full detail for a single swap by its swapAnalytics row ID.
   * Returns the swapAnalytics row plus any matching htlcSwaps rows
   * (matched by rfqId or txId) so the detail drawer can show both legs.
   */
  detail: publicProcedure
    .input(z.object({
      id: z.number().int().positive(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { swap: null, htlcLegs: [] };

      const [swap] = await db
        .select()
        .from(swapAnalytics)
        .where(eq(swapAnalytics.id, input.id))
        .limit(1);

      if (!swap) return { swap: null, htlcLegs: [] };

      // Find matching HTLC legs by rfqId (preferred) or txId
      const htlcConditions = [];
      if (swap.rfqId) htlcConditions.push(eq(htlcSwaps.rfqId, swap.rfqId));
      if (swap.txId) htlcConditions.push(eq(htlcSwaps.lockTxId, swap.txId));

      const htlcLegs = htlcConditions.length > 0
        ? await db
            .select()
            .from(htlcSwaps)
            .where(or(...htlcConditions))
            .orderBy(htlcSwaps.createdAt)
        : [];

      return { swap, htlcLegs };
    }),
});
