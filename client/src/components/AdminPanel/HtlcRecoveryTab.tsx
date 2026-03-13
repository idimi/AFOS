/**
 * HtlcRecoveryTab — Admin panel tab for monitoring and recovering stuck HTLCs
 * across all chains (Solana, Ethereum, Bitcoin).
 *
 * Shows all expired on-chain HTLCs regardless of who owns them.
 * Server-side refund is available for server-owned HTLCs.
 * User-owned HTLCs show a "Notify User" button.
 */
import { useState } from "react";
import {
  RefreshCw, AlertTriangle, CheckCircle2, Loader2, Copy,
  ExternalLink, Shield, Clock, Zap, ChevronDown, ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

// ─── Chain helpers ────────────────────────────────────────────────────────────

const CHAIN_COLORS: Record<string, string> = {
  solana: "#9945ff",
  ethereum: "#627eea",
  bitcoin: "#f7931a",
};

const CHAIN_LABELS: Record<string, string> = {
  solana: "SOL",
  ethereum: "ETH",
  bitcoin: "BTC",
};

function explorerUrl(chain: string, address: string): string {
  if (chain === "solana") return `https://solscan.io/account/${address}`;
  if (chain === "ethereum") return `https://etherscan.io/address/${address}`;
  if (chain === "bitcoin") return `https://mempool.space/address/${address}`;
  return "#";
}

function formatCountdown(timelockExpiry: number): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const diff = timelockExpiry - nowSec;
  if (diff <= 0) {
    const ago = Math.abs(diff);
    if (ago < 60) return `Expired ${ago}s ago`;
    if (ago < 3600) return `Expired ${Math.floor(ago / 60)}m ago`;
    if (ago < 86400) return `Expired ${Math.floor(ago / 3600)}h ago`;
    return `Expired ${Math.floor(ago / 86400)}d ago`;
  }
  if (diff < 60) return `${diff}s left`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m left`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h left`;
  return `${Math.floor(diff / 86400)}d left`;
}

// ─── Component ────────────────────────────────────────────────────────────────

// ─── Stuck Swaps sub-component ──────────────────────────────────────────────

