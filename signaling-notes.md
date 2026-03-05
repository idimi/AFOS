# Signaling Server Architecture Notes

## Current State
- LightPeerContext: browser-only, announces to Oracle VM at /api/peer/announce (HTTP POST) + relay at /api/relay/announce
- SSE stream at /api/afos/api/stream for events (prices, rfq, peer_connected, etc.) — proxied to Oracle VM
- getRelayPeers() fetches from /api/afos/api/relay/peers — proxied to Oracle VM
- peerMessages router: stores messages in DB, no real-time delivery
- Server: Express + http.createServer in server/_core/index.ts, already has `server` variable (HTTP server)
- No WebSocket server exists yet

## What Needs to Change
1. Add `ws` WebSocket server attached to the existing HTTP server
2. Create signaling server: peer registry, heartbeat, peer list broadcast
3. WebRTC signaling: SDP offer/answer relay, ICE candidate relay
4. Update LightPeerContext to connect via WebSocket instead of HTTP POST announce
5. Establish WebRTC data channels for direct peer-to-peer messaging
6. Wire existing RFQ/quote/HTLC flow through WebRTC channels

## Key Design Decisions
- WebSocket path: /ws/signaling (avoids conflict with /api/* routes)
- Peer registry: in-memory Map on server (no DB needed — peers are ephemeral)
- Heartbeat: client sends ping every 30s, server removes stale peers after 90s
- WebRTC: use RTCPeerConnection with Google STUN servers, optional TURN
- Messages: { type, payload } JSON protocol over WebSocket
