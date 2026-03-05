/**
 * AFOS Chat Page — Conversational Swap Agent
 * Users chat with the AI agent in natural language to execute swaps.
 * "swap 1 USDT to SOL" → agent parses → shows quote → user confirms → Phantom signs → on-chain
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Send, Wallet, ArrowLeftRight, CheckCircle2,
  Loader2, ExternalLink, AlertTriangle, Zap, RefreshCw,
  TrendingUp, X, ChevronDown, Sparkles, ShieldAlert, Settings
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useWallet } from "@/contexts/WalletContext";
import { useMultiChainWallet } from "@/contexts/MultiChainWalletContext";
import { useAuth } from "@/_core/hooks/useAuth";
import ConnectWalletModal from "../components/ConnectWalletModal";
import { Connection, VersionedTransaction } from "@solana/web3.js";
import { Link } from "wouter";

// ─── Types ────────────────────────────────────────────────────────────────────

type SupportedChain = "solana" | "ethereum" | "bitcoin";

interface QuoteData {
  fromToken: string;
  fromChain?: SupportedChain;
  toToken: string;
  toChain?: SupportedChain;
  fromAmount: number;
  toAmount: number;
  netToAmount?: number;    // what user actually receives after fee
  fromAmountUsd: number;
  toAmountUsd: number;
  rate: number;
  priceImpact: number;
  platformFee: number;
  platformFeeUsd: number;
  platformFeeOut?: number; // fee in toToken units
  feeBps?: number;         // 15 for P2P, 20 for DEX
  feeToken?: string;
  route: string;
  quoteResponse: unknown;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  type?: "text" | "quote_card" | "tx_success" | "error" | "limit_exceeded";
  quoteData?: QuoteData;
  txHash?: string;
  timestamp: number;
  /** Soft warning: amount is near or over the user's maxTxAmountUsd */
  limitWarning?: string;
  /** For limit_exceeded messages: the blocked amount and the user's limit */
  limitExceededData?: { blockedAmountUsd: number; limitUsd: number };
}

// ─── Suggestion chips ─────────────────────────────────────────────────────────
const SUGGESTIONS = [
  "swap 1 USDT to SOL",
  "swap 0.1 SOL to USDT",
  "what's the SOL price?",
  "show my balances",
  "swap 10 USDT to USDC",
];

// ─── Fallback token → chain (only used when quoteData.fromChain is missing) ──
const TOKEN_CHAIN_FALLBACK: Record<string, SupportedChain> = {
  SOL: "solana",
  BTC: "bitcoin",
  ETH: "ethereum",
  // USDT/USDC intentionally omitted — ambiguous without chain context, defaults to "solana"
};

// ─── Token colors ─────────────────────────────────────────────────────────────
const TOKEN_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  SOL: { bg: "rgba(153,69,255,0.15)", text: "#9945FF", border: "rgba(153,69,255,0.3)" },
  USDT: { bg: "rgba(38,161,123,0.15)", text: "#26a17b", border: "rgba(38,161,123,0.3)" },
  USDC: { bg: "rgba(39,117,202,0.15)", text: "#2775CA", border: "rgba(39,117,202,0.3)" },
  BTC: { bg: "rgba(247,147,26,0.15)", text: "#F7931A", border: "rgba(247,147,26,0.3)" },
  ETH: { bg: "rgba(98,126,234,0.15)", text: "#627EEA", border: "rgba(98,126,234,0.3)" },
};

function TokenBadge({ symbol }: { symbol: string }) {
  const c = TOKEN_COLORS[symbol] || { bg: "rgba(100,100,100,0.15)", text: "#aaa", border: "rgba(100,100,100,0.3)" };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
      {symbol}
    </span>
  );
}

// ─── Route Badge ────────────────────────────────────────────────────────────
// Shows which execution route was selected: IntercomSwap P2P, Jupiter, 1inch, or Direct HTLC
const ROUTE_STYLES: Record<string, { bg: string; text: string; border: string; dot: string; label: string }> = {
  p2p: {
    bg:     "rgba(20,241,149,0.12)",
    text:   "#14F195",
    border: "rgba(20,241,149,0.3)",
    dot:    "#14F195",
    label:  "IntercomSwap P2P",
  },
  jupiter: {
    bg:     "rgba(153,69,255,0.12)",
    text:   "#9945FF",
    border: "rgba(153,69,255,0.3)",
    dot:    "#9945FF",
    label:  "Jupiter DEX",
  },
  oneinch: {
    bg:     "rgba(98,126,234,0.12)",
    text:   "#627EEA",
    border: "rgba(98,126,234,0.3)",
    dot:    "#627EEA",
    label:  "1inch",
  },
  htlc: {
    bg:     "rgba(247,147,26,0.12)",
    text:   "#F7931A",
    border: "rgba(247,147,26,0.3)",
    dot:    "#F7931A",
    label:  "Direct HTLC",
  },
  default: {
    bg:     "rgba(100,100,100,0.12)",
    text:   "#aaa",
    border: "rgba(100,100,100,0.3)",
    dot:    "#aaa",
    label:  "Aggregator",
  },
};

