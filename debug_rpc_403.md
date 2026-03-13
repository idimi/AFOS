# Debug: RPC 403 Forbidden — Both Agents Stuck

## Key Observations from Screenshots

### Agent A (left):
- "Swap In Progress" card showing "Atomic Settlement — Releasing secret — claiming funds"
- "Confirmed" step shown but HTLC timer counting down (6m 53s)
- Console: `revealHtlcSecret agentAWallet=AuSUBiV...` called
- Console: Multiple `rpc.unlock-protocol.com/1:1` 403 errors (load resource: server responded with status 403)
- Console: `[HTLC] revealHtlcSecret agentAWallet=AuSUBiV... rfqId=rfq_1773`

### Agent B (right):
- HTLC Atomic Swap dialog stuck at step 3 "Funds locked — waiting for counterparty"
- "Waiting for settlement..." button shown
- Console: `htlc_locked but we are not the initiator for rfqId=rfq_1773 — skipping revealHtlcSecret` (echo guard working)
- Console: `acceptRfq called` → `passed early return check — proceeding with HTLC lock`
- Console: `chain resolved` → `Entering Solana HTLC lock path` → `isAgentA: false, lockToken: 'USDT'`
- Console: `senderPubkeyStr CzP3GvDsLFfwqvPRm3hCtVYHP7PcnbUEqNBssevqepiW` (from live Phantom)
- Console: `agentEscrowAddr Ey3PYDh9gKukTcGriXo8rb1T11QFxP3pJvnMqkCDQopR`
- Console: `Pre-flight balance check: 5.005164 USDT (need 0.868495300000001) for CzP3GvDs...`
- Console: `About to sign. {isAgentA: false, lockToken: 'USDT', lockAmount: 0.868495300000001, isPhantomStandard: true}`
- Console: `Using Phantom Standard Wallet (window.phantom.solana) path`
- Console: Multiple `POST dialog.bundle.js?343611b...:3 https://rpc.unlock-protocol.com/1 403 (Forbidden)`
- Console: `Auto-claiming HTLC funds for RFQ rfq_1773...`

## Root Cause
The Solana RPC endpoint `rpc.unlock-protocol.com` is returning 403 Forbidden.
This endpoint is used for submitting HTLC claim/reveal transactions.
Both agents successfully locked funds but cannot complete settlement because the RPC rejects their transactions.

## Fix Needed
Find where `rpc.unlock-protocol.com` is configured and switch to a working Solana RPC:
- The VITE_SOL_RPC_URL env var
- Or hardcoded in the Phantom wallet adapter / connection setup
- Or in the HTLC escrow program interaction code
