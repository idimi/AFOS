/**
 * TerminalPage — AFOS Agent Terminal (Split Layout)
 * Design: Glassmorphism + Agentic Sci-Fi — dark terminal aesthetic
 *
 * Layout: Two vertical panels side by side
 *   LEFT  — Swap Execution Pipeline (5-step live tracker, shared via AgentLogContext)
 *   RIGHT — Agent Terminal log stream with command input
 *
 * On mobile: stacked vertically (Pipeline on top, Terminal below)
 */
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Terminal, ChevronRight, Trash2, Download, Copy,
  ChevronDown, ChevronRight as ChevronRightIcon,
  CheckCircle2, AlertTriangle, XCircle, Info, Code2,
  Circle, Zap, Play
} from "lucide-react";
import { toast } from "sonner";
import {
  useAgentLog,
  type TerminalEntry,
  type LogLevel,
  PIPELINE_STEPS,
  CHAIN_BADGE,
} from "../contexts/AgentLogContext";
import { useHaptic } from "../hooks/useHaptic";

// ── Level config ──────────────────────────────────────────────────────────────
const LEVEL_CONFIG: Record<LogLevel, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  success: { label: "OK",  color: "text-emerald-400", bg: "bg-emerald-500/8",  Icon: CheckCircle2 },
  error:   { label: "ERR", color: "text-red-400",     bg: "bg-red-500/8",      Icon: XCircle },
  warn:    { label: "WRN", color: "text-amber-400",   bg: "bg-amber-500/8",    Icon: AlertTriangle },
  info:    { label: "INF", color: "text-cyan-400",    bg: "bg-cyan-500/5",     Icon: Info },
  debug:   { label: "DBG", color: "text-slate-400",   bg: "bg-transparent",    Icon: Code2 },
  cmd:     { label: "CMD", color: "text-violet-400",  bg: "bg-violet-500/8",   Icon: ChevronRight },
};

const FILTER_OPTIONS: { label: string; value: LogLevel | "all" }[] = [
  { label: "All",   value: "all" },
  { label: "CMD",   value: "cmd" },
  { label: "OK",    value: "success" },
  { label: "INFO",  value: "info" },
  { label: "WARN",  value: "warn" },
  { label: "ERR",   value: "error" },
  { label: "DEBUG", value: "debug" },
];

