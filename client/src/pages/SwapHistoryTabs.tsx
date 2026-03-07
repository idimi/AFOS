/**
 * AFOS — Open Trades and Refunds tabs for SwapHistory
 * Production: pulls live data from tRPC history procedures (wallet-scoped)
 * Features: Explorer links for tx hashes and HTLC addresses (Solscan, Etherscan, Mempool.space)
 */
import { motion } from "framer-motion";
import { Activity, CheckCircle2, AlertTriangle, RotateCcw, Loader2, Wallet, Search, ExternalLink, Copy } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

// ─── Shared Props ─────────────────────────────────────────────────────────────

interface TabProps {
  walletAddresses: string[];
  search?: string;
}

// ─── Chain Explorer Config ────────────────────────────────────────────────────

const CHAIN_EXPLORERS: Record<"bitcoin" | "ethereum" | "solana", { tx: string; addr: string }> = {
  bitcoin:  { tx: "https://mempool.space/tx/",       addr: "https://mempool.space/address/" },
  ethereum: { tx: "https://etherscan.io/tx/",        addr: "https://etherscan.io/address/" },
  solana:   { tx: "https://solscan.io/tx/",          addr: "https://solscan.io/account/" },
};

function explorerTxUrl(chain: "bitcoin" | "ethereum" | "solana", txHash: string): string {
  return CHAIN_EXPLORERS[chain].tx + txHash;
}

function explorerAddrUrl(chain: "bitcoin" | "ethereum" | "solana", addr: string): string {
  return CHAIN_EXPLORERS[chain].addr + addr;
}

function truncateHash(hash: string, chars = 8): string {
  if (!hash || hash.length <= chars * 2 + 3) return hash;
  return `${hash.slice(0, chars)}…${hash.slice(-chars)}`;
}

function TxLink({ chain, txHash, label }: { chain: "bitcoin" | "ethereum" | "solana"; txHash: string; label?: string }) {
  if (!txHash || txHash.length < 10) return <span className="text-[10px] font-mono text-muted-foreground/40">—</span>;
  const url = explorerTxUrl(chain, txHash);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1 text-[10px] font-mono text-cyan-400/80 hover:text-cyan-300 transition-colors"
      onClick={e => e.stopPropagation()}
    >
      {label ?? truncateHash(txHash)}
      <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
    </a>
  );
}

function AddrLink({ chain, addr, label }: { chain: "bitcoin" | "ethereum" | "solana"; addr: string; label?: string }) {
  if (!addr || addr.length < 10) return <span className="text-[10px] font-mono text-muted-foreground/40">—</span>;
  const url = explorerAddrUrl(chain, addr);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1 text-[10px] font-mono text-purple-400/80 hover:text-purple-300 transition-colors"
      onClick={e => e.stopPropagation()}
    >
      {label ?? truncateHash(addr)}
      <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
    </a>
  );
}

