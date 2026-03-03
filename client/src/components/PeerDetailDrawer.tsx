/**
 * PeerDetailDrawer
 *
 * Slide-over panel that opens when a leaderboard row is clicked.
 * Shows: Overview (reputation stats + notes/tags), Swap History, Channel History,
 * and an Open Channel shortcut pre-filled with the peer's ID.
 *
 * Keyboard navigation:
 *  - Escape          → close drawer
 *  - ArrowUp / ArrowDown → cycle through leaderboard rows (via onNavigate callback)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import {
  X, Star, Radio, Globe, Zap, ArrowLeftRight,
  Clock, CheckCircle2, AlertTriangle, ExternalLink,
  Activity, Layers, Plus, Tag, StickyNote, ChevronUp, ChevronDown,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtUsd(v: number | string | null | undefined): string {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  if (isNaN(n)) return "$0.00";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function timeAgo(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function scoreColor(score: number | null | undefined): string {
  if (score === null || score === undefined) return "#64748b";
  if (score >= 80) return "#10b981";
  if (score >= 60) return "#f59e0b";
  if (score >= 40) return "#f97316";
  return "#ef4444";
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PeerDetailDrawerProps {
  peerId: string | null;
  alias: string | null;
  origin: string;
  /** Current index in the leaderboard list (0-based) */
  peerIndex?: number;
  /** Total number of peers in the leaderboard */
  peerTotal?: number;
  onClose: () => void;
  onOpenChannel?: (peerId: string) => void;
  /** Called when user presses ArrowUp (-1) or ArrowDown (+1) */
  onNavigate?: (direction: -1 | 1) => void;
}

type Tab = "overview" | "swaps" | "channels";

// ─── Preset tag suggestions ───────────────────────────────────────────────────

const TAG_PRESETS = [
  "Main LP",
  "High Volume",
  "Slow ETH",
  "Reliable",
  "New Peer",
  "Avoid",
  "BTC Specialist",
  "SOL Specialist",
];

// ─── Component ────────────────────────────────────────────────────────────────

