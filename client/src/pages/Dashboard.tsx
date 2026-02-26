/**
 * AFOS Dashboard — Agentic Financial Operating System
 * Design: Glassmorphism + Agentic Sci-Fi
 * Colors: Deep navy-black base, cyan-teal primary, violet secondary, gold for financial values
 * Typography: Outfit Bold for headings/values, JetBrains Mono for addresses/hashes
 * Layout: Left sidebar (agent status + nav) | Main content (pipeline + stats) | Right feed (activity log)
 */

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone, Wallet, ArrowLeftRight, Send, Activity, ChevronRight,
  Zap, Shield, Globe, TrendingUp, Clock, CheckCircle2, AlertCircle,
  Loader2, PhoneCall, Bot, CreditCard, Network, BarChart3, Settings,
  Bell, LogOut, Menu, X, ExternalLink, Copy, RefreshCw
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────

type StepStatus = "idle" | "active" | "complete" | "error";

interface PipelineStep {
  id: number;
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  color: string;
  glowColor: string;
  status: StepStatus;
  detail?: string;
}

interface ActivityItem {
  id: string;
  time: string;
  type: "call" | "buy" | "swap" | "send" | "confirm";
  message: string;
  amount?: string;
  status: "success" | "pending" | "error";
}

interface BalanceItem {
  symbol: string;
  name: string;
  amount: string;
  usd: string;
  change: string;
  positive: boolean;
  color: string;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const INITIAL_STEPS: PipelineStep[] = [
  {
    id: 1, label: "Voice Call", sublabel: "Clawfinger",
    icon: <Phone size={18} />, color: "text-cyan-400", glowColor: "#06b6d4",
    status: "idle", detail: "+1 (555) 0192 · Agent answered"
  },
  {
    id: 2, label: "Buy Crypto", sublabel: "MoonPay Agents",
    icon: <CreditCard size={18} />, color: "text-violet-400", glowColor: "#7c3aed",
    status: "idle", detail: "$100 USDT via bank transfer"
  },
  {
    id: 3, label: "Atomic Swap", sublabel: "IntercomSwap",
    icon: <ArrowLeftRight size={18} />, color: "text-amber-400", glowColor: "#f59e0b",
    status: "idle", detail: "USDT → BTC · Lightning Network"
  },
  {
    id: 4, label: "Send Payment", sublabel: "Non-custodial wallet",
    icon: <Send size={18} />, color: "text-emerald-400", glowColor: "#10b981",
    status: "idle", detail: "0.00231 BTC → bc1q...4f2a"
  },
  {
    id: 5, label: "Confirmed", sublabel: "OpenClaw notifies",
    icon: <CheckCircle2 size={18} />, color: "text-cyan-300", glowColor: "#67e8f9",
    status: "idle", detail: "WhatsApp: Payment confirmed ✓"
  },
];

const ACTIVITY_LOG: ActivityItem[] = [
  { id: "a1", time: "2s ago", type: "confirm", message: "Payment confirmed to Ben", amount: "0.00231 BTC", status: "success" },
  { id: "a2", time: "18s ago", type: "send", message: "Outbound transfer executed", amount: "0.00231 BTC", status: "success" },
  { id: "a3", time: "34s ago", type: "swap", message: "Atomic swap settled", amount: "$100 USDT → BTC", status: "success" },
  { id: "a4", time: "52s ago", type: "buy", message: "MoonPay on-ramp complete", amount: "$100.00 USDT", status: "success" },
  { id: "a5", time: "1m ago", type: "call", message: "Voice instruction received", amount: undefined, status: "success" },
  { id: "a6", time: "8m ago", type: "swap", message: "Swap quote negotiated P2P", amount: "Rate: 0.0000231", status: "success" },
  { id: "a7", time: "22m ago", type: "buy", message: "Recurring DCA executed", amount: "$50.00 BTC", status: "success" },
  { id: "a8", time: "1h ago", type: "send", message: "Invoice paid automatically", amount: "0.00089 BTC", status: "success" },
  { id: "a9", time: "3h ago", type: "call", message: "Inbound call: portfolio check", amount: undefined, status: "success" },
  { id: "a10", time: "5h ago", type: "swap", message: "Swap failed — retrying", amount: "ETH → USDC", status: "error" },
];

const BALANCES: BalanceItem[] = [
  { symbol: "BTC", name: "Bitcoin", amount: "0.04821", usd: "$4,821.00", change: "+2.4%", positive: true, color: "#f59e0b" },
  { symbol: "USDT", name: "Tether", amount: "1,240.00", usd: "$1,240.00", change: "+0.01%", positive: true, color: "#10b981" },
  { symbol: "SOL", name: "Solana", amount: "12.50", usd: "$1,875.00", change: "-1.2%", positive: false, color: "#7c3aed" },
  { symbol: "ETH", name: "Ethereum", amount: "0.812", usd: "$2,436.00", change: "+3.1%", positive: true, color: "#06b6d4" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function AgentStatusOrb({ isActive }: { isActive: boolean }) {
  return (
    <div className="relative flex items-center justify-center w-14 h-14">
      {isActive && (
        <>
          <div className="absolute inset-0 rounded-full bg-cyan-400/10 animate-ping" />
          <div className="absolute inset-1 rounded-full bg-cyan-400/15 animate-pulse" />
        </>
      )}
      <div
        className="relative w-10 h-10 rounded-full flex items-center justify-center"
        style={{
          background: isActive
            ? "radial-gradient(circle, oklch(0.72 0.18 195 / 0.3), oklch(0.72 0.18 195 / 0.05))"
            : "radial-gradient(circle, oklch(0.3 0.02 260 / 0.5), transparent)",
          border: `1.5px solid ${isActive ? "oklch(0.72 0.18 195 / 0.7)" : "oklch(0.4 0.04 260 / 0.4)"}`,
          boxShadow: isActive ? "0 0 20px oklch(0.72 0.18 195 / 0.5)" : "none"
        }}
      >
        <Bot size={18} className={isActive ? "text-cyan-400" : "text-slate-500"} />
      </div>
    </div>
  );
}

function PipelineStepCard({ step, index, isRunning }: { step: PipelineStep; index: number; isRunning: boolean }) {
  const statusColors: Record<StepStatus, string> = {
    idle: "border-white/10 bg-white/3",
    active: "border-cyan-400/40 bg-cyan-400/5",
    complete: "border-emerald-400/40 bg-emerald-400/5",
    error: "border-red-400/40 bg-red-400/5",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08 }}
      className={`relative rounded-xl border p-4 transition-all duration-500 ${statusColors[step.status]}`}
      style={{
        backdropFilter: "blur(12px)",
        boxShadow: step.status === "active"
          ? `0 0 16px ${step.glowColor}30`
          : step.status === "complete"
          ? "0 0 10px #10b98120"
          : "none"
      }}
    >
      {/* Step number */}
      <div className="absolute -top-2.5 -left-2.5 w-5 h-5 rounded-full bg-slate-800 border border-white/15 flex items-center justify-center">
        <span className="text-[10px] font-mono text-slate-400">{step.id}</span>
      </div>

      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${step.color}`}
          style={{
            background: `${step.glowColor}15`,
            border: `1px solid ${step.glowColor}30`,
          }}
        >
          {step.status === "active" && isRunning ? (
            <Loader2 size={16} className="animate-spin" />
          ) : step.status === "complete" ? (
            <CheckCircle2 size={16} className="text-emerald-400" />
          ) : (
            step.icon
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-white/90">{step.label}</span>
            {step.status === "complete" && (
              <span className="text-[10px] text-emerald-400 font-mono">DONE</span>
            )}
            {step.status === "active" && (
              <span className="text-[10px] text-cyan-400 font-mono animate-pulse">LIVE</span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">{step.sublabel}</div>
          {step.detail && (
            <div className="text-[11px] text-slate-400 mt-1.5 font-mono truncate">{step.detail}</div>
          )}
        </div>
      </div>

      {/* Flow connector */}
      {step.id < 5 && (
        <div className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5 z-10">
          <div className="w-px h-2 bg-white/10" />
          <ChevronRight size={10} className="text-white/20 rotate-90" />
        </div>
      )}
    </motion.div>
  );
}

function ActivityRow({ item, delay }: { item: ActivityItem; delay: number }) {
  const typeConfig = {
    call: { icon: <PhoneCall size={12} />, color: "text-cyan-400", bg: "bg-cyan-400/10" },
    buy: { icon: <CreditCard size={12} />, color: "text-violet-400", bg: "bg-violet-400/10" },
    swap: { icon: <ArrowLeftRight size={12} />, color: "text-amber-400", bg: "bg-amber-400/10" },
    send: { icon: <Send size={12} />, color: "text-emerald-400", bg: "bg-emerald-400/10" },
    confirm: { icon: <CheckCircle2 size={12} />, color: "text-cyan-300", bg: "bg-cyan-300/10" },
  };
  const cfg = typeConfig[item.type];

  return (
    <motion.div
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
      className="flex items-start gap-2.5 py-2.5 border-b border-white/5 last:border-0"
    >
      <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${cfg.bg} ${cfg.color}`}>
        {cfg.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-white/80 truncate">{item.message}</span>
          {item.status === "error" && <AlertCircle size={11} className="text-red-400 flex-shrink-0" />}
        </div>
        {item.amount && (
          <div className="text-[11px] font-mono text-amber-400/80 mt-0.5">{item.amount}</div>
        )}
        <div className="text-[10px] text-slate-600 mt-0.5">{item.time}</div>
      </div>
    </motion.div>
  );
}

function StatCard({ label, value, sub, icon, color, delay }: {
  label: string; value: string; sub: string; icon: React.ReactNode; color: string; delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="glass-card rounded-xl p-4"
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs text-slate-500 uppercase tracking-wider">{label}</span>
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${color}`}
          style={{ background: `${color.replace("text-", "")}15` }}>
          {icon}
        </div>
      </div>
      <div className="text-2xl font-bold text-white" style={{ fontFamily: "'Outfit', sans-serif" }}>{value}</div>
      <div className="text-xs text-slate-500 mt-1">{sub}</div>
    </motion.div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [steps, setSteps] = useState<PipelineStep[]>(INITIAL_STEPS);
  const [isRunning, setIsRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [agentActive, setAgentActive] = useState(true);
  const [activity, setActivity] = useState<ActivityItem[]>(ACTIVITY_LOG);
  const [totalVolume, setTotalVolume] = useState("$10,372");
  const [txCount, setTxCount] = useState(47);
  const runRef = useRef(false);

  const BG_URL = "https://private-us-east-1.manuscdn.com/sessionFile/Rf8GQw20ieLRndEIY01aHd/sandbox/CMHXyEbOGZ9uI8wwGu3io8-img-1_1772065364000_na1fn_YWZvcy1iZw.png?x-oss-process=image/resize,w_1920,h_1920/format,webp/quality,q_80&Expires=1798761600&Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9wcml2YXRlLXVzLWVhc3QtMS5tYW51c2Nkbi5jb20vc2Vzc2lvbkZpbGUvUmY4R1F3MjBpZUxSbmRFSVkwMWFIZC9zYW5kYm94L0NNSFh5RWJPR1o5dUk4d3dHdTNpbzgtaW1nLTFfMTc3MjA2NTM2NDAwMF9uYTFmbl9ZV1p2Y3kxaVp3LnBuZz94LW9zcy1wcm9jZXNzPWltYWdlL3Jlc2l6ZSx3XzE5MjAsaF8xOTIwL2Zvcm1hdCx3ZWJwL3F1YWxpdHkscV84MCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc5ODc2MTYwMH19fV19&Key-Pair-Id=K2HSFNDJXOU9YS&Signature=s7lioW45otsoPZdYjq~k8BWx~~dUJTFmAxl5JPa7x97vrjTPi9yjYO7IQ8sHYVP-EhsudPQzUBGnDBOltdoNp6TLh8ULLv42iyR8IxmMY0ZB9M1Ah~JqPctENNRau3vLDzFyFgJwp6iHRiSTU9UH9C7pToZHQblD1h5-oTnftnurrEjUJg9gBA8WrB6a6f~PgEGjtYIbhHcTEcWsJIRvAAYFy64aR1DjSaujb92eQR2bN6Gw4yFSQmmmxw9~8~fD9K6KTVYUJk~j8vtvJ5NR9qa-TPgHLvl1v-t4N7UxIKecb6fEY2P9HkcJbE3A2Oe3~tuR6OhPxQQxyeKy6R-tQw__";

  const runDemo = async () => {
    if (runRef.current) return;
    runRef.current = true;
    setIsRunning(true);

    const reset = INITIAL_STEPS.map(s => ({ ...s, status: "idle" as StepStatus }));
    setSteps(reset);
    setCurrentStep(-1);

    const delays = [1200, 2500, 2000, 1500, 1000];

    for (let i = 0; i < INITIAL_STEPS.length; i++) {
      setCurrentStep(i);
      setSteps(prev => prev.map((s, idx) =>
        idx === i ? { ...s, status: "active" } : s
      ));
      await new Promise(r => setTimeout(r, delays[i]));
      setSteps(prev => prev.map((s, idx) =>
        idx === i ? { ...s, status: "complete" } : s
      ));
    }

    // Add new activity item
    const newItem: ActivityItem = {
      id: `a${Date.now()}`,
      time: "just now",
      type: "confirm",
      message: "Demo payment confirmed",
      amount: "0.00231 BTC",
      status: "success"
    };
    setActivity(prev => [newItem, ...prev.slice(0, 9)]);
    setTxCount(c => c + 1);

    toast.success("Transaction complete", {
      description: "0.00231 BTC sent to bc1q...4f2a",
    });

    setIsRunning(false);
    runRef.current = false;
  };

  const copyAddress = () => {
    toast.success("Address copied", { description: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh" });
  };

  const navItems = [
    { icon: <BarChart3 size={16} />, label: "Dashboard", active: true },
    { icon: <Wallet size={16} />, label: "Wallets", active: false },
    { icon: <ArrowLeftRight size={16} />, label: "Swaps", active: false },
    { icon: <Phone size={16} />, label: "Voice Calls", active: false },
    { icon: <Activity size={16} />, label: "Activity", active: false },
    { icon: <Network size={16} />, label: "P2P Network", active: false },
    { icon: <Shield size={16} />, label: "Security", active: false },
    { icon: <Settings size={16} />, label: "Settings", active: false },
  ];

  return (
    <div
      className="min-h-screen flex overflow-hidden"
      style={{
        background: "oklch(0.085 0.02 260)",
        fontFamily: "'Outfit', sans-serif"
      }}
    >
      {/* Background */}
      <div
        className="fixed inset-0 z-0 opacity-20"
        style={{
          backgroundImage: `url(${BG_URL})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <div className="fixed inset-0 z-0" style={{
        background: "radial-gradient(ellipse 80% 60% at 50% 0%, oklch(0.55 0.22 290 / 0.08), transparent)"
      }} />

      {/* ── Sidebar ── */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ x: -240 }}
            animate={{ x: 0 }}
            exit={{ x: -240 }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="relative z-20 w-56 flex-shrink-0 flex flex-col border-r border-white/8"
            style={{
              background: "oklch(0.1 0.025 260 / 0.92)",
              backdropFilter: "blur(20px)",
            }}
          >
            {/* Logo */}
            <div className="px-5 py-5 border-b border-white/8">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, oklch(0.72 0.18 195), oklch(0.55 0.22 290))" }}>
                  <Zap size={14} className="text-white" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white tracking-tight">AFOS</div>
                  <div className="text-[9px] text-slate-500 tracking-widest uppercase">Agent OS</div>
                </div>
              </div>
            </div>

            {/* Agent status */}
            <div className="px-4 py-4 border-b border-white/8">
              <div className="flex items-center gap-3">
                <AgentStatusOrb isActive={agentActive} />
                <div>
                  <div className="text-xs font-semibold text-white/90">OpenClaw</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${agentActive ? "bg-emerald-400" : "bg-slate-600"}`}
                      style={{ boxShadow: agentActive ? "0 0 6px #10b981" : "none" }} />
                    <span className="text-[10px] text-slate-500">{agentActive ? "Active · Listening" : "Offline"}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Nav */}
            <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
              {navItems.map((item) => (
                <button
                  key={item.label}
                  onClick={() => !item.active && toast.info("Feature coming soon")}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs transition-all duration-200 ${
                    item.active
                      ? "bg-cyan-400/10 text-cyan-400 border border-cyan-400/20"
                      : "text-slate-500 hover:text-slate-300 hover:bg-white/5"
                  }`}
                >
                  {item.icon}
                  <span className="font-medium">{item.label}</span>
                  {item.active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-cyan-400" />}
                </button>
              ))}
            </nav>

            {/* Bottom */}
            <div className="px-4 py-4 border-t border-white/8 space-y-2">
              <div className="flex items-center gap-2 px-1">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center">
                  <span className="text-[9px] font-bold text-white">A</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-white/80 truncate">Alex</div>
                  <div className="text-[10px] text-slate-600 truncate">alex@afos.ai</div>
                </div>
                <button onClick={() => toast.info("Feature coming soon")} className="text-slate-600 hover:text-slate-400">
                  <LogOut size={12} />
                </button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ── Main Content ── */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0">

        {/* Top bar */}
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-white/8"
          style={{ background: "oklch(0.1 0.02 260 / 0.7)", backdropFilter: "blur(16px)" }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(s => !s)}
              className="text-slate-500 hover:text-slate-300 transition-colors">
              {sidebarOpen ? <X size={16} /> : <Menu size={16} />}
            </button>
            <div>
              <h1 className="text-sm font-bold text-white">Agentic Financial OS</h1>
              <p className="text-[10px] text-slate-500">OpenClaw · Clawfinger · IntercomSwap · MoonPay Agents</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-400/20 bg-emerald-400/5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-emerald-400 font-medium">All Systems Operational</span>
            </div>
            <button onClick={() => toast.info("Feature coming soon")}
              className="w-7 h-7 rounded-lg border border-white/10 flex items-center justify-center text-slate-500 hover:text-slate-300 hover:border-white/20 transition-all">
              <Bell size={13} />
            </button>
          </div>
        </header>

        {/* Content grid */}
        <div className="flex-1 flex overflow-hidden">

          {/* Center: Stats + Pipeline */}
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

            {/* Stats row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard label="Total Volume" value={totalVolume} sub="Last 30 days" icon={<TrendingUp size={14} />} color="text-cyan-400" delay={0.05} />
              <StatCard label="Transactions" value={String(txCount)} sub="This month" icon={<Activity size={14} />} color="text-violet-400" delay={0.1} />
              <StatCard label="Avg. Swap Time" value="8.3s" sub="P2P settlement" icon={<Clock size={14} />} color="text-amber-400" delay={0.15} />
              <StatCard label="Network Peers" value="142" sub="IntercomSwap nodes" icon={<Globe size={14} />} color="text-emerald-400" delay={0.2} />
            </div>

            {/* Pipeline demo */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="glass-card rounded-2xl p-5"
            >
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-sm font-bold text-white">Transaction Pipeline</h2>
                  <p className="text-[11px] text-slate-500 mt-0.5">Live agentic flow · Voice → Buy → Swap → Send → Confirm</p>
                </div>
                <button
                  onClick={runDemo}
                  disabled={isRunning}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200 disabled:opacity-50"
                  style={{
                    background: isRunning ? "oklch(0.72 0.18 195 / 0.1)" : "linear-gradient(135deg, oklch(0.72 0.18 195 / 0.2), oklch(0.55 0.22 290 / 0.2))",
                    border: "1px solid oklch(0.72 0.18 195 / 0.3)",
                    color: "oklch(0.72 0.18 195)",
                    boxShadow: isRunning ? "none" : "0 0 12px oklch(0.72 0.18 195 / 0.2)"
                  }}
                >
                  {isRunning ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                  {isRunning ? "Running..." : "Run Demo"}
                </button>
              </div>

              {/* Steps */}
              <div className="space-y-4">
                {steps.map((step, i) => (
                  <PipelineStepCard key={step.id} step={step} index={i} isRunning={isRunning && currentStep === i} />
                ))}
              </div>
            </motion.div>

            {/* Wallet balances */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              className="glass-card rounded-2xl p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-bold text-white">Non-Custodial Wallet</h2>
                  <p className="text-[11px] text-slate-500 mt-0.5">You hold the keys · MoonPay managed</p>
                </div>
                <button onClick={() => toast.info("Feature coming soon")}
                  className="text-slate-600 hover:text-slate-400 transition-colors">
                  <RefreshCw size={13} />
                </button>
              </div>

              {/* Address bar */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/3 border border-white/8 mb-4">
                <span className="text-[11px] font-mono text-slate-500 flex-1 truncate">bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh</span>
                <button onClick={copyAddress} className="text-slate-600 hover:text-cyan-400 transition-colors flex-shrink-0">
                  <Copy size={11} />
                </button>
              </div>

              <div className="space-y-2">
                {BALANCES.map((b, i) => (
                  <motion.div
                    key={b.symbol}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.4 + i * 0.06 }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/3 transition-colors"
                  >
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                      style={{ background: `${b.color}20`, color: b.color, border: `1px solid ${b.color}30` }}>
                      {b.symbol.slice(0, 1)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-white/90">{b.name}</div>
                      <div className="text-[10px] font-mono text-slate-500">{b.amount} {b.symbol}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold text-amber-400">{b.usd}</div>
                      <div className={`text-[10px] ${b.positive ? "text-emerald-400" : "text-red-400"}`}>{b.change}</div>
                    </div>
                  </motion.div>
                ))}
              </div>

              <div className="mt-3 pt-3 border-t border-white/8 flex items-center justify-between">
                <span className="text-xs text-slate-500">Total Portfolio</span>
                <span className="text-sm font-bold text-amber-400">$10,372.00</span>
              </div>
            </motion.div>

            {/* Stack components */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
              className="glass-card rounded-2xl p-5"
            >
              <h2 className="text-sm font-bold text-white mb-4">Stack Components</h2>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { name: "OpenClaw", role: "Agent Brain", status: "Online", color: "#06b6d4", icon: <Bot size={14} /> },
                  { name: "Clawfinger", role: "Voice Gateway", status: "Listening", color: "#7c3aed", icon: <Phone size={14} /> },
                  { name: "IntercomSwap", role: "P2P Exchange", status: "142 Peers", color: "#f59e0b", icon: <ArrowLeftRight size={14} /> },
                  { name: "MoonPay Agents", role: "Fiat Bridge", status: "Connected", color: "#10b981", icon: <CreditCard size={14} /> },
                ].map((comp, i) => (
                  <motion.div
                    key={comp.name}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.5 + i * 0.07 }}
                    className="rounded-xl p-3 border border-white/8 hover:border-white/15 transition-all"
                    style={{ background: `${comp.color}08` }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 rounded-md flex items-center justify-center"
                        style={{ background: `${comp.color}20`, color: comp.color }}>
                        {comp.icon}
                      </div>
                      <span className="text-xs font-semibold text-white/90">{comp.name}</span>
                    </div>
                    <div className="text-[10px] text-slate-500">{comp.role}</div>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: comp.color }} />
                      <span className="text-[10px]" style={{ color: comp.color }}>{comp.status}</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>

          {/* Right: Activity feed */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="w-64 flex-shrink-0 border-l border-white/8 flex flex-col overflow-hidden"
            style={{ background: "oklch(0.1 0.022 260 / 0.7)", backdropFilter: "blur(16px)" }}
          >
            <div className="px-4 py-3.5 border-b border-white/8 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-white">Live Activity</h3>
                <p className="text-[10px] text-slate-500 mt-0.5">Agent event stream</p>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] text-emerald-400">Live</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-2">
              <AnimatePresence>
                {activity.map((item, i) => (
                  <ActivityRow key={item.id} item={item} delay={i * 0.04} />
                ))}
              </AnimatePresence>
            </div>

            {/* Voice command input */}
            <div className="px-4 py-4 border-t border-white/8">
              <div className="text-[10px] text-slate-500 mb-2 uppercase tracking-wider">Voice Command</div>
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-white/10 bg-white/3 hover:border-cyan-400/30 transition-all cursor-pointer group"
                onClick={() => toast.info("Connect Clawfinger to enable voice commands")}>
                <PhoneCall size={12} className="text-slate-600 group-hover:text-cyan-400 transition-colors" />
                <span className="text-[11px] text-slate-600 group-hover:text-slate-400 transition-colors flex-1">Call your agent...</span>
                <div className="w-4 h-4 rounded-full border border-white/10 flex items-center justify-center">
                  <Zap size={8} className="text-slate-600 group-hover:text-cyan-400 transition-colors" />
                </div>
              </div>
              <div className="mt-2 flex items-center gap-1.5 justify-center">
                <ExternalLink size={9} className="text-slate-700" />
                <span className="text-[9px] text-slate-700">Powered by Clawfinger + OpenClaw</span>
              </div>
            </div>
          </motion.div>

        </div>
      </div>
    </div>
  );
}
