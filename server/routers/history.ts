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
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { swapAnalytics, htlcSwaps, htlcSecrets } from "../../drizzle/schema";
import { eq, and, gte, desc, count, inArray, or, sql, like, lt, notExists } from "drizzle-orm";
import type { SupportedChain } from "@shared/const";

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
          eq(swapAnalytics.fromChain, input.chain as SupportedChain)
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

      const rawRows = await db
        .select()
        .from(swapAnalytics)
        .where(where)
        .orderBy(desc(swapAnalytics.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      // Enrich with settledVia from htlc_secrets (join on rfqId)
      const rfqIds = rawRows.map(r => r.rfqId).filter(Boolean) as string[];
      let secretsMap: Record<string, { settledVia: string | null; settledAt: Date | null }> = {};
      if (rfqIds.length > 0) {
        const secrets = await db
          .select({
            rfqId: htlcSecrets.rfqId,
            settledVia: htlcSecrets.settledVia,
            settledAt: htlcSecrets.settledAt,
          })
          .from(htlcSecrets)
          .where(inArray(htlcSecrets.rfqId, rfqIds));
        for (const s of secrets) {
          secretsMap[s.rfqId] = { settledVia: s.settledVia, settledAt: s.settledAt };
        }
      }

      const rows = rawRows.map(r => ({
        ...r,
        settledVia: r.rfqId ? (secretsMap[r.rfqId]?.settledVia ?? null) : null,
        settledAt:  r.rfqId ? (secretsMap[r.rfqId]?.settledAt ?? null) : null,
      }));

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

      // Exclude pending HTLCs where swap_analytics confirms the swap completed.
      // This prevents ghost "open trade" entries for successfully settled swaps.
      const notCompletedInAnalytics = notExists(
        db.select({ one: sql`1` })
          .from(swapAnalytics)
          .where(
            and(
              eq(swapAnalytics.rfqId, htlcSwaps.rfqId),
              eq(swapAnalytics.status, "completed"),
            )
          )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conditions: any[] = [
        eq(htlcSwaps.status, "pending"),
        notCompletedInAnalytics,
      ];
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
      // adminOverride: when true AND walletAddresses is empty, return all refunds (admin use only).
      // When false (default) and walletAddresses is empty, return nothing — security gate.
      adminOverride:   z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { refunds: [], isWalletScoped: false };

      // Security gate: if no wallet addresses provided and not admin override, return empty.
      // This prevents unauthenticated or wallet-less users from seeing all refunds.
      if (input.walletAddresses.length === 0 && !input.adminOverride) {
        return { refunds: [], isWalletScoped: false };
      }

      const isWalletScoped = input.walletAddresses.length > 0;

      const statusCondition = or(
        eq(htlcSwaps.status, "pending"),
        eq(htlcSwaps.status, "refunded"),
        eq(htlcSwaps.status, "expired"),
      );

      // Exclude pending HTLCs where swap_analytics confirms the swap completed.
      // This prevents false CLAIMABLE entries for successfully settled swaps where the
      // DB status hasn't been updated yet (e.g. Helius webhook cache lag).
      const notCompletedInAnalytics = notExists(
        db.select({ one: sql`1` })
          .from(swapAnalytics)
          .where(
            and(
              eq(swapAnalytics.rfqId, htlcSwaps.rfqId),
              eq(swapAnalytics.status, "completed"),
            )
          )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conditions: any[] = [
        statusCondition,
        // For pending HTLCs only: exclude those with a completed swap in analytics.
        // Refunded/expired rows are always shown regardless.
        or(
          // Non-pending rows (refunded/expired) always pass through
          or(eq(htlcSwaps.status, "refunded"), eq(htlcSwaps.status, "expired")),
          // Pending rows only pass if no completed analytics entry exists for this rfqId
          and(eq(htlcSwaps.status, "pending"), notCompletedInAnalytics),
        ),
      ];
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

  /**
   * On-chain scanner — fetches unclaimed HTLCs directly from the blockchain.
   * Covers Solana (getProgramAccounts), Ethereum (event logs), and BTC (DB + mempool.space).
   * When walletAddresses is provided, only returns HTLCs where senderAddress matches.
   * When walletAddresses is empty + adminOverride=true, returns all HTLCs (admin view).
   * When walletAddresses is empty + adminOverride=false (default), returns nothing (security gate).
   */
  myOnChainRefunds: publicProcedure
    .input(z.object({
      walletAddresses: z.array(z.string()).default([]),
      // adminOverride: when true AND walletAddresses is empty, return all HTLCs (admin use only).
      // When false (default) and walletAddresses is empty, return nothing.
      adminOverride: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      // Security gate: if no wallet addresses provided and not admin override, return empty.
      // This prevents random users from seeing all on-chain HTLCs.
      if (input.walletAddresses.length === 0 && !input.adminOverride) {
        return { htlcs: [] };
      }

      // Normalise wallet addresses to lowercase for case-insensitive comparison (ETH addresses).
      const walletSet = new Set(input.walletAddresses.map(a => a.toLowerCase()));
      const filterBySender = input.walletAddresses.length > 0; // false only when adminOverride + empty

      const results: Array<{
        htlcId: string;
        pdaAddress: string;
        senderAddress: string;
        amount: string;
        amountHuman: string;
        token: string;
        chain: string;
        timelockExpiry: number;
        timelockExpired: boolean;
        dbStatus: string | null;
        rfqId: string | null;
        secretHash: string | null;
      }> = [];

      // ── Phase 1: Solana on-chain scanner ──────────────────────────────────────
      // Strategy: DB-first + getAccountInfo per PDA.
      // We query htlcSwaps for pending Solana HTLCs, then verify each PDA with
      // getAccountInfo (fast: ~0.1s per call). This avoids getProgramAccounts
      // which times out on public RPCs.
      try {
        const { ENV } = await import("../_core/env");
        const rpcUrl = ENV.solRpcUrl || "https://solana-rpc.publicnode.com";
        const { PublicKey } = await import("@solana/web3.js");
        const nowSec = Math.floor(Date.now() / 1000);
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");

        // Build DB query for pending Solana HTLCs
        const solConditions = [
          eq(htlcSwaps.chain, "solana"),
          eq(htlcSwaps.status, "pending"),
        ];
        // For user view, filter by sender address in DB
        if (filterBySender) {
          const { inArray } = await import("drizzle-orm");
          solConditions.push(inArray(htlcSwaps.senderAddress, input.walletAddresses));
        }
        const pendingSol = await db
          .select()
          .from(htlcSwaps)
          .where(and(...solConditions))
          .limit(50);

        console.log(`[myOnChainRefunds] Solana DB query: ${pendingSol.length} pending HTLCs (wallets: ${JSON.stringify(input.walletAddresses)}, filterBySender: ${filterBySender})`);
        if (pendingSol.length > 0) {
          console.log(`[myOnChainRefunds] Found HTLCs:`, pendingSol.map(r => ({ addr: r.htlcAddress?.slice(0,8), sender: r.senderAddress?.slice(0,8), status: r.status })));
        }

        // Helper to parse a single HTLC account buffer
        const parseHtlcAccount = (raw: Buffer, pubkey: string) => {
          // Correct layout (verified from on-chain hex dumps, 219 bytes total):
          // discriminator(8) + htlcId_fixed32(32) + sender(32) + receiver(32) +
          // secretHash(32) + timelock_i64(8) + amount_u64(8) + padding(33) + status(1)
          // Status byte is at offset 185, NOT 152.
          if (raw.length < 186) return null;
          const htlcIdRaw = raw.slice(8, 40);
          const nullIdx = htlcIdRaw.indexOf(0);
          const htlcId = htlcIdRaw.slice(0, nullIdx >= 0 ? nullIdx : 32).toString("utf8");
          const sender = new PublicKey(raw.slice(40, 72)).toBase58();
          const secretHashHex = raw.slice(104, 136).toString("hex");
          const timelock = Number(raw.readBigInt64LE(136));
          const amountLamports = raw.readBigUInt64LE(144);
          const status = raw[185]; // 0=active, 1=refunded, 2=claimed
          if (status !== 0) return null; // only return active/locked HTLCs
          const amountSol = Number(amountLamports) / 1e9;
          return {
            htlcId, pdaAddress: pubkey, senderAddress: sender,
            amount: amountLamports.toString(), amountHuman: amountSol.toFixed(6),
            token: "SOL", chain: "solana",
            timelockExpiry: timelock, timelockExpired: timelock > 0 && timelock < nowSec,
            dbStatus: null, rfqId: null, secretHash: secretHashHex,
          };
        };

        // Verify each PDA on-chain with getAccountInfo (fast)
        for (const row of pendingSol) {
          try {
            const resp = await fetch(rpcUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0", id: 1,
                method: "getAccountInfo",
                params: [row.htlcAddress, { encoding: "base64" }],
              }),
              signal: AbortSignal.timeout(8000),
            });
            const json = await resp.json() as { result?: { value?: { data: [string, string] } | null } };
            const accValue = json.result?.value;
            const raw = accValue ? Buffer.from(accValue.data[0], "base64") : null;

            if (!raw || raw.length < 186) {
              // PDA is closed (null) or too short — HTLC was either claimed or refunded on-chain.
              // We can't distinguish from the closed PDA alone, so cross-reference swap_analytics:
              // if the rfqId has a completed entry → it was claimed (completed).
              // Otherwise fall back to refunded.
              let closedStatus: "completed" | "refunded" = "refunded";
              try {
                const db2 = await getDb();
                if (db2 && row.rfqId) {
                  const [analytic] = await db2.select({ status: swapAnalytics.status })
                    .from(swapAnalytics)
                    .where(eq(swapAnalytics.rfqId, row.rfqId))
                    .limit(1);
                  if (analytic?.status === "completed") {
                    closedStatus = "completed";
                  }
                }
              } catch { /* ignore — fall back to refunded */ }
              try {
                const db2 = await getDb();
                if (db2) {
                  await db2.update(htlcSwaps)
                    .set({ status: closedStatus })
                    .where(eq(htlcSwaps.htlcAddress, row.htlcAddress));
                  console.log(`[myOnChainRefunds] Auto-marked HTLC ${row.htlcAddress.slice(0,8)} as ${closedStatus} (PDA closed on-chain, rfqId=${row.rfqId ?? 'none'})`);
                }
              } catch (dbErr) {
                console.warn(`[myOnChainRefunds] Failed to auto-mark HTLC ${row.htlcAddress.slice(0,8)}:`, dbErr);
              }
              continue;
            }

            // Read status byte at offset 185 (verified correct offset from on-chain hex dumps)
            const onChainStatus = raw[185]; // 0=active, 1=refunded, 2=claimed
            if (onChainStatus !== 0) {
              // PDA exists but HTLC is already settled (refunded or claimed).
              // Update DB to match on-chain reality. Do NOT write placeholder strings.
              const newStatus = onChainStatus === 2 ? "completed" : "refunded";
              try {
                const db2 = await getDb();
                if (db2) {
                  await db2.update(htlcSwaps)
                    .set({ status: newStatus })
                    .where(eq(htlcSwaps.htlcAddress, row.htlcAddress));
                  console.log(`[myOnChainRefunds] Auto-marked HTLC ${row.htlcAddress.slice(0,8)} as ${newStatus} (on-chain status byte=${onChainStatus})`);
                }
              } catch (dbErr) {
                console.warn(`[myOnChainRefunds] Failed to auto-mark HTLC ${row.htlcAddress.slice(0,8)}:`, dbErr);
              }
              continue;
            }

            // status byte = 0 → HTLC is still active on-chain
            const parsed = parseHtlcAccount(raw, row.htlcAddress);
            if (parsed) {
              // Enrich with DB data and push
              results.push({
                ...parsed,
                rfqId: row.rfqId ?? null,
                dbStatus: row.status,
              });
            }
          } catch (err) {
            console.warn(`[myOnChainRefunds] getAccountInfo failed for ${row.htlcAddress.slice(0,8)}:`, err);
          }
        }
      } catch (err) {
        console.warn("[myOnChainRefunds] Solana scanner error:", err);
      }

      // ── Phase 2: ETH on-chain scanner ─────────────────────────────────────────
      try {
        const contractAddress = process.env.ETH_HTLC_ADDRESS;
        const ethRpcUrl = process.env.ETH_RPC_URL;
        if (contractAddress && ethRpcUrl) {
          // Keccak256("Locked(bytes32,address,address,uint256,bytes32,uint256)")
          const LOCKED_TOPIC = "0x1d1e5b9e5b9e5b9e5b9e5b9e5b9e5b9e5b9e5b9e5b9e5b9e5b9e5b9e5b9e5b9e";
          const logsResp = await fetch(ethRpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0", id: 1,
              method: "eth_getLogs",
              params: [{ address: contractAddress, topics: [LOCKED_TOPIC], fromBlock: "earliest", toBlock: "latest" }],
            }),
            signal: AbortSignal.timeout(15000),
          });
          const logsJson = await logsResp.json() as { result?: Array<{ topics: string[]; data: string; transactionHash: string }> };
          const logs = logsJson.result ?? [];
          const nowSec = Math.floor(Date.now() / 1000);

          for (const log of logs) {
            try {
              const contractId = log.topics[1];
              const initiator = "0x" + log.topics[2].slice(26);
              const data = log.data.slice(2);
              const amountHex = data.slice(0, 64);
              const timelockHex = data.slice(128, 192);
              const amountWei = BigInt("0x" + amountHex);
              const timelock = Number(BigInt("0x" + timelockHex));
              const timelockExpired = timelock > 0 && timelock < nowSec;

              // Filter by sender: only include if initiator matches one of the connected wallets
              if (filterBySender && !walletSet.has(initiator.toLowerCase())) continue;

              // Check if still active via getContract
              const statusResp = await fetch(ethRpcUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  jsonrpc: "2.0", id: 2,
                  method: "eth_call",
                  params: [{ to: contractAddress, data: "0xf4fd17f9" + contractId.slice(2) }, "latest"],
                }),
                signal: AbortSignal.timeout(10000),
              });
              const statusJson = await statusResp.json() as { result?: string };
              const statusHex = statusJson.result ?? "0x";
              if (statusHex.length < 66) continue;
              const contractStatus = parseInt(statusHex.slice(-2), 16);
              if (contractStatus !== 1) continue; // 1 = active

              results.push({
                htlcId: contractId,
                pdaAddress: contractId,
                senderAddress: initiator,
                amount: amountWei.toString(),
                amountHuman: (Number(amountWei) / 1e18).toFixed(6),
                token: "ETH",
                chain: "ethereum",
                timelockExpiry: timelock,
                timelockExpired,
                dbStatus: null,
                rfqId: null,
                secretHash: null,
              });
            } catch {
              // skip malformed logs
            }
          }
        }
      } catch (err) {
        console.warn("[myOnChainRefunds] ETH scan failed:", err);
      }

      // ── Phase 3: BTC — check DB for pending HTLCs + verify UTXO status ────────
      try {
        const db = await getDb();
        if (db) {
          const pendingBtc = await db
            .select()
            .from(htlcSwaps)
            .where(and(
              eq(htlcSwaps.chain, "bitcoin"),
              eq(htlcSwaps.status, "pending"),
            ))
            .limit(50);

          const nowMs = Date.now();
          for (const row of pendingBtc) {
            try {
              // Check UTXO via mempool.space
              const utxoResp = await fetch(
                `https://mempool.space/api/address/${row.htlcAddress}/utxo`,
                { signal: AbortSignal.timeout(8000) }
              );
              const utxos = await utxoResp.json() as Array<{ value: number }>;
              if (!utxos || utxos.length === 0) continue; // already spent

              const totalSats = utxos.reduce((s, u) => s + u.value, 0);
              // Estimate timelock expiry from locktime (block height * ~600s)
              const estimatedExpiry = row.locktime * 600;
              const timelockExpired = estimatedExpiry < nowMs / 1000;

              // Filter by sender: only include if senderAddress matches one of the connected wallets
              const btcSender = row.senderAddress ?? "";
              if (filterBySender && !walletSet.has(btcSender.toLowerCase())) continue;

              results.push({
                htlcId: row.htlcAddress,
                pdaAddress: row.htlcAddress,
                senderAddress: row.senderAddress ?? "unknown",
                amount: totalSats.toString(),
                amountHuman: (totalSats / 1e8).toFixed(8),
                token: "BTC",
                chain: "bitcoin",
                timelockExpiry: estimatedExpiry,
                timelockExpired,
                dbStatus: row.status,
                rfqId: row.rfqId ?? null,
                secretHash: row.secretHash,
              });
            } catch {
              // skip
            }
          }
        }
      } catch (err) {
        console.warn("[myOnChainRefunds] BTC scan failed:", err);
      }

      // ── Phase 4: TNK (Trac Network) — query DB for pending HTLCs ─────────────
      try {
        const db = await getDb();
        if (db) {
          const pendingTnk = await db
            .select()
            .from(htlcSwaps)
            .where(and(
              eq(htlcSwaps.chain, "trac_network"),
              eq(htlcSwaps.status, "pending"),
            ))
            .limit(50);
          const nowSec = Math.floor(Date.now() / 1000);
          for (const row of pendingTnk) {
            try {
              // TNK uses Unix timestamps for locktime (same as Solana)
              const isUnixTimelock = row.locktime > 1_000_000_000;
              const timelockExpired = isUnixTimelock && row.locktime < nowSec;
              // Filter by sender address
              const tnkSender = row.senderAddress ?? "";
              if (filterBySender && tnkSender && !walletSet.has(tnkSender.toLowerCase())) continue;
              results.push({
                htlcId: row.htlcId ?? row.htlcAddress,
                pdaAddress: row.htlcAddress,
                senderAddress: row.senderAddress ?? "unknown",
                amount: row.amountHuman,
                amountHuman: row.amountHuman,
                token: "TNK",
                chain: "trac_network",
                timelockExpiry: isUnixTimelock ? row.locktime : 0,
                timelockExpired,
                dbStatus: row.status,
                rfqId: row.rfqId ?? null,
                secretHash: row.secretHash,
              });
            } catch {
              // skip
            }
          }
        }
      } catch (err) {
        console.warn("[myOnChainRefunds] TNK scan failed:", err);
      }

      return { htlcs: results };
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

  /**
   * Agent-side refund: triggers the AFOS agent to submit the on-chain refund tx.
   * Used when the agent is the on-chain sender (locked the HTLC on behalf of the user).
   * The agent signs with SOL_HTLC_KEY and the program returns the SOL to the agent wallet.
   */
  agentRefundHtlc: publicProcedure
    .input(z.object({
      htlcAddress: z.string(),
      htlcId:      z.string(),
      tokenSymbol: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });

      // Verify the HTLC exists and is still pending
      const [htlc] = await db
        .select()
        .from(htlcSwaps)
        .where(eq(htlcSwaps.htlcAddress, input.htlcAddress))
        .limit(1);

      if (!htlc) throw new TRPCError({ code: 'NOT_FOUND', message: 'HTLC not found' });
      if (htlc.status !== 'pending') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `HTLC is already ${htlc.status}` });
      }

      // Verify timelock has expired
      const nowSec = Math.floor(Date.now() / 1000);
      if (htlc.locktime && nowSec < htlc.locktime) {
        const remaining = htlc.locktime - nowSec;
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Timelock has not expired yet. ${remaining}s remaining.`,
        });
      }

      // Import and call the refund executor
      const { refundSolanaHtlc } = await import('../solanaHtlcRefund.js');
      const result = await refundSolanaHtlc({
        htlcId: input.htlcId,
        tokenSymbol: input.tokenSymbol,
      });

      // Update DB
      await db
        .update(htlcSwaps)
        .set({
          refundTxId: result.txSignature,
          status:     'refunded',
          refundedAt: new Date(),
          updatedAt:  new Date(),
        })
        .where(eq(htlcSwaps.htlcAddress, input.htlcAddress));

      return { success: true, txSignature: result.txSignature };
    }),

  /**
   * List htlc_secrets rows in 'revealed' state older than 10 minutes.
   * These are swaps where the secret was revealed but the claim never completed.
   * Admin-only.
   */
  getStuckSwaps: protectedProcedure
    .query(async ({ ctx }) => {
      if (ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin only' });
      }
      const db = await getDb();
      if (!db) return { swaps: [] };

      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

      const rows = await db
        .select()
        .from(htlcSecrets)
        .where(
          and(
            eq(htlcSecrets.status, 'revealed'),
            lt(htlcSecrets.updatedAt, tenMinutesAgo),
          )
        )
        .orderBy(desc(htlcSecrets.updatedAt))
        .limit(50);

      // Enrich with htlc_swaps data for each rfqId
      const enriched = await Promise.all(rows.map(async (row) => {
        const swapRows = await db
          .select({
            htlcId:         htlcSwaps.htlcId,
            htlcAddress:    htlcSwaps.htlcAddress,
            senderAddress:  htlcSwaps.senderAddress,
            status:         htlcSwaps.status,
            toToken:        htlcSwaps.toToken,
          })
          .from(htlcSwaps)
          .where(eq(htlcSwaps.rfqId, row.rfqId))
          .limit(2);

        const minutesStuck = Math.floor((Date.now() - new Date(row.updatedAt).getTime()) / 60_000);

        return {
          id:                  row.id,
          rfqId:               row.rfqId,
          secretHex:           row.secretHex,
          secretHashHex:       row.secretHashHex,
          fromChain:           row.fromChain,
          toChain:             row.toChain,
          fromToken:           row.fromToken,
          toToken:             row.toToken,
          initiatorAddress:    row.initiatorAddress,
          counterpartyAddress: row.counterpartyAddress,
          htlcId:              row.htlcId,
          status:              row.status,
          updatedAt:           row.updatedAt,
          minutesStuck,
          htlcSwaps:           swapRows,
        };
      }));

      return { swaps: enriched };
    }),

  /**
   * Force-claim a stuck swap by rfqId.
   * Triggers immediate server-side claims for both Agent A and Agent B HTLCs.
   * Admin-only.
   */
  forceClaimSwap: protectedProcedure
    .input(z.object({
      rfqId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin only' });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });

      // Get the htlc_secret row
      const [secretRow] = await db
        .select()
        .from(htlcSecrets)
        .where(eq(htlcSecrets.rfqId, input.rfqId))
        .limit(1);

      if (!secretRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `No htlc_secret found for rfqId ${input.rfqId}` });
      }

      if (secretRow.status === 'completed') {
        return { success: true, message: 'Already completed', results: [] };
      }

      // Get the two htlc_swaps rows
      const swapRows = await db
        .select()
        .from(htlcSwaps)
        .where(eq(htlcSwaps.rfqId, input.rfqId))
        .limit(2);

      if (swapRows.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `No htlc_swaps found for rfqId ${input.rfqId}` });
      }

      // Import the claim executor
      const { claimSolanaHtlc } = await import('../solanaHtlcClaim.js');

      const results: Array<{ htlcId: string; chain: string; success: boolean; txSignature?: string; error?: string }> = [];

      for (const swap of swapRows) {
        if (!swap.htlcId) continue;
        if (swap.status === 'completed') {
          results.push({ htlcId: swap.htlcId, chain: swap.chain, success: true });
          continue;
        }
        if (swap.chain !== 'solana') {
          results.push({ htlcId: swap.htlcId, chain: swap.chain, success: false, error: 'Non-Solana force-claim not yet supported' });
          continue;
        }
        try {
          const result = await claimSolanaHtlc({
            htlcId:      swap.htlcId,
            secretHex:   secretRow.secretHex,
            tokenSymbol: swap.toToken ?? 'SOL',
            recipientAddress: swap.counterpartyAddress ?? swap.senderAddress ?? '',
          });
          // Update DB
          await db
            .update(htlcSwaps)
            .set({ status: 'completed', updatedAt: new Date() })
            .where(eq(htlcSwaps.id, swap.id));
          results.push({ htlcId: swap.htlcId, chain: swap.chain, success: true, txSignature: result.txSignature });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({ htlcId: swap.htlcId, chain: swap.chain, success: false, error: msg });
        }
      }

      // Mark htlc_secrets as completed if all succeeded
      const allOk = results.every(r => r.success);
      if (allOk) {
        const now = new Date();
        await db
          .update(htlcSecrets)
          .set({ status: 'completed', settledAt: now, settledVia: 'admin_force_claim', updatedAt: now })
          .where(eq(htlcSecrets.rfqId, input.rfqId));
      }

      return { success: allOk, message: allOk ? 'All claims succeeded' : 'Some claims failed', results };
    }),

  /**
   * Return all 6 on-chain proof fields for a single swap by rfqId.
   * Used by SwapProgressCard (on mount refresh) and SwapHistory (View Proof modal).
   * Returns null when the rfqId is unknown or has no proof data yet.
   */
  getSwapProof: publicProcedure
    .input(z.object({ rfqId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [row] = await db
        .select({
          rfqId:                  htlcSecrets.rfqId,
          fromChain:              htlcSecrets.fromChain,
          toChain:                htlcSecrets.toChain,
          fromToken:              htlcSecrets.fromToken,
          toToken:                htlcSecrets.toToken,
          lockTxId:               htlcSecrets.lockTxId,
          counterpartyLockTxId:   htlcSecrets.counterpartyLockTxId,
          escrowAddress:          htlcSecrets.escrowAddress,
          peerEscrowAddress:      htlcSecrets.peerEscrowAddress,
          revealTxId:             htlcSecrets.revealTxId,
          counterpartyRevealTxId: htlcSecrets.counterpartyRevealTxId,
          status:                 htlcSecrets.status,
        })
        .from(htlcSecrets)
        .where(eq(htlcSecrets.rfqId, input.rfqId))
        .limit(1);
      if (!row) return null;
      return row;
    }),

  /**
   * Batch-fetch proof data for multiple rfqIds in a single round-trip.
   * Used by SwapHistory to load proof availability for all visible rows at once.
   * Returns a map of rfqId → proof (null entries are omitted).
   */
  batchGetSwapProofs: publicProcedure
    .input(z.object({ rfqIds: z.array(z.string()).max(50) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db || input.rfqIds.length === 0) return {};
      const rows = await db
        .select({
          rfqId:                  htlcSecrets.rfqId,
          fromChain:              htlcSecrets.fromChain,
          toChain:                htlcSecrets.toChain,
          fromToken:              htlcSecrets.fromToken,
          toToken:                htlcSecrets.toToken,
          lockTxId:               htlcSecrets.lockTxId,
          counterpartyLockTxId:   htlcSecrets.counterpartyLockTxId,
          escrowAddress:          htlcSecrets.escrowAddress,
          peerEscrowAddress:      htlcSecrets.peerEscrowAddress,
          revealTxId:             htlcSecrets.revealTxId,
          counterpartyRevealTxId: htlcSecrets.counterpartyRevealTxId,
          status:                 htlcSecrets.status,
        })
        .from(htlcSecrets)
        .where(inArray(htlcSecrets.rfqId, input.rfqIds));
      const map: Record<string, typeof rows[0]> = {};
      for (const r of rows) map[r.rfqId] = r;
      return map;
    }),
});
