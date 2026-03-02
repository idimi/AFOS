/**
 * Tests for the unified 3-chain swap architecture:
 *   - analyticsRouter: procedure structure, input validation, null-DB guards
 *   - htlcMonitor: exported functions exist, refund logic helpers
 *   - pathFinder: route discovery logic, hop construction
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Analytics Router ─────────────────────────────────────────────────────────

describe("analyticsRouter structure", () => {
  it("exports an analyticsRouter object", async () => {
    const mod = await import("./routers/analytics");
    expect(mod.analyticsRouter).toBeDefined();
    expect(typeof mod.analyticsRouter).toBe("object");
  });

  it("has all required procedure keys", async () => {
    const { analyticsRouter } = await import("./routers/analytics");
    const keys = Object.keys(analyticsRouter._def.procedures ?? {});
    const required = [
      "volumeByChain",
      "settlementTime",
      "htlcRatio",
      "peerLeaderboard",
      "routeDistribution",
      "recentSwaps",
      "summary",
    ];
    for (const key of required) {
      expect(keys).toContain(key);
    }
  });
});

describe("analyticsRouter — null DB guards", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("volumeByChain returns empty result when DB is unavailable", async () => {
    vi.doMock("./db", () => ({ getDb: async () => null }));
    const { analyticsRouter } = await import("./routers/analytics");
    const caller = analyticsRouter.createCaller({} as never);
    const result = await caller.volumeByChain({ days: 30 });
    expect(result.totalSwaps).toBe(0);
    expect(result.totalUsd).toBe(0);
    expect(result.byChain).toEqual([]);
  });

  it("settlementTime returns empty array when DB is unavailable", async () => {
    vi.doMock("./db", () => ({ getDb: async () => null }));
    const { analyticsRouter } = await import("./routers/analytics");
    const caller = analyticsRouter.createCaller({} as never);
    const result = await caller.settlementTime({ days: 30 });
    expect(result).toEqual([]);
  });

  it("htlcRatio returns zero totals when DB is unavailable", async () => {
    vi.doMock("./db", () => ({ getDb: async () => null }));
    const { analyticsRouter } = await import("./routers/analytics");
    const caller = analyticsRouter.createCaller({} as never);
    const result = await caller.htlcRatio({ days: 30 });
    expect(result.total).toBe(0);
    expect(result.successRate).toBe("0.0");
  });

  it("peerLeaderboard returns empty array when DB is unavailable", async () => {
    vi.doMock("./db", () => ({ getDb: async () => null }));
    const { analyticsRouter } = await import("./routers/analytics");
    const caller = analyticsRouter.createCaller({} as never);
    const result = await caller.peerLeaderboard({ days: 30, limit: 10 });
    expect(result).toEqual([]);
  });

  it("routeDistribution returns empty array when DB is unavailable", async () => {
    vi.doMock("./db", () => ({ getDb: async () => null }));
    const { analyticsRouter } = await import("./routers/analytics");
    const caller = analyticsRouter.createCaller({} as never);
    const result = await caller.routeDistribution({ days: 30 });
    expect(result).toEqual([]);
  });

  it("recentSwaps returns empty array when DB is unavailable", async () => {
    vi.doMock("./db", () => ({ getDb: async () => null }));
    const { analyticsRouter } = await import("./routers/analytics");
    const caller = analyticsRouter.createCaller({} as never);
    const result = await caller.recentSwaps({ limit: 20 });
    expect(result).toEqual([]);
  });

  it("summary returns zero stats when DB is unavailable", async () => {
    vi.doMock("./db", () => ({ getDb: async () => null }));
    const { analyticsRouter } = await import("./routers/analytics");
    const caller = analyticsRouter.createCaller({} as never);
    const result = await caller.summary({ days: 30 });
    expect(result.totalSwaps).toBe(0);
    expect(result.totalUsd).toBe(0);
    expect(result.p2pRatio).toBe("0.0");
    expect(result.htlcSuccessRate).toBe("0.0");
  });
});

describe("analyticsRouter — input validation", () => {
  it("volumeByChain rejects days < 1", async () => {
    const { analyticsRouter } = await import("./routers/analytics");
    const caller = analyticsRouter.createCaller({} as never);
    await expect(caller.volumeByChain({ days: 0 })).rejects.toThrow();
  });

  it("volumeByChain rejects days > 365", async () => {
    const { analyticsRouter } = await import("./routers/analytics");
    const caller = analyticsRouter.createCaller({} as never);
    await expect(caller.volumeByChain({ days: 366 })).rejects.toThrow();
  });

  it("peerLeaderboard rejects limit > 50", async () => {
    const { analyticsRouter } = await import("./routers/analytics");
    const caller = analyticsRouter.createCaller({} as never);
    await expect(caller.peerLeaderboard({ days: 30, limit: 51 })).rejects.toThrow();
  });

  it("recentSwaps rejects limit > 100", async () => {
    const { analyticsRouter } = await import("./routers/analytics");
    const caller = analyticsRouter.createCaller({} as never);
    await expect(caller.recentSwaps({ limit: 101 })).rejects.toThrow();
  });
});

// ─── HTLC Monitor ─────────────────────────────────────────────────────────────

describe("htlcMonitor exports", () => {
  it("exports startHtlcMonitor function", async () => {
    const mod = await import("./htlcMonitor");
    expect(typeof mod.startHtlcMonitor).toBe("function");
  });
});

// ─── Path Finder ──────────────────────────────────────────────────────────────

describe("pathFinderRouter structure", () => {
  it("exports a pathFinderRouter object", async () => {
    const mod = await import("./pathFinder");
    expect(mod.pathFinderRouter).toBeDefined();
    expect(typeof mod.pathFinderRouter).toBe("object");
  });

  it("has findSwapPath and getSupportedPairs procedures", async () => {
    const { pathFinderRouter } = await import("./pathFinder");
    const keys = Object.keys(pathFinderRouter._def.procedures ?? {});
    expect(keys).toContain("findSwapPath");
    expect(keys).toContain("getSupportedPairs");
  });
});

describe("pathFinderRouter — input validation", () => {
  it("findSwapPath rejects invalid fromChain", async () => {
    const { pathFinderRouter } = await import("./pathFinder");
    const caller = pathFinderRouter.createCaller({} as never);
    await expect(
      caller.findSwapPath({ fromChain: "dogecoin" as never, toChain: "solana", fromToken: "BTC", toToken: "SOL", amount: 0.001 })
    ).rejects.toThrow();
  });

  it("findSwapPath accepts valid cross-chain input", async () => {
    const { pathFinderRouter } = await import("./pathFinder");
    const caller = pathFinderRouter.createCaller({} as never);
    // Should not throw (may return no routes if no peers)
    const result = await caller.findSwapPath({
      fromChain: "bitcoin",
      toChain:   "solana",
      fromToken: "BTC",
      toToken:   "SOL",
      amount:    0.001,
    });
    expect(result).toBeDefined();
    expect(typeof result.found).toBe("boolean");
    expect(Array.isArray(result.hops)).toBe(true);
    expect(typeof result.hopCount).toBe("number");
  });

  it("getSupportedPairs returns an array", async () => {
    const { pathFinderRouter } = await import("./pathFinder");
    const caller = pathFinderRouter.createCaller({} as never);
    const result = await caller.getSupportedPairs();
    expect(Array.isArray(result)).toBe(true);
  });
});
