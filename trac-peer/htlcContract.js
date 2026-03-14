/**
 * htlcContract.js — AFOS HTLC Contract State Machine for Trac Network
 *
 * Extends trac-peer BaseContract. Deterministic state machine that runs on
 * every subnet node. Processes htlc_lock, htlc_claim, htlc_refund operations.
 *
 * State stored at key "htlc/<htlcId>":
 * {
 *   status:     "locked" | "claimed" | "refunded"
 *   secretHash: string   // hex64 SHA-256 hash
 *   amountRaw:  string   // TNK in smallest unit
 *   locktime:   number   // Unix timestamp (seconds)
 *   sender:     string   // trac1... address
 *   recipient:  string   // trac1... address
 *   lockedAt:   number   // Unix timestamp
 *   claimedAt:  number | null
 *   refundedAt: number | null
 *   preimage:   string | null
 *   lockTxHash: string | null
 * }
 */
import BaseContract from "trac-peer/src/artifacts/contract.js";
import crypto from "node:crypto";

function htlcKey(htlcId) {
  return `htlc/${htlcId}`;
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

class HtlcContract extends BaseContract {
  constructor(protocol, config) {
    super(protocol, config);
    this.addFunction("htlc_lock");
    this.addFunction("htlc_claim");
    this.addFunction("htlc_refund");
  }

  // ── htlc_lock ────────────────────────────────────────────────────────────────
  async htlc_lock() {
    const v = this.value;
    const now = Math.floor(Date.now() / 1000);

    // Validate required fields
    if (!v.htlcId || typeof v.htlcId !== "string") throw new Error("htlcId required");
    if (!v.secretHash || !/^[0-9a-f]{64}$/i.test(v.secretHash)) throw new Error("secretHash must be hex64");
    if (!v.amountRaw || !/^\d+$/.test(v.amountRaw) || BigInt(v.amountRaw) <= 0n) throw new Error("amountRaw must be positive integer string");
    if (!v.locktime || typeof v.locktime !== "number" || v.locktime <= now) throw new Error("locktime must be a future Unix timestamp");
    if (!v.sender || typeof v.sender !== "string") throw new Error("sender required");
    if (!v.recipient || typeof v.recipient !== "string") throw new Error("recipient required");

    const key = htlcKey(v.htlcId);
    const existing = await this.get(key);
    if (existing !== null) throw new Error(`HTLC ${v.htlcId} already exists`);

    await this.put(key, {
      status: "locked",
      secretHash: v.secretHash.toLowerCase(),
      amountRaw: v.amountRaw,
      locktime: v.locktime,
      sender: v.sender,
      recipient: v.recipient,
      lockedAt: now,
      claimedAt: null,
      refundedAt: null,
      preimage: null,
      lockTxHash: v.lockTxHash ?? null,
    });
  }

  // ── htlc_claim ───────────────────────────────────────────────────────────────
  async htlc_claim() {
    const v = this.value;
    if (!v.htlcId || typeof v.htlcId !== "string") throw new Error("htlcId required");
    if (!v.preimage || typeof v.preimage !== "string") throw new Error("preimage required");

    const key = htlcKey(v.htlcId);
    const htlc = await this.get(key);
    if (htlc === null) throw new Error(`HTLC ${v.htlcId} not found`);

    const state = typeof htlc === "string" ? JSON.parse(htlc) : htlc;
    if (state.status !== "locked") throw new Error(`HTLC ${v.htlcId} is not locked (status: ${state.status})`);

    const hash = sha256Hex(v.preimage);
    if (hash !== state.secretHash) throw new Error("Preimage does not match secretHash");

    await this.put(key, {
      ...state,
      status: "claimed",
      preimage: v.preimage,
      claimedAt: Math.floor(Date.now() / 1000),
    });
  }

  // ── htlc_refund ──────────────────────────────────────────────────────────────
  async htlc_refund() {
    const v = this.value;
    if (!v.htlcId || typeof v.htlcId !== "string") throw new Error("htlcId required");

    const key = htlcKey(v.htlcId);
    const htlc = await this.get(key);
    if (htlc === null) throw new Error(`HTLC ${v.htlcId} not found`);

    const state = typeof htlc === "string" ? JSON.parse(htlc) : htlc;
    if (state.status !== "locked") throw new Error(`HTLC ${v.htlcId} is not locked (status: ${state.status})`);

    const now = Math.floor(Date.now() / 1000);
    if (now <= state.locktime) throw new Error(`HTLC ${v.htlcId} timelock has not expired yet`);

    await this.put(key, {
      ...state,
      status: "refunded",
      refundedAt: now,
    });
  }
}

export default HtlcContract;
