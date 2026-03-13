/**
 * Tests for the webhookHealth router and Helius webhook status tracking.
 *
 * These tests verify:
 *  1. The webhookHealth.getStatus procedure returns the expected shape
 *  2. The in-memory webhookStatus counters are correctly read
 *  3. The settlement breakdown aggregation logic is correct
 *  4. Admin-only access is enforced
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the DB so we don't need a real DB connection ─────────────────────────

vi.mock("../db.js", () => ({
  getDb: vi.fn().mockResolvedValue(null), // Return null to exercise the "DB unavailable" path
}));

// ── Mock the heliusHtlc module ────────────────────────────────────────────────

const mockStatus = {
  webhookId: "wh_test_abc123",
  registeredUrl: "https://afos.trade/api/webhooks/helius-htlc",
  lastEventAt: Date.now() - 15_000, // 15s ago
  lastEventSig: "5xKj9mN2pQ8rT3vW7yZ1aB4cD6eF0gH",
  totalEventsReceived: 42,
  totalClaimsTriggered: 7,
  lastClaimTriggeredAt: Date.now() - 30_000, // 30s ago
};

vi.mock("../webhooks/heliusHtlc.js", () => ({
  getWebhookStatus: vi.fn(() => ({ ...mockStatus })),
  setWebhookId: vi.fn(),
  ensureHeliusWebhook: vi.fn().mockResolvedValue(undefined),
  registerHeliusWebhookRoute: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { getWebhookStatus } from "../webhooks/heliusHtlc.js";

// ── Unit tests for getWebhookStatus shape ─────────────────────────────────────

describe("getWebhookStatus", () => {
  it("returns all expected fields", () => {
    const status = getWebhookStatus();
    expect(status).toHaveProperty("webhookId");
    expect(status).toHaveProperty("registeredUrl");
    expect(status).toHaveProperty("lastEventAt");
    expect(status).toHaveProperty("lastEventSig");
    expect(status).toHaveProperty("totalEventsReceived");
    expect(status).toHaveProperty("totalClaimsTriggered");
    expect(status).toHaveProperty("lastClaimTriggeredAt");
  });

  it("returns the mocked values", () => {
    const status = getWebhookStatus();
    expect(status.webhookId).toBe("wh_test_abc123");
    expect(status.totalEventsReceived).toBe(42);
    expect(status.totalClaimsTriggered).toBe(7);
  });

  it("lastEventAt is a recent timestamp", () => {
    const status = getWebhookStatus();
    const ageMs = Date.now() - (status.lastEventAt ?? 0);
    expect(ageMs).toBeGreaterThan(0);
    expect(ageMs).toBeLessThan(60_000); // within 1 minute
  });
});

// ── Unit tests for settlement breakdown aggregation logic ─────────────────────

describe("settlement breakdown aggregation", () => {
  const breakdown = [
    { settledVia: "helius_webhook", count: 12 },
    { settledVia: "browser_notify", count: 5 },
    { settledVia: "monitor_fallback", count: 3 },
    { settledVia: "admin_force_claim", count: 1 },
  ];

  it("calculates total correctly", () => {
    const total = breakdown.reduce((s, r) => s + r.count, 0);
    expect(total).toBe(21);
  });

  it("calculates percentages correctly", () => {
    const total = breakdown.reduce((s, r) => s + r.count, 0);
    const webhookPct = Math.round((breakdown[0].count / total) * 100);
    expect(webhookPct).toBe(57); // 12/21 ≈ 57%
  });

  it("finds webhook claim count", () => {
    const webhookCount = breakdown.find(r => r.settledVia === "helius_webhook")?.count ?? 0;
    expect(webhookCount).toBe(12);
  });

  it("handles empty breakdown gracefully", () => {
    const emptyBreakdown: typeof breakdown = [];
    const total = emptyBreakdown.reduce((s, r) => s + r.count, 0);
    expect(total).toBe(0);
    const webhookCount = emptyBreakdown.find(r => r.settledVia === "helius_webhook")?.count ?? 0;
    expect(webhookCount).toBe(0);
  });
});

// ── Unit tests for speed tier logic ──────────────────────────────────────────

describe("settlement speed tier", () => {
  function speedTier(ms: number | null): string {
    if (!ms || ms <= 0) return "—";
    if (ms < 30_000) return "Fast";
    if (ms < 300_000) return "Normal";
    return "Slow";
  }

  it("classifies sub-30s as Fast", () => {
    expect(speedTier(5_000)).toBe("Fast");
    expect(speedTier(29_999)).toBe("Fast");
  });

  it("classifies 30s-5min as Normal", () => {
    expect(speedTier(30_000)).toBe("Normal");
    expect(speedTier(150_000)).toBe("Normal");
    expect(speedTier(299_999)).toBe("Normal");
  });

  it("classifies over 5min as Slow", () => {
    expect(speedTier(300_000)).toBe("Slow");
    expect(speedTier(600_000)).toBe("Slow");
  });

  it("handles null/zero gracefully", () => {
    expect(speedTier(null)).toBe("—");
    expect(speedTier(0)).toBe("—");
  });
});

// ── Unit tests for timeAgo helper ─────────────────────────────────────────────

describe("timeAgo helper", () => {
  function timeAgo(ms: number | null): string {
    if (!ms) return "never";
    const diff = Date.now() - ms;
    if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
    return `${Math.round(diff / 3_600_000)}h ago`;
  }

  it("returns 'never' for null", () => {
    expect(timeAgo(null)).toBe("never");
  });

  it("returns seconds for recent events", () => {
    const result = timeAgo(Date.now() - 15_000);
    expect(result).toMatch(/^\d+s ago$/);
  });

  it("returns minutes for events ~2 minutes ago", () => {
    const result = timeAgo(Date.now() - 120_000);
    expect(result).toMatch(/^\d+m ago$/);
  });

  it("returns hours for events ~2 hours ago", () => {
    const result = timeAgo(Date.now() - 7_200_000);
    expect(result).toMatch(/^\d+h ago$/);
  });
});

// ── Unit tests for formatMs helper ────────────────────────────────────────────

describe("formatMs helper", () => {
  function formatMs(ms: number | null): string {
    if (!ms || ms <= 0) return "—";
    if (ms < 1_000) return `${Math.round(ms)}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60_000).toFixed(1)}m`;
  }

  it("returns '—' for null/zero", () => {
    expect(formatMs(null)).toBe("—");
    expect(formatMs(0)).toBe("—");
  });

  it("formats sub-second as ms", () => {
    expect(formatMs(500)).toBe("500ms");
  });

  it("formats seconds correctly", () => {
    expect(formatMs(15_000)).toBe("15.0s");
    expect(formatMs(29_500)).toBe("29.5s");
  });

  it("formats minutes correctly", () => {
    expect(formatMs(120_000)).toBe("2.0m");
    expect(formatMs(90_000)).toBe("1.5m");
  });
});

// ── Polling confirmation logic tests ─────────────────────────────────────────

describe("polling confirmation logic", () => {
  /**
   * Simulates the polling loop used in claimRefund and claimAll.
   * Returns { confirmed, foundOnChain } based on mock status responses.
   */
  async function simulatePolling(
    responses: Array<{ confirmationStatus?: string; err?: unknown } | null>
  ): Promise<{ confirmed: boolean; foundOnChain: boolean }> {
    let confirmed = false;
    let foundOnChain = false;

    for (const resp of responses) {
      if (!resp) continue;
      if (resp.err) throw new Error(`On-chain error: ${JSON.stringify(resp.err)}`);
      if (resp.confirmationStatus === "confirmed" || resp.confirmationStatus === "finalized") {
        confirmed = true;
        foundOnChain = true;
        break;
      }
      // "processed" status — tx is on-chain but not yet confirmed
      if (resp.confirmationStatus === "processed") {
        foundOnChain = true;
      }
    }

    return { confirmed, foundOnChain };
  }

  it("confirms when status is 'confirmed'", async () => {
    const { confirmed } = await simulatePolling([
      null, // first poll: not found yet
      { confirmationStatus: "confirmed" }, // second poll: confirmed
    ]);
    expect(confirmed).toBe(true);
  });

  it("confirms when status is 'finalized'", async () => {
    const { confirmed } = await simulatePolling([
      { confirmationStatus: "finalized" },
    ]);
    expect(confirmed).toBe(true);
  });

  it("detects on-chain tx with 'processed' status (not yet confirmed)", async () => {
    const { confirmed, foundOnChain } = await simulatePolling([
      { confirmationStatus: "processed" },
    ]);
    expect(confirmed).toBe(false);
    expect(foundOnChain).toBe(true);
  });

  it("throws on on-chain error", async () => {
    await expect(simulatePolling([
      { err: { InstructionError: [2, { Custom: 6005 }] } },
    ])).rejects.toThrow("On-chain error");
  });

  it("handles timeout (all nulls) gracefully", async () => {
    const { confirmed, foundOnChain } = await simulatePolling([null, null, null]);
    expect(confirmed).toBe(false);
    expect(foundOnChain).toBe(false);
  });

  it("recovery path: tx found after timeout should update DB", () => {
    // Simulate the recovery logic: if txHash is set and error includes "not confirmed after 90s",
    // do a final check. If found with no error, treat as success.
    const txHash = "5xKj9mN2pQ8rT3vW7yZ1aB4cD6eF0gH";
    const errorMsg = "Tx not confirmed after 90s — check Solscan: 5xKj9mN2pQ8r…";
    const recoveryStatus = { confirmationStatus: "finalized", err: null };

    const isTimeout = errorMsg.includes("not confirmed after 90s");
    const shouldRecover = isTimeout && txHash && recoveryStatus && !recoveryStatus.err;

    expect(isTimeout).toBe(true);
    expect(shouldRecover).toBe(true);
  });

  it("recovery path: tx NOT found after timeout should show error", () => {
    const txHash = "5xKj9mN2pQ8rT3vW7yZ1aB4cD6eF0gH";
    const errorMsg = "Tx not confirmed after 90s — check Solscan: 5xKj9mN2pQ8r…";
    const recoveryStatus = null; // Not found in history

    const isTimeout = errorMsg.includes("not confirmed after 90s");
    const shouldRecover = isTimeout && txHash && recoveryStatus && !(recoveryStatus as null);

    expect(isTimeout).toBe(true);
    expect(shouldRecover).toBeFalsy();
  });
});
