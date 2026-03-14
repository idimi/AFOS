/**
 * htlcProtocol.js — AFOS HTLC Protocol for Trac Network
 *
 * Extends trac-peer BaseProtocol. Maps CLI commands and JSON inputs into
 * typed operations that the HtlcContract state machine processes.
 *
 * Supported tx types:
 *   htlc_lock    — Lock TNK into the HTLC (swap initiator)
 *   htlc_claim   — Claim locked TNK by revealing preimage (agent)
 *   htlc_refund  — Refund expired HTLC back to sender (agent)
 */
import BaseProtocol from "trac-peer/src/artifacts/protocol.js";

class HtlcProtocol extends BaseProtocol {
  mapTxCommand(command) {
    if (typeof command !== "string" || command.trim() === "") return null;
    const raw = command.trim();

    // Accept raw JSON: { "type": "htlc_lock", "value": { ... } }
    if (raw.startsWith("{")) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.type === "string" && parsed.value !== undefined) {
          return { type: parsed.type, value: parsed.value };
        }
      } catch (_e) {}
    }

    // CLI: htlc_lock <htlcId> <secretHash> <amountRaw> <locktime> <sender> <recipient> <lockTxHash>
    if (raw.startsWith("htlc_lock ")) {
      const parts = raw.split(" ").filter(Boolean);
      if (parts.length >= 8) {
        return {
          type: "htlc_lock",
          value: {
            htlcId: parts[1],
            secretHash: parts[2],
            amountRaw: parts[3],
            locktime: parseInt(parts[4], 10),
            sender: parts[5],
            recipient: parts[6],
            lockTxHash: parts[7],
          },
        };
      }
    }

    // CLI: htlc_claim <htlcId> <preimage>
    if (raw.startsWith("htlc_claim ")) {
      const parts = raw.split(" ").filter(Boolean);
      if (parts.length >= 3) {
        return { type: "htlc_claim", value: { htlcId: parts[1], preimage: parts[2] } };
      }
    }

    // CLI: htlc_refund <htlcId>
    if (raw.startsWith("htlc_refund ")) {
      const parts = raw.split(" ").filter(Boolean);
      if (parts.length >= 2) {
        return { type: "htlc_refund", value: { htlcId: parts[1] } };
      }
    }

    return null;
  }

  async printOptions() {
    console.log("");
    console.log("- AFOS HTLC commands:");
    console.log("  /tx --command 'htlc_lock <htlcId> <secretHash64> <amountRaw> <locktime> <sender> <recipient> <lockTxHash>'");
    console.log("  /tx --command 'htlc_claim <htlcId> <preimage>'");
    console.log("  /tx --command 'htlc_refund <htlcId>'");
    console.log("  /get --key \"htlc/<htlcId>\"  -- read HTLC state");
    console.log("");
  }
}

export default HtlcProtocol;
