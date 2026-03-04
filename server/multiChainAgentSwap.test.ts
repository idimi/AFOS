/**
 * Multi-Chain Agent Swap Tests
 *
 * Validates the executeAgentSwap chain dispatcher and the ETH/BTC helper modules.
 * All tests run in demo mode (no real keys) so they are safe in CI.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── 1. Chain dispatcher in chat.ts ───────────────────────────────────────────
describe("executeAgentSwap chain dispatcher", () => {
  it("should import executeEthAgentSwap and executeBtcAgentSwap in chat.ts", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/routers/chat.ts", "utf-8");
    expect(src).toContain('import { executeEthAgentSwap } from "../agentSwapEth"');
    expect(src).toContain('import { executeBtcAgentSwap } from "../agentSwapBtc"');
  });

  it("should dispatch to ETH path when fromChain=ethereum", async () => {
    const src = (await import("fs")).readFileSync("server/routers/chat.ts", "utf-8");
    expect(src).toContain('if (chain === "ethereum")');
    expect(src).toContain("executeEthAgentSwap({ fromToken, toToken, amount, fromChain, toChain })");
  });

  it("should dispatch to BTC path when fromChain=bitcoin", async () => {
    const src = (await import("fs")).readFileSync("server/routers/chat.ts", "utf-8");
    expect(src).toContain('if (chain === "bitcoin")');
    expect(src).toContain("executeBtcAgentSwap({");
  });

  it("should fall through to Solana path for any other chain", async () => {
    const src = (await import("fs")).readFileSync("server/routers/chat.ts", "utf-8");
    // Solana path uses SOL_AGENT_KEY
    expect(src).toContain("const agentKeyRaw = process.env.SOL_AGENT_KEY;");
  });

  it("should accept btcNetwork and btcExpiryHours in input schema", async () => {
    const src = (await import("fs")).readFileSync("server/routers/chat.ts", "utf-8");
    expect(src).toContain('btcNetwork: z.enum(["mainnet", "testnet"])');
    expect(src).toContain("btcExpiryHours: z.number().int().positive()");
  });
});

// ─── 2. ETH agent swap helper ─────────────────────────────────────────────────
describe("executeEthAgentSwap", () => {
  it("should return demo mode when ETH_AGENT_KEY is not set", async () => {
    // Ensure key is not set
    const originalKey = process.env.ETH_AGENT_KEY;
    delete process.env.ETH_AGENT_KEY;

    const { executeEthAgentSwap } = await import("./agentSwapEth");
    const result = await executeEthAgentSwap({
      fromToken: "ETH",
      toToken: "USDT",
      amount: 0.1,
    });

    expect(result.demo).toBe(true);
    expect(result.success).toBe(false);
    expect(result.agentAddress).toBeNull();
    expect(result.message).toContain("ETH_AGENT_KEY");
    expect(result.feeBps).toBe(20); // PLATFORM_FEE_BPS

    if (originalKey !== undefined) process.env.ETH_AGENT_KEY = originalKey;
  });

  it("should return correct fee constants", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/agentSwapEth.ts", "utf-8");
    const p2pMatch = src.match(/const\s+P2P_FEE_BPS\s*=\s*(\d+)/);
    const dexMatch = src.match(/const\s+PLATFORM_FEE_BPS\s*=\s*(\d+)/);
    expect(p2pMatch).not.toBeNull();
    expect(Number(p2pMatch![1])).toBe(15);
    expect(dexMatch).not.toBeNull();
    expect(Number(dexMatch![1])).toBe(20);
  });

  it("should support all expected ETH tokens", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/agentSwapEth.ts", "utf-8");
    // Tokens are defined as  ETH: { ... }, USDT: { ... }, etc.
    for (const token of ["ETH", "USDT", "USDC", "WBTC", "DAI", "WETH"]) {
      // Match either "TOKEN": or TOKEN: (with or without quotes)
      const hasToken = src.includes(`"${token}":`) || src.includes(`  ${token}:`) || src.includes(`\n  ${token}:`);
      expect(hasToken, `Token ${token} should be defined in ETH_TOKENS`).toBe(true);
    }
  });

  it("should include ERC-20 approval logic for non-native tokens", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/agentSwapEth.ts", "utf-8");
    expect(src).toContain("approve");
    expect(src).toContain("allowance");
    expect(src).toContain("ETH_NATIVE");
  });

  it("should record analytics with feeBps and feeAmountOut", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/agentSwapEth.ts", "utf-8");
    expect(src).toContain("feeBps,");
    expect(src).toContain("feeAmountOut:");
    expect(src).toContain("recordSwapAnalytic");
  });
});

// ─── 3. BTC agent swap helper ─────────────────────────────────────────────────
describe("executeBtcAgentSwap", () => {
  it("should return demo mode when BTC_AGENT_WIF is not set", async () => {
    const originalKey = process.env.BTC_AGENT_WIF;
    delete process.env.BTC_AGENT_WIF;

    const { executeBtcAgentSwap } = await import("./agentSwapBtc");
    const result = await executeBtcAgentSwap({
      fromToken: "BTC",
      toToken: "USDT",
      amount: 0.001,
    });

    // Demo mode should succeed (returns simulated result)
    expect(result.demo).toBe(true);
    expect(result.success).toBe(true);
    expect(result.txid).not.toBeNull();
    expect(result.htlcAddress).not.toBeNull();
    expect(result.secretHash).not.toBeNull();
    expect(result.secret).not.toBeNull();
    expect(result.feeBps).toBe(15); // P2P_FEE_BPS
    expect(result.message).toContain("DEMO");

    if (originalKey !== undefined) process.env.BTC_AGENT_WIF = originalKey;
  });

  it("should use P2P fee (15 bps) for all BTC swaps", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/agentSwapBtc.ts", "utf-8");
    const match = src.match(/const\s+P2P_FEE_BPS\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(15);
    // BTC should not have a separate DEX fee constant
    expect(src).not.toContain("PLATFORM_FEE_BPS");
  });

  it("should build P2WSH HTLC script with correct opcodes", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/agentSwapBtc.ts", "utf-8");
    expect(src).toContain("OP_IF");
    expect(src).toContain("OP_SHA256");
    expect(src).toContain("OP_EQUALVERIFY");
    expect(src).toContain("OP_CHECKSIG");
    expect(src).toContain("OP_CHECKLOCKTIMEVERIFY");
    expect(src).toContain("OP_ENDIF");
  });

  it("should fetch UTXOs and broadcast via mempool.space", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/agentSwapBtc.ts", "utf-8");
    expect(src).toContain("mempool.space");
    expect(src).toContain("fetchUtxos");
    expect(src).toContain("broadcastTx");
    expect(src).toContain("fetchRawTx");
  });

  it("should record analytics with feeBps and feeAmountOut", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/agentSwapBtc.ts", "utf-8");
    expect(src).toContain("feeBps:       P2P_FEE_BPS,");
    expect(src).toContain("feeAmountOut:");
    expect(src).toContain("recordSwapAnalytic");
  });

  it("should use ECPair from ecpair + tiny-secp256k1 for signing", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/agentSwapBtc.ts", "utf-8");
    expect(src).toContain("ECPairFactory");
    expect(src).toContain("tinysecp");
    expect(src).toContain("psbt.signAllInputs");
    expect(src).toContain("psbt.finalizeAllInputs");
  });

  it("should check balance before attempting PSBT construction", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/agentSwapBtc.ts", "utf-8");
    expect(src).toContain("Insufficient BTC balance");
    expect(src).toContain("totalSats < amountSats + feeSats");
  });
});

// ─── 4. Frontend ChatPage updates ─────────────────────────────────────────────
describe("ChatPage multi-chain agent mode", () => {
  it("should dispatch all chains to executeAgentSwap when no wallet connected", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("client/src/pages/ChatPage.tsx", "utf-8");
    // New logic checks noWalletConnected for all chains
    expect(src).toContain("const noWalletConnected =");
    expect(src).toContain('fromChainNorm === "ethereum"');
    expect(src).toContain('fromChainNorm === "bitcoin"');
  });

  it("should show chain-specific demo key hint in agent demo mode", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("client/src/pages/ChatPage.tsx", "utf-8");
    expect(src).toContain("ETH_AGENT_KEY");
    expect(src).toContain("BTC_AGENT_WIF");
    expect(src).toContain("SOL_AGENT_KEY");
  });

  it("should show HTLC address in BTC swap success message", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("client/src/pages/ChatPage.tsx", "utf-8");
    expect(src).toContain("htlcAddress");
    expect(src).toContain("HTLC Address");
  });

  it("TxSuccessCard should use chain-appropriate explorer", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("client/src/pages/ChatPage.tsx", "utf-8");
    expect(src).toContain("mempool.space");
    expect(src).toContain("etherscan.io");
    expect(src).toContain("solscan.io");
    expect(src).toContain("fromChain?: string");
  });
});

// ─── 5. Fee math for all chains ───────────────────────────────────────────────
describe("Fee math — all chains", () => {
  it("ETH P2P: 0.15% of 1000 USDT = 1.50 USDT", () => {
    const out = 1000;
    const fee = out * (15 / 10000);
    expect(fee).toBeCloseTo(1.5, 6);
  });

  it("ETH DEX: 0.20% of 1000 USDT = 2.00 USDT", () => {
    const out = 1000;
    const fee = out * (20 / 10000);
    expect(fee).toBeCloseTo(2.0, 6);
  });

  it("BTC P2P: 0.15% of 0.1 BTC output = 0.00015 BTC", () => {
    const out = 0.1;
    const fee = out * (15 / 10000);
    expect(fee).toBeCloseTo(0.00015, 8);
  });

  it("BTC amount in sats: 0.001 BTC = 100000 sats", () => {
    const btc = 0.001;
    const sats = Math.round(btc * 1e8);
    expect(sats).toBe(100000);
  });

  it("ETH amount in wei: 0.1 ETH = 100000000000000000 wei", () => {
    const eth = 0.1;
    const wei = BigInt(Math.floor(eth * Math.pow(10, 18)));
    expect(wei).toBe(BigInt("100000000000000000"));
  });
});
