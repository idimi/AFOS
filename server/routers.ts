import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { chatRouter } from "./routers/chat";
import { btcHtlcRouter } from "./routers/btcHtlc";
import { pathFinderRouter } from "./pathFinder";
import { analyticsRouter } from "./routers/analytics";
import { htlcWalletRouter } from "./routers/htlcWallet";
import { setPriceCache } from "./priceCache";
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

// ─── In-memory price cache (BTC/SOL/ETH from CoinGecko + TNK from Gate.io) ───
let _priceCache: {
  btc: number;
  sol: number;
  eth: number;
  tnk: number;
  tnkChange24h: number;
  tnkVol24h: number;
  fetchedAt: number;
} | null = null;

/** Fetch TNK/USDT price from Gate.io (primary) with MEXC as fallback. */
async function getTnkPrice(): Promise<{ usd: number; change24h: number; vol24h: number }> {
  // Primary: Gate.io — no rate limits, no CORS issues server-side
  try {
    const res = await fetch(
      "https://api.gateio.ws/api/v4/spot/tickers?currency_pair=TNK_USDT",
      { signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) {
      const data = await res.json() as Array<{
        last: string;
        change_percentage: string;
        quote_volume: string;
      }>;
      if (data[0]?.last) {
        return {
          usd: parseFloat(data[0].last),
          change24h: parseFloat(data[0].change_percentage ?? "0"),
          vol24h: parseFloat(data[0].quote_volume ?? "0"),
        };
      }
    }
  } catch { /* fall through to MEXC */ }

  // Fallback: MEXC
  try {
    const res = await fetch(
      "https://api.mexc.com/api/v3/ticker/24hr?symbol=TNKUSDT",
      { signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) {
      const data = await res.json() as {
        lastPrice: string;
        priceChangePercent: string;
        quoteVolume: string;
      };
      if (data.lastPrice) {
        return {
          usd: parseFloat(data.lastPrice),
          change24h: parseFloat(data.priceChangePercent ?? "0") * 100,
          vol24h: parseFloat(data.quoteVolume ?? "0"),
        };
      }
    }
  } catch { /* fall through to default */ }

  return { usd: 0, change24h: 0, vol24h: 0 };
}

export async function getLandingPrices() {
  if (_priceCache && Date.now() - _priceCache.fetchedAt < 30_000) return _priceCache;
  try {
    // Fetch BTC/SOL/ETH from CoinGecko and TNK from Gate.io in parallel
    const [mainRes, tnkData] = await Promise.allSettled([
      fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,solana,ethereum&vs_currencies=usd",
        { signal: AbortSignal.timeout(5000) }
      ),
      getTnkPrice(),
    ]);

    // Use stale cache values as fallback for BTC/SOL/ETH
    let btc = _priceCache?.btc ?? 70000;
    let sol = _priceCache?.sol ?? 90;
    let eth = _priceCache?.eth ?? 2500;

    if (mainRes.status === "fulfilled" && mainRes.value.ok) {
      const data = await mainRes.value.json() as {
        bitcoin?: { usd: number };
        solana?: { usd: number };
        ethereum?: { usd: number };
      };
      // Guard against zero/missing prices (CoinGecko rate-limit responses can return partial data)
      if (data.bitcoin?.usd && data.bitcoin.usd > 0) btc = data.bitcoin.usd;
      if (data.solana?.usd && data.solana.usd > 0) sol = data.solana.usd;
      if (data.ethereum?.usd && data.ethereum.usd > 0) eth = data.ethereum.usd;
    }

    const tnk = tnkData.status === "fulfilled"
      ? tnkData.value
      : { usd: _priceCache?.tnk ?? 0, change24h: _priceCache?.tnkChange24h ?? 0, vol24h: _priceCache?.tnkVol24h ?? 0 };

    _priceCache = {
      btc, sol, eth,
      tnk: tnk.usd,
      tnkChange24h: tnk.change24h,
      tnkVol24h: tnk.vol24h,
      fetchedAt: Date.now(),
    };
    setPriceCache(_priceCache);
    return _priceCache;
  } catch {
    // Return stale cache or sensible fallback
    return _priceCache ?? { btc: 70000, sol: 90, eth: 2500, tnk: 0, tnkChange24h: 0, tnkVol24h: 0, fetchedAt: 0 };
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
        tnkPrice: p.tnk,
        tnkChange24h: p.tnkChange24h,
        tnkVol24h: p.tnkVol24h,
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
