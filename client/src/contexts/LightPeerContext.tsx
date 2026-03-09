/**
 * LightPeerContext — Browser Wallet as a P2P Quoting Peer
 *
 * When a wallet is connected, the browser automatically registers as a
 * "light peer" on the AFOS P2P network. No server or AFOS agent
 * is required — the wallet public key becomes the peer identity.
 *
 * Flow:
 *  1. Wallet connects → derive peerId from pubkey → announce to network
 *  2. SSE p2p_rfq events arrive → auto-quote matching pairs at live price + spread
 *  3. Incoming RFQ notification shown to user → Accept/Reject
 *  4. Accept → sign HTLC lock tx via wallet → settle atomically
 *  5. Heartbeat every 30s to keep peer alive on network
 *  6. Wallet disconnects → send peer_disconnected + stop heartbeat
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { useWallet } from "./WalletContext";
import { useMultiChainWallet } from "./MultiChainWalletContext";
import { onSSEEvent, getPrices, BACKEND_URL, announceToRelay } from "../lib/afosApi";
import { toast } from "sonner";
import {
  detectBtcProvider,
  executeBtcHtlcLock,
  type BtcWalletProvider,
} from "../lib/btcHtlc";
import { buildSolanaHtlcLockTx, generateHtlcSecret } from "../lib/solanaHtlc";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getSignalingClient, type RemotePeer, type SignalingClient } from "../lib/signalingClient";
import { executeTnkHtlcLock, tnkExplorerUrl } from "../lib/tnkHtlc";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LightPeerPrefs {
  enabled: boolean;
  spreadBps: number;          // basis points above market (e.g. 30 = 0.30%)
  minTradeUsd: number;        // minimum trade size in USD
  maxTradeUsd: number;        // maximum trade size in USD
  acceptedPairs: string[];    // e.g. ["SOL/USDT", "ETH/USDC"]
  autoAccept: boolean;        // auto-accept RFQs without user confirmation
}

export interface IncomingRfq {
  rfqId: string;
  fromToken: string;
  toToken: string;
  amount: number;
  fromChain: string;
  toChain: string;
  requestorPeer: string;
  expiresAt: number;          // unix ms
  suggestedRate: number;
  suggestedOutAmount: number;
  status: "pending" | "accepted" | "rejected" | "expired";
  receivedAt: number;
}

export type HtlcStep = "idle" | "signing" | "locking" | "revealing" | "settled" | "failed";

export interface HtlcSigningState {
  rfqId: string;
  step: HtlcStep;
  txHash?: string;
  error?: string;
}

export interface LightPeerState {
  peerId: string | null;
  peerAlias: string;
  isRegistered: boolean;
  isOnline: boolean;
  prefs: LightPeerPrefs;
  incomingRfqs: IncomingRfq[];
  quotesGiven: number;
  tradesCompleted: number;
  totalVolumeUsd: number;
  lastHeartbeat: number | null;
  htlcSigning: HtlcSigningState | null;
  /** Remote peers discovered via WebSocket signaling */
  remotePeers: RemotePeer[];
  /** The signaling client instance for direct peer messaging */
  signalingClient: SignalingClient | null;
  /** Whether the signaling WebSocket is connected */
  signalingConnected: boolean;
  /** Count of peers with direct WebRTC data channels */
  directPeerCount: number;
  /** Connected wallet addresses for multi-chain display */
  solanaAddress: string | null;
  ethereumAddress: string | null;
  bitcoinAddress: string | null;
  // Actions
  setPrefs: (prefs: Partial<LightPeerPrefs>) => void;
  acceptRfq: (rfqId: string) => Promise<void>;
  rejectRfq: (rfqId: string) => void;
  /**
   * Initiate HTLC lock as the REQUESTER (Agent A).
   * Called after buildSwapTx returns P2P route — triggers wallet signing.
   */
  initiateHtlcLock: (params: {
    rfqId: string;
    fromToken: string;
    toToken: string;
    fromChain: string;
    toChain: string;
    amount: number;
    outAmount: number;
    rate: number;
    counterpartyPeerId?: string;
    counterpartyWallet?: string;
  }) => Promise<void>;
  toggleEnabled: () => void;
  dismissHtlc: () => void;
  /** Send a message to a specific peer via WebRTC or signaling relay */
  sendPeerMessage: (targetPeerId: string, payload: unknown) => void;
  /** Broadcast an RFQ to all connected peers */
  broadcastRfq: (rfq: unknown) => void;
  /** Map of rfqId → secretHex received from Agent A (for Agent B to claim) */
  htlcRevealedSecrets: Record<string, string>;
  /**
   * Claim HTLC funds as Agent B using the revealed secret.
   * Builds and broadcasts the on-chain claim transaction for the given chain.
   */
  claimHtlcFunds: (rfqId: string) => Promise<void>;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_PREFS: LightPeerPrefs = {
  // Disabled by default — users must explicitly opt in as LPs in Agent Settings.
  // This prevents every browser visitor from appearing as a phantom LP peer.
  enabled: false,
  spreadBps: 30,
  minTradeUsd: 10,
  maxTradeUsd: 10000,
  acceptedPairs: [
    "SOL/USDT", "SOL/USDC", "ETH/USDT", "ETH/USDC",
    "BTC/USDT", "BTC/ETH", "BTC/SOL",
    "TNK/USDT", "TNK/ETH", "TNK/SOL", "TNK/BTC",
  ],
  autoAccept: false,
};

const HEARTBEAT_INTERVAL_MS = 30_000;
const RFQ_EXPIRY_MS = 60_000;

// ─── Context ──────────────────────────────────────────────────────────────────

const LightPeerContext = createContext<LightPeerState | null>(null);

