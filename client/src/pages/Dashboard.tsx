/**
 * AFOS Dashboard — Agentic Financial Operating System
 * Redesigned Overview: Production-ready operator command center
 * Layout: 2-column (left: agent status + metrics + activity, right: portfolio + market + thought stream)
 * Mobile: Single column, prioritized order
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Zap, ArrowLeftRight, Activity, Settings,
  ChevronRight, CheckCircle2, Clock,
  TrendingUp, TrendingDown, Send,
  Network, Radio, Moon, Sun, Cpu, Wallet, X, Terminal,
  QrCode, ArrowUpRight, ArrowDownLeft, Copy, Check,
  Shield, AlertTriangle, Loader2, ExternalLink,
  BarChart3, Users, Globe, Gauge, Play, RefreshCw,
  Sparkles, Eye, CircleDot, ArrowRight, Menu
} from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "../contexts/ThemeContext";
import { useHaptic } from "../hooks/useHaptic";
import { useAgentLog, type TerminalEntry } from "../contexts/AgentLogContext";
import { useWallet } from "../contexts/WalletContext";
import { useMultiChainWallet } from "../contexts/MultiChainWalletContext";
import ConnectWalletModal from "../components/ConnectWalletModal";
import { getPrices, getStats, getAgentStatus, getSwaps, getWallet, onSSEEvent, type RfqResult, type WalletAsset } from "../lib/afosApi";
import Swaps from "./Swaps";
import SwapHistory from "./SwapHistory";
import AgentSettings from "./AgentSettings";
import NetworkPage from "./NetworkPage";
import TerminalPage from "./TerminalPage";
import ChatPage from "./ChatPage";
import { trpc } from "@/lib/trpc";

type NavPage = "dashboard" | "chat" | "swaps" | "activity" | "network" | "settings" | "terminal";

// ── Desktop Sidebar ────────────────────────────────────────────────────────
function DesktopSidebar({ navItems, activePage, setActivePage, open, setOpen }: {
  navItems: { id: NavPage; icon: React.ElementType; label: string }[];
  activePage: NavPage;
  setActivePage: (p: NavPage) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  return (
    <motion.aside
      animate={{ width: open ? 220 : 64 }}
      transition={{ duration: 0.22, ease: "easeInOut" }}
      className="hidden lg:flex shrink-0 flex-col border-r border-border bg-background relative"
      style={{ overflow: "visible" }}
    >
      {/* Inner clip so content doesn't spill */}
      <div className="absolute inset-0 overflow-hidden flex flex-col" style={{ pointerEvents: "none" }} />

      {/* Header */}
      <div className="h-14 flex items-center px-3 border-b border-border shrink-0 gap-2.5 overflow-hidden">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center shrink-0">
          <Zap className="w-4 h-4 text-white" />
        </div>
        <AnimatePresence>
          {open && (
            <motion.span
              initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.15 }}
              className="text-sm font-bold text-foreground whitespace-nowrap tracking-wide flex-1">
              AFOS
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Floating toggle tab — top of sidebar, right edge */}
      <button
        onClick={() => setOpen(!open)}
        title={open ? "Collapse sidebar" : "Expand sidebar"}
        className="absolute top-[14px] -right-[18px] z-50 w-[18px] h-8 flex items-center justify-center rounded-r-lg transition-all duration-150 hover:w-[22px] group"
        style={{
          background: "linear-gradient(135deg, rgba(6,182,212,0.25), rgba(139,92,246,0.2))",
          border: "1px solid rgba(6,182,212,0.5)",
          borderLeft: "none",
          boxShadow: "2px 0 12px rgba(6,182,212,0.2)",
        }}
      >
        <ChevronRight className={`w-3 h-3 text-cyan-400 transition-transform duration-200 group-hover:text-cyan-300 ${open ? "rotate-180" : ""}`} />
      </button>

      <nav className="flex-1 py-3 space-y-0.5 px-2">
        {navItems.map(item => {
          const Icon = item.icon;
          const active = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActivePage(item.id)}
              title={!open ? item.label : undefined}
              className={`w-full flex items-center gap-3 rounded-xl transition-all text-left ${
                open ? "px-2.5 py-2.5" : "px-0 py-2.5 justify-center"
              } ${
                active
                  ? "bg-cyan-500/10 border border-cyan-500/20 text-cyan-300"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent border border-transparent"
              }`}>
              <Icon className={`w-4 h-4 shrink-0 ${open ? "" : "mx-auto"}`} />
              <AnimatePresence>
                {open && (
                  <motion.span
                    initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }}
                    transition={{ duration: 0.12 }}
                    className="text-sm whitespace-nowrap">{item.label}</motion.span>
                )}
              </AnimatePresence>
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-border shrink-0">
        <div className={`flex items-center gap-2.5 ${open ? "px-2" : "justify-center"}`}>
          <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
          <AnimatePresence>
            {open && (
              <motion.span
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="text-xs text-muted-foreground whitespace-nowrap font-mono">agent online</motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.aside>
  );
}

