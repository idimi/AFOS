/**
 * usePeerReputation — Tracks per-peer reputation from P2P network events.
 *
 * Reputation is computed from:
 *  - Trades completed vs quotes given (fill rate)
 *  - Time on network (longevity bonus)
 *  - Response latency (lower = better)
 *
 * Tiers:
 *  - New:     0–9 trades  (grey)
 *  - Trusted: 10–49 trades (blue)
 *  - Elite:   50+ trades  (gold)
 *
 * Data is persisted in localStorage so reputation accumulates across sessions.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { onSSEEvent } from "../lib/afosApi";

export type ReputationTier = "new" | "trusted" | "elite";

export interface PeerRecord {
  peerId: string;
  alias?: string;
  quotesGiven: number;
  tradesCompleted: number;
  firstSeen: number;   // unix ms
  lastSeen: number;    // unix ms
  avgLatencyMs: number;
  peerType?: "light" | "full";
}

export interface PeerReputation {
  score: number;          // 0–100
  tier: ReputationTier;
  tierLabel: string;
  tierColor: string;      // Tailwind text color class
  tierBg: string;         // Tailwind bg color class
  fillRate: number;       // tradesCompleted / quotesGiven (0–1)
  daysActive: number;
  record: PeerRecord;
}

const STORAGE_KEY = "afos_peer_reputation";
const MAX_PEERS = 500;

function loadRecords(): Record<string, PeerRecord> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveRecords(records: Record<string, PeerRecord>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch { /* storage full — ignore */ }
}

function computeReputation(record: PeerRecord): PeerReputation {
  const fillRate = record.quotesGiven > 0
    ? Math.min(record.tradesCompleted / record.quotesGiven, 1)
    : 0;

  const daysActive = Math.max(
    (Date.now() - record.firstSeen) / (1000 * 60 * 60 * 24),
    0,
  );

  // Score components (0–100)
  const fillScore = fillRate * 40;                                    // 40 pts max
  const volumeScore = Math.min(record.tradesCompleted / 100, 1) * 30; // 30 pts max
  const longevityScore = Math.min(daysActive / 30, 1) * 20;          // 20 pts max
  const latencyScore = record.avgLatencyMs > 0
    ? Math.max(0, (1 - record.avgLatencyMs / 500)) * 10              // 10 pts max
    : 5;

  const score = Math.round(fillScore + volumeScore + longevityScore + latencyScore);

  let tier: ReputationTier;
  let tierLabel: string;
  let tierColor: string;
  let tierBg: string;

  if (record.tradesCompleted >= 50) {
    tier = "elite";
    tierLabel = "Elite";
    tierColor = "text-amber-400";
    tierBg = "bg-amber-400/15";
  } else if (record.tradesCompleted >= 10) {
    tier = "trusted";
    tierLabel = "Trusted";
    tierColor = "text-blue-400";
    tierBg = "bg-blue-400/15";
  } else {
    tier = "new";
    tierLabel = "New";
    tierColor = "text-slate-400";
    tierBg = "bg-slate-400/15";
  }

  return { score, tier, tierLabel, tierColor, tierBg, fillRate, daysActive, record };
}

