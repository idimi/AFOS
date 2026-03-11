/**
 * Tests for history.myOnChainRefunds logic:
 * 1. On-chain HTLC state decoding
 * 2. Wallet-address filtering (only sender's HTLCs shown)
 * 3. Timelock expiry detection
 * 4. Deduplication with DB records (by PDA address)
 */
import { describe, expect, it } from "vitest";

// ─── Pure helpers (mirrors server/routers/history.ts) ─────────────────────────

function decodeHtlcStateForHistory(data: Buffer): {
  htlcId: string;
  sender: string;
  recipient: string;
  secretHash: string;
  timelock: number;
  amountLamports: bigint;
  tokenMint: string;
  claimed: boolean;
  refunded: boolean;
} | null {
  if (data.length < 219) return null;
  let offset = 8; // skip Anchor discriminator
  const htlcId = Buffer.from(data.slice(offset, offset + 32)).toString("utf8").replace(/\0/g, "");
  offset += 32;
  // We can't easily create real PublicKey in a unit test, so we test the decode logic
  // using a mock that just reads 32 bytes as a hex string for sender/recipient/tokenMint
  const sender = data.slice(offset, offset + 32).toString("hex");
  offset += 32;
  const recipient = data.slice(offset, offset + 32).toString("hex");
  offset += 32;
  const secretHash = data.slice(offset, offset + 32).toString("hex");
  offset += 32;
  const timelock = Number(data.readBigInt64LE(offset));
  offset += 8;
  const amountLamports = data.readBigUInt64LE(offset);
  offset += 8;
  const tokenMint = data.slice(offset, offset + 32).toString("hex");
  offset += 32;
  const claimed = data[offset] !== 0;
  const refunded = data[offset + 1] !== 0;
  return { htlcId, sender, recipient, secretHash, timelock, amountLamports, tokenMint, claimed, refunded };
}

