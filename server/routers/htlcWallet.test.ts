/**
 * Tests for the HTLC Wallet router — verifies address derivation from keys
 * and graceful handling when keys are missing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

function createTestContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as unknown as TrpcContext["res"],
  };
}

// Save original env values
const origBtcWif = process.env.BTC_AGENT_WIF;
const origEthKey = process.env.ETH_AGENT_KEY;
const origSolKey = process.env.SOL_AGENT_KEY;

describe("htlcWallet router", () => {
  afterEach(() => {
    // Restore original env
    if (origBtcWif !== undefined) process.env.BTC_AGENT_WIF = origBtcWif;
    else delete process.env.BTC_AGENT_WIF;
    if (origEthKey !== undefined) process.env.ETH_AGENT_KEY = origEthKey;
    else delete process.env.ETH_AGENT_KEY;
    if (origSolKey !== undefined) process.env.SOL_AGENT_KEY = origSolKey;
    else delete process.env.SOL_AGENT_KEY;
  });

  describe("response structure", () => {
    it("should always return btc, eth, sol keys with expected fields", async () => {
      const caller = appRouter.createCaller(createTestContext());
      const result = await caller.htlcWallet.getHtlcWallets();

      for (const chain of ["btc", "eth", "sol"] as const) {
        expect(result[chain]).toHaveProperty("chain");
        expect(result[chain]).toHaveProperty("asset");
        expect(result[chain]).toHaveProperty("address");
        expect(result[chain]).toHaveProperty("balance");
        expect(result[chain]).toHaveProperty("usd");
        expect(result[chain]).toHaveProperty("live");
        expect(result[chain]).toHaveProperty("configured");
      }

      expect(result.btc.chain).toBe("bitcoin");
      expect(result.eth.chain).toBe("ethereum");
      expect(result.sol.chain).toBe("solana");
      expect(result.btc.asset).toBe("BTC");
      expect(result.eth.asset).toBe("ETH");
      expect(result.sol.asset).toBe("SOL");
    });
  });

  describe("missing keys", () => {
    it("should report not configured when BTC_AGENT_WIF is unset", async () => {
      delete process.env.BTC_AGENT_WIF;
      const caller = appRouter.createCaller(createTestContext());
      const result = await caller.htlcWallet.getHtlcWallets();

      expect(result.btc.configured).toBe(false);
      expect(result.btc.address).toBeNull();
      expect(result.btc.error).toContain("not set");
    });

    it("should report not configured when ETH_AGENT_KEY is unset", async () => {
      delete process.env.ETH_AGENT_KEY;
      const caller = appRouter.createCaller(createTestContext());
      const result = await caller.htlcWallet.getHtlcWallets();

      expect(result.eth.configured).toBe(false);
      expect(result.eth.address).toBeNull();
      expect(result.eth.error).toContain("not set");
    });

    it("should report not configured when SOL_AGENT_KEY is unset", async () => {
      delete process.env.SOL_AGENT_KEY;
      const caller = appRouter.createCaller(createTestContext());
      const result = await caller.htlcWallet.getHtlcWallets();

      expect(result.sol.configured).toBe(false);
      expect(result.sol.address).toBeNull();
      expect(result.sol.error).toContain("not set");
    });
  });

  describe("ETH address derivation", () => {
    it("should derive correct ETH address from a known test private key", async () => {
      // Well-known Hardhat account #0 private key (DO NOT use in production)
      process.env.ETH_AGENT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
      const caller = appRouter.createCaller(createTestContext());
      const result = await caller.htlcWallet.getHtlcWallets();

      expect(result.eth.configured).toBe(true);
      expect(result.eth.address?.toLowerCase()).toBe("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
    });

    it("should handle ETH key without 0x prefix", async () => {
      process.env.ETH_AGENT_KEY = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
      const caller = appRouter.createCaller(createTestContext());
      const result = await caller.htlcWallet.getHtlcWallets();

      expect(result.eth.configured).toBe(true);
      expect(result.eth.address?.toLowerCase()).toBe("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
    });
  });
});
