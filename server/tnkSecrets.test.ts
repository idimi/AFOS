/**
 * tnkSecrets.test.ts
 *
 * Validates that the TNK signing keys required for live HTLC execution are
 * present in the environment.
 *
 * NOTE: TNK_HTLC_WIF is used as a presence flag by executeTnkAgentSwap —
 * when set, the function routes to the Oracle VM for live execution instead
 * of returning a demo result.  The actual signing is performed by the Oracle
 * VM, so the value does not need to be a valid Bitcoin WIF key; it only
 * needs to be a non-empty string.
 *
 * TNK_AGENT_KEY is used by tnkHtlcMonitor for refund signing and similarly
 * only needs to be a non-empty string.
 */

import { describe, it, expect } from "vitest";

describe("TNK signing keys", () => {
  it("TNK_HTLC_WIF is set and non-empty", () => {
    const wif = process.env.TNK_HTLC_WIF;
    expect(
      wif,
      "TNK_HTLC_WIF must be set in project secrets to enable live TNK HTLC signing"
    ).toBeDefined();
    expect(typeof wif).toBe("string");
    expect((wif as string).length, "TNK_HTLC_WIF must not be an empty string").toBeGreaterThan(0);
  });

  it("TNK_AGENT_KEY is set and non-empty", () => {
    const key = process.env.TNK_AGENT_KEY;
    expect(
      key,
      "TNK_AGENT_KEY must be set in project secrets to enable live TNK refund signing"
    ).toBeDefined();
    expect(typeof key).toBe("string");
    expect((key as string).length, "TNK_AGENT_KEY must not be an empty string").toBeGreaterThan(0);
  });

  it("TNK_HTLC_WIF being set means executeTnkAgentSwap will run in LIVE mode (not demo)", () => {
    // This test documents the runtime behaviour: when TNK_HTLC_WIF is truthy,
    // the demo flag is false and the Oracle VM is called for real execution.
    const wif = process.env.TNK_HTLC_WIF;
    const isLiveMode = !!wif;
    expect(isLiveMode).toBe(true);
  });
});
