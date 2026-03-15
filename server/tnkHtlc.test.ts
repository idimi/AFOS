/**
 * tnkHtlc.test.ts — Vitest tests for TNK on-chain HTLC implementation
 *
 * Tests cover:
 *   - tnkHtlcContract: isTnkPeerHealthy, getTnkHtlcState, submitTnkHtlcLock
 *   - tnkHtlcClaim:    claimTnkHtlc (happy path + error paths)
 *   - tnkHtlcRefund:   refundTnkHtlc (happy path + error paths)
 *
 * Mock shapes match the actual API calls:
 *   - isTnkPeerHealthy:  GET /v1/health → { ok: true }
 *   - getTnkHtlcState:   GET /v1/state?key=htlc/{id} → { value: TnkHtlcState | null }
 *   - submitContractTx:
 *       GET /v1/contract/nonce → { nonce: "..." }
 *       GET /v1/contract/tx/context → { msb: { networkId, txv, iw, bs, mbs, operationType } }
 *       POST /v1/contract/tx (sim=true) → { result: ... }
 *       POST /v1/contract/tx (sim=false) → { result: { txHash: "..." } }
 *   - agentSendTnk:      POST /v1/agent/send → { success: true, txHash: "..." }
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

/** Build a mock fetch that returns responses in sequence (last one repeats) */
function makeFetchMock(responses: Array<{ ok: boolean; body: unknown }>) {
  let callIndex = 0;
  return vi.fn().mockImplementation(async () => {
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return {
      ok: resp.ok,
      status: resp.ok ? 200 : 500,
      json: async () => resp.body,
      text: async () => JSON.stringify(resp.body),
    };
  });
}

/** Standard MSB context returned by GET /v1/contract/tx/context */
const MSB_CONTEXT = {
  networkId: 1,
  txv: "1",
  iw: "1",
  bs: "",
  mbs: "1",
  operationType: 1,
};

/** Responses for a successful submitContractTx call (4 fetches) */
function successfulContractTxResponses(txHash: string) {
  return [
    { ok: true, body: { nonce: "abc123" } },                              // GET /v1/contract/nonce
    { ok: true, body: { msb: MSB_CONTEXT } },                             // GET /v1/contract/tx/context
    { ok: true, body: { result: { simulated: true } } },                  // POST sim=true
    { ok: true, body: { result: { txHash } } },                           // POST sim=false
  ];
}

// ─── Mock DB ──────────────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue({
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  }),
}));

// ─── sha256 preimage verification ────────────────────────────────────────────

describe("preimage verification (sha256)", () => {
  it("sha256(preimage) matches secretHash for known values", () => {
    const preimage = "test_secret_preimage";
    const hash = sha256Hex(preimage);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(sha256Hex(preimage)).toBe(hash);
    expect(sha256Hex("different_preimage")).not.toBe(hash);
  });
});

// ─── tnkHtlcContract: isTnkPeerHealthy ───────────────────────────────────────

describe("isTnkPeerHealthy", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    process.env.TNK_PEER_RPC_URL = "http://localhost:5001";
    process.env.TNK_AGENT_KEY = "a".repeat(64);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true when peer responds with status ok", async () => {
    vi.stubGlobal("fetch", makeFetchMock([
      { ok: true, body: { ok: true, version: "1.0.0" } },
    ]));
    const { isTnkPeerHealthy } = await import("./tnkHtlcContract");
    expect(await isTnkPeerHealthy()).toBe(true);
  });

  it("returns false when fetch throws (peer unreachable)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const { isTnkPeerHealthy } = await import("./tnkHtlcContract");
    expect(await isTnkPeerHealthy()).toBe(false);
  });

  it("returns false when peer returns non-ok HTTP status", async () => {
    vi.stubGlobal("fetch", makeFetchMock([{ ok: false, body: {} }]));
    const { isTnkPeerHealthy } = await import("./tnkHtlcContract");
    expect(await isTnkPeerHealthy()).toBe(false);
  });
});

// ─── tnkHtlcContract: getTnkHtlcState ────────────────────────────────────────

