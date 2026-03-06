/**
 * Admin wallet allowlist tests
 *
 * Validates that the VITE_ADMIN_WALLETS env var is set and contains
 * exactly the three expected Solana wallet addresses.
 */

import { describe, it, expect } from "vitest";

const EXPECTED_WALLETS = [
  "CzP3GvDsLFfwqvPRm3hCtVYHP7PcnbUEqNBssevqepiW",
  "AuSUBiVV1FYnCkBiqKCAHWesvDm6BQipQ3hcRcvg6HQk",
  "3xs9ePntinq3oCbGdaCFE5ktJ4zmoMEoGjSp3W1i5rZY",
];

function parseAdminWallets(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);
}

describe("Admin wallet allowlist", () => {
  it("VITE_ADMIN_WALLETS env var is set and non-empty", () => {
    const raw = process.env.VITE_ADMIN_WALLETS;
    expect(raw).toBeTruthy();
    expect(raw!.trim().length).toBeGreaterThan(0);
  });

  it("parses exactly 3 wallet addresses from VITE_ADMIN_WALLETS", () => {
    const wallets = parseAdminWallets(process.env.VITE_ADMIN_WALLETS);
    expect(wallets).toHaveLength(3);
  });

  it("all three expected admin wallets are present in the allowlist", () => {
    const wallets = parseAdminWallets(process.env.VITE_ADMIN_WALLETS);
    for (const expected of EXPECTED_WALLETS) {
      expect(wallets).toContain(expected);
    }
  });

  it("rejects a wallet address not in the allowlist", () => {
    const wallets = parseAdminWallets(process.env.VITE_ADMIN_WALLETS);
    expect(wallets).not.toContain("FakeWalletAddressNotInAllowlist1234567890");
  });

  it("each wallet address is a valid Solana base58 string (32-44 chars)", () => {
    const wallets = parseAdminWallets(process.env.VITE_ADMIN_WALLETS);
    for (const w of wallets) {
      expect(w.length).toBeGreaterThanOrEqual(32);
      expect(w.length).toBeLessThanOrEqual(44);
      // Solana addresses are base58 — only alphanumeric, no 0/O/I/l
      expect(w).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    }
  });
});
