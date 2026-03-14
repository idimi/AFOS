/**
 * htlcProtocol.js — AFOS HTLC Protocol Definition for Trac Network
 *
 * A trac-peer Protocol maps incoming user commands to typed operations that
 * the Contract state machine can process. Each operation has:
 *   - type:     unique string identifier
 *   - validate: synchronous schema check (throws on invalid input)
 *   - prepare:  transforms raw user input into a canonical command object
 *
 * Supported operations:
 *   htlc_lock    — Lock TNK into the HTLC contract (called by swap initiator)
 *   htlc_claim   — Claim locked TNK by revealing the preimage (called by agent)
 *   htlc_refund  — Refund expired HTLC back to sender (called by agent)
 *   htlc_query   — Read-only state query (no state mutation)
 *
 * Per the Trac Network dApp Developer Guide:
 *   - Protocols define the "interface" layer; Contracts define the "logic" layer
 *   - The peer validates the protocol before calling the contract
 *   - prepare() returns the prepared_command that gets signed and broadcast
 */

"use strict";

// ─── Validation helpers ───────────────────────────────────────────────────────

function requireString(val, name, minLen = 1, maxLen = 512) {
  if (typeof val !== "string" || val.length < minLen || val.length > maxLen) {
    throw new Error(`${name} must be a string of length ${minLen}–${maxLen}`);
  }
}

function requireHex(val, name, exactLen) {
  requireString(val, name, exactLen, exactLen);
  if (!/^[0-9a-fA-F]+$/.test(val)) {
    throw new Error(`${name} must be a hex string`);
  }
}

function requirePositiveIntString(val, name) {
  if (typeof val !== "string" || !/^\d+$/.test(val) || BigInt(val) <= 0n) {
    throw new Error(`${name} must be a positive integer string`);
  }
}

function requirePositiveNumber(val, name) {
  if (typeof val !== "number" || !Number.isFinite(val) || val <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
}

// ─── Protocol definition ──────────────────────────────────────────────────────

export const AfosHtlcProtocol = {
  name: "afos_htlc",
  version: "1.0.0",

  operations: {
    /**
     * htlc_lock — Lock TNK into the HTLC contract
     *
     * Called by the swap initiator after sending TNK to the contract address.
     * Records the HTLC commitment on-chain in the subnet state.
     *
     * Input:
     *   htlcId      — unique swap identifier (UUID or hex)
     *   secretHash  — SHA-256 hash of the preimage (hex64)
     *   amountRaw   — TNK amount in smallest unit (integer string)
     *   locktime    — Unix timestamp (seconds) after which refund is allowed
     *   sender      — trac1... address of the TNK sender
     *   recipient   — trac1... address of the intended TNK recipient
     *   lockTxHash  — (optional) on-chain TNK transfer tx hash for proof
     */
    htlc_lock: {
      validate(input) {
        requireString(input.htlcId, "htlcId", 1, 128);
        requireHex(input.secretHash, "secretHash", 64);
        requirePositiveIntString(input.amountRaw, "amountRaw");
        requirePositiveNumber(input.locktime, "locktime");
        requireString(input.sender, "sender", 5, 128);
        requireString(input.recipient, "recipient", 5, 128);
        if (input.lockTxHash !== undefined) {
          requireString(input.lockTxHash, "lockTxHash", 1, 128);
        }
      },
      prepare(input) {
        return {
          type: "htlc_lock",
          value: {
            htlcId:     input.htlcId,
            secretHash: input.secretHash.toLowerCase(),
            amountRaw:  input.amountRaw,
            locktime:   input.locktime,
            sender:     input.sender,
            recipient:  input.recipient,
            lockTxHash: input.lockTxHash ?? null,
          },
        };
      },
    },

    /**
     * htlc_claim — Claim locked TNK by revealing the preimage
     *
     * Called by the AFOS agent after the counterparty reveals the secret.
     * The contract verifies sha256(preimage) == secretHash.
     * The actual TNK release (sendTNK) is executed by the AFOS server after
     * this contract command succeeds.
     *
     * Input:
     *   htlcId   — HTLC identifier (must match a locked HTLC)
     *   preimage — The secret preimage (hex string, any length <= 256 chars)
     */
    htlc_claim: {
      validate(input) {
        requireString(input.htlcId, "htlcId", 1, 128);
        requireString(input.preimage, "preimage", 1, 256);
      },
      prepare(input) {
        return {
          type: "htlc_claim",
          value: {
            htlcId:   input.htlcId,
            preimage: input.preimage,
          },
        };
      },
    },

    /**
     * htlc_refund — Refund expired HTLC back to sender
     *
     * Called by the AFOS agent after the timelock has expired.
     * The contract verifies current block height > locktime.
     * The actual TNK return (sendTNK back to sender) is executed by the AFOS
     * server after this contract command succeeds.
     *
     * Input:
     *   htlcId — HTLC identifier (must match a locked, expired HTLC)
     */
    htlc_refund: {
      validate(input) {
        requireString(input.htlcId, "htlcId", 1, 128);
      },
      prepare(input) {
        return {
          type: "htlc_refund",
          value: {
            htlcId: input.htlcId,
          },
        };
      },
    },

    /**
     * htlc_query — Read-only state query (no state mutation)
     *
     * Returns the current state of an HTLC. Used by the monitor and UI.
     * This is a convenience wrapper; callers can also query the subnet state
     * directly via GET /v1/state?key=htlc/{htlcId}.
     *
     * Input:
     *   htlcId — HTLC identifier to query
     */
    htlc_query: {
      validate(input) {
        requireString(input.htlcId, "htlcId", 1, 128);
      },
      prepare(input) {
        return {
          type: "htlc_query",
          value: {
            htlcId: input.htlcId,
          },
        };
      },
    },
  },
};

export default AfosHtlcProtocol;
