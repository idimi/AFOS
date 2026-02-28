/**
 * AFOS Dashboard — Agentic Financial Operating System
 * Redesigned Overview: Production-ready operator command center
 * Layout: 2-column (left: agent status + metrics + activity, right: portfolio + market + thought stream)
 * Mobile: Single column, prioritized order
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Zap, ArrowLeftRight, Activity, Settings,
  ChevronRight, CheckCircle2, Clock,
  TrendingUp, TrendingDown, Send,
  Network, Radio, Moon, Sun, Cpu, Wallet, X, Terminal,
  QrCode, ArrowUpRight, ArrowDownLeft, Copy, Check,
  Shield, AlertTriangle, Loader2, ExternalLink,
  BarChart3, Users, Globe, Gauge, Play, RefreshCw,
  Sparkles, Eye, CircleDot, ArrowRight
} from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "../contexts/ThemeContext";
import { useHaptic } from "../hooks/useHaptic";
import { useAgentLog, type TerminalEntry } from "../contexts/AgentLogContext";
import { useWallet } from "../contexts/WalletContext";
import ConnectWalletModal from "../components/ConnectWalletModal";
import Swaps from "./Swaps";
import SwapHistory from "./SwapHistory";
import AgentSettings from "./AgentSettings";
import NetworkPage from "./NetworkPage";
import TerminalPage from "./TerminalPage";

type NavPage = "dashboard" | "swaps" | "activity" | "network" | "settings" | "terminal";

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

// ── Mobile Bottom Tab Bar ──────────────────────────────────────────────────
function MobileTabBar({ navItems, activePage, setActivePage }: {
  navItems: { id: NavPage; icon: React.ElementType; label: string }[];
  activePage: NavPage;
  setActivePage: (p: NavPage) => void;
}) {
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-xl border-t border-border flex items-center justify-around px-2 py-2 safe-area-pb">
      {navItems.map(item => {
        const Icon = item.icon;
        const active = activePage === item.id;
        return (
          <button key={item.id} onClick={() => setActivePage(item.id)}
            className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-all ${
              active ? "text-cyan-400" : "text-muted-foreground"
            }`}>
            <Icon className="w-5 h-5" />
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// ── Agent Status Card ──────────────────────────────────────────────────────
function AgentStatusCard({ onNavigateToTerminal }: { onNavigateToTerminal: () => void }) {
  const [uptime, setUptime] = useState(0);
  const [currentTask, setCurrentTask] = useState("Monitoring rendezvous channel");
  const [taskCycle, setTaskCycle] = useState(0);

  const TASKS = useMemo(() => [
    "Monitoring rendezvous channel",
    "Scanning for RFQ opportunities",
    "Rebalancing LN channel liquidity",
    "Checking escrow PDA states",
    "Heartbeat ping to 3 peers",
    "Evaluating best BTC/USDT rate",
    "Idle — awaiting instructions",
  ], []);

  useEffect(() => {
    const interval = setInterval(() => setUptime(u => u + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setTaskCycle(c => {
        const next = (c + 1) % TASKS.length;
        setCurrentTask(TASKS[next]);
        return next;
      });
    }, 8000);
    return () => clearInterval(interval);
  }, [TASKS]);

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
              <h3 className="text-sm font-bold text-foreground">OpenClaw Agent</h3>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">ACTIVE</span>
            </div>
            <p className="text-xs text-muted-foreground font-mono">gpt-4o-mini · intercomswap@mainnet</p>
          </div>
        </div>
        <button
          onClick={onNavigateToTerminal}
          className="text-xs text-muted-foreground hover:text-cyan-400 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-cyan-500/10 font-mono"
        >
          Terminal →
        </button>
      </div>

      {/* Current task */}
      <div className="rounded-xl bg-muted/40 border border-border p-3 mb-3">
        <div className="flex items-center gap-2 mb-1.5">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Current Task</span>
        </div>
        <motion.p
          key={currentTask}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-sm text-foreground font-mono"
        >
          {currentTask}
        </motion.p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-muted/30 border border-border p-2.5 text-center">
          <p className="text-xs font-bold font-mono text-foreground">{formatUptime(uptime)}</p>
          <p className="text-[9px] text-muted-foreground mt-0.5">Uptime</p>
        </div>
        <div className="rounded-lg bg-muted/30 border border-border p-2.5 text-center">
          <p className="text-xs font-bold font-mono text-foreground">3</p>
          <p className="text-[9px] text-muted-foreground mt-0.5">Skills loaded</p>
        </div>
        <div className="rounded-lg bg-muted/30 border border-border p-2.5 text-center">
          <p className="text-xs font-bold font-mono text-emerald-400">Healthy</p>
          <p className="text-[9px] text-muted-foreground mt-0.5">LND / SOL / ETH</p>
        </div>
      </div>
    </div>
  );
}

