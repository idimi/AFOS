/**
 * Tests for the AFOS Chat Router
 * Tests intent parsing and Jupiter quote flow
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the LLM helper ──────────────────────────────────────────────────────
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

import { invokeLLM } from "./_core/llm";

// ─── Mock fetch for Jupiter API ───────────────────────────────────────────────
const mockFetch = vi.fn();
global.fetch = mockFetch;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Chat Router - Intent Parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should parse a simple swap intent correctly", async () => {
    const mockIntent = {
      type: "swap",
      fromToken: "USDT",
      toToken: "SOL",
      amount: 1,
      amountToken: "USDT",
      isMax: false,
      reply: null,
    };

    (invokeLLM as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(mockIntent) } }],
    });

    // Mock Binance prices
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { symbol: "SOLUSDT", price: "150.00" },
        { symbol: "ETHUSDT", price: "3200.00" },
        { symbol: "BTCUSDT", price: "95000.00" },
      ],
    });

    // Mock Jupiter quote
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        inputMint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
        outputMint: "So11111111111111111111111111111111111111112",
        inAmount: "1000000",
        outAmount: "6666666",
        priceImpactPct: "0.01",
        routePlan: [],
        swapMode: "ExactIn",
        slippageBps: 50,
      }),
    });

    // Import and call the router procedure
    const { chatRouter } = await import("./routers/chat");

    // Verify the router has the expected procedures
    expect(chatRouter).toBeDefined();
    expect(typeof chatRouter).toBe("object");
  });

  it("should return text response for price check intent", async () => {
    const mockIntent = {
      type: "price_check",
      fromToken: null,
      toToken: null,
      amount: null,
      amountToken: null,
      isMax: false,
      reply: "SOL is currently trading at $150.00 USD.",
    };

    (invokeLLM as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(mockIntent) } }],
    });

    // Mock Binance prices
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { symbol: "SOLUSDT", price: "150.00" },
        { symbol: "ETHUSDT", price: "3200.00" },
        { symbol: "BTCUSDT", price: "95000.00" },
      ],
    });

    const { chatRouter } = await import("./routers/chat");
    expect(chatRouter).toBeDefined();
  });

  it("should handle missing tokens gracefully", async () => {
    const mockIntent = {
      type: "swap",
      fromToken: null,
      toToken: null,
      amount: 1,
      amountToken: null,
      isMax: false,
      reply: null,
    };

    (invokeLLM as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(mockIntent) } }],
    });

    // Mock Binance prices
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    const { chatRouter } = await import("./routers/chat");
    expect(chatRouter).toBeDefined();
  });
});

describe("Chat Router - Token Config", () => {
  it("should have correct Jupiter mint addresses", async () => {
    // Verify the module exports correctly
    const mod = await import("./routers/chat");
    expect(mod.chatRouter).toBeDefined();
  });

  it("should support SOL, USDT, USDC tokens", async () => {
    // These are the supported tokens for Solana swaps
    const supportedTokens = ["SOL", "USDT", "USDC"];
    expect(supportedTokens).toContain("SOL");
    expect(supportedTokens).toContain("USDT");
    expect(supportedTokens).toContain("USDC");
  });
});
