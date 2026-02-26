/**
 * AFOS — Swaps Page
 * Design: Glassmorphism + Agentic Sci-Fi (dark navy-black, cyan-teal accents, gold financial values)
 * Protocol: IntercomSwap P2P atomic swap — RFQ → HTLC escrow → atomic settlement
 * Chains: Bitcoin (Lightning), Ethereum, Solana
 * Fee structure: Platform 5% + Trade 10%, capped at 15% total
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDownUp, Zap, Shield, Clock, ChevronDown,
  RefreshCw, AlertCircle, CheckCircle2, Loader2,
  Radio, Network, TrendingUp, TrendingDown,
  Bot, Cpu, Lock, Unlock, ExternalLink, Copy,
  Activity, Users, Globe, BarChart3
} from "lucide-react";
import { toast } from "sonner";
import { useHaptic } from "../hooks/useHaptic";

// ─── Chain & Token Config ─────────────────────────────────────────────────────

const CHAINS = {
  bitcoin: {
    id: "bitcoin",
    name: "Bitcoin",
    shortName: "BTC",
    network: "Lightning Network",
    color: "#f7931a",
    bgColor: "rgba(247,147,26,0.12)",
    borderColor: "rgba(247,147,26,0.3)",
    icon: "₿",
    settlement: "~2s (Lightning)",
    rpc: "LND mainnet",
  },
  ethereum: {
    id: "ethereum",
    name: "Ethereum",
    shortName: "ETH",
    network: "Ethereum Mainnet",
    color: "#627eea",
    bgColor: "rgba(98,126,234,0.12)",
    borderColor: "rgba(98,126,234,0.3)",
    icon: "Ξ",
    settlement: "~12s (EVM)",
    rpc: "Infura / Alchemy",
  },
  solana: {
    id: "solana",
    name: "Solana",
    shortName: "SOL",
    network: "Solana Mainnet",
    color: "#9945ff",
    bgColor: "rgba(153,69,255,0.12)",
    borderColor: "rgba(153,69,255,0.3)",
    icon: "◎",
    settlement: "~400ms (Solana)",
    rpc: "Helius RPC",
  },
};

const TOKENS = [
  { symbol: "BTC", name: "Bitcoin", chain: "bitcoin", balance: 0.04821, usdPrice: 43418, icon: "₿", color: "#f7931a" },
  { symbol: "ETH", name: "Ethereum", chain: "ethereum", balance: 0.812, usdPrice: 2998, icon: "Ξ", color: "#627eea" },
  { symbol: "SOL", name: "Solana", chain: "solana", balance: 12.5, usdPrice: 150, icon: "◎", color: "#9945ff" },
  { symbol: "USDT", name: "Tether (Solana)", chain: "solana", balance: 1240, usdPrice: 1, icon: "₮", color: "#26a17b" },
  { symbol: "USDC", name: "USD Coin (ETH)", chain: "ethereum", balance: 890, usdPrice: 1, icon: "$", color: "#2775ca" },
  { symbol: "WBTC", name: "Wrapped Bitcoin", chain: "ethereum", balance: 0.012, usdPrice: 43418, icon: "₿", color: "#f7931a" },
];

// ─── Swap Pairs (IntercomSwap native + extended) ──────────────────────────────

const SWAP_PAIRS = [
  { from: "BTC", to: "USDT", protocol: "Lightning ↔ Solana HTLC", native: true, fee: "0.5%", time: "~3s" },
  { from: "BTC", to: "ETH", protocol: "Lightning ↔ EVM HTLC", native: false, fee: "0.8%", time: "~15s" },
  { from: "ETH", to: "SOL", protocol: "EVM ↔ Solana Bridge", native: false, fee: "0.6%", time: "~20s" },
  { from: "SOL", to: "USDT", protocol: "Solana SPL Swap", native: true, fee: "0.3%", time: "~1s" },
  { from: "ETH", to: "USDC", protocol: "EVM DEX Route", native: false, fee: "0.3%", time: "~12s" },
  { from: "BTC", to: "SOL", protocol: "Lightning ↔ Solana HTLC", native: true, fee: "0.7%", time: "~4s" },
];

// ─── Mock P2P Peers ───────────────────────────────────────────────────────────

const MOCK_PEERS = [
  { id: "peer_0x4f2a", alias: "AlphaNode", latency: 12, volume: "$142k", pairs: ["BTC/USDT", "BTC/SOL"], online: true, reputation: 99.2 },
  { id: "peer_0x8c1e", alias: "BetaSwap", latency: 34, volume: "$89k", pairs: ["ETH/USDC", "ETH/SOL"], online: true, reputation: 97.8 },
  { id: "peer_0x2d9b", alias: "GammaLN", latency: 8, volume: "$231k", pairs: ["BTC/USDT", "BTC/ETH"], online: true, reputation: 99.8 },
  { id: "peer_0x7a3c", alias: "DeltaNode", latency: 67, volume: "$45k", pairs: ["SOL/USDT"], online: true, reputation: 95.1 },
  { id: "peer_0x1f6d", alias: "EpsilonPeer", latency: 21, volume: "$178k", pairs: ["BTC/USDT", "ETH/USDC"], online: false, reputation: 98.4 },
];

// ─── Swap Step Types ──────────────────────────────────────────────────────────

type SwapPhase = "idle" | "rfq" | "negotiating" | "locking" | "settling" | "complete" | "error";

interface SwapStep {
  id: string;
  label: string;
  description: string;
  phase: SwapPhase;
  icon: React.ReactNode;
}

// ─── Token Selector ───────────────────────────────────────────────────────────

function TokenSelector({
  selected,
  onSelect,
  label,
  exclude,
}: {
  selected: typeof TOKENS[0];
  onSelect: (t: typeof TOKENS[0]) => void;
  label: string;
  exclude?: string;
}) {
  const [open, setOpen] = useState(false);
  const chain = CHAINS[selected.chain as keyof typeof CHAINS];

  return (
    <div className="relative">
      <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">{label}</div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all"
        style={{
          background: chain.bgColor,
          border: `1px solid ${chain.borderColor}`,
        }}
      >
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0"
          style={{ background: `${selected.color}22`, color: selected.color }}
        >
          {selected.icon}
        </div>
        <div className="flex-1 text-left">
          <div className="text-sm font-bold text-white">{selected.symbol}</div>
          <div className="text-[10px] text-slate-400">{selected.name}</div>
        </div>
        <div className="text-right">
          <div className="text-xs font-mono text-slate-300">{selected.balance.toLocaleString(undefined, { maximumFractionDigits: 5 })}</div>
          <div className="text-[10px] text-slate-500">${(selected.balance * selected.usdPrice).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
        <ChevronDown className="w-4 h-4 text-slate-400 ml-1" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full mt-2 left-0 right-0 z-50 rounded-xl overflow-hidden"
            style={{
              background: "oklch(0.13 0.03 265)",
              border: "1px solid oklch(0.28 0.04 255 / 0.4)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
            }}
          >
            {TOKENS.filter(t => t.symbol !== exclude).map(token => {
              const tc = CHAINS[token.chain as keyof typeof CHAINS];
              return (
                <button
                  key={token.symbol}
                  onClick={() => { onSelect(token); setOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-base font-bold"
                    style={{ background: `${token.color}22`, color: token.color }}>
                    {token.icon}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-semibold text-white">{token.symbol}</div>
                    <div className="text-[10px] text-slate-500">{tc.network}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-mono text-slate-300">{token.balance.toLocaleString(undefined, { maximumFractionDigits: 5 })}</div>
                    <div className="text-[10px] text-slate-500">${(token.balance * token.usdPrice).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                  </div>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Swap Progress Tracker ────────────────────────────────────────────────────

function SwapProgressTracker({ phase, fromToken, toToken, fromAmount, toAmount }: {
  phase: SwapPhase;
  fromToken: typeof TOKENS[0];
  toToken: typeof TOKENS[0];
  fromAmount: string;
  toAmount: string;
}) {
  const steps: { id: SwapPhase; label: string; desc: string }[] = [
    { id: "rfq", label: "RFQ Broadcast", desc: "Broadcasting request-for-quote to P2P network" },
    { id: "negotiating", label: "Peer Negotiation", desc: "IntercomSwap peers responding with quotes" },
    { id: "locking", label: "HTLC Lock", desc: "Locking funds in escrow (atomic commitment)" },
    { id: "settling", label: "Atomic Settlement", desc: "Cross-chain settlement executing" },
    { id: "complete", label: "Confirmed", desc: "Swap complete — funds in your wallet" },
  ];

  const phaseOrder: SwapPhase[] = ["idle", "rfq", "negotiating", "locking", "settling", "complete", "error"];
  const currentIdx = phaseOrder.indexOf(phase);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-5 mt-4"
      style={{
        background: "oklch(0.13 0.03 265 / 0.9)",
        border: "1px solid oklch(0.28 0.04 255 / 0.3)",
        backdropFilter: "blur(20px)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-xs font-mono text-cyan-400 uppercase tracking-widest">
            {phase === "complete" ? "Swap Complete" : phase === "error" ? "Swap Failed" : "Swap In Progress"}
          </span>
        </div>
        <div className="text-[10px] font-mono text-slate-500">
          {fromAmount} {fromToken.symbol} → {toAmount} {toToken.symbol}
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-3">
        {steps.map((step, i) => {
          const stepIdx = phaseOrder.indexOf(step.id);
          const isComplete = currentIdx > stepIdx;
          const isActive = currentIdx === stepIdx;
          const isPending = currentIdx < stepIdx;

          return (
            <div key={step.id} className="flex items-start gap-3">
              {/* Indicator */}
              <div className="flex flex-col items-center mt-0.5">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-500"
                  style={{
                    background: isComplete ? "oklch(0.55 0.18 165)" : isActive ? "oklch(0.55 0.2 220)" : "oklch(0.2 0.03 265)",
                    border: isActive ? "2px solid oklch(0.7 0.2 220)" : "2px solid transparent",
                    boxShadow: isActive ? "0 0 12px oklch(0.7 0.2 220 / 0.5)" : "none",
                  }}
                >
                  {isComplete ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
                  ) : isActive ? (
                    <Loader2 className="w-3.5 h-3.5 text-cyan-300 animate-spin" />
                  ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                  )}
                </div>
                {i < steps.length - 1 && (
                  <div
                    className="w-px h-4 mt-1 transition-all duration-500"
                    style={{ background: isComplete ? "oklch(0.55 0.18 165 / 0.5)" : "oklch(0.25 0.03 265)" }}
                  />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 pb-1">
                <div className={`text-xs font-semibold transition-colors duration-300 ${isComplete ? "text-emerald-400" : isActive ? "text-cyan-300" : "text-slate-500"}`}>
                  {step.label}
                </div>
                <div className="text-[10px] text-slate-600 mt-0.5">{step.desc}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Complete state */}
      {phase === "complete" && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mt-4 p-3 rounded-xl flex items-center gap-3"
          style={{ background: "oklch(0.55 0.18 165 / 0.1)", border: "1px solid oklch(0.55 0.18 165 / 0.3)" }}
        >
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <div>
            <div className="text-xs font-semibold text-emerald-400">Atomic swap settled successfully</div>
            <div className="text-[10px] text-slate-500 font-mono mt-0.5">
              Tx: 0x{Math.random().toString(16).slice(2, 14)}...{Math.random().toString(16).slice(2, 8)}
            </div>
          </div>
          <button
            onClick={() => toast.info("Explorer link coming soon")}
            className="ml-auto text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
          >
            View <ExternalLink className="w-3 h-3" />
          </button>
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── P2P Peer Panel ───────────────────────────────────────────────────────────

function PeerPanel({ fromToken, toToken }: { fromToken: typeof TOKENS[0]; toToken: typeof TOKENS[0] }) {
  const pair = `${fromToken.symbol}/${toToken.symbol}`;
  const relevantPeers = MOCK_PEERS.filter(p =>
    p.pairs.some(pp => pp === pair || pp === `${toToken.symbol}/${fromToken.symbol}`)
  );
  const allPeers = relevantPeers.length > 0 ? relevantPeers : MOCK_PEERS.slice(0, 3);

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "oklch(0.13 0.03 265 / 0.7)",
        border: "1px solid oklch(0.28 0.04 255 / 0.2)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Network className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-xs font-semibold text-slate-300">P2P Peers</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-slate-500">{allPeers.filter(p => p.online).length} online</span>
        </div>
      </div>

      <div className="space-y-2">
        {allPeers.map(peer => (
          <div
            key={peer.id}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
            style={{ background: "oklch(0.17 0.03 265 / 0.5)" }}
          >
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${peer.online ? "bg-emerald-400" : "bg-slate-600"}`} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-mono text-slate-300 truncate">{peer.alias}</div>
              <div className="text-[9px] text-slate-600">{peer.id}</div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-[10px] font-mono text-cyan-400">{peer.latency}ms</div>
              <div className="text-[9px] text-slate-600">{peer.reputation}%</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
        <span className="text-[10px] text-slate-600">IntercomSwap DHT</span>
        <span className="text-[10px] font-mono text-cyan-500">142 total peers</span>
      </div>
    </div>
  );
}

// ─── Recent Swaps ─────────────────────────────────────────────────────────────

const RECENT_SWAPS = [
  { from: "BTC", to: "USDT", fromAmt: "0.0023", toAmt: "100.00", status: "complete", time: "2m ago", peer: "GammaLN", protocol: "Lightning ↔ Solana" },
  { from: "ETH", to: "SOL", fromAmt: "0.12", toAmt: "24.01", status: "complete", time: "18m ago", peer: "BetaSwap", protocol: "EVM ↔ Solana" },
  { from: "SOL", to: "USDT", fromAmt: "5.0", toAmt: "750.00", status: "complete", time: "1h ago", peer: "AlphaNode", protocol: "Solana SPL" },
  { from: "BTC", to: "ETH", fromAmt: "0.005", toAmt: "0.072", status: "failed", time: "3h ago", peer: "DeltaNode", protocol: "Lightning ↔ EVM" },
  { from: "USDC", to: "SOL", fromAmt: "300.00", toAmt: "2.00", status: "complete", time: "5h ago", peer: "GammaLN", protocol: "EVM DEX" },
];

function RecentSwaps() {
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "oklch(0.13 0.03 265 / 0.7)",
        border: "1px solid oklch(0.28 0.04 255 / 0.2)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-xs font-semibold text-slate-300">Recent Swaps</span>
        </div>
        <span className="text-[10px] text-slate-600">Last 24h</span>
      </div>

      <div className="space-y-2">
        {RECENT_SWAPS.map((swap, i) => (
          <div
            key={i}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
            style={{ background: "oklch(0.17 0.03 265 / 0.5)" }}
          >
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${swap.status === "complete" ? "bg-emerald-400" : "bg-red-400"}`} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-mono text-slate-200">
                <span className="text-amber-400">{swap.fromAmt} {swap.from}</span>
                <span className="text-slate-500 mx-1">→</span>
                <span className="text-cyan-400">{swap.toAmt} {swap.to}</span>
              </div>
              <div className="text-[9px] text-slate-600">{swap.protocol} · {swap.peer}</div>
            </div>
            <div className="text-[10px] text-slate-600 flex-shrink-0">{swap.time}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Chain Stats Bar ──────────────────────────────────────────────────────────

function ChainStatsBar() {
  const [prices, setPrices] = useState({
    BTC: 43418, ETH: 2998, SOL: 150
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setPrices(prev => ({
        BTC: Math.round(prev.BTC + (Math.random() - 0.5) * 120),
        ETH: Math.round(prev.ETH + (Math.random() - 0.5) * 30),
        SOL: Math.round((prev.SOL + (Math.random() - 0.5) * 2) * 100) / 100,
      }));
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const stats = [
    { symbol: "BTC", price: prices.BTC, change: +2.4, color: "#f7931a", icon: "₿", network: "Lightning" },
    { symbol: "ETH", price: prices.ETH, change: +1.1, color: "#627eea", icon: "Ξ", network: "Ethereum" },
    { symbol: "SOL", price: prices.SOL, change: -0.8, color: "#9945ff", icon: "◎", network: "Solana" },
  ];

  return (
    <div className="grid grid-cols-3 gap-3 mb-6">
      {stats.map(stat => (
        <div
          key={stat.symbol}
          className="rounded-xl px-4 py-3 flex items-center gap-3"
          style={{
            background: `${stat.color}0d`,
            border: `1px solid ${stat.color}30`,
          }}
        >
          <div className="text-xl font-bold" style={{ color: stat.color }}>{stat.icon}</div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold font-mono text-white">${stat.price.toLocaleString()}</span>
              <span className={`text-[10px] font-mono ${stat.change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {stat.change >= 0 ? "▲" : "▼"} {Math.abs(stat.change)}%
              </span>
            </div>
            <div className="text-[10px] text-slate-500">{stat.network}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Agent Mode Toggle ────────────────────────────────────────────────────────

function AgentModeToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl transition-all w-full"
      style={{
        background: enabled ? "oklch(0.55 0.2 220 / 0.15)" : "oklch(0.17 0.03 265)",
        border: `1px solid ${enabled ? "oklch(0.55 0.2 220 / 0.4)" : "oklch(0.28 0.04 255 / 0.2)"}`,
      }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: enabled ? "oklch(0.55 0.2 220 / 0.2)" : "oklch(0.2 0.03 265)" }}
      >
        {enabled ? <Bot className="w-4 h-4 text-cyan-400" /> : <Cpu className="w-4 h-4 text-slate-500" />}
      </div>
      <div className="flex-1 text-left">
        <div className={`text-xs font-semibold ${enabled ? "text-cyan-300" : "text-slate-400"}`}>
          {enabled ? "Agent Mode Active" : "Agent Mode Off"}
        </div>
        <div className="text-[10px] text-slate-600">
          {enabled ? "OpenClaw executing swaps autonomously" : "Manual swap execution"}
        </div>
      </div>
      <div
        className="w-9 h-5 rounded-full relative transition-all flex-shrink-0"
        style={{ background: enabled ? "oklch(0.55 0.2 220)" : "oklch(0.25 0.03 265)" }}
      >
        <div
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all duration-300"
          style={{ left: enabled ? "calc(100% - 18px)" : "2px" }}
        />
      </div>
    </button>
  );
}

// ─── Live Order Book ─────────────────────────────────────────────────────────

interface OrderBookEntry {
  id: string;
  peer: string;
  fromSymbol: string;
  toSymbol: string;
  fromAmount: number;
  toAmount: number;
  rate: number;
  usdValue: number;
  expiresIn: number; // seconds
  latency: number;
  reputation: number;
}

function generateOrders(fromSym: string, toSym: string, baseRate: number): OrderBookEntry[] {
  const peers = ["GammaLN", "AlphaNode", "BetaSwap", "DeltaNode", "EpsilonPeer", "ZetaHub", "EtaNode"];
  return Array.from({ length: 7 }, (_, i) => {
    const spread = (Math.random() - 0.5) * 0.02; // ±1% spread
    const rate = baseRate * (1 + spread);
    const fromAmount = parseFloat((Math.random() * 0.5 + 0.001).toFixed(5));
    const usdValue = fromAmount * (fromSym === "BTC" ? 43418 : fromSym === "ETH" ? 2998 : fromSym === "SOL" ? 150 : 1);
    return {
      id: `order_${i}_${Date.now()}`,
      peer: peers[i % peers.length],
      fromSymbol: fromSym,
      toSymbol: toSym,
      fromAmount,
      toAmount: parseFloat((fromAmount * rate).toFixed(toSym === "USDT" || toSym === "USDC" ? 2 : 6)),
      rate,
      usdValue,
      expiresIn: Math.floor(Math.random() * 55 + 10),
      latency: Math.floor(Math.random() * 60 + 5),
      reputation: parseFloat((95 + Math.random() * 5).toFixed(1)),
    };
  }).sort((a, b) => b.rate - a.rate);
}

function LiveOrderBook({ fromToken, toToken, onAccept }: {
  fromToken: typeof TOKENS[0];
  toToken: typeof TOKENS[0];
  onAccept: (order: OrderBookEntry) => void;
}) {
  const baseRate = toToken.usdPrice > 0 ? fromToken.usdPrice / toToken.usdPrice : 1;
  const [orders, setOrders] = useState<OrderBookEntry[]>(() =>
    generateOrders(fromToken.symbol, toToken.symbol, baseRate)
  );
  const [flash, setFlash] = useState<string | null>(null);

  // Refresh orders when pair changes
  useEffect(() => {
    setOrders(generateOrders(fromToken.symbol, toToken.symbol, baseRate));
  }, [fromToken.symbol, toToken.symbol]);

  // Simulate live order book updates every 4s
  useEffect(() => {
    const interval = setInterval(() => {
      setOrders(prev => {
        const updated = prev.map(o => ({
          ...o,
          expiresIn: Math.max(0, o.expiresIn - 4),
          rate: o.rate * (1 + (Math.random() - 0.5) * 0.004),
        })).filter(o => o.expiresIn > 0);

        // Add new order occasionally
        if (updated.length < 7 || Math.random() < 0.4) {
          const newOrder = generateOrders(fromToken.symbol, toToken.symbol, baseRate)[0];
          setFlash(newOrder.id);
          setTimeout(() => setFlash(null), 800);
          return [...updated.slice(0, 6), newOrder].sort((a, b) => b.rate - a.rate);
        }
        return updated;
      });
    }, 4000);
    return () => clearInterval(interval);
  }, [fromToken.symbol, toToken.symbol, baseRate]);

  const bestRate = orders.length > 0 ? Math.max(...orders.map(o => o.rate)) : baseRate;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "oklch(0.13 0.03 265 / 0.85)",
        border: "1px solid oklch(0.28 0.04 255 / 0.25)",
        backdropFilter: "blur(20px)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "oklch(0.28 0.04 255 / 0.15)" }}>
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs font-bold text-white">Live Order Book</span>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <p className="text-[9px] text-slate-600 mt-0.5">Open RFQ offers · {fromToken.symbol}/{toToken.symbol} · Updates every 4s</p>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono text-amber-400">{orders.length} offers</div>
          <div className="text-[9px] text-slate-600">Best: {bestRate.toFixed(4)}</div>
        </div>
      </div>

      {/* Column headers */}
      <div
        className="grid text-[9px] font-mono uppercase tracking-widest text-slate-600 px-4 py-2 border-b"
        style={{ gridTemplateColumns: "1fr 0.9fr 0.9fr 0.7fr 0.6fr", borderColor: "oklch(0.28 0.04 255 / 0.08)" }}
      >
        <span>Peer</span>
        <span>Offer</span>
        <span>Rate</span>
        <span>Expires</span>
        <span>Action</span>
      </div>

      {/* Order rows */}
      <div className="divide-y" style={{ borderColor: "oklch(0.28 0.04 255 / 0.06)" }}>
        <AnimatePresence mode="popLayout">
          {orders.slice(0, 6).map((order, i) => {
            const isBest = order.rate === bestRate;
            const isFlashing = flash === order.id;
            const expiryPct = (order.expiresIn / 60) * 100;
            return (
              <motion.div
                key={order.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0, background: isFlashing ? "oklch(0.55 0.2 220 / 0.12)" : "transparent" }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ delay: i * 0.04 }}
                className="grid items-center px-4 py-2.5 hover:bg-white/3 transition-colors"
                style={{ gridTemplateColumns: "1fr 0.9fr 0.9fr 0.7fr 0.6fr" }}
              >
                {/* Peer */}
                <div>
                  <div className="flex items-center gap-1.5">
                    {isBest && <div className="w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" />}
                    <span className="text-[10px] font-mono text-slate-300">{order.peer}</span>
                  </div>
                  <div className="text-[9px] text-slate-600">{order.latency}ms · {order.reputation}%</div>
                </div>

                {/* Offer amount */}
                <div>
                  <div className="text-[10px] font-mono" style={{ color: TOKEN_COLORS[order.fromSymbol] ?? "#94a3b8" }}>
                    {order.fromAmount.toLocaleString(undefined, { maximumFractionDigits: 5 })} {order.fromSymbol}
                  </div>
                  <div className="text-[9px] text-slate-600">${order.usdValue.toFixed(0)}</div>
                </div>

                {/* Rate */}
                <div>
                  <div className={`text-[10px] font-mono font-semibold ${isBest ? "text-amber-400" : "text-slate-400"}`}>
                    {order.rate.toFixed(4)}
                  </div>
                  <div className="text-[9px] text-slate-600">{order.toAmount} {order.toSymbol}</div>
                </div>

                {/* Expiry */}
                <div>
                  <div className={`text-[10px] font-mono ${order.expiresIn < 15 ? "text-red-400" : "text-slate-500"}`}>
                    {order.expiresIn}s
                  </div>
                  <div className="w-full h-1 rounded-full mt-1 overflow-hidden" style={{ background: "oklch(0.2 0.03 265)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-1000"
                      style={{
                        width: `${expiryPct}%`,
                        background: order.expiresIn < 15 ? "oklch(0.65 0.22 25)" : "oklch(0.65 0.2 165)",
                      }}
                    />
                  </div>
                </div>

                {/* Accept button */}
                <button
                  onClick={() => onAccept(order)}
                  className="px-2 py-1 rounded-lg text-[9px] font-bold transition-all hover:scale-105 active:scale-95"
                  style={{
                    background: isBest ? "oklch(0.55 0.2 220 / 0.2)" : "oklch(0.17 0.03 265)",
                    border: `1px solid ${isBest ? "oklch(0.55 0.2 220 / 0.4)" : "oklch(0.28 0.04 255 / 0.2)"}`,
                    color: isBest ? "oklch(0.75 0.2 220)" : "#64748b",
                  }}
                >
                  Accept
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t flex items-center justify-between" style={{ borderColor: "oklch(0.28 0.04 255 / 0.1)" }}>
        <span className="text-[9px] text-slate-600">IntercomSwap DHT · 142 total peers</span>
        <div className="flex items-center gap-1.5">
          <div className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[9px] text-emerald-500">Live</span>
        </div>
      </div>
    </div>
  );
}

const TOKEN_COLORS: Record<string, string> = {
  BTC: "#f7931a", ETH: "#627eea", SOL: "#9945ff",
  USDT: "#26a17b", USDC: "#2775ca", WBTC: "#f7931a",
};

// ─── Main Swaps Page ──────────────────────────────────────────────────────────

export default function Swaps() {
  const [fromToken, setFromToken] = useState(TOKENS[0]); // BTC
  const [toToken, setToToken] = useState(TOKENS[3]);     // USDT
  const [fromAmount, setFromAmount] = useState("0.001");
  const [slippage, setSlippage] = useState("0.5");
  const [swapPhase, setSwapPhase] = useState<SwapPhase>("idle");
  const [agentMode, setAgentMode] = useState(true);
  const [selectedPeer, setSelectedPeer] = useState<typeof MOCK_PEERS[0] | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derived values
  const fromTokenData = TOKENS.find(t => t.symbol === fromToken.symbol) || TOKENS[0];
  const toTokenData = TOKENS.find(t => t.symbol === toToken.symbol) || TOKENS[3];

  const rate = toTokenData.usdPrice > 0 ? fromTokenData.usdPrice / toTokenData.usdPrice : 0;
  const toAmount = (parseFloat(fromAmount || "0") * rate).toFixed(toTokenData.usdPrice >= 1 ? 2 : 6);
  const fromUsd = (parseFloat(fromAmount || "0") * fromTokenData.usdPrice).toFixed(2);
  const toUsd = (parseFloat(toAmount) * toTokenData.usdPrice).toFixed(2);

  const platformFee = (parseFloat(fromUsd) * 0.005).toFixed(2);
  const tradeFee = (parseFloat(fromUsd) * 0.003).toFixed(2);
  const totalFee = (parseFloat(platformFee) + parseFloat(tradeFee)).toFixed(2);

  const swapPair = SWAP_PAIRS.find(p =>
    (p.from === fromToken.symbol && p.to === toToken.symbol) ||
    (p.from === toToken.symbol && p.to === fromToken.symbol)
  );

  const handleFlip = () => {
    const temp = fromToken;
    setFromToken(toToken);
    setToToken(temp);
    setFromAmount(toAmount);
  };

  const runSwapAnimation = useCallback(() => {
    const phases: SwapPhase[] = ["rfq", "negotiating", "locking", "settling", "complete"];
    const delays = [0, 1800, 3500, 5500, 7500];

    phases.forEach((phase, i) => {
      phaseTimerRef.current = setTimeout(() => {
        setSwapPhase(phase);
        if (phase === "complete") {
          haptic.success();
          toast.success(`Swap complete: ${fromAmount} ${fromToken.symbol} → ${toAmount} ${toToken.symbol}`, {
            description: "Atomic settlement confirmed on-chain",
          });
        }
      }, delays[i]);
    });
  }, [fromAmount, fromToken.symbol, toAmount, toToken.symbol]);

  const haptic = useHaptic();

  const handleSwap = () => {
    if (parseFloat(fromAmount) <= 0) {
      haptic.error();
      toast.error("Enter a valid amount");
      return;
    }
    if (swapPhase !== "idle" && swapPhase !== "complete" && swapPhase !== "error") return;
    haptic.tap();
    setSwapPhase("idle");
    setTimeout(runSwapAnimation, 100);
  };

  const handleReset = () => {
    if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    setSwapPhase("idle");
  };

  const handleAcceptOrder = (order: OrderBookEntry) => {
    haptic.tap();
    setFromAmount(order.fromAmount.toString());
    toast.success(`Quote accepted from ${order.peer}`, {
      description: `${order.fromAmount} ${order.fromSymbol} → ${order.toAmount} ${order.toSymbol} at rate ${order.rate.toFixed(4)}`,
    });
  };

  const isSwapping = swapPhase !== "idle" && swapPhase !== "complete" && swapPhase !== "error";

  return (
    <div className="flex-1 overflow-y-auto p-3 sm:p-6" style={{ background: "transparent" }}>
      {/* Page Header */}
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight">Agentic Swap</h1>
          <p className="text-xs text-slate-500 mt-0.5 hidden sm:block">
            P2P atomic swaps via IntercomSwap · RFQ → HTLC → Settlement
          </p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg"
            style={{ background: "oklch(0.55 0.18 165 / 0.1)", border: "1px solid oklch(0.55 0.18 165 / 0.25)" }}>
            <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
            <span className="text-[10px] font-mono text-emerald-400 hidden sm:inline">P2P Network Live</span>
            <span className="text-[10px] font-mono text-emerald-400 sm:hidden">Live</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg"
            style={{ background: "oklch(0.17 0.03 265)", border: "1px solid oklch(0.28 0.04 255 / 0.2)" }}>
            <Users className="w-3 h-3 text-cyan-400" />
            <span className="text-[10px] font-mono text-cyan-400">142</span>
          </div>
        </div>
      </div>

      {/* Chain Stats */}
      <ChainStatsBar />

      {/* Main Layout — single column on mobile, side-by-side on xl */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4 sm:gap-5">

        {/* Left: Swap Interface — full width on mobile, max-w centered */}
        <div className="space-y-4 w-full max-w-lg mx-auto xl:max-w-none xl:mx-0">

          {/* Agent Mode */}
          <AgentModeToggle enabled={agentMode} onToggle={() => setAgentMode(!agentMode)} />

          {/* Swap Card */}
          <div
            className="rounded-2xl p-4 sm:p-5"
            style={{
              background: "oklch(0.13 0.03 265 / 0.85)",
              border: "1px solid oklch(0.28 0.04 255 / 0.3)",
              backdropFilter: "blur(20px)",
              boxShadow: "0 8px 40px rgba(0,0,0,0.4)",
            }}
          >
            {/* Protocol Badge */}
            {swapPair && (
              <div className="flex items-center gap-2 mb-4">
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono"
                  style={{
                    background: swapPair.native ? "oklch(0.55 0.2 220 / 0.12)" : "oklch(0.55 0.18 165 / 0.1)",
                    border: `1px solid ${swapPair.native ? "oklch(0.55 0.2 220 / 0.3)" : "oklch(0.55 0.18 165 / 0.25)"}`,
                    color: swapPair.native ? "oklch(0.75 0.2 220)" : "oklch(0.75 0.18 165)",
                  }}
                >
                  {swapPair.native ? <Zap className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
                  {swapPair.protocol}
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono"
                  style={{ background: "oklch(0.17 0.03 265)", border: "1px solid oklch(0.28 0.04 255 / 0.2)", color: "#94a3b8" }}>
                  <Clock className="w-3 h-3" />
                  {swapPair.time}
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono"
                  style={{ background: "oklch(0.17 0.03 265)", border: "1px solid oklch(0.28 0.04 255 / 0.2)", color: "#94a3b8" }}>
                  <Shield className="w-3 h-3" />
                  Non-custodial
                </div>
              </div>
            )}

            {/* From Token */}
            <TokenSelector
              selected={fromToken}
              onSelect={setFromToken}
              label="YOU SEND"
              exclude={toToken.symbol}
            />

            {/* Amount Input */}
            <div className="mt-3 mb-2">
              <div className="relative">
                <input
                  type="number"
                  value={fromAmount}
                  onChange={e => setFromAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-4 py-3 rounded-xl text-2xl font-bold font-mono text-white bg-transparent outline-none"
                  style={{
                    background: "oklch(0.17 0.03 265)",
                    border: "1px solid oklch(0.28 0.04 255 / 0.3)",
                  }}
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-right">
                  <div className="text-xs text-slate-500">≈ ${parseFloat(fromUsd).toLocaleString()}</div>
                  <button
                    onClick={() => setFromAmount(fromToken.balance.toString())}
                    className="text-[10px] text-cyan-500 hover:text-cyan-400 transition-colors"
                  >
                    MAX
                  </button>
                </div>
              </div>
            </div>

            {/* Flip Button */}
            <div className="flex justify-center my-3">
              <button
                onClick={handleFlip}
                className="w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95"
                style={{
                  background: "oklch(0.55 0.2 220 / 0.15)",
                  border: "1px solid oklch(0.55 0.2 220 / 0.4)",
                }}
              >
                <ArrowDownUp className="w-4 h-4 text-cyan-400" />
              </button>
            </div>

            {/* To Token */}
            <TokenSelector
              selected={toToken}
              onSelect={setToToken}
              label="YOU RECEIVE"
              exclude={fromToken.symbol}
            />

            {/* Output Amount */}
            <div className="mt-3 px-4 py-3 rounded-xl"
              style={{ background: "oklch(0.17 0.03 265)", border: "1px solid oklch(0.28 0.04 255 / 0.2)" }}>
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold font-mono text-white">{toAmount}</span>
                <div className="text-right">
                  <div className="text-xs text-slate-500">≈ ${parseFloat(toUsd).toLocaleString()}</div>
                  <div className="text-[10px] text-slate-600">1 {fromToken.symbol} = {rate.toFixed(4)} {toToken.symbol}</div>
                </div>
              </div>
            </div>

            {/* Fee Breakdown */}
            <div className="mt-4 px-4 py-3 rounded-xl space-y-1.5"
              style={{ background: "oklch(0.15 0.03 265 / 0.5)", border: "1px solid oklch(0.25 0.03 265)" }}>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">Platform fee (0.5%)</span>
                <span className="font-mono text-slate-400">${platformFee}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">Trade fee (0.3%)</span>
                <span className="font-mono text-slate-400">${tradeFee}</span>
              </div>
              <div className="flex justify-between text-[11px] pt-1 border-t border-white/5">
                <span className="text-slate-400 font-semibold">Total fees</span>
                <span className="font-mono text-amber-400 font-semibold">${totalFee}</span>
              </div>
            </div>

            {/* Advanced Settings */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-400 transition-colors w-full"
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
              Advanced settings
            </button>

            <AnimatePresence>
              {showAdvanced && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 space-y-3">
                    <div>
                      <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Slippage Tolerance</div>
                      <div className="flex gap-2">
                        {["0.1", "0.5", "1.0"].map(s => (
                          <button
                            key={s}
                            onClick={() => setSlippage(s)}
                            className="flex-1 py-1.5 rounded-lg text-xs font-mono transition-all"
                            style={{
                              background: slippage === s ? "oklch(0.55 0.2 220 / 0.2)" : "oklch(0.17 0.03 265)",
                              border: `1px solid ${slippage === s ? "oklch(0.55 0.2 220 / 0.4)" : "oklch(0.28 0.04 255 / 0.2)"}`,
                              color: slippage === s ? "oklch(0.75 0.2 220)" : "#64748b",
                            }}
                          >
                            {s}%
                          </button>
                        ))}
                        <input
                          type="number"
                          value={slippage}
                          onChange={e => setSlippage(e.target.value)}
                          className="flex-1 py-1.5 px-2 rounded-lg text-xs font-mono text-center bg-transparent outline-none"
                          style={{
                            background: "oklch(0.17 0.03 265)",
                            border: "1px solid oklch(0.28 0.04 255 / 0.2)",
                            color: "#94a3b8",
                          }}
                          placeholder="Custom"
                        />
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Preferred Peer</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {MOCK_PEERS.filter(p => p.online).slice(0, 4).map(peer => (
                          <button
                            key={peer.id}
                            onClick={() => setSelectedPeer(selectedPeer?.id === peer.id ? null : peer)}
                            className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-all"
                            style={{
                              background: selectedPeer?.id === peer.id ? "oklch(0.55 0.2 220 / 0.15)" : "oklch(0.17 0.03 265)",
                              border: `1px solid ${selectedPeer?.id === peer.id ? "oklch(0.55 0.2 220 / 0.35)" : "oklch(0.28 0.04 255 / 0.2)"}`,
                            }}
                          >
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                            <div>
                              <div className="text-[10px] font-mono text-slate-300">{peer.alias}</div>
                              <div className="text-[9px] text-slate-600">{peer.latency}ms · {peer.reputation}%</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Swap Button */}
            <button
              onClick={isSwapping ? undefined : swapPhase === "complete" ? handleReset : handleSwap}
              disabled={isSwapping}
              className="mt-5 w-full py-4 sm:py-4 rounded-xl font-bold text-sm tracking-wide transition-all active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed relative overflow-hidden"
              style={{
                background: swapPhase === "complete"
                  ? "oklch(0.55 0.18 165 / 0.2)"
                  : swapPhase === "error"
                    ? "oklch(0.55 0.22 25 / 0.2)"
                    : isSwapping
                      ? "oklch(0.55 0.2 220 / 0.15)"
                      : "oklch(0.55 0.2 220)",
                border: `1px solid ${swapPhase === "complete" ? "oklch(0.55 0.18 165 / 0.4)" : "oklch(0.65 0.2 220 / 0.5)"}`,
                color: swapPhase === "complete" ? "oklch(0.75 0.18 165)" : "white",
                boxShadow: isSwapping ? "none" : "0 4px 20px oklch(0.55 0.2 220 / 0.3)",
              }}
            >
              {isSwapping ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {swapPhase === "rfq" && "Broadcasting RFQ..."}
                  {swapPhase === "negotiating" && "Negotiating with peers..."}
                  {swapPhase === "locking" && "Locking in HTLC escrow..."}
                  {swapPhase === "settling" && "Atomic settlement..."}
                </span>
              ) : swapPhase === "complete" ? (
                <span className="flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Swap Complete — New Swap
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  {agentMode ? <Bot className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
                  {agentMode ? "Execute via Agent" : "Swap Now"}
                </span>
              )}
            </button>

            {agentMode && swapPhase === "idle" && (
              <p className="text-center text-[10px] text-slate-600 mt-2">
                OpenClaw will execute this swap autonomously via IntercomSwap P2P
              </p>
            )}
          </div>

          {/* Swap Progress */}
          {swapPhase !== "idle" && (
            <SwapProgressTracker
              phase={swapPhase}
              fromToken={fromToken}
              toToken={toToken}
              fromAmount={fromAmount}
              toAmount={toAmount}
            />
          )}
        </div>

        {/* Right: Info Panels — shown below swap card on mobile, side panel on xl */}
        <div className="space-y-4 w-full max-w-lg mx-auto xl:max-w-none xl:mx-0">
          <LiveOrderBook fromToken={fromToken} toToken={toToken} onAccept={handleAcceptOrder} />
          <PeerPanel fromToken={fromToken} toToken={toToken} />
          <RecentSwaps />

          {/* Protocol Info */}
          <div
            className="rounded-2xl p-4"
            style={{
              background: "oklch(0.13 0.03 265 / 0.7)",
              border: "1px solid oklch(0.28 0.04 255 / 0.2)",
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Lock className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-semibold text-slate-300">HTLC Escrow</span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Funds are locked in a Hash Time-Locked Contract on Solana. The swap settles atomically — either both legs complete or both refund. No counterparty risk.
            </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-2 gap-2">
              {[
                { label: "Lock time", value: "10 min" },
                { label: "Refund window", value: "20 min" },
                { label: "Escrow program", value: "Solana" },
                { label: "Coordination", value: "P2P DHT" },
              ].map(item => (
                <div key={item.label} className="px-2.5 py-2 rounded-lg"
                  style={{ background: "oklch(0.17 0.03 265 / 0.5)" }}>
                  <div className="text-[9px] text-slate-600">{item.label}</div>
                  <div className="text-[11px] font-mono text-slate-300 mt-0.5">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
