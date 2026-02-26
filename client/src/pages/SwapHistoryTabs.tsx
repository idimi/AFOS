/**
 * AFOS — Open Trades and Refunds tabs for SwapHistory
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, CheckCircle2, AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";

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

const MOCK_OPEN_TRADES: OpenTrade[] = [
  { id: "ot_1", direction: "buy_btc", fromSymbol: "USDT", toSymbol: "BTC", fromAmount: 432.50, toAmount: 0.00996, rate: 43418, feeBps: 12, peer: "GammaLN", htlcExpiry: "9m 42s", refundWindow: "20-40h", phase: "quote_received", receivedAt: new Date(Date.now() - 45000), expiresIn: 582 },
  { id: "ot_2", direction: "sell_btc", fromSymbol: "BTC", toSymbol: "USDT", fromAmount: 0.005, toAmount: 216.80, rate: 43360, feeBps: 18, peer: "AlphaNode", htlcExpiry: "14m 11s", refundWindow: "20-40h", phase: "htlc_locked", receivedAt: new Date(Date.now() - 120000), expiresIn: 851 },
  { id: "ot_3", direction: "buy_btc", fromSymbol: "USDT", toSymbol: "BTC", fromAmount: 100.00, toAmount: 0.00230, rate: 43478, feeBps: 8, peer: "IotaSwap", htlcExpiry: "2m 05s", refundWindow: "20-40h", phase: "rfq_sent", receivedAt: new Date(Date.now() - 12000), expiresIn: 125 },
];

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

export function OpenTradesTab() {
  const [trades, setTrades] = useState<OpenTrade[]>(MOCK_OPEN_TRADES);

  const acceptTrade = (id: string) => {
    setTrades(prev => prev.map(t => t.id === id ? { ...t, phase: "htlc_locked" as const } : t));
    toast.success("Quote accepted — HTLC locking...", { description: "Atomic escrow initiated on Solana" });
  };

  const rejectTrade = (id: string) => {
    setTrades(prev => prev.filter(t => t.id !== id));
    toast.info("Trade rejected", { description: "RFQ cancelled, no funds moved" });
  };

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

const MOCK_REFUNDS: RefundRecord[] = [
  { id: "ref_1", fromSymbol: "BTC", toSymbol: "USDT", amount: 0.003, usdValue: 130.25, peer: "EpsilonPeer", failReason: "Peer timeout — no settlement received", htlcExpiry: new Date(Date.now() - 3600000), status: "claimable", txHash: "0x4f2a8c1e9b3d7f0a...", escrowPda: "7xKp...9mNz" },
  { id: "ref_2", fromSymbol: "ETH", toSymbol: "BTC", amount: 0.12, usdValue: 359.76, peer: "DeltaNode", failReason: "Rate mismatch — quote expired before acceptance", htlcExpiry: new Date(Date.now() - 86400000), status: "claimed", txHash: "0x8c1e4f2a7b9d3e0f...", escrowPda: "3mKp...7nXz" },
  { id: "ref_3", fromSymbol: "BTC", toSymbol: "USDT", amount: 0.001, usdValue: 43.42, peer: "ZetaHub", failReason: "Insufficient peer liquidity", htlcExpiry: new Date(Date.now() + 7200000), status: "claimable", txHash: "0x2d9b7a3c1f6d8e4b...", escrowPda: "9nXz...4mKp" },
];

export function RefundsTab() {
  const [refunds, setRefunds] = useState<RefundRecord[]>(MOCK_REFUNDS);

  const claimRefund = (id: string) => {
    setRefunds(prev => prev.map(r => r.id === id ? { ...r, status: "claimed" as const } : r));
    toast.success("Refund claimed", { description: "HTLC escrow unlocked — funds returned to wallet" });
  };

  const claimable = refunds.filter(r => r.status === "claimable");
  const claimed = refunds.filter(r => r.status === "claimed");

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
                    border: `1px solid ${refund.status === "claimable" ? "rgba(245,158,11,0.3)" : refund.status === "claimed" ? "rgba(16,185,129,0.3)" : "rgba(100,116,139,0.2)"}`,
                    color: refund.status === "claimable" ? "#f59e0b" : refund.status === "claimed" ? "#10b981" : "#64748b",
                  }}>
                  {refund.status.toUpperCase()}
                </span>
                <span className="text-xs font-mono font-semibold text-foreground">
                  {refund.amount} {refund.fromSymbol} <span className="text-muted-foreground text-[10px]">approx ${refund.usdValue.toFixed(2)}</span>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-2">
                {[
                  { label: "Failed peer", value: refund.peer },
                  { label: "Escrow PDA", value: refund.escrowPda },
                  { label: "HTLC expired", value: refund.htlcExpiry < new Date() ? `${Math.round((Date.now() - refund.htlcExpiry.getTime()) / 3600000)}h ago` : `in ${Math.round((refund.htlcExpiry.getTime() - Date.now()) / 3600000)}h` },
                  { label: "Tx hash", value: refund.txHash },
                ].map(item => (
                  <div key={item.label}>
                    <div className="text-[9px] text-muted-foreground/60">{item.label}</div>
                    <div className="text-[10px] font-mono text-foreground/70 truncate">{item.value}</div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground/60 italic">{refund.failReason}</p>
            </div>
            {refund.status === "claimable" && (
              <button onClick={() => claimRefund(refund.id)}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all"
                style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.35)", color: "#f59e0b" }}>
                <RotateCcw className="w-3 h-3" />
                Claim Refund
              </button>
            )}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
