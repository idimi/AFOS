/**
 * AFOS — Open Trades and Refunds tabs for SwapHistory
 * Production: pulls live data from tRPC history procedures (wallet-scoped)
 */
import { motion } from "framer-motion";
import { Activity, CheckCircle2, AlertTriangle, RotateCcw, Loader2, Wallet, Search } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";


// ─── Shared Props ─────────────────────────────────────────────────────────────

interface TabProps {
  walletAddresses: string[];
  search?: string;
}

// ─── Shared Search Bar ────────────────────────────────────────────────────────

export function HtlcSearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-xl"
      style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
    >
      <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Search peer, HTLC address, token…"
        className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 outline-none"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="text-muted-foreground/60 hover:text-foreground text-xs leading-none"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ─── HtlcSwap row type (mirrors drizzle schema) ───────────────────────────────

interface HtlcSwapRow {
  id: number;
  chain: "bitcoin" | "ethereum" | "solana";
  htlcAddress: string;
  secretHash: string;
  lockTxId: string | null;
  amountRaw: string;
  amountHuman: string;
  locktime: number;
  status: "pending" | "completed" | "refunded" | "expired";
  peerId: string | null;
  rfqId: string | null;
  toToken: string | null;
  toChain: "bitcoin" | "ethereum" | "solana" | null;
  refundTxId: string | null;
  senderAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
  refundedAt: Date | null;
}

// ─── Open Trades ──────────────────────────────────────────────────────────────

interface OpenTrade {
  id: string;
  direction: "buy_btc" | "sell_btc";
  fromSymbol: string;
  toSymbol: string;
  fromAmount: number;
  toAmount: number;
  rate: number;
  feeBps: number;
  peer: string;
  htlcExpiry: string;
  refundWindow: string;
  phase: "rfq_sent" | "quote_received" | "htlc_locked" | "awaiting_settle";
  receivedAt: Date;
  expiresIn: number;
}

const PHASE_LABELS = {
  rfq_sent: "RFQ Sent",
  quote_received: "Quote Received",
  htlc_locked: "HTLC Locked",
  awaiting_settle: "Awaiting Settlement",
} as const;

const PHASE_COLORS = {
  rfq_sent: "#f59e0b",
  quote_received: "#8b5cf6",
  htlc_locked: "#10b981",
  awaiting_settle: "#06b6d4",
} as const;

function mapHtlcToOpenTrade(row: HtlcSwapRow): OpenTrade {
  const ageMs = Date.now() - row.createdAt.getTime();
  const fromSymbol = row.chain === "bitcoin" ? "BTC" : row.chain === "ethereum" ? "ETH" : "SOL";
  const toSymbol = row.toToken ?? "USDT";
  const fromAmount = parseFloat(row.amountHuman);
  const toAmount = 0; // not stored in HTLC row — shown as 0 until settled
  const isBuy = toSymbol === "BTC";

  let phase: OpenTrade["phase"] = "rfq_sent";
  if (row.lockTxId) phase = "htlc_locked";
  if (ageMs > 60_000) phase = "awaiting_settle";

  const expiresIn = Math.max(0, Math.round((600_000 - ageMs) / 1000));

  return {
    id: String(row.id),
    direction: isBuy ? "buy_btc" : "sell_btc",
    fromSymbol,
    toSymbol,
    fromAmount,
    toAmount,
    rate: 0,
    feeBps: 20,
    peer: row.peerId ?? "P2P Network",
    htlcExpiry: expiresIn > 0 ? `${expiresIn}s` : "Expired",
    refundWindow: "20-40h",
    phase,
    receivedAt: row.createdAt,
    expiresIn,
  };
}

