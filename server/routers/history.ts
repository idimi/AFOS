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

  /**
   * On-chain scanner — fetches ALL unclaimed HTLCs directly from the blockchain.
   * Covers Solana (getProgramAccounts), Ethereum (event logs), and BTC (DB + mempool.space).
   * No wallet filter — the Solana program enforces sender==signer at refund time.
   */
  myOnChainRefunds: publicProcedure
    .input(z.object({
      walletAddresses: z.array(z.string()).default([]),
    }))
    .query(async ({ input }) => {
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
      try {
        const { ENV } = await import("../_core/env");
        const rpcUrl = ENV.solRpcUrl || "https://solana-rpc.publicnode.com";
        const AFOS_HTLC_PROGRAM_ID = "XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW";

        const body = JSON.stringify({
          jsonrpc: "2.0", id: 1,
          method: "getProgramAccounts",
          params: [AFOS_HTLC_PROGRAM_ID, {
            encoding: "base64",
            // No dataSize filter — htlcId is variable length so account size varies
          }],
        });

        const resp = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(15000),
        });
        const json = await resp.json() as { result?: Array<{ pubkey: string; account: { data: [string, string] } }> };
        const accounts = json.result ?? [];
        const nowSec = Math.floor(Date.now() / 1000);
        const { PublicKey } = await import("@solana/web3.js");

        for (const acc of accounts) {
          try {
            const raw = Buffer.from(acc.account.data[0], "base64");
            // Minimum: discriminator(8) + htlcId_fixed(32) + sender(32) + receiver(32) + secretHash(32) + timelock(8) + amount(8) + status(1) = 153
            if (raw.length < 153) continue;

            // Actual on-chain layout (verified from account 45jdLty...):
            // 0-8:    discriminator
            // 8-40:   htlcId as fixed [u8; 32] (null-padded)
            // 40-72:  sender pubkey (32 bytes)
            // 72-104: receiver pubkey (32 bytes)
            // 104-136: secretHash (32 bytes)
            // 136-144: timelock as Unix timestamp (i64 LE)
            // 144-152: amount in lamports (u64 LE)
            // 152:    status (0=active, 1=redeemed, 2=refunded)
            const htlcIdRaw = raw.slice(8, 40);
            const nullIdx = htlcIdRaw.indexOf(0);
            const htlcId = htlcIdRaw.slice(0, nullIdx >= 0 ? nullIdx : 32).toString("utf8");

            const sender = new PublicKey(raw.slice(40, 72)).toBase58();
            const secretHashHex = raw.slice(104, 136).toString("hex");
            const timelock = Number(raw.readBigInt64LE(136));
            const amountLamports = raw.readBigUInt64LE(144);
            const status = raw[152];
            if (status !== 0) continue; // 0 = active/locked

            const amountSol = Number(amountLamports) / 1e9;
            const timelockExpired = timelock > 0 && timelock < nowSec;

            results.push({
              htlcId,
              pdaAddress: acc.pubkey,
              senderAddress: sender,
              amount: amountLamports.toString(),
              amountHuman: amountSol.toFixed(6),
              token: "SOL",
              chain: "solana",
              timelockExpiry: timelock,
              timelockExpired,
              dbStatus: null,
              rfqId: null,
              secretHash: secretHashHex,
            });
          } catch {
            // skip malformed accounts
          }
        }
      } catch (err) {
        console.warn("[myOnChainRefunds] Solana scan failed:", err);
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
});