function StuckSwapsSection() {
  const { data, isLoading, refetch, isFetching } = trpc.history.getStuckSwaps.useQuery(
    undefined,
    { refetchInterval: 60_000 }
  );

  const forceClaimMut = trpc.history.forceClaimSwap.useMutation({
    onSuccess: (res) => {
      if (res.success) {
        toast.success(`Force claim succeeded: ${res.results.map(r => r.txSignature?.slice(0, 8) + '…').join(', ')}`);
      } else {
        toast.warning(`Partial success: ${res.message}`);
      }
      refetch();
    },
    onError: (err) => toast.error(`Force claim failed: ${err.message}`),
  });

  const swaps = data?.swaps ?? [];

  return (
    <div className="rounded-2xl overflow-hidden mt-4" style={{ border: "1px solid rgba(239,68,68,0.25)" }}>
      {/* Section header */}
      <div
        className="flex items-center gap-2 px-4 py-3"
        style={{ background: "rgba(239,68,68,0.08)", borderBottom: "1px solid rgba(239,68,68,0.2)" }}
      >
        <Zap className="w-4 h-4 text-red-400" />
        <p className="text-sm font-bold text-red-300">Stuck Swaps — Secret Revealed but Not Claimed</p>
        <span
          className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: "rgba(239,68,68,0.2)", color: "#ef4444" }}
        >
          {isLoading ? '…' : swaps.length}
        </span>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-all ml-2"
          style={{ background: "var(--muted)", border: "1px solid var(--border)", color: "var(--muted-foreground)" }}
        >
          <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-8 gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Loading stuck swaps…</span>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && swaps.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <CheckCircle2 className="w-6 h-6 text-emerald-400" />
          <p className="text-xs text-muted-foreground">No stuck swaps — all secrets have been claimed.</p>
        </div>
      )}

      {/* Stuck swap rows */}
      {swaps.length > 0 && (
        <div className="divide-y" style={{ borderColor: "rgba(239,68,68,0.1)" }}>
          {swaps.map((swap) => (
            <div key={swap.rfqId} className="px-4 py-3 space-y-2">
              {/* Row header */}
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}
                    >
                      {swap.minutesStuck}m stuck
                    </span>
                    <span className="text-xs font-mono text-muted-foreground truncate">
                      {swap.rfqId.slice(0, 30)}…
                    </span>
                    <button
                      onClick={() => { navigator.clipboard.writeText(swap.rfqId); toast.success('rfqId copied'); }}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>{swap.fromChain} → {swap.toChain}</span>
                    <span>{swap.fromToken ?? '?'} → {swap.toToken ?? '?'}</span>
                    {swap.htlcId && (
                      <a
                        href={`https://solscan.io/account/${swap.htlcId}`}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-0.5 text-blue-400 hover:text-blue-300"
                      >
                        <ExternalLink className="w-2.5 h-2.5" />
                        HTLC
                      </a>
                    )}
                  </div>
                  {/* HTLC swap rows */}
                  {swap.htlcSwaps.length > 0 && (
                    <div className="flex gap-2 mt-1 flex-wrap">
                      {swap.htlcSwaps.map((s, i) => (
                        <span
                          key={i}
                          className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                          style={{
                            background: s.status === 'completed' ? 'rgba(52,211,153,0.1)' : 'rgba(251,191,36,0.1)',
                            color: s.status === 'completed' ? '#34d399' : '#fbbf24',
                            border: `1px solid ${s.status === 'completed' ? 'rgba(52,211,153,0.2)' : 'rgba(251,191,36,0.2)'}`,
                          }}
                        >
                          {s.htlcId?.slice(0, 8)}… · {s.status} · {s.toToken ?? '?'}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {/* Force Claim button */}
                <button
                  onClick={() => forceClaimMut.mutate({ rfqId: swap.rfqId })}
                  disabled={forceClaimMut.isPending}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                  style={{
                    background: forceClaimMut.isPending ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.15)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    color: '#f87171',
                  }}
                >
                  {forceClaimMut.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Zap className="w-3 h-3" />
                  )}
                  Force Claim
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function HtlcRecoveryTab() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = trpc.history.myOnChainRefunds.useQuery(
    { walletAddresses: [], adminOverride: true }, // admin: scan all, no wallet filter
    { refetchInterval: 120_000 }
  );

  const updateHtlcRefund = trpc.history.updateHtlcRefund.useMutation({
    onSuccess: () => {
      toast.success("Refund recorded in database");
      refetch();
    },
    onError: (err) => toast.error(`DB update failed: ${err.message}`),
  });

  const htlcs = data?.htlcs ?? [];
  const expired = htlcs.filter(h => h.timelockExpired);
  const pending = htlcs.filter(h => !h.timelockExpired);

  const totalUsd = expired.reduce((sum, h) => {
    const price = h.token === "BTC" ? 95000 : h.token === "ETH" ? 3000 : h.token === "SOL" ? 150 : 1;
    return sum + parseFloat(h.amountHuman) * price;
  }, 0);

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* Header KPI row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label: "Expired HTLCs",
            value: expired.length,
            color: "#f59e0b",
            bg: "rgba(245,158,11,0.08)",
            border: "rgba(245,158,11,0.2)",
          },
          {
            label: "Pending HTLCs",
            value: pending.length,
            color: "#60a5fa",
            bg: "rgba(96,165,250,0.08)",
            border: "rgba(96,165,250,0.2)",
          },
          {
            label: "Est. USD at Risk",
            value: `$${totalUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
            color: "#f87171",
            bg: "rgba(248,113,113,0.08)",
            border: "rgba(248,113,113,0.2)",
          },
        ].map(kpi => (
          <div
            key={kpi.label}
            className="rounded-xl p-3 text-center"
            style={{ background: kpi.bg, border: `1px solid ${kpi.border}` }}
          >
            <p className="text-[10px] text-muted-foreground mb-1">{kpi.label}</p>
            <p className="text-lg font-bold" style={{ color: kpi.color }}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Refresh button */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Scanning SOL · ETH · BTC chains for stuck/expired HTLCs
        </p>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
          style={{
            background: "var(--muted)",
            border: "1px solid var(--border)",
            color: "var(--muted-foreground)",
          }}
        >
          <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          {isFetching ? "Scanning…" : "Refresh"}
        </button>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-12 gap-2">
          <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
          <span className="text-xs text-muted-foreground">Scanning all chains…</span>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && htlcs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <CheckCircle2 className="w-8 h-8 text-emerald-400" />
          <p className="text-sm font-semibold text-foreground">No stuck HTLCs found</p>
          <p className="text-xs text-muted-foreground">All on-chain HTLCs are either active or already settled.</p>
        </div>
      )}

      {/* Expired HTLCs section */}
      {expired.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(245,158,11,0.25)" }}>
          <div
            className="flex items-center gap-2 px-4 py-3"
            style={{ background: "rgba(245,158,11,0.08)", borderBottom: "1px solid rgba(245,158,11,0.2)" }}
          >
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <p className="text-sm font-bold text-amber-300">Expired — Claimable Refunds</p>
            <span
              className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: "rgba(245,158,11,0.2)", color: "#f59e0b" }}
            >
              {expired.length}
            </span>
          </div>
          <div className="divide-y divide-amber-900/20">
            {expired.map(h => (
              <HtlcRow
                key={h.pdaAddress}
                htlc={h}
                expanded={expandedId === h.pdaAddress}
                onToggle={() => setExpandedId(expandedId === h.pdaAddress ? null : h.pdaAddress)}
                onMarkRefunded={(txId) => updateHtlcRefund.mutate({ htlcAddress: h.pdaAddress, refundTxId: txId })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Pending HTLCs section */}
      {pending.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <div
            className="flex items-center gap-2 px-4 py-3"
            style={{ background: "var(--muted)", borderBottom: "1px solid var(--border)" }}
          >
            <Clock className="w-4 h-4 text-blue-400" />
            <p className="text-sm font-bold text-foreground">Active — Timelock Running</p>
            <span
              className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: "rgba(96,165,250,0.15)", color: "#60a5fa" }}
            >
              {pending.length}
            </span>
          </div>
          <div className="divide-y divide-border">
            {pending.map(h => (
              <HtlcRow
                key={h.pdaAddress}
                htlc={h}
                expanded={expandedId === h.pdaAddress}
                onToggle={() => setExpandedId(expandedId === h.pdaAddress ? null : h.pdaAddress)}
                onMarkRefunded={(txId) => updateHtlcRefund.mutate({ htlcAddress: h.pdaAddress, refundTxId: txId })}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── HTLC Row ─────────────────────────────────────────────────────────────────

interface HtlcRowProps {
  htlc: {
    htlcId: string;
    pdaAddress: string;
    senderAddress: string;
    amountHuman: string;
    token: string;
    chain: string;
    timelockExpiry: number;
    timelockExpired: boolean;
    dbStatus: string | null;
    rfqId: string | null;
    secretHash: string | null;
  };
  expanded: boolean;
  onToggle: () => void;
  onMarkRefunded: (txId: string) => void;
}

function HtlcRow({ htlc, expanded, onToggle, onMarkRefunded }: HtlcRowProps) {
  const [manualTxId, setManualTxId] = useState("");
  const chainColor = CHAIN_COLORS[htlc.chain] ?? "#888";

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  return (
    <div>
      {/* Row summary */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
        onClick={onToggle}
      >
        {/* Chain badge */}
        <span
          className="text-[9px] font-bold px-1.5 py-0.5 rounded-md shrink-0"
          style={{ background: `${chainColor}20`, color: chainColor, border: `1px solid ${chainColor}40` }}
        >
          {CHAIN_LABELS[htlc.chain] ?? htlc.chain.toUpperCase()}
        </span>

        {/* Amount */}
        <span className="text-sm font-bold text-foreground shrink-0">
          {parseFloat(htlc.amountHuman).toFixed(htlc.token === "BTC" ? 8 : 4)} {htlc.token}
        </span>

        {/* Sender */}
        <span className="text-[10px] font-mono text-muted-foreground truncate flex-1">
          {htlc.senderAddress.slice(0, 8)}…{htlc.senderAddress.slice(-6)}
        </span>

        {/* Timelock */}
        <span
          className="text-[10px] font-semibold shrink-0"
          style={{ color: htlc.timelockExpired ? "#f59e0b" : "#60a5fa" }}
        >
          {formatCountdown(htlc.timelockExpiry)}
        </span>

        {/* DB status */}
        {htlc.dbStatus && (
          <span
            className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md shrink-0"
            style={{
              background: htlc.dbStatus === "refunded" ? "rgba(52,211,153,0.1)" : "rgba(148,163,184,0.1)",
              color: htlc.dbStatus === "refunded" ? "#34d399" : "#94a3b8",
              border: `1px solid ${htlc.dbStatus === "refunded" ? "rgba(52,211,153,0.2)" : "rgba(148,163,184,0.2)"}`,
            }}
          >
            {htlc.dbStatus}
          </span>
        )}

        {/* Expand icon */}
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div
          className="px-4 pb-4 space-y-3"
          style={{ borderTop: "1px solid var(--border)", background: "rgba(0,0,0,0.15)" }}
        >
          {/* Detail rows */}
          {[
            { label: "HTLC ID", value: htlc.htlcId },
            { label: "PDA / Contract", value: htlc.pdaAddress },
            { label: "Sender", value: htlc.senderAddress },
            ...(htlc.secretHash ? [{ label: "Secret Hash", value: htlc.secretHash }] : []),
            ...(htlc.rfqId ? [{ label: "RFQ ID", value: htlc.rfqId }] : []),
          ].map(({ label, value }) => (
            <div key={label} className="flex items-start gap-2 pt-2">
              <span className="text-[10px] text-muted-foreground w-24 shrink-0 pt-0.5">{label}</span>
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <span className="text-[10px] font-mono text-foreground break-all">{value}</span>
                <button
                  onClick={() => copy(value, label)}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}

          {/* Timelock detail */}
          <div className="flex items-start gap-2 pt-1">
            <span className="text-[10px] text-muted-foreground w-24 shrink-0 pt-0.5">Timelock</span>
            <span className="text-[10px] font-mono text-foreground">
              {htlc.timelockExpiry} ({new Date(htlc.timelockExpiry * 1000).toLocaleString()})
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-2 flex-wrap">
            {/* Explorer link */}
            <a
              href={explorerUrl(htlc.chain, htlc.pdaAddress)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
              style={{
                background: `${chainColor}15`,
                border: `1px solid ${chainColor}30`,
                color: chainColor,
              }}
            >
              <ExternalLink className="w-3 h-3" />
              View on Explorer
            </a>

            {/* Manual refund recording */}
            {htlc.timelockExpired && (
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <input
                  type="text"
                  placeholder="Paste refund tx hash…"
                  value={manualTxId}
                  onChange={e => setManualTxId(e.target.value)}
                  className="flex-1 min-w-0 text-[10px] font-mono px-2 py-1.5 rounded-lg bg-transparent outline-none"
                  style={{ border: "1px solid var(--border)", color: "var(--foreground)" }}
                />
                <button
                  disabled={!manualTxId.trim()}
                  onClick={() => {
                    onMarkRefunded(manualTxId.trim());
                    setManualTxId("");
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all disabled:opacity-40"
                  style={{
                    background: "rgba(52,211,153,0.1)",
                    border: "1px solid rgba(52,211,153,0.25)",
                    color: "#34d399",
                  }}
                >
                  <Shield className="w-3 h-3" />
                  Mark Refunded
                </button>
              </div>
            )}
          </div>

          {/* Solana refund instruction */}
          {htlc.chain === "solana" && htlc.timelockExpired && (
            <div
              className="rounded-xl p-3 text-[10px] leading-relaxed"
              style={{ background: "rgba(153,69,255,0.06)", border: "1px solid rgba(153,69,255,0.15)" }}
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <Zap className="w-3 h-3 text-purple-400" />
                <span className="font-semibold text-purple-300">User Self-Service Refund</span>
              </div>
              <p className="text-muted-foreground">
                The original sender (<span className="font-mono text-foreground">{htlc.senderAddress.slice(0, 8)}…</span>)
                can reclaim their SOL from the History → Refunds tab. The on-chain program enforces that only the
                original sender can trigger the refund after timelock expiry.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Stuck Swaps section ── */}
      <StuckSwapsSection />
    </div>
  );
}
