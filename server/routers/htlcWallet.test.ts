/**
 * Tests for the HTLC Wallet router — verifies address derivation from keys,
 * graceful handling when keys are missing, and the new 7-asset flat array.
 *
 * After the dual-key split:
 *   - HTLC escrow wallets use SOL_HTLC_KEY / ETH_HTLC_KEY / BTC_HTLC_WIF
 *   - Fee collection wallets use SOL_AGENT_KEY / ETH_AGENT_KEY / BTC_AGENT_WIF
 *   - getHtlcWallets() reads HTLC keys first, falls back to agent keys
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

// Save original env values (both HTLC keys and agent keys)
const origBtcHtlcWif = process.env.BTC_HTLC_WIF;
const origEthHtlcKey = process.env.ETH_HTLC_KEY;
const origSolHtlcKey = process.env.SOL_HTLC_KEY;
const origBtcWif = process.env.BTC_AGENT_WIF;
const origEthKey = process.env.ETH_AGENT_KEY;
const origSolKey = process.env.SOL_AGENT_KEY;

describe("htlcWallet router", () => {
  afterEach(() => {
    // Restore original env — both HTLC keys and agent keys
    if (origBtcHtlcWif !== undefined) process.env.BTC_HTLC_WIF = origBtcHtlcWif;
    else delete process.env.BTC_HTLC_WIF;
    if (origEthHtlcKey !== undefined) process.env.ETH_HTLC_KEY = origEthHtlcKey;
    else delete process.env.ETH_HTLC_KEY;
    if (origSolHtlcKey !== undefined) process.env.SOL_HTLC_KEY = origSolHtlcKey;
    else delete process.env.SOL_HTLC_KEY;
    if (origBtcWif !== undefined) process.env.BTC_AGENT_WIF = origBtcWif;
    else delete process.env.BTC_AGENT_WIF;
    if (origEthKey !== undefined) process.env.ETH_AGENT_KEY = origEthKey;
    else delete process.env.ETH_AGENT_KEY;
    if (origSolKey !== undefined) process.env.SOL_AGENT_KEY = origSolKey;
    else delete process.env.SOL_AGENT_KEY;
  });

  describe("response structure — legacy btc/eth/sol keys", () => {
    it("should always return btc, eth, sol keys with expected fields", { timeout: 30_000 }, async () => {
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

  describe("response structure — new 7-asset flat array", () => {
    it("should return assets array with exactly 7 items covering all chains and tokens", { timeout: 30_000 }, async () => {
      const caller = appRouter.createCaller(createTestContext());
      const result = await caller.htlcWallet.getHtlcWallets();

      expect(result.assets).toBeDefined();
      expect(Array.isArray(result.assets)).toBe(true);
      expect(result.assets).toHaveLength(7);

      const expectedAssets = [
        { chain: "solana",   asset: "SOL"  },
        { chain: "solana",   asset: "USDT" },
        { chain: "solana",   asset: "USDC" },
        { chain: "ethereum", asset: "ETH"  },
        { chain: "ethereum", asset: "USDT" },
        { chain: "ethereum", asset: "USDC" },
        { chain: "bitcoin",  asset: "BTC"  },
      ];

      for (const expected of expectedAssets) {
        const found = result.assets.find(
          a => a.chain === expected.chain && a.asset === expected.asset
        );
        expect(found, `Missing ${expected.asset}/${expected.chain}`).toBeDefined();
        expect(found).toHaveProperty("balance");
        expect(found).toHaveProperty("usd");
        expect(found).toHaveProperty("live");
        expect(found).toHaveProperty("configured");
      }
    });

    it("should have USDT/USDC on solana sharing the same address as SOL", { timeout: 30_000 }, async () => {
      const caller = appRouter.createCaller(createTestContext());
      const result = await caller.htlcWallet.getHtlcWallets();

      const sol  = result.assets.find(a => a.chain === "solana"   && a.asset === "SOL");
      const usdt = result.assets.find(a => a.chain === "solana"   && a.asset === "USDT");
      const usdc = result.assets.find(a => a.chain === "solana"   && a.asset === "USDC");

      // If SOL key is configured, all 3 Solana assets share the same address
      if (sol?.address) {
        expect(usdt?.address).toBe(sol.address);
        expect(usdc?.address).toBe(sol.address);
      }
    });

    it("should have USDT/USDC on ethereum sharing the same address as ETH", { timeout: 30_000 }, async () => {
      const caller = appRouter.createCaller(createTestContext());
      const result = await caller.htlcWallet.getHtlcWallets();

      const eth  = result.assets.find(a => a.chain === "ethereum" && a.asset === "ETH");
      const usdt = result.assets.find(a => a.chain === "ethereum" && a.asset === "USDT");
      const usdc = result.assets.find(a => a.chain === "ethereum" && a.asset === "USDC");

      // If ETH key is configured, all 3 Ethereum assets share the same address
      if (eth?.address) {
        expect(usdt?.address).toBe(eth.address);
        expect(usdc?.address).toBe(eth.address);
      }
    });
  });

  describe("missing keys — HTLC keys take priority, agent keys as fallback", () => {
    it("should report not configured when both BTC_HTLC_WIF and BTC_AGENT_WIF are unset", { timeout: 30_000 }, async () => {
      delete process.env.BTC_HTLC_WIF;
      delete process.env.BTC_AGENT_WIF;
      const caller = appRouter.createCaller(createTestContext());
      const result = await caller.htlcWallet.getHtlcWallets();

      expect(result.btc.configured).toBe(false);
      expect(result.btc.address).toBeNull();
      expect(result.btc.error).toContain("not set");

      // Also check via assets array
      const btcAsset = result.assets.find(a => a.chain === "bitcoin" && a.asset === "BTC");
      expect(btcAsset?.configured).toBe(false);
    });

    it("should report not configured when both ETH_HTLC_KEY and ETH_AGENT_KEY are unset", { timeout: 30_000 }, async () => {
      delete process.env.ETH_HTLC_KEY;
      delete process.env.ETH_AGENT_KEY;
      const caller = appRouter.createCaller(createTestContext());
      const result = await caller.htlcWallet.getHtlcWallets();

      expect(result.eth.configured).toBe(false);
      expect(result.eth.address).toBeNull();
      expect(result.eth.error).toContain("not set");

      // All 3 ETH-chain assets should be unconfigured
      const ethAssets = result.assets.filter(a => a.chain === "ethereum");
      expect(ethAssets).toHaveLength(3);
      for (const a of ethAssets) {
        expect(a.configured).toBe(false);
      }
    });

    it("should report not configured when both SOL_HTLC_KEY and SOL_AGENT_KEY are unset", { timeout: 30_000 }, async () => {
      delete process.env.SOL_HTLC_KEY;
      delete process.env.SOL_AGENT_KEY;
      const caller = appRouter.createCaller(createTestContext());
      const result = await caller.htlcWallet.getHtlcWallets();

      expect(result.sol.configured).toBe(false);
      expect(result.sol.address).toBeNull();
      expect(result.sol.error).toContain("not set");

      // All 3 SOL-chain assets should be unconfigured
      const solAssets = result.assets.filter(a => a.chain === "solana");
      expect(solAssets).toHaveLength(3);
      for (const a of solAssets) {
        expect(a.configured).toBe(false);
      }
    });

    it("should use BTC_AGENT_WIF as fallback when BTC_HTLC_WIF is unset", { timeout: 30_000 }, async () => {
      // Only agent key set (no dedicated HTLC key)
      delete process.env.BTC_HTLC_WIF;
      // BTC_AGENT_WIF stays as-is (whatever was originally set)
      const caller = appRouter.createCaller(createTestContext());
      const result = await caller.htlcWallet.getHtlcWallets();

      // If agent key was set, wallet should still be configured
      if (origBtcWif) {
        expect(result.btc.configured).toBe(true);
      }
    });

    it("should prefer ETH_HTLC_KEY over ETH_AGENT_KEY when both are set", { timeout: 30_000 }, async () => {
      // Set HTLC key to Hardhat account #0 (known address)
      process.env.ETH_HTLC_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
      // Set agent key to Hardhat account #1 (different address)
      process.env.ETH_AGENT_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
      const caller = appRouter.createCaller(createTestContext());
      const result = await caller.htlcWallet.getHtlcWallets();

      // Should use HTLC key address (Hardhat #0), not agent key address (Hardhat #1)
      expect(result.eth.configured).toBe(true);
      expect(result.eth.address?.toLowerCase()).toBe("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
    });
  });

  describe("ETH address derivation", () => {
    it("should derive correct ETH address from a known test private key (via ETH_HTLC_KEY)", { timeout: 30_000 }, async () => {
      // Well-known Hardhat account #0 private key (DO NOT use in production)
      process.env.ETH_HTLC_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
      delete process.env.ETH_AGENT_KEY; // ensure HTLC key is used
      const caller = appRouter.createCaller(createTestContext());
      const result = await caller.htlcWallet.getHtlcWallets();

      expect(result.eth.configured).toBe(true);
      expect(result.eth.address?.toLowerCase()).toBe("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");

      // USDT and USDC on ETH should share the same address
      const ethUsdt = result.assets.find(a => a.chain === "ethereum" && a.asset === "USDT");
      const ethUsdc = result.assets.find(a => a.chain === "ethereum" && a.asset === "USDC");
      expect(ethUsdt?.address?.toLowerCase()).toBe("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
      expect(ethUsdc?.address?.toLowerCase()).toBe("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
    });

    it("should derive correct ETH address from ETH_AGENT_KEY fallback (no ETH_HTLC_KEY)", { timeout: 30_000 }, async () => {
      delete process.env.ETH_HTLC_KEY;
      process.env.ETH_AGENT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
      const caller = appRouter.createCaller(createTestContext());
      const result = await caller.htlcWallet.getHtlcWallets();

      expect(result.eth.configured).toBe(true);
      expect(result.eth.address?.toLowerCase()).toBe("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
    });

    it("should handle ETH key without 0x prefix", { timeout: 30_000 }, async () => {
      process.env.ETH_HTLC_KEY = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
      delete process.env.ETH_AGENT_KEY;
      const caller = appRouter.createCaller(createTestContext());
      const result = await caller.htlcWallet.getHtlcWallets();

      expect(result.eth.configured).toBe(true);
      expect(result.eth.address?.toLowerCase()).toBe("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
    });
  });
});