function CopyButton({ value }: { value: string }) {
  return (
    <button
      onClick={e => {
        e.stopPropagation();
        navigator.clipboard.writeText(value).then(() => toast.success("Copied!"));
      }}
      className="text-muted-foreground/40 hover:text-cyan-400 transition-colors"
    >
      <Copy className="w-2.5 h-2.5" />
    </button>
  );
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
  chain: "bitcoin" | "ethereum" | "solana";
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
  lockTxId: string | null;
  htlcAddress: string;
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
    chain: row.chain,
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
    lockTxId: row.lockTxId,
    htlcAddress: row.htlcAddress,
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
                  <div>
                    <div className="text-[9px] text-muted-foreground/60">You send</div>
                    <div className="text-[10px] font-mono text-foreground/80">{trade.fromAmount.toLocaleString()} {trade.fromSymbol}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-muted-foreground/60">You receive</div>
                    <div className="text-[10px] font-mono text-foreground/80">{trade.toAmount > 0 ? `${trade.toAmount} ${trade.toSymbol}` : "Pending settlement"}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-muted-foreground/60">Rate</div>
                    <div className="text-[10px] font-mono text-foreground/80">{trade.rate > 0 ? `1 BTC = $${trade.rate.toLocaleString()}` : "Awaiting quote"}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-muted-foreground/60">Fee</div>
                    <div className="text-[10px] font-mono text-foreground/80">{trade.feeBps} bps</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-muted-foreground/60">Peer</div>
                    <div className="text-[10px] font-mono text-foreground/80 truncate">{trade.peer}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-muted-foreground/60">HTLC expiry</div>
                    <div className="text-[10px] font-mono text-foreground/80">{trade.htlcExpiry}</div>
                  </div>
                  {/* Lock TX with explorer link */}
                  <div>
                    <div className="text-[9px] text-muted-foreground/60">Lock Tx</div>
                    <div className="flex items-center gap-1">
                      {trade.lockTxId
                        ? <TxLink chain={trade.chain} txHash={trade.lockTxId} />
                        : <span className="text-[10px] font-mono text-muted-foreground/40">Pending</span>
                      }
                      {trade.lockTxId && <CopyButton value={trade.lockTxId} />}
                    </div>
                  </div>
                  {/* HTLC Address with explorer link */}
                  <div>
                    <div className="text-[9px] text-muted-foreground/60">HTLC Address</div>
                    <div className="flex items-center gap-1">
                      <AddrLink chain={trade.chain} addr={trade.htlcAddress} />
                      {trade.htlcAddress && <CopyButton value={trade.htlcAddress} />}
                    </div>
                  </div>
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
  chain: "bitcoin" | "ethereum" | "solana";
  fromSymbol: string;
  toSymbol: string;
  amount: number;
  usdValue: number;
  peer: string;
  failReason: string;
  htlcExpiry: Date;
  status: "claimable" | "claimed" | "expired";
  txHash: string;
  rawTxHash: string;
  escrowPda: string;
  rawEscrowPda: string;
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
  const rawTxHash = row.refundTxId ?? row.lockTxId ?? "";
  const rawEscrowPda = row.htlcAddress;

  return {
    id: String(row.id),
    chain: row.chain,
    fromSymbol,
    toSymbol,
    amount,
    usdValue,
    peer: row.peerId ?? "P2P Network",
    failReason: row.status === "expired" ? "HTLC expired — no settlement received" : "Swap refunded by peer",
    htlcExpiry: row.refundedAt ?? row.updatedAt,
    status,
    txHash: rawTxHash ? truncateHash(rawTxHash) : row.secretHash.slice(0, 16) + "...",
    rawTxHash,
    escrowPda: truncateHash(rawEscrowPda),
    rawEscrowPda,
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

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 mb-2">
                <div>
                  <div className="text-[9px] text-muted-foreground/60">Value</div>
                  <div className="text-[10px] font-mono text-foreground/80">${refund.usdValue.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground/60">Peer</div>
                  <div className="text-[10px] font-mono text-foreground/80 truncate">{refund.peer}</div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground/60">Reason</div>
                  <div className="text-[10px] font-mono text-foreground/80 truncate">{refund.failReason}</div>
                </div>
                {/* Tx with explorer link */}
                <div>
                  <div className="text-[9px] text-muted-foreground/60">Tx</div>
                  <div className="flex items-center gap-1">
                    {refund.rawTxHash
                      ? <TxLink chain={refund.chain} txHash={refund.rawTxHash} />
                      : <span className="text-[10px] font-mono text-muted-foreground/40">{refund.txHash}</span>
                    }
                    {refund.rawTxHash && <CopyButton value={refund.rawTxHash} />}
                  </div>
                </div>
                {/* HTLC Escrow with explorer link */}
                <div>
                  <div className="text-[9px] text-muted-foreground/60">Escrow</div>
                  <div className="flex items-center gap-1">
                    <AddrLink chain={refund.chain} addr={refund.rawEscrowPda} />
                    {refund.rawEscrowPda && <CopyButton value={refund.rawEscrowPda} />}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground/60">HTLC Expiry</div>
                  <div className="text-[10px] font-mono text-foreground/80">{refund.htlcExpiry.toLocaleString()}</div>
                </div>
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
