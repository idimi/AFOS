/**
 * AFOS — P2P Network Page
 * Interactive animated SVG node graph showing live IntercomSwap peers,
 * latency rings, active swap channels, and geographic distribution.
 * Design: Glassmorphism + Agentic Sci-Fi (dark navy-black, cyan-teal accents)
 *
 * PRODUCTION: All data is live from Oracle VM /api/peers + SSE + LightPeerContext.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import { useTheme } from "next-themes";
import { trpc } from "@/lib/trpc";
import { motion, AnimatePresence } from "framer-motion";
import {
  Radio, Zap, Globe, Activity, Users, TrendingUp,
  Shield, Clock, RefreshCw, ChevronRight, X,
  GitBranch, Plus, Minus, Mail, Link2, AlertCircle, Wifi, WifiOff, Loader2,
  ArrowUpDown, SlidersHorizontal, Star, Check, MessageSquare, Volume2, VolumeX, Trophy,
  BellOff, Bell, Flag, Send, SmilePlus, ChevronDown,
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
  /** Multi-chain wallet addresses broadcast by the peer on connect */
  walletAddresses?: {
    solana?: string;
    ethereum?: string;
    bitcoin?: string;
  };
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

/** Deterministic position from public key hash — spreads peers evenly around the canvas.
 * density: multiplier for the radius (0.5 = sparse, 1.0 = balanced, 2.0 = dense) */
function peerPosition(pubkey: string, index: number, total: number, density = 1.0): { lat: number; lng: number } {
  // Use golden angle distribution for even spacing
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const angle = index * goldenAngle;
  // density > 1 packs nodes closer (smaller radius), density < 1 spreads them further
  const baseRadius = 0.15 + (index / Math.max(total, 1)) * 0.25;
  const radius = baseRadius / density;
  return {
    lat: 0.5 + radius * Math.cos(angle) * 1.4,
    lng: 0.5 + radius * Math.sin(angle) * 1.2,
  };
}

// ─── SVG Node Graph ───────────────────────────────────────────────────────────

