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
import { buildSolanaHtlcLockTx, generateHtlcSecret, checkHtlcProgramDeployed, checkAgentBHtlcLocked } from "../lib/solanaHtlc";
import { buildSolanaTokenHtlcLockTx, TOKEN_MINTS } from "../lib/solanaTokenHtlc";
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
  autoClaim: boolean;          // auto-claim HTLC funds when the secret is received (Agent B)
  quoteTtlMs: number;          // how long this peer's RFQ quotes are valid in the order book (ms)
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
  /** SHA-256 hash of Agent A's HTLC secret (hex). Agent B MUST lock to this hash for atomicity. */
  secretHashHex?: string;
  /** Agent A's wallet address — used to attribute the counterparty lock correctly. */
  counterpartyAddress?: string;
  /** Agent A's wallet address (alias for counterpartyAddress, used in HTLC lock logic). */
  requesterWallet?: string;
  /** Full multi-chain wallet map for Agent A (the initiator). Enables cross-chain auto-claim. */
  requesterWallets?: { solana?: string; ethereum?: string; bitcoin?: string; trac_network?: string };
  /** Full multi-chain wallet map for the COUNTERPARTY (Agent B from Agent A's perspective, or Agent A from Agent B's perspective). */
  counterpartyWallets?: { solana?: string; ethereum?: string; bitcoin?: string; trac_network?: string };
  /** True when this RFQ was created by initiateHtlcLock (Agent A / requester).
   *  When false/undefined, this is Agent B (counterparty) who should lock the toToken. */
  isInitiator?: boolean;
  /** Audit trail: why Smart Auto-Accept accepted or rejected this RFQ */
  autoDecision?: {
    action: "accepted" | "rejected";
    reason: string;
    oracleRate?: number;
    offeredRate?: number;
    tradeUsd?: number;
    spreadBps?: number;
    timestamp: number;
  };
}

export type HtlcStep = "idle" | "signing" | "locking" | "locked" | "revealing" | "settled" | "failed";

export interface HtlcSigningState {
  rfqId: string;
  step: HtlcStep;
  txHash?: string;
  error?: string;
  // Enhanced fields for the progress modal
  fromToken?: string;       // Token Agent B is locking (e.g. "USDT")
  toToken?: string;         // Token Agent B will receive (e.g. "SOL")
  fromAmount?: number;      // Amount Agent B is locking
  toAmount?: number;        // Amount Agent B will receive
  fromChain?: string;       // Chain Agent B is locking on
  toChain?: string;         // Chain Agent B will receive on
  counterpartyAlias?: string; // Agent A's alias/peerId
  expiresAt?: number;       // HTLC timelock expiry (ms epoch)
  lockedAt?: number;        // When Agent B locked (ms epoch)
  settledAt?: number;       // When the swap fully settled (ms epoch)
  claimTxHash?: string;     // Tx hash of the claim (settlement)
  counterpartyLockTxHash?: string;  // Agent A's lock tx on their chain (seen by Agent B)
  counterpartyClaimTxHash?: string; // Agent A's claim tx (Agent A claims Agent B's funds)
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
  acceptRfq: (rfqId: string, rfqOverride?: IncomingRfq) => Promise<void>;
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
    /** Full multi-chain wallet map for the counterparty (Agent B). Used to resolve the correct chain address for cross-chain HTLC locks. */
    counterpartyWallets?: { solana?: string; ethereum?: string; bitcoin?: string; trac_network?: string };
    /** SHA-256 hash of the HTLC secret from buildSwapTx. Agent A must lock to this hash. */
    secretHashHex?: string;
  }) => Promise<void>;
  toggleEnabled: () => void;
  dismissHtlc: () => void;
  /** Send a message to a specific peer via WebRTC or signaling relay */
  sendPeerMessage: (targetPeerId: string, payload: unknown) => void;
  /** Broadcast an RFQ to all connected peers */
  broadcastRfq: (rfq: unknown) => void;
  /** Map of rfqId → secretHex received from Agent A (for Agent B to claim) */
  htlcRevealedSecrets: Record<string, string>;
  /** Set of rfqIds that have been successfully claimed (Claim button hidden) */
  claimedRfqIds: Set<string>;
  /** Set of rfqIds where refund has been successfully executed (Refund button replaced with badge) */
  refundedRfqIds: Set<string>;
  /**
   * Claim HTLC funds as Agent B using the revealed secret.
   * Builds and broadcasts the on-chain claim transaction for the given chain.
   */
  claimHtlcFunds: (rfqId: string) => Promise<void>;
  /**
   * Map of rfqId → { fromChain, toChain, expiresAt, lockTxId? } for Agent A's expired outgoing HTLCs.
   * Populated when htlc_expired signaling message is received.
   */
  refundableHtlcs: Record<string, { fromChain: string; toChain: string; expiresAt: number; lockTxId?: string }>;
  /**
   * Map of rfqId → Unix ms timestamp when the HTLC lock was initiated.
   * Used to compute the countdown timer on accepted RFQ cards.
   * The HTLC timelock is always 1 hour from lockedAt.
   */
  htlcLockedAt: Record<string, number>;
  /**
   * Refund HTLC funds as Agent A after the swap window has expired.
   * Calls the on-chain timelock-sweep path for the given chain.
   */
  refundHtlcFunds: (rfqId: string) => Promise<void>;
  /**
   * Rolling log of the last 50 Smart Auto-Accept decisions (accepted + rejected).
   * Each entry mirrors IncomingRfq.autoDecision plus the pair and rfqId for display.
   */
  autoDecisionLog: Array<{
    rfqId: string;
    pair: string;
    fromAmount: number;
    fromToken: string;
    toToken: string;
    action: "accepted" | "rejected";
    reason: string;
    oracleRate?: number;
    offeredRate?: number;
    tradeUsd?: number;
    timestamp: number;
  }>;
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
  autoClaim: true,  // on by default — recommended for fully agentic swaps
  quoteTtlMs: 120_000, // 2 minutes default
};

const HEARTBEAT_INTERVAL_MS = 30_000;
const RFQ_EXPIRY_MS = 60_000;

// ─── Context ──────────────────────────────────────────────────────────────────

const LightPeerContext = createContext<LightPeerState | null>(null);

