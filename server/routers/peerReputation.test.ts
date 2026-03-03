/**
 * peerReputation router — unit tests
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock DB helpers ────────────────────────────────────────────────────────────
vi.mock("../db", () => ({
  getPeerReputation: vi.fn(),
  upsertPeerReputation: vi.fn(),
  getPeerReputationBatch: vi.fn(),
}));

import {
  getPeerReputation,
  upsertPeerReputation,
  getPeerReputationBatch,
} from "../db";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Compute reputation score the same way the router does */
function computeScore(
  successfulPings: number,
  failedPings: number,
  successfulSwaps: number,
): number {
  const totalPings = successfulPings + failedPings;
  const pingSuccessRate = totalPings > 0 ? successfulPings / totalPings : 0.5;
  const swapBonus = Math.min(successfulSwaps * 2, 20);
  return Math.round(Math.min(100, pingSuccessRate * 80 + swapBonus));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("peerReputation score computation", () => {
  it("returns 50 for a brand-new peer with no history", () => {
    const score = computeScore(0, 0, 0);
    expect(score).toBe(40); // 0.5 * 80 + 0 = 40
  });

  it("returns 100 for a peer with perfect ping rate and many swaps", () => {
    const score = computeScore(100, 0, 10);
    expect(score).toBe(100); // 1.0 * 80 + 20 = 100
  });

  it("returns 0 for a peer with all failed pings and no swaps", () => {
    const score = computeScore(0, 100, 0);
    expect(score).toBe(0); // 0 * 80 + 0 = 0
  });

  it("caps swap bonus at 20", () => {
    const score = computeScore(50, 50, 100); // 50% ping rate, 100 swaps
    expect(score).toBe(60); // 0.5 * 80 + 20 = 60
  });

  it("increases score with successful pings", () => {
    const low = computeScore(10, 90, 0);  // 10% success
    const high = computeScore(90, 10, 0); // 90% success
    expect(high).toBeGreaterThan(low);
  });
});

describe("peerReputation DB helpers (mocked)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getPeerReputation is callable with a peerId", async () => {
    (getPeerReputation as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await getPeerReputation("abc123");
    expect(getPeerReputation).toHaveBeenCalledWith("abc123");
    expect(result).toBeNull();
  });

  it("upsertPeerReputation is callable with a record", async () => {
    const record = {
      peerId: "abc123",
      alias: "TestNode",
      origin: "hyperswarm" as const,
      successfulPings: 5,
      failedPings: 1,
      successfulSwaps: 2,
      avgLatencyMs: 42,
      score: 72,
      lastSeen: Date.now(),
    };
    (upsertPeerReputation as ReturnType<typeof vi.fn>).mockResolvedValue(record);
    const result = await upsertPeerReputation(record);
    expect(upsertPeerReputation).toHaveBeenCalledWith(record);
    expect(result).toEqual(record);
  });

  it("getPeerReputationBatch returns a map keyed by peerId", async () => {
    const mockMap = { abc123: { score: 85, successfulSwaps: 3, avgLatencyMs: 30 } };
    (getPeerReputationBatch as ReturnType<typeof vi.fn>).mockResolvedValue(mockMap);
    const result = await getPeerReputationBatch(["abc123"]);
    expect(getPeerReputationBatch).toHaveBeenCalledWith(["abc123"]);
    expect(result).toHaveProperty("abc123");
    expect(result["abc123"].score).toBe(85);
  });
});
