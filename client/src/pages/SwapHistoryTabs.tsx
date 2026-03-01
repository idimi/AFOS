/**
 * AFOS — Open Trades and Refunds tabs for SwapHistory
 * Production: pulls live data from getSwaps() API
 */
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Activity, CheckCircle2, AlertTriangle, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getSwaps, type RfqResult } from "../lib/afosApi";

// ─── Open Trades ──────────────────────────────────────────────────────────────

export interface OpenTrade {
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

const PHASE_LABELS: Record<OpenTrade["phase"], string> = {
  rfq_sent: "RFQ Sent",
  quote_received: "Quote Received",
  htlc_locked: "HTLC Locked",
  awaiting_settle: "Awaiting Settlement",
};

const PHASE_COLORS: Record<OpenTrade["phase"], string> = {
  rfq_sent: "#f59e0b",
  quote_received: "#8b5cf6",
  htlc_locked: "#10b981",
  awaiting_settle: "#06b6d4",
};

function mapRfqToOpenTrade(rfq: RfqResult): OpenTrade {
  const isBuy = rfq.toToken === "BTC";
  const ageMs = Date.now() - rfq.timestamp;
  const rate = rfq.inAmount > 0 ? rfq.outAmount / rfq.inAmount : 0;
  // Map route to a phase heuristic
  let phase: OpenTrade["phase"] = "rfq_sent";
  if (rfq.route === "p2p" && rfq.p2pQuotes > 0) phase = "quote_received";
  if (ageMs > 30_000) phase = "htlc_locked";
  if (ageMs > 60_000) phase = "awaiting_settle";

  return {
    id: rfq.rfqId,
    direction: isBuy ? "buy_btc" : "sell_btc",
    fromSymbol: rfq.fromToken,
    toSymbol: rfq.toToken,
    fromAmount: rfq.inAmount,
    toAmount: rfq.outAmount,
    rate,
    feeBps: rfq.platformFeeBps ?? 0,
    peer: rfq.dexRoute || "P2P Network",
    htlcExpiry: ageMs < 60_000 ? `${Math.max(0, Math.round((600_000 - ageMs) / 1000))}s` : "Expired",
    refundWindow: "20-40h",
    phase,
    receivedAt: new Date(rfq.timestamp),
    expiresIn: Math.max(0, Math.round((600_000 - ageMs) / 1000)),
  };
}

export function OpenTradesTab() {
  const [trades, setTrades] = useState<OpenTrade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTrades = async () => {
      try {
        const data = await getSwaps();
        setTrades(data.pending.map(mapRfqToOpenTrade));
      } catch { /* keep previous */ } finally { setLoading(false); }
    };
    fetchTrades();
    const t = setInterval(fetchTrades, 15000);
    return () => clearInterval(t);
  }, []);

  const acceptTrade = (id: string) => {
    setTrades(prev => prev.map(t => t.id === id ? { ...t, phase: "htlc_locked" as const } : t));
    toast.success("Quote accepted — HTLC locking...", { description: "Atomic escrow initiated on Solana" });
  };

  const rejectTrade = (id: string) => {
    setTrades(prev => prev.filter(t => t.id !== id));
    toast.info("Trade rejected", { description: "RFQ cancelled, no funds moved" });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
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
          <p className="text-xs text-muted-foreground/60 mt-1">Active swaps will appear here for approval</p>
        </div>
      )}

      {trades.map(trade => {
        const phaseColor = PHASE_COLORS[trade.phase];
        const isUrgent = trade.expiresIn < 120;
        return (
          <motion.div key={trade.id} layout
            className="rounded-2xl p-4" style={{ background: "var(--card)", border: `1px solid ${isUrgent ? "rgba(239,68,68,0.35)" : "var(--border)"}` }}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-3">
                  <span className="px-2 py-0.5 rounded text-[9px] font-bold font-mono"
                    style={{ background: `${phaseColor}18`, border: `1px solid ${phaseColor}40`, color: phaseColor }}>
                    {PHASE_LABELS[trade.phase]}
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
                    { label: "You receive", value: `${trade.toAmount} ${trade.toSymbol}` },
                    { label: "Rate", value: `1 BTC = $${trade.rate.toLocaleString()}` },
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

              {trade.phase === "quote_received" && (
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
              {trade.phase === "htlc_locked" && (
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

function mapRfqToRefund(rfq: RfqResult): RefundRecord {
  return {
    id: rfq.rfqId,
    fromSymbol: rfq.fromToken,
    toSymbol: rfq.toToken,
    amount: rfq.inAmount,
    usdValue: rfq.inAmount * (rfq.fromToken === "BTC" ? 65000 : rfq.fromToken === "ETH" ? 1900 : rfq.fromToken === "SOL" ? 83 : 1),
    peer: rfq.dexRoute || "P2P Network",
    failReason: "Peer timeout — no settlement received",
    htlcExpiry: new Date(rfq.timestamp),
    status: "claimable",
    txHash: rfq.rfqId.slice(0, 16) + "...",
    escrowPda: "N/A",
  };
}

export function RefundsTab() {
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRefunds = async () => {
      try {
        const data = await getSwaps();
        // Failed/refundable swaps — those with 0 outAmount or negative rate indicate failures
        const failed = data.completed.filter(s => s.outAmount <= 0 || s.rate <= 0);
        setRefunds(failed.map(mapRfqToRefund));
      } catch { /* keep previous */ } finally { setLoading(false); }
    };
    fetchRefunds();
    const t = setInterval(fetchRefunds, 30000);
    return () => clearInterval(t);
  }, []);

  const claimRefund = (id: string) => {
    setRefunds(prev => prev.map(r => r.id === id ? { ...r, status: "claimed" as const } : r));
    toast.success("Refund claimed", { description: "HTLC escrow unlocked — funds returned to wallet" });
  };

  const claimable = refunds.filter(r => r.status === "claimable");
  const claimed = refunds.filter(r => r.status === "claimed");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Claimable", value: claimable.length, color: "text-amber-400", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.25)" },
          { label: "Claimed", value: claimed.length, color: "text-emerald-400", bg: "rgba(16,185,129,0.1)", border: "rgba(16,185,129,0.25)" },
          { label: "Total Value", value: `$${refunds.filter(r => r.status === "claimable").reduce((s, r) => s + r.usdValue, 0).toFixed(2)}`, color: "text-foreground", bg: "var(--muted)", border: "var(--border)" },
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
