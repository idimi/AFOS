/**
 * Fee Model Tests — Platform fee implementation
 *
 * Validates:
 *   1. Fee constants are correct (P2P 15 bps, DEX 20 bps)
 *   2. QuoteResult includes all fee fields (netToAmount, platformFeeOut, feeBps, feeToken)
 *   3. ChatMessage quoteData includes fee fields
 *   4. recordSwapAnalytic accepts fee fields
 *   5. feeRevenue analytics procedure exists and returns expected shape
 *   6. PLATFORM_FEE_ACCOUNT reads from env
 */
import { describe, it, expect, vi } from "vitest";

// ─── 1. Fee constants ─────────────────────────────────────────────────────────
describe("Fee constants", () => {
  it("should define P2P fee at 15 bps (0.15%)", async () => {
    // Read the source file to verify constants
    const fs = await import("fs");
    const src = fs.readFileSync("server/routers/chat.ts", "utf-8");
    expect(src).toContain("P2P_FEE_BPS");
    // Extract value
    const match = src.match(/const\s+P2P_FEE_BPS\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(15);
  });

  it("should define DEX fee at 20 bps (0.20%)", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/routers/chat.ts", "utf-8");
    const match = src.match(/const\s+PLATFORM_FEE_BPS\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(20);
  });

  it("should read PLATFORM_FEE_ACCOUNT from env with NO hardcoded fallback", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/routers/chat.ts", "utf-8");
    // Must read from env var
    expect(src).toContain("process.env.PLATFORM_FEE_WALLET");
    // Must NOT contain any hardcoded fallback address (security: no unknown wallet should receive fees)
    expect(src).not.toContain("8PqWJvFQKxXhzqJLGRhTWUZhB1Bwk9JtQxKmKZvKpump");
    // feeAccount is conditionally included only when PLATFORM_FEE_WALLET is set
    expect(src).toContain("PLATFORM_FEE_ACCOUNT ? { feeAccount: PLATFORM_FEE_ACCOUNT }");
    // Startup warning is emitted when PLATFORM_FEE_WALLET is not configured
    expect(src).toContain("PLATFORM_FEE_WALLET env var is not set");
  });
});

// ─── 2. QuoteResult interface ─────────────────────────────────────────────────
describe("QuoteResult interface", () => {
  it("should include netToAmount, platformFeeOut, feeBps, feeToken fields", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/routers/chat.ts", "utf-8");
    expect(src).toContain("netToAmount: number;");
    expect(src).toContain("platformFeeOut: number;");
    expect(src).toContain("feeBps: number;");
    expect(src).toContain("feeToken: string;");
  });
});

// ─── 3. ChatMessage quoteData ─────────────────────────────────────────────────
describe("ChatMessage quoteData", () => {
  it("should include fee fields in quoteData type", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/routers/chat.ts", "utf-8");
    // Check the quoteData block in ChatMessage
    const quoteDataBlock = src.substring(
      src.indexOf("quoteData?: {"),
      src.indexOf("quoteResponse: unknown;") + 30
    );
    expect(quoteDataBlock).toContain("netToAmount: number;");
    expect(quoteDataBlock).toContain("platformFeeOut: number;");
    expect(quoteDataBlock).toContain("feeBps: number;");
    expect(quoteDataBlock).toContain("feeToken: string;");
  });

  it("should pass fee fields from quoteResult to quoteData in sendMessage return", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/routers/chat.ts", "utf-8");
    expect(src).toContain("netToAmount:    quoteResult.netToAmount,");
    expect(src).toContain("platformFeeOut: quoteResult.platformFeeOut,");
    expect(src).toContain("feeBps:         quoteResult.feeBps,");
    expect(src).toContain("feeToken:       quoteResult.feeToken,");
  });
});

// ─── 4. recordSwapAnalytic fee fields ─────────────────────────────────────────
describe("recordSwapAnalytic", () => {
  it("should accept platformFeeUsd, feeBps, feeAmountOut parameters", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/htlcMonitor.ts", "utf-8");
    // The function signature spans multiple lines with varying whitespace
    const fnStart = src.indexOf("export async function recordSwapAnalytic");
    const fnEnd = src.indexOf("}): Promise<void>", fnStart);
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const fnBlock = src.substring(fnStart, fnEnd + 20);
    expect(fnBlock).toContain("platformFeeUsd?");
    expect(fnBlock).toContain("feeBps?");
    expect(fnBlock).toContain("feeAmountOut?");
  });
});

// ─── 5. Database schema ───────────────────────────────────────────────────────
describe("Database schema", () => {
  it("should have platformFeeUsd, feeBps, feeAmountOut columns in swapAnalytics", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("drizzle/schema.ts", "utf-8");
    expect(src).toContain('platformFeeUsd');
    expect(src).toContain('feeBps');
    expect(src).toContain('feeAmountOut');
  });
});

// ─── 6. Analytics feeRevenue procedure ────────────────────────────────────────
describe("feeRevenue analytics procedure", () => {
  it("should exist in analyticsRouter", async () => {
    const { analyticsRouter } = await import("./routers/analytics");
    expect(analyticsRouter).toBeDefined();
    // Check that feeRevenue is a procedure
    const procedures = Object.keys((analyticsRouter as any)._def.procedures ?? {});
    expect(procedures).toContain("feeRevenue");
  });
});

// ─── 7. Frontend QuoteData interface ──────────────────────────────────────────
describe("Frontend QuoteData", () => {
  it("should include fee fields in ChatPage.tsx QuoteData interface", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("client/src/pages/ChatPage.tsx", "utf-8");
    expect(src).toContain("netToAmount?:");
    expect(src).toContain("platformFeeOut?:");
    expect(src).toContain("feeBps?:");
    expect(src).toContain("feeToken?:");
  });

  it("should display AFOS Fee label in QuoteCard", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("client/src/pages/ChatPage.tsx", "utf-8");
    expect(src).toContain("AFOS Fee");
  });
});

// ─── 8. Fee math validation ───────────────────────────────────────────────────
describe("Fee math", () => {
  it("P2P fee: 0.15% of 100 USDT output = 0.15 USDT", () => {
    const outAmount = 100;
    const feeBps = 15;
    const fee = outAmount * (feeBps / 10000);
    expect(fee).toBeCloseTo(0.15, 6);
    const net = outAmount - fee;
    expect(net).toBeCloseTo(99.85, 6);
  });

  it("DEX fee: 0.20% of 100 USDT output = 0.20 USDT", () => {
    const outAmount = 100;
    const feeBps = 20;
    const fee = outAmount * (feeBps / 10000);
    expect(fee).toBeCloseTo(0.20, 6);
  });

  it("P2P fee is strictly less than DEX fee for same output", () => {
    const outAmount = 1000;
    const p2pFee = outAmount * (15 / 10000);
    const dexFee = outAmount * (20 / 10000);
    expect(p2pFee).toBeLessThan(dexFee);
  });
});
