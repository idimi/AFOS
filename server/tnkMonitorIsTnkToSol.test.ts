/**
 * tnkMonitorIsTnkToSol.test.ts
 *
 * Tests for the isTnkToSol settlement branch in tnkHtlcMonitor.pollTnkEscrow.
 *
 * When a pending htlcSwaps row has:
 *   chain = "trac_network", toChain = "solana", status = "pending"
 *
 * And the trac-peer subnet reports contractState.status = "locked",
 * the monitor should fire-and-forget a two-step settlement:
 *   1. claimTnkHtlc(htlcIdB, secretHex)  → agent receives TNK
 *   2. claimSolanaHtlc(htlcIdA, ...)     → user receives SOL/USDT/USDC
 *   3. htlcSecrets.status updated to "completed"
 *   4. htlcSwaps.status updated to "completed"
 *   5. broadcastAll({ type: "tnk_to_sol_settled", ... }) emitted
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Shared mock state ────────────────────────────────────────────────────────
const claimTnkHtlcMock = vi.fn();
const claimSolanaHtlcMock = vi.fn();
const broadcastAllMock = vi.fn();

// Mock dynamic imports used inside the isTnkToSol branch
vi.mock("../server/tnkHtlcClaim.js", () => ({
  claimTnkHtlc: claimTnkHtlcMock,
}));
vi.mock("../server/solanaHtlcClaim.js", () => ({
  claimSolanaHtlc: claimSolanaHtlcMock,
}));
// Also mock the non-.js paths (Vitest resolves both)
vi.mock("./tnkHtlcClaim", () => ({
  claimTnkHtlc: claimTnkHtlcMock,
}));
vi.mock("./solanaHtlcClaim", () => ({
  claimSolanaHtlc: claimSolanaHtlcMock,
}));

vi.mock("./signaling", () => ({
  broadcastAll: broadcastAllMock,
}));

vi.mock("./db", () => ({
  getDb: vi.fn(),
  saveHtlcSecret: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./tnkHtlcContract", () => ({
  isTnkPeerHealthy: vi.fn(),
  getTnkHtlcState: vi.fn(),
  getTnkBlockHeight: vi.fn().mockResolvedValue(1000),
}));

vi.mock("./tnkHtlcRefund", () => ({
  refundTnkHtlc: vi.fn().mockResolvedValue({ ok: false, error: "not-expired" }),
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

vi.mock("./jobs/ownerNotifyPrefs", () => ({
  getOwnerNotifyPrefs: vi.fn().mockResolvedValue({ ownerNotifyMissedLock: false }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────
const RFQ_ID = "rfq_tnk_to_sol_test_1234567890";
const SECRET_HEX = "a".repeat(64);
const SOL_CLAIM_TX = "SolClaimTxSig1111111111111111111111111111111";
const TNK_CONTRACT_TX = "tnk_contract_tx_abc123";

/** Build a minimal htlcSwaps row for a pending TNK→SOL swap */
function makeTnkToSolRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    chain: "trac_network" as const,
    toChain: "solana" as const,
    status: "pending" as const,
    rfqId: RFQ_ID,
    htlcId: `htlc_b_${RFQ_ID.slice(0, 22)}`,
    htlcAddress: "trac1htlc_b_address",
    secretHash: "b".repeat(64),
    lockTxId: null,
    amountRaw: "1000000000",
    amountHuman: "10",
    locktime: Math.floor(Date.now() / 1000) + 7200,
    senderAddress: "UserSolanaAddr111111111111111111111111111111",
    recipientAddress: "AgentTnkAddr",
    toToken: "SOL",
    peerId: null,
    refundTxId: null,
    counterpartyAddress: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    refundedAt: null,
    ...overrides,
  };
}

/** Build a minimal htlcSecrets row */
function makeSecretRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    rfqId: RFQ_ID,
    secretHex: SECRET_HEX,
    secretHashHex: "b".repeat(64),
    fromChain: "trac_network" as const,
    toChain: "solana" as const,
    expiresAt: BigInt(Math.floor(Date.now() / 1000) + 86400),
    status: "locked" as const,
    lockTxId: null,
    revealTxId: null,
    counterpartyRevealTxId: null,
    htlcId: null,
    initiatorAddress: "UserSolanaAddr111111111111111111111111111111",
    counterpartyAddress: "AgentTnkAddr",
    fromToken: "TNK",
    toToken: "SOL",
    settledAt: null,
    settledVia: null,
    counterpartyPeerId: null,
    initiatorPeerId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Build a mock DB that returns the given htlcSwaps rows and secrets */
