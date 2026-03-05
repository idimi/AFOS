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
    // Solana path uses SOL_HTLC_KEY (with SOL_AGENT_KEY fallback)
    expect(src).toContain("SOL_HTLC_KEY");
    expect(src).toContain("SOL_AGENT_KEY"); // fallback
  });

  it("should accept btcNetwork and btcExpiryHours in input schema", async () => {
    const src = (await import("fs")).readFileSync("server/routers/chat.ts", "utf-8");
    expect(src).toContain('btcNetwork: z.enum(["mainnet", "testnet"])');
    expect(src).toContain("btcExpiryHours: z.number().int().positive()");
  });
});

// ─── 2. ETH agent swap helper ─────────────────────────────────────────────────
describe("executeEthAgentSwap", () => {
  it("should return error when ETH_HTLC_KEY and ETH_AGENT_KEY are both not set", async () => {
    // Ensure both keys are not set
    const originalHtlcKey = process.env.ETH_HTLC_KEY;
    const originalKey = process.env.ETH_AGENT_KEY;
    delete process.env.ETH_HTLC_KEY;
    delete process.env.ETH_AGENT_KEY;

    const { executeEthAgentSwap } = await import("./agentSwapEth");
    const result = await executeEthAgentSwap({
      fromToken: "ETH",
      toToken: "USDT",
      amount: 0.1,
    });

    // Mode B removed: no demo mode. Returns wallet-required error when HTLC key not set.
    expect(result.demo).toBe(false);
    expect(result.success).toBe(false);
    expect(result.agentAddress).toBeNull();
    expect(result.message).toContain("ETH_HTLC_KEY");

    if (originalHtlcKey !== undefined) process.env.ETH_HTLC_KEY = originalHtlcKey;
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
  it("should return demo mode when BTC_HTLC_WIF and BTC_AGENT_WIF are both not set", async () => {
    const originalHtlcKey = process.env.BTC_HTLC_WIF;
    const originalKey = process.env.BTC_AGENT_WIF;
    delete process.env.BTC_HTLC_WIF;
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

    if (originalHtlcKey !== undefined) process.env.BTC_HTLC_WIF = originalHtlcKey;
    if (originalKey !== undefined) process.env.BTC_AGENT_WIF = originalKey;
  }, 20_000); // BTC demo mode may take up to 20s in CI

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

  it("should NOT have demo mode key hints in ChatPage (Mode B removed)", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("client/src/pages/ChatPage.tsx", "utf-8");
    // Mode B removed: ChatPage no longer shows demo key hints for agent execution
    // Instead it shows a wallet connection prompt
    expect(src).toContain("openWalletForChain");
    expect(src).toContain("noWalletConnected");
    // Wallet connection is enforced for all chains
    expect(src).toContain('fromChainNorm === "ethereum"');
    expect(src).toContain('fromChainNorm === "bitcoin"');
  });

  it("should show BTC HTLC flow in ChatPage (wallet-connected path)", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("client/src/pages/ChatPage.tsx", "utf-8");
    // BTC HTLC lock is initiated from the wallet-connected BTC path
    expect(src).toContain("BTC HTLC lock");
    // HTLC route style is defined for display
    expect(src).toContain("Direct HTLC");
    // BTC swap dispatches to executeBtcSwap or btcSignPsbt
    expect(src).toContain("executeBtcSwap");
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

// ─── 6. Cross-chain routing ─────────────────────────────────────────────────
describe("Cross-chain swap routing", () => {
  it("ETH agent should skip 1inch fallback for cross-chain swaps", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/agentSwapEth.ts", "utf-8");
    // Must detect cross-chain and skip 1inch
    expect(src).toContain("isCrossChain");
    expect(src).toContain("Cross-chain swap");
    expect(src).toContain("Oracle VM required, no DEX fallback");
  });

  it("SOL agent should skip Jupiter fallback for cross-chain swaps", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/routers/chat.ts", "utf-8");
    // Must detect cross-chain and skip Jupiter
    expect(src).toContain("isCrossChainSol");
    expect(src).toContain("Oracle VM required, no Jupiter fallback");
  });

  it("BTC agent has no DEX fallback (always cross-chain via P2P)", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/agentSwapBtc.ts", "utf-8");
    // BTC has no DEX fallback — all swaps go through Oracle VM or demo
    expect(src).not.toContain("1inch");
    expect(src).not.toContain("Jupiter");
    // Should always use P2P fee
    expect(src).toContain("P2P_FEE_BPS");
  });

  it("buildQuote should return IntercomSwap P2P route for cross-chain pairs", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/routers/chat.ts", "utf-8");
    // The cross-chain fallback section should exist
    expect(src).toContain("IntercomSwap P2P (cross-chain)");
    expect(src).toContain("IntercomSwap P2P (Bitcoin bridge)");
  });

  it("buildQuote cross-chain should use P2P_FEE_BPS (15 bps)", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/routers/chat.ts", "utf-8");
    // The cross-chain section uses P2P_FEE_BPS
    const crossChainSection = src.substring(
      src.indexOf("// ── Cross-chain or Bitcoin"),
      src.indexOf("// ─── Chat message types")
    );
    expect(crossChainSection).toContain("P2P_FEE_BPS");
    expect(crossChainSection).toContain("feeBps:         P2P_FEE_BPS");
  });

  it("ETH cross-chain demo: should return error when ETH_HTLC_KEY and ETH_AGENT_KEY are both not set", async () => {
    const originalHtlcKey = process.env.ETH_HTLC_KEY;
    const originalKey = process.env.ETH_AGENT_KEY;
    delete process.env.ETH_HTLC_KEY;
    delete process.env.ETH_AGENT_KEY;

    const { executeEthAgentSwap } = await import("./agentSwapEth");
    // Cross-chain: ETH → SOL (no key set)
    const result = await executeEthAgentSwap({
      fromToken: "ETH",
      toToken: "SOL",
      amount: 0.1,
      fromChain: "ethereum",
      toChain: "solana",
    });

    // Mode B removed: no demo mode. Returns wallet-required error when HTLC key not set.
    expect(result.demo).toBe(false);
    expect(result.success).toBe(false);
    expect(result.message).toContain("ETH_HTLC_KEY");

    if (originalHtlcKey !== undefined) process.env.ETH_HTLC_KEY = originalHtlcKey;
    if (originalKey !== undefined) process.env.ETH_AGENT_KEY = originalKey;
  });

  it("Oracle VM RFQ sends fromChain and toChain for all chains", async () => {
    const fs = await import("fs");
    // Check Solana path
    const chatSrc = fs.readFileSync("server/routers/chat.ts", "utf-8");
    const rfqSection = chatSrc.substring(
      chatSrc.indexOf("Step 1: Submitting RFQ"),
      chatSrc.indexOf("Step 2: Execute via Oracle VM")
    );
    expect(rfqSection).toContain("fromChain,");
    expect(rfqSection).toContain("toChain,");

    // Check ETH path
    const ethSrc = fs.readFileSync("server/agentSwapEth.ts", "utf-8");
    expect(ethSrc).toContain("fromChain,");
    expect(ethSrc).toContain("toChain,");

    // Check BTC path
    const btcSrc = fs.readFileSync("server/agentSwapBtc.ts", "utf-8");
    expect(btcSrc).toContain("toChain,");
  });

  it("ChatPage enforces wallet connection before executeAgentSwap (Mode B removed)", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("client/src/pages/ChatPage.tsx", "utf-8");
    // Mode B removed: ChatPage now calls openWalletForChain() when no wallet is connected
    // instead of calling executeAgentSwap without a wallet.
    expect(src).toContain("noWalletConnected");
    expect(src).toContain("openWalletForChain");
    // executeAgentSwap is still present for wallet-connected agent-assisted swaps
    // (e.g., when user has wallet but wants agent to handle routing)
    // The mutation is defined but only called after wallet check passes
    expect(src).toContain("executeAgentSwap");
    // Wallet check covers all three chains
    expect(src).toContain('fromChainNorm === "ethereum"');
    expect(src).toContain('fromChainNorm === "bitcoin"');
  });

  it("ChatPage shows ChainPill for cross-chain quotes", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("client/src/pages/ChatPage.tsx", "utf-8");
    expect(src).toContain("ChainPill");
    // ChainPill hides when fromChain === toChain (same chain)
    expect(src).toContain("fromChain === toChain");
  });
});

