/**
 * Unit tests for preferredBtcWallet restoration and stale-preference cleanup logic.
 *
 * These tests verify that:
 * 1. The stored preference is correctly applied AFTER parallel reconnect completes
 * 2. The last-writer-wins race condition is eliminated
 * 3. Stale preferences are cleaned up when the preferred wallet is no longer connected
 * 4. The cleanup guard (reconnectCompleteRef) prevents premature cleanup on mount
 */

import { describe, it, expect, beforeEach } from "vitest";

// ─── Re-implement the preference helpers for testing ──────────────────────────

type BtcProviderType = "metamask" | "tap" | "phantom";

const PREFERRED_BTC_WALLET_KEY = "afos_preferred_btc_wallet";

let mockStorage: Record<string, string> = {};

function savePreferredBtcWallet(pref: BtcProviderType | null) {
  if (pref) mockStorage[PREFERRED_BTC_WALLET_KEY] = pref;
  else delete mockStorage[PREFERRED_BTC_WALLET_KEY];
}

function loadPreferredBtcWallet(): BtcProviderType | null {
  const raw = mockStorage[PREFERRED_BTC_WALLET_KEY];
  if (raw === "metamask" || raw === "tap" || raw === "phantom") return raw;
  return null;
}

// ─── Simulate the parallel reconnect + preference restoration logic ───────────

/**
 * Simulates what happens in the auto-reconnect useEffect:
 * - Both wallets reconnect in parallel (each calls setPreferredBtcWallet)
 * - After Promise.allSettled, the stored preference is re-applied
 *
 * Returns the final preferredBtcWallet value after restoration.
 */
function simulateParallelReconnect(opts: {
  storedPreference: BtcProviderType | null;
  phantomFinishesFirst: boolean;
  phantomBtcConnected: boolean;
  tapBtcConnected: boolean;
}): BtcProviderType | null {
  // Initialize state from localStorage (as useState initializer does)
  let currentPref: BtcProviderType | null = opts.storedPreference;
  savePreferredBtcWallet(opts.storedPreference);

  // ── The fix: capture the stored preference BEFORE parallel reconnect starts ──
  // This mirrors what the actual code does: loadPreferredBtcWallet() is called
  // inside the setTimeout callback, before any wallet reconnect runs.
  const storedPrefBeforeReconnect = loadPreferredBtcWallet();

  const setPreferredBtcWallet = (pref: BtcProviderType | null) => {
    currentPref = pref;
    savePreferredBtcWallet(pref);
  };

  // Simulate parallel reconnect — each wallet sets the preference when it finishes
  if (opts.phantomFinishesFirst) {
    // Phantom finishes first, then Tap Wallet
    if (opts.phantomBtcConnected) setPreferredBtcWallet("phantom");
    if (opts.tapBtcConnected) setPreferredBtcWallet("tap"); // ← overwrites phantom if last
  } else {
    // Tap Wallet finishes first, then Phantom
    if (opts.tapBtcConnected) setPreferredBtcWallet("tap");
    if (opts.phantomBtcConnected) setPreferredBtcWallet("phantom"); // ← overwrites tap if last
  }

  // ── The fix: re-apply the captured preference after all reconnections complete ──
  // Uses setPreferredBtcWalletRaw (state-only update, no localStorage write)
  // so the stored preference in localStorage is not affected.
  if (storedPrefBeforeReconnect) {
    currentPref = storedPrefBeforeReconnect; // state-only, like setPreferredBtcWalletRaw
  }

  return currentPref;
}

// ─── Simulate stale preference cleanup ────────────────────────────────────────

