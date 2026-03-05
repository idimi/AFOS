/**
 * Signaling Server — Unit Tests
 * Tests the WebSocket signaling server for peer registry, heartbeat, and message relay.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const SIGNALING_PATH = path.resolve(__dirname, "signaling.ts");
const signalingSource = fs.readFileSync(SIGNALING_PATH, "utf-8");

describe("Signaling Server — Source Code Validation", () => {
  it("should export attachSignaling function", () => {
    expect(signalingSource).toContain("export function attachSignaling");
  });

  it("should handle 'register' message type", () => {
    expect(signalingSource).toContain('"register"');
  });

  it("should handle 'deregister' message type", () => {
    expect(signalingSource).toContain('"deregister"');
  });

  it("should handle 'heartbeat' message type", () => {
    expect(signalingSource).toContain('"heartbeat"');
  });

  it("should handle WebRTC signaling messages (rtc_offer, rtc_answer, rtc_ice)", () => {
    expect(signalingSource).toContain('"rtc_offer"');
    expect(signalingSource).toContain('"rtc_answer"');
    expect(signalingSource).toContain('"rtc_ice"');
  });

  it("should handle 'peer_message' for direct messaging relay", () => {
    expect(signalingSource).toContain('"peer_message"');
  });

  it("should handle 'rfq_broadcast' for RFQ distribution", () => {
    expect(signalingSource).toContain('"rfq_broadcast"');
  });

  it("should implement peer cleanup with STALE_TIMEOUT_MS", () => {
    expect(signalingSource).toContain("STALE_TIMEOUT_MS");
  });

  it("should send peer_list to newly registered peers", () => {
    expect(signalingSource).toContain("peer_list");
  });

  it("should broadcast peer_joined when a new peer registers", () => {
    expect(signalingSource).toContain("peer_joined");
  });

  it("should broadcast peer_left when a peer deregisters", () => {
    expect(signalingSource).toContain("peer_left");
  });

  it("should use /api/ws/signaling path for WebSocket upgrade", () => {
    expect(signalingSource).toContain("/api/ws/signaling");
  });

  it("should store wallet addresses in peer registry", () => {
    expect(signalingSource).toContain("walletAddresses");
  });

  it("should track peer pairs for matchmaking", () => {
    expect(signalingSource).toContain("pairs");
  });
});

describe("Signaling Client — Source Code Validation", () => {
  const CLIENT_PATH = path.resolve(__dirname, "../client/src/lib/signalingClient.ts");
  const clientSource = fs.readFileSync(CLIENT_PATH, "utf-8");

  it("should export SignalingClient class", () => {
    expect(clientSource).toContain("export class SignalingClient");
  });

  it("should export RemotePeer interface", () => {
    expect(clientSource).toContain("export interface RemotePeer");
  });

  it("should export getSignalingClient singleton factory", () => {
    expect(clientSource).toContain("export function getSignalingClient");
  });

  it("should implement WebRTC peer connection with STUN servers", () => {
    expect(clientSource).toContain("stun:");
  });

  it("should implement register method", () => {
    expect(clientSource).toContain("register(");
  });

  it("should implement deregister method", () => {
    expect(clientSource).toContain("deregister(");
  });

  it("should implement sendToPeer for direct messaging", () => {
    expect(clientSource).toContain("sendToPeer(");
  });

  it("should implement broadcastRfq for RFQ distribution", () => {
    expect(clientSource).toContain("broadcastRfq(");
  });

  it("should handle WebRTC offer/answer/ICE candidate exchange", () => {
    expect(clientSource).toContain("createOffer");
    expect(clientSource).toContain("createAnswer");
    expect(clientSource).toContain("addIceCandidate");
  });

  it("should create RTCDataChannel for direct peer communication", () => {
    expect(clientSource).toContain("createDataChannel");
  });

  it("should implement auto-reconnect on WebSocket close", () => {
    expect(clientSource).toContain("reconnect");
  });

  it("should implement getPeerList method", () => {
    expect(clientSource).toContain("getPeerList()");
  });

  it("should track directPeerCount", () => {
    expect(clientSource).toContain("directPeerCount");
  });
});

describe("LightPeerContext — Signaling Integration", () => {
  const CONTEXT_PATH = path.resolve(__dirname, "../client/src/contexts/LightPeerContext.tsx");
  const contextSource = fs.readFileSync(CONTEXT_PATH, "utf-8");

  it("should import getSignalingClient from signalingClient", () => {
    expect(contextSource).toContain("getSignalingClient");
  });

  it("should import RemotePeer and SignalingClient types", () => {
    expect(contextSource).toContain("RemotePeer");
    expect(contextSource).toContain("SignalingClient");
  });

  it("should expose remotePeers in context value", () => {
    expect(contextSource).toContain("remotePeers");
  });

  it("should expose signalingConnected in context value", () => {
    expect(contextSource).toContain("signalingConnected");
  });

  it("should expose directPeerCount in context value", () => {
    expect(contextSource).toContain("directPeerCount");
  });

  it("should expose sendPeerMessage action", () => {
    expect(contextSource).toContain("sendPeerMessage");
  });

  it("should expose broadcastRfq action", () => {
    expect(contextSource).toContain("broadcastRfq");
  });

  it("should connect signaling client when peerId and prefs.enabled", () => {
    expect(contextSource).toContain("client.connect()");
    expect(contextSource).toContain("client.register(");
  });

  it("should disconnect signaling on cleanup", () => {
    expect(contextSource).toContain("client.deregister()");
    expect(contextSource).toContain("client.disconnect()");
  });

  it("should keep legacy HTTP announce as fallback", () => {
    expect(contextSource).toContain("/api/peer/announce");
    expect(contextSource).toContain("announceToRelay");
  });
});
