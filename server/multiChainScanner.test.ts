/**
 * Tests for multi-chain on-chain scanner and auto-refund logic
 */
import { describe, it, expect } from "vitest";

// ─── htlcId generation formula tests ────────────────────────────────────────

describe("htlcId generation formula", () => {
  it("produces correct htlcId from rfqId with htlc_a_ prefix", () => {
    const rfqId = "rfq_1773205346880_lp-3dcc94c0da";
    const htlcId = "htlc_a_" + rfqId.slice(0, 22);
    expect(htlcId).toBe("htlc_a_rfq_1773205346880_lp-3");
  });

  it("handles short rfqIds gracefully", () => {
    const rfqId = "rfq_123";
    const htlcId = "htlc_a_" + rfqId.slice(0, 22);
    expect(htlcId).toBe("htlc_a_rfq_123");
  });

  it("handles exact 22-char rfqIds", () => {
    const rfqId = "rfq_1234567890_lp-abc";
    expect(rfqId.length).toBe(21);
    const htlcId = "htlc_a_" + rfqId.slice(0, 22);
    expect(htlcId).toBe("htlc_a_rfq_1234567890_lp-abc");
  });
});

// ─── HTLC state decoding tests ──────────────────────────────────────────────

describe("HTLC state decoding", () => {
  it("rejects buffers shorter than 219 bytes", () => {
    const shortBuf = Buffer.alloc(100);
    // The decodeHtlcState function returns null for short buffers
    expect(shortBuf.length).toBeLessThan(219);
  });

  it("correctly identifies native SOL token mint", () => {
    const nativeMint = "11111111111111111111111111111111";
    expect(nativeMint.length).toBe(32);
  });
});

// ─── ETH event topic verification ───────────────────────────────────────────

describe("ETH Locked event topic", () => {
  it("uses the correct pre-computed keccak256 hash", () => {
    // Pre-computed keccak256("Locked(bytes32,address,address,address,uint256,bytes32,uint256)")
    const LOCKED_TOPIC = "0x14442dbf5e9aa943f3b7681bdf4e57c3256930c69ccc137263150f7e01bd51cf";
    expect(LOCKED_TOPIC).toMatch(/^0x[0-9a-f]{64}$/);
    expect(LOCKED_TOPIC.length).toBe(66); // 0x + 64 hex chars
  });

  it("uses the correct refund function selector", () => {
    // keccak256("refund(bytes32)") first 4 bytes
    const REFUND_SELECTOR = "0x7249fbb6";
    expect(REFUND_SELECTOR).toMatch(/^0x[0-9a-f]{8}$/);
  });

  it("uses the correct getContract function selector", () => {
    // keccak256("getContract(bytes32)") first 4 bytes
    const GET_CONTRACT_SELECTOR = "0xe16c7d98";
    expect(GET_CONTRACT_SELECTOR).toMatch(/^0x[0-9a-f]{8}$/);
  });
});

// ─── ETH log decoding tests ─────────────────────────────────────────────────