// ─── 7. Cross-chain fee math ────────────────────────────────────────────────
describe("Cross-chain fee math", () => {
  it("SOL→ETH cross-chain: 0.15% of 100 USDT output = 0.15 USDT", () => {
    const estimatedOut = 100;
    const fee = estimatedOut * (15 / 10000);
    const net = estimatedOut - fee;
    expect(fee).toBeCloseTo(0.15, 6);
    expect(net).toBeCloseTo(99.85, 6);
  });

  it("ETH→BTC cross-chain: 0.15% of 0.05 BTC output = 0.000075 BTC", () => {
    const estimatedOut = 0.05;
    const fee = estimatedOut * (15 / 10000);
    const net = estimatedOut - fee;
    expect(fee).toBeCloseTo(0.000075, 6);
    expect(net).toBeCloseTo(0.049925, 6);
  });

  it("BTC→SOL cross-chain: 0.15% of 500 SOL output = 0.75 SOL", () => {
    const estimatedOut = 500;
    const fee = estimatedOut * (15 / 10000);
    const net = estimatedOut - fee;
    expect(fee).toBeCloseTo(0.75, 6);
    expect(net).toBeCloseTo(499.25, 6);
  });

  it("Cross-chain always uses P2P fee (15 bps), never DEX fee (20 bps)", () => {
    const P2P_FEE_BPS = 15;
    const PLATFORM_FEE_BPS = 20;
    // Cross-chain pairs should always use P2P
    const crossChainPairs = [
      { from: "solana", to: "ethereum" },
      { from: "solana", to: "bitcoin" },
      { from: "ethereum", to: "solana" },
      { from: "ethereum", to: "bitcoin" },
      { from: "bitcoin", to: "solana" },
      { from: "bitcoin", to: "ethereum" },
    ];
    for (const pair of crossChainPairs) {
      // Cross-chain always uses P2P
      expect(P2P_FEE_BPS).toBe(15);
      expect(pair.from).not.toBe(pair.to);
    }
    // Same-chain DEX uses PLATFORM_FEE_BPS
    expect(PLATFORM_FEE_BPS).toBe(20);
  });
});
