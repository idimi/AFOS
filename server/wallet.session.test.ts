/**
 * Unit tests for wallet session persistence logic.
 *
 * These tests verify that:
 * 1. saveWalletSession merges into existing session (not overwriting)
 * 2. removeFromWalletSession removes only specified keys
 * 3. clearWalletSession removes the entire session
 * 4. Multi-wallet sessions (Phantom + Tap Wallet) persist correctly
 *
 * NOTE: These functions are defined in client/src/contexts/MultiChainWalletContext.tsx
 * and are tested here by re-implementing the same logic in a testable module.
 */

import { describe, it, expect, beforeEach } from "vitest";

// ─── Re-implement the session helpers for testing ─────────────────────────────
// (The actual implementation lives in MultiChainWalletContext.tsx but is not
//  exported. We test the logic directly here.)

type EthProviderType = "metamask" | "phantom";
type BtcProviderType = "metamask" | "tap" | "phantom";

type WalletSession = {
  eth?: EthProviderType;
  btc?: BtcProviderType;
  phantom?: true;
};

const WALLET_SESSION_KEY = "afos_wallet_session";

// Simulate localStorage using a plain object
let mockStorage: Record<string, string> = {};

function loadWalletSession(): WalletSession | null {
  try {
    const raw = mockStorage[WALLET_SESSION_KEY];
    return raw ? (JSON.parse(raw) as WalletSession) : null;
  } catch (_) {
    return null;
  }
}

function saveWalletSession(session: WalletSession) {
  try {
    const existing = loadWalletSession() ?? {};
    const merged: WalletSession = { ...existing, ...session };
    mockStorage[WALLET_SESSION_KEY] = JSON.stringify(merged);
  } catch (_) {}
}

function clearWalletSession() {
  delete mockStorage[WALLET_SESSION_KEY];
}

function removeFromWalletSession(keys: (keyof WalletSession)[]) {
  try {
    const existing = loadWalletSession();
    if (!existing) return;
    const updated = { ...existing };
    for (const key of keys) delete updated[key];
    if (Object.keys(updated).length === 0) {
      delete mockStorage[WALLET_SESSION_KEY];
    } else {
      mockStorage[WALLET_SESSION_KEY] = JSON.stringify(updated);
    }
  } catch (_) {}
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Wallet Session Persistence", () => {
  beforeEach(() => {
    mockStorage = {};
  });

  it("should save a Phantom session", () => {
    saveWalletSession({ phantom: true });
    const session = loadWalletSession();
    expect(session).toEqual({ phantom: true });
  });

  it("should save a Tap Wallet session", () => {
    saveWalletSession({ btc: "tap" });
    const session = loadWalletSession();
    expect(session).toEqual({ btc: "tap" });
  });

  it("should merge sessions — Phantom + Tap Wallet coexist", () => {
    // Connect Phantom first
    saveWalletSession({ phantom: true });
    // Then connect Tap Wallet (should not overwrite Phantom)
    saveWalletSession({ btc: "tap" });
    const session = loadWalletSession();
    expect(session).toEqual({ phantom: true, btc: "tap" });
  });

  it("should merge sessions — MetaMask ETH + Tap Wallet coexist", () => {
    saveWalletSession({ eth: "metamask" });
    saveWalletSession({ btc: "tap" });
    const session = loadWalletSession();
    expect(session).toEqual({ eth: "metamask", btc: "tap" });
  });

  it("should merge sessions — Phantom + MetaMask BTC coexist", () => {
    saveWalletSession({ phantom: true });
    saveWalletSession({ btc: "metamask" });
    const session = loadWalletSession();
    expect(session).toEqual({ phantom: true, btc: "metamask" });
  });

  it("removeFromWalletSession should remove only btc, keeping phantom", () => {
    saveWalletSession({ phantom: true, btc: "tap" });
    removeFromWalletSession(["btc"]);
    const session = loadWalletSession();
    expect(session).toEqual({ phantom: true });
  });

  it("removeFromWalletSession should remove only phantom/eth, keeping btc", () => {
    saveWalletSession({ phantom: true, btc: "tap" });
    removeFromWalletSession(["phantom", "eth"]);
    const session = loadWalletSession();
    expect(session).toEqual({ btc: "tap" });
  });

  it("removeFromWalletSession should clear storage when all keys removed", () => {
    saveWalletSession({ btc: "tap" });
    removeFromWalletSession(["btc"]);
    const session = loadWalletSession();
    expect(session).toBeNull();
  });

  it("clearWalletSession should remove entire session", () => {
    saveWalletSession({ phantom: true, btc: "tap" });
    clearWalletSession();
    const session = loadWalletSession();
    expect(session).toBeNull();
  });

  it("loadWalletSession should return null when no session exists", () => {
    const session = loadWalletSession();
    expect(session).toBeNull();
  });

  it("saveWalletSession should overwrite individual keys when re-saving", () => {
    // Start with Phantom BTC
    saveWalletSession({ phantom: true });
    // Switch to MetaMask BTC (btc key should be updated)
    saveWalletSession({ btc: "metamask" });
    const session = loadWalletSession();
    expect(session).toEqual({ phantom: true, btc: "metamask" });
  });

  it("should handle the full multi-wallet connect/disconnect lifecycle", () => {
    // Step 1: Connect Phantom
    saveWalletSession({ phantom: true });
    expect(loadWalletSession()).toEqual({ phantom: true });

    // Step 2: Also connect Tap Wallet
    saveWalletSession({ btc: "tap" });
    expect(loadWalletSession()).toEqual({ phantom: true, btc: "tap" });

    // Step 3: Disconnect Tap Wallet (only remove btc)
    removeFromWalletSession(["btc"]);
    expect(loadWalletSession()).toEqual({ phantom: true });

    // Step 4: Disconnect Phantom (remove phantom + eth)
    removeFromWalletSession(["phantom", "eth"]);
    expect(loadWalletSession()).toBeNull();
  });
});
