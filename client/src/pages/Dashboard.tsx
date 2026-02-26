/**
 * AFOS Dashboard — Agentic Financial Operating System
 * Stack: OpenClaw Agent → IntercomSwap (BTC/LN ↔ USDT/SOL, ETH, SOL)
 * MoonPay: shown as "Phase 2 — Coming Soon" future layer
 * Design: Glassmorphism + Agentic Sci-Fi
 * Colors: deep navy-black base, cyan-teal agent activity, violet system states, gold financial values
 */

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Zap, ArrowLeftRight, Activity, Settings,
  ChevronRight, Circle, CheckCircle2, Clock,
  TrendingUp, TrendingDown, Send,
  Network, Radio, Moon, Cpu, Wallet
} from "lucide-react";
import { toast } from "sonner";
import Swaps from "./Swaps";
import SwapHistory from "./SwapHistory";
import AgentSettings from "./AgentSettings";

type NavPage = "dashboard" | "swaps" | "activity" | "network" | "settings";

interface AgentLog {
  id: string;
  ts: string;
  level: "info" | "success" | "warn" | "error";
  message: string;
  tool?: string;
}

const INITIAL_LOGS: AgentLog[] = [
  { id: "1", ts: "02:41:07", level: "success", message: "IntercomSwap peer connected", tool: "intercomswap_peer_start" },
  { id: "2", ts: "02:41:09", level: "info", message: "Joined rendezvous: 0000intercomswapbtcusdt", tool: "intercomswap_sc_join" },
  { id: "3", ts: "02:41:12", level: "info", message: "Scanning for RFQ offers…", tool: "intercomswap_rfq_scan" },
  { id: "4", ts: "02:41:15", level: "success", message: "3 active peers discovered", tool: "intercomswap_peer_list" },
  { id: "5", ts: "02:41:20", level: "info", message: "LND healthy — 4 channels, 0.142 BTC", tool: "intercomswap_ln_getinfo" },
  { id: "6", ts: "02:41:22", level: "success", message: "Solana wallet — 1,240.50 USDT", tool: "intercomswap_solctl_balance" },
];

const LIVE_LOG_POOL: Omit<AgentLog, "id" | "ts">[] = [
  { level: "info", message: "Heartbeat — peer alive", tool: "intercomswap_peer_ping" },
  { level: "info", message: "RFQ offer from peer 3f8a…c12d", tool: "intercomswap_rfq_receive" },
  { level: "success", message: "Quote accepted: 0.001 BTC → 96.42 USDT", tool: "intercomswap_quote_accept" },
  { level: "info", message: "Monitoring escrow PDA 7xKp…9mNz", tool: "intercomswap_escrow_watch" },
  { level: "warn", message: "Peer 9a2b…ff01 slow (1.8s)", tool: "intercomswap_peer_probe" },
  { level: "success", message: "LN channel balanced — local: 0.08 BTC", tool: "intercomswap_ln_getinfo" },
  { level: "info", message: "svc_announce broadcast sent", tool: "intercomswap_svc_announce" },
  { level: "success", message: "Escrow claimed — preimage revealed", tool: "intercomswap_escrow_claim" },
];

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
  "Show swap history",
];

const CHAIN_BADGE: Record<string, string> = {
  "OpenClaw": "bg-violet-500/15 text-violet-300 border-violet-500/20",
  "IntercomSwap": "bg-cyan-500/15 text-cyan-300 border-cyan-500/20",
  "Solana": "bg-purple-500/15 text-purple-300 border-purple-500/20",
  "Bitcoin LN": "bg-amber-500/15 text-amber-300 border-amber-500/20",
};

function nowTs() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

