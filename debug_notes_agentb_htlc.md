# Debug Notes: Agent B HTLC Lock Not Executing

## Screenshots Analysis

### Agent A (left screenshot - pasted_file_ohCesK):
- Shows "SWAP COMPLETE" with 0.01 SOL → 0.8682 USDT
- All 5 pipeline steps green: RFQ Broadcast → Peer Negotiation → HTLC Lock → Atomic Settlement → Confirmed
- "Atomic swap settled successfully - Settlement confirmed"
- Bottom toast: "Swap complete: 0.001 SOL → 0.0868 USDT - Atomic settlement confirmed on-chain"
- Agent B (lp-c7de58616b) shows Peer Mode Active, Trades Done: 0, Volume USD: $0
- This means Agent B's counters didn't increment even though Agent A says swap is complete

### Agent B (right screenshot - pasted_file_XIHGlf):
- Also shows "SWAP COMPLETE" with 0.01 SOL → 0.8691 USDT
- All 5 pipeline steps green (same as Agent A)
- "Atomic swap settled successfully - Settlement confirmed"
- Browser console shows CRITICAL ERRORS:
  1. `chat.revealHtlcSecret` tRPC call FAILING with stack trace
  2. `quote-api.jup.ag` ERR_NAME_NOT_RESOLVED (DNS failure)
  3. Multiple SCTP failures with lp-c598e1b7b (WebRTC data channel errors)
  4. Repeated peer join/leave/rejoin cycles for lp-c598e1b7bc

## Key Issues:
1. **Agent B shows "SWAP COMPLETE" but Trades Done = 0** → the swap pipeline UI is being faked/simulated
2. **revealHtlcSecret is failing** → the atomic settlement step is broken
3. **Agent B never actually locked USDT** → the HTLC lock step was skipped or simulated
4. The swap pipeline progresses through all 5 steps WITHOUT waiting for actual on-chain confirmation

## Root Cause Hypothesis:
The swap pipeline UI on Agent A's side is advancing through all steps based on the chat agent's response,
NOT based on actual on-chain events. When Agent A's chat agent says "swap complete", the pipeline
shows all green — but Agent B may not have actually participated.

The `revealHtlcSecret` error on Agent B suggests Agent B DID try to participate but the server-side
secret reveal mechanism is broken.