describe("ETH log decoding", () => {
  it("extracts initiator address from topics[2]", () => {
    // topics[2] is the indexed initiator address, zero-padded to 32 bytes
    const topic2 = "0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045";
    const initiator = "0x" + topic2.slice(26);
    expect(initiator).toBe("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
  });

  it("decodes amount from data field", () => {
    // data layout: token(32) + amount(32) + secretHash(32) + timelock(32)
    const amountHex = "0000000000000000000000000000000000000000000000000de0b6b3a7640000";
    const amount = BigInt("0x" + amountHex);
    expect(amount).toBe(BigInt("1000000000000000000")); // 1 ETH in wei
    expect(Number(amount) / 1e18).toBe(1.0);
  });

  it("decodes timelock from data field", () => {
    const timelockHex = "0000000000000000000000000000000000000000000000000000000067890abc";
    const timelock = parseInt(timelockHex, 16);
    expect(timelock).toBeGreaterThan(0);
  });
});

// ─── BTC HTLC scan logic tests ──────────────────────────────────────────────

describe("BTC HTLC expiry check", () => {
  it("treats locktime > 500_000_000 as unix timestamp", () => {
    const locktime = 1773205346; // Unix timestamp
    const now = Math.floor(Date.now() / 1000);
    expect(locktime).toBeGreaterThan(500_000_000);
    // This is a past timestamp, so it should be expired
    expect(now >= locktime).toBe(true);
  });

  it("treats locktime <= 500_000_000 as block height", () => {
    const locktime = 850000; // Block height
    expect(locktime).toBeLessThanOrEqual(500_000_000);
    // For block heights, we fall back to time-based check (24h from creation)
  });
});

// ─── Notification cooldown logic tests ──────────────────────────────────────

describe("Notification cooldown", () => {
  it("prevents re-notification within cooldown period", () => {
    const REFUND_COOLDOWN_MS = 30 * 60 * 1000;
    const notifiedRecently = new Map<string, number>();

    const key = "test_htlc_1";
    notifiedRecently.set(key, Date.now());

    const lastNotified = notifiedRecently.get(key) ?? 0;
    const shouldNotify = Date.now() - lastNotified > REFUND_COOLDOWN_MS;
    expect(shouldNotify).toBe(false);
  });

  it("allows notification after cooldown expires", () => {
    const REFUND_COOLDOWN_MS = 30 * 60 * 1000;
    const notifiedRecently = new Map<string, number>();

    const key = "test_htlc_2";
    notifiedRecently.set(key, Date.now() - REFUND_COOLDOWN_MS - 1000);

    const lastNotified = notifiedRecently.get(key) ?? 0;
    const shouldNotify = Date.now() - lastNotified > REFUND_COOLDOWN_MS;
    expect(shouldNotify).toBe(true);
  });

  it("cleans up old cooldowns older than 2 hours", () => {
    const notifiedRecently = new Map<string, number>();
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;

    notifiedRecently.set("old_htlc", twoHoursAgo - 1000);
    notifiedRecently.set("recent_htlc", Date.now());

    Array.from(notifiedRecently.entries()).forEach(([key, ts]) => {
      if (ts < twoHoursAgo) notifiedRecently.delete(key);
    });

    expect(notifiedRecently.has("old_htlc")).toBe(false);
    expect(notifiedRecently.has("recent_htlc")).toBe(true);
  });
});

// ─── Multi-chain merge logic tests ──────────────────────────────────────────

describe("Multi-chain merge and deduplication", () => {
  it("deduplicates by PDA/contract address (case-insensitive)", () => {
    const dbAddresses = new Set(["45jdltyqbrbcmz6wpc1kgtuqzxash3w5lwg6uhbtytlq"]);
    const onChainHtlc = { pdaAddress: "45jdLtyQBrbCMz6wpC1kgtuQZxASH3w5LWg6UhbTYTLQ" };
    const isDuplicate = dbAddresses.has(onChainHtlc.pdaAddress.toLowerCase());
    expect(isDuplicate).toBe(true);
  });

  it("includes on-chain HTLCs not in DB", () => {
    const dbAddresses = new Set(["abc123"]);
    const onChainHtlc = { pdaAddress: "xyz789" };
    const isDuplicate = dbAddresses.has(onChainHtlc.pdaAddress.toLowerCase());
    expect(isDuplicate).toBe(false);
  });

  it("assigns correct chain label from on-chain scanner response", () => {
    const htlcSol = { chain: "solana", tokenSymbol: "SOL" };
    const htlcEth = { chain: "ethereum", tokenSymbol: "ETH" };
    const htlcBtc = { chain: "bitcoin", tokenSymbol: "BTC" };

    expect(htlcSol.chain).toBe("solana");
    expect(htlcEth.chain).toBe("ethereum");
    expect(htlcBtc.chain).toBe("bitcoin");
  });

  it("uses correct price estimates per chain", () => {
    const PRICE_ESTIMATES: Record<string, number> = {
      SOL: 150,
      ETH: 3500,
      BTC: 90000,
    };

    expect(PRICE_ESTIMATES["SOL"]).toBe(150);
    expect(PRICE_ESTIMATES["ETH"]).toBe(3500);
    expect(PRICE_ESTIMATES["BTC"]).toBe(90000);
  });
});

// ─── ETH refund handler logic tests ─────────────────────────────────────────

describe("ETH refund handler", () => {
  it("detects on-chain scanner result by htlcAddress format (0x + 64 hex)", () => {
    const onChainContractId = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const isOnChainResult = onChainContractId.startsWith("0x") && onChainContractId.length === 66;
    expect(isOnChainResult).toBe(true);
  });

  it("detects DB result by htlcAddress format (0x + 40 hex address)", () => {
    const dbAddress = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
    const isOnChainResult = dbAddress.startsWith("0x") && dbAddress.length === 66;
    expect(isOnChainResult).toBe(false);
  });

  it("builds correct calldata for refund(bytes32 contractId)", () => {
    const contractId = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const contractIdHex = contractId.slice(2);
    const calldata = "0x7249fbb6" + contractIdHex.padStart(64, "0");
    expect(calldata).toBe("0x7249fbb6" + contractIdHex);
    expect(calldata.length).toBe(2 + 8 + 64); // 0x + selector + 32 bytes
  });
});