// ── Key Metrics Row ────────────────────────────────────────────────────────
function MetricsRow() {
  const [metrics, setMetrics] = useState({
    volume24h: 142800,
    feesEarned: 428.40,
    successRate: 98.7,
    activePeers: 3,
  });

  // Simulate slight metric changes
  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics(prev => ({
        volume24h: prev.volume24h + (Math.random() - 0.4) * 200,
        feesEarned: prev.feesEarned + Math.random() * 0.5,
        successRate: Math.min(100, Math.max(95, prev.successRate + (Math.random() - 0.5) * 0.1)),
        activePeers: Math.random() > 0.9 ? (prev.activePeers === 3 ? 4 : 3) : prev.activePeers,
      }));
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const cards = [
    {
      label: "24h Volume",
      value: `$${(metrics.volume24h / 1000).toFixed(1)}K`,
      change: "+3.2%",
      positive: true,
      icon: BarChart3,
      color: "text-cyan-400",
      bg: "bg-cyan-500/8",
      border: "border-cyan-500/15",
    },
    {
      label: "Fees Earned",
      value: `$${metrics.feesEarned.toFixed(2)}`,
      change: "+12.4%",
      positive: true,
      icon: TrendingUp,
      color: "text-emerald-400",
      bg: "bg-emerald-500/8",
      border: "border-emerald-500/15",
    },
    {
      label: "Success Rate",
      value: `${metrics.successRate.toFixed(1)}%`,
      change: "0.0%",
      positive: true,
      icon: Shield,
      color: "text-violet-400",
      bg: "bg-violet-500/8",
      border: "border-violet-500/15",
    },
    {
      label: "Active Peers",
      value: String(metrics.activePeers),
      change: "stable",
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
  const RECENT_SWAPS = useMemo(() => [
    { id: "sw-001", from: "BTC", to: "USDT", fromAmt: "0.012", toAmt: "1,157.04", status: "complete" as const, time: "2m ago", protocol: "Lightning ↔ Solana" },
    { id: "sw-002", from: "ETH", to: "USDT", fromAmt: "0.5", toAmt: "1,602.50", status: "complete" as const, time: "8m ago", protocol: "EVM HTLC" },
    { id: "sw-003", from: "SOL", to: "USDT", fromAmt: "15.0", toAmt: "2,142.00", status: "complete" as const, time: "14m ago", protocol: "Solana SPL" },
    { id: "sw-004", from: "BTC", to: "SOL", fromAmt: "0.005", toAmt: "2.56", status: "pending" as const, time: "18m ago", protocol: "Lightning ↔ Solana" },
    { id: "sw-005", from: "BTC", to: "USDT", fromAmt: "0.001", toAmt: "96.42", status: "complete" as const, time: "25m ago", protocol: "Lightning ↔ Solana" },
  ], []);

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
    { label: "Open Terminal", icon: Terminal, page: "terminal" as NavPage, color: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/20" },
    { label: "New Swap", icon: ArrowLeftRight, page: "swaps" as NavPage, color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20" },
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
  const [totalUsd] = useState(18136);
  const [change24h] = useState(+2.4);

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Total Portfolio</p>
        <span className="text-xs text-muted-foreground font-mono">non-custodial</span>
      </div>
      <div className="flex items-end gap-3 mb-1">
        <p className="text-3xl font-bold font-mono text-foreground tracking-tight">
          ${totalUsd.toLocaleString()}
        </p>
        <div className={`flex items-center gap-1 text-sm font-mono mb-1 ${change24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
          {change24h >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          {change24h >= 0 ? "+" : ""}{change24h}%
        </div>
      </div>
      <p className="text-xs text-muted-foreground">24h change across all chains</p>
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
  BTC: "lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaqnp4q0n326hr8v9zprg8gsvezcch06gfaqqhde2aj730yg0durunfhv66",
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
    if (modal.asset === "BTC" && !invoice) { toast.error("Paste a Lightning invoice"); return; }
    toast.success(`${modal.asset} send initiated`, {
      description: modal.asset === "BTC"
        ? `Paying LN invoice · ${amount} BTC`
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
                  {modal.asset === "BTC" ? "Lightning Invoice" : `${modal.network} Address`}
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
                  <label className="text-[10px] text-muted-foreground mb-1 block">Lightning Invoice</label>
                  <textarea
                    value={invoice}
                    onChange={e => setInvoice(e.target.value)}
                    placeholder="lnbc…"
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

  const wallets = [
    { asset: "BTC", network: "Lightning", balance: "0.14200000", usd: "$13,691", color: "text-amber-400", border: "border-amber-500/20", bg: "bg-amber-500/8" },
    { asset: "USDT", network: "Solana", balance: "1,240.50", usd: "$1,240", color: "text-emerald-400", border: "border-emerald-500/20", bg: "bg-emerald-500/8" },
    { asset: "SOL", network: "Solana", balance: "12.840", usd: "$1,833", color: "text-purple-400", border: "border-purple-500/20", bg: "bg-purple-500/8" },
    { asset: "ETH", network: "Ethereum", balance: "0.5120", usd: "$1,372", color: "text-blue-400", border: "border-blue-500/20", bg: "bg-blue-500/8" },
  ];

  return (
    <>
      {modal && <WalletModal modal={modal} onClose={() => setModal(null)} />}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Wallets</h3>
          </div>
        </div>
        <div className="space-y-2">
          {wallets.map(w => (
            <div key={w.asset} className={`flex items-center gap-3 p-2.5 rounded-xl border ${w.border} ${w.bg}`}>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold font-mono ${w.color} bg-background/50 border border-border shrink-0`}>
                {w.asset}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-mono font-semibold ${w.color}`}>{w.balance}</p>
                  <span className="text-[10px] text-muted-foreground">{w.usd}</span>
                </div>
                <p className="text-[10px] text-muted-foreground">{w.network}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
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
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Market Ticker ──────────────────────────────────────────────────────────
function MarketTicker() {
  const [prices, setPrices] = useState({
    BTC: { price: 96420, change: +3.2 },
    ETH: { price: 2680, change: +0.8 },
    SOL: { price: 142.80, change: -1.1 },
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setPrices(prev => ({
        BTC: { price: prev.BTC.price + (Math.random() - 0.5) * 50, change: prev.BTC.change + (Math.random() - 0.5) * 0.1 },
        ETH: { price: prev.ETH.price + (Math.random() - 0.5) * 5, change: prev.ETH.change + (Math.random() - 0.5) * 0.1 },
        SOL: { price: prev.SOL.price + (Math.random() - 0.5) * 0.5, change: prev.SOL.change + (Math.random() - 0.5) * 0.1 },
      }));
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const tickers = [
    { symbol: "BTC/USDT", ...prices.BTC, color: "text-amber-400", icon: "₿" },
    { symbol: "ETH/USDT", ...prices.ETH, color: "text-blue-400", icon: "Ξ" },
    { symbol: "SOL/USDT", ...prices.SOL, color: "text-purple-400", icon: "◎" },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Market</h3>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">IntercomSwap rates</span>
      </div>
      <div className="space-y-2">
        {tickers.map(t => (
          <div key={t.symbol} className="flex items-center justify-between p-2.5 rounded-xl bg-muted/20 border border-border">
            <div className="flex items-center gap-2.5">
              <span className={`text-lg font-bold ${t.color}`}>{t.icon}</span>
              <div>
                <p className="text-xs font-mono text-foreground font-semibold">{t.symbol}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-mono text-foreground font-bold">
                ${t.price.toLocaleString(undefined, { maximumFractionDigits: t.price > 1000 ? 0 : 2 })}
              </p>
              <span className={`text-[10px] font-mono flex items-center gap-0.5 justify-end ${t.change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {t.change >= 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                {t.change >= 0 ? "+" : ""}{t.change.toFixed(1)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Agent Thought Stream (compact live feed) ───────────────────────────────
function AgentThoughtStream({ onNavigateToTerminal }: { onNavigateToTerminal: () => void }) {
  const { entries } = useAgentLog();
  const scrollRef = useRef<HTMLDivElement>(null);
  const recent = entries.slice(-8);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const levelColor = (level: string) =>
    level === "success" ? "text-emerald-400" :
    level === "warn" ? "text-amber-400" :
    level === "error" ? "text-red-400" :
    level === "cmd" ? "text-violet-400" :
    level === "debug" ? "text-slate-400" : "text-cyan-300/80";

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Agent Activity</h3>
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        </div>
        <button
          onClick={onNavigateToTerminal}
          className="text-[10px] font-mono text-muted-foreground hover:text-cyan-400 transition-colors px-2 py-1 rounded-md hover:bg-cyan-500/10"
        >
          Full log →
        </button>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-2.5 space-y-1 min-h-0"
        style={{ background: "var(--background)" }}
      >
        {recent.map(log => (
          <motion.div
            key={log.id}
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-start gap-2 text-[11px] font-mono py-0.5"
          >
            <span className="text-muted-foreground/40 shrink-0 tabular-nums w-[68px]">{log.ts.slice(0, 8)}</span>
            <span className={`flex-1 min-w-0 break-words leading-snug ${levelColor(log.level)}`}>
              {log.message}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ── Stack Health Strip ─────────────────────────────────────────────────────
function StackHealthStrip() {
  const services = [
    { name: "OpenClaw", status: "live", color: "bg-emerald-400" },
    { name: "IntercomSwap", status: "live", color: "bg-emerald-400" },
    { name: "Bitcoin LN", status: "live", color: "bg-emerald-400" },
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
  const { connectedWallets, primaryWallet } = useWallet();
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [activePage, setActivePage] = useState<NavPage>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const navItems = [
    { id: "dashboard" as NavPage, icon: Cpu, label: "Overview" },
    { id: "terminal" as NavPage, icon: Terminal, label: "Terminal" },
    { id: "swaps" as NavPage, icon: ArrowLeftRight, label: "Swaps" },
    { id: "activity" as NavPage, icon: Activity, label: "History" },
    { id: "network" as NavPage, icon: Network, label: "Network" },
    { id: "settings" as NavPage, icon: Settings, label: "Settings" },
  ];

  const renderSubPage = () => {
    if (activePage === "swaps") return <Swaps />;
    if (activePage === "activity") return <SwapHistory />;
    if (activePage === "settings") return <AgentSettings />;
    if (activePage === "network") return <NetworkPage />;
    if (activePage === "terminal") return <TerminalPage />;
    return null;
  };

  const subPage = renderSubPage();

  return (
    <div className="flex h-screen bg-background font-sans" style={{ overflow: "hidden" }}>
      <div className="relative z-10 flex-shrink-0" style={{ overflow: "visible" }}>
        <DesktopSidebar navItems={navItems} activePage={activePage} setActivePage={setActivePage} open={sidebarOpen} setOpen={setSidebarOpen} />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Topbar */}
        <header className="h-14 border-b border-border flex items-center justify-between px-4 lg:px-6 shrink-0 bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-2 lg:gap-3">
            <div className="lg:hidden w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm text-muted-foreground font-mono hidden sm:block">openclaw-agent</span>
            <span className="text-muted-foreground/40 hidden sm:block">·</span>
            <span className="text-xs text-cyan-400/70 font-mono">intercomswap@mainnet</span>
          </div>
          <div className="flex items-center gap-2 lg:gap-4">
            <span className="text-xs text-muted-foreground font-mono hidden xl:block">0000intercomswapbtcusdt</span>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/20">
              <Radio className="w-3 h-3 text-violet-400 animate-pulse" />
              <span className="text-xs text-violet-300 font-mono">3 peers</span>
            </div>
            {connectedWallets.length > 0 ? (
              <button
                onClick={() => setShowWalletModal(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all"
                style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", color: "#10b981" }}>
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {primaryWallet?.shortAddress}
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
          <main className="flex-1 overflow-auto pb-16 lg:pb-0">{subPage}</main>
        ) : (
          /* ── OVERVIEW ── */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-auto pb-20 lg:pb-0">

              {/* ── DESKTOP: 2-column layout ── */}
              <div className="hidden lg:grid grid-cols-12 gap-5 p-5 h-full" style={{ minHeight: 0 }}>

                {/* LEFT col — Agent Status + Metrics + Recent Swaps + Quick Actions */}
                <div className="col-span-7 flex flex-col gap-4 min-h-0">
                  <AgentStatusCard onNavigateToTerminal={() => setActivePage("terminal")} />
                  <MetricsRow />
                  <QuickActions onNavigate={setActivePage} />
                  <RecentSwapsCard onViewAll={() => setActivePage("activity")} />
                </div>

                {/* RIGHT col — Portfolio + Wallets + Market + Agent Activity */}
                <div className="col-span-5 flex flex-col gap-4 min-h-0">
                  <PortfolioCard />
                  <WalletsCard />
                  <MarketTicker />
                  <AgentThoughtStream onNavigateToTerminal={() => setActivePage("terminal")} />
                </div>
              </div>

              {/* ── MOBILE: single-column stacked ── */}
              <div className="lg:hidden flex flex-col gap-4 p-4">
                <AgentStatusCard onNavigateToTerminal={() => setActivePage("terminal")} />
                <MetricsRow />
                <PortfolioCard />
                <WalletsCard />
                <QuickActions onNavigate={setActivePage} />
                <MarketTicker />
                <RecentSwapsCard onViewAll={() => setActivePage("activity")} />
                <AgentThoughtStream onNavigateToTerminal={() => setActivePage("terminal")} />
              </div>
            </div>

            {/* Stack health strip at bottom */}
            <StackHealthStrip />
          </div>
        )}
      </div>

      <MobileTabBar navItems={navItems} activePage={activePage} setActivePage={setActivePage} />
      <ConnectWalletModal open={showWalletModal} onClose={() => setShowWalletModal(false)} />
    </div>
  );
}
