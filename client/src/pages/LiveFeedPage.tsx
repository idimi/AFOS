/**
 * Live Feed — Real-time P2P Intercom sidechannel message stream
 * Shows swap.svc_announce, swap.rfq, swap.quote, swap.cancel, swap.terms, etc.
 * Mirrors what you'd see in the Collin UI "Live Feed" tab
 * Design: Glassmorphism + Agentic Sci-Fi (dark terminal aesthetic)
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Radio, Filter, Trash2, Pause, Play, ChevronDown, ChevronUp, Copy, Wifi, WifiOff, Circle } from "lucide-react";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────────────────
type MessageKind =
  | "swap.svc_announce"
  | "swap.rfq"
  | "swap.quote"
  | "swap.quote_accept"
  | "swap.cancel"
  | "swap.terms"
  | "swap.accept"
  | "swap.status"
  | "swap.invite"
  | "peer.ping"
  | "peer.join"
  | "peer.leave";

interface FeedMessage {
  id: string;
  ts: number;
  kind: MessageKind;
  channel: string;
  from: string;
  payload: Record<string, unknown>;
  expanded: boolean;
}

// ── Simulated P2P message pool (mirrors real intercomswap wire format) ─────
const PEER_IDS = [
  "3f8a...c12d",
  "a7e2...9b4f",
  "d1c5...7e3a",
  "9f0b...2d8c",
  "b4a7...1e6f",
];

const CHANNELS = ["0000intercomswapbtcusdt", "0000intercom", "swap:rfq-8f3a", "swap:rfq-2c91"];

function randomPeer() { return PEER_IDS[Math.floor(Math.random() * PEER_IDS.length)]; }
function randomChannel() { return CHANNELS[Math.floor(Math.random() * 2)]; }
function nowTs() { return Date.now(); }

const MESSAGE_TEMPLATES: { kind: MessageKind; weight: number; payload: () => Record<string, unknown> }[] = [
  {
    kind: "swap.svc_announce",
    weight: 3,
    payload: () => ({
      name: "swap-maker",
      pairs: ["BTC_LN/USDT_SOL"],
      rfq_channels: ["0000intercomswapbtcusdt"],
      offers: [{ have: "USDT_SOL", want: "BTC_LN", pair: "BTC_LN/USDT_SOL" }],
      version: "1.4.2",
    }),
  },
  {
    kind: "swap.rfq",
    weight: 4,
    payload: () => ({
      id: `rfq-${Math.random().toString(36).slice(2, 8)}`,
      pair: "BTC_LN/USDT_SOL",
      have: "BTC_LN",
      want: "USDT_SOL",
      btc_sats: Math.floor(Math.random() * 500000 + 10000),
      max_fee_bps: Math.floor(Math.random() * 50 + 10),
      refund_window_min_hours: 1,
      refund_window_max_hours: 24,
      expires_at: Date.now() + 300_000,
    }),
  },
  {
    kind: "swap.quote",
    weight: 3,
    payload: () => ({
      rfq_id: `rfq-${Math.random().toString(36).slice(2, 8)}`,
      btc_sats: Math.floor(Math.random() * 500000 + 10000),
      usdt_amount: (Math.random() * 500 + 10).toFixed(6),
      fee_bps: Math.floor(Math.random() * 30 + 5),
      valid_for_sec: 60,
      rate: (95000 + Math.random() * 2000).toFixed(2),
    }),
  },
  {
    kind: "swap.quote_accept",
    weight: 2,
    payload: () => ({
      rfq_id: `rfq-${Math.random().toString(36).slice(2, 8)}`,
      quote_hash: `0x${Math.random().toString(16).slice(2, 18)}`,
    }),
  },
  {
    kind: "swap.cancel",
    weight: 2,
    payload: () => ({
      rfq_id: `rfq-${Math.random().toString(36).slice(2, 8)}`,
      reason: ["expired", "no_route", "price_moved", "user_cancel"][Math.floor(Math.random() * 4)],
    }),
  },
  {
    kind: "swap.terms",
    weight: 1,
    payload: () => ({
      swap_id: `swap:rfq-${Math.random().toString(36).slice(2, 8)}`,
      btc_sats: Math.floor(Math.random() * 500000 + 10000),
      usdt_amount: (Math.random() * 500 + 10).toFixed(6),
      ln_invoice: `lnbc${Math.floor(Math.random() * 9999)}u1p...`,
      sol_escrow_pda: `${Math.random().toString(36).slice(2, 8)}...${Math.random().toString(36).slice(2, 6)}`,
      refund_window_hours: 12,
    }),
  },
  {
    kind: "swap.status",
    weight: 2,
    payload: () => ({
      swap_id: `swap:rfq-${Math.random().toString(36).slice(2, 8)}`,
      note: ["ln_route_precheck_ok", "escrow_confirmed", "ln_paid", "claim_submitted"][Math.floor(Math.random() * 4)],
    }),
  },
  {
    kind: "peer.ping",
    weight: 4,
    payload: () => ({ latency_ms: Math.floor(Math.random() * 80 + 10) }),
  },
];

function pickMessage(): Omit<FeedMessage, "id" | "ts" | "expanded"> {
  const totalWeight = MESSAGE_TEMPLATES.reduce((s, t) => s + t.weight, 0);
  let r = Math.random() * totalWeight;
  for (const t of MESSAGE_TEMPLATES) {
    r -= t.weight;
    if (r <= 0) {
      return {
        kind: t.kind,
        channel: t.kind.startsWith("peer") ? "0000intercom" : randomChannel(),
        from: randomPeer(),
        payload: t.payload(),
      };
    }
  }
  return { kind: "peer.ping", channel: "0000intercom", from: randomPeer(), payload: { latency_ms: 42 } };
}

// ── Kind styling ───────────────────────────────────────────────────────────
const KIND_STYLE: Record<MessageKind, { color: string; bg: string; dot: string }> = {
  "swap.svc_announce": { color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/20", dot: "bg-cyan-400" },
  "swap.rfq":          { color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20", dot: "bg-amber-400" },
  "swap.quote":        { color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", dot: "bg-emerald-400" },
  "swap.quote_accept": { color: "text-green-400", bg: "bg-green-500/10 border-green-500/20", dot: "bg-green-400" },
  "swap.cancel":       { color: "text-red-400", bg: "bg-red-500/10 border-red-500/20", dot: "bg-red-400" },
  "swap.terms":        { color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20", dot: "bg-violet-400" },
  "swap.accept":       { color: "text-green-300", bg: "bg-green-500/10 border-green-500/20", dot: "bg-green-300" },
  "swap.status":       { color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20", dot: "bg-blue-400" },
  "swap.invite":       { color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20", dot: "bg-purple-400" },
  "peer.ping":         { color: "text-muted-foreground", bg: "bg-muted/30 border-border", dot: "bg-muted-foreground" },
  "peer.join":         { color: "text-emerald-300", bg: "bg-emerald-500/10 border-emerald-500/20", dot: "bg-emerald-300" },
  "peer.leave":        { color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20", dot: "bg-orange-400" },
};

const ALL_KINDS: MessageKind[] = [
  "swap.svc_announce", "swap.rfq", "swap.quote", "swap.quote_accept",
  "swap.cancel", "swap.terms", "swap.status", "peer.ping",
];

const CHANNEL_FILTERS = ["All", "0000intercomswapbtcusdt", "0000intercom", "swap:*"];

function formatTs(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function LiveFeedPage() {
  const [messages, setMessages] = useState<FeedMessage[]>([]);
  const [paused, setPaused] = useState(false);
  const [kindFilter, setKindFilter] = useState<MessageKind | "all">("all");
  const [channelFilter, setChannelFilter] = useState("All");
  const [showFilters, setShowFilters] = useState(false);
  const [connected, setConnected] = useState(true);
  const [msgCount, setMsgCount] = useState(0);
  const [tickCount, setTickCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Simulate incoming P2P messages
  useEffect(() => {
    const interval = setInterval(() => {
      setTickCount(t => t + 1);
      if (pausedRef.current) return;
      const count = Math.random() > 0.6 ? 2 : 1;
      const newMsgs: FeedMessage[] = Array.from({ length: count }, () => ({
        ...pickMessage(),
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: nowTs(),
        expanded: false,
      }));
      setMessages(prev => {
        const updated = [...prev, ...newMsgs].slice(-300); // keep last 300
        return updated;
      });
      setMsgCount(c => c + count);
    }, 1800);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, paused]);

  const toggleExpand = useCallback((id: string) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, expanded: !m.expanded } : m));
  }, []);

  const copyPayload = useCallback((msg: FeedMessage) => {
    navigator.clipboard.writeText(JSON.stringify(msg.payload, null, 2));
    toast.success("Payload copied");
  }, []);

  const clearFeed = () => {
    setMessages([]);
    setMsgCount(0);
  };

  // Filtered messages
  const filtered = messages.filter(m => {
    if (kindFilter !== "all" && m.kind !== kindFilter) return false;
    if (channelFilter !== "All") {
      if (channelFilter === "swap:*") return m.channel.startsWith("swap:");
      if (m.channel !== channelFilter) return false;
    }
    return true;
  });

  const stats = {
    rfq: messages.filter(m => m.kind === "swap.rfq").length,
    announce: messages.filter(m => m.kind === "swap.svc_announce").length,
    cancel: messages.filter(m => m.kind === "swap.cancel").length,
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="shrink-0 px-4 lg:px-6 py-4 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/25 flex items-center justify-center">
              <Radio className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-foreground">Live Feed</h1>
              <p className="text-xs text-muted-foreground">P2P sidechannel messages · tick #{tickCount}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Connection status */}
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${connected ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400" : "bg-red-500/10 border-red-500/25 text-red-400"}`}>
              {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              <span>{connected ? "live" : "disconnected"}</span>
            </div>
            <button
              onClick={() => setPaused(p => !p)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${paused ? "bg-amber-500/10 border-amber-500/25 text-amber-400" : "bg-muted/40 border-border text-muted-foreground hover:text-foreground"}`}
            >
              {paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              onClick={() => setShowFilters(f => !f)}
              className={`p-1.5 rounded-lg border transition-colors ${showFilters ? "bg-cyan-500/10 border-cyan-500/25 text-cyan-400" : "bg-muted/40 border-border text-muted-foreground hover:text-foreground"}`}
            >
              <Filter className="w-3.5 h-3.5" />
            </button>
            <button onClick={clearFeed} className="p-1.5 rounded-lg border border-border bg-muted/40 text-muted-foreground hover:text-foreground transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
          <span className="text-foreground font-mono font-medium">{msgCount} msgs</span>
          <span className="text-amber-400">{stats.rfq} RFQs</span>
          <span className="text-cyan-400">{stats.announce} announces</span>
          <span className="text-red-400">{stats.cancel} cancels</span>
        </div>

        {/* Filters */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-3 space-y-2">
                {/* Kind filter */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Message Kind</p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => setKindFilter("all")}
                      className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${kindFilter === "all" ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >
                      All
                    </button>
                    {ALL_KINDS.map(k => {
                      const s = KIND_STYLE[k];
                      return (
                        <button
                          key={k}
                          onClick={() => setKindFilter(k)}
                          className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${kindFilter === k ? `${s.bg} ${s.color}` : "border-border text-muted-foreground hover:text-foreground"}`}
                        >
                          {k}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* Channel filter */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Channel</p>
                  <div className="flex flex-wrap gap-1.5">
                    {CHANNEL_FILTERS.map(ch => (
                      <button
                        key={ch}
                        onClick={() => setChannelFilter(ch)}
                        className={`px-2 py-0.5 rounded-full text-xs border font-mono transition-colors ${channelFilter === ch ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                      >
                        {ch}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Message stream */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 lg:px-6 py-3 space-y-1 font-mono text-xs">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
            <Radio className="w-8 h-8 opacity-30" />
            <p>Waiting for P2P messages…</p>
          </div>
        )}
        <AnimatePresence initial={false}>
          {filtered.map(msg => {
            const s = KIND_STYLE[msg.kind] ?? KIND_STYLE["peer.ping"];
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.15 }}
                className={`rounded-lg border ${s.bg} overflow-hidden`}
              >
                {/* Row */}
                <div
                  className="flex items-start gap-2 px-3 py-2 cursor-pointer select-none"
                  onClick={() => toggleExpand(msg.id)}
                >
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${s.dot}`} />
                  <span className="text-muted-foreground shrink-0 tabular-nums">{formatTs(msg.ts)}</span>
                  <span className={`shrink-0 font-semibold ${s.color}`}>{msg.kind}</span>
                  <span className="text-muted-foreground shrink-0 truncate max-w-[120px]">#{msg.channel}</span>
                  <span className="text-muted-foreground/60 shrink-0 truncate">from {msg.from}</span>
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={e => { e.stopPropagation(); copyPayload(msg); }}
                      className="p-0.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                    {msg.expanded ? <ChevronUp className="w-3 h-3 text-muted-foreground/50" /> : <ChevronDown className="w-3 h-3 text-muted-foreground/50" />}
                  </div>
                </div>
                {/* Expanded payload */}
                <AnimatePresence>
                  {msg.expanded && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: "auto" }}
                      exit={{ height: 0 }}
                      className="overflow-hidden"
                    >
                      <pre className="px-3 pb-3 text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                        {JSON.stringify(msg.payload, null, 2)}
                      </pre>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Bottom status bar */}
      <div className="shrink-0 px-4 lg:px-6 py-2 border-t border-border bg-muted/20 flex items-center gap-3 text-xs text-muted-foreground">
        <Circle className={`w-2 h-2 fill-current ${paused ? "text-amber-400" : "text-emerald-400 animate-pulse"}`} />
        <span>{paused ? "Paused" : "Streaming"}</span>
        <span className="ml-auto">channel: {channelFilter === "All" ? "all" : channelFilter}</span>
        <span>·</span>
        <span>{filtered.length} visible</span>
      </div>
    </div>
  );
}
