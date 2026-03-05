/**
 * AFOS — P2P Network Page
 * Interactive animated SVG node graph showing live IntercomSwap peers,
 * latency rings, active swap channels, and geographic distribution.
 * Design: Glassmorphism + Agentic Sci-Fi (dark navy-black, cyan-teal accents)
 *
 * PRODUCTION: All data is live from Oracle VM /api/peers + SSE + LightPeerContext.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTheme } from "next-themes";
import { trpc } from "@/lib/trpc";
import { motion, AnimatePresence } from "framer-motion";
import {
  Radio, Zap, Globe, Activity, Users, TrendingUp,
  Shield, Clock, RefreshCw, ChevronRight, X,
  GitBranch, Plus, Minus, Mail, Link2, AlertCircle, Wifi, WifiOff, Loader2,
  ArrowUpDown, SlidersHorizontal, Star, Check, MessageSquare, Volume2, VolumeX, Trophy
} from "lucide-react";
import { toast } from "sonner";
import { useLightPeer } from "@/contexts/LightPeerContext";
import {
  getPeers, getAgentStatus, onSSEEvent, type OraclePeer,
  getChannels, openChannel, closeChannel, pingPeer, pingSignalingPeer,
  getRelayPeers,
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
  origin?: 'hyperswarm' | 'intercomswap'; // which DHT layer this peer came from
  lastSeen?: number; // Unix ms timestamp — only set for relay light peers
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

/** Format a Unix ms timestamp as a human-readable "last seen" string */
function formatLastSeen(lastSeen: number): string {
  const diffMs = Date.now() - lastSeen;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.floor(diffMin / 60)}h ago`;
}

/** Animated "last seen" badge for Light Peers — updates every 5 seconds */
function LastSeenBadge({ lastSeen }: { lastSeen: number }) {
  const [label, setLabel] = useState(() => formatLastSeen(lastSeen));
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme
    ? resolvedTheme === 'dark'
    : typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  useEffect(() => {
    setLabel(formatLastSeen(lastSeen));
    const id = setInterval(() => setLabel(formatLastSeen(lastSeen)), 5_000);
    return () => clearInterval(id);
  }, [lastSeen]);
  const diffSec = Math.floor((Date.now() - lastSeen) / 1000);
  // Use darker shades in light mode for readability
  const color = diffSec < 30
    ? (isDark ? '#10b981' : '#059669')
    : diffSec < 120
      ? (isDark ? '#f59e0b' : '#d97706')
      : (isDark ? '#f97316' : '#ea580c');
  return (
    <span
      title={`Last heartbeat: ${new Date(lastSeen).toLocaleTimeString()}`}
      className="shrink-0 flex items-center gap-0.5 text-[8px] font-mono"
      style={{ color }}
    >
      <span className="w-1 h-1 rounded-full inline-block" style={{ background: color }} />
      {label}
    </span>
  );
}

/** Format a Date/timestamp as a human-readable relative time string */
function formatRelativeTime(ts: Date | number): string {
  const date = ts instanceof Date ? ts : new Date(ts);
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  // Older than 24h: show date + time
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Live relative timestamp — updates every 30 seconds */
function RelativeTime({ ts, className }: { ts: Date | number; className?: string }) {
  const [label, setLabel] = useState(() => formatRelativeTime(ts));
  useEffect(() => {
    setLabel(formatRelativeTime(ts));
    const id = setInterval(() => setLabel(formatRelativeTime(ts)), 30_000);
    return () => clearInterval(id);
  }, [ts]);
  const date = ts instanceof Date ? ts : new Date(ts);
  return (
    <span
      title={date.toLocaleString()}
      className={className}
    >
      {label}
    </span>
  );
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
  const { resolvedTheme } = useTheme();
  // resolvedTheme can be undefined on first render — fall back to DOM class check
  const isDark = resolvedTheme
    ? resolvedTheme === "dark"
    : typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const labelColor = isDark ? "rgba(255,255,255,0.82)" : "rgba(15,23,42,0.85)";
  const labelColorOffline = isDark ? "rgba(255,255,255,0.3)" : "rgba(15,23,42,0.4)";
  const offlineNodeFill = isDark ? "rgba(255,255,255,0.04)" : "rgba(15,23,42,0.06)";
  const offlineNodeStroke = isDark ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.2)";
  const inactiveChannelStroke = isDark ? "rgba(255,255,255,0.05)" : "rgba(15,23,42,0.12)";

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
                : inactiveChannelStroke}
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
                  : offlineNodeFill}
              stroke={isSelf
                ? "rgba(6,182,212,0.8)"
                : peer.online ? color : offlineNodeStroke}
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
              fill={peer.online ? labelColor : labelColorOffline}
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

// ─── Peer Chat ───────────────────────────────────────────────────────────────

/**
 * Collapsible direct-message panel shown inside the PeerDetail popup.
 * Messages are stored in the DB via the peerMessages tRPC router.
 */
function PeerChat({ myPeerId, otherPeerId, otherAlias }: { myPeerId: string; otherPeerId: string; otherAlias: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: thread = [], refetch } = trpc.peerMessages.getThread.useQuery(
    { myPeerId, otherPeerId, limit: 50 },
    { enabled: open, refetchInterval: open ? 5000 : false }
  );

  const sendMsg = trpc.peerMessages.send.useMutation({
    onSuccess: () => {
      setDraft('');
      refetch();
    },
  });

  const markRead = trpc.peerMessages.markRead.useMutation();

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thread, open]);

  // Mark messages as read when chat opens
  useEffect(() => {
    if (open && myPeerId && otherPeerId) {
      markRead.mutate({ myPeerId, fromPeerId: otherPeerId });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSend = () => {
    const body = draft.trim();
    if (!body || sendMsg.isPending) return;
    sendMsg.mutate({ fromPeerId: myPeerId, toPeerId: otherPeerId, body });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-border">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between text-[9px] text-muted-foreground uppercase tracking-widest hover:text-foreground/70 transition-colors"
      >
        <span className="flex items-center gap-1">
          <MessageSquare className="w-3 h-3" />
          Direct Message
        </span>
        <span className="text-[8px]">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-1">
          {/* Message thread */}
          <div
            ref={scrollRef}
            className="flex flex-col gap-1 max-h-40 overflow-y-auto pr-1"
            style={{ scrollbarWidth: 'thin' }}
          >
            {thread.length === 0 ? (
              <p className="text-[9px] text-muted-foreground text-center py-2">
                No messages yet. Say hi!
              </p>
            ) : (
              thread.map((msg) => {
                const isMine = msg.fromPeerId === myPeerId;
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className="px-2 py-1 rounded-lg text-[10px] max-w-[90%] break-words"
                      style={{
                        background: isMine ? 'rgba(6,182,212,0.15)' : 'rgba(100,116,139,0.12)',
                        border: `1px solid ${isMine ? 'rgba(6,182,212,0.25)' : 'rgba(100,116,139,0.2)'}`,
                        color: isMine ? '#06b6d4' : 'var(--foreground)',
                      }}
                    >
                      {msg.body}
                    </div>
                    <RelativeTime
                      ts={msg.createdAt}
                      className="text-[8px] text-muted-foreground/50 mt-0.5"
                    />
                  </div>
                );
              })
            )}
          </div>

          {/* Input */}
          <div className="flex gap-1 mt-1">
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${otherAlias}…`}
              maxLength={500}
              className="flex-1 min-w-0 px-2 py-1 rounded-md text-[10px] bg-transparent outline-none"
              style={{
                border: '1px solid var(--border)',
                color: 'var(--foreground)',
              }}
            />
            <button
              onClick={handleSend}
              disabled={!draft.trim() || sendMsg.isPending}
              className="shrink-0 px-2 py-1 rounded-md text-[9px] font-semibold transition-all disabled:opacity-40"
              style={{
                background: 'rgba(6,182,212,0.15)',
                border: '1px solid rgba(6,182,212,0.3)',
                color: '#06b6d4',
              }}
            >
              {sendMsg.isPending ? '…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Derive a human-readable trust level label from a 0-100 reputation score */
function trustLevel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: 'Trusted', color: '#10b981' };
  if (score >= 60) return { label: 'Reliable', color: '#06b6d4' };
  if (score >= 40) return { label: 'Neutral', color: '#f59e0b' };
  if (score >= 20) return { label: 'Caution', color: '#f97316' };
  return { label: 'Risky', color: '#ef4444' };
}

