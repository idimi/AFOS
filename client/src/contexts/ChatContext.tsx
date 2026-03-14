/**
 * ChatContext — Shared conversation state between MiniChatWidget (Overview) and ChatPage (Agent).
 * Both views read/write from the same messages array so the conversation is persistent and synced.
 *
 * Persistence: messages are serialised to localStorage under CHAT_STORAGE_KEY on every change
 * and rehydrated on mount. This means signedBy, txHash, balancesAfterSwap, and all other
 * message fields survive page refreshes.
 *
 * Storage limits: we keep at most MAX_STORED_MESSAGES recent messages and prune older ones
 * automatically to avoid hitting the ~5 MB localStorage quota.
 */
import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react";

import type { SupportedChain } from "@/lib/afosApi";
export type { SupportedChain } from "@/lib/afosApi";

// ─── Storage constants ────────────────────────────────────────────────────────
const CHAT_STORAGE_KEY = "afos_chat_history";
/** Maximum number of messages to persist (older ones are pruned) */
const MAX_STORED_MESSAGES = 200;

export interface QuoteData {
  fromToken: string;
  fromChain?: SupportedChain;
  toToken: string;
  toChain?: SupportedChain;
  fromAmount: number;
  toAmount: number;
  netToAmount?: number;
  fromAmountUsd: number;
  toAmountUsd: number;
  rate: number;
  priceImpact: number;
  platformFee: number;
  platformFeeUsd: number;
  platformFeeOut?: number;
  feeBps?: number;
  feeToken?: string;
  route: string;
  quoteResponse: unknown;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  type?: "text" | "quote_card" | "tx_success" | "swap_complete" | "error" | "limit_exceeded" | "incoming_rfq" | "peer_searching" | "swap_progress" | "tnk_sign_card";
  quoteData?: QuoteData;
  txHash?: string;
  timestamp: number;
  limitWarning?: string;
  limitExceededData?: { blockedAmountUsd: number; limitUsd: number };
  /** Updated balances to show after a swap completes */
  balancesAfterSwap?: Array<{ symbol: string; amount: string; usdValue: number }>;
  /** Wallet that signed the swap — shown in TxSuccessCard for audit trail */
  signedBy?: { name: string; address: string };
  /** Badge shown on quote_card: 'p2p' | 'dex' | undefined */
  routeBadge?: "p2p" | "dex";
  /** Matched peer alias for P2P quote cards */
  matchedPeerAlias?: string;
  /** DEX name used for fallback (e.g. 'Jupiter', '0x', '1inch') */
  dexName?: string;
  /** Live swap progress data — updated in-place as phases advance */
  swapProgressData?: {
    rfqId: string;
    fromAmount: number;
    fromToken: string;
    toAmount: number;
    toToken: string;
    phase: "broadcasting" | "negotiating" | "locking" | "settling" | "confirmed" | "failed" | "expired";
    peerAlias?: string;
    txHash?: string;
    expiresAt?: number; // unix ms — HTLC lock expiry
    errorMsg?: string;
    rate?: number;       // exchange rate (toAmount / fromAmount)
    fromChain?: string; // source chain
    toChain?: string;   // destination chain
    startedAt?: number; // unix ms — when the swap started
    agentBClaimTxId?: string; // Agent A's SOL escrow claim tx (Agent B receives fromToken)
    agentAClaimTxId?: string; // Agent B's USDT escrow claim tx (Agent A receives toToken)
    confirmedAt?: number; // unix ms — when the swap was confirmed on-chain
    lockTxId?: string;    // Agent A's own lock tx hash (fromChain)
    peerLockTxId?: string; // Agent B's lock tx hash (toChain) — received via htlc_locked event
    htlcEscrowAddress?: string; // HTLC escrow/PDA address on fromChain
  };
  /** TNK→SOL HTLC sign card data — shown when buildSwapTx returns route "AFOS TNK→SOL HTLC" */
  tnkSignCardData?: {
    tnkLockTxPayload: string;
    htlcIdA: string;
    htlcIdB: string;
    rfqId: string;
    tnkAmount?: number;
    outAmount?: number;
    toToken?: string;
  };
  incomingRfqData?: {
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
    expiresAt: number;
  };
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

function loadMessages(): ChatMessage[] | null {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatMessage[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveMessages(msgs: ChatMessage[]): void {
  try {
    // Keep only the most recent MAX_STORED_MESSAGES to avoid quota issues
    const toStore = msgs.length > MAX_STORED_MESSAGES
      ? msgs.slice(msgs.length - MAX_STORED_MESSAGES)
      : msgs;
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(toStore));
  } catch {
    // Quota exceeded or private browsing — silently ignore
  }
}

// ─── Welcome message factory ──────────────────────────────────────────────────

export function makeWelcomeMessage(connected: boolean): ChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    content: connected
      ? "Hi! I'm AFOS. Try: *swap 0.01 BTC to USDT*, *swap 100 USDT to ETH*, *swap 500 TNK to SOL*, or *how much SOL can I get for $500?*"
      : "Hi! I'm AFOS, your autonomous financial agent. Connect your wallet to start swapping — e.g. *swap 0.01 BTC to USDT*, *swap 100 USDT to ETH*, *swap 500 TNK to SOL*, or *bridge 1 SOL to Bitcoin*.",
    type: "text",
    timestamp: Date.now(),
  };
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface ChatContextValue {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  addMessage: (msg: Omit<ChatMessage, "id" | "timestamp">) => void;
  /** Reset conversation to a single fresh welcome message */
  clearMessages: (connected?: boolean) => void;
  isTyping: boolean;
  setIsTyping: (v: boolean) => void;
  /** Track whether the wallet-connected welcome has been shown this session */
  welcomeShownRef: React.MutableRefObject<boolean>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  // Initialise from localStorage on first render; fall back to welcome message
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const stored = loadMessages();
    return stored ?? [makeWelcomeMessage(false)];
  });
  const [isTyping, setIsTyping] = useState(false);
  const welcomeShownRef = useRef(false);

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  const addMessage = useCallback((msg: Omit<ChatMessage, "id" | "timestamp">) => {
    const newMsg: ChatMessage = {
      ...msg,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, newMsg]);
  }, []);

  const clearMessages = useCallback((connected = false) => {
    welcomeShownRef.current = false;
    const welcome = makeWelcomeMessage(connected);
    setMessages([welcome]);
    // Also clear storage so the next load starts fresh
    try { localStorage.removeItem(CHAT_STORAGE_KEY); } catch { /* ignore */ }
  }, []);

  return (
    <ChatContext.Provider value={{ messages, setMessages, addMessage, clearMessages, isTyping, setIsTyping, welcomeShownRef }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
