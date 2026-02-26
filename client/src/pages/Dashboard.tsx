/**
 * AFOS Dashboard — Agentic Financial Operating System
 * Stack: OpenClaw Agent → IntercomSwap (BTC/LN ↔ USDT/SOL, ETH, SOL)
 * MoonPay: Phase 2 future layer
 * Design: Glassmorphism + Agentic Sci-Fi
 * Mobile: Uniswap-style — bottom tab bar, single-column cards, full-width inputs
 * Desktop: 3-column grid, agent log fills full available height
 */

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Zap, ArrowLeftRight, Activity, Settings,
  ChevronRight, Circle, CheckCircle2, Clock,
  TrendingUp, TrendingDown, Send,
  Network, Radio, Moon, Sun, Cpu, Wallet, Menu, X, Terminal,
  ToggleLeft, ToggleRight, QrCode, ArrowUpRight, ArrowDownLeft, Copy, Check
} from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "../contexts/ThemeContext";
import { useHaptic } from "../hooks/useHaptic";
import { useAgentLog } from "../contexts/AgentLogContext";
import Swaps from "./Swaps";
import SwapHistory from "./SwapHistory";
import AgentSettings from "./AgentSettings";
import NetworkPage from "./NetworkPage";
import TerminalPage from "./TerminalPage";

type NavPage = "dashboard" | "swaps" | "activity" | "network" | "settings" | "terminal";


const PIPELINE_STEPS = [
  { id: 1, label: "Agent Parses Command", tool: "openclaw:parse", detail: "OpenClaw interprets natural language instruction", chain: "OpenClaw" },
  { id: 2, label: "Broadcast RFQ", tool: "intercomswap_rfq_send", detail: "Request-for-Quote sent to P2P rendezvous channel", chain: "IntercomSwap" },
  { id: 3, label: "Peer Negotiation", tool: "intercomswap_quote_accept", detail: "Best quote selected, swap terms agreed P2P", chain: "IntercomSwap" },
  { id: 4, label: "HTLC Escrow Lock", tool: "intercomswap_escrow_init", detail: "Solana escrow locked with payment hash (atomic)", chain: "Solana" },
  { id: 5, label: "Lightning Settlement", tool: "intercomswap_ln_pay", detail: "BTC sent via LN, preimage reveals USDT to maker", chain: "Bitcoin LN" },
];

const AGENT_COMMANDS = [
  "Swap 0.01 BTC to USDT",
  "Get best BTC quote",
  "Check LN liquidity",
  "List active peers",
];

const CHAIN_BADGE: Record<string, string> = {
  "OpenClaw": "bg-violet-500/15 text-violet-300 border-violet-500/20",
  "IntercomSwap": "bg-cyan-500/15 text-cyan-300 border-cyan-500/20",
  "Solana": "bg-purple-500/15 text-purple-300 border-purple-500/20",
  "Bitcoin LN": "bg-amber-500/15 text-amber-300 border-amber-500/20",
};


