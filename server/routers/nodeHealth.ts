/**
 * nodeHealth router
 *
 * Proxies health checks from the server side so the browser doesn't
 * need to make direct HTTP requests to internal IPs (which are blocked
 * by CORS and firewall rules).
 *
 * Node order:
 *   1. Oracle VM
 *   2. Ethereum RPC   — block height via ethereum.publicnode.com
 *   3. Solana RPC     — block height via api.mainnet-beta.solana.com
 *   4. Bitcoin RPC    — block height via mempool.space
 *   5. Trac Network RPC — block height via tracapi.trac.network
 *   6. AFOS Signaling — local WebSocket peer count
 *
 * Detail pattern for all RPC nodes:
 *   "Block height: {n} · Connected via {source}"
 */
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { ENV } from "../_core/env";

interface NodeStatus {
  name: string;
  status: "live" | "degraded" | "offline";
  detail: string;
  latency?: string;
  error?: string;
}

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

/** Fetch ETH block height from a public RPC (hex → decimal) */
async function getEthBlockHeight(): Promise<number | null> {
  try {
    const res = await fetch("https://ethereum.publicnode.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { result?: string };
    return data.result ? parseInt(data.result, 16) : null;
  } catch {
    return null;
  }
}

/** Fetch SOL block height from the public mainnet RPC */
async function getSolBlockHeight(): Promise<number | null> {
  try {
    const res = await fetch("https://api.mainnet-beta.solana.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBlockHeight" }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { result?: number };
    return data.result ?? null;
  } catch {
    return null;
  }
}

/** Fetch BTC block height from mempool.space */
async function getBtcBlockHeight(): Promise<number | null> {
  try {
    const res = await fetch("https://mempool.space/api/blocks/tip/height", {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    const n = parseInt(text.trim(), 10);
    return isNaN(n) ? null : n;
  } catch {
    return null;
  }
}

export const nodeHealthRouter = router({
  /**
   * Check all node health statuses from the server side.
   * Returns an array of NodeStatus objects in display order.
   */
  check: adminProcedure.query(async () => {
    const results: NodeStatus[] = [];
    const ORACLE_API = ENV.oracleApiUrl;

    // ── 1. Oracle VM ─────────────────────────────────────────────────────────
    let oracleOk = false;
    let oracleLatency = "";
    try {
      const t0 = Date.now();
      const resp = await fetch(`${ORACLE_API}/health`, {
        signal: AbortSignal.timeout(8000),
      });
      oracleLatency = `${Date.now() - t0}ms`;
      if (resp.ok) {
        const data = await resp.json() as {
          status?: string;
          version?: string;
          agentStatus?: string;
        };
        oracleOk = true;
        results.push({
          name: "Oracle VM",
          status: "live",
          detail: `HTTP 200 · ${data.status ?? "ok"}`,
          latency: oracleLatency,
        });
      } else {
        results.push({
          name: "Oracle VM",
          status: "degraded",
          detail: `HTTP ${resp.status}`,
          latency: oracleLatency,
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Timeout";
      results.push({ name: "Oracle VM", status: "offline", detail: "Unreachable", error: msg });
    }

    // ── 2–4. ETH / SOL / BTC RPC — fetch block heights in parallel ──────────
    const [ethHeight, solHeight, btcHeight] = await Promise.all([
      getEthBlockHeight(),
      getSolBlockHeight(),
      getBtcBlockHeight(),
    ]);

    const rpcStatus = (height: number | null): "live" | "degraded" =>
      height !== null ? "live" : "degraded";

    const rpcDetail = (height: number | null, source: string): string =>
      height !== null
        ? `Block height: ${height.toLocaleString()} · Connected via ${source}`
        : `Connected via ${source} · Block height unavailable`;

    results.push({
      name: "Ethereum RPC",
      status: oracleOk ? rpcStatus(ethHeight) : "offline",
      detail: oracleOk
        ? rpcDetail(ethHeight, "ethereum.publicnode.com")
        : "Oracle VM offline",
      latency: ethHeight !== null ? oracleLatency : undefined,
    });

    results.push({
      name: "Solana RPC",
      status: oracleOk ? rpcStatus(solHeight) : "offline",
      detail: oracleOk
        ? rpcDetail(solHeight, "mainnet-beta.solana.com")
        : "Oracle VM offline",
      latency: solHeight !== null ? oracleLatency : undefined,
    });

    results.push({
      name: "Bitcoin RPC",
      status: oracleOk ? rpcStatus(btcHeight) : "offline",
      detail: oracleOk
        ? rpcDetail(btcHeight, "mempool.space")
        : "Oracle VM offline",
      latency: btcHeight !== null ? oracleLatency : undefined,
    });

    // ── 5. Trac Network RPC ──────────────────────────────────────────────────
    try {
      const t0 = Date.now();
      const resp = await fetch("https://tracapi.trac.network/v1/confirmed-length", {
        signal: AbortSignal.timeout(8000),
      });
      const latency = `${Date.now() - t0}ms`;
      if (resp.ok) {
        const data = await resp.json() as { confirmed_length?: number };
        const height = data.confirmed_length;
        results.push({
          name: "Trac Network RPC",
          status: "live",
          detail: height !== undefined
            ? `Block height: ${height.toLocaleString()} · Connected via tracapi.trac.network`
            : `Connected via tracapi.trac.network`,
          latency,
        });
      } else {
        results.push({
          name: "Trac Network RPC",
          status: "degraded",
          detail: `HTTP ${resp.status} · tracapi.trac.network`,
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Timeout";
      results.push({ name: "Trac Network RPC", status: "offline", detail: "Unreachable", error: msg });
    }

    // ── 6. TNK HTLC Subnet (trac-peer node) ────────────────────────────────
    try {
      const { isTnkPeerHealthy, getTnkBlockHeight } = await import("../tnkHtlcContract.js");
      const t0 = Date.now();
      const [healthy, blockHeight] = await Promise.all([
        isTnkPeerHealthy(),
        getTnkBlockHeight(),
      ]);
      const latency = `${Date.now() - t0}ms`;
      const peerUrl = process.env.TNK_PEER_RPC_URL ?? "http://localhost:5001";
      const host = (() => { try { return new URL(peerUrl).hostname; } catch { return peerUrl; } })();
      if (healthy) {
        results.push({
          name: "TNK HTLC Subnet",
          status: "live",
          detail: blockHeight !== null
            ? `Block height: ${blockHeight.toLocaleString()} · Connected via ${host}`
            : `Subnet reachable · Connected via ${host}`,
          latency,
        });
      } else {
        results.push({
          name: "TNK HTLC Subnet",
          status: "offline",
          detail: `Unreachable · ${host} · Set TNK_PEER_RPC_URL to deploy`,
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown";
      results.push({ name: "TNK HTLC Subnet", status: "offline", detail: "Subnet error", error: msg });
    }

    // ── 7. AFOS Signaling (local in-process WebSocket server) ────────────────
    try {
      const { getSignalingPeerCount } = await import("../signaling.js");
      const peerCount = getSignalingPeerCount();
      results.push({
        name: "AFOS Signaling",
        status: "live",
        detail: `${peerCount} peer${peerCount !== 1 ? "s" : ""} connected`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown";
      results.push({ name: "AFOS Signaling", status: "offline", detail: "Signaling server error", error: msg });
    }

    return results;
  }),

  /**
   * Lightweight public procedure — used by the swap UI chain selector badge.
   * Returns { online: boolean, blockHeight: number | null } without admin auth.
   * Clients should set staleTime: 15_000 to avoid hammering the subnet.
   */
  tnkSubnetStatus: publicProcedure.query(async () => {
    try {
      const { isTnkPeerHealthy, getTnkBlockHeight } = await import("../tnkHtlcContract.js");
      const [healthy, blockHeight] = await Promise.all([
        isTnkPeerHealthy(),
        getTnkBlockHeight(),
      ]);
      return { online: healthy, blockHeight };
    } catch {
      return { online: false, blockHeight: null };
    }
  }),
});
