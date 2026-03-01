/**
 * AFOS — Swaps Page
 * Design: Glassmorphism + Agentic Sci-Fi (dark navy-black, cyan-teal accents, gold financial values)
 * Protocol: IntercomSwap P2P atomic swap — RFQ → HTLC escrow → atomic settlement
 * Chains: Bitcoin (on-chain), Ethereum, Solana
 * Fee structure: Platform 5% + Trade 10%, capped at 15% total
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDownUp, Zap, Shield, Clock, ChevronDown,
  RefreshCw, AlertCircle, CheckCircle2, Loader2,
  Radio, Network, TrendingUp, TrendingDown,
  Bot, Cpu, Lock, Unlock, ExternalLink, Copy,
  Activity, Users, Globe, BarChart3,
  Repeat, Timer, Filter, Rss, Play, Square, RotateCcw, GitMerge
} from "lucide-react";
import { toast } from "sonner";
import { useHaptic } from "../hooks/useHaptic";
import { useWallet } from "../contexts/WalletContext";
import ConnectWalletModal from "../components/ConnectWalletModal";
import { Wallet } from "lucide-react";
import { getPrices, getSwapQuote, submitRfq, onSSEEvent, getSwaps, getAgentStatus, type SwapQuote, type RfqResult } from "../lib/afosApi";

// ─── Chain & Token Config ─────────────────────────────────────────────────────

const CHAINS = {
  bitcoin: {
    id: "bitcoin",
    name: "Bitcoin",
    shortName: "BTC",
    network: "Bitcoin Network",
    color: "#f7931a",
    bgColor: "rgba(247,147,26,0.12)",
    borderColor: "rgba(247,147,26,0.3)",
    icon: "₿",
    settlement: "~10m (on-chain)",
    rpc: "Bitcoin mainnet",
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
  { from: "BTC", to: "USDT", protocol: "IntercomSwap BTC↔USDT", native: true, fee: "0.5%", time: "~10m" },
  { from: "BTC", to: "ETH", protocol: "IntercomSwap BTC↔ETH", native: false, fee: "0.8%", time: "~15m" },
  { from: "ETH", to: "SOL", protocol: "EVM ↔ Solana Bridge", native: false, fee: "0.6%", time: "~20s" },
  { from: "SOL", to: "USDT", protocol: "Solana SPL Swap", native: true, fee: "0.3%", time: "~1s" },
  { from: "ETH", to: "USDC", protocol: "EVM DEX Route", native: false, fee: "0.3%", time: "~12s" },
  { from: "BTC", to: "SOL", protocol: "IntercomSwap BTC↔SOL", native: true, fee: "0.7%", time: "~10m" },
];

// ─── Live P2P Peer type (populated from SSE / getAgentStatus) ────────────────

interface LivePeer {
  id: string;
  alias: string;
  latency: number;
  pairs: string[];
  online: boolean;
  reputation: number;
}

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
          <div className="text-sm font-bold text-foreground">{selected.symbol}</div>
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
              background: "var(--card)",
              border: "1px solid var(--border)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
            }}
          >
            {TOKENS.filter(t => t.symbol !== exclude).map(token => {
              const tc = CHAINS[token.chain as keyof typeof CHAINS];
              return (
                <button
                  key={token.symbol}
                  onClick={() => { onSelect(token); setOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-base font-bold"
                    style={{ background: `${token.color}22`, color: token.color }}>
                    {token.icon}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-semibold text-foreground">{token.symbol}</div>
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

function SwapProgressTracker({ phase, fromToken, toToken, fromAmount, toAmount, rfqId }: {
  phase: SwapPhase;
  fromToken: typeof TOKENS[0];
  toToken: typeof TOKENS[0];
  fromAmount: string;
  toAmount: string;
  rfqId?: string;
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
        background: "var(--card)",
        border: "1px solid var(--border)",
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
                    background: isComplete ? "#10b981" : isActive ? "#3b82f6" : "var(--muted)",
                    border: isActive ? "2px solid #60a5fa" : "2px solid transparent",
                    boxShadow: isActive ? "0 0 12px rgba(96,165,250,0.5)" : "none",
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
                    style={{ background: isComplete ? "rgba(16,185,129,0.5)" : "var(--muted)" }}
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
          style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)" }}
        >
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <div>
            <div className="text-xs font-semibold text-emerald-400">Atomic swap settled successfully</div>
            <div className="text-[10px] text-slate-500 font-mono mt-0.5">
              {rfqId ? `RFQ: ${rfqId}` : 'Settlement confirmed'}
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

// ─── P2P Peer Panel (live from SSE) ───────────────────────────────────────────────────

function PeerPanel({ fromToken, toToken, livePeers, activePeerCount }: {
  fromToken: typeof TOKENS[0];
  toToken: typeof TOKENS[0];
  livePeers: LivePeer[];
  activePeerCount: number;
}) {
  const pair = `${fromToken.symbol}/${toToken.symbol}`;
  const relevantPeers = livePeers.filter(p =>
    p.pairs.some(pp => pp === pair || pp === `${toToken.symbol}/${fromToken.symbol}`)
  );
  const displayPeers = relevantPeers.length > 0 ? relevantPeers : livePeers.slice(0, 3);
  const onlineCount = livePeers.filter(p => p.online).length;

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Network className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-xs font-semibold text-slate-300">P2P Peers</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-slate-500">{onlineCount} online</span>
        </div>
      </div>

      {displayPeers.length === 0 ? (
        <p className="text-[11px] text-muted-foreground text-center py-3">
          Waiting for peers to announce…
        </p>
      ) : (
        <div className="space-y-2">
          {displayPeers.map(peer => (
            <div
              key={peer.id}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
              style={{ background: "var(--muted)" }}
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
      )}

      <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
        <span className="text-[10px] text-slate-600">IntercomSwap DHT</span>
        <span className="text-[10px] font-mono text-cyan-500">{activePeerCount > 0 ? `${activePeerCount} total peers` : 'Connecting…'}</span>
      </div>
    </div>
  );
}

// ─── Recent Swaps (live from Oracle VM) ──────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

function RecentSwaps() {
  const [swaps, setSwaps] = useState<RfqResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSwaps = async () => {
      try {
        const data = await getSwaps();
        setSwaps([...data.completed, ...data.pending].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5));
      } catch { /* keep previous */ } finally { setLoading(false); }
    };
    fetchSwaps();
    const t = setInterval(fetchSwaps, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-xs font-semibold text-slate-300">Recent Swaps</span>
        </div>
        <span className="text-[10px] text-slate-600">Last 24h</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
        </div>
      ) : swaps.length === 0 ? (
        <p className="text-[11px] text-muted-foreground text-center py-3">No recent swaps</p>
      ) : (
        <div className="space-y-2">
          {swaps.map(swap => (
            <div
              key={swap.rfqId}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
              style={{ background: "var(--muted)" }}
            >
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-emerald-400" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono text-slate-200">
                  <span className="text-amber-400">{swap.inAmount.toFixed(4)} {swap.fromToken}</span>
                  <span className="text-slate-500 mx-1">→</span>
                  <span className="text-cyan-400">{swap.outAmount.toFixed(4)} {swap.toToken}</span>
                </div>
                <div className="text-[9px] text-slate-600">
                  {swap.route === 'p2p' ? 'IntercomSwap P2P' : `DEX (${swap.dexRoute || 'Jupiter'})`}
                </div>
              </div>
              <div className="text-[10px] text-slate-600 flex-shrink-0">{timeAgo(swap.timestamp)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Chain Stats Bar ──────────────────────────────────────────────────────────

function ChainStatsBar() {
  const [prices, setPrices] = useState({
    BTC: { price: 67000, change: 0 },
    ETH: { price: 2000, change: 0 },
    SOL: { price: 87, change: 0 },
  });
  const [source, setSource] = useState<'live' | 'fallback'>('fallback');

  useEffect(() => {
    // Fetch real prices from AFOS backend
    const fetchPrices = async () => {
      try {
        const priceData = await getPrices();
          setPrices({
            BTC: { price: priceData.BTC?.usd ?? 67000, change: priceData.BTC?.change24h ?? 0 },
            ETH: { price: priceData.ETH?.usd ?? 2000, change: priceData.ETH?.change24h ?? 0 },
            SOL: { price: priceData.SOL?.usd ?? 87, change: priceData.SOL?.change24h ?? 0 },
          });
          setSource('live');
      } catch { /* keep fallback prices */ }
    };
    fetchPrices();
    const interval = setInterval(fetchPrices, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const stats = [
    { symbol: "BTC", price: prices.BTC.price, change: prices.BTC.change, color: "#f7931a", icon: "₿", network: source === 'live' ? "Binance Live" : "Bitcoin (fallback)" },
    { symbol: "ETH", price: prices.ETH.price, change: prices.ETH.change, color: "#627eea", icon: "Ξ", network: source === 'live' ? "Binance Live" : "Ethereum (fallback)" },
    { symbol: "SOL", price: prices.SOL.price, change: prices.SOL.change, color: "#9945ff", icon: "◎", network: source === 'live' ? "Jupiter Live" : "Solana (fallback)" },
  ];

  return (
    <div className="flex gap-3 mb-5 overflow-x-auto pb-1 -mx-1 px-1 sm:grid sm:grid-cols-3 sm:overflow-visible sm:pb-0 sm:mx-0 sm:px-0">
      {stats.map(stat => (
        <div
          key={stat.symbol}
          className="rounded-xl px-3 py-2.5 flex items-center gap-2.5 flex-shrink-0 sm:flex-shrink sm:px-4 sm:py-3 sm:gap-3"
          style={{
            background: `${stat.color}0d`,
            border: `1px solid ${stat.color}30`,
            minWidth: "140px",
          }}
        >
          <div className="text-lg sm:text-xl font-bold" style={{ color: stat.color }}>{stat.icon}</div>
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-xs sm:text-sm font-bold font-mono text-foreground">${stat.price.toLocaleString()}</span>
              <span className={`text-[10px] font-mono ${stat.change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {stat.change >= 0 ? "▲" : "▼"}{Math.abs(stat.change)}%
              </span>
            </div>
            <div className="text-[10px] text-slate-500 truncate">{stat.network}</div>
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
        background: enabled ? "rgba(59,130,246,0.15)" : "var(--muted)",
        border: `1px solid ${enabled ? "rgba(59,130,246,0.4)" : "var(--border)"}`,
      }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: enabled ? "rgba(59,130,246,0.2)" : "var(--muted)" }}
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
        style={{ background: enabled ? "#3b82f6" : "var(--muted)" }}
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
  const peers = ["GammaNode", "AlphaNode", "BetaSwap", "DeltaNode", "EpsilonPeer", "ZetaHub", "EtaNode"];
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
        background: "var(--card)",
        border: "1px solid var(--border)",
        backdropFilter: "blur(20px)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs font-bold text-foreground">Live Order Book</span>
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
        style={{ gridTemplateColumns: "1fr 0.9fr 0.9fr 0.7fr 0.6fr", borderColor: "var(--border)" }}
      >
        <span>Peer</span>
        <span>Offer</span>
        <span>Rate</span>
        <span>Expires</span>
        <span>Action</span>
      </div>

      {/* Order rows */}
      <div className="divide-y" style={{ borderColor: "var(--border)" }}>
        <AnimatePresence mode="popLayout">
          {orders.slice(0, 6).map((order, i) => {
            const isBest = order.rate === bestRate;
            const isFlashing = flash === order.id;
            const expiryPct = (order.expiresIn / 60) * 100;
            return (
              <motion.div
                key={order.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0, background: isFlashing ? "rgba(59,130,246,0.12)" : "transparent" }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ delay: i * 0.04 }}
                className="grid items-center px-4 py-2.5 hover:bg-muted/50 transition-colors"
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
                  <div className="w-full h-1 rounded-full mt-1 overflow-hidden" style={{ background: "var(--muted)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-1000"
                      style={{
                        width: `${expiryPct}%`,
                        background: order.expiresIn < 15 ? "#ef4444" : "#10b981",
                      }}
                    />
                  </div>
                </div>

                {/* Accept button */}
                <button
                  onClick={() => onAccept(order)}
                  className="px-2 py-1 rounded-lg text-[9px] font-bold transition-all hover:scale-105 active:scale-95"
                  style={{
                    background: isBest ? "rgba(59,130,246,0.2)" : "var(--muted)",
                    border: `1px solid ${isBest ? "rgba(59,130,246,0.4)" : "var(--border)"}`,
                    color: isBest ? "#3b82f6" : "var(--muted-foreground)",
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
      <div className="px-4 py-2.5 border-t flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
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

// ─── Live Feed Component ─────────────────────────────────────────────────────

type FeedMsgKind = "swap.svc_announce" | "swap.rfq" | "swap.quote" | "swap.quote_accept" | "swap.cancel" | "swap.settle";

interface FeedMessage {
  id: string;
  ts: string;
  kind: FeedMsgKind;
  channel: string;
  peer: string;
  payload: Record<string, unknown>;
}

const FEED_CHANNELS = ["0000intercomswapbtcusdt", "0000intercomswapbtcsol", "0000intercomswapethusdc"];

const KIND_COLORS: Record<FeedMsgKind, string> = {
  "swap.svc_announce": "#06b6d4",
  "swap.rfq": "#f59e0b",
  "swap.quote": "#10b981",
  "swap.quote_accept": "#8b5cf6",
  "swap.cancel": "#ef4444",
  "swap.settle": "#f7931a",
};

const KIND_LABELS: Record<FeedMsgKind, string> = {
  "swap.svc_announce": "SVC_ANNOUNCE",
  "swap.rfq": "RFQ",
  "swap.quote": "QUOTE",
  "swap.quote_accept": "ACCEPT",
  "swap.cancel": "CANCEL",
  "swap.settle": "SETTLE",
};

function generateFeedMsg(): FeedMessage {
  const kinds: FeedMsgKind[] = ["swap.svc_announce", "swap.rfq", "swap.quote", "swap.quote_accept", "swap.cancel", "swap.settle"];
  const weights = [0.25, 0.30, 0.20, 0.10, 0.10, 0.05];
  const r = Math.random();
  let cumulative = 0;
  let kind: FeedMsgKind = "swap.rfq";
  for (let i = 0; i < kinds.length; i++) {
    cumulative += weights[i];
    if (r < cumulative) { kind = kinds[i]; break; }
  }
  const peers = ["GammaNode", "AlphaNode", "BetaSwap", "DeltaNode", "IotaSwap", "ZetaHub"];
  const peer = peers[Math.floor(Math.random() * peers.length)];
  const channel = FEED_CHANNELS[Math.floor(Math.random() * FEED_CHANNELS.length)];
  const now = new Date();
  const ts = `${now.getHours().toString().padStart(2,"0")}:${now.getMinutes().toString().padStart(2,"0")}:${now.getSeconds().toString().padStart(2,"0")}.${now.getMilliseconds().toString().padStart(3,"0")}`;
  const btcAmt = (Math.random() * 0.1 + 0.001).toFixed(5);
  const usdtAmt = (parseFloat(btcAmt) * 43418 * (1 + (Math.random()-0.5)*0.02)).toFixed(2);
  const payloads: Record<FeedMsgKind, Record<string, unknown>> = {
    "swap.svc_announce": { peer_id: peer, pairs: ["BTC/USDT", "BTC/SOL"], fee_bps: Math.floor(Math.random()*30+5), version: "1.2.0", channels: Math.floor(Math.random()*8+1) },
    "swap.rfq": { from: "BTC", to: "USDT", amount: btcAmt, min_fee_bps: 10, max_fee_bps: 50, refund_window_min: 20, expiry: "+5m" },
    "swap.quote": { from: "BTC", to: "USDT", amount: btcAmt, quote_usdt: usdtAmt, fee_bps: Math.floor(Math.random()*20+5), rate: (parseFloat(usdtAmt)/parseFloat(btcAmt)).toFixed(2), expires_in: "45s" },
    "swap.quote_accept": { quote_id: `q_${Math.random().toString(36).slice(2,8)}`, peer, amount: btcAmt, rate: (43418*(1+(Math.random()-0.5)*0.01)).toFixed(2) },
    "swap.cancel": { reason: ["timeout", "rate_mismatch", "liquidity"][Math.floor(Math.random()*3)], rfq_id: `rfq_${Math.random().toString(36).slice(2,8)}` },
    "swap.settle": { tx_hash: `0x${Array.from({length:12},()=>Math.floor(Math.random()*16).toString(16)).join("")}...`, amount_btc: btcAmt, amount_usdt: usdtAmt, settlement_ms: Math.floor(Math.random()*4000+800) },
  };
  return { id: `${Date.now()}_${Math.random()}`, ts, kind, channel, peer, payload: payloads[kind] };
}

function LiveFeedTab() {
  const [messages, setMessages] = useState<FeedMessage[]>(() => Array.from({length: 12}, generateFeedMsg));
  const [filterKind, setFilterKind] = useState<FeedMsgKind | "all">("all");
  const [filterChannel, setFilterChannel] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [wsStatus, setWsStatus] = useState<"connecting" | "live" | "fallback">("connecting");
  const scrollRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const simRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Helper: push a message if not paused
  const pushMsg = (msg: FeedMessage) => {
    setMessages(prev => [msg, ...prev].slice(0, 80));
  };

  // Start simulation fallback
  const startSim = () => {
    setWsStatus("fallback");
    if (simRef.current) return;
    simRef.current = setInterval(() => {
      if (!paused) pushMsg(generateFeedMsg());
    }, 1800);
  };

  useEffect(() => {
    // Try to connect to a local IntercomSwap WebSocket node
    // The default IntercomSwap node exposes a WS feed at ws://localhost:8080/feed
    // or the user-configured endpoint from Settings
    const wsUrl = (typeof window !== "undefined" && (window as unknown as Record<string,string>).__INTERCOMSWAP_WS__)
      || "ws://localhost:8080/feed";

    let ws: WebSocket;
    let connectTimeout: ReturnType<typeof setTimeout>;

    try {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      connectTimeout = setTimeout(() => {
        // If no open within 3s, fall back to simulation
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
          startSim();
        }
      }, 3000);

      ws.onopen = () => {
        clearTimeout(connectTimeout);
        setWsStatus("live");
        // Subscribe to all rendezvous channels
        FEED_CHANNELS.forEach(ch => {
          ws.send(JSON.stringify({ action: "subscribe", channel: ch }));
        });
      };

      ws.onmessage = (event) => {
        if (paused) return;
        try {
          const raw = JSON.parse(event.data as string);
          // Normalize IntercomSwap message format
          const now = new Date();
          const ts = `${now.getHours().toString().padStart(2,"0")}:${now.getMinutes().toString().padStart(2,"0")}:${now.getSeconds().toString().padStart(2,"0")}.${now.getMilliseconds().toString().padStart(3,"0")}`;
          const msg: FeedMessage = {
            id: `${Date.now()}_${Math.random()}`,
            ts,
            kind: (raw.kind ?? raw.type ?? "swap.rfq") as FeedMsgKind,
            channel: raw.channel ?? raw.rendezvous ?? FEED_CHANNELS[0],
            peer: raw.peer_id ?? raw.from ?? raw.sender ?? "unknown",
            payload: raw,
          };
          pushMsg(msg);
        } catch { /* ignore malformed */ }
      };

      ws.onerror = () => {
        clearTimeout(connectTimeout);
        startSim();
      };

      ws.onclose = () => {
        clearTimeout(connectTimeout);
        if (wsStatus !== "live") startSim();
      };
    } catch {
      startSim();
    }

    return () => {
      wsRef.current?.close();
      if (simRef.current) clearInterval(simRef.current);
      simRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = messages.filter(m => {
    if (filterKind !== "all" && m.kind !== filterKind) return false;
    if (filterChannel !== "all" && m.channel !== filterChannel) return false;
    return true;
  });

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
          style={{
            background: wsStatus === "live" ? "rgba(16,185,129,0.1)" : wsStatus === "connecting" ? "rgba(245,158,11,0.1)" : "rgba(100,116,139,0.1)",
            border: `1px solid ${wsStatus === "live" ? "rgba(16,185,129,0.25)" : wsStatus === "connecting" ? "rgba(245,158,11,0.25)" : "rgba(100,116,139,0.25)"}`,
          }}>
          <div className={`w-1.5 h-1.5 rounded-full ${wsStatus === "live" ? "bg-emerald-400 animate-pulse" : wsStatus === "connecting" ? "bg-amber-400 animate-pulse" : "bg-slate-400"}`} />
          <span className={`text-[10px] font-mono ${wsStatus === "live" ? "text-emerald-400" : wsStatus === "connecting" ? "text-amber-400" : "text-slate-400"}`}>
            {wsStatus === "live" ? "WS Live" : wsStatus === "connecting" ? "Connecting…" : "Simulated"}
          </span>
        </div>
        <select value={filterKind} onChange={e => setFilterKind(e.target.value as FeedMsgKind | "all")}
          className="px-2.5 py-1.5 rounded-lg text-[10px] font-mono text-foreground outline-none"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <option value="all">All kinds</option>
          {(Object.keys(KIND_LABELS) as FeedMsgKind[]).map(k => (
            <option key={k} value={k}>{KIND_LABELS[k]}</option>
          ))}
        </select>
        <select value={filterChannel} onChange={e => setFilterChannel(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg text-[10px] font-mono text-foreground outline-none"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <option value="all">All channels</option>
          {FEED_CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={() => setPaused(p => !p)}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-mono transition-all"
          style={{ background: paused ? "rgba(239,68,68,0.1)" : "var(--muted)", border: `1px solid ${paused ? "rgba(239,68,68,0.3)" : "var(--border)"}`, color: paused ? "#ef4444" : "var(--muted-foreground)" }}>
          {paused ? <Play className="w-3 h-3" /> : <Square className="w-3 h-3" />}
          {paused ? "Resume" : "Pause"}
        </button>
        <button onClick={() => setMessages([])} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-mono text-muted-foreground transition-all"
          style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
          <RotateCcw className="w-3 h-3" />
          Clear
        </button>
      </div>

      {/* Message stream */}
      <div ref={scrollRef} className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="px-4 py-2.5 border-b flex items-center justify-between" style={{ borderColor: "var(--border)", background: "var(--muted)" }}>
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">P2P Message Stream</span>
          <span className="text-[10px] font-mono text-muted-foreground">{filtered.length} msgs</span>
        </div>
        <div className="divide-y" style={{ borderColor: "var(--border)", maxHeight: "520px", overflowY: "auto" }}>
          <AnimatePresence mode="popLayout" initial={false}>
            {filtered.slice(0, 40).map(msg => (
              <motion.div key={msg.id}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="px-4 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setExpandedId(expandedId === msg.id ? null : msg.id)}
              >
                <div className="flex items-start gap-3">
                  <span className="text-[9px] font-mono text-muted-foreground/60 shrink-0 tabular-nums mt-0.5">{msg.ts}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold font-mono"
                      style={{ background: `${KIND_COLORS[msg.kind]}18`, border: `1px solid ${KIND_COLORS[msg.kind]}40`, color: KIND_COLORS[msg.kind] }}>
                      {KIND_LABELS[msg.kind]}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-foreground/80">{msg.peer}</span>
                      <span className="text-[9px] text-muted-foreground/50 truncate">{msg.channel}</span>
                    </div>
                    {expandedId === msg.id && (
                      <motion.pre
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-2 text-[9px] font-mono text-cyan-300/70 overflow-x-auto"
                        style={{ background: "var(--muted)", padding: "8px", borderRadius: "6px" }}
                      >{JSON.stringify(msg.payload, null, 2)}</motion.pre>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {filtered.length === 0 && (
            <div className="py-12 text-center text-muted-foreground text-xs">No messages match filters</div>
          )}
        </div>
      </div>

      {/* Channel legend */}
      <div className="grid grid-cols-3 gap-2">
        {FEED_CHANNELS.map(ch => (
          <div key={ch} className="px-3 py-2 rounded-xl" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center gap-1.5 mb-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[9px] font-mono text-emerald-400">live</span>
            </div>
            <div className="text-[9px] font-mono text-foreground/60 truncate">{ch}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Autopost / Run-as-Bot Component ─────────────────────────────────────────

interface AutopostTask {
  id: string;
  direction: "buy_btc" | "sell_btc";
  amount: string;
  feeBpsCap: string;
  refundWindowMin: string;
  refundWindowMax: string;
  expiry: string;
  interval: string;
  repeatCount: string;
  channel: string;
  active: boolean;
  executedCount: number;
  lastRun: string | null;
}

const AUTOPOST_STORAGE_KEY = "afos_autopost_tasks_v1";

function loadAutopostTasks(): AutopostTask[] {
  try {
    const raw = localStorage.getItem(AUTOPOST_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AutopostTask[];
  } catch { /* ignore */ }
  return [];
}

function AutopostTab() {
  const [tasks, setTasks] = useState<AutopostTask[]>(loadAutopostTasks);
  const [allPaused, setAllPaused] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Omit<AutopostTask, "id" | "active" | "executedCount" | "lastRun">>({
    direction: "buy_btc",
    amount: "0.001",
    feeBpsCap: "30",
    refundWindowMin: "20",
    refundWindowMax: "40",
    expiry: "+5m",
    interval: "10s",
    repeatCount: "6",
    channel: "0000intercomswapbtcusdt",
  });

  const setF = (k: keyof typeof form) => (v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const addTask = () => {
    const newTask: AutopostTask = { ...form, id: `task_${Date.now()}`, active: false, executedCount: 0, lastRun: null };
    setTasks(prev => [newTask, ...prev]);
    setShowForm(false);
    toast.success("Autopost task created", { description: `${form.direction === "buy_btc" ? "Buy BTC" : "Sell BTC"} · ${form.amount} BTC · every ${form.interval}` });
  };

  const toggleTask = (id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, active: !t.active } : t));
  };

  const deleteTask = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    toast.info("Task removed");
  };

  // Persist tasks to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(AUTOPOST_STORAGE_KEY, JSON.stringify(tasks));
    } catch { /* ignore */ }
  }, [tasks]);

  // Simulate task execution counter (respects allPaused)
  useEffect(() => {
    const interval = setInterval(() => {
      if (allPaused) return;
      setTasks(prev => prev.map(t => {
        if (!t.active) return t;
        const maxRuns = parseInt(t.repeatCount) || 999;
        if (t.executedCount >= maxRuns) return { ...t, active: false };
        return { ...t, executedCount: t.executedCount + 1, lastRun: "just now" };
      }));
    }, 8000);
    return () => clearInterval(interval);
  }, [allPaused]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">Autopost Tasks</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {tasks.filter(t => t.active).length} active · {tasks.length} total · persisted
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Master pause toggle */}
          <button
            onClick={() => {
              const next = !allPaused;
              setAllPaused(next);
              if (next) {
                setTasks(prev => prev.map(t => ({ ...t, active: false })));
                toast.info("All tasks paused");
              } else {
                toast.success("Tasks resumed");
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: allPaused ? "rgba(239,68,68,0.12)" : "rgba(16,185,129,0.10)",
              border: `1px solid ${allPaused ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.25)"}`,
              color: allPaused ? "#f87171" : "#10b981",
            }}>
            {allPaused ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            {allPaused ? "Paused" : "Running"}
          </button>
          <button onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.35)", color: "#60a5fa" }}>
            {showForm ? <Square className="w-3 h-3" /> : <Repeat className="w-3 h-3" />}
            {showForm ? "Cancel" : "New Task"}
          </button>
        </div>
      </div>

      {/* Create form */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="rounded-2xl p-4 space-y-3" style={{ background: "var(--card)", border: "1px solid rgba(59,130,246,0.25)" }}>
            <p className="text-xs font-bold text-foreground mb-2">New Autopost Task</p>

            {/* Direction */}
            <div>
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5">Direction</div>
              <div className="flex gap-2">
                {(["buy_btc", "sell_btc"] as const).map(d => (
                  <button key={d} onClick={() => setF("direction")(d)}
                    className="flex-1 py-2 rounded-xl text-xs font-mono border transition-all"
                    style={{
                      background: form.direction === d ? (d === "buy_btc" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.12)") : "var(--muted)",
                      border: `1px solid ${form.direction === d ? (d === "buy_btc" ? "rgba(16,185,129,0.4)" : "rgba(239,68,68,0.3)") : "var(--border)"}`,
                      color: form.direction === d ? (d === "buy_btc" ? "#10b981" : "#ef4444") : "var(--muted-foreground)",
                    }}>
                    {d === "buy_btc" ? "Buy BTC (post offer)" : "Sell BTC (post RFQ)"}
                  </button>
                ))}
              </div>
            </div>

            {/* Amount + Fee cap */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5">Amount (BTC)</div>
                <input value={form.amount} onChange={e => setF("amount")(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs font-mono text-foreground outline-none"
                  style={{ background: "var(--muted)", border: "1px solid var(--border)" }} placeholder="0.001" />
              </div>
              <div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5">Max Fee (bps)</div>
                <input value={form.feeBpsCap} onChange={e => setF("feeBpsCap")(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs font-mono text-foreground outline-none"
                  style={{ background: "var(--muted)", border: "1px solid var(--border)" }} placeholder="30" />
              </div>
            </div>

            {/* HTLC refund window */}
            <div>
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5">HTLC Refund Window (hours)</div>
              <div className="grid grid-cols-2 gap-3">
                <input value={form.refundWindowMin} onChange={e => setF("refundWindowMin")(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs font-mono text-foreground outline-none"
                  style={{ background: "var(--muted)", border: "1px solid var(--border)" }} placeholder="Min hrs (e.g. 20)" />
                <input value={form.refundWindowMax} onChange={e => setF("refundWindowMax")(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs font-mono text-foreground outline-none"
                  style={{ background: "var(--muted)", border: "1px solid var(--border)" }} placeholder="Max hrs (e.g. 40)" />
              </div>
            </div>

            {/* Interval + Repeat + Expiry */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5">Interval</div>
                <select value={form.interval} onChange={e => setF("interval")(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs font-mono text-foreground outline-none"
                  style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                  {["5s","10s","30s","1m","5m","15m","1h"].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5">Repeat</div>
                <input value={form.repeatCount} onChange={e => setF("repeatCount")(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs font-mono text-foreground outline-none"
                  style={{ background: "var(--muted)", border: "1px solid var(--border)" }} placeholder="6" />
              </div>
              <div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5">Expiry</div>
                <select value={form.expiry} onChange={e => setF("expiry")(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs font-mono text-foreground outline-none"
                  style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                  {["+1m","+5m","+15m","+30m","+1h","+6h","+1d","+1w"].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </div>

            {/* Channel */}
            <div>
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5">Rendezvous Channel</div>
              <select value={form.channel} onChange={e => setF("channel")(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-xs font-mono text-foreground outline-none"
                style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                {FEED_CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <button onClick={addTask}
              className="w-full py-2.5 rounded-xl text-xs font-bold transition-all"
              style={{ background: "rgba(59,130,246,0.2)", border: "1px solid rgba(59,130,246,0.4)", color: "#60a5fa" }}>
              Create Autopost Task
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Task list */}
      <div className="space-y-3">
        {tasks.length === 0 && (
          <div className="py-12 text-center rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <Repeat className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No autopost tasks</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Create a task to run recurring swaps automatically</p>
          </div>
        )}
        {tasks.map(task => (
          <motion.div key={task.id} layout
            className="rounded-2xl p-4" style={{ background: "var(--card)", border: `1px solid ${task.active ? "rgba(16,185,129,0.3)" : "var(--border)"}` }}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 rounded text-[9px] font-bold font-mono"
                    style={{
                      background: task.direction === "buy_btc" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.12)",
                      border: `1px solid ${task.direction === "buy_btc" ? "rgba(16,185,129,0.35)" : "rgba(239,68,68,0.25)"}`,
                      color: task.direction === "buy_btc" ? "#10b981" : "#ef4444",
                    }}>
                    {task.direction === "buy_btc" ? "BUY BTC" : "SELL BTC"}
                  </span>
                  {task.active && <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /><span className="text-[9px] font-mono text-emerald-400">running</span></div>}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1">
                  {[
                    { label: "Amount", value: `${task.amount} BTC` },
                    { label: "Fee cap", value: `${task.feeBpsCap} bps` },
                    { label: "Interval", value: task.interval },
                    { label: "Expiry", value: task.expiry },
                    { label: "HTLC window", value: `${task.refundWindowMin}–${task.refundWindowMax}h` },
                    { label: "Channel", value: task.channel.slice(0, 20) + "..." },
                    { label: "Executed", value: `${task.executedCount}/${task.repeatCount}` },
                    { label: "Last run", value: task.lastRun ?? "never" },
                  ].map(item => (
                    <div key={item.label}>
                      <div className="text-[9px] text-muted-foreground/60">{item.label}</div>
                      <div className="text-[10px] font-mono text-foreground/80">{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <button onClick={() => toggleTask(task.id)}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-bold font-mono transition-all"
                  style={{
                    background: task.active ? "rgba(239,68,68,0.12)" : "rgba(16,185,129,0.12)",
                    border: `1px solid ${task.active ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.3)"}`,
                    color: task.active ? "#ef4444" : "#10b981",
                  }}>
                  {task.active ? "Stop" : "Start"}
                </button>
                <button onClick={() => deleteTask(task.id)}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-mono text-muted-foreground transition-all"
                  style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                  Delete
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Swaps Page ──────────────────────────────────────────────────────────

export default function Swaps() {
  const [activeTab, setActiveTab] = useState<"swap" | "feed" | "autopost">("swap");
  const { connected, shortAddress } = useWallet();
  const connectedWallets = connected ? [{ chain: 'solana', name: 'Phantom', address: shortAddress || '' }] : [];
  const primaryWallet = connected ? { shortAddress, chain: 'solana' } : null;
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [fromToken, setFromToken] = useState(TOKENS[0]); // BTC
  const [toToken, setToToken] = useState(TOKENS[3]);     // USDT
  const [fromAmount, setFromAmount] = useState("0.001");
  const [slippage, setSlippage] = useState("0.5");
  const [feeBpsCap, setFeeBpsCap] = useState("30");
  const [refundWindowMin, setRefundWindowMin] = useState("20");
  const [refundWindowMax, setRefundWindowMax] = useState("40");
  const [expiry, setExpiry] = useState("+5m");
  const [swapPhase, setSwapPhase] = useState<SwapPhase>("idle");
  const [agentMode, setAgentMode] = useState(true);
  const [selectedPeer, setSelectedPeer] = useState<LivePeer | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Live quote from backend
  const [liveQuote, setLiveQuote] = useState<SwapQuote | null>(null);
  const [quoteFetching, setQuoteFetching] = useState(false);
  const quoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Live token prices from backend
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  // Live P2P peers from SSE + getAgentStatus
  const [livePeers, setLivePeers] = useState<LivePeer[]>([]);
  const [activePeerCount, setActivePeerCount] = useState(0);
  // Last completed RFQ ID for progress tracker
  const [lastRfqId, setLastRfqId] = useState<string | undefined>(undefined);

  // Fetch live prices on mount
  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const prices = await getPrices();
          const priceMap: Record<string, number> = {};
          Object.entries(prices).forEach(([sym, p]) => { priceMap[sym] = p.usd; });
          setLivePrices(priceMap);
      } catch { /* keep static prices */ }
    };
    fetchPrices();
    const interval = setInterval(fetchPrices, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch live peers from getAgentStatus + SSE events
  useEffect(() => {
    const fetchPeers = async () => {
      try {
        const status = await getAgentStatus();
        setActivePeerCount(status.activePeers || 0);
      } catch { /* keep previous */ }
    };
    fetchPeers();
    const interval = setInterval(fetchPeers, 30000);

    // Listen for SSE peer events
    const unsubConnect = onSSEEvent('peer_connected', (data: unknown) => {
      const d = data as { peer_id?: string; alias?: string; latency?: number; pairs?: string[]; reputation?: number };
      if (!d.peer_id) return;
      const peer: LivePeer = {
        id: d.peer_id,
        alias: d.alias || d.peer_id.slice(0, 10),
        latency: d.latency || 0,
        pairs: d.pairs || [],
        online: true,
        reputation: d.reputation || 99,
      };
      setLivePeers(prev => {
        const existing = prev.filter(p => p.id !== peer.id);
        return [...existing, peer];
      });
      setActivePeerCount(prev => prev + 1);
    });

    const unsubDisconnect = onSSEEvent('peer_disconnected', (data: unknown) => {
      const d = data as { peer_id?: string };
      if (!d.peer_id) return;
      setLivePeers(prev => prev.map(p => p.id === d.peer_id ? { ...p, online: false } : p));
      setActivePeerCount(prev => Math.max(0, prev - 1));
    });

    return () => {
      clearInterval(interval);
      unsubConnect();
      unsubDisconnect();
    };
  }, []);

  // Fetch live quote when pair/amount changes (debounced 800ms)
  useEffect(() => {
    if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
    const amt = parseFloat(fromAmount);
    const solPairs = ['SOL', 'USDT', 'USDC'];
    if (amt > 0 && solPairs.includes(fromToken.symbol) && solPairs.includes(toToken.symbol)) {
      quoteTimerRef.current = setTimeout(async () => {
        setQuoteFetching(true);
        try {
          const q = await getSwapQuote(fromToken.symbol, toToken.symbol, fromAmount);
          if (q) setLiveQuote(q);
        } catch { /* keep previous quote */ } finally {
          setQuoteFetching(false);
        }
      }, 800);
    } else {
      setLiveQuote(null);
    }
    return () => { if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromToken.symbol, toToken.symbol, fromAmount, slippage]);

  // Derived values — use live prices when available
  const fromTokenData = TOKENS.find(t => t.symbol === fromToken.symbol) || TOKENS[0];
  const toTokenData = TOKENS.find(t => t.symbol === toToken.symbol) || TOKENS[3];
  const fromPrice = livePrices[fromToken.symbol] || fromTokenData.usdPrice;
  const toPrice = livePrices[toToken.symbol] || toTokenData.usdPrice;

  const rate = toPrice > 0 ? fromPrice / toPrice : 0;
  const toAmount = liveQuote?.outAmount != null
    ? liveQuote.outAmount.toFixed(toPrice >= 1 ? 4 : 6)
    : (parseFloat(fromAmount || "0") * rate).toFixed(toPrice >= 1 ? 2 : 6);
  const fromUsd = (parseFloat(fromAmount || "0") * fromPrice).toFixed(2);
  const toUsd = (parseFloat(toAmount) * toPrice).toFixed(2);

  const platformFeePct = liveQuote ? (liveQuote.platformFeeBps / 100) : 0.2;
  const platformFee = (parseFloat(fromUsd) * platformFeePct / 100).toFixed(2);
  const tradeFee = (parseFloat(fromUsd) * 0.001).toFixed(2);
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
    setLiveQuote(null);
  };

  const haptic = useHaptic();

  const runSwapAnimation = useCallback((finalToAmount?: string, routeDesc?: string) => {
    const phases: SwapPhase[] = ["rfq", "negotiating", "locking", "settling", "complete"];
    const delays = [0, 1800, 3500, 5500, 7500];
    const displayTo = finalToAmount ?? toAmount;

    phases.forEach((phase, i) => {
      phaseTimerRef.current = setTimeout(() => {
        setSwapPhase(phase);
        if (phase === "complete") {
          haptic.success();
          toast.success(`Swap complete: ${fromAmount} ${fromToken.symbol} → ${displayTo} ${toToken.symbol}`, {
            description: routeDesc ?? "Atomic settlement confirmed on-chain",
          });
        }
      }, delays[i]);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromAmount, fromToken.symbol, toAmount, toToken.symbol]);

  const handleSwap = async () => {
    if (parseFloat(fromAmount) <= 0) {
      haptic.error();
      toast.error("Enter a valid amount");
      return;
    }
    if (swapPhase !== "idle" && swapPhase !== "complete" && swapPhase !== "error") return;
    haptic.tap();
    setSwapPhase("rfq");

    try {
      const result = await submitRfq(fromToken.symbol, toToken.symbol, parseFloat(fromAmount));
      if (result?.success) {
        const rfqResult: RfqResult = result.result;
        const finalOut = rfqResult.outAmount != null
          ? Number(rfqResult.outAmount).toFixed(4)
          : toAmount;
        setSwapPhase("negotiating");
        setTimeout(() => setSwapPhase("locking"), 800);
        setTimeout(() => setSwapPhase("settling"), 1800);
        setTimeout(() => {
          setSwapPhase("complete");
          haptic.success();
          const route = rfqResult.route === 'p2p' ? `P2P IntercomSwap (${rfqResult.p2pQuotes} quotes)` : `DEX fallback (${rfqResult.dexRoute || 'Jupiter'})`;
          toast.success(`Swap complete: ${fromAmount} ${fromToken.symbol} → ${finalOut} ${toToken.symbol}`, {
            description: `${route} · 0.2% platform fee collected`,
          });
        }, 2800);
      } else {
        runSwapAnimation();
      }
    } catch {
      runSwapAnimation();
    }
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
          <h1 className="text-lg sm:text-xl font-bold text-foreground tracking-tight">Agentic Swap</h1>
          <p className="text-xs text-slate-500 mt-0.5 hidden sm:block">
            P2P atomic swaps via IntercomSwap · RFQ → HTLC → Settlement
          </p>
        </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg"
            style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)" }}>
            <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
            <span className="text-[10px] font-mono text-emerald-400 hidden sm:inline">P2P Network Live</span>
            <span className="text-[10px] font-mono text-emerald-400 sm:hidden">Live</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg"
            style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
            <Users className="w-3 h-3 text-cyan-400" />
            <span className="text-[10px] font-mono text-cyan-400">142</span>
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 mb-4 p-1 rounded-xl" style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
        {([
          { id: "swap", label: "Swap", icon: <ArrowDownUp className="w-3.5 h-3.5" /> },
          { id: "feed", label: "Live Feed", icon: <Rss className="w-3.5 h-3.5" /> },
          { id: "autopost", label: "Autopost", icon: <Repeat className="w-3.5 h-3.5" /> },
        ] as const).map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: activeTab === tab.id ? "var(--card)" : "transparent",
              color: activeTab === tab.id ? "var(--foreground)" : "var(--muted-foreground)",
              boxShadow: activeTab === tab.id ? "0 1px 4px rgba(0,0,0,0.2)" : "none",
            }}>
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Live Feed Tab */}
      {activeTab === "feed" && <LiveFeedTab />}

      {/* Autopost Tab */}
      {activeTab === "autopost" && <AutopostTab />}

      {/* Swap Tab */}
      {activeTab === "swap" && <>
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
              background: "var(--card)",
              border: "1px solid var(--border)",
              backdropFilter: "blur(20px)",
              boxShadow: "0 8px 40px rgba(0,0,0,0.4)",
            }}
          >
            {/* Protocol Badge */}
            {swapPair && (
              <div className="flex flex-wrap items-center gap-1.5 mb-4">
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono"
                  style={{
                    background: swapPair.native ? "rgba(59,130,246,0.12)" : "rgba(16,185,129,0.1)",
                    border: `1px solid ${swapPair.native ? "rgba(59,130,246,0.3)" : "rgba(16,185,129,0.25)"}`,
                    color: swapPair.native ? "#60a5fa" : "#34d399",
                  }}
                >
                  {swapPair.native ? <Zap className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
                  {swapPair.protocol}
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono"
                  style={{ background: "var(--muted)", border: "1px solid var(--border)", color: "#94a3b8" }}>
                  <Clock className="w-3 h-3" />
                  {swapPair.time}
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono"
                  style={{ background: "var(--muted)", border: "1px solid var(--border)", color: "#94a3b8" }}>
                  <Shield className="w-3 h-3" />
                  Non-custodial
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono"
                  style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", color: "#10b981" }}>
                  <GitMerge className="w-3 h-3" />
                  Hybrid routing
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
                  className="w-full px-4 py-3 rounded-xl text-2xl font-bold font-mono text-foreground bg-transparent outline-none"
                  style={{
                    background: "var(--muted)",
                    border: "1px solid var(--border)",
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
                  background: "rgba(59,130,246,0.15)",
                  border: "1px solid rgba(59,130,246,0.4)",
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
              style={{ background: "var(--muted)", border: `1px solid ${liveQuote ? 'rgba(16,185,129,0.3)' : 'var(--border)'}` }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold font-mono text-foreground">{toAmount}</span>
                  {quoteFetching && <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />}
                  {liveQuote && !quoteFetching && (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}>
                      LIVE
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">≈ ${parseFloat(toUsd).toLocaleString()}</div>
                  <div className="text-[10px] text-slate-600">
                    {liveQuote ? `via ${liveQuote.route}` : `1 ${fromToken.symbol} = ${rate.toFixed(4)} ${toToken.symbol}`}
                  </div>
                </div>
              </div>
            </div>

            {/* Fee Breakdown */}
            <div className="mt-4 px-4 py-3 rounded-xl space-y-1.5"
              style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">Platform fee ({platformFeePct}%)</span>
                <span className="font-mono text-slate-400">${platformFee}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">DEX/network fee (~0.1%)</span>
                <span className="font-mono text-slate-400">${tradeFee}</span>
              </div>
              {liveQuote && (
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-500">Price impact</span>
                  <span className={`font-mono ${liveQuote.priceImpact > 1 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {(liveQuote.priceImpact * 100).toFixed(4)}%
                  </span>
                </div>
              )}
              <div className="flex justify-between text-[11px] pt-1 border-t border-border">
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
                              background: slippage === s ? "rgba(59,130,246,0.2)" : "var(--muted)",
                              border: `1px solid ${slippage === s ? "rgba(59,130,246,0.4)" : "var(--border)"}`,
                              color: slippage === s ? "#3b82f6" : "var(--muted-foreground)",
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
                            background: "var(--muted)",
                            border: "1px solid var(--border)",
                            color: "#94a3b8",
                          }}
                          placeholder="Custom"
                        />
                      </div>
                    </div>
                    {/* Fee bps cap */}
                    <div>
                      <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Max Fee Cap (bps)</div>
                      <div className="flex gap-2">
                        {["10", "20", "30", "50"].map(s => (
                          <button key={s} onClick={() => setFeeBpsCap(s)}
                            className="flex-1 py-1.5 rounded-lg text-xs font-mono transition-all"
                            style={{
                              background: feeBpsCap === s ? "rgba(59,130,246,0.2)" : "var(--muted)",
                              border: `1px solid ${feeBpsCap === s ? "rgba(59,130,246,0.4)" : "var(--border)"}`,
                              color: feeBpsCap === s ? "#3b82f6" : "var(--muted-foreground)",
                            }}>
                            {s}
                          </button>
                        ))}
                        <input type="number" value={feeBpsCap} onChange={e => setFeeBpsCap(e.target.value)}
                          className="flex-1 py-1.5 px-2 rounded-lg text-xs font-mono text-center bg-transparent outline-none"
                          style={{ background: "var(--muted)", border: "1px solid var(--border)", color: "#94a3b8" }}
                          placeholder="Custom" />
                      </div>
                    </div>

                    {/* HTLC Refund Window */}
                    <div>
                      <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">HTLC Refund Window (hours)</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-[9px] text-muted-foreground mb-1">Min</div>
                          <input type="number" value={refundWindowMin} onChange={e => setRefundWindowMin(e.target.value)}
                            className="w-full px-3 py-1.5 rounded-lg text-xs font-mono text-foreground outline-none"
                            style={{ background: "var(--muted)", border: "1px solid var(--border)" }} placeholder="20" />
                        </div>
                        <div>
                          <div className="text-[9px] text-muted-foreground mb-1">Max</div>
                          <input type="number" value={refundWindowMax} onChange={e => setRefundWindowMax(e.target.value)}
                            className="w-full px-3 py-1.5 rounded-lg text-xs font-mono text-foreground outline-none"
                            style={{ background: "var(--muted)", border: "1px solid var(--border)" }} placeholder="40" />
                        </div>
                      </div>
                    </div>

                    {/* Offer Expiry */}
                    <div>
                      <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Offer Expiry</div>
                      <div className="flex gap-1.5 flex-wrap">
                        {["+1m","+5m","+15m","+30m","+1h","+6h"].map(e => (
                          <button key={e} onClick={() => setExpiry(e)}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-mono transition-all"
                            style={{
                              background: expiry === e ? "rgba(59,130,246,0.2)" : "var(--muted)",
                              border: `1px solid ${expiry === e ? "rgba(59,130,246,0.4)" : "var(--border)"}`,
                              color: expiry === e ? "#3b82f6" : "var(--muted-foreground)",
                            }}>
                            {e}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Preferred Peer</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {livePeers.filter((p: LivePeer) => p.online).slice(0, 4).map((peer: LivePeer) => (
                          <button
                            key={peer.id}
                            onClick={() => setSelectedPeer(selectedPeer?.id === peer.id ? null : peer)}
                            className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-all"
                            style={{
                              background: selectedPeer?.id === peer.id ? "rgba(59,130,246,0.15)" : "var(--muted)",
                              border: `1px solid ${selectedPeer?.id === peer.id ? "rgba(59,130,246,0.35)" : "var(--border)"}`,
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
                  ? "rgba(16,185,129,0.2)"
                  : swapPhase === "error"
                    ? "rgba(239,68,68,0.2)"
                    : isSwapping
                      ? "rgba(59,130,246,0.15)"
                      : "#3b82f6",
                border: `1px solid ${swapPhase === "complete" ? "rgba(16,185,129,0.4)" : "rgba(59,130,246,0.5)"}`,
                color: swapPhase === "complete" ? "#10b981" : "white",
                boxShadow: isSwapping ? "none" : "0 4px 20px rgba(59,130,246,0.3)",
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
          <PeerPanel fromToken={fromToken} toToken={toToken} livePeers={livePeers} activePeerCount={activePeerCount} />
          <RecentSwaps />

          {/* Protocol Info */}
          <div
            className="rounded-2xl p-4"
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
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
                { label: "Refund window", value: `${refundWindowMin}–${refundWindowMax}h` },
                { label: "Escrow program", value: "Solana" },
                { label: "Fee cap", value: `${feeBpsCap} bps` },
              ].map(item => (
                <div key={item.label} className="px-2.5 py-2 rounded-lg"
                  style={{ background: "var(--muted)" }}>
                  <div className="text-[9px] text-slate-600">{item.label}</div>
                  <div className="text-[11px] font-mono text-slate-300 mt-0.5">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      </> }
      <ConnectWalletModal open={showWalletModal} onClose={() => setShowWalletModal(false)} />
    </div>
  );
}