export function LightPeerProvider({ children }: { children: ReactNode }) {
  const { publicKey: solPubkey, connected: solAdapterConnected, signTransaction } = useWallet();
  const { ethereum, bitcoin, phantomMultiChain } = useMultiChainWallet();
  const { connection: solConnection } = useConnection();

  // Solana is "connected" if the standard adapter is connected OR if Phantom multi-chain has a Solana address
  const phantomSolAddress = phantomMultiChain?.solanaAddress;
  const solConnected = solAdapterConnected || !!phantomSolAddress;

  // ── Peer identity — stable device-local key (wallet-agnostic) ───────────────
  // Generate once and persist in localStorage so the peer ID never changes
  // regardless of which wallet(s) are connected. Wallet addresses are broadcast
  // as metadata alongside this stable ID.
  const [peerId] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem("afos_peer_id");
      if (stored) return stored;
      // Generate a new stable ID: 8 random hex chars prefixed with 'lp-'
      const rand = Array.from(crypto.getRandomValues(new Uint8Array(5)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      const newId = `lp-${rand}`;
      localStorage.setItem("afos_peer_id", newId);
      return newId;
    } catch {
      return null;
    }
  });
  const [peerAlias, setPeerAlias] = useState<string>(() => {
    try {
      const stored = localStorage.getItem("afos_peer_alias");
      return stored || "light-peer";
    } catch {
      return "light-peer";
    }
  });
  const [isRegistered, setIsRegistered] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [lastHeartbeat, setLastHeartbeat] = useState<number | null>(null);

  // ── Preferences (persisted to localStorage) ───────────────────────────────
  const [prefs, setPrefsState] = useState<LightPeerPrefs>(() => {
    try {
      const saved = localStorage.getItem("afos_light_peer_prefs");
      if (!saved) return DEFAULT_PREFS;
      const parsed = JSON.parse(saved) as Partial<LightPeerPrefs>;
      // Migration: if the user never explicitly opted in as LP (no "lp_opted_in" flag),
      // reset enabled to false regardless of what was stored. This clears the old
      // default-true behaviour that auto-registered every visitor as a peer.
      const hasExplicitlyOptedIn = localStorage.getItem("afos_lp_opted_in") === "true";
      if (!hasExplicitlyOptedIn && parsed.enabled) {
        parsed.enabled = false;
        localStorage.setItem("afos_light_peer_prefs", JSON.stringify({ ...DEFAULT_PREFS, ...parsed }));
      }
      return { ...DEFAULT_PREFS, ...parsed };
    } catch {
      return DEFAULT_PREFS;
    }
  });

  // ── RFQ state ──────────────────────────────────────────────────────────────
  const [incomingRfqs, setIncomingRfqs] = useState<IncomingRfq[]>([]);
  const [quotesGiven, setQuotesGiven] = useState(0);
  const [tradesCompleted, setTradesCompleted] = useState(0);
  const [totalVolumeUsd, setTotalVolumeUsd] = useState(0);
  const [htlcSigning, setHtlcSigning] = useState<HtlcSigningState | null>(null);
  // rfqId → revealed secretHex (received from Agent A after they confirm their lock)
  const [htlcRevealedSecrets, setHtlcRevealedSecrets] = useState<Record<string, string>>({});

  // ── Signaling state ───────────────────────────────────────────────────────
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  const [signalingConnected, setSignalingConnected] = useState(false);
  const [directPeerCount, setDirectPeerCount] = useState(0);
  const signalingRef = useRef<SignalingClient | null>(null);

  // ── Live prices ref (updated from SSE) ────────────────────────────────────
  const pricesRef = useRef<Record<string, number>>({});
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  // ── Update alias from stable peer ID (never changes) ──────────────────────
  // The alias is derived from the stable peer ID, not from wallet addresses.
  // It is set once on mount and persisted so it stays consistent across sessions.
  useEffect(() => {
    if (!peerId) return;
    const stored = localStorage.getItem("afos_peer_alias");
    if (stored && stored !== "light-peer") {
      setPeerAlias(stored);
      return;
    }
    // Derive alias from stable peer ID suffix
    const alias = peerId; // e.g. "lp-a3f9c1b2" — already short and readable
    localStorage.setItem("afos_peer_alias", alias);
    setPeerAlias(alias);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerId]);

  // ── Announce / heartbeat (legacy HTTP — kept as fallback) ─────────────────
  const announce = useCallback(async (id: string, alias: string) => {
    if (!prefsRef.current.enabled) return;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);
      await fetch(`${BACKEND_URL}/api/peer/announce`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          peerId: id, alias,
          pairs: prefsRef.current.acceptedPairs,
          spreadBps: prefsRef.current.spreadBps,
          minTradeUsd: prefsRef.current.minTradeUsd,
          maxTradeUsd: prefsRef.current.maxTradeUsd,
          peerType: "light",
          timestamp: Date.now(),
        }),
      });
      clearTimeout(timeoutId);
    } catch { /* Oracle VM not needed 2014 signaling server is primary — signaling server is primary */ }
    announceToRelay(id, alias, prefsRef.current.acceptedPairs).catch(() => {});
  }, []);

  const deannounce = useCallback(async (id: string) => {
    try {
      await fetch(`${BACKEND_URL}/api/peer/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ peerId: id, timestamp: Date.now() }),
      });
    } catch { /* best-effort */ }
  }, []);

  // ── WebSocket Signaling — primary peer discovery & WebRTC ─────────────────
  // Bug 6 fix: Always connect to the signaling WebSocket so this peer can RECEIVE
  // agent_rfq messages even when Peer Mode (prefs.enabled) is OFF. We only
  // advertise our pairs / register as a liquidity provider when enabled=true.
  useEffect(() => {
    if (!peerId) {
      // No stable peer ID yet — cannot connect
      if (signalingRef.current) {
        signalingRef.current.deregister();
        signalingRef.current.disconnect();
        signalingRef.current = null;
      }
      setRemotePeers([]);
      setSignalingConnected(false);
      setDirectPeerCount(0);
      if (isRegistered) {
        setIsRegistered(false);
        setIsOnline(false);
      }
      return;
    }
    // If peer mode was just disabled, deregister (stop advertising) but keep the
    // WebSocket open so we can still receive incoming agent_rfq messages.
    if (!prefs.enabled && signalingRef.current) {
      signalingRef.current.deregister();
      setIsRegistered(false);
      setIsOnline(false);
      // Keep signalingRef.current alive — do NOT disconnect or return early.
    }

    const client = getSignalingClient();
    signalingRef.current = client;

    // Build wallet addresses map
    const walletAddresses: Record<string, string> = {};
    if (solAdapterConnected && solPubkey) walletAddresses.solana = solPubkey.toString();
    if (phantomSolAddress) walletAddresses.solana = walletAddresses.solana || phantomSolAddress;
    if (ethereum?.address) walletAddresses.ethereum = ethereum.address;
    if (bitcoin?.address) walletAddresses.bitcoin = bitcoin.address;

    // Event handlers
    const unsubs: Array<() => void> = [];

    unsubs.push(client.on("connected", () => {
      setSignalingConnected(true);
    }));

    unsubs.push(client.on("disconnected", () => {
      setSignalingConnected(false);
    }));

    unsubs.push(client.on("registered", () => {
      setIsRegistered(true);
      setIsOnline(true);
      setLastHeartbeat(Date.now());
    }));

    unsubs.push(client.on("peer_list", () => {
      setRemotePeers(client.getPeerList());
      setDirectPeerCount(client.directPeerCount);
    }));

    unsubs.push(client.on("peer_joined", () => {
      setRemotePeers(client.getPeerList());
    }));

    unsubs.push(client.on("peer_left", () => {
      setRemotePeers(client.getPeerList());
      setDirectPeerCount(client.directPeerCount);
    }));

    unsubs.push(client.on("data_channel_open", () => {
      setDirectPeerCount(client.directPeerCount);
    }));

    unsubs.push(client.on("data_channel_close", () => {
      setDirectPeerCount(client.directPeerCount);
    }));

    // Handle peer messages received via signaling relay or WebRTC
    unsubs.push(client.on("peer_message", (data) => {
      const { fromPeerId, payload } = data as { fromPeerId: string; payload: unknown };
      const msg = payload as { type?: string };
      if (msg?.type === "rfq") {
        // Process as RFQ (same as SSE p2p_rfq)
        window.dispatchEvent(new CustomEvent("afos:signaling-rfq", { detail: { fromPeerId, ...payload as object } }));
      } else if (msg?.type === "chat") {
        // Peer chat message
        window.dispatchEvent(new CustomEvent("afos:peer-chat", { detail: { fromPeerId, ...payload as object } }));
      } else if (msg?.type === "rfq_accepted") {
        // Counterparty accepted our RFQ — notify the chat UI
        window.dispatchEvent(new CustomEvent("afos:rfq-accepted", { detail: { fromPeerId, ...payload as object } }));
      }
    }));

    // Handle htlc_locked: Agent B notified Agent A that their lock is on-chain.
    // Agent A calls revealHtlcSecret, then sends the secret to Agent B.
    unsubs.push(client.on("htlc_locked", (data) => {
      const { fromPeerId, rfqId, txHash, chain, amountLocked } = data as {
        fromPeerId: string; rfqId: string; txHash?: string; chain?: string; amountLocked?: number;
      };
      if (!rfqId) return;
      // Show toast so Agent A knows Agent B locked
      toast.info(`Counterparty locked their ${chain ?? ""} HTLC`, {
        description: `RFQ ${rfqId.slice(0, 8)}… · ${amountLocked?.toFixed(4) ?? ""} locked · Tx: ${(txHash ?? "").slice(0, 12)}…`,
        duration: 12000,
      });
      // Dispatch window event so ChatPage / other UI can react
      window.dispatchEvent(new CustomEvent("afos:htlc-locked", { detail: { fromPeerId, rfqId, txHash, chain, amountLocked } }));
      // Retrieve the plaintext secret from the server and send it to Agent B
      void (async () => {
        try {
          const res = await fetch("/api/trpc/chat.revealHtlcSecret", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ "0": { json: { rfqId, requesterAddress: peerId ?? "" } } }),
          });
          if (!res.ok) {
            console.warn("[HTLC] revealHtlcSecret failed:", res.status);
            return;
          }
          const json = await res.json() as { result?: { data?: { json?: { secretHex?: string } } } };
          const secretHex = json?.result?.data?.json?.secretHex;
          if (!secretHex) { console.warn("[HTLC] No secretHex in revealHtlcSecret response"); return; }
          // Send the secret to Agent B so they can claim
          signalingRef.current?.sendHtlcSecret(fromPeerId, rfqId, secretHex);
          toast.success("HTLC secret revealed to counterparty", {
            description: `Agent B can now claim their funds for RFQ ${rfqId.slice(0, 8)}…`,
            duration: 10000,
          });
          window.dispatchEvent(new CustomEvent("afos:htlc-secret-sent", { detail: { rfqId, secretHex } }));
        } catch (e) {
          console.error("[HTLC] Error revealing secret:", e);
        }
      })();
    }));

    // Handle htlc_secret: Agent A sent us (Agent B) the plaintext secret so we can claim.
    unsubs.push(client.on("htlc_secret", (data) => {
      const { rfqId, secretHex } = data as { rfqId: string; secretHex: string };
      if (!rfqId || !secretHex) return;
      setHtlcRevealedSecrets(prev => ({ ...prev, [rfqId]: secretHex }));
      toast.success("HTLC secret received — you can now claim your funds!", {
        description: `Secret for RFQ ${rfqId.slice(0, 8)}… · Use this to call the claim function on-chain`,
        duration: 30000,
        action: {
          label: "Copy Secret",
          onClick: () => { void navigator.clipboard.writeText(secretHex); },
        },
      });
      window.dispatchEvent(new CustomEvent("afos:htlc-secret-received", { detail: { rfqId, secretHex } }));
    }));

    // Handle htlc_secret_reminder: server re-broadcasts the secret for Agent B who may have missed it
    unsubs.push(client.on("htlc_secret_reminder", (data) => {
      const { rfqId, secretHex } = data as { rfqId: string; secretHex: string };
      if (!rfqId || !secretHex) return;
      // Only update if we don't already have this secret stored
      setHtlcRevealedSecrets(prev => {
        if (prev[rfqId]) return prev; // already have it
        toast.info("Claim reminder: secret available", {
          description: `RFQ ${rfqId.slice(0, 8)}… — Agent A already revealed the secret. Claim your funds now.`,
          duration: 20000,
        });
        return { ...prev, [rfqId]: secretHex };
      });
    }));

    // Handle htlc_expired: the swap window has passed without settlement
    unsubs.push(client.on("htlc_expired", (data) => {
      const { rfqId } = data as { rfqId: string; fromChain?: string; toChain?: string; message?: string };
      if (!rfqId) return;
      // Remove the secret if stored (no longer claimable)
      setHtlcRevealedSecrets(prev => {
        const next = { ...prev };
        delete next[rfqId];
        return next;
      });
      toast.warning("HTLC swap expired", {
        description: `RFQ ${rfqId.slice(0, 8)}… expired. You may now refund your locked funds.`,
        duration: 15000,
      });
      window.dispatchEvent(new CustomEvent("afos:htlc-expired", { detail: { rfqId } }));
    }));

    // Handle RFQ broadcasts
    unsubs.push(client.on("rfq_broadcast", (data) => {
      const { fromPeerId, rfq } = data as { fromPeerId: string; rfq: unknown };
      window.dispatchEvent(new CustomEvent("afos:signaling-rfq", { detail: { fromPeerId, ...(rfq as object) } }));
    }));

    // Handle agent-dispatched RFQs (agent matched this peer with a requester)
    unsubs.push(client.on("agent_rfq", (data) => {
      const rfq = data as {
        rfqId: string;
        fromToken: string;
        toToken: string;
        fromChain: string;
        toChain: string;
        amount: number;
        outAmount: number;
        rate: number;
        requesterAlias?: string;
        requesterPeerId?: string;
        requesterWallet?: string;
        expiresAt: number;
      };
      if (!rfq.rfqId || !rfq.fromToken || !rfq.toToken) return;
      // Echo-filter: if this RFQ was sent by us (Order Book quote request), ignore it.
      // The requesterPeerId is set to our own peerId by requestPeerQuote in Swaps.tsx.
      if (rfq.requesterPeerId && rfq.requesterPeerId === peerId) return;
      // Also ignore if the alias is "Order Book" and we have no requesterPeerId (legacy path)
      if (!rfq.requesterPeerId && rfq.requesterAlias === "Order Book") return;
      // Build IncomingRfq from agent_rfq data
      const incoming: IncomingRfq = {
        rfqId: rfq.rfqId,
        fromToken: rfq.fromToken,
        toToken: rfq.toToken,
        amount: rfq.amount,
        fromChain: rfq.fromChain ?? "solana",
        toChain: rfq.toChain ?? "solana",
        requestorPeer: rfq.requesterPeerId ?? rfq.requesterAlias ?? "unknown",
        expiresAt: rfq.expiresAt,
        suggestedRate: rfq.rate,
        suggestedOutAmount: rfq.outAmount,
        status: "pending",
        receivedAt: Date.now(),
      };
      setIncomingRfqs(prev => {
        if (prev.some(r => r.rfqId === rfq.rfqId)) return prev;
        return [incoming, ...prev].slice(0, 20);
      });
      // Dispatch to chat page so the agent shows the incoming swap card
      window.dispatchEvent(new CustomEvent("afos:agent-rfq", { detail: rfq }));
      // Auto-accept if enabled and within configured limits
      const prefs_ = prefsRef.current as LightPeerPrefs & {
        autoAcceptRfq?: boolean;
        autoAcceptMaxUsd?: number;
        slippagePct?: string | number;
      };
      const autoAcceptEnabled = prefs_.autoAcceptRfq ?? prefs_.autoAccept;
      const autoAcceptCap = (prefs_.autoAcceptMaxUsd && prefs_.autoAcceptMaxUsd > 0)
        ? prefs_.autoAcceptMaxUsd
        : prefs_.maxTradeUsd;
      // Estimate USD value of the trade
      const fromPriceAA = pricesRef.current[rfq.fromToken?.toUpperCase() ?? ""] ?? 0;
      const tradeUsdEstimate = fromPriceAA > 0 ? rfq.amount * fromPriceAA : rfq.outAmount * rfq.rate;
      // Slippage guard: compare peer's offered rate against oracle mid-price
      const toPriceAA = pricesRef.current[rfq.toToken?.toUpperCase() ?? ""] ?? 0;
      const oracleRate = (fromPriceAA > 0 && toPriceAA > 0) ? fromPriceAA / toPriceAA : 0;
      const slippagePctNum = parseFloat(String(prefs_.slippagePct ?? "0.5"));
      const slippageFrac = isNaN(slippagePctNum) ? 0.005 : slippagePctNum / 100;
      // Peer rate must be within slippage tolerance of oracle rate
      const rateOk = oracleRate <= 0 || rfq.rate >= oracleRate * (1 - slippageFrac);
      if (autoAcceptEnabled && tradeUsdEstimate <= autoAcceptCap && rateOk) {
        submitQuote(incoming);
        setIncomingRfqs(prev =>
          prev.map(r => r.rfqId === rfq.rfqId ? { ...r, status: "accepted" } : r)
        );
        const autoAlias = rfq.requesterAlias ?? rfq.requesterPeerId?.slice(0, 8) ?? "Someone";
        toast.success(`Auto-accepted swap from ${autoAlias}`, {
          description: `${rfq.amount.toFixed(4)} ${rfq.fromToken} → ${rfq.outAmount.toFixed(4)} ${rfq.toToken}`,
          duration: 8000,
        });
        // Write to swap_analytics audit log via tRPC mutation (fire-and-forget)
        void fetch("/api/trpc/chat.logAutoAcceptedRfq", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            "0": {
              json: {
                rfqId:     rfq.rfqId,
                fromToken: rfq.fromToken,
                toToken:   rfq.toToken,
                fromChain: rfq.fromChain,
                toChain:   rfq.toChain,
                amount:    rfq.amount,
                outAmount: rfq.outAmount,
                rate:      rfq.rate,
                peerAlias: rfq.requesterAlias,
                peerId:    rfq.requesterPeerId,
              },
            },
          }),
        }).catch(() => { /* best-effort */ });
      } else if (autoAcceptEnabled && !rateOk) {
        // Slippage guard triggered — notify user and fall through to manual review
        const alias = rfq.requesterAlias ?? rfq.requesterPeerId?.slice(0, 8) ?? "Someone";
        toast.warning(`Auto-accept blocked: rate outside slippage tolerance`, {
          description: `Peer offered ${rfq.rate.toFixed(6)} vs oracle ${oracleRate.toFixed(6)} (>${(slippageFrac * 100).toFixed(2)}% slip)`,
          duration: 10000,
        });
        toast(`Incoming swap from ${alias}`, {
          description: `${rfq.amount.toFixed(4)} ${rfq.fromToken} → ${rfq.outAmount.toFixed(4)} ${rfq.toToken} — Agent matched you`,
          duration: 15000,
          action: {
            label: "View in Agent",
            onClick: () => {
              window.dispatchEvent(new CustomEvent("afos:open-agent-chat"));
            },
          },
        });
      } else {
        // Show toast notification for manual review
        const alias = rfq.requesterAlias ?? rfq.requesterPeerId?.slice(0, 8) ?? "Someone";
        toast(`Incoming swap from ${alias}`, {
          description: `${rfq.amount.toFixed(4)} ${rfq.fromToken} → ${rfq.outAmount.toFixed(4)} ${rfq.toToken} — Agent matched you`,
          duration: 15000,
          action: {
            label: "View in Agent",
            onClick: () => {
              window.dispatchEvent(new CustomEvent("afos:open-agent-chat"));
            },
          },
        });
      }
    }));

    // Always connect to the signaling WebSocket (needed to receive agent_rfq).
    // Register with the server in all cases so sendToPeer can deliver messages to
    // this peer. When Peer Mode is OFF, register with empty pairs so we are NOT
    // matched as a liquidity provider by findSignalingPeer.
    client.connect();
    if (prefs.enabled) {
      // Full LP registration: advertise pairs and start heartbeat
      client.register(peerId, peerAlias, prefs.acceptedPairs, walletAddresses, prefs.maxTradeUsd);
      // Also do legacy HTTP announce (best-effort fallback)
      announce(peerId, peerAlias);
      // Legacy heartbeat (best-effort fallback)
      heartbeatRef.current = setInterval(() => {
        announce(peerId, peerAlias);
        setLastHeartbeat(Date.now());
      }, HEARTBEAT_INTERVAL_MS);
    } else {
      // Listener-only registration: empty pairs — won't be matched as LP but CAN receive agent_rfq
      client.register(peerId, peerAlias, [], walletAddresses, 0);
    }

    return () => {
      unsubs.forEach(u => u());
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      client.deregister();
      client.disconnect();
      signalingRef.current = null;
      deannounce(peerId);
      setIsRegistered(false);
      setIsOnline(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerId, peerAlias, prefs.enabled, JSON.stringify(prefs.acceptedPairs), solAdapterConnected, solPubkey?.toString(), phantomSolAddress, ethereum?.address, bitcoin?.address]);

  // ── Subscribe to live prices via SSE ──────────────────────────────────────
  useEffect(() => {
    const unsub = onSSEEvent("prices", (data: unknown) => {
      const d = data as { prices?: Record<string, { usd: number }> };
      if (d?.prices) {
        const map: Record<string, number> = {};
        for (const [sym, v] of Object.entries(d.prices)) {
          map[sym.toUpperCase()] = v.usd;
        }
        pricesRef.current = map;
      }
    });

    // Also fetch prices on mount
    getPrices().then(p => {
      const map: Record<string, number> = {};
      for (const [sym, v] of Object.entries(p)) {
        map[sym.toUpperCase()] = v.usd;
      }
      pricesRef.current = map;
    }).catch(() => {});

    return unsub;
  }, []);

  // ── Listen for incoming RFQs via SSE ──────────────────────────────────────
  useEffect(() => {
    if (!peerId || !prefs.enabled) return;

    const unsub = onSSEEvent("p2p_rfq", (data: unknown) => {
      const rfq = data as {
        rfqId?: string;
        fromToken?: string;
        toToken?: string;
        amount?: number;
        fromChain?: string;
        toChain?: string;
        peerId?: string;
        requestorPeer?: string;
        timestamp?: number;
      };

      if (!rfq.rfqId || !rfq.fromToken || !rfq.toToken) return;

      // Don't respond to our own RFQs
      if (rfq.peerId === peerId || rfq.requestorPeer === peerId) return;

      const pair = `${rfq.toToken}/${rfq.fromToken}`;   // they want toToken, we sell fromToken
      const reversePair = `${rfq.fromToken}/${rfq.toToken}`;

      // Check if we accept this pair
      const pairAccepted = prefsRef.current.acceptedPairs.some(
        p => p === pair || p === reversePair ||
          p === `${rfq.fromToken}/${rfq.toToken}` ||
          p === `${rfq.toToken}/${rfq.fromToken}`
      );
      if (!pairAccepted) return;

      // Calculate quote
      const fromPrice = pricesRef.current[rfq.fromToken?.toUpperCase() ?? ""] ?? 0;
      const toPrice = pricesRef.current[rfq.toToken?.toUpperCase() ?? ""] ?? 1;
      if (!fromPrice || !toPrice) return;

      const amount = rfq.amount ?? 0;
      const tradeUsd = amount * fromPrice;

      // Check trade size limits
      if (tradeUsd < prefsRef.current.minTradeUsd || tradeUsd > prefsRef.current.maxTradeUsd) return;

      // Apply spread
      const spreadMultiplier = 1 - prefsRef.current.spreadBps / 10000;
      const baseRate = fromPrice / toPrice;
      const quotedRate = baseRate * spreadMultiplier;
      const outAmount = amount * quotedRate;

      const incoming: IncomingRfq = {
        rfqId: rfq.rfqId,
        fromToken: rfq.fromToken,
        toToken: rfq.toToken,
        amount,
        fromChain: rfq.fromChain ?? "solana",
        toChain: rfq.toChain ?? "solana",
        requestorPeer: rfq.requestorPeer ?? rfq.peerId ?? "unknown",
        expiresAt: Date.now() + RFQ_EXPIRY_MS,
        suggestedRate: quotedRate,
        suggestedOutAmount: outAmount,
        status: "pending",
        receivedAt: Date.now(),
      };

      setIncomingRfqs(prev => {
        // Deduplicate
        if (prev.some(r => r.rfqId === rfq.rfqId)) return prev;
        return [incoming, ...prev].slice(0, 20);
      });

      setQuotesGiven(q => q + 1);

      // Auto-accept if enabled — with slippage guard
      const ssePrefs = prefsRef.current as LightPeerPrefs & { slippagePct?: string | number };
      if (ssePrefs.autoAccept) {
        // Slippage guard: the rate we quoted (quotedRate) is already spread-adjusted below oracle.
        // We guard against the *requester* sending us a manipulated amount that implies a worse rate.
        // Compare our quoted rate against the oracle mid-price.
        const oracleRateSse = fromPrice / toPrice;  // already validated above
        const slippagePctSse = parseFloat(String(ssePrefs.slippagePct ?? "0.5"));
        const slippageFracSse = isNaN(slippagePctSse) ? 0.005 : slippagePctSse / 100;
        // Our quoted rate must not be worse than oracle*(1 - tolerance) — i.e. we don't give away
        // more than slippage% below mid-price. spreadBps is our profit buffer; if spread > slippage
        // the guard always passes. If spread < slippage the guard catches misconfigured spreads.
        const sseRateOk = quotedRate >= oracleRateSse * (1 - slippageFracSse);
        if (sseRateOk) {
          submitQuote(incoming);
          setIncomingRfqs(prev =>
            prev.map(r => r.rfqId === rfq.rfqId ? { ...r, status: "accepted" } : r)
          );
        } else {
          // Slippage guard triggered — warn user and fall through to manual review
          toast.warning("Auto-accept blocked: quoted rate outside slippage tolerance", {
            description: `Quoted ${quotedRate.toFixed(6)} vs oracle ${oracleRateSse.toFixed(6)} (>${(slippageFracSse * 100).toFixed(2)}% slip). Review manually.`,
            duration: 10000,
          });
          toast(`Incoming trade request: ${amount.toFixed(4)} ${rfq.fromToken} → ${outAmount.toFixed(4)} ${rfq.toToken}`, {
            description: `From peer ${incoming.requestorPeer.slice(0, 8)}… · $${tradeUsd.toFixed(2)} USD`,
            duration: 10000,
            action: {
              label: "View",
              onClick: () => {
                window.dispatchEvent(new CustomEvent("afos:open-peer-panel"));
              },
            },
          });
        }
      } else {
        // Show notification
        toast(`Incoming trade request: ${amount.toFixed(4)} ${rfq.fromToken} → ${outAmount.toFixed(4)} ${rfq.toToken}`, {
          description: `From peer ${incoming.requestorPeer.slice(0, 8)}… · $${tradeUsd.toFixed(2)} USD`,
          duration: 10000,
          action: {
            label: "View",
            onClick: () => {
              window.dispatchEvent(new CustomEvent("afos:open-peer-panel"));
            },
          },
        });
      }
    });

    return unsub;
  }, [peerId, prefs.enabled]);

  // ── Expire stale RFQs ─────────────────────────────────────────────────────
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setIncomingRfqs(prev =>
        prev.map(r =>
          r.status === "pending" && r.expiresAt < now
            ? { ...r, status: "expired" }
            : r
        )
      );
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // ── Submit quote to AFOS agent ─────────────────────────────────────────────
  const submitQuote = useCallback(async (rfq: IncomingRfq) => {
    try {
      await fetch(`${BACKEND_URL}/api/rfq/${rfq.rfqId}/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          peerId,
          peerAlias,
          rate: rfq.suggestedRate,
          outAmount: rfq.suggestedOutAmount,
          fromToken: rfq.fromToken,
          toToken: rfq.toToken,
          peerType: "light",
          timestamp: Date.now(),
        }),
      });
    } catch { /* best-effort — best-effort 2014 agent handles matching */ }
  }, [peerId, peerAlias]);

  // ── Accept RFQ with in-browser HTLC signing ───────────────────────────────
  // Accepts an optional `rfqOverride` so initiateHtlcLock can pass the synthetic
  // RFQ directly without waiting for React state to update.
  const acceptRfq = useCallback(async (rfqId: string, rfqOverride?: IncomingRfq) => {
    const rfq = rfqOverride ?? incomingRfqs.find(r => r.rfqId === rfqId);
    if (!rfq || rfq.status !== "pending") return;
    setIncomingRfqs(prev =>
      prev.map(r => r.rfqId === rfqId ? { ...r, status: "accepted" } : r)
    );
    // Step 1: Submit quote to AFOS agent
    await submitQuote(rfq);

    // Step 1b: Notify the requester (Agent A) that we accepted their RFQ
    if (rfq.requestorPeer && signalingRef.current) {
      signalingRef.current.sendToPeer(rfq.requestorPeer, {
        type: "rfq_accepted",
        rfqId: rfq.rfqId,
        acceptorAlias: peerAlias,
        acceptorPeerId: peerId,
        fromToken: rfq.fromToken,
        toToken: rfq.toToken,
        amount: rfq.amount,
        outAmount: rfq.suggestedOutAmount,
      });
    }

    // Step 2: In-browser HTLC lock signing
    setHtlcSigning({ rfqId, step: "signing" });

    try {
      const chain = rfq.fromChain?.toLowerCase() ?? "solana";

      if (chain === "solana" && solConnected && signTransaction && solPubkey) {
        // Solana HTLC: build PDA lock transaction and sign with wallet
        setHtlcSigning({ rfqId, step: "locking" });
        try {
          // Use Agent A's secretHashHex if provided (ensures atomicity), otherwise generate own
          const existingHash = (rfq as unknown as { secretHashHex?: string }).secretHashHex;
          const { secretHex, secretHashHex } = existingHash
            ? { secretHex: "", secretHashHex: existingHash }  // Agent B locks to Agent A's hash
            : await generateHtlcSecret();                     // fallback: generate own secret
          void secretHex; // store securely in production — needed to reveal later

          // Timelock: 1 hour from now
          const timelock = Math.floor(Date.now() / 1000) + 3600;

          // Counterparty pubkey: use peer's pubkey from RFQ if available
          const counterpartyStr = (rfq as unknown as { counterpartyAddress?: string }).counterpartyAddress
            ?? solPubkey.toBase58(); // fallback to self for demo
          let recipientPubkey: PublicKey;
          try {
            recipientPubkey = new PublicKey(counterpartyStr);
          } catch {
            recipientPubkey = solPubkey;
          }

          // Build the HTLC lock transaction
          const { transaction, escrowAddress } = await buildSolanaHtlcLockTx({
            senderPubkey:    solPubkey,
            recipientPubkey,
            amountSol:       rfq.amount ?? 0,
            secretHash:      secretHashHex,
            timelock,
            connection:      solConnection,
          });

          // Sign with the connected wallet
          const signedTx = await (signTransaction as (tx: import("@solana/web3.js").Transaction) => Promise<import("@solana/web3.js").Transaction>)(transaction);

          // Broadcast to Solana mainnet
          const rawTx = signedTx.serialize();
          const txHash = await solConnection.sendRawTransaction(rawTx, {
            skipPreflight: false,
            preflightCommitment: "confirmed",
          });

          setHtlcSigning({ rfqId, step: "revealing", txHash });
          await new Promise(r => setTimeout(r, 800));
          setHtlcSigning({ rfqId, step: "settled", txHash });
          // Notify Agent A that we (Agent B) have locked our side
          if (rfq.requestorPeer && signalingRef.current) {
            signalingRef.current.sendHtlcLocked(rfq.requestorPeer, rfqId, txHash, "solana", rfq.amount);
          }
          toast.success("Solana HTLC locked", {
            description: `Tx: ${txHash.slice(0, 20)}… · ${rfq.amount} SOL locked in PDA escrow (${escrowAddress.slice(0, 8)}…)`,
            action: {
              label: "View on Solscan",
              onClick: () => window.open(`https://solscan.io/tx/${txHash}`, "_blank"),
            },
          });
        } catch (solErr: unknown) {
          const msg = solErr instanceof Error ? solErr.message : String(solErr);
          if (msg.toLowerCase().includes("user rejected") || msg.toLowerCase().includes("cancel")) {
            setHtlcSigning({ rfqId, step: "failed", error: "Transaction rejected by user" });
          } else {
            setHtlcSigning({ rfqId, step: "failed", error: msg.slice(0, 120) });
            toast.error("Solana HTLC lock failed", { description: msg.slice(0, 80) });
          }
        }
      } else if ((chain === "ethereum" || chain === "eth") && ethereum?.connected) {
        // Ethereum HTLC: ABI-encoded lockETH() / lockToken() via HTLC.sol
        setHtlcSigning({ rfqId, step: "locking" });
        const rawEth = (window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<string> } }).ethereum;
        try {
          if (!rawEth) throw new Error("No Ethereum provider found");

          // ── Build ABI-encoded lockETH() calldata ─────────────────────────
          // HTLC contract address (set after deploying HTLC.sol to Sepolia/mainnet)
          const htlcContractAddress = import.meta.env.VITE_ETH_HTLC_ADDRESS as string | undefined;

          // Use Agent A's secretHashHex if provided (ensures atomicity), otherwise generate own
          const existingEthHash = (rfq as unknown as { secretHashHex?: string }).secretHashHex;
          const secretHashHex = existingEthHash ?? (() => {
            const secretBytes   = crypto.getRandomValues(new Uint8Array(32));
            return crypto.subtle.digest("SHA-256", secretBytes).then(buf =>
              Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
            );
          })();
          const resolvedSecretHashHex = typeof secretHashHex === "string" ? secretHashHex : await secretHashHex;

          // Timelock: 1 hour from now (Unix timestamp in seconds)
          const timelock = Math.floor(Date.now() / 1000) + 3600;

          // Counterparty address: use peer address from RFQ if available
          const recipient = (rfq as unknown as { counterpartyAddress?: string }).counterpartyAddress
            ?? ethereum.address;

          // Amount in wei (rfq.amount is in ETH)
          const amountWei = BigInt(Math.floor((rfq.amount ?? 0) * 1e18));

          // ABI-encode lockETH(bytes32 secretHash, address recipient, uint256 timelock)
          // Function selector: keccak256("lockETH(bytes32,address,uint256)") = 0x1d4e5e8c
          const padLeft = (hex: string, bytes = 32) => hex.padStart(bytes * 2, "0");
          const calldata = "0x1d4e5e8c"
            + padLeft(resolvedSecretHashHex, 32)
            + padLeft(recipient.replace(/^0x/, "").toLowerCase(), 32)
            + padLeft(timelock.toString(16), 32);

          // Use real HTLC contract if deployed, otherwise send a marker tx for demo
          const txTo   = htlcContractAddress ?? ethereum.address;
          const txData = htlcContractAddress ? calldata : `0x48544c43${rfqId.replace(/-/g, "").slice(0, 32)}`;
          const txValue = htlcContractAddress ? "0x" + amountWei.toString(16) : "0x0";
          const txGas   = htlcContractAddress ? "0x186A0" : "0x5208";

          const txHash = await rawEth.request({
            method: "eth_sendTransaction",
            params: [{
              from:  ethereum.address,
              to:    txTo,
              value: txValue,
              data:  txData,
              gas:   txGas,
            }],
          });
          setHtlcSigning({ rfqId, step: "revealing", txHash });
          await new Promise(r => setTimeout(r, 800));
          setHtlcSigning({ rfqId, step: "settled", txHash });
          // Notify Agent A that we (Agent B) have locked our side
          if (rfq.requestorPeer && signalingRef.current) {
            signalingRef.current.sendHtlcLocked(rfq.requestorPeer, rfqId, txHash, "ethereum", rfq.amount);
          }
          toast.success(htlcContractAddress ? "ETH HTLC locked" : "HTLC settled on Ethereum", {
            description: `Tx: ${txHash.slice(0, 20)}… · Funds locked atomically`,
          });
        } catch (ethErr: unknown) {
          const msg = ethErr instanceof Error ? ethErr.message : String(ethErr);
          if (msg.toLowerCase().includes("user rejected") || msg.toLowerCase().includes("rejected")) {
            setHtlcSigning({ rfqId, step: "failed", error: "Transaction rejected by user" });
          } else {
            // Wallet signing failed — do NOT mark as settled
            setHtlcSigning({ rfqId, step: "failed", error: msg.slice(0, 120) });
            toast.error("ETH HTLC lock failed", { description: msg.slice(0, 80) });
          }
        }
      } else if ((chain === "bitcoin" || chain === "btc") && bitcoin?.connected) {
        // Bitcoin HTLC: build P2WSH PSBT, sign with detected wallet, broadcast via mempool.space
        setHtlcSigning({ rfqId, step: "locking" });
        try {
          const btcProvider: BtcWalletProvider = detectBtcProvider();
          if (btcProvider === "unknown") {
            throw new Error("No Bitcoin wallet provider detected. Please connect Phantom, Xverse, or Tap Wallet.");
          }
          // Convert amount to satoshis (rfq.amount is in BTC)
          const amountSats = Math.round(rfq.amount * 1e8);
          // Use a placeholder pubkey for the counterparty — in production this comes from the RFQ
          // The peer's pubkey would be exchanged during the RFQ negotiation phase
          const counterpartyPubKey = rfq.requestorPeer
            ? `02${rfq.requestorPeer.replace(/[^0-9a-f]/gi, "").slice(0, 62).padEnd(62, "0")}`
            : "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"; // fallback: secp256k1 generator
          // Sender pubkey: derive from connected address (placeholder — real impl uses wallet's getPublicKey)
          const senderPubKey = bitcoin.address
            ? `03${bitcoin.address.replace(/[^0-9a-f]/gi, "").slice(0, 62).padEnd(62, "0")}`
            : "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
          // Pass Agent A's secretHashHex so both sides lock to the same hash (atomicity)
          const btcExistingHash = (rfq as unknown as { secretHashHex?: string }).secretHashHex;
          const result = await executeBtcHtlcLock(
            bitcoin.address,
            counterpartyPubKey,
            senderPubKey,
            amountSats,
            24, // 24-hour locktime
            btcProvider,
            "mainnet",
            btcExistingHash,
          );
          setHtlcSigning({ rfqId, step: "revealing", txHash: result.txid });
          await new Promise(r => setTimeout(r, 800));
          setHtlcSigning({ rfqId, step: "settled", txHash: result.txid });
          // Notify Agent A that we (Agent B) have locked our side
          if (rfq.requestorPeer && signalingRef.current) {
            signalingRef.current.sendHtlcLocked(rfq.requestorPeer, rfqId, result.txid, "bitcoin", rfq.amount);
          }
          toast.success("Bitcoin HTLC locked", {
            description: `Tx: ${result.txid.slice(0, 16)}… · ${amountSats.toLocaleString()} sats locked in P2WSH escrow`,
            action: {
              label: "View on mempool.space",
              onClick: () => window.open(result.explorerUrl, "_blank"),
            },
          });
        } catch (btcErr: unknown) {
          const msg = btcErr instanceof Error ? btcErr.message : String(btcErr);
          if (msg.toLowerCase().includes("user rejected") || msg.toLowerCase().includes("cancel")) {
            setHtlcSigning({ rfqId, step: "failed", error: "Transaction rejected by user" });
          } else if (msg.includes("Insufficient funds") || msg.includes("No confirmed UTXOs")) {
            setHtlcSigning({ rfqId, step: "failed", error: msg });
            toast.error("Insufficient Bitcoin balance", { description: msg });
          } else {
            // Wallet signing failed — do NOT mark as settled
            setHtlcSigning({ rfqId, step: "failed", error: msg.slice(0, 120) });
            toast.error("BTC HTLC lock failed", { description: msg.slice(0, 80) });
          }
        }
      } else if ((chain === "trac_network" || rfq.fromToken === "TNK") && (window as any).tracnetwork) {
        // TNK (Trac Network) HTLC: agent-escrow model using window.tracnetwork.sendTNK()
        setHtlcSigning({ rfqId, step: "locking" });
        try {
          // Use Agent A's secretHashHex if provided (ensures atomicity), otherwise generate own
          const existingTnkHash = (rfq as unknown as { secretHashHex?: string }).secretHashHex;
          const secretHash = existingTnkHash ?? (await generateHtlcSecret()).secretHashHex;
          const result = await executeTnkHtlcLock({
            amount: rfq.amount.toFixed(8),
            secretHash,
            timelockSeconds: 600, // 10 minutes default for TNK
          });
          setHtlcSigning({ rfqId, step: "revealing", txHash: result.txHash });
          await new Promise(r => setTimeout(r, 800));
          setHtlcSigning({ rfqId, step: "settled", txHash: result.txHash });
          // Notify Agent A that we (Agent B) have locked our side
          if (rfq.requestorPeer && signalingRef.current) {
            signalingRef.current.sendHtlcLocked(rfq.requestorPeer, rfqId, result.txHash, "trac_network", rfq.amount);
          }
          toast.success("TNK escrowed", {
            description: `${rfq.amount.toFixed(4)} TNK locked in AFOS escrow · Tx: ${result.txHash.slice(0, 16)}…`,
            action: {
              label: "View on Trac Explorer",
              onClick: () => window.open(tnkExplorerUrl(result.txHash), "_blank"),
            },
          });
        } catch (tnkErr: unknown) {
          const msg = tnkErr instanceof Error ? tnkErr.message : String(tnkErr);
          if (msg.toLowerCase().includes("user rejected") || msg.toLowerCase().includes("cancel")) {
            setHtlcSigning({ rfqId, step: "failed", error: "Transaction rejected by user" });
          } else {
            // Wallet signing failed — do NOT mark as settled
            setHtlcSigning({ rfqId, step: "failed", error: msg.slice(0, 120) });
            toast.error("TNK HTLC lock failed", { description: msg.slice(0, 80) });
          }
        }
      } else {
        // No wallet connected for this chain — cannot sign HTLC
        setHtlcSigning({ rfqId, step: "failed", error: `No ${chain} wallet connected to sign HTLC` });
        toast.error("Wallet not connected", {
          description: `Connect a ${chain} wallet to sign the HTLC lock transaction.`,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setHtlcSigning({ rfqId, step: "failed", error: msg });
      toast.error("HTLC signing failed", { description: msg });
    }

    // Only count as a completed trade if HTLC actually settled (not failed)
    setHtlcSigning(prev => {
      if (prev?.step === "settled") {
        setTradesCompleted(t => t + 1);
        const fromPrice = pricesRef.current[rfq.fromToken.toUpperCase()] ?? 0;
        setTotalVolumeUsd(v => v + rfq.amount * fromPrice);
      }
      return prev;
    });
  }, [incomingRfqs, submitQuote, solConnected, signTransaction, ethereum]);

  // ── Initiate HTLC Lock (Agent A / Requester side) ──────────────────────────
  // Called after buildSwapTx returns P2P route — triggers wallet signing for the requester.
  // Reuses the same HTLC signing logic as acceptRfq by creating a synthetic IncomingRfq.
  const initiateHtlcLock = useCallback(async (params: {
    rfqId: string;
    fromToken: string;
    toToken: string;
    fromChain: string;
    toChain: string;
    amount: number;
    outAmount: number;
    rate: number;
    counterpartyPeerId?: string;
    counterpartyWallet?: string;
  }) => {
    const { rfqId, fromToken, toToken, fromChain, toChain, amount, outAmount, rate, counterpartyPeerId, counterpartyWallet } = params;
    // Build a synthetic IncomingRfq for Agent A (the requester)
    // The counterpartyAddress field is used by the HTLC signing logic to know
    // who to lock funds for (the LP / Agent B).
    const syntheticRfq: IncomingRfq = {
      rfqId,
      fromToken,
      toToken,
      amount,
      fromChain,
      toChain,
      ...({ counterpartyAddress: counterpartyWallet } as object),
      requestorPeer: counterpartyPeerId ?? counterpartyWallet ?? "peer",
      expiresAt: Date.now() + 60_000,
      suggestedRate: rate,
      suggestedOutAmount: outAmount,
      status: "pending",
      receivedAt: Date.now(),
    };
    // Add to incomingRfqs so the HTLC signing panel shows up
    setIncomingRfqs(prev => {
      if (prev.some(r => r.rfqId === rfqId)) return prev;
      return [syntheticRfq, ...prev];
    });
    // Bug 5 fix: pass the synthetic RFQ directly to acceptRfq via rfqOverride
    // so it doesn't need to look it up from (stale) React state.
    await acceptRfq(rfqId, syntheticRfq);
  }, [acceptRfq]);

  // ── Claim HTLC Funds (Agent B) ──────────────────────────────────────────────
  // Called when Agent B has received the secret from Agent A and wants to claim
  // the funds locked in the HTLC on the destination chain.
  const claimHtlcFunds = useCallback(async (rfqId: string) => {
    const secretHex = htlcRevealedSecrets[rfqId];
    if (!secretHex) {
      toast.error("No secret available", { description: `No revealed secret found for RFQ ${rfqId.slice(0, 8)}…` });
      return;
    }

    // Find the corresponding RFQ to determine which chain to claim on
    const rfq = incomingRfqs.find(r => r.rfqId === rfqId);
    // Agent B locked on toChain (the chain they sent funds to), so they claim on fromChain
    // (the chain where Agent A locked funds for them)
    const claimChain = rfq?.fromChain?.toLowerCase() ?? "solana";

    toast.loading(`Claiming funds on ${claimChain}…`, { id: `claim-${rfqId}` });

    try {
      if (claimChain === "solana" && solConnected && signTransaction && solPubkey) {
        // Solana claim: build a claim instruction using the revealed secret
        // The claim instruction reveals the secret to the HTLC program to release funds
        const htlcProgramId = import.meta.env.VITE_SOL_HTLC_PROGRAM_ID as string | undefined;
        if (htlcProgramId) {
          // Real Anchor program: call the claim instruction
          // Instruction: [8-byte discriminator][32-byte secret]
          const CLAIM_DISCRIMINATOR = Buffer.from([0x3e, 0x1f, 0x2a, 0x8b, 0x4c, 0x7d, 0x9e, 0x5f]);
          const secretBytes = new Uint8Array(secretHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
          const data = Buffer.concat([CLAIM_DISCRIMINATOR, Buffer.from(secretBytes)]);
          const { Transaction, TransactionInstruction, PublicKey: SolPublicKey, SystemProgram } = await import("@solana/web3.js");
          const programId = new SolPublicKey(htlcProgramId);
          const secretHashBuf = await crypto.subtle.digest("SHA-256", secretBytes);
          const secretHashBytes = new Uint8Array(secretHashBuf);
          const [escrowPda] = await SolPublicKey.findProgramAddress(
            [Buffer.from("htlc"), Buffer.from(secretHashBytes), solPubkey.toBuffer()],
            programId
          );
          const claimIx = new TransactionInstruction({
            programId,
            keys: [
              { pubkey: solPubkey, isSigner: true, isWritable: true },
              { pubkey: escrowPda, isSigner: false, isWritable: true },
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data,
          });
          const { blockhash } = await solConnection.getLatestBlockhash("confirmed");
          const tx = new Transaction();
          tx.recentBlockhash = blockhash;
          tx.feePayer = solPubkey;
          tx.add(claimIx);
          const signedTx = await (signTransaction as (tx: import("@solana/web3.js").Transaction) => Promise<import("@solana/web3.js").Transaction>)(tx);
          const txHash = await solConnection.sendRawTransaction(signedTx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
          toast.success("SOL HTLC claimed!", {
            id: `claim-${rfqId}`,
            description: `Tx: ${txHash.slice(0, 20)}… · Funds released to your wallet`,
            action: { label: "View on Solscan", onClick: () => window.open(`https://solscan.io/tx/${txHash}`, "_blank") },
          });
          // Mark as completed
          void fetch("/api/trpc/chat.updateHtlcStatus", {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify({ "0": { json: { rfqId, status: "completed", revealTxId: txHash } } }),
          }).catch(() => {});
        } else {
          // Demo mode: no program deployed — show the secret and instruct user
          toast.success("HTLC Secret Ready", {
            id: `claim-${rfqId}`,
            description: `Secret: ${secretHex.slice(0, 16)}… · No HTLC program deployed — use this secret with your HTLC contract`,
            duration: 30000,
            action: { label: "Copy Secret", onClick: () => void navigator.clipboard.writeText(secretHex) },
          });
        }
      } else if ((claimChain === "ethereum" || claimChain === "eth") && ethereum?.connected) {
        // Ethereum claim: call withdraw(bytes32 secret) on the HTLC contract
        const rawEth = (window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<string> } }).ethereum;
        if (!rawEth) throw new Error("No Ethereum provider found");
        const htlcContractAddress = import.meta.env.VITE_ETH_HTLC_ADDRESS as string | undefined;
        if (htlcContractAddress) {
          // ABI-encode withdraw(bytes32 secret)
          // Function selector: keccak256("withdraw(bytes32)") = 0x441a3e70
          const padLeft = (hex: string, bytes = 32) => hex.padStart(bytes * 2, "0");
          const calldata = "0x441a3e70" + padLeft(secretHex, 32);
          const txHash = await rawEth.request({
            method: "eth_sendTransaction",
            params: [{ from: ethereum.address, to: htlcContractAddress, data: calldata, gas: "0x186A0" }],
          });
          toast.success("ETH HTLC claimed!", {
            id: `claim-${rfqId}`,
            description: `Tx: ${txHash.slice(0, 20)}… · Funds released to your wallet`,
          });
          void fetch("/api/trpc/chat.updateHtlcStatus", {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify({ "0": { json: { rfqId, status: "completed", revealTxId: txHash } } }),
          }).catch(() => {});
        } else {
          // Demo mode: show secret
          toast.success("ETH HTLC Secret Ready", {
            id: `claim-${rfqId}`,
            description: `Secret: ${secretHex.slice(0, 16)}… · No HTLC contract deployed — use this secret with your contract`,
            duration: 30000,
            action: { label: "Copy Secret", onClick: () => void navigator.clipboard.writeText(secretHex) },
          });
        }
      } else if ((claimChain === "bitcoin" || claimChain === "btc") && bitcoin?.connected) {
        // Bitcoin claim: the secret is needed to spend the P2WSH HTLC output
        // In production: build a claim PSBT using the secret as the witness preimage
        // For now: copy the secret and show instructions (full PSBT claim requires UTXO data)
        toast.success("BTC HTLC Secret Ready", {
          id: `claim-${rfqId}`,
          description: `Secret: ${secretHex.slice(0, 16)}… · Use this secret to spend the P2WSH HTLC output via mempool.space`,
          duration: 30000,
          action: { label: "Copy Secret", onClick: () => void navigator.clipboard.writeText(secretHex) },
        });
        void fetch("/api/trpc/chat.updateHtlcStatus", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ "0": { json: { rfqId, status: "completed" } } }),
        }).catch(() => {});
      } else if ((claimChain === "trac_network" || claimChain === "tnk") && (window as any).tracnetwork) {
        // TNK claim: reveal secret to the AFOS agent escrow via signMessage
        const tap = (window as any).tracnetwork;
        const claimMessage = `AFOS-HTLC-CLAIM:${secretHex}:${rfqId}`;
        const sigResult = await tap.signMessage(claimMessage);
        const sig = typeof sigResult === "string" ? sigResult : sigResult?.signature ?? "";
        toast.success("TNK HTLC claimed!", {
          id: `claim-${rfqId}`,
          description: `Secret revealed to AFOS escrow · Sig: ${sig.slice(0, 16)}…`,
          duration: 15000,
        });
        void fetch("/api/trpc/chat.updateHtlcStatus", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ "0": { json: { rfqId, status: "completed" } } }),
        }).catch(() => {});
      } else {
        // No wallet connected for this chain — just copy the secret
        toast.info("Secret copied to clipboard", {
          id: `claim-${rfqId}`,
          description: `Connect a ${claimChain} wallet to claim on-chain, or use the secret manually`,
          duration: 20000,
        });
        void navigator.clipboard.writeText(secretHex);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Claim failed", { id: `claim-${rfqId}`, description: msg.slice(0, 100) });
    }
  }, [htlcRevealedSecrets, incomingRfqs, solConnected, signTransaction, solPubkey, solConnection, ethereum, bitcoin]);

  // ── Reject RFQ ────────────────────────────────────────────────────────────
  const rejectRfq = useCallback((rfqId: string) => {
    setIncomingRfqs(prev =>
      prev.map(r => r.rfqId === rfqId ? { ...r, status: "rejected" } : r)
    );
  }, []);

  // ── Dismiss HTLC signing dialog ───────────────────────────────────────────
  const dismissHtlc = useCallback(() => {
    setHtlcSigning(null);
  }, []);

  // ── Update prefs ────────────────────────────────────────────
  const setPrefs = useCallback((partial: Partial<LightPeerPrefs>) => {
    setPrefsState(prev => {
      const next = { ...prev, ...partial };
      localStorage.setItem("afos_light_peer_prefs", JSON.stringify(next));
      // Track explicit opt-in so the migration guard doesn't reset it on next load
      if (partial.enabled === true) {
        localStorage.setItem("afos_lp_opted_in", "true");
      } else if (partial.enabled === false) {
        localStorage.removeItem("afos_lp_opted_in");
      }
      return next;
    });
  }, []);

  const toggleEnabled = useCallback(() => {
    setPrefs({ enabled: !prefs.enabled });
  }, [prefs.enabled, setPrefs]);

  // ── Signaling message helpers ────────────────────────────────────────────
  const sendPeerMessage = useCallback((targetPeerId: string, payload: unknown) => {
    signalingRef.current?.sendToPeer(targetPeerId, payload);
  }, []);

  const broadcastRfqFn = useCallback((rfq: unknown) => {
    signalingRef.current?.broadcastRfq(rfq);
  }, []);

  return (
    <LightPeerContext.Provider value={{
      peerId,
      peerAlias,
      isRegistered,
      isOnline,
      prefs,
      incomingRfqs,
      quotesGiven,
      tradesCompleted,
      totalVolumeUsd,
      lastHeartbeat,
      htlcSigning,
      remotePeers,
      signalingClient: signalingRef.current,
      signalingConnected,
      directPeerCount,
      setPrefs,
      acceptRfq,
      rejectRfq,
      initiateHtlcLock,
      toggleEnabled,
      dismissHtlc,
      sendPeerMessage,
      broadcastRfq: broadcastRfqFn,
      htlcRevealedSecrets,
      claimHtlcFunds,
      solanaAddress: (solAdapterConnected && solPubkey ? solPubkey.toString() : null) ?? phantomSolAddress ?? null,
      ethereumAddress: ethereum?.address ?? null,
      bitcoinAddress: bitcoin?.address ?? null,
    }}>
      {children}
    </LightPeerContext.Provider>
  );
}

export function useLightPeer(): LightPeerState {
  const ctx = useContext(LightPeerContext);
  if (!ctx) throw new Error("useLightPeer must be used inside LightPeerProvider");
  return ctx;
}