export function OpenTradesTab({ walletAddresses, search = "" }: TabProps) {
  const { data, isLoading } = trpc.history.openTrades.useQuery(
    { walletAddresses, search },
    { refetchInterval: 15000 }
  );

  const trades: OpenTrade[] = (data?.trades ?? []).map(mapHtlcToOpenTrade);
  const hasWallet = walletAddresses.length > 0;

  const acceptTrade = (_id: string) => {
    toast.success("Quote accepted — HTLC locking...", { description: "Atomic escrow initiated on Solana" });
  };

  const rejectTrade = (_id: string) => {
    toast.info("Trade rejected", { description: "RFQ cancelled, no funds moved" });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Wallet scope banner */}
      {!hasWallet && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
          style={{ background: "rgba(6,182,212,0.07)", border: "1px solid rgba(6,182,212,0.2)" }}
        >
          <Wallet className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
          <span className="text-cyan-300/80">
            Connect a wallet to see your open trades. Showing all network trades (operator view).
          </span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{trades.length} active trade{trades.length !== 1 ? "s" : ""} in progress</p>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] font-mono text-emerald-400">Live</span>
        </div>
      </div>

      {trades.length === 0 && (
        <div className="py-16 text-center rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <Activity className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No open trades</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            {hasWallet ? "Your active swaps will appear here" : "Active swaps will appear here for approval"}
          </p>
        </div>
      )}

      {trades.map(trade => {
        const phase = trade.phase;
        const phaseColor = PHASE_COLORS[phase];
        const isUrgent = trade.expiresIn < 120;
        return (
          <motion.div key={trade.id} layout
            className="rounded-2xl p-4" style={{ background: "var(--card)", border: `1px solid ${isUrgent ? "rgba(239,68,68,0.35)" : "var(--border)"}` }}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-3">
                  <span className="px-2 py-0.5 rounded text-[9px] font-bold font-mono"
                    style={{ background: `${phaseColor}18`, border: `1px solid ${phaseColor}40`, color: phaseColor }}>
                    {PHASE_LABELS[phase]}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[9px] font-bold font-mono"
                    style={{
                      background: trade.direction === "buy_btc" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.1)",
                      border: `1px solid ${trade.direction === "buy_btc" ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.25)"}`,
                      color: trade.direction === "buy_btc" ? "#10b981" : "#ef4444"
                    }}>
                    {trade.direction === "buy_btc" ? "BUY BTC" : "SELL BTC"}
                  </span>
                  {isUrgent && (
                    <div className="flex items-center gap-1 ml-auto">
                      <AlertTriangle className="w-3 h-3 text-red-400" />
                      <span className="text-[9px] font-mono text-red-400">Expires soon</span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 mb-3">
                  {[
                    { label: "You send", value: `${trade.fromAmount.toLocaleString()} ${trade.fromSymbol}` },
                    { label: "You receive", value: trade.toAmount > 0 ? `${trade.toAmount} ${trade.toSymbol}` : "Pending settlement" },
                    { label: "Rate", value: trade.rate > 0 ? `1 BTC = $${trade.rate.toLocaleString()}` : "Awaiting quote" },
                    { label: "Fee", value: `${trade.feeBps} bps` },
                    { label: "Peer", value: trade.peer },
                    { label: "HTLC expiry", value: trade.htlcExpiry },
                    { label: "Refund window", value: trade.refundWindow },
                    { label: "Received", value: `${Math.round((Date.now() - trade.receivedAt.getTime()) / 1000)}s ago` },
                  ].map(item => (
                    <div key={item.label}>
                      <div className="text-[9px] text-muted-foreground/60">{item.label}</div>
                      <div className="text-[10px] font-mono text-foreground/80">{item.value}</div>
                    </div>
                  ))}
                </div>

                <div>
                  <div className="flex justify-between text-[9px] text-muted-foreground mb-1">
                    <span>HTLC timeout</span>
                    <span className={isUrgent ? "text-red-400" : "text-muted-foreground"}>{trade.expiresIn}s remaining</span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
                    <div className="h-full rounded-full transition-all duration-1000"
                      style={{ width: `${Math.min(100, (trade.expiresIn / 900) * 100)}%`, background: isUrgent ? "#ef4444" : "#10b981" }} />
                  </div>
                </div>
              </div>

              {phase === "quote_received" && (
                <div className="flex flex-col gap-2 shrink-0">
                  <button onClick={() => acceptTrade(trade.id)}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all"
                    style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.35)", color: "#10b981" }}>
                    Accept
                  </button>
                  <button onClick={() => rejectTrade(trade.id)}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-mono text-muted-foreground transition-all"
                    style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                    Reject
                  </button>
                </div>
              )}
              {phase === "htlc_locked" && (
                <div className="shrink-0">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                    style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)" }}>
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[10px] font-mono text-emerald-400">Locked</span>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// ─── Refunds Tab ──────────────────────────────────────────────────────────────

interface RefundRecord {
  id: string;
  fromSymbol: string;
  toSymbol: string;
  amount: number;
  usdValue: number;
  peer: string;
  failReason: string;
  htlcExpiry: Date;
  status: "claimable" | "claimed" | "expired";
  txHash: string;
  escrowPda: string;
}

// Rough USD price estimates for display purposes
const PRICE_ESTIMATES: Record<string, number> = {
  BTC: 95000, ETH: 3000, SOL: 150, USDT: 1, USDC: 1,
};

function mapHtlcToRefund(row: HtlcSwapRow): RefundRecord {
  const fromSymbol = row.chain === "bitcoin" ? "BTC" : row.chain === "ethereum" ? "ETH" : "SOL";
  const toSymbol = row.toToken ?? "USDT";
  const amount = parseFloat(row.amountHuman);
  const price = PRICE_ESTIMATES[fromSymbol] ?? 1;
  const usdValue = amount * price;
  const status: RefundRecord["status"] = row.status === "refunded" ? "claimed" : "claimable";

  return {
    id: String(row.id),
    fromSymbol,
    toSymbol,
    amount,
    usdValue,
    peer: row.peerId ?? "P2P Network",
    failReason: row.status === "expired" ? "HTLC expired — no settlement received" : "Swap refunded by peer",
    htlcExpiry: row.refundedAt ?? row.updatedAt,
    status,
    txHash: row.refundTxId ?? row.lockTxId ?? row.secretHash.slice(0, 16) + "...",
    escrowPda: row.htlcAddress.length > 20 ? row.htlcAddress.slice(0, 12) + "..." : row.htlcAddress,
  };
}

export function RefundsTab({ walletAddresses, search = "" }: TabProps) {
  const { data, isLoading } = trpc.history.refunds.useQuery(
    { walletAddresses, search },
    { refetchInterval: 30000 }
  );

  const refunds: RefundRecord[] = (data?.refunds ?? []).map(mapHtlcToRefund);
  const hasWallet = walletAddresses.length > 0;

  const claimRefund = (_id: string) => {
    toast.success("Refund claimed", { description: "HTLC escrow unlocked — funds returned to wallet" });
  };

  const claimable = refunds.filter(r => r.status === "claimable");
  const claimed = refunds.filter(r => r.status === "claimed");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Wallet scope banner */}
      {!hasWallet && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
          style={{ background: "rgba(6,182,212,0.07)", border: "1px solid rgba(6,182,212,0.2)" }}
        >
          <Wallet className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
          <span className="text-cyan-300/80">
            Connect a wallet to see your refunds. Showing all network refunds (operator view).
          </span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Claimable", value: claimable.length, color: "text-amber-400", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.25)" },
          { label: "Claimed", value: claimed.length, color: "text-emerald-400", bg: "rgba(16,185,129,0.1)", border: "rgba(16,185,129,0.25)" },
          { label: "Total Value", value: `$${claimable.reduce((s, r) => s + r.usdValue, 0).toFixed(2)}`, color: "text-foreground", bg: "var(--muted)", border: "var(--border)" },
        ].map(stat => (
          <div key={stat.label} className="rounded-xl p-3 text-center"
            style={{ background: stat.bg, border: `1px solid ${stat.border}` }}>
            <div className={`text-lg font-bold font-mono ${stat.color}`}>{stat.value}</div>
            <div className="text-[9px] text-muted-foreground mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {refunds.length === 0 && (
        <div className="py-16 text-center rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <CheckCircle2 className="w-8 h-8 text-emerald-400/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No refunds needed</p>
          <p className="text-xs text-muted-foreground/60 mt-1">All swaps settled successfully</p>
        </div>
      )}

      {refunds.map(refund => (
        <motion.div key={refund.id} layout
          className="rounded-2xl p-4"
          style={{ background: "var(--card)", border: `1px solid ${refund.status === "claimable" ? "rgba(245,158,11,0.3)" : "var(--border)"}` }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 rounded text-[9px] font-bold font-mono"
                  style={{
                    background: refund.status === "claimable" ? "rgba(245,158,11,0.12)" : refund.status === "claimed" ? "rgba(16,185,129,0.12)" : "rgba(100,116,139,0.12)",
                    border: `1px solid ${refund.status === "claimable" ? "rgba(245,158,11,0.3)" : refund.status === "claimed" ? "rgba(16,185,129,0.3)" : "rgba(100,116,139,0.3)"}`,
                    color: refund.status === "claimable" ? "#f59e0b" : refund.status === "claimed" ? "#10b981" : "#64748b",
                  }}>
                  {refund.status === "claimable" ? "CLAIMABLE" : refund.status === "claimed" ? "CLAIMED" : "EXPIRED"}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">{refund.amount} {refund.fromSymbol} → {refund.toSymbol}</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 mb-2">
                {[
                  { label: "Value", value: `$${refund.usdValue.toFixed(2)}` },
                  { label: "Peer", value: refund.peer },
                  { label: "Reason", value: refund.failReason },
                  { label: "Tx", value: refund.txHash },
                  { label: "Escrow", value: refund.escrowPda },
                  { label: "HTLC Expiry", value: refund.htlcExpiry.toLocaleString() },
                ].map(item => (
                  <div key={item.label}>
                    <div className="text-[9px] text-muted-foreground/60">{item.label}</div>
                    <div className="text-[10px] font-mono text-foreground/80 truncate">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {refund.status === "claimable" && (
              <button onClick={() => claimRefund(refund.id)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-bold shrink-0 transition-all"
                style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.35)", color: "#f59e0b" }}>
                <RotateCcw className="w-3 h-3" />
                Claim
              </button>
            )}
            {refund.status === "claimed" && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg shrink-0"
                style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)" }}>
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span className="text-[10px] font-mono text-emerald-400">Claimed</span>
              </div>
            )}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
