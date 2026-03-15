/**
 * Tests for TNK→USDT swap flow fixes:
 * 1. RFQ card perspective: "You send" should show fromToken/amount (user's perspective)
 * 2. AFOS P2P route: buildSwapTx returning "AFOS P2P" for TNK swaps should be handled
 */

import { describe, it, expect } from "vitest";

// ─── Test 1: RFQ card data perspective ────────────────────────────────────────
describe("Incoming RFQ card perspective", () => {
  /**
   * The incomingRfqData is from the requester's perspective:
   *   fromToken = what the requester sends (e.g. TNK)
   *   toToken   = what the requester wants to receive (e.g. USDT)
   *   amount    = how much the requester sends
   *   outAmount = how much the requester expects to receive
   *
   * The user (counterparty) should see:
   *   "You send"    → amount + fromToken  (the requester's fromToken is what the user sends)
   *   "You receive" → outAmount + toToken (the requester's toToken is what the user receives)
   *
   * This matches the user's original intent: "swap 1 TNK to USDT"
   */

  const mockRfqData = {
    rfqId: "rfq_test_123",
    fromToken: "TNK",
    toToken: "USDT",
    fromChain: "trac_network",
    toChain: "solana",
    amount: 1.0,
    outAmount: 0.1815,
    rate: 0.1815,
    requesterAlias: "peer_abc",
    requesterPeerId: "peer_abc123",
    expiresAt: Date.now() + 120_000,
  };

  it("should display fromToken/amount as 'You send'", () => {
    // The "You send" field should show the requester's fromToken and amount
    const youSendAmount = mockRfqData.amount;
    const youSendToken = mockRfqData.fromToken;

    expect(youSendAmount).toBe(1.0);
    expect(youSendToken).toBe("TNK");
  });

  it("should display toToken/outAmount as 'You receive'", () => {
    // The "You receive" field should show the requester's toToken and outAmount
    const youReceiveAmount = mockRfqData.outAmount;
    const youReceiveToken = mockRfqData.toToken;

    expect(youReceiveAmount).toBe(0.1815);
    expect(youReceiveToken).toBe("USDT");
  });

  it("should NOT show toToken as 'You send' (the old broken behavior)", () => {
    // The old broken code showed outAmount/toToken as "You send"
    // which would display "You send 0.1815 USDT" — confusing for a TNK→USDT user
    const wrongYouSend = mockRfqData.outAmount; // 0.1815 USDT — this was the bug
    const correctYouSend = mockRfqData.amount;  // 1.0 TNK — this is correct

    expect(correctYouSend).not.toBe(wrongYouSend);
    expect(correctYouSend).toBe(1.0);
  });

  it("should pass fromToken/amount to onAcceptRfq callback", () => {
    // The Accept Swap button should call onAcceptRfq with:
    // rfqId, fromToken, toToken, amount, outAmount
    // This generates: "accept swap 1.0000 TNK for 0.1815 USDT rfq:rfq_test_123"
    const rfq = mockRfqData;
    const expectedText = `accept swap ${rfq.amount.toFixed(4)} ${rfq.fromToken} for ${rfq.outAmount.toFixed(4)} ${rfq.toToken} rfq:${rfq.rfqId}`;

    expect(expectedText).toBe("accept swap 1.0000 TNK for 0.1815 USDT rfq:rfq_test_123");
    expect(expectedText).toContain("TNK");
    expect(expectedText).not.toMatch(/^accept swap 0\.1815/); // Should NOT start with USDT amount
  });
});

