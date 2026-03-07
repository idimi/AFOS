/**
 * usePairDepth — Aggregates advertised LP liquidity depth per swap pair.
 *
 * Each online LP peer advertises their `maxTradeUsd` when registering with the
 * signaling server. This hook sums those values across all peers that accept a
 * given pair (or its reverse), giving an estimated available depth in USD.
 *
 * Usage:
 *   const depthMap = usePairDepth(signalingPeers);
 *   const depth = depthMap["SOL/USDT"]; // e.g. 42000
 */

import { useMemo } from "react";

interface PeerEntry {
  peerId: string;
  pairs: string[];
  maxTradeUsd?: number | null;
  lastHeartbeat?: number | null;
}

/**
 * Returns a map of pairKey → total advertised depth in USD.
 * pairKey is always in "FROM/TO" canonical form (upper-case).
 */
export function usePairDepth(peers: PeerEntry[] | undefined): Record<string, number> {
  return useMemo(() => {
    if (!peers || peers.length === 0) return {};

    const depthMap: Record<string, number> = {};
    const now = Date.now();
    const STALE_MS = 90_000; // ignore peers whose heartbeat is >90s old

    for (const peer of peers) {
      // Skip stale peers
      if (peer.lastHeartbeat && now - peer.lastHeartbeat > STALE_MS) continue;
      const contribution = peer.maxTradeUsd ?? 0;
      if (contribution <= 0) continue;

      for (const pair of peer.pairs) {
        const canonical = pair.toUpperCase();
        depthMap[canonical] = (depthMap[canonical] ?? 0) + contribution;

        // Also credit the reverse pair (e.g. SOL/USDT ↔ USDT/SOL)
        const [a, b] = canonical.split("/");
        if (a && b) {
          const reverse = `${b}/${a}`;
          depthMap[reverse] = (depthMap[reverse] ?? 0) + contribution;
        }
      }
    }

    return depthMap;
  }, [peers]);
}

/**
 * Format a USD depth value as a human-readable badge label.
 * e.g. 42000 → "~$42k"  |  1500000 → "~$1.5M"  |  0 → null
 */
export function formatDepth(usd: number | undefined): string | null {
  if (!usd || usd <= 0) return null;
  if (usd >= 1_000_000) return `~$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000)     return `~$${Math.round(usd / 1_000)}k`;
  return `~$${Math.round(usd)}`;
}

/**
 * Returns a color class based on depth tier.
 * Green = deep (>$50k), yellow = moderate ($5k–$50k), red = shallow (<$5k).
 */
export function depthColor(usd: number | undefined): string {
  if (!usd || usd <= 0) return "#64748b"; // slate — no data
  if (usd >= 50_000)    return "#10b981"; // emerald — deep
  if (usd >= 5_000)     return "#f59e0b"; // amber — moderate
  return "#ef4444";                        // red — shallow
}
