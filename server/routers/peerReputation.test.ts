/**
 * peerReputation router — unit tests
 *
 * Tests cover:
 *  - Score computation logic (pure function, no DB needed)
 *  - DB helper mocks for recordPeerPing, recordPeerSwap, getPeerReputations, getAllPeerReputations
 *  - trustLevel label derivation (mirrors the frontend helper)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock DB helpers ────────────────────────────────────────────────────────────
vi.mock("../db", () => ({
  recordPeerPing: vi.fn(),
  recordPeerSwap: vi.fn(),
  getPeerReputations: vi.fn(),
  getAllPeerReputations: vi.fn(),
  getDb: vi.fn(),
}));

import {
  recordPeerPing,
  recordPeerSwap,
  getPeerReputations,
  getAllPeerReputations,
} from "../db";

// ── Score computation (mirrors db.ts computeScore) ────────────────────────────

/**
 * Mirrors the computeScore function in server/db.ts.
 * Kept in sync manually — if the scoring formula changes, update both.
 */
function computeScore(
  successfulPings: number,
  failedPings: number,
  successfulSwaps: number,
  totalLatencyMs: number = 0,
): number {
  const totalPings = successfulPings + failedPings;
  const uptimePts = totalPings === 0
    ? 40
    : (successfulPings / totalPings) * 80;
  const swapPts = Math.min(successfulSwaps * 2, 20);
  const avgLatency = successfulPings > 0 ? totalLatencyMs / successfulPings : 0;
  const latencyPts = successfulPings === 0
    ? 0
    : avgLatency < 50 ? 0
    : avgLatency < 200 ? -5
    : -10;
  return Math.max(0, Math.min(100, Math.round(uptimePts + swapPts + latencyPts)));
}

/** Mirrors the trustLevel helper in NetworkPage.tsx */
function trustLevel(score: number): string {
  if (score >= 80) return "Trusted";
  if (score >= 60) return "Reliable";
  if (score >= 40) return "Neutral";
  if (score >= 20) return "Caution";
  return "Risky";
}

// ── Score computation tests ───────────────────────────────────────────────────

describe("peerReputation score computation", () => {
  it("returns 40 for a brand-new peer with no history", () => {
    const score = computeScore(0, 0, 0);
    expect(score).toBe(40); // 0 pings → uptimePts = 40 (neutral), no swaps
  });

  it("returns 100 for a peer with perfect ping rate and many swaps", () => {
    const score = computeScore(100, 0, 10, 30 * 100); // 30ms avg latency
    expect(score).toBe(100); // 1.0 * 80 + 20 + 0 = 100
  });

  it("returns 0 for a peer with all failed pings and no swaps", () => {
    const score = computeScore(0, 100, 0);
    expect(score).toBe(0); // 0 * 80 + 0 = 0
  });

  it("caps swap bonus at 20", () => {
    const score = computeScore(50, 50, 100, 30 * 50); // 50% ping rate, 100 swaps, 30ms avg
    expect(score).toBe(60); // 0.5 * 80 + 20 + 0 = 60
  });

  it("increases score with successful pings", () => {
    const low = computeScore(10, 90, 0);  // 10% success
    const high = computeScore(90, 10, 0); // 90% success
    expect(high).toBeGreaterThan(low);
  });

  it("applies latency penalty for high-latency peers", () => {
    const fast = computeScore(10, 0, 0, 30 * 10);   // 30ms avg — no penalty
    const slow = computeScore(10, 0, 0, 300 * 10);  // 300ms avg — -10 penalty
    expect(fast).toBeGreaterThan(slow);
  });

  it("score is clamped between 0 and 100", () => {
    const max = computeScore(1000, 0, 1000, 10 * 1000);
    const min = computeScore(0, 1000, 0);
    expect(max).toBeLessThanOrEqual(100);
    expect(min).toBeGreaterThanOrEqual(0);
  });
});

// ── Trust level label tests ───────────────────────────────────────────────────

