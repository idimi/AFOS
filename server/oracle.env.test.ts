import { describe, it, expect } from "vitest";

describe("ORACLE_API_URL secret", () => {
  it("should be set in environment", () => {
    const url = process.env.ORACLE_API_URL;
    expect(url).toBeTruthy();
    expect(url).toMatch(/^https?:\/\//);
  });

  it("should be reachable (health check)", async () => {
    const url = process.env.ORACLE_API_URL || "http://141.253.123.101:4000";
    const res = await fetch(`${url}/api/agent/status`, {
      signal: AbortSignal.timeout(6000),
    });
    expect(res.ok).toBe(true);
    const json = await res.json() as Record<string, unknown>;
    expect(json).toHaveProperty("status");
    expect(json.success).toBe(true);
  });
});
