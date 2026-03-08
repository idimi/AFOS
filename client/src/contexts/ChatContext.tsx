/**
 * ChatContext — Shared conversation state between MiniChatWidget (Overview) and ChatPage (Agent).
 * Both views read/write from the same messages array so the conversation is persistent and synced.
 */
import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";

export type SupportedChain = "solana" | "ethereum" | "bitcoin" | "trac_network";

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
  type?: "text" | "quote_card" | "tx_success" | "error" | "limit_exceeded" | "incoming_rfq" | "peer_searching";
  quoteData?: QuoteData;
  txHash?: string;
  timestamp: number;
  limitWarning?: string;
  limitExceededData?: { blockedAmountUsd: number; limitUsd: number };
  /** Badge shown on quote_card: 'p2p' | 'dex' | undefined */
  routeBadge?: "p2p" | "dex";
  /** Matched peer alias for P2P quote cards */
  matchedPeerAlias?: string;
  /** DEX name used for fallback (e.g. 'Jupiter', '0x', '1inch') */
  dexName?: string;
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
  const [messages, setMessages] = useState<ChatMessage[]>([makeWelcomeMessage(false)]);
  const [isTyping, setIsTyping] = useState(false);
  const welcomeShownRef = useRef(false);

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
    setMessages([makeWelcomeMessage(connected)]);
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