// ── Worker Status Card ────────────────────────────────────────────────────────
function WorkerStatusCard() {
  const [tradeauto, setTradeauto] = useState(false);
  const [ticks, setTicks] = useState(1847);
  const [actions, setActions] = useState(23);
  const [lastTick, setLastTick] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setTicks(t => t + 1);
      setLastTick(new Date());
      if (tradeauto && Math.random() > 0.7) setActions(a => a + 1);
    }, 3800);
    return () => clearInterval(interval);
  }, [tradeauto]);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shrink-0">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Worker</p>
        <button
          onClick={() => { setTradeauto(v => !v); }}
          className="flex items-center gap-1.5 text-[10px] font-mono transition-colors"
          style={{ color: tradeauto ? "#10b981" : "var(--muted-foreground)" }}
        >
          {tradeauto
            ? <ToggleRight className="w-4 h-4 text-emerald-400" />
            : <ToggleLeft className="w-4 h-4" />}
          tradeauto
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Ticks", value: ticks.toLocaleString() },
          { label: "Actions", value: actions },
          { label: "Last tick", value: `${Math.round((Date.now() - lastTick.getTime()) / 1000)}s ago` },
        ].map(stat => (
          <div key={stat.label} className="rounded-lg p-2 text-center" style={{ background: "var(--muted)" }}>
            <div className="text-sm font-bold font-mono text-foreground">{stat.value}</div>
            <div className="text-[9px] text-muted-foreground mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
      animate={{ width: open ? 216 : 60 }}
      transition={{ duration: 0.22, ease: "easeInOut" }}
      className="hidden lg:flex shrink-0 flex-col border-r border-border bg-background overflow-hidden"
    >
      <div className="h-14 flex items-center px-3.5 border-b border-border shrink-0 gap-3">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center shrink-0">
          <Zap className="w-3.5 h-3.5 text-white" />
        </div>
        <AnimatePresence>
          {open && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="text-sm font-bold text-foreground whitespace-nowrap tracking-wide">
              AFOS
            </motion.span>
          )}
        </AnimatePresence>
        <button onClick={() => setOpen(!open)}
          className="ml-auto text-muted-foreground hover:text-foreground transition-colors">
          <ChevronRight className={`w-4 h-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      <nav className="flex-1 py-3 space-y-0.5 px-2">
        {navItems.map(item => {
          const Icon = item.icon;
          const active = activePage === item.id;
          return (
            <button key={item.id} onClick={() => setActivePage(item.id)}
              className={`w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl transition-all text-left ${
                active ? "bg-cyan-500/10 border border-cyan-500/20 text-cyan-300" : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}>
              <Icon className="w-4 h-4 shrink-0" />
              <AnimatePresence>
                {open && (
                  <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="text-sm whitespace-nowrap">{item.label}</motion.span>
                )}
              </AnimatePresence>
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border shrink-0">
        <div className="flex items-center gap-2.5 px-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
          <AnimatePresence>
            {open && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
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

// ── Main ───────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { theme, toggleTheme } = useTheme();
  const haptic = useHaptic();
  const [activePage, setActivePage] = useState<NavPage>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { entries: logs, addEntry: addLog } = useAgentLog();
  const [pipelineStep, setPipelineStep] = useState(0);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const [agentThinking, setAgentThinking] = useState(false);
  const logScrollRef = useRef<HTMLDivElement>(null);
  const [logPulse, setLogPulse] = useState(false);

  // Scroll the desktop log panel — NOT the whole page (no scrollIntoView on mobile)
  useEffect(() => {
    const el = logScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  // Pulse scrollbar on new log entries
  useEffect(() => {
    setLogPulse(true);
    const t = setTimeout(() => setLogPulse(false), 600);
    return () => clearTimeout(t);
  }, [logs.length]);

  const runPipeline = (cmd?: string) => {
    if (pipelineRunning) return;
    const instruction = cmd || commandInput || "Swap 0.01 BTC to USDT";
    setCommandInput("");
    setAgentThinking(true);
    setPipelineRunning(true);
    setPipelineStep(0);
    addLog({ level: "cmd", message: `> ${instruction}`, tool: "openclaw:parse" });
    addLog({ level: "info", message: `Agent received: "${instruction}"`, tool: "openclaw:parse",
      payload: { raw_input: instruction, intent: "swap", confidence: 0.94 } });
    setTimeout(() => setAgentThinking(false), 700);
    PIPELINE_STEPS.forEach((step, i) => {
      setTimeout(() => {
        setPipelineStep(i + 1);
        addLog({
          level: i === PIPELINE_STEPS.length - 1 ? "success" : "info",
          message: step.detail, tool: step.tool,
        });
        if (i === PIPELINE_STEPS.length - 1) {
          setTimeout(() => {
            setPipelineRunning(false);
            toast.success("Swap executed", { description: "Funds settled atomically on-chain" });
          }, 500);
        }
      }, 800 + i * 1050);
    });
  };

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
    <div className="flex h-screen bg-background overflow-hidden font-sans">
      <DesktopSidebar navItems={navItems} activePage={activePage} setActivePage={setActivePage} open={sidebarOpen} setOpen={setSidebarOpen} />

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Topbar */}
        <header className="h-14 border-b border-border flex items-center justify-between px-4 lg:px-6 shrink-0 bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-2 lg:gap-3">
            {/* Mobile logo */}
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
            {/* Theme toggle */}
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
          /* ── DASHBOARD ── */
          <div className="flex-1 overflow-auto pb-20 lg:pb-0">

            {/* ── DESKTOP: 3-column grid fills full height ── */}
            <div className="hidden lg:grid grid-cols-12 gap-4 p-5 h-full" style={{ minHeight: 0 }}>

              {/* LEFT col — Command + Pipeline */}
              <div className="col-span-5 flex flex-col gap-4 min-h-0">

                {/* Agent Command */}
                <div className="rounded-2xl border border-cyan-500/15 bg-card p-5 shrink-0">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                      <Bot className="w-4 h-4 text-cyan-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-card-foreground">OpenClaw Agent</p>
                      <p className="text-xs text-muted-foreground">Natural language → IntercomSwap tool calls</p>
                    </div>
                    {agentThinking && (
                      <div className="flex gap-1">
                        {[0, 1, 2].map(i => (
                          <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-cyan-400"
                            animate={{ opacity: [0.3, 1, 0.3] }}
                            transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.2 }} />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {AGENT_COMMANDS.map(cmd => (
                      <button key={cmd} onClick={() => { haptic.tap(); runPipeline(cmd); }} disabled={pipelineRunning}
                        className="text-xs px-2.5 py-1.5 rounded-full border border-border text-muted-foreground hover:border-cyan-500/35 hover:text-cyan-300 hover:bg-cyan-500/5 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                        {cmd}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input type="text" value={commandInput} onChange={e => setCommandInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && runPipeline()}
                      placeholder="e.g. Swap 0.05 BTC to USDT at best rate…"
                      disabled={pipelineRunning}
                      className="flex-1 bg-input border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-cyan-500/35 font-mono disabled:opacity-40" />
                    <button onClick={() => { haptic.tap(); runPipeline(); }} disabled={pipelineRunning}
                      className="px-4 py-2.5 rounded-xl bg-cyan-500/15 border border-cyan-500/25 text-cyan-300 hover:bg-cyan-500/25 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Pipeline — grows to fill remaining height */}
                <div className="rounded-2xl border border-border bg-card p-5 flex-1 flex flex-col min-h-0">
                  <div className="flex items-center justify-between mb-4 shrink-0">
                    <p className="text-sm font-semibold text-card-foreground">Swap Execution Pipeline</p>
                    {pipelineRunning && <span className="text-xs text-cyan-400 font-mono animate-pulse">executing…</span>}
                    {!pipelineRunning && pipelineStep === PIPELINE_STEPS.length && (
                      <span className="text-xs text-emerald-400 font-mono">✓ settled</span>
                    )}
                  </div>
                  <div className="flex-1 overflow-auto space-y-2.5">
                    {PIPELINE_STEPS.map((step, i) => {
                      const done = pipelineStep > i;
                      const active = pipelineStep === i && pipelineRunning;
                      return (
                        <motion.div key={step.id}
                          className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${
                            done ? "border-emerald-500/20 bg-emerald-500/4" :
                            active ? "border-cyan-500/35 bg-cyan-500/8" :
                            "border-border bg-muted/30"
                          }`}
                          animate={active ? { boxShadow: ["0 0 0px rgba(6,182,212,0)", "0 0 14px rgba(6,182,212,0.12)", "0 0 0px rgba(6,182,212,0)"] } : {}}
                          transition={{ duration: 1.3, repeat: Infinity }}>
                          <div className="mt-0.5 shrink-0">
                            {done ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> :
                             active ? (
                               <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                                 <Zap className="w-4 h-4 text-cyan-400" />
                               </motion.div>
                             ) : <Circle className="w-4 h-4 text-muted-foreground/30" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className={`text-sm font-medium ${done ? "text-emerald-300" : active ? "text-cyan-300" : "text-muted-foreground"}`}>
                                {step.label}
                              </p>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${CHAIN_BADGE[step.chain] ?? "bg-muted text-muted-foreground border-border"}`}>
                                {step.chain}
                              </span>
                            </div>
                            <p className={`text-xs mt-0.5 ${done || active ? "text-foreground/60" : "text-muted-foreground/40"}`}>{step.detail}</p>
                            <p className={`text-[10px] font-mono mt-0.5 ${done || active ? "text-muted-foreground" : "text-muted-foreground/30"}`}>{step.tool}</p>
                          </div>
                        </motion.div>
                      );
                    })}
                    <div className="p-3 rounded-xl border border-dashed border-border">
                      <div className="flex items-center gap-2">
                        <Moon className="w-3.5 h-3.5 text-muted-foreground/40" />
                        <p className="text-xs text-muted-foreground/50 font-mono">Phase 2: MoonPay fiat on-ramp → auto-fund wallet before swap</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* CENTER col — Wallets + Pairs + LN */}
              <div className="col-span-4 flex flex-col gap-4 min-h-0 overflow-auto">
                <WalletsCard />
                <PairsCard />
                <LNCard />
              </div>

              {/* RIGHT col — Agent Log fills full height + Stack status below */}
              <div className="col-span-3 flex flex-col gap-4 min-h-0">

                {/* Agent Log — flex-1 so it fills all available vertical space */}
                <div className="rounded-2xl border border-border bg-card p-5 flex flex-col flex-1 min-h-0">
                  <div className="flex items-center justify-between mb-3 shrink-0">
                    <p className="text-sm font-semibold text-card-foreground">Agent Log</p>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-xs text-muted-foreground font-mono">live</span>
                    </div>
                  </div>
                  {/* overflow-y-auto on this inner div — the card itself is flex-1 */}
                  <div
                    ref={logScrollRef}
                    className={`flex-1 overflow-y-auto space-y-2 pr-1 min-h-0 transition-all duration-300 ${logPulse ? "log-scroll-pulse" : ""}`}
                  >
                    <AnimatePresence initial={false}>
                      {logs.map(log => (
                        <motion.div key={log.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }} className="text-xs">
                          <div className="flex items-start gap-2">
                            <span className="text-muted-foreground/60 font-mono shrink-0 tabular-nums">{log.ts}</span>
                            <div className="flex-1 min-w-0">
                              <p className={`leading-snug ${
                                log.level === "success" ? "text-emerald-400" :
                                log.level === "warn" ? "text-amber-400" :
                                log.level === "error" ? "text-red-400" :
                                log.level === "cmd" ? "text-violet-400" :
                                log.level === "debug" ? "text-slate-400" : "text-foreground/70"
                              }`}>{log.message}</p>
                              {log.tool && <p className="text-muted-foreground/50 font-mono truncate">{log.tool}</p>}
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Stack Status — shrinks to content */}
                <div className="rounded-2xl border border-border bg-card p-5 shrink-0">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Stack Status</p>
                  <div className="space-y-2.5">
                    {[
                      { name: "OpenClaw", role: "Agent runtime", status: "live", color: "text-cyan-400" },
                      { name: "IntercomSwap", role: "P2P swap protocol", status: "live", color: "text-emerald-400" },
                      { name: "Bitcoin LN", role: "BTC settlement", status: "live", color: "text-amber-400" },
                      { name: "Solana", role: "USDT escrow", status: "live", color: "text-purple-400" },
                      { name: "Ethereum", role: "ETH HTLC", status: "building", color: "text-blue-400" },
                      { name: "MoonPay", role: "Fiat on-ramp", status: "planned", color: "text-muted-foreground" },
                    ].map(s => (
                      <div key={s.name} className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <span className={`text-xs font-semibold ${s.color}`}>{s.name}</span>
                          <span className="text-[10px] text-muted-foreground ml-1.5">{s.role}</span>
                        </div>
                        <span className={`text-[10px] font-mono shrink-0 ml-2 ${
                          s.status === "live" ? "text-emerald-400" :
                          s.status === "building" ? "text-amber-400" : "text-muted-foreground/50"
                        }`}>{s.status}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Worker Status */}
                <WorkerStatusCard />
              </div>
            </div>

            {/* ── MOBILE: single-column stacked cards ── */}
            <div className="lg:hidden flex flex-col gap-4 p-4">

              {/* Agent Command — full width */}
              <div className="rounded-2xl border border-cyan-500/15 bg-card p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-card-foreground">OpenClaw Agent</p>
                    <p className="text-xs text-muted-foreground">Tap a command or type below</p>
                  </div>
                  {agentThinking && (
                    <div className="flex gap-1">
                      {[0, 1, 2].map(i => (
                        <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-cyan-400"
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.2 }} />
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                   {AGENT_COMMANDS.map(cmd => (
                     <button key={cmd} onClick={() => { haptic.tap(); runPipeline(cmd); }} disabled={pipelineRunning}
                      className="text-xs px-3 py-2 rounded-full border border-border text-muted-foreground active:bg-cyan-500/10 active:border-cyan-500/30 active:text-cyan-300 transition-all disabled:opacity-30">
                      {cmd}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input type="text" value={commandInput} onChange={e => setCommandInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && runPipeline()}
                    placeholder="Type a command…"
                    disabled={pipelineRunning}
                    className="flex-1 bg-input border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-cyan-500/35 font-mono disabled:opacity-40" />
                   <button onClick={() => { haptic.tap(); runPipeline(); }} disabled={pipelineRunning}
                    className="px-4 py-3 rounded-xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 active:bg-cyan-500/35 transition-all disabled:opacity-30">
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Terminal Widget — synced with Terminal page */}
              <MobileTerminalWidget logs={logs} onNavigateToTerminal={() => setActivePage("terminal")} />

              {/* Pipeline — mobile */}
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-foreground">Swap Pipeline</p>
                  {pipelineRunning && <span className="text-xs text-cyan-400 font-mono animate-pulse">executing…</span>}
                  {!pipelineRunning && pipelineStep === PIPELINE_STEPS.length && <span className="text-xs text-emerald-400 font-mono">✓ settled</span>}
                </div>
                <div className="space-y-2">
                  {PIPELINE_STEPS.map((step, i) => {
                    const done = pipelineStep > i;
                    const active = pipelineStep === i && pipelineRunning;
                    return (
                      <div key={step.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                        done ? "border-emerald-500/20 bg-emerald-500/4" :
                        active ? "border-cyan-500/35 bg-cyan-500/8" :
                        "border-border"
                      }`}>
                        <div className="shrink-0">
                          {done ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> :
                           active ? (
                             <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                               <Zap className="w-4 h-4 text-cyan-400" />
                             </motion.div>
                           ) : <Circle className="w-4 h-4 text-muted-foreground/30" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${done ? "text-emerald-300" : active ? "text-cyan-300" : "text-muted-foreground"}`}>{step.label}</p>
                          <p className={`text-xs truncate ${done || active ? "text-foreground/60" : "text-muted-foreground/30"}`}>{step.tool}</p>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono shrink-0 ${CHAIN_BADGE[step.chain] ?? "bg-muted text-muted-foreground border-border"}`}>
                          {step.chain}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Wallets — mobile */}
              <WalletsCard />

              {/* Pairs — mobile */}
              <PairsCard />

              {/* Agent Log — mobile: fixed height with scroll */}
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-card-foreground">Agent Log</p>
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs text-muted-foreground font-mono">live</span>
                  </div>
                </div>
                <div className="overflow-y-auto space-y-2" style={{ maxHeight: 280 }} ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
                  {logs.slice(-20).map(log => (
                    <div key={log.id} className="text-xs flex items-start gap-2">
                      <span className="text-muted-foreground/60 font-mono shrink-0 tabular-nums">{log.ts}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`leading-snug ${
                          log.level === "success" ? "text-emerald-400" :
                          log.level === "warn" ? "text-amber-400" :
                          log.level === "error" ? "text-red-400" :
                          log.level === "cmd" ? "text-violet-400" :
                          log.level === "debug" ? "text-slate-400" : "text-foreground/70"
                        }`}>{log.message}</p>
                        {log.tool && <p className="text-muted-foreground/50 font-mono truncate">{log.tool}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stack status — mobile */}
              <div className="rounded-2xl border border-border bg-card p-4">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Stack Status</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { name: "OpenClaw", status: "live", color: "text-cyan-400" },
                    { name: "IntercomSwap", status: "live", color: "text-emerald-400" },
                    { name: "Bitcoin LN", status: "live", color: "text-amber-400" },
                    { name: "Solana", status: "live", color: "text-purple-400" },
                    { name: "Ethereum", status: "building", color: "text-blue-400" },
                    { name: "MoonPay", status: "planned", color: "text-muted-foreground" },
                  ].map(s => (
                    <div key={s.name} className="flex items-center justify-between p-2.5 rounded-xl bg-muted/40 border border-border">
                      <span className={`text-xs font-semibold ${s.color}`}>{s.name}</span>
                      <span className={`text-[10px] font-mono ${
                        s.status === "live" ? "text-emerald-400" :
                        s.status === "building" ? "text-amber-400" : "text-muted-foreground/50"
                      }`}>{s.status}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Worker Status — mobile */}
              <WorkerStatusCard />

            </div>
          </div>
        )}
      </div>

      {/* Mobile bottom tab bar */}
      <MobileTabBar navItems={navItems} activePage={activePage} setActivePage={setActivePage} />
    </div>
  );
}

// ── Mobile Terminal Widget ────────────────────────────────────────────────
function MobileTerminalWidget({ logs, onNavigateToTerminal }: {
  logs: import("../contexts/AgentLogContext").TerminalEntry[];
  onNavigateToTerminal: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep scrolled to bottom when new entries arrive
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const recent = logs.slice(-12);

  const levelColor = (level: string) =>
    level === "success" ? "text-emerald-400" :
    level === "warn" ? "text-amber-400" :
    level === "error" ? "text-red-400" :
    level === "cmd" ? "text-violet-400" :
    level === "debug" ? "text-slate-400" : "text-cyan-300/80";

  return (
    <div className="rounded-2xl border border-violet-500/15 bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-xs font-bold font-mono text-foreground">Agent Output</span>
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        </div>
        <button
          onClick={onNavigateToTerminal}
          className="text-[10px] font-mono text-muted-foreground hover:text-cyan-400 transition-colors px-2 py-1 rounded-md hover:bg-cyan-500/10"
        >
          Open Terminal →
        </button>
      </div>

      {/* Log output */}
      <div
        ref={scrollRef}
        className="overflow-y-auto px-3 py-2 space-y-0.5"
        style={{ maxHeight: 200, background: "var(--background)" }}
      >
        {recent.map(log => (
          <div key={log.id} className="flex items-start gap-2 text-[11px] font-mono py-0.5">
            <span className="text-muted-foreground/40 shrink-0 tabular-nums w-[68px]">{log.ts.slice(0, 8)}</span>
            <span className={`flex-1 min-w-0 break-words leading-snug ${levelColor(log.level)}`}>
              {log.level === "cmd" ? log.message : log.message}
            </span>
          </div>
        ))}
      </div>
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
          {/* Header */}
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

// ── Shared card components ─────────────────────────────────────────────────
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
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-card-foreground">Agent Wallets</p>
          <span className="text-xs text-muted-foreground font-mono">non-custodial</span>
        </div>
        <div className="space-y-2.5">
          {wallets.map(w => (
            <div key={w.asset} className={`flex items-center gap-3 p-2.5 rounded-xl border ${w.border} ${w.bg}`}>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold font-mono ${w.color} bg-background/50 border border-border shrink-0`}>
                {w.asset}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-mono font-semibold ${w.color}`}>{w.balance}</p>
                <p className="text-xs text-muted-foreground">{w.network}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => setModal({ asset: w.asset, network: w.network, mode: "receive" })}
                  title="Receive"
                  className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-105"
                  style={{ background: "rgba(16,185,129,0.10)", border: "1px solid rgba(16,185,129,0.25)" }}>
                  <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-400" />
                </button>
                <button
                  onClick={() => setModal({ asset: w.asset, network: w.network, mode: "send" })}
                  title="Send"
                  className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-105"
                  style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.25)" }}>
                  <ArrowUpRight className="w-3.5 h-3.5 text-red-400" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-border flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Total Portfolio</span>
          <span className="text-base font-bold text-amber-400 font-mono">$18,136</span>
        </div>
      </div>
    </>
  );
}

function PairsCard() {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-sm font-semibold text-card-foreground mb-3">IntercomSwap Pairs</p>
      <div className="space-y-2">
        {[
          { pair: "BTC/LN ↔ USDT/SOL", vol: "$142.8K", change: +3.2, price: "96,420" },
          { pair: "SOL ↔ USDT/SOL", vol: "$28.4K", change: -1.1, price: "142.80" },
          { pair: "ETH ↔ USDT/SOL", vol: "$61.2K", change: +0.8, price: "2,680" },
        ].map(s => (
          <div key={s.pair} className="flex items-center justify-between p-2.5 rounded-xl bg-muted/30 border border-border">
            <div>
              <p className="text-xs font-mono text-foreground/65">{s.pair}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Vol 24h: {s.vol}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-mono text-foreground font-semibold">${s.price}</p>
              <div className={`flex items-center gap-1 justify-end text-xs ${s.change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {s.change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {s.change >= 0 ? "+" : ""}{s.change}%
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LNCard() {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-card-foreground">LN Channel Health</p>
        <span className="text-xs text-emerald-400 font-mono">4 active</span>
      </div>
      <div className="space-y-2.5">
        {[
          { peer: "ACINQ", local: 72 },
          { peer: "Bitfinex", local: 45 },
          { peer: "River", local: 88 },
          { peer: "Kraken", local: 31 },
        ].map(ch => (
          <div key={ch.peer}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-foreground/45 font-mono">{ch.peer}</span>
              <span className="text-muted-foreground">{ch.local}% local</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400 transition-all duration-1000"
                style={{ width: `${ch.local}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

