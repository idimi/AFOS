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
  TrendingUp, X, ChevronDown, Sparkles
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useWallet } from "@/contexts/WalletContext";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Connection, VersionedTransaction } from "@solana/web3.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface QuoteData {
  fromToken: string;
  toToken: string;
  fromAmount: number;
  toAmount: number;
  fromAmountUsd: number;
  toAmountUsd: number;
  rate: number;
  priceImpact: number;
  platformFee: number;
  platformFeeUsd: number;
  route: string;
  quoteResponse: unknown;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  type?: "text" | "quote_card" | "tx_success" | "error";
  quoteData?: QuoteData;
  txHash?: string;
  timestamp: number;
}

// ─── Suggestion chips ─────────────────────────────────────────────────────────
const SUGGESTIONS = [
  "swap 1 USDT to SOL",
  "swap 0.1 SOL to USDT",
  "what's the SOL price?",
  "show my balances",
  "swap 10 USDT to USDC",
];

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

// ─── Quote Card ───────────────────────────────────────────────────────────────
function QuoteCard({
  data,
  onConfirm,
  onCancel,
  isExecuting,
}: {
  data: QuoteData;
  onConfirm: () => void;
  onCancel: () => void;
  isExecuting: boolean;
}) {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="rounded-2xl overflow-hidden mt-2"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2"
        style={{ borderBottom: "1px solid var(--border)", background: "rgba(6,182,212,0.05)" }}>
        <Zap className="w-4 h-4 text-cyan-400" />
        <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">Swap Quote</span>
        <span className="ml-auto text-[10px] text-muted-foreground">{data.route}</span>
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
            <p className="text-xl font-bold text-emerald-400 font-mono">{data.toAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}</p>
            <div className="flex justify-center mt-1"><TokenBadge symbol={data.toToken} /></div>
            <p className="text-[10px] text-muted-foreground mt-1">${data.toAmountUsd.toFixed(2)}</p>
          </div>
        </div>

        {/* Details */}
        <div className="space-y-1.5 text-xs">
          {[
            { label: "Rate", value: `1 ${data.fromToken} = ${data.rate.toFixed(6)} ${data.toToken}` },
            { label: "Price Impact", value: `${data.priceImpact.toFixed(3)}%`, warn: data.priceImpact > 1 },
            { label: "Platform Fee (0.2%)", value: `${data.platformFee.toFixed(6)} ${data.fromToken} ($${data.platformFeeUsd.toFixed(4)})` },
          ].map(row => (
            <div key={row.label} className="flex items-center justify-between">
              <span className="text-muted-foreground">{row.label}</span>
              <span className={row.warn ? "text-amber-400" : "text-foreground font-mono"}>{row.value}</span>
            </div>
          ))}
        </div>

        {/* Warning for high price impact */}
        {data.priceImpact > 1 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
            style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)" }}>
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-amber-300">High price impact. Consider splitting into smaller swaps.</span>
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
            onClick={() => setVisible(true)}
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

// ─── Tx Success Card ──────────────────────────────────────────────────────────
function TxSuccessCard({ txHash, fromToken, toToken, fromAmount, toAmount }: {
  txHash: string;
  fromToken: string;
  toToken: string;
  fromAmount: number;
  toAmount: number;
}) {
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
        Swapped {fromAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} <strong className="text-foreground">{fromToken}</strong> →{" "}
        {toAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} <strong className="text-foreground">{toToken}</strong>
      </p>
      <a
        href={`https://solscan.io/tx/${txHash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        View on Solscan: {txHash.slice(0, 8)}…{txHash.slice(-8)}
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
}: {
  msg: ChatMessage;
  onConfirmSwap: (msgId: string, quoteData: QuoteData) => void;
  onCancelSwap: (msgId: string) => void;
  executingId: string | null;
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
  const { setVisible } = useWalletModal();
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
      });

      if (result.type === "quote_card" && result.quoteData) {
        addMessage({
          role: "assistant",
          content: result.content,
          type: "quote_card",
          quoteData: result.quoteData as QuoteData,
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

  const handleConfirmSwap = useCallback(async (msgId: string, quoteData: QuoteData) => {
    if (!connected || !publicKey) {
      setVisible(true);
      return;
    }

    setExecutingId(msgId);

    try {
      // Build the Jupiter swap transaction
      const { swapTransaction } = await buildSwapTx.mutateAsync({
        quoteResponse: quoteData.quoteResponse,
        userPublicKey: publicKey.toString(),
      });

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
      } else {
        toast.error("Swap failed", { description: msg.slice(0, 100) });
        addMessage({ role: "assistant", content: `Swap failed: ${msg.slice(0, 150)}. Please try again.`, type: "error" });
      }
    } finally {
      setExecutingId(null);
    }
  }, [connected, publicKey, buildSwapTx, sendTransaction, addMessage, setVisible]);

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

      {/* Suggestion chips */}
      {messages.length <= 2 && (
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

      {/* Input */}
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
          AFOS never holds your keys · All swaps are self-custodial · Powered by Jupiter
        </p>
      </div>
    </div>
  );
}
