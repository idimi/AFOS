# HTLC Flow Analysis — Root Cause

## Issue 1: Agent B never receives the RFQ (FIXED in previous commit)
- rfq_broadcast handler now adds to incomingRfqs
- Polling fallback added for missed WebSocket messages

## Issue 2: Agent B shows "SWAP COMPLETE" but didn't actually lock USDT
Looking at the screenshots:
- Agent A (left): Shows SWAP COMPLETE with all 5 steps green
- Agent B (right): Also shows SWAP COMPLETE with all 5 steps green
- BUT Agent B's "Trades Done: 0" and "Volume USD: $0"

### The real question: Did Agent B actually lock USDT?
From the code analysis:
1. Agent B's `acceptRfq` function DOES try to sign an HTLC lock tx
2. The signing flow goes through wallet interaction (Phantom)
3. If the wallet signs, the tx is submitted on-chain
4. After signing, `setHtlcSigning({ rfqId, step: "settled" })` is called

### But the user says "agent b simulate" — meaning Agent B's lock was simulated/fake
Looking at the code more carefully:
- Line 2905: `setSwapPhase("complete")` is called even when `execError && !realTxHash`
- The toast says "Swap routed (no on-chain confirmation)"
- This is the SWAPS PAGE flow, not the CHAT flow

### For the CHAT flow:
- Line 1629: `phase: "locking"` is set immediately
- The pipeline advances based on window events:
  - `afos:htlc-locked` → phase "settling"
  - `afos:htlc-secret-sent` → phase "settling" 
  - `afos:htlc-secret-received` → phase "confirmed"

### Key Finding: The `revealHtlcSecret` error
The error in Agent B's console is actually from the `htlc_locked` handler.
When Agent B sends `htlc_locked` to Agent A, Agent A calls `revealHtlcSecret`.
But the error appears in Agent B's console — this means Agent B is ALSO receiving
the `htlc_locked` event (echo/self-notification?) and trying to call revealHtlcSecret.

OR: The error is from a different flow — Agent B's own attempt to reveal.

### Most likely root cause:
The `htlc_locked` handler on line 609 fires on BOTH Agent A and Agent B.
When Agent B locks their HTLC and sends `htlc_locked` to Agent A via signaling,
Agent B might also receive this event back (echo). Then Agent B tries to call
`revealHtlcSecret` with its OWN wallet address as `initiatorAddress`, which
doesn't match the stored initiator address in the DB → FORBIDDEN error.

## Fix needed:
1. Add a guard in the `htlc_locked` handler to skip if the `fromPeerId` is our own peerId
2. Ensure the pipeline UI only advances to "confirmed" based on actual on-chain events
