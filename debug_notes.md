# Debug Notes: RFQ Broadcast Not Appearing

## Observations from screenshots:

### Agent A (left side):
- Peer ID: e91c7f...c687
- Shows "3 peers" connected, 5/5 data channels
- Sent "swap 0.01 sol to usdt"
- Agent found peer lp-c7de5861b and showed SWAP QUOTE card
- Quote: 0.01 SOL → 0.858419 USDT at rate 1 SOL = 86.1 USDT
- "P2P matched — @lp-c7de5861b"
- Agent A's Network panel shows: Smart Auto-Accept OFF, Auto-Claim ON

### Agent B (right side - Swaps page):
- Peer ID: e91c7f...c687 (SAME peer ID!)
- Wait... both show e91c7f...c687? Let me re-check.
- Actually Agent B shows "lp-c7de58616b" in the Network panel
- Live Order Book: "0 offers", "Listening for P2P quotes"
- Network: ONLINE, 1 peer(?), 5/5 data channels
- Peer Mode: Active
- Smart Auto-Accept: GUARDED, OFF
- Auto-Claim: ON
- Incoming RFQs: "Listening for RFQs on accepted pairs..."

## Key Question:
The RFQ from Agent A was matched by the server to lp-c7de5861b (Agent B).
This means the server sent an `agent_rfq` SSE event to Agent B.
But Agent B is on the Swaps page, not the Network page.

Wait — the Incoming RFQs section IS visible on Agent B's screen (bottom right).
It says "Listening for RFQs on accepted pairs..." — meaning no RFQs have arrived.

## Possible root causes:
1. The `agent_rfq` SSE event is not being received by Agent B
2. The `rfq_broadcast` WebRTC message is not being received
3. The signaling client's `rfq_broadcast` event is never emitted (the client doesn't have an event for it)
4. The server sends the RFQ via a different channel that the client doesn't listen to

Need to check:
- How does the signaling client emit `rfq_broadcast` events?
- What does the server actually send when it matches a peer?
- Is there a disconnect between server event names and client event handlers?
