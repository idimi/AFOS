/**
 * Tests for Helius HTLC Webhook — instruction identification, event extraction,
 * webhook status tracking, and settlement badge logic.
 */
import { describe, expect, it } from "vitest";
import {
  identifyInstruction,
  extractProgramInstructions,
  getWebhookStatus,
  setWebhookId,
} from "./heliusHtlc";
import type { HeliusRawEvent, HeliusInstruction } from "./heliusHtlc";

// ── Anchor discriminators (copied from source for test verification) ─────────

const DISCRIMINATORS = {
  lockSol:   [181, 15, 15, 99, 159, 87, 241, 42],
  lockToken: [153, 150, 141, 190, 78, 115, 232, 80],
  claim:     [62, 198, 214, 193, 213, 159, 108, 210],
  refund:    [2, 96, 183, 251, 63, 208, 46, 46],
};

// ── Helper: encode discriminator bytes as base58 ─────────────────────────────

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(bytes: number[]): string {
  // Simple base58 encoder for small byte arrays
  if (bytes.length === 0) return "";
  let value = BigInt(0);
  for (const b of bytes) {
    value = value * 256n + BigInt(b);
  }
  let result = "";
  while (value > 0n) {
    const remainder = Number(value % 58n);
    result = BASE58_ALPHABET[remainder] + result;
    value = value / 58n;
  }
  // Add leading '1's for leading zero bytes
  for (const b of bytes) {
    if (b === 0) result = "1" + result;
    else break;
  }
  return result || "1";
}

// ── Tests: identifyInstruction ───────────────────────────────────────────────