function PeerDetail({ peer, onClose, selfPeerId, reputationScores }: {
  peer: Peer;
  onClose: () => void;
  selfPeerId?: string | null;
  reputationScores?: Record<string, { score: number; successfulSwaps: number; avgLatencyMs: number | null }>;
}) {
  const color = latencyColor(peer.latency);
  // Use DB-persisted reputation score if available, fall back to in-memory value
  const dbRep = peer.fullKey ? reputationScores?.[peer.fullKey] : undefined;
  const repScore = dbRep?.score ?? peer.reputation;
  const trust = trustLevel(repScore);
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.2 }}
      className="absolute top-4 right-4 w-64 rounded-2xl z-20 flex flex-col"
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        backdropFilter: "blur(24px)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        maxHeight: "calc(100% - 2rem)",
      }}
    >
      {/* Sticky header */}
      <div className="flex items-start justify-between p-4 pb-3 shrink-0">
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

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--border) transparent' }}>
        <div className="space-y-2">
          {[
            { label: "Latency", value: peer.id === "self" ? "local" : `${peer.latency}ms`, color: color },
            { label: "Reputation", value: `${repScore}/100`, color: trust.color },
            { label: "Trust Level", value: trust.label, color: trust.color },
            ...(dbRep ? [{ label: "Swaps", value: `${dbRep.successfulSwaps} completed`, color: '#a78bfa' }] : []),
            ...(dbRep?.avgLatencyMs != null ? [{ label: "Avg Latency", value: `${dbRep.avgLatencyMs}ms`, color: '#06b6d4' }] : []),
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
          <div className="text-[9px] text-muted-foreground uppercase tracking-widest mb-1.5">Active Pairs</div>
          <div className="flex flex-wrap gap-1">
            {peer.pairs.map(pair => (
              <span key={pair} className="px-1.5 py-0.5 rounded text-[9px] font-mono"
                style={{ background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)", color: "rgba(6,182,212,0.8)" }}>
                {pair}
              </span>
            ))}
          </div>
        </div>

        {/* Copy Invite Link — only for remote peers with a fullKey */}
        {peer.id !== 'self' && peer.fullKey && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="text-[9px] text-muted-foreground uppercase tracking-widest mb-1.5">Share</div>
            <CopyInviteLinkButton peerId={peer.fullKey} />
          </div>
        )}
        {/* Direct Message — only for remote peers when own wallet is connected */}
        {peer.id !== 'self' && peer.fullKey && selfPeerId && (
          <PeerChat
            myPeerId={selfPeerId}
            otherPeerId={peer.fullKey}
            otherAlias={peer.alias}
          />
        )}
        {/* My Invite Link — only for self peer when wallet is connected */}
        {peer.id === 'self' && selfPeerId && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="text-[9px] text-muted-foreground uppercase tracking-widest mb-1.5">My Invite Link</div>
            <p className="text-[9px] text-muted-foreground mb-2">
              Share this link so others can connect to you directly.
            </p>
            <CopyInviteLinkButton peerId={selfPeerId} />
          </div>
        )}
        {peer.id === 'self' && !selfPeerId && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="text-[9px] text-muted-foreground uppercase tracking-widest mb-1.5">My Invite Link</div>
            <p className="text-[9px] text-muted-foreground">
              Connect a wallet to generate your invite link.
            </p>
          </div>
        )}
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

type SortKey = 'reputation' | 'latency' | 'channels' | 'alias';
type FilterKey = 'all' | 'online' | 'highRep';