function getRouteStyle(route: string) {
  const r = route.toLowerCase();
  if (r.includes("p2p") || r.includes("intercomswap")) return ROUTE_STYLES.p2p;
  if (r.includes("jupiter"))  return ROUTE_STYLES.jupiter;
  if (r.includes("1inch"))    return ROUTE_STYLES.oneinch;
  if (r.includes("htlc"))     return ROUTE_STYLES.htlc;
  return ROUTE_STYLES.default;
}

function RouteBadge({ route }: { route: string }) {
  const s = getRouteStyle(route);
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}` }}
      title={route}
    >
      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: s.dot }} />
      {s.label}
    </span>
  );
}

// ─── Chain Pill ───────────────────────────────────────────────────────────────
// Shows source → destination chain for cross-chain swaps
const CHAIN_PILL_STYLES: Record<string, { color: string; label: string }> = {
  solana:   { color: "#9945FF", label: "SOL" },
  ethereum: { color: "#627EEA", label: "ETH" },
  bitcoin:  { color: "#F7931A", label: "BTC" },
};

function ChainPill({ fromChain, toChain }: { fromChain?: string; toChain?: string }) {
  if (!fromChain || !toChain || fromChain === toChain) return null;
  const from = CHAIN_PILL_STYLES[fromChain] ?? { color: "#aaa", label: fromChain.toUpperCase() };
  const to   = CHAIN_PILL_STYLES[toChain]   ?? { color: "#aaa", label: toChain.toUpperCase() };
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#ccc" }}>
      <span style={{ color: from.color }}>{from.label}</span>
      <span className="opacity-50">→</span>
      <span style={{ color: to.color }}>{to.label}</span>
    </span>
  );
}

// // ─── Quote Card ──────────────────────────────────────────────────────────
function QuoteCard({
  data,
  onConfirm,
  onCancel,
  isExecuting,
  onRequestConnect,
  limitWarning,
}: {
  data: QuoteData;
  onConfirm: () => void;
  onCancel: () => void;
  isExecuting: boolean;
  onRequestConnect: () => void;
  limitWarning?: string;
}) {
  const { connected } = useWallet();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="rounded-2xl overflow-hidden mt-2"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2 flex-wrap"
        style={{ borderBottom: "1px solid var(--border)", background: "rgba(6,182,212,0.05)" }}>
        <Zap className="w-4 h-4 text-cyan-400" />
        <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">Swap Quote</span>
        <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
          <ChainPill fromChain={data.fromChain} toChain={data.toChain} />
          <RouteBadge route={data.route} />
        </div>
      </div>

      {/* Swap summary */}
      <div className="px-4 py-4 space-y-3">
        {/* From → To */}
        <div className="flex items-center gap-3">
          <div className="flex-1 rounded-xl p-3 text-center"
            style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
            <p className="text-[10px] text-muted-foreground mb-1">You pay</p>
            <p className="text-xl font-bold text-foreground font-mono">{data.fromAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}</p>
            <div className="flex justify-center mt-1"><TokenBadge symbol={data.fromToken} /></div>
            <p className="text-[10px] text-muted-foreground mt-1">${data.fromAmountUsd.toFixed(2)}</p>
          </div>

          <div className="flex flex-col items-center gap-1">
            <ArrowLeftRight className="w-4 h-4 text-muted-foreground" />
          </div>

          <div className="flex-1 rounded-xl p-3 text-center"
            style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)" }}>
            <p className="text-[10px] text-muted-foreground mb-1">You receive</p>
            <p className="text-xl font-bold text-emerald-400 font-mono">{(data.netToAmount ?? data.toAmount).toLocaleString(undefined, { maximumFractionDigits: 6 })}</p>
            <div className="flex justify-center mt-1"><TokenBadge symbol={data.toToken} /></div>
            <p className="text-[10px] text-muted-foreground mt-1">${data.toAmountUsd.toFixed(2)}</p>
          </div>
        </div>

        {/* Details */}
        <div className="space-y-1.5 text-xs">
          {[
            { label: "Rate", value: `1 ${data.fromToken} = ${data.rate.toFixed(6)} ${data.toToken}` },
            { label: "Price Impact", value: `${data.priceImpact.toFixed(3)}%`, warn: data.priceImpact > 1 },
          ].map(row => (
            <div key={row.label} className="flex items-center justify-between">
              <span className="text-muted-foreground">{row.label}</span>
              <span className={row.warn ? "text-amber-400" : "text-foreground font-mono"}>{row.value}</span>
            </div>
          ))}
          {/* Fee breakdown row */}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              AFOS Fee ({data.feeBps != null ? `${(data.feeBps / 100).toFixed(2)}%` : "0.20%"})
              {data.feeBps === 15 && (
                <span className="ml-1 text-[9px] px-1 py-0.5 rounded" style={{ background: "rgba(20,241,149,0.15)", color: "#14F195" }}>P2P</span>
              )}
              {data.feeBps === 20 && (
                <span className="ml-1 text-[9px] px-1 py-0.5 rounded" style={{ background: "rgba(153,69,255,0.15)", color: "#9945FF" }}>DEX</span>
              )}
            </span>
            <span className="text-foreground font-mono">
              {data.platformFeeOut != null
                ? `${data.platformFeeOut.toFixed(6)} ${data.feeToken ?? data.toToken}`
                : `${data.platformFee.toFixed(6)} ${data.fromToken}`}
              {" "}(${data.platformFeeUsd.toFixed(4)})
            </span>
          </div>
        </div>

        {/* Warning for high price impact */}
        {data.priceImpact > 1 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
            style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)" }}>
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-amber-300">High price impact. Consider splitting into smaller swaps.</span>
          </div>
        )}

        {/* Near-limit warning banner */}
        {limitWarning && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-xl text-xs"
            style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)" }}>
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="text-amber-300">{limitWarning}</span>
              <Link href="/settings" className="ml-2 text-amber-400 underline hover:text-amber-300 transition-colors">Adjust limit</Link>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 pb-4 flex gap-2">
        <button
          onClick={onCancel}
          disabled={isExecuting}
          className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all text-muted-foreground hover:text-foreground"
          style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
          Cancel
        </button>
        {connected ? (
          <button
            onClick={onConfirm}
            disabled={isExecuting}
            className="flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
            style={{
              background: isExecuting ? "rgba(16,185,129,0.1)" : "linear-gradient(135deg, #9945FF, #14F195)",
              color: isExecuting ? "#10b981" : "white",
              border: isExecuting ? "1px solid rgba(16,185,129,0.3)" : "none",
            }}>
            {isExecuting ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Signing…</>
            ) : (
              <><CheckCircle2 className="w-3.5 h-3.5" /> Confirm Swap</>
            )}
          </button>
        ) : (
          <button
            onClick={onRequestConnect}
            className="flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
            style={{ background: "rgba(153,69,255,0.2)", border: "1px solid rgba(153,69,255,0.4)", color: "#9945FF" }}>
            <Wallet className="w-3.5 h-3.5" />
            Connect Wallet to Swap
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── Limit Exceeded Card ────────────────────────────────────────────────────
function LimitExceededCard({ blockedAmountUsd, limitUsd }: { blockedAmountUsd: number; limitUsd: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="rounded-2xl p-4 mt-2"
      style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}
    >
      <div className="flex items-center gap-2 mb-2">
        <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
        <span className="text-sm font-bold text-red-400">Transaction Limit Exceeded</span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        This swap (~<strong className="text-foreground">${blockedAmountUsd.toFixed(2)}</strong>) exceeds your
        configured maximum of <strong className="text-foreground">${limitUsd}</strong>.
        Reduce the amount or raise your limit in Settings.
      </p>
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors"
      >
        <Settings className="w-3.5 h-3.5" />
        Open Settings
      </Link>
    </motion.div>
  );
}

// ─── Tx Success Card ──────────────────────────────────────────────────────────
function TxSuccessCard({ txHash, fromToken, toToken, fromAmount, toAmount, fromChain }: {
  txHash: string;
  fromToken: string;
  toToken: string;
  fromAmount: number;
  toAmount: number;
  fromChain?: string;
}) {
  // Determine explorer URL and label based on chain
  const chain = fromChain?.toLowerCase() ?? (fromToken === "BTC" ? "bitcoin" : fromToken === "ETH" ? "ethereum" : "solana");
  const { explorerUrl, explorerLabel } = (() => {
    if (chain === "bitcoin") {
      // mempool.space for BTC txids; rfqIds won't be valid txids but show gracefully
      const isTxid = /^[0-9a-f]{64}$/i.test(txHash);
      return {
        explorerUrl: isTxid ? `https://mempool.space/tx/${txHash}` : `https://mempool.space`,
        explorerLabel: isTxid ? `View on mempool.space: ${txHash.slice(0, 8)}…${txHash.slice(-8)}` : "View on mempool.space",
      };
    }
    if (chain === "ethereum") {
      const isTxHash = /^0x[0-9a-f]{64}$/i.test(txHash);
      return {
        explorerUrl: isTxHash ? `https://etherscan.io/tx/${txHash}` : `https://etherscan.io`,
        explorerLabel: isTxHash ? `View on Etherscan: ${txHash.slice(0, 10)}…${txHash.slice(-8)}` : "View on Etherscan",
      };
    }
    // Solana default
    return {
      explorerUrl: `https://solscan.io/tx/${txHash}`,
      explorerLabel: `View on Solscan: ${txHash.slice(0, 8)}…${txHash.slice(-8)}`,
    };
  })();

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-2xl p-4 mt-2"
      style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
        <span className="text-sm font-bold text-emerald-400">Swap Confirmed!</span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Swapped {fromAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} <strong className="text-foreground">{fromToken}</strong> {"→"}{" "}
        {toAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} <strong className="text-foreground">{toToken}</strong>
      </p>
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        {explorerLabel}
      </a>
    </motion.div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────
