/**
 * Tests for 0x API integration
 * Validates the ZEROX_API_KEY by calling the 0x price endpoint
 */
import { describe, it, expect } from "vitest";

describe("0x API integration", () => {
  it("ZEROX_API_KEY is set", () => {
    const key = process.env.ZEROX_API_KEY;
    expect(key).toBeTruthy();
    expect(typeof key).toBe("string");
    expect(key!.length).toBeGreaterThan(10);
  });

  it("can fetch a price quote from 0x API v2", async () => {
    const key = process.env.ZEROX_API_KEY;
    if (!key) {
      console.warn("ZEROX_API_KEY not set, skipping live test");
      return;
    }

    const params = new URLSearchParams({
      chainId: "1",
      sellToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
      buyToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",  // WETH (0x v2 uses WETH not native ETH)
      sellAmount: "1000000", // 1 USDC
    });

    const res = await fetch(`https://api.0x.org/swap/permit2/price?${params}`, {
      headers: { "0x-api-key": key, "0x-version": "v2" },
    });

    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.buyAmount).toBeTruthy();
    expect(Number(data.buyAmount)).toBeGreaterThan(0);
  }, 15000);

  it("VITE_ZEROX_API_KEY is set for frontend", () => {
    const key = process.env.VITE_ZEROX_API_KEY;
    expect(key).toBeTruthy();
    expect(typeof key).toBe("string");
  });
});