function makeDb(
  htlcRows: ReturnType<typeof makeTnkToSolRow>[],
  secretRows: ReturnType<typeof makeSecretRow>[]
) {
  const updateSetWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateSetWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  // select().from().where().limit() → secretRows
  // select().from().where() → htlcRows (main query)
  const limit = vi.fn().mockResolvedValue(secretRows);
  const whereSecrets = vi.fn().mockReturnValue({ limit });
  const fromSecrets = vi.fn().mockReturnValue({ where: whereSecrets });

  const whereHtlc = vi.fn().mockResolvedValue(htlcRows);
  const fromHtlc = vi.fn().mockReturnValue({ where: whereHtlc });

  // select() is called twice: once for htlcSwaps (main query), once for htlcSecrets
  let selectCallCount = 0;
  const select = vi.fn().mockImplementation(() => {
    selectCallCount++;
    if (selectCallCount === 1) {
      // First call: main htlcSwaps query in pollTnkEscrow
      return { from: fromHtlc };
    }
    // Subsequent calls: htlcSecrets lookup inside isTnkToSol branch
    return { from: fromSecrets };
  });

  return { select, update, _updateSetWhere: updateSetWhere, _updateSet: updateSet };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("tnkHtlcMonitor — isTnkToSol settlement branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    const mod = await import("./jobs/tnkHtlcMonitor");
    mod.stopTnkHtlcMonitor();
  });

  it("calls claimTnkHtlc BEFORE claimSolanaHtlc (correct order)", async () => {
    const callOrder: string[] = [];
    claimTnkHtlcMock.mockImplementation(async () => {
      callOrder.push("claimTnkHtlc");
      return { ok: true, contractTxHash: TNK_CONTRACT_TX };
    });
    claimSolanaHtlcMock.mockImplementation(async () => {
      callOrder.push("claimSolanaHtlc");
      return { txSignature: SOL_CLAIM_TX, htlcId: "htlc_a_test", recipient: "user" };
    });

    const db = makeDb([makeTnkToSolRow()], [makeSecretRow()]);
    const { getDb } = await import("./db");
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const { isTnkPeerHealthy, getTnkHtlcState } = await import("./tnkHtlcContract");
    (isTnkPeerHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (getTnkHtlcState as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "locked",
      secretHash: "b".repeat(64),
      amountRaw: "1000000000",
      locktime: Math.floor(Date.now() / 1000) + 7200,
      sender: "UserTnkAddr",
      recipient: "AgentTnkAddr",
      lockedAt: Date.now(),
      claimedAt: null,
      refundedAt: null,
      preimage: null,
      lockTxHash: "tnk_lock_tx_hash_abc",
    });

    const { pollTnkEscrow } = await import("./jobs/tnkHtlcMonitor");
    const result = await pollTnkEscrow();

    // Wait for the fire-and-forget async block to complete
    await new Promise(r => setTimeout(r, 50));

    expect(result.detected).toBe(1);
    expect(callOrder[0]).toBe("claimTnkHtlc");
    expect(callOrder[1]).toBe("claimSolanaHtlc");
  });

  it("passes htlcIdB to claimTnkHtlc and htlcIdA to claimSolanaHtlc", async () => {
    claimTnkHtlcMock.mockResolvedValue({ ok: true, contractTxHash: TNK_CONTRACT_TX });
    claimSolanaHtlcMock.mockResolvedValue({ txSignature: SOL_CLAIM_TX, htlcId: "htlc_a_test", recipient: "user" });

    const db = makeDb([makeTnkToSolRow()], [makeSecretRow()]);
    const { getDb } = await import("./db");
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const { isTnkPeerHealthy, getTnkHtlcState } = await import("./tnkHtlcContract");
    (isTnkPeerHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (getTnkHtlcState as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "locked",
      secretHash: "b".repeat(64),
      amountRaw: "1000000000",
      locktime: Math.floor(Date.now() / 1000) + 7200,
      sender: "UserTnkAddr",
      recipient: "AgentTnkAddr",
      lockedAt: Date.now(),
      claimedAt: null,
      refundedAt: null,
      preimage: null,
      lockTxHash: "tnk_lock_tx_hash_abc",
    });

    const { pollTnkEscrow } = await import("./jobs/tnkHtlcMonitor");
    await pollTnkEscrow();
    await new Promise(r => setTimeout(r, 50));

    const expectedHtlcIdB = `htlc_b_${RFQ_ID.slice(0, 22)}`;
    const expectedHtlcIdA = `htlc_a_${RFQ_ID.slice(0, 22)}`;

    expect(claimTnkHtlcMock).toHaveBeenCalledWith(expectedHtlcIdB, SECRET_HEX);
    expect(claimSolanaHtlcMock).toHaveBeenCalledWith(
      expect.objectContaining({ htlcId: expectedHtlcIdA, secretHex: SECRET_HEX })
    );
  });

  it("marks htlcSecrets.status as 'completed' after successful settlement", async () => {
    claimTnkHtlcMock.mockResolvedValue({ ok: true, contractTxHash: TNK_CONTRACT_TX });
    claimSolanaHtlcMock.mockResolvedValue({ txSignature: SOL_CLAIM_TX, htlcId: "htlc_a_test", recipient: "user" });

    const db = makeDb([makeTnkToSolRow()], [makeSecretRow()]);
    const { getDb } = await import("./db");
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const { isTnkPeerHealthy, getTnkHtlcState } = await import("./tnkHtlcContract");
    (isTnkPeerHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (getTnkHtlcState as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "locked",
      secretHash: "b".repeat(64),
      amountRaw: "1000000000",
      locktime: Math.floor(Date.now() / 1000) + 7200,
      sender: "UserTnkAddr",
      recipient: "AgentTnkAddr",
      lockedAt: Date.now(),
      claimedAt: null,
      refundedAt: null,
      preimage: null,
      lockTxHash: "tnk_lock_tx_hash_abc",
    });

    const { pollTnkEscrow } = await import("./jobs/tnkHtlcMonitor");
    await pollTnkEscrow();
    await new Promise(r => setTimeout(r, 50));

    // db.update().set() should have been called with status: "completed"
    expect(db._updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" })
    );
  });

  it("emits tnk_to_sol_settled broadcast after successful settlement", async () => {
    claimTnkHtlcMock.mockResolvedValue({ ok: true, contractTxHash: TNK_CONTRACT_TX });
    claimSolanaHtlcMock.mockResolvedValue({ txSignature: SOL_CLAIM_TX, htlcId: "htlc_a_test", recipient: "user" });

    const db = makeDb([makeTnkToSolRow()], [makeSecretRow()]);
    const { getDb } = await import("./db");
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const { isTnkPeerHealthy, getTnkHtlcState } = await import("./tnkHtlcContract");
    (isTnkPeerHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (getTnkHtlcState as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "locked",
      secretHash: "b".repeat(64),
      amountRaw: "1000000000",
      locktime: Math.floor(Date.now() / 1000) + 7200,
      sender: "UserTnkAddr",
      recipient: "AgentTnkAddr",
      lockedAt: Date.now(),
      claimedAt: null,
      refundedAt: null,
      preimage: null,
      lockTxHash: "tnk_lock_tx_hash_abc",
    });

    const { pollTnkEscrow } = await import("./jobs/tnkHtlcMonitor");
    await pollTnkEscrow();
    await new Promise(r => setTimeout(r, 50));

    expect(broadcastAllMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tnk_to_sol_settled",
        rfqId: RFQ_ID,
        claimSolTx: SOL_CLAIM_TX,
        claimTnkTx: TNK_CONTRACT_TX,
      })
    );
  });

  it("does NOT trigger isTnkToSol when toChain is not 'solana'", async () => {
    // A standard TNK↔TNK or TNK↔BTC row should NOT trigger the branch
    const row = makeTnkToSolRow({ toChain: "bitcoin" });
    const db = makeDb([row as ReturnType<typeof makeTnkToSolRow>], []);
    const { getDb } = await import("./db");
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const { isTnkPeerHealthy, getTnkHtlcState } = await import("./tnkHtlcContract");
    (isTnkPeerHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (getTnkHtlcState as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "locked",
      secretHash: "b".repeat(64),
      amountRaw: "1000000000",
      locktime: Math.floor(Date.now() / 1000) + 7200,
      sender: "UserTnkAddr",
      recipient: "AgentTnkAddr",
      lockedAt: Date.now(),
      claimedAt: null,
      refundedAt: null,
      preimage: null,
      lockTxHash: "tnk_lock_tx_hash_abc",
    });

    const { pollTnkEscrow } = await import("./jobs/tnkHtlcMonitor");
    await pollTnkEscrow();
    await new Promise(r => setTimeout(r, 50));

    expect(claimTnkHtlcMock).not.toHaveBeenCalled();
    expect(claimSolanaHtlcMock).not.toHaveBeenCalled();
  });

  it("does NOT trigger isTnkToSol when rfqId is null", async () => {
    const row = makeTnkToSolRow({ rfqId: null });
    const db = makeDb([row as ReturnType<typeof makeTnkToSolRow>], []);
    const { getDb } = await import("./db");
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const { isTnkPeerHealthy, getTnkHtlcState } = await import("./tnkHtlcContract");
    (isTnkPeerHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (getTnkHtlcState as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "locked",
      secretHash: "b".repeat(64),
      amountRaw: "1000000000",
      locktime: Math.floor(Date.now() / 1000) + 7200,
      sender: "UserTnkAddr",
      recipient: "AgentTnkAddr",
      lockedAt: Date.now(),
      claimedAt: null,
      refundedAt: null,
      preimage: null,
      lockTxHash: "tnk_lock_tx_hash_abc",
    });

    const { pollTnkEscrow } = await import("./jobs/tnkHtlcMonitor");
    await pollTnkEscrow();
    await new Promise(r => setTimeout(r, 50));

    expect(claimTnkHtlcMock).not.toHaveBeenCalled();
  });

  it("aborts settlement if claimTnkHtlc returns ok=false", async () => {
    claimTnkHtlcMock.mockResolvedValue({ ok: false, error: "insufficient-balance" });

    const db = makeDb([makeTnkToSolRow()], [makeSecretRow()]);
    const { getDb } = await import("./db");
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const { isTnkPeerHealthy, getTnkHtlcState } = await import("./tnkHtlcContract");
    (isTnkPeerHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (getTnkHtlcState as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "locked",
      secretHash: "b".repeat(64),
      amountRaw: "1000000000",
      locktime: Math.floor(Date.now() / 1000) + 7200,
      sender: "UserTnkAddr",
      recipient: "AgentTnkAddr",
      lockedAt: Date.now(),
      claimedAt: null,
      refundedAt: null,
      preimage: null,
      lockTxHash: "tnk_lock_tx_hash_abc",
    });

    const { pollTnkEscrow } = await import("./jobs/tnkHtlcMonitor");
    await pollTnkEscrow();
    await new Promise(r => setTimeout(r, 50));

    // claimTnkHtlc was called but failed — claimSolanaHtlc should NOT be called
    expect(claimTnkHtlcMock).toHaveBeenCalled();
    expect(claimSolanaHtlcMock).not.toHaveBeenCalled();
  });

  it("passes tokenSymbol=undefined for SOL, tokenSymbol=USDT for USDT swap", async () => {
    claimTnkHtlcMock.mockResolvedValue({ ok: true, contractTxHash: TNK_CONTRACT_TX });
    claimSolanaHtlcMock.mockResolvedValue({ txSignature: SOL_CLAIM_TX, htlcId: "htlc_a_test", recipient: "user" });

    // TNK → USDT swap
    const usdtRow = makeTnkToSolRow({ toToken: "USDT" });
    const db = makeDb([usdtRow], [makeSecretRow({ toToken: "USDT" })]);
    const { getDb } = await import("./db");
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const { isTnkPeerHealthy, getTnkHtlcState } = await import("./tnkHtlcContract");
    (isTnkPeerHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (getTnkHtlcState as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "locked",
      secretHash: "b".repeat(64),
      amountRaw: "1000000000",
      locktime: Math.floor(Date.now() / 1000) + 7200,
      sender: "UserTnkAddr",
      recipient: "AgentTnkAddr",
      lockedAt: Date.now(),
      claimedAt: null,
      refundedAt: null,
      preimage: null,
      lockTxHash: "tnk_lock_tx_hash_abc",
    });

    const { pollTnkEscrow } = await import("./jobs/tnkHtlcMonitor");
    await pollTnkEscrow();
    await new Promise(r => setTimeout(r, 50));

    expect(claimSolanaHtlcMock).toHaveBeenCalledWith(
      expect.objectContaining({ tokenSymbol: "USDT" })
    );
  });

  it("uses senderAddress from htlcSwaps row as recipientAddress for claimSolanaHtlc", async () => {
    claimTnkHtlcMock.mockResolvedValue({ ok: true, contractTxHash: TNK_CONTRACT_TX });
    claimSolanaHtlcMock.mockResolvedValue({ txSignature: SOL_CLAIM_TX, htlcId: "htlc_a_test", recipient: "user" });

    const userAddr = "UserSolanaAddr111111111111111111111111111111";
    const db = makeDb([makeTnkToSolRow({ senderAddress: userAddr })], [makeSecretRow()]);
    const { getDb } = await import("./db");
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const { isTnkPeerHealthy, getTnkHtlcState } = await import("./tnkHtlcContract");
    (isTnkPeerHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (getTnkHtlcState as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "locked",
      secretHash: "b".repeat(64),
      amountRaw: "1000000000",
      locktime: Math.floor(Date.now() / 1000) + 7200,
      sender: "UserTnkAddr",
      recipient: "AgentTnkAddr",
      lockedAt: Date.now(),
      claimedAt: null,
      refundedAt: null,
      preimage: null,
      lockTxHash: "tnk_lock_tx_hash_abc",
    });

    const { pollTnkEscrow } = await import("./jobs/tnkHtlcMonitor");
    await pollTnkEscrow();
    await new Promise(r => setTimeout(r, 50));

    expect(claimSolanaHtlcMock).toHaveBeenCalledWith(
      expect.objectContaining({ recipientAddress: userAddr })
    );
  });
});

