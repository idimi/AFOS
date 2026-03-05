/**
 * TerminalPage — AFOS Agent Terminal
 * Design: Glassmorphism + Agentic Sci-Fi
 * Streams REAL agent events from Oracle VM backend via SSE
 * Shows: agent decisions, P2P RFQ broadcasts, peer connections, swap executions
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Terminal, Trash2, Download, Copy,
  ChevronDown, ChevronRight,
  CheckCircle2, AlertTriangle, XCircle, Info, Code2,
  Maximize2, Minimize2, Radio, Zap, Network, Bot,
  RefreshCw, Wifi, WifiOff
} from "lucide-react";
import { toast } from "sonner";
import {
  onSSEEvent, getAgentLog, getAgentStatus, isSSEConnected,
  type AgentLogEntry, type AgentDecision
} from "../lib/afosApi";
import { useHaptic } from "../hooks/useHaptic";

// ─── Types ────────────────────────────────────────────────────────────────────

type DisplayLevel = 'info' | 'warn' | 'error' | 'debug' | 'p2p' | 'decision' | 'swap';

interface DisplayEntry {
  id: string;
  ts: string;
  level: DisplayLevel;
  message: string;
  data?: Record<string, unknown>;
  source: 'sse' | 'api';
}

// ─── Level Config ─────────────────────────────────────────────────────────────

const LEVEL_CONFIG: Record<DisplayLevel, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  info:     { label: "INF", color: "text-cyan-400",    bg: "bg-cyan-500/5",    Icon: Info },
  warn:     { label: "WRN", color: "text-amber-400",   bg: "bg-amber-500/8",   Icon: AlertTriangle },
  error:    { label: "ERR", color: "text-red-400",     bg: "bg-red-500/8",     Icon: XCircle },
  debug:    { label: "DBG", color: "text-slate-400",   bg: "bg-transparent",   Icon: Code2 },
  p2p:      { label: "P2P", color: "text-violet-400",  bg: "bg-violet-500/8",  Icon: Network },
  decision: { label: "AGT", color: "text-emerald-400", bg: "bg-emerald-500/8", Icon: Bot },
  swap:     { label: "SWP", color: "text-amber-300",   bg: "bg-amber-500/8",   Icon: Zap },
};

function formatTs(ts: number): string {
  return new Date(ts).toISOString().slice(11, 23);
}

function agentLogToDisplay(entry: AgentLogEntry): DisplayEntry {
  let level: DisplayLevel = 'info';
  let message = entry.message;

  // Detect expected Oracle VM warnings that are not real errors
  const isDexQuoteFailed = entry.level === 'warn' && entry.message === 'DEX quote failed';
  const errorDetail = (entry.data as Record<string, string> | undefined)?.error ?? '';
  const isBtcNoDex = isDexQuoteFailed && (
    errorDetail.includes('BTC') || errorDetail.includes('Unsupported pair')
  );

  if (isBtcNoDex) {
    // BTC has no DEX route — Oracle VM automatically falls back to P2P. Not a real error.
    level = 'p2p';
    message = 'DEX route unavailable for BTC — routing via P2P bridge (expected)';
  } else if (entry.level === 'warn') {
    level = 'warn';
  } else if (entry.level === 'error') {
    level = 'error';
  } else if (entry.level === 'debug') {
    level = 'debug';
  } else if (entry.message.includes('P2P') || entry.message.includes('peer') || entry.message.includes('RFQ')) {
    level = 'p2p';
  } else if (entry.message.includes('decision') || entry.message.includes('Agent')) {
    level = 'decision';
  } else if (entry.message.includes('swap') || entry.message.includes('Swap') || entry.message.includes('quote')) {
    level = 'swap';
  }

  return {
    id: entry.id,
    ts: formatTs(entry.timestamp),
    level,
    message,
    data: Object.keys(entry.data || {}).length > 0 ? entry.data : undefined,
    source: 'api',
  };
}

// ─── JSON Viewer ──────────────────────────────────────────────────────────────

function JsonViewer({ data }: { data: Record<string, unknown> }) {
  return (
    <pre className="mt-1.5 ml-6 text-xs font-mono text-slate-400 bg-muted/60 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed border border-border">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

// ─── Log Row ──────────────────────────────────────────────────────────────────

function LogRow({ entry }: { entry: DisplayEntry }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = LEVEL_CONFIG[entry.level];
  const Icon = cfg.Icon;
  const hasPayload = !!entry.data;

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
        {hasPayload && (
          <span className="shrink-0 mt-0.5">
            {expanded
              ? <ChevronDown className="w-3 h-3 text-muted-foreground" />
              : <ChevronRight className="w-3 h-3 text-muted-foreground" />
            }
          </span>
        )}
      </div>
      {expanded && entry.data && <JsonViewer data={entry.data} />}
    </motion.div>
  );
}

// ─── Agent Status Bar ─────────────────────────────────────────────────────────

function AgentStatusBar({
  status, peers, lastDecision, connected
}: {
  status: string;
  peers: number;
  lastDecision: AgentDecision | null;
  connected: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-muted/30 flex-wrap">
      {/* Connection status */}
      <div className="flex items-center gap-1.5">
        {connected
          ? <Wifi className="w-3.5 h-3.5 text-emerald-400" />
          : <WifiOff className="w-3.5 h-3.5 text-red-400" />
        }
        <span className={`text-[11px] font-mono font-semibold ${connected ? 'text-emerald-400' : 'text-red-400'}`}>
          {connected ? 'SSE LIVE' : 'RECONNECTING'}
        </span>
      </div>

      <div className="w-px h-4 bg-border" />

      {/* Agent status */}
      <div className="flex items-center gap-1.5">
        <div className={`w-2 h-2 rounded-full ${status === 'active' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
        <span className="text-[11px] font-mono text-muted-foreground">
          AGENT: <span className="text-foreground font-semibold uppercase">{status}</span>
        </span>
      </div>

      <div className="w-px h-4 bg-border" />

      {/* P2P peers */}
      <div className="flex items-center gap-1.5">
        <Radio className="w-3.5 h-3.5 text-violet-400" />
        <span className="text-[11px] font-mono text-muted-foreground">
          PEERS: <span className="text-violet-400 font-semibold">{peers}</span>
        </span>
      </div>

      {lastDecision && (
        <>
          <div className="w-px h-4 bg-border" />
          <div className="flex items-center gap-1.5 min-w-0">
            <Bot className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-[11px] font-mono text-emerald-400 font-semibold shrink-0">{lastDecision.action}</span>
            <span className="text-[11px] font-mono text-muted-foreground truncate hidden sm:block">
              — {lastDecision.reasoning}
            </span>
            <span className="text-[11px] font-mono text-slate-500 shrink-0">
              ({(lastDecision.confidence * 100).toFixed(0)}%)
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Terminal Page ───────────────────────────────────────────────────────

export default function TerminalPage() {
  const [entries, setEntries] = useState<DisplayEntry[]>([]);
  const [filter, setFilter] = useState<DisplayLevel | 'all'>('all');
  const [fullscreen, setFullscreen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [agentStatus, setAgentStatus] = useState('initializing');
  const [activePeers, setActivePeers] = useState(0);
  const [lastDecision, setLastDecision] = useState<AgentDecision | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);
  const haptic = useHaptic();

  const addEntry = useCallback((entry: DisplayEntry) => {
    setEntries(prev => {
      const next = [entry, ...prev];
      return next.slice(0, 500); // keep last 500 entries
    });
  }, []);

  // Load initial log from REST API
  useEffect(() => {
    const loadInitial = async () => {
      try {
        const [log, status] = await Promise.all([getAgentLog(), getAgentStatus()]);
        const displayEntries = log.map(agentLogToDisplay);
        setEntries(displayEntries);
        setAgentStatus(status.status);
        setActivePeers(status.activePeers);
        setLastDecision(status.lastDecision);
      } catch (err) {
        addEntry({
          id: crypto.randomUUID(),
          ts: formatTs(Date.now()),
          level: 'warn',
          message: 'Could not load initial agent log — waiting for SSE stream',
          source: 'api',
        });
      } finally {
        setLoading(false);
      }
    };
    loadInitial();
  }, [addEntry]);

  // Subscribe to SSE events
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    // Check SSE connection status
    const checkConn = setInterval(() => setSseConnected(isSSEConnected()), 2000);

    unsubs.push(onSSEEvent('init', (data: unknown) => {
      const d = data as { status: string; activePeers: number; lastDecision: AgentDecision | null };
      setSseConnected(true);
      setAgentStatus(d.status);
      setActivePeers(d.activePeers);
      setLastDecision(d.lastDecision);
      addEntry({
        id: crypto.randomUUID(),
        ts: formatTs(Date.now()),
        level: 'info',
        message: `SSE stream connected — agent ${d.status}, ${d.activePeers} P2P peers`,
        source: 'sse',
      });
    }));

    unsubs.push(onSSEEvent('agent_log', (data: unknown) => {
      const entry = data as AgentLogEntry;
      addEntry(agentLogToDisplay(entry));
    }));

    unsubs.push(onSSEEvent('agent_decision', (data: unknown) => {
      const d = data as AgentDecision;
      setLastDecision(d);
      addEntry({
        id: crypto.randomUUID(),
        ts: formatTs(d.timestamp || Date.now()),
        level: 'decision',
        message: `[GEMINI] ${d.action} — ${d.reasoning} (confidence: ${(d.confidence * 100).toFixed(0)}%)`,
        source: 'sse',
      });
    }));

    unsubs.push(onSSEEvent('peer_connected', (data: unknown) => {
      const d = data as { peer: string; totalPeers: number };
      setActivePeers(d.totalPeers);
      addEntry({
        id: crypto.randomUUID(),
        ts: formatTs(Date.now()),
        level: 'p2p',
        message: `Peer connected: ${d.peer} (total: ${d.totalPeers})`,
        source: 'sse',
      });
    }));

    unsubs.push(onSSEEvent('peer_disconnected', (data: unknown) => {
      const d = data as { peer: string; totalPeers: number };
      setActivePeers(d.totalPeers);
      addEntry({
        id: crypto.randomUUID(),
        ts: formatTs(Date.now()),
        level: 'p2p',
        message: `Peer disconnected: ${d.peer} (remaining: ${d.totalPeers})`,
        source: 'sse',
      });
    }));

    unsubs.push(onSSEEvent('p2p_rfq_sent', (data: unknown) => {
      const d = data as { rfqId: string; pair: string; amount: number; peers: number };
      addEntry({
        id: crypto.randomUUID(),
        ts: formatTs(Date.now()),
        level: 'p2p',
        message: `RFQ broadcast: ${d.amount} ${d.pair} → ${d.peers} peers`,
        data: d as unknown as Record<string, unknown>,
        source: 'sse',
      });
    }));

    unsubs.push(onSSEEvent('p2p_rfq', (data: unknown) => {
      const d = data as { rfqId: string; peer: string; pair: string; amount: number };
      addEntry({
        id: crypto.randomUUID(),
        ts: formatTs(Date.now()),
        level: 'p2p',
        message: `Incoming RFQ from ${d.peer}: ${d.amount} ${d.pair} — responding as maker`,
        data: d as unknown as Record<string, unknown>,
        source: 'sse',
      });
    }));

    unsubs.push(onSSEEvent('p2p_quote', (data: unknown) => {
      const d = data as { rfqId: string; peer: string; rate: number; outAmount: number };
      addEntry({
        id: crypto.randomUUID(),
        ts: formatTs(Date.now()),
        level: 'p2p',
        message: `P2P quote received from ${d.peer}: rate=${d.rate?.toFixed(4)}, out=${d.outAmount?.toFixed(4)}`,
        source: 'sse',
      });
    }));

    unsubs.push(onSSEEvent('rfq_result', (data: unknown) => {
      const d = data as { rfqId: string; route: string; outAmount: number; p2pQuotes: number };
      addEntry({
        id: crypto.randomUUID(),
        ts: formatTs(Date.now()),
        level: 'swap',
        message: `RFQ result: route=${d.route?.toUpperCase()}, out=${d.outAmount?.toFixed(4)}, p2p_quotes=${d.p2pQuotes}`,
        data: d as unknown as Record<string, unknown>,
        source: 'sse',
      });
    }));

    unsubs.push(onSSEEvent('swap_executed', (data: unknown) => {
      const d = data as { fromToken: string; toToken: string; inAmount: number; outAmount: number; route: string };
      addEntry({
        id: crypto.randomUUID(),
        ts: formatTs(Date.now()),
        level: 'swap',
        message: `Swap executed: ${d.inAmount} ${d.fromToken} → ${d.outAmount?.toFixed(4)} ${d.toToken} via ${d.route?.toUpperCase()}`,
        data: d as unknown as Record<string, unknown>,
        source: 'sse',
      });
      haptic.success();
    }));

    unsubs.push(onSSEEvent('prices', (data: unknown) => {
      const d = data as Record<string, { usd: number }>;
      addEntry({
        id: crypto.randomUUID(),
        ts: formatTs(Date.now()),
        level: 'info',
        message: `Price update: BTC=$${d.BTC?.usd?.toFixed(0)} ETH=$${d.ETH?.usd?.toFixed(0)} SOL=$${d.SOL?.usd?.toFixed(2)}`,
        source: 'sse',
      });
    }));

    return () => {
      unsubs.forEach(u => u());
      clearInterval(checkConn);
    };
  }, [addEntry, haptic]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries, autoScroll]);

  const filtered = filter === 'all' ? entries : entries.filter(e => e.level === filter);

  const handleClear = () => { setEntries([]); haptic.tap(); };

  const handleCopy = () => {
    const text = entries.map(e => `[${e.ts}] [${e.level.toUpperCase()}] ${e.message}`).join('\n');
    navigator.clipboard.writeText(text);
    toast.success('Log copied to clipboard');
    haptic.tap();
  };

  const handleDownload = () => {
    const text = entries.map(e => `[${e.ts}] [${e.level.toUpperCase()}] ${e.message}${e.data ? '\n' + JSON.stringify(e.data, null, 2) : ''}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `afos-agent-log-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    haptic.tap();
  };

  const FILTERS: { id: DisplayLevel | 'all'; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'decision', label: 'Agent' },
    { id: 'p2p', label: 'P2P' },
    { id: 'swap', label: 'Swaps' },
    { id: 'info', label: 'Info' },
    { id: 'warn', label: 'Warn' },
    { id: 'error', label: 'Error' },
  ];

  return (
    <div className={`flex flex-col ${fullscreen ? "fixed inset-0 z-50 bg-background" : "flex-1 min-h-0"}`}
      style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace" }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/95 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-foreground">AFOS Agent Terminal</span>
          <span className="text-[10px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
            {entries.length} events
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setAutoScroll(v => !v)}
            className={`p-1.5 rounded-lg transition-colors text-xs font-mono ${autoScroll ? 'text-cyan-400 bg-cyan-500/10' : 'text-muted-foreground hover:text-foreground'}`}
            title="Auto-scroll"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleCopy} className="p-1.5 rounded-lg hover:bg-muted transition-colors" title="Copy log">
            <Copy className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <button onClick={handleDownload} className="p-1.5 rounded-lg hover:bg-muted transition-colors" title="Download log">
            <Download className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <button onClick={handleClear} className="p-1.5 rounded-lg hover:bg-muted transition-colors" title="Clear">
            <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <button onClick={() => setFullscreen(v => !v)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            {fullscreen ? <Minimize2 className="w-3.5 h-3.5 text-muted-foreground" /> : <Maximize2 className="w-3.5 h-3.5 text-muted-foreground" />}
          </button>
        </div>
      </div>

      {/* Agent Status Bar */}
      <AgentStatusBar
        status={agentStatus}
        peers={activePeers}
        lastDecision={lastDecision}
        connected={sseConnected}
      />

      {/* Filter Tabs */}
      <div className="flex gap-1 px-4 py-2 border-b border-border bg-muted/20 overflow-x-auto shrink-0">
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-2.5 py-1 rounded text-[11px] font-mono font-semibold transition-colors shrink-0 ${
              filter === f.id
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {f.label}
            {f.id !== 'all' && (
              <span className="ml-1 text-[9px] opacity-60">
                {entries.filter(e => e.level === f.id).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Log Stream */}
      <div className="flex-1 overflow-y-auto p-3 space-y-0.5 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="text-sm font-mono">Loading agent log...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
            <Terminal className="w-8 h-8 opacity-30" />
            <span className="text-sm font-mono">
              {entries.length === 0 ? 'Waiting for agent events...' : `No ${filter} events`}
            </span>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {[...filtered].reverse().map(entry => (
              <LogRow key={entry.id} entry={entry} />
            ))}
          </AnimatePresence>
        )}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}
