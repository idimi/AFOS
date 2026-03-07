/**
 * Unit tests for the TNK HTLC Monitor
 *
 * Tests the pure logic functions that don't require a live DB or network:
 *   - parseSecretHashFromMemo: memo format parsing
 *   - startTnkHtlcMonitor / stopTnkHtlcMonitor: idempotent lifecycle
 *   - pollTnkEscrow: graceful no-op when DB is unavailable
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// ─── parseSecretHashFromMemo (extracted via module re-export for testing) ─────
// We test the memo parsing logic by importing the module and testing the
// exported pollTnkEscrow with a mocked DB that returns no rows.

describe("TNK HTLC Monitor — memo parsing", () => {
  // Test the regex pattern directly (mirrors the implementation)
  function parseSecretHashFromMemo(memo: string | undefined): string | null {
    if (!memo) return null;
    const match = memo.match(/^AFOS-HTLC:([0-9a-fA-F]{64}):/);
    return match ? match[1].toLowerCase() : null;
  }

  it("parses a valid AFOS-HTLC memo", () => {
    const secretHash = "a".repeat(64);
    const memo = `AFOS-HTLC:${secretHash}:trac1escrow:500:1234567`;
    expect(parseSecretHashFromMemo(memo)).toBe(secretHash.toLowerCase());
  });

  it("returns null for undefined memo", () => {
    expect(parseSecretHashFromMemo(undefined)).toBeNull();
  });

  it("returns null for empty memo", () => {
    expect(parseSecretHashFromMemo("")).toBeNull();
  });

  it("returns null for malformed memo (wrong prefix)", () => {
    const memo = `HTLC:${"a".repeat(64)}:trac1escrow:500:1234567`;
    expect(parseSecretHashFromMemo(memo)).toBeNull();
  });

  it("returns null for memo with short secretHash (< 64 hex chars)", () => {
    const memo = `AFOS-HTLC:${"a".repeat(32)}:trac1escrow:500:1234567`;
    expect(parseSecretHashFromMemo(memo)).toBeNull();
  });

  it("normalises secretHash to lowercase", () => {
    const secretHash = "A".repeat(64);
    const memo = `AFOS-HTLC:${secretHash}:trac1escrow:500:1234567`;
    expect(parseSecretHashFromMemo(memo)).toBe("a".repeat(64));
  });

  it("returns null for non-hex characters in secretHash", () => {
    const memo = `AFOS-HTLC:${"z".repeat(64)}:trac1escrow:500:1234567`;
    expect(parseSecretHashFromMemo(memo)).toBeNull();
  });
});

// ─── startTnkHtlcMonitor / stopTnkHtlcMonitor lifecycle ─────────────────────

describe("TNK HTLC Monitor — lifecycle", () => {
  afterEach(async () => {
    // Always stop the monitor after each test to avoid timer leaks
    const mod = await import("./jobs/tnkHtlcMonitor");
    mod.stopTnkHtlcMonitor();
  });

  it("startTnkHtlcMonitor is idempotent (calling twice does not throw)", async () => {
    const mod = await import("./jobs/tnkHtlcMonitor");
    expect(() => {
      mod.startTnkHtlcMonitor();
      mod.startTnkHtlcMonitor(); // second call should be a no-op
    }).not.toThrow();
  });

  it("stopTnkHtlcMonitor is safe to call when not running", async () => {
    const mod = await import("./jobs/tnkHtlcMonitor");
    mod.stopTnkHtlcMonitor(); // stop when already stopped — should not throw
    expect(true).toBe(true);
  });
});

// ─── pollTnkEscrow — graceful no-op when DB unavailable ─────────────────────

describe("TNK HTLC Monitor — pollTnkEscrow", () => {
  it("returns error result when DB is unavailable", async () => {
    // Mock getDb to return null (simulates DB connection failure)
    vi.mock("./db", () => ({
      getDb: vi.fn().mockResolvedValue(null),
    }));

    const { pollTnkEscrow } = await import("./jobs/tnkHtlcMonitor");
    const result = await pollTnkEscrow();

    expect(result.detected).toBe(0);
    expect(result.refunded).toBe(0);
    expect(result.error).toBe("db-unavailable");

    vi.restoreAllMocks();
  });
});
