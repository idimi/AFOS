/**
 * RefundBanner — Dismissible warning banner shown on the Overview page
 * when the connected wallet has claimable (expired) HTLCs.
 *
 * Queries myOnChainRefunds with the user's wallet addresses.
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

  const { data } = trpc.history.myOnChainRefunds.useQuery(
    { walletAddresses },
    {
      enabled: walletAddresses.length > 0 && !dismissed,
      refetchInterval: 5 * 60_000, // re-check every 5 minutes
      staleTime: 60_000,
    }
  );

  const claimable = useMemo(
    () => (data?.htlcs ?? []).filter(h => h.timelockExpired),
    [data]
  );

  const totalUsd = useMemo(
    () => claimable.reduce((sum, h) => {
      const price = PRICE_ESTIMATES[h.token] ?? 1;
      return sum + parseFloat(h.amountHuman) * price;
    }, 0),
    [claimable]
  );

  // Don't render if no wallet connected, dismissed, or no claimable HTLCs
  if (walletAddresses.length === 0 || dismissed || claimable.length === 0) return null;

  const handleDismiss = () => {
    sessionStorage.setItem("afos_refund_banner_dismissed", "1");
    setDismissed(true);
  };

  const amountSummary = claimable
    .reduce((acc, h) => {
      acc[h.token] = (acc[h.token] ?? 0) + parseFloat(h.amountHuman);
      return acc;
    }, {} as Record<string, number>);

  const amountStr = Object.entries(amountSummary)
    .map(([sym, amt]) => `${amt.toFixed(sym === "BTC" ? 8 : 4)} ${sym}`)
    .join(" + ");

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
          {claimable.length === 1
            ? "You have 1 claimable refund"
            : `You have ${claimable.length} claimable refunds`}
        </p>
        <p className="text-[10px] text-amber-400/70 truncate">
          {amountStr}
          {totalUsd > 0.01 && ` · ≈ $${totalUsd.toFixed(2)}`}
          {" · "}HTLCs expired — funds locked on-chain
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
        Claim Now
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