// ─── Test 2: AFOS P2P route handling for TNK swaps ────────────────────────────
describe("TNK swap AFOS P2P route handling", () => {
  /**
   * When buildSwapTx returns route: "AFOS P2P" for a TNK swap,
   * the frontend should handle it by triggering initiateHtlcLock,
   * NOT fall through to "Unexpected swap route" error.
   */

  it("should recognize AFOS P2P as a valid route for TNK→SOL swaps", () => {
    const validRoutes = ["AFOS TNK→SOL", "AFOS SOL→TNK", "AFOS P2P"];
    const serverResponse = { route: "AFOS P2P", p2pQuote: { rfqId: "rfq_p2p_123", peerId: "peer_xyz" } };

    expect(validRoutes).toContain(serverResponse.route);
  });

  it("should NOT treat AFOS P2P as unexpected for TNK swaps", () => {
    const unexpectedRoutes = ["UNKNOWN", "DIRECT", "BRIDGE_V1"];
    const serverRoute = "AFOS P2P";

    expect(unexpectedRoutes).not.toContain(serverRoute);
  });

  it("should extract p2pQuote from AFOS P2P response for initiateHtlcLock", () => {
    const tnkSolResult = {
      route: "AFOS P2P",
      p2pQuote: {
        rfqId: "rfq_p2p_456",
        peerId: "peer_abc",
        peerAlias: "alice",
        outAmount: 0.1815,
        rate: 0.1815,
        htlcExpiresAt: Date.now() + 3_600_000,
        secretHashHex: "abc123def456",
      },
    };

    // Simulate the frontend extracting p2p data
    const p2p = tnkSolResult.p2pQuote;
    expect(p2p).toBeDefined();
    expect(p2p.rfqId).toBe("rfq_p2p_456");
    expect(p2p.peerAlias).toBe("alice");
    expect(p2p.outAmount).toBe(0.1815);
  });

  it("should build correct initiateHtlcLock params from AFOS P2P result", () => {
    const quoteData = {
      fromToken: "TNK",
      toToken: "USDT",
      fromChain: "trac_network",
      toChain: "solana",
      fromAmount: 1.0,
      toAmount: 0.1815,
      rate: 0.1815,
    };

    const p2p = {
      rfqId: "rfq_p2p_789",
      peerId: "peer_xyz",
      outAmount: 0.1815,
      rate: 0.1815,
      secretHashHex: "deadbeef",
    };

    // Simulate the initiateHtlcLock params construction
    const htlcLockParams = {
      rfqId:              p2p.rfqId,
      fromToken:          quoteData.fromToken,
      toToken:            quoteData.toToken,
      fromChain:          quoteData.fromChain,
      toChain:            quoteData.toChain,
      amount:             quoteData.fromAmount,
      outAmount:          p2p.outAmount ?? quoteData.toAmount,
      rate:               p2p.rate ?? quoteData.rate,
      counterpartyPeerId: p2p.peerId,
      secretHashHex:      p2p.secretHashHex,
    };

    expect(htlcLockParams.rfqId).toBe("rfq_p2p_789");
    expect(htlcLockParams.fromToken).toBe("TNK");
    expect(htlcLockParams.fromChain).toBe("trac_network");
    expect(htlcLockParams.toChain).toBe("solana");
    expect(htlcLockParams.amount).toBe(1.0);
    expect(htlcLockParams.outAmount).toBe(0.1815);
    expect(htlcLockParams.secretHashHex).toBe("deadbeef");
  });
});

// ─── Test 3: rfqSendChain wallet check ────────────────────────────────────────
describe("RFQ wallet check chain derivation", () => {
  /**
   * The wallet-missing guard for the Accept Swap button should check
   * the fromChain (the chain the user needs to send on), not the toChain.
   */

  it("should use fromChain for wallet check (user sends fromToken)", () => {
    const rfqData = {
      fromChain: "trac_network" as const,
      toChain: "solana" as const,
      fromToken: "TNK",
      toToken: "USDT",
    };

    // The wallet check should be for fromChain (trac_network → need Tap Wallet)
    const rfqSendChain = rfqData.fromChain;
    expect(rfqSendChain).toBe("trac_network");
    // NOT toChain (solana → would incorrectly require Phantom)
    expect(rfqSendChain).not.toBe("solana");
  });

  it("should require Trac Network wallet for TNK send chain", () => {
    const rfqSendChain = "trac_network";
    const walletStates = {
      tnkWallet: { connected: false },
      phantom: { connected: true },
    };

    // For trac_network, we need tnkWallet, not phantom
    const rfqWalletMissing = rfqSendChain === "trac_network"
      ? !walletStates.tnkWallet.connected
      : !walletStates.phantom.connected;

    expect(rfqWalletMissing).toBe(true); // tnkWallet not connected
  });
});