// ── Sidebar ────────────────────────────────────────────────────────────────
function Sidebar({ navItems, activePage, setActivePage, open, setOpen }: {
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
      className="shrink-0 flex flex-col border-r border-white/5 bg-[#07090f] overflow-hidden"
    >
      <div className="h-14 flex items-center px-3.5 border-b border-white/5 shrink-0 gap-3">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center shrink-0">
          <Zap className="w-3.5 h-3.5 text-white" />
        </div>
        <AnimatePresence>
          {open && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="text-sm font-bold text-white whitespace-nowrap tracking-wide">
              AFOS
            </motion.span>
          )}
        </AnimatePresence>
        <button onClick={() => setOpen(!open)}
          className="ml-auto text-white/25 hover:text-white/60 transition-colors">
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
                active ? "bg-cyan-500/10 border border-cyan-500/20 text-cyan-300" : "text-white/35 hover:text-white/65 hover:bg-white/4"
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

      <div className="p-3 border-t border-white/5 shrink-0">
        <div className="flex items-center gap-2.5 px-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
          <AnimatePresence>
            {open && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="text-xs text-white/30 whitespace-nowrap font-mono">agent online</motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.aside>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [activePage, setActivePage] = useState<NavPage>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [logs, setLogs] = useState<AgentLog[]>(INITIAL_LOGS);
  const [pipelineStep, setPipelineStep] = useState(0);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const [agentThinking, setAgentThinking] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  useEffect(() => {
    const interval = setInterval(() => {
      const entry = LIVE_LOG_POOL[Math.floor(Math.random() * LIVE_LOG_POOL.length)];
      setLogs(prev => [...prev.slice(-50), { id: Date.now().toString(), ts: nowTs(), ...entry }]);
    }, 3800);
    return () => clearInterval(interval);
  }, []);

  const runPipeline = (cmd?: string) => {
    if (pipelineRunning) return;
    const instruction = cmd || commandInput || "Swap 0.01 BTC to USDT";
    setCommandInput("");
    setAgentThinking(true);
    setPipelineRunning(true);
    setPipelineStep(0);
    setLogs(prev => [...prev, { id: Date.now().toString(), ts: nowTs(), level: "info", message: `Agent received: "${instruction}"`, tool: "openclaw:parse" }]);
    setTimeout(() => setAgentThinking(false), 700);
    PIPELINE_STEPS.forEach((step, i) => {
      setTimeout(() => {
        setPipelineStep(i + 1);
        setLogs(prev => [...prev, {
          id: Date.now().toString() + i, ts: nowTs(),
          level: i === PIPELINE_STEPS.length - 1 ? "success" : "info",
          message: step.detail, tool: step.tool,
        }]);
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
    { id: "dashboard" as NavPage, icon: Cpu, label: "Agent Overview" },
    { id: "swaps" as NavPage, icon: ArrowLeftRight, label: "Swaps" },
    { id: "activity" as NavPage, icon: Activity, label: "History" },
    { id: "network" as NavPage, icon: Network, label: "P2P Network" },
    { id: "settings" as NavPage, icon: Settings, label: "Settings" },
  ];

  const renderPage = () => {
    if (activePage === "swaps") return <Swaps />;
    if (activePage === "activity") return <SwapHistory />;
    if (activePage === "settings") return <AgentSettings />;
    if (activePage === "network") return <NetworkPage />;
    return null;
  };

  const subPage = renderPage();

  return (
    <div className="flex h-screen bg-[#07090f] overflow-hidden font-sans">
      <Sidebar navItems={navItems} activePage={activePage} setActivePage={setActivePage} open={sidebarOpen} setOpen={setSidebarOpen} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="h-14 border-b border-white/5 flex items-center justify-between px-6 shrink-0 bg-[#07090f]/80 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm text-white/50 font-mono">openclaw-agent</span>
            <span className="text-white/15">·</span>
            <span className="text-xs text-cyan-400/70 font-mono">intercomswap@mainnet</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-white/30 font-mono hidden md:block">0000intercomswapbtcusdt</span>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/20">
              <Radio className="w-3 h-3 text-violet-400 animate-pulse" />
              <span className="text-xs text-violet-300 font-mono">3 peers</span>
            </div>
          </div>
        </header>

        {/* Sub-page or Dashboard */}
        {subPage ? (
          <main className="flex-1 overflow-auto">{subPage}</main>
        ) : (
          <div className="flex-1 overflow-auto p-5 grid grid-cols-12 gap-4">

            {/* LEFT — Command + Pipeline */}
            <div className="col-span-12 lg:col-span-5 flex flex-col gap-4">

              {/* Agent Command */}
              <div className="rounded-2xl border border-cyan-500/15 bg-gradient-to-br from-[#0c1520] to-[#090d14] p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                    <Bot className="w-4.5 h-4.5 text-cyan-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-white">OpenClaw Agent</p>
                    <p className="text-xs text-white/35">Natural language → IntercomSwap tool calls</p>
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
                    <button key={cmd} onClick={() => runPipeline(cmd)} disabled={pipelineRunning}
                      className="text-xs px-2.5 py-1.5 rounded-full border border-white/8 text-white/50 hover:border-cyan-500/35 hover:text-cyan-300 hover:bg-cyan-500/5 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                      {cmd}
                    </button>
                  ))}
                </div>

                <div className="flex gap-2">
                  <input type="text" value={commandInput} onChange={e => setCommandInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && runPipeline()}
                    placeholder="e.g. Swap 0.05 BTC to USDT at best rate…"
                    disabled={pipelineRunning}
                    className="flex-1 bg-white/4 border border-white/8 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-cyan-500/35 font-mono disabled:opacity-40" />
                  <button onClick={() => runPipeline()} disabled={pipelineRunning}
                    className="px-4 py-2.5 rounded-xl bg-cyan-500/15 border border-cyan-500/25 text-cyan-300 hover:bg-cyan-500/25 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Pipeline */}
              <div className="rounded-2xl border border-white/5 bg-[#0c1218] p-5 flex-1">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-semibold text-white">Swap Execution Pipeline</p>
                  {pipelineRunning && <span className="text-xs text-cyan-400 font-mono animate-pulse">executing…</span>}
                  {!pipelineRunning && pipelineStep === PIPELINE_STEPS.length && (
                    <span className="text-xs text-emerald-400 font-mono">✓ settled</span>
                  )}
                </div>

                <div className="space-y-2.5">
                  {PIPELINE_STEPS.map((step, i) => {
                    const done = pipelineStep > i;
                    const active = pipelineStep === i && pipelineRunning;
                    return (
                      <motion.div key={step.id}
                        className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${
                          done ? "border-emerald-500/20 bg-emerald-500/4" :
                          active ? "border-cyan-500/35 bg-cyan-500/8" :
                          "border-white/4 bg-white/1"
                        }`}
                        animate={active ? { boxShadow: ["0 0 0px rgba(6,182,212,0)", "0 0 14px rgba(6,182,212,0.12)", "0 0 0px rgba(6,182,212,0)"] } : {}}
                        transition={{ duration: 1.3, repeat: Infinity }}>
                        <div className="mt-0.5 shrink-0">
                          {done ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> :
                           active ? (
                             <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                               <Zap className="w-4 h-4 text-cyan-400" />
                             </motion.div>
                           ) : <Circle className="w-4 h-4 text-white/15" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={`text-sm font-medium ${done ? "text-emerald-300" : active ? "text-cyan-300" : "text-white/35"}`}>
                              {step.label}
                            </p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${CHAIN_BADGE[step.chain] ?? "bg-white/5 text-white/30 border-white/10"}`}>
                              {step.chain}
                            </span>
                          </div>
                          <p className={`text-xs mt-0.5 ${done || active ? "text-white/45" : "text-white/18"}`}>{step.detail}</p>
                          <p className={`text-[10px] font-mono mt-0.5 ${done || active ? "text-white/25" : "text-white/10"}`}>{step.tool}</p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                {/* MoonPay future layer */}
                <div className="mt-3 p-3 rounded-xl border border-dashed border-white/8 bg-transparent">
                  <div className="flex items-center gap-2">
                    <Moon className="w-3.5 h-3.5 text-white/18" />
                    <p className="text-xs text-white/22 font-mono">Phase 2: MoonPay fiat on-ramp → auto-fund wallet before swap</p>
                  </div>
                </div>
              </div>
            </div>

            {/* CENTER — Wallets + Pairs + LN */}
            <div className="col-span-12 lg:col-span-4 flex flex-col gap-4">

              {/* Wallets */}
              <div className="rounded-2xl border border-white/5 bg-[#0c1218] p-5">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-semibold text-white">Agent Wallets</p>
                  <span className="text-xs text-white/25 font-mono">non-custodial</span>
                </div>
                <div className="space-y-2.5">
                  {[
                    { asset: "BTC", network: "Lightning", balance: "0.14200000", usd: "$13,691", color: "text-amber-400", border: "border-amber-500/20", bg: "bg-amber-500/8" },
                    { asset: "USDT", network: "Solana", balance: "1,240.50", usd: "$1,240", color: "text-emerald-400", border: "border-emerald-500/20", bg: "bg-emerald-500/8" },
                    { asset: "SOL", network: "Solana", balance: "12.840", usd: "$1,833", color: "text-purple-400", border: "border-purple-500/20", bg: "bg-purple-500/8" },
                    { asset: "ETH", network: "Ethereum", balance: "0.5120", usd: "$1,372", color: "text-blue-400", border: "border-blue-500/20", bg: "bg-blue-500/8" },
                  ].map(w => (
                    <div key={w.asset} className={`flex items-center gap-3 p-2.5 rounded-xl border ${w.border} ${w.bg}`}>
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold font-mono ${w.color} bg-black/20 border border-white/5`}>
                        {w.asset}
                      </div>
                      <div className="flex-1">
                        <p className={`text-sm font-mono font-semibold ${w.color}`}>{w.balance}</p>
                        <p className="text-xs text-white/25">{w.network}</p>
                      </div>
                      <p className="text-sm text-white/55 font-mono">{w.usd}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t border-white/5 flex justify-between items-center">
                  <span className="text-xs text-white/25">Total Portfolio</span>
                  <span className="text-base font-bold text-amber-400 font-mono">$18,136</span>
                </div>
              </div>

              {/* IntercomSwap Pairs */}
              <div className="rounded-2xl border border-white/5 bg-[#0c1218] p-5">
                <p className="text-sm font-semibold text-white mb-3">IntercomSwap Pairs</p>
                <div className="space-y-2">
                  {[
                    { pair: "BTC/LN ↔ USDT/SOL", vol: "$142.8K", change: +3.2, price: "96,420" },
                    { pair: "SOL ↔ USDT/SOL", vol: "$28.4K", change: -1.1, price: "142.80" },
                    { pair: "ETH ↔ USDT/SOL", vol: "$61.2K", change: +0.8, price: "2,680" },
                  ].map(s => (
                    <div key={s.pair} className="flex items-center justify-between p-2.5 rounded-xl bg-white/2 border border-white/4">
                      <div>
                        <p className="text-xs font-mono text-white/65">{s.pair}</p>
                        <p className="text-[10px] text-white/25 mt-0.5">Vol 24h: {s.vol}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-mono text-white font-semibold">${s.price}</p>
                        <div className={`flex items-center gap-1 justify-end text-xs ${s.change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {s.change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {s.change >= 0 ? "+" : ""}{s.change}%
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* LN Channels */}
              <div className="rounded-2xl border border-white/5 bg-[#0c1218] p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-white">LN Channel Health</p>
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
                        <span className="text-white/45 font-mono">{ch.peer}</span>
                        <span className="text-white/25">{ch.local}% local</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400 transition-all duration-1000"
                          style={{ width: `${ch.local}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* RIGHT — Live agent log + stack status */}
            <div className="col-span-12 lg:col-span-3 flex flex-col gap-4">

              {/* Log */}
              <div className="rounded-2xl border border-white/5 bg-[#0c1218] p-5 flex flex-col" style={{ height: 420 }}>
                <div className="flex items-center justify-between mb-3 shrink-0">
                  <p className="text-sm font-semibold text-white">Agent Log</p>
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs text-white/25 font-mono">live</span>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  <AnimatePresence initial={false}>
                    {logs.map(log => (
                      <motion.div key={log.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }} className="text-xs">
                        <div className="flex items-start gap-2">
                          <span className="text-white/18 font-mono shrink-0 tabular-nums">{log.ts}</span>
                          <div className="flex-1 min-w-0">
                            <p className={`leading-snug ${
                              log.level === "success" ? "text-emerald-400" :
                              log.level === "warn" ? "text-amber-400" :
                              log.level === "error" ? "text-red-400" : "text-white/55"
                            }`}>{log.message}</p>
                            {log.tool && <p className="text-white/18 font-mono truncate">{log.tool}</p>}
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  <div ref={logsEndRef} />
                </div>
              </div>

              {/* Stack status */}
              <div className="rounded-2xl border border-white/5 bg-[#0c1218] p-5">
                <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-3">Stack Status</p>
                <div className="space-y-2.5">
                  {[
                    { name: "OpenClaw", role: "Agent runtime", status: "live", color: "text-cyan-400" },
                    { name: "IntercomSwap", role: "P2P swap protocol", status: "live", color: "text-emerald-400" },
                    { name: "Bitcoin LN", role: "BTC settlement", status: "live", color: "text-amber-400" },
                    { name: "Solana", role: "USDT escrow", status: "live", color: "text-purple-400" },
                    { name: "Ethereum", role: "ETH HTLC (building)", status: "building", color: "text-blue-400" },
                    { name: "MoonPay", role: "Fiat on-ramp (Phase 2)", status: "planned", color: "text-white/25" },
                  ].map(s => (
                    <div key={s.name} className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <span className={`text-xs font-semibold ${s.color}`}>{s.name}</span>
                        <span className="text-[10px] text-white/25 ml-1.5">{s.role}</span>
                      </div>
                      <span className={`text-[10px] font-mono shrink-0 ml-2 ${
                        s.status === "live" ? "text-emerald-400" :
                        s.status === "building" ? "text-amber-400" : "text-white/18"
                      }`}>{s.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

// ── Network placeholder ────────────────────────────────────────────────────
function NetworkPage() {
  return (
    <div className="flex-1 flex items-center justify-center p-12">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto mb-4">
          <Network className="w-8 h-8 text-violet-400" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">P2P Network Map</h2>
        <p className="text-white/35 text-sm max-w-sm mx-auto">
          Live IntercomSwap peer graph — 142 nodes, active swap channels, and geographic distribution.
        </p>
        <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-mono">
          <Clock className="w-3.5 h-3.5" />
          Coming in Phase 2
        </div>
      </div>
    </div>
  );
}
