/**
 * RefundBanner — Dismissible warning banner shown on the Overview page
 * when the connected wallet has claimable (expired) HTLCs.
 *
 * Uses TWO data sources for reliability:
 *   1. DB refunds query (fast, includes pending HTLCs)
 *   2. On-chain scanner (verifies PDA still exists on-chain)
 *
 * Shows a banner with count + total amount + link to History → Refunds tab.
 * Dismissed state is stored in sessionStorage (resets on page reload).
 */
import { useState, useMemo } from "react";
import { AlertTriangle, X, ArrowRight } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface RefundBannerProps {
  walletAddresses: string[];
  onNavigateToRefunds: () => void;
}

const PRICE_ESTIMATES: Record<string, number> = {
  BTC: 95000, ETH: 3000, SOL: 150, USDT: 1, USDC: 1, TNK: 0.01,
};

export default function RefundBanner({ walletAddresses, onNavigateToRefunds }: RefundBannerProps) {
  const [dismissed, setDismissed] = useState(() => {
    return sessionStorage.getItem("afos_refund_banner_dismissed") === "1";
  });

  const enabled = walletAddresses.length > 0 && !dismissed;

  // Source 1: DB refunds query (fast — includes pending HTLCs now)
  const { data: dbData } = trpc.history.refunds.useQuery(
    { walletAddresses, search: "" },
    {
      enabled,
      refetchInterval: 30_000,
      staleTime: 15_000,
    }
  );

  // Source 2: On-chain scanner (slower but authoritative)
  const { data: onChainData } = trpc.history.myOnChainRefunds.useQuery(
    { walletAddresses },
    {
      enabled,
      refetchInterval: 5 * 60_000,
      staleTime: 60_000,
    }
  );

  // Count claimable from DB: only pending HTLCs where the timelock has expired.
  // locktime > 1_000_000_000 means it's a Unix timestamp (Solana/ETH); otherwise block height.
  // Block-height timelocks (BTC) are always shown as claimable since we can't check block height here.
  const dbClaimable = useMemo(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    return (dbData?.refunds ?? []).filter(r => {
      if (r.status !== "pending") return false;
      const isUnixTimelock = r.locktime > 1_000_000_000;
      if (isUnixTimelock) {
        // Only show as claimable if the timelock has actually expired
        return r.locktime < nowSec;
      }
      // Block-height timelocks (BTC): show as claimable (block check done elsewhere)
      return true;
    });
  }, [dbData]);

  // Count claimable from on-chain scanner: expired timelocks
  const onChainClaimable = useMemo(
    () => (onChainData?.htlcs ?? []).filter(h => h.timelockExpired),
    [onChainData]
  );

  // Merge: use whichever source found more claimable HTLCs (avoid double-counting)
  // DB is faster and more reliable; on-chain is authoritative but slower
  const claimableCount = Math.max(dbClaimable.length, onChainClaimable.length);

  // Calculate total USD from the best available source
  const totalUsd = useMemo(() => {
    if (onChainClaimable.length > 0) {
      return onChainClaimable.reduce((sum, h) => {
        const price = PRICE_ESTIMATES[h.token] ?? 1;
        return sum + parseFloat(h.amountHuman) * price;
      }, 0);
    }
    // Fallback to DB data
    return dbClaimable.reduce((sum, r) => {
      const fromSymbol = r.chain === "bitcoin" ? "BTC" : r.chain === "ethereum" ? "ETH" : r.chain === "trac_network" ? "TNK" : "SOL";
      const price = PRICE_ESTIMATES[fromSymbol] ?? 1;
      return sum + parseFloat(r.amountHuman) * price;
    }, 0);
  }, [onChainClaimable, dbClaimable]);

  // Build amount summary string
  const amountStr = useMemo(() => {
    if (onChainClaimable.length > 0) {
      const summary = onChainClaimable.reduce((acc, h) => {
        acc[h.token] = (acc[h.token] ?? 0) + parseFloat(h.amountHuman);
        return acc;
      }, {} as Record<string, number>);
      return Object.entries(summary)
        .map(([sym, amt]) => `${amt.toFixed(sym === "BTC" ? 8 : 4)} ${sym}`)
        .join(" + ");
    }
    // Fallback to DB data
    const summary = dbClaimable.reduce((acc, r) => {
      const sym = r.chain === "bitcoin" ? "BTC" : r.chain === "ethereum" ? "ETH" : r.chain === "trac_network" ? "TNK" : "SOL";
      acc[sym] = (acc[sym] ?? 0) + parseFloat(r.amountHuman);
      return acc;
    }, {} as Record<string, number>);
    return Object.entries(summary)
      .map(([sym, amt]) => `${amt.toFixed(sym === "BTC" ? 8 : 4)} ${sym}`)
      .join(" + ");
  }, [onChainClaimable, dbClaimable]);

  // Don't render if no wallet connected, dismissed, or no claimable HTLCs
  if (!enabled || claimableCount === 0) return null;

  const handleDismiss = () => {
    sessionStorage.setItem("afos_refund_banner_dismissed", "1");
    setDismissed(true);
  };

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl mx-4 sm:mx-5 mt-3"
      style={{
        background: "rgba(245,158,11,0.08)",
        border: "1px solid rgba(245,158,11,0.3)",
      }}
    >
      {/* Icon */}
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: "rgba(245,158,11,0.15)" }}
      >
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
      </div>

      {/* Message */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-amber-300">
          {claimableCount === 1
            ? "You have 1 HTLC with stuck funds"
            : `You have ${claimableCount} HTLCs with stuck funds`}
        </p>
        <p className="text-[10px] text-amber-400/70 truncate">
          {amountStr}
          {totalUsd > 0.01 && ` · ≈ $${totalUsd.toFixed(2)}`}
          {" · "}Timelock expired — recovery available
        </p>
      </div>

      {/* CTA */}
      <button
        onClick={onNavigateToRefunds}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold shrink-0 transition-all hover:opacity-80 active:scale-95"
        style={{
          background: "rgba(245,158,11,0.2)",
          border: "1px solid rgba(245,158,11,0.4)",
          color: "#f59e0b",
        }}
      >
        Recover Funds
        <ArrowRight className="w-3 h-3" />
      </button>

      {/* Dismiss */}
      <button
        onClick={handleDismiss}
        className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 text-amber-400/50 hover:text-amber-400 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