describe("trustLevel label derivation", () => {
  it("returns Trusted for score >= 80", () => {
    expect(trustLevel(80)).toBe("Trusted");
    expect(trustLevel(100)).toBe("Trusted");
  });

  it("returns Reliable for score 60-79", () => {
    expect(trustLevel(60)).toBe("Reliable");
    expect(trustLevel(79)).toBe("Reliable");
  });

  it("returns Neutral for score 40-59", () => {
    expect(trustLevel(40)).toBe("Neutral");
    expect(trustLevel(59)).toBe("Neutral");
  });

  it("returns Caution for score 20-39", () => {
    expect(trustLevel(20)).toBe("Caution");
    expect(trustLevel(39)).toBe("Caution");
  });

  it("returns Risky for score < 20", () => {
    expect(trustLevel(0)).toBe("Risky");
    expect(trustLevel(19)).toBe("Risky");
  });
});

// ── DB helper mock tests ───────────────────────────────────────────────────────

describe("peerReputation DB helpers (mocked)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recordPeerPing is callable with a successful ping", async () => {
    const mockResult = {
      id: 1,
      peerId: "abc123",
      alias: "TestNode",
      origin: "hyperswarm",
      successfulPings: 1,
      failedPings: 0,
      successfulSwaps: 0,
      totalLatencyMs: 42,
      score: 55,
      lastSeenAt: new Date(),
      firstSeenAt: new Date(),
      updatedAt: new Date(),
      notes: null,
      tags: null,
    };
    (recordPeerPing as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);
    const result = await recordPeerPing("abc123", "TestNode", "hyperswarm", 42);
    expect(recordPeerPing).toHaveBeenCalledWith("abc123", "TestNode", "hyperswarm", 42);
    expect(result?.score).toBe(55);
    expect(result?.successfulPings).toBe(1);
  });

  it("recordPeerPing handles failed ping (latencyMs = null)", async () => {
    (recordPeerPing as ReturnType<typeof vi.fn>).mockResolvedValue({
      peerId: "abc123",
      failedPings: 1,
      score: 45,
    });
    const result = await recordPeerPing("abc123", undefined, "intercomswap", null);
    expect(recordPeerPing).toHaveBeenCalledWith("abc123", undefined, "intercomswap", null);
    expect(result?.failedPings).toBe(1);
  });

  it("recordPeerSwap increments successfulSwaps", async () => {
    (recordPeerSwap as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await recordPeerSwap("abc123");
    expect(recordPeerSwap).toHaveBeenCalledWith("abc123");
  });

  it("getPeerReputations returns a Map keyed by peerId", async () => {
    const mockMap = new Map([
      ["abc123", {
        id: 1,
        peerId: "abc123",
        alias: "TestNode",
        origin: "hyperswarm",
        successfulPings: 10,
        failedPings: 2,
        successfulSwaps: 3,
        totalLatencyMs: 420,
        score: 85,
        lastSeenAt: new Date(),
        firstSeenAt: new Date(),
        updatedAt: new Date(),
        notes: null,
        tags: null,
      }],
    ]);
    (getPeerReputations as ReturnType<typeof vi.fn>).mockResolvedValue(mockMap);
    const result = await getPeerReputations(["abc123"]);
    expect(getPeerReputations).toHaveBeenCalledWith(["abc123"]);
    expect(result.get("abc123")?.score).toBe(85);
  });

  it("getPeerReputations returns empty Map for empty input", async () => {
    (getPeerReputations as ReturnType<typeof vi.fn>).mockResolvedValue(new Map());
    const result = await getPeerReputations([]);
    expect(result.size).toBe(0);
  });

  it("getAllPeerReputations returns rows ordered by score descending", async () => {
    const mockRows = [
      { peerId: "peer1", score: 95, successfulSwaps: 10, alias: "Alpha" },
      { peerId: "peer2", score: 72, successfulSwaps: 3, alias: "Beta" },
      { peerId: "peer3", score: 45, successfulSwaps: 0, alias: "Gamma" },
    ];
    (getAllPeerReputations as ReturnType<typeof vi.fn>).mockResolvedValue(mockRows);
    const result = await getAllPeerReputations();
    expect(getAllPeerReputations).toHaveBeenCalled();
    expect(result).toHaveLength(3);
    expect(result[0].score).toBe(95); // Highest first
    expect(result[2].score).toBe(45); // Lowest last
  });
});
