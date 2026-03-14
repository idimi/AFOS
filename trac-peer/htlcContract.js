/**
 * htlcContract.js — AFOS HTLC Contract State Machine for Trac Network
 *
 * This is the deterministic state machine that runs inside the trac-peer node.
 * It processes commands from the Protocol layer and mutates the subnet state.
 *
 * State schema (stored per HTLC at key "htlc/{htlcId}"):
 * {
 *   status:     "locked" | "claimed" | "refunded"
 *   secretHash: string   // hex64 SHA-256 hash
 *   amountRaw:  string   // TNK in smallest unit
 *   locktime:   number   // Unix timestamp (seconds) — refund allowed after this
 *   sender:     string   // trac1... address
 *   recipient:  string   // trac1... address
 *   lockedAt:   number   // Unix timestamp when locked
 *   claimedAt:  number | null
 *   refundedAt: number | null
 *   preimage:   string | null  // revealed on claim
 *   lockTxHash: string | null  // on-chain TNK transfer tx hash
 * }
 *
 * Contract invariants:
 *   1. An HTLC can only be locked once (htlcId is unique)
 *   2. An HTLC can only be claimed when status="locked" and sha256(preimage)==secretHash
 *   3. An HTLC can only be refunded when status="locked" and currentTime > locktime
 *   4. State transitions are irreversible
 *
 * Cross-chain compatibility:
 *   The secretHash/preimage mechanism is identical to Solana's HTLC program,
 *   enabling atomic cross-chain swaps where the same secret unlocks both legs.
 */

"use strict";

import crypto from "node:crypto";

// ─── State key helpers ────────────────────────────────────────────────────────

function htlcKey(htlcId) {
  return `htlc/${htlcId}`;
}

// ─── SHA-256 helper ───────────────────────────────────────────────────────────

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

// ─── Contract definition ──────────────────────────────────────────────────────