/** Small button that copies a shareable invite link for a specific peer to the clipboard */
function CopyInviteLinkButton({ peerId, onCopy }: { peerId: string; onCopy?: () => void }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}${window.location.pathname}#network?peer=${encodeURIComponent(peerId)}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback for browsers without clipboard API
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handleCopy}
      title={copied ? 'Link copied!' : 'Copy invite link — share this URL to connect directly with this peer'}
      className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-mono transition-all hover:opacity-80"
      style={{
        background: copied ? 'rgba(6,182,212,0.15)' : 'rgba(100,116,139,0.08)',
        border: `1px solid ${copied ? 'rgba(6,182,212,0.4)' : 'rgba(100,116,139,0.2)'}`,
        color: copied ? '#06b6d4' : '#64748b',
      }}
    >
      {copied ? <Check className="w-2.5 h-2.5" /> : <Link2 className="w-2.5 h-2.5" />}
      {copied ? 'Copied!' : 'Link'}
    </button>
  );
}

function PeerList({ peers, selectedId, onSelect, pingResults, onPing, reputationScores, onInvite, onCopyInviteLink }: {
  peers: Peer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  pingResults: Record<string, { latencyMs: number | null; loading: boolean }>;
  onPing: (peerId: string, fullKey: string) => void;
  reputationScores: Record<string, { score: number; successfulSwaps: number; avgLatencyMs: number | null }> | undefined;
  onInvite?: (peerId: string, alias: string) => void;
  onCopyInviteLink?: (peerId: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('reputation');
  const [filterKey, setFilterKey] = useState<FilterKey>('all');
  const [showControls, setShowControls] = useState(false);

  const remotePeers = peers.filter(p => p.id !== 'self');

  // Apply filter
  const filteredPeers = remotePeers.filter(peer => {
    if (filterKey === 'online') return peer.online;
    if (filterKey === 'highRep') {
      const score = peer.fullKey ? (reputationScores?.[peer.fullKey]?.score ?? null) : null;
      return score !== null && score >= 80;
    }
    return true;
  });

  // Apply sort
  const sortedPeers = [...filteredPeers].sort((a, b) => {
    if (sortKey === 'reputation') {
      const sa = a.fullKey ? (reputationScores?.[a.fullKey]?.score ?? -1) : -1;
      const sb = b.fullKey ? (reputationScores?.[b.fullKey]?.score ?? -1) : -1;
      return sb - sa; // highest first
    }
    if (sortKey === 'latency') {
      const la = pingResults[a.id]?.latencyMs ?? a.latency;
      const lb = pingResults[b.id]?.latencyMs ?? b.latency;
      return la - lb; // lowest first
    }
    if (sortKey === 'channels') return b.channels - a.channels; // most first
    if (sortKey === 'alias') return a.alias.localeCompare(b.alias);
    return 0;
  });

  const sortLabels: Record<SortKey, string> = {
    reputation: 'Reputation ↓',
    latency: 'Latency ↑',
    channels: 'Channels ↓',
    alias: 'Alias A–Z',
  };
  const filterLabels: Record<FilterKey, string> = {
    all: 'All',
    online: 'Online',
    highRep: '★ High Rep',
  };

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      {/* Header */}
      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs font-bold text-foreground">Peer Directory</span>
            <span className="text-[10px] font-mono text-muted-foreground">{peers.length} nodes</span>
          </div>
          <button
            onClick={() => setShowControls(v => !v)}
            title="Sort & Filter"
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-mono transition-all hover:opacity-80"
            style={{
              background: showControls ? "rgba(6,182,212,0.12)" : "var(--muted)",
              border: `1px solid ${showControls ? "rgba(6,182,212,0.3)" : "var(--border)"}`,
              color: showControls ? "#06b6d4" : "var(--muted-foreground)",
            }}>
            <SlidersHorizontal className="w-2.5 h-2.5" />
            Sort
          </button>
        </div>

        {/* Sort & Filter controls — collapsible */}
        <AnimatePresence>
          {showControls && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="pt-2.5 space-y-2">
                {/* Sort row */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[9px] text-muted-foreground/70 font-mono w-8 shrink-0">Sort</span>
                  {(Object.keys(sortLabels) as SortKey[]).map(key => (
                    <button
                      key={key}
                      onClick={() => setSortKey(key)}
                      className="px-2 py-0.5 rounded text-[9px] font-mono transition-all"
                      style={{
                        background: sortKey === key ? "rgba(6,182,212,0.15)" : "var(--muted)",
                        border: `1px solid ${sortKey === key ? "rgba(6,182,212,0.35)" : "var(--border)"}`,
                        color: sortKey === key ? "#06b6d4" : "var(--muted-foreground)",
                      }}>
                      {sortLabels[key]}
                    </button>
                  ))}
                </div>
                {/* Filter row */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[9px] text-muted-foreground/70 font-mono w-8 shrink-0">Filter</span>
                  {(Object.keys(filterLabels) as FilterKey[]).map(key => (
                    <button
                      key={key}
                      onClick={() => setFilterKey(key)}
                      className="px-2 py-0.5 rounded text-[9px] font-mono transition-all"
                      style={{
                        background: filterKey === key ? "rgba(139,92,246,0.15)" : "var(--muted)",
                        border: `1px solid ${filterKey === key ? "rgba(139,92,246,0.35)" : "var(--border)"}`,
                        color: filterKey === key ? "#a78bfa" : "var(--muted-foreground)",
                      }}>
                      {filterLabels[key]}
                    </button>
                  ))}
                </div>
                {/* Active state summary */}
                <div className="text-[9px] text-muted-foreground/50 font-mono">
                  Showing {sortedPeers.length} of {remotePeers.length} remote peers
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="divide-y max-h-72 overflow-y-auto" style={{ borderColor: "var(--border)" }}>
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
                <div className="text-[11px] font-mono text-cyan-500 dark:text-cyan-300 truncate flex items-center gap-1.5">
                  {peer.alias}
                  <span className="text-[8px] px-1 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/25 text-cyan-600 dark:text-cyan-400 font-bold">YOU</span>
                </div>
                <div className="text-[9px] text-muted-foreground">{peer.region}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] font-mono text-cyan-600 dark:text-cyan-400">local</div>
              </div>
              <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
            </button>
          );
        })}
        {/* Remote peers — sorted & filtered */}
        {sortedPeers.map(peer => {
          const pingState = pingResults[peer.id];
          const displayLatency = pingState?.latencyMs ?? peer.latency;
          const color = latencyColor(displayLatency);
          const isSelected = selectedId === peer.id;
          const rep = peer.fullKey ? reputationScores?.[peer.fullKey] : undefined;
          const repScore = rep?.score ?? null;
          const canInvite = repScore !== null && repScore >= 70;
          const inviteTooltip = repScore === null
            ? 'Ping this peer first to establish a reputation score'
            : canInvite
              ? `Invite to open a Liquidity Channel (score ${repScore}/100 \u2265 70)`
              : `Score ${repScore}/100 is below the 70-point threshold to invite`;
          return (
            <div
              key={peer.id}
              className="group px-4 py-2 hover:bg-muted/40 transition-colors cursor-pointer"
              style={{ background: isSelected ? "rgba(6,182,212,0.06)" : undefined }}
              onClick={() => onSelect(peer.id)}
            >
              {/* Main info row */}
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full shrink-0 mt-0.5" style={{ background: peer.online ? color : "#374151" }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-mono text-foreground truncate flex items-center gap-1.5">
                    {peer.alias}
                    {/* Peer type badge */}
                    <span
                      className="text-[8px] px-1 py-0.5 rounded font-bold font-mono shrink-0"
                      title={
                        peer.origin === 'hyperswarm'
                          ? 'Hyperswarm DHT — Full node · Oracle VM · Supports HTLC atomic swaps, channel routing, and relay bridging'
                          : 'IntercomSwap DHT — Browser Light Peer · Wallet-connected · Supports P2P RFQ and HTLC atomic swaps'
                      }
                      style={{
                        background: peer.origin === 'hyperswarm' ? 'rgba(16,185,129,0.12)' : 'rgba(6,182,212,0.12)',
                        border: `1px solid ${peer.origin === 'hyperswarm' ? 'rgba(16,185,129,0.3)' : 'rgba(6,182,212,0.3)'}`,
                        color: peer.origin === 'hyperswarm' ? '#10b981' : '#06b6d4',
                      }}
                    >
                      {peer.origin === 'hyperswarm' ? '⚡ HW' : '📱 LP'}
                    </span>
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
                  <div className="text-[9px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                    <span>{peer.channels}ch</span>
                    <span className="text-muted-foreground/40">·</span>
                    <span>{peer.pairs[0] || '—'}</span>
                    {peer.origin === 'intercomswap' && peer.lastSeen && (
                      <LastSeenBadge lastSeen={peer.lastSeen} />
                    )}
                  </div>
                </div>
                {/* Latency — always visible */}
                <div className="text-right shrink-0">
                  <div className="text-[10px] font-mono" style={{ color }}>
                    {pingState?.loading ? (
                      <Loader2 className="w-3 h-3 animate-spin inline" />
                    ) : (
                      `${displayLatency}ms`
                    )}
                  </div>
                </div>
                <ChevronRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />
              </div>
              {/* Action strip — revealed on hover */}
              <div className="overflow-hidden max-h-0 group-hover:max-h-10 transition-all duration-200 ease-in-out">
                <div className="flex items-center gap-1.5 pt-1.5 pl-4" onClick={e => e.stopPropagation()}>
                  {/* Ping */}
                  <button
                    onClick={(e) => { e.stopPropagation(); if (peer.fullKey) onPing(peer.id, peer.fullKey); }}
                    disabled={pingState?.loading || !peer.fullKey}
                    title="Ping this peer"
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono transition-all hover:opacity-80 disabled:opacity-40"
                    style={{
                      background: 'rgba(16,185,129,0.1)',
                      border: '1px solid rgba(16,185,129,0.25)',
                      color: '#10b981',
                    }}
                  >
                    {pingState?.loading ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Radio className="w-2.5 h-2.5" />}
                    Ping
                  </button>
                  {/* Invite */}
                  <button
                    onClick={(e) => { e.stopPropagation(); if (canInvite && peer.fullKey) onInvite?.(peer.fullKey, peer.alias); }}
                    disabled={!canInvite}
                    title={inviteTooltip}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono transition-all hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: canInvite ? 'rgba(139,92,246,0.12)' : 'rgba(100,116,139,0.08)',
                      border: `1px solid ${canInvite ? 'rgba(139,92,246,0.3)' : 'rgba(100,116,139,0.2)'}`,
                      color: canInvite ? '#a78bfa' : '#94a3b8',
                    }}
                  >
                    <Mail className="w-2.5 h-2.5" />
                    Invite
                  </button>
                  {/* Copy link */}
                  {peer.fullKey && (
                    <CopyInviteLinkButton peerId={peer.fullKey} onCopy={() => onCopyInviteLink?.(peer.fullKey!)} />
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {/* Empty state when no remote peers */}
        {sortedPeers.length === 0 && (
          <div className="px-4 py-6 text-center">
            <WifiOff className="w-5 h-5 text-muted-foreground/40 mx-auto mb-2" />
            {remotePeers.length === 0 ? (
              <>
                <p className="text-[10px] text-muted-foreground">No remote peers connected</p>
                <p className="text-[9px] text-muted-foreground/60 mt-1">Scanning Hyperswarm + IntercomSwap DHT...</p>
              </>
            ) : (
              <>
                <p className="text-[10px] text-muted-foreground">No peers match the filter</p>
                <button onClick={() => setFilterKey('all')} className="text-[9px] text-cyan-400 mt-1 hover:underline">Clear filter</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Empty State for Topology ─────────────────────────────────────────────────

function EmptyTopology({ lightPeerOnline, lightPeerId, signalingConnected, signalingRemotePeers, directPeerCount, onConnectWallet }: {
  lightPeerOnline: boolean;
  lightPeerId: string | null;
  signalingConnected: boolean;
  signalingRemotePeers: { peerId: string }[];
  directPeerCount: number;
  onConnectWallet?: () => void;
}) {
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
      <h3 className="text-sm font-bold text-foreground mb-1">Scanning Dual-Layer P2P Network</h3>
      <p className="text-xs text-muted-foreground text-center max-w-xs mb-4">
        Your AFOS node announces on both DHT networks simultaneously. Remote peers from either layer will appear here once they connect.
      </p>

      {/* Wallet connect CTA — shown when no wallet is connected */}
      {!lightPeerId && (
        <div className="mb-4 px-4 py-3 rounded-xl text-center w-full max-w-xs"
          style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" }}>
          <div className="flex items-center gap-2 justify-center mb-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[11px] font-bold text-amber-400">Wallet not connected</span>
          </div>
          <p className="text-[10px] text-amber-300/70 mb-2">
            Connect a wallet to announce yourself as a Light Peer and become discoverable to other nodes.
          </p>
          {onConnectWallet && (
            <button
              onClick={onConnectWallet}
              className="px-3 py-1.5 rounded-lg text-[10px] font-bold font-mono transition-all hover:opacity-90 active:scale-95"
              style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.35)", color: "#f59e0b" }}>
              Connect Wallet
            </button>
          )}
        </div>
      )}

      {/* Light peer enabled but waiting for remote peers */}
      {lightPeerId && lightPeerOnline && (
        <div className="mb-4 px-4 py-2 rounded-xl text-center w-full max-w-xs"
          style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)" }}>
          <div className="flex items-center gap-2 justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-mono text-emerald-400">
              You are announced · waiting for remote peers
            </span>
          </div>
        </div>
      )}

      {/* Three-layer status badges */}
      <div className="flex flex-col gap-2 w-full max-w-xs">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono text-emerald-400 font-bold">Hyperswarm DHT</div>
            <div className="text-[9px] text-emerald-400/60">Oracle VM full node · Announced</div>
          </div>
          <Radio className="w-3 h-3 text-emerald-400 shrink-0" />
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{
            background: lightPeerOnline ? "rgba(6,182,212,0.08)" : "rgba(100,116,139,0.06)",
            border: `1px solid ${lightPeerOnline ? "rgba(6,182,212,0.2)" : "rgba(100,116,139,0.15)"}`,
          }}>
          <div className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: lightPeerOnline ? "#06b6d4" : "#64748b", animationDelay: "0.5s" }} />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono font-bold" style={{ color: lightPeerOnline ? "#06b6d4" : "#64748b" }}>IntercomSwap DHT</div>
            <div className="text-[9px]" style={{ color: lightPeerOnline ? "rgba(6,182,212,0.6)" : "rgba(100,116,139,0.6)" }}>
              {lightPeerOnline ? `Light Peer · ${lightPeerId?.slice(0, 12)}… · Active` : "Connect wallet to activate"}
            </div>
          </div>
          <Globe className="w-3 h-3 shrink-0" style={{ color: lightPeerOnline ? "#06b6d4" : "#64748b" }} />
        </div>
        {/* WebSocket Signaling status */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{
            background: signalingConnected ? "rgba(168,85,247,0.08)" : "rgba(100,116,139,0.06)",
            border: `1px solid ${signalingConnected ? "rgba(168,85,247,0.2)" : "rgba(100,116,139,0.15)"}`,
          }}>
          <div className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: signalingConnected ? "#a855f7" : "#64748b", animationDelay: "1s" }} />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono font-bold" style={{ color: signalingConnected ? "#a855f7" : "#64748b" }}>WebSocket Signaling</div>
            <div className="text-[9px]" style={{ color: signalingConnected ? "rgba(168,85,247,0.6)" : "rgba(100,116,139,0.6)" }}>
              {signalingConnected
                ? `Connected · ${signalingRemotePeers.length} peer${signalingRemotePeers.length !== 1 ? 's' : ''} · ${directPeerCount} direct`
                : lightPeerOnline ? "Connecting…" : "Connect wallet to activate"}
            </div>
          </div>
          <Wifi className="w-3 h-3 shrink-0" style={{ color: signalingConnected ? "#a855f7" : "#64748b" }} />
        </div>
      </div>
    </div>
  );
}

// ─── Reputation Leaderboard ─────────────────────────────────────────────────

function ReputationLeaderboard() {
  const { data, isLoading } = trpc.peerReputation.getAll.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="rounded-2xl p-8 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <Trophy className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm font-semibold text-foreground mb-1">No Reputation Data Yet</p>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
          Ping peers to start building reputation history. Scores persist across sessions and improve with successful swaps.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <Trophy className="w-4 h-4 text-amber-400" />
        <h2 className="text-sm font-bold text-foreground">Peer Reputation Leaderboard</h2>
        <span className="text-[10px] font-mono text-muted-foreground ml-auto">{data.length} peers tracked</span>
      </div>
      <p className="text-[10px] text-muted-foreground mb-3">
        Scores persist across sessions. Each successful ping improves a peer's score; failed pings and swap failures reduce it.
      </p>
      <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        {/* Table header */}
        <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 px-4 py-2 border-b text-[9px] font-mono text-muted-foreground uppercase tracking-widest"
          style={{ borderColor: "var(--border)" }}>
          <span>#</span>
          <span>Peer</span>
          <span className="text-right">Score</span>
          <span className="text-right hidden sm:block">Swaps</span>
          <span className="text-right hidden sm:block">Avg Latency</span>
        </div>
        <div className="divide-y" style={{ borderColor: "var(--border)" }}>
          {data.map((entry, idx) => {
            const trust = trustLevel(entry.score);
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;
            return (
              <div key={entry.peerId}
                className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 px-4 py-2.5 items-center hover:bg-muted/30 transition-colors">
                <span className="text-[10px] font-mono text-muted-foreground w-5 text-center">
                  {medal ?? `${idx + 1}`}
                </span>
                <div className="min-w-0">
                  <div className="text-[11px] font-mono text-foreground truncate">
                    {entry.alias || `${entry.peerId.slice(0, 12)}…`}
                  </div>
                  <div className="text-[9px] text-muted-foreground font-mono truncate">
                    {entry.origin} · last seen {new Date(entry.lastSeenAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span
                    className="text-[11px] font-bold font-mono px-1.5 py-0.5 rounded"
                    style={{
                      background: `${trust.color}18`,
                      border: `1px solid ${trust.color}40`,
                      color: trust.color,
                    }}
                  >{entry.score}</span>
                  <div className="text-[8px] mt-0.5" style={{ color: trust.color }}>{trust.label}</div>
                </div>
                <div className="text-right shrink-0 hidden sm:block">
                  <div className="text-[10px] font-mono text-foreground">{entry.successfulSwaps}</div>
                  <div className="text-[8px] text-muted-foreground">swaps</div>
                </div>
                <div className="text-right shrink-0 hidden sm:block">
                  <div className="text-[10px] font-mono text-foreground">
                    {entry.avgLatencyMs != null ? `${entry.avgLatencyMs}ms` : '—'}
                  </div>
                  <div className="text-[8px] text-muted-foreground">avg latency</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main Network Page ────────────────────────────────────────────────────────

export default function NetworkPage({ invitePeerId, onInvitePeerHandled }: {
  invitePeerId?: string | null;
  onInvitePeerHandled?: () => void;
} = {}) {
  const [activeTab, setActiveTab] = useState<"topology" | "channels" | "invites" | "leaderboard">("topology");
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
  const [inviteBannerDismissed, setInviteBannerDismissed] = useState(false);

  // Chime mute toggle — persisted to localStorage
  const [chimeMuted, setChimeMuted] = useState<boolean>(
    () => localStorage.getItem('afos:chime-muted') === 'true'
  );
  const toggleChimeMuted = () => {
    setChimeMuted(prev => {
      const next = !prev;
      localStorage.setItem('afos:chime-muted', String(next));
      return next;
    });
  };

  // The matched peer from the invite link (if any)
  const invitedPeer = useMemo(() => {
    if (!invitePeerId || livePeers.length === 0) return null;
    return livePeers.find(p =>
      p.fullKey === invitePeerId ||
      p.id === invitePeerId ||
      (p.fullKey && p.fullKey.startsWith(invitePeerId))
    ) ?? null;
  }, [invitePeerId, livePeers]);

  // Auto-select invited peer from invite link (?peer=<peerId>)
  useEffect(() => {
    if (!invitePeerId || livePeers.length === 0) return;
    // Match by fullKey (exact) or by partial peerId prefix
    const match = livePeers.find(p =>
      p.fullKey === invitePeerId ||
      p.id === invitePeerId ||
      (p.fullKey && p.fullKey.startsWith(invitePeerId))
    );
    if (match) {
      setSelectedId(match.id);
      onInvitePeerHandled?.();
    }
  }, [invitePeerId, livePeers, onInvitePeerHandled]);

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
  const recordSwapMutation = trpc.peerReputation.recordSwap.useMutation();

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
      origin: 'intercomswap' as const,
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
        origin: 'hyperswarm' as const,
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

  /** Fetch live peer data from Oracle VM + relay light peers */
  const fetchLiveData = useCallback(async () => {
    try {
      const [peersData, statusData, channelsData, relayData] = await Promise.all([
        getPeers().catch(() => null),
        getAgentStatus().catch(() => null),
        getChannels().catch(() => null),
        getRelayPeers().catch(() => null),
      ]);

      const selfPeer = buildSelfPeer();
      const remotePeers = peersData ? convertOraclePeers(peersData.peers) : [];

      // Merge relay light peers (browser wallets that announced themselves)
      // Exclude self by matching the actual peerId from LightPeerContext
      const myRelayPeerId = lightPeer.peerId; // wallet public key / address
      const lightPeers: Peer[] = relayData
        ? [...relayData.hyperswarmPeers, ...relayData.lightPeers]
            .filter(rp => {
              // Exclude our own peer from the remote list
              if (myRelayPeerId && rp.peerId === myRelayPeerId) return false;
              return true;
            })
            .map((rp, index) => {
              const pos = peerPosition(rp.peerId, remotePeers.length + index, remotePeers.length + (relayData.hyperswarmPeers.length + relayData.lightPeers.length));
              return {
                id: rp.peerId.slice(0, 16),
                alias: rp.alias || `lp-${rp.peerId.slice(0, 8)}`,
                region: "Light Peer",
                lat: pos.lat,
                lng: pos.lng,
                latency: 0,
                volume24h: 0,
                pairs: rp.pairs || ["BTC/USDT", "SOL/USDT"],
                online: rp.isConnected,
                reputation: 99,
                channels: 0,
                liquidity: 0,
                version: "2.0.0",
                fullKey: rp.peerId,
                origin: 'intercomswap' as const,
                lastSeen: rp.lastSeen,
              };
            })
        : [];

      // Merge signaling peers (WebSocket-discovered browser peers)
      const signalingPeers: Peer[] = lightPeer.remotePeers
        .filter(sp => {
          // Exclude self
          if (myRelayPeerId && sp.peerId === myRelayPeerId) return false;
          return true;
        })
        .map((sp, index) => {
          const totalSig = lightPeer.remotePeers.length;
          const pos = peerPosition(sp.peerId, remotePeers.length + lightPeers.length + index, remotePeers.length + lightPeers.length + totalSig);
          return {
            id: sp.peerId.slice(0, 16),
            alias: sp.alias || `lp-${sp.peerId.slice(0, 8)}`,
            region: "Light Peer",
            lat: pos.lat,
            lng: pos.lng,
            latency: 0,
            volume24h: 0,
            pairs: sp.pairs || ["BTC/USDT", "SOL/USDT"],
            online: true, // signaling peers are always online (they have an active WS)
            reputation: 99,
            channels: sp.dataChannel ? 1 : 0,
            liquidity: 0,
            version: "2.0.0",
            fullKey: sp.peerId,
            origin: 'intercomswap' as const,
            lastSeen: sp.lastHeartbeat ?? sp.connectedAt,
          };
        });

      // Deduplicate: prefer Oracle peers > relay peers > signaling peers
      const seenIds = new Set(remotePeers.map(p => p.id));
      const newLightPeers = lightPeers.filter(p => !seenIds.has(p.id));
      newLightPeers.forEach(p => seenIds.add(p.id));
      const newSignalingPeers = signalingPeers.filter(p => !seenIds.has(p.id));
      const allRemotePeers = [...remotePeers, ...newLightPeers, ...newSignalingPeers];

      const allPeers = [selfPeer, ...allRemotePeers];
      const channels = buildChannels(allRemotePeers);

      // Update self peer with Oracle VM data
      if (statusData) {
        selfPeer.channels = allRemotePeers.length;
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
  }, [buildSelfPeer, convertOraclePeers, buildChannels, lightPeer.peerId, lightPeer.remotePeers]);

  /** Ping a remote peer, update latency display, and persist result to reputation DB */
  const handlePing = useCallback(async (peerId: string, fullKey: string) => {
    setPingResults(prev => ({ ...prev, [peerId]: { latencyMs: null, loading: true } }));
    const peer = livePeers.find(p => p.id === peerId);
    // Route to correct ping endpoint based on peer origin:
    // - 'intercomswap' (signaling/light peers) → local signaling server
    // - 'hyperswarm' or undefined → Oracle VM
    const isSignalingPeer = peer?.origin === 'intercomswap';
    try {
      const result = isSignalingPeer
        ? await pingSignalingPeer(fullKey)
        : await pingPeer(fullKey);
      setPingResults(prev => ({ ...prev, [peerId]: { latencyMs: result.latencyMs, loading: false } }));
      // Persist ping result to reputation DB
      recordPingMutation.mutate({
        peerId: fullKey,
        alias: peer?.alias,
        origin: isSignalingPeer ? 'intercomswap' : 'hyperswarm',
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
      recordPingMutation.mutate({ peerId: fullKey, alias: peer?.alias, origin: isSignalingPeer ? 'intercomswap' : 'hyperswarm', latencyMs: null });
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
      // Automatically update peer reputation when a swap completes.
      // The Oracle VM emits { peerId, pair, amount, ... } in the swap_executed event.
      // We record the swap for the counterparty peer so their reputation score improves
      // organically over time without any manual operator action.
      const counterpartyKey = data.peerId || data.peer || data.counterparty;
      if (counterpartyKey && typeof counterpartyKey === 'string') {
        recordSwapMutation.mutate(
          { peerId: counterpartyKey },
          { onSuccess: () => refetchReputation() },
        );
      }
    });

    return () => {
      unsubPeerConnect();
      unsubPeerDisconnect();
      unsubRfq();
      unsubRfqSent();
      unsubQuote();
      unsubSwap();
    };
  }, [triggerPulse, fetchLiveData, recordSwapMutation, refetchReputation]);

  return (
    <div className="flex-1 overflow-y-auto p-3 sm:p-6" style={{ background: "transparent" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-foreground tracking-tight">P2P Network</h1>
          <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">
            Hyperswarm DHT + IntercomSwap DHT · Dual-layer P2P · Atomic swap channels
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
          {/* Chime mute toggle */}
          <button
            onClick={toggleChimeMuted}
            title={chimeMuted ? "Message chime muted — click to unmute" : "Message chime on — click to mute"}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all hover:opacity-80"
            style={{
              background: chimeMuted ? "rgba(239,68,68,0.08)" : "var(--card)",
              border: `1px solid ${chimeMuted ? "rgba(239,68,68,0.3)" : "var(--border)"}`,
            }}
          >
            {chimeMuted
              ? <VolumeX className="w-3 h-3 text-red-400" />
              : <Volume2 className="w-3 h-3 text-muted-foreground" />}
            <span className={`text-[10px] font-mono hidden sm:inline ${chimeMuted ? 'text-red-400' : 'text-muted-foreground'}`}>
              {chimeMuted ? "Muted" : "Chime"}
            </span>
          </button>
          {/* Hyperswarm DHT badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" title="Oracle VM Hyperswarm DHT — full node"
            style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)" }}>
            <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
            <span className="text-[10px] font-mono text-emerald-400 hidden sm:inline">Hyperswarm</span>
            <span className="text-[10px] font-mono text-emerald-400 sm:hidden">HW</span>
          </div>
          {/* IntercomSwap DHT badge — reflects Light Peer status */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
            title={lightPeer.isOnline ? "IntercomSwap DHT — Light Peer connected" : "IntercomSwap DHT — Light Peer offline"}
            style={{
              background: lightPeer.isOnline ? "rgba(6,182,212,0.1)" : "rgba(100,116,139,0.1)",
              border: `1px solid ${lightPeer.isOnline ? "rgba(6,182,212,0.25)" : "rgba(100,116,139,0.2)"}`,
            }}>
            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: lightPeer.isOnline ? "#06b6d4" : "#64748b" }} />
            <span className="text-[10px] font-mono hidden sm:inline" style={{ color: lightPeer.isOnline ? "#06b6d4" : "#64748b" }}>IntercomSwap</span>
            <span className="text-[10px] font-mono sm:hidden" style={{ color: lightPeer.isOnline ? "#06b6d4" : "#64748b" }}>IS</span>
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
          { id: "leaderboard", label: "Reputation", icon: <Trophy className="w-3.5 h-3.5" /> },
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

      {/* Leaderboard Tab — all-time peer reputation from DB */}
      {activeTab === "leaderboard" && (
        <ReputationLeaderboard />
      )}

      {/* Stats */}
      {activeTab === "topology" && <NetworkStats peers={livePeers} channels={liveChannels} />}

      {/* Invite link banner — shown when a ?peer= URL param is set (pending or found) */}
      {activeTab === "topology" && invitePeerId && !inviteBannerDismissed && (
        <AnimatePresence>
          <motion.div
            key={invitedPeer ? 'found' : 'pending'}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="mx-4 mt-2 rounded-xl px-4 py-3 flex items-center gap-3"
            style={{
              background: invitedPeer ? "rgba(6,182,212,0.08)" : "rgba(100,116,139,0.08)",
              border: `1px solid ${invitedPeer ? "rgba(6,182,212,0.3)" : "rgba(100,116,139,0.25)"}`,
            }}
          >
            {invitedPeer ? (
              <Link2 className="w-4 h-4 text-cyan-400 shrink-0" />
            ) : (
              <Loader2 className="w-4 h-4 text-slate-400 shrink-0 animate-spin" />
            )}
            <div className="flex-1 min-w-0">
              {invitedPeer ? (
                <>
                  <p className="text-[11px] font-semibold text-cyan-500 dark:text-cyan-300">
                    Peer found via invite link
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    <span className="font-mono text-cyan-400">{invitedPeer.alias}</span>
                    {" "}· {invitedPeer.origin === 'intercomswap' ? 'Light Peer' : 'Hyperswarm'}
                    {invitedPeer.online ? (
                      <span className="ml-1 text-emerald-400">● online</span>
                    ) : (
                      <span className="ml-1 text-slate-500">● offline</span>
                    )}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[11px] font-semibold text-foreground/80">
                    Waiting for peer to come online…
                  </p>
                  <p className="text-[10px] text-muted-foreground font-mono truncate">
                    {invitePeerId.slice(0, 20)}…
                  </p>
                </>
              )}
            </div>
            {invitedPeer && (
              <button
                onClick={() => {
                  setSelectedId(invitedPeer.id);
                  window.dispatchEvent(new CustomEvent('afos:navigate-swaps', { detail: { peerId: invitedPeer.fullKey || invitedPeer.id } }));
                }}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
                style={{
                  background: "rgba(6,182,212,0.2)",
                  border: "1px solid rgba(6,182,212,0.4)",
                  color: "#06b6d4",
                }}
              >
                <Zap className="w-3 h-3" />
                Swap Now
              </button>
            )}
            <button
              onClick={() => {
                setInviteBannerDismissed(true);
                sessionStorage.removeItem('afos:invite-peer');
              }}
              className="shrink-0 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        </AnimatePresence>
      )}

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
        <EmptyTopology
          lightPeerOnline={lightPeer.isOnline}
          lightPeerId={lightPeer.peerId}
          signalingConnected={lightPeer.signalingConnected}
          signalingRemotePeers={lightPeer.remotePeers}
          directPeerCount={lightPeer.directPeerCount}
          onConnectWallet={() => window.dispatchEvent(new CustomEvent('afos:open-wallet'))}
        />
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
                  <div className="text-sm font-bold text-cyan-600 dark:text-cyan-300 truncate flex items-center gap-1.5">
                    {peer.alias}
                    <span className="text-[8px] px-1 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/25 text-cyan-600 dark:text-cyan-400 font-bold">YOU</span>
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
                    <div className="text-sm font-bold text-foreground truncate flex items-center gap-1.5">
                      {peer.alias}
                      {/* DHT layer origin badge */}
                      <span
                        className="text-[8px] px-1.5 py-0.5 rounded font-bold font-mono shrink-0"
                        title={
                          peer.origin === 'hyperswarm'
                            ? 'Hyperswarm DHT — Full node · Oracle VM'
                            : 'IntercomSwap DHT — Browser Light Peer · Wallet-connected'
                        }
                        style={{
                          background: peer.origin === 'hyperswarm' ? 'rgba(16,185,129,0.12)' : 'rgba(6,182,212,0.12)',
                          border: `1px solid ${peer.origin === 'hyperswarm' ? 'rgba(16,185,129,0.3)' : 'rgba(6,182,212,0.3)'}`,
                          color: peer.origin === 'hyperswarm' ? '#10b981' : '#06b6d4',
                        }}
                      >{peer.origin === 'hyperswarm' ? '⚡ Hyperswarm' : '📱 Light Peer'}</span>
                    </div>
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
                  {/* Mobile Invite button — reputation-gated */}
                  {(() => {
                    const mobileRep = peer.fullKey ? reputationData?.[peer.fullKey] : undefined;
                    const mobileScore = mobileRep?.score ?? null;
                    const canInvite = mobileScore !== null && mobileScore >= 70;
                    return (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!canInvite) {
                            toast.error(mobileScore === null ? 'Ping this peer first to get a reputation score' : `Score ${mobileScore}/100 is below the 70-point threshold`);
                            return;
                          }
                          setActiveTab('channels');
                          sessionStorage.setItem('afos_open_channel_peer', peer.fullKey!);
                          window.dispatchEvent(new CustomEvent('afos:open-channel', { detail: { peerId: peer.fullKey } }));
                          toast.success(`Opening channel form for ${peer.alias}`);
                        }}
                        title={canInvite ? `Invite (score ${mobileScore}/100)` : mobileScore === null ? 'Ping first to establish score' : `Score ${mobileScore}/100 < 70`}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-mono transition-all"
                        style={{
                          background: canInvite ? 'rgba(139,92,246,0.12)' : 'rgba(100,116,139,0.08)',
                          border: `1px solid ${canInvite ? 'rgba(139,92,246,0.3)' : 'rgba(100,116,139,0.2)'}`,
                          color: canInvite ? '#a78bfa' : '#475569',
                          opacity: canInvite ? 1 : 0.4,
                        }}>
                        <Mail className="w-2.5 h-2.5" />
                        Invite
                      </button>
                    );
                  })()}
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
              <PeerDetail peer={selectedPeer} onClose={() => setSelectedId(null)} selfPeerId={lightPeer.peerId} reputationScores={reputationData} />
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
              className="text-[10px] font-mono text-cyan-600/80 dark:text-cyan-300/70 truncate"
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
          <PeerList
            peers={livePeers}
            selectedId={selectedId}
            onSelect={id => setSelectedId(prev => prev === id ? null : id)}
            pingResults={pingResults}
            onPing={handlePing}
            reputationScores={reputationData}
            onInvite={(peerId, alias) => {
              // Switch to Liquidity Channels tab and pre-fill the Open Channel form
              setActiveTab('channels');
              // Store the peer ID for the Open Channel form to pick up
              sessionStorage.setItem('afos_open_channel_peer', peerId);
              window.dispatchEvent(new CustomEvent('afos:open-channel', { detail: { peerId } }));
              toast.success(`Opening channel form for ${alias}`, {
                description: `Score ≥ 70 — peer is eligible for a Liquidity Channel`,
              });
            }}
            onCopyInviteLink={(peerId) => {
              toast.success('Invite link copied!', {
                description: 'Share this URL with the peer to connect directly without waiting for DHT discovery.',
              });
            }}
          />

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
                         <div className="text-[9px] text-muted-foreground">{ch.pair}</div>
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
                { label: "Protocol", value: "Hyperswarm + IntercomSwap DHT" },
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