function MessageBubble({
  msg,
  onConfirmSwap,
  onCancelSwap,
  executingId,
  onRequestConnect,
}: {
  msg: ChatMessage;
  onConfirmSwap: (msgId: string, quoteData: QuoteData) => void;
  onCancelSwap: (msgId: string) => void;
  executingId: string | null;
  onRequestConnect: (fromToken: string, fromChain?: SupportedChain) => void;
}) {
  const isUser = msg.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
      {/* Avatar */}
      {!isUser && (
        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-1"
          style={{ background: "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(139,92,246,0.2))", border: "1px solid rgba(6,182,212,0.3)" }}>
          <Bot className="w-4 h-4 text-cyan-400" />
        </div>
      )}

      <div className={`flex-1 max-w-[85%] ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        {/* Text bubble */}
        <div
          className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${isUser ? "rounded-tr-sm" : "rounded-tl-sm"}`}
          style={{
            background: isUser
              ? "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(139,92,246,0.2))"
              : "var(--card)",
            border: isUser
              ? "1px solid rgba(6,182,212,0.3)"
              : "1px solid var(--border)",
            color: "var(--foreground)",
          }}
        >
          {msg.content}
        </div>

        {/* Quote card (inline) */}
        {msg.type === "quote_card" && msg.quoteData && executingId !== msg.id && (
          <div className="w-full mt-1">
            <QuoteCard
              data={msg.quoteData}
              onConfirm={() => onConfirmSwap(msg.id, msg.quoteData!)}
              onCancel={() => onCancelSwap(msg.id)}
              isExecuting={executingId === msg.id}
              onRequestConnect={() => onRequestConnect(msg.quoteData!.fromToken, msg.quoteData!.fromChain)}
              limitWarning={msg.limitWarning}
            />
          </div>
        )}

        {/* Limit exceeded card */}
        {msg.type === "limit_exceeded" && msg.limitExceededData && (
          <div className="w-full mt-1">
            <LimitExceededCard
              blockedAmountUsd={msg.limitExceededData.blockedAmountUsd}
              limitUsd={msg.limitExceededData.limitUsd}
            />
          </div>
        )}

        {/* Tx success */}
        {msg.type === "tx_success" && msg.txHash && msg.quoteData && (
          <TxSuccessCard
            txHash={msg.txHash}
            fromToken={msg.quoteData.fromToken}
            toToken={msg.quoteData.toToken}
            fromAmount={msg.quoteData.fromAmount}
            toAmount={msg.quoteData.toAmount}
            fromChain={msg.quoteData.fromChain}
          />
        )}

        {/* Timestamp */}
        <span className="text-[10px] text-muted-foreground mt-1 px-1">
          {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </motion.div>
  );
}

