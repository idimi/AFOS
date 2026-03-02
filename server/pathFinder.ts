/**
 * Cross-Chain Swap Path Finder
 *
 * Finds multi-hop routes when no direct P2P peer exists for a requested pair.
 * Example: BTC → SOL with no direct peer → BTC → USDT → SOL (two hops)
 *
 * Algorithm:
 *   1. Check direct route (fromToken → toToken on respective chains)
 *   2. If no direct peer, try bridge tokens: USDT, USDC
 *   3. Build a hop graph and find shortest path with max 3 hops
 *   4. Return ordered array of SwapHop objects with estimated rates
 *
 * Each hop follows the same P2P-first pattern:
 *   IntercomSwap P2P → chain aggregator fallback
 */

import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SwapHop {
  /** Hop index (0-based) */
  hopIndex:   number;
  /** Source token for this hop */
  fromToken:  string;
  /** Source chain for this hop */
  fromChain:  "bitcoin" | "ethereum" | "solana";
  /** Destination token for this hop */
  toToken:    string;
  /** Destination chain for this hop */
  toChain:    "bitcoin" | "ethereum" | "solana";
  /** Estimated rate for this hop (toAmount / fromAmount) */
  estimatedRate: number;
  /** Execution procedure to call for this hop */
  procedure:  "buildSwapTx" | "executeEthSwap" | "executeBtcSwap";
  /** Whether this hop has an active P2P peer (from Oracle RFQ) */
  hasPeer:    boolean;
  /** Peer ID if P2P peer found */
  peerId?:    string;
}

export interface PathFinderResult {
  /** Whether a valid route was found */
  found:       boolean;
  /** Total number of hops */
  hopCount:    number;
  /** Ordered list of hops to execute */
  hops:        SwapHop[];
  /** Estimated final output amount (after all hops) */
  estimatedOut: number;
  /** Total estimated slippage across all hops (%) */
  totalSlippage: number;
  /** Human-readable route description */
  routeDescription: string;
  /** Warning if route has high slippage or many hops */
  warning?:    string;
}

// ─── Bridge tokens (used as intermediate hops) ───────────────────────────────

const BRIDGE_TOKENS = [
  { symbol: "USDT", chain: "solana"   as const },
  { symbol: "USDT", chain: "ethereum" as const },
  { symbol: "USDC", chain: "solana"   as const },
  { symbol: "USDC", chain: "ethereum" as const },
];

// ─── Supported direct pairs per chain ────────────────────────────────────────
// Pairs that can be swapped without an intermediate hop.

const DIRECT_PAIRS: Record<string, string[]> = {
  "SOL/solana":    ["USDT/solana", "USDC/solana"],
  "USDT/solana":   ["SOL/solana", "USDC/solana"],
  "USDC/solana":   ["SOL/solana", "USDT/solana"],
  "ETH/ethereum":  ["USDT/ethereum", "USDC/ethereum"],
  "USDT/ethereum": ["ETH/ethereum", "USDC/ethereum"],
  "USDC/ethereum": ["ETH/ethereum", "USDT/ethereum"],
  "BTC/bitcoin":   ["USDT/solana", "USDT/ethereum", "SOL/solana", "ETH/ethereum"],
};

function tokenKey(symbol: string, chain: string): string {
  return `${symbol}/${chain}`;
}

function getProcedure(fromChain: "bitcoin" | "ethereum" | "solana"): SwapHop["procedure"] {
  if (fromChain === "bitcoin")  return "executeBtcSwap";
  if (fromChain === "ethereum") return "executeEthSwap";
  return "buildSwapTx";
}

// ─── Oracle RFQ check ─────────────────────────────────────────────────────────

const ORACLE_API = process.env.ORACLE_API_URL || "http://141.253.123.101:4000";

interface OraclePeer {
  peerId:             string;
  counterpartyPubKey: string;
  rate:               number;
  outAmount:          number;
}

async function checkP2PPeer(
  fromToken: string,
  toToken:   string,
  fromChain: string,
  toChain:   string,
  amount:    number
): Promise<OraclePeer | null> {
  try {
    const res = await fetch(`${ORACLE_API}/api/rfq`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ fromToken, toToken, amount, fromChain, toChain }),
      signal:  AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { success: boolean; result?: OraclePeer };
    if (!data.success || !data.result?.peerId) return null;
    return data.result;
  } catch {
    return null;
  }
}

// ─── Price estimator ─────────────────────────────────────────────────────────

const PRICE_ESTIMATES: Record<string, number> = {
  BTC:  66000,
  ETH:  1950,
  SOL:  85,
  USDT: 1,
  USDC: 1,
};

function estimateRate(fromToken: string, toToken: string): number {
  const fromPrice = PRICE_ESTIMATES[fromToken] ?? 1;
  const toPrice   = PRICE_ESTIMATES[toToken]   ?? 1;
  return fromPrice / toPrice;
}

// ─── Path finder ─────────────────────────────────────────────────────────────

