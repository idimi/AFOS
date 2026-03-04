/**
 * Tests for server-side enforcement of user settings in chat procedures.
 *
 * Strategy notes:
 *  - getTokenPricesWithSource is defined inline in chat.ts (not importable), so
 *    we cannot vi.mock it. Instead we set maxTxAmountUsd to $0.01 so any real
 *    token amount (even 0.001 SOL ≈ $0.15) will exceed the limit.
 *  - For the forceP2P test we mock globalThis.fetch to simulate Oracle VM being
 *    unreachable (network error), which causes rfqId to remain null.
 *
 * Verifies:
 *  1. executeAgentSwap rejects swaps exceeding maxTxAmountUsd
 *  2. executeAgentSwap allows swaps within maxTxAmountUsd (proceeds to chain logic)
 *  3. executeAgentSwap throws PRECONDITION_FAILED when preferredRoute="intercomswap" and no peer
 *  4. executeEthSwap rejects swaps exceeding maxTxAmountUsd
 *  5. executeEthSwap allows swaps within maxTxAmountUsd
 *  6. buildSwapTx rejects swaps exceeding maxTxAmountUsd
 *  7. No openId → DEFAULT_USER_SETTINGS used (no limit rejection for small amounts)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { DEFAULT_USER_SETTINGS } from "../../drizzle/schema";

// ─── DB mock ──────────────────────────────────────────────────────────────────
const mockSettingsStore: Record<string, typeof DEFAULT_USER_SETTINGS> = {};

vi.mock("../db", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db")>();
  return {
    ...original,
    getUserSettings: vi.fn(async (openId: string) => {
      return mockSettingsStore[openId] ?? { ...DEFAULT_USER_SETTINGS };
    }),
    upsertUserSettings: vi.fn(async (openId: string, patch: Partial<typeof DEFAULT_USER_SETTINGS>) => {
      const current = mockSettingsStore[openId] ?? { ...DEFAULT_USER_SETTINGS };
      mockSettingsStore[openId] = { ...current, ...patch };
    }),
    recordSwapAnalytic: vi.fn(async () => {}),
    recordHtlcLock: vi.fn(async () => {}),
  };
});

// ─── Context helpers ──────────────────────────────────────────────────────────
function makeCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("server-side settings enforcement", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockSettingsStore)) delete mockSettingsStore[key];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 1. executeAgentSwap — maxTxAmountUsd enforcement ─────────────────────
  describe("executeAgentSwap — maxTxAmountUsd", () => {
    it("rejects a SOL swap that exceeds the user's maxTxAmountUsd ($0.01 limit)", async () => {
      const openId = "user-limit-test";
      // $0.01 limit — any real SOL amount will exceed it (1 SOL ≈ $150)
      mockSettingsStore[openId] = { ...DEFAULT_USER_SETTINGS, maxTxAmountUsd: 0.01 };

      const caller = appRouter.createCaller(makeCtx());
      await expect(
        caller.chat.executeAgentSwap({
          fromToken: "SOL",
          toToken: "USDT",
          amount: 1,
          fromChain: "solana",
          toChain: "solana",
          openId,
        })
      ).rejects.toThrow(/maximum transaction limit/i);
    }, 15_000);

    it("allows a SOL swap within the user's maxTxAmountUsd (proceeds to chain logic)", async () => {
      const openId = "user-limit-ok";
      // $10,000 limit — 0.001 SOL ≈ $0.15, well within limit
      mockSettingsStore[openId] = { ...DEFAULT_USER_SETTINGS, maxTxAmountUsd: 10_000 };

      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.chat.executeAgentSwap({
        fromToken: "SOL",
        toToken: "USDT",
        amount: 0.001,
        fromChain: "solana",
        toChain: "solana",
        openId,
      }).catch(err => ({ _error: err.message as string }));

      // Should NOT throw a "maximum transaction limit" error
      if ("_error" in (result as object)) {
        expect((result as { _error: string })._error).not.toMatch(/maximum transaction limit/i);
      }
    }, 30_000);

    it("uses DEFAULT_USER_SETTINGS when no openId is provided", async () => {
      // DEFAULT_USER_SETTINGS.maxTxAmountUsd = 500; 0.001 SOL ≈ $0.15 → well within limit
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.chat.executeAgentSwap({
        fromToken: "SOL",
        toToken: "USDT",
        amount: 0.001,
        fromChain: "solana",
        toChain: "solana",
        // no openId
      }).catch(err => ({ _error: err.message as string }));

      if ("_error" in (result as object)) {
        expect((result as { _error: string })._error).not.toMatch(/maximum transaction limit/i);
      }
    }, 30_000);
  });

  // ── 2. executeAgentSwap — preferredRoute "intercomswap" forces P2P ───────
  describe("executeAgentSwap — preferredRoute intercomswap", () => {
    it("throws PRECONDITION_FAILED when preferredRoute='intercomswap' and Oracle VM is unreachable", async () => {
      const openId = "user-p2p-force";
      mockSettingsStore[openId] = { ...DEFAULT_USER_SETTINGS, preferredRoute: "intercomswap", maxTxAmountUsd: 10_000 };

      // Mock fetch to simulate Oracle VM being unreachable (network error)
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED — Oracle VM unreachable"));

      const caller = appRouter.createCaller(makeCtx());
      try {
        await expect(
          caller.chat.executeAgentSwap({
            fromToken: "SOL",
            toToken: "USDT",
            amount: 0.001,
            fromChain: "solana",
            toChain: "solana",
            openId,
          })
        ).rejects.toThrow(/IntercomSwap P2P/i);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }, 15_000);
  });

  // ── 3. executeEthSwap — maxTxAmountUsd enforcement ───────────────────────
  describe("executeEthSwap — maxTxAmountUsd", () => {
    it("rejects an ETH swap that exceeds the user's maxTxAmountUsd ($0.01 limit)", async () => {
      const openId = "user-eth-limit";
      // $0.01 limit — 0.001 ETH ≈ $3, exceeds it
      mockSettingsStore[openId] = { ...DEFAULT_USER_SETTINGS, maxTxAmountUsd: 0.01 };

      const caller = appRouter.createCaller(makeCtx());
      await expect(
        caller.chat.executeEthSwap({
          fromAddress: "0x1234567890123456789012345678901234567890",
          fromToken: "ETH",
          toToken: "USDT",
          amount: 0.001,
          openId,
        })
      ).rejects.toThrow(/maximum transaction limit/i);
    }, 15_000);

    it("allows an ETH swap within the user's maxTxAmountUsd (proceeds to chain logic)", async () => {
      const openId = "user-eth-ok";
      // $10,000 limit — 0.001 ETH ≈ $3, well within limit
      mockSettingsStore[openId] = { ...DEFAULT_USER_SETTINGS, maxTxAmountUsd: 10_000 };

      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.chat.executeEthSwap({
        fromAddress: "0x1234567890123456789012345678901234567890",
        fromToken: "ETH",
        toToken: "USDT",
        amount: 0.001,
        openId,
      }).catch(err => ({ _error: err.message as string }));

      if ("_error" in (result as object)) {
        expect((result as { _error: string })._error).not.toMatch(/maximum transaction limit/i);
      }
    }, 30_000);
  });

  // ── 4. buildSwapTx — maxTxAmountUsd enforcement ──────────────────────────
  describe("buildSwapTx — maxTxAmountUsd", () => {
    it("rejects when amount exceeds user's maxTxAmountUsd ($0.01 limit)", async () => {
      const openId = "user-build-limit";
      // $0.01 limit — 0.01 SOL ≈ $1.50, exceeds it
      mockSettingsStore[openId] = { ...DEFAULT_USER_SETTINGS, maxTxAmountUsd: 0.01 };

      const caller = appRouter.createCaller(makeCtx());
      await expect(
        caller.chat.buildSwapTx({
          quoteResponse: {
            inputMint: "So11111111111111111111111111111111111111112",
            outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            inAmount: "10000000",
            outAmount: "1490000",
            otherAmountThreshold: "1480000",
            swapMode: "ExactIn",
            slippageBps: 50,
            priceImpactPct: "0.01",
            routePlan: [],
          },
          userPublicKey: "DYsF9Dq3LnPpinsSUfRkRwEkvyQdFBGmJcYUpifJhC68",
          fromToken: "SOL",
          toToken: "USDT",
          amount: 0.01, // ≈ $1.50 at live price, exceeds $0.01 limit
          openId,
        })
      ).rejects.toThrow(/maximum transaction limit/i);
    }, 15_000);
  });
});