// ─── Main ChatPage ─────────────────────────────────────────────────────────────
export default function ChatPage() {
  const { connected, shortAddress, walletName, balances, totalUsd, connect, publicKey, sendTransaction } = useWallet();
  const { bitcoin, ethereum } = useMultiChainWallet();
  const { user } = useAuth();
  const openId = user?.openId;
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [walletModalChain, setWalletModalChain] = useState<"solana" | "ethereum" | "bitcoin">("solana");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hi! I'm AFOS, your autonomous financial agent. I can help you swap tokens on Solana.\n\nTry saying: *swap 1 USDT to SOL* or *what's the SOL price?*",
      type: "text",
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sendMessage = trpc.chat.sendMessage.useMutation();
  const buildSwapTx = trpc.chat.buildSwapTx.useMutation();
  const executeBtcSwap = trpc.chat.executeBtcSwap.useMutation();
  const executeEthSwap = trpc.chat.executeEthSwap.useMutation();
  // Agent-mode: server-side autonomous swap (no wallet required)
  const executeAgentSwap = trpc.chat.executeAgentSwap.useMutation();

  // Read prefill from Swaps page "Send to Agent" button on mount
  // If afos_chat_autosend is set, auto-send the message immediately
  const hasAutoSentRef = useRef(false);
  useEffect(() => {
    const prefill = sessionStorage.getItem('afos_chat_prefill');
    const autoSend = sessionStorage.getItem('afos_chat_autosend');
    if (prefill) {
      sessionStorage.removeItem('afos_chat_prefill');
      sessionStorage.removeItem('afos_chat_autosend');
      if (autoSend === 'true' && !hasAutoSentRef.current) {
        hasAutoSentRef.current = true;
        // Auto-send after a short delay to let component fully mount
        setTimeout(() => handleSend(prefill), 300);
      } else {
        setInput(prefill);
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const addMessage = useCallback((msg: Omit<ChatMessage, "id" | "timestamp">) => {
    const newMsg: ChatMessage = {
      ...msg,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, newMsg]);
    return newMsg.id;
  }, []);

  const handleSend = useCallback(async (text?: string) => {
    const messageText = (text || input).trim();
    if (!messageText || isTyping) return;

    setInput("");
    addMessage({ role: "user", content: messageText, type: "text" });
    setIsTyping(true);

    try {
      const history = messages
        .filter(m => m.type !== "quote_card" && m.type !== "tx_success")
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content }));

      const result = await sendMessage.mutateAsync({
        message: messageText,
        history,
        walletAddress: publicKey?.toString(),
        walletBalances: balances.map(b => ({ symbol: b.symbol, amount: b.amount })),
        openId,
      });

      if (result.type === "quote_card" && result.quoteData) {
        addMessage({
          role: "assistant",
          content: result.content,
          type: "quote_card",
          quoteData: result.quoteData as QuoteData,
          limitWarning: (result as { limitWarning?: string }).limitWarning,
        });
      } else {
        addMessage({
          role: "assistant",
          content: result.content,
          type: "text",
        });
      }
    } catch (err) {
      addMessage({
        role: "assistant",
        content: "Sorry, I encountered an error. Please try again.",
        type: "error",
      });
      console.error("[ChatPage] sendMessage error:", err);
    } finally {
      setIsTyping(false);
    }
  }, [input, isTyping, messages, sendMessage, addMessage, publicKey, balances]);

  // Open wallet modal for a specific chain based on the quote's FROM token
  const openWalletForChain = useCallback((fromToken: string, fromChain?: SupportedChain) => {
    const chain = fromChain || TOKEN_CHAIN_FALLBACK[fromToken] || "solana";
    setWalletModalChain(chain);
    setShowWalletModal(true);
  }, []);

  const handleConfirmSwap = useCallback(async (msgId: string, quoteData: QuoteData) => {
    // ── Wallet required — AFOS is non-custodial, user must connect their own wallet ──
    const fromChainNorm = (quoteData.fromChain ?? "solana").toLowerCase();
    const noWalletConnected =
      !connected || !publicKey ||
      (fromChainNorm === "ethereum" && !ethereum?.address) ||
      (fromChainNorm === "bitcoin"  && !bitcoin?.address);

    if (noWalletConnected) {
      // Non-custodial: the agent cannot execute swaps on behalf of the user.
      // Prompt the user to connect their wallet for the appropriate chain.
      openWalletForChain(quoteData.fromToken, quoteData.fromChain);
      return;
    }

    setExecutingId(msgId);

    try {
      // ── BTC swaps: use executeBtcSwap (agent HTLC) or btcSignPsbt (browser light peer) ──
      if (quoteData.fromChain === "bitcoin" || quoteData.toChain === "bitcoin") {
        const btcAddress = bitcoin?.address ?? "";
        if (!btcAddress) {
          toast.error("Bitcoin wallet not connected", { description: "Please connect a Bitcoin wallet to execute BTC swaps." });
          setExecutingId(null);
          return;
        }

        toast.loading("Initiating BTC HTLC lock\u2026", { id: "btc-htlc" });
        const result = await executeBtcSwap.mutateAsync({
          senderAddress: btcAddress,
          amountBtc: quoteData.fromChain === "bitcoin" ? quoteData.fromAmount : quoteData.toAmount,
          expiryHours: 24,
          network: "mainnet",
        });
        toast.dismiss("btc-htlc");

        if (result.success) {
          const isDemoStr = result.demo ? " [DEMO]" : "";
          toast.success(`BTC HTLC lock initiated${isDemoStr}`, {
            description: `Tx: ${result.txid?.slice(0, 12)}\u2026`,
          });

          setMessages(prev => prev.map(m =>
            m.id === msgId
              ? { ...m, type: "tx_success" as const, txHash: result.txid ?? "" }
              : m
          ));

          addMessage({
            role: "assistant",
            content: result.message ?? `BTC HTLC lock created. ${result.nextStep ?? "Waiting for counterparty."}`,
            type: "text",
          });
        } else {
          addMessage({
            role: "assistant",
            content: result.message ?? "BTC HTLC lock could not be completed. Please try again.",
            type: "error",
          });
        }

        setExecutingId(null);
        return;
      }

      // ── Ethereum swaps: IntercomSwap P2P primary + 1inch fallback ────────────────
      if (quoteData.fromChain === "ethereum" || quoteData.toChain === "ethereum") {
        const ethAddress = ethereum?.address ?? "";
        if (!ethAddress) {
          toast.error("Ethereum wallet not connected", { description: "Please connect an Ethereum wallet (MetaMask, Phantom ETH, or Coinbase) to execute ETH swaps." });
          setExecutingId(null);
          return;
        }

        toast.loading("Finding best ETH swap route…", { id: "eth-swap" });
        const ethResult = await executeEthSwap.mutateAsync({
          fromAddress: ethAddress,
          fromToken:   quoteData.fromToken,
          toToken:     quoteData.toToken,
          fromChain:   (quoteData.fromChain as "solana" | "ethereum" | "bitcoin") ?? "ethereum",
          toChain:     (quoteData.toChain   as "solana" | "ethereum" | "bitcoin") ?? "ethereum",
          amount:      quoteData.fromAmount,
          slippage:    1,
          openId,
        });
        toast.dismiss("eth-swap");

        if (!ethResult.success) {
          addMessage({ role: "assistant", content: ethResult.message ?? "ETH swap route unavailable. Please try again.", type: "error" });
          setExecutingId(null);
          return;
        }

        // P2P route: HTLC will be coordinated by LightPeerContext / Oracle VM
        if (ethResult.route === "IntercomSwap P2P") {
          toast.success("P2P peer matched!", { description: `Peer: ${ethResult.p2pQuote?.peerId ?? "unknown"}` });
          setMessages(prev => prev.map(m =>
            m.id === msgId ? { ...m, type: "tx_success" as const, txHash: ethResult.p2pQuote?.rfqId ?? "p2p" } : m
          ));
          addMessage({
            role: "assistant",
            content: ethResult.nextStep ?? ethResult.message ?? "IntercomSwap P2P peer matched. Coordinating HTLC via Oracle VM.",
            type: "text",
          });
          setExecutingId(null);
          return;
        }

        // 1inch route: sign and broadcast via window.ethereum
        if (ethResult.tx) {
          const rawEth = (window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<string> } }).ethereum;
          if (!rawEth) {
            toast.error("No Ethereum provider", { description: "Install MetaMask or Phantom to sign ETH transactions." });
            setExecutingId(null);
            return;
          }
          toast.loading("Waiting for wallet signature…", { id: "eth-sign" });
          try {
            const txHash = await rawEth.request({
              method: "eth_sendTransaction",
              params: [{
                from:  ethAddress,
                to:    ethResult.tx.to,
                data:  ethResult.tx.data,
                value: ethResult.tx.value,
                ...(ethResult.tx.gas ? { gas: `0x${ethResult.tx.gas.toString(16)}` } : {}),
              }],
            });
            toast.dismiss("eth-sign");
            toast.success("ETH swap submitted!", { description: `Tx: ${txHash.slice(0, 12)}…` });
            setMessages(prev => prev.map(m =>
              m.id === msgId ? { ...m, type: "tx_success" as const, txHash } : m
            ));
            addMessage({
              role: "assistant",
              content: `✅ ETH swap submitted via 1inch: ${quoteData.fromAmount} ${quoteData.fromToken} → ${quoteData.toToken}. Tx: ${txHash.slice(0, 16)}…`,
              type: "text",
            });
          } catch (ethErr: unknown) {
            toast.dismiss("eth-sign");
            const msg = ethErr instanceof Error ? ethErr.message : String(ethErr);
            if (msg.toLowerCase().includes("user rejected") || msg.toLowerCase().includes("rejected")) {
              toast.info("ETH swap cancelled");
              addMessage({ role: "assistant", content: "ETH swap cancelled. Let me know if you'd like to try again.", type: "text" });
            } else {
              toast.error("ETH swap failed", { description: msg.slice(0, 100) });
              addMessage({ role: "assistant", content: `ETH swap failed: ${msg.slice(0, 150)}`, type: "error" });
            }
          }
          setExecutingId(null);
          return;
        }

        // Fallback: no tx and no P2P
        addMessage({ role: "assistant", content: ethResult.message ?? "ETH swap unavailable at this time.", type: "error" });
        setExecutingId(null);
        return;
      }

      // ── Solana swaps: IntercomSwap P2P primary + Jupiter fallback ──────────────
      const solResult = await buildSwapTx.mutateAsync({
        quoteResponse: quoteData.quoteResponse,
        userPublicKey: publicKey.toString(),
        fromToken:     quoteData.fromToken,
        toToken:       quoteData.toToken,
        fromChain:     (quoteData.fromChain as "solana" | "ethereum" | "bitcoin") ?? "solana",
        toChain:       (quoteData.toChain   as "solana" | "ethereum" | "bitcoin") ?? "solana",
        amount:        quoteData.fromAmount,
        openId,
      });

      // P2P route matched: HTLC coordinated by LightPeerContext
      if (solResult.route === "IntercomSwap P2P") {
        toast.success("P2P peer matched!", { description: `Peer: ${solResult.p2pQuote?.peerId ?? "unknown"}` });
        setMessages(prev => prev.map(m =>
          m.id === msgId ? { ...m, type: "tx_success" as const, txHash: solResult.p2pQuote?.rfqId ?? "p2p" } : m
        ));
        addMessage({
          role: "assistant",
          content: solResult.message ?? "IntercomSwap P2P peer matched. Coordinating HTLC via Oracle VM.",
          type: "text",
        });
        setExecutingId(null);
        return;
      }

      // Jupiter route: deserialize and send via Solana wallet
      const swapTransaction = solResult.swapTransaction;
      if (!swapTransaction) {
        throw new Error("No swap transaction returned from Jupiter. Please try again.");
      }

      // Deserialize the transaction
      const txBytes = Buffer.from(swapTransaction, "base64");
      const transaction = VersionedTransaction.deserialize(txBytes);

      // Send to wallet for signing and submission
      const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
      const txHash = await (sendTransaction as (tx: VersionedTransaction, conn: Connection) => Promise<string>)(transaction, connection);

      // Wait for confirmation
      toast.loading("Confirming transaction…", { id: "swap-confirm" });
      await connection.confirmTransaction(txHash, "confirmed");
      toast.dismiss("swap-confirm");
      toast.success("Swap confirmed on-chain!", { description: `Tx: ${txHash.slice(0, 8)}…` });

      // Update the message to show success
      setMessages(prev => prev.map(m =>
        m.id === msgId
          ? { ...m, type: "tx_success" as const, txHash }
          : m
      ));

      // Add a follow-up message
      addMessage({
        role: "assistant",
        content: `✅ Your swap of ${quoteData.fromAmount} ${quoteData.fromToken} → ${quoteData.toAmount.toFixed(6)} ${quoteData.toToken} is confirmed on-chain. Would you like to make another swap?`,
        type: "text",
      });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("User rejected") || msg.includes("rejected")) {
        toast.info("Swap cancelled");
        addMessage({ role: "assistant", content: "Swap cancelled. Let me know if you'd like to try again.", type: "text" });
      } else if (msg.toLowerCase().includes("maximum transaction limit") || msg.toLowerCase().includes("exceeds your")) {
        // Extract the blocked amount and limit from the error message if possible
        const amountMatch = msg.match(/\$(\d+(?:\.\d+)?)/g);
        const blockedAmountUsd = amountMatch ? parseFloat(amountMatch[0].replace("$", "")) : 0;
        const limitUsd = amountMatch && amountMatch.length > 1 ? parseFloat(amountMatch[1].replace("$", "")) : 500;
        toast.error("Transaction limit exceeded", { description: "Raise your limit in Settings." });
        addMessage({
          role: "assistant",
          content: "This swap exceeds your configured transaction limit.",
          type: "limit_exceeded",
          limitExceededData: { blockedAmountUsd, limitUsd },
        });
      } else {
        toast.error("Swap failed", { description: msg.slice(0, 100) });
        addMessage({ role: "assistant", content: `Swap failed: ${msg.slice(0, 150)}. Please try again.`, type: "error" });
      }
    } finally {
      setExecutingId(null);
    }
  }, [connected, publicKey, buildSwapTx, executeEthSwap, executeBtcSwap, executeAgentSwap, sendTransaction, addMessage, openWalletForChain, bitcoin, ethereum]);

  const handleCancelSwap = useCallback((msgId: string) => {
    setCancelledIds(prev => { const next = new Set(prev); next.add(msgId); return next; });
    addMessage({ role: "assistant", content: "Swap cancelled. What else can I help you with?", type: "text" });
  }, [addMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--background)" }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between shrink-0"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--card)" }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(139,92,246,0.2))", border: "1px solid rgba(6,182,212,0.3)" }}>
            <Bot className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">AFOS Agent</p>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-muted-foreground">Autonomous · Gemini 2.5 Flash</span>
            </div>
          </div>
        </div>

        {/* Wallet status — read-only indicator, no connect button (header has it) */}
        {connected && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
            style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <div className="text-right">
              <p className="text-[10px] font-semibold text-emerald-400">{walletName}</p>
              <p className="text-[9px] font-mono text-muted-foreground">{shortAddress}</p>
            </div>
            {totalUsd > 0 && (
              <span className="text-[10px] font-bold text-foreground ml-1">${totalUsd.toFixed(2)}</span>
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Subtle hint when not connected — no button, header has the connect action */}
        {!connected && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl px-4 py-3 flex items-center gap-2.5"
            style={{ background: "rgba(153,69,255,0.06)", border: "1px solid rgba(153,69,255,0.15)" }}>
            <Wallet className="w-3.5 h-3.5 shrink-0" style={{ color: "#9945FF" }} />
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Wallet not connected.</span> Use the Connect button above to execute swaps. You can still get quotes.
            </p>
          </motion.div>
        )}

        {/* Message list */}
        {messages.map(msg => (
          !cancelledIds.has(msg.id) || msg.type !== "quote_card" ? (
            <MessageBubble
              key={msg.id}
              msg={msg}
              onConfirmSwap={handleConfirmSwap}
              onCancelSwap={handleCancelSwap}
              executingId={executingId}
              onRequestConnect={openWalletForChain}
            />
          ) : null
        ))}

        {/* Typing indicator */}
        <AnimatePresence>
          {isTyping && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="flex gap-3"
            >
              <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(139,92,246,0.2))", border: "1px solid rgba(6,182,212,0.3)" }}>
                <Bot className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-1.5"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={messagesEndRef} />
      </div>

      {/* Suggestion chips — only when a wallet is connected and few messages */}
      {(connected || bitcoin?.address || ethereum?.address) && messages.length <= 2 && (
        <div className="px-4 pb-2 flex gap-2 overflow-x-auto scrollbar-hide">
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              onClick={() => handleSend(s)}
              className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all hover:opacity-80"
              style={{ background: "var(--muted)", border: "1px solid var(--border)", color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input area — gated behind wallet connection */}
      {(connected || bitcoin?.address || ethereum?.address) ? (
        <div className="px-4 pb-4 pt-2 shrink-0"
          style={{ borderTop: "1px solid var(--border)" }}>
          <div className="flex gap-2 items-end">
            <div className="flex-1 rounded-2xl overflow-hidden flex items-center gap-2 px-4 py-3"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <Sparkles className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="swap 1 USDT to SOL…"
                disabled={isTyping}
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 outline-none"
              />
            </div>
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isTyping}
              className="w-11 h-11 rounded-2xl flex items-center justify-center transition-all shrink-0"
              style={{
                background: input.trim() && !isTyping
                  ? "linear-gradient(135deg, #06b6d4, #8b5cf6)"
                  : "var(--muted)",
                opacity: input.trim() && !isTyping ? 1 : 0.5,
              }}>
              {isTyping ? (
                <Loader2 className="w-4 h-4 text-foreground animate-spin" />
              ) : (
                <Send className="w-4 h-4 text-white" />
              )}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground text-center mt-2">
            AFOS never holds your keys · All swaps are self-custodial · Powered by IntercomSwap P2P · Jupiter · 1inch
          </p>
        </div>
      ) : (
        /* Connect Wallet prompt — shown when no wallet is connected */
        <div className="px-4 pb-5 pt-3 shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="rounded-2xl p-5 flex flex-col items-center gap-3 text-center"
            style={{ background: "color-mix(in srgb, var(--foreground) 4%, var(--background))", border: "1px solid var(--border)" }}>
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, rgba(6,182,212,0.15), rgba(139,92,246,0.15))", border: "1px solid rgba(6,182,212,0.3)" }}>
              <Wallet className="w-6 h-6 text-cyan-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Connect a wallet to start</p>
              <p className="text-xs text-muted-foreground mt-1">You need a wallet to ask questions or request swaps</p>
            </div>
            <button
              onClick={() => { setWalletModalChain("solana"); setShowWalletModal(true); }}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.97] hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #06b6d4, #8b5cf6)", color: "white" }}>
              Connect Wallet
            </button>
            <p className="text-[10px] text-muted-foreground">
              Supports Phantom, MetaMask, Coinbase, Solflare, Tap Wallet · Non-custodial
            </p>
          </div>
        </div>
      )}
      <ConnectWalletModal
        open={showWalletModal}
        onClose={() => setShowWalletModal(false)}
        defaultChain={walletModalChain}
      />
    </div>
  );
}