export async function findSwapPath(
  fromToken:  string,
  fromChain:  "bitcoin" | "ethereum" | "solana",
  toToken:    string,
  toChain:    "bitcoin" | "ethereum" | "solana",
  amount:     number
): Promise<PathFinderResult> {
  const fromKey = tokenKey(fromToken, fromChain);
  const toKey   = tokenKey(toToken,   toChain);

  // ── 1. Check direct route ──────────────────────────────────────────────────
  const directPairs = DIRECT_PAIRS[fromKey] ?? [];
  const directPossible = directPairs.includes(toKey) || fromChain !== toChain;

  if (directPossible) {
    const peer = await checkP2PPeer(fromToken, toToken, fromChain, toChain, amount);
    const rate = peer?.rate ?? estimateRate(fromToken, toToken);
    const hop: SwapHop = {
      hopIndex:      0,
      fromToken,
      fromChain,
      toToken,
      toChain,
      estimatedRate: rate,
      procedure:     getProcedure(fromChain),
      hasPeer:       !!peer,
      peerId:        peer?.peerId,
    };
    return {
      found:            true,
      hopCount:         1,
      hops:             [hop],
      estimatedOut:     amount * rate,
      totalSlippage:    0.15,
      routeDescription: `${fromToken} (${fromChain}) → ${toToken} (${toChain})${peer ? " via IntercomSwap P2P" : " via aggregator"}`,
    };
  }

  // ── 2. Try 2-hop routes via bridge tokens ─────────────────────────────────
  for (const bridge of BRIDGE_TOKENS) {
    const bridgeKey = tokenKey(bridge.symbol, bridge.chain);

    // Check if fromToken → bridge is possible
    const fromPairs  = DIRECT_PAIRS[fromKey]   ?? [];
    const bridgePairs = DIRECT_PAIRS[bridgeKey] ?? [];

    const canHop1 = fromPairs.includes(bridgeKey) || fromChain !== bridge.chain;
    const canHop2 = bridgePairs.includes(toKey)   || bridge.chain !== toChain;

    if (!canHop1 || !canHop2) continue;

    // Check P2P availability for both hops in parallel
    const [peer1, peer2] = await Promise.all([
      checkP2PPeer(fromToken, bridge.symbol, fromChain, bridge.chain, amount),
      checkP2PPeer(bridge.symbol, toToken, bridge.chain, toChain, amount * estimateRate(fromToken, bridge.symbol)),
    ]);

    const rate1 = peer1?.rate ?? estimateRate(fromToken, bridge.symbol);
    const rate2 = peer2?.rate ?? estimateRate(bridge.symbol, toToken);
    const midAmount = amount * rate1;

    const hop1: SwapHop = {
      hopIndex:      0,
      fromToken,
      fromChain,
      toToken:       bridge.symbol,
      toChain:       bridge.chain,
      estimatedRate: rate1,
      procedure:     getProcedure(fromChain),
      hasPeer:       !!peer1,
      peerId:        peer1?.peerId,
    };

    const hop2: SwapHop = {
      hopIndex:      1,
      fromToken:     bridge.symbol,
      fromChain:     bridge.chain,
      toToken,
      toChain,
      estimatedRate: rate2,
      procedure:     getProcedure(bridge.chain),
      hasPeer:       !!peer2,
      peerId:        peer2?.peerId,
    };

    const estimatedOut = midAmount * rate2;
    const totalSlippage = 0.3; // 2-hop slippage estimate

    return {
      found:            true,
      hopCount:         2,
      hops:             [hop1, hop2],
      estimatedOut,
      totalSlippage,
      routeDescription:
        `${fromToken} (${fromChain}) → ${bridge.symbol} (${bridge.chain}) → ${toToken} (${toChain})`,
      warning:
        totalSlippage > 0.5
          ? "Multi-hop route has higher slippage. Consider splitting into separate swaps."
          : undefined,
    };
  }

  // ── 3. No route found ─────────────────────────────────────────────────────
  return {
    found:            false,
    hopCount:         0,
    hops:             [],
    estimatedOut:     0,
    totalSlippage:    0,
    routeDescription: `No route found for ${fromToken} (${fromChain}) → ${toToken} (${toChain})`,
    warning:
      "No direct or 2-hop route available. Try swapping to a bridge token (USDT/USDC) first.",
  };
}

// ─── tRPC Router ─────────────────────────────────────────────────────────────

export const pathFinderRouter = router({
  /**
   * Find the optimal swap path for a given token pair.
   * Returns a direct route (1 hop) or multi-hop route (2+ hops) via bridge tokens.
   * Each hop specifies which execution procedure to call and whether a P2P peer is available.
   */
  findSwapPath: publicProcedure
    .input(
      z.object({
        fromToken:  z.string(),
        fromChain:  z.enum(["bitcoin", "ethereum", "solana"]),
        toToken:    z.string(),
        toChain:    z.enum(["bitcoin", "ethereum", "solana"]),
        amount:     z.number().positive(),
      })
    )
    .query(async ({ input }) => {
      const { fromToken, fromChain, toToken, toChain, amount } = input;
      return findSwapPath(fromToken, fromChain, toToken, toChain, amount);
    }),

  /**
   * Get all supported direct trading pairs.
   * Useful for the UI to show which pairs can be swapped directly vs multi-hop.
   */
  getSupportedPairs: publicProcedure
    .query(() => {
      return Object.entries(DIRECT_PAIRS).map(([from, tos]) => ({
        from,
        to: tos,
      }));
    }),
});
