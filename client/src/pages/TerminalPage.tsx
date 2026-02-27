/**
 * TerminalPage — AFOS Agent Terminal
 * Design: Glassmorphism + Agentic Sci-Fi
 * Shows real-time agent command output, pipeline step JSON, and raw logs.
 * Color coding: green=success, red=error, yellow=warn, cyan=info, gray=debug, magenta=cmd
 */

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Terminal, ChevronRight, Trash2, Download, Copy,
  ChevronDown, ChevronRight as ChevronRightIcon,
  Circle, CheckCircle2, AlertTriangle, XCircle, Info, Code2,
  Maximize2, Minimize2
} from "lucide-react";
import { toast } from "sonner";
import { useAgentLog, type TerminalEntry, type LogLevel } from "../contexts/AgentLogContext";
import { useHaptic } from "../hooks/useHaptic";

// Color config per log level
const LEVEL_CONFIG: Record<LogLevel, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  success: { label: "OK", color: "text-emerald-400", bg: "bg-emerald-500/8", Icon: CheckCircle2 },
  error:   { label: "ERR", color: "text-red-400",     bg: "bg-red-500/8",     Icon: XCircle },
  warn:    { label: "WRN", color: "text-amber-400",   bg: "bg-amber-500/8",   Icon: AlertTriangle },
  info:    { label: "INF", color: "text-cyan-400",    bg: "bg-cyan-500/5",    Icon: Info },
  debug:   { label: "DBG", color: "text-slate-400",   bg: "bg-transparent",   Icon: Code2 },
  cmd:     { label: "CMD", color: "text-violet-400",  bg: "bg-violet-500/8",  Icon: ChevronRight },
};

