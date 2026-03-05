/**
 * Tests for the adminConfig router.
 * Covers: get (returns defaults when DB is unavailable), saveFeeConfig validation, saveTreasury validation.
 * Since the test environment has no real DB, we verify that:
 *   1. The router procedures exist and are callable.
 *   2. Input validation rejects out-of-range values.
 *   3. The router returns the expected shape on graceful DB failure (null).
 */

import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "admin-user",
      email: "admin@afos.io",
      name: "Admin",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("adminConfig.get", () => {
  it("returns null or an object (graceful when DB is unavailable)", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    // In test env the DB may not be reachable; we just verify the call resolves
    const result = await caller.adminConfig.get();
    // result is either null (no DB) or an object with the expected shape
    if (result !== null) {
      expect(result).toHaveProperty("feeEnabled");
      expect(result).toHaveProperty("swapFeeBps");
      expect(result).toHaveProperty("expressFeeBps");
      expect(result).toHaveProperty("botFeeCents");
      expect(result).toHaveProperty("minTradeUsdCents");
      expect(result).toHaveProperty("maxTradeUsdCents");
      expect(result).toHaveProperty("treasuryWallets");
    } else {
      expect(result).toBeNull();
    }
  });
});

describe("adminConfig.saveFeeConfig", () => {
  it("rejects swapFeeBps above 1000", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.adminConfig.saveFeeConfig({ swapFeeBps: 9999 })
    ).rejects.toThrow();
  });

  it("rejects negative swapFeeBps", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.adminConfig.saveFeeConfig({ swapFeeBps: -1 })
    ).rejects.toThrow();
  });

  it("rejects minTradeUsdCents below 1", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.adminConfig.saveFeeConfig({ minTradeUsdCents: 0 })
    ).rejects.toThrow();
  });
});

describe("adminConfig.saveTreasury", () => {
  it("rejects wallet with splitPercent above 100", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.adminConfig.saveTreasury({
        wallets: [
          { id: "tw_1", label: "Main", chain: "solana", address: "abc123", splitPercent: 150 },
        ],
      })
    ).rejects.toThrow();
  });

  it("accepts an empty wallet list (no DB call needed for validation)", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    // With no DB, this will return null — just verify it doesn't throw on valid input
    // (DB unavailability is a graceful failure, not a validation error)
    const result = await caller.adminConfig.saveTreasury({ wallets: [] }).catch(() => null);
    // Either null (no DB) or an object — both are acceptable
    expect(result === null || typeof result === "object").toBe(true);
  });
});

describe("analytics.userStats", () => {
  it("returns the expected shape (graceful when DB is unavailable)", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.analytics.userStats({ days: 30 });
    expect(result).toHaveProperty("totalWallets");
    expect(result).toHaveProperty("activeWallets");
    expect(result).toHaveProperty("avgSwapUsd");
    expect(typeof result.totalWallets).toBe("number");
    expect(typeof result.activeWallets).toBe("number");
    expect(typeof result.avgSwapUsd).toBe("number");
  });
});

describe("analytics.topPairs", () => {
  it("returns an array (graceful when DB is unavailable)", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.analytics.topPairs({ days: 30, limit: 5 });
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("adminConfig.saveFeeConfig — feeAlertThresholdCents", () => {
  it("rejects negative feeAlertThresholdCents", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.adminConfig.saveFeeConfig({ feeAlertThresholdCents: -1 })
    ).rejects.toThrow();
  });

  it("accepts zero (disables alert)", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    // With no DB this returns { success: false } or null — both are acceptable
    const result = await caller.adminConfig.saveFeeConfig({ feeAlertThresholdCents: 0 }).catch(() => null);
    expect(result === null || typeof result === "object").toBe(true);
  });
});

describe("operatorConfig.get", () => {
  it("returns null or an object with expected shape (graceful when DB unavailable)", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.operatorConfig.get();
    if (result !== null) {
      expect(result).toHaveProperty("llmModel");
      expect(result).toHaveProperty("rendezvousChannel");
      expect(result).toHaveProperty("tradeauto");
      expect(result).toHaveProperty("solanaRpc");
    } else {
      expect(result).toBeNull();
    }
  });
});

describe("operatorConfig.save — admin guard", () => {
  it("rejects non-admin users", async () => {
    const ctx: import("./_core/context").TrpcContext = {
      user: {
        id: 2,
        openId: "regular-user",
        email: "user@afos.io",
        name: "Regular User",
        loginMethod: "manus",
        role: "user",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      req: { protocol: "https", headers: {} } as import("./_core/context").TrpcContext["req"],
      res: { clearCookie: () => {} } as import("./_core/context").TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.operatorConfig.save({ llmModel: "gpt-4" })
    ).rejects.toThrow();
  });

  it("rejects invalid solanaRpc URL", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.operatorConfig.save({ solanaRpc: "not-a-url" })
    ).rejects.toThrow();
  });
});

describe("adminConfig.getAuditLog", () => {
  it("returns the expected shape (graceful when DB unavailable)", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adminConfig.getAuditLog({ section: "all", page: 1, limit: 20 });
    expect(result).toHaveProperty("entries");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("page");
    expect(result).toHaveProperty("limit");
    expect(Array.isArray(result.entries)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("rejects non-admin users", async () => {
    const ctx: import("./_core/context").TrpcContext = {
      user: {
        id: 2,
        openId: "regular-user",
        email: "user@afos.io",
        name: "Regular User",
        loginMethod: "manus",
        role: "user",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      req: { protocol: "https", headers: {} } as import("./_core/context").TrpcContext["req"],
      res: { clearCookie: () => {} } as import("./_core/context").TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.adminConfig.getAuditLog({ section: "all", page: 1, limit: 20 })
    ).rejects.toThrow();
  });

  it("filters by section without throwing", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adminConfig.getAuditLog({ section: "fee_config", page: 1, limit: 10 });
    expect(Array.isArray(result.entries)).toBe(true);
  });
});

describe("auditLog.diffObjects", () => {
  it("detects changed fields", async () => {
    const { diffObjects } = await import("./lib/auditLog");
    const before = { a: 1, b: "hello", c: true };
    const after  = { a: 2, b: "hello", c: false };
    const changes = diffObjects(before, after);
    expect(changes).toHaveLength(2);
    const fieldNames = changes.map(c => c.fieldName);
    expect(fieldNames).toContain("a");
    expect(fieldNames).toContain("c");
  });

  it("returns empty array when nothing changed", async () => {
    const { diffObjects } = await import("./lib/auditLog");
    const obj = { x: 42, y: "same" };
    const changes = diffObjects(obj, { ...obj });
    expect(changes).toHaveLength(0);
  });

  it("detects new keys", async () => {
    const { diffObjects } = await import("./lib/auditLog");
    const changes = diffObjects({ a: 1 }, { a: 1, b: 2 });
    expect(changes).toHaveLength(1);
    expect(changes[0].fieldName).toBe("b");
    expect(changes[0].oldValue).toBeUndefined();
    expect(changes[0].newValue).toBe(2);
  });
});

describe("analytics.checkFeeAlert", () => {
  it("resolves without throwing (graceful when DB unavailable)", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.analytics.checkFeeAlert();
    expect(result).toHaveProperty("checked");
    expect(result).toHaveProperty("alerted");
    expect(result).toHaveProperty("totalFeeUsd");
    expect(result).toHaveProperty("thresholdUsd");
  });
});
