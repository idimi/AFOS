/**
 * Signaling Client — Connects to the AFOS WebSocket signaling server
 * and manages WebRTC peer connections for direct browser-to-browser communication.
 *
 * Usage:
 *   const client = new SignalingClient();
 *   client.on("peer_joined", (peer) => ...);
 *   client.on("peer_left", (peerId) => ...);
 *   client.on("data_channel_open", ({ peerId, channel }) => ...);
 *   client.on("data_channel_message", ({ peerId, data }) => ...);
 *   client.register(peerId, alias, pairs, walletAddresses);
 *   client.sendToPeer(targetPeerId, { type: "chat", text: "hello" });
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RemotePeer {
  peerId: string;
  alias: string;
  pairs: string[];
  walletAddresses: {
    solana?: string;
    ethereum?: string;
    bitcoin?: string;
  };
  connectedAt: number;
  lastHeartbeat?: number;
  /** WebRTC data channel (null until established) */
  dataChannel: RTCDataChannel | null;
  /** RTCPeerConnection (null until WebRTC handshake starts) */
  peerConnection: RTCPeerConnection | null;
}

export type SignalingEvent =
  | "connected"
  | "disconnected"
  | "registered"
  | "peer_list"
  | "peer_joined"
  | "peer_left"
  | "peer_message"
  | "rfq_broadcast"
  | "agent_rfq"
  | "data_channel_open"
  | "data_channel_close"
  | "data_channel_message"
  | "lp_invite"
  | "error";

type EventHandler = (data: unknown) => void;

// ─── STUN/TURN Configuration ─────────────────────────────────────────────────
//
// STUN servers: Used for NAT discovery (free, no credentials needed).
// TURN servers: Used as relay when direct WebRTC fails behind strict NAT/firewalls.
//   - Open Relay Project: free, no credentials, suitable for development/low traffic
//   - For production: set VITE_TURN_URL, VITE_TURN_USERNAME, VITE_TURN_CREDENTIAL
//     in your environment to use Cloudflare TURN or a self-hosted coturn server.

const TURN_URL = import.meta.env.VITE_TURN_URL as string | undefined;
const TURN_USERNAME = import.meta.env.VITE_TURN_USERNAME as string | undefined;
const TURN_CREDENTIAL = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;

const buildIceServers = (): RTCIceServer[] => {
  const servers: RTCIceServer[] = [
    // Google STUN (free, no credentials)
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    // Open Relay Project TURN (free, no credentials, good for development)
    {
      urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turn:openrelay.metered.ca:443?transport=tcp",
      ],
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ];
  // Custom TURN server (Cloudflare TURN or self-hosted coturn)
  if (TURN_URL && TURN_USERNAME && TURN_CREDENTIAL) {
    servers.push({
      urls: TURN_URL,
      username: TURN_USERNAME,
      credential: TURN_CREDENTIAL,
    });
  }
  return servers;
};

const RTC_CONFIG: RTCConfiguration = {
  iceServers: buildIceServers(),
  iceTransportPolicy: "all", // Use TURN relay only if direct/STUN fails
};

const HEARTBEAT_INTERVAL = 30_000;
const RECONNECT_DELAY = 5_000;
const MAX_RECONNECT_DELAY = 60_000;
const MAX_RECONNECT_ATTEMPTS = 5; // Stop reconnecting after 5 failures to prevent loops

// ─── Signaling Client ────────────────────────────────────────────────────────

export class SignalingClient {
  private ws: WebSocket | null = null;
  private myPeerId: string | null = null;
  private myAlias: string = "";
  private myPairs: string[] = [];
  private myWalletAddresses: Record<string, string> = {};
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_DELAY;
  private handlers = new Map<SignalingEvent, Set<EventHandler>>();
  private remotePeers = new Map<string, RemotePeer>();
  private isRegistered = false;
  private intentionalClose = false;
  private reconnectAttempts = 0;

  /** Get the WebSocket URL based on current page origin */
  private getWsUrl(): string {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    // Path is under /api/* so the Manus gateway routes it to our backend
    return `${proto}//${window.location.host}/api/ws/signaling`;
  }

  // ── Event Emitter ─────────────────────────────────────────────────────────

  on(event: SignalingEvent, handler: EventHandler): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  private emit(event: SignalingEvent, data?: unknown) {
    this.handlers.get(event)?.forEach((h) => h(data));
  }

  // ── Connection Management ─────────────────────────────────────────────────