export function PeerDetailDrawer({
  peerId,
  alias,
  origin,
  peerIndex,
  peerTotal,
  onClose,
  onOpenChannel,
  onNavigate,
}: PeerDetailDrawerProps) {
  const [tab, setTab] = useState<Tab>("overview");

  // Notes / tags local state
  const [notes, setNotes] = useState<string>("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading } = trpc.analytics.peerDetail.useQuery(
    { peerId: peerId ?? "" },
    { enabled: !!peerId }
  );

  const updateNotes = trpc.peerReputation.updateNotes.useMutation({
    onSuccess: () => {
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    },
    onError: () => setSaveStatus("error"),
  });

  // Populate notes/tags from DB when data loads
  useEffect(() => {
    if (data?.reputation) {
      const rep = data.reputation as { notes?: string | null; tags?: string | null };
      setNotes(rep.notes ?? "");
      try {
        setTags(rep.tags ? JSON.parse(rep.tags) : []);
      } catch {
        setTags([]);
      }
    } else {
      setNotes("");
      setTags([]);
    }
    setNotesDirty(false);
    setSaveStatus("idle");
  }, [data?.reputation, peerId]);

  // Auto-save notes after 1.2s of inactivity
  const handleNotesChange = useCallback((val: string) => {
    setNotes(val);
    setNotesDirty(true);
    setSaveStatus("idle");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (!peerId) return;
      setSaveStatus("saving");
      updateNotes.mutate({ peerId, notes: val || null, tags });
    }, 1200);
  }, [peerId, tags, updateNotes]);

  const saveTagsNow = useCallback((newTags: string[]) => {
    if (!peerId) return;
    setSaveStatus("saving");
    updateNotes.mutate({ peerId, notes: notes || null, tags: newTags });
  }, [peerId, notes, updateNotes]);

  const addTag = useCallback((tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed || tags.includes(trimmed) || tags.length >= 20) return;
    const next = [...tags, trimmed];
    setTags(next);
    setTagInput("");
    saveTagsNow(next);
  }, [tags, saveTagsNow]);

  const removeTag = useCallback((tag: string) => {
    const next = tags.filter(t => t !== tag);
    setTags(next);
    saveTagsNow(next);
  }, [tags, saveTagsNow]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs/textareas
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        onNavigate?.(-1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        onNavigate?.(1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onNavigate]);

  const isHW = origin === "hyperswarm";
  const displayName = alias ?? (peerId ? `${peerId.slice(0, 12)}…${peerId.slice(-6)}` : "Unknown");
  const score = data?.reputation?.score ?? null;

  if (!peerId) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md flex flex-col"
        style={{
          background: "var(--card)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.4)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between px-5 py-4 border-b border-border shrink-0"
          style={{ background: "var(--muted)" }}
        >
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-foreground text-base truncate max-w-[200px]">
                {displayName}
              </span>
              {/* Layer badge */}
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold shrink-0"
                style={{
                  background: isHW ? "rgba(16,185,129,0.12)" : "rgba(6,182,212,0.12)",
                  border: `1px solid ${isHW ? "rgba(16,185,129,0.3)" : "rgba(6,182,212,0.3)"}`,
                  color: isHW ? "#10b981" : "#06b6d4",
                }}
              >
                {isHW ? <Radio className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
                {isHW ? "Hyperswarm" : "IntercomSwap"}
              </span>
              {/* Score badge */}
              {score !== null && (
                <span
                  className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-bold shrink-0"
                  style={{
                    background: `${scoreColor(score)}18`,
                    border: `1px solid ${scoreColor(score)}40`,
                    color: scoreColor(score),
                  }}
                >
                  <Star className="w-2.5 h-2.5" />
                  {score} / 100
                </span>
              )}
            </div>
            <span className="font-mono text-[10px] text-muted-foreground break-all">
              {peerId}
            </span>
          </div>

          {/* Right side: nav arrows + row counter + close */}
          <div className="flex items-center gap-1 ml-3 shrink-0">
            {peerTotal !== undefined && peerIndex !== undefined && (
              <>
                <button
                  onClick={() => onNavigate?.(-1)}
                  disabled={peerIndex === 0}
                  className="p-1 rounded hover:bg-muted/80 transition-colors disabled:opacity-30"
                  title="Previous peer (↑)"
                >
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                </button>
                <span className="text-[10px] text-muted-foreground font-mono w-10 text-center">
                  {peerIndex + 1}/{peerTotal}
                </span>
                <button
                  onClick={() => onNavigate?.(1)}
                  disabled={peerIndex >= peerTotal - 1}
                  className="p-1 rounded hover:bg-muted/80 transition-colors disabled:opacity-30"
                  title="Next peer (↓)"
                >
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors"
              title="Close (Esc)"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
          {(["overview", "swaps", "channels"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex-1 py-2.5 text-xs font-semibold capitalize transition-all"
              style={{
                background: tab === t ? "rgba(6,182,212,0.08)" : "transparent",
                color: tab === t ? "#22d3ee" : "var(--muted-foreground)",
                borderBottom: tab === t ? "2px solid #22d3ee" : "2px solid transparent",
              }}
            >
              {t === "overview" ? "Overview" : t === "swaps" ? `Swaps (${data?.swapCount ?? 0})` : `Channels (${data?.channels?.length ?? 0})`}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
            </div>
          ) : !data ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground text-sm">
              <Activity className="w-8 h-8 opacity-30" />
              <span>No data available for this peer.</span>
            </div>
          ) : (
            <>
              {/* ── Overview Tab ── */}
              {tab === "overview" && (
                <div className="space-y-4">
                  {/* Stats grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Reputation Score", value: score !== null ? `${score} / 100` : "—", color: scoreColor(score), icon: <Star className="w-4 h-4" /> },
                      { label: "Avg Latency", value: fmtMs(data.avgLatencyMs), color: "#22d3ee", icon: <Zap className="w-4 h-4" /> },
                      { label: "Uptime", value: data.uptimePct !== null ? `${data.uptimePct}%` : "—", color: data.uptimePct !== null && data.uptimePct >= 90 ? "#10b981" : "#f59e0b", icon: <Activity className="w-4 h-4" /> },
                      { label: "Total Pings", value: String(data.totalPings), color: "#94a3b8", icon: <Radio className="w-4 h-4" /> },
                      { label: "Completed Swaps", value: String(data.swapCount), color: "#10b981", icon: <ArrowLeftRight className="w-4 h-4" /> },
                      { label: "Total Volume", value: fmtUsd(data.totalUsd), color: "#f59e0b", icon: <Layers className="w-4 h-4" /> },
                    ].map((stat) => (
                      <div
                        key={stat.label}
                        className="rounded-xl p-3"
                        style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                      >
                        <div className="flex items-center gap-1.5 mb-1" style={{ color: stat.color }}>
                          {stat.icon}
                          <span className="text-[10px] font-medium text-muted-foreground">{stat.label}</span>
                        </div>
                        <div className="font-bold text-sm" style={{ color: stat.color }}>
                          {stat.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Ping breakdown */}
                  {data.totalPings > 0 && (
                    <div
                      className="rounded-xl p-3 space-y-2"
                      style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                    >
                      <div className="text-xs font-semibold text-foreground mb-2">Ping History</div>
                      <div className="flex items-center gap-2 text-xs">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span className="text-muted-foreground">Successful</span>
                        <span className="ml-auto font-mono text-emerald-400">{data.reputation?.successfulPings ?? 0}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        <span className="text-muted-foreground">Failed</span>
                        <span className="ml-auto font-mono text-red-400">{data.reputation?.failedPings ?? 0}</span>
                      </div>
                      {/* Progress bar */}
                      {data.uptimePct !== null && (
                        <div className="mt-2">
                          <div className="h-1.5 rounded-full bg-border overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${data.uptimePct}%`,
                                background: data.uptimePct >= 90 ? "#10b981" : data.uptimePct >= 70 ? "#f59e0b" : "#ef4444",
                              }}
                            />
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-1">{data.uptimePct}% uptime</div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Last seen */}
                  {data.reputation?.lastSeenAt && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Last seen {timeAgo(data.reputation.lastSeenAt)} · {fmtDate(data.reputation.lastSeenAt)}</span>
                    </div>
                  )}

                  {/* ── Tags ── */}
                  <div
                    className="rounded-xl p-3 space-y-2"
                    style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <Tag className="w-3.5 h-3.5 text-cyan-400" />
                      <span className="text-xs font-semibold text-foreground">Tags</span>
                      {saveStatus === "saving" && <span className="ml-auto text-[10px] text-muted-foreground animate-pulse">Saving…</span>}
                      {saveStatus === "saved" && <span className="ml-auto text-[10px] text-emerald-400">Saved ✓</span>}
                    </div>

                    {/* Active tags */}
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium cursor-pointer transition-all hover:opacity-80"
                          style={{
                            background: "rgba(6,182,212,0.12)",
                            border: "1px solid rgba(6,182,212,0.3)",
                            color: "#22d3ee",
                          }}
                          onClick={() => removeTag(tag)}
                          title="Click to remove"
                        >
                          {tag}
                          <X className="w-2.5 h-2.5" />
                        </span>
                      ))}
                      {tags.length === 0 && (
                        <span className="text-[11px] text-muted-foreground">No tags yet</span>
                      )}
                    </div>

                    {/* Tag input */}
                    <div className="flex gap-1.5">
                      <input
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === ",") {
                            e.preventDefault();
                            addTag(tagInput);
                          }
                        }}
                        placeholder="Add tag…"
                        maxLength={50}
                        className="flex-1 text-xs px-2.5 py-1.5 rounded-lg bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-cyan-400/50 transition-colors"
                      />
                      <button
                        onClick={() => addTag(tagInput)}
                        disabled={!tagInput.trim()}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-40"
                        style={{
                          background: "rgba(6,182,212,0.12)",
                          border: "1px solid rgba(6,182,212,0.3)",
                          color: "#22d3ee",
                        }}
                      >
                        Add
                      </button>
                    </div>

                    {/* Preset suggestions */}
                    <div className="flex flex-wrap gap-1">
                      {TAG_PRESETS.filter(p => !tags.includes(p)).slice(0, 5).map((preset) => (
                        <button
                          key={preset}
                          onClick={() => addTag(preset)}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors"
                        >
                          + {preset}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── Notes ── */}
                  <div
                    className="rounded-xl p-3 space-y-2"
                    style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <StickyNote className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-xs font-semibold text-foreground">Notes</span>
                      {notesDirty && saveStatus === "idle" && (
                        <span className="ml-auto text-[10px] text-muted-foreground">Unsaved</span>
                      )}
                      {saveStatus === "saving" && <span className="ml-auto text-[10px] text-muted-foreground animate-pulse">Saving…</span>}
                      {saveStatus === "saved" && <span className="ml-auto text-[10px] text-emerald-400">Saved ✓</span>}
                      {saveStatus === "error" && <span className="ml-auto text-[10px] text-red-400">Save failed</span>}
                    </div>
                    <textarea
                      value={notes}
                      onChange={(e) => handleNotesChange(e.target.value)}
                      placeholder="Add operator notes about this peer… (auto-saved)"
                      rows={4}
                      maxLength={2000}
                      className="w-full text-xs px-3 py-2 rounded-lg bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-amber-400/50 transition-colors resize-none leading-relaxed"
                    />
                    <div className="text-[10px] text-muted-foreground text-right">{notes.length}/2000</div>
                  </div>
                </div>
              )}

              {/* ── Swaps Tab ── */}
              {tab === "swaps" && (
                <div className="space-y-2">
                  {data.swaps.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground text-sm">
                      <ArrowLeftRight className="w-8 h-8 opacity-30" />
                      <span>No completed swaps with this peer yet.</span>
                    </div>
                  ) : (
                    data.swaps.map((swap) => (
                      <div
                        key={swap.id}
                        className="rounded-xl p-3 text-xs"
                        style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono font-semibold text-foreground">
                            {swap.amount} {swap.fromToken} → {swap.toToken}
                          </span>
                          <span className="text-emerald-400 font-semibold">{fmtUsd(swap.amountUsd)}</span>
                        </div>
                        <div className="flex items-center gap-3 text-muted-foreground">
                          <span>{swap.fromChain} → {swap.toChain}</span>
                          <span>·</span>
                          <span>{fmtMs(swap.settlementMs)}</span>
                          <span className="ml-auto">{timeAgo(swap.createdAt)}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* ── Channels Tab ── */}
              {tab === "channels" && (
                <div className="space-y-2">
                  {data.channels.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground text-sm">
                      <Layers className="w-8 h-8 opacity-30" />
                      <span>No channel history with this peer.</span>
                    </div>
                  ) : (
                    data.channels.map((ch) => (
                      <div
                        key={ch.id}
                        className="rounded-xl p-3 text-xs"
                        style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono text-foreground truncate max-w-[200px]" title={ch.htlcAddress ?? ""}>
                            {ch.htlcAddress ? `${ch.htlcAddress.slice(0, 14)}…` : ch.id}
                          </span>
                          <span
                            className="font-semibold"
                            style={{
                              color: ch.status === "completed" ? "#10b981"
                                : ch.status === "refunded" ? "#f59e0b"
                                : "#ef4444",
                            }}
                          >
                            {ch.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-muted-foreground">
                          <span>{ch.chain?.toUpperCase()}</span>
                          <span>·</span>
                          <span>{ch.amountHuman ?? ch.amountRaw}</span>
                          <span className="ml-auto">{timeAgo(ch.createdAt)}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer — Open Channel shortcut */}
        <div className="px-5 py-4 border-t border-border shrink-0">
          <button
            onClick={() => onOpenChannel?.(peerId)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all"
            style={{
              background: "rgba(6,182,212,0.12)",
              border: "1px solid rgba(6,182,212,0.3)",
              color: "#22d3ee",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(6,182,212,0.2)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(6,182,212,0.12)";
            }}
          >
            <Plus className="w-4 h-4" />
            Open Channel with {alias ?? `${peerId.slice(0, 8)}…`}
          </button>
        </div>
      </div>
    </>
  );
}
