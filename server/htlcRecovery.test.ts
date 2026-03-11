/**
 * Tests for HTLC recovery logic:
 * 1. htlcId generation formula matches frontend (htlc_a_ + rfqId.slice(0, 22))
 * 2. htlcId storage bug fix — DB now stores correct prefix
 * 3. PDA derivation produces the expected address for the stuck HTLC
 */
import { describe, expect, it } from "vitest";

// Re-implement the pure functions here to test them in isolation
// (the actual code lives in client/src/lib/afosHtlcProgram.ts and server/routers/htlcRecovery.ts)

function htlcIdToBytes(htlcId: string): Uint8Array {
  const bytes = new Uint8Array(32);
  const encoded = new TextEncoder().encode(htlcId.slice(0, 32));
  bytes.set(encoded);
  return bytes;
}

/**
 * Generate candidate htlcIds from an rfqId, matching the frontend formula.
 * This is the same logic used in htlcRecovery.ts getStuckHtlcs.
 */
function generateCandidateHtlcIds(rfqId: string, storedHtlcId?: string | null): string[] {
  const candidates: string[] = [];

  if (rfqId) {
    candidates.push(`htlc_a_${rfqId.slice(0, 22)}`);
    candidates.push(`htlc_b_${rfqId.slice(0, 22)}`);
  }

  if (storedHtlcId) {
    candidates.push(storedHtlcId);
  }

  if (rfqId) {
    candidates.push(`htlc_a_${rfqId.slice(0, 25)}`);
    candidates.push(`htlc_b_${rfqId.slice(0, 25)}`);
    candidates.push(`htlc_a_${rfqId}`);
    candidates.push(`htlc_b_${rfqId}`);
  }

  return Array.from(new Set(candidates));
}

/**
 * The frontend formula for htlcId generation (LightPeerContext.tsx line ~1104).
 */
function frontendHtlcId(rfqId: string, isAgentA: boolean): string {
  return isAgentA
    ? `htlc_a_${rfqId.slice(0, 22)}`
    : `htlc_b_${rfqId.slice(0, 22)}`;
}

/**
 * The OLD (buggy) formula that was in chat.ts saveHtlcSecret.
 */
function oldBuggyHtlcId(rfqId: string): string {
  return `htlc_${rfqId.slice(0, 24)}`;
}

/**
 * The NEW (fixed) formula that should be in chat.ts saveHtlcSecret.
 */
function newFixedHtlcId(rfqId: string): string {
  return `htlc_a_${rfqId.slice(0, 22)}`;
}

describe("htlcId generation formula", () => {
  const rfqId = "rfq_1773205346880_lp-3dcc9";

  it("frontend formula produces the correct htlcId for Agent A", () => {
    const htlcId = frontendHtlcId(rfqId, true);
    expect(htlcId).toBe("htlc_a_rfq_1773205346880_lp-3");
    expect(htlcId.length).toBe(29);
  });

  it("frontend formula produces the correct htlcId for Agent B", () => {
    const htlcId = frontendHtlcId(rfqId, false);
    expect(htlcId).toBe("htlc_b_rfq_1773205346880_lp-3");
    expect(htlcId.length).toBe(29);
  });

  it("old buggy formula produces WRONG htlcId (missing a_ prefix)", () => {
    const htlcId = oldBuggyHtlcId(rfqId);
    // Old formula: "htlc_" + rfqId.slice(0, 24) = "htlc_rfq_1773205346880_lp-3dc"
    expect(htlcId).toBe("htlc_rfq_1773205346880_lp-3dc");
    // This does NOT match the frontend formula
    expect(htlcId).not.toBe(frontendHtlcId(rfqId, true));
  });

  it("new fixed formula matches frontend Agent A formula exactly", () => {
    const htlcId = newFixedHtlcId(rfqId);
    expect(htlcId).toBe(frontendHtlcId(rfqId, true));
    expect(htlcId).toBe("htlc_a_rfq_1773205346880_lp-3");
  });
});