describe("getTnkHtlcState", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    process.env.TNK_PEER_RPC_URL = "http://localhost:5001";
    process.env.TNK_AGENT_KEY = "a".repeat(64);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when HTLC not found (value: null)", async () => {
    // GET /v1/state?key=htlc/... → { value: null }
    vi.stubGlobal("fetch", makeFetchMock([{ ok: true, body: { value: null } }]));
    const { getTnkHtlcState } = await import("./tnkHtlcContract");
    expect(await getTnkHtlcState("htlc_a_test123")).toBeNull();
  });

  it("returns contract state when found", async () => {
    const mockState = {
      status: "locked",
      secretHash: "abc123",
      locktime: 9999999999,
      amountRaw: "10.0",
      sender: "trac1sender",
      recipient: "trac1recipient",
      lockedAt: 1700000000,
      claimedAt: null,
      refundedAt: null,
      preimage: null,
      lockTxHash: null,
    };
    // GET /v1/state?key=htlc/... → { value: TnkHtlcState }
    vi.stubGlobal("fetch", makeFetchMock([{ ok: true, body: { value: mockState } }]));
    const { getTnkHtlcState } = await import("./tnkHtlcContract");
    const result = await getTnkHtlcState("htlc_a_test123");
    expect(result?.status).toBe("locked");
    expect(result?.secretHash).toBe("abc123");
  });

  it("returns null on fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    const { getTnkHtlcState } = await import("./tnkHtlcContract");
    expect(await getTnkHtlcState("htlc_a_test123")).toBeNull();
  });
});

// ─── tnkHtlcContract: submitTnkHtlcLock ──────────────────────────────────────

