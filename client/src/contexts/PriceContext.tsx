/**
 * PriceContext — single shared price feed for the entire app.
 *
 * Replaces the four independent getPrices() polling loops that previously
 * lived in MarketTicker, MobileMarketCard, ChainStatsBar, and RecentSwaps.
 * All components now read from one source of truth, updated every 30 seconds.
 *
 * Usage:
 *   const { prices, source, lastUpdated } = usePrices();
 *   prices.BTC?.usd   // number | undefined
 *   source            // 'loading' | 'live' | 'error'
 *   lastUpdated       // Date | null
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { getPrices, type TokenPrice } from "@/lib/afosApi";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PriceMap = Record<string, TokenPrice>;

export type PriceSource = "loading" | "live" | "error";

export interface PriceContextValue {
  /** Full price map keyed by token symbol (e.g. "BTC", "ETH", "SOL") */
  prices: PriceMap;
  /** Current data-source state */
  source: PriceSource;
  /** Timestamp of the last successful fetch */
  lastUpdated: Date | null;
  /** Latency of the last successful fetch in ms */
  latencyMs: number | null;
  /** Manually trigger an immediate refresh */
  refresh: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const PriceContext = createContext<PriceContextValue>({
  prices: {},
  source: "loading",
  lastUpdated: null,
  latencyMs: null,
  refresh: () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000;

export function PriceProvider({ children }: { children: React.ReactNode }) {
  const [prices, setPrices] = useState<PriceMap>({});
  const [source, setSource] = useState<PriceSource>("loading");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPrices = useCallback(async () => {
    try {
      const t0 = Date.now();
      const data = await getPrices();
      const elapsed = Date.now() - t0;
      setPrices(data);
      setSource("live");
      setLastUpdated(new Date());
      setLatencyMs(elapsed);
    } catch {
      // Keep the last known prices; only update source to 'error' if we've
      // never had a successful fetch yet (avoid flickering on transient errors)
      setSource(prev => (prev === "loading" ? "error" : prev === "live" ? "error" : prev));
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    fetchPrices();
    timerRef.current = setInterval(fetchPrices, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchPrices]);

  return (
    <PriceContext.Provider
      value={{ prices, source, lastUpdated, latencyMs, refresh: fetchPrices }}
    >
      {children}
    </PriceContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Access the shared live price feed.
 *
 * @example
 * const { prices, source } = usePrices();
 * const btcUsd = prices.BTC?.usd ?? null;
 */
export function usePrices(): PriceContextValue {
  return useContext(PriceContext);
}

/**
 * Convenience hook that returns the USD price for a single token symbol.
 * Returns null while loading or on error.
 *
 * @example
 * const btcPrice = useTokenPrice("BTC"); // number | null
 */
export function useTokenPrice(symbol: string): number | null {
  const { prices } = usePrices();
  return prices[symbol]?.usd ?? null;
}
