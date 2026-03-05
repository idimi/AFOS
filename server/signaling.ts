/**
 * WebSocket Signaling Server for AFOS P2P Network
 *
 * This is the matchmaker — it never touches funds or swap data.
 * It handles:
 *  1. Peer registration: browser connects, sends `register` with peerId + offered pairs
 *  2. Peer discovery: server broadcasts updated peer list to all connected browsers
 *  3. WebRTC signaling relay: forwards SDP offers/answers and ICE candidates between peers
 *  4. Heartbeat: clients ping every 30s, server removes stale peers after 90s
 *  5. Peer-to-peer messaging relay: forwards chat/rfq messages until WebRTC connects
 *
 * Protocol: JSON messages over WebSocket at /ws/signaling
 *
 * Message types (client → server):
 *   { type: "register", peerId, alias, pairs, walletAddresses }
 *   { type: "heartbeat", peerId }
 *   { type: "deregister", peerId }
 *   { type: "rtc_offer", targetPeerId, sdp }
 *   { type: "rtc_answer", targetPeerId, sdp }
 *   { type: "rtc_ice", targetPeerId, candidate }
 *   { type: "peer_message", targetPeerId, payload }
 *   { type: "rfq_broadcast", rfq }
 *
 * Message types (server → client):
 *   { type: "registered", peerId, peerCount }
 *   { type: "peer_list", peers }
 *   { type: "peer_joined", peer }
 *   { type: "peer_left", peerId }
 *   { type: "rtc_offer", fromPeerId, sdp }
 *   { type: "rtc_answer", fromPeerId, sdp }
 *   { type: "rtc_ice", fromPeerId, candidate }
 *   { type: "peer_message", fromPeerId, payload }
 *   { type: "rfq_broadcast", fromPeerId, rfq }
 *   { type: "error", message }
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SignalingPeer {
  peerId: string;
  alias: string;
  pairs: string[];
  walletAddresses: {
    solana?: string;
    ethereum?: string;
    bitcoin?: string;
  };
  connectedAt: number;
  lastHeartbeat: number;
  ws: WebSocket;
}

interface ClientMessage {
  type: string;
  peerId?: string;
  alias?: string;
  pairs?: string[];
  walletAddresses?: {
    solana?: string;
    ethereum?: string;
    bitcoin?: string;
  };
  targetPeerId?: string;
  sdp?: unknown;
  candidate?: unknown;
  payload?: unknown;
  rfq?: unknown;
}

// ─── Peer Registry ───────────────────────────────────────────────────────────

const peers = new Map<string, SignalingPeer>();
const STALE_TIMEOUT_MS = 90_000; // Remove peers after 90s without heartbeat

/** Get a sanitised peer list (no WebSocket refs) for broadcasting */
function getPeerList() {
  return Array.from(peers.values()).map((p) => ({
    peerId: p.peerId,
    alias: p.alias,
    pairs: p.pairs,
    walletAddresses: p.walletAddresses,
    connectedAt: p.connectedAt,
    lastHeartbeat: p.lastHeartbeat,
  }));
}

/** Broadcast a message to all connected peers except the sender */
function broadcastExcept(senderPeerId: string, message: object) {
  const data = JSON.stringify(message);
  Array.from(peers.entries()).forEach(([id, peer]) => {
    if (id !== senderPeerId && peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(data);
    }
  });
}

/** Broadcast to ALL connected peers */
function broadcastAll(message: object) {
  const data = JSON.stringify(message);
  Array.from(peers.values()).forEach((peer) => {
    if (peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(data);
    }
  });
}

/** Send to a specific peer by ID */
function sendToPeer(peerId: string, message: object): boolean {
  const peer = peers.get(peerId);
  if (peer && peer.ws.readyState === WebSocket.OPEN) {
    peer.ws.send(JSON.stringify(message));
    return true;
  }
  return false;
}

/** Remove a peer and notify others */
function removePeer(peerId: string) {
  const existed = peers.delete(peerId);
  if (existed) {
    broadcastAll({ type: "peer_left", peerId });
    console.log(`[Signaling] Peer left: ${peerId} (${peers.size} online)`);
  }
}

// ─── Stale Peer Cleanup ─────────────────────────────────────────────────────

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    Array.from(peers.entries()).forEach(([id, peer]) => {
      if (now - peer.lastHeartbeat > STALE_TIMEOUT_MS) {
        console.log(`[Signaling] Removing stale peer: ${id}`);
        peer.ws.close(4001, "Heartbeat timeout");
        removePeer(id);
      }
    });
  }, 30_000);
}

// ─── WebSocket Server Setup ─────────────────────────────────────────────────

