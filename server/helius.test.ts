/**
 * Validate that the HELIUS_API_KEY env var is set and the RPC endpoint responds.
 */
import { describe, it, expect } from "vitest";
import "dotenv/config";

describe("Helius RPC", () => {
  it("should respond to getSlot with a valid API key", async () => {
    const apiKey = process.env.HELIUS_API_KEY;
    expect(apiKey, "HELIUS_API_KEY must be set").toBeTruthy();

    const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot", params: [] }),
      signal: AbortSignal.timeout(10000),
    });

    expect(res.ok, `Helius RPC returned HTTP ${res.status}`).toBe(true);
    const json = await res.json() as { result?: number; error?: unknown };
    expect(json.error, `Helius RPC error: ${JSON.stringify(json.error)}`).toBeUndefined();
    expect(typeof json.result).toBe("number");
    expect(json.result).toBeGreaterThan(0);
    console.log(`[Helius] Current slot: ${json.result}`);
  }, 15000);
});