export const AfosHtlcContract = {
  name: "afos_htlc",
  version: "1.0.0",

  /**
   * process — Handle a prepared command from the Protocol layer.
   *
   * @param {object} command      - { type, value } from Protocol.prepare()
   * @param {object} state        - Current subnet state (key-value store proxy)
   * @param {object} context      - { blockHeight, timestamp, caller }
   * @returns {object}            - { ok: boolean, error?: string, result?: unknown }
   */
  async process(command, state, context) {
    const { type, value } = command;

    switch (type) {
      case "htlc_lock":
        return this._lock(value, state, context);
      case "htlc_claim":
        return this._claim(value, state, context);
      case "htlc_refund":
        return this._refund(value, state, context);
      case "htlc_query":
        return this._query(value, state);
      default:
        return { ok: false, error: `Unknown command type: ${type}` };
    }
  },

  // ─── Lock ─────────────────────────────────────────────────────────────────

  async _lock(value, state, context) {
    const key = htlcKey(value.htlcId);

    // Idempotency: if already locked with same params, return ok
    const existing = await state.get(key);
    if (existing) {
      if (existing.secretHash === value.secretHash.toLowerCase()) {
        return { ok: true, result: existing, idempotent: true };
      }
      return {
        ok: false,
        error: `HTLC ${value.htlcId} already exists with a different secretHash`,
      };
    }

    // Validate locktime is in the future
    const now = context.timestamp ?? Math.floor(Date.now() / 1000);
    if (value.locktime <= now) {
      return {
        ok: false,
        error: `locktime ${value.locktime} is in the past (now: ${now})`,
      };
    }

    // Validate minimum locktime: at least 10 minutes from now
    const MIN_LOCKTIME_SECONDS = 10 * 60;
    if (value.locktime - now < MIN_LOCKTIME_SECONDS) {
      return {
        ok: false,
        error: `locktime must be at least ${MIN_LOCKTIME_SECONDS}s in the future`,
      };
    }

    const htlcState = {
      status:     "locked",
      secretHash: value.secretHash.toLowerCase(),
      amountRaw:  value.amountRaw,
      locktime:   value.locktime,
      sender:     value.sender,
      recipient:  value.recipient,
      lockedAt:   now,
      claimedAt:  null,
      refundedAt: null,
      preimage:   null,
      lockTxHash: value.lockTxHash ?? null,
    };

    await state.set(key, htlcState);

    console.log(
      `[AFOS HTLC Contract] Locked HTLC ${value.htlcId} ` +
      `amount=${value.amountRaw} sender=${value.sender.slice(0, 20)}... ` +
      `locktime=${value.locktime}`
    );

    return { ok: true, result: htlcState };
  },

  // ─── Claim ────────────────────────────────────────────────────────────────

  async _claim(value, state, context) {
    const key = htlcKey(value.htlcId);
    const htlcState = await state.get(key);

    if (!htlcState) {
      return { ok: false, error: `HTLC ${value.htlcId} not found` };
    }

    if (htlcState.status !== "locked") {
      return {
        ok: false,
        error: `HTLC ${value.htlcId} is not in locked state (current: ${htlcState.status})`,
      };
    }

    // Verify the preimage
    const computedHash = sha256Hex(value.preimage);
    if (computedHash !== htlcState.secretHash) {
      return {
        ok: false,
        error: `Invalid preimage: sha256(preimage)=${computedHash} != secretHash=${htlcState.secretHash}`,
      };
    }

    const now = context.timestamp ?? Math.floor(Date.now() / 1000);

    // Check timelock has not expired (can still claim if within timelock)
    if (now > htlcState.locktime) {
      return {
        ok: false,
        error: `HTLC ${value.htlcId} timelock has expired (locktime=${htlcState.locktime}, now=${now})`,
      };
    }

    const updated = {
      ...htlcState,
      status:    "claimed",
      claimedAt: now,
      preimage:  value.preimage,
    };

    await state.set(key, updated);

    console.log(
      `[AFOS HTLC Contract] Claimed HTLC ${value.htlcId} ` +
      `recipient=${htlcState.recipient.slice(0, 20)}... ` +
      `amount=${htlcState.amountRaw}`
    );

    return {
      ok: true,
      result: {
        htlcId:    value.htlcId,
        status:    "claimed",
        recipient: htlcState.recipient,
        amountRaw: htlcState.amountRaw,
        preimage:  value.preimage,
        claimedAt: now,
      },
    };
  },

  // ─── Refund ───────────────────────────────────────────────────────────────

  async _refund(value, state, context) {
    const key = htlcKey(value.htlcId);
    const htlcState = await state.get(key);

    if (!htlcState) {
      return { ok: false, error: `HTLC ${value.htlcId} not found` };
    }

    if (htlcState.status !== "locked") {
      return {
        ok: false,
        error: `HTLC ${value.htlcId} is not in locked state (current: ${htlcState.status})`,
      };
    }

    const now = context.timestamp ?? Math.floor(Date.now() / 1000);

    if (now <= htlcState.locktime) {
      return {
        ok: false,
        error:
          `HTLC ${value.htlcId} timelock has not yet expired ` +
          `(locktime=${htlcState.locktime}, now=${now}, ` +
          `remaining=${htlcState.locktime - now}s)`,
      };
    }

    const updated = {
      ...htlcState,
      status:     "refunded",
      refundedAt: now,
    };

    await state.set(key, updated);

    console.log(
      `[AFOS HTLC Contract] Refunded HTLC ${value.htlcId} ` +
      `sender=${htlcState.sender.slice(0, 20)}... ` +
      `amount=${htlcState.amountRaw}`
    );

    return {
      ok: true,
      result: {
        htlcId:     value.htlcId,
        status:     "refunded",
        sender:     htlcState.sender,
        amountRaw:  htlcState.amountRaw,
        refundedAt: now,
      },
    };
  },

  // ─── Query (read-only) ────────────────────────────────────────────────────

  async _query(value, state) {
    const key = htlcKey(value.htlcId);
    const htlcState = await state.get(key);

    if (!htlcState) {
      return { ok: true, result: null };
    }

    return { ok: true, result: htlcState };
  },
};

export default AfosHtlcContract;
