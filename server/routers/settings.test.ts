/**
 * Tests for the settings tRPC router.
 *
 * Uses an in-memory mock for the database helpers so the tests run without
 * a live MySQL connection. The mock is injected via vi.mock so the router
 * picks it up automatically.
 *
 * Auth model: wallet-based. openId is passed as input (no Manus OAuth required).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { DEFAULT_USER_SETTINGS } from "../../drizzle/schema";

// ─── DB mock ──────────────────────────────────────────────────────────────────
const mockStore: Record<string, typeof DEFAULT_USER_SETTINGS & { id?: number }> = {};

vi.mock("../db", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db")>();
  return {
    ...original,
    getUserSettings: vi.fn(async (openId: string) => {
      return mockStore[openId] ?? { ...DEFAULT_USER_SETTINGS };
    }),
    upsertUserSettings: vi.fn(async (openId: string, patch: Partial<typeof DEFAULT_USER_SETTINGS>) => {
      const current = mockStore[openId] ?? { ...DEFAULT_USER_SETTINGS };
      mockStore[openId] = { ...current, ...patch };
    }),
  };
});

// ─── Context helpers ──────────────────────────────────────────────────────────
function makeCtx(user: TrpcContext["user"] = null): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("settings router", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStore)) delete mockStore[key];
    vi.clearAllMocks();
  });

  describe("settings.get", () => {
    it("returns default settings when no row exists yet", async () => {
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.settings.get({ openId: "wallet-001" });

      expect(result.maxTxAmountUsd).toBe(DEFAULT_USER_SETTINGS.maxTxAmountUsd);
      expect(result.autoConfirm).toBe(DEFAULT_USER_SETTINGS.autoConfirm);
      expect(result.slippagePct).toBe(DEFAULT_USER_SETTINGS.slippagePct);
      expect(result.preferredRoute).toBe(DEFAULT_USER_SETTINGS.preferredRoute);
      expect(result.theme).toBe(DEFAULT_USER_SETTINGS.theme);
    });

    it("returns stored settings when a row exists", async () => {
      const openId = "wallet-001";
      mockStore[openId] = {
        maxTxAmountUsd: 1000,
        autoConfirm: true,
        slippagePct: "1.5",
        preferredRoute: "jupiter",
        theme: "light",
      };

      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.settings.get({ openId });

      expect(result.maxTxAmountUsd).toBe(1000);
      expect(result.autoConfirm).toBe(true);
      expect(result.slippagePct).toBe("1.5");
      expect(result.preferredRoute).toBe("jupiter");
      expect(result.theme).toBe("light");
    });

    it("returns defaults when no openId is provided (anon fallback)", async () => {
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.settings.get({});
      expect(result.maxTxAmountUsd).toBe(DEFAULT_USER_SETTINGS.maxTxAmountUsd);
    });

    it("works without a Manus session (unauthenticated user)", async () => {
      const caller = appRouter.createCaller(makeCtx(null));
      // Should NOT throw — no Manus auth required
      await expect(caller.settings.get({ openId: "wallet-001" })).resolves.toBeDefined();
    });
  });

  describe("settings.save", () => {
    it("saves a full settings patch and returns updated settings", async () => {
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.settings.save({
        openId: "wallet-001",
        maxTxAmountUsd: 750,
        autoConfirm: true,
        slippagePct: "0.3",
        preferredRoute: "oneinch",
        theme: "system",
      });

      expect(result.maxTxAmountUsd).toBe(750);
      expect(result.autoConfirm).toBe(true);
      expect(result.slippagePct).toBe("0.3");
      expect(result.preferredRoute).toBe("oneinch");
      expect(result.theme).toBe("system");
    });

    it("saves a partial patch — only provided fields change", async () => {
      const openId = "wallet-partial";
      mockStore[openId] = {
        maxTxAmountUsd: 200,
        autoConfirm: false,
        slippagePct: "0.5",
        preferredRoute: "intercomswap",
        theme: "dark",
      };

      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.settings.save({ openId, maxTxAmountUsd: 999 });

      expect(result.maxTxAmountUsd).toBe(999);
      expect(result.slippagePct).toBe("0.5");
      expect(result.preferredRoute).toBe("intercomswap");
    });

    it("rejects maxTxAmountUsd below 1", async () => {
      const caller = appRouter.createCaller(makeCtx());
      await expect(caller.settings.save({ openId: "w", maxTxAmountUsd: 0 })).rejects.toThrow();
    });

    it("rejects maxTxAmountUsd above 1,000,000", async () => {
      const caller = appRouter.createCaller(makeCtx());
      await expect(caller.settings.save({ openId: "w", maxTxAmountUsd: 2_000_000 })).rejects.toThrow();
    });

    it("rejects a non-numeric slippagePct string", async () => {
      const caller = appRouter.createCaller(makeCtx());
      await expect(caller.settings.save({ openId: "w", slippagePct: "abc" })).rejects.toThrow();
    });

    it("rejects an invalid preferredRoute value", async () => {
      const caller = appRouter.createCaller(makeCtx());
      // @ts-expect-error — intentionally passing invalid value
      await expect(caller.settings.save({ openId: "w", preferredRoute: "unknown_dex" })).rejects.toThrow();
    });

    it("works without a Manus session (unauthenticated user)", async () => {
      const caller = appRouter.createCaller(makeCtx(null));
      // Should NOT throw — no Manus auth required
      await expect(caller.settings.save({ openId: "wallet-001", maxTxAmountUsd: 100 })).resolves.toBeDefined();
    });

    it("settings are isolated per wallet (different openIds)", async () => {
      const caller = appRouter.createCaller(makeCtx());

      await caller.settings.save({ openId: "wallet-A", maxTxAmountUsd: 111 });
      await caller.settings.save({ openId: "wallet-B", maxTxAmountUsd: 222 });

      const resultA = await caller.settings.get({ openId: "wallet-A" });
      const resultB = await caller.settings.get({ openId: "wallet-B" });

      expect(resultA.maxTxAmountUsd).toBe(111);
      expect(resultB.maxTxAmountUsd).toBe(222);
    });
  });
});
