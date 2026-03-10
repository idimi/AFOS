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
 *   { type: "htlc_locked", targetPeerId, rfqId, txHash?, chain?, amountLocked? }
 *   { type: "htlc_secret", targetPeerId, rfqId, secretHex }
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
 *   { type: "htlc_locked", fromPeerId, rfqId, txHash, chain, amountLocked }
 *   { type: "htlc_secret", fromPeerId, rfqId, secretHex }
 *   { type: "error", message }
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import { recordPeerPing } from "./db";
import { notifyOwner } from "./_core/notification";

// ─── IP Geolocation ──────────────────────────────────────────────────────────

/** Cache resolved country codes to avoid hammering the geo API */
const geoCache = new Map<string, string>();

/**
 * Resolve a country code from an IP address using ip-api.com (free, no key).
 * Returns a 2-letter ISO country code (e.g. "US", "DE") or "" on failure.
 * Results are cached in-process to avoid duplicate lookups.
 */
async function resolveCountryCode(rawIp: string | string[] | undefined): Promise<string> {
  if (!rawIp) return "";
  // x-forwarded-for may be a comma-separated list; take the first (client) IP
  const ip = (Array.isArray(rawIp) ? rawIp[0] : rawIp).split(",")[0].trim();
  // Skip private/loopback addresses — they won't resolve to a country
  if (!ip || ip === "::1" || ip.startsWith("127.") || ip.startsWith("10.") ||
      ip.startsWith("192.168.") || ip.startsWith("172.")) {
    return "";
  }
  if (geoCache.has(ip)) return geoCache.get(ip)!;
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=countryCode`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return "";
    const data = await res.json() as { countryCode?: string };
    const code = data.countryCode ?? "";
    geoCache.set(ip, code);
    return code;
  } catch {
    return "";
  }
}

/** Convert a 2-letter ISO country code to a flag emoji (e.g. "US" → "🇺🇸") */
function countryCodeToFlag(code: string): string {
  if (!code || code.length !== 2) return "";
  const upper = code.toUpperCase();
  return Array.from(upper).map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join("");
}

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
  /** Maximum trade size in USD this peer is willing to quote (advertised liquidity) */
  maxTradeUsd?: number;
  /** 2-letter ISO country code resolved from the connecting IP (e.g. "US", "DE") */
  countryCode?: string;
  /** Flag emoji derived from countryCode (e.g. "🇺🇸", "🇩🇪") */
  flagEmoji?: string;
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
  /** Advertised max trade size in USD for liquidity depth aggregation */
  maxTradeUsd?: number;
  /** Whether the peer wants their country flag broadcast to others */
  showCountryFlag?: boolean;
  /** HTLC lock notification fields */
  rfqId?: string;
  txHash?: string;
  chain?: string;
  amountLocked?: number;
  /** HTLC secret reveal fields */
  secretHex?: string;
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
    maxTradeUsd: p.maxTradeUsd,
    countryCode: p.countryCode,
    flagEmoji: p.flagEmoji,
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

/** Broadcast to ALL connected peers — exported for server-side use */
export function broadcastAll(message: object) {
  const data = JSON.stringify(message);
  Array.from(peers.values()).forEach((peer) => {
    if (peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(data);
    }
  });
}

/**
 * Broadcast an RFQ to all peers EXCEPT the sender.
 * Called by the chat agent so any connected peer can see and accept the open RFQ.
 */
export function broadcastRfqToAll(senderPeerId: string | undefined, rfq: object) {
  const message = JSON.stringify({
    type: "rfq_broadcast",
    fromPeerId: senderPeerId ?? "agent",
    rfq,
  });
  Array.from(peers.entries()).forEach(([id, peer]) => {
    if (id !== senderPeerId && peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(message);
    }
  });
  console.log(`[Signaling] RFQ broadcast from ${senderPeerId ?? "agent"} to ${peers.size} peer(s)`);
}

/** Send to a specific peer by ID — exported for server-side use (e.g. agent RFQ dispatch) */
export function sendToPeer(peerId: string, message: object): boolean {
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

const SIGNALING_PATH = "/api/ws/signaling";

export function attachSignalingServer(httpServer: HttpServer) {
  // Use noServer mode + manual upgrade handling so the signaling WebSocket
  // is intercepted BEFORE Vite dev middleware can swallow the upgrade request.
  // Path is under /api/* so the Manus gateway routes it to our backend.
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = req.url?.split("?")[0];
    if (url === SIGNALING_PATH) {
      wss.handleUpgrade(req, socket as import("net").Socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
    // All other upgrade requests (e.g. Vite HMR) fall through naturally
  });

  startCleanup();

  console.log(`[Signaling] WebSocket signaling server attached at ${SIGNALING_PATH}`);

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
            maxTradeUsd: typeof msg.maxTradeUsd === "number" ? msg.maxTradeUsd : undefined,
          };

          peers.set(msg.peerId, peer);
          registeredPeerId = msg.peerId;

          // Confirm registration and send current peer list immediately (don't wait for geo)
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
          // Persist peer sighting to the database (fire-and-forget)
          recordPeerPing(msg.peerId, peer.alias, "intercomswap", null).catch(() => {});

          // Resolve country code asynchronously and broadcast an update when ready.
          // Skip if the peer has opted out of showing their flag (showCountryFlag === false).
          const peerWantsFlag = msg.showCountryFlag !== false; // default true
          if (peerWantsFlag) {
            resolveCountryCode(clientIp).then((code) => {
              if (!code) return;
              const flag = countryCodeToFlag(code);
              // Update the stored peer if it's still connected
              const storedPeer = peers.get(msg.peerId!);
              if (storedPeer) {
                storedPeer.countryCode = code;
                storedPeer.flagEmoji = flag;
                // Broadcast a geo_update so all peers (including the new one) get the flag
                broadcastAll({
                  type: "peer_geo_update",
                  peerId: msg.peerId,
                  countryCode: code,
                  flagEmoji: flag,
                });
                console.log(`[Signaling] Geo resolved: ${msg.peerId!.slice(0, 12)}… → ${code} ${flag}`);
              }
            }).catch(() => {});
          } else {
            console.log(`[Signaling] Flag hidden by peer preference: ${msg.peerId!.slice(0, 12)}…`);
          }
          break;
        }

        // ── Heartbeat ─────────────────────────────────────────────────────
        case "heartbeat": {
          const id = msg.peerId || registeredPeerId;
          if (id && peers.has(id)) {
            const p = peers.get(id)!;
            p.lastHeartbeat = Date.now();
            // Optionally update pairs if provided
            if (msg.pairs) {
              p.pairs = msg.pairs;
            }
            // Record a successful ping with 0ms latency to keep lastSeenAt fresh
            recordPeerPing(id, p.alias, "intercomswap", 0).catch(() => {});
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

        // ── HTLC Lock Notification (Agent B → Agent A) ──────────────────
        // Agent B sends this after broadcasting their lock tx so Agent A knows
        // it's safe to sign and broadcast their own HTLC lock.
        case "htlc_locked": {
          if (!msg.targetPeerId || !msg.rfqId) {
            ws.send(JSON.stringify({ type: "error", message: "targetPeerId and rfqId required" }));
            return;
          }
          const fromHtlc = msg.peerId || registeredPeerId;
          if (!fromHtlc) {
            ws.send(JSON.stringify({ type: "error", message: "Not registered" }));
            return;
          }
          sendToPeer(msg.targetPeerId, {
            type: "htlc_locked",
            fromPeerId: fromHtlc,
            rfqId: msg.rfqId,
            txHash: msg.txHash ?? null,
            chain: msg.chain ?? null,
            amountLocked: msg.amountLocked ?? null,
          });
          console.log(`[Signaling] htlc_locked: ${fromHtlc.slice(0,8)}→${msg.targetPeerId.slice(0,8)} rfq=${msg.rfqId.slice(0,8)}`);
          // Push notification to owner
          void notifyOwner({
            title: `HTLC Locked — ${msg.chain ?? "?"} escrow`,
            content: `Peer @${fromHtlc.slice(0,12)} locked ${msg.amountLocked ?? "?"} ${msg.chain ?? ""} for RFQ ${msg.rfqId.slice(0,8)}… → @${msg.targetPeerId.slice(0,12)}. Tx: ${(msg.txHash ?? "").slice(0,20)}…`,
          }).catch(() => {});
          break;
        }
        // ── HTLC Secret Reveal (Agent A → Agent B) ───────────────────────
        // Agent A sends the plaintext secret after both sides have locked so
        // Agent B can use it to claim their funds from the HTLC contract.
        case "htlc_secret": {
          if (!msg.targetPeerId || !msg.rfqId || !msg.secretHex) {
            ws.send(JSON.stringify({ type: "error", message: "targetPeerId, rfqId, and secretHex required" }));
            return;
          }
          const fromSecret = msg.peerId || registeredPeerId;
          if (!fromSecret) {
            ws.send(JSON.stringify({ type: "error", message: "Not registered" }));
            return;
          }
          sendToPeer(msg.targetPeerId, {
            type: "htlc_secret",
            fromPeerId: fromSecret,
            rfqId: msg.rfqId,
            secretHex: msg.secretHex,
          });
          console.log(`[Signaling] htlc_secret: ${fromSecret.slice(0,8)}→${msg.targetPeerId.slice(0,8)} rfq=${msg.rfqId.slice(0,8)}`);
          // Push notification to owner
          void notifyOwner({
            title: `HTLC Secret Revealed`,
            content: `Peer @${fromSecret.slice(0,12)} revealed the HTLC secret for RFQ ${msg.rfqId.slice(0,8)}… to @${msg.targetPeerId.slice(0,12)}. Counterparty can now claim.`,
          }).catch(() => {});
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

/**
 * Ping a specific peer via WebSocket native ping/pong and return RTT latency.
 * Returns null if the peer is not found or the ping times out.
 */
export function pingSignalingPeer(peerId: string, timeoutMs = 5000): Promise<number | null> {
  return new Promise((resolve) => {
    const peer = peers.get(peerId);
    if (!peer || peer.ws.readyState !== WebSocket.OPEN) {
      resolve(null);
      return;
    }

    const start = Date.now();
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null); // timeout
      }
    }, timeoutMs);

    peer.ws.once('pong', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(Date.now() - start);
      }
    });

    try {
      peer.ws.ping();
    } catch {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(null);
      }
    }
  });
}
