/**
 * Swap Analytics Dashboard
 *
 * Displays:
 *   - KPI strip: total volume, swap count, avg settlement time, P2P ratio, HTLC success rate
 *   - Volume by chain (bar chart via recharts)
 *   - Route distribution (donut chart)
 *   - HTLC success / refund ratio by chain
 *   - Average settlement time per route
 *   - Peer reputation leaderboard
 *   - Recent swap activity feed
 */

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  TrendingUp, Zap, Clock, Users, CheckCircle2,
  AlertTriangle, RefreshCw, ArrowLeftRight, Activity,
  Trophy, Radio, BarChart3, Droplets, Globe, ArrowUpDown, Star,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { getWallet, mergeWithAllAssets, type WalletAsset } from "@/lib/afosApi";
import { PeerDetailDrawer } from "@/components/PeerDetailDrawer";

// ─── Constants ────────────────────────────────────────────────────────────────

const CHAIN_COLORS: Record<string, string> = {
  bitcoin:  "#F7931A",
  ethereum: "#627EEA",
  solana:   "#9945FF",
};

const ROUTE_COLORS: Record<string, string> = {
  "IntercomSwap P2P": "#14F195",
  "Jupiter DEX":      "#9945FF",
  "0x Protocol":      "#6366f1",
  "1inch":            "#627EEA",
  "Direct HTLC":      "#F7931A",
};

function routeColor(route: string): string {
  for (const [key, color] of Object.entries(ROUTE_COLORS)) {
    if (route.toLowerCase().includes(key.toLowerCase())) return color;
  }
  return "#888";
}

