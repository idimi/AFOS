/**
 * settings router
 * Provides settings.get, settings.save, and settings.testRouteConnection
 * procedures for persisting per-user trading preferences to the database
 * and testing swap route connectivity.
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getUserSettings, upsertUserSettings } from "../db";
import { DEFAULT_USER_SETTINGS } from "../../drizzle/schema";

const preferredRouteEnum = z.enum(["intercomswap", "jupiter", "zerox", "oneinch", "best"]);
const themeEnum = z.enum(["dark", "light", "system"]);

export const settingsRouter = router({
  /**
   * Load the current user's settings.
   * Returns defaults when no row exists yet — safe to call on first load.
   */
  get: protectedProcedure.query(async ({ ctx }) => {
    const settings = await getUserSettings(ctx.user.openId);
    return {
      maxTxAmountUsd: settings.maxTxAmountUsd ?? DEFAULT_USER_SETTINGS.maxTxAmountUsd,
      autoConfirm: settings.autoConfirm ?? DEFAULT_USER_SETTINGS.autoConfirm,
      slippagePct: settings.slippagePct ?? DEFAULT_USER_SETTINGS.slippagePct,
      preferredRoute: settings.preferredRoute ?? DEFAULT_USER_SETTINGS.preferredRoute,
      theme: settings.theme ?? DEFAULT_USER_SETTINGS.theme,
      autoAcceptRfq: settings.autoAcceptRfq ?? DEFAULT_USER_SETTINGS.autoAcceptRfq,
      autoAcceptMaxUsd: settings.autoAcceptMaxUsd ?? DEFAULT_USER_SETTINGS.autoAcceptMaxUsd,
    };
  }),

  /**
   * Test connectivity to a swap route by sending a lightweight probe request.
   * Returns { ok, latencyMs, message } — public so unauthenticated users can test.
   */
  testRouteConnection: publicProcedure
    .input(z.object({ routeId: preferredRouteEnum }))
    .mutation(async ({ input }) => {
      const start = Date.now();
      const ORACLE_API = process.env.ORACLE_API_URL || "http://141.253.123.101:4000";
      const ZEROX_KEY  = process.env.ZEROX_API_KEY;

      try {
        if (input.routeId === "intercomswap" || input.routeId === "best") {
          // Test the local AFOS signaling server (no Oracle VM needed)
          const { getSignalingPeerCount } = await import("../signaling.js");
          const peerCount = getSignalingPeerCount();
          const latencyMs = Date.now() - start;
          return { ok: true, latencyMs, message: `AFOS P2P signaling server online — ${peerCount} peer${peerCount !== 1 ? "s" : ""} connected (${latencyMs}ms)` };
        }

        if (input.routeId === "jupiter") {
          // Lightweight SOL→USDC quote probe — uses the current lite-api v1 endpoint
          // (quote-api.jup.ag/v6 is deprecated and returns connection refused)
          const res = await fetch(
            "https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000&slippageBps=50",
            { signal: AbortSignal.timeout(5000) },
          );
          const latencyMs = Date.now() - start;
          if (!res.ok) return { ok: false, latencyMs, message: `Jupiter API returned HTTP ${res.status}` };
          return { ok: true, latencyMs, message: `Jupiter lite-api reachable (${latencyMs}ms)` };
        }

        if (input.routeId === "zerox") {
          if (!ZEROX_KEY) return { ok: false, latencyMs: 0, message: "ZEROX_API_KEY not configured" };
          const res = await fetch(
            "https://api.0x.org/swap/permit2/price?chainId=1&sellToken=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2&buyToken=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48&sellAmount=1000000000000000",
            { headers: { "0x-api-key": ZEROX_KEY, "0x-version": "v2" }, signal: AbortSignal.timeout(5000) },
          );
          const latencyMs = Date.now() - start;
          if (!res.ok) return { ok: false, latencyMs, message: `0x API returned HTTP ${res.status}` };
          return { ok: true, latencyMs, message: `0x Protocol API reachable (${latencyMs}ms)` };
        }

        if (input.routeId === "oneinch") {
          const oneInchKey = process.env.ONEINCH_API_KEY;
          if (!oneInchKey) return { ok: false, latencyMs: 0, message: "1inch API key not configured — add ONEINCH_API_KEY in Settings" };
          const res = await fetch(
            "https://api.1inch.dev/swap/v6.0/1/healthcheck",
            { headers: { Authorization: `Bearer ${oneInchKey}` }, signal: AbortSignal.timeout(5000) },
          );
          const latencyMs = Date.now() - start;
          if (!res.ok) return { ok: false, latencyMs, message: `1inch API returned HTTP ${res.status}` };
          return { ok: true, latencyMs, message: `1inch API reachable (${latencyMs}ms)` };
        }

        return { ok: false, latencyMs: 0, message: "Unknown route" };
      } catch (err: unknown) {
        const latencyMs = Date.now() - start;
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, latencyMs, message: msg.includes("timeout") ? "Connection timed out (>5s)" : msg };
      }
    }),

  /**
   * Save (upsert) the current user's settings.
   * Accepts a partial patch — only provided fields are written.
   */
  save: protectedProcedure
    .input(
      z.object({
        maxTxAmountUsd: z.number().int().min(1).max(1_000_000).optional(),
        autoConfirm: z.boolean().optional(),
        slippagePct: z.string().regex(/^\d+(\.\d+)?$/, "Must be a numeric string like '0.5'").optional(),
        preferredRoute: preferredRouteEnum.optional(),
        theme: themeEnum.optional(),
        autoAcceptRfq: z.boolean().optional(),
        autoAcceptMaxUsd: z.number().int().min(0).max(1_000_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await upsertUserSettings(ctx.user.openId, input);
      return getUserSettings(ctx.user.openId);
    }),
});