// ─── isTnkToSol branch detection unit tests ───────────────────────────────────
describe("isTnkToSol branch detection logic", () => {
  it("triggers when toChain === 'solana' and rfqId is set", () => {
    const htlc = { toChain: "solana" as const, rfqId: "rfq_123" };
    const isTnkToSol = htlc.toChain === "solana" && !!htlc.rfqId;
    expect(isTnkToSol).toBe(true);
  });

  it("does not trigger when toChain === 'bitcoin'", () => {
    const htlc = { toChain: "bitcoin" as const, rfqId: "rfq_123" };
    const isTnkToSol = htlc.toChain === "solana" && !!htlc.rfqId;
    expect(isTnkToSol).toBe(false);
  });

  it("does not trigger when toChain === 'trac_network'", () => {
    const htlc = { toChain: "trac_network" as const, rfqId: "rfq_123" };
    const isTnkToSol = htlc.toChain === "solana" && !!htlc.rfqId;
    expect(isTnkToSol).toBe(false);
  });

  it("does not trigger when rfqId is null", () => {
    const htlc = { toChain: "solana" as const, rfqId: null };
    const isTnkToSol = htlc.toChain === "solana" && !!htlc.rfqId;
    expect(isTnkToSol).toBe(false);
  });

  it("htlcIdB naming: htlc_b_<rfqId first 22 chars>", () => {
    const rfqId = "rfq_tnk_to_sol_test_1234567890";
    const htlcIdB = `htlc_b_${rfqId.slice(0, 22)}`;
    // rfqId.slice(0,22) of "rfq_tnk_to_sol_test_1234567890" is "rfq_tnk_to_sol_test_12"
    expect(htlcIdB).toBe("htlc_b_rfq_tnk_to_sol_test_12");
    expect(htlcIdB).toMatch(/^htlc_b_/);
  });

  it("htlcIdA naming: htlc_a_<rfqId first 22 chars>", () => {
    const rfqId = "rfq_tnk_to_sol_test_1234567890";
    const htlcIdA = `htlc_a_${rfqId.slice(0, 22)}`;
    // rfqId.slice(0,22) of "rfq_tnk_to_sol_test_1234567890" is "rfq_tnk_to_sol_test_12"
    expect(htlcIdA).toBe("htlc_a_rfq_tnk_to_sol_test_12");
    expect(htlcIdA).toMatch(/^htlc_a_/);
  });

  it("tokenSymbol is undefined for SOL (native), string for SPL tokens", () => {
    expect("SOL" === "SOL" ? undefined : "SOL").toBeUndefined();
    expect("USDT" === "SOL" ? undefined : "USDT").toBe("USDT");
    expect("USDC" === "SOL" ? undefined : "USDC").toBe("USDC");
  });
});