// ── JSON viewer ───────────────────────────────────────────────────────────────
function JsonViewer({ data }: { data: Record<string, unknown> }) {
  return (
    <pre className="mt-1.5 ml-6 text-xs font-mono text-slate-400 bg-muted/60 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed border border-border">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

// ── Log row ───────────────────────────────────────────────────────────────────
function LogRow({ entry }: { entry: TerminalEntry }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = LEVEL_CONFIG[entry.level];
  const Icon = cfg.Icon;
  const hasPayload = !!entry.payload;
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={`group rounded-lg px-3 py-1.5 ${cfg.bg} ${hasPayload ? "cursor-pointer" : ""}`}
      onClick={hasPayload ? () => setExpanded(e => !e) : undefined}
    >
      <div className="flex items-start gap-2 min-w-0">
        <span className="text-xs font-mono text-muted-foreground/50 shrink-0 pt-px select-none w-[80px]">
          {entry.ts}
        </span>
        <span className={`text-[10px] font-bold font-mono shrink-0 pt-px w-[28px] ${cfg.color}`}>
          {cfg.label}
        </span>
        <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${cfg.color}`} />
        <span className="text-xs font-mono text-foreground/90 flex-1 min-w-0 break-words leading-relaxed">
          {entry.message}
        </span>
        {entry.tool && (
          <span className="text-[10px] font-mono text-muted-foreground/40 shrink-0 hidden sm:block">
            {entry.tool}
          </span>
        )}
        {hasPayload && (
          <span className="shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors">
            {expanded
              ? <ChevronDown className="w-3 h-3" />
              : <ChevronRightIcon className="w-3 h-3" />}
          </span>
        )}
      </div>
      <AnimatePresence>
        {expanded && entry.payload && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <JsonViewer data={entry.payload} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Pipeline Panel ────────────────────────────────────────────────────────────
function PipelinePanel() {
  const { pipelineStep, pipelineRunning, runPipeline } = useAgentLog();
  const haptic = useHaptic();

  const QUICK_CMDS = [
    "Swap 0.01 BTC to USDT",
    "Get best BTC quote",
    "Check LN liquidity",
    "List active peers",
  ];

  return (
    <div className="flex flex-col h-full min-h-0 rounded-2xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-card-foreground">Swap Execution Pipeline</span>
        </div>
        <div className="flex items-center gap-2">
          {pipelineRunning && (
            <span className="text-[10px] font-mono text-cyan-400 animate-pulse">executing...</span>
          )}
          {!pipelineRunning && pipelineStep === PIPELINE_STEPS.length && (
            <span className="text-[10px] font-mono text-emerald-400">settled</span>
          )}
          {!pipelineRunning && pipelineStep === 0 && (
            <span className="text-[10px] font-mono text-muted-foreground/50">idle</span>
          )}
        </div>
      </div>

      {/* Steps */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5 min-h-0">
        {PIPELINE_STEPS.map((step, i) => {
          const done   = pipelineStep > i;
          const active = pipelineStep === i && pipelineRunning;
          return (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`rounded-xl border p-3.5 transition-all duration-300 ${
                done
                  ? "border-emerald-500/25 bg-emerald-500/5"
                  : active
                  ? "border-cyan-500/40 bg-cyan-500/8 shadow-[0_0_12px_rgba(6,182,212,0.08)]"
                  : "border-border bg-muted/20 opacity-50"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="shrink-0 mt-0.5">
                  {done ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : active ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    >
                      <Circle className="w-4 h-4 text-cyan-400" strokeWidth={2.5} />
                    </motion.div>
                  ) : (
                    <Circle className="w-4 h-4 text-muted-foreground/30" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-semibold leading-tight ${
                      done ? "text-emerald-300" : active ? "text-cyan-300" : "text-muted-foreground"
                    }`}>
                      {step.label}
                    </span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${CHAIN_BADGE[step.chain] ?? "bg-muted text-muted-foreground border-border"}`}>
                      {step.chain}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                    {step.detail}
                  </p>
                  <p className="text-[10px] font-mono text-muted-foreground/40 mt-1">
                    {step.tool}
                  </p>
                </div>
              </div>
            </motion.div>
          );
        })}

        {/* Phase 2 placeholder */}
        <div className="rounded-xl border border-dashed border-border/50 p-3.5 opacity-35">
          <div className="flex items-start gap-3">
            <Circle className="w-4 h-4 text-muted-foreground/30 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Phase 2: Fiat On-Ramp</p>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">MoonPay to auto-fund wallet before swap</p>
            </div>
          </div>
        </div>
      </div>

      {/* Run pipeline button + quick commands */}
      <div className="shrink-0 border-t border-border p-4 space-y-3">
        <button
          onClick={() => { haptic.tap(); runPipeline("Swap 0.01 BTC to USDT"); }}
          disabled={pipelineRunning}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: pipelineRunning ? undefined : "linear-gradient(135deg, rgba(6,182,212,0.15), rgba(139,92,246,0.15))",
            border: "1px solid rgba(6,182,212,0.3)",
            color: "rgb(6,182,212)",
          }}
        >
          <Play className="w-4 h-4" />
          {pipelineRunning ? "Pipeline Running..." : "Run Pipeline Demo"}
        </button>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_CMDS.map(cmd => (
            <button
              key={cmd}
              onClick={() => { haptic.tap(); runPipeline(cmd); }}
              disabled={pipelineRunning}
              className="text-[10px] font-mono px-2 py-1 rounded-md bg-muted/60 border border-border text-muted-foreground hover:text-foreground hover:border-cyan-500/30 hover:bg-cyan-500/5 transition-all disabled:opacity-30"
            >
              {cmd}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Terminal Panel ────────────────────────────────────────────────────────────
function TerminalPanel() {
  const { entries, addEntry, clearEntries } = useAgentLog();
  const haptic = useHaptic();
  const [filter, setFilter] = useState<LogLevel | "all">("all");
  const [input, setInput] = useState("");
  const [cmdHistory, setCmdHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("afos_cmd_history") || "[]"); } catch { return []; }
  });
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredEntries = filter === "all" ? entries : entries.filter(e => e.level === filter);

  // Auto-scroll: only scroll within the container, never the page
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 60);
  };

  const handleCommand = () => {
    const cmd = input.trim();
    if (!cmd) return;
    addEntry({ level: "cmd", message: "> " + cmd, tool: "openclaw:parse" });
    const newHistory = [cmd, ...cmdHistory.slice(0, 49)];
    setCmdHistory(newHistory);
    localStorage.setItem("afos_cmd_history", JSON.stringify(newHistory));
    setHistoryIdx(-1);
    setInput("");

    setTimeout(() => {
      addEntry({ level: "debug", message: "openclaw:parse - intent: " + (cmd.toLowerCase().includes("swap") ? "swap" : "query") + ", confidence: 0.94", tool: "openclaw:parse",
        payload: { raw: cmd, intent: cmd.toLowerCase().includes("swap") ? "swap" : "query", confidence: 0.94 } });
    }, 400);

    if (cmd.toLowerCase().includes("swap") || cmd.toLowerCase().includes("btc")) {
      setTimeout(() => addEntry({ level: "info", message: "Broadcasting RFQ to rendezvous channel...", tool: "intercomswap_rfq_send",
        payload: { channel: "0000intercomswapbtcusdt", pair: "BTC/USDT", side: "sell", amount: 0.01 } }), 900);
      setTimeout(() => addEntry({ level: "success", message: "Quote received: 96,420 USDT/BTC from peer 3f8a...c12d", tool: "intercomswap_quote_accept",
        payload: { rate: 96420, peer: "3f8a...c12d", fee_bps: 30, expires_in_s: 30 } }), 1600);
    } else if (cmd.toLowerCase().includes("peer") || cmd.toLowerCase().includes("list")) {
      setTimeout(() => addEntry({ level: "success", message: "3 active peers found", tool: "intercomswap_peer_list",
        payload: { peers: [
          { id: "3f8a...c12d", alias: "lightning-maker-1", latency_ms: 42, rate: 96420 },
          { id: "9a2b...ff01", alias: "sol-arb-node", latency_ms: 118, rate: 96380 },
          { id: "b7c3...0e44", alias: "btc-lp-tokyo", latency_ms: 67, rate: 96405 },
        ] } }), 700);
    } else if (cmd.toLowerCase().includes("liquidity") || cmd.toLowerCase().includes("ln")) {
      setTimeout(() => addEntry({ level: "success", message: "LN liquidity: local 0.142 BTC / remote 0.089 BTC", tool: "intercomswap_ln_getinfo",
        payload: { local_balance_sat: 14200000, remote_balance_sat: 8900000, num_active_channels: 4, synced: true } }), 700);
    } else if (cmd.toLowerCase().includes("quote")) {
      setTimeout(() => addEntry({ level: "success", message: "Best quote: 96,420 USDT/BTC from 3f8a...c12d", tool: "intercomswap_rfq_receive",
        payload: { rate: 96420, fee_pct: 0.1, peer: "3f8a...c12d", expires_in_s: 30 } }), 700);
    } else if (cmd.toLowerCase().includes("balance") || cmd.toLowerCase().includes("wallet")) {
      setTimeout(() => addEntry({ level: "success", message: "Wallet balances fetched", tool: "intercomswap_solctl_balance",
        payload: { BTC: "0.14200000", USDT: "1240.50", SOL: "12.840", ETH: "0.5120" } }), 700);
    } else if (cmd.toLowerCase().includes("help")) {
      setTimeout(() => addEntry({ level: "info", message: "Available commands:", tool: "openclaw:help",
        payload: { commands: ["Swap <amount> BTC to USDT", "Get best BTC quote", "Check LN liquidity", "List active peers", "Show wallet balances", "Show escrow status"] } }), 400);
    } else {
      setTimeout(() => addEntry({ level: "warn", message: "Unknown command: \"" + cmd + "\" - try \"help\"", tool: "openclaw:parse" }), 500);
    }
    haptic.tap();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { handleCommand(); return; }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const idx = Math.min(historyIdx + 1, cmdHistory.length - 1);
      setHistoryIdx(idx);
      if (cmdHistory[idx]) setInput(cmdHistory[idx]);
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const idx = Math.max(historyIdx - 1, -1);
      setHistoryIdx(idx);
      setInput(idx === -1 ? "" : (cmdHistory[idx] ?? ""));
    }
  };

  const handleCopy = () => {
    const text = filteredEntries.map(e => "[" + e.ts + "] " + e.level.toUpperCase() + " " + e.message).join("\n");
    navigator.clipboard.writeText(text).then(() => toast.success("Log copied"));
    haptic.tap();
  };

  const handleDownload = () => {
    const text = filteredEntries.map(e =>
      "[" + e.ts + "] " + e.level.toUpperCase().padEnd(7) + " " + e.message + (e.tool ? " (" + e.tool + ")" : "") + (e.payload ? "\n" + JSON.stringify(e.payload, null, 2) : "")
    ).join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "afos-terminal-" + Date.now() + ".log"; a.click();
    URL.revokeObjectURL(url);
    haptic.tap();
  };

  return (
    <div className="flex flex-col h-full min-h-0 rounded-2xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0 flex-wrap gap-y-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Terminal className="w-4 h-4 text-cyan-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-card-foreground leading-none">Agent Terminal</p>
            <p className="text-[10px] font-mono text-muted-foreground/60 mt-0.5">openclaw-agent · intercomswap@mainnet</p>
          </div>
          <div className="flex items-center gap-1 ml-2 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-mono text-emerald-400">live</span>
          </div>
        </div>
        {/* Filter tabs */}
        <div className="hidden md:flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
          {FILTER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`text-[10px] font-mono px-2 py-1 rounded-md transition-all ${
                filter === opt.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {/* Mobile filter */}
        <select
          className="md:hidden text-xs font-mono bg-muted border border-border rounded-lg px-2 py-1 text-foreground"
          value={filter}
          onChange={e => setFilter(e.target.value as LogLevel | "all")}
        >
          {FILTER_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <button onClick={handleCopy} title="Copy" className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button onClick={handleDownload} title="Download" className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
          <Download className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => { clearEntries(); haptic.tap(); }} title="Clear" className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Log output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 space-y-0.5 font-mono min-h-0"
        style={{ background: "var(--background)" }}
        onClick={() => inputRef.current?.focus()}
      >
        {filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground/40">
            <Terminal className="w-8 h-8" />
            <span className="text-xs font-mono">No log entries</span>
          </div>
        ) : (
          filteredEntries.map(entry => <LogRow key={entry.id} entry={entry} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* Jump to latest */}
      {!autoScroll && (
        <div className="flex justify-center py-1 shrink-0">
          <button
            onClick={() => {
              setAutoScroll(true);
              if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }}
            className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded-full px-3 py-1 hover:bg-cyan-500/20 transition-all"
          >
            Jump to latest
          </button>
        </div>
      )}

      {/* Command input */}
      <div className="shrink-0 border-t border-border p-3">
        <div className="flex items-center gap-2 bg-muted/50 border border-border rounded-xl px-3 py-2.5 focus-within:border-cyan-500/40 focus-within:bg-muted/80 transition-all">
          <ChevronRight className="w-4 h-4 text-cyan-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command... e.g. Swap 0.01 BTC to USDT"
            className="flex-1 bg-transparent text-sm font-mono text-foreground placeholder:text-muted-foreground/40 outline-none"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
          />
          <button
            onClick={handleCommand}
            disabled={!input.trim()}
            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all disabled:opacity-30"
            style={{ background: input.trim() ? "rgba(6,182,212,0.15)" : undefined, border: input.trim() ? "1px solid rgba(6,182,212,0.3)" : undefined }}
          >
            <ChevronRight className="w-3.5 h-3.5 text-cyan-400" />
          </button>
        </div>
        {/* Quick commands */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {["Swap 0.01 BTC to USDT", "Get best BTC quote", "Check LN liquidity", "List active peers", "Show wallet balances", "help"].map(cmd => (
            <button
              key={cmd}
              onClick={() => { setInput(cmd); inputRef.current?.focus(); haptic.tap(); }}
              className="text-[10px] font-mono px-2 py-1 rounded-md bg-muted/60 border border-border text-muted-foreground hover:text-foreground hover:border-cyan-500/30 hover:bg-cyan-500/5 transition-all"
            >
              {cmd}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function TerminalPage() {
  return (
    <div className="h-full flex flex-col min-h-0 p-4 gap-4">
      {/* Page title row */}
      <div className="flex items-center gap-2 shrink-0">
        <Terminal className="w-4 h-4 text-cyan-400" />
        <h1 className="text-sm font-bold text-foreground">Agent Terminal</h1>
        <span className="text-xs text-muted-foreground font-mono hidden sm:block">split view: pipeline + log stream</span>
      </div>

      {/* Split layout: side by side on lg+, stacked on mobile */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0">
        {/* LEFT: Pipeline panel */}
        <div className="lg:w-[360px] xl:w-[400px] shrink-0 flex flex-col" style={{ minHeight: "380px" }}>
          <PipelinePanel />
        </div>

        {/* RIGHT: Terminal panel */}
        <div className="flex-1 flex flex-col min-h-0" style={{ minHeight: "400px" }}>
          <TerminalPanel />
        </div>
      </div>
    </div>
  );
}