export function attachSignalingServer(httpServer: HttpServer) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws/signaling",
  });

  startCleanup();

  console.log("[Signaling] WebSocket signaling server attached at /ws/signaling");

  wss.on("connection", (ws, req) => {
    const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    console.log(`[Signaling] New connection from ${clientIp}`);

    let registeredPeerId: string | null = null;

    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      switch (msg.type) {
        // ── Register ──────────────────────────────────────────────────────
        case "register": {
          if (!msg.peerId) {
            ws.send(JSON.stringify({ type: "error", message: "peerId required" }));
            return;
          }

          // If this peerId is already registered by another socket, close the old one
          const existing = peers.get(msg.peerId);
          if (existing && existing.ws !== ws) {
            existing.ws.close(4002, "Replaced by new connection");
          }

          const peer: SignalingPeer = {
            peerId: msg.peerId,
            alias: msg.alias || `peer-${msg.peerId.slice(0, 6)}`,
            pairs: msg.pairs || [],
            walletAddresses: msg.walletAddresses || {},
            connectedAt: Date.now(),
            lastHeartbeat: Date.now(),
            ws,
          };

          peers.set(msg.peerId, peer);
          registeredPeerId = msg.peerId;

          // Confirm registration and send current peer list
          ws.send(
            JSON.stringify({
              type: "registered",
              peerId: msg.peerId,
              peerCount: peers.size,
            })
          );

          // Send the full peer list to the new peer
          ws.send(
            JSON.stringify({
              type: "peer_list",
              peers: getPeerList().filter((p) => p.peerId !== msg.peerId),
            })
          );

          // Notify all other peers about the new peer
          broadcastExcept(msg.peerId, {
            type: "peer_joined",
            peer: {
              peerId: peer.peerId,
              alias: peer.alias,
              pairs: peer.pairs,
              walletAddresses: peer.walletAddresses,
              connectedAt: peer.connectedAt,
            },
          });

          console.log(
            `[Signaling] Peer registered: ${peer.alias} (${msg.peerId.slice(0, 12)}…) — ${peers.size} online`
          );
          break;
        }

        // ── Heartbeat ─────────────────────────────────────────────────────
        case "heartbeat": {
          const id = msg.peerId || registeredPeerId;
          if (id && peers.has(id)) {
            peers.get(id)!.lastHeartbeat = Date.now();
            // Optionally update pairs if provided
            if (msg.pairs) {
              peers.get(id)!.pairs = msg.pairs;
            }
          }
          break;
        }

        // ── Deregister ────────────────────────────────────────────────────
        case "deregister": {
          const id = msg.peerId || registeredPeerId;
          if (id) {
            removePeer(id);
            registeredPeerId = null;
          }
          break;
        }

        // ── WebRTC Signaling: SDP Offer ───────────────────────────────────
        case "rtc_offer": {
          if (!msg.targetPeerId || !msg.sdp) {
            ws.send(JSON.stringify({ type: "error", message: "targetPeerId and sdp required" }));
            return;
          }
          const fromId = msg.peerId || registeredPeerId;
          if (!fromId) {
            ws.send(JSON.stringify({ type: "error", message: "Not registered" }));
            return;
          }
          const sent = sendToPeer(msg.targetPeerId, {
            type: "rtc_offer",
            fromPeerId: fromId,
            sdp: msg.sdp,
          });
          if (!sent) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: `Peer ${msg.targetPeerId} not found or disconnected`,
              })
            );
          }
          break;
        }

        // ── WebRTC Signaling: SDP Answer ──────────────────────────────────
        case "rtc_answer": {
          if (!msg.targetPeerId || !msg.sdp) {
            ws.send(JSON.stringify({ type: "error", message: "targetPeerId and sdp required" }));
            return;
          }
          const fromId2 = msg.peerId || registeredPeerId;
          if (!fromId2) {
            ws.send(JSON.stringify({ type: "error", message: "Not registered" }));
            return;
          }
          sendToPeer(msg.targetPeerId, {
            type: "rtc_answer",
            fromPeerId: fromId2,
            sdp: msg.sdp,
          });
          break;
        }

        // ── WebRTC Signaling: ICE Candidate ───────────────────────────────
        case "rtc_ice": {
          if (!msg.targetPeerId || !msg.candidate) {
            ws.send(JSON.stringify({ type: "error", message: "targetPeerId and candidate required" }));
            return;
          }
          const fromId3 = msg.peerId || registeredPeerId;
          if (!fromId3) {
            ws.send(JSON.stringify({ type: "error", message: "Not registered" }));
            return;
          }
          sendToPeer(msg.targetPeerId, {
            type: "rtc_ice",
            fromPeerId: fromId3,
            candidate: msg.candidate,
          });
          break;
        }

        // ── Peer-to-Peer Message (relayed via server until WebRTC connects) ─
        case "peer_message": {
          if (!msg.targetPeerId || !msg.payload) {
            ws.send(JSON.stringify({ type: "error", message: "targetPeerId and payload required" }));
            return;
          }
          const fromId4 = msg.peerId || registeredPeerId;
          if (!fromId4) {
            ws.send(JSON.stringify({ type: "error", message: "Not registered" }));
            return;
          }
          const delivered = sendToPeer(msg.targetPeerId, {
            type: "peer_message",
            fromPeerId: fromId4,
            payload: msg.payload,
          });
          // Acknowledge delivery
          ws.send(
            JSON.stringify({
              type: "message_ack",
              targetPeerId: msg.targetPeerId,
              delivered,
            })
          );
          break;
        }

        // ── RFQ Broadcast (sent to all peers) ─────────────────────────────
        case "rfq_broadcast": {
          const fromId5 = msg.peerId || registeredPeerId;
          if (!fromId5) {
            ws.send(JSON.stringify({ type: "error", message: "Not registered" }));
            return;
          }
          broadcastExcept(fromId5, {
            type: "rfq_broadcast",
            fromPeerId: fromId5,
            rfq: msg.rfq,
          });
          break;
        }

        default:
          ws.send(JSON.stringify({ type: "error", message: `Unknown type: ${msg.type}` }));
      }
    });

    ws.on("close", () => {
      if (registeredPeerId) {
        removePeer(registeredPeerId);
        registeredPeerId = null;
      }
    });

    ws.on("error", (err) => {
      console.error(`[Signaling] WebSocket error:`, err.message);
      if (registeredPeerId) {
        removePeer(registeredPeerId);
        registeredPeerId = null;
      }
    });
  });

  return wss;
}

/** Get current peer count (for health checks / status endpoints) */
export function getSignalingPeerCount(): number {
  return peers.size;
}

/** Get sanitised peer list (for REST API fallback) */
export function getSignalingPeerList() {
  return getPeerList();
}
