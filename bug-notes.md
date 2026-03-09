# Bug Investigation Notes

## Screenshot 1 (Agent A - Swap UI)
- Shows swap: 0.01 SOL → 0.848725 USDT on SOL chain
- "Confirm Swap" button visible
- Yellow warning: "Please connect your Solana wallet first to execute swaps."
- But the user says wallet IS connected
- This is the Agent A side (the one requesting the swap)

## Screenshot 2 (Agent B - Network Panel)
- Shows "Incoming RFQs" section
- RFQ: "Anonymou... accepted" with green checkmark, 1m ago
- 0.0100 SOL → 0.8487 USDT
- Rate: 1 SOL = 85.000000 USDT · solana → solana
- Stats show: Quotes Given: 0, Trades Done: 0, Volume USD: $0
- Agent B accepted the quote but Agent A was never notified

## Screenshot 3 (Agent B - HTLC Modal)
- "HTLC Atomic Swap" modal with all 4 steps showing green checkmarks:
  1. Sign HTLC lock transaction ✓
  2. Lock funds in escrow ✓
  3. Reveal secret hash ✓
  4. Atomic settlement complete ✓
- "Done" button at bottom
- User says this is premature - trade hasn't actually settled
- This modal appears to auto-complete all steps without actually doing them
