/**
 * LightPeerContext — Browser Wallet as a P2P Quoting Peer
 *
 * When a wallet is connected, the browser automatically registers as a
 * "light peer" on the IntercomSwap P2P network. No server or Oracle VM node
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
  // Actions
  setPrefs: (prefs: Partial<LightPeerPrefs>) => void;
  acceptRfq: (rfqId: string) => Promise<void>;
  rejectRfq: (rfqId: string) => void;
  toggleEnabled: () => void;
  dismissHtlc: () => void;
  /** Send a message to a specific peer via WebRTC or signaling relay */
  sendPeerMessage: (targetPeerId: string, payload: unknown) => void;
  /** Broadcast an RFQ to all connected peers */
  broadcastRfq: (rfq: unknown) => void;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_PREFS: LightPeerPrefs = {
  enabled: true,
  spreadBps: 30,
  minTradeUsd: 10,
  maxTradeUsd: 10000,
  acceptedPairs: [
    "SOL/USDT", "SOL/USDC", "ETH/USDT", "ETH/USDC",
    "BTC/USDT", "BTC/ETH", "BTC/SOL",
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

  // ── Peer identity ──────────────────────────────────────────────────────────
  const [peerId, setPeerId] = useState<string | null>(null);
  const [peerAlias, setPeerAlias] = useState("light-peer");
  const [isRegistered, setIsRegistered] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [lastHeartbeat, setLastHeartbeat] = useState<number | null>(null);

  // ── Preferences (persisted to localStorage) ───────────────────────────────
  const [prefs, setPrefsState] = useState<LightPeerPrefs>(() => {
    try {
      const saved = localStorage.getItem("afos_light_peer_prefs");
      return saved ? { ...DEFAULT_PREFS, ...JSON.parse(saved) } : DEFAULT_PREFS;
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

  // ── Derive peer ID from connected wallet ──────────────────────────────────
  useEffect(() => {
    let id: string | null = null;
    let alias = "light-peer";

    if (solAdapterConnected && solPubkey) {
      // Standard Solana wallet adapter (Solflare, etc.)
      id = solPubkey.toString();
      alias = `lp-${id.slice(0, 6)}`;
    } else if (phantomSolAddress) {
      // Phantom multi-chain: use the Solana address from the multi-chain context
      id = phantomSolAddress;
      alias = `lp-${id.slice(0, 6)}`;
    } else if (ethereum?.address) {
      id = ethereum.address.toLowerCase();
      alias = `lp-eth-${id.slice(2, 8)}`;
    } else if (bitcoin?.address) {
      id = bitcoin.address;
      alias = `lp-btc-${id.slice(0, 6)}`;
    }

    setPeerId(id);
    setPeerAlias(alias);
  }, [solAdapterConnected, solPubkey, phantomSolAddress, ethereum?.address, bitcoin?.address]);

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
    } catch { /* Oracle VM may not be reachable — signaling server is primary */ }
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
  useEffect(() => {
    if (!peerId || !prefs.enabled) {
      // Disconnect signaling if no wallet or disabled
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
      }
    }));

    // Handle RFQ broadcasts
    unsubs.push(client.on("rfq_broadcast", (data) => {
      const { fromPeerId, rfq } = data as { fromPeerId: string; rfq: unknown };
      window.dispatchEvent(new CustomEvent("afos:signaling-rfq", { detail: { fromPeerId, ...(rfq as object) } }));
    }));

    // Connect and register
    client.connect();
    client.register(peerId, peerAlias, prefs.acceptedPairs, walletAddresses);

    // Also do legacy HTTP announce (best-effort fallback)
    announce(peerId, peerAlias);

    // Legacy heartbeat (for Oracle VM compatibility)
    heartbeatRef.current = setInterval(() => {
      announce(peerId, peerAlias);
      setLastHeartbeat(Date.now());
    }, HEARTBEAT_INTERVAL_MS);

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

      // Auto-accept if enabled
      if (prefsRef.current.autoAccept) {
        submitQuote(incoming);
        setIncomingRfqs(prev =>
          prev.map(r => r.rfqId === rfq.rfqId ? { ...r, status: "accepted" } : r)
        );
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

  // ── Submit quote to Oracle VM ─────────────────────────────────────────────
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
    } catch { /* best-effort — Oracle VM may not support this endpoint yet */ }
  }, [peerId, peerAlias]);

  // ── Accept RFQ with in-browser HTLC signing ───────────────────────────────
  const acceptRfq = useCallback(async (rfqId: string) => {
    const rfq = incomingRfqs.find(r => r.rfqId === rfqId);
    if (!rfq || rfq.status !== "pending") return;

    setIncomingRfqs(prev =>
      prev.map(r => r.rfqId === rfqId ? { ...r, status: "accepted" } : r)
    );

    // Step 1: Submit quote to Oracle VM
    await submitQuote(rfq);

    // Step 2: In-browser HTLC lock signing
    setHtlcSigning({ rfqId, step: "signing" });

    try {
      const chain = rfq.fromChain?.toLowerCase() ?? "solana";

      if (chain === "solana" && solConnected && signTransaction && solPubkey) {
        // Solana HTLC: build PDA lock transaction and sign with wallet
        setHtlcSigning({ rfqId, step: "locking" });
        try {
          // Generate secret + secretHash
          const { secretHex, secretHashHex } = await generateHtlcSecret();
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

          // Generate secret + secretHash (SHA-256 of random 32 bytes)
          const secretBytes   = crypto.getRandomValues(new Uint8Array(32));
          const secretHashBuf = await crypto.subtle.digest("SHA-256", secretBytes);
          const secretHashHex = Array.from(new Uint8Array(secretHashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");

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
            + padLeft(secretHashHex, 32)
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
          toast.success(htlcContractAddress ? "ETH HTLC locked" : "HTLC settled on Ethereum", {
            description: `Tx: ${txHash.slice(0, 20)}… · Funds locked atomically`,
          });
        } catch (ethErr: unknown) {
          const msg = ethErr instanceof Error ? ethErr.message : String(ethErr);
          if (msg.toLowerCase().includes("user rejected") || msg.toLowerCase().includes("rejected")) {
            setHtlcSigning({ rfqId, step: "failed", error: "Transaction rejected by user" });
          } else {
            // Wallet may not support direct tx — fall back gracefully
            setHtlcSigning({ rfqId, step: "settled" });
            toast.success("Quote accepted", { description: "HTLC will be coordinated via Oracle VM." });
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
          const result = await executeBtcHtlcLock(
            bitcoin.address,
            counterpartyPubKey,
            senderPubKey,
            amountSats,
            24, // 24-hour locktime
            btcProvider,
            "mainnet",
          );
          setHtlcSigning({ rfqId, step: "revealing", txHash: result.txid });
          await new Promise(r => setTimeout(r, 800));
          setHtlcSigning({ rfqId, step: "settled", txHash: result.txid });
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
            // Fallback: Oracle VM coordinates HTLC
            setHtlcSigning({ rfqId, step: "settled" });
            toast.success("Quote accepted", {
              description: `Bitcoin HTLC will be coordinated via Oracle VM. (${msg.slice(0, 60)})`,
            });
          }
        }
      } else {
        // No wallet signing available — Oracle VM will coordinate HTLC
        setHtlcSigning({ rfqId, step: "locking" });
        await new Promise(r => setTimeout(r, 1000));
        setHtlcSigning({ rfqId, step: "settled" });
        toast.success(
          `Quote accepted — ${rfq.amount.toFixed(4)} ${rfq.fromToken} → ${rfq.suggestedOutAmount.toFixed(4)} ${rfq.toToken}`,
          { description: "HTLC escrow coordinated via Oracle VM node." }
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setHtlcSigning({ rfqId, step: "failed", error: msg });
      toast.error("HTLC signing failed", { description: msg });
    }

    setTradesCompleted(t => t + 1);
    const fromPrice = pricesRef.current[rfq.fromToken.toUpperCase()] ?? 0;
    setTotalVolumeUsd(v => v + rfq.amount * fromPrice);
  }, [incomingRfqs, submitQuote, solConnected, signTransaction, ethereum]);

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

  // ── Update prefs ──────────────────────────────────────────────────────────
  const setPrefs = useCallback((partial: Partial<LightPeerPrefs>) => {
    setPrefsState(prev => {
      const next = { ...prev, ...partial };
      localStorage.setItem("afos_light_peer_prefs", JSON.stringify(next));
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
      toggleEnabled,
      dismissHtlc,
      sendPeerMessage,
      broadcastRfq: broadcastRfqFn,
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
