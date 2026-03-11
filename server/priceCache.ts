/**
 * Shared in-memory price cache for BTC/SOL/ETH/TNK.
 * Extracted here to avoid circular imports between routers.ts and sub-routers.
 */

type PriceSnapshot = {
  btc: number;
  sol: number;
  eth: number;
  tnk: number;
  tnkChange24h: number;
  tnkVol24h: number;
  fetchedAt: number;
};

let _priceCache: PriceSnapshot | null = null;

const FALLBACK: PriceSnapshot = {
  btc: 70000, sol: 90, eth: 2500, tnk: 0,
  tnkChange24h: 0, tnkVol24h: 0, fetchedAt: 0,
};

/** Returns the latest cached prices, or fallback values if cache is empty. */
export function getCachedPrices(): PriceSnapshot {
  return _priceCache ?? FALLBACK;
}

/** Updates the shared price cache. Called by getLandingPrices() in routers.ts. */
export function setPriceCache(snapshot: PriceSnapshot): void {
  _priceCache = snapshot;
}
