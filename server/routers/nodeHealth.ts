/**
 * nodeHealth router
 *
 * Proxies health checks from the server side so the browser doesn't
 * need to make direct HTTP requests to internal IPs (which are blocked
 * by CORS and firewall rules).
 *
 * Node order:
 *   1. Oracle VM
 *   2. Ethereum RPC   (derived from Oracle VM /health)
 *   3. Solana RPC     (derived from Oracle VM /health)
 *   4. Bitcoin RPC    (derived from Oracle VM /health)
 *   5. Trac Network RPC  (https://tracapi.trac.network/v1/confirmed-length)
 *   6. AFOS Signaling    (local WebSocket signaling server peer count)
 */
import { router, protectedProcedure } from "../_core/trpc";
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

export const nodeHealthRouter = router({
  /**
   * Check all node health statuses from the server side.
   * Returns an array of NodeStatus objects in display order.
   */
  check: adminProcedure.query(async () => {
    const results: NodeStatus[] = [];
    const ORACLE_API = ENV.oracleApiUrl;

    // ── 1. Oracle VM + derived RPC statuses ──────────────────────────────────
    try {
      const t0 = Date.now();
      const resp = await fetch(`${ORACLE_API}/health`, {
        signal: AbortSignal.timeout(8000),
      });
      const latency = `${Date.now() - t0}ms`;
      if (resp.ok) {
        const data = await resp.json() as {
          status?: string;
          rpc?: { eth?: { ok: boolean }; sol?: { ok: boolean }; btc?: { ok: boolean } };
        };
        results.push({
          name: "Oracle VM",
          status: "live",
          detail: `HTTP 200 · ${data.status ?? "ok"}`,
          latency,
        });
        if (data.rpc) {
          results.push({
            name: "Ethereum RPC",
            status: data.rpc.eth?.ok ? "live" : "degraded",
            detail: data.rpc.eth?.ok ? "Connected via Oracle VM" : "RPC unreachable",
            latency: data.rpc.eth?.ok ? latency : undefined,
          });
          results.push({
            name: "Solana RPC",
            status: data.rpc.sol?.ok ? "live" : "degraded",
            detail: data.rpc.sol?.ok ? "Connected via Oracle VM" : "RPC unreachable",
            latency: data.rpc.sol?.ok ? latency : undefined,
          });
          results.push({
            name: "Bitcoin RPC",
            status: data.rpc.btc?.ok ? "live" : "degraded",
            detail: data.rpc.btc?.ok ? "Connected via Oracle VM" : "RPC unreachable",
            latency: data.rpc.btc?.ok ? latency : undefined,
          });
        } else {
          results.push({ name: "Ethereum RPC", status: "degraded", detail: "Status unknown", latency });
          results.push({ name: "Solana RPC",   status: "degraded", detail: "Status unknown", latency });
          results.push({ name: "Bitcoin RPC",  status: "degraded", detail: "Status unknown", latency });
        }
      } else {
        results.push({ name: "Oracle VM",    status: "degraded", detail: `HTTP ${resp.status}` });
        results.push({ name: "Ethereum RPC", status: "offline",  detail: "Oracle VM degraded" });
        results.push({ name: "Solana RPC",   status: "offline",  detail: "Oracle VM degraded" });
        results.push({ name: "Bitcoin RPC",  status: "offline",  detail: "Oracle VM degraded" });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Timeout";
      results.push({ name: "Oracle VM",    status: "offline", detail: "Unreachable", error: msg });
      results.push({ name: "Ethereum RPC", status: "offline", detail: "Oracle VM offline" });
      results.push({ name: "Solana RPC",   status: "offline", detail: "Oracle VM offline" });
      results.push({ name: "Bitcoin RPC",  status: "offline", detail: "Oracle VM offline" });
    }

    // ── 2. Trac Network RPC (tracapi.trac.network) ───────────────────────────
    // Uses /v1/confirmed-length — the canonical "is the chain alive?" probe.
    try {
      const t0 = Date.now();
      const resp = await fetch("https://tracapi.trac.network/v1/confirmed-length", {
        signal: AbortSignal.timeout(8000),
      });
      const latency = `${Date.now() - t0}ms`;
      if (resp.ok) {
        const data = await resp.json() as { confirmed_length?: number };
        const height = data.confirmed_length ?? "?";
        results.push({
          name: "Trac Network RPC",
          status: "live",
          detail: `Block height: ${height}`,
          latency,
        });
      } else {
        results.push({
          name: "Trac Network RPC",
          status: "degraded",
          detail: `HTTP ${resp.status}`,
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Timeout";
      results.push({ name: "Trac Network RPC", status: "offline", detail: "Unreachable", error: msg });
    }

    // ── 3. AFOS Signaling (local WebSocket server — no external fetch needed) ─
    // The signaling server runs in-process; we read peer count directly.
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
});