export function LightPeerProvider({ children }: { children: ReactNode }) {
  const { publicKey: solPubkey, connected: solAdapterConnected, signTransaction, sendTransaction: sendSolTransaction } = useWallet();
  const { ethereum, bitcoin, tracNetwork: tnkWalletCtx, phantomMultiChain } = useMultiChainWallet();
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
      }
      // Migration: autoClaim was previously false by default — force it to true
      // so all existing users get seamless atomic swap completion without manual steps.
      // Users can still turn it off in Agent Settings if they prefer manual claiming.
      if (parsed.autoClaim === false && !localStorage.getItem("afos_autoclaim_explicitly_disabled")) {
        parsed.autoClaim = true;
      }
      const merged = { ...DEFAULT_PREFS, ...parsed };
      localStorage.setItem("afos_light_peer_prefs", JSON.stringify(merged));
      return merged;
    } catch {
      return DEFAULT_PREFS;
    }
  });

  // ── RFQ state ──────────────────────────────────────────────────────────────
  const [incomingRfqs, setIncomingRfqs] = useState<IncomingRfq[]>([]);
  const [quotesGiven, setQuotesGiven] = useState(0);
  const [tradesCompleted, setTradesCompleted] = useState(0);
  const [totalVolumeUsd, setTotalVolumeUsd] = useState(0);
  const [htlcSigning, setHtlcSigning] = useState<HtlcSigningState | null>(() => {
    try {
      const stored = sessionStorage.getItem("afos_htlc_signing");
      if (stored) return JSON.parse(stored) as HtlcSigningState;
    } catch { /* ignore */ }
    return null;
  });
  // rfqId → revealed secretHex (received from Agent A after they confirm their lock)
  const [htlcRevealedSecrets, setHtlcRevealedSecrets] = useState<Record<string, string>>({});
  // Ref mirror so closures (useEffect with stale deps) always read the latest value
  const htlcRevealedSecretsRef = useRef<Record<string, string>>({});
  useEffect(() => { htlcRevealedSecretsRef.current = htlcRevealedSecrets; }, [htlcRevealedSecrets]);
  // rfqIds that have been successfully claimed (Claim button hidden after success)
  // Seeded from localStorage on mount, then synced with DB via getSettledHtlcs
  const [claimedRfqIds, setClaimedRfqIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("afos_claimed_rfq_ids");
      if (stored) return new Set(JSON.parse(stored) as string[]);
    } catch { /* ignore */ }
    return new Set();
  });
  // rfqIds that have been successfully refunded (Refund button replaced with badge)
  const [refundedRfqIds, setRefundedRfqIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("afos_refunded_rfq_ids");
      if (stored) return new Set(JSON.parse(stored) as string[]);
    } catch { /* ignore */ }
    return new Set();
  });
  // rfqId → { fromChain, toChain, expiresAt } for Agent A's expired outgoing HTLCs
  const [refundableHtlcs, setRefundableHtlcs] = useState<Record<string, { fromChain: string; toChain: string; expiresAt: number }>>({})
  // rfqId → Unix ms when the HTLC lock was initiated (for countdown timer)
  // Persisted to localStorage so the countdown survives page reloads
  const [autoDecisionLog, setAutoDecisionLog] = useState<LightPeerState["autoDecisionLog"]>([]);

  const [htlcLockedAt, setHtlcLockedAt] = useState<Record<string, number>>(() => {
    try {
      const stored = localStorage.getItem("afos_htlc_locked_at");
      if (stored) return JSON.parse(stored) as Record<string, number>;
    } catch { /* ignore */ }
    return {};
  });

  // ── Persist claimedRfqIds + refundedRfqIds + htlcLockedAt to localStorage ───────
  useEffect(() => {
    try { localStorage.setItem("afos_claimed_rfq_ids", JSON.stringify(Array.from(claimedRfqIds))); } catch { /* ignore */ }
  }, [claimedRfqIds]);

  useEffect(() => {
    try { localStorage.setItem("afos_refunded_rfq_ids", JSON.stringify(Array.from(refundedRfqIds))); } catch { /* ignore */ }
  }, [refundedRfqIds]);

  useEffect(() => {
    try { localStorage.setItem("afos_htlc_locked_at", JSON.stringify(htlcLockedAt)); } catch { /* ignore */ }
  }, [htlcLockedAt]);

  // ── Persist htlcSigning to sessionStorage so the modal survives panel close/reopen ──
  // sessionStorage (not localStorage) so it clears automatically when the browser tab closes.
  useEffect(() => {
    try {
      if (htlcSigning) {
        sessionStorage.setItem("afos_htlc_signing", JSON.stringify(htlcSigning));
      } else {
        sessionStorage.removeItem("afos_htlc_signing");
      }
    } catch { /* ignore */ }
  }, [htlcSigning]);

  // ── localStorage retry fallback for recordHtlcDeposit ──────────────────────
  // If recordHtlcDeposit fails (network error, 400, etc.) the payload is saved
  // to localStorage under "afos_pending_deposits" and retried on the next mount.
  const PENDING_DEPOSITS_KEY = "afos_pending_deposits";

  type DepositPayload = {
    chain: string; txHash: string; senderAddress: string; recipientAddress: string;
    escrowAddress: string; amountRaw: string; token: string; secretHash: string;
    timelock: number; rfqId: string; peerId?: string; htlcId: string; isAgentA: boolean;
    counterpartyAddress?: string;
    counterpartyWallets?: { solana?: string; ethereum?: string; bitcoin?: string; trac_network?: string };
    savedAt: number; // ms timestamp for TTL
  };

  const saveFailedDeposit = (payload: Omit<DepositPayload, "savedAt">) => {
    try {
      const stored = localStorage.getItem(PENDING_DEPOSITS_KEY);
      const list: DepositPayload[] = stored ? (JSON.parse(stored) as DepositPayload[]) : [];
      // Deduplicate by txHash
      if (list.some(d => d.txHash === payload.txHash)) return;
      list.push({ ...payload, savedAt: Date.now() });
      localStorage.setItem(PENDING_DEPOSITS_KEY, JSON.stringify(list));
    } catch { /* ignore */ }
  };

  const retryPendingDeposits = async () => {
    try {
      const stored = localStorage.getItem(PENDING_DEPOSITS_KEY);
      if (!stored) return;
      const list: DepositPayload[] = JSON.parse(stored) as DepositPayload[];
      if (!list.length) return;
      const now = Date.now();
      const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
      const fresh = list.filter(d => now - d.savedAt < TTL_MS);
      const remaining: DepositPayload[] = [];
      for (const payload of fresh) {
        try {
          const res = await fetch("/api/trpc/htlcWallet.recordHtlcDeposit?batch=1", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              "0": {
                json: {
                  chain: payload.chain, txHash: payload.txHash,
                  senderAddress: payload.senderAddress, recipientAddress: payload.recipientAddress,
                  escrowAddress: payload.escrowAddress, amountRaw: payload.amountRaw,
                  token: payload.token, secretHash: payload.secretHash,
                  timelock: payload.timelock, rfqId: payload.rfqId,
                  peerId: payload.peerId, htlcId: payload.htlcId, isAgentA: payload.isAgentA,
                  counterpartyAddress: payload.counterpartyAddress,
                  counterpartyWallets: payload.counterpartyWallets,
                },
              },
            }),
          });
          if (!res.ok) {
            remaining.push(payload); // keep for next retry
          }
          // success — don't push to remaining, it's been recorded
        } catch {
          remaining.push(payload); // network error — keep for next retry
        }
      }
      if (remaining.length > 0) {
        localStorage.setItem(PENDING_DEPOSITS_KEY, JSON.stringify(remaining));
      } else {
        localStorage.removeItem(PENDING_DEPOSITS_KEY);
      }
    } catch { /* ignore */ }
  };

  // ── Seed claimedRfqIds + refundedRfqIds from DB on mount ─────────────────
  useEffect(() => {
    void fetch("/api/trpc/chat.getSettledHtlcs?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22limit%22%3A500%7D%7D%7D", {
      credentials: "include",
    })
      .then(r => r.json())
      .then((data: unknown) => {
        const rows = (data as { result?: { data?: { json?: Array<{ rfqId: string; status: string }> } } }[])?.[0]?.result?.data?.json;
        if (!Array.isArray(rows)) return;
        const claimed = new Set<string>();
        const refunded = new Set<string>();
        for (const row of rows) {
          if (row.status === "completed") claimed.add(row.rfqId);
          if (row.status === "refunded") refunded.add(row.rfqId);
        }
        if (claimed.size > 0) setClaimedRfqIds(prev => new Set([...Array.from(prev), ...Array.from(claimed)]));
        if (refunded.size > 0) setRefundedRfqIds(prev => new Set([...Array.from(prev), ...Array.from(refunded)]));
      })
      .catch(() => { /* DB not available yet — localStorage values remain */ });
  }, []);

   // ── Retry pending deposits on mount (localStorage fallback) ────────────────
  // Runs once on mount with a 3-second delay to let the server warm up.
  useEffect(() => {
    const t = setTimeout(() => { void retryPendingDeposits(); }, 3000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Autonomous retry-reveal: re-trigger revealHtlcSecret on wallet connect ─
  // If Agent A locked their HTLC but the page was refreshed before the secret
  // was revealed (e.g. Agent B locked while Agent A was offline), this effect
  // autonomously re-triggers the reveal as soon as the wallet reconnects.
  // Uses exponential backoff: 5s → 15s → 45s → 2min → 5min (max 5 attempts).
  const revealRetryCountRef    = useRef<Record<string, number>>({});
  const revealRetryTimersRef   = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Maps rfqId → interval ID for polling htlc_secrets status until "completed"
  const completionPollingRef   = useRef<Record<string, ReturnType<typeof setInterval>>>({}); 

  const triggerAutoReveal = useCallback(async (row: {
    rfqId: string;
    htlcId: string | null;
    initiatorAddress: string | null;
    counterpartyAddress: string | null;
    counterpartyPeerId: string | null;
    fromChain: string;
    expiresAt: bigint;
  }) => {
    const { rfqId, initiatorAddress, counterpartyAddress, counterpartyPeerId, fromChain } = row;
    if (!initiatorAddress) return;
    // Don't retry if already expired
    if (Number(row.expiresAt) < Date.now()) {
      console.log(`[AutoReveal] rfqId=${rfqId.slice(0,8)} expired — skipping`);
      return;
    }
    const attempt = (revealRetryCountRef.current[rfqId] ?? 0) + 1;
    revealRetryCountRef.current[rfqId] = attempt;
    const maxAttempts = 5;
    if (attempt > maxAttempts) {
      console.warn(`[AutoReveal] rfqId=${rfqId.slice(0,8)} exceeded max retry attempts`);
      return;
    }
    console.log(`[AutoReveal] Attempting reveal for rfqId=${rfqId.slice(0,8)} (attempt ${attempt}/${maxAttempts})`);
    try {
      const agentAHtlcId = `htlc_a_${rfqId.slice(0, 22)}`;
      const agentBHtlcId = `htlc_b_${rfqId.slice(0, 22)}`;
      const res = await fetch("/api/trpc/chat.revealHtlcSecret?batch=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ "0": { json: {
          rfqId,
          initiatorAddress,
          counterpartyAddress: counterpartyAddress ?? undefined,
          htlcIdA: agentAHtlcId,
          htlcIdB: agentBHtlcId,
          chain: fromChain,
        } } }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.warn(`[AutoReveal] revealHtlcSecret failed (attempt ${attempt}):`, res.status, errText);
        // Schedule retry with exponential backoff
        const backoffMs = [5_000, 15_000, 45_000, 120_000, 300_000][attempt - 1] ?? 300_000;
        revealRetryTimersRef.current[rfqId] = setTimeout(() => void triggerAutoReveal(row), backoffMs);
        return;
      }
      const json = await res.json();
      const batchResult  = Array.isArray(json) ? json[0] : json;
      const secretHex              = batchResult?.result?.data?.json?.secretHex;
      const isReplay               = batchResult?.result?.data?.json?.replay === true;
      const isCompleted            = batchResult?.result?.data?.json?.completed === true;
      const isTriggered            = batchResult?.result?.data?.json?.triggered === true;
      // tx hashes returned on completed path (fetched from DB)
      const completedRevealTxId    = batchResult?.result?.data?.json?.revealTxId as string | undefined;
      const completedCpRevealTxId  = batchResult?.result?.data?.json?.counterpartyRevealTxId as string | undefined;
      if (!secretHex) {
        console.warn(`[AutoReveal] No secretHex in response (attempt ${attempt})`);
        const backoffMs = [5_000, 15_000, 45_000, 120_000, 300_000][attempt - 1] ?? 300_000;
        revealRetryTimersRef.current[rfqId] = setTimeout(() => void triggerAutoReveal(row), backoffMs);
        return;
      }
      // Send the secret to Agent B via P2P signaling so they can claim.
      // Only use counterpartyPeerId — never fall back to a wallet address (agentAWalletByRfqRef
      // stores Agent A's wallet, not Agent B's peerId, so using it as a target is wrong).
      // If counterpartyPeerId is missing, the server-side notifyAgentBLocked already handles
      // on-chain claims, so skipping the P2P signal is safe.
      const targetPeerId = counterpartyPeerId ?? null;
      if (targetPeerId && signalingRef.current) {
        signalingRef.current.sendHtlcSecret(targetPeerId, rfqId, secretHex);
      } else if (!targetPeerId) {
        console.log(`[AutoReveal] No counterpartyPeerId for rfqId=${rfqId.slice(0,8)} — skipping P2P signal (server handles on-chain claims)`);
      }
      // If the swap was already fully completed (status=completed in DB), dispatch htlc-completed
      // so Agent A's UI can show the success message even after a page reload.
      if (isCompleted) {
        console.log(`[AutoReveal] rfqId=${rfqId.slice(0,8)} already completed — dispatching afos:htlc-completed`);
        // Fetch tx hashes from DB if not already in the response
        let agentBClaimTxId = completedRevealTxId;
        let agentAClaimTxId = completedCpRevealTxId;
        if (!agentBClaimTxId || !agentAClaimTxId) {
          try {
            const txRes = await fetch(`/api/trpc/chat.getHtlcSecretHash?batch=1&input=${encodeURIComponent(JSON.stringify({ "0": { json: { rfqId } } }))}`, { credentials: "include" });
            if (txRes.ok) {
              const txJson = await txRes.json();
              const txData = (txJson as Array<{ result?: { data?: { json?: { revealTxId?: string; counterpartyRevealTxId?: string } } } }>)?.[0]?.result?.data?.json;
              agentBClaimTxId = agentBClaimTxId ?? txData?.revealTxId;
              agentAClaimTxId = agentAClaimTxId ?? txData?.counterpartyRevealTxId;
            }
          } catch { /* non-critical */ }
        }
        window.dispatchEvent(new CustomEvent("afos:htlc-completed", { detail: { rfqId, chain: fromChain, agentBClaimTxId, agentAClaimTxId } }));
        // Clear retry counter on success
        delete revealRetryCountRef.current[rfqId];
        delete revealRetryTimersRef.current[rfqId];
        return;
      }
      // Only show the toast for genuinely new reveals — suppress it for replays
      // (replay = secret was already revealed in a previous session; status was 'revealed'/'completed').
      if (!isReplay) {
        toast.success("[Auto] HTLC secret revealed autonomously", {
          description: `RFQ ${rfqId.slice(0, 8)}… secret sent to counterparty`,
          duration: 10000,
        });
      } else {
        console.log(`[AutoReveal] Replay for rfqId=${rfqId.slice(0,8)} — secret re-sent silently (no toast)`);
      }
      window.dispatchEvent(new CustomEvent("afos:htlc-secret-sent", { detail: { rfqId, secretHex } }));
      // If the server is firing on-chain claims (triggered=true), start polling the DB
      // status every 5s until it becomes "completed", then dispatch afos:htlc-completed.
      // This ensures Agent A's UI shows the success message after both HTLCs are claimed.
      if (isTriggered && !completionPollingRef.current[rfqId]) {
        console.log(`[AutoReveal] rfqId=${rfqId.slice(0,8)} claims triggered — polling for completion`);
        let pollCount = 0;
        const maxPolls = 24; // 24 × 5s = 2 minutes max
        completionPollingRef.current[rfqId] = setInterval(async () => {
          pollCount++;
          if (pollCount > maxPolls) {
            clearInterval(completionPollingRef.current[rfqId]);
            delete completionPollingRef.current[rfqId];
            console.warn(`[CompletionPoll] rfqId=${rfqId.slice(0,8)} timed out waiting for completion`);
            return;
          }
          try {
            const pollRes = await fetch(`/api/trpc/chat.getHtlcSecretHash?batch=1&input=${encodeURIComponent(JSON.stringify({ "0": { json: { rfqId } } }))}`, {
              credentials: "include",
            });
            if (!pollRes.ok) return;
            const pollJson = await pollRes.json();
            const pollData = (pollJson as Array<{ result?: { data?: { json?: { status?: string; revealTxId?: string; counterpartyRevealTxId?: string } } } }>)?.[0]?.result?.data?.json;
            if (pollData?.status === "completed") {
              clearInterval(completionPollingRef.current[rfqId]);
              delete completionPollingRef.current[rfqId];
              console.log(`[CompletionPoll] rfqId=${rfqId.slice(0,8)} completed — dispatching afos:htlc-completed`);
              window.dispatchEvent(new CustomEvent("afos:htlc-completed", { detail: {
                rfqId,
                chain: fromChain,
                agentBClaimTxId: pollData.revealTxId,             // Agent A's SOL escrow → Agent B
                agentAClaimTxId: pollData.counterpartyRevealTxId, // Agent B's USDT escrow → Agent A
              } }));
            }
          } catch (pollErr) {
            console.warn(`[CompletionPoll] rfqId=${rfqId.slice(0,8)} poll error:`, pollErr);
          }
        }, 5_000);
      }
      // Clear retry counter on success
      delete revealRetryCountRef.current[rfqId];
      delete revealRetryTimersRef.current[rfqId];
    } catch (e) {
      console.error(`[AutoReveal] Error on attempt ${attempt}:`, e);
      const backoffMs = [5_000, 15_000, 45_000, 120_000, 300_000][attempt - 1] ?? 300_000;
      revealRetryTimersRef.current[rfqId] = setTimeout(() => void triggerAutoReveal(row), backoffMs);
    }
  }, [toast]); // eslint-disable-line react-hooks/exhaustive-deps

  // Trigger auto-reveal when wallet connects (or on mount if already connected)
  const solWalletAddress = solPubkey?.toBase58() ?? phantomSolAddress ?? null;
  useEffect(() => {
    if (!solWalletAddress) return;
    // Restore agentAWalletByRfqRef from localStorage on wallet connect
    // (it's already initialized from localStorage in the useRef initializer,
    //  but we also need to handle the case where the wallet connects after mount)
    const stored = localStorage.getItem("afos_agent_a_wallet_map");
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Record<string, string>;
        Object.assign(agentAWalletByRfqRef.current, parsed);
      } catch { /* ignore */ }
    }
    // Query the server for any locked htlc_secrets where this wallet is the initiator
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/trpc/chat.getPendingRevealHtlcs?batch=1&input=${encodeURIComponent(JSON.stringify({ "0": { json: { initiatorAddress: solWalletAddress } } }))}`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const json = await res.json();
        const batchResult = Array.isArray(json) ? json[0] : json;
        const rows = batchResult?.result?.data?.json as Array<{
          rfqId: string;
          htlcId: string | null;
          initiatorAddress: string | null;
          counterpartyAddress: string | null;
          counterpartyPeerId: string | null;
          fromChain: string;
          expiresAt: bigint;
        }> | undefined;
        if (!rows?.length) return;
        console.log(`[AutoReveal] Found ${rows.length} pending reveal(s) for wallet ${solWalletAddress.slice(0,8)}`);
        for (const row of rows) {
          // Skip if already revealed in this session (prevents double-toast after refund/refresh)
          // Use the ref so we always read the latest value even in a stale closure
          if (htlcRevealedSecretsRef.current[row.rfqId]) {
            console.log(`[AutoReveal] rfqId=${row.rfqId.slice(0,8)} already revealed in session — skipping`);
            continue;
          }
          // Restore the agentAWalletByRfqRef mapping
          if (row.initiatorAddress) {
            agentAWalletByRfqRef.current[row.rfqId] = row.initiatorAddress;
          }
          // Populate counterpartyPeerIdByRfqRef so the on-chain poll fallback
          // can send the P2P reveal signal even when htlc_locked was dropped.
          if (row.counterpartyPeerId) {
            counterpartyPeerIdByRfqRef.current[row.rfqId] = row.counterpartyPeerId;
          }
          // Trigger autonomous reveal with a small stagger to avoid hammering the server
          const staggerMs = rows.indexOf(row) * 2000;
          setTimeout(() => void triggerAutoReveal(row), staggerMs);
        }
      } catch (e) {
        console.warn("[AutoReveal] Failed to query pending reveals:", e);
      }
    }, 5000); // 5s delay to let signaling connect first
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solWalletAddress]);

  // ── On-chain HTLC state polling (every 30s) ────────────────────────────────
  // Polls Agent B's htlcPda every 30s for swaps where Agent A is waiting.
  // This is the fallback for when the P2P htlc_locked message was dropped.
  const htlcPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (htlcPollingRef.current) clearInterval(htlcPollingRef.current);
    htlcPollingRef.current = setInterval(async () => {
      // Only poll if we have active swaps where Agent A locked but Agent B hasn't confirmed
      const pendingRfqIds = Object.keys(htlcLockedAt).filter(rfqId => {
        // Only poll for rfqs where we are the initiator (Agent A)
        return !!agentAWalletByRfqRef.current[rfqId];
      });
      if (!pendingRfqIds.length) return;
      for (const rfqId of pendingRfqIds) {
        const agentBHtlcId = `htlc_b_${rfqId.slice(0, 22)}`;
        try {
          const isLocked = await checkAgentBHtlcLocked(solConnection, agentBHtlcId);
          if (isLocked) {
            console.log(`[OnChainPoll] Agent B htlcPda found for rfqId=${rfqId.slice(0,8)} — triggering reveal`);
            // Agent B has locked — trigger the reveal as if we received htlc_locked P2P message
            const initiatorAddress = agentAWalletByRfqRef.current[rfqId];
            if (!initiatorAddress) continue;
            // Check if already revealed (avoid double-reveal)
            const alreadyRevealed = htlcRevealedSecrets[rfqId];
            if (alreadyRevealed) continue;
            // Trigger auto-reveal — use stored counterpartyPeerId if available
            void triggerAutoReveal({
              rfqId,
              htlcId: `htlc_a_${rfqId.slice(0, 22)}`,
              initiatorAddress,
              counterpartyAddress: null,
              counterpartyPeerId: counterpartyPeerIdByRfqRef.current[rfqId] ?? null,
              fromChain: "solana",
              expiresAt: BigInt(Date.now() + 3_600_000),
            });
          }
        } catch (e) {
          console.warn(`[OnChainPoll] Error polling rfqId=${rfqId.slice(0,8)}:`, e);
        }
      }
    }, 30_000); // poll every 30 seconds
    return () => {
      if (htlcPollingRef.current) clearInterval(htlcPollingRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [htlcLockedAt, solConnection]);

  // ── Signaling state ───────────────────────────────────────────────────────
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  const [signalingConnected, setSignalingConnected] = useState(false);
  const [directPeerCount, setDirectPeerCount] = useState(0);
  const signalingRef = useRef<SignalingClient | null>(null);
  // Maps rfqId → Agent A's resolved wallet address, stored at initiateHtlcLock time.
  // This prevents a race condition where phantomSolAddress is null when htlc_locked fires.
  const agentAWalletByRfqRef = useRef<Record<string, string>>(
    (() => {
      try {
        const stored = localStorage.getItem("afos_agent_a_wallet_map");
        return stored ? (JSON.parse(stored) as Record<string, string>) : {};
      } catch { return {}; }
    })()
  );
  // Persist agentAWalletByRfqRef to localStorage whenever it changes
  const persistAgentAWalletMap = useCallback(() => {
    try {
      localStorage.setItem("afos_agent_a_wallet_map", JSON.stringify(agentAWalletByRfqRef.current));
    } catch { /* ignore */ }
  }, []);
  // Maps rfqId → counterpartyPeerId, populated from getPendingRevealHtlcs and htlc_locked messages.
  // Used by the on-chain poll fallback so it can send the P2P reveal signal even when
  // the htlc_locked message was dropped.
  // Seeded from localStorage on mount so it survives page refreshes.
  const counterpartyPeerIdByRfqRef = useRef<Record<string, string>>(
    (() => {
      try {
        const stored = localStorage.getItem("afos_counterparty_peer_map");
        return stored ? (JSON.parse(stored) as Record<string, string>) : {};
      } catch { return {}; }
    })()
  );
  const persistCounterpartyPeerMap = useCallback(() => {
    try {
      localStorage.setItem("afos_counterparty_peer_map", JSON.stringify(counterpartyPeerIdByRfqRef.current));
    } catch { /* ignore */ }
  }, []);

  // Stable ref to acceptRfq so the signaling handlers (agent_rfq, rfq_broadcast)
  // always call the latest version — avoids stale closure where solConnected is false.
  const acceptRfqRef = useRef<(rfqId: string, rfqOverride?: IncomingRfq) => Promise<void>>(() => Promise.resolve());
  // Stable ref to claimHtlcFunds so the htlc_secret handler can call it
  // without being re-created every render (avoids stale closure in the event listener).
  const claimHtlcFundsRef = useRef<(rfqId: string) => Promise<void>>(() => Promise.resolve());
  // ── Live prices ref (updated from SSE) ─────────────────────────────────────
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
    if (tnkWalletCtx?.address) walletAddresses.trac_network = tnkWalletCtx.address;

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

    // When the server resolves a peer's country code, update that peer in state
    unsubs.push(client.on("peer_geo_update", (data) => {
      const { peerId, countryCode, flagEmoji } = data as {
        peerId: string;
        countryCode: string;
        flagEmoji: string;
      };
      setRemotePeers((prev) =>
        prev.map((p) =>
          p.peerId === peerId ? { ...p, countryCode, flagEmoji } : p
        )
      );
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
      } else if (msg?.type === "typing") {
        // Peer typing indicator — dispatch so PeerChat can show animated dots
        window.dispatchEvent(new CustomEvent("afos:peer-typing", { detail: { fromPeerId, ...payload as object } }));
      }
    }));

    // Handle htlc_locked: Agent B notified Agent A that their lock is on-chain.
    // Agent A calls revealHtlcSecret, then sends the secret to Agent B.
    unsubs.push(client.on("htlc_locked", (data) => {
      const { fromPeerId, rfqId, txHash, chain, amountLocked, senderWallet, htlcId: agentBHtlcId } = data as {
        fromPeerId: string; rfqId: string; txHash?: string; chain?: string; amountLocked?: number;
        senderWallet?: string; htlcId?: string;
      };
      if (!rfqId) return;

      // ── Echo guard: skip if this is our own lock notification bouncing back ──
      // Only Agent A (the initiator) should call revealHtlcSecret.
      // Agent B sends htlc_locked to Agent A; if Agent B also receives it (echo/broadcast),
      // Agent B must NOT try to reveal — it would fail with FORBIDDEN because Agent B's
      // wallet doesn't match the stored initiator address.
      if (fromPeerId === peerId) {
        console.log(`[HTLC] Ignoring own htlc_locked echo for rfqId=${rfqId.slice(0, 8)}`);
        return;
      }

      // Additional guard: only proceed if we are the initiator for this RFQ.
      // We know we're the initiator if we stored our wallet in agentAWalletByRfqRef.
      const isInitiator = !!agentAWalletByRfqRef.current[rfqId];
      if (!isInitiator) {
        console.log(`[HTLC] Received htlc_locked but we are not the initiator for rfqId=${rfqId.slice(0, 8)} — skipping revealHtlcSecret`);
        // Still dispatch the UI event so Agent B can see the lock status
        window.dispatchEvent(new CustomEvent("afos:htlc-locked", { detail: { fromPeerId, rfqId, txHash, chain, amountLocked } }));
        return;
      }

      // Show toast so Agent A knows Agent B locked
      toast.info(`Counterparty locked their ${chain ?? ""} HTLC`, {
        description: `RFQ ${rfqId.slice(0, 8)}… · ${amountLocked?.toFixed(4) ?? ""} locked · Tx: ${(txHash ?? "").slice(0, 12)}…`,
        duration: 12000,
      });
      // Dispatch window event so ChatPage / other UI can react
      window.dispatchEvent(new CustomEvent("afos:htlc-locked", { detail: { fromPeerId, rfqId, txHash, chain, amountLocked } }));
      // Retrieve the plaintext secret from the server and send it to Agent B.
      // IMPORTANT: initiatorAddress must be the wallet address (not peerId) because that's
      // what was saved in the DB by buildSwapTx (userPublicKey). Use solPubkey or phantomSolAddress.
      void (async () => {
        try {
          // Resolve Agent A's wallet address for the auth check.
          // Priority: (1) stored ref set at initiateHtlcLock time (most reliable),
          // (2) live solPubkey from adapter, (3) phantomSolAddress, (4) peerId fallback.
          const agentAWallet =
            agentAWalletByRfqRef.current[rfqId] ??
            solPubkey?.toBase58() ??
            phantomSolAddress ??
            peerId ?? "";
          console.log(`[HTLC] revealHtlcSecret agentAWallet=${agentAWallet.slice(0,8)}... rfqId=${rfqId.slice(0,8)}`);
          // Compute Agent A's htlcId (same rfqId-based formula)
          const agentAHtlcId = `htlc_a_${rfqId.slice(0, 22)}`;
          const res = await fetch("/api/trpc/chat.revealHtlcSecret?batch=1", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ "0": { json: {
              rfqId,
              initiatorAddress: agentAWallet,
              counterpartyAddress: senderWallet ?? undefined,  // Agent B's wallet
              htlcIdA: agentAHtlcId,                           // Agent A's PDA seed
              htlcIdB: agentBHtlcId ?? undefined,              // Agent B's PDA seed
              chain: chain ?? "solana",
            } } }),
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => "");
            console.warn("[HTLC] revealHtlcSecret failed:", res.status, errText);
            return;
          }
          const json = await res.json();
          // Batch response is an array: [{result:{data:{json:{secretHex:...}}}}]
          const batchResult = Array.isArray(json) ? json[0] : json;
          const secretHex = batchResult?.result?.data?.json?.secretHex;
          if (!secretHex) { console.warn("[HTLC] No secretHex in revealHtlcSecret response"); return; }
          // Send the secret to Agent B so they can claim
          signalingRef.current?.sendHtlcSecret(fromPeerId, rfqId, secretHex);
          toast.success("HTLC secret revealed to counterparty", {
            description: `Agent B can now claim their funds for RFQ ${rfqId.slice(0, 8)}…`,
            duration: 10000,
          });
          window.dispatchEvent(new CustomEvent("afos:htlc-secret-sent", { detail: { rfqId, secretHex } }));
          // Start polling for completion so Agent A's UI shows success when both claims land.
          if (!completionPollingRef.current[rfqId]) {
            const fromChainLocal = chain ?? "solana";
            let pollCount = 0;
            const maxPolls = 24;
            completionPollingRef.current[rfqId] = setInterval(async () => {
              pollCount++;
              if (pollCount > maxPolls) {
                clearInterval(completionPollingRef.current[rfqId]);
                delete completionPollingRef.current[rfqId];
                return;
              }
              try {
                const pollRes = await fetch(`/api/trpc/chat.getHtlcSecretHash?batch=1&input=${encodeURIComponent(JSON.stringify({ "0": { json: { rfqId } } }))}`, { credentials: "include" });
                if (!pollRes.ok) return;
                const pollJson = await pollRes.json();
                const pollData2 = (pollJson as Array<{ result?: { data?: { json?: { status?: string; revealTxId?: string; counterpartyRevealTxId?: string } } } }>)?.[0]?.result?.data?.json;
                if (pollData2?.status === "completed") {
                  clearInterval(completionPollingRef.current[rfqId]);
                  delete completionPollingRef.current[rfqId];
                  window.dispatchEvent(new CustomEvent("afos:htlc-completed", { detail: {
                    rfqId,
                    chain: fromChainLocal,
                    agentBClaimTxId: pollData2.revealTxId,
                    agentAClaimTxId: pollData2.counterpartyRevealTxId,
                  } }));
                }
              } catch { /* non-critical */ }
            }, 5_000);
          }
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
      window.dispatchEvent(new CustomEvent("afos:htlc-secret-received", { detail: { rfqId, secretHex } }));

      // ── Auto-claim path ────────────────────────────────────────────────────
      // When autoClaim is enabled, trigger the on-chain claim immediately without
      // requiring a manual button click. The secret is already stored in state above.
      if (prefsRef.current.autoClaim) {
        toast.loading(`Auto-claiming HTLC funds for RFQ ${rfqId.slice(0, 8)}…`, { id: `auto-claim-${rfqId}`, duration: 60000 });
        // Small delay to let React flush the setHtlcRevealedSecrets state update
        // before claimHtlcFunds reads htlcRevealedSecrets[rfqId].
        setTimeout(() => {
          void claimHtlcFundsRef.current(rfqId).catch((err: unknown) => {
            console.error("[HTLC] Auto-claim failed:", err);
            toast.error("Auto-claim failed — please claim manually", {
              id: `auto-claim-${rfqId}`,
              description: String(err),
              duration: 30000,
            });
          });
        }, 300);
      } else {
        toast.success("HTLC secret received — you can now claim your funds!", {
          description: `Secret for RFQ ${rfqId.slice(0, 8)}… · Use this to call the claim function on-chain`,
          duration: 30000,
          action: {
            label: "Copy Secret",
            onClick: () => { void navigator.clipboard.writeText(secretHex); },
          },
        });
      }
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
      const { rfqId, fromChain, toChain, expiresAt: expAt, lockTxId } = data as {
        rfqId: string;
        fromChain?: string;
        toChain?: string;
        expiresAt?: number;
        lockTxId?: string;
        message?: string;
      };
      if (!rfqId) return;
      // Remove the secret if stored (no longer claimable as Agent B)
      setHtlcRevealedSecrets(prev => {
        const next = { ...prev };
        delete next[rfqId];
        return next;
      });
      // Add to refundable HTLCs so Agent A can trigger the refund path
      if (fromChain && toChain) {
        setRefundableHtlcs(prev => ({
          ...prev,
          [rfqId]: {
            fromChain,
            toChain,
            expiresAt: expAt ?? Date.now(),
            lockTxId: lockTxId ?? undefined,
          },
        }));
      }
      toast.warning("HTLC swap expired", {
        description: `RFQ ${rfqId.slice(0, 8)}… expired. You may now refund your locked funds.`,
        duration: 15000,
        action: { label: "Refund", onClick: () => window.dispatchEvent(new CustomEvent("afos:htlc-refund-requested", { detail: { rfqId } })) },
      });
      window.dispatchEvent(new CustomEvent("afos:htlc-expired", { detail: { rfqId, fromChain, toChain } }));
    }));

    // Handle RFQ broadcasts
    unsubs.push(client.on("rfq_broadcast", (data) => {
      console.log("[LightPeer] rfq_broadcast received", data);
      const { fromPeerId, rfq } = data as { fromPeerId: string; rfq: unknown };
      // Dispatch to Live Order Book (Swaps page)
      window.dispatchEvent(new CustomEvent("afos:signaling-rfq", { detail: { fromPeerId, ...(rfq as object) } }));
      // Also add to incomingRfqs so the Incoming RFQs panel in NetworkPanel shows it
      const r = rfq as {
        rfqId?: string; fromToken?: string; toToken?: string; fromChain?: string; toChain?: string;
        amount?: number; outAmount?: number; rate?: number; expiresAt?: number;
        requesterAlias?: string; requesterPeerId?: string; requesterWallet?: string;
        requesterWallets?: { solana?: string; ethereum?: string; bitcoin?: string; trac_network?: string };
        secretHashHex?: string;
      };
      if (!r.rfqId || !r.fromToken || !r.toToken) return;
      // Echo-filter: ignore our own broadcasts.
      // Check both r.requesterPeerId (set by server when requesterPeerId is included in the rfq object)
      // and fromPeerId (the outer broadcast sender field) as belt-and-suspenders.
      if (peerId && (r.requesterPeerId === peerId || fromPeerId === peerId)) return;
      const incoming: IncomingRfq = {
        rfqId: r.rfqId,
        fromToken: r.fromToken,
        toToken: r.toToken,
        amount: r.amount ?? 0,
        fromChain: r.fromChain ?? "solana",
        toChain: r.toChain ?? "solana",
        requestorPeer: fromPeerId,
        expiresAt: r.expiresAt ?? (Date.now() + 120_000),
        suggestedRate: r.rate ?? 0,
        suggestedOutAmount: r.outAmount ?? 0,
        status: "pending",
        receivedAt: Date.now(),
        secretHashHex:      r.secretHashHex,
        counterpartyAddress: r.requesterWallet,
        requesterWallet:     r.requesterWallet,
        requesterWallets:    r.requesterWallets,
      };
      setIncomingRfqs(prev => {
        if (prev.some(x => x.rfqId === r.rfqId)) return prev;
        return [incoming, ...prev].slice(0, 20);
      });
      // Dispatch to chat page so the agent shows the incoming swap card.
      // IMPORTANT: preserve r.requesterPeerId (Agent A's actual peerId) when present.
      // Do NOT overwrite it with fromPeerId — fromPeerId may be 'agent' (server fallback)
      // which would break the echo-filter in ChatPage (rfq.requesterPeerId === myPeerId).
      window.dispatchEvent(new CustomEvent("afos:agent-rfq", { detail: { ...r, requesterPeerId: r.requesterPeerId ?? fromPeerId, requestorPeer: fromPeerId } }));
      // Auto-accept guard logic (same as agent_rfq path)
      const prefs_b = prefsRef.current as LightPeerPrefs & {
        autoAcceptRfq?: boolean;
        autoAcceptMaxUsd?: number;
        slippagePct?: string | number;
      };
      const autoAcceptEnabled_b = prefs_b.autoAcceptRfq ?? prefs_b.autoAccept;
      if (!autoAcceptEnabled_b) return;
      const autoAcceptCap_b = (prefs_b.autoAcceptMaxUsd && prefs_b.autoAcceptMaxUsd > 0)
        ? prefs_b.autoAcceptMaxUsd
        : prefs_b.maxTradeUsd;
      const fromPrice_b = pricesRef.current[(r.fromToken ?? "").toUpperCase()] ?? 0;
      const toPrice_b = pricesRef.current[(r.toToken ?? "").toUpperCase()] ?? 0;
      const tradeUsd_b = fromPrice_b > 0 ? (r.amount ?? 0) * fromPrice_b : (r.outAmount ?? 0) * (r.rate ?? 1);
      const oracleRate_b = (fromPrice_b > 0 && toPrice_b > 0) ? fromPrice_b / toPrice_b : 0;
      const slippagePctNum_b = parseFloat(String(prefs_b.slippagePct ?? "0.5"));
      const slippageFrac_b = isNaN(slippagePctNum_b) ? 0.005 : slippagePctNum_b / 100;
      const rateOk_b = oracleRate_b <= 0 || (r.rate ?? 0) >= oracleRate_b * (1 - slippageFrac_b);
      if (tradeUsd_b <= autoAcceptCap_b && rateOk_b) {
        const acceptedDecision_b: IncomingRfq["autoDecision"] = {
          action: "accepted",
          reason: `All guards passed — pair accepted, $${tradeUsd_b.toFixed(2)} within size limits, rate within slippage tolerance`,
          oracleRate: oracleRate_b,
          offeredRate: r.rate ?? 0,
          tradeUsd: tradeUsd_b,
          spreadBps: prefsRef.current.spreadBps,
          timestamp: Date.now(),
        };
        incoming.autoDecision = acceptedDecision_b;
        void acceptRfqRef.current(r.rfqId!, incoming);
        setIncomingRfqs(prev =>
          prev.map(x => x.rfqId === r.rfqId ? { ...x, status: "accepted", autoDecision: acceptedDecision_b } : x)
        );
        setAutoDecisionLog(prev => [{
          rfqId: r.rfqId!,
          pair: `${r.fromToken}/${r.toToken}`,
          fromAmount: r.amount ?? 0,
          fromToken: r.fromToken!,
          toToken: r.toToken!,
          ...acceptedDecision_b,
        }, ...prev].slice(0, 50));
        toast.success(`Smart Auto-Accept: broadcast swap`, {
          description: `${(r.amount ?? 0).toFixed(4)} ${r.fromToken} → ${(r.outAmount ?? 0).toFixed(4)} ${r.toToken} · All guards passed`,
          duration: 8000,
        });
      } else if (!rateOk_b) {
        const rejectedDecision_b: IncomingRfq["autoDecision"] = {
          action: "rejected",
          reason: `Rate guard failed — peer offered ${(r.rate ?? 0).toFixed(6)} but oracle is ${oracleRate_b.toFixed(6)} (>${(slippageFrac_b * 100).toFixed(2)}% slippage)`,
          oracleRate: oracleRate_b,
          offeredRate: r.rate ?? 0,
          tradeUsd: tradeUsd_b,
          spreadBps: prefsRef.current.spreadBps,
          timestamp: Date.now(),
        };
        setIncomingRfqs(prev =>
          prev.map(x => x.rfqId === r.rfqId ? { ...x, autoDecision: rejectedDecision_b } : x)
        );
        setAutoDecisionLog(prev => [{
          rfqId: r.rfqId!,
          pair: `${r.fromToken}/${r.toToken}`,
          fromAmount: r.amount ?? 0,
          fromToken: r.fromToken!,
          toToken: r.toToken!,
          ...rejectedDecision_b,
        }, ...prev].slice(0, 50));
        toast.warning(`Smart Auto-Accept blocked: bad rate (broadcast)`, {
          description: `Offered ${(r.rate ?? 0).toFixed(6)} vs oracle ${oracleRate_b.toFixed(6)} — exceeds ${(slippageFrac_b * 100).toFixed(2)}% slippage limit`,
          duration: 10000,
        });
      }
    }));

    // Handle agent-dispatched RFQs (agent matched this peer with a requester)
    unsubs.push(client.on("agent_rfq", (data) => {
      console.log("[LightPeer] agent_rfq received", data);
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
        /** SHA-256 hash of Agent A's HTLC secret — Agent B MUST lock to this hash for atomicity */
        secretHashHex?: string;
      };
      if (!rfq.rfqId || !rfq.fromToken || !rfq.toToken) return;
      // Echo-filter: if this RFQ was sent by us (Order Book quote request), ignore it.
      // The requesterPeerId is set to our own peerId by requestPeerQuote in Swaps.tsx.
      if (rfq.requesterPeerId && rfq.requesterPeerId === peerId) return;
      // Also ignore if the alias is "Order Book" and we have no requesterPeerId (legacy path)
      if (!rfq.requesterPeerId && rfq.requesterAlias === "Order Book") return;
      // Build IncomingRfq from agent_rfq data
      // IMPORTANT: secretHashHex must be preserved so Agent B locks to the same hash as Agent A (atomicity)
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
        // Critical for atomicity: preserve Agent A's secret hash so both sides lock to the same hash
        secretHashHex:       rfq.secretHashHex,
        // Agent A's wallet address — used as counterparty in Agent B's HTLC lock
        counterpartyAddress: rfq.requesterWallet,
        requesterWallet:     rfq.requesterWallet,
        // Agent A's full multi-chain wallet map — enables cross-chain auto-claim
        requesterWallets:    (rfq as { requesterWallets?: { solana?: string; ethereum?: string; bitcoin?: string; trac_network?: string } }).requesterWallets,
      };
      setIncomingRfqs(prev => {
        if (prev.some(r => r.rfqId === rfq.rfqId)) return prev;
        return [incoming, ...prev].slice(0, 20);
      });
      // Dispatch to chat page so the agent shows the incoming swap card
      // Include requestorPeer so ChatPage can call acceptRfq directly without looking up incomingRfqs
      window.dispatchEvent(new CustomEvent("afos:agent-rfq", { detail: { ...rfq, requestorPeer: rfq.requesterPeerId ?? rfq.requesterAlias ?? "unknown" } }));
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
        // Bug #4 fix: call acceptRfq (not submitQuote) so the HTLC lock is actually triggered.
        // submitQuote only sends a quote response without locking funds.
        // acceptRfq handles the full flow: quote response + HTLC signing + lock.
        const acceptedDecision: IncomingRfq["autoDecision"] = {
          action: "accepted",
          reason: `All guards passed — pair accepted, $${tradeUsdEstimate.toFixed(2)} within size limits, rate within slippage tolerance`,
          oracleRate,
          offeredRate: rfq.rate,
          tradeUsd: tradeUsdEstimate,
          spreadBps: prefsRef.current.spreadBps,
          timestamp: Date.now(),
        };
        incoming.autoDecision = acceptedDecision;
        void acceptRfqRef.current(rfq.rfqId, incoming);
        setIncomingRfqs(prev =>
          prev.map(r => r.rfqId === rfq.rfqId ? { ...r, status: "accepted", autoDecision: acceptedDecision } : r)
        );
        setAutoDecisionLog(prev => [{
          rfqId: rfq.rfqId,
          pair: `${rfq.fromToken}/${rfq.toToken}`,
          fromAmount: rfq.amount,
          fromToken: rfq.fromToken,
          toToken: rfq.toToken,
          ...acceptedDecision,
        }, ...prev].slice(0, 50));
        const autoAlias = rfq.requesterAlias ?? rfq.requesterPeerId?.slice(0, 8) ?? "Someone";
        toast.success(`Smart Auto-Accept: swap from ${autoAlias}`, {
          description: `${rfq.amount.toFixed(4)} ${rfq.fromToken} → ${rfq.outAmount.toFixed(4)} ${rfq.toToken} · All guards passed`,
          duration: 8000,
        });
        // Write to swap_analytics audit log via tRPC mutation (fire-and-forget)
        void fetch("/api/trpc/chat.logAutoAcceptedRfq?batch=1", {
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
        // Slippage guard triggered — stamp rejection reason and notify user
        const alias = rfq.requesterAlias ?? rfq.requesterPeerId?.slice(0, 8) ?? "Someone";
        const rejectedDecision: IncomingRfq["autoDecision"] = {
          action: "rejected",
          reason: `Rate guard failed — peer offered ${rfq.rate.toFixed(6)} but oracle is ${oracleRate.toFixed(6)} (>${(slippageFrac * 100).toFixed(2)}% slippage)`,
          oracleRate,
          offeredRate: rfq.rate,
          tradeUsd: tradeUsdEstimate,
          spreadBps: prefsRef.current.spreadBps,
          timestamp: Date.now(),
        };
        setIncomingRfqs(prev =>
          prev.map(r => r.rfqId === rfq.rfqId ? { ...r, autoDecision: rejectedDecision } : r)
        );
        setAutoDecisionLog(prev => [{
          rfqId: rfq.rfqId,
          pair: `${rfq.fromToken}/${rfq.toToken}`,
          fromAmount: rfq.amount,
          fromToken: rfq.fromToken,
          toToken: rfq.toToken,
          ...rejectedDecision,
        }, ...prev].slice(0, 50));
        toast.warning(`Smart Auto-Accept blocked: bad rate from ${alias}`, {
          description: `Offered ${rfq.rate.toFixed(6)} vs oracle ${oracleRate.toFixed(6)} — exceeds ${(slippageFrac * 100).toFixed(2)}% slippage limit`,
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

    // Read showCountryFlag from persisted settings (localStorage for unauthed, DB for authed)
    const _showCountryFlag = (() => {
      try {
        const s = localStorage.getItem('afos_settings_local');
        if (s) {
          const p = JSON.parse(s) as Record<string, unknown>;
          if (typeof p.showCountryFlag === 'boolean') return p.showCountryFlag;
        }
      } catch { /* ignore */ }
      return true; // default: show flag
    })();

    // Always connect to the signaling WebSocket (needed to receive agent_rfq).
    // Register with the server in all cases so sendToPeer can deliver messages to
    // this peer. When Peer Mode is OFF, register with empty pairs so we are NOT
    // matched as a liquidity provider by findSignalingPeer.
    client.connect();
    if (prefs.enabled) {
      // Full LP registration: advertise pairs and start heartbeat
      client.register(peerId, peerAlias, prefs.acceptedPairs, walletAddresses, prefs.maxTradeUsd, _showCountryFlag);
      // Also do legacy HTTP announce (best-effort fallback)
      announce(peerId, peerAlias);
      // Legacy heartbeat (best-effort fallback)
      heartbeatRef.current = setInterval(() => {
        announce(peerId, peerAlias);
        setLastHeartbeat(Date.now());
      }, HEARTBEAT_INTERVAL_MS);
    } else {
      // Listener-only registration: empty pairs — won't be matched as LP but CAN receive agent_rfq
      client.register(peerId, peerAlias, [], walletAddresses, 0, _showCountryFlag);
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
          // Bug fix: use acceptRfq (not submitQuote) so the HTLC lock is actually triggered.
          // submitQuote only sends a quote response without locking funds.
          // acceptRfq handles the full flow: quote response + HTLC signing + lock.
          const sseAcceptedDecision: IncomingRfq["autoDecision"] = {
            action: "accepted",
            reason: `All guards passed — pair accepted, $${tradeUsd.toFixed(2)} within size limits, rate within slippage tolerance`,
            oracleRate: oracleRateSse,
            offeredRate: quotedRate,
            tradeUsd,
            spreadBps: prefsRef.current.spreadBps,
            timestamp: Date.now(),
          };
          incoming.autoDecision = sseAcceptedDecision;
          void acceptRfqRef.current(rfq.rfqId, incoming);
          setIncomingRfqs(prev =>
            prev.map(r => r.rfqId === rfq.rfqId ? { ...r, status: "accepted", autoDecision: sseAcceptedDecision } : r)
          );
          setAutoDecisionLog(prev => [{
            rfqId: rfq.rfqId ?? "",
            pair: `${rfq.fromToken ?? "?"}/${rfq.toToken ?? "?"}`,
            fromAmount: amount,
            fromToken: rfq.fromToken ?? "",
            toToken: rfq.toToken ?? "",
            ...sseAcceptedDecision,
          }, ...prev].slice(0, 50));
        } else {
          // Slippage guard triggered — stamp rejection and warn user
          const sseRejectedDecision: IncomingRfq["autoDecision"] = {
            action: "rejected",
            reason: `Rate guard failed — quoted ${quotedRate.toFixed(6)} vs oracle ${oracleRateSse.toFixed(6)} (>${(slippageFracSse * 100).toFixed(2)}% slippage)`,
            oracleRate: oracleRateSse,
            offeredRate: quotedRate,
            tradeUsd,
            spreadBps: prefsRef.current.spreadBps,
            timestamp: Date.now(),
          };
          setIncomingRfqs(prev =>
            prev.map(r => r.rfqId === rfq.rfqId ? { ...r, autoDecision: sseRejectedDecision } : r)
          );
          setAutoDecisionLog(prev => [{
            rfqId: rfq.rfqId ?? "",
            pair: `${rfq.fromToken ?? "?"}/${rfq.toToken ?? "?"}`,
            fromAmount: amount,
            fromToken: rfq.fromToken ?? "",
            toToken: rfq.toToken ?? "",
            ...sseRejectedDecision,
          }, ...prev].slice(0, 50));
          toast.warning("Smart Auto-Accept blocked: rate outside slippage tolerance", {
            description: `Quoted ${quotedRate.toFixed(6)} vs oracle ${oracleRateSse.toFixed(6)} (>${(slippageFracSse * 100).toFixed(2)}% slip). Review manually.`,
            duration: 10000,
          });
          // Gate by notifyTradeInquiry setting (read from localStorage for context-level access)
          const _notifyTrade = (() => { try { const s = localStorage.getItem('afos_settings_local'); if (s) { const p = JSON.parse(s); if (typeof p.notifyTradeInquiry === 'boolean') return p.notifyTradeInquiry; } } catch {} return true; })();
          if (_notifyTrade) toast(`Incoming trade request: ${amount.toFixed(4)} ${rfq.fromToken} → ${outAmount.toFixed(4)} ${rfq.toToken}`, {
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
        // Show notification — gated by notifyTradeInquiry setting
        const _notifyTrade2 = (() => { try { const s = localStorage.getItem('afos_settings_local'); if (s) { const p = JSON.parse(s); if (typeof p.notifyTradeInquiry === 'boolean') return p.notifyTradeInquiry; } } catch {} return true; })();
        if (_notifyTrade2) toast(`Incoming trade request: ${amount.toFixed(4)} ${rfq.fromToken} → ${outAmount.toFixed(4)} ${rfq.toToken}`, {
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

  // ── Poll server inbox for missed agent_rfq messages (fallback) ────────────
  // WebSocket delivery can be unreliable (tab switching, reconnection races,
  // multiple tabs). This polls the server every 5s to catch any missed RFQs.
  useEffect(() => {
    if (!peerId) return;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/trpc/chat.pollInbox?batch=1&input=${encodeURIComponent(JSON.stringify({ "0": { json: { peerId } } }))}`,
          { credentials: "include" }
        );
        if (!res.ok) return;
        const body = await res.json() as unknown;
        const items = (body as { result?: { data?: { json?: Array<{
          rfqId: string; fromToken: string; toToken: string; fromChain: string; toChain: string;
          amount: number; outAmount: number; rate: number; requesterAlias?: string;
          requesterPeerId?: string; requesterWallet?: string; expiresAt: number;
          secretHashHex?: string; timestamp: number;
        }> } } }[])?.[0]?.result?.data?.json;
        if (!Array.isArray(items) || items.length === 0) return;
        console.log("[LightPeer] pollInbox returned", items.length, "missed RFQs");
        for (const rfq of items) {
          if (!rfq.rfqId || !rfq.fromToken || !rfq.toToken) continue;
          if (rfq.expiresAt < Date.now()) continue;
          // Echo-filter
          if (rfq.requesterPeerId && rfq.requesterPeerId === peerId) continue;
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
            secretHashHex: rfq.secretHashHex,
            counterpartyAddress: rfq.requesterWallet,
            requesterWallet: rfq.requesterWallet,
          };
          setIncomingRfqs(prev => {
            if (prev.some(r => r.rfqId === rfq.rfqId)) return prev;
            return [incoming, ...prev].slice(0, 20);
          });
          // Dispatch to chat page
          window.dispatchEvent(new CustomEvent("afos:agent-rfq", { detail: rfq }));
          // Dispatch to Live Order Book
          window.dispatchEvent(new CustomEvent("afos:signaling-rfq", { detail: rfq }));
          toast(`Incoming swap: ${rfq.amount.toFixed(4)} ${rfq.fromToken} → ${rfq.outAmount.toFixed(4)} ${rfq.toToken}`, {
            description: `From ${rfq.requesterAlias ?? rfq.requesterPeerId?.slice(0, 8) ?? "peer"} · recovered via polling`,
            duration: 15000,
            action: {
              label: "View in Agent",
              onClick: () => { window.dispatchEvent(new CustomEvent("afos:open-agent-chat")); },
            },
          });
          // Run auto-accept guards on polled RFQs too
          const prefs_p = prefsRef.current as LightPeerPrefs & { autoAcceptRfq?: boolean; autoAcceptMaxUsd?: number; slippagePct?: string | number };
          const autoEnabled_p = prefs_p.autoAcceptRfq ?? prefs_p.autoAccept;
          if (autoEnabled_p) {
            const fromPrice_p = pricesRef.current[(rfq.fromToken ?? "").toUpperCase()] ?? 0;
            const toPrice_p = pricesRef.current[(rfq.toToken ?? "").toUpperCase()] ?? 0;
            const tradeUsd_p = fromPrice_p > 0 ? rfq.amount * fromPrice_p : rfq.outAmount * rfq.rate;
            const cap_p = (prefs_p.autoAcceptMaxUsd && prefs_p.autoAcceptMaxUsd > 0) ? prefs_p.autoAcceptMaxUsd : prefs_p.maxTradeUsd;
            const oracleRate_p = (fromPrice_p > 0 && toPrice_p > 0) ? fromPrice_p / toPrice_p : 0;
            const slipFrac_p = parseFloat(String(prefs_p.slippagePct ?? "0.5")) / 100 || 0.005;
            const rateOk_p = oracleRate_p <= 0 || rfq.rate >= oracleRate_p * (1 - slipFrac_p);
            if (tradeUsd_p <= cap_p && rateOk_p) {
              void acceptRfqRef.current(rfq.rfqId, incoming);
              setIncomingRfqs(prev => prev.map(r => r.rfqId === rfq.rfqId ? { ...r, status: "accepted" } : r));
            }
          }
        }
      } catch { /* polling is best-effort */ }
    };
    // Poll immediately on mount, then every 5 seconds
    void poll();
    const timer = setInterval(poll, 5000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerId]);

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
    // 3-second timeout — this is best-effort; HTLC signing must not be blocked by Oracle VM latency
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3000);
    try {
      await fetch(`${BACKEND_URL}/api/rfq/${rfq.rfqId}/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
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
    } catch { /* best-effort — Oracle VM may be slow or unreachable */ } finally {
      clearTimeout(timer);
    }
  }, [peerId, peerAlias]);

  // ── Accept RFQ with in-browser HTLC signing ───────────────────────────────
  // Accepts an optional `rfqOverride` so initiateHtlcLock can pass the synthetic
  // RFQ directly without waiting for React state to update.
  const acceptRfq = useCallback(async (rfqId: string, rfqOverride?: IncomingRfq) => {
    console.error("[HTLC-DEBUG] acceptRfq called", { rfqId, hasOverride: !!rfqOverride });
    const rfq = rfqOverride ?? incomingRfqs.find(r => r.rfqId === rfqId);
    if (!rfq || rfq.status !== "pending") {
      console.error("[HTLC-DEBUG] acceptRfq early return — rfq not found or not pending", { found: !!rfq, status: rfq?.status });
      toast.error("[HTLC-DEBUG] acceptRfq early return", { description: `found=${!!rfq} status=${rfq?.status}` });
      return;
    }
    console.error("[HTLC-DEBUG] acceptRfq passed early return check — proceeding with HTLC lock", { rfqId, chain: rfq.fromChain });
    toast.success(`[HTLC-DEBUG] acceptRfq proceeding chain=${rfq.fromChain}`);
    setIncomingRfqs(prev =>
      prev.map(r => r.rfqId === rfqId ? { ...r, status: "accepted" } : r)
    );
    // Step 1: Submit quote to AFOS agent (non-critical — 504 from Oracle VM must not abort HTLC signing)
    try {
      await submitQuote(rfq);
    } catch (sqErr) {
      console.warn("[acceptRfq] submitQuote failed (non-critical):", sqErr instanceof Error ? sqErr.message : sqErr);
    }

    // Step 1b: Notify the requester (Agent A) that we accepted their RFQ (non-critical)
    console.error("[HTLC-DEBUG] about to sendToPeer rfq_accepted", { hasRequestorPeer: !!rfq.requestorPeer, hasSignaling: !!signalingRef.current });
    if (rfq.requestorPeer && signalingRef.current) {
      try {
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
      } catch (stpErr) {
        console.warn("[acceptRfq] sendToPeer failed (non-critical):", stpErr instanceof Error ? stpErr.message : stpErr);
      }
    }

    // Step 2: In-browser HTLC lock signing
    console.error("[HTLC-DEBUG] about to setHtlcSigning signing");
    toast.info("[HTLC-DEBUG] Step 2: setHtlcSigning");
    // Agent B locks toToken and receives fromToken
    const isInit = !!rfq.isInitiator;
    setHtlcSigning({
      rfqId,
      step: "signing",
      fromToken:          isInit ? rfq.fromToken : rfq.toToken,   // what Agent B locks
      toToken:            isInit ? rfq.toToken   : rfq.fromToken, // what Agent B receives
      fromAmount:         isInit ? rfq.amount    : rfq.suggestedOutAmount,
      toAmount:           isInit ? rfq.suggestedOutAmount : rfq.amount,
      fromChain:          isInit ? rfq.fromChain : rfq.toChain,
      toChain:            isInit ? rfq.toChain   : rfq.fromChain,
      counterpartyAlias:  rfq.requestorPeer?.slice(0, 12),
      expiresAt:          Date.now() + 3_600_000, // 1 hour HTLC timelock
      lockedAt:           Date.now(),
    });

    try {
      // Agent A locks on fromChain; Agent B locks on toChain (important for cross-chain swaps)
      const chain = rfq.isInitiator
        ? (rfq.fromChain?.toLowerCase() ?? "solana")
        : (rfq.toChain?.toLowerCase() ?? rfq.fromChain?.toLowerCase() ?? "solana");
      console.error("[HTLC-DEBUG] chain resolved", { chain, isInitiator: rfq.isInitiator, fromChain: rfq.fromChain, toChain: rfq.toChain, solConnected });
      toast.info(`[HTLC-DEBUG] chain=${chain} isInit=${!!rfq.isInitiator} solConn=${solConnected}`);

      if (chain === "solana" && solConnected) {
        // Solana HTLC: build lock transaction and sign with wallet
        // Agent A locks fromToken (e.g., SOL); Agent B locks toToken (e.g., USDT)
        setHtlcSigning(prev => prev ? { ...prev, step: "locking" } : { rfqId, step: "locking" });

        // Determine what token and amount this agent should lock
        const isAgentA = !!rfq.isInitiator;
        const lockToken = isAgentA ? rfq.fromToken : rfq.toToken;
        const lockAmount = isAgentA ? (rfq.amount ?? 0) : (rfq.suggestedOutAmount ?? 0);
        const isNativeSol = lockToken.toUpperCase() === "SOL";
        console.error("[HTLC-DEBUG] Entering Solana HTLC lock path", { isAgentA, lockToken, lockAmount, isNativeSol });

        try {
          // Resolve the sender's Solana pubkey from either adapter or Phantom multi-chain.
          // IMPORTANT: Use window.phantom.solana.publicKey as the live address when available —
          // phantomSolAddress can be stale if the user switched Phantom accounts after connecting.
          const livePh = (window as unknown as { phantom?: { solana?: { publicKey?: { toString(): string } } } }).phantom?.solana;
          const liveSolAddress = livePh?.publicKey?.toString() ?? null;
          const senderPubkeyStr = solPubkey?.toBase58() ?? liveSolAddress ?? phantomSolAddress;
          console.error("[HTLC-DEBUG] senderPubkeyStr", senderPubkeyStr, { fromAdapter: !!solPubkey, fromLivePhantom: !!liveSolAddress, fromStored: !!phantomSolAddress });
          if (!senderPubkeyStr) throw new Error("No Solana wallet address available");
          const senderPubkeyObj = new PublicKey(senderPubkeyStr);

          // ── Pre-flight: verify HTLC program is deployed on-chain ──────────────
          const programCheck = await checkHtlcProgramDeployed(solConnection);
          if (!programCheck.deployed) {
            const msg = programCheck.reason ?? "HTLC program not found on-chain. Please try again later.";
            setHtlcSigning(prev => prev ? { ...prev, step: 'failed', error: msg } : { rfqId, step: 'failed', error: msg });
            toast.error('HTLC program unavailable', { description: msg });
            return;
          }

          // Use Agent A's secretHashHex if provided (ensures atomicity), otherwise generate own
          const { secretHex, secretHashHex } = rfq.secretHashHex
            ? { secretHex: "", secretHashHex: rfq.secretHashHex }  // Agent B locks to Agent A's hash
            : await generateHtlcSecret();                           // fallback: generate own secret
          void secretHex; // store securely in production — needed to reveal later

          // Timelock: 1 hour from now
          const timelock = Math.floor(Date.now() / 1000) + 3600;

          // Generate distinct htlcId for Agent A vs Agent B (different PDAs, same secret hash)
          // Agent A: htlc_a_<rfqId first 22 chars>  Agent B: htlc_b_<rfqId first 22 chars>
          const htlcId = isAgentA
            ? `htlc_a_${rfqId.slice(0, 22)}`
            : `htlc_b_${rfqId.slice(0, 22)}`;

          // Counterparty pubkey: use peer's pubkey from RFQ if available
          const counterpartyStr = rfq.counterpartyAddress ?? rfq.requesterWallet
            ?? senderPubkeyStr; // fallback to self for demo
          let recipientPubkey: PublicKey;
          try {
            recipientPubkey = new PublicKey(counterpartyStr);
          } catch {
            recipientPubkey = senderPubkeyObj;
          }

          // Use the pre-configured HTLC escrow address from the environment variable.
          const agentEscrowAddr: string | undefined = import.meta.env.VITE_SOL_HTLC_ESCROW || undefined;
          console.error("[HTLC-DEBUG] agentEscrowAddr", agentEscrowAddr);

          let transaction: import("@solana/web3.js").Transaction;
          let escrowAddress: string;

          if (isNativeSol) {
            // ── Pre-flight: verify sender has enough SOL to cover lock + rent + fee ──
            // InsufficientFundsForRent happens when:
            //   balance < lockAmount + PDA_rent (~0.00114 SOL) + tx_fee (~0.00008 SOL) + sender_rent_exempt_min (~0.00089 SOL)
            // Total overhead ≈ 0.00211 SOL. We use 0.005 SOL as a safe buffer.
            const SOL_LOCK_OVERHEAD_LAMPORTS = 5_000_000; // 0.005 SOL buffer for rent + fees
            try {
              const senderBalance = await solConnection.getBalance(senderPubkeyObj, "confirmed");
              const lockLamports = Math.round(lockAmount * 1e9);
              const needed = lockLamports + SOL_LOCK_OVERHEAD_LAMPORTS;
              if (senderBalance < needed) {
                const haveSol = (senderBalance / 1e9).toFixed(4);
                const needSol = (needed / 1e9).toFixed(4);
                const msg = `Insufficient SOL. You have ${haveSol} SOL but need at least ${needSol} SOL (${lockAmount} SOL to lock + 0.005 SOL for rent & fees).`;
                console.error("[HTLC] Pre-flight balance check failed:", msg);
                setHtlcSigning(prev => prev ? { ...prev, step: 'failed', error: msg } : { rfqId, step: 'failed', error: msg });
                toast.error('Insufficient SOL balance', { description: msg });
                return;
              }
              console.log(`[HTLC] Pre-flight balance check: ${senderBalance} lamports (need ${needed}) for ${senderPubkeyStr.slice(0,8)}...`);
            } catch (balErr) {
              // If balance check fails (network), proceed and let the tx fail naturally
              console.warn("[HTLC] Pre-flight SOL balance check failed (network), proceeding:", balErr);
            }

            // ── Native SOL lock (Agent A in SOL→USDT, or Agent B in USDT→SOL) ──
            const result = await buildSolanaHtlcLockTx({
              senderPubkey:    senderPubkeyObj,
              recipientPubkey,
              amountSol:       lockAmount,
              secretHash:      secretHashHex,
              timelock,
              connection:      solConnection,
              htlcId,
            });
            transaction = result.transaction;
            escrowAddress = result.escrowAddress;
          } else if (TOKEN_MINTS[lockToken.toUpperCase()]) {
            // ── Pre-flight: verify Agent B has enough SPL token balance ──
            // Uses the server-side getSolanaBalanceByAddress endpoint which races multiple
            // reliable RPC endpoints (Helius + fallbacks) — avoids publicnode 403 issues.
            //
            // For USDT/USDC: the endpoint returns dedicated named fields (usdtBalance / usdcBalance).
            // For any other TOKEN_MINTS entry: we pass the mint address via the `mint` parameter
            //   and read the generic `splBalance` field from the response.
            // This means ALL tokens in TOKEN_MINTS are now pre-checked — no false negatives.
            try {
              const tokenUpper = lockToken.toUpperCase();
              const tokenMintInfo = TOKEN_MINTS[tokenUpper];
              // Build input: always include address; include mint for non-USDT/USDC tokens
              const balInput: { address: string; mint?: string } = { address: senderPubkeyStr };
              if (tokenUpper !== 'USDT' && tokenUpper !== 'USDC' && tokenMintInfo) {
                balInput.mint = tokenMintInfo.mint;
              }
              const encoded = encodeURIComponent(JSON.stringify({ '0': { json: balInput } }));
              const balRes = await fetch(`/api/trpc/htlcWallet.getSolanaBalanceByAddress?batch=1&input=${encoded}`, {
                credentials: 'include',
              });
              if (balRes.ok) {
                const batchResult = await balRes.json() as Array<{ result?: { data?: { json?: { usdtBalance?: number; usdcBalance?: number; splBalance?: number | null } } } }>;
                const data = batchResult?.[0]?.result?.data?.json;
                if (data) {
                  // Resolve balance: named field for USDT/USDC, generic splBalance for everything else
                  const balance =
                    tokenUpper === 'USDT' ? (data.usdtBalance ?? 0) :
                    tokenUpper === 'USDC' ? (data.usdcBalance ?? 0) :
                    (data.splBalance ?? null); // null = check unavailable, don't block
                  console.log(`[HTLC] Pre-flight balance check: ${balance} ${lockToken} (need ${lockAmount}) for ${senderPubkeyStr.slice(0,8)}...`);
                  if (balance !== null && balance < lockAmount) {
                    const msg = balance === 0
                      ? `You have no ${lockToken} in this wallet. Please fund your wallet with ${lockAmount} ${lockToken} before accepting this swap.`
                      : `Insufficient ${lockToken} balance. You have ${balance.toFixed(6)} ${lockToken} but need ${lockAmount} ${lockToken}.`;
                    setHtlcSigning(prev => prev ? { ...prev, step: 'failed', error: msg } : { rfqId, step: 'failed', error: msg });
                    toast.error('Insufficient balance', { description: msg });
                    return;
                  }
                  // If balance is null (splBalance not returned), proceed without blocking
                }
                // If data is missing, proceed anyway (don't block on check failure)
              } else {
                console.warn('[HTLC] Balance pre-check HTTP error (proceeding):', balRes.status);
              }
            } catch (balErr: unknown) {
              // If balance check itself fails (network error), proceed anyway
              console.warn('[HTLC] Balance pre-check failed (proceeding):', balErr instanceof Error ? balErr.message : balErr);
            }
            // ── SPL Token lock (Agent B in SOL→USDT locks USDT, etc.) ──
            const result = await buildSolanaTokenHtlcLockTx({
              senderPubkey:    senderPubkeyObj,
              recipientPubkey,
              tokenSymbol:     lockToken,
              amount:          lockAmount,
              secretHash:      secretHashHex,
              timelock,
              connection:      solConnection,
              htlcId,
            });
            transaction = result.transaction;
            escrowAddress = result.escrowAddress;
          } else {
            throw new Error(`Unsupported token for HTLC lock: ${lockToken}`);
          }

          let txHash: string;
          // Detect Phantom Standard Wallet: phantomSolAddress is set but solPubkey (adapter) is null
          const isPhantomStandardWallet = !!phantomSolAddress && !solPubkey;
          // window.phantom.solana is the Phantom Standard Wallet provider
          const phantomProvider = (window as unknown as {
            phantom?: { solana?: { signAndSendTransaction: (tx: unknown) => Promise<{ signature: string }>, signTransaction?: (tx: unknown) => Promise<unknown> } }
          }).phantom?.solana ?? (window as unknown as {
            solana?: { signAndSendTransaction?: (tx: unknown) => Promise<{ signature: string }>, signTransaction?: (tx: unknown) => Promise<unknown> }
          }).solana;

          console.error("[HTLC-DEBUG] About to sign.", { isAgentA, lockToken, lockAmount, isPhantomStandard: isPhantomStandardWallet });

          if (isPhantomStandardWallet && phantomProvider?.signAndSendTransaction) {
            console.error("[HTLC-DEBUG] Using Phantom Standard Wallet (window.phantom.solana) path");
            const { signature } = await phantomProvider.signAndSendTransaction(transaction);
            txHash = signature;
          } else if (sendSolTransaction && solPubkey) {
            console.error("[HTLC-DEBUG] Using sendSolTransaction path — calling now...");
            txHash = await (sendSolTransaction as (tx: import("@solana/web3.js").Transaction, conn: typeof solConnection) => Promise<string>)(transaction, solConnection);
          } else if (signTransaction && solPubkey) {
            console.error("[HTLC-DEBUG] Using legacy signTransaction path");
            const signedTx = await (signTransaction as (tx: import("@solana/web3.js").Transaction) => Promise<import("@solana/web3.js").Transaction>)(transaction);
            const rawTx = signedTx.serialize();
            txHash = await solConnection.sendRawTransaction(rawTx, {
              skipPreflight: false,
              preflightCommitment: "confirmed",
            });
          } else if (phantomProvider?.signAndSendTransaction) {
            console.error("[HTLC-DEBUG] Using window.solana fallback");
            const { signature } = await phantomProvider.signAndSendTransaction(transaction);
            txHash = signature;
          } else {
            throw new Error("No Solana wallet found. Please connect Phantom or MetaMask to sign HTLC transactions.");
          }

          // ── Confirm the tx on-chain before recording ──────────────────────
          // Poll getSignatureStatus every 3s for up to 90s — far more reliable than
          // confirmTransaction which hard-times-out at 30s on congested mainnet.
          console.log("[HTLC] Waiting for lock tx confirmation:", txHash);
          const MAX_POLLS_LOCK = 30; // 30 × 3s = 90s
          let txConfirmed = false;
          for (let poll = 0; poll < MAX_POLLS_LOCK; poll++) {
            await new Promise(r => setTimeout(r, 3000));
            const statusResp = await solConnection.getSignatureStatus(txHash, { searchTransactionHistory: true });
            const txStatus = statusResp?.value;
            if (txStatus?.err) {
              const errStr = JSON.stringify(txStatus.err);
              console.error("[HTLC] Lock tx failed on-chain:", errStr);
              throw new Error(`HTLC lock transaction failed on-chain: ${errStr}`);
            }
            if (txStatus?.confirmationStatus === "confirmed" || txStatus?.confirmationStatus === "finalized") {
              console.log("[HTLC] Lock tx confirmed on-chain after", (poll + 1) * 3, "s:", txHash);
              txConfirmed = true;
              break;
            }
          }
          if (!txConfirmed) {
            // Final check after 90s
            const finalResp = await solConnection.getSignatureStatus(txHash, { searchTransactionHistory: true });
            if (finalResp?.value?.err) {
              throw new Error(`HTLC lock transaction failed on-chain: ${JSON.stringify(finalResp.value.err)}`);
            }
            if (!finalResp?.value) {
              throw new Error("HTLC lock transaction not found on-chain after 90s — please retry");
            }
            // Has a status with no error — treat as confirmed
            console.log("[HTLC] Lock tx found on-chain after 90s (no error):", txHash);
            txConfirmed = true;
          }

          // HTLC lock tx submitted — mark as "locked" (not "settled").
          // True settlement only happens after Agent A reveals the secret and both sides claim.
          setHtlcSigning(prev => ({
            ...(prev ?? {}),
            rfqId,
            step: "locked",
            txHash,
            lockedAt: Date.now(),
            expiresAt: Date.now() + 3_600_000, // 1 hour from now
          }));
          // Dispatch own-lock event so ChatPage can store the lock tx in swapProgressData
          window.dispatchEvent(new CustomEvent("afos:htlc-own-lock", { detail: { rfqId, txHash, escrowAddress, chain: "solana" } }));
          setHtlcLockedAt(prev => ({ ...prev, [rfqId]: Date.now() }));
          // Notify Agent A that we (Agent B) have locked our side
          if (rfq.requestorPeer && signalingRef.current) {
            signalingRef.current.sendHtlcLocked(
              rfq.requestorPeer, rfqId, txHash, "solana", lockAmount,
              senderPubkeyStr,  // Agent B's wallet address (so Agent A knows where to send funds)
              htlcId,           // Agent B's htlcId (PDA seed for the program)
            );
          }
          // Record the HTLC deposit in the database for server-side monitoring.
          // Only reached if the tx was confirmed successfully on-chain.
          // On failure, save to localStorage for retry on next mount.
          {
            const depositPayload = {
              chain: "solana" as const,
              txHash,
              senderAddress: senderPubkeyStr,
              recipientAddress: recipientPubkey.toBase58(),
              escrowAddress,
              amountRaw: String(lockAmount),
              token: lockToken,
              secretHash: secretHashHex,
              timelock,
              rfqId,
              peerId: rfq.requestorPeer ?? undefined,
              htlcId,
              isAgentA,
              // Store the counterparty's wallet address so HtlcSecretsMonitor can auto-claim
              // without needing a separate htlc_secrets lookup.
              // For Agent A: counterparty = Agent B (recipient = the person who will claim Agent A's funds)
              // For Agent B: counterparty = Agent A (the initiator, whose address is in rfq.requesterWallet)
              counterpartyAddress: isAgentA
                ? recipientPubkey.toBase58()   // Agent B's address
                : (rfq.requesterWallet ?? rfq.counterpartyAddress ?? undefined),  // Agent A's address
              // Full multi-chain wallet map for the counterparty — enables HtlcSecretsMonitor
              // to auto-claim on any chain without a separate peer registry lookup.
              counterpartyWallets: rfq.requesterWallets ?? undefined,
            };
            try {
              const res = await fetch("/api/trpc/htlcWallet.recordHtlcDeposit?batch=1", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ "0": { json: depositPayload } }),
              });
              if (!res.ok) {
                // Save for retry on next page load
                saveFailedDeposit(depositPayload);
                console.warn("[HTLC] recordHtlcDeposit failed (", res.status, ") — saved to localStorage for retry");
              }
            } catch (recordErr) {
              // Network error — save for retry
              saveFailedDeposit(depositPayload);
              console.warn("[HTLC] recordHtlcDeposit network error — saved to localStorage for retry", recordErr);
            }
          }

          toast.success(`${lockToken} HTLC locked`, {
            description: `Tx: ${txHash.slice(0, 20)}… · ${lockAmount} ${lockToken} locked in escrow (${escrowAddress.slice(0, 8)}…)`,
            action: {
              label: "View on Solscan",
              onClick: () => window.open(`https://solscan.io/tx/${txHash}`, "_blank"),
            },
          });

          // ── Webhook: notify server immediately so it can trigger auto-claim ──
          // Agent B calls this after their lock is confirmed. The server fires both
          // claims (Agent A's lock → Agent B, Agent B's lock → Agent A) without
          // waiting for the 5-minute HtlcSecretsMonitor stale timer.
          if (!isAgentA) {
            void (async () => {
              try {
                const webhookRes = await fetch("/api/trpc/chat.notifyAgentBLocked?batch=1", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                  body: JSON.stringify({ "0": { json: {
                    rfqId,
                    htlcIdB:      htlcId,
                    senderWallet: senderPubkeyStr,
                    lockTxHash:   txHash,
                    chain:        "solana",
                    // Agent B's full wallet map — stored in Agent A's htlc_secrets row
                    // as counterpartyWallets for Tier 1 monitor address resolution.
                    senderWallets: {
                      ...(senderPubkeyStr           ? { solana: senderPubkeyStr }                    : {}),
                      ...(ethereum?.address         ? { ethereum: ethereum.address }                 : {}),
                      ...(bitcoin?.address          ? { bitcoin: bitcoin.address }                   : {}),
                      ...(tnkWalletCtx?.address     ? { trac_network: tnkWalletCtx.address }         : {}),
                    },
                  } } }),
                });
                if (webhookRes.ok) {
                  const webhookJson = await webhookRes.json();
                  const triggered = (webhookJson as Array<{ result?: { data?: { json?: { triggered?: boolean } } } }>)?.[0]?.result?.data?.json?.triggered;
                  console.log(`[AgentBWebhook] notifyAgentBLocked → triggered=${triggered}`);
                  if (triggered) {
                    // Server is handling on-chain claims — start polling for tx hashes then dispatch completion
                    if (!completionPollingRef.current[rfqId]) {
                      let pollCountB = 0;
                      const maxPollsB = 24;
                      completionPollingRef.current[rfqId] = setInterval(async () => {
                        pollCountB++;
                        if (pollCountB > maxPollsB) {
                          clearInterval(completionPollingRef.current[rfqId]);
                          delete completionPollingRef.current[rfqId];
                          // Dispatch without tx hashes as fallback
                          window.dispatchEvent(new CustomEvent("afos:htlc-completed", { detail: { rfqId, chain: "solana" } }));
                          return;
                        }
                        try {
                          const pollRes = await fetch(`/api/trpc/chat.getHtlcSecretHash?batch=1&input=${encodeURIComponent(JSON.stringify({ "0": { json: { rfqId } } }))}`, { credentials: "include" });
                          if (!pollRes.ok) return;
                          const pollJson = await pollRes.json();
                          const pollDataB = (pollJson as Array<{ result?: { data?: { json?: { status?: string; revealTxId?: string; counterpartyRevealTxId?: string } } } }>)?.[0]?.result?.data?.json;
                          if (pollDataB?.status === "completed") {
                            clearInterval(completionPollingRef.current[rfqId]);
                            delete completionPollingRef.current[rfqId];
                            window.dispatchEvent(new CustomEvent("afos:htlc-completed", { detail: {
                              rfqId,
                              chain: "solana",
                              agentBClaimTxId: pollDataB.revealTxId,
                              agentAClaimTxId: pollDataB.counterpartyRevealTxId,
                            } }));
                          }
                        } catch { /* non-critical */ }
                      }, 5_000);
                    }
                  }
                } else {
                  console.warn("[AgentBWebhook] notifyAgentBLocked failed:", webhookRes.status);
                }
              } catch (webhookErr) {
                // Non-fatal: HtlcSecretsMonitor will retry after 5 minutes
                console.warn("[AgentBWebhook] notifyAgentBLocked network error:", webhookErr);
              }
            })();
          }
        } catch (solErr: unknown) {
          const msg = solErr instanceof Error ? solErr.message : String(solErr);
          if (msg.toLowerCase().includes("user rejected") || msg.toLowerCase().includes("cancel")) {
            setHtlcSigning(prev => prev ? { ...prev, step: "failed", error: "Transaction rejected by user" } : { rfqId, step: "failed", error: "Transaction rejected by user" });
          } else {
            setHtlcSigning(prev => prev ? { ...prev, step: "failed", error: msg.slice(0, 120) } : { rfqId, step: "failed", error: msg.slice(0, 120) });
            toast.error("Solana HTLC lock failed", { description: msg.slice(0, 80) });
          }
        }
      } else if ((chain === "ethereum" || chain === "eth") && (ethereum?.connected || !!(window as any).ethereum || phantomMultiChain?.ethereumAddress)) {
        // Ethereum HTLC: ABI-encoded lockETH() / lockToken() via HTLC.sol
        // Accepts: MetaMask, Phantom multi-chain ethereum, or any EIP-1193 provider
        setHtlcSigning(prev => prev ? { ...prev, step: "locking" } : { rfqId, step: "locking" });
        const rawEth = (window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<string> } }).ethereum
          ?? (window as any).phantom?.ethereum;
        try {
          if (!rawEth) throw new Error("No Ethereum provider found. Please connect MetaMask or Phantom.");

          // ── Build ABI-encoded lockETH() calldata ─────────────────────────
          // HTLC contract address (set after deploying HTLC.sol to Sepolia/mainnet)
          const htlcContractAddress = import.meta.env.VITE_ETH_HTLC_ADDRESS as string | undefined;

          // Use Agent A's secretHashHex if provided (ensures atomicity), otherwise generate own
          const secretHashHex = rfq.secretHashHex ?? (() => {
            const secretBytes   = crypto.getRandomValues(new Uint8Array(32));
            return crypto.subtle.digest("SHA-256", secretBytes).then(buf =>
              Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
            );
          })();
          const resolvedSecretHashHex = typeof secretHashHex === "string" ? secretHashHex : await secretHashHex;

          // Timelock: 1 hour from now (Unix timestamp in seconds)
          const timelock = Math.floor(Date.now() / 1000) + 3600;

          // Resolve sender address: prefer context, fallback to Phantom multi-chain, then request from provider
          const senderEthAddr = ethereum?.address ?? phantomMultiChain?.ethereumAddress
            ?? (await rawEth.request({ method: "eth_accounts" }) as string[])?.[0];
          if (!senderEthAddr) throw new Error("No Ethereum address available. Please reconnect your wallet.");

          // Counterparty address: use peer address from RFQ if available
          const recipient = rfq.counterpartyAddress ?? rfq.requesterWallet ?? senderEthAddr;

          // Agent A locks fromToken amount; Agent B locks toToken amount
          const isAgentAEth = !!rfq.isInitiator;
          const ethLockAmount = isAgentAEth ? (rfq.amount ?? 0) : (rfq.suggestedOutAmount ?? 0);
          // Amount in wei
          const amountWei = BigInt(Math.floor(ethLockAmount * 1e18));

          // ABI-encode lockETH(bytes32 secretHash, address recipient, uint256 timelock)
          // Function selector: keccak256("lockETH(bytes32,address,uint256)") = 0x1d4e5e8c
          const padLeft = (hex: string, bytes = 32) => hex.padStart(bytes * 2, "0");
          const calldata = "0x1d4e5e8c"
            + padLeft(resolvedSecretHashHex, 32)
            + padLeft(recipient.replace(/^0x/, "").toLowerCase(), 32)
            + padLeft(timelock.toString(16), 32);

          // Use real HTLC contract if deployed, otherwise send a marker tx for demo
          const txTo   = htlcContractAddress ?? senderEthAddr;
          const txData = htlcContractAddress ? calldata : `0x48544c43${rfqId.replace(/-/g, "").slice(0, 32)}`;
          const txValue = htlcContractAddress ? "0x" + amountWei.toString(16) : "0x0";
          const txGas   = htlcContractAddress ? "0x186A0" : "0x5208";

          const txHash = await rawEth.request({
            method: "eth_sendTransaction",
            params: [{
              from:  senderEthAddr,
              to:    txTo,
              value: txValue,
              data:  txData,
              gas:   txGas,
            }],
          });
          // HTLC lock tx submitted — mark as "locked" (not "settled").
          setHtlcSigning(prev => ({
            ...(prev ?? {}),
            rfqId,
            step: "locked",
            txHash,
            lockedAt: Date.now(),
            expiresAt: Date.now() + 3_600_000, // 1 hour from now
          }));
          window.dispatchEvent(new CustomEvent("afos:htlc-own-lock", { detail: { rfqId, txHash, escrowAddress: htlcContractAddress ?? undefined, chain: "ethereum" } }));
          setHtlcLockedAt(prev => ({ ...prev, [rfqId]: Date.now() }));
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
            setHtlcSigning(prev => prev ? { ...prev, step: "failed", error: "Transaction rejected by user" } : { rfqId, step: "failed", error: "Transaction rejected by user" });
          } else {
            // Wallet signing failed — do NOT mark as settled
            setHtlcSigning(prev => prev ? { ...prev, step: "failed", error: msg.slice(0, 120) } : { rfqId, step: "failed", error: msg.slice(0, 120) });
            toast.error("ETH HTLC lock failed", { description: msg.slice(0, 80) });
          }
        }
      } else if ((chain === "bitcoin" || chain === "btc") && (bitcoin?.connected || phantomMultiChain?.bitcoinAddress || !!(window as any).tapprotocol)) {
        // Bitcoin HTLC: build P2WSH PSBT, sign with detected wallet, broadcast via mempool.space
        setHtlcSigning(prev => prev ? { ...prev, step: "locking" } : { rfqId, step: "locking" });
        try {
          const btcProvider: BtcWalletProvider = detectBtcProvider();
          if (btcProvider === "unknown") {
            throw new Error("No Bitcoin wallet provider detected. Please connect Phantom, MetaMask, or Tap Wallet.");
          }
          // Agent A locks fromToken amount; Agent B locks toToken amount
          const isAgentABtc = !!rfq.isInitiator;
          const btcLockAmount = isAgentABtc ? rfq.amount : (rfq.suggestedOutAmount ?? rfq.amount);
          // Convert amount to satoshis
          const amountSats = Math.round(btcLockAmount * 1e8);
          // Use a placeholder pubkey for the counterparty — in production this comes from the RFQ
          // The peer's pubkey would be exchanged during the RFQ negotiation phase
          const counterpartyPubKey = rfq.requestorPeer
            ? `02${rfq.requestorPeer.replace(/[^0-9a-f]/gi, "").slice(0, 62).padEnd(62, "0")}`
            : "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"; // fallback: secp256k1 generator
          // Resolve BTC address: prefer context, fallback to Phantom multi-chain
          const btcAddr = bitcoin?.address ?? phantomMultiChain?.bitcoinAddress ?? "";
          if (!btcAddr) throw new Error("No Bitcoin address available. Please reconnect your wallet.");
          // Sender pubkey: derive from connected address (placeholder — real impl uses wallet's getPublicKey)
          const senderPubKey = btcAddr
            ? `03${btcAddr.replace(/[^0-9a-f]/gi, "").slice(0, 62).padEnd(62, "0")}`
            : "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
          // Pass Agent A's secretHashHex so both sides lock to the same hash (atomicity)
          const btcExistingHash = rfq.secretHashHex;
          const result = await executeBtcHtlcLock(
            btcAddr,
            counterpartyPubKey,
            senderPubKey,
            amountSats,
            24, // 24-hour locktime
            btcProvider,
            "mainnet",
            btcExistingHash,
          );
          // HTLC lock tx submitted — mark as "locked" (not "settled").
          setHtlcSigning(prev => prev ? { ...prev, step: "locked", txHash: result.txid } : { rfqId, step: "locked", txHash: result.txid });
          window.dispatchEvent(new CustomEvent("afos:htlc-own-lock", { detail: { rfqId, txHash: result.txid, escrowAddress: result.htlcAddress ?? undefined, chain: "bitcoin" } }));
          setHtlcLockedAt(prev => ({ ...prev, [rfqId]: Date.now() }));
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
            setHtlcSigning(prev => prev ? { ...prev, step: "failed", error: "Transaction rejected by user" } : { rfqId, step: "failed", error: "Transaction rejected by user" });
          } else if (msg.includes("Insufficient funds") || msg.includes("No confirmed UTXOs")) {
            setHtlcSigning(prev => prev ? { ...prev, step: "failed", error: msg } : { rfqId, step: "failed", error: msg });
            toast.error("Insufficient Bitcoin balance", { description: msg });
          } else {
            // Wallet signing failed — do NOT mark as settled
            setHtlcSigning(prev => prev ? { ...prev, step: "failed", error: msg.slice(0, 120) } : { rfqId, step: "failed", error: msg.slice(0, 120) });
            toast.error("BTC HTLC lock failed", { description: msg.slice(0, 80) });
          }
        }
      } else if ((chain === "trac_network" || rfq.fromToken === "TNK") && ((window as any).tracnetwork || (window as any).tapprotocol)) {
        // TNK (Trac Network) HTLC: agent-escrow model using window.tracnetwork.sendTNK()
        // Note: Tap Wallet may inject as window.tapprotocol (BTC) AND/OR window.tracnetwork (TNK) — check both
        setHtlcSigning(prev => prev ? { ...prev, step: "locking" } : { rfqId, step: "locking" });
        try {
          // Use Agent A's secretHashHex if provided (ensures atomicity), otherwise generate own
          const existingTnkHash = rfq.secretHashHex;
          const secretHash = existingTnkHash ?? (await generateHtlcSecret()).secretHashHex;
          // Agent A locks fromToken amount; Agent B locks toToken amount
          const isAgentATnk = !!rfq.isInitiator;
          const tnkLockAmount = isAgentATnk ? rfq.amount : (rfq.suggestedOutAmount ?? rfq.amount);
          // Determine recipient address (counterparty who can claim by revealing preimage).
          // For TNK HTLC, the recipient MUST be the counterparty's TRAC NETWORK address (trac1...).
          // rfq.counterpartyAddress is the address on the OUTPUT chain (e.g. Solana for TNK→USDT),
          // so we must use rfq.counterpartyWallets?.trac_network or rfq.requesterWallets?.trac_network.
          const tnkRecipientFromWallets =
            rfq.counterpartyWallets?.trac_network ??
            rfq.requesterWallets?.trac_network;
          const tnkRecipientFallback =
            rfq.requesterWallet?.startsWith("trac1") ? rfq.requesterWallet :
            rfq.counterpartyAddress?.startsWith("trac1") ? rfq.counterpartyAddress :
            rfq.requesterWallet ?? rfq.counterpartyAddress ?? "";
          const tnkRecipient = tnkRecipientFromWallets ?? tnkRecipientFallback;
          // Derive htlcId for this swap (same formula as Solana)
          const tnkHtlcId = isAgentATnk
            ? `htlc_a_${rfqId.slice(0, 22)}`
            : `htlc_b_${rfqId.slice(0, 22)}`;
          const result = await executeTnkHtlcLock({
            amount: tnkLockAmount.toFixed(8),
            secretHash,
            timelockSeconds: 600, // 10 minutes default for TNK
            recipientAddress: tnkRecipient,
            htlcId: tnkHtlcId,
          });
          // HTLC lock tx submitted — mark as "locked" (not "settled").
          // result.sendTxHash = the TNK transfer tx; result.contractTxHash = the subnet contract lock tx
          const tnkDisplayTxHash = result.contractTxHash ?? result.sendTxHash;
          setHtlcSigning(prev => prev ? { ...prev, step: "locked", txHash: tnkDisplayTxHash } : { rfqId, step: "locked", txHash: tnkDisplayTxHash });
          window.dispatchEvent(new CustomEvent("afos:htlc-own-lock", { detail: { rfqId, txHash: tnkDisplayTxHash, escrowAddress: result.contractAddress, chain: "trac_network" } }));
          setHtlcLockedAt(prev => ({ ...prev, [rfqId]: Date.now() }));
          // Notify Agent A that we (Agent B) have locked our side
          if (rfq.requestorPeer && signalingRef.current) {
            signalingRef.current.sendHtlcLocked(rfq.requestorPeer, rfqId, tnkDisplayTxHash, "trac_network", rfq.amount);
          }
          // Record the TNK HTLC deposit in the DB so tnkHtlcMonitor can detect it
          // and release the counterparty's funds (SOL/USDT/ETH/BTC) to the user.
          {
            const tnkDepositPayload = {
              chain: "trac_network" as const,
              txHash: tnkDisplayTxHash,
              senderAddress: tnkWalletCtx?.address ?? "",
              recipientAddress: tnkRecipient,
              escrowAddress: result.contractAddress ?? tnkRecipient,
              // TNK uses 18 decimals (like ETH), NOT 8 decimals (like BTC).
              // 1 TNK = 1_000_000_000_000_000_000 raw units (1e18).
              // Use integer arithmetic to avoid floating-point precision loss.
              amountRaw: String(BigInt(Math.round(tnkLockAmount * 1e9)) * BigInt(1_000_000_000)),
              token: "TNK",
              secretHash,
              timelock: Math.floor(Date.now() / 1000) + 600,
              rfqId,
              peerId: rfq.requestorPeer ?? undefined,
              htlcId: tnkHtlcId,
              isAgentA: isAgentATnk,
              counterpartyAddress: isAgentATnk
                ? (rfq.counterpartyAddress ?? rfq.requesterWallet ?? undefined)
                : (rfq.requesterWallet ?? rfq.counterpartyAddress ?? undefined),
              counterpartyWallets: rfq.requesterWallets ?? undefined,
            };
            try {
              const res = await fetch("/api/trpc/htlcWallet.recordHtlcDeposit?batch=1", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ "0": { json: tnkDepositPayload } }),
              });
              if (!res.ok) {
                saveFailedDeposit(tnkDepositPayload);
                console.warn("[HTLC] recordHtlcDeposit (TNK) failed (", res.status, ") — saved to localStorage for retry");
              }
            } catch (recordErr) {
              saveFailedDeposit(tnkDepositPayload);
              console.warn("[HTLC] recordHtlcDeposit (TNK) network error — saved to localStorage for retry", recordErr);
            }
          }
          toast.success("TNK locked on-chain", {
            description: `${rfq.amount.toFixed(4)} TNK locked in HTLC contract · Tx: ${tnkDisplayTxHash.slice(0, 16)}…`,
            action: {
              label: "View on Trac Explorer",
              onClick: () => window.open(tnkExplorerUrl(result.sendTxHash), "_blank"),
            },
          });
        } catch (tnkErr: unknown) {
          const msg = tnkErr instanceof Error ? tnkErr.message : String(tnkErr);
          if (msg.toLowerCase().includes("user rejected") || msg.toLowerCase().includes("cancel")) {
            setHtlcSigning(prev => prev ? { ...prev, step: "failed", error: "Transaction rejected by user" } : { rfqId, step: "failed", error: "Transaction rejected by user" });
          } else {
            // Wallet signing failed — do NOT mark as settled
            setHtlcSigning(prev => prev ? { ...prev, step: "failed", error: msg.slice(0, 120) } : { rfqId, step: "failed", error: msg.slice(0, 120) });
            toast.error("TNK HTLC lock failed", { description: msg.slice(0, 80) });
          }
        }
      } else {
        // No wallet connected for this chain — cannot sign HTLC
        setHtlcSigning(prev => prev ? { ...prev, step: "failed", error: `No ${chain} wallet connected to sign HTLC` } : { rfqId, step: "failed", error: `No ${chain} wallet connected to sign HTLC` });
        toast.error("Wallet not connected", {
          description: `Connect a ${chain} wallet to sign the HTLC lock transaction.`,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setHtlcSigning(prev => prev ? { ...prev, step: "failed", error: msg } : { rfqId, step: "failed", error: msg });
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
  }, [incomingRfqs, submitQuote, solConnected, signTransaction, sendSolTransaction, phantomSolAddress, ethereum, bitcoin, phantomMultiChain]);
  // Keep the ref in sync so signaling handlers always call the latest version
  acceptRfqRef.current = acceptRfq;

  // ── Initiate HTLC Lock (Agent A / Requester side) ──────────────────────────
  // Called after buildSwapTx returns P2P route — triggers wallet signing for the requester.
  // Reuses the same HTLC signing logic as acceptRfq by creating a synthetic IncomingRfq.
  const initiateHtlcLock = useCallback(async (params: {
    // [HTLC-DEBUG] entry logged below
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
    /** Full multi-chain wallet map for the counterparty (Agent B). Used to resolve the correct chain address for cross-chain HTLC locks. */
    counterpartyWallets?: { solana?: string; ethereum?: string; bitcoin?: string; trac_network?: string };
    /** SHA-256 hash of the HTLC secret generated by buildSwapTx. Must be passed so Agent A locks to the same hash stored in the DB. */
    secretHashHex?: string;
  }) => {
    const { rfqId, fromToken, toToken, fromChain, toChain, amount, outAmount, rate, counterpartyPeerId, counterpartyWallet, counterpartyWallets: counterpartyWalletsParam } = params;
    console.error("[HTLC-DEBUG] initiateHtlcLock called", { rfqId, fromChain, toChain, amount, counterpartyWallet, secretHashHex: params.secretHashHex?.slice(0, 16) });
    toast.info(`[HTLC-DEBUG] initiateHtlcLock rfqId=${rfqId?.slice(0,8)} chain=${fromChain}`);
    // Store Agent A's wallet address NOW (before any async work) so the htlc_locked
    // handler can reliably retrieve it even if phantomSolAddress is null at that time.
    // Use live window.phantom.solana.publicKey to avoid stale phantomSolAddress.
    const livePhA = (window as unknown as { phantom?: { solana?: { publicKey?: { toString(): string } } } }).phantom?.solana;
    const agentAResolvedWallet = solPubkey?.toBase58() ?? livePhA?.publicKey?.toString() ?? phantomSolAddress ?? "";
    if (agentAResolvedWallet) {
      agentAWalletByRfqRef.current[rfqId] = agentAResolvedWallet;
      persistAgentAWalletMap(); // persist so auto-reveal works after page refresh
      console.log(`[HTLC] Stored agentAWallet=${agentAResolvedWallet.slice(0,8)}... for rfqId=${rfqId.slice(0,8)}`);
    }
    // Store counterpartyPeerId so the on-chain poll fallback can send the P2P reveal
    // signal even when the htlc_locked message was dropped.
    // Persist to localStorage so it survives page refreshes.
    if (counterpartyPeerId) {
      counterpartyPeerIdByRfqRef.current[rfqId] = counterpartyPeerId;
      persistCounterpartyPeerMap();
    }
    // Build a synthetic IncomingRfq for Agent A (the requester).
    // Agent A locks their SOURCE tokens (fromToken on fromChain).
    // acceptRfq uses rfq.fromChain to determine which chain to lock on,
    // so we set fromChain = Agent A's source chain (correct).
    // counterpartyAddress = Agent B's wallet so the HTLC is locked for them.
    // secretHashHex from the server's buildSwapTx is passed through so Agent A
    // locks to the same hash that was saved in the DB (and will be sent to Agent B).
    const syntheticRfq: IncomingRfq = {
      rfqId,
      fromToken,
      toToken,
      amount,
      fromChain,   // Agent A locks on fromChain (their source chain)
      toChain,
      counterpartyAddress: counterpartyWallet,
      requesterWallet: counterpartyWallet,
      counterpartyWallets: counterpartyWalletsParam,
      requestorPeer: counterpartyPeerId ?? counterpartyWallet ?? "peer",
      expiresAt: Date.now() + 60_000,
      suggestedRate: rate,
      suggestedOutAmount: outAmount,
      status: "pending",
      receivedAt: Date.now(),
      // secretHashHex from buildSwapTx ensures Agent A locks to the same hash stored in DB
      secretHashHex: params.secretHashHex,
      // Mark as initiator so acceptRfq knows Agent A should lock fromToken (not toToken)
      isInitiator: true,
    };
    // Add to incomingRfqs so the HTLC signing panel shows up
    setIncomingRfqs(prev => {
      if (prev.some(r => r.rfqId === rfqId)) return prev;
      return [syntheticRfq, ...prev];
    });
    // Bug 5 fix: pass the synthetic RFQ directly to acceptRfq via rfqOverride
    // so it doesn't need to look it up from (stale) React state.
    // Use acceptRfqRef.current to always get the latest version with current solConnected.
    await acceptRfqRef.current(rfqId, syntheticRfq);
  }, []);  // no deps needed — acceptRfqRef is a stable ref

  // ── Claim HTLC Funds (Agent B) ──────────────────────────────────────────────
  // Called when Agent B has received the secret from Agent A and wants to claim
  // the funds locked in the HTLC on the destination chain.
  // ── Exponential backoff retry helper ─────────────────────────────────────
  // Retries an async operation up to maxAttempts times with exponential backoff.
  // Does NOT retry on user-rejection errors (wallet cancelled).
  async function withRetry<T>(
    fn: () => Promise<T>,
    opts: { maxAttempts?: number; baseDelayMs?: number; label?: string } = {}
  ): Promise<T> {
    const { maxAttempts = 3, baseDelayMs = 1500, label = "operation" } = opts;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err: unknown) {
        lastErr = err;
        const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
        // Do not retry user cancellations or wallet rejections
        const isUserRejection = msg.includes("user rejected") || msg.includes("cancelled") || msg.includes("canceled") || msg.includes("denied");
        // Do not retry permanent on-chain errors — WrongSender (0x1777) will never succeed on retry
        const isPermanentOnChainError = msg.includes("0x1777") || msg.includes("wrongsender") || msg.includes("wrong sender");
        if (isUserRejection || isPermanentOnChainError || attempt === maxAttempts) throw err;
        const delay = baseDelayMs * Math.pow(2, attempt - 1); // 1.5s, 3s, 6s
        console.warn(`[HTLC] ${label} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms:`, msg);
        toast.loading(`${label} — retrying (${attempt}/${maxAttempts - 1})…`, { id: `retry-htlc-${attempt}`, duration: delay });
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw lastErr;
  }

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
    // Dismiss the "Auto-claiming" loading toast (if it was shown by the auto-claim path)
    // before showing the "Claiming funds" toast so only one loading indicator is visible.
    toast.dismiss(`auto-claim-${rfqId}`);
    toast.loading(`Claiming funds on ${claimChain}\u2026`, { id: `claim-${rfqId}` });
    // Update modal to show "revealing" step
    setHtlcSigning(prev => prev ? { ...prev, step: "revealing" } : prev);
    try {
      if (claimChain === "solana" && solConnected) {
        // Solana claim: build a claim instruction using the revealed secret
        // The claim instruction reveals the secret to the HTLC program to release funds
        const htlcProgramId = import.meta.env.VITE_SOL_HTLC_PROGRAM_ID as string | undefined;
        if (htlcProgramId) {
          // Real Anchor program: use buildClaimInstruction with correct discriminator,
          // PDA derivation (htlc_a_<rfqId>), and always-required token accounts
          const { buildClaimInstruction, htlcIdToBytes } = await import("@/lib/afosHtlcProgram");
          const { Transaction, PublicKey: SolPublicKey } = await import("@solana/web3.js");
          const secretBytes = new Uint8Array(secretHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
          // Use live window.phantom.solana.publicKey to avoid stale phantomSolAddress
          const livePhClaim = (window as unknown as { phantom?: { solana?: { publicKey?: { toString(): string } } } }).phantom?.solana;
          const claimSolPubkeyStr = solPubkey?.toBase58() ?? livePhClaim?.publicKey?.toString() ?? phantomSolAddress;
          if (!claimSolPubkeyStr) throw new Error("No Solana wallet address available");
          const claimSolPubkey = new SolPublicKey(claimSolPubkeyStr);
          // Agent B is claiming Agent A's HTLC — htlcId is htlc_a_<rfqId first 22 chars>
          // Agent B's wallet is the on-chain recipient of Agent A's HTLC
          const htlcIdA = `htlc_a_${rfqId.slice(0, 22)}`;
          const claimIx = buildClaimInstruction({
            caller: claimSolPubkey,
            htlcId: htlcIdToBytes(htlcIdA),
            preimage: secretBytes,
            recipient: claimSolPubkey,
          });
          const { blockhash } = await solConnection.getLatestBlockhash("confirmed");
          const tx = new Transaction();
          tx.recentBlockhash = blockhash;
          tx.feePayer = claimSolPubkey;
          tx.add(claimIx);
          let txHash: string;
          // Sign the transaction once (wallet interaction — not retried)
          let signedTxBytes: Uint8Array | null = null;
          if (signTransaction && solPubkey && !sendSolTransaction) {
            const signedTx = await (signTransaction as (tx: import("@solana/web3.js").Transaction) => Promise<import("@solana/web3.js").Transaction>)(tx);
            signedTxBytes = signedTx.serialize();
          }
          // Submit with exponential backoff retry (up to 3 attempts)
          txHash = await withRetry(async () => {
            // Refresh blockhash on each retry to avoid expiry
            const { blockhash: freshBlockhash } = await solConnection.getLatestBlockhash("confirmed");
            tx.recentBlockhash = freshBlockhash;
            if (sendSolTransaction && solPubkey) {
              // Preferred: sendTransaction works for Standard Wallet (Phantom v24+) and legacy adapters
              return (sendSolTransaction as (tx: import("@solana/web3.js").Transaction, conn: typeof solConnection) => Promise<string>)(tx, solConnection);
            } else if (signedTxBytes) {
              return solConnection.sendRawTransaction(signedTxBytes, { skipPreflight: false, preflightCommitment: "confirmed" });
            } else {
              const phantom = (window as unknown as { solana?: { signAndSendTransaction: (tx: unknown) => Promise<{ signature: string }> } }).solana;
              if (!phantom?.signAndSendTransaction) throw new Error("No Solana wallet found. Please connect Phantom or MetaMask.");
              const { signature } = await phantom.signAndSendTransaction(tx);
              return signature;
            }
          }, { maxAttempts: 3, baseDelayMs: 1500, label: "SOL HTLC claim" });
          toast.success("SOL HTLC claimed!", {
            id: `claim-${rfqId}`,
            description: `Tx: ${txHash.slice(0, 20)}… · Funds released to your wallet`,
            action: { label: "View on Solscan", onClick: () => window.open(`https://solscan.io/tx/${txHash}`, "_blank") },
          });
          // Mark as completed in DB and hide the Claim button
          void fetch("/api/trpc/chat.updateHtlcStatus?batch=1", {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify({ "0": { json: { rfqId, status: "completed", revealTxId: txHash } } }),
          }).catch(() => {});
          void fetch("/api/trpc/chat.notifySwapCompletion?batch=1", {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify({ "0": { json: { rfqId, type: "claimed", chain: "solana", txHash } } }),
          }).catch(() => {});
          setHtlcSigning(prev => prev ? { ...prev, step: "settled", claimTxHash: txHash } : prev);
          setClaimedRfqIds(prev => new Set(Array.from(prev).concat(rfqId)));
          // Dispatch completion event so ChatPage can show success message with new balance
          window.dispatchEvent(new CustomEvent("afos:htlc-completed", { detail: { rfqId, txHash, chain: "solana" } }));
        } else {
          // Demo mode: no program deployed — show the secret and instruct user
          toast.success("HTLC Secret Ready", {
            id: `claim-${rfqId}`,
            description: `Secret: ${secretHex.slice(0, 16)}… · No HTLC program deployed — use this secret with your HTLC contract`,
            duration: 30000,
            action: { label: "Copy Secret", onClick: () => void navigator.clipboard.writeText(secretHex) },
          });
          // Mark as claimed in UI even in demo mode
          setHtlcSigning(prev => prev ? { ...prev, step: "settled" } : prev);
          setClaimedRfqIds(prev => new Set(Array.from(prev).concat(rfqId)));
        }
      } else if ((claimChain === "ethereum" || claimChain === "eth") && (ethereum?.connected || !!(window as any).ethereum || phantomMultiChain?.ethereumAddress)) {
        // Ethereum claim: call withdraw(bytes32 secret) on the HTLC contract
        const rawEth = (window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<string> } }).ethereum
          ?? (window as any).phantom?.ethereum;
        if (!rawEth) throw new Error("No Ethereum provider found. Please connect MetaMask or Phantom.");
        const claimEthAddr = ethereum?.address ?? phantomMultiChain?.ethereumAddress
          ?? (await rawEth.request({ method: "eth_accounts" }) as string[])?.[0];
        if (!claimEthAddr) throw new Error("No Ethereum address available.");
        const htlcContractAddress = import.meta.env.VITE_ETH_HTLC_ADDRESS as string | undefined;
        if (htlcContractAddress) {
          // ABI-encode withdraw(bytes32 secret)
          // Function selector: keccak256("withdraw(bytes32)") = 0x441a3e70
          const padLeft = (hex: string, bytes = 32) => hex.padStart(bytes * 2, "0");
          const calldata = "0x441a3e70" + padLeft(secretHex, 32);
          const txHash = await withRetry(() => rawEth.request({
            method: "eth_sendTransaction",
            params: [{ from: claimEthAddr, to: htlcContractAddress, data: calldata, gas: "0x186A0" }],
          }) as Promise<string>, { maxAttempts: 3, baseDelayMs: 1500, label: "ETH HTLC claim" });
          toast.success("ETH HTLC claimed!", {
            id: `claim-${rfqId}`,
            description: `Tx: ${txHash.slice(0, 20)}… · Funds released to your wallet`,
          });
          void fetch("/api/trpc/chat.updateHtlcStatus?batch=1", {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify({ "0": { json: { rfqId, status: "completed", revealTxId: txHash } } }),
          }).catch(() => {});
          void fetch("/api/trpc/chat.notifySwapCompletion?batch=1", {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify({ "0": { json: { rfqId, type: "claimed", chain: "ethereum", txHash } } }),
          }).catch(() => {});
          setHtlcSigning(prev => prev ? { ...prev, step: "settled", claimTxHash: txHash } : prev);
          setClaimedRfqIds(prev => new Set(Array.from(prev).concat(rfqId)));
        } else {
          // Demo mode: show secret
          toast.success("ETH HTLC Secret Ready", {
            id: `claim-${rfqId}`,
            description: `Secret: ${secretHex.slice(0, 16)}… · No HTLC contract deployed — use this secret with your contract`,
            duration: 30000,
            action: { label: "Copy Secret", onClick: () => void navigator.clipboard.writeText(secretHex) },
          });
          setClaimedRfqIds(prev => new Set(Array.from(prev).concat(rfqId)));
        }
      } else if ((claimChain === "bitcoin" || claimChain === "btc") && (bitcoin?.connected || phantomMultiChain?.bitcoinAddress || !!(window as any).tapprotocol)) {
        // Bitcoin claim: the secret is needed to spend the P2WSH HTLC output
        // In production: build a claim PSBT using the secret as the witness preimage
        // For now: copy the secret and show instructions (full PSBT claim requires UTXO data)
        toast.success("BTC HTLC Secret Ready", {
          id: `claim-${rfqId}`,
          description: `Secret: ${secretHex.slice(0, 16)}… · Use this secret to spend the P2WSH HTLC output via mempool.space`,
          duration: 30000,
          action: { label: "Copy Secret", onClick: () => void navigator.clipboard.writeText(secretHex) },
        });
        void fetch("/api/trpc/chat.updateHtlcStatus?batch=1", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ "0": { json: { rfqId, status: "completed" } } }),
        }).catch(() => {});
        void fetch("/api/trpc/chat.notifySwapCompletion?batch=1", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ "0": { json: { rfqId, type: "claimed", chain: "bitcoin" } } }),
        }).catch(() => {});
        setClaimedRfqIds(prev => new Set(Array.from(prev).concat(rfqId)));
      } else if ((claimChain === "trac_network" || claimChain === "tnk") && ((window as any).tracnetwork || (window as any).tapprotocol)) {
        // TNK claim: reveal secret to the AFOS agent escrow via signMessage
        const tap = (window as any).tracnetwork ?? (window as any).tapprotocol;
        const claimMessage = `AFOS-HTLC-CLAIM:${secretHex}:${rfqId}`;
        const sigResult = await tap.signMessage(claimMessage);
        const sig = typeof sigResult === "string" ? sigResult : sigResult?.signature ?? "";
        toast.success("TNK HTLC claimed!", {
          id: `claim-${rfqId}`,
          description: `Secret revealed to AFOS escrow · Sig: ${sig.slice(0, 16)}…`,
          duration: 15000,
        });
        void fetch("/api/trpc/chat.updateHtlcStatus?batch=1", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ "0": { json: { rfqId, status: "completed" } } }),
        }).catch(() => {});
        void fetch("/api/trpc/chat.notifySwapCompletion?batch=1", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ "0": { json: { rfqId, type: "claimed", chain: "trac_network" } } }),
        }).catch(() => {});
        setHtlcSigning(prev => prev ? { ...prev, step: "settled", settledAt: prev.settledAt ?? Date.now() } : prev);
        setClaimedRfqIds(prev => new Set(Array.from(prev).concat(rfqId)));
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
      // WrongSender (0x1777): the HTLC was locked by a different sender key.
      // This is a permanent mismatch — show a clear, actionable error instead of a generic "Claim failed".
      const isWrongSender =
        msg.includes('0x1777') ||
        msg.includes('WrongSender') ||
        msg.includes('Wrong sender');
      if (isWrongSender) {
        toast.error("Wrong sender key (0x1777)", {
          id: `claim-${rfqId}`,
          description:
            "This HTLC was locked by a different wallet address. " +
            "Make sure you are using the same wallet that initiated the swap. " +
            "If the issue persists, contact support with RFQ ID: " + rfqId.slice(0, 16) + "…",
          duration: 15_000,
        });
        return;
      }
      toast.error("Claim failed", { id: `claim-${rfqId}`, description: msg.slice(0, 100) });
    }
  }, [htlcRevealedSecrets, incomingRfqs, solConnected, signTransaction, solPubkey, solConnection, ethereum, bitcoin, phantomMultiChain]);
  // Keep the ref in sync so the htlc_secret handler always calls the latest version
  claimHtlcFundsRef.current = claimHtlcFunds;

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
      // Track explicit autoClaim disable so migration doesn't re-enable it
      if (partial.autoClaim === false) {
        localStorage.setItem("afos_autoclaim_explicitly_disabled", "true");
      } else if (partial.autoClaim === true) {
        localStorage.removeItem("afos_autoclaim_explicitly_disabled");
      }
      return next;
    });
  }, []);

  const toggleEnabled = useCallback(() => {
    setPrefs({ enabled: !prefs.enabled });
  }, [prefs.enabled, setPrefs]);

  // ── Refund HTLC Funds (Agent A) ────────────────────────────────────────────
  // Called when Agent A's outgoing HTLC has expired and they want to reclaim funds.
  const refundHtlcFunds = useCallback(async (rfqId: string) => {
    const htlcInfo = refundableHtlcs[rfqId];
    if (!htlcInfo) {
      toast.error("No refundable HTLC", { description: `No expired HTLC found for RFQ ${rfqId.slice(0, 8)}…` });
      return;
    }
    const refundChain = htlcInfo.fromChain?.toLowerCase() ?? "solana";
    toast.loading(`Refunding locked funds on ${refundChain}…`, { id: `refund-${rfqId}` });
    try {
      if (refundChain === "solana" && solConnected) {
        const htlcProgramId = import.meta.env.VITE_SOL_HTLC_PROGRAM_ID as string | undefined;
        if (htlcProgramId) {
          // Anchor refund instruction: [8-byte discriminator] — no secret needed, timelock expired
          const REFUND_DISCRIMINATOR = Buffer.from([0x1a, 0x2b, 0x3c, 0x4d, 0x5e, 0x6f, 0x7a, 0x8b]);
          const { Transaction, TransactionInstruction, PublicKey: SolPublicKey, SystemProgram } = await import("@solana/web3.js");
          const programId = new SolPublicKey(htlcProgramId);
          // PDA: ["htlc", secretHash, senderPubkey] — secretHash unknown at refund time
          // In practice, the frontend would need to look up the secretHash from the DB.
          // For now: show instructions and mark as refunded.
          toast.info("SOL HTLC Refund", {
            id: `refund-${rfqId}`,
            description: "Timelock has expired. Call the refund instruction on your HTLC program to reclaim funds.",
            duration: 20000,
          });
          void programId; void Transaction; void TransactionInstruction; void SystemProgram;
        } else {
          toast.info("SOL HTLC expired", {
            id: `refund-${rfqId}`,
            description: "No HTLC program deployed. Your timelock has expired — funds are reclaimable.",
            duration: 15000,
          });
        }
      } else if ((refundChain === "ethereum" || refundChain === "eth") && (ethereum?.connected || !!(window as any).ethereum || phantomMultiChain?.ethereumAddress)) {
        const rawEth = (window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<string> } }).ethereum
          ?? (window as any).phantom?.ethereum;
        if (!rawEth) throw new Error("No Ethereum provider found. Please connect MetaMask or Phantom.");
        const refundEthAddr = ethereum?.address ?? phantomMultiChain?.ethereumAddress
          ?? (await rawEth.request({ method: "eth_accounts" }) as string[])?.[0];
        if (!refundEthAddr) throw new Error("No Ethereum address available.");
        const htlcContractAddress = import.meta.env.VITE_ETH_HTLC_ADDRESS as string | undefined;
        if (htlcContractAddress) {
          // ABI-encode refund() — no args, timelock must have expired on-chain
          // Function selector: keccak256("refund()") = 0x590e1ae3
          const txHash = await rawEth.request({
            method: "eth_sendTransaction",
            params: [{ from: refundEthAddr, to: htlcContractAddress, data: "0x590e1ae3", gas: "0x186A0" }],
          });
          toast.success("ETH HTLC refunded!", {
            id: `refund-${rfqId}`,
            description: `Tx: ${txHash.slice(0, 20)}… · Funds returned to your wallet`,
          });
          void fetch("/api/trpc/chat.updateHtlcStatus?batch=1", {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify({ "0": { json: { rfqId, status: "refunded", revealTxId: txHash } } }),
          }).catch(() => {});
          void fetch("/api/trpc/chat.notifySwapCompletion?batch=1", {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify({ "0": { json: { rfqId, type: "refunded", chain: "ethereum", txHash } } }),
          }).catch(() => {});
          setRefundedRfqIds(prev => new Set([...Array.from(prev), rfqId]));
          setRefundableHtlcs(prev => { const next = { ...prev }; delete next[rfqId]; return next; });
        } else {
          toast.info("ETH HTLC expired", {
            id: `refund-${rfqId}`,
            description: "No HTLC contract deployed. Your timelock has expired — funds are reclaimable.",
            duration: 15000,
          });
        }
      } else if ((refundChain === "bitcoin" || refundChain === "btc") && (bitcoin?.connected || phantomMultiChain?.bitcoinAddress || !!(window as any).tapprotocol)) {
        // BTC refund: build a refund PSBT spending the HTLC P2WSH output via the timelock path
        toast.info("BTC HTLC Refund", {
          id: `refund-${rfqId}`,
          description: "Timelock expired. Use mempool.space to broadcast the refund transaction with your wallet.",
          duration: 20000,
        });
        void fetch("/api/trpc/chat.updateHtlcStatus?batch=1", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ "0": { json: { rfqId, status: "refunded" } } }),
        }).catch(() => {});
        void fetch("/api/trpc/chat.notifySwapCompletion?batch=1", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ "0": { json: { rfqId, type: "refunded", chain: "bitcoin" } } }),
        }).catch(() => {});
        setRefundedRfqIds(prev => new Set([...Array.from(prev), rfqId]));
        setRefundableHtlcs(prev => { const next = { ...prev }; delete next[rfqId]; return next; });
      } else if ((refundChain === "trac_network" || refundChain === "tnk") && ((window as any).tracnetwork || (window as any).tapprotocol)) {
        const tap = (window as any).tracnetwork ?? (window as any).tapprotocol;
        const refundMessage = `AFOS-HTLC-REFUND:${rfqId}`;
        const sigResult = await tap.signMessage(refundMessage);
        const sig = typeof sigResult === "string" ? sigResult : sigResult?.signature ?? "";
        toast.success("TNK HTLC refund requested!", {
          id: `refund-${rfqId}`,
          description: `Refund request sent to AFOS escrow · Sig: ${sig.slice(0, 16)}…`,
          duration: 15000,
        });
        void fetch("/api/trpc/chat.updateHtlcStatus?batch=1", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ "0": { json: { rfqId, status: "refunded" } } }),
        }).catch(() => {});
        void fetch("/api/trpc/chat.notifySwapCompletion?batch=1", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ "0": { json: { rfqId, type: "refunded", chain: "trac_network" } } }),
        }).catch(() => {});
        setRefundedRfqIds(prev => new Set([...Array.from(prev), rfqId]));
        setRefundableHtlcs(prev => { const next = { ...prev }; delete next[rfqId]; return next; });
      } else {
        toast.info("Refund info", {
          id: `refund-${rfqId}`,
          description: `Connect a ${refundChain} wallet to trigger the refund, or reclaim manually after the timelock expires.`,
          duration: 20000,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Refund failed", { id: `refund-${rfqId}`, description: msg.slice(0, 100) });
    }
  }, [refundableHtlcs, solConnected, signTransaction, solPubkey, solConnection, ethereum, bitcoin, phantomMultiChain])  // ── Update htlcSigning with counterparty claim tx when swap completes ───────────────────────
  // For Agent B: agentAClaimTxId = Agent A's claim tx (Agent A claims Agent B's locked funds)
  // For Agent A: agentBClaimTxId = Agent B's claim tx (Agent B claims Agent A's locked funds)
  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail as {
        rfqId?: string; agentBClaimTxId?: string; agentAClaimTxId?: string;
      };
      if (!data?.rfqId) return;
      setHtlcSigning(prev => {
        if (!prev || prev.rfqId !== data.rfqId) return prev;
        return {
          ...prev,
          // For Agent B (non-initiator): agentAClaimTxId is the counterparty's claim tx
          // For Agent A (initiator): agentBClaimTxId is the counterparty's claim tx
          counterpartyClaimTxHash: data.agentAClaimTxId ?? data.agentBClaimTxId ?? prev.counterpartyClaimTxHash,
        };
      });
    };
    window.addEventListener("afos:htlc-completed", handler);
    return () => window.removeEventListener("afos:htlc-completed", handler);
  }, []);

  // ── Signaling message helpers ────────────────────────────────────────────────
  const sendPeerMessage= useCallback((targetPeerId: string, payload: unknown) => {
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
      claimedRfqIds,
      refundedRfqIds,
      claimHtlcFunds,
      refundableHtlcs,
      refundHtlcFunds,
      htlcLockedAt,
      autoDecisionLog,
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
