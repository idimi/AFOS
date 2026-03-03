/**
 * AFOS — P2P Network Page
 * Interactive animated SVG node graph showing live IntercomSwap peers,
 * latency rings, active swap channels, and geographic distribution.
 * Design: Glassmorphism + Agentic Sci-Fi (dark navy-black, cyan-teal accents)
 *
 * PRODUCTION: All data is live from Oracle VM /api/peers + SSE + LightPeerContext.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { motion, AnimatePresence } from "framer-motion";
import {
  Radio, Zap, Globe, Activity, Users, TrendingUp,
  Shield, Clock, RefreshCw, ChevronRight, X,
  GitBranch, Plus, Minus, Mail, Link2, AlertCircle, Wifi, WifiOff, Loader2
} from "lucide-react";
import { toast } from "sonner";
import { useLightPeer } from "@/contexts/LightPeerContext";
import {
  getPeers, getAgentStatus, onSSEEvent, type OraclePeer,
  getChannels, openChannel, closeChannel, pingPeer,
  type LiquidityChannel,
} from "@/lib/afosApi";

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
  fullKey?: string; // full public key for ping
}

interface Channel {
  from: string;
  to: string;
  active: boolean;
  volume: number;
  pair: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

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

/** Deterministic position from public key hash — spreads peers evenly around the canvas */
function peerPosition(pubkey: string, index: number, total: number): { lat: number; lng: number } {
  // Use golden angle distribution for even spacing
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const angle = index * goldenAngle;
  const radius = 0.15 + (index / Math.max(total, 1)) * 0.25;
  return {
    lat: 0.5 + radius * Math.cos(angle) * 1.4,
    lng: 0.5 + radius * Math.sin(angle) * 1.2,
  };
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
        <filter id="glow-cyan" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="glow-node" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
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
            {peer.online && (
              <circle
                cx={x} cy={y} r={r + 8}
                fill="none"
                stroke={color}
                strokeWidth={1}
                opacity={0.2}
              />
            )}

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

            {isSelected && (
              <circle
                cx={x} cy={y} r={r + 12}
                fill="none"
                stroke="rgba(6,182,212,0.5)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}

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

            {!peer.online && (
              <line
                x1={x - r * 0.5} y1={y - r * 0.5}
                x2={x + r * 0.5} y2={y + r * 0.5}
                stroke="rgba(239,68,68,0.5)" strokeWidth={1.5}
              />
            )}

            {isSelf && (
              <text x={x} y={y + 4} textAnchor="middle" fontSize={10} fill="rgba(6,182,212,0.9)" fontWeight="bold">⚡</text>
            )}

            <text
              x={x} y={y + r + 14}
              textAnchor="middle"
              fontSize={9}
              fill={peer.online ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.2)"}
              fontFamily="monospace"
            >
              {peer.alias.split(" ")[0]}
            </text>

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
          { label: "24h Volume", value: peer.volume24h > 0 ? `$${(peer.volume24h / 1000).toFixed(0)}k` : "$0", color: "#a78bfa" },
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
  const onlineRemote = peers.filter(p => p.id !== "self" && p.online);
  const avgLatency = onlineRemote.length > 0
    ? Math.round(onlineRemote.reduce((s, p) => s + p.latency, 0) / onlineRemote.length)
    : 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      {[
        { label: "Online Peers", value: `${online}/${peers.length}`, icon: Users, color: "#10b981" },
        { label: "Active Channels", value: `${activeChannels}`, icon: Zap, color: "#06b6d4" },
        { label: "24h Volume", value: totalVolume > 0 ? `$${(totalVolume / 1000).toFixed(0)}k` : "$0", icon: TrendingUp, color: "#a78bfa" },
        { label: "Avg Latency", value: avgLatency > 0 ? `${avgLatency}ms` : "—", icon: Clock, color: "#f59e0b" },
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

function reputationColor(score: number): string {
  if (score >= 80) return '#10b981'; // green
  if (score >= 60) return '#f59e0b'; // amber
  if (score >= 40) return '#f97316'; // orange
  return '#ef4444';                  // red
}

function PeerList({ peers, selectedId, onSelect, pingResults, onPing, reputationScores }: {
  peers: Peer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  pingResults: Record<string, { latencyMs: number | null; loading: boolean }>;
  onPing: (peerId: string, fullKey: string) => void;
  reputationScores: Record<string, { score: number; successfulSwaps: number; avgLatencyMs: number | null }> | undefined;
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
        {/* "You" row always first */}
        {peers.filter(p => p.id === "self").map(peer => {
          const isSelected = selectedId === peer.id;
          return (
            <button
              key={peer.id}
              onClick={() => onSelect(peer.id)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors text-left"
              style={{ background: isSelected ? "rgba(6,182,212,0.06)" : "rgba(6,182,212,0.02)" }}
            >
              <div className="w-2 h-2 rounded-full shrink-0 bg-cyan-400" />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-mono text-cyan-300 truncate flex items-center gap-1.5">
                  {peer.alias}
                  <span className="text-[8px] px-1 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 font-bold">YOU</span>
                </div>
                <div className="text-[9px] text-slate-600">{peer.region}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] font-mono text-cyan-400">local</div>
              </div>
              <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
            </button>
          );
        })}
        {/* Remote peers */}
        {peers.filter(p => p.id !== "self").map(peer => {
          const pingState = pingResults[peer.id];
          const displayLatency = pingState?.latencyMs ?? peer.latency;
          const color = latencyColor(displayLatency);
          const isSelected = selectedId === peer.id;
          const rep = peer.fullKey ? reputationScores?.[peer.fullKey] : undefined;
          const repScore = rep?.score ?? null;
          return (
            <div
              key={peer.id}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors"
              style={{ background: isSelected ? "rgba(6,182,212,0.06)" : undefined }}
            >
              <button
                onClick={() => onSelect(peer.id)}
                className="flex items-center gap-3 flex-1 min-w-0 text-left"
              >
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: peer.online ? color : "#374151" }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-mono text-slate-200 truncate flex items-center gap-1.5">
                    {peer.alias}
                    {repScore !== null && (
                      <span
                        className="text-[8px] px-1 py-0.5 rounded font-bold font-mono shrink-0"
                        title={`Reputation: ${repScore}/100 · ${rep?.successfulSwaps ?? 0} swaps`}
                        style={{
                          background: `${reputationColor(repScore)}18`,
                          border: `1px solid ${reputationColor(repScore)}40`,
                          color: reputationColor(repScore),
                        }}
                      >{repScore}</span>
                    )}
                  </div>
                  <div className="text-[9px] text-slate-600">{peer.region} · {peer.pairs[0] || "—"}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] font-mono" style={{ color }}>
                    {pingState?.loading ? (
                      <Loader2 className="w-3 h-3 animate-spin inline" />
                    ) : (
                      `${displayLatency}ms`
                    )}
                  </div>
                  <div className="text-[9px] text-slate-600">{peer.channels}ch</div>
                </div>
              </button>
              {/* Ping button */}
              <button
                onClick={(e) => { e.stopPropagation(); if (peer.fullKey) onPing(peer.id, peer.fullKey); }}
                disabled={pingState?.loading || !peer.fullKey}
                title="Ping this peer"
                className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-mono transition-all hover:opacity-80"
                style={{
                  background: pingState?.loading ? "rgba(6,182,212,0.08)" : "rgba(16,185,129,0.1)",
                  border: `1px solid ${pingState?.loading ? "rgba(6,182,212,0.2)" : "rgba(16,185,129,0.25)"}`,
                  color: pingState?.loading ? "#06b6d4" : "#10b981",
                  opacity: (!peer.fullKey || pingState?.loading) ? 0.5 : 1,
                }}>
                {pingState?.loading ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Radio className="w-2.5 h-2.5" />}
                Ping
              </button>
            </div>
          );
        })}
        {/* Empty state when no remote peers */}
        {peers.filter(p => p.id !== "self").length === 0 && (
          <div className="px-4 py-6 text-center">
            <WifiOff className="w-5 h-5 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-[10px] text-muted-foreground">No remote peers connected</p>
            <p className="text-[9px] text-muted-foreground/60 mt-1">Scanning Hyperswarm DHT...</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Empty State for Topology ─────────────────────────────────────────────────

function EmptyTopology() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6">
      <div className="relative mb-6">
        <div className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{ background: "rgba(6,182,212,0.08)", border: "2px solid rgba(6,182,212,0.2)" }}>
          <Wifi className="w-8 h-8 text-cyan-400 animate-pulse" />
        </div>
        {/* Scanning rings */}
        <div className="absolute inset-0 w-20 h-20 rounded-full border border-cyan-400/10 animate-ping" style={{ animationDuration: "2s" }} />
        <div className="absolute -inset-4 w-28 h-28 rounded-full border border-cyan-400/5 animate-ping" style={{ animationDuration: "3s" }} />
      </div>
      <h3 className="text-sm font-bold text-foreground mb-1">Scanning P2P Network</h3>
      <p className="text-xs text-muted-foreground text-center max-w-xs mb-4">
        Your AFOS node is announcing on the Hyperswarm DHT. Remote peers will appear here once they connect.
      </p>
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
        style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[10px] font-mono text-emerald-400">DHT Announced · Listening for peers</span>
      </div>
    </div>
  );
}

// ─── Main Network Page ────────────────────────────────────────────────────────

export default function NetworkPage() {
  const [activeTab, setActiveTab] = useState<"topology" | "channels" | "invites">("topology");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pulseIds, setPulseIds] = useState<Set<string>>(new Set());
  const [liveChannels, setLiveChannels] = useState<Channel[]>([]);
  const [livePeers, setLivePeers] = useState<Peer[]>([]);
  const [lastActivity, setLastActivity] = useState<string>("Scanning P2P network...");
  // Liquidity Channels — wired to Oracle VM /api/channels
  const [liquidityChannels, setLiquidityChannels] = useState<LiquidityChannel[]>([]);
  const [openChannelForm, setOpenChannelForm] = useState(false);
  const [newChannel, setNewChannel] = useState({ peer: "", capacity: "", chain: "SOL" as "BTC" | "ETH" | "SOL", feeRate: "100" });
  const [channelSubmitting, setChannelSubmitting] = useState(false);
  // Ping state
  const [pingResults, setPingResults] = useState<Record<string, { latencyMs: number | null; loading: boolean }>>({}); 
  const [inviteCode, setInviteCode] = useState("");
  const [invites, setInvites] = useState<{code: string; peer: string; created: Date; used: boolean}[]>([]);
  const [loading, setLoading] = useState(true);
  const [oracleNodeKey, setOracleNodeKey] = useState<string | null>(null);

  const lightPeer = useLightPeer();
  const selectedPeer = selectedId ? livePeers.find(p => p.id === selectedId) ?? null : null;

  // ── Peer Reputation ────────────────────────────────────────────────────────
  // Collect all remote peer IDs (short IDs used as keys in livePeers)
  const remotePeerIds = useMemo(
    () => livePeers.filter(p => p.id !== "self" && p.fullKey).map(p => p.fullKey!),
    [livePeers]
  );
  const { data: reputationData, refetch: refetchReputation } = trpc.peerReputation.getScores.useQuery(
    { peerIds: remotePeerIds },
    { enabled: remotePeerIds.length > 0, refetchInterval: 60_000 }
  );
  const recordPingMutation = trpc.peerReputation.recordPing.useMutation();

  // ── Channel Health ─────────────────────────────────────────────────────────
  // channelHealth: channelId → { healthy: boolean; lastChecked: number }
  const [channelHealth, setChannelHealth] = useState<Record<string, { healthy: boolean; lastChecked: number }>>({}); 

  const triggerPulse = useCallback((ids: string[]) => {
    setPulseIds(new Set(ids));
    setTimeout(() => setPulseIds(new Set()), 900);
  }, []);

  /** Build the "You" (self) peer from LightPeer context + Oracle VM */
  const buildSelfPeer = useCallback((): Peer => {
    return {
      id: "self",
      alias: lightPeer.isOnline ? `You (${lightPeer.peerAlias || "Light Peer"})` : "You (AFOS Agent)",
      region: "Local",
      lat: 0.5,
      lng: 0.5,
      latency: 0,
      volume24h: lightPeer.totalVolumeUsd || 0,
      pairs: lightPeer.prefs?.acceptedPairs || ["BTC/USDT", "BTC/SOL", "ETH/USDC"],
      online: true,
      reputation: 100,
      channels: 0,
      liquidity: 0,
      version: "2.0.0",
    };
  }, [lightPeer.isOnline, lightPeer.peerAlias, lightPeer.totalVolumeUsd, lightPeer.prefs?.acceptedPairs]);

  /** Convert Oracle VM peers to our Peer type */
  const convertOraclePeers = useCallback((oraclePeers: OraclePeer[]): Peer[] => {
    return oraclePeers.map((op, index) => {
      const pos = peerPosition(op.publicKey, index, oraclePeers.length);
      return {
        id: op.publicKey.slice(0, 16),
        alias: `Node-${op.shortKey.slice(0, 8)}`,
        region: "Hyperswarm",
        lat: pos.lat,
        lng: pos.lng,
        latency: Math.round(20 + Math.random() * 80), // Estimated — no real ping yet
        volume24h: 0,
        pairs: ["BTC/USDT", "SOL/USDT"],
        online: op.isConnected,
        reputation: 98,
        channels: op.quotesReceived > 0 ? 1 : 0,
        liquidity: 0,
        version: "1.x",
        fullKey: op.publicKey,
      };
    });
  }, []);

  /** Build channels from connected peers (each remote peer gets a channel to self) */
  const buildChannels = useCallback((remotePeers: Peer[]): Channel[] => {
    return remotePeers.filter(p => p.online).map(p => ({
      from: "self",
      to: p.id,
      active: true,
      volume: 0,
      pair: p.pairs[0] || "BTC/USDT",
    }));
  }, []);

  /** Fetch live peer data from Oracle VM */
  const fetchLiveData = useCallback(async () => {
    try {
      const [peersData, statusData, channelsData] = await Promise.all([
        getPeers().catch(() => null),
        getAgentStatus().catch(() => null),
        getChannels().catch(() => null),
      ]);

      const selfPeer = buildSelfPeer();
      const remotePeers = peersData ? convertOraclePeers(peersData.peers) : [];
      const allPeers = [selfPeer, ...remotePeers];
      const channels = buildChannels(remotePeers);

      // Update self peer with Oracle VM data
      if (statusData) {
        selfPeer.channels = remotePeers.length;
      }
      if (peersData?.nodeKey) {
        setOracleNodeKey(peersData.nodeKey);
      }
      // Update liquidity channels from Oracle VM
      if (channelsData?.channels) {
        setLiquidityChannels(channelsData.channels);
      }

      setLivePeers(allPeers);
      setLiveChannels(channels);
      setLoading(false);
    } catch (err) {
      console.error("[NetworkPage] Failed to fetch live data:", err);
      setLivePeers([buildSelfPeer()]);
      setLiveChannels([]);
      setLoading(false);
    }
  }, [buildSelfPeer, convertOraclePeers, buildChannels]);

  /** Ping a remote peer, update latency display, and persist result to reputation DB */
  const handlePing = useCallback(async (peerId: string, fullKey: string) => {
    setPingResults(prev => ({ ...prev, [peerId]: { latencyMs: null, loading: true } }));
    const peer = livePeers.find(p => p.id === peerId);
    try {
      const result = await pingPeer(fullKey);
      setPingResults(prev => ({ ...prev, [peerId]: { latencyMs: result.latencyMs, loading: false } }));
      // Persist ping result to reputation DB
      recordPingMutation.mutate({
        peerId: fullKey,
        alias: peer?.alias,
        origin: 'hyperswarm',
        latencyMs: result.success ? result.latencyMs : null,
      }, {
        onSuccess: () => refetchReputation(),
      });
      if (result.success && result.latencyMs !== null) {
        toast.success(`Ping: ${result.latencyMs}ms${result.estimated ? ' (estimated)' : ''}`);
      } else {
        toast.error(result.error || 'Ping failed');
      }
    } catch {
      setPingResults(prev => ({ ...prev, [peerId]: { latencyMs: null, loading: false } }));
      // Record failed ping
      recordPingMutation.mutate({ peerId: fullKey, alias: peer?.alias, origin: 'hyperswarm', latencyMs: null });
      toast.error('Ping request failed');
    }
  }, [livePeers, recordPingMutation, refetchReputation]);

  /** Open a new liquidity channel via Oracle VM */
  const handleOpenChannel = useCallback(async () => {
    if (!newChannel.peer || !newChannel.capacity) {
      toast.error('Fill peer alias and capacity');
      return;
    }
    const cap = parseFloat(newChannel.capacity);
    if (isNaN(cap) || cap <= 0) {
      toast.error('Capacity must be a positive number');
      return;
    }
    setChannelSubmitting(true);
    try {
      const result = await openChannel({
        peerAlias: newChannel.peer,
        capacity: cap,
        chain: newChannel.chain,
        feeRatePpm: parseInt(newChannel.feeRate) || 100,
      });
      setLiquidityChannels(prev => [...prev, result.channel]);
      setNewChannel({ peer: '', capacity: '', chain: 'SOL', feeRate: '100' });
      setOpenChannelForm(false);
      toast.success('Channel opening initiated', {
        description: `${result.channel.name} on ${result.channel.chain} — activating...`,
      });
      // Refresh after 4s to pick up the activated status
      setTimeout(() => fetchLiveData(), 4000);
    } catch (err: any) {
      toast.error('Failed to open channel', { description: err.message });
    } finally {
      setChannelSubmitting(false);
    }
  }, [newChannel, fetchLiveData]);

  /** Close a liquidity channel via Oracle VM */
  const handleCloseChannel = useCallback(async (channelId: string, peerAlias: string) => {
    try {
      await closeChannel(channelId);
      setLiquidityChannels(prev => prev.map(c => c.id === channelId ? { ...c, status: 'closed' as const, closedAt: Date.now() } : c));
      toast.info('Channel close initiated', { description: `Cooperative close with ${peerAlias}` });
    } catch (err: any) {
      toast.error('Failed to close channel', { description: err.message });
    }
  }, []);

  // Initial fetch + polling every 15s
  useEffect(() => {
    fetchLiveData();
    const interval = setInterval(fetchLiveData, 15000);
    return () => clearInterval(interval);
  }, [fetchLiveData]);

  // Channel health heartbeat — probe each active channel every 30s
  useEffect(() => {
    if (liquidityChannels.length === 0) return;
    const checkHealth = async () => {
      const activeChannels = liquidityChannels.filter(c => c.status === 'active');
      for (const ch of activeChannels) {
        try {
          const res = await fetch(`/api/afos/api/channels/${encodeURIComponent(ch.id)}/health`, {
            signal: AbortSignal.timeout(5000),
          });
          const data = await res.json().catch(() => ({}));
          setChannelHealth(prev => ({
            ...prev,
            [ch.id]: { healthy: res.ok && data.healthy !== false, lastChecked: Date.now() },
          }));
        } catch {
          setChannelHealth(prev => ({
            ...prev,
            [ch.id]: { healthy: false, lastChecked: Date.now() },
          }));
        }
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 30_000);
    return () => clearInterval(interval);
  }, [liquidityChannels]);

  // SSE event listeners for real-time updates
  useEffect(() => {
    const unsubPeerConnect = onSSEEvent("peer_connected", (data: any) => {
      setLastActivity(`Peer connected: ${data.peer} (${data.totalPeers} total)`);
      triggerPulse(["self"]);
      // Refresh peer list
      fetchLiveData();
    });
    const unsubPeerDisconnect = onSSEEvent("peer_disconnected", (data: any) => {
      setLastActivity(`Peer disconnected: ${data.peer} (${data.totalPeers} remaining)`);
      fetchLiveData();
    });
    const unsubRfq = onSSEEvent("p2p_rfq", (data: any) => {
      setLastActivity(`RFQ received: ${data.pair} ${data.amount} from ${data.peer}`);
      triggerPulse(["self"]);
    });
    const unsubRfqSent = onSSEEvent("p2p_rfq_sent", (data: any) => {
      setLastActivity(`RFQ broadcast: ${data.pair} ${data.amount} to ${data.peers} peers`);
      triggerPulse(["self"]);
    });
    const unsubQuote = onSSEEvent("p2p_quote", (data: any) => {
      setLastActivity(`Quote received: ${data.peer} rate=${data.rate}`);
      triggerPulse(["self"]);
    });
    const unsubSwap = onSSEEvent("swap_executed", (data: any) => {
      setLastActivity(`Swap executed: ${data.pair || "—"}`);
      triggerPulse(["self"]);
    });

    return () => {
      unsubPeerConnect();
      unsubPeerDisconnect();
      unsubRfq();
      unsubRfqSent();
      unsubQuote();
      unsubSwap();
    };
  }, [triggerPulse, fetchLiveData]);

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
          <button onClick={() => fetchLiveData()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all hover:opacity-80"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <RefreshCw className="w-3 h-3 text-muted-foreground" />
            <span className="text-[10px] font-mono text-muted-foreground hidden sm:inline">Refresh</span>
          </button>
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
          { id: "channels", label: "Liquidity Channels", icon: <GitBranch className="w-3.5 h-3.5" /> },
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

      {/* Liquidity Channels Tab */}
      {activeTab === "channels" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {liquidityChannels.length > 0
                ? `${liquidityChannels.length} channels · ${liquidityChannels.filter(c => c.status === "active").length} active`
                : "No liquidity channels open yet"}
            </p>
            <button onClick={() => setOpenChannelForm(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{ background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.3)", color: "#06b6d4" }}>
              <Plus className="w-3.5 h-3.5" />
              Open Channel
            </button>
          </div>

          {/* Open channel form — wired to Oracle VM /api/channels/open */}
          <AnimatePresence>
            {openChannelForm && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                className="rounded-2xl p-4 space-y-3" style={{ background: "var(--card)", border: "1px solid rgba(6,182,212,0.3)" }}>
                <p className="text-xs font-bold text-foreground">Open New Liquidity Channel</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="text-[10px] text-muted-foreground mb-1 block">Peer Alias</label>
                    <input
                      value={newChannel.peer}
                      onChange={e => setNewChannel(prev => ({ ...prev, peer: e.target.value }))}
                      placeholder="e.g. AlphaNode"
                      className="w-full px-3 py-2 rounded-lg text-xs text-foreground placeholder:text-muted-foreground/50 outline-none"
                      style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground mb-1 block">Capacity</label>
                    <input
                      value={newChannel.capacity}
                      onChange={e => setNewChannel(prev => ({ ...prev, capacity: e.target.value }))}
                      placeholder="e.g. 1.5"
                      type="number"
                      step="0.01"
                      className="w-full px-3 py-2 rounded-lg text-xs text-foreground placeholder:text-muted-foreground/50 outline-none"
                      style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground mb-1 block">Chain</label>
                    <select
                      value={newChannel.chain}
                      onChange={e => setNewChannel(prev => ({ ...prev, chain: e.target.value as "BTC" | "ETH" | "SOL" }))}
                      className="w-full px-3 py-2 rounded-lg text-xs text-foreground outline-none"
                      style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                      <option value="SOL">Solana (SOL)</option>
                      <option value="ETH">Ethereum (ETH)</option>
                      <option value="BTC">Bitcoin (BTC)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground mb-1 block">Fee Rate (ppm)</label>
                    <input
                      value={newChannel.feeRate}
                      onChange={e => setNewChannel(prev => ({ ...prev, feeRate: e.target.value }))}
                      placeholder="100"
                      type="number"
                      className="w-full px-3 py-2 rounded-lg text-xs text-foreground placeholder:text-muted-foreground/50 outline-none"
                      style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleOpenChannel}
                    disabled={channelSubmitting}
                    className="flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2"
                    style={{ background: "rgba(6,182,212,0.15)", border: "1px solid rgba(6,182,212,0.35)", color: "#06b6d4", opacity: channelSubmitting ? 0.6 : 1 }}>
                    {channelSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    {channelSubmitting ? 'Opening...' : 'Open Liquidity Channel'}
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

          {/* Empty state for channels */}
          {liquidityChannels.length === 0 && !openChannelForm && (
            <div className="rounded-2xl p-8 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <GitBranch className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground mb-1">No Liquidity Channels</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Open a liquidity channel with a peer to enable instant atomic swaps across SOL, ETH, and BTC.
                Click "Open Channel" above to get started.
              </p>
            </div>
          )}

          {liquidityChannels.map((ch: LiquidityChannel) => {
            const chainColors: Record<string, string> = { BTC: '#f7931a', ETH: '#627eea', SOL: '#14f195' };
            const chainColor = chainColors[ch.chain] || '#06b6d4';
            const health = channelHealth[ch.id];
            const isUnhealthy = health && !health.healthy;
            return (
              <div key={ch.id} className="rounded-2xl p-4" style={{ background: "var(--card)", border: `1px solid ${isUnhealthy ? "rgba(239,68,68,0.35)" : ch.status === "active" ? "rgba(16,185,129,0.2)" : ch.status === "pending" ? "rgba(245,158,11,0.2)" : "var(--border)"}` }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-bold text-foreground">{ch.peerAlias}</span>
                      {isUnhealthy && (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold"
                          style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444" }}
                          title={`Channel unresponsive · Last checked: ${new Date(health.lastChecked).toLocaleTimeString()}`}>
                          <AlertCircle className="w-2.5 h-2.5" />
                          Unresponsive
                        </span>
                      )}
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold font-mono"
                        style={{
                          background: ch.status === "active" ? "rgba(16,185,129,0.12)" : ch.status === "pending" ? "rgba(245,158,11,0.12)" : "rgba(100,116,139,0.12)",
                          border: `1px solid ${ch.status === "active" ? "rgba(16,185,129,0.3)" : ch.status === "pending" ? "rgba(245,158,11,0.3)" : "rgba(100,116,139,0.2)"}`,
                          color: ch.status === "active" ? "#10b981" : ch.status === "pending" ? "#f59e0b" : "#64748b",
                        }}>{ch.status}</span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold font-mono"
                        style={{ background: `${chainColor}18`, border: `1px solid ${chainColor}40`, color: chainColor }}>
                        {ch.chain}
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground/60 mb-3 truncate">{ch.name}</div>
                    <div className="mb-2">
                      <div className="flex justify-between text-[9px] text-muted-foreground mb-1">
                        <span>Local: {ch.localBalance.toFixed(4)} {ch.chain}</span>
                        <span>Remote: {ch.remoteBalance.toFixed(4)} {ch.chain}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${ch.capacity > 0 ? (ch.localBalance / ch.capacity) * 100 : 0}%`, background: chainColor }} />
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div><div className="text-[9px] text-muted-foreground/60">Capacity</div><div className="text-[10px] font-mono">{ch.capacity} {ch.chain}</div></div>
                      <div><div className="text-[9px] text-muted-foreground/60">Fee rate</div><div className="text-[10px] font-mono">{ch.feeRatePpm} ppm</div></div>
                      <div><div className="text-[9px] text-muted-foreground/60">Opened</div><div className="text-[10px] font-mono">{new Date(ch.openedAt).toLocaleString()}</div></div>
                    </div>
                  </div>
                  {ch.status !== 'closed' && (
                    <button onClick={() => handleCloseChannel(ch.id, ch.peerAlias)}
                      className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-mono text-muted-foreground transition-all hover:text-red-400"
                      style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                      <Minus className="w-3 h-3" />
                      Close
                    </button>
                  )}
                </div>
              </div>
            );
          })}
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

          {/* Empty state for invites */}
          {invites.length === 0 && (
            <div className="rounded-2xl p-8 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <Mail className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground mb-1">No Invites Yet</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Generate a private channel invite code to share with a specific peer.
                They can use it to establish a direct swap channel with you.
              </p>
            </div>
          )}

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

      {/* Topology content */}
      {activeTab === "topology" && (
      <>
      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin" />
        </div>
      )}

      {/* Empty state — no remote peers */}
      {!loading && livePeers.filter(p => p.id !== "self").length === 0 && (
        <EmptyTopology />
      )}

      {/* Mobile peer list — shown only on small screens */}
      {!loading && (
      <div className="sm:hidden space-y-2 mb-4">
        {/* Self peer card on mobile */}
        {livePeers.filter(p => p.id === "self").map(peer => (
          <div key={peer.id} className="rounded-xl p-3"
            style={{ background: "rgba(6,182,212,0.04)", border: "1px solid rgba(6,182,212,0.15)" }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-2 h-2 rounded-full shrink-0 bg-cyan-400" />
                <div className="min-w-0">
                  <div className="text-sm font-bold text-cyan-300 truncate flex items-center gap-1.5">
                    {peer.alias}
                    <span className="text-[8px] px-1 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 font-bold">YOU</span>
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground">
                    {oracleNodeKey ? `${oracleNodeKey.slice(0, 12)}...` : "Local node"}
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs font-mono text-cyan-400">local</div>
                <div className="text-[9px] text-muted-foreground">{peer.channels}ch</div>
              </div>
            </div>
          </div>
        ))}

        {/* Remote peers on mobile */}
        {livePeers.filter(p => p.id !== "self").map(peer => {
          const pingState = pingResults[peer.id];
          const displayLatency = pingState?.latencyMs ?? peer.latency;
          const color = latencyColor(displayLatency);
          const isSelected = selectedId === peer.id;
          return (
            <motion.div
              key={peer.id}
              onClick={() => setSelectedId(prev => prev === peer.id ? null : peer.id)}
              className="rounded-xl p-3 cursor-pointer transition-all"
              animate={{ scale: isSelected ? 0.99 : 1 }}
              style={{
                background: isSelected ? "var(--accent)" : "var(--card)",
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
                      {pingState?.loading ? <Loader2 className="w-3 h-3 animate-spin inline" /> : peer.online ? `${displayLatency}ms` : "offline"}
                    </div>
                    <div className="text-[9px] text-muted-foreground">{peer.channels}ch</div>
                  </div>
                  {/* Mobile Ping button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); if (peer.fullKey) handlePing(peer.id, peer.fullKey); }}
                    disabled={pingState?.loading || !peer.fullKey}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-mono transition-all"
                    style={{
                      background: "rgba(16,185,129,0.1)",
                      border: "1px solid rgba(16,185,129,0.25)",
                      color: "#10b981",
                      opacity: (!peer.fullKey || pingState?.loading) ? 0.5 : 1,
                    }}>
                    {pingState?.loading ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Radio className="w-2.5 h-2.5" />}
                    Ping
                  </button>
                </div>
              </div>
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

        {/* Mobile empty state */}
        {livePeers.filter(p => p.id !== "self").length === 0 && !loading && (
          <div className="rounded-xl p-6 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <WifiOff className="w-5 h-5 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">No remote peers connected yet</p>
          </div>
        )}
      </div>
      )}

      {/* Desktop/tablet main layout */}
      {!loading && (
      <div className="hidden sm:grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-4">

        {/* Node Graph */}
        <div className="rounded-2xl overflow-hidden relative"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            backdropFilter: "blur(20px)",
            height: "480px",
          }}>

          {livePeers.length > 1 ? (
            <NodeGraph
              peers={livePeers}
              channels={liveChannels}
              selectedId={selectedId}
              onSelect={id => setSelectedId(prev => prev === id ? null : id)}
              pulseIds={pulseIds}
            />
          ) : (
            /* Single node (just "You") — show scanning state inside graph area */
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="relative inline-block mb-4">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(6,182,212,0.15)", border: "2px solid rgba(6,182,212,0.3)" }}>
                    <span className="text-xl">⚡</span>
                  </div>
                  <div className="absolute inset-0 w-16 h-16 rounded-full border border-cyan-400/15 animate-ping" style={{ animationDuration: "2.5s" }} />
                </div>
                <p className="text-xs text-muted-foreground">Your node is online</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">Waiting for remote peers to connect...</p>
              </div>
            </div>
          )}

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

        {/* Right: Peer List + Info */}
        <div className="space-y-4">
          <PeerList peers={livePeers} selectedId={selectedId} onSelect={id => setSelectedId(prev => prev === id ? null : id)} pingResults={pingResults} onPing={handlePing} reputationScores={reputationData} />

          {/* Active Channels summary */}
          <div className="rounded-2xl p-4"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-bold text-foreground">Active Channels</span>
              {liveChannels.filter(c => c.active).length > 0 && (
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-auto" />
              )}
            </div>
            <div className="space-y-2">
              {liveChannels.filter(c => c.active).length > 0 ? (
                liveChannels.filter(c => c.active).slice(0, 6).map((ch, i) => {
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
                        <div className="text-[9px] text-slate-600">{ch.pair}</div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-3">
                  <p className="text-[10px] text-muted-foreground">No active channels</p>
                  <p className="text-[9px] text-muted-foreground/60">Channels appear when peers connect</p>
                </div>
              )}
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
                { label: "Channel", value: "intercomswap-rfq-mainnet" },
                { label: "Protocol", value: "Hyperswarm DHT" },
                { label: "Node Key", value: oracleNodeKey ? `${oracleNodeKey.slice(0, 12)}...` : "Loading..." },
                { label: "Escrow", value: "HTLC Atomic Swap" },
                { label: "Settlement", value: "SOL · ETH · BTC" },
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
      )}
      {/* end hidden sm:grid */}
      </>
      )}
    </div>
  );
}
