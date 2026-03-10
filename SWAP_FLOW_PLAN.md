# AFOS Swap Flow — Analysis & Redesign Plan

## Current (Broken) Flow

```
User types "swap 0.01 SOL to USDT"
  → sendMessage called on server
  → Server IMMEDIATELY broadcasts RFQ to all P2P peers (broadcastRfqToAll)
  → Server IMMEDIATELY finds a peer match (findSignalingPeer)
  → Server IMMEDIATELY sends agent_rfq to matched peer (sendAgentRfqToPeer)
  → Server returns quote_card to client
  → Client shows QuoteCard with "Confirm Swap" button
  → Client also shows "Building swap transaction…" + "P2P peer matched… please sign"
  → User clicks "Confirm Swap" → HTLC lock begins
```

**Problems:**
1. RFQ is broadcast and peer is matched BEFORE the user confirms — the peer is already waiting before the user even sees the quote
2. The "Confirm Swap" button is misleading — the swap is already in progress when it appears
3. The full chat page shows "Connect Wallet to Swap" even when wallet IS connected — because `QuoteCard` uses `useWallet().connected` which only reflects the Solana adapter, not Phantom multi-chain or ETH/BTC wallets
4. The overview and full chat show different UIs — the overview correctly shows "Confirm Swap" because it has different wallet context

## Correct (New) Flow

```
Step 1 — QUOTE PHASE (no network activity):
  User types "swap 0.01 SOL to USDT"
  → sendMessage called on server
  → Server fetches prices and builds a quote (DEX or estimated P2P rate)
  → Server returns quote_card with estimated rate (NO peer matching, NO RFQ broadcast)
  → Client shows QuoteCard with "Confirm Swap" button
  → User reviews the quote

Step 2 — CONFIRM PHASE (user action required):
  User clicks "Confirm Swap"
  → Client calls a NEW procedure: confirmSwap (or reuses sendMessage with action="confirm")
  → Server NOW broadcasts RFQ to all peers (broadcastRfqToAll)
  → Server NOW finds best peer match (findSignalingPeer)
  → If P2P match found:
      → Server sends agent_rfq to peer
      → Server returns { route: "p2p", peer, rfqId, secretHashHex }
      → Client shows SwapProgressCard (broadcasting → negotiating → locking → settling → confirmed)
      → Client calls initiateHtlcLock
  → If no peer / DEX route:
      → Server returns { route: "dex", swapTransaction }
      → Client signs and submits the transaction

Step 3 — HTLC LOCK PHASE (wallet signing required):
  → Client prompts user to sign HTLC lock transaction in wallet
  → On-chain confirmation wait
  → Peer locks their side
  → Secret revealed, funds claimed
```

## Bug Fix: "Connect Wallet to Swap" in Full Chat

**Root cause:** `QuoteCard` uses `const { connected } = useWallet()` which only returns true for the Solana wallet adapter. If the user connected via Phantom multi-chain, ETH, or BTC wallet, `connected` is false even though a wallet IS connected.

**Fix:** Pass `isWalletConnected` as a prop to `QuoteCard` from the parent (ChatPage), where the full multi-chain wallet state is available via `anyWalletConnected`.

## Implementation Plan

### Server changes (server/routers/chat.ts):

1. **sendMessage** — remove `broadcastRfqToAll` and `findSignalingPeer` and `sendAgentRfqToPeer` calls. Instead, just build a quote and return `quote_card` with estimated P2P rate if peers are online, or DEX rate.

2. **Add new `confirmSwap` procedure** — takes `{ rfqId, quoteData, senderPeerId, senderWallet, senderAlias }`, does the actual peer matching and RFQ broadcast, returns `{ route, peer?, swapTransaction? }`.

### Client changes (client/src/pages/ChatPage.tsx):

1. **QuoteCard** — add `isWalletConnected: boolean` prop, use it instead of `useWallet().connected`

2. **handleConfirmSwap** — instead of directly executing the swap, first call `confirmSwap` mutation to do peer matching. Then based on the result, either start HTLC lock (P2P) or sign DEX transaction.

3. **MessageBubble** — pass `anyWalletConnected` down to `QuoteCard` via `onConfirmSwap`

### Overview widget (client/src/pages/Swaps.tsx or wherever the overview is):

- Same QuoteCard fix — pass `isWalletConnected` correctly