export function usePeerReputation() {
  const [records, setRecords] = useState<Record<string, PeerRecord>>(loadRecords);
  const recordsRef = useRef(records);
  recordsRef.current = records;

  // ── Persist on change ─────────────────────────────────────────────────────
  useEffect(() => {
    saveRecords(records);
  }, [records]);

  // ── Update a peer record ──────────────────────────────────────────────────
  const upsertPeer = useCallback((
    peerId: string,
    update: Partial<Omit<PeerRecord, "peerId" | "firstSeen">> & { alias?: string; latencyMs?: number },
  ) => {
    setRecords(prev => {
      const existing = prev[peerId] ?? {
        peerId,
        quotesGiven: 0,
        tradesCompleted: 0,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        avgLatencyMs: 0,
        peerType: "full" as const,
      };

      const next: PeerRecord = {
        ...existing,
        ...update,
        lastSeen: Date.now(),
        // Rolling average latency
        avgLatencyMs: update.latencyMs != null
          ? existing.avgLatencyMs === 0
            ? update.latencyMs
            : Math.round((existing.avgLatencyMs * 0.8) + (update.latencyMs * 0.2))
          : existing.avgLatencyMs,
      };

      // Prune oldest peers if over limit
      const updated = { ...prev, [peerId]: next };
      const keys = Object.keys(updated);
      if (keys.length > MAX_PEERS) {
        const sorted = keys.sort((a, b) => updated[a].lastSeen - updated[b].lastSeen);
        delete updated[sorted[0]];
      }

      return updated;
    });
  }, []);

  // ── Listen to SSE events to update reputation ─────────────────────────────
  useEffect(() => {
    // Quote events — peer responded to an RFQ
    const unsubQuote = onSSEEvent("p2p_quote", (data: unknown) => {
      const d = data as { peerId?: string; alias?: string; latencyMs?: number; peerType?: "light" | "full" };
      if (!d?.peerId) return;
      upsertPeer(d.peerId, {
        alias: d.alias,
        quotesGiven: (recordsRef.current[d.peerId]?.quotesGiven ?? 0) + 1,
        latencyMs: d.latencyMs,
        peerType: d.peerType,
      });
    });

    // Swap executed — trade completed
    const unsubSwap = onSSEEvent("swap_executed", (data: unknown) => {
      const d = data as { peerId?: string; counterpartyPeer?: string };
      if (d?.peerId) {
        upsertPeer(d.peerId, {
          tradesCompleted: (recordsRef.current[d.peerId]?.tradesCompleted ?? 0) + 1,
        });
      }
      if (d?.counterpartyPeer) {
        upsertPeer(d.counterpartyPeer, {
          tradesCompleted: (recordsRef.current[d.counterpartyPeer]?.tradesCompleted ?? 0) + 1,
        });
      }
    });

    // Track peers from incoming RFQs (they announced themselves)
    const unsubRfq = onSSEEvent("p2p_rfq", (data: unknown) => {
      const d = data as { peerId?: string; alias?: string; peerType?: "light" | "full" };
      if (!d?.peerId) return;
      upsertPeer(d.peerId, { alias: d.alias, peerType: d.peerType });
    });

    // Track peers who accepted quotes
    const unsubAccept = onSSEEvent("p2p_quote_accept", (data: unknown) => {
      const d = data as { peerId?: string; alias?: string };
      if (!d?.peerId) return;
      upsertPeer(d.peerId, {
        tradesCompleted: (recordsRef.current[d.peerId]?.tradesCompleted ?? 0) + 1,
        alias: d.alias,
      });
    });

    return () => {
      unsubQuote();
      unsubSwap();
      unsubRfq();
      unsubAccept();
    };
  }, [upsertPeer]);

  // ── Public API ────────────────────────────────────────────────────────────

  const getReputation = useCallback((peerId: string): PeerReputation => {
    const record = records[peerId] ?? {
      peerId,
      quotesGiven: 0,
      tradesCompleted: 0,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      avgLatencyMs: 0,
    };
    return computeReputation(record);
  }, [records]);

  const recordQuote = useCallback((peerId: string, latencyMs?: number, alias?: string) => {
    upsertPeer(peerId, {
      quotesGiven: (recordsRef.current[peerId]?.quotesGiven ?? 0) + 1,
      latencyMs,
      alias,
    });
  }, [upsertPeer]);

  const recordTrade = useCallback((peerId: string) => {
    upsertPeer(peerId, {
      tradesCompleted: (recordsRef.current[peerId]?.tradesCompleted ?? 0) + 1,
    });
  }, [upsertPeer]);

  const allPeers = Object.values(records)
    .map(computeReputation)
    .sort((a, b) => b.score - a.score);

  return { getReputation, recordQuote, recordTrade, allPeers, records };
}