function NodeGraph({ peers, channels, selectedId, onSelect, pulseIds, pingingIds, unreadByPeer, blockedPeerIds, mutedPeerIds, graphDensity = 1.0 }: {
  peers: Peer[];
  channels: Channel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  pulseIds: Set<string>;
  pingingIds?: Set<string>;
  unreadByPeer?: Record<string, { count: number; snippet: string }>;
  blockedPeerIds?: Set<string>;
  mutedPeerIds?: Set<string>;
  graphDensity?: number;
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
          @keyframes ping-travel {
            0%   { offset-distance: 0%; opacity: 1; }
            85%  { opacity: 1; }
            100% { offset-distance: 100%; opacity: 0; }
          }
          .ping-dot { animation: ping-travel 0.9s ease-in-out infinite; }
          @keyframes unread-ring {
            0%   { r: var(--ring-start); opacity: 0.85; stroke-width: 2.5; }
            60%  { opacity: 0.4; stroke-width: 1.5; }
            100% { r: var(--ring-end); opacity: 0; stroke-width: 0.5; }
          }
          .unread-ring-1 { animation: unread-ring 1.8s ease-out infinite; }
          .unread-ring-2 { animation: unread-ring 1.8s ease-out 0.6s infinite; }
          .unread-ring-3 { animation: unread-ring 1.8s ease-out 1.2s infinite; }
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
        const isPinging = pingingIds?.has(ch.to) || pingingIds?.has(ch.from);
        const x1 = px(from.lat), y1 = py(from.lng);
        const x2 = px(to.lat), y2 = py(to.lng);
        const pathId = `edge-path-${i}`;
        return (
          <g key={i}>
            {/* Hidden path for ping-dot motion path */}
            {isPinging && (
              <defs>
                <path id={pathId} d={`M${x1},${y1} L${x2},${y2}`} />
              </defs>
            )}
            {ch.active && (
              <line
                x1={x1} y1={y1}
                x2={x2} y2={y2}
                stroke={isPinging ? "rgba(6,182,212,0.35)" : "rgba(6,182,212,0.12)"}
                strokeWidth={isSelected ? 6 : 3}
              />
            )}
            <line
              x1={x1} y1={y1}
              x2={x2} y2={y2}
              stroke={ch.active
                ? isSelected ? "rgba(6,182,212,0.7)" : isPinging ? "rgba(6,182,212,0.5)" : "rgba(6,182,212,0.25)"
                : inactiveChannelStroke}
              strokeWidth={ch.active ? (isSelected ? 2 : 1.5) : 1}
              strokeDasharray={ch.active ? "6 4" : "3 6"}
              className={ch.active ? "channel-active" : ""}
            />
            {ch.active && (
              <>
                <circle
                  cx={(x1 + x2) / 2}
                  cy={(y1 + y2) / 2}
                  r={3}
                  fill="rgba(6,182,212,0.5)"
                />
                {/* Live latency label on the channel edge */}
                {to.latency > 0 && (
                  <text
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 - 8}
                    textAnchor="middle"
                    fontSize={8}
                    fill={latencyColor(to.latency)}
                    fontFamily="monospace"
                    opacity={0.8}
                  >
                    {to.latency}ms
                  </text>
                )}
                {/* Ping animation: traveling dot along the edge */}
                {isPinging && (
                  <circle
                    r={4}
                    fill="rgba(6,182,212,0.9)"
                    filter="url(#glow-cyan)"
                    style={{
                      offsetPath: `path('M${x1},${y1} L${x2},${y2}')`,
                      offsetDistance: '0%',
                      animation: 'ping-travel 0.9s ease-in-out infinite',
                    } as React.CSSProperties}
                  />
                )}
              </>
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
                {peer.latency > 0 ? `${peer.latency}ms` : 'N/A'}
              </text>
            )}

            {/* Blocked peer indicator — red tint overlay + lock icon */}
            {peer.id !== "self" && peer.fullKey && blockedPeerIds?.has(peer.fullKey) && (
              <g>
                {/* Red tint overlay on node circle */}
                <circle cx={x} cy={y} r={r + 2} fill="rgba(239,68,68,0.18)" stroke="rgba(239,68,68,0.5)" strokeWidth={1.5} />
                {/* Lock badge top-right */}
                <circle cx={x + r + 4} cy={y - r - 4} r={7} fill="rgba(239,68,68,0.9)" />
                <text x={x + r + 4} y={y - r - 0.5} textAnchor="middle" fontSize={8} fill="#fff" fontWeight="bold">
                  🔒
                </text>
                {/* Blocked label below latency */}
                <text x={x} y={y + r + 34} textAnchor="middle" fontSize={7} fill="rgba(239,68,68,0.7)" fontFamily="monospace">
                  blocked
                </text>
              </g>
            )}

            {/* Muted peer indicator — gray bell icon, no pulsing rings */}
            {peer.id !== "self" && peer.fullKey && mutedPeerIds?.has(peer.fullKey) && !blockedPeerIds?.has(peer.fullKey) && (
              <g>
                {/* Gray tint overlay */}
                <circle cx={x} cy={y} r={r + 2} fill="rgba(100,116,139,0.12)" stroke="rgba(100,116,139,0.35)" strokeWidth={1} strokeDasharray="3,2" />
                {/* Bell-off badge top-right */}
                <circle cx={x + r + 4} cy={y - r - 4} r={7} fill="rgba(100,116,139,0.85)" />
                <text x={x + r + 4} y={y - r - 0.5} textAnchor="middle" fontSize={8} fill="#fff" fontWeight="bold">
                  🔕
                </text>
                {/* Muted label below latency */}
                <text x={x} y={y + r + 34} textAnchor="middle" fontSize={7} fill="rgba(100,116,139,0.7)" fontFamily="monospace">
                  muted
                </text>
              </g>
            )}

            {/* Unread message indicator — pulsing rings + badge when peer has unread messages */}
            {peer.id !== "self" && peer.fullKey && unreadByPeer?.[peer.fullKey]?.count ? (() => {
              const count = unreadByPeer[peer.fullKey!]!.count;
              const ringStart = r + 4;
              const ringEnd = r + 22;
              const badgeR = 7;
              const bx = x + r + 4;
              const by = y - r - 4;
              return (
                <g>
                  {/* Three staggered expanding rings for "new message" glow — Framer Motion for reliable SVG r animation */}
                  {[0, 0.6, 1.2].map((delay, i) => (
                    <motion.circle
                      key={i}
                      cx={x} cy={y}
                      fill="none"
                      stroke="rgba(6,182,212,0.85)"
                      initial={{ r: ringStart, opacity: 0.85, strokeWidth: 2.5 }}
                      animate={{ r: ringEnd, opacity: 0, strokeWidth: 0.5 }}
                      transition={{
                        duration: 1.8,
                        ease: 'easeOut',
                        delay,
                        repeat: Infinity,
                        repeatDelay: 1.8 * 2 / 3,
                      }}
                    />
                  ))}
                  {/* Numeric badge */}
                  <circle cx={bx} cy={by} r={badgeR + 2} fill="rgba(6,182,212,0.2)" />
                  <circle cx={bx} cy={by} r={badgeR} fill="rgba(6,182,212,0.95)" />
                  <text x={bx} y={by + 3.5} textAnchor="middle" fontSize={7} fill="#000" fontWeight="bold" fontFamily="monospace">
                    {count > 9 ? '9+' : count}
                  </text>
                </g>
              );
            })() : null}
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
function PeerChat({ myPeerId, otherPeerId, otherAlias, initialDraft, autoOpen, sendPeerMessage }: {
  myPeerId: string;
  otherPeerId: string;
  otherAlias: string;
  initialDraft?: string;
  autoOpen?: boolean;
  sendPeerMessage?: (targetPeerId: string, payload: unknown) => void;
}) {
  const [open, setOpen] = useState(autoOpen ?? false);
  const [draft, setDraft] = useState(initialDraft ?? '');
  const [showEmoji, setShowEmoji] = useState(false);
  const [hoveredMsgId, setHoveredMsgId] = useState<number | null>(null);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<number | null>(null);
  const [peerIsTyping, setPeerIsTyping] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingThrottleRef = useRef<number>(0);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const emojiPickerBtnRef = useRef<HTMLButtonElement>(null);
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ top: number; left: number } | null>(null);
  const reactionPickerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Close emoji picker when clicking outside
  useEffect(() => {
    if (!showEmoji) return;
    const handler = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmoji]);

  // Close reaction picker when clicking outside
  useEffect(() => {
    if (reactionPickerMsgId === null) return;
    const handler = (e: MouseEvent) => {
      if (reactionPickerRef.current && !reactionPickerRef.current.contains(e.target as Node)) {
        setReactionPickerMsgId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [reactionPickerMsgId]);

  // Auto-resize textarea whenever draft changes
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, [draft]);

  // Listen for typing events from the other peer
  useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { fromPeerId: string };
      if (detail.fromPeerId !== otherPeerId) return;
      setPeerIsTyping(true);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => setPeerIsTyping(false), 3000);
    };
    window.addEventListener('afos:peer-typing', handler);
    return () => {
      window.removeEventListener('afos:peer-typing', handler);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [open, otherPeerId]);

  const { data: thread = [], refetch } = trpc.peerMessages.getThread.useQuery(
    { myPeerId, otherPeerId, limit: 50 },
    { enabled: open, refetchInterval: open ? 4000 : false }
  );

  // Fetch reactions for visible messages
  const messageIds = useMemo(() => thread.map(m => m.id), [thread]);
  const { data: reactionsMap = {}, refetch: refetchReactions } = trpc.peerMessages.getReactions.useQuery(
    { messageIds },
    { enabled: open && messageIds.length > 0, refetchInterval: open ? 8000 : false }
  );

  const reactMutation = trpc.peerMessages.react.useMutation({
    onSuccess: () => refetchReactions(),
  });

  const sendMsg = trpc.peerMessages.send.useMutation({
    onSuccess: () => {
      setDraft('');
      if (inputRef.current) inputRef.current.style.height = 'auto';
      refetch();
    },
  });

  const markRead = trpc.peerMessages.markRead.useMutation();

  // When a pair badge is clicked, sync draft + open
  useEffect(() => {
    if (initialDraft !== undefined && initialDraft !== '') {
      setDraft(initialDraft);
      setOpen(true);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [initialDraft]);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Send typing signal (throttled to once every 2s)
  const handleDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value);
    const now = Date.now();
    if (sendPeerMessage && now - typingThrottleRef.current > 2000) {
      typingThrottleRef.current = now;
      sendPeerMessage(otherPeerId, { type: 'typing', fromPeerId: myPeerId });
    }
  };

  // Quick-reaction emojis shown on hover
  const QUICK_REACTIONS = ['👍', '❤️', '🚀', '😂', '🔥'];

  // Theme awareness for light/dark mode
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme
    ? resolvedTheme === 'dark'
    : typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const emojiTheme = isDark ? 'dark' : 'light';

  // Derive initials for avatar
  const peerInitials = otherAlias.slice(0, 2).toUpperCase();
  const myInitials = 'ME';

  // Derived theme-aware style tokens
  const panelBg = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.04)';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.12)';
  const headerBg = isDark ? 'rgba(6,182,212,0.05)' : 'rgba(6,182,212,0.08)';
  const headerBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.1)';
  const peerAvatarBg = 'rgba(6,182,212,0.2)';
  const peerNameColor = isDark ? '#f1f5f9' : '#0f172a';
  const subtitleColor = isDark ? '#64748b' : '#475569';
  const scrollbarColor = isDark ? 'rgba(255,255,255,0.1) transparent' : 'rgba(15,23,42,0.15) transparent';
  const myBubbleBg = isDark ? 'rgba(139,92,246,0.18)' : 'rgba(139,92,246,0.12)';
  const myBubbleBorder = isDark ? 'rgba(139,92,246,0.25)' : 'rgba(139,92,246,0.3)';
  const myBubbleText = isDark ? '#e2d9f3' : '#3b0764';
  const peerBubbleBg = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.06)';
  const peerBubbleBorder = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.12)';
  const peerBubbleText = isDark ? '#e2e8f0' : '#1e293b';
  const reactionBarBg = isDark ? 'rgba(15,23,42,0.92)' : 'rgba(248,250,252,0.96)';
  const reactionBarBorder = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.15)';
  const inputBarBg = isDark ? 'rgba(0,0,0,0.2)' : 'rgba(15,23,42,0.04)';
  const inputBarBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.1)';
  const textareaBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.05)';
  const textareaBorder = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.15)';
  const textareaColor = isDark ? '#e2e8f0' : '#1e293b';
  const textareaFocusBorder = 'rgba(6,182,212,0.4)';
  const textareaFocusBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(6,182,212,0.04)';
  const sendBtnIdleBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)';
  const sendBtnIdleBorder = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.15)';
  const hintColor = isDark ? '#475569' : '#94a3b8';
  const sectionHeaderText = isDark ? 'text-slate-300 group-hover:text-white' : 'text-slate-600 group-hover:text-slate-900';
  const chevronColor = isDark ? 'text-slate-500' : 'text-slate-400';
  const emptyIconColor = isDark ? 'text-slate-600' : 'text-slate-400';
  const emptyTextColor = isDark ? 'text-slate-500' : 'text-slate-500';
  const emptySubColor = isDark ? 'text-slate-600' : 'text-slate-400';
  const emojiButtonIdle = isDark ? 'text-slate-500 hover:text-slate-300 hover:bg-white/8' : 'text-slate-400 hover:text-slate-700 hover:bg-black/5';
  const typingDotColor = isDark ? 'bg-slate-400' : 'bg-slate-500';

  return (
    <div className="mt-3 border-t" style={{ borderColor: panelBorder }}>
      {/* ── Section header ── */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-0 py-3 group"
      >
        <span className={`flex items-center gap-2 text-xs font-semibold transition-colors ${sectionHeaderText}`}>
          <MessageSquare className="w-3.5 h-3.5 text-cyan-500" />
          Direct Message
          {thread.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-cyan-500/20 text-cyan-500 border border-cyan-500/30">
              {thread.length}
            </span>
          )}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform duration-200 ${chevronColor} ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Portal: emoji picker rendered at document.body level to escape overflow clipping */}
      {showEmoji && emojiPickerPos && createPortal(
        <div
          ref={emojiPickerRef}
          style={{
            position: 'fixed',
            top: emojiPickerPos.top,
            left: emojiPickerPos.left,
            zIndex: 9999,
            filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.6))',
          }}
        >
          <Picker
            data={data}
            theme={emojiTheme}
            previewPosition="none"
            skinTonePosition="none"
            set="native"
            onEmojiSelect={(emoji: { native: string }) => {
              setDraft(d => d + emoji.native);
              setShowEmoji(false);
              setEmojiPickerPos(null);
              inputRef.current?.focus();
            }}
          />
        </div>,
        document.body
      )}

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="chat-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="flex flex-col rounded-xl overflow-hidden"
              style={{
                background: panelBg,
                border: `1px solid ${panelBorder}`,
              }}
            >
              {/* ── Chat header ── */}
              <div className="flex items-center gap-2.5 px-3 py-2.5 border-b"
                style={{ background: headerBg, borderColor: headerBorder }}
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                  style={{ background: peerAvatarBg, color: '#06b6d4', border: '1px solid rgba(6,182,212,0.3)' }}
                >
                  {peerInitials}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate" style={{ color: peerNameColor }}>{otherAlias}</p>
                  <p className="text-[10px]" style={{ color: subtitleColor }}>P2P encrypted · {thread.length} messages</p>
                </div>
              </div>

              {/* ── Message thread ── */}
              <div
                ref={scrollRef}
                className="flex flex-col gap-2 p-3 overflow-y-auto"
                style={{
                  minHeight: '120px',
                  maxHeight: '220px',
                  scrollbarWidth: 'thin',
                  scrollbarColor,
                }}
              >
                {thread.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-20 gap-2">
                    <MessageSquare className={`w-5 h-5 ${emptyIconColor}`} />
                    <p className={`text-xs ${emptyTextColor}`}>No messages yet</p>
                    <p className={`text-[10px] ${emptySubColor}`}>Say hi to {otherAlias}!</p>
                  </div>
                ) : (
                  thread.map((msg) => {
                    const isMine = msg.fromPeerId === myPeerId;
                    const msgReactions = (reactionsMap as Record<number, Record<string, string[]>>)[msg.id] ?? {};
                    const hasReactions = Object.keys(msgReactions).length > 0;
                    return (
                      <div
                        key={msg.id}
                        className={`flex gap-2 group/msg ${
                          isMine ? 'flex-row-reverse' : 'flex-row'
                        }`}
                        onMouseEnter={() => setHoveredMsgId(msg.id)}
                        onMouseLeave={() => setHoveredMsgId(null)}
                      >
                        {/* Avatar */}
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5"
                          style={{
                            background: isMine
                              ? 'rgba(139,92,246,0.25)'
                              : 'rgba(6,182,212,0.15)',
                            color: isMine ? '#a78bfa' : '#06b6d4',
                            border: `1px solid ${isMine ? 'rgba(139,92,246,0.3)' : 'rgba(6,182,212,0.25)'}`,
                          }}
                        >
                          {isMine ? myInitials : peerInitials}
                        </div>

                        {/* Bubble + reactions */}
                        <div className={`flex flex-col gap-0.5 max-w-[78%] ${
                          isMine ? 'items-end' : 'items-start'
                        }`}>
                          {/* Bubble */}
                          <div className="relative">
                            <div
                              className="px-3 py-2 rounded-2xl text-xs leading-relaxed break-words"
                              style={{
                                background: isMine ? myBubbleBg : peerBubbleBg,
                                border: `1px solid ${isMine ? myBubbleBorder : peerBubbleBorder}`,
                                color: isMine ? myBubbleText : peerBubbleText,
                                borderRadius: isMine
                                  ? '16px 4px 16px 16px'
                                  : '4px 16px 16px 16px',
                              }}
                            >
                              {msg.body}
                            </div>
                            {/* Quick reaction row — appears on hover */}
                            {hoveredMsgId === msg.id && (
                              <div
                                className={`absolute -bottom-6 flex items-center gap-0.5 z-10 ${
                                  isMine ? 'right-0' : 'left-0'
                                }`}
                                style={{
                                  background: reactionBarBg,
                                  border: `1px solid ${reactionBarBorder}`,
                                  borderRadius: '20px',
                                  padding: '2px 6px',
                                  boxShadow: isDark ? '0 4px 12px rgba(0,0,0,0.5)' : '0 4px 12px rgba(0,0,0,0.12)',
                                }}
                              >
                                {QUICK_REACTIONS.map(emoji => (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => {
                                      reactMutation.mutate({ messageId: msg.id, reactorPeerId: myPeerId, emoji });
                                      setHoveredMsgId(null);
                                    }}
                                    className="text-sm hover:scale-125 transition-transform px-0.5 leading-none"
                                    title={`React with ${emoji}`}
                                  >
                                    {emoji}
                                  </button>
                                ))}
                                {/* + button opens full emoji picker for this message */}
                                <div className="relative" ref={reactionPickerMsgId === msg.id ? reactionPickerRef : undefined}>
                                  <button
                                    type="button"
                                    onClick={() => setReactionPickerMsgId(id => id === msg.id ? null : msg.id)}
                                    className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold transition-all"
                                    style={{
                                      background: reactionPickerMsgId === msg.id ? 'rgba(6,182,212,0.25)' : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.08)'),
                                      color: reactionPickerMsgId === msg.id ? '#06b6d4' : '#94a3b8',
                                      border: `1px solid ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(15,23,42,0.15)'}`,
                                    }}
                                    title="More reactions"
                                  >
                                    +
                                  </button>
                                  {reactionPickerMsgId === msg.id && (
                                    <div
                                      className={`absolute z-50 ${
                                        isMine ? 'right-0' : 'left-0'
                                      }`}
                                      style={{
                                        bottom: '28px',
                                        filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.7))',
                                      }}
                                    >
                                      <Picker
                                        data={data}
                                        theme={emojiTheme}
                                        previewPosition="none"
                                        skinTonePosition="none"
                                        set="native"
                                        onEmojiSelect={(emoji: { native: string }) => {
                                          reactMutation.mutate({ messageId: msg.id, reactorPeerId: myPeerId, emoji: emoji.native });
                                          setReactionPickerMsgId(null);
                                          setHoveredMsgId(null);
                                        }}
                                      />
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Existing reactions summary */}
                          {hasReactions && (
                            <div className={`flex flex-wrap gap-1 mt-5 ${
                              isMine ? 'justify-end' : 'justify-start'
                            }`}>
                              {Object.entries(msgReactions).map(([emoji, reactors]) => {
                                const iReacted = reactors.includes(myPeerId);
                                return (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => reactMutation.mutate({ messageId: msg.id, reactorPeerId: myPeerId, emoji })}
                                    className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] transition-all"
                                    style={{
                                      background: iReacted
                                        ? 'rgba(6,182,212,0.2)'
                                        : 'rgba(255,255,255,0.06)',
                                      border: `1px solid ${
                                        iReacted ? 'rgba(6,182,212,0.4)' : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.12)')
                                      }`,
                                      color: iReacted ? '#06b6d4' : (isDark ? '#94a3b8' : '#64748b'),
                                    }}
                                    title={`${reactors.length} reaction${reactors.length !== 1 ? 's' : ''}`}
                                  >
                                    <span>{emoji}</span>
                                    <span>{reactors.length}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {/* Timestamp + read receipt row */}
                          <div className={`flex items-center gap-1 px-1 ${
                            isMine ? 'flex-row-reverse' : 'flex-row'
                          } ${hasReactions ? 'mt-1' : ''}`}>
                            <RelativeTime
                              ts={msg.createdAt}
                              className="text-[9px] text-slate-600"
                            />
                            {/* Read receipt — only shown on messages I sent */}
                            {isMine && (
                              <span
                                title={msg.readAt ? `Read ${new Date(msg.readAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Delivered'}
                                className="text-[9px] leading-none"
                                style={{ color: msg.readAt ? '#06b6d4' : '#475569' }}
                              >
                                {msg.readAt ? '✓✓' : '✓'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Typing indicator */}
                {peerIsTyping && (
                  <div className="flex gap-2 items-end">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
                      style={{
                        background: 'rgba(6,182,212,0.15)',
                        color: '#06b6d4',
                        border: '1px solid rgba(6,182,212,0.25)',
                      }}
                    >
                      {peerInitials}
                    </div>
                    <div
                      className="px-3 py-2.5 rounded-2xl"
                      style={{
                        background: peerBubbleBg,
                        border: `1px solid ${peerBubbleBorder}`,
                        borderRadius: '4px 16px 16px 16px',
                      }}
                    >
                      <div className="flex items-center gap-1">
                        {[0, 1, 2].map(i => (
                          <span
                            key={i}
                            className={`w-1.5 h-1.5 rounded-full animate-bounce ${typingDotColor}`}
                            style={{ animationDelay: `${i * 0.15}s`, animationDuration: '0.9s' }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Input bar ── */}
              <div
                className="flex items-end gap-2 px-3 py-2.5 border-t"
                style={{ background: inputBarBg, borderColor: inputBarBorder }}
              >
                {/* Emoji button — picker is rendered via portal at document.body */}
                <div className="relative shrink-0">
                  <button
                    ref={emojiPickerBtnRef}
                    type="button"
                    onClick={() => {
                      if (showEmoji) {
                        setShowEmoji(false);
                        setEmojiPickerPos(null);
                      } else {
                        const rect = emojiPickerBtnRef.current?.getBoundingClientRect();
                        if (rect) {
                          // Position picker above the button; picker is ~435px tall
                          const pickerH = 435;
                          const top = Math.max(8, rect.top - pickerH - 8);
                          setEmojiPickerPos({ top, left: rect.left });
                        }
                        setShowEmoji(true);
                      }
                    }}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                      showEmoji
                        ? 'bg-cyan-500/20 text-cyan-500'
                        : emojiButtonIdle
                    }`}
                    title="Add emoji"
                  >
                    <SmilePlus className="w-4 h-4" />
                  </button>
                </div>

                {/* Textarea */}
                <div className="flex-1 relative">
                  <textarea
                    ref={inputRef}
                    value={draft}
                    onChange={handleDraftChange}
                    onKeyDown={handleKeyDown}
                    placeholder={`Message ${otherAlias}…`}
                    maxLength={500}
                    rows={1}
                    className="w-full px-3 py-2 rounded-xl text-xs bg-transparent outline-none resize-none leading-relaxed placeholder:text-slate-400"
                    style={{
                      background: textareaBg,
                      border: `1px solid ${textareaBorder}`,
                      color: textareaColor,
                      minHeight: '36px',
                      maxHeight: '96px',
                      overflowY: 'auto',
                    }}
                    onFocus={e => {
                      e.currentTarget.style.borderColor = textareaFocusBorder;
                      e.currentTarget.style.background = textareaFocusBg;
                    }}
                    onBlur={e => {
                      e.currentTarget.style.borderColor = textareaBorder;
                      e.currentTarget.style.background = textareaBg;
                    }}
                  />
                  {/* Char counter — only visible when typing */}
                  {draft.length > 400 && (
                    <span
                      className="absolute bottom-1.5 right-2 text-[9px] pointer-events-none"
                      style={{ color: draft.length > 480 ? '#ef4444' : '#64748b' }}
                    >
                      {500 - draft.length}
                    </span>
                  )}
                </div>

                {/* Send button */}
                <button
                  onClick={handleSend}
                  disabled={!draft.trim() || sendMsg.isPending}
                  className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-all disabled:opacity-30"
                  style={{
                    background: draft.trim()
                      ? 'linear-gradient(135deg, rgba(6,182,212,0.8), rgba(139,92,246,0.8))'
                      : sendBtnIdleBg,
                    border: `1px solid ${sendBtnIdleBorder}`,
                  }}
                  title="Send (Enter)"
                >
                  {sendMsg.isPending
                    ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                    : <Send className="w-3.5 h-3.5 text-white" />
                  }
                </button>
              </div>

              {/* Hint */}
              <p className="text-center text-[9px] pb-2" style={{ color: hintColor }}>
                Enter to send · Shift+Enter for newline
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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

function PeerDetail({ peer, onClose, selfPeerId, reputationScores, pingHistory, sendPeerMessage }: {
  peer: Peer;
  onClose: () => void;
  selfPeerId?: string | null;
  reputationScores?: Record<string, { score: number; successfulSwaps: number; avgLatencyMs: number | null }>;
  pingHistory?: number[];
  sendPeerMessage?: (targetPeerId: string, payload: unknown) => void;
}) {
  const color = latencyColor(peer.latency);
  // Use DB-persisted reputation score if available, fall back to in-memory value
  const dbRep = peer.fullKey ? reputationScores?.[peer.fullKey] : undefined;
  const repScore = dbRep?.score ?? peer.reputation;
  const trust = trustLevel(repScore);

  // When a pair badge is clicked, pre-fill the DM with a trade inquiry template.
  // Using a counter suffix forces the useEffect in PeerChat to re-fire even if the
  // same pair is clicked twice in a row.
  const [pairDraftKey, setPairDraftKey] = useState(0);
  const [pairDraft, setPairDraft] = useState('');

  // Block state
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [blockReason, setBlockReason] = useState<string>('spam');

  // Mute state
  const [showMuteConfirm, setShowMuteConfirm] = useState(false);

  // Report state
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportReason, setReportReason] = useState<string>('spam');
  const [reportDetails, setReportDetails] = useState('');
  const [reportSubmitted, setReportSubmitted] = useState(false);

  // Only relevant for remote peers
  const isRemotePeer = peer.id !== 'self' && !!peer.fullKey && !!selfPeerId;

  // Block queries/mutations
  const { data: blockState, refetch: refetchBlock } = trpc.peerBlocks.isBlocked.useQuery(
    { blockerPeerId: selfPeerId ?? '', blockedPeerId: peer.fullKey ?? '' },
    { enabled: isRemotePeer && !!selfPeerId && !!peer.fullKey }
  );
  const blockMutation = trpc.peerBlocks.block.useMutation({
    onSuccess: () => { refetchBlock(); setShowBlockConfirm(false); },
  });
  const unblockMutation = trpc.peerBlocks.unblock.useMutation({
    onSuccess: () => refetchBlock(),
  });
  const isBlocked = blockState?.blocked ?? false;

  // Mute queries/mutations
  const { data: muteState, refetch: refetchMute } = trpc.peerMutes.isMuted.useQuery(
    { muterPeerId: selfPeerId ?? '', mutedPeerId: peer.fullKey ?? '' },
    { enabled: isRemotePeer && !!selfPeerId && !!peer.fullKey }
  );
  const muteMutation = trpc.peerMutes.mute.useMutation({
    onSuccess: () => { refetchMute(); setShowMuteConfirm(false); },
  });
  const unmuteMutation = trpc.peerMutes.unmute.useMutation({
    onSuccess: () => refetchMute(),
  });
  const isMuted = muteState?.muted ?? false;

  // Report mutation
  const reportMutation = trpc.peerReports.report.useMutation({
    onSuccess: () => {
      setReportSubmitted(true);
      setTimeout(() => { setShowReportForm(false); setReportSubmitted(false); setReportDetails(''); }, 2000);
    },
  });

  const handlePairClick = (pair: string) => {
    if (!selfPeerId || !peer.fullKey || peer.id === 'self') return;
    const [base, quote] = pair.split('/');
    const template = `Hey ${peer.alias}, interested in ${base}/${quote} — are you quoting? What's your rate?`;
    setPairDraft(template);
    setPairDraftKey(k => k + 1);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.2 }}
      className="absolute top-4 right-4 w-80 rounded-2xl z-20 flex flex-col"
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

        {/* Latency Sparkline — shown when there's at least 2 ping history readings */}
        {pingHistory && pingHistory.length >= 2 && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[9px] text-muted-foreground uppercase tracking-widest">Latency History</div>
              <span className="text-[9px] font-mono" style={{ color: latencyColor(pingHistory[pingHistory.length - 1]) }}>
                {pingHistory[pingHistory.length - 1]}ms
              </span>
            </div>
            <div className="flex items-end gap-0.5 h-8">
              {pingHistory.map((ms, idx) => {
                const maxMs = Math.max(...pingHistory, 1);
                const heightPct = Math.max(10, (ms / maxMs) * 100);
                return (
                  <div
                    key={idx}
                    className="flex-1 rounded-sm transition-all duration-300"
                    style={{
                      height: `${heightPct}%`,
                      background: latencyColor(ms),
                      opacity: idx === pingHistory.length - 1 ? 1 : 0.45 + (idx / pingHistory.length) * 0.4,
                    }}
                    title={`${ms}ms`}
                  />
                );
              })}
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[8px] text-muted-foreground/50">oldest</span>
              <span className="text-[8px] text-muted-foreground/50">latest</span>
            </div>
          </div>
        )}

        {/* Multi-chain wallet addresses — shown when peer has broadcast wallet metadata */}
        {peer.walletAddresses && Object.keys(peer.walletAddresses).some(k => peer.walletAddresses![k as keyof typeof peer.walletAddresses]) && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="text-[9px] text-muted-foreground uppercase tracking-widest mb-1.5">Connected Wallets</div>
            <div className="flex flex-col gap-1">
              {peer.walletAddresses.solana && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-mono px-1 py-0.5 rounded" style={{ background: 'rgba(153,69,255,0.15)', color: '#9945FF', border: '1px solid rgba(153,69,255,0.25)' }}>SOL</span>
                  <span className="text-[9px] font-mono text-muted-foreground truncate" title={peer.walletAddresses.solana}>
                    {peer.walletAddresses.solana.slice(0, 8)}...{peer.walletAddresses.solana.slice(-4)}
                  </span>
                </div>
              )}
              {peer.walletAddresses.ethereum && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-mono px-1 py-0.5 rounded" style={{ background: 'rgba(98,126,234,0.15)', color: '#627EEA', border: '1px solid rgba(98,126,234,0.25)' }}>ETH</span>
                  <span className="text-[9px] font-mono text-muted-foreground truncate" title={peer.walletAddresses.ethereum}>
                    {peer.walletAddresses.ethereum.slice(0, 6)}...{peer.walletAddresses.ethereum.slice(-4)}
                  </span>
                </div>
              )}
              {peer.walletAddresses.bitcoin && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-mono px-1 py-0.5 rounded" style={{ background: 'rgba(247,147,26,0.15)', color: '#F7931A', border: '1px solid rgba(247,147,26,0.25)' }}>BTC</span>
                  <span className="text-[9px] font-mono text-muted-foreground truncate" title={peer.walletAddresses.bitcoin}>
                    {peer.walletAddresses.bitcoin.slice(0, 8)}...{peer.walletAddresses.bitcoin.slice(-4)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-border">
          <div className="text-[9px] text-muted-foreground uppercase tracking-widest mb-1.5">Active Pairs</div>
          <div className="flex flex-wrap gap-1">
            {peer.pairs.map(pair => {
              const isClickable = peer.id !== 'self' && !!peer.fullKey && !!selfPeerId;
              return (
                <button
                  key={pair}
                  onClick={() => isClickable && handlePairClick(pair)}
                  title={isClickable ? `Message ${peer.alias} about ${pair}` : pair}
                  className="px-1.5 py-0.5 rounded text-[9px] font-mono transition-all"
                  style={{
                    background: "rgba(6,182,212,0.1)",
                    border: "1px solid rgba(6,182,212,0.2)",
                    color: "rgba(6,182,212,0.8)",
                    cursor: isClickable ? 'pointer' : 'default',
                  }}
                  onMouseEnter={e => { if (isClickable) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(6,182,212,0.22)'; }}
                  onMouseLeave={e => { if (isClickable) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(6,182,212,0.1)'; }}
                >
                  {pair}
                </button>
              );
            })}
          </div>
          {peer.id !== 'self' && !!peer.fullKey && !!selfPeerId && (
            <p className="text-[8px] text-muted-foreground/50 mt-1">
              Click a pair to send a quick trade inquiry
            </p>
          )}
        </div>

        {/* Direct Message — only for remote peers when own wallet is connected */}
        {peer.id !== 'self' && peer.fullKey && selfPeerId && (
          <PeerChat
            key={pairDraftKey}
            myPeerId={selfPeerId}
            otherPeerId={peer.fullKey}
            otherAlias={peer.alias}
            initialDraft={pairDraft}
            autoOpen={pairDraft !== ''}
            sendPeerMessage={sendPeerMessage}
          />
        )}
        {/* Copy Invite Link — only for remote peers with a fullKey */}
        {peer.id !== 'self' && peer.fullKey && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="text-[9px] text-muted-foreground uppercase tracking-widest mb-1.5">Share</div>
            <CopyInviteLinkButton peerId={peer.fullKey} />
          </div>
        )}
        {/* Mute / Unmute — only for remote peers */}
        {isRemotePeer && (
          <div className="mt-3 pt-3 border-t border-border">
            {!showMuteConfirm ? (
              <button
                onClick={() => isMuted
                  ? unmuteMutation.mutate({ muterPeerId: selfPeerId!, mutedPeerId: peer.fullKey! })
                  : setShowMuteConfirm(true)
                }
                disabled={muteMutation.isPending || unmuteMutation.isPending}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
                style={{
                  background: isMuted ? 'rgba(6,182,212,0.08)' : 'rgba(100,116,139,0.08)',
                  border: `1px solid ${isMuted ? 'rgba(6,182,212,0.25)' : 'rgba(100,116,139,0.2)'}`,
                  color: isMuted ? '#06b6d4' : '#94a3b8',
                }}
              >
                {isMuted
                  ? <><Bell className="w-3 h-3" /> Unmute Peer</>
                  : <><BellOff className="w-3 h-3" /> Mute Peer</>}
              </button>
            ) : (
              <div className="rounded-lg p-2.5" style={{ background: 'rgba(100,116,139,0.08)', border: '1px solid rgba(100,116,139,0.2)' }}>
                <p className="text-[9px] text-muted-foreground mb-2 leading-relaxed">
                  Mute <span className="font-bold text-foreground">{peer.alias}</span>? Their messages will still arrive but you won't see notifications or badges.
                </p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => muteMutation.mutate({ muterPeerId: selfPeerId!, mutedPeerId: peer.fullKey! })}
                    disabled={muteMutation.isPending}
                    className="flex-1 py-1 rounded text-[9px] font-semibold transition-all"
                    style={{ background: '#64748b', color: '#fff' }}
                  >
                    {muteMutation.isPending ? 'Muting…' : 'Confirm Mute'}
                  </button>
                  <button
                    onClick={() => setShowMuteConfirm(false)}
                    className="flex-1 py-1 rounded text-[9px] font-semibold transition-all"
                    style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--muted-foreground)' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Block / Unblock — only for remote peers */}
        {isRemotePeer && (
          <div className="mt-1">
            {!showBlockConfirm ? (
              <button
                onClick={() => isBlocked ? unblockMutation.mutate({ blockerPeerId: selfPeerId!, blockedPeerId: peer.fullKey! }) : setShowBlockConfirm(true)}
                disabled={blockMutation.isPending || unblockMutation.isPending}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
                style={{
                  background: isBlocked ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.08)',
                  border: `1px solid ${isBlocked ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.2)'}`,
                  color: isBlocked ? '#10b981' : '#ef4444',
                }}
              >
                {isBlocked ? '✓ Unblock Peer' : '⊘ Block Peer'}
              </button>
            ) : (
              <div className="rounded-lg p-2.5" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <p className="text-[9px] text-red-400 mb-2 leading-relaxed">
                  Block <span className="font-bold">{peer.alias}</span>? They won't be able to send you messages.
                </p>
                {/* Reason dropdown */}
                <div className="mb-2">
                  <label className="text-[8px] text-muted-foreground uppercase tracking-widest mb-1 block">Reason</label>
                  <select
                    value={blockReason}
                    onChange={e => setBlockReason(e.target.value)}
                    className="w-full px-2 py-1 rounded text-[9px] text-foreground outline-none"
                    style={{ background: 'var(--background)', border: '1px solid rgba(239,68,68,0.3)' }}
                  >
                    <option value="spam">Spam</option>
                    <option value="suspicious_activity">Suspicious activity</option>
                    <option value="harassment">Harassment</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => blockMutation.mutate({ blockerPeerId: selfPeerId!, blockedPeerId: peer.fullKey!, reason: blockReason })}
                    disabled={blockMutation.isPending}
                    className="flex-1 py-1 rounded text-[9px] font-semibold transition-all"
                    style={{ background: '#ef4444', color: '#fff' }}
                  >
                    {blockMutation.isPending ? 'Blocking…' : 'Confirm Block'}
                  </button>
                  <button
                    onClick={() => setShowBlockConfirm(false)}
                    className="flex-1 py-1 rounded text-[9px] font-semibold transition-all"
                    style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--muted-foreground)' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Report Peer — only for remote peers */}
        {isRemotePeer && (
          <div className="mt-1">
            {!showReportForm ? (
              <button
                onClick={() => setShowReportForm(true)}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
                style={{
                  background: 'rgba(245,158,11,0.06)',
                  border: '1px solid rgba(245,158,11,0.18)',
                  color: '#f59e0b',
                }}
              >
                <Flag className="w-3 h-3" /> Report Peer
              </button>
            ) : reportSubmitted ? (
              <div className="rounded-lg p-2.5 text-center" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
                <p className="text-[9px] text-emerald-400 font-semibold">✓ Report submitted. Thank you.</p>
              </div>
            ) : (
              <div className="rounded-lg p-2.5" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.18)' }}>
                <p className="text-[9px] text-amber-400 mb-2 leading-relaxed font-semibold">
                  Report <span className="font-bold">{peer.alias}</span>
                </p>
                <div className="mb-2">
                  <label className="text-[8px] text-muted-foreground uppercase tracking-widest mb-1 block">Reason</label>
                  <select
                    value={reportReason}
                    onChange={e => setReportReason(e.target.value)}
                    className="w-full px-2 py-1 rounded text-[9px] text-foreground outline-none"
                    style={{ background: 'var(--background)', border: '1px solid rgba(245,158,11,0.3)' }}
                  >
                    <option value="spam">Spam</option>
                    <option value="suspicious_activity">Suspicious activity</option>
                    <option value="fake_quotes">Fake quotes / price manipulation</option>
                    <option value="harassment">Harassment</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="mb-2">
                  <label className="text-[8px] text-muted-foreground uppercase tracking-widest mb-1 block">Details (optional)</label>
                  <textarea
                    value={reportDetails}
                    onChange={e => setReportDetails(e.target.value)}
                    placeholder="Describe the issue…"
                    maxLength={500}
                    rows={2}
                    className="w-full px-2 py-1 rounded text-[9px] text-foreground placeholder:text-muted-foreground/50 outline-none resize-none"
                    style={{ background: 'var(--background)', border: '1px solid rgba(245,158,11,0.3)' }}
                  />
                  <div className="text-[8px] text-muted-foreground/50 text-right">{reportDetails.length}/500</div>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => reportMutation.mutate({
                      reporterPeerId: selfPeerId!,
                      reportedPeerId: peer.fullKey!,
                      reason: reportReason as 'spam' | 'suspicious_activity' | 'fake_quotes' | 'harassment' | 'other',
                      details: reportDetails || undefined,
                    })}
                    disabled={reportMutation.isPending}
                    className="flex-1 py-1 rounded text-[9px] font-semibold transition-all"
                    style={{ background: '#f59e0b', color: '#000' }}
                  >
                    {reportMutation.isPending ? 'Submitting…' : 'Submit Report'}
                  </button>
                  <button
                    onClick={() => { setShowReportForm(false); setReportDetails(''); }}
                    className="flex-1 py-1 rounded text-[9px] font-semibold transition-all"
                    style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--muted-foreground)' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
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
  const activeChannels = channels.filter(c => c.active).length;
  const totalVolume = peers.reduce((s, p) => s + p.volume24h, 0);
  const onlineRemote = peers.filter(p => p.id !== "self" && p.online);
  const avgLatency = onlineRemote.length > 0
    ? Math.round(onlineRemote.reduce((s, p) => s + p.latency, 0) / onlineRemote.length)
    : 0;
  // Live signaling peer count from the real signaling server registry
  const { data: signalingPeers } = trpc.chat.getPeerList.useQuery(undefined, {
    refetchInterval: 10_000,
    staleTime: 8_000,
  });
  const liveOnlineCount = signalingPeers?.length ?? 0;
  const totalPeers = Math.max(peers.length, liveOnlineCount);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      {[
        { label: "Online Peers", value: `${liveOnlineCount}/${totalPeers}`, icon: Users, color: "#10b981" },
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

function PeerList({ peers, selectedId, onSelect, pingResults, onPing, reputationScores, onInvite, onCopyInviteLink, unreadByPeer, blockedPeerIds, mutedPeerIds }: {
  peers: Peer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  pingResults: Record<string, { latencyMs: number | null; loading: boolean }>;
  onPing: (peerId: string, fullKey: string) => void;
  reputationScores: Record<string, { score: number; successfulSwaps: number; avgLatencyMs: number | null }> | undefined;
  onInvite?: (peerId: string, alias: string) => void;
  onCopyInviteLink?: (peerId: string) => void;
  unreadByPeer?: Record<string, { count: number; snippet: string }>;
  blockedPeerIds?: Set<string>;
  mutedPeerIds?: Set<string>;
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
          const unread = peer.fullKey ? unreadByPeer?.[peer.fullKey] : undefined;
          const isBlockedPeer = peer.fullKey ? blockedPeerIds?.has(peer.fullKey) : false;
          const isMutedPeer = peer.fullKey ? mutedPeerIds?.has(peer.fullKey) : false;
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
                          : 'AFOS P2P DHT — Browser Light Peer · Wallet-connected · Supports P2P RFQ and HTLC atomic swaps'
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
                    {unread && unread.count > 0 && (
                      <span
                        className="inline-flex items-center justify-center min-w-[14px] h-3.5 px-1 rounded-full text-[8px] font-bold shrink-0 animate-pulse"
                        title={`${unread.count} unread message${unread.count > 1 ? 's' : ''}: "${unread.snippet}"`}
                        style={{
                          background: 'rgba(6,182,212,0.9)',
                          color: '#000',
                        }}
                      >{unread.count > 9 ? '9+' : unread.count}</span>
                    )}
                    {isBlockedPeer && (
                      <span
                        className="inline-flex items-center justify-center h-3.5 px-1 rounded text-[8px] font-bold shrink-0"
                        title="You have blocked this peer — they cannot send you messages"
                        style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)', color: '#ef4444' }}
                      >
                        🔒 blocked
                      </span>
                    )}
                    {isMutedPeer && !isBlockedPeer && (
                      <span
                        className="inline-flex items-center justify-center h-3.5 px-1 rounded text-[8px] font-bold shrink-0"
                        title="You have muted this peer — their messages arrive silently"
                        style={{ background: 'rgba(100,116,139,0.15)', border: '1px solid rgba(100,116,139,0.35)', color: '#94a3b8' }}
                      >
                        🔕 muted
                      </span>
                    )}
                  </div>
                  <div className="text-[9px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                    <span>{peer.channels}ch</span>
                    <span className="text-muted-foreground/40">·</span>
                    <span>{peer.pairs[0] || '—'}</span>
                    {/* Chain icons — shown when peer has broadcast wallet addresses */}
                    {peer.walletAddresses && (
                      <>
                        {peer.walletAddresses.solana && (
                          <span className="text-[8px] font-mono px-0.5 rounded" style={{ color: '#9945FF', background: 'rgba(153,69,255,0.12)', border: '1px solid rgba(153,69,255,0.2)' }} title={`SOL: ${peer.walletAddresses.solana}`}>SOL</span>
                        )}
                        {peer.walletAddresses.ethereum && (
                          <span className="text-[8px] font-mono px-0.5 rounded" style={{ color: '#627EEA', background: 'rgba(98,126,234,0.12)', border: '1px solid rgba(98,126,234,0.2)' }} title={`ETH: ${peer.walletAddresses.ethereum}`}>ETH</span>
                        )}
                        {peer.walletAddresses.bitcoin && (
                          <span className="text-[8px] font-mono px-0.5 rounded" style={{ color: '#F7931A', background: 'rgba(247,147,26,0.12)', border: '1px solid rgba(247,147,26,0.2)' }} title={`BTC: ${peer.walletAddresses.bitcoin}`}>₿</span>
                        )}
                      </>
                    )}
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
                <p className="text-[9px] text-muted-foreground/60 mt-1">Scanning Hyperswarm + AFOS P2P DHT...</p>
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

function EmptyTopology({ lightPeerOnline, lightPeerId, lpEnabled, signalingConnected, signalingRemotePeers, directPeerCount, onConnectWallet, onNavigateToSettings }: {
  lightPeerOnline: boolean;
  lightPeerId: string | null;
  lpEnabled: boolean;
  signalingConnected: boolean;
  signalingRemotePeers: { peerId: string }[];
  directPeerCount: number;
  onConnectWallet?: () => void;
  onNavigateToSettings?: () => void;
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

      {/* LP Mode disabled — user has a peerId but hasn't opted in as LP */}
      {lightPeerId && !lpEnabled && !lightPeerOnline && (
        <div className="mb-4 px-4 py-3 rounded-xl text-center w-full max-w-xs"
          style={{ background: "rgba(100,116,139,0.08)", border: "1px solid rgba(100,116,139,0.25)" }}>
          <div className="flex items-center gap-2 justify-center mb-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            <span className="text-[11px] font-bold text-slate-400">LP Mode is off</span>
          </div>
          <p className="text-[10px] text-slate-500 mb-2">
            You are not broadcasting as a liquidity provider. Enable LP Mode in Agent Settings to respond to peer RFQs and appear in the Order Book.
          </p>
          <button
            onClick={() => onNavigateToSettings?.()}
            className="inline-block px-3 py-1.5 rounded-lg text-[10px] font-bold font-mono transition-all hover:opacity-90 active:scale-95 cursor-pointer"
            style={{ background: "rgba(100,116,139,0.15)", border: "1px solid rgba(100,116,139,0.35)", color: "#94a3b8" }}>
            Open Agent Settings
          </button>
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
            <div className="text-[10px] font-mono font-bold" style={{ color: lightPeerOnline ? "#06b6d4" : "#64748b" }}>AFOS P2P DHT</div>
            <div className="text-[9px]" style={{ color: lightPeerOnline ? "rgba(6,182,212,0.6)" : "rgba(100,116,139,0.6)" }}>
              {lightPeerOnline ? `Light Peer · ${lightPeerId?.slice(0, 12)}… · Active` : "Enable LP Mode to activate"}
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
                : lightPeerOnline ? "Connecting…" : "Enable LP Mode to activate"}
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
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
        <h2 className="text-sm font-bold text-foreground">Peer Reputation Leaderboard</h2>
        <span className="text-[10px] font-mono text-muted-foreground ml-auto shrink-0">{data.length} tracked</span>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Scores persist across sessions. Successful pings improve a peer's score; failures reduce it.
      </p>

      {/* ── Mobile: card list ── */}
      <div className="sm:hidden space-y-2">
        {data.map((entry, idx) => {
          const trust = trustLevel(entry.score);
          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;
          return (
            <div
              key={entry.peerId}
              className="rounded-xl px-3 py-2.5 flex items-center gap-3"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}
            >
              {/* Rank */}
              <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold font-mono"
                style={{
                  background: medal ? `${trust.color}18` : "var(--muted)",
                  border: `1px solid ${medal ? `${trust.color}35` : "var(--border)"}`,
                  color: medal ? trust.color : "var(--muted-foreground)",
                }}>
                {medal ?? idx + 1}
              </div>

              {/* Peer info */}
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-mono font-semibold text-foreground truncate">
                  {entry.alias || `${entry.peerId.slice(0, 14)}…`}
                </div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-[9px] font-mono text-muted-foreground">
                    {entry.origin}
                  </span>
                  <span className="text-[9px] text-muted-foreground/60">·</span>
                  <span className="text-[9px] font-mono text-muted-foreground">
                    {new Date(entry.lastSeenAt).toLocaleDateString()}
                  </span>
                  {entry.successfulSwaps > 0 && (
                    <>
                      <span className="text-[9px] text-muted-foreground/60">·</span>
                      <span className="text-[9px] font-mono text-emerald-400">{entry.successfulSwaps} swaps</span>
                    </>
                  )}
                  {entry.avgLatencyMs != null && (
                    <>
                      <span className="text-[9px] text-muted-foreground/60">·</span>
                      <span className="text-[9px] font-mono text-cyan-400">{entry.avgLatencyMs}ms</span>
                    </>
                  )}
                </div>
              </div>

              {/* Score badge */}
              <div className="shrink-0 text-right">
                <div
                  className="text-[13px] font-bold font-mono px-2 py-0.5 rounded-lg"
                  style={{
                    background: `${trust.color}18`,
                    border: `1px solid ${trust.color}40`,
                    color: trust.color,
                  }}
                >{entry.score}</div>
                <div className="text-[9px] mt-0.5 font-medium" style={{ color: trust.color }}>{trust.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Desktop: table ── */}
      <div className="hidden sm:block rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        {/* Table header */}
        <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 px-4 py-2 border-b text-[9px] font-mono text-muted-foreground uppercase tracking-widest"
          style={{ borderColor: "var(--border)" }}>
          <span>#</span>
          <span>Peer</span>
          <span className="text-right">Score</span>
          <span className="text-right">Swaps</span>
          <span className="text-right">Avg Latency</span>
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
                <div className="text-right shrink-0">
                  <div className="text-[10px] font-mono text-foreground">{entry.successfulSwaps}</div>
                  <div className="text-[8px] text-muted-foreground">swaps</div>
                </div>
                <div className="text-right shrink-0">
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

export default function NetworkPage({ invitePeerId, onInvitePeerHandled, onNavigateToSettings }: {
  invitePeerId?: string | null;
  onInvitePeerHandled?: () => void;
  onNavigateToSettings?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"topology" | "channels" | "invites" | "leaderboard">("topology");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pulseIds, setPulseIds] = useState<Set<string>>(new Set());
  const [liveChannels, setLiveChannels] = useState<Channel[]>([]);
  const [livePeers, setLivePeers] = useState<Peer[]>([]);
  const [lastActivity, setLastActivity] = useState<string>("Scanning P2P network...");
  // Liquidity Channels — wired to Oracle VM /api/channels
  const [liquidityChannels, setLiquidityChannels] = useState<LiquidityChannel[]>([]);
  const [openChannelForm, setOpenChannelForm] = useState(false);
  const [newChannel, setNewChannel] = useState({ peer: "", capacity: "", chain: "SOL" as "BTC" | "ETH" | "SOL" | "TNK", feeRate: "100" });
  const [channelSubmitting, setChannelSubmitting] = useState(false);
  // Ping state
  const [pingResults, setPingResults] = useState<Record<string, { latencyMs: number | null; loading: boolean; history: number[] }>>({}); 
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

  // ── Notification preferences from Settings ─────────────────────────────────
  // settings.get is a publicProcedure — works for both authed and unauthed users.
  const { data: userSettings } = trpc.settings.get.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const notifyIncomingDm   = userSettings ? (userSettings as Record<string, unknown>).notifyIncomingDm  !== false : true;
  const notifyUnreadBadge  = userSettings ? (userSettings as Record<string, unknown>).notifyUnreadBadge !== false : true;
  const notifyTradeInquiry = userSettings ? (userSettings as Record<string, unknown>).notifyTradeInquiry !== false : true;
  const graphDensity = userSettings ? (typeof (userSettings as Record<string, unknown>).graphDensity === 'number' ? (userSettings as Record<string, unknown>).graphDensity as number : 1.0) : 1.0;

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

  // ── HTLC Escrow Wallets — for the Escrow Wallets card in the sidebar ────────
  const { data: htlcWalletsData } = trpc.htlcWallet.getHtlcWallets.useQuery(undefined, {
    refetchInterval: 120_000, // refresh every 2 min
    staleTime: 60_000,
  });

  // ── Unread Messages by Sender ─────────────────────────────────────────────
  // Poll every 10s to know which peers have sent unread messages.
  // We use lightPeer.peerId as our own peer ID (wallet-derived).
  const { data: unreadBySenderRaw = [] } = trpc.peerMessages.unreadBySender.useQuery(
    { myPeerId: lightPeer.peerId! },
    { enabled: !!lightPeer.peerId, refetchInterval: 10_000 }
  );

  // Blocked peers list — used to show visual indicators on nodes
  const { data: blockedPeersRaw = [], refetch: refetchBlocked } = trpc.peerBlocks.listBlocked.useQuery(
    { blockerPeerId: lightPeer.peerId! },
    { enabled: !!lightPeer.peerId, refetchInterval: 30_000 }
  );
  const blockedPeerIds = useMemo(() => new Set(blockedPeersRaw.map(b => b.blockedPeerId)), [blockedPeersRaw]);

  // Muted peers list — used to suppress notifications/badges without blocking
  const { data: mutedPeersRaw = [] } = trpc.peerMutes.listMuted.useQuery(
    { muterPeerId: lightPeer.peerId! },
    { enabled: !!lightPeer.peerId, refetchInterval: 30_000 }
  );
  const mutedPeerIds = useMemo(() => new Set(mutedPeersRaw.map(m => m.mutedPeerId)), [mutedPeersRaw]);

  // Build a lookup: fullKey → { count, snippet } — exclude muted peers from badges
  const unreadByPeer = useMemo(() => {
    const map: Record<string, { count: number; snippet: string }> = {};
    for (const entry of unreadBySenderRaw) {
      // Still track unread count but skip badge for muted peers or when badge is disabled
      if (!mutedPeerIds.has(entry.fromPeerId) && notifyUnreadBadge) {
        map[entry.fromPeerId] = { count: entry.count, snippet: entry.snippet };
      }
    }
    return map;
  }, [unreadBySenderRaw, mutedPeerIds, notifyUnreadBadge]);

  // Fire a toast when a new unread message arrives from a peer we haven't toasted yet.
  // Skip toasts for muted peers.
  const prevUnreadRef = useRef<Record<string, number>>({});
  useEffect(() => {
    const prev = prevUnreadRef.current;
    for (const entry of unreadBySenderRaw) {
      const prevCount = prev[entry.fromPeerId] ?? 0;
      if (entry.count > prevCount && !mutedPeerIds.has(entry.fromPeerId) && notifyIncomingDm) {
        // Find the peer's alias from livePeers
        const senderPeer = livePeers.find(p => p.fullKey === entry.fromPeerId);
        const alias = senderPeer?.alias ?? entry.fromPeerId.slice(0, 12);
        toast.message(`💬 Message from ${alias}`, {
          description: entry.snippet,
          action: {
            label: 'View',
            onClick: () => {
              setActiveTab('topology');
              if (senderPeer) setSelectedId(senderPeer.id);
            },
          },
          duration: 8000,
        });
      }
    }
    // Update prev counts
    const next: Record<string, number> = {};
    for (const entry of unreadBySenderRaw) next[entry.fromPeerId] = entry.count;
    prevUnreadRef.current = next;
  }, [unreadBySenderRaw, livePeers, setActiveTab, mutedPeerIds, notifyIncomingDm]);

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
    const wa: Peer['walletAddresses'] = {};
    if (lightPeer.solanaAddress) wa.solana = lightPeer.solanaAddress;
    if (lightPeer.ethereumAddress) wa.ethereum = lightPeer.ethereumAddress;
    if (lightPeer.bitcoinAddress) wa.bitcoin = lightPeer.bitcoinAddress;
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
      walletAddresses: Object.keys(wa).length > 0 ? wa : undefined,
    };
  }, [lightPeer.isOnline, lightPeer.peerAlias, lightPeer.totalVolumeUsd, lightPeer.prefs?.acceptedPairs, lightPeer.solanaAddress, lightPeer.ethereumAddress, lightPeer.bitcoinAddress]);

  /** Convert Oracle VM peers to our Peer type */
  const convertOraclePeers = useCallback((oraclePeers: OraclePeer[]): Peer[] => {
    return oraclePeers.map((op, index) => {
      const pos = peerPosition(op.publicKey, index, oraclePeers.length, graphDensity);
      return {
        id: op.publicKey.slice(0, 16),
        alias: `Node-${op.shortKey.slice(0, 8)}`,
        region: "Hyperswarm",
        lat: pos.lat,
        lng: pos.lng,
        latency: 0, // Real latency not available from Hyperswarm; shown as N/A in UI
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
  }, [graphDensity]);
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
              const pos = peerPosition(rp.peerId, remotePeers.length + index, remotePeers.length + (relayData.hyperswarmPeers.length + relayData.lightPeers.length), graphDensity);
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
          const pos = peerPosition(sp.peerId, remotePeers.length + lightPeers.length + index, remotePeers.length + lightPeers.length + totalSig, graphDensity);
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
            walletAddresses: sp.walletAddresses,
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
   }, [buildSelfPeer, convertOraclePeers, buildChannels, lightPeer.peerId, lightPeer.remotePeers, graphDensity]);
  /** Ping a remote peer, update latency display, and persist result to reputation DB */
  const handlePing = useCallback(async (peerId: string, fullKey: string, silent = false) => {
    setPingResults(prev => ({ ...prev, [peerId]: { latencyMs: null, loading: true, history: prev[peerId]?.history ?? [] } }));
    const peer = livePeers.find(p => p.id === peerId);
    // Route to correct ping endpoint based on peer origin:
    // - 'intercomswap' (signaling/light peers) → local signaling server
    // - 'hyperswarm' or undefined → Oracle VM
    const isSignalingPeer = peer?.origin === 'intercomswap';
    try {
      const result = isSignalingPeer
        ? await pingSignalingPeer(fullKey)
        : await pingPeer(fullKey);
      setPingResults(prev => {
        const prevHistory = prev[peerId]?.history ?? [];
        const newHistory = result.latencyMs !== null
          ? [...prevHistory, result.latencyMs].slice(-10) // keep last 10 readings
          : prevHistory;
        return { ...prev, [peerId]: { latencyMs: result.latencyMs, loading: false, history: newHistory } };
      });
      // Update the peer's latency in livePeers so the topology canvas reflects the real RTT
      if (result.success && result.latencyMs !== null) {
        setLivePeers(prev => prev.map(p =>
          p.id === peerId ? { ...p, latency: result.latencyMs! } : p
        ));
      }
      // Persist ping result to reputation DB
      recordPingMutation.mutate({
        peerId: fullKey,
        alias: peer?.alias,
        origin: isSignalingPeer ? 'intercomswap' : 'hyperswarm',
        latencyMs: result.success ? result.latencyMs : null,
      }, {
        onSuccess: () => refetchReputation(),
      });
      if (!silent) {
        if (result.success && result.latencyMs !== null) {
          toast.success(`Ping: ${result.latencyMs}ms${result.estimated ? ' (estimated)' : ''}`);
        } else {
          toast.error(result.error || 'Ping failed');
        }
      }
    } catch {
      setPingResults(prev => ({ ...prev, [peerId]: { latencyMs: null, loading: false, history: prev[peerId]?.history ?? [] } }));
      // Record failed ping
      recordPingMutation.mutate({ peerId: fullKey, alias: peer?.alias, origin: isSignalingPeer ? 'intercomswap' : 'hyperswarm', latencyMs: null });
      if (!silent) {
        toast.error('Ping request failed');
      }
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

  // ── Auto-ping new signaling peers on connect ─────────────────────────────
  // Track which peers have already been auto-pinged so we don't re-ping on every poll cycle.
  const autoPingedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // Find signaling peers that haven't been auto-pinged yet
    const newPeers = livePeers.filter(p =>
      p.id !== 'self' &&
      p.online &&
      p.origin === 'intercomswap' &&
      p.fullKey &&
      !autoPingedRef.current.has(p.fullKey)
    );
    if (newPeers.length === 0) return;
    // Mark them as pinged immediately to avoid duplicate pings
    newPeers.forEach(p => autoPingedRef.current.add(p.fullKey!));
    // Stagger pings by 500ms to avoid overwhelming the signaling server
    newPeers.forEach((p, idx) => {
      setTimeout(() => {
        handlePing(p.id, p.fullKey!, true); // silent = true (no toast)
      }, idx * 500);
    });
  }, [livePeers, handlePing]);

  // ── Periodic re-ping every 30s ─────────────────────────────────────────────
  // Keep latency values fresh for all connected intercomswap peers.
  useEffect(() => {
    const interval = setInterval(() => {
      const connectedPeers = livePeers.filter(p =>
        p.id !== 'self' &&
        p.online &&
        p.origin === 'intercomswap' &&
        p.fullKey
      );
      connectedPeers.forEach((p, idx) => {
        setTimeout(() => {
          handlePing(p.id, p.fullKey!, true); // silent = true (no toast)
        }, idx * 600); // stagger by 600ms
      });
    }, 30_000); // every 30 seconds
    return () => clearInterval(interval);
  }, [livePeers, handlePing]);

  return (
    <div className="flex-1 flex flex-col overflow-y-auto sm:overflow-hidden p-3 sm:p-6 pb-safe" style={{ background: "transparent" }}>
      <div className="max-w-[1280px] mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-foreground tracking-tight">P2P Network</h1>
          <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">
            Hyperswarm DHT + AFOS P2P DHT · Dual-layer P2P · Atomic swap channels
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
          {/* AFOS P2P DHT badge — reflects Light Peer status */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
            title={lightPeer.isOnline ? "AFOS P2P DHT — Light Peer connected" : "AFOS P2P DHT — Light Peer offline"}
            style={{
              background: lightPeer.isOnline ? "rgba(6,182,212,0.1)" : "rgba(100,116,139,0.1)",
              border: `1px solid ${lightPeer.isOnline ? "rgba(6,182,212,0.25)" : "rgba(100,116,139,0.2)"}`,
            }}>
            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: lightPeer.isOnline ? "#06b6d4" : "#64748b" }} />
            <span className="text-[10px] font-mono hidden sm:inline" style={{ color: lightPeer.isOnline ? "#06b6d4" : "#64748b" }}>IntercomSwap</span>
            <span className="text-[10px] font-mono sm:hidden" style={{ color: lightPeer.isOnline ? "#06b6d4" : "#64748b" }}>IS</span>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <Shield className="w-3 h-3 text-cyan-400" />
            <span className="text-[10px] font-mono text-cyan-400">Non-custodial</span>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 p-1 rounded-xl" style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
        {([
          { id: "topology", label: "Topology", shortLabel: "Nodes", icon: <Activity className="w-3.5 h-3.5" /> },
          { id: "channels", label: "Liquidity Channels", shortLabel: "Channels", icon: <GitBranch className="w-3.5 h-3.5" /> },
          { id: "invites", label: "Invites", shortLabel: "Invites", icon: <Mail className="w-3.5 h-3.5" /> },
          { id: "leaderboard", label: "Reputation", shortLabel: "Rep", icon: <Trophy className="w-3.5 h-3.5" /> },
        ] as const).map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className="flex-1 flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 py-2 rounded-lg text-[10px] sm:text-xs font-semibold transition-all min-w-0"
            style={{
              background: activeTab === tab.id ? "var(--card)" : "transparent",
              color: activeTab === tab.id ? "var(--foreground)" : "var(--muted-foreground)",
              boxShadow: activeTab === tab.id ? "0 1px 4px rgba(0,0,0,0.2)" : "none",
            }}>
            {tab.icon}
            <span className="sm:hidden leading-none">{tab.shortLabel}</span>
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
                      onChange={e => setNewChannel(prev => ({ ...prev, chain: e.target.value as "BTC" | "ETH" | "SOL" | "TNK" }))}
                      className="w-full px-3 py-2 rounded-lg text-xs text-foreground outline-none"
                      style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                      <option value="SOL">Solana (SOL)</option>
                      <option value="ETH">Ethereum (ETH)</option>
                      <option value="BTC">Bitcoin (BTC)</option>
                      <option value="TNK">Trac Network (TNK)</option>
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
            const chainColors: Record<string, string> = { BTC: '#f7931a', ETH: '#627eea', SOL: '#14f195', TNK: '#f97316' };
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
                const code = `AFOS-${crypto.randomUUID().replace(/-/g,'').slice(0,6).toUpperCase()}-SWAP`;
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
      <div className="flex-1 flex flex-col min-h-0">
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
          lpEnabled={lightPeer.prefs?.enabled ?? false}
          signalingConnected={lightPeer.signalingConnected}
          signalingRemotePeers={lightPeer.remotePeers}
          directPeerCount={lightPeer.directPeerCount}
          onConnectWallet={() => window.dispatchEvent(new CustomEvent('afos:open-wallet'))}
          onNavigateToSettings={onNavigateToSettings}
        />
      )}

      {/* Mobile peer list — shown only on small screens */}
      {!loading && (
      <div className="sm:hidden space-y-2 mb-4">

        {/* ── Mini stats bar ── */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {[
            { label: "Online", value: `${livePeers.filter(p => p.id !== "self" && p.online).length}/${livePeers.filter(p => p.id !== "self").length}`, color: "#10b981" },
            { label: "Channels", value: liveChannels.filter(c => c.active).length, color: "#06b6d4" },
            { label: "Avg ms", value: (() => { const latencies = livePeers.filter(p => p.id !== "self" && p.online).map(p => pingResults[p.id]?.latencyMs ?? p.latency).filter(Boolean); return latencies.length ? `${Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)}ms` : "—"; })(), color: "#f59e0b" },
          ].map(stat => (
            <div key={stat.label} className="rounded-xl px-3 py-2 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="text-[13px] font-bold font-mono" style={{ color: stat.color }}>{stat.value}</div>
              <div className="text-[9px] text-muted-foreground mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Self peer card on mobile */}
        {livePeers.filter(p => p.id === "self").map(peer => (
          <div key={peer.id} className="rounded-xl px-3 py-2.5"
            style={{ background: "rgba(6,182,212,0.04)", border: "1px solid rgba(6,182,212,0.15)" }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                {/* Animated pulse for self node */}
                <div className="relative shrink-0">
                  <div className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                  <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-cyan-400/40 animate-ping" style={{ animationDuration: "2s" }} />
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-cyan-600 dark:text-cyan-300 truncate flex items-center gap-1.5">
                    {peer.alias}
                    <span className="text-[8px] px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/25 text-cyan-600 dark:text-cyan-400 font-bold tracking-wide">YOU</span>
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground truncate">
                    {oracleNodeKey ? `${oracleNodeKey.slice(0, 16)}…` : "Local node"}
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0 ml-2">
                <div className="text-[11px] font-mono font-semibold text-cyan-400">local</div>
                <div className="text-[9px] text-muted-foreground">{peer.channels} ch</div>
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
          const repEntry = peer.fullKey ? reputationData?.[peer.fullKey] : undefined;
          const repScore = repEntry?.score ?? null;
          const isMuted = mutedPeerIds.has(peer.id);
          const isBlocked = blockedPeerIds.has(peer.id);
          return (
            <motion.div
              key={peer.id}
              onClick={() => setSelectedId(prev => prev === peer.id ? null : peer.id)}
              className="rounded-xl cursor-pointer transition-all overflow-hidden"
              animate={{ scale: isSelected ? 0.99 : 1 }}
              style={{
                background: isSelected ? "rgba(15,15,25,0.95)" : "var(--card)",
                border: `1px solid ${isSelected ? "rgba(139,92,246,0.55)" : isBlocked ? "rgba(239,68,68,0.25)" : "var(--border)"}`,
                boxShadow: isSelected ? "0 0 0 1px rgba(139,92,246,0.15), 0 4px 24px rgba(139,92,246,0.12)" : undefined,
                opacity: isBlocked ? 0.6 : 1,
              }}
            >
              {/* Main row */}
              <div className="flex items-center gap-2.5 px-3 py-2.5">
                {/* Status dot */}
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: peer.online ? color : "#ef4444" }} />

                {/* Peer identity */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[13px] font-bold text-foreground font-mono truncate max-w-[140px]">{peer.alias}</span>
                    <span
                      className="text-[8px] px-1.5 py-0.5 rounded font-bold font-mono shrink-0"
                      style={{
                        background: peer.origin === 'hyperswarm' ? 'rgba(16,185,129,0.12)' : 'rgba(6,182,212,0.12)',
                        border: `1px solid ${peer.origin === 'hyperswarm' ? 'rgba(16,185,129,0.3)' : 'rgba(6,182,212,0.3)'}`,
                        color: peer.origin === 'hyperswarm' ? '#10b981' : '#06b6d4',
                      }}
                    >{peer.origin === 'hyperswarm' ? 'HW' : 'IS'}</span>
                    {isMuted && <span title="Muted"><BellOff className="w-3 h-3 text-slate-400 shrink-0" /></span>}
                    {isBlocked && <span title="Blocked"><Shield className="w-3 h-3 text-red-400 shrink-0" /></span>}
                  </div>
                  {/* Meta row: latency · channels · rep score */}
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[10px] font-mono font-semibold" style={{ color: peer.online ? color : "#64748b" }}>
                      {pingState?.loading
                        ? <Loader2 className="w-2.5 h-2.5 animate-spin inline" />
                        : peer.online ? `${displayLatency}ms` : "offline"}
                    </span>
                    <span className="text-[9px] text-muted-foreground/50">·</span>
                    <span className="text-[9px] text-muted-foreground">{peer.channels} ch</span>
                    {repScore !== null && (
                      <>
                        <span className="text-[9px] text-muted-foreground/50">·</span>
                        <span className="text-[9px] font-mono" style={{ color: trustLevel(repScore).color }}>
                          {repScore} rep
                        </span>
                      </>
                    )}
                    {peer.pairs.length > 0 && (
                      <>
                        <span className="text-[9px] text-muted-foreground/50">·</span>
                        <span className="text-[9px] font-mono text-muted-foreground">{peer.pairs.slice(0, 2).join(' ')}{peer.pairs.length > 2 ? ` +${peer.pairs.length - 2}` : ''}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Action buttons — compact on mobile */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); if (peer.fullKey) handlePing(peer.id, peer.fullKey); }}
                    disabled={pingState?.loading || !peer.fullKey}
                    className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
                    title="Ping"
                    style={{
                      background: "rgba(16,185,129,0.1)",
                      border: "1px solid rgba(16,185,129,0.25)",
                      color: "#10b981",
                      opacity: (!peer.fullKey || pingState?.loading) ? 0.4 : 1,
                    }}>
                    {pingState?.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radio className="w-3.5 h-3.5" />}
                  </button>
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
                        title={canInvite ? `Invite (score ${mobileScore}/100)` : mobileScore === null ? 'Ping first' : `Score ${mobileScore}/100 < 70`}
                        className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
                        style={{
                          background: canInvite ? 'rgba(139,92,246,0.12)' : 'rgba(100,116,139,0.08)',
                          border: `1px solid ${canInvite ? 'rgba(139,92,246,0.3)' : 'rgba(100,116,139,0.2)'}`,
                          color: canInvite ? '#a78bfa' : '#475569',
                          opacity: canInvite ? 1 : 0.35,
                        }}>
                        <Mail className="w-3.5 h-3.5" />
                      </button>
                    );
                  })()}
                  {/* Expand chevron */}
                  <div className="w-5 flex items-center justify-center">
                    <motion.div animate={{ rotate: isSelected ? 90 : 0 }} transition={{ duration: 0.15 }}>
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40" />
                    </motion.div>
                  </div>
                </div>
              </div>

              {/* Expanded detail panel */}
              <AnimatePresence>
                {isSelected && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <div className="px-3 pb-3 pt-2 border-t" style={{ borderColor: "rgba(139,92,246,0.25)" }}>
                      {/* Stats grid */}
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="rounded-lg px-2 py-2 text-center" style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.18)" }}>
                          <div className="text-[13px] font-mono font-bold" style={{ color: "#a78bfa" }}>{peer.reputation}%</div>
                          <div className="text-[9px] text-muted-foreground mt-0.5">uptime</div>
                        </div>
                        <div className="rounded-lg px-2 py-2 text-center" style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.18)" }}>
                          <div className="text-[13px] font-mono font-bold" style={{ color: "#a78bfa" }}>{peer.channels}</div>
                          <div className="text-[9px] text-muted-foreground mt-0.5">channels</div>
                        </div>
                        <div className="rounded-lg px-2 py-2 text-center" style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.18)" }}>
                          <div className="text-[13px] font-mono font-bold" style={{ color: "#a78bfa" }}>{peer.version}</div>
                          <div className="text-[9px] text-muted-foreground mt-0.5">version</div>
                        </div>
                      </div>
                      {/* Pairs */}
                      {peer.pairs.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2.5">
                          {peer.pairs.map(pair => (
                            <span key={pair} className="px-2 py-0.5 rounded-md text-[9px] font-mono"
                              style={{ background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.22)", color: "rgba(6,182,212,0.9)" }}>
                              {pair}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* View full profile button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedId(peer.id); }}
                        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
                        style={{
                          background: "rgba(139,92,246,0.12)",
                          border: "1px solid rgba(139,92,246,0.3)",
                          color: "#c4b5fd",
                        }}
                      >
                        <Users className="w-3.5 h-3.5" />
                        View Full Profile
                      </button>
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
      <div className="hidden sm:grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-4 flex-1 min-h-0">

        {/* Node Graph */}
        <div className="rounded-2xl overflow-hidden relative flex flex-col min-h-0"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            backdropFilter: "blur(20px)",
          }}>

          {livePeers.length > 1 ? (
            <NodeGraph
              peers={livePeers}
              channels={liveChannels}
              selectedId={selectedId}
              onSelect={id => setSelectedId(prev => prev === id ? null : id)}
              pulseIds={pulseIds}
              pingingIds={new Set(Object.entries(pingResults).filter(([, v]) => v.loading).map(([k]) => k))}
              unreadByPeer={unreadByPeer}
              blockedPeerIds={blockedPeerIds}
              mutedPeerIds={mutedPeerIds}
              graphDensity={graphDensity}
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
              <PeerDetail
                peer={selectedPeer}
                onClose={() => setSelectedId(null)}
                selfPeerId={lightPeer.peerId}
                reputationScores={reputationData}
                pingHistory={selectedPeer ? pingResults[selectedPeer.id]?.history : undefined}
                sendPeerMessage={lightPeer.sendPeerMessage}
              />
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
            unreadByPeer={unreadByPeer}
            blockedPeerIds={blockedPeerIds}
            mutedPeerIds={mutedPeerIds}
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
                { label: "Protocol", value: "Hyperswarm + AFOS P2P DHT" },
                { label: "Node Key", value: oracleNodeKey ? `${oracleNodeKey.slice(0, 12)}...` : "Loading..." },
                { label: "Escrow", value: "HTLC Atomic Swap" },
                { label: "Settlement", value: "SOL · ETH · BTC · TNK" },
              ].map(item => (
                <div key={item.label} className="flex justify-between">
                  <span className="text-[10px] text-muted-foreground">{item.label}</span>
                  <span className="text-[10px] font-mono text-foreground/80">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* HTLC Escrow Wallets */}
          <div className="rounded-2xl p-4"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs font-bold text-foreground">HTLC Escrow Wallets</span>
            </div>
            {htlcWalletsData?.assets ? (
              <div className="space-y-2">
                {htlcWalletsData.assets
                  .filter(a => ["SOL", "ETH", "BTC", "TNK"].includes(a.asset))
                  .map(a => {
                    const chainColor =
                      a.chain === "solana"       ? "#9945ff"
                      : a.chain === "ethereum"   ? "#627eea"
                      : a.chain === "bitcoin"    ? "#f7931a"
                      : a.chain === "trac_network" ? "#e87d3e"
                      : "#888";
                    const shortAddr = a.address && a.address.length > 16
                      ? `${a.address.slice(0, 8)}...${a.address.slice(-6)}`
                      : (a.address ?? "—");
                    const configured = a.address && a.address !== "Not configured";
                    return (
                      <div key={`${a.chain}-${a.asset}`} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                            style={{ background: `${chainColor}20`, color: chainColor, border: `1px solid ${chainColor}30` }}
                          >
                            {a.asset}
                          </span>
                          <span className="text-[10px] font-mono text-muted-foreground truncate">
                            {configured ? shortAddr : "not set"}
                          </span>
                        </div>
                        {configured && (
                          <button
                            onClick={() => { navigator.clipboard.writeText(a.address!); toast.success("Address copied"); }}
                            className="text-[9px] text-muted-foreground hover:text-foreground flex-shrink-0"
                          >
                            copy
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground">Loading escrow addresses...</div>
            )}
          </div>
        </div>
      </div>
      )}
      {/* end hidden sm:grid */}
      </div>
      )}
      </div>
    </div>
  );
}
