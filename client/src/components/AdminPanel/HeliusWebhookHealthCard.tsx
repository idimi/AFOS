/**
 * HeliusWebhookHealthCard
 *
 * Displays real-time Helius webhook health metrics in the Admin panel.
 * Auto-refreshes every 30 seconds. Shows:
 *  - Registration status (webhook ID, registered URL)
 *  - Live event counters (events received, claims triggered)
 *  - Last event time and signature
 *  - Settlement breakdown by source (Webhook / Browser / Monitor / Admin)
 *  - Average settlement time for webhook-triggered claims
 */
import React, { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  Zap, Radio, Clock, Hash, AlertTriangle, CheckCircle2,
  RefreshCw, ExternalLink, BarChart3, Activity,
} from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ms: number | null): string {
  if (!ms) return "never";
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

function formatMs(ms: number | null): string {
  if (!ms || ms <= 0) return "—";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function speedTier(ms: number | null): { label: string; color: string } {
  if (!ms || ms <= 0) return { label: "—", color: "var(--muted-foreground)" };
  if (ms < 30_000) return { label: "Fast", color: "#22c55e" };
  if (ms < 300_000) return { label: "Normal", color: "#3b82f6" };
  return { label: "Slow", color: "#f59e0b" };
}

const VIA_LABELS: Record<string, { label: string; color: string }> = {
  helius_webhook: { label: "Webhook", color: "#22c55e" },
  browser_notify: { label: "Browser", color: "#3b82f6" },
  monitor_fallback: { label: "Monitor", color: "#f59e0b" },
  admin_force_claim: { label: "Admin", color: "#a78bfa" },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StatRow({
  label, value, sub, color,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5"
      style={{ borderBottom: "1px solid var(--border)" }}>
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="text-right">
        <span className="text-[11px] font-semibold font-mono" style={{ color: color ?? "var(--foreground)" }}>
          {value}
        </span>
        {sub && <p className="text-[9px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2 mt-3">
      <Icon className="w-3 h-3 text-muted-foreground" />
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function HeliusWebhookHealthCard() {
  const { data, isLoading, refetch, dataUpdatedAt } = trpc.webhookHealth.getStatus.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const lastRefreshed = useMemo(() => {
    if (!dataUpdatedAt) return null;
    return new Date(dataUpdatedAt).toLocaleTimeString();
  }, [dataUpdatedAt]);

  const isRegistered = !!(data?.webhookId);
  const statusColor = isRegistered ? "#22c55e" : "#f59e0b";
  const statusLabel = isRegistered ? "Registered" : "Not registered";

  const speed = speedTier(data?.avgSettlementMs ?? null);

  const totalSettled = (data?.settlementBreakdown ?? []).reduce((s, r) => s + r.count, 0);

  return (
    <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)" }}>
            <Radio className="w-3.5 h-3.5 text-green-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">Helius Webhook</p>
            <p className="text-[10px] text-muted-foreground">HTLC on-chain event listener</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Status pill */}
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full"
            style={{ background: `${statusColor}15`, border: `1px solid ${statusColor}40` }}>
            {isRegistered
              ? <CheckCircle2 className="w-2.5 h-2.5" style={{ color: statusColor }} />
              : <AlertTriangle className="w-2.5 h-2.5" style={{ color: statusColor }} />}
            <span className="text-[10px] font-semibold" style={{ color: statusColor }}>{statusLabel}</span>
          </div>
          {/* Refresh button */}
          <button
            onClick={() => void refetch()}
            disabled={isLoading}
            className="p-1.5 rounded-lg transition-colors"
            style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
            title="Refresh">
            <RefreshCw className={`w-3 h-3 text-muted-foreground ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {isLoading && !data ? (
        <div className="flex items-center justify-center py-6">
          <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
          <span className="ml-2 text-xs text-muted-foreground">Loading webhook status…</span>
        </div>
      ) : (
        <>
          {/* Registration */}
          <SectionHeader icon={Hash} title="Registration" />
          <div className="space-y-0">
            <StatRow
              label="Webhook ID"
              value={data?.webhookId
                ? <span className="font-mono text-[10px]">{data.webhookId.slice(0, 18)}…</span>
                : <span className="text-amber-400">Not registered</span>}
            />
            <StatRow
              label="Program Address"
              value={
                <span className="font-mono text-[10px]">
                  {data?.programAddress?.slice(0, 12)}…
                </span>
              }
              sub="AFOS HTLC Program"
            />
            <StatRow
              label="Secret"
              value={data?.secretConfigured
                ? <span className="text-green-400">Configured ✓</span>
                : <span className="text-amber-400">Not set (dev mode)</span>}
            />
          </div>

          {/* Live counters */}
          <SectionHeader icon={Activity} title="Live Counters (since last restart)" />
          <div className="space-y-0">
            <StatRow
              label="Events received"
              value={data?.totalEventsReceived ?? 0}
              color={data?.totalEventsReceived ? "#60a5fa" : undefined}
            />
            <StatRow
              label="Claims triggered"
              value={data?.totalClaimsTriggered ?? 0}
              color={data?.totalClaimsTriggered ? "#22c55e" : undefined}
            />
            <StatRow
              label="Last event"
              value={timeAgo(data?.lastEventAt ?? null)}
              sub={data?.lastEventSig
                ? `sig: ${data.lastEventSig.slice(0, 14)}…`
                : undefined}
            />
            <StatRow
              label="Last claim"
              value={timeAgo(data?.lastClaimTriggeredAt ?? null)}
            />
          </div>

          {/* Settlement stats */}
          <SectionHeader icon={BarChart3} title="Settlement Breakdown (all-time)" />
          {totalSettled === 0 ? (
            <p className="text-[10px] text-muted-foreground py-2">No completed swaps yet.</p>
          ) : (
            <div className="space-y-0">
              {(data?.settlementBreakdown ?? []).map((row) => {
                const via = VIA_LABELS[row.settledVia ?? ""] ?? { label: row.settledVia ?? "Unknown", color: "var(--muted-foreground)" };
                const pct = totalSettled > 0 ? Math.round((row.count / totalSettled) * 100) : 0;
                return (
                  <div key={row.settledVia} className="flex items-center justify-between py-1.5"
                    style={{ borderBottom: "1px solid var(--border)" }}>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: via.color }} />
                      <span className="text-[11px] text-muted-foreground">{via.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Mini bar */}
                      <div className="w-16 h-1 rounded-full" style={{ background: "var(--muted)" }}>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: via.color }} />
                      </div>
                      <span className="text-[11px] font-semibold font-mono" style={{ color: via.color }}>
                        {row.count}
                      </span>
                      <span className="text-[9px] text-muted-foreground w-7 text-right">{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Avg settlement time */}
          {(data?.webhookClaimCount ?? 0) > 0 && (
            <>
              <SectionHeader icon={Clock} title="Webhook Performance" />
              <div className="space-y-0">
                <StatRow
                  label="Avg settlement time"
                  value={formatMs(data?.avgSettlementMs ?? null)}
                  color={speed.color}
                  sub={`${speed.label} · ${data?.fastClaimCount ?? 0}/${data?.webhookClaimCount ?? 0} under 30s`}
                />
              </div>
            </>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between mt-3 pt-2"
            style={{ borderTop: "1px solid var(--border)" }}>
            <span className="text-[9px] text-muted-foreground">
              {lastRefreshed ? `Refreshed at ${lastRefreshed}` : "Auto-refreshes every 30s"}
            </span>
            <a
              href="https://dashboard.helius.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground transition-colors">
              Helius Dashboard <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>
        </>
      )}
    </div>
  );
}
