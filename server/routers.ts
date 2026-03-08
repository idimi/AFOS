import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { chatRouter } from "./routers/chat";
import { btcHtlcRouter } from "./routers/btcHtlc";
import { pathFinderRouter } from "./pathFinder";
import { analyticsRouter } from "./routers/analytics";
import { htlcWalletRouter } from "./routers/htlcWallet";
import { peerReputationRouter } from "./routers/peerReputation";
import { peerMessagesRouter } from "./routers/peerMessages";
import { peerBlocksRouter } from "./routers/peerBlocks";
import { peerReportsRouter } from "./routers/peerReports";
import { peerMutesRouter } from "./routers/peerMutes";
import { settingsRouter } from "./routers/settings";
import { adminConfigRouter } from "./routers/adminConfig";
import { operatorConfigRouter } from "./routers/operatorConfig";
import { historyRouter } from "./routers/history";
import { nodeHealthRouter } from "./routers/nodeHealth";

// ─── Simple in-memory price cache for the landing page swap card ──────────────
let _priceCache: { btc: number; sol: number; eth: number; fetchedAt: number } | null = null;

async function getLandingPrices() {
  if (_priceCache && Date.now() - _priceCache.fetchedAt < 30_000) return _priceCache;
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,solana,ethereum&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) throw new Error("CoinGecko error");
    const data = await res.json() as {
      bitcoin: { usd: number };
      solana: { usd: number };
      ethereum: { usd: number };
    };
    _priceCache = {
      btc: data.bitcoin.usd,
      sol: data.solana.usd,
      eth: data.ethereum.usd,
      fetchedAt: Date.now(),
    };
    return _priceCache;
  } catch {
    // Return stale cache or sensible fallback
    return _priceCache ?? { btc: 70000, sol: 90, eth: 2500, fetchedAt: 0 };
  }
}

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts,
  // all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  chat: chatRouter,
  btcHtlc: btcHtlcRouter,
  pathFinder: pathFinderRouter,
  analytics: analyticsRouter,
  htlcWallet: htlcWalletRouter,
  peerReputation: peerReputationRouter,
  peerMessages: peerMessagesRouter,
  peerBlocks: peerBlocksRouter,
  peerReports: peerReportsRouter,
  peerMutes: peerMutesRouter,
  settings: settingsRouter,
  adminConfig: adminConfigRouter,
  operatorConfig: operatorConfigRouter,
  history: historyRouter,
  nodeHealth: nodeHealthRouter,

  // Public price feed — used by the landing page live swap card (no auth required)
  prices: router({
    live: publicProcedure.query(async () => {
      const p = await getLandingPrices();
      const btcAmount = 0.1;
      const btcUsd = btcAmount * p.btc;
      const fee = btcUsd * 0.0015; // 0.15% platform fee
      const solAmount = (btcUsd - fee) / p.sol;
      return {
        btcPrice: p.btc,
        solPrice: p.sol,
        ethPrice: p.eth,
        btcAmount,
        solAmount: Math.round(solAmount * 100) / 100,
        btcUsd: Math.round(btcUsd),
        solUsd: Math.round(btcUsd - fee),
        feeUsd: Math.round(fee * 100) / 100,
        feePercent: 0.15,
        fetchedAt: p.fetchedAt,
      };
    }),
  }),

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
});

export type AppRouter = typeof appRouter;
