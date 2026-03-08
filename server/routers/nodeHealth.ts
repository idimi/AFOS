/**
 * nodeHealth router
 *
 * Proxies health checks from the server side so the browser doesn't
 * need to make direct HTTP requests to internal IPs (which are blocked
 * by CORS and firewall rules).
 *
 * All health checks are performed server-side and results returned to
 * the client via tRPC.
 */
import { router } from "../_core/trpc";
import { protectedProcedure } from "../_core/trpc";
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
   * Returns an array of NodeStatus objects for Oracle VM, RPC nodes,
   * and the AFOS Signaling server.
   */
  check: adminProcedure.query(async () => {
    const results: NodeStatus[] = [];
    const ORACLE_API = ENV.oracleApiUrl;

    // 1. Oracle VM health endpoint (server-side fetch avoids CORS)
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
        // Derive RPC statuses from Oracle VM health response
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
          // Oracle VM is up but didn't return RPC info — mark as unknown
          results.push({ name: "Ethereum RPC", status: "degraded", detail: "Status unknown", latency });
          results.push({ name: "Solana RPC", status: "degraded", detail: "Status unknown", latency });
          results.push({ name: "Bitcoin RPC", status: "degraded", detail: "Status unknown", latency });
        }
      } else {
        results.push({
          name: "Oracle VM",
          status: "degraded",
          detail: `HTTP ${resp.status}`,
        });
        results.push({ name: "Ethereum RPC", status: "offline", detail: "Oracle VM degraded" });
        results.push({ name: "Solana RPC", status: "offline", detail: "Oracle VM degraded" });
        results.push({ name: "Bitcoin RPC", status: "offline", detail: "Oracle VM degraded" });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Timeout";
      results.push({ name: "Oracle VM", status: "offline", detail: "Unreachable", error: msg });
      results.push({ name: "Ethereum RPC", status: "offline", detail: "Oracle VM offline" });
      results.push({ name: "Solana RPC", status: "offline", detail: "Oracle VM offline" });
      results.push({ name: "Bitcoin RPC", status: "offline", detail: "Oracle VM offline" });
    }

    // 2. IntercomSwap / AFOS Signaling server (HTTPS — no CORS issue but proxy anyway for consistency)
    try {
      const t0 = Date.now();
      const resp = await fetch("https://intercomswap.io", {
        method: "HEAD",
        signal: AbortSignal.timeout(8000),
      });
      results.push({
        name: "AFOS Signaling",
        status: resp.ok || resp.status < 500 ? "live" : "degraded",
        detail: `HTTP ${resp.status}`,
        latency: `${Date.now() - t0}ms`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Timeout";
      results.push({ name: "AFOS Signaling", status: "offline", detail: "Unreachable", error: msg });
    }

    // 3. Trac Network explorer (TNK chain health)
    try {
      const t0 = Date.now();
      const resp = await fetch("https://explorer.trac.network/api/status", {
        signal: AbortSignal.timeout(8000),
      });
      const latency = `${Date.now() - t0}ms`;
      results.push({
        name: "Trac Network",
        status: resp.ok ? "live" : "degraded",
        detail: resp.ok ? `HTTP 200 · explorer reachable` : `HTTP ${resp.status}`,
        latency,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Timeout";
      results.push({ name: "Trac Network", status: "offline", detail: "Explorer unreachable", error: msg });
    }

    return results;
  }),
});