// ── Mobile Sidebar Drawer ──────────────────────────────────────────────────
function MobileSidebarDrawer({
  navItems, activePage, setActivePage, open, onClose, onOpenWallet, connected, shortAddress,
}: {
  navItems: { id: NavPage; icon: React.ElementType; label: string }[];
  activePage: NavPage;
  setActivePage: (p: NavPage) => void;
  open: boolean;
  onClose: () => void;
  onOpenWallet: () => void;
  connected: boolean;
  shortAddress?: string;
}) {
  // Swipe-to-close: track touch start X
  const touchStartX = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (dx < -60) onClose(); // swipe left to close
    touchStartX.current = null;
  };

  const handleNav = (id: NavPage) => {
    setActivePage(id);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="lg:hidden fixed inset-0 z-40"
            style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
            onClick={onClose}
          />
          {/* Drawer panel */}
          <motion.aside
            key="drawer-panel"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 36, mass: 0.8 }}
            className="lg:hidden fixed top-0 left-0 bottom-0 z-50 w-72 flex flex-col"
            style={{ background: "var(--background)", borderRight: "1px solid var(--border)", boxShadow: "8px 0 40px rgba(0,0,0,0.35)" }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {/* Header */}
            <div className="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center">
                  <Zap className="w-4 h-4 text-white" />
                </div>
                <span className="text-sm font-bold text-foreground tracking-wide">AFOS</span>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                style={{ background: "var(--muted)" }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Nav items */}
            <nav className="flex-1 py-3 px-3 space-y-0.5 overflow-y-auto">
              {navItems.map(item => {
                const Icon = item.icon;
                const active = activePage === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleNav(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-left ${
                      active
                        ? "bg-cyan-500/10 border border-cyan-500/20 text-cyan-300"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent border border-transparent"
                    }`}
                  >
                    <Icon className="w-4.5 h-4.5 shrink-0" />
                    <span className="text-sm font-medium">{item.label}</span>
                    {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-cyan-400" />}
                  </button>
                );
              })}
            </nav>

            {/* Footer: wallet + agent status */}
            <div className="p-3 border-t border-border space-y-2 shrink-0">
              <button
                onClick={() => { onClose(); onOpenWallet(); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all"
                style={connected
                  ? { background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }
                  : { background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.25)" }
                }
              >
                {connected ? (
                  <>
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                    <span className="text-xs font-semibold text-emerald-400 flex-1 truncate">{shortAddress}</span>
                    <span className="text-[10px] text-muted-foreground">connected</span>
                  </>
                ) : (
                  <>
                    <Wallet className="w-4 h-4 text-blue-400 shrink-0" />
                    <span className="text-xs font-semibold text-blue-400">Connect Wallet</span>
                  </>
                )}
              </button>
              <div className="flex items-center gap-2 px-3 py-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
                <span className="text-xs text-muted-foreground font-mono">agent online</span>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Mini Chat Widget (replaces Agent Status Card on Overview) ─────────────────
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

interface MiniChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  type?: "text" | "quote_card" | "tx_success" | "error";
  quoteData?: QuoteData;
}

function MiniChatWidget({ onOpenFullChat }: { onOpenFullChat: () => void }) {
  const { publicKey, balances } = useWallet();
  const [messages, setMessages] = useState<MiniChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hi! I'm AFOS. Try: *swap 1 USDT to SOL* or *what's the SOL price?*",
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sendMessage = trpc.chat.sendMessage.useMutation();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const addMessage = useCallback((msg: Omit<MiniChatMessage, "id" | "timestamp">) => {
    setMessages(prev => [...prev, {
      ...msg,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
    }]);
  }, []);

  const buildSwapTx = trpc.chat.buildSwapTx.useMutation();

  const handleConfirmSwap = useCallback(async (quoteData: QuoteData) => {
    if (!publicKey) {
      addMessage({ role: "assistant", content: "Please connect your Solana wallet first to execute swaps.", type: "error" });
      return;
    }
    addMessage({ role: "assistant", content: `Building swap transaction for ${quoteData.fromAmount} ${quoteData.fromToken} → ${quoteData.toToken}…`, type: "text" });
    try {
      const { swapTransaction } = await buildSwapTx.mutateAsync({
        quoteResponse: quoteData.quoteResponse,
        userPublicKey: publicKey.toString(),
      });
      // Decode and sign via Phantom
      const { Connection, VersionedTransaction } = await import("@solana/web3.js");
      const connection = new Connection("https://api.mainnet-beta.solana.com");
      const txBytes = Uint8Array.from(atob(swapTransaction), c => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(txBytes);
      const phantom = (window as unknown as { solana?: { signAndSendTransaction: (tx: unknown) => Promise<{ signature: string }> } }).solana;
      if (!phantom?.signAndSendTransaction) {
        addMessage({ role: "assistant", content: "Phantom wallet not found. Please install Phantom to execute swaps.", type: "error" });
        return;
      }
      const { signature } = await phantom.signAndSendTransaction(tx);
      await connection.confirmTransaction(signature, "confirmed");
      addMessage({
        role: "assistant",
        content: `Swap confirmed! ${quoteData.fromAmount} ${quoteData.fromToken} → ${quoteData.toAmount.toFixed(6)} ${quoteData.toToken}`,
        type: "tx_success",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Transaction failed";
      addMessage({ role: "assistant", content: `Swap failed: ${msg}`, type: "error" });
    }
  }, [publicKey, buildSwapTx, addMessage]);

  const handleSend = useCallback(async (text?: string) => {
    const messageText = (text ?? input).trim();
    if (!messageText || isTyping) return;
    setInput("");
    addMessage({ role: "user", content: messageText, type: "text" });
    setIsTyping(true);
    try {
      const history = messages
        .slice(-8)
        .map(m => ({ role: m.role, content: m.content }));
      const result = await sendMessage.mutateAsync({
        message: messageText,
        history,
        walletAddress: publicKey?.toString(),
        walletBalances: balances.map(b => ({ symbol: b.symbol, amount: b.amount })),
      });
      addMessage({
        role: "assistant",
        content: result.content,
        type: result.type,
        quoteData: result.type === "quote_card" ? (result as { type: "quote_card"; content: string; quoteData: QuoteData }).quoteData : undefined,
      });
    } catch {
      addMessage({ role: "assistant", content: "Sorry, something went wrong. Please try again.", type: "error" });
    } finally {
      setIsTyping(false);
    }
  }, [input, isTyping, messages, sendMessage, addMessage, publicKey, balances]);

  const QUICK_CHIPS = ["swap 1 USDT to SOL", "SOL price?", "ETH price?", "BTC price?", "show balances"];

  return (
    <div className="rounded-2xl border border-cyan-500/15 bg-card flex flex-col" style={{ height: 340 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center relative">
            <Bot className="w-3.5 h-3.5 text-cyan-400" />
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border border-card" />
          </div>
          <div>
            <p className="text-xs font-bold text-foreground leading-none">AFOS Agent</p>
            <p className="text-[10px] text-muted-foreground font-mono">gemini-2.5-flash-lite</p>
          </div>
        </div>
        <button
          onClick={onOpenFullChat}
          className="text-[10px] text-muted-foreground hover:text-cyan-400 transition-colors px-2 py-1 rounded-lg hover:bg-cyan-500/10 font-mono"
        >
          Full chat →
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
        {messages.map(msg => (
          <div key={msg.id} className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
            {msg.role === "assistant" && (
              <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(139,92,246,0.2))", border: "1px solid rgba(6,182,212,0.3)" }}>
                {msg.type === "tx_success" ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> :
                 msg.type === "error" ? <AlertTriangle className="w-3 h-3 text-red-400" /> :
                 <Bot className="w-3 h-3 text-cyan-400" />}
              </div>
            )}
            {/* Quote card — rich inline swap confirmation */}
            {msg.type === "quote_card" && msg.quoteData ? (
              <div className="flex-1 max-w-[90%] rounded-xl rounded-tl-sm overflow-hidden"
                style={{ border: "1px solid rgba(6,182,212,0.3)", background: "linear-gradient(135deg, rgba(6,182,212,0.06), rgba(139,92,246,0.06))" }}>
                {/* Quote header */}
                <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1">
                  <ArrowLeftRight className="w-3 h-3 text-cyan-400" />
                  <span className="text-[10px] font-semibold text-cyan-400 uppercase tracking-wider">Swap Quote</span>
                  <span className="ml-auto text-[9px] font-mono text-muted-foreground">{msg.quoteData.route}</span>
                </div>
                {/* Token flow */}
                <div className="flex items-center gap-2 px-3 py-2">
                  <div className="flex-1 rounded-lg px-2.5 py-2" style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                    <p className="text-[9px] text-muted-foreground mb-0.5">You pay</p>
                    <p className="text-sm font-bold font-mono text-foreground">{msg.quoteData.fromAmount} {msg.quoteData.fromToken}</p>
                    <p className="text-[9px] text-muted-foreground">${msg.quoteData.fromAmountUsd.toFixed(2)}</p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 rounded-lg px-2.5 py-2" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
                    <p className="text-[9px] text-muted-foreground mb-0.5">You receive</p>
                    <p className="text-sm font-bold font-mono text-emerald-400">{msg.quoteData.toAmount.toFixed(6)} {msg.quoteData.toToken}</p>
                    <p className="text-[9px] text-muted-foreground">${msg.quoteData.toAmountUsd.toFixed(2)}</p>
                  </div>
                </div>
                {/* Fee row */}
                <div className="flex items-center justify-between px-3 pb-2 text-[9px] font-mono text-muted-foreground">
                  <span>Fee: {msg.quoteData.platformFee.toFixed(6)} {msg.quoteData.fromToken} (${msg.quoteData.platformFeeUsd.toFixed(4)})</span>
                  <span className={msg.quoteData.priceImpact > 1 ? "text-amber-400" : "text-emerald-400"}>
                    Impact: {msg.quoteData.priceImpact < 0.01 ? "<0.01" : msg.quoteData.priceImpact.toFixed(2)}%
                  </span>
                </div>
                {/* Confirm button */}
                <div className="px-3 pb-3">
                  <button
                    onClick={() => handleConfirmSwap(msg.quoteData!)}
                    disabled={buildSwapTx.isPending}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all active:scale-[0.98] disabled:opacity-60"
                    style={{ background: "linear-gradient(135deg, #06b6d4, #8b5cf6)", color: "white" }}
                  >
                    {buildSwapTx.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                    {buildSwapTx.isPending ? "Building tx…" : `Confirm Swap`}
                  </button>
                </div>
              </div>
            ) : (
              <div
                className={`px-3 py-2 rounded-xl text-xs leading-relaxed max-w-[80%] ${
                  msg.role === "user" ? "rounded-tr-sm" : "rounded-tl-sm"
                }`}
                style={{
                  background: msg.role === "user"
                    ? "linear-gradient(135deg, rgba(6,182,212,0.18), rgba(139,92,246,0.18))"
                    : msg.type === "tx_success" ? "rgba(16,185,129,0.1)"
                    : msg.type === "error" ? "rgba(239,68,68,0.1)"
                    : "var(--muted)",
                  border: msg.role === "user"
                    ? "1px solid rgba(6,182,212,0.25)"
                    : msg.type === "tx_success" ? "1px solid rgba(16,185,129,0.3)"
                    : msg.type === "error" ? "1px solid rgba(239,68,68,0.3)"
                    : "1px solid var(--border)",
                  color: msg.type === "tx_success" ? "#10b981" : msg.type === "error" ? "#f87171" : "var(--foreground)",
                }}
              >
                {msg.content}
              </div>
            )}
          </div>
        ))}
        {isTyping && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(139,92,246,0.2))", border: "1px solid rgba(6,182,212,0.3)" }}>
              <Bot className="w-3 h-3 text-cyan-400" />
            </div>
            <div className="px-3 py-2 rounded-xl rounded-tl-sm flex items-center gap-1"
              style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick chips — only show when few messages */}
      {messages.length <= 2 && (
        <div className="px-3 pb-1.5 flex gap-1.5 overflow-x-auto scrollbar-hide shrink-0">
          {QUICK_CHIPS.map(chip => (
            <button
              key={chip}
              onClick={() => handleSend(chip)}
              className="shrink-0 px-2.5 py-1 rounded-full text-[10px] font-medium transition-all hover:opacity-80 whitespace-nowrap"
              style={{ background: "var(--muted)", border: "1px solid var(--border)", color: "var(--muted-foreground)" }}
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="px-3 pb-3 pt-1.5 shrink-0 border-t border-border">
        <div className="flex gap-2 items-center">
          <div
            className="flex-1 rounded-xl flex items-center gap-2 px-3 py-2.5 transition-all duration-150"
            style={{
              background: "color-mix(in srgb, var(--foreground) 6%, var(--background))",
              border: "1.5px solid color-mix(in srgb, var(--foreground) 18%, transparent)",
            }}
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Ask AFOS — e.g. swap 1 USDT to SOL"
              disabled={isTyping}
              className="flex-1 bg-transparent text-xs text-foreground outline-none"
              style={{ color: "var(--foreground)", caretColor: "#06b6d4" }}
            />
          </div>
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isTyping}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-all shrink-0"
            style={{
              background: input.trim() && !isTyping ? "linear-gradient(135deg, #06b6d4, #8b5cf6)" : "var(--muted)",
              opacity: input.trim() && !isTyping ? 1 : 0.5,
            }}
          >
            {isTyping ? <Loader2 className="w-3 h-3 text-foreground animate-spin" /> : <Send className="w-3 h-3 text-white" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Agent Status Card (kept for mobile use) ────────────────────────────────
function AgentStatusCard({ onNavigateToTerminal }: { onNavigateToTerminal: () => void }) {
  const [uptime, setUptime] = useState(0);
  const [currentTask, setCurrentTask] = useState("Connecting to agent...");
  const [agentStatus, setAgentStatus] = useState<'ACTIVE' | 'INITIALIZING' | 'OFFLINE'>('INITIALIZING');
  const [skillsLoaded, setSkillsLoaded] = useState(0);
  const [activePeers, setActivePeers] = useState(0);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const status = await getAgentStatus();
        setAgentStatus(status.status === 'active' ? 'ACTIVE' : 'INITIALIZING');
        setActivePeers(status.activePeers);
        setSkillsLoaded(status.stats?.totalSwaps !== undefined ? 3 : 0);
        if (status.lastDecision?.reasoning) {
          setCurrentTask(status.lastDecision.reasoning.slice(0, 80));
        }
      } catch { /* keep current */ }
    };
    fetchStatus();
    const t = setInterval(fetchStatus, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const unsub = onSSEEvent('agent_decision', (data: unknown) => {
      const d = data as { action: string; reasoning: string };
      if (d?.reasoning) setCurrentTask(d.reasoning.slice(0, 80));
      setAgentStatus('ACTIVE');
    });
    const unsubPeer = onSSEEvent('peer_connected', () => setActivePeers(p => p + 1));
    const unsubPeerD = onSSEEvent('peer_disconnected', () => setActivePeers(p => Math.max(0, p - 1)));
    const unsubInit = onSSEEvent('init', (data: unknown) => {
      const d = data as { activePeers?: number; lastDecision?: { reasoning?: string } };
      if (d?.activePeers !== undefined) setActivePeers(d.activePeers);
      if (d?.lastDecision?.reasoning) setCurrentTask(d.lastDecision.reasoning.slice(0, 80));
      setAgentStatus('ACTIVE');
      setSkillsLoaded(3);
    });
    return () => { unsub(); unsubPeer(); unsubPeerD(); unsubInit(); };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setUptime(u => u + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}h ${m}m ${sec}s`;
  };

  return (
    <div className="rounded-2xl border border-cyan-500/15 bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center relative">
            <Bot className="w-5 h-5 text-cyan-400" />
            <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-card" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-foreground">AFOS Agent</h3>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full border ${
                agentStatus === 'ACTIVE' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                agentStatus === 'INITIALIZING' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
                'bg-red-500/10 border-red-500/20 text-red-400'
              }`}>{agentStatus}</span>
            </div>
            <p className="text-xs text-muted-foreground font-mono">gemini-2.5-flash-lite · intercomswap@mainnet</p>
          </div>
        </div>
        <button
          onClick={onNavigateToTerminal}
          className="text-xs text-muted-foreground hover:text-cyan-400 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-cyan-500/10 font-mono"
        >
          Terminal →
        </button>
      </div>
      <div className="rounded-xl bg-muted/40 border border-border p-3 mb-3">
        <div className="flex items-center gap-2 mb-1.5">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Current Task</span>
        </div>
        <motion.p key={currentTask} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="text-sm text-foreground font-mono">
          {currentTask}
        </motion.p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-muted/30 border border-border p-2.5 text-center">
          <p className="text-xs font-bold font-mono text-foreground">{formatUptime(uptime)}</p>
          <p className="text-[9px] text-muted-foreground mt-0.5">Uptime</p>
        </div>
        <div className="rounded-lg bg-muted/30 border border-border p-2.5 text-center">
          <p className="text-xs font-bold font-mono text-foreground">{skillsLoaded > 0 ? skillsLoaded : '—'}</p>
          <p className="text-[9px] text-muted-foreground mt-0.5">Skills loaded</p>
        </div>
        <div className="rounded-lg bg-muted/30 border border-border p-2.5 text-center">
          <p className="text-xs font-bold font-mono text-emerald-400">{activePeers}</p>
          <p className="text-[9px] text-muted-foreground mt-0.5">Active Peers</p>
        </div>
      </div>
    </div>
  );
}

// ── Key Metrics Row ──────────────────────────────────────────────────────────
function MetricsRow() {
  const [metrics, setMetrics] = useState({
    volume24h: 2840000,
    feesEarned: 5680,
    p2pRatio: 9.95,
    activePeers: 7,
  });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const stats = await getStats();
          setMetrics({
            volume24h: stats.totalVolumeUsd,
            feesEarned: stats.totalFeesUsd,
            p2pRatio: stats.p2pRatio * 100,
            activePeers: stats.activePeers,
          });
      } catch { /* keep current metrics */ }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 60000);
    return () => clearInterval(interval);
  }, []);

  const cards = [
    {
      label: "Total Volume",
      value: `$${(metrics.volume24h / 1000000).toFixed(2)}M`,
      change: "+3.2%",
      positive: true,
      icon: BarChart3,
      color: "text-cyan-400",
      bg: "bg-cyan-500/8",
      border: "border-cyan-500/15",
    },
    {
      label: "Fees Collected",
      value: `$${metrics.feesEarned.toLocaleString()}`,
      change: "+12.4%",
      positive: true,
      icon: TrendingUp,
      color: "text-emerald-400",
      bg: "bg-emerald-500/8",
      border: "border-emerald-500/15",
    },
    {
      label: "P2P Ratio",
      value: `${metrics.p2pRatio.toFixed(1)}%`,
      change: "live",
      positive: true,
      icon: Radio,
      color: "text-violet-400",
      bg: "bg-violet-500/8",
      border: "border-violet-500/15",
    },
    {
      label: "Active Peers",
      value: String(metrics.activePeers),
      change: "online",
      positive: true,
      icon: Users,
      color: "text-amber-400",
      bg: "bg-amber-500/8",
      border: "border-amber-500/15",
    },
  ];

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      {cards.map(card => {
        const Icon = card.icon;
        return (
          <div key={card.label} className={`rounded-xl border ${card.border} ${card.bg} p-4`}>
            <div className="flex items-center justify-between mb-2">
              <Icon className={`w-4 h-4 ${card.color}`} />
              <span className={`text-[10px] font-mono ${card.positive ? "text-emerald-400" : "text-red-400"}`}>
                {card.change}
              </span>
            </div>
            <p className="text-lg font-bold font-mono text-foreground">{card.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{card.label}</p>
          </div>
        );
      })}
    </div>
  );
}

// ── Recent Swaps Card ──────────────────────────────────────────────────────
function RecentSwapsCard({ onViewAll }: { onViewAll: () => void }) {
  const [allSwaps, setAllSwaps] = useState<{ pending: RfqResult[]; completed: RfqResult[] }>({ pending: [], completed: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSwaps = async () => {
      try {
        const data = await getSwaps();
        setAllSwaps(data);
      } catch { /* keep empty */ } finally { setLoading(false); }
    };
    fetchSwaps();
    const t = setInterval(fetchSwaps, 30000);
    return () => clearInterval(t);
  }, []);

  // Merge pending + completed, sort by timestamp desc, take top 5
  const combined = [...allSwaps.pending, ...allSwaps.completed]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 5);

  // Map RfqResult to display format
  const RECENT_SWAPS = combined.map(s => ({
    id: s.rfqId,
    from: s.fromToken,
    to: s.toToken,
    fromAmt: s.inAmount.toFixed(4),
    toAmt: s.outAmount.toFixed(4),
    status: allSwaps.pending.some(p => p.rfqId === s.rfqId) ? 'pending' as const : 'complete' as const,
    time: new Date(s.timestamp).toLocaleTimeString(),
    protocol: s.route === 'p2p' ? 'IntercomSwap P2P' : `Jupiter DEX`,
  }));

  const STATUS_STYLE = {
    complete: { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10" },
    pending: { icon: Loader2, color: "text-amber-400", bg: "bg-amber-500/10" },
    failed: { icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/10" },
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Recent Swaps</h3>
        </div>
        <button
          onClick={onViewAll}
          className="text-xs text-muted-foreground hover:text-cyan-400 transition-colors font-mono flex items-center gap-1"
        >
          View all <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      <div className="flex-1 overflow-auto space-y-1.5 min-h-0">
        {loading && <div className="flex items-center justify-center py-8"><div className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" /></div>}
        {!loading && RECENT_SWAPS.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Radio className="w-8 h-8 text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground font-mono">No swaps yet</p>
            <p className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">Waiting for P2P peers or user-initiated swaps</p>
          </div>
        )}
        {RECENT_SWAPS.map(swap => {
          const statusCfg = STATUS_STYLE[swap.status];
          const StatusIcon = statusCfg.icon;
          return (
            <div key={swap.id} className="flex items-center gap-3 p-3 rounded-xl bg-muted/20 border border-border hover:bg-muted/40 transition-colors group">
              <div className={`w-8 h-8 rounded-lg ${statusCfg.bg} flex items-center justify-center shrink-0`}>
                <StatusIcon className={`w-4 h-4 ${statusCfg.color} ${swap.status === "pending" ? "animate-spin" : ""}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-mono font-semibold text-foreground">{swap.fromAmt} {swap.from}</span>
                  <ArrowRight className="w-3 h-3 text-muted-foreground" />
                  <span className="text-sm font-mono font-semibold text-foreground">{swap.toAmt} {swap.to}</span>
                </div>
                <p className="text-[10px] text-muted-foreground font-mono">{swap.protocol}</p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-[10px] font-mono ${statusCfg.color}`}>{swap.status}</p>
                <p className="text-[10px] text-muted-foreground">{swap.time}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Quick Actions ──────────────────────────────────────────────────────────
function QuickActions({ onNavigate }: { onNavigate: (page: NavPage) => void }) {
  const haptic = useHaptic();
  const actions = [
    { label: "New Swap", icon: ArrowLeftRight, page: "swaps" as NavPage, color: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/20" },
    { label: "History", icon: Activity, page: "activity" as NavPage, color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20" },
    { label: "View Peers", icon: Globe, page: "network" as NavPage, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
    { label: "Settings", icon: Settings, page: "settings" as NavPage, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  ];

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
      {actions.map(action => {
        const Icon = action.icon;
        return (
          <button
            key={action.label}
            onClick={() => { haptic.tap(); onNavigate(action.page); }}
            className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border ${action.border} ${action.bg} hover:scale-[1.02] active:scale-[0.98] transition-all`}
          >
            <Icon className={`w-4 h-4 ${action.color}`} />
            <span className="text-xs font-semibold text-foreground">{action.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Portfolio Card ─────────────────────────────────────────────────────────
function PortfolioCard() {
  const [totalUsd, setTotalUsd] = useState<number | null>(null);
  const [change24h] = useState<number | null>(null);

  useEffect(() => {
    const fetchTotal = async () => {
      try {
        const data = await getWallet();
        setTotalUsd(data.totalUsd);
      } catch { /* keep null */ }
    };
    fetchTotal();
    const t = setInterval(fetchTotal, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Total Portfolio</p>
        <span className="text-xs text-muted-foreground font-mono">non-custodial</span>
      </div>
      <div className="flex items-end gap-3 mb-1">
        <p className="text-3xl font-bold font-mono text-foreground tracking-tight">
          {totalUsd !== null ? `$${totalUsd.toLocaleString()}` : <span className="text-muted-foreground text-xl">Loading...</span>}
        </p>
        {change24h !== null && (
          <div className={`flex items-center gap-1 text-sm font-mono mb-1 ${change24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {change24h >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {change24h >= 0 ? "+" : ""}{change24h}%
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{totalUsd !== null ? 'Agent treasury balance' : 'Fetching on-chain balance...'}</p>
    </div>
  );
}

// ── Wallet Send/Receive Modal ──────────────────────────────────────────────
interface WalletModalState {
  asset: string;
  network: string;
  mode: "send" | "receive";
}

const MOCK_ADDRESSES: Record<string, string> = {
  BTC: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  USDT: "7xKp9mNzQ3aBcDeFgHiJkLmNoPqRsTuVwXyZ2345678",
  SOL: "9WzDXwBbmkg8ZTbNMqUxvQRnL6iqChFynpXg3NqaFuAm",
  ETH: "0x742d35Cc6634C0532925a3b8D4C9E4F8B2A1d3E5",
};

function WalletModal({ modal, onClose }: { modal: WalletModalState; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [invoice, setInvoice] = useState("");
  const [copied, setCopied] = useState(false);
  const addr = MOCK_ADDRESSES[modal.asset] ?? "";

  const handleCopy = () => {
    navigator.clipboard?.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Address copied");
  };

  const handleSend = () => {
    if (!amount) { toast.error("Enter an amount"); return; }
    if (modal.asset === "BTC" && !invoice) { toast.error("Paste a Bitcoin address"); return; }
    toast.success(`${modal.asset} send initiated`, {
      description: modal.asset === "BTC"
        ? `Sending ${amount} BTC on-chain`
        : `Sending ${amount} ${modal.asset} on ${modal.network}`,
    });
    onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 32, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 32, scale: 0.97 }}
          transition={{ type: "spring", damping: 28, stiffness: 380 }}
          className="w-full max-w-sm rounded-2xl p-5 space-y-4"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {modal.mode === "send"
                ? <ArrowUpRight className="w-4 h-4 text-red-400" />
                : <ArrowDownLeft className="w-4 h-4 text-emerald-400" />}
              <span className="text-sm font-bold text-foreground">
                {modal.mode === "send" ? "Send" : "Receive"} {modal.asset}
              </span>
              <span className="text-xs text-muted-foreground font-mono">· {modal.network}</span>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {modal.mode === "receive" ? (
            <div className="space-y-3">
              <div className="flex items-center justify-center p-4 rounded-xl" style={{ background: "var(--muted)" }}>
                <QrCode className="w-16 h-16 text-muted-foreground/40" />
              </div>
              <div className="rounded-xl p-3" style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                <p className="text-[9px] text-muted-foreground mb-1">
                  {modal.asset === "BTC" ? "Bitcoin Address" : `${modal.network} Address`}
                </p>
                <p className="text-[10px] font-mono text-foreground break-all leading-relaxed">{addr.slice(0, 60)}…</p>
              </div>
              <button onClick={handleCopy}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold transition-all"
                style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)", color: "#10b981" }}>
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copied!" : "Copy Address"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {modal.asset === "BTC" && (
                <div>
                  <label className="text-[10px] text-muted-foreground mb-1 block">Bitcoin Address</label>
                  <textarea
                    value={invoice}
                    onChange={e => setInvoice(e.target.value)}
                    placeholder="bc1q… or 1… or 3…"
                    rows={3}
                    className="w-full px-3 py-2 rounded-xl text-[10px] font-mono text-foreground placeholder:text-muted-foreground/50 outline-none resize-none"
                    style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                  />
                </div>
              )}
              {modal.asset !== "BTC" && (
                <div>
                  <label className="text-[10px] text-muted-foreground mb-1 block">Recipient Address</label>
                  <input
                    placeholder={`${modal.network} address…`}
                    className="w-full px-3 py-2 rounded-xl text-xs font-mono text-foreground placeholder:text-muted-foreground/50 outline-none"
                    style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                  />
                </div>
              )}
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">Amount ({modal.asset})</label>
                <input
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder={modal.asset === "BTC" ? "0.001" : modal.asset === "USDT" ? "100" : "1.0"}
                  className="w-full px-3 py-2 rounded-xl text-sm font-mono text-foreground placeholder:text-muted-foreground/50 outline-none"
                  style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                />
              </div>
              <button onClick={handleSend}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold transition-all"
                style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}>
                <Send className="w-3.5 h-3.5" />
                {modal.asset === "BTC" ? "Pay Invoice" : `Send ${modal.asset}`}
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Wallets Card (compact) ─────────────────────────────────────────────────
function WalletsCard() {
  const [modal, setModal] = useState<WalletModalState | null>(null);
  const [walletData, setWalletData] = useState<WalletAsset[]>([]);
  const [walletLoading, setWalletLoading] = useState(true);
  const { ethereum, bitcoin } = useMultiChainWallet();

  useEffect(() => {
    const fetchWallet = async () => {
      try {
        const data = await getWallet();
        setWalletData(data.wallets);
      } catch { /* keep empty */ } finally { setWalletLoading(false); }
    };
    fetchWallet();
    const t = setInterval(fetchWallet, 30000);
    return () => clearInterval(t);
  }, []);

  const ASSET_STYLE: Record<string, { color: string; border: string; bg: string; chain: string; chainColor: string }> = {
    SOL:  { color: "text-purple-400",  border: "border-purple-500/20",  bg: "bg-purple-500/8",  chain: "Solana",   chainColor: "text-purple-300" },
    USDT: { color: "text-emerald-400", border: "border-emerald-500/20", bg: "bg-emerald-500/8", chain: "Solana",   chainColor: "text-purple-300" },
    USDC: { color: "text-blue-300",    border: "border-blue-400/20",    bg: "bg-blue-400/8",    chain: "Solana",   chainColor: "text-purple-300" },
    BTC:  { color: "text-amber-400",   border: "border-amber-500/20",   bg: "bg-amber-500/8",   chain: "Bitcoin",  chainColor: "text-amber-300" },
    ETH:  { color: "text-blue-400",    border: "border-blue-500/20",    bg: "bg-blue-500/8",    chain: "Ethereum", chainColor: "text-blue-300" },
    TNK:  { color: "text-orange-400",  border: "border-orange-500/20",  bg: "bg-orange-500/8",  chain: "Solana",   chainColor: "text-purple-300" },
  };

  // Chain dot colors
  const CHAIN_DOT: Record<string, string> = {
    Solana: "bg-purple-400",
    Ethereum: "bg-blue-400",
    Bitcoin: "bg-amber-400",
  };

  // All supported assets — always shown, live data merged in when available
  const ALL_ASSETS = [
    { asset: "SOL",  network: "Solana",   defaultBalance: "0.000000", defaultUsd: "$0" },
    { asset: "USDT", network: "Solana",   defaultBalance: "0.00",     defaultUsd: "$0" },
    { asset: "USDC", network: "Solana",   defaultBalance: "0.00",     defaultUsd: "$0" },
    { asset: "ETH",  network: "Ethereum", defaultBalance: "0.000000", defaultUsd: "$0" },
    { asset: "USDT", network: "Ethereum", defaultBalance: "0.00",     defaultUsd: "$0" },
    { asset: "BTC",  network: "Bitcoin",  defaultBalance: "0.00000000", defaultUsd: "$0" },
  ];

  // Build wallet rows: live data takes priority, fall back to placeholder
  const wallets = ALL_ASSETS.map(def => {
    // Try to find live data from backend (Solana assets)
    const live = walletData.find(w => w.asset === def.asset && w.network.toLowerCase().includes(def.network.toLowerCase()));
    // Try connected ETH wallet
    const isEthAsset = def.network === "Ethereum" && def.asset === "ETH" && ethereum?.connected;
    // Try connected BTC wallet
    const isBtcAsset = def.network === "Bitcoin" && def.asset === "BTC" && bitcoin?.connected;

    const style = ASSET_STYLE[def.asset] ?? { color: "text-cyan-400", border: "border-cyan-500/20", bg: "bg-cyan-500/8", chain: def.network, chainColor: "text-cyan-300" };

    if (live) {
      return { asset: def.asset, network: live.network, balance: live.balance, usd: live.usd, connected: true, ...style };
    } else if (isEthAsset) {
      return { asset: "ETH", network: `Ethereum · ${ethereum!.shortAddress}`, balance: ethereum!.balance, usd: ethereum!.balanceUsd > 0 ? `$${ethereum!.balanceUsd.toFixed(2)}` : "$0", connected: true, ...style };
    } else if (isBtcAsset) {
      return { asset: "BTC", network: `Bitcoin · ${bitcoin!.shortAddress}`, balance: bitcoin!.balance, usd: bitcoin!.balanceUsd > 0 ? `$${bitcoin!.balanceUsd.toFixed(2)}` : "$0", connected: true, ...style };
    } else {
      return { asset: def.asset, network: def.network, balance: def.defaultBalance, usd: def.defaultUsd, connected: false, ...style };
    }
  });

  // Also append any extra live assets not in ALL_ASSETS (e.g. TNK)
  walletData.forEach(w => {
    const alreadyIncluded = ALL_ASSETS.some(a => a.asset === w.asset && w.network.toLowerCase().includes(a.network.toLowerCase()));
    if (!alreadyIncluded) {
      const style = ASSET_STYLE[w.asset] ?? { color: "text-cyan-400", border: "border-cyan-500/20", bg: "bg-cyan-500/8", chain: w.network, chainColor: "text-cyan-300" };
      wallets.push({ asset: w.asset, network: w.network, balance: w.balance, usd: w.usd, connected: true, ...style });
    }
  });

  return (
    <>
      {modal && <WalletModal modal={modal} onClose={() => setModal(null)} />}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Wallets</h3>
          </div>
          <span className="text-[10px] text-muted-foreground font-mono">{wallets.filter(w => w.connected).length}/{wallets.length} active</span>
        </div>
        {/* Scrollable wallet list — max 3.5 rows visible, scroll for more */}
        <div className="space-y-2 overflow-y-auto pr-0.5" style={{ maxHeight: 232 }}>
          {wallets.map((w, i) => (
            <div
              key={`${w.asset}-${w.network}-${i}`}
              className={`flex items-center gap-3 p-2.5 rounded-xl border transition-opacity duration-200 ${w.border} ${w.bg} ${!w.connected ? "opacity-45" : ""}`}
            >
              {/* Asset icon */}
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold font-mono ${w.color} bg-background/50 border border-border shrink-0`}>
                {w.asset}
              </div>
              {/* Balance + network */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-mono font-semibold ${w.connected ? w.color : "text-muted-foreground"}`}>{w.balance}</p>
                  <span className="text-[10px] text-muted-foreground">{w.usd}</span>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${CHAIN_DOT[w.chain] ?? "bg-cyan-400"}`} />
                  <p className={`text-[10px] font-mono ${w.chainColor}`}>{w.network}</p>
                </div>
              </div>
              {/* Actions — only show when connected */}
              <div className="flex items-center gap-1 shrink-0">
                {w.connected ? (
                  <>
                    <button
                      onClick={() => setModal({ asset: w.asset, network: w.network, mode: "receive" })}
                      title="Receive"
                      className="w-6 h-6 rounded-md flex items-center justify-center transition-all hover:scale-110"
                      style={{ background: "rgba(16,185,129,0.10)", border: "1px solid rgba(16,185,129,0.25)" }}>
                      <ArrowDownLeft className="w-3 h-3 text-emerald-400" />
                    </button>
                    <button
                      onClick={() => setModal({ asset: w.asset, network: w.network, mode: "send" })}
                      title="Send"
                      className="w-6 h-6 rounded-md flex items-center justify-center transition-all hover:scale-110"
                      style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.25)" }}>
                      <ArrowUpRight className="w-3 h-3 text-red-400" />
                    </button>
                  </>
                ) : (
                  <span className="text-[9px] font-mono text-muted-foreground px-1.5 py-0.5 rounded-full" style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>not connected</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Market Ticker with expandable TradingView chart ───────────────────────
const TV_SYMBOLS: Record<string, string> = {
  "BTC/USDT": "BINANCE:BTCUSDT",
  "ETH/USDT": "BINANCE:ETHUSDT",
  "SOL/USDT": "BINANCE:SOLUSDT",
};

// TradingView Advanced Chart widget — uses a keyed inner component so
// the entire DOM node is destroyed and recreated whenever interval/symbol/theme changes,
// forcing the TradingView script to reinitialise with the correct config.
function TradingViewChartInner({
  symbol, interval, theme, height
}: { symbol: string; interval: string; theme: string; height: number }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";

    const widgetDiv = document.createElement("div");
    widgetDiv.className = "tradingview-widget-container__widget";
    widgetDiv.style.height = `${height}px`;
    widgetDiv.style.width = "100%";
    container.appendChild(widgetDiv);

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: false,
      width: "100%",
      height: height,
      symbol: symbol,
      interval: interval,
      timezone: "Etc/UTC",
      theme: theme,
      style: "3",
      locale: "en",
      withdateranges: false,
      hide_side_toolbar: true,
      hide_top_toolbar: true,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      hide_volume: false,
      support_host: "https://www.tradingview.com",
    });
    container.appendChild(script);
    return () => { container.innerHTML = ""; };
  }, []);

  return <div ref={containerRef} className="tradingview-widget-container" style={{ height: `${height}px`, width: "100%" }} />;
}

// Wrapper that forces full remount via key whenever any prop changes
function TradingViewChart({
  symbol, interval, theme, height
}: { symbol: string; interval: string; theme: string; height: number }) {
  const key = `${symbol}-${interval}-${theme}-${height}`;
  return <TradingViewChartInner key={key} symbol={symbol} interval={interval} theme={theme} height={height} />;
}

function MarketTicker() {
  const { theme } = useTheme();
  const tvTheme = theme === "light" ? "light" : "dark";
  const [prices, setPrices] = useState({
    BTC: { price: 67090, change: 0 },
    ETH: { price: 2000, change: 0 },
    SOL: { price: 87.2, change: 0 },
  });
  const [priceSource, setPriceSource] = useState<'live' | 'mock'>('mock');
  // Persist chart pair + timeframe in localStorage
  const [activePair, setActivePairState] = useState<string | null>(() => {
    try { return localStorage.getItem("afos_chart_pair") ?? "BTC/USDT"; } catch { return "BTC/USDT"; }
  });
  const [interval, setIntervalTFState] = useState<string>(() => {
    try { return localStorage.getItem("afos_chart_tf") ?? "5"; } catch { return "5"; }
  });
  const setActivePair = (pair: string | null) => {
    setActivePairState(pair);
    try { if (pair) localStorage.setItem("afos_chart_pair", pair); } catch { /* ignore */ }
  };
  const setIntervalTF = (tf: string) => {
    setIntervalTFState(tf);
    try { localStorage.setItem("afos_chart_tf", tf); } catch { /* ignore */ }
  };

  const TF_OPTIONS = [
    { label: "1m", value: "1" },
    { label: "5m", value: "5" },
    { label: "30m", value: "30" },
    { label: "1h", value: "60" },
    { label: "4h", value: "240" },
    { label: "1D", value: "D" },
  ];

  useEffect(() => {
    const fetchLivePrices = async () => {
      try {
        const priceData = await getPrices();
          setPrices({
            BTC: { price: priceData.BTC?.usd ?? 67090, change: priceData.BTC?.change24h ?? 0 },
            ETH: { price: priceData.ETH?.usd ?? 2000, change: priceData.ETH?.change24h ?? 0 },
            SOL: { price: priceData.SOL?.usd ?? 87.2, change: priceData.SOL?.change24h ?? 0 },
          });
          setPriceSource('live');
      } catch { /* keep current prices */ }
    };
    fetchLivePrices();
    const timer = setInterval(fetchLivePrices, 30000);
    return () => clearInterval(timer);
  }, []);

  const tickers = [
    { symbol: "BTC/USDT", ...prices.BTC, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", icon: "₿" },
    { symbol: "ETH/USDT", ...prices.ETH, color: "text-blue-400",  bg: "bg-blue-500/10",  border: "border-blue-500/20",  icon: "Ξ" },
    { symbol: "SOL/USDT", ...prices.SOL, color: "text-purple-400",bg: "bg-purple-500/10",border: "border-purple-500/20",icon: "◎" },
  ];

  const activeTicker = tickers.find(t => t.symbol === activePair);

  return (
    <div className={`rounded-2xl border bg-card overflow-hidden transition-all duration-300 ${
      activePair ? "border-cyan-500/30" : "border-border"
    }`} style={activePair ? { boxShadow: "0 0 0 1px rgba(6,182,212,0.15), 0 4px 24px rgba(6,182,212,0.08)" } : {}}>

      {/* ── Card header ── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Market</h3>
          <span className="text-[10px] text-muted-foreground font-mono">
            {priceSource === 'live' ? 'Binance · Jupiter live' : 'IntercomSwap rates'}
          </span>
        </div>
        {activePair ? (
          <button
            onClick={() => setActivePair(null)}
            className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/8"
          >
            <X className="w-3 h-3" /> close
          </button>
        ) : (
          <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
            live
          </span>
        )}
      </div>

      {/* ── Ticker rows: compact when chart open, full when closed ── */}
      <div className="px-3 space-y-1.5">
        {tickers.map(t => {
          const isActive = activePair === t.symbol;
          const isHidden = activePair !== null && !isActive;
          return (
            <motion.div
              key={t.symbol}
              animate={{ opacity: isHidden ? 0.45 : 1, scale: isHidden ? 0.98 : 1 }}
              transition={{ duration: 0.2 }}
            >
              <button
                onClick={() => setActivePair(activePair === t.symbol ? null : t.symbol)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all duration-200 ${
                  isActive
                    ? `${t.bg} ${t.border}`
                    : "bg-muted/15 border-border hover:bg-muted/30 hover:border-border/80"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className={`text-base font-bold leading-none w-5 text-center ${t.color}`}>{t.icon}</span>
                  <div className="text-left">
                    <p className="text-xs font-mono text-foreground font-semibold tracking-wide">{t.symbol}</p>
                    {!isActive && (
                      <p className="text-[9px] text-muted-foreground font-mono mt-0.5">click for chart</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm font-mono text-foreground font-bold">
                      ${t.price.toLocaleString(undefined, { maximumFractionDigits: t.price > 1000 ? 0 : 2 })}
                    </p>
                    <span className={`text-[10px] font-mono flex items-center gap-0.5 justify-end ${
                      t.change >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}>
                      {t.change >= 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                      {t.change >= 0 ? "+" : ""}{t.change.toFixed(1)}%
                    </span>
                  </div>
                  <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${
                    isActive ? "rotate-90" : ""
                  }`} />
                </div>
              </button>
            </motion.div>
          );
        })}
      </div>

      {/* ── Chart panel — shown below all rows when a pair is active ── */}
      <AnimatePresence>
        {activePair && activeTicker && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.32, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {/* Chart toolbar */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              {/* Timeframe pills */}
              <div className="flex items-center gap-1 bg-muted/30 rounded-lg p-0.5">
                {TF_OPTIONS.map(tf => (
                  <button
                    key={tf.value}
                    onClick={() => setIntervalTF(tf.value)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-mono font-semibold transition-all duration-150 ${
                      interval === tf.value
                        ? `${activeTicker.bg} ${activeTicker.color} ${activeTicker.border} border`
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
              {/* Swap CTA */}
              <button
                onClick={() => toast.info(`Opening swap for ${activePair}`)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all duration-150 hover:scale-[1.02] active:scale-[0.98] ${
                  activeTicker.bg
                } ${activeTicker.border} ${activeTicker.color}`}
              >
                <ArrowLeftRight className="w-3 h-3" />
                Swap {activePair.split("/")[0]}
              </button>
            </div>

            {/* TradingView Advanced Chart widget */}
            <div className="mx-3 mb-3 rounded-xl overflow-hidden" style={{ border: `1px solid rgba(6,182,212,0.18)` }}>
              <TradingViewChart
                symbol={TV_SYMBOLS[activePair]}
                interval={interval}
                theme={tvTheme}
                height={240}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom padding when no chart */}
      {!activePair && <div className="pb-3" />}
    </div>
  );
}

// ── Agent Thought Stream (compact live feed) ───────────────────────────────
function AgentInsights({ onNavigateToTerminal }: { onNavigateToTerminal: () => void }) {
  const { entries } = useAgentLog();

  // Count decision types from real entries
  const decisionCounts = useMemo(() => {
    const counts: Record<string, number> = { MONITOR: 0, BROADCAST_RFQ: 0, WAIT: 0 };
    entries.forEach(e => {
      if (e.message.startsWith("Agent decision:")) {
        if (e.message.includes("BROADCAST_RFQ")) counts.BROADCAST_RFQ++;
        else if (e.message.includes("WAIT")) counts.WAIT++;
        else counts.MONITOR++;
      }
    });
    return counts;
  }, [entries]);

  // Count swaps executed from real entries
  const swapsExecuted = useMemo(() => {
    return entries.filter(e =>
      e.message.toLowerCase().includes("swap executed") ||
      e.message.toLowerCase().includes("swap complete") ||
      e.message.toLowerCase().includes("swap confirmed") ||
      (e.level === "success" && e.message.includes("→"))
    ).length;
  }, [entries]);

  // Parse swap display: "1 USDT → 0.0058 SOL" from message
  const parseSwapMessage = (msg: string): string => {
    // Match patterns like "1 USDT → 0.0058 SOL" or "Swap: 1 USDT to SOL"
    const arrowMatch = msg.match(/(\d+\.?\d*\s*\w+)\s*[→>]\s*(\d+\.?\d*\s*\w+)/);
    if (arrowMatch) return `${arrowMatch[1]} → ${arrowMatch[2]}`;
    const toMatch = msg.match(/(\d+\.?\d*\s*\w+)\s+to\s+(\w+)/i);
    if (toMatch) return `${toMatch[1]} → ${toMatch[2]}`;
    return msg.length > 80 ? msg.slice(0, 80) + "…" : msg;
  };

  // Last 5 confidence scores
  const confidenceTrend = useMemo(() => {
    return entries
      .filter(e => e.message.startsWith("Agent decision:"))
      .slice(-5)
      .map((e, i) => {
        const match = e.message.match(/(\d+)%/);
        return { i, value: match ? parseInt(match[1]) : 85 };
      });
  }, [entries]);

  // Last meaningful event (non-MONITOR)
  const lastEvent = useMemo(() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.level === "success" || e.level === "warn" || e.level === "error") return e;
      if (e.message.includes("BROADCAST_RFQ") || e.message.includes("Swap") || e.message.includes("Peer")) return e;
    }
    return entries[entries.length - 1] ?? null;
  }, [entries]);

  const total = decisionCounts.MONITOR + decisionCounts.BROADCAST_RFQ + decisionCounts.WAIT;
  const monitorPct = total > 0 ? Math.round((decisionCounts.MONITOR / total) * 100) : 0;
  const rfqPct = total > 0 ? Math.round((decisionCounts.BROADCAST_RFQ / total) * 100) : 0;
  const waitPct = total > 0 ? Math.round((decisionCounts.WAIT / total) * 100) : 0;
  const avgConfidence = confidenceTrend.length > 0
    ? Math.round(confidenceTrend.reduce((s, c) => s + c.value, 0) / confidenceTrend.length)
    : 85;

  const eventLevelColor = (level: string) =>
    level === "success" ? "text-emerald-400" :
    level === "warn" ? "text-amber-400" :
    level === "error" ? "text-red-400" : "text-cyan-300";

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Agent Insights</h3>
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        </div>
        <button
          onClick={onNavigateToTerminal}
          className="text-[10px] font-mono text-muted-foreground hover:text-cyan-400 transition-colors px-2 py-1 rounded-md hover:bg-cyan-500/10"
        >
          Full log →
        </button>
      </div>

      <div className="flex-1 overflow-hidden px-4 py-3 space-y-3 min-h-0">
        {/* Decision breakdown */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Decision Breakdown</span>
            <span className="text-[10px] font-mono text-muted-foreground">{total} total</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-cyan-400/70 w-24 shrink-0">MONITOR</span>
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <motion.div className="h-full rounded-full bg-cyan-500/60" initial={{ width: 0 }} animate={{ width: `${monitorPct}%` }} transition={{ duration: 0.6, ease: "easeOut" }} />
              </div>
              <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">{monitorPct}%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-emerald-400/70 w-24 shrink-0">RFQ</span>
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <motion.div className="h-full rounded-full bg-emerald-500/60" initial={{ width: 0 }} animate={{ width: `${rfqPct}%` }} transition={{ duration: 0.6, ease: "easeOut" }} />
              </div>
              <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">{rfqPct}%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-amber-400/70 w-24 shrink-0">WAIT</span>
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <motion.div className="h-full rounded-full bg-amber-500/60" initial={{ width: 0 }} animate={{ width: `${waitPct}%` }} transition={{ duration: 0.6, ease: "easeOut" }} />
              </div>
              <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">{waitPct}%</span>
            </div>
          </div>
        </div>

        {/* Confidence + Swaps row */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-muted/30 border border-border">
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Avg Confidence</div>
              <div className="text-lg font-bold text-foreground">{avgConfidence}%</div>
            </div>
            <div className="flex items-end gap-0.5 h-7">
              {(confidenceTrend.length > 0 ? confidenceTrend : [{i:0,value:85},{i:1,value:87},{i:2,value:85},{i:3,value:90},{i:4,value:88}]).map(c => (
                <div key={c.i} className="w-2 rounded-sm bg-cyan-500/50" style={{ height: `${Math.max(20, c.value)}%` }} />
              ))}
            </div>
          </div>
          <div className="flex flex-col justify-center p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Swaps Executed</div>
            <div className="text-lg font-bold text-emerald-400">{swapsExecuted}</div>
            <div className="text-[9px] text-muted-foreground mt-0.5">on-chain</div>
          </div>
        </div>

        {/* Last meaningful event */}
        {lastEvent && (
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Last Event</div>
            <div className="p-2.5 rounded-xl bg-muted/20 border border-border">
              <div className="flex items-start gap-2">
                <span className="text-[9px] font-mono text-muted-foreground/50 shrink-0 mt-0.5 tabular-nums">{lastEvent.ts.slice(0, 8)}</span>
                <span className={`text-[11px] font-mono leading-snug ${eventLevelColor(lastEvent.level)}`}>
                  {parseSwapMessage(lastEvent.message)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Mobile Hero Banner — Agent Chat as primary CTA ────────────────────
function MobileHeroBanner({ onNavigateToTerminal, onNavigateToChat }: {
  onNavigateToTerminal: () => void;
  onNavigateToChat: () => void;
}) {
  const [uptime, setUptime] = useState(0);
  const [currentTask, setCurrentTask] = useState("Monitoring IntercomSwap DHT topic");
  const [walletTotal, setWalletTotal] = useState<number | null>(null);
  const haptic = useHaptic();

  useEffect(() => {
    const t = setInterval(() => setUptime(u => u + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const status = await getAgentStatus();
        if (status.lastDecision?.reasoning) {
          setCurrentTask(status.lastDecision.reasoning.slice(0, 80));
        }
      } catch { /* keep */ }
    };
    fetchStatus();
    const t = setInterval(fetchStatus, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const fetchWallet = async () => {
      try {
        const data = await getWallet();
        setWalletTotal(data.totalUsd);
      } catch { /* keep */ }
    };
    fetchWallet();
    const t = setInterval(fetchWallet, 30000);
    return () => clearInterval(t);
  }, []);

  const fmtUptime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${sec}s`;
  };

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid rgba(6,182,212,0.2)" }}>

      {/* Portfolio strip — compact top row */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
        <div>
          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-widest mb-0.5">Total Portfolio</p>
          <span className="text-xl font-bold font-mono text-foreground">
            {walletTotal !== null ? `$${walletTotal.toLocaleString()}` : <span className="text-muted-foreground text-base">$—</span>}
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] font-mono text-emerald-400">{fmtUptime(uptime)}</span>
        </div>
      </div>

      {/* Agent Chat — PRIMARY CTA */}
      <button
        onClick={() => { haptic.tap(); onNavigateToChat(); }}
        className="w-full px-4 py-4 flex items-center gap-3.5 transition-all active:scale-[0.98] hover:bg-cyan-500/5 group"
      >
        {/* Agent avatar */}
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 relative"
          style={{ background: "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(139,92,246,0.2))", border: "1px solid rgba(6,182,212,0.3)" }}>
          <Bot className="w-5 h-5 text-cyan-400" />
          <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2" style={{ borderColor: "var(--card)" }} />
        </div>

        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-bold text-foreground">Chat with AFOS Agent</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-mono font-semibold" style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)", color: "#10b981" }}>LIVE</span>
          </div>
          <motion.p
            key={currentTask}
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-[11px] text-muted-foreground truncate"
          >
            {currentTask}
          </motion.p>
        </div>

        {/* Arrow */}
        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-all group-hover:translate-x-0.5"
          style={{ background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.25)" }}>
          <ArrowRight className="w-4 h-4 text-cyan-400" />
        </div>
      </button>

      {/* Prompt hint */}
      <div className="px-4 pb-3.5">
        <p className="text-[10px] text-muted-foreground">
          Try: <span className="text-cyan-400/80 font-mono">"swap 1 USDT to SOL"</span> · <span className="text-cyan-400/80 font-mono">"what's the SOL price?"</span>
        </p>
      </div>
    </div>
  );
}

// ── Mobile Metric Strip (horizontal scroll) ───────────────────────────────
function MobileMetricStrip() {
  const [metrics, setMetrics] = useState({
    volume24h: 2840000,
    feesEarned: 5680,
    successRate: 98.7,
    activePeers: 7,
    p2pRatio: 9.95,
  });
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const stats = await getStats();
          setMetrics({
            volume24h: stats.totalVolumeUsd,
            feesEarned: stats.totalFeesUsd,
            successRate: 98.7,
            activePeers: stats.activePeers,
            p2pRatio: stats.p2pRatio * 100,
          });
      } catch { /* keep current metrics */ }
    };
    fetchStats();
    const t = setInterval(fetchStats, 60000);
    return () => clearInterval(t);
  }, []);

  const cards = [
    { label: "Total Volume", value: `$${(metrics.volume24h / 1000000).toFixed(2)}M`, change: "+3.2%", icon: BarChart3, color: "text-cyan-400", bg: "bg-cyan-500/8", border: "border-cyan-500/20" },
    { label: "Fees Collected", value: `$${metrics.feesEarned.toLocaleString()}`, change: "+12.4%", icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/8", border: "border-emerald-500/20" },
    { label: "P2P Ratio", value: `${metrics.p2pRatio.toFixed(1)}%`, change: "live", icon: Radio, color: "text-violet-400", bg: "bg-violet-500/8", border: "border-violet-500/20" },
    { label: "Active Peers", value: String(metrics.activePeers), change: "online", icon: Users, color: "text-amber-400", bg: "bg-amber-500/8", border: "border-amber-500/20" },
  ];

  return (
    <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none" style={{ scrollSnapType: "x mandatory" }}>
      {cards.map(card => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className={`rounded-xl border ${card.border} ${card.bg} p-3.5 shrink-0 w-[140px]`}
            style={{ scrollSnapAlign: "start" }}
          >
            <div className="flex items-center justify-between mb-2">
              <Icon className={`w-3.5 h-3.5 ${card.color}`} />
              <span className="text-[9px] font-mono text-emerald-400">{card.change}</span>
            </div>
            <p className={`text-base font-bold font-mono ${card.color}`}>{card.value}</p>
            <p className="text-[9px] text-muted-foreground mt-0.5">{card.label}</p>
          </div>
        );
      })}
    </div>
  );
}

// ── Mobile Wallets Strip (horizontal scroll chips) ────────────────────────
function MobileWalletStrip({ onOpenWalletModal }: { onOpenWalletModal: (asset: string, network: string, mode: "send" | "receive") => void }) {
  const [walletData, setWalletData] = useState<WalletAsset[]>([]);

  useEffect(() => {
    const fetchWallet = async () => {
      try {
        const data = await getWallet();
        setWalletData(data.wallets);
      } catch { /* keep empty */ }
    };
    fetchWallet();
    const t = setInterval(fetchWallet, 30000);
    return () => clearInterval(t);
  }, []);

  const ASSET_STYLE: Record<string, { color: string; border: string; bg: string }> = {
    SOL: { color: "text-purple-400", border: "border-purple-500/25", bg: "bg-purple-500/8" },
    USDT: { color: "text-emerald-400", border: "border-emerald-500/25", bg: "bg-emerald-500/8" },
    BTC: { color: "text-amber-400", border: "border-amber-500/25", bg: "bg-amber-500/8" },
    ETH: { color: "text-blue-400", border: "border-blue-500/25", bg: "bg-blue-500/8" },
  };

  const wallets = walletData.map(w => ({
    asset: w.asset,
    network: w.network,
    balance: w.balance,
    usd: w.usd,
    ...(ASSET_STYLE[w.asset] ?? { color: "text-cyan-400", border: "border-cyan-500/25", bg: "bg-cyan-500/8" }),
  }));

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Wallet className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">Wallets</span>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">non-custodial</span>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none">
        {wallets.map(w => (
          <div
            key={w.asset}
            className={`rounded-xl border ${w.border} ${w.bg} p-3 shrink-0 w-[120px]`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs font-bold font-mono ${w.color}`}>{w.asset}</span>
              <span className="text-[9px] text-muted-foreground font-mono">{w.network.slice(0, 3)}</span>
            </div>
            <p className={`text-sm font-mono font-bold ${w.color} mb-0.5`}>{w.balance}</p>
            <p className="text-[9px] text-muted-foreground mb-2.5">{w.usd}</p>
            <div className="flex gap-1.5">
              <button
                onClick={() => onOpenWalletModal(w.asset, w.network, "receive")}
                className="flex-1 flex items-center justify-center py-1 rounded-md text-[9px] font-semibold transition-all active:scale-95"
                style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)", color: "#10b981" }}
              >
                <ArrowDownLeft className="w-2.5 h-2.5" />
              </button>
              <button
                onClick={() => onOpenWalletModal(w.asset, w.network, "send")}
                className="flex-1 flex items-center justify-center py-1 rounded-md text-[9px] font-semibold transition-all active:scale-95"
                style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171" }}
              >
                <ArrowUpRight className="w-2.5 h-2.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Mobile Recent Swaps (compact, 3 items) ────────────────────────────────
function MobileRecentSwaps({ onViewAll }: { onViewAll: () => void }) {
  const [rawSwaps, setRawSwaps] = useState<RfqResult[]>([]);

  useEffect(() => {
    const fetchSwaps = async () => {
      try {
        const data = await getSwaps();
        setRawSwaps([...data.completed, ...data.pending]);
      } catch { /* keep empty */ }
    };
    fetchSwaps();
    const t = setInterval(fetchSwaps, 30000);
    return () => clearInterval(t);
  }, []);

  const SWAPS = rawSwaps.map(s => ({
    id: s.rfqId,
    from: s.fromToken,
    to: s.toToken,
    fromAmt: s.inAmount.toString(),
    toAmt: s.outAmount.toFixed(4),
    status: 'complete' as 'complete' | 'pending' | 'failed',
    time: new Date(s.timestamp).toLocaleTimeString(),
    protocol: s.route === 'p2p' ? 'IntercomSwap P2P' : `DEX: ${s.dexRoute}`,
  }));

  const STATUS_STYLE = {
    complete: { icon: CheckCircle2, color: "text-emerald-400", dot: "bg-emerald-400" },
    pending: { icon: Loader2, color: "text-amber-400", dot: "bg-amber-400" },
    failed: { icon: AlertTriangle, color: "text-red-400", dot: "bg-red-400" },
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">Recent Swaps</span>
        </div>
        <button onClick={onViewAll} className="text-[10px] text-muted-foreground hover:text-cyan-400 transition-colors font-mono flex items-center gap-1">
          View all <ArrowRight className="w-2.5 h-2.5" />
        </button>
      </div>
      <div className="space-y-2">
        {SWAPS.slice(0, 3).map(swap => {
          const s = STATUS_STYLE[swap.status];
          return (
            <div key={swap.id} className="flex items-center gap-2.5 py-2 border-b border-border/40 last:border-0">
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot} ${swap.status === "pending" ? "animate-pulse" : ""}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-mono font-semibold text-foreground">{swap.fromAmt} {swap.from}</span>
                  <ArrowRight className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
                  <span className="text-xs font-mono font-semibold text-foreground">{swap.toAmt} {swap.to}</span>
                </div>
                <p className="text-[9px] text-muted-foreground font-mono">{swap.protocol}</p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-[9px] font-mono ${s.color}`}>{swap.status}</p>
                <p className="text-[9px] text-muted-foreground">{swap.time}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Mobile Agent Insights (decision breakdown + confidence) ──────────────────
function MobileAgentActivity({ onNavigateToTerminal }: { onNavigateToTerminal: () => void }) {
  const { entries } = useAgentLog();

  const decisionCounts = useMemo(() => {
    const counts: Record<string, number> = { MONITOR: 0, BROADCAST_RFQ: 0, WAIT: 0 };
    entries.forEach(e => {
      if (e.message.startsWith("Agent decision:")) {
        if (e.message.includes("BROADCAST_RFQ")) counts.BROADCAST_RFQ++;
        else if (e.message.includes("WAIT")) counts.WAIT++;
        else counts.MONITOR++;
      }
    });
    return counts;
  }, [entries]);

  const swapsExecuted = useMemo(() => {
    return entries.filter(e =>
      e.message.toLowerCase().includes("swap executed") ||
      e.message.toLowerCase().includes("swap complete") ||
      e.message.toLowerCase().includes("swap confirmed") ||
      (e.level === "success" && e.message.includes("→"))
    ).length;
  }, [entries]);

  const parseSwapMessage = (msg: string): string => {
    const arrowMatch = msg.match(/(\d+\.?\d*\s*\w+)\s*[→>]\s*(\d+\.?\d*\s*\w+)/);
    if (arrowMatch) return `${arrowMatch[1]} → ${arrowMatch[2]}`;
    const toMatch = msg.match(/(\d+\.?\d*\s*\w+)\s+to\s+(\w+)/i);
    if (toMatch) return `${toMatch[1]} → ${toMatch[2]}`;
    return msg.length > 60 ? msg.slice(0, 60) + "…" : msg;
  };

  const confidenceTrend = useMemo(() => {
    return entries
      .filter(e => e.message.startsWith("Agent decision:"))
      .slice(-5)
      .map((e, i) => {
        const match = e.message.match(/(\d+)%/);
        return { i, value: match ? parseInt(match[1]) : 85 };
      });
  }, [entries]);

  const lastEvent = useMemo(() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.level === "success" || e.level === "warn" || e.level === "error") return e;
      if (e.message.includes("BROADCAST_RFQ") || e.message.includes("Swap") || e.message.includes("Peer")) return e;
    }
    return entries[entries.length - 1] ?? null;
  }, [entries]);

  const total = decisionCounts.MONITOR + decisionCounts.BROADCAST_RFQ + decisionCounts.WAIT;
  const monitorPct = total > 0 ? Math.round((decisionCounts.MONITOR / total) * 100) : 0;
  const rfqPct = total > 0 ? Math.round((decisionCounts.BROADCAST_RFQ / total) * 100) : 0;
  const waitPct = total > 0 ? Math.round((decisionCounts.WAIT / total) * 100) : 0;
  const avgConfidence = confidenceTrend.length > 0
    ? Math.round(confidenceTrend.reduce((s, c) => s + c.value, 0) / confidenceTrend.length)
    : 85;

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Gauge className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">Agent Insights</span>
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        </div>
        <button
          onClick={onNavigateToTerminal}
          className="text-[10px] font-mono text-muted-foreground hover:text-cyan-400 transition-colors px-2 py-1 rounded hover:bg-cyan-500/10"
        >
          Full log →
        </button>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Decision breakdown */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Decisions</span>
            <span className="text-[9px] font-mono text-muted-foreground">{total} total</span>
          </div>
          <div className="space-y-1.5">
            {[{label:"MONITOR",pct:monitorPct,color:"bg-cyan-500/60",textColor:"text-cyan-400/70"},{label:"RFQ",pct:rfqPct,color:"bg-emerald-500/60",textColor:"text-emerald-400/70"},{label:"WAIT",pct:waitPct,color:"bg-amber-500/60",textColor:"text-amber-400/70"}].map(row => (
              <div key={row.label} className="flex items-center gap-2">
                <span className={`text-[9px] font-mono w-16 shrink-0 ${row.textColor}`}>{row.label}</span>
                <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                  <motion.div className={`h-full rounded-full ${row.color}`} initial={{ width: 0 }} animate={{ width: `${row.pct}%` }} transition={{ duration: 0.6, ease: "easeOut" }} />
                </div>
                <span className="text-[9px] font-mono text-muted-foreground w-7 text-right">{row.pct}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Confidence + Swaps + last event */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2.5 rounded-xl bg-muted/30 border border-border">
            <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Confidence</div>
            <div className="text-lg font-bold text-foreground">{avgConfidence}%</div>
            <div className="flex items-end gap-0.5 h-4 mt-1">
              {(confidenceTrend.length > 0 ? confidenceTrend : [{i:0,value:85},{i:1,value:87},{i:2,value:85},{i:3,value:90},{i:4,value:88}]).map(c => (
                <div key={c.i} className="flex-1 rounded-sm bg-cyan-500/40" style={{ height: `${Math.max(20, c.value)}%` }} />
              ))}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Swaps Executed</div>
            <div className="text-lg font-bold text-emerald-400">{swapsExecuted}</div>
            <div className="text-[9px] text-muted-foreground mt-0.5">on-chain</div>
          </div>
        </div>
        {lastEvent && (
          <div className="p-2.5 rounded-xl bg-muted/20 border border-border overflow-hidden">
            <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Last Event</div>
            <div className="text-[9px] font-mono text-cyan-300 leading-snug line-clamp-2">
              {parseSwapMessage(lastEvent.message)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Mobile Market Card (chart at 260px height) ────────────────────────────
function MobileMarketCard() {
  const { theme } = useTheme();
  const tvTheme = theme === "light" ? "light" : "dark";
  const [prices, setPrices] = useState({
    BTC: { price: 96420, change: +3.2 },
    ETH: { price: 2680, change: +0.8 },
    SOL: { price: 142.80, change: -1.1 },
  });
  // Persist chart pair + timeframe in localStorage (shared key with desktop)
  const [activePair, setActivePairState] = useState<string | null>(() => {
    try { return localStorage.getItem("afos_chart_pair") ?? null; } catch { return null; }
  });
  const [interval, setIntervalTFState] = useState<string>(() => {
    try { return localStorage.getItem("afos_chart_tf") ?? "5"; } catch { return "5"; }
  });
  const setActivePair = (pair: string | null) => {
    setActivePairState(pair);
    try { if (pair) localStorage.setItem("afos_chart_pair", pair); else localStorage.removeItem("afos_chart_pair"); } catch { /* ignore */ }
  };
  const setIntervalTF = (tf: string) => {
    setIntervalTFState(tf);
    try { localStorage.setItem("afos_chart_tf", tf); } catch { /* ignore */ }
  };

  useEffect(() => {
    const t = setInterval(() => {
      setPrices(prev => ({
        BTC: { price: prev.BTC.price + (Math.random() - 0.5) * 50, change: prev.BTC.change + (Math.random() - 0.5) * 0.1 },
        ETH: { price: prev.ETH.price + (Math.random() - 0.5) * 5, change: prev.ETH.change + (Math.random() - 0.5) * 0.1 },
        SOL: { price: prev.SOL.price + (Math.random() - 0.5) * 0.5, change: prev.SOL.change + (Math.random() - 0.5) * 0.1 },
      }));
    }, 4000);
    return () => clearInterval(t);
  }, []);

  const tickers = [
    { symbol: "BTC/USDT", ...prices.BTC, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", icon: "₿" },
    { symbol: "ETH/USDT", ...prices.ETH, color: "text-blue-400",  bg: "bg-blue-500/10",  border: "border-blue-500/20",  icon: "Ξ" },
    { symbol: "SOL/USDT", ...prices.SOL, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20", icon: "◎" },
  ];

  const TF_OPTIONS = [
    { label: "1m", value: "1" },
    { label: "5m", value: "5" },
    { label: "30m", value: "30" },
    { label: "1h", value: "60" },
    { label: "4h", value: "240" },
    { label: "1D", value: "D" },
  ];

  const activeTicker = tickers.find(t => t.symbol === activePair);

  return (
    <div className={`rounded-2xl border bg-card overflow-hidden transition-all duration-300 ${
      activePair ? "border-cyan-500/30" : "border-border"
    }`}>
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">Market</span>
          {activePair && (
            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full border ${
              activeTicker ? `${activeTicker.bg} ${activeTicker.border} ${activeTicker.color}` : ""
            }`}>{activePair}</span>
          )}
        </div>
        {activePair ? (
          <button onClick={() => setActivePair(null)} className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-red-400 transition-colors">
            <X className="w-3 h-3" /> close
          </button>
        ) : (
          <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
            live
          </span>
        )}
      </div>

      <div className="px-3 space-y-1.5">
        {tickers.map(t => {
          const isActive = activePair === t.symbol;
          const isHidden = activePair !== null && !isActive;
          return (
            <motion.div key={t.symbol} animate={{ opacity: isHidden ? 0.4 : 1 }} transition={{ duration: 0.2 }}>
              <button
                onClick={() => setActivePair(activePair === t.symbol ? null : t.symbol)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all duration-200 ${
                  isActive ? `${t.bg} ${t.border}` : "bg-muted/15 border-border hover:bg-muted/30"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold w-4 text-center ${t.color}`}>{t.icon}</span>
                  <span className="text-xs font-mono text-foreground font-semibold">{t.symbol}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <p className="text-xs font-mono text-foreground font-bold">
                      ${t.price.toLocaleString(undefined, { maximumFractionDigits: t.price > 1000 ? 0 : 2 })}
                    </p>
                    <span className={`text-[9px] font-mono flex items-center gap-0.5 justify-end ${
                      t.change >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}>
                      {t.change >= 0 ? <TrendingUp className="w-2 h-2" /> : <TrendingDown className="w-2 h-2" />}
                      {t.change >= 0 ? "+" : ""}{t.change.toFixed(1)}%
                    </span>
                  </div>
                  <ChevronRight className={`w-3 h-3 text-muted-foreground transition-transform duration-200 ${isActive ? "rotate-90" : ""}`} />
                </div>
              </button>
            </motion.div>
          );
        })}
      </div>

      <AnimatePresence>
        {activePair && activeTicker && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <div className="flex items-center gap-1 bg-muted/30 rounded-lg p-0.5">
                {TF_OPTIONS.map(tf => (
                  <button
                    key={tf.value}
                    onClick={() => setIntervalTF(tf.value)}
                    className={`px-2 py-1 rounded-md text-[9px] font-mono font-semibold transition-all ${
                      interval === tf.value
                        ? `${activeTicker.bg} ${activeTicker.color} ${activeTicker.border} border`
                        : "text-muted-foreground"
                    }`}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => toast.info(`Opening swap for ${activePair}`)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-all active:scale-95 ${
                  activeTicker.bg
                } ${activeTicker.border} ${activeTicker.color}`}
              >
                <ArrowLeftRight className="w-2.5 h-2.5" />
                Swap {activePair.split("/")[0]}
              </button>
            </div>
            <div className="mx-3 mb-3 rounded-xl overflow-hidden" style={{ border: `1px solid rgba(6,182,212,0.18)` }}>
              <TradingViewChart
                symbol={TV_SYMBOLS[activePair]}
                interval={interval}
                theme={tvTheme}
                height={340}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {!activePair && <div className="pb-3" />}
    </div>
  );
}

// ── Stack Health Strip ─────────────────────────────────────────────────────
function StackHealthStrip() {
  const services = [
    { name: "AFOS Agent", status: "live", color: "bg-emerald-400" },
    { name: "IntercomSwap", status: "live", color: "bg-emerald-400" },
    { name: "Bitcoin", status: "live", color: "bg-emerald-400" },
    { name: "Solana", status: "live", color: "bg-emerald-400" },
    { name: "Ethereum", status: "building", color: "bg-amber-400" },
  ];

  return (
    <div className="flex items-center gap-3 px-5 py-2.5 border-t border-border bg-muted/20 shrink-0">
      <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">Stack</span>
      <div className="flex items-center gap-3 flex-1">
        {services.map(s => (
          <div key={s.name} className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${s.color} ${s.status === "live" ? "animate-pulse" : ""}`} />
            <span className="text-[10px] text-muted-foreground font-mono">{s.name}</span>
          </div>
        ))}
      </div>
      <span className="text-[10px] text-emerald-400 font-mono">4/5 live</span>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const { theme, toggleTheme } = useTheme();
  const { connected, shortAddress } = useWallet();
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [walletModal, setWalletModal] = useState<WalletModalState | null>(null);
  const [activePage, setActivePage] = useState<NavPage>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // Swipe-right from left edge to open drawer
  const swipeTouchStartX = useRef<number | null>(null);
  const handleGlobalTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches[0].clientX < 24) swipeTouchStartX.current = e.touches[0].clientX;
    else swipeTouchStartX.current = null;
  };
  const handleGlobalTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (swipeTouchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - swipeTouchStartX.current;
    if (dx > 60) setMobileDrawerOpen(true);
    swipeTouchStartX.current = null;
  };

  const navItems = [
    { id: "dashboard" as NavPage, icon: Cpu, label: "Overview" },
    { id: "chat" as NavPage, icon: Bot, label: "Agent Chat" },
    { id: "swaps" as NavPage, icon: ArrowLeftRight, label: "Swaps" },
    { id: "activity" as NavPage, icon: Activity, label: "History" },
    { id: "network" as NavPage, icon: Network, label: "Network" },
    { id: "settings" as NavPage, icon: Settings, label: "Settings" },
    // Terminal is intentionally excluded from nav — accessible via "Full log →" link on Overview
  ];

  const renderSubPage = () => {
    if (activePage === "chat") return <ChatPage />;
    if (activePage === "swaps") return <Swaps />;
    if (activePage === "activity") return <SwapHistory />;
    if (activePage === "settings") return <AgentSettings />;
    if (activePage === "network") return <NetworkPage />;
    if (activePage === "terminal") return <TerminalPage />;
    return null;
  };

  const subPage = renderSubPage();

  return (
    <div
      className="flex h-screen bg-background font-sans"
      style={{ overflow: "hidden" }}
      onTouchStart={handleGlobalTouchStart}
      onTouchEnd={handleGlobalTouchEnd}
    >
      <div className="relative z-10 flex-shrink-0" style={{ overflow: "visible" }}>
        <DesktopSidebar navItems={navItems} activePage={activePage} setActivePage={setActivePage} open={sidebarOpen} setOpen={setSidebarOpen} />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Topbar */}
        <header className="h-14 border-b border-border flex items-center justify-between px-4 lg:px-6 shrink-0 bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-2 lg:gap-3">
            {/* Mobile: hamburger to open drawer */}
            <button
              className="lg:hidden w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors active:scale-95"
              onClick={() => setMobileDrawerOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm text-muted-foreground font-mono hidden sm:block">AFOS Agent</span>
            <span className="text-muted-foreground/40 hidden sm:block">·</span>
            <span className="text-xs text-cyan-400/70 font-mono">intercomswap@mainnet</span>
          </div>
          <div className="flex items-center gap-2 lg:gap-4">
            <span className="text-xs text-muted-foreground font-mono hidden xl:block">0000intercomswapbtcusdt</span>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/20">
              <Radio className="w-3 h-3 text-violet-400 animate-pulse" />
              <span className="text-xs text-violet-300 font-mono">3 peers</span>
            </div>
            {connected ? (
              <button
                onClick={() => setShowWalletModal(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all"
                style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", color: "#10b981" }}>
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {shortAddress}
              </button>
            ) : (
              <button
                onClick={() => setShowWalletModal(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold transition-all"
                style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)", color: "#60a5fa" }}>
                <Wallet className="w-3 h-3" />
                Connect
              </button>
            )}
            <button
              onClick={toggleTheme}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:scale-110 active:scale-95"
              style={{
                background: theme === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)",
                border: theme === "dark" ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.1)",
              }}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark"
                ? <Sun className="w-3.5 h-3.5 text-amber-400" />
                : <Moon className="w-3.5 h-3.5 text-slate-500" />}
            </button>
          </div>
        </header>

        {/* Content */}
        {subPage ? (
          <main className="flex-1 overflow-auto">{subPage}</main>
        ) : (
          /* ── OVERVIEW ── */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-auto">

              {/* ── DESKTOP: 2-column layout ── */}
              <div className="hidden lg:grid grid-cols-12 gap-5 p-5 h-full" style={{ minHeight: 0 }}>

                {/* LEFT col — Mini Chat + Metrics + Quick Actions + Market (with charts) */}
                <div className="col-span-7 flex flex-col gap-4 min-h-0">
                  <MiniChatWidget onOpenFullChat={() => setActivePage("chat")} />
                  <MetricsRow />
                  <QuickActions onNavigate={setActivePage} />
                  <MarketTicker />
                </div>

                {/* RIGHT col — Portfolio + Wallets + Recent Swaps + Agent Activity */}
                <div className="col-span-5 flex flex-col gap-4 min-h-0">
                  <PortfolioCard />
                  <WalletsCard />
                  <RecentSwapsCard onViewAll={() => setActivePage("activity")} />
                  <AgentInsights onNavigateToTerminal={() => setActivePage("terminal")} />
                </div>
              </div>

              {/* ── MOBILE: optimized single-column layout ── */}
              <div className="lg:hidden flex flex-col gap-3 p-3 pb-6">
                {/* 1. Hero: portfolio + agent status merged */}
                <MobileHeroBanner onNavigateToTerminal={() => setActivePage("terminal")} onNavigateToChat={() => setActivePage("chat")} />

                {/* 2. Metrics: horizontal scroll strip */}
                <MobileMetricStrip />

                {/* 3. Quick actions: 2×2 grid with large tap targets */}
                <QuickActions onNavigate={setActivePage} />

                {/* 4. Market chart: compact with 260px chart height */}
                <MobileMarketCard />

                {/* 5. Wallets: horizontal scroll chips */}
                 <MobileWalletStrip onOpenWalletModal={(asset, network, mode) => setWalletModal({ asset, network, mode })} />

                {/* 6. Recent swaps: compact 3-item list */}
                <MobileRecentSwaps onViewAll={() => setActivePage("activity")} />

                {/* 7. Agent activity: compact 5-line feed */}
                <MobileAgentActivity onNavigateToTerminal={() => setActivePage("terminal")} />
              </div>
            </div>

            {/* Stack health strip at bottom */}
            <StackHealthStrip />
          </div>
        )}
      </div>

      <MobileSidebarDrawer
        navItems={navItems}
        activePage={activePage}
        setActivePage={setActivePage}
        open={mobileDrawerOpen}
        onClose={() => setMobileDrawerOpen(false)}
        onOpenWallet={() => setShowWalletModal(true)}
        connected={connected}
        shortAddress={shortAddress ?? undefined}
      />
      {walletModal && <WalletModal modal={walletModal} onClose={() => setWalletModal(null)} />}
      <ConnectWalletModal open={showWalletModal} onClose={() => setShowWalletModal(false)} />
    </div>
  );
}