  /** Reset reconnect state — allows retrying after max attempts reached */
  resetReconnect() {
    this.reconnectAttempts = 0;
    this.reconnectDelay = RECONNECT_DELAY;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.intentionalClose = false;
    // Reset attempts on explicit connect (not from auto-reconnect)
    this.reconnectAttempts = 0;
    this.reconnectDelay = RECONNECT_DELAY;
    const url = this.getWsUrl();

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      console.error("[SignalingClient] Failed to create WebSocket:", err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log("[SignalingClient] Connected to signaling server");
      this.reconnectDelay = RECONNECT_DELAY;
      this.reconnectAttempts = 0; // Reset on successful connection
      this.emit("connected");

      // Re-register if we had a previous registration
      if (this.myPeerId) {
        this.sendMessage({
          type: "register",
          peerId: this.myPeerId,
          alias: this.myAlias,
          pairs: this.myPairs,
          walletAddresses: this.myWalletAddresses,
        });
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        this.handleServerMessage(msg);
      } catch (err) {
        console.error("[SignalingClient] Failed to parse message:", err);
      }
    };

    this.ws.onclose = () => {
      console.log("[SignalingClient] Disconnected from signaling server");
      this.stopHeartbeat();
      this.emit("disconnected");

      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (err) => {
      console.error("[SignalingClient] WebSocket error:", err);
    };
  }

  disconnect() {
    this.intentionalClose = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Close all WebRTC connections
    this.remotePeers.forEach((peer) => {
      peer.dataChannel?.close();
      peer.peerConnection?.close();
    });
    this.remotePeers.clear();

    if (this.ws) {
      if (this.myPeerId && this.ws.readyState === WebSocket.OPEN) {
        this.sendMessage({ type: "deregister", peerId: this.myPeerId });
      }
      this.ws.close();
      this.ws = null;
    }

    this.isRegistered = false;
    this.myPeerId = null;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.intentionalClose) return;
    this.reconnectAttempts++;
    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.warn(`[SignalingClient] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Signaling offline — will use HTTP fallback only.`);
      this.emit("error", { message: "Max reconnect attempts reached" });
      return;
    }
    console.log(`[SignalingClient] Reconnecting in ${this.reconnectDelay / 1000}s... (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }

  // ── Registration ──────────────────────────────────────────────────────────

  register(
    peerId: string,
    alias: string,
    pairs: string[],
    walletAddresses: Record<string, string>
  ) {
    this.myPeerId = peerId;
    this.myAlias = alias;
    this.myPairs = pairs;
    this.myWalletAddresses = walletAddresses;

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect();
      return; // Will register on connect
    }

    this.sendMessage({
      type: "register",
      peerId,
      alias,
      pairs,
      walletAddresses,
    });
  }

  deregister() {
    if (this.myPeerId && this.ws?.readyState === WebSocket.OPEN) {
      this.sendMessage({ type: "deregister", peerId: this.myPeerId });
    }
    this.stopHeartbeat();
    this.isRegistered = false;

    // Close all WebRTC connections
    this.remotePeers.forEach((peer) => {
      peer.dataChannel?.close();
      peer.peerConnection?.close();
    });
    this.remotePeers.clear();
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.myPeerId && this.ws?.readyState === WebSocket.OPEN) {
        this.sendMessage({
          type: "heartbeat",
          peerId: this.myPeerId,
          pairs: this.myPairs,
        });
      }
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── Message Sending ───────────────────────────────────────────────────────

  private sendMessage(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /** Send data to a specific peer — uses WebRTC data channel if available, falls back to signaling relay */
  sendToPeer(targetPeerId: string, payload: unknown) {
    const remote = this.remotePeers.get(targetPeerId);

    // Try WebRTC data channel first (direct, no server)
    if (remote?.dataChannel?.readyState === "open") {
      remote.dataChannel.send(JSON.stringify(payload));
      return;
    }

    // Fall back to signaling server relay
    this.sendMessage({
      type: "peer_message",
      targetPeerId,
      payload,
    });
  }

  /** Send an LP invite to a specific peer via signaling server */
  sendLpInvite(targetPeerId: string, payload: unknown) {
    this.sendMessage({
      type: "lp_invite",
      targetPeerId,
      payload,
    });
  }

  /** Broadcast an RFQ to all peers */
  broadcastRfq(rfq: unknown) {
    // Send via signaling server (reaches all peers)
    this.sendMessage({
      type: "rfq_broadcast",
      rfq,
    });

    // Also send via WebRTC data channels for redundancy
    this.remotePeers.forEach((peer) => {
      if (peer.dataChannel?.readyState === "open") {
        peer.dataChannel.send(JSON.stringify({ type: "rfq", rfq }));
      }
    });
  }

  // ── Server Message Handling ───────────────────────────────────────────────

  private handleServerMessage(msg: Record<string, unknown>) {
    switch (msg.type) {
      case "registered":
        this.isRegistered = true;
        this.startHeartbeat();
        this.emit("registered", msg);
        console.log(`[SignalingClient] Registered as ${this.myAlias} — ${msg.peerCount} peers online`);
        break;

      case "peer_list": {
        const peers = msg.peers as Array<{
          peerId: string;
          alias: string;
          pairs: string[];
          walletAddresses: Record<string, string>;
          connectedAt: number;
        }>;
        // Initialize remote peer entries
        for (const p of peers) {
          if (!this.remotePeers.has(p.peerId)) {
            this.remotePeers.set(p.peerId, {
              ...p,
              dataChannel: null,
              peerConnection: null,
            });
          }
        }
        this.emit("peer_list", peers);

        // Initiate WebRTC connections to all existing peers
        for (const p of peers) {
          this.initiateWebRTC(p.peerId);
        }
        break;
      }

      case "peer_joined": {
        const peer = msg.peer as {
          peerId: string;
          alias: string;
          pairs: string[];
          walletAddresses: Record<string, string>;
          connectedAt: number;
        };
        if (!this.remotePeers.has(peer.peerId)) {
          this.remotePeers.set(peer.peerId, {
            ...peer,
            dataChannel: null,
            peerConnection: null,
          });
        }
        this.emit("peer_joined", peer);
        console.log(`[SignalingClient] Peer joined: ${peer.alias} (${peer.peerId.slice(0, 12)}…)`);

        // The newly joined peer will initiate WebRTC to us (they received peer_list)
        // We don't initiate here to avoid duplicate offers
        break;
      }

      case "peer_left": {
        const peerId = msg.peerId as string;
        const remote = this.remotePeers.get(peerId);
        if (remote) {
          remote.dataChannel?.close();
          remote.peerConnection?.close();
          this.remotePeers.delete(peerId);
        }
        this.emit("peer_left", peerId);
        console.log(`[SignalingClient] Peer left: ${peerId.slice(0, 12)}…`);
        break;
      }

      case "rtc_offer":
        this.handleRtcOffer(msg.fromPeerId as string, msg.sdp as RTCSessionDescriptionInit);
        break;

      case "rtc_answer":
        this.handleRtcAnswer(msg.fromPeerId as string, msg.sdp as RTCSessionDescriptionInit);
        break;

      case "rtc_ice":
        this.handleRtcIce(msg.fromPeerId as string, msg.candidate as RTCIceCandidateInit);
        break;

      case "peer_message":
        this.emit("peer_message", {
          fromPeerId: msg.fromPeerId,
          payload: msg.payload,
        });
        break;

      case "rfq_broadcast":
        this.emit("rfq_broadcast", {
          fromPeerId: msg.fromPeerId,
          rfq: msg.rfq,
        });
        break;

      case "agent_rfq":
        // Agent-dispatched RFQ — server pushes this directly to the matched peer
        this.emit("agent_rfq", msg);
        break;

      case "lp_invite":
        // LP invite — another peer is asking us to register for a pair
        this.emit("lp_invite", {
          fromPeerId: msg.fromPeerId,
          payload: msg.payload,
        });
        break;

      case "error":
        console.error("[SignalingClient] Server error:", msg.message);
        this.emit("error", msg.message);
        break;
    }
  }

  // ── WebRTC Connection Management ──────────────────────────────────────────

  private async initiateWebRTC(targetPeerId: string) {
    if (!this.myPeerId) return;

    const remote = this.remotePeers.get(targetPeerId);
    if (!remote) return;

    // Don't create duplicate connections
    if (remote.peerConnection) return;

    console.log(`[SignalingClient] Initiating WebRTC to ${targetPeerId.slice(0, 12)}…`);

    const pc = new RTCPeerConnection(RTC_CONFIG);
    remote.peerConnection = pc;

    // Create data channel (initiator creates it)
    const dc = pc.createDataChannel("afos-p2p", {
      ordered: true,
    });
    this.setupDataChannel(dc, targetPeerId);

    // ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendMessage({
          type: "rtc_ice",
          targetPeerId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        console.log(`[SignalingClient] WebRTC to ${targetPeerId.slice(0, 12)}… ${pc.connectionState}`);
        // Clean up but keep the remote peer entry (they're still on signaling)
        remote.dataChannel = null;
        remote.peerConnection = null;
        pc.close();
        this.emit("data_channel_close", { peerId: targetPeerId });
      }
    };

    // Create and send offer
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendMessage({
        type: "rtc_offer",
        targetPeerId,
        sdp: pc.localDescription?.toJSON(),
      });
    } catch (err) {
      console.error(`[SignalingClient] Failed to create offer for ${targetPeerId}:`, err);
      remote.peerConnection = null;
      pc.close();
    }
  }

  private async handleRtcOffer(fromPeerId: string, sdp: RTCSessionDescriptionInit) {
    if (!this.myPeerId) return;

    let remote = this.remotePeers.get(fromPeerId);
    if (!remote) {
      // Peer might have joined but we haven't received peer_joined yet
      remote = {
        peerId: fromPeerId,
        alias: `peer-${fromPeerId.slice(0, 6)}`,
        pairs: [],
        walletAddresses: {},
        connectedAt: Date.now(),
        dataChannel: null,
        peerConnection: null,
      };
      this.remotePeers.set(fromPeerId, remote);
    }

    // If we already have a connection, close it first
    if (remote.peerConnection) {
      remote.peerConnection.close();
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);
    remote.peerConnection = pc;

    // Handle incoming data channel (responder receives it)
    pc.ondatachannel = (event) => {
      this.setupDataChannel(event.channel, fromPeerId);
    };

    // ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendMessage({
          type: "rtc_ice",
          targetPeerId: fromPeerId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        remote!.dataChannel = null;
        remote!.peerConnection = null;
        pc.close();
        this.emit("data_channel_close", { peerId: fromPeerId });
      }
    };

    // Set remote description and create answer
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendMessage({
        type: "rtc_answer",
        targetPeerId: fromPeerId,
        sdp: pc.localDescription?.toJSON(),
      });
    } catch (err) {
      console.error(`[SignalingClient] Failed to handle offer from ${fromPeerId}:`, err);
      remote.peerConnection = null;
      pc.close();
    }
  }

  private async handleRtcAnswer(fromPeerId: string, sdp: RTCSessionDescriptionInit) {
    const remote = this.remotePeers.get(fromPeerId);
    if (!remote?.peerConnection) return;

    try {
      await remote.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    } catch (err) {
      console.error(`[SignalingClient] Failed to set answer from ${fromPeerId}:`, err);
    }
  }

  private async handleRtcIce(fromPeerId: string, candidate: RTCIceCandidateInit) {
    const remote = this.remotePeers.get(fromPeerId);
    if (!remote?.peerConnection) return;

    try {
      await remote.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      // ICE candidate errors are common and usually non-fatal
      console.debug(`[SignalingClient] ICE candidate error from ${fromPeerId}:`, err);
    }
  }

  private setupDataChannel(dc: RTCDataChannel, peerId: string) {
    const remote = this.remotePeers.get(peerId);

    dc.onopen = () => {
      console.log(`[SignalingClient] Data channel open with ${peerId.slice(0, 12)}…`);
      if (remote) remote.dataChannel = dc;
      this.emit("data_channel_open", { peerId, channel: dc });
    };

    dc.onclose = () => {
      console.log(`[SignalingClient] Data channel closed with ${peerId.slice(0, 12)}…`);
      if (remote) remote.dataChannel = null;
      this.emit("data_channel_close", { peerId });
    };

    dc.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.emit("data_channel_message", { peerId, data });
      } catch {
        // Non-JSON message
        this.emit("data_channel_message", { peerId, data: event.data });
      }
    };

    dc.onerror = (err) => {
      console.error(`[SignalingClient] Data channel error with ${peerId}:`, err);
    };
  }

  // ── Public Getters ────────────────────────────────────────────────────────

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get registered(): boolean {
    return this.isRegistered;
  }

  get peerId(): string | null {
    return this.myPeerId;
  }

  get peers(): Map<string, RemotePeer> {
    return this.remotePeers;
  }

  /** Get count of peers with active WebRTC data channels */
  get directPeerCount(): number {
    let count = 0;
    this.remotePeers.forEach((p) => {
      if (p.dataChannel?.readyState === "open") count++;
    });
    return count;
  }

  /** Get all remote peers as an array */
  getPeerList(): RemotePeer[] {
    return Array.from(this.remotePeers.values());
  }
}

// ─── Singleton Instance ──────────────────────────────────────────────────────

let _instance: SignalingClient | null = null;

export function getSignalingClient(): SignalingClient {
  if (!_instance) {
    _instance = new SignalingClient();
  }
  return _instance;
}