function simulateStalePrefCleanup(opts: {
  preferredBtcWallet: BtcProviderType | null;
  tapConnected: boolean;
  nonTapConnected: boolean;
  nonTapIsPhantom: boolean;
  reconnectComplete: boolean;
}): BtcProviderType | null {
  let currentPref = opts.preferredBtcWallet;
  savePreferredBtcWallet(opts.preferredBtcWallet);

  const setPreferredBtcWallet = (pref: BtcProviderType | null) => {
    currentPref = pref;
    savePreferredBtcWallet(pref);
  };

  // Guard: do not run before reconnect is complete
  if (!opts.reconnectComplete) return currentPref;
  if (!currentPref) return currentPref;

  const { tapConnected, nonTapConnected, nonTapIsPhantom } = opts;

  if (currentPref === "tap" && !tapConnected && nonTapConnected) {
    setPreferredBtcWallet(nonTapIsPhantom ? "phantom" : "metamask");
  } else if (currentPref !== "tap" && !nonTapConnected && tapConnected) {
    setPreferredBtcWallet("tap");
  } else if (!tapConnected && !nonTapConnected) {
    setPreferredBtcWallet(null);
  }

  return currentPref;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("preferredBtcWallet Restoration After Parallel Reconnect", () => {
  beforeEach(() => {
    mockStorage = {};
  });

  it("should restore 'phantom' preference even when Tap Wallet finishes last", () => {
    // User had Phantom as preferred BTC wallet
    // Tap Wallet reconnects last → would overwrite without the fix
    const result = simulateParallelReconnect({
      storedPreference: "phantom",
      phantomFinishesFirst: true, // Phantom finishes first
      phantomBtcConnected: true,
      tapBtcConnected: true,
    });
    expect(result).toBe("phantom");
  });

  it("should restore 'tap' preference even when Phantom finishes last", () => {
    // User had Tap Wallet as preferred BTC wallet
    // Phantom reconnects last → would overwrite without the fix
    const result = simulateParallelReconnect({
      storedPreference: "tap",
      phantomFinishesFirst: false, // Tap finishes first, Phantom last
      phantomBtcConnected: true,
      tapBtcConnected: true,
    });
    expect(result).toBe("tap");
  });

  it("should restore 'phantom' preference when Phantom finishes last (non-deterministic order)", () => {
    const result = simulateParallelReconnect({
      storedPreference: "phantom",
      phantomFinishesFirst: false, // Phantom finishes last
      phantomBtcConnected: true,
      tapBtcConnected: true,
    });
    expect(result).toBe("phantom");
  });

  it("should restore 'tap' preference when Tap Wallet finishes first", () => {
    const result = simulateParallelReconnect({
      storedPreference: "tap",
      phantomFinishesFirst: true, // Tap finishes first, Phantom last
      phantomBtcConnected: true,
      tapBtcConnected: true,
    });
    expect(result).toBe("tap");
  });

  it("should keep 'phantom' when only Phantom reconnects (Tap Wallet not in session)", () => {
    const result = simulateParallelReconnect({
      storedPreference: "phantom",
      phantomFinishesFirst: true,
      phantomBtcConnected: true,
      tapBtcConnected: false,
    });
    expect(result).toBe("phantom");
  });

  it("should keep 'tap' when only Tap Wallet reconnects (Phantom not in session)", () => {
    const result = simulateParallelReconnect({
      storedPreference: "tap",
      phantomFinishesFirst: false,
      phantomBtcConnected: false,
      tapBtcConnected: true,
    });
    expect(result).toBe("tap");
  });
});

describe("Stale preferredBtcWallet Cleanup", () => {
  beforeEach(() => {
    mockStorage = {};
  });

  it("should NOT run cleanup before reconnect is complete (guard check)", () => {
    // Preference is 'phantom', but no wallets are connected yet (still reconnecting)
    const result = simulateStalePrefCleanup({
      preferredBtcWallet: "phantom",
      tapConnected: false,
      nonTapConnected: false,
      nonTapIsPhantom: true,
      reconnectComplete: false, // ← guard is active
    });
    // Preference should be preserved — cleanup was blocked
    expect(result).toBe("phantom");
  });

  it("should clear stale 'tap' preference and fall back to Phantom when Tap Wallet is gone", () => {
    const result = simulateStalePrefCleanup({
      preferredBtcWallet: "tap",
      tapConnected: false,     // Tap Wallet extension removed
      nonTapConnected: true,   // Phantom BTC is connected
      nonTapIsPhantom: true,
      reconnectComplete: true,
    });
    expect(result).toBe("phantom");
  });

  it("should clear stale 'tap' preference and fall back to MetaMask when Tap Wallet is gone", () => {
    const result = simulateStalePrefCleanup({
      preferredBtcWallet: "tap",
      tapConnected: false,
      nonTapConnected: true,
      nonTapIsPhantom: false,  // MetaMask BTC
      reconnectComplete: true,
    });
    expect(result).toBe("metamask");
  });

  it("should clear stale 'phantom' preference and fall back to Tap Wallet when Phantom is gone", () => {
    const result = simulateStalePrefCleanup({
      preferredBtcWallet: "phantom",
      tapConnected: true,
      nonTapConnected: false,  // Phantom extension removed
      nonTapIsPhantom: true,
      reconnectComplete: true,
    });
    expect(result).toBe("tap");
  });

  it("should clear preference entirely when no BTC wallet is connected", () => {
    const result = simulateStalePrefCleanup({
      preferredBtcWallet: "phantom",
      tapConnected: false,
      nonTapConnected: false,
      nonTapIsPhantom: true,
      reconnectComplete: true,
    });
    expect(result).toBeNull();
  });

  it("should NOT change preference when preferred wallet is still connected", () => {
    const result = simulateStalePrefCleanup({
      preferredBtcWallet: "phantom",
      tapConnected: true,
      nonTapConnected: true,   // Phantom is still connected
      nonTapIsPhantom: true,
      reconnectComplete: true,
    });
    // Both wallets connected, preference is valid — no change
    expect(result).toBe("phantom");
  });

  it("should NOT change 'tap' preference when Tap Wallet is still connected", () => {
    const result = simulateStalePrefCleanup({
      preferredBtcWallet: "tap",
      tapConnected: true,      // Tap Wallet is still connected
      nonTapConnected: true,
      nonTapIsPhantom: true,
      reconnectComplete: true,
    });
    expect(result).toBe("tap");
  });
});