const TIME_WINDOWS = [
  { label: "7d",  days: 7  },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

function fmtMs(ms: number): string {
  if (ms === 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon: Icon, color, loading,
}: {
  label:   string;
  value:   string;
  sub?:    string;
  icon:    React.ElementType;
  color:   string;
  loading: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-4 flex flex-col gap-2"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: `${color}18`, border: `1px solid ${color}40` }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
      </div>
      {loading ? (
        <div className="h-7 w-24 rounded-lg animate-pulse" style={{ background: "var(--muted)" }} />
      ) : (
        <p className="text-2xl font-bold font-mono text-foreground">{value}</p>
      )}
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </motion.div>
  );
}

function SectionCard({ title, icon: Icon, children }: {
  title:    string;
  icon:     React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="px-4 py-3 flex items-center gap-2"
        style={{ borderBottom: "1px solid var(--border)", background: "rgba(6,182,212,0.04)" }}>
        <Icon className="w-4 h-4 text-cyan-400" />
        <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
      <Activity className="w-8 h-8 opacity-30" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SwapAnalytics() {
  const [days, setDays] = useState(30);
  const [drawerPeer, setDrawerPeer] = useState<{ peerId: string; alias: string | null; origin: string } | null>(null);
  const [drawerPeerIndex, setDrawerPeerIndex] = useState<number>(0);

  const { data: summary,  isLoading: loadingSummary  } = trpc.analytics.summary.useQuery({ days });
  const { data: volume,   isLoading: loadingVolume   } = trpc.analytics.volumeByChain.useQuery({ days });
  const { data: routes,   isLoading: loadingRoutes   } = trpc.analytics.routeDistribution.useQuery({ days });
  const { data: htlc,     isLoading: loadingHtlc     } = trpc.analytics.htlcRatio.useQuery({ days });
  const { data: settle,   isLoading: loadingSettle   } = trpc.analytics.settlementTime.useQuery({ days });
  const [peerSortBy, setPeerSortBy] = useState<'score' | 'swaps' | 'volume' | 'latency'>('score');
  const { data: peers,    isLoading: loadingPeers    } = trpc.analytics.peerLeaderboard.useQuery({ days, limit: 25, sortBy: peerSortBy });
  const { data: recent,   isLoading: loadingRecent   } = trpc.analytics.recentSwaps.useQuery({ limit: 20 });

  const utils = trpc.useUtils();
  const refresh = () => {
    utils.analytics.summary.invalidate();
    utils.analytics.volumeByChain.invalidate();
    utils.analytics.routeDistribution.invalidate();
    utils.analytics.htlcRatio.invalidate();
    utils.analytics.settlementTime.invalidate();
    utils.analytics.peerLeaderboard.invalidate();
    utils.analytics.recentSwaps.invalidate();
  };

  // ── Volume bar chart data ────────────────────────────────────────────────
  const volumeChartData = (volume?.byChain ?? []).map(c => ({
    name:  c.chain.charAt(0).toUpperCase() + c.chain.slice(1),
    chain: c.chain,
    swaps: c.swapCount,
    usd:   c.totalUsd,
  }));

  // ── Route donut data ─────────────────────────────────────────────────────
  const routeChartData = (routes ?? []).map(r => ({
    name:  r.route,
    value: r.swapCount,
    usd:   r.totalUsd,
    pct:   r.percentage,
  }));

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Peer Detail Drawer */}
      {drawerPeer && (
        <PeerDetailDrawer
          peerId={drawerPeer.peerId}
          alias={drawerPeer.alias}
          origin={drawerPeer.origin}
          peerIndex={drawerPeerIndex}
          peerTotal={peers?.length ?? 0}
          onClose={() => setDrawerPeer(null)}
          onNavigate={(dir) => {
            const list = peers ?? [];
            const next = drawerPeerIndex + dir;
            if (next < 0 || next >= list.length) return;
            const p = list[next];
            setDrawerPeerIndex(next);
            setDrawerPeer({ peerId: p.peerId, alias: p.alias, origin: p.origin });
          }}
          onOpenChannel={(peerId) => {
            setDrawerPeer(null);
            // Navigate to Network page with pre-filled peer ID via sessionStorage
            sessionStorage.setItem('afos_open_channel_peer', peerId);
            window.dispatchEvent(new CustomEvent('afos:open-channel', { detail: { peerId } }));
          }}
        />
      )}

      {/* Header */}
      <div className="px-4 lg:px-6 py-4 flex items-center justify-between border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-cyan-400" />
          <h1 className="text-base font-bold text-foreground">Swap Analytics</h1>
          <span className="text-xs text-muted-foreground hidden sm:block">· {days}-day window</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Time window selector */}
          <div className="flex rounded-xl overflow-hidden border border-border">
            {TIME_WINDOWS.map(w => (
              <button
                key={w.days}
                onClick={() => setDays(w.days)}
                className="px-3 py-1.5 text-xs font-semibold transition-all"
                style={{
                  background: days === w.days ? "rgba(6,182,212,0.15)" : "transparent",
                  color:      days === w.days ? "#22d3ee" : "var(--muted-foreground)",
                  borderRight: w.days !== 90 ? "1px solid var(--border)" : undefined,
                }}
              >
                {w.label}
              </button>
            ))}
          </div>
          <button
            onClick={refresh}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6">

        {/* ── KPI Strip ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiCard
            label="Total Volume"
            value={fmtUsd(summary?.totalUsd ?? 0)}
            sub={`${summary?.totalSwaps ?? 0} swaps`}
            icon={TrendingUp}
            color="#22d3ee"
            loading={loadingSummary}
          />
          <KpiCard
            label="Avg Settlement"
            value={fmtMs(summary?.avgSettlementMs ?? 0)}
            sub="quote → on-chain"
            icon={Clock}
            color="#a78bfa"
            loading={loadingSummary}
          />
          <KpiCard
            label="P2P Ratio"
            value={`${summary?.p2pRatio ?? "0.0"}%`}
            sub="IntercomSwap P2P"
            icon={Radio}
            color="#14F195"
            loading={loadingSummary}
          />
          <KpiCard
            label="HTLC Success"
            value={`${summary?.htlcSuccessRate ?? "0.0"}%`}
            sub={`Refund: ${summary?.htlcRefundRate ?? "0.0"}%`}
            icon={CheckCircle2}
            color="#10b981"
            loading={loadingSummary}
          />
          <KpiCard
            label="Active Peers"
            value={String(peers?.length ?? 0)}
            sub="with completed swaps"
            icon={Users}
            color="#f59e0b"
            loading={loadingPeers}
          />
        </div>

        {/* ── Volume + Route Distribution ────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Volume by Chain */}
          <SectionCard title="Volume by Chain" icon={BarChart3}>
            {loadingVolume ? (
              <div className="h-48 flex items-center justify-center">
                <div className="w-6 h-6 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
              </div>
            ) : volumeChartData.length === 0 ? (
              <EmptyState message="No swap data yet. Complete a swap to see volume." />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={volumeChartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} tickFormatter={v => fmtUsd(v)} width={56} />
                  <RechartTooltip
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(value: any, _name: any, props: any) => [
                      fmtUsd(Number(value)),
                      props?.payload?.chain ?? "Volume",
                    ]}
                  />
                  <Bar dataKey="usd" radius={[6, 6, 0, 0]}>
                    {volumeChartData.map(entry => (
                      <Cell key={entry.chain} fill={CHAIN_COLORS[entry.chain] ?? "#888"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
            {/* Chain legend */}
            {!loadingVolume && volumeChartData.length > 0 && (
              <div className="flex items-center gap-4 mt-2 justify-center flex-wrap">
                {volumeChartData.map(c => (
                  <div key={c.chain} className="flex items-center gap-1.5 text-[11px]">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: CHAIN_COLORS[c.chain] ?? "#888" }} />
                    <span className="text-muted-foreground capitalize">{c.chain}</span>
                    <span className="font-mono text-foreground">{c.swaps} swaps</span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Route Distribution */}
          <SectionCard title="Route Distribution" icon={Zap}>
            {loadingRoutes ? (
              <div className="h-48 flex items-center justify-center">
                <div className="w-6 h-6 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
              </div>
            ) : routeChartData.length === 0 ? (
              <EmptyState message="No route data yet." />
            ) : (
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie
                      data={routeChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {routeChartData.map((entry, i) => (
                        <Cell key={i} fill={routeColor(entry.name)} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-2 flex-1">
                  {routeChartData.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: routeColor(r.name) }} />
                      <span className="text-muted-foreground flex-1 truncate">{r.name}</span>
                      <span className="font-mono text-foreground">{r.pct}%</span>
                      <span className="text-muted-foreground">({r.value})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </SectionCard>
        </div>

        {/* ── HTLC Ratio + Settlement Time ───────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* HTLC Ratio */}
          <SectionCard title="HTLC Status Breakdown" icon={CheckCircle2}>
            {loadingHtlc ? (
              <div className="h-32 flex items-center justify-center">
                <div className="w-6 h-6 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
              </div>
            ) : (htlc?.total ?? 0) === 0 ? (
              <EmptyState message="No HTLC data yet." />
            ) : (
              <div className="space-y-3">
                {/* Summary bar */}
                <div className="flex rounded-full overflow-hidden h-3 gap-0.5">
                  {[
                    { key: "completed", color: "#10b981" },
                    { key: "refunded",  color: "#f59e0b" },
                    { key: "expired",   color: "#ef4444" },
                    { key: "pending",   color: "#6b7280" },
                  ].map(({ key, color }) => {
                    const val = (htlc?.totals as Record<string, number>)?.[key] ?? 0;
                    const pct = htlc?.total ? (val / htlc.total) * 100 : 0;
                    if (pct === 0) return null;
                    return (
                      <div key={key} style={{ width: `${pct}%`, background: color, borderRadius: 4 }} />
                    );
                  })}
                </div>
                {/* Stat rows */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: "completed", label: "Completed", color: "#10b981", icon: CheckCircle2 },
                    { key: "refunded",  label: "Refunded",  color: "#f59e0b", icon: AlertTriangle },
                    { key: "expired",   label: "Expired",   color: "#ef4444", icon: Clock },
                    { key: "pending",   label: "Pending",   color: "#6b7280", icon: RefreshCw },
                  ].map(({ key, label, color, icon: Icon }) => {
                    const val = (htlc?.totals as Record<string, number>)?.[key] ?? 0;
                    return (
                      <div key={key} className="flex items-center gap-2 p-2 rounded-xl"
                        style={{ background: `${color}10`, border: `1px solid ${color}25` }}>
                        <Icon className="w-3.5 h-3.5" style={{ color }} />
                        <div>
                          <p className="text-[10px] text-muted-foreground">{label}</p>
                          <p className="text-sm font-bold font-mono" style={{ color }}>{val}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Per-chain breakdown */}
                {Object.entries(htlc?.byChain ?? {}).map(([chain, statuses]) => (
                  <div key={chain} className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-full" style={{ background: CHAIN_COLORS[chain] ?? "#888" }} />
                    <span className="text-muted-foreground capitalize w-16">{chain}</span>
                    {Object.entries(statuses as Record<string, number>).map(([s, n]) => (
                      <span key={s} className="text-muted-foreground">{s}: <span className="text-foreground font-mono">{n}</span></span>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Settlement Time */}
          <SectionCard title="Avg Settlement Time by Route" icon={Clock}>
            {loadingSettle ? (
              <div className="h-32 flex items-center justify-center">
                <div className="w-6 h-6 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
              </div>
            ) : (settle ?? []).length === 0 ? (
              <EmptyState message="No settlement data yet." />
            ) : (
              <div className="space-y-2">
                {(settle ?? []).map((r, i) => {
                  const maxMs = Math.max(...(settle ?? []).map(x => x.avgMs), 1);
                  const pct   = (r.avgMs / maxMs) * 100;
                  const color = routeColor(r.route);
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground truncate max-w-[160px]">{r.route}</span>
                        <span className="font-mono text-foreground">{fmtMs(r.avgMs)}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
                      </div>
                      <p className="text-[10px] text-muted-foreground">{r.swapCount} swaps</p>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>

        {/* ── Peer Leaderboard ───────────────────────────────────────────── */}
        <SectionCard title="P2P Peer Leaderboard" icon={Trophy}>
          {/* Sort controls */}
          <div className="flex items-center gap-1.5 mb-3 flex-wrap">
            <ArrowUpDown className="w-3 h-3 text-muted-foreground shrink-0" />
            <span className="text-[10px] text-muted-foreground mr-1">Sort:</span>
            {(['score', 'swaps', 'volume', 'latency'] as const).map(key => (
              <button key={key}
                onClick={() => setPeerSortBy(key)}
                className="px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all"
                style={{
                  background: peerSortBy === key ? 'rgba(6,182,212,0.15)' : 'transparent',
                  border: `1px solid ${peerSortBy === key ? 'rgba(6,182,212,0.4)' : 'rgba(100,116,139,0.2)'}`,
                  color: peerSortBy === key ? '#22d3ee' : 'var(--muted-foreground)',
                }}>
                {key === 'score' ? '★ Score' : key === 'swaps' ? '⇅ Swaps' : key === 'volume' ? '$ Volume' : '⏱ Latency'}
              </button>
            ))}
          </div>

          {loadingPeers ? (
            <div className="h-32 flex items-center justify-center">
              <div className="w-6 h-6 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
            </div>
          ) : (peers ?? []).length === 0 ? (
            <EmptyState message="No P2P peers have completed swaps yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border">
                    <th className="text-left pb-2 font-medium w-8">#</th>
                    <th className="text-left pb-2 font-medium">Peer</th>
                    <th className="text-left pb-2 font-medium">Layer</th>
                    <th className="text-right pb-2 font-medium">
                      <span className="inline-flex flex-col items-end gap-0">
                        <span>Score</span>
                        <span className="text-[9px] font-normal text-muted-foreground/70 leading-none">All Time</span>
                      </span>
                    </th>
                    <th className="text-right pb-2 font-medium">
                      <span className="inline-flex flex-col items-end gap-0">
                        <span>Swaps</span>
                        <span className="text-[9px] font-normal text-muted-foreground/70 leading-none">{days}d</span>
                      </span>
                    </th>
                    <th className="text-right pb-2 font-medium hidden sm:table-cell">Volume</th>
                    <th className="text-right pb-2 font-medium hidden sm:table-cell">Avg Latency</th>
                    <th className="text-right pb-2 font-medium hidden md:table-cell">Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {(peers ?? []).map((p, i) => {
                    const isHW = p.origin === 'hyperswarm';
                    const score = p.score;
                    const scoreColor = score === null ? '#64748b'
                      : score >= 80 ? '#10b981'
                      : score >= 60 ? '#f59e0b'
                      : score >= 40 ? '#f97316'
                      : '#ef4444';
                    const lastSeen = p.lastSeenAt
                      ? (() => {
                          const diff = Date.now() - new Date(p.lastSeenAt).getTime();
                          const mins = Math.floor(diff / 60000);
                          if (mins < 60) return `${mins}m ago`;
                          const hrs = Math.floor(mins / 60);
                          if (hrs < 24) return `${hrs}h ago`;
                          return `${Math.floor(hrs / 24)}d ago`;
                        })()
                      : '—';
                    return (
                      <tr
                        key={p.peerId}
                        className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => {
                          setDrawerPeerIndex(i);
                          setDrawerPeer({ peerId: p.peerId, alias: p.alias, origin: p.origin });
                        }}
                        title="Click to view peer details (↑↓ to navigate, Esc to close)"
                      >
                        {/* Rank */}
                        <td className="py-2 pr-2">
                          {i === 0 ? <Trophy className="w-3.5 h-3.5 text-amber-400" /> :
                           i === 1 ? <span className="text-zinc-400 font-bold">2</span> :
                           i === 2 ? <span className="text-amber-700 font-bold">3</span> :
                           <span className="text-muted-foreground">{p.rank}</span>}
                        </td>
                        {/* Peer alias / ID */}
                        <td className="py-2 max-w-[120px]">
                          <div className="font-semibold text-foreground truncate" title={p.peerId}>
                            {p.alias ?? `${p.peerId.slice(0, 8)}…`}
                          </div>
                          <div className="font-mono text-[9px] text-muted-foreground truncate">{p.peerId.slice(0, 10)}…</div>
                        </td>
                        {/* Layer badge */}
                        <td className="py-2">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold"
                            style={{
                              background: isHW ? 'rgba(16,185,129,0.12)' : 'rgba(6,182,212,0.12)',
                              border: `1px solid ${isHW ? 'rgba(16,185,129,0.3)' : 'rgba(6,182,212,0.3)'}`,
                              color: isHW ? '#10b981' : '#06b6d4',
                            }}>
                            {isHW ? <Radio className="w-2.5 h-2.5" /> : <Globe className="w-2.5 h-2.5" />}
                            {isHW ? 'HW' : 'IS'}
                          </span>
                        </td>
                        {/* Reputation score */}
                        <td className="py-2 text-right">
                          {score !== null ? (
                            <span className="inline-flex items-center gap-0.5 font-mono font-bold text-[11px]"
                              style={{ color: scoreColor }}>
                              <Star className="w-2.5 h-2.5" />
                              {score}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        {/* Swaps */}
                        <td className="py-2 text-right font-mono text-emerald-400">{p.swapCount || p.successfulSwaps || 0}</td>
                        {/* Volume */}
                        <td className="py-2 text-right font-mono text-foreground hidden sm:table-cell">{fmtUsd(p.totalUsd)}</td>
                        {/* Avg Latency */}
                        <td className="py-2 text-right font-mono text-muted-foreground hidden sm:table-cell">
                          {p.avgLatencyMs !== null ? fmtMs(p.avgLatencyMs) : '—'}
                        </td>
                        {/* Last Seen */}
                        <td className="py-2 text-right text-muted-foreground hidden md:table-cell">{lastSeen}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        {/* ── Recent Swap Feed ───────────────────────────────────────────── */}
        <SectionCard title="Recent Swaps" icon={Activity}>
          {loadingRecent ? (
            <div className="h-32 flex items-center justify-center">
              <div className="w-6 h-6 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
            </div>
          ) : (recent ?? []).length === 0 ? (
            <EmptyState message="No swaps recorded yet. Complete a swap to see it here." />
          ) : (
            <div className="space-y-2">
              {(recent ?? []).map((swap) => (
                <div key={swap.id}
                  className="flex items-center gap-3 p-3 rounded-xl text-xs"
                  style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                  {/* Chain dots */}
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="w-2 h-2 rounded-full" style={{ background: CHAIN_COLORS[swap.fromChain] ?? "#888" }} />
                    <ArrowLeftRight className="w-3 h-3 text-muted-foreground" />
                    <span className="w-2 h-2 rounded-full" style={{ background: CHAIN_COLORS[swap.toChain] ?? "#888" }} />
                  </div>
                  {/* Pair */}
                  <span className="font-mono text-foreground shrink-0">
                    {swap.amount} {swap.fromToken} → {swap.toToken}
                  </span>
                  {/* Route badge */}
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold shrink-0"
                    style={{
                      background: `${routeColor(swap.route)}18`,
                      color:      routeColor(swap.route),
                      border:     `1px solid ${routeColor(swap.route)}40`,
                    }}>
                    {swap.route}
                  </span>
                  {/* Status */}
                  <span className={`ml-auto shrink-0 font-semibold ${
                    swap.status === "completed" ? "text-emerald-400" :
                    swap.status === "refunded"  ? "text-amber-400"   :
                    "text-red-400"
                  }`}>
                    {swap.status}
                  </span>
                  {/* Time */}
                  <span className="text-muted-foreground shrink-0 hidden sm:block">
                    {fmtDate(swap.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* ── Platform Liquidity ─────────────────────────────────────── */}
        <PlatformLiquidity />

      </div>
    </div>
  );
}

// ─── Platform Liquidity Section ──────────────────────────────────────────────

function PlatformLiquidity() {
  const [wallets, setWallets] = useState<WalletAsset[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await getWallet();
      setWallets(mergeWithAllAssets(data.wallets));
    } catch { /* keep empty */ }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 60_000);
    return () => clearInterval(t);
  }, []);

  // Group wallets by chain for the summary
  const byChain = wallets.reduce<Record<string, { assets: WalletAsset[]; totalUsd: number }>>((acc, w) => {
    const chain = w.chain;
    if (!acc[chain]) acc[chain] = { assets: [], totalUsd: 0 };
    acc[chain].assets.push(w);
    const usdNum = parseFloat(w.usd.replace(/[^\d.-]/g, "")) || 0;
    acc[chain].totalUsd += usdNum;
    return acc;
  }, {});

  const totalPortfolioUsd = Object.values(byChain).reduce((s, c) => s + c.totalUsd, 0);

  return (
    <SectionCard title="Platform Liquidity" icon={Droplets}>
      {loading && wallets.length === 0 ? (
        <div className="h-32 flex items-center justify-center">
          <div className="w-6 h-6 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
        </div>
      ) : wallets.length === 0 ? (
        <EmptyState message="No wallet data available. Ensure the Oracle VM is running." />
      ) : (
        <div className="space-y-4">
          {/* Total portfolio value */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Total Portfolio Value</p>
              <p className="text-2xl font-bold font-mono text-foreground">{fmtUsd(totalPortfolioUsd)}</p>
            </div>
            <button onClick={fetchData}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* Chain allocation bar */}
          {totalPortfolioUsd > 0 && (
            <div>
              <div className="flex rounded-full overflow-hidden h-3 gap-0.5">
                {Object.entries(byChain).map(([chain, data]) => {
                  const pct = (data.totalUsd / totalPortfolioUsd) * 100;
                  if (pct < 0.5) return null;
                  return (
                    <div key={chain}
                      style={{ width: `${pct}%`, background: CHAIN_COLORS[chain] ?? "#888", borderRadius: 4 }}
                      title={`${chain}: ${fmtUsd(data.totalUsd)} (${pct.toFixed(1)}%)`} />
                  );
                })}
              </div>
              <div className="flex items-center gap-4 mt-2 flex-wrap">
                {Object.entries(byChain).map(([chain, data]) => {
                  const pct = totalPortfolioUsd > 0 ? (data.totalUsd / totalPortfolioUsd) * 100 : 0;
                  return (
                    <div key={chain} className="flex items-center gap-1.5 text-[11px]">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: CHAIN_COLORS[chain] ?? "#888" }} />
                      <span className="text-muted-foreground capitalize">{chain}</span>
                      <span className="font-mono text-foreground">{fmtUsd(data.totalUsd)}</span>
                      <span className="text-muted-foreground">({pct.toFixed(1)}%)</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Per-chain reserve breakdown */}
          <div className="space-y-3">
            {Object.entries(byChain).map(([chain, data]) => (
              <div key={chain}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: CHAIN_COLORS[chain] ?? "#888" }} />
                  <span className="text-xs font-semibold text-foreground capitalize">{chain}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{fmtUsd(data.totalUsd)}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {data.assets.map((w, i) => {
                    const chainColor = CHAIN_COLORS[chain] ?? "#888";
                    return (
                      <div key={`${w.asset}-${i}`}
                        className="flex items-center gap-2.5 p-2.5 rounded-xl"
                        style={{ background: `${chainColor}08`, border: `1px solid ${chainColor}20` }}>
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[9px] font-bold font-mono"
                          style={{ background: `${chainColor}20`, color: chainColor, border: `1px solid ${chainColor}40` }}>
                          {w.asset}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-mono font-semibold text-foreground">{w.balance}</p>
                          <p className="text-[10px] text-muted-foreground">{w.usd}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: w.live ? "#10b981" : "#6b7280" }} />
                          <span className="text-[9px] text-muted-foreground">{w.live ? "live" : "offline"}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
