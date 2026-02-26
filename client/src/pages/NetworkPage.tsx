/**
 * AFOS — P2P Network Page
 * Interactive animated SVG node graph showing live IntercomSwap peers,
 * latency rings, active swap channels, and geographic distribution.
 * Design: Glassmorphism + Agentic Sci-Fi (dark navy-black, cyan-teal accents)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Radio, Zap, Globe, Activity, Users, TrendingUp,
  Shield, Clock, RefreshCw, ChevronRight, X,
  GitBranch, Plus, Minus, Mail, Link2, AlertCircle
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Peer {
  id: string;
  alias: string;
  region: string;
  lat: number;   // canvas x (0-1)
  lng: number;   // canvas y (0-1)
  latency: number;
  volume24h: number;
  pairs: string[];
  online: boolean;
  reputation: number;
  channels: number;
  liquidity: number; // BTC
  version: string;
}

interface Channel {
  from: string;
  to: string;
  active: boolean;
  volume: number;
  pair: string;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const PEERS: Peer[] = [
  { id: "self", alias: "You (openclaw-agent)", region: "Local", lat: 0.5, lng: 0.5, latency: 0, volume24h: 142000, pairs: ["BTC/USDT", "BTC/SOL", "ETH/USDC"], online: true, reputation: 100, channels: 4, liquidity: 0.142, version: "1.2.0" },
  { id: "p1", alias: "GammaLN", region: "US-East", lat: 0.18, lng: 0.38, latency: 8, volume24h: 231000, pairs: ["BTC/USDT", "BTC/ETH"], online: true, reputation: 99.8, channels: 7, liquidity: 0.85, version: "1.2.0" },
  { id: "p2", alias: "AlphaNode", region: "EU-West", lat: 0.42, lng: 0.22, latency: 12, volume24h: 142000, pairs: ["BTC/USDT", "BTC/SOL"], online: true, reputation: 99.2, channels: 5, liquidity: 0.42, version: "1.1.9" },
  { id: "p3", alias: "BetaSwap", region: "AP-South", lat: 0.78, lng: 0.30, latency: 34, volume24h: 89000, pairs: ["ETH/USDC", "ETH/SOL"], online: true, reputation: 97.8, channels: 3, liquidity: 0.21, version: "1.2.0" },
  { id: "p4", alias: "DeltaNode", region: "US-West", lat: 0.14, lng: 0.65, latency: 67, volume24h: 45000, pairs: ["SOL/USDT"], online: true, reputation: 95.1, channels: 2, liquidity: 0.09, version: "1.1.8" },
  { id: "p5", alias: "EpsilonPeer", region: "EU-Central", lat: 0.52, lng: 0.18, latency: 21, volume24h: 178000, pairs: ["BTC/USDT", "ETH/USDC"], online: false, reputation: 98.4, channels: 6, liquidity: 0.61, version: "1.2.0" },
  { id: "p6", alias: "ZetaHub", region: "AP-East", lat: 0.82, lng: 0.55, latency: 45, volume24h: 95000, pairs: ["BTC/USDT", "SOL/USDT"], online: true, reputation: 96.7, channels: 4, liquidity: 0.33, version: "1.1.9" },
  { id: "p7", alias: "EtaNode", region: "SA-East", lat: 0.30, lng: 0.75, latency: 88, volume24h: 32000, pairs: ["BTC/USDT"], online: true, reputation: 93.2, channels: 1, liquidity: 0.05, version: "1.1.7" },
  { id: "p8", alias: "ThetaRelay", region: "AF-South", lat: 0.62, lng: 0.82, latency: 112, volume24h: 18000, pairs: ["BTC/USDT", "ETH/USDC"], online: true, reputation: 91.5, channels: 2, liquidity: 0.04, version: "1.1.6" },
  { id: "p9", alias: "IotaSwap", region: "EU-North", lat: 0.38, lng: 0.12, latency: 16, volume24h: 204000, pairs: ["BTC/USDT", "BTC/SOL", "ETH/SOL"], online: true, reputation: 98.9, channels: 8, liquidity: 0.73, version: "1.2.0" },
  { id: "p10", alias: "KappaNode", region: "US-Central", lat: 0.25, lng: 0.52, latency: 29, volume24h: 67000, pairs: ["SOL/USDT", "ETH/USDC"], online: true, reputation: 96.1, channels: 3, liquidity: 0.18, version: "1.1.9" },
];

const CHANNELS: Channel[] = [
  { from: "self", to: "p1", active: true, volume: 0.042, pair: "BTC/USDT" },
  { from: "self", to: "p2", active: true, volume: 0.018, pair: "BTC/SOL" },
  { from: "self", to: "p9", active: true, volume: 0.031, pair: "BTC/USDT" },
  { from: "self", to: "p10", active: false, volume: 0.008, pair: "SOL/USDT" },
  { from: "p1", to: "p2", active: true, volume: 0.125, pair: "BTC/USDT" },
  { from: "p1", to: "p9", active: true, volume: 0.089, pair: "BTC/USDT" },
  { from: "p2", to: "p5", active: false, volume: 0.034, pair: "ETH/USDC" },
  { from: "p3", to: "p6", active: true, volume: 0.056, pair: "ETH/SOL" },
  { from: "p4", to: "p10", active: true, volume: 0.012, pair: "SOL/USDT" },
  { from: "p6", to: "p8", active: true, volume: 0.021, pair: "BTC/USDT" },
  { from: "p7", to: "p8", active: false, volume: 0.007, pair: "BTC/USDT" },
  { from: "p9", to: "p3", active: true, volume: 0.044, pair: "ETH/SOL" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function latencyColor(ms: number): string {
  if (ms === 0) return "#06b6d4";
  if (ms < 20) return "#10b981";
  if (ms < 50) return "#f59e0b";
  if (ms < 100) return "#f97316";
  return "#ef4444";
}

function nodeRadius(peer: Peer): number {
  if (peer.id === "self") return 14;
  const base = 7;
  const extra = Math.min(6, peer.channels * 0.8);
  return base + extra;
}

// ─── SVG Node Graph ───────────────────────────────────────────────────────────

function NodeGraph({ peers, channels, selectedId, onSelect, pulseIds }: {
  peers: Peer[];
  channels: Channel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  pulseIds: Set<string>;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 480 });

  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const e = entries[0];
      if (e) setDims({ w: e.contentRect.width, h: e.contentRect.height });
    });
    if (svgRef.current?.parentElement) obs.observe(svgRef.current.parentElement);
    return () => obs.disconnect();
  }, []);

  const px = (lat: number) => lat * dims.w;
  const py = (lng: number) => lng * dims.h;

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="100%"
      viewBox={`0 0 ${dims.w} ${dims.h}`}
      className="absolute inset-0"
      style={{ cursor: "default" }}
    >
      <defs>
        {/* Glow filter for active channels */}
        <filter id="glow-cyan" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="glow-node" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        {/* Animated dash for active channels */}
        <style>{`
          @keyframes dash-flow {
            to { stroke-dashoffset: -20; }
          }
          .channel-active { animation: dash-flow 1.2s linear infinite; }
        `}</style>
      </defs>

      {/* Background grid */}
      {Array.from({ length: 8 }).map((_, i) => (
        <line key={`h${i}`}
          x1={0} y1={(i + 1) * dims.h / 9}
          x2={dims.w} y2={(i + 1) * dims.h / 9}
          stroke="rgba(6,182,212,0.04)" strokeWidth={1} />
      ))}
      {Array.from({ length: 12 }).map((_, i) => (
        <line key={`v${i}`}
          x1={(i + 1) * dims.w / 13} y1={0}
          x2={(i + 1) * dims.w / 13} y2={dims.h}
          stroke="rgba(6,182,212,0.04)" strokeWidth={1} />
      ))}

      {/* Channels */}
      {channels.map((ch, i) => {
        const from = peers.find(p => p.id === ch.from);
        const to = peers.find(p => p.id === ch.to);
        if (!from || !to) return null;
        const isSelected = selectedId === ch.from || selectedId === ch.to;
        return (
          <g key={i}>
            {/* Glow underlay for active channels */}
            {ch.active && (
              <line
                x1={px(from.lat)} y1={py(from.lng)}
                x2={px(to.lat)} y2={py(to.lng)}
                stroke="rgba(6,182,212,0.12)"
                strokeWidth={isSelected ? 6 : 3}
              />
            )}
            <line
              x1={px(from.lat)} y1={py(from.lng)}
              x2={px(to.lat)} y2={py(to.lng)}
              stroke={ch.active
                ? isSelected ? "rgba(6,182,212,0.7)" : "rgba(6,182,212,0.25)"
                : "rgba(255,255,255,0.05)"}
              strokeWidth={ch.active ? (isSelected ? 2 : 1.5) : 1}
              strokeDasharray={ch.active ? "6 4" : "3 6"}
              className={ch.active ? "channel-active" : ""}
            />
            {/* Volume dot at midpoint */}
            {ch.active && (
              <circle
                cx={(px(from.lat) + px(to.lat)) / 2}
                cy={(py(from.lng) + py(to.lng)) / 2}
                r={3}
                fill="rgba(6,182,212,0.5)"
              />
            )}
          </g>
        );
      })}

      {/* Nodes */}
      {peers.map(peer => {
        const x = px(peer.lat);
        const y = py(peer.lng);
        const r = nodeRadius(peer);
        const color = latencyColor(peer.latency);
        const isSelected = selectedId === peer.id;
        const isPulsing = pulseIds.has(peer.id);
        const isSelf = peer.id === "self";

        return (
          <g key={peer.id} onClick={() => onSelect(peer.id)} style={{ cursor: "pointer" }}>
            {/* Latency ring */}
            {peer.online && (
              <circle
                cx={x} cy={y} r={r + 8}
                fill="none"
                stroke={color}
                strokeWidth={1}
                opacity={0.2}
              />
            )}

            {/* Pulse animation on activity */}
            {isPulsing && (
              <motion.circle
                cx={x} cy={y}
                r={r}
                fill="none"
                stroke={color}
                strokeWidth={2}
                initial={{ r, opacity: 0.8 }}
                animate={{ r: r + 20, opacity: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            )}

            {/* Selection ring */}
            {isSelected && (
              <circle
                cx={x} cy={y} r={r + 12}
                fill="none"
                stroke="rgba(6,182,212,0.5)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}

            {/* Node body */}
            <circle
              cx={x} cy={y} r={r}
              fill={isSelf
                ? "rgba(6,182,212,0.25)"
                : peer.online
                  ? `${color}22`
                  : "rgba(255,255,255,0.04)"}
              stroke={isSelf
                ? "rgba(6,182,212,0.8)"
                : peer.online ? color : "rgba(255,255,255,0.12)"}
              strokeWidth={isSelf ? 2 : 1.5}
              filter={isSelected || isSelf ? "url(#glow-node)" : undefined}
            />

            {/* Offline indicator */}
            {!peer.online && (
              <line
                x1={x - r * 0.5} y1={y - r * 0.5}
                x2={x + r * 0.5} y2={y + r * 0.5}
                stroke="rgba(239,68,68,0.5)" strokeWidth={1.5}
              />
            )}

            {/* Self icon */}
            {isSelf && (
              <text x={x} y={y + 4} textAnchor="middle" fontSize={10} fill="rgba(6,182,212,0.9)" fontWeight="bold">⚡</text>
            )}

            {/* Alias label */}
            <text
              x={x} y={y + r + 14}
              textAnchor="middle"
              fontSize={9}
              fill={peer.online ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.2)"}
              fontFamily="monospace"
            >
              {peer.alias.split(" ")[0]}
            </text>

            {/* Latency badge */}
            {peer.id !== "self" && peer.online && (
              <text
                x={x} y={y + r + 24}
                textAnchor="middle"
                fontSize={8}
                fill={color}
                fontFamily="monospace"
                opacity={0.7}
              >
                {peer.latency}ms
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Peer Detail Panel ────────────────────────────────────────────────────────

function PeerDetail({ peer, onClose }: { peer: Peer; onClose: () => void }) {
  const color = latencyColor(peer.latency);
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.2 }}
      className="absolute top-4 right-4 w-64 rounded-2xl p-4 z-20"
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        backdropFilter: "blur(24px)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ background: peer.online ? "#10b981" : "#ef4444" }} />
            <span className="text-sm font-bold text-foreground">{peer.alias}</span>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground">{peer.region}</span>
        </div>
        <button onClick={onClose} className="text-foreground/25 hover:text-foreground/60 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2">
        {[
          { label: "Latency", value: peer.id === "self" ? "local" : `${peer.latency}ms`, color: color },
          { label: "Reputation", value: `${peer.reputation}%`, color: peer.reputation > 98 ? "#10b981" : peer.reputation > 95 ? "#f59e0b" : "#ef4444" },
          { label: "Channels", value: peer.channels.toString(), color: "#06b6d4" },
          { label: "Liquidity", value: `${peer.liquidity} BTC`, color: "#f7931a" },
          { label: "24h Volume", value: `$${(peer.volume24h / 1000).toFixed(0)}k`, color: "#a78bfa" },
          { label: "Version", value: peer.version, color: "#64748b" },
        ].map(item => (
          <div key={item.label} className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">{item.label}</span>
            <span className="text-[10px] font-mono font-semibold" style={{ color: item.color }}>{item.value}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t border-border">
        <div className="text-[9px] text-slate-600 uppercase tracking-widest mb-1.5">Active Pairs</div>
        <div className="flex flex-wrap gap-1">
          {peer.pairs.map(pair => (
            <span key={pair} className="px-1.5 py-0.5 rounded text-[9px] font-mono"
              style={{ background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)", color: "rgba(6,182,212,0.8)" }}>
              {pair}
            </span>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function NetworkStats({ peers, channels }: { peers: Peer[]; channels: Channel[] }) {
  const online = peers.filter(p => p.online).length;
  const activeChannels = channels.filter(c => c.active).length;
  const totalVolume = peers.reduce((s, p) => s + p.volume24h, 0);
  const avgLatency = Math.round(peers.filter(p => p.id !== "self" && p.online).reduce((s, p) => s + p.latency, 0) / (online - 1));

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      {[
        { label: "Online Peers", value: `${online}/${peers.length}`, icon: Users, color: "#10b981" },
        { label: "Active Channels", value: `${activeChannels}`, icon: Zap, color: "#06b6d4" },
        { label: "24h Volume", value: `$${(totalVolume / 1000).toFixed(0)}k`, icon: TrendingUp, color: "#a78bfa" },
        { label: "Avg Latency", value: `${avgLatency}ms`, icon: Clock, color: "#f59e0b" },
      ].map(stat => {
        const Icon = stat.icon;
        return (
          <div key={stat.label} className="rounded-xl p-3 flex items-center gap-3"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: `${stat.color}18`, border: `1px solid ${stat.color}30` }}>
              <Icon className="w-3.5 h-3.5" style={{ color: stat.color }} />
            </div>
            <div>
              <div className="text-sm font-bold font-mono" style={{ color: stat.color }}>{stat.value}</div>
              <div className="text-[9px] text-muted-foreground">{stat.label}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Peer List ────────────────────────────────────────────────────────────────

function PeerList({ peers, selectedId, onSelect }: {
  peers: Peer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="px-4 py-3 border-b flex items-center justify-between"
        style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2">
          <Globe className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-xs font-bold text-foreground">Peer Directory</span>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">{peers.length} nodes</span>
      </div>
      <div className="divide-y max-h-64 overflow-y-auto" style={{ borderColor: "var(--border)" }}>
        {peers.filter(p => p.id !== "self").map(peer => {
          const color = latencyColor(peer.latency);
          const isSelected = selectedId === peer.id;
          return (
            <button
              key={peer.id}
              onClick={() => onSelect(peer.id)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors text-left"
              style={{ background: isSelected ? "rgba(6,182,212,0.06)" : undefined }}
            >
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: peer.online ? color : "#374151" }} />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-mono text-slate-200 truncate">{peer.alias}</div>
                <div className="text-[9px] text-slate-600">{peer.region} · {peer.pairs[0]}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] font-mono" style={{ color }}>{peer.id === "self" ? "local" : `${peer.latency}ms`}</div>
                <div className="text-[9px] text-slate-600">{peer.channels}ch</div>
              </div>
              <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Network Page ────────────────────────────────────────────────────────

interface LNChannel {
  id: string;
  peer: string;
  pubkey: string;
  localBal: number;
  remoteBal: number;
  capacity: number;
  status: "active" | "inactive" | "pending";
  feePpm: number;
}

const INITIAL_LN_CHANNELS: LNChannel[] = [
  { id: "ch_1", peer: "AlphaNode", pubkey: "02a3b4c5d6e7f8...", localBal: 0.05, remoteBal: 0.03, capacity: 0.08, status: "active", feePpm: 100 },
  { id: "ch_2", peer: "GammaLN", pubkey: "03b4c5d6e7f8a9...", localBal: 0.12, remoteBal: 0.08, capacity: 0.20, status: "active", feePpm: 150 },
  { id: "ch_3", peer: "IotaSwap", pubkey: "04c5d6e7f8a9b0...", localBal: 0.02, remoteBal: 0.06, capacity: 0.08, status: "inactive", feePpm: 200 },
  { id: "ch_4", peer: "ZetaHub", pubkey: "05d6e7f8a9b0c1...", localBal: 0.08, remoteBal: 0.02, capacity: 0.10, status: "pending", feePpm: 80 },
];

export default function NetworkPage() {
  const [activeTab, setActiveTab] = useState<"topology" | "channels" | "invites">("topology");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pulseIds, setPulseIds] = useState<Set<string>>(new Set());
  const [liveChannels, setLiveChannels] = useState<Channel[]>(CHANNELS);
  const [livePeers, setLivePeers] = useState<Peer[]>(PEERS);
  const [lastActivity, setLastActivity] = useState<string>("Scanning P2P network...");
  const [lnChannels, setLnChannels] = useState<LNChannel[]>(INITIAL_LN_CHANNELS);
  const [openChannelForm, setOpenChannelForm] = useState(false);
  const [newChannel, setNewChannel] = useState({ peer: "", pubkey: "", amount: "" });
  const [inviteCode, setInviteCode] = useState("");
  const [invites, setInvites] = useState<{code: string; peer: string; created: Date; used: boolean}[]>([
    { code: "AFOS-7X3K-SWAP", peer: "AlphaNode", created: new Date(Date.now() - 86400000), used: true },
    { code: "AFOS-9M2P-SWAP", peer: "GammaLN", created: new Date(Date.now() - 3600000), used: false },
  ]);

  const selectedPeer = selectedId ? livePeers.find(p => p.id === selectedId) ?? null : null;

  const triggerPulse = useCallback((ids: string[]) => {
    setPulseIds(new Set(ids));
    setTimeout(() => setPulseIds(new Set()), 900);
  }, []);

  // Simulate live network activity
  useEffect(() => {
    const activities = [
      { msg: "New RFQ offer: GammaLN → 0.05 BTC/USDT", peers: ["self", "p1"] },
      { msg: "Channel rebalanced: AlphaNode ↔ IotaSwap", peers: ["p2", "p9"] },
      { msg: "Swap settled: BetaSwap ↔ ZetaHub (0.02 ETH/SOL)", peers: ["p3", "p6"] },
      { msg: "Peer probe: DeltaNode latency 67ms", peers: ["p4"] },
      { msg: "New peer joined: ThetaRelay (AF-South)", peers: ["p8"] },
      { msg: "Heartbeat: 10/11 peers alive", peers: ["self"] },
      { msg: "HTLC escrow locked: GammaLN → 0.001 BTC", peers: ["p1", "self"] },
      { msg: "Quote accepted: IotaSwap → 0.003 BTC/USDT", peers: ["p9", "self"] },
    ];
    const interval = setInterval(() => {
      const activity = activities[Math.floor(Math.random() * activities.length)];
      setLastActivity(activity.msg);
      triggerPulse(activity.peers);

      // Occasionally toggle a channel active state
      if (Math.random() < 0.3) {
        setLiveChannels(prev => {
          const idx = Math.floor(Math.random() * prev.length);
          return prev.map((ch, i) => i === idx ? { ...ch, active: !ch.active } : ch);
        });
      }
      // Slightly vary latencies
      setLivePeers(prev => prev.map(p =>
        p.id === "self" ? p : { ...p, latency: Math.max(5, p.latency + Math.round((Math.random() - 0.5) * 6)) }
      ));
    }, 3500);
    return () => clearInterval(interval);
  }, [triggerPulse]);

  return (
    <div className="flex-1 overflow-y-auto p-3 sm:p-6" style={{ background: "transparent" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-foreground tracking-tight">P2P Network</h1>
          <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">
            IntercomSwap DHT · Live peer topology · Atomic swap channels
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 sm:hidden">
            {livePeers.filter(p => p.online).length}/{livePeers.length} peers online
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
            style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)" }}>
            <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
            <span className="text-[10px] font-mono text-emerald-400">DHT Live</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <Shield className="w-3 h-3 text-cyan-400" />
            <span className="text-[10px] font-mono text-cyan-400">Non-custodial</span>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 p-1 rounded-xl" style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
        {([
          { id: "topology", label: "Topology", icon: <Activity className="w-3.5 h-3.5" /> },
          { id: "channels", label: "LN Channels", icon: <GitBranch className="w-3.5 h-3.5" /> },
          { id: "invites", label: "Invites", icon: <Mail className="w-3.5 h-3.5" /> },
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

      {/* LN Channels Tab */}
      {activeTab === "channels" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{lnChannels.length} channels · {lnChannels.filter(c => c.status === "active").length} active</p>
            <button onClick={() => setOpenChannelForm(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{ background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.3)", color: "#06b6d4" }}>
              <Plus className="w-3.5 h-3.5" />
              Open Channel
            </button>
          </div>

          {/* Open channel form */}
          <AnimatePresence>
            {openChannelForm && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                className="rounded-2xl p-4 space-y-3" style={{ background: "var(--card)", border: "1px solid rgba(6,182,212,0.3)" }}>
                <p className="text-xs font-bold text-foreground">Open New LN Channel</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { label: "Peer alias", key: "peer", placeholder: "e.g. AlphaNode" },
                    { label: "Pubkey", key: "pubkey", placeholder: "02a3b4c5..." },
                    { label: "Amount (BTC)", key: "amount", placeholder: "0.05" },
                  ].map(field => (
                    <div key={field.key}>
                      <label className="text-[10px] text-muted-foreground mb-1 block">{field.label}</label>
                      <input
                        value={newChannel[field.key as keyof typeof newChannel]}
                        onChange={e => setNewChannel(prev => ({ ...prev, [field.key]: e.target.value }))}
                        placeholder={field.placeholder}
                        className="w-full px-3 py-2 rounded-lg text-xs text-foreground placeholder:text-muted-foreground/50 outline-none"
                        style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => {
                    if (!newChannel.peer || !newChannel.pubkey || !newChannel.amount) { toast.error("Fill all fields"); return; }
                    const ch: LNChannel = { id: `ch_${Date.now()}`, peer: newChannel.peer, pubkey: newChannel.pubkey, localBal: parseFloat(newChannel.amount), remoteBal: 0, capacity: parseFloat(newChannel.amount), status: "pending", feePpm: 100 };
                    setLnChannels(prev => [...prev, ch]);
                    setNewChannel({ peer: "", pubkey: "", amount: "" });
                    setOpenChannelForm(false);
                    toast.success("Channel opening initiated", { description: `Funding tx broadcast for ${newChannel.peer}` });
                  }}
                    className="flex-1 py-2 rounded-lg text-xs font-bold transition-all"
                    style={{ background: "rgba(6,182,212,0.15)", border: "1px solid rgba(6,182,212,0.35)", color: "#06b6d4" }}>
                    Broadcast Funding Tx
                  </button>
                  <button onClick={() => setOpenChannelForm(false)}
                    className="px-4 py-2 rounded-lg text-xs text-muted-foreground transition-all"
                    style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                    Cancel
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {lnChannels.map(ch => (
            <div key={ch.id} className="rounded-2xl p-4" style={{ background: "var(--card)", border: `1px solid ${ch.status === "active" ? "rgba(16,185,129,0.2)" : ch.status === "pending" ? "rgba(245,158,11,0.2)" : "var(--border)"}` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-bold text-foreground">{ch.peer}</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold font-mono"
                      style={{
                        background: ch.status === "active" ? "rgba(16,185,129,0.12)" : ch.status === "pending" ? "rgba(245,158,11,0.12)" : "rgba(100,116,139,0.12)",
                        border: `1px solid ${ch.status === "active" ? "rgba(16,185,129,0.3)" : ch.status === "pending" ? "rgba(245,158,11,0.3)" : "rgba(100,116,139,0.2)"}`,
                        color: ch.status === "active" ? "#10b981" : ch.status === "pending" ? "#f59e0b" : "#64748b",
                      }}>{ch.status}</span>
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground/60 mb-3 truncate">{ch.pubkey}</div>
                  <div className="mb-2">
                    <div className="flex justify-between text-[9px] text-muted-foreground mb-1">
                      <span>Local: {ch.localBal} BTC</span>
                      <span>Remote: {ch.remoteBal} BTC</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
                      <div className="h-full rounded-full bg-cyan-400 transition-all"
                        style={{ width: `${(ch.localBal / ch.capacity) * 100}%` }} />
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div><div className="text-[9px] text-muted-foreground/60">Capacity</div><div className="text-[10px] font-mono">{ch.capacity} BTC</div></div>
                    <div><div className="text-[9px] text-muted-foreground/60">Fee rate</div><div className="text-[10px] font-mono">{ch.feePpm} ppm</div></div>
                  </div>
                </div>
                <button onClick={() => {
                  setLnChannels(prev => prev.filter(c => c.id !== ch.id));
                  toast.info("Channel close initiated", { description: `Cooperative close with ${ch.peer}` });
                }}
                  className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-mono text-muted-foreground transition-all"
                  style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                  <Minus className="w-3 h-3" />
                  Close
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Invites Tab */}
      {activeTab === "invites" && (
        <div className="space-y-4">
          <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid rgba(139,92,246,0.3)" }}>
            <p className="text-xs font-bold text-foreground mb-3">Create Private Channel Invite</p>
            <div className="flex gap-2">
              <input
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value)}
                placeholder="Peer alias (e.g. BetaSwap)"
                className="flex-1 px-3 py-2 rounded-lg text-xs text-foreground placeholder:text-muted-foreground/50 outline-none"
                style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
              />
              <button onClick={() => {
                if (!inviteCode.trim()) { toast.error("Enter a peer alias"); return; }
                const code = `AFOS-${Math.random().toString(36).slice(2,6).toUpperCase()}-SWAP`;
                setInvites(prev => [...prev, { code, peer: inviteCode, created: new Date(), used: false }]);
                setInviteCode("");
                toast.success("Invite created", { description: code });
              }}
                className="px-4 py-2 rounded-lg text-xs font-bold transition-all"
                style={{ background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.35)", color: "#8b5cf6" }}>
                Generate
              </button>
            </div>
          </div>

          {invites.map(inv => (
            <div key={inv.code} className="rounded-2xl p-4 flex items-center justify-between gap-3"
              style={{ background: "var(--card)", border: `1px solid ${inv.used ? "var(--border)" : "rgba(139,92,246,0.25)"}` }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono font-bold text-foreground">{inv.code}</span>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold"
                    style={{
                      background: inv.used ? "rgba(100,116,139,0.12)" : "rgba(139,92,246,0.12)",
                      border: `1px solid ${inv.used ? "rgba(100,116,139,0.2)" : "rgba(139,92,246,0.3)"}`,
                      color: inv.used ? "#64748b" : "#8b5cf6",
                    }}>{inv.used ? "used" : "active"}</span>
                </div>
                <div className="text-[10px] text-muted-foreground">For: {inv.peer} · Created {Math.round((Date.now() - inv.created.getTime()) / 3600000)}h ago</div>
              </div>
              {!inv.used && (
                <button onClick={() => { navigator.clipboard?.writeText(inv.code); toast.success("Invite code copied"); }}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono transition-all"
                  style={{ background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.3)", color: "#8b5cf6" }}>
                  <Link2 className="w-3 h-3" />
                  Copy
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Stats */}
      {activeTab === "topology" && <NetworkStats peers={livePeers} channels={liveChannels} />}

      {/* Topology content — only shown when topology tab is active */}
      {activeTab === "topology" && (
      <>
      {/* Mobile peer list — shown only on small screens instead of the SVG graph */}
      <div className="sm:hidden space-y-2 mb-4">
        {livePeers.filter(p => p.id !== "self").map(peer => {
          const color = latencyColor(peer.latency);
          const isSelected = selectedId === peer.id;
          return (
            <motion.div
              key={peer.id}
              onClick={() => setSelectedId(prev => prev === peer.id ? null : peer.id)}
              className="rounded-xl p-3 cursor-pointer transition-all"
              animate={{ scale: isSelected ? 0.99 : 1 }}
              style={{
                background: isSelected
                  ? "var(--accent)"
                  : "var(--card)",
                border: `1px solid ${isSelected ? "rgba(6,182,212,0.4)" : "var(--border)"}`,
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: peer.online ? color : "#ef4444" }} />
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-foreground truncate">{peer.alias}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">{peer.region}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-2">
                  <div className="text-right">
                    <div className="text-xs font-mono font-semibold" style={{ color }}>
                      {peer.online ? `${peer.latency}ms` : "offline"}
                    </div>
                    <div className="text-[9px] text-muted-foreground">{peer.channels}ch</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-mono text-amber-400">{peer.liquidity} BTC</div>
                    <div className="text-[9px] text-muted-foreground">${(peer.volume24h/1000).toFixed(0)}k vol</div>
                  </div>
                </div>
              </div>
              {/* Expanded detail on select */}
              <AnimatePresence>
                {isSelected && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 pt-3 border-t border-border space-y-1.5">
                      <div className="flex justify-between">
                        <span className="text-[10px] text-muted-foreground">Reputation</span>
                        <span className="text-[10px] font-mono" style={{ color: peer.reputation > 98 ? "#10b981" : peer.reputation > 95 ? "#f59e0b" : "#ef4444" }}>{peer.reputation}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[10px] text-muted-foreground">Version</span>
                        <span className="text-[10px] font-mono text-foreground/80">{peer.version}</span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {peer.pairs.map(pair => (
                          <span key={pair} className="px-1.5 py-0.5 rounded text-[9px] font-mono"
                            style={{ background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)", color: "rgba(6,182,212,0.8)" }}>
                            {pair}
                          </span>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {/* Desktop/tablet main layout — hidden on mobile */}
      <div className="hidden sm:grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-4">

        {/* Node Graph */}
        <div className="rounded-2xl overflow-hidden relative"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            backdropFilter: "blur(20px)",
            height: "480px",
          }}>

          {/* Graph canvas */}
          <NodeGraph
            peers={livePeers}
            channels={liveChannels}
            selectedId={selectedId}
            onSelect={id => setSelectedId(prev => prev === id ? null : id)}
            pulseIds={pulseIds}
          />

          {/* Peer detail overlay */}
          <AnimatePresence>
            {selectedPeer && (
              <PeerDetail peer={selectedPeer} onClose={() => setSelectedId(null)} />
            )}
          </AnimatePresence>

          {/* Bottom activity ticker */}
          <div className="absolute bottom-0 left-0 right-0 px-4 py-2.5 border-t flex items-center gap-2"
            style={{ background: "var(--background)", borderColor: "var(--border)" }}>
            <Activity className="w-3 h-3 text-cyan-400 shrink-0 animate-pulse" />
            <motion.span
              key={lastActivity}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-[10px] font-mono text-cyan-300/70 truncate"
            >
              {lastActivity}
            </motion.span>
          </div>

          {/* Legend */}
          <div className="absolute top-3 left-3 flex flex-col gap-1.5 pointer-events-none">
            {[
              { color: "#10b981", label: "< 20ms" },
              { color: "#f59e0b", label: "20–50ms" },
              { color: "#f97316", label: "50–100ms" },
              { color: "#ef4444", label: "> 100ms" },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: item.color }} />
                <span className="text-[9px] font-mono text-foreground/35">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Peer List */}
        <div className="space-y-4">
          <PeerList peers={livePeers} selectedId={selectedId} onSelect={id => setSelectedId(prev => prev === id ? null : id)} />

          {/* Channel activity */}
          <div className="rounded-2xl p-4"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-bold text-foreground">Active Channels</span>
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-auto" />
            </div>
            <div className="space-y-2">
              {liveChannels.filter(c => c.active).slice(0, 6).map((ch, i) => {
                const from = livePeers.find(p => p.id === ch.from);
                const to = livePeers.find(p => p.id === ch.to);
                if (!from || !to) return null;
                return (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                      <span className="text-[10px] font-mono text-foreground/80 truncate">
                        {from.alias.split(" ")[0]} ↔ {to.alias.split(" ")[0]}
                      </span>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <div className="text-[10px] font-mono text-amber-400">{ch.volume} BTC</div>
                      <div className="text-[9px] text-slate-600">{ch.pair}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Rendezvous info */}
          <div className="rounded-2xl p-4"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center gap-2 mb-3">
              <Globe className="w-3.5 h-3.5 text-violet-400" />
              <span className="text-xs font-bold text-foreground">Rendezvous</span>
            </div>
            <div className="space-y-1.5">
              {[
                { label: "Channel", value: "0000intercomswapbtcusdt" },
                { label: "Protocol", value: "IntercomSwap DHT" },
                { label: "Escrow", value: "Solana Mainnet" },
                { label: "Settlement", value: "Lightning + HTLC" },
              ].map(item => (
                <div key={item.label} className="flex justify-between">
                  <span className="text-[10px] text-muted-foreground">{item.label}</span>
                  <span className="text-[10px] font-mono text-foreground/80">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* end hidden sm:grid */}
      </>
      )}
    </div>
  );
}