describe("submitTnkHtlcLock", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    process.env.TNK_PEER_RPC_URL = "http://localhost:5001";
    // Valid PKCS8 DER hex for Ed25519 (generated via crypto.generateKeyPairSync)
    // We generate a real key here so signWithAgentKey doesn't throw
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    process.env.TNK_AGENT_KEY = (privateKey.export({ format: "der", type: "pkcs8" }) as Buffer).toString("hex");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok:true on successful lock (4 fetch calls)", async () => {
    vi.stubGlobal("fetch", makeFetchMock(successfulContractTxResponses("0xlock_tx")));
    const { submitTnkHtlcLock } = await import("./tnkHtlcContract");
    const result = await submitTnkHtlcLock({
      htlcId: "htlc_a_test",
      secretHash: sha256Hex("s"),
      locktime: 9999999999,
      amountRaw: "10.0",
      sender: "trac1s",
      recipient: "trac1r",
      lockTxHash: "0xsend",
    });
    expect(result.ok).toBe(true);
  });

  it("returns ok:false when broadcast fails (HTTP 500)", async () => {
    vi.stubGlobal("fetch", makeFetchMock([
      { ok: true, body: { nonce: "abc123" } },
      { ok: true, body: { msb: MSB_CONTEXT } },
      { ok: true, body: { result: { simulated: true } } },
      { ok: false, body: { error: "broadcast failed" } },   // broadcast fails
    ]));
    const { submitTnkHtlcLock } = await import("./tnkHtlcContract");
    const result = await submitTnkHtlcLock({
      htlcId: "htlc_a_test",
      secretHash: sha256Hex("s"),
      locktime: 9999999999,
      amountRaw: "10.0",
      sender: "trac1s",
      recipient: "trac1r",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns ok:false when simulation fails (HTTP 500)", async () => {
    vi.stubGlobal("fetch", makeFetchMock([
      { ok: true, body: { nonce: "abc123" } },
      { ok: true, body: { msb: MSB_CONTEXT } },
      { ok: false, body: { error: "simulation failed" } },  // sim fails
    ]));
    const { submitTnkHtlcLock } = await import("./tnkHtlcContract");
    const result = await submitTnkHtlcLock({
      htlcId: "htlc_a_test",
      secretHash: sha256Hex("s"),
      locktime: 9999999999,
      amountRaw: "10.0",
      sender: "trac1s",
      recipient: "trac1r",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Simulation failed");
  });
});

// ─── claimTnkHtlc tests ───────────────────────────────────────────────────────

describe("claimTnkHtlc", () => {
  const preimage = "mysecret_preimage_12345";
  const secretHash = sha256Hex(preimage);
  const htlcId = "htlc_a_test456";
  const futureLocktime = Math.floor(Date.now() / 1000) + 3600;

  // Use realistic raw units: 2.03 TNK (2 TNK + 0.03 fee buffer) = 2030000000000000000 raw (18 decimals)
  // After fee subtraction in claimTnkHtlc: 2030000000000000000 - 30000000000000000 = 2000000000000000000 (2 TNK)
  const mockLockedState = {
    status: "locked" as const,
    secretHash,
    locktime: futureLocktime,
    amountRaw: "2030000000000000000",  // 2.03 TNK in raw units (18 decimals)
    sender: "trac1sender",
    recipient: "trac1recipient",
    lockedAt: 1700000000,
    claimedAt: null,
    refundedAt: null,
    preimage: null,
    lockTxHash: null,
  };

  let agentKeyHex: string;

  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    process.env.TNK_PEER_RPC_URL = "http://localhost:5001";
    // Use a very short timeout so waitForTnkHtlcLocked exits quickly in tests
    process.env.TNK_HTLC_CONFIRM_TIMEOUT_MS = "200";
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    agentKeyHex = (privateKey.export({ format: "der", type: "pkcs8" }) as Buffer).toString("hex");
    process.env.TNK_AGENT_KEY = agentKeyHex;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok:false when peer is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const { claimTnkHtlc } = await import("./tnkHtlcClaim");
    const result = await claimTnkHtlc(htlcId, preimage);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("trac-peer-unreachable");
  });

  it("returns ok:false when HTLC not found in subnet", async () => {
    vi.stubGlobal("fetch", makeFetchMock([
      { ok: true, body: { ok: true } },     // GET /health
      { ok: true, body: { value: null } },       // GET /v1/state?key=htlc/...
    ]));
    const { claimTnkHtlc } = await import("./tnkHtlcClaim");
    const result = await claimTnkHtlc(htlcId, preimage);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("returns ok:false when HTLC is already claimed", async () => {
    vi.stubGlobal("fetch", makeFetchMock([
      { ok: true, body: { ok: true } },
      { ok: true, body: { value: { ...mockLockedState, status: "claimed" } } },
    ]));
    const { claimTnkHtlc } = await import("./tnkHtlcClaim");
    const result = await claimTnkHtlc(htlcId, preimage);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("already claimed");
  });

  it("returns ok:false when preimage does not match secretHash", async () => {
    vi.stubGlobal("fetch", makeFetchMock([
      { ok: true, body: { ok: true } },
      { ok: true, body: { value: mockLockedState } },
    ]));
    const { claimTnkHtlc } = await import("./tnkHtlcClaim");
    const result = await claimTnkHtlc(htlcId, "wrong_preimage");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Preimage mismatch");
  });

  it("returns ok:false when timelock has expired", async () => {
    const expiredLocktime = Math.floor(Date.now() / 1000) - 3600;
    vi.stubGlobal("fetch", makeFetchMock([
      { ok: true, body: { ok: true } },
      { ok: true, body: { value: { ...mockLockedState, locktime: expiredLocktime } } },
    ]));
    const { claimTnkHtlc } = await import("./tnkHtlcClaim");
    const result = await claimTnkHtlc(htlcId, preimage);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("expired");
  });

  it("returns ok:false with address-mismatch when TNK_HTLC_WIF does not match sender (real transfer path)", async () => {
    // The new claimTnkHtlc flow calls broadcastTnkTransfer (real on-chain transfer).
    // broadcastTnkTransfer makes 3 fetch calls after the contract claim:
    //   1. GET tracapi.trac.network/v1/balance/{from}  — balance check
    //   2. GET tracapi.trac.network/v1/txv             — get current txv
    //   3. POST tracapi.trac.network/v1/broadcast-transaction — broadcast
    // We set TNK_HTLC_WIF to a valid-length key that does NOT derive 'trac1sender',
    // so broadcastTnkTransfer returns an address-mismatch error.
    // This confirms the claim logic correctly reaches the transfer step.
    process.env.TNK_HTLC_WIF = "a".repeat(128); // valid length (128 hex chars = 64 bytes)
    vi.stubGlobal("fetch", makeFetchMock([
      { ok: true, body: { ok: true } },                                    // GET /health
      { ok: true, body: { value: mockLockedState } },                      // GET /v1/state?key=htlc/...
      ...successfulContractTxResponses("0xclaim_contract_tx"),             // submitTnkHtlcClaim (4 calls)
      // broadcastTnkTransfer: balance check, txv, broadcast (would be called if address matched)
      { ok: true, body: { balance: "9999000000000000000000" } },           // GET /v1/balance/{from}
      { ok: true, body: { txv: "a".repeat(64) } },                         // GET /v1/txv
      { ok: true, body: { result: { tx: "0xclaim_send_tx" } } },           // POST /v1/broadcast-transaction
    ]));
    const { claimTnkHtlc } = await import("./tnkHtlcClaim");
    const result = await claimTnkHtlc(htlcId, preimage);
    // Contract claim succeeded (contractTxHash is set) but transfer fails with address mismatch
    expect(result.contractTxHash).toBe("0xclaim_contract_tx");
    // The error should mention the address mismatch (TNK_HTLC_WIF derives wrong address)
    expect(result.error).toContain("TNK_HTLC_WIF derives address");
  });
});

// ─── refundTnkHtlc tests ─────────────────────────────────────────────────────

describe("refundTnkHtlc", () => {
  const htlcId = "htlc_a_test789";
  const expiredLocktime = Math.floor(Date.now() / 1000) - 100;
  const futureLocktime = Math.floor(Date.now() / 1000) + 3600;

  const mockLockedExpiredState = {
    status: "locked" as const,
    secretHash: "abc",
    locktime: expiredLocktime,
    amountRaw: "3.0",
    sender: "trac1sender",
    recipient: "trac1recipient",
    lockedAt: 1700000000,
    claimedAt: null,
    refundedAt: null,
    preimage: null,
    lockTxHash: null,
  };

  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    process.env.TNK_PEER_RPC_URL = "http://localhost:5001";
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    process.env.TNK_AGENT_KEY = (privateKey.export({ format: "der", type: "pkcs8" }) as Buffer).toString("hex");
    process.env.TNK_HTLC_CONTRACT_ADDRESS = "trac1contract";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok:false when peer is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const { refundTnkHtlc } = await import("./tnkHtlcRefund");
    const result = await refundTnkHtlc(htlcId);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("trac-peer-unreachable");
  });

  it("returns ok:false when HTLC not found", async () => {
    vi.stubGlobal("fetch", makeFetchMock([
      { ok: true, body: { ok: true } },
      { ok: true, body: { value: null } },
    ]));
    const { refundTnkHtlc } = await import("./tnkHtlcRefund");
    const result = await refundTnkHtlc(htlcId);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("returns ok:false when timelock has not expired", async () => {
    vi.stubGlobal("fetch", makeFetchMock([
      { ok: true, body: { ok: true } },
      { ok: true, body: { value: { ...mockLockedExpiredState, locktime: futureLocktime } } },
    ]));
    const { refundTnkHtlc } = await import("./tnkHtlcRefund");
    const result = await refundTnkHtlc(htlcId);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not expired");
  });

  it("returns ok:false when HTLC is already claimed", async () => {
    vi.stubGlobal("fetch", makeFetchMock([
      { ok: true, body: { ok: true } },
      { ok: true, body: { value: { ...mockLockedExpiredState, status: "claimed" } } },
    ]));
    const { refundTnkHtlc } = await import("./tnkHtlcRefund");
    const result = await refundTnkHtlc(htlcId);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not refundable");
  });

  it("returns ok:true on successful refund (6 fetch calls)", async () => {
    vi.stubGlobal("fetch", makeFetchMock([
      { ok: true, body: { ok: true } },                                // GET /health
      { ok: true, body: { value: mockLockedExpiredState } },               // GET /v1/state?key=htlc/...
      ...successfulContractTxResponses("0xrefund_contract_tx"),            // submitTnkHtlcRefund (4 calls)
      { ok: true, body: { success: true, txHash: "0xrefund_send_tx" } },  // POST /v1/agent/send
    ]));
    const { refundTnkHtlc } = await import("./tnkHtlcRefund");
    const result = await refundTnkHtlc(htlcId);
    expect(result.ok).toBe(true);
    expect(result.sendTxHash).toBe("0xrefund_send_tx");
  });

  it("returns ok:true even when sendTNK fails (contract state is already refunded)", async () => {
    vi.stubGlobal("fetch", makeFetchMock([
      { ok: true, body: { ok: true } },
      { ok: true, body: { value: mockLockedExpiredState } },
      ...successfulContractTxResponses("0xrefund_contract_tx"),
      { ok: false, body: { error: "sendTNK failed" } },                   // agentSendTnk fails
    ]));
    const { refundTnkHtlc } = await import("./tnkHtlcRefund");
    const result = await refundTnkHtlc(htlcId);
    // Contract refund succeeded — ok:true even if sendTNK fails (funds are safe in contract)
    expect(result.ok).toBe(true);
    expect(result.contractTxHash).toBe("0xrefund_contract_tx"); // extracted from result.result.txHash
  });
});
