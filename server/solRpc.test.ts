import { describe, it, expect } from "vitest";

describe("SOL RPC URL validation", () => {
  it("VITE_SOL_RPC_URL should be set", () => {
    const url = process.env.VITE_SOL_RPC_URL;
    expect(url).toBeDefined();
    expect(url).toMatch(/^https?:\/\//);
  });

  it("VITE_SOL_RPC_URL should return a valid blockhash", async () => {
    const url = process.env.VITE_SOL_RPC_URL!;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getLatestBlockhash",
        params: [{ commitment: "confirmed" }],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result?.value?.blockhash).toBeDefined();
    expect(typeof data.result.value.blockhash).toBe("string");
    expect(data.result.value.blockhash.length).toBeGreaterThan(20);
  });
});