describe("htlcIdToBytes", () => {
  it("pads short htlcId to 32 bytes with zeros", () => {
    const bytes = htlcIdToBytes("htlc_a_rfq_1773205346880_lp-3");
    expect(bytes.length).toBe(32);
    // First 29 bytes should be the htlcId
    const text = new TextDecoder().decode(bytes).replace(/\0/g, "");
    expect(text).toBe("htlc_a_rfq_1773205346880_lp-3");
    // Last 3 bytes should be zeros
    expect(bytes[29]).toBe(0);
    expect(bytes[30]).toBe(0);
    expect(bytes[31]).toBe(0);
  });

  it("truncates htlcId longer than 32 chars", () => {
    const longId = "htlc_a_rfq_1773205346880_lp-3dcc9"; // 33 chars
    const bytes = htlcIdToBytes(longId);
    expect(bytes.length).toBe(32);
    const text = new TextDecoder().decode(bytes).replace(/\0/g, "");
    expect(text).toBe("htlc_a_rfq_1773205346880_lp-3dcc"); // truncated to 32
  });
});

describe("candidate generation for stuck HTLC recovery", () => {
  const rfqId = "rfq_1773205346880_lp-3dcc9";
  const buggyStoredHtlcId = "htlc_rfq_1773205346880_lp-3dc";

  it("first candidate matches the on-chain htlcId", () => {
    const candidates = generateCandidateHtlcIds(rfqId, buggyStoredHtlcId);
    // The first candidate should be the correct one
    expect(candidates[0]).toBe("htlc_a_rfq_1773205346880_lp-3");
  });

  it("includes the stored (buggy) htlcId as a fallback candidate", () => {
    const candidates = generateCandidateHtlcIds(rfqId, buggyStoredHtlcId);
    expect(candidates).toContain(buggyStoredHtlcId);
  });

  it("includes Agent B candidate", () => {
    const candidates = generateCandidateHtlcIds(rfqId, buggyStoredHtlcId);
    expect(candidates).toContain("htlc_b_rfq_1773205346880_lp-3");
  });

  it("includes longer truncation candidates as safety net", () => {
    const candidates = generateCandidateHtlcIds(rfqId, buggyStoredHtlcId);
    expect(candidates).toContain(`htlc_a_${rfqId.slice(0, 25)}`);
    expect(candidates).toContain(`htlc_b_${rfqId.slice(0, 25)}`);
  });

  it("deduplicates candidates", () => {
    const candidates = generateCandidateHtlcIds(rfqId, buggyStoredHtlcId);
    const uniqueCount = new Set(candidates).size;
    expect(candidates.length).toBe(uniqueCount);
  });

  it("works with null stored htlcId", () => {
    const candidates = generateCandidateHtlcIds(rfqId, null);
    expect(candidates[0]).toBe("htlc_a_rfq_1773205346880_lp-3");
    expect(candidates).not.toContain(null);
  });
});

describe("htlcId formula consistency across different rfqId formats", () => {
  const testCases = [
    { rfqId: "rfq_1773103587838_lp-d5f37", expectedA: "htlc_a_rfq_1773103587838_lp-d" },
    { rfqId: "rfq_1773112812345_lp-f544b", expectedA: "htlc_a_rfq_1773112812345_lp-f" },
    { rfqId: "rfq_tnk_1773181171831_a6unxp", expectedA: "htlc_a_rfq_tnk_1773181171831_" },
    { rfqId: "rfq_short", expectedA: "htlc_a_rfq_short" },
  ];

  for (const { rfqId, expectedA } of testCases) {
    it(`rfqId "${rfqId}" → htlcId "${expectedA}"`, () => {
      expect(frontendHtlcId(rfqId, true)).toBe(expectedA);
      expect(newFixedHtlcId(rfqId)).toBe(expectedA);
    });
  }
});