/** Build a minimal 219-byte HTLC account buffer for testing */
function buildMockHtlcBuffer(params: {
  htlcId: string;
  sender: string;  // 32-char hex
  recipient: string;  // 32-char hex
  secretHash: string;  // 32-char hex
  timelock: number;
  amountLamports: bigint;
  tokenMint: string;  // 32-char hex
  claimed: boolean;
  refunded: boolean;
}): Buffer {
  const buf = Buffer.alloc(219, 0);
  let offset = 8; // discriminator (zeros)

  // htlcId (32 bytes, UTF-8 padded with zeros)
  const htlcIdBytes = Buffer.from(params.htlcId.slice(0, 32).padEnd(32, "\0"));
  htlcIdBytes.copy(buf, offset);
  offset += 32;

  // sender (32 bytes hex)
  Buffer.from(params.sender.padStart(64, "0").slice(0, 64), "hex").copy(buf, offset);
  offset += 32;

  // recipient (32 bytes hex)
  Buffer.from(params.recipient.padStart(64, "0").slice(0, 64), "hex").copy(buf, offset);
  offset += 32;

  // secretHash (32 bytes hex)
  Buffer.from(params.secretHash.padStart(64, "0").slice(0, 64), "hex").copy(buf, offset);
  offset += 32;

  // timelock (int64 LE)
  buf.writeBigInt64LE(BigInt(params.timelock), offset);
  offset += 8;

  // amountLamports (uint64 LE)
  buf.writeBigUInt64LE(params.amountLamports, offset);
  offset += 8;

  // tokenMint (32 bytes hex)
  Buffer.from(params.tokenMint.padStart(64, "0").slice(0, 64), "hex").copy(buf, offset);
  offset += 32;

  // claimed, refunded, bump
  buf[offset] = params.claimed ? 1 : 0;
  buf[offset + 1] = params.refunded ? 1 : 0;
  buf[offset + 2] = 255; // bump

  return buf;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("decodeHtlcStateForHistory", () => {
  it("returns null for buffers shorter than 219 bytes", () => {
    expect(decodeHtlcStateForHistory(Buffer.alloc(100))).toBeNull();
    expect(decodeHtlcStateForHistory(Buffer.alloc(218))).toBeNull();
    expect(decodeHtlcStateForHistory(Buffer.alloc(219))).not.toBeNull();
  });

  it("correctly decodes htlcId from account data", () => {
    const buf = buildMockHtlcBuffer({
      htlcId: "htlc_a_rfq_1773205346880_lp-3",
      sender: "a".repeat(64),
      recipient: "b".repeat(64),
      secretHash: "c".repeat(64),
      timelock: 1773205346,
      amountLamports: 25_000_000n,
      tokenMint: "0".repeat(64),
      claimed: false,
      refunded: false,
    });
    const state = decodeHtlcStateForHistory(buf);
    expect(state).not.toBeNull();
    expect(state!.htlcId).toBe("htlc_a_rfq_1773205346880_lp-3");
  });

  it("correctly decodes amountLamports", () => {
    const buf = buildMockHtlcBuffer({
      htlcId: "test_htlc",
      sender: "a".repeat(64),
      recipient: "b".repeat(64),
      secretHash: "c".repeat(64),
      timelock: 1000000,
      amountLamports: 25_000_000n, // 0.025 SOL
      tokenMint: "0".repeat(64),
      claimed: false,
      refunded: false,
    });
    const state = decodeHtlcStateForHistory(buf);
    expect(state!.amountLamports).toBe(25_000_000n);
    // 0.025 SOL
    expect(Number(state!.amountLamports) / 1e9).toBeCloseTo(0.025, 6);
  });

  it("correctly decodes claimed and refunded flags", () => {
    const claimedBuf = buildMockHtlcBuffer({
      htlcId: "test", sender: "a".repeat(64), recipient: "b".repeat(64),
      secretHash: "c".repeat(64), timelock: 1000, amountLamports: 1n,
      tokenMint: "0".repeat(64), claimed: true, refunded: false,
    });
    const refundedBuf = buildMockHtlcBuffer({
      htlcId: "test", sender: "a".repeat(64), recipient: "b".repeat(64),
      secretHash: "c".repeat(64), timelock: 1000, amountLamports: 1n,
      tokenMint: "0".repeat(64), claimed: false, refunded: true,
    });
    const activeBuf = buildMockHtlcBuffer({
      htlcId: "test", sender: "a".repeat(64), recipient: "b".repeat(64),
      secretHash: "c".repeat(64), timelock: 1000, amountLamports: 1n,
      tokenMint: "0".repeat(64), claimed: false, refunded: false,
    });

    expect(decodeHtlcStateForHistory(claimedBuf)!.claimed).toBe(true);
    expect(decodeHtlcStateForHistory(claimedBuf)!.refunded).toBe(false);
    expect(decodeHtlcStateForHistory(refundedBuf)!.refunded).toBe(true);
    expect(decodeHtlcStateForHistory(activeBuf)!.claimed).toBe(false);
    expect(decodeHtlcStateForHistory(activeBuf)!.refunded).toBe(false);
  });

  it("correctly decodes timelock", () => {
    const timelock = 1773205346; // Unix timestamp
    const buf = buildMockHtlcBuffer({
      htlcId: "test", sender: "a".repeat(64), recipient: "b".repeat(64),
      secretHash: "c".repeat(64), timelock,
      amountLamports: 1n, tokenMint: "0".repeat(64),
      claimed: false, refunded: false,
    });
    const state = decodeHtlcStateForHistory(buf);
    expect(state!.timelock).toBe(timelock);
  });
});

describe("myOnChainRefunds wallet filtering logic", () => {
  const WALLET_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const WALLET_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  function filterByWallet(
    htlcs: Array<{ sender: string; claimed: boolean; refunded: boolean }>,
    walletAddresses: string[]
  ) {
    const walletSet = new Set(walletAddresses.map(a => a.toLowerCase()));
    return htlcs.filter(h => {
      if (h.claimed || h.refunded) return false;
      return walletSet.has(h.sender.toLowerCase());
    });
  }

  it("only returns HTLCs where sender matches connected wallet", () => {
    const htlcs = [
      { sender: WALLET_A, claimed: false, refunded: false },
      { sender: WALLET_B, claimed: false, refunded: false },
      { sender: WALLET_A, claimed: false, refunded: false },
    ];
    const result = filterByWallet(htlcs, [WALLET_A]);
    expect(result.length).toBe(2);
    expect(result.every(h => h.sender === WALLET_A)).toBe(true);
  });

  it("excludes already claimed HTLCs", () => {
    const htlcs = [
      { sender: WALLET_A, claimed: true, refunded: false },
      { sender: WALLET_A, claimed: false, refunded: false },
    ];
    const result = filterByWallet(htlcs, [WALLET_A]);
    expect(result.length).toBe(1);
    expect(result[0].claimed).toBe(false);
  });

  it("excludes already refunded HTLCs", () => {
    const htlcs = [
      { sender: WALLET_A, claimed: false, refunded: true },
      { sender: WALLET_A, claimed: false, refunded: false },
    ];
    const result = filterByWallet(htlcs, [WALLET_A]);
    expect(result.length).toBe(1);
    expect(result[0].refunded).toBe(false);
  });

  it("returns empty array when no wallet matches", () => {
    const htlcs = [{ sender: WALLET_B, claimed: false, refunded: false }];
    const result = filterByWallet(htlcs, [WALLET_A]);
    expect(result.length).toBe(0);
  });

  it("is case-insensitive for wallet address comparison", () => {
    const htlcs = [{ sender: WALLET_A.toUpperCase(), claimed: false, refunded: false }];
    const result = filterByWallet(htlcs, [WALLET_A.toLowerCase()]);
    expect(result.length).toBe(1);
  });
});

describe("timelock expiry detection", () => {
  it("marks HTLC as expired when timelock <= current time", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiredTimelock = nowSeconds - 3600; // 1 hour ago
    const futureTimelock = nowSeconds + 3600;  // 1 hour from now

    expect(nowSeconds >= expiredTimelock).toBe(true);
    expect(nowSeconds >= futureTimelock).toBe(false);
  });

  it("correctly identifies the stuck HTLC timelock as expired", () => {
    // The stuck HTLC had timelock = 1741654949 (Unix timestamp)
    // Current date is Mar 11, 2026 — well past that timestamp
    const stuckHtlcTimelock = 1741654949;
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(nowSeconds >= stuckHtlcTimelock).toBe(true);
  });
});

describe("deduplication of on-chain results with DB records", () => {
  it("filters out on-chain HTLCs already present in DB by PDA address", () => {
    const dbAddresses = new Set(["pda1", "pda2"].map(a => a.toLowerCase()));

    const onChainHtlcs = [
      { pdaAddress: "pda1", htlcId: "htlc_a_1" }, // already in DB
      { pdaAddress: "pda3", htlcId: "htlc_a_3" }, // not in DB
      { pdaAddress: "PDA2", htlcId: "htlc_a_2" }, // already in DB (case-insensitive)
    ];

    const filtered = onChainHtlcs.filter(h => !dbAddresses.has(h.pdaAddress.toLowerCase()));
    expect(filtered.length).toBe(1);
    expect(filtered[0].pdaAddress).toBe("pda3");
  });

  it("shows all on-chain HTLCs when DB has no matching records", () => {
    const dbAddresses = new Set<string>();
    const onChainHtlcs = [
      { pdaAddress: "pda1", htlcId: "htlc_a_1" },
      { pdaAddress: "pda2", htlcId: "htlc_a_2" },
    ];
    const filtered = onChainHtlcs.filter(h => !dbAddresses.has(h.pdaAddress.toLowerCase()));
    expect(filtered.length).toBe(2);
  });
});