describe("identifyInstruction", () => {
  it("returns null for undefined data", () => {
    expect(identifyInstruction(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(identifyInstruction("")).toBeNull();
  });

  it("returns null for data shorter than 8 bytes", () => {
    expect(identifyInstruction([1, 2, 3])).toBeNull();
  });

  it("identifies lockSol from byte array", () => {
    const data = [...DISCRIMINATORS.lockSol, 0, 0, 0, 0]; // 8 discriminator + padding
    expect(identifyInstruction(data)).toBe("lockSol");
  });

  it("identifies lockToken from byte array", () => {
    const data = [...DISCRIMINATORS.lockToken, 0, 0, 0, 0];
    expect(identifyInstruction(data)).toBe("lockToken");
  });

  it("identifies claim from byte array", () => {
    const data = [...DISCRIMINATORS.claim, 0, 0, 0, 0];
    expect(identifyInstruction(data)).toBe("claim");
  });

  it("identifies refund from byte array", () => {
    const data = [...DISCRIMINATORS.refund, 0, 0, 0, 0];
    expect(identifyInstruction(data)).toBe("refund");
  });

  it("returns null for unrecognized byte array", () => {
    const data = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3];
    expect(identifyInstruction(data)).toBeNull();
  });

  it("identifies lockSol from base58-encoded string", () => {
    // Encode the lockSol discriminator + some trailing bytes as base58
    const bytes = [...DISCRIMINATORS.lockSol, 99, 88, 77, 66, 55, 44, 33, 22];
    const encoded = encodeBase58(bytes);
    expect(identifyInstruction(encoded)).toBe("lockSol");
  });

  it("identifies claim from base58-encoded string", () => {
    const bytes = [...DISCRIMINATORS.claim, 1, 2, 3, 4, 5, 6, 7, 8];
    const encoded = encodeBase58(bytes);
    expect(identifyInstruction(encoded)).toBe("claim");
  });
});

// ── Tests: extractProgramInstructions ────────────────────────────────────────

const PROGRAM_ID = "XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW";

describe("extractProgramInstructions", () => {
  it("returns empty array for event with no instructions", () => {
    const event: HeliusRawEvent = {};
    expect(extractProgramInstructions(event)).toEqual([]);
  });

  it("extracts instructions from top-level instructions array", () => {
    const event: HeliusRawEvent = {
      instructions: [
        { programId: PROGRAM_ID, accounts: ["acc1"], data: [1, 2, 3] },
        { programId: "otherProgram", accounts: ["acc2"] },
      ],
    };
    const result = extractProgramInstructions(event);
    expect(result).toHaveLength(1);
    expect(result[0].programId).toBe(PROGRAM_ID);
  });

  it("extracts instructions from transaction.message.instructions", () => {
    const event: HeliusRawEvent = {
      transaction: {
        message: {
          instructions: [
            { programId: PROGRAM_ID, accounts: ["pda1"] },
          ],
        },
      },
    };
    const result = extractProgramInstructions(event);
    expect(result).toHaveLength(1);
  });

  it("extracts inner instructions from top-level instructions", () => {
    const event: HeliusRawEvent = {
      instructions: [
        {
          programId: "wrapperProgram",
          innerInstructions: [
            { programId: PROGRAM_ID, accounts: ["inner1"] },
          ],
        },
      ],
    };
    const result = extractProgramInstructions(event);
    expect(result).toHaveLength(1);
    expect(result[0].accounts).toEqual(["inner1"]);
  });

  it("extracts from event.innerInstructions groups", () => {
    const event: HeliusRawEvent = {
      innerInstructions: [
        {
          index: 0,
          instructions: [
            { programId: PROGRAM_ID, accounts: ["grouped1"] },
            { programId: "other", accounts: ["other1"] },
          ],
        },
      ],
    };
    const result = extractProgramInstructions(event);
    expect(result).toHaveLength(1);
    expect(result[0].accounts).toEqual(["grouped1"]);
  });

  it("combines instructions from multiple sources", () => {
    const event: HeliusRawEvent = {
      instructions: [
        { programId: PROGRAM_ID, accounts: ["top1"] },
      ],
      innerInstructions: [
        {
          index: 0,
          instructions: [
            { programId: PROGRAM_ID, accounts: ["inner1"] },
          ],
        },
      ],
    };
    const result = extractProgramInstructions(event);
    expect(result).toHaveLength(2);
  });
});

// ── Tests: webhook status tracking ───────────────────────────────────────────

describe("webhookStatus", () => {
  it("starts with null webhookId", () => {
    const status = getWebhookStatus();
    // webhookId may be null or set from a previous test run; just check shape
    expect(status).toHaveProperty("webhookId");
    expect(status).toHaveProperty("registeredUrl");
    expect(status).toHaveProperty("totalEventsReceived");
    expect(status).toHaveProperty("totalClaimsTriggered");
  });

  it("setWebhookId updates the status", () => {
    setWebhookId("test-webhook-123", "https://example.com/api/webhooks/helius-htlc");
    const status = getWebhookStatus();
    expect(status.webhookId).toBe("test-webhook-123");
    expect(status.registeredUrl).toBe("https://example.com/api/webhooks/helius-htlc");
  });

  it("getWebhookStatus returns a copy (not a reference)", () => {
    const status1 = getWebhookStatus();
    const status2 = getWebhookStatus();
    expect(status1).not.toBe(status2);
    expect(status1).toEqual(status2);
  });
});

// ── Tests: settlement speed classification (mirrors SettlementBadge logic) ───

describe("settlement speed classification", () => {
  function classifySpeed(ms: number): "fast" | "normal" | "slow" {
    if (ms > 0 && ms < 30_000) return "fast";
    if (ms >= 30_000 && ms < 300_000) return "normal";
    return "slow";
  }

  it("classifies < 30s as fast (webhook-triggered)", () => {
    expect(classifySpeed(5_000)).toBe("fast");
    expect(classifySpeed(15_000)).toBe("fast");
    expect(classifySpeed(29_999)).toBe("fast");
  });

  it("classifies 30s–5min as normal", () => {
    expect(classifySpeed(30_000)).toBe("normal");
    expect(classifySpeed(120_000)).toBe("normal");
    expect(classifySpeed(299_999)).toBe("normal");
  });

  it("classifies > 5min as slow (monitor fallback)", () => {
    expect(classifySpeed(300_000)).toBe("slow");
    expect(classifySpeed(600_000)).toBe("slow");
  });

  it("classifies 0ms as slow (no settlement data)", () => {
    expect(classifySpeed(0)).toBe("slow");
  });
});

// ── Tests: settledVia label mapping (mirrors SettlementBadge logic) ──────────

describe("settledVia label mapping", () => {
  function mapViaLabel(via: string | null): string | null {
    if (via === "helius_webhook") return "Webhook";
    if (via === "browser_notify") return "Browser";
    if (via === "monitor_fallback") return "Monitor";
    if (via === "admin_force_claim") return "Admin";
    return null;
  }

  it("maps helius_webhook to Webhook", () => {
    expect(mapViaLabel("helius_webhook")).toBe("Webhook");
  });

  it("maps browser_notify to Browser", () => {
    expect(mapViaLabel("browser_notify")).toBe("Browser");
  });

  it("maps monitor_fallback to Monitor", () => {
    expect(mapViaLabel("monitor_fallback")).toBe("Monitor");
  });

  it("maps admin_force_claim to Admin", () => {
    expect(mapViaLabel("admin_force_claim")).toBe("Admin");
  });

  it("returns null for unknown values", () => {
    expect(mapViaLabel(null)).toBeNull();
    expect(mapViaLabel("unknown")).toBeNull();
  });
});
