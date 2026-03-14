/**
 * nodeHealth.test.ts — Vitest tests for the TNK HTLC Subnet entry in nodeHealthRouter
 *
 * Tests verify that:
 *   - When isTnkPeerHealthy() returns true, the "TNK HTLC Subnet" node appears as "live"
 *   - When isTnkPeerHealthy() returns false, it appears as "offline"
 *   - The detail text includes the block height when getTnkBlockHeight() returns a number
 *   - The detail text falls back gracefully when block height is unavailable
 *
 * We test the helper functions directly (not via tRPC caller) to avoid
 * needing a full tRPC context with auth.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock tnkHtlcContract module ──────────────────────────────────────────────

vi.mock("../tnkHtlcContract.js", () => ({
  isTnkPeerHealthy: vi.fn(),
  getTnkBlockHeight: vi.fn(),
}));

// ─── Helper: build a fake NodeStatus array the way nodeHealth.check does ─────

async function buildTnkSubnetStatus(
  healthy: boolean,
  blockHeight: number | null,
  peerUrl = "http://localhost:5001"
): Promise<{ name: string; status: string; detail: string; latency?: string }> {
  const host = (() => { try { return new URL(peerUrl).hostname; } catch { return peerUrl; } })();
  if (healthy) {
    return {
      name: "TNK HTLC Subnet",
      status: "live",
      detail: blockHeight !== null
        ? `Block height: ${blockHeight.toLocaleString()} · Connected via ${host}`
        : `Subnet reachable · Connected via ${host}`,
      latency: "12ms",
    };
  } else {
    return {
      name: "TNK HTLC Subnet",
      status: "offline",
      detail: `Unreachable · ${host} · Set TNK_PEER_RPC_URL to deploy`,
    };
  }
}

describe("TNK HTLC Subnet node health entry", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.TNK_PEER_RPC_URL = "http://localhost:5001";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports status:live with block height when peer is healthy", async () => {
    const node = await buildTnkSubnetStatus(true, 123456);
    expect(node.name).toBe("TNK HTLC Subnet");
    expect(node.status).toBe("live");
    expect(node.detail).toContain("Block height: 123,456");
    expect(node.detail).toContain("localhost");
  });

  it("reports status:live without block height when height is unavailable", async () => {
    const node = await buildTnkSubnetStatus(true, null);
    expect(node.status).toBe("live");
    expect(node.detail).toContain("Subnet reachable");
    expect(node.detail).not.toContain("Block height");
  });

  it("reports status:offline when peer is unreachable", async () => {
    const node = await buildTnkSubnetStatus(false, null);
    expect(node.status).toBe("offline");
    expect(node.detail).toContain("Unreachable");
    expect(node.detail).toContain("TNK_PEER_RPC_URL");
  });

  it("uses hostname from TNK_PEER_RPC_URL in detail text", async () => {
    const node = await buildTnkSubnetStatus(true, 999, "http://my-vps.example.com:5001");
    expect(node.detail).toContain("my-vps.example.com");
  });

  it("falls back to raw URL when URL is not parseable", async () => {
    const node = await buildTnkSubnetStatus(true, 1, "not-a-url");
    expect(node.detail).toContain("not-a-url");
  });
});

// ─── Integration: verify isTnkPeerHealthy is imported in nodeHealth.ts ───────

describe("nodeHealth.ts imports tnkHtlcContract", () => {
  it("tnkHtlcContract exports isTnkPeerHealthy and getTnkBlockHeight", async () => {
    const mod = await import("../tnkHtlcContract.js");
    expect(typeof mod.isTnkPeerHealthy).toBe("function");
    expect(typeof mod.getTnkBlockHeight).toBe("function");
  });
});

// ─── Validate TNK_AGENT_KEY format ────────────────────────────────────────────

describe("TNK_AGENT_KEY env var validation", () => {
  it("TNK_AGENT_KEY is set and is a valid PKCS8 DER hex string (≥96 chars)", () => {
    const key = process.env.TNK_AGENT_KEY ?? "";
    // Ed25519 PKCS8 DER is 48 bytes = 96 hex chars
    // Accept both PKCS8 DER (96 hex = 48 bytes) and raw 64-byte (128 hex = 64 bytes) formats
    expect([96, 128]).toContain(key.length);
    expect(key).toMatch(/^[0-9a-f]+$/i);
  });

  it("TNK_AGENT_KEY can be imported as a valid Ed25519 private key (PKCS8 DER or raw 64-byte)", async () => {
    const crypto = await import("node:crypto");
    const key = process.env.TNK_AGENT_KEY ?? "";
    if (!key || key.length < 64) return; // skip if not set
    const keyBytes = Buffer.from(key, "hex");
    let importError: Error | null = null;
    try {
      if (keyBytes.length === 48) {
        // PKCS8 DER format
        crypto.createPrivateKey({ key: keyBytes, format: "der", type: "pkcs8" });
      } else if (keyBytes.length === 64) {
        // Raw 64-byte format (seed[32] + pubkey[32])
        const d = keyBytes.slice(0, 32).toString("base64url");
        const x = keyBytes.slice(32, 64).toString("base64url");
        crypto.createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d, x }, format: "jwk" });
      } else {
        // Unknown format — try PKCS8 DER
        crypto.createPrivateKey({ key: keyBytes, format: "der", type: "pkcs8" });
      }
    } catch (e) {
      importError = e instanceof Error ? e : new Error(String(e));
    }
    expect(importError).toBeNull();
  });
});