function JsonViewer({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data, null, 2);
  return (
    <pre className="mt-1.5 ml-6 text-xs font-mono text-slate-400 bg-muted/60 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed border border-border">
      {json}
    </pre>
  );
}

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
        {/* Timestamp */}
        <span className="text-xs font-mono text-muted-foreground/50 shrink-0 pt-px select-none w-[80px]">
          {entry.ts}
        </span>

        {/* Level badge */}
        <span className={`text-[10px] font-bold font-mono shrink-0 pt-px w-[28px] ${cfg.color}`}>
          {cfg.label}
        </span>

        {/* Icon */}
        <Icon className={`w-3.5 h-3.5 shrink-0 mt-px ${cfg.color}`} />

        {/* Message */}
        <span className={`text-xs font-mono flex-1 min-w-0 break-words ${cfg.color}`}>
          {entry.message}
        </span>

        {/* Tool tag */}
        {entry.tool && (
          <span className="text-[10px] font-mono text-muted-foreground/40 shrink-0 hidden sm:block">
            {entry.tool}
          </span>
        )}

        {/* Expand indicator */}
        {hasPayload && (
          <span className="shrink-0 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors">
            {expanded
              ? <ChevronDown className="w-3 h-3" />
              : <ChevronRightIcon className="w-3 h-3" />}
          </span>
        )}
      </div>

      {/* JSON payload */}
      <AnimatePresence>
        {expanded && entry.payload && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <JsonViewer data={entry.payload} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function TerminalPage() {
  const { entries, addEntry, clearEntries } = useAgentLog();
  const haptic = useHaptic();
  const [input, setInput] = useState("");
  const [filter, setFilter] = useState<LogLevel | "all">("all");
  const [fullscreen, setFullscreen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [entries, autoScroll]);

  // Detect manual scroll up → disable auto-scroll
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
  };

  const filteredEntries = filter === "all"
    ? entries
    : entries.filter(e => e.level === filter);

  const handleCommand = () => {
    const cmd = input.trim();
    if (!cmd) return;
    haptic.tap();
    setInput("");

    // Log the command itself
    addEntry({ level: "cmd", message: `> ${cmd}`, tool: "openclaw:parse" });

    // Simulate agent response
    setTimeout(() => {
      addEntry({ level: "info", message: `Parsing: "${cmd}"`, tool: "openclaw:parse",
        payload: { raw_input: cmd, intent: "swap", confidence: 0.94 } });
    }, 300);

    setTimeout(() => {
      if (cmd.toLowerCase().includes("swap") || cmd.toLowerCase().includes("btc") || cmd.toLowerCase().includes("usdt")) {
        addEntry({ level: "info", message: "Broadcasting RFQ to rendezvous channel…", tool: "intercomswap_rfq_send",
          payload: { channel: "0000intercomswapbtcusdt", pair: "BTC/USDT", side: "sell", amount: 0.01 } });
      } else if (cmd.toLowerCase().includes("peer") || cmd.toLowerCase().includes("list")) {
        addEntry({ level: "success", message: "3 active peers found", tool: "intercomswap_peer_list",
          payload: {
            peers: [
              { id: "3f8a…c12d", alias: "lightning-maker-1", latency_ms: 42, rate: 96420 },
              { id: "9a2b…ff01", alias: "sol-arb-node", latency_ms: 118, rate: 96380 },
              { id: "b7c3…0e44", alias: "btc-lp-tokyo", latency_ms: 67, rate: 96405 },
            ],
          } });
      } else if (cmd.toLowerCase().includes("liquidity") || cmd.toLowerCase().includes("ln")) {
        addEntry({ level: "success", message: "LN liquidity: local 0.142 BTC / remote 0.089 BTC", tool: "intercomswap_ln_getinfo",
          payload: { local_balance_sat: 14200000, remote_balance_sat: 8900000, num_active_channels: 4, synced: true } });
      } else if (cmd.toLowerCase().includes("quote")) {
        addEntry({ level: "success", message: "Best quote: 96,420 USDT/BTC from 3f8a…c12d", tool: "intercomswap_rfq_receive",
          payload: { rate: 96420, fee_pct: 0.1, peer: "3f8a…c12d", expires_in_s: 30 } });
      } else if (cmd.toLowerCase().includes("balance") || cmd.toLowerCase().includes("wallet")) {
        addEntry({ level: "success", message: "Wallet balances fetched", tool: "intercomswap_solctl_balance",
          payload: { BTC: "0.14200000", USDT: "1240.50", SOL: "12.840", ETH: "0.5120" } });
      } else if (cmd.toLowerCase().includes("help")) {
        addEntry({ level: "info", message: "Available commands:", tool: "openclaw:help",
          payload: {
            commands: [
              "Swap <amount> BTC to USDT",
              "Get best BTC quote",
              "Check LN liquidity",
              "List active peers",
              "Show wallet balances",
              "Show escrow status",
            ],
          } });
      } else {
        addEntry({ level: "warn", message: `Unknown command: "${cmd}" — try "help" for available commands`, tool: "openclaw:parse" });
      }
    }, 700);

    // Simulate pipeline completion for swap commands
    if (cmd.toLowerCase().includes("swap")) {
      const steps = [
        { delay: 1400, level: "success" as const, message: "RFQ response: 96,420 USDT/BTC from 3f8a…c12d", tool: "intercomswap_rfq_receive",
          payload: { rate: 96420, peer: "3f8a…c12d", expires_in_s: 30 } },
        { delay: 2200, level: "info" as const, message: "Accepting quote — locking HTLC escrow on Solana…", tool: "intercomswap_escrow_init",
          payload: { program: "IntercomSwapEscrow", hashlock: "0xa3f8…d92b", timeout_slot: 882400, usdt_amount: 96.32 } },
        { delay: 3100, level: "success" as const, message: "Escrow locked at PDA 7xKp…9mNz", tool: "intercomswap_escrow_init",
          payload: { pda: "7xKp9mNz", tx_sig: "5Kj2…Xm9p", state: "locked" } },
        { delay: 4000, level: "info" as const, message: "Sending Lightning payment…", tool: "intercomswap_ln_pay",
          payload: { payment_request: "lnbc100u1p…", amount_sat: 1000, fee_sat: 1 } },
        { delay: 5000, level: "success" as const, message: "Lightning settled — preimage: a3f8c1…d92b", tool: "intercomswap_ln_pay",
          payload: { preimage: "a3f8c1d92b", payment_hash: "0xd8f3…", settled_usdt: 96.32, total_fee_pct: 0.1 } },
        { delay: 5200, level: "success" as const, message: "✓ Swap complete — 0.001 BTC → 96.32 USDT", tool: "openclaw:done",
          payload: { status: "settled", btc_sent: 0.001, usdt_received: 96.32, duration_ms: 5200 } },
      ];
      steps.forEach(({ delay, ...entry }) => {
        setTimeout(() => addEntry(entry), delay);
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleCommand();
  };

  const handleCopy = () => {
    const text = filteredEntries.map(e => `[${e.ts}] ${e.level.toUpperCase().padEnd(7)} ${e.message}${e.tool ? ` (${e.tool})` : ""}`).join("\n");
    navigator.clipboard.writeText(text);
    toast.success("Log copied to clipboard");
    haptic.tap();
  };

  const handleDownload = () => {
    const text = filteredEntries.map(e =>
      `[${e.ts}] ${e.level.toUpperCase().padEnd(7)} ${e.message}${e.tool ? ` (${e.tool})` : ""}${e.payload ? "\n" + JSON.stringify(e.payload, null, 2) : ""}`
    ).join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `afos-terminal-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
    haptic.tap();
  };

  const FILTER_OPTIONS: { value: LogLevel | "all"; label: string; color: string }[] = [
    { value: "all",     label: "All",     color: "text-foreground" },
    { value: "cmd",     label: "CMD",     color: "text-violet-400" },
    { value: "success", label: "OK",      color: "text-emerald-400" },
    { value: "info",    label: "INFO",    color: "text-cyan-400" },
    { value: "warn",    label: "WARN",    color: "text-amber-400" },
    { value: "error",   label: "ERR",     color: "text-red-400" },
    { value: "debug",   label: "DEBUG",   color: "text-slate-400" },
  ];

  return (
    <div className={`flex flex-col h-full ${fullscreen ? "fixed inset-0 z-50 bg-background" : ""}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500/20 to-cyan-500/20 border border-border flex items-center justify-center">
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-foreground font-mono">Agent Terminal</h2>
            <p className="text-[10px] text-muted-foreground font-mono">openclaw-agent · intercomswap@mainnet</p>
          </div>
          <div className="flex items-center gap-1 ml-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] text-emerald-400 font-mono">live</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          {/* Filter tabs */}
          <div className="hidden sm:flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5 border border-border">
            {FILTER_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-all ${
                  filter === opt.value
                    ? `${opt.color} bg-background shadow-sm`
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Mobile filter */}
          <select
            className="sm:hidden text-xs font-mono bg-muted border border-border rounded-lg px-2 py-1 text-foreground"
            value={filter}
            onChange={e => setFilter(e.target.value as LogLevel | "all")}
          >
            {FILTER_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <button onClick={handleCopy} title="Copy log"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleDownload} title="Download log"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
            <Download className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => { clearEntries(); haptic.tap(); }} title="Clear"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setFullscreen(f => !f)} title="Toggle fullscreen"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all hidden lg:flex">
            {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
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
          filteredEntries.map(entry => (
            <LogRow key={entry.id} entry={entry} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Auto-scroll indicator */}
      {!autoScroll && (
        <div className="flex justify-center py-1 shrink-0">
          <button
            onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }}
            className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded-full px-3 py-1 hover:bg-cyan-500/20 transition-all"
          >
            ↓ Jump to latest
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
            placeholder="Type a command… e.g. Swap 0.01 BTC to USDT"
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
