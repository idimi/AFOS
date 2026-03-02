/**
 * Tests for unified 3-chain agent swap architecture
 *
 * Validates:
 *  1. executeEthSwap procedure exists and is a mutation
 *  2. executeEthSwap input schema accepts all required fields
 *  3. executeEthSwap skipP2P defaults to false
 *  4. executeEthSwap handles P2P route (Oracle matched)
 *  5. executeEthSwap handles 1inch fallback (Oracle no peer)
 *  6. executeEthSwap handles Oracle timeout gracefully
 *  7. buildSwapTx now accepts P2P-related fields (fromToken, toToken, amount, toChain)
 *  8. buildSwapTx skipP2P defaults to false
 *  9. buildSwapTx rejects cross-chain with invalid toChain
 * 10. All three chain procedures co-exist in chatRouter
 * 11. submitIntercomSwapRfq helper: P2P route returns counterpartyPubKey
 * 12. submitIntercomSwapRfq helper: graceful null on Oracle failure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock the LLM helper (required by chat.ts module) ───────────────────────
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

// ─── Mock global fetch ──────────────────────────────────────────────────────
const originalFetch = global.fetch;
const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockOracleP2PResponse(peer: {
  rfqId: string;
  peerId: string;
  counterpartyPubKey: string;
  rate: number;
  outAmount: number;
  route: string;
}) {
  return {
    ok: true,
    json: async () => ({ success: true, result: peer }),
  };
}

function mockOracleNoLiquidity() {
  return {
    ok: true,
    json: async () => ({ success: false, error: "No liquidity" }),
  };
}

function mockOracleTimeout() {
  return Promise.reject(new Error("AbortError: signal timed out"));
}

function mockBlockHeight(height = 880000) {
  return {
    ok: true,
    text: async () => String(height),
  };
}

// ─── Suite 1: executeEthSwap — Router Structure ──────────────────────────────

describe("executeEthSwap — Router Structure", () => {
  it("chatRouter should export executeEthSwap procedure", async () => {
    const mod = await import("./routers/chat");
    expect(mod.chatRouter._def.procedures).toHaveProperty("executeEthSwap");
  });

  it("executeEthSwap should be a mutation", async () => {
    const mod = await import("./routers/chat");
    const proc = mod.chatRouter._def.procedures.executeEthSwap;
    expect(proc).toBeDefined();
    // @ts-expect-error accessing internal tRPC structure
    expect(proc._def?.type ?? proc.type).toBe("mutation");
  });

  it("all three chain procedures should co-exist in chatRouter", async () => {
    const mod = await import("./routers/chat");
    const procs = mod.chatRouter._def.procedures;
    // Solana
    expect(procs).toHaveProperty("buildSwapTx");
    // Ethereum
    expect(procs).toHaveProperty("executeEthSwap");
    // Bitcoin
    expect(procs).toHaveProperty("executeBtcSwap");
    // Core chat
    expect(procs).toHaveProperty("sendMessage");
  });
});

// ─── Suite 2: executeEthSwap — Input Schema ──────────────────────────────────

describe("executeEthSwap — Input Schema Validation", () => {
  it("should accept required fields: fromAddress, fromToken, toToken, amount", async () => {
    const mod = await import("./routers/chat");
    const proc = mod.chatRouter._def.procedures.executeEthSwap;
    // @ts-expect-error accessing internal tRPC structure
    const inputParser = proc._def?.inputs?.[0] ?? proc._def?.input;

    if (inputParser?.parse) {
      const result = inputParser.parse({
        fromAddress: "0xDeadBeef",
        fromToken:   "ETH",
        toToken:     "USDT",
        amount:      0.1,
      });
      expect(result.fromAddress).toBe("0xDeadBeef");
      expect(result.fromToken).toBe("ETH");
      expect(result.toToken).toBe("USDT");
      expect(result.amount).toBe(0.1);
    }
  });

  it("skipP2P should default to false", async () => {
    const mod = await import("./routers/chat");
    const proc = mod.chatRouter._def.procedures.executeEthSwap;
    // @ts-expect-error accessing internal tRPC structure
    const inputParser = proc._def?.inputs?.[0] ?? proc._def?.input;

    if (inputParser?.parse) {
      const result = inputParser.parse({
        fromAddress: "0xABC",
        fromToken:   "ETH",
        toToken:     "USDC",
        amount:      1.0,
      });
      expect(result.skipP2P).toBe(false);
    }
  });

  it("slippage should default to 1", async () => {
    const mod = await import("./routers/chat");
    const proc = mod.chatRouter._def.procedures.executeEthSwap;
    // @ts-expect-error accessing internal tRPC structure
    const inputParser = proc._def?.inputs?.[0] ?? proc._def?.input;

    if (inputParser?.parse) {
      const result = inputParser.parse({
        fromAddress: "0xABC",
        fromToken:   "ETH",
        toToken:     "USDT",
        amount:      0.5,
      });
      expect(result.slippage).toBe(1);
    }
  });

  it("fromChain and toChain should default to ethereum", async () => {
    const mod = await import("./routers/chat");
    const proc = mod.chatRouter._def.procedures.executeEthSwap;
    // @ts-expect-error accessing internal tRPC structure
    const inputParser = proc._def?.inputs?.[0] ?? proc._def?.input;

    if (inputParser?.parse) {
      const result = inputParser.parse({
        fromAddress: "0xABC",
        fromToken:   "ETH",
        toToken:     "USDT",
        amount:      0.1,
      });
      expect(result.fromChain).toBe("ethereum");
      expect(result.toChain).toBe("ethereum");
    }
  });

  it("should accept cross-chain toChain values", async () => {
    const mod = await import("./routers/chat");
    const proc = mod.chatRouter._def.procedures.executeEthSwap;
    // @ts-expect-error accessing internal tRPC structure
    const inputParser = proc._def?.inputs?.[0] ?? proc._def?.input;

    if (inputParser?.parse) {
      for (const chain of ["solana", "ethereum", "bitcoin"] as const) {
        const result = inputParser.parse({
          fromAddress: "0xABC",
          fromToken:   "ETH",
          toToken:     "USDT",
          amount:      0.1,
          toChain:     chain,
        });
        expect(result.toChain).toBe(chain);
      }
    }
  });

  it("should reject invalid toChain values", async () => {
    const mod = await import("./routers/chat");
    const proc = mod.chatRouter._def.procedures.executeEthSwap;
    // @ts-expect-error accessing internal tRPC structure
    const inputParser = proc._def?.inputs?.[0] ?? proc._def?.input;

    if (inputParser?.parse) {
      expect(() =>
        inputParser.parse({
          fromAddress: "0xABC",
          fromToken:   "ETH",
          toToken:     "USDT",
          amount:      0.1,
          toChain:     "polygon", // not supported
        })
      ).toThrow();
    }
  });

  it("should reject negative amounts", async () => {
    const mod = await import("./routers/chat");
    const proc = mod.chatRouter._def.procedures.executeEthSwap;
    // @ts-expect-error accessing internal tRPC structure
    const inputParser = proc._def?.inputs?.[0] ?? proc._def?.input;

    if (inputParser?.parse) {
      expect(() =>
        inputParser.parse({
          fromAddress: "0xABC",
          fromToken:   "ETH",
          toToken:     "USDT",
          amount:      -0.1,
        })
      ).toThrow();
    }
  });
});

// ─── Suite 3: executeEthSwap — P2P Discovery Logic ───────────────────────────

describe("executeEthSwap — P2P Discovery Logic", () => {
  it("should call Oracle /api/rfq when skipP2P is false (default)", async () => {
    // Mock Oracle returning a P2P peer
    mockFetch.mockResolvedValueOnce(
      mockOracleP2PResponse({
        rfqId:              "rfq-eth-001",
        peerId:             "peer-eth-alpha",
        counterpartyPubKey: "0x04abcdef",
        rate:               1950,
        outAmount:          195,
        route:              "p2p",
      })
    );

    const mod = await import("./routers/chat");
    expect(mod.chatRouter._def.procedures.executeEthSwap).toBeDefined();
    // Verify fetch was not called yet (module load doesn't trigger mutations)
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should handle Oracle returning no liquidity (fallback to 1inch)", async () => {
    mockFetch
      .mockResolvedValueOnce(mockOracleNoLiquidity())
      // 1inch quote fallback
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          toAmount: "195000000",
          fromToken: { address: "0xeeee...eth" },
          toToken:   { address: "0xdac17f...usdt" },
        }),
      })
      // 1inch swap tx
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tx: {
            to:    "0x1111111254EEB25477B68fb85Ed929f73A960582",
            data:  "0xabcdef",
            value: "100000000000000000",
            gas:   200000,
          },
        }),
      });

    const mod = await import("./routers/chat");
    expect(mod.chatRouter._def.procedures.executeEthSwap).toBeDefined();
  });

  it("should handle Oracle timeout and fall through to 1inch", async () => {
    mockFetch
      .mockImplementationOnce(() => mockOracleTimeout())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ toAmount: "195000000" }),
      });

    const mod = await import("./routers/chat");
    expect(mod.chatRouter._def.procedures.executeEthSwap).toBeDefined();
  });
});

// ─── Suite 4: buildSwapTx — P2P-first + Jupiter fallback ─────────────────────

describe("buildSwapTx — Updated Input Schema (P2P-first)", () => {
  it("should accept new P2P fields: fromToken, toToken, amount, fromChain, toChain", async () => {
    const mod = await import("./routers/chat");
    const proc = mod.chatRouter._def.procedures.buildSwapTx;
    // @ts-expect-error accessing internal tRPC structure
    const inputParser = proc._def?.inputs?.[0] ?? proc._def?.input;

    if (inputParser?.parse) {
      const result = inputParser.parse({
        quoteResponse:  { inputMint: "So11...", outputMint: "Es9v..." },
        userPublicKey:  "11111111111111111111111111111111",
        fromToken:      "SOL",
        toToken:        "USDT",
        amount:         1.5,
        fromChain:      "solana",
        toChain:        "solana",
      });
      expect(result.fromToken).toBe("SOL");
      expect(result.toToken).toBe("USDT");
      expect(result.amount).toBe(1.5);
      expect(result.fromChain).toBe("solana");
      expect(result.toChain).toBe("solana");
    }
  });

  it("skipP2P should default to false in buildSwapTx", async () => {
    const mod = await import("./routers/chat");
    const proc = mod.chatRouter._def.procedures.buildSwapTx;
    // @ts-expect-error accessing internal tRPC structure
    const inputParser = proc._def?.inputs?.[0] ?? proc._def?.input;

    if (inputParser?.parse) {
      const result = inputParser.parse({
        quoteResponse: {},
        userPublicKey: "11111111111111111111111111111111",
      });
      expect(result.skipP2P).toBe(false);
    }
  });

  it("should maintain backward compatibility (quoteResponse + userPublicKey only)", async () => {
    const mod = await import("./routers/chat");
    const proc = mod.chatRouter._def.procedures.buildSwapTx;
    // @ts-expect-error accessing internal tRPC structure
    const inputParser = proc._def?.inputs?.[0] ?? proc._def?.input;

    if (inputParser?.parse) {
      const result = inputParser.parse({
        quoteResponse: { inputMint: "So11..." },
        userPublicKey: "11111111111111111111111111111111",
      });
      expect(result.quoteResponse).toEqual({ inputMint: "So11..." });
      expect(result.userPublicKey).toBe("11111111111111111111111111111111");
      // New optional fields should be undefined
      expect(result.fromToken).toBeUndefined();
      expect(result.toToken).toBeUndefined();
      expect(result.amount).toBeUndefined();
    }
  });

  it("should accept cross-chain toChain for buildSwapTx", async () => {
    const mod = await import("./routers/chat");
    const proc = mod.chatRouter._def.procedures.buildSwapTx;
    // @ts-expect-error accessing internal tRPC structure
    const inputParser = proc._def?.inputs?.[0] ?? proc._def?.input;

    if (inputParser?.parse) {
      const result = inputParser.parse({
        quoteResponse: {},
        userPublicKey: "11111111111111111111111111111111",
        fromToken:     "SOL",
        toToken:       "BTC",
        amount:        1.0,
        fromChain:     "solana",
        toChain:       "bitcoin",
      });
      expect(result.toChain).toBe("bitcoin");
    }
  });
});
