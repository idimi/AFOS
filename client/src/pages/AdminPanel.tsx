/**
 * AdminPanel — Hidden operator dashboard at /admin
 * NOT linked from consumer UI. Password protected.
 * Design: Dark terminal aesthetic, data-dense, operator-focused
 */

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Lock, Eye, EyeOff, Shield, DollarSign, Wallet, Settings,
  BarChart3, Activity, AlertTriangle, CheckCircle2, Copy,
  Plus, Trash2, Save, RefreshCw, TrendingUp, Zap, Users,
  ArrowUpRight, Server, Database,
  Cpu, QrCode, X, Bot, Network, Repeat, Moon, ToggleLeft, ToggleRight
} from "lucide-react";
import { getWallet, mergeWithAllAssets, type WalletAsset } from "@/lib/afosApi";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import QRCode from "react-qr-code";

// ─── Admin password (in production this would be server-side auth) ────────────
const ADMIN_PASSWORD = "afos-admin-2024";
const ADMIN_SESSION_KEY = "afos_admin_session";

// ─── Types ────────────────────────────────────────────────────────────────────
interface TreasuryWallet {
  id: string;
  label: string;
  chain: "solana" | "ethereum" | "bitcoin";
  address: string;
  splitPercent: number;
}

// ─── Revenue Tab (DB-backed) ─────────────────────────────────────────────────
function RevenueTab() {
  const [days, setDays] = useState(30);
  const { data: feeData, isLoading } = trpc.analytics.feeRevenue.useQuery({ days }, { staleTime: 30_000 });
  const { data: volumeData } = trpc.analytics.volumeByChain.useQuery({ days }, { staleTime: 30_000 });

  const totalFee  = feeData?.totalFeeUsd ?? 0;
  const p2pFee    = feeData?.p2pFeeUsd   ?? 0;
  const dexFee    = feeData?.dexFeeUsd   ?? 0;
  const totalSwps = feeData?.totalSwaps  ?? 0;
  const p2pSwps   = feeData?.p2pSwaps    ?? 0;
  const dexSwps   = feeData?.dexSwaps    ?? 0;
  const avgFee    = feeData?.avgFeeUsd   ?? 0;
  const p2pPct    = totalSwps > 0 ? ((p2pSwps / totalSwps) * 100).toFixed(1) : "0";

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* Time window selector */}
      <div className="flex items-center gap-2 justify-end">
        {[7, 30, 90, 365].map(d => (
          <button key={d} onClick={() => setDays(d)}
            className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all"
            style={{
              background: days === d ? "rgba(59,130,246,0.2)" : "var(--muted)",
              color: days === d ? "#3b82f6" : "var(--muted-foreground)",
              border: days === d ? "1px solid rgba(59,130,246,0.4)" : "1px solid var(--border)",
            }}>
            {d === 365 ? "1Y" : `${d}D`}
          </button>
        ))}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Fee Revenue", value: `$${totalFee.toFixed(2)}`, sub: `${days} days`, icon: DollarSign, color: "#10b981" },
          { label: "P2P Revenue (0.15%)", value: `$${p2pFee.toFixed(2)}`, sub: `${p2pSwps} swaps`, icon: Zap, color: "#14F195" },
          { label: "DEX Revenue (0.20%)", value: `$${dexFee.toFixed(2)}`, sub: `${dexSwps} swaps`, icon: Activity, color: "#9945FF" },
          { label: "Avg Fee / Swap", value: `$${avgFee.toFixed(4)}`, sub: `${totalSwps} total swaps`, icon: TrendingUp, color: "#60a5fa" },
        ].map(kpi => (
          <div key={kpi.label} className="rounded-2xl p-4"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between mb-2">
              <kpi.icon className="w-4 h-4" style={{ color: kpi.color }} />
              {isLoading && <RefreshCw className="w-3 h-3 text-muted-foreground animate-spin" />}
            </div>
            <p className="text-lg font-bold text-foreground font-mono">{kpi.value}</p>
            <p className="text-[10px] text-muted-foreground">{kpi.label}</p>
            <p className="text-[9px] text-muted-foreground mt-0.5">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* P2P vs DEX split bar */}
      <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <p className="text-xs font-semibold text-foreground mb-3">Route Split</p>
        <div className="flex items-center gap-3 mb-2">
          <div className="flex-1">
            <div className="h-3 rounded-full overflow-hidden flex" style={{ background: "var(--muted)" }}>
              <div className="h-full transition-all" style={{ width: `${p2pPct}%`, background: "#14F195" }} />
              <div className="h-full transition-all" style={{ width: `${100 - parseFloat(p2pPct)}%`, background: "#9945FF" }} />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span style={{ color: "#14F195" }}>P2P: {p2pPct}% ({p2pSwps} swaps) — 0.15% fee</span>
          <span style={{ color: "#9945FF" }}>DEX: {(100 - parseFloat(p2pPct)).toFixed(1)}% ({dexSwps} swaps) — 0.20% fee</span>
        </div>
      </div>

      {/* Volume by chain */}
      {volumeData && (
        <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <p className="text-xs font-semibold text-foreground mb-3">Volume by Chain ({days}D)</p>
          <div className="space-y-3">
            {volumeData.byChain.map(c => {
              const maxUsd = Math.max(...volumeData.byChain.map(x => x.totalUsd), 1);
              const pct = (c.totalUsd / maxUsd) * 100;
              const chainLabel = c.chain === "bitcoin" ? "BTC" : c.chain === "ethereum" ? "ETH" : "SOL";
              const chainColor = c.chain === "bitcoin" ? "#F7931A" : c.chain === "ethereum" ? "#627EEA" : "#9945FF";
              return (
                <div key={c.chain}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-semibold" style={{ color: chainColor }}>{chainLabel}</p>
                    <div className="flex items-center gap-3">
                      <p className="text-[10px] text-muted-foreground">Vol: ${c.totalUsd.toFixed(2)}</p>
                      <p className="text-[10px] font-semibold text-emerald-400">{c.swapCount} swaps</p>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background: "var(--muted)" }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: chainColor, opacity: 0.6 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent fee events */}
      {feeData?.recentFees && feeData.recentFees.length > 0 && (
        <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <p className="text-xs font-semibold text-foreground mb-3">Recent Fee Events</p>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {feeData.recentFees.map(fee => (
              <div key={fee.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg text-[10px]"
                style={{ background: "var(--muted)" }}>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-foreground">{fee.fromToken} → {fee.toToken}</span>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold"
                    style={{
                      background: fee.feeBps === 15 ? "rgba(20,241,149,0.15)" : "rgba(153,69,255,0.15)",
                      color: fee.feeBps === 15 ? "#14F195" : "#9945FF",
                    }}>
                    {fee.feeBps === 15 ? "P2P" : "DEX"} {((fee.feeBps ?? 0) / 100).toFixed(2)}%
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">{fee.feeAmountOut ? `${parseFloat(fee.feeAmountOut).toFixed(6)} ${fee.toToken}` : "—"}</span>
                  <span className="font-mono text-emerald-400">{fee.platformFeeUsd ? `$${parseFloat(fee.platformFeeUsd).toFixed(4)}` : "—"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && totalSwps === 0 && (
        <div className="rounded-2xl p-8 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <DollarSign className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-semibold text-foreground">No fee revenue yet</p>
          <p className="text-xs text-muted-foreground mt-1">Revenue will appear here after the first completed swap.</p>
          <p className="text-[10px] text-muted-foreground mt-2">P2P swaps: 0.15% output-side fee · DEX swaps: 0.20% via referral</p>
        </div>
      )}
    </div>
  );
}

// ─── Fee Config Tab (DB-backed) ───────────────────────────────────────────────
function FeeConfigTab() {
  const { data: cfg, isLoading } = trpc.adminConfig.get.useQuery(undefined, { staleTime: 30_000 });
  const saveFeeConfig = trpc.adminConfig.saveFeeConfig.useMutation({
    onSuccess: () => { toast.success("Fee configuration saved"); setSaved(true); setTimeout(() => setSaved(false), 2000); },
    onError: () => toast.error("Failed to save fee configuration"),
  });

  const [local, setLocal] = useState({
    feeEnabled: true,
    swapFeeBps: 20,
    expressFeeBps: 5,
    botFeeCents: 10,
    minTradeUsdCents: 1000,
    maxTradeUsdCents: 100000,
  });
  const [saved, setSaved] = useState(false);

  // Sync from DB when loaded
  useEffect(() => {
    if (!cfg) return;
    setLocal({
      feeEnabled: cfg.feeEnabled,
      swapFeeBps: cfg.swapFeeBps,
      expressFeeBps: cfg.expressFeeBps,
      botFeeCents: cfg.botFeeCents,
      minTradeUsdCents: cfg.minTradeUsdCents,
      maxTradeUsdCents: cfg.maxTradeUsdCents,
    });
  }, [cfg]);

  const handleSave = () => {
    saveFeeConfig.mutate({
      feeEnabled: local.feeEnabled,
      swapFeeBps: local.swapFeeBps,
      expressFeeBps: local.expressFeeBps,
      botFeeCents: local.botFeeCents,
      minTradeUsdCents: local.minTradeUsdCents,
      maxTradeUsdCents: local.maxTradeUsdCents,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="w-5 h-5 text-muted-foreground animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <div className="rounded-2xl p-5 space-y-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-foreground">Fee Configuration</p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Swaps</span>
            <button
              onClick={() => setLocal(prev => ({ ...prev, feeEnabled: !prev.feeEnabled }))}
              className="relative w-10 h-5 rounded-full transition-all"
              style={{ background: local.feeEnabled ? "rgba(16,185,129,0.4)" : "var(--muted)" }}>
              <div className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
                style={{
                  background: local.feeEnabled ? "#10b981" : "var(--muted-foreground)",
                  left: local.feeEnabled ? "calc(100% - 18px)" : "2px",
                }} />
            </button>
            <span className="text-[10px]" style={{ color: local.feeEnabled ? "#10b981" : "var(--muted-foreground)" }}>
              {local.feeEnabled ? "Active" : "Paused"}
            </span>
          </div>
        </div>

        {/* Swap Fee bps */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div>
              <p className="text-xs font-semibold text-foreground">Swap Fee</p>
              <p className="text-[10px] text-muted-foreground">Base fee on every swap (20 bps = 0.20%)</p>
            </div>
            <div className="flex items-center gap-1.5">
              <input type="number" value={local.swapFeeBps}
                onChange={e => setLocal(prev => ({ ...prev, swapFeeBps: parseInt(e.target.value) || 0 }))}
                className="w-20 px-2 py-1.5 rounded-lg text-xs font-mono text-foreground text-right outline-none"
                style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                step={1} min={0} max={200} />
              <span className="text-[10px] text-muted-foreground w-8">bps</span>
            </div>
          </div>
          <p className="text-[10px] text-emerald-400 font-semibold">= {(local.swapFeeBps / 100).toFixed(2)}% per swap</p>
        </div>

        {/* Express Fee bps */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div>
              <p className="text-xs font-semibold text-foreground">Express Fee</p>
              <p className="text-[10px] text-muted-foreground">Additional fee for priority routing</p>
            </div>
            <div className="flex items-center gap-1.5">
              <input type="number" value={local.expressFeeBps}
                onChange={e => setLocal(prev => ({ ...prev, expressFeeBps: parseInt(e.target.value) || 0 }))}
                className="w-20 px-2 py-1.5 rounded-lg text-xs font-mono text-foreground text-right outline-none"
                style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                step={1} min={0} max={100} />
              <span className="text-[10px] text-muted-foreground w-8">bps</span>
            </div>
          </div>
        </div>

        {/* Bot Fee cents */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div>
              <p className="text-xs font-semibold text-foreground">Bot/Autopost Fee</p>
              <p className="text-[10px] text-muted-foreground">Flat fee per automated task (in USD cents)</p>
            </div>
            <div className="flex items-center gap-1.5">
              <input type="number" value={local.botFeeCents}
                onChange={e => setLocal(prev => ({ ...prev, botFeeCents: parseInt(e.target.value) || 0 }))}
                className="w-20 px-2 py-1.5 rounded-lg text-xs font-mono text-foreground text-right outline-none"
                style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                step={1} min={0} max={10000} />
              <span className="text-[10px] text-muted-foreground w-8">¢</span>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground font-mono">= ${(local.botFeeCents / 100).toFixed(2)} per task</p>
        </div>

        {/* Min trade */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div>
              <p className="text-xs font-semibold text-foreground">Min Trade Size</p>
              <p className="text-[10px] text-muted-foreground">Minimum swap value accepted (in USD cents)</p>
            </div>
            <div className="flex items-center gap-1.5">
              <input type="number" value={local.minTradeUsdCents}
                onChange={e => setLocal(prev => ({ ...prev, minTradeUsdCents: parseInt(e.target.value) || 10 }))}
                className="w-24 px-2 py-1.5 rounded-lg text-xs font-mono text-foreground text-right outline-none"
                style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                step={100} min={10} />
              <span className="text-[10px] text-muted-foreground w-8">¢</span>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground font-mono">= ${(local.minTradeUsdCents / 100).toFixed(2)} minimum</p>
        </div>

        {/* Max trade */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div>
              <p className="text-xs font-semibold text-foreground">Max Trade Size</p>
              <p className="text-[10px] text-muted-foreground">Maximum swap value per transaction (in USD cents)</p>
            </div>
            <div className="flex items-center gap-1.5">
              <input type="number" value={local.maxTradeUsdCents}
                onChange={e => setLocal(prev => ({ ...prev, maxTradeUsdCents: parseInt(e.target.value) || 100 }))}
                className="w-24 px-2 py-1.5 rounded-lg text-xs font-mono text-foreground text-right outline-none"
                style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                step={10000} min={100} />
              <span className="text-[10px] text-muted-foreground w-8">¢</span>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground font-mono">= ${(local.maxTradeUsdCents / 100).toFixed(2)} maximum</p>
        </div>

        <button onClick={handleSave} disabled={saveFeeConfig.isPending}
          className="w-full py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          style={{
            background: saved ? "rgba(16,185,129,0.15)" : "rgba(59,130,246,0.15)",
            border: `1px solid ${saved ? "rgba(16,185,129,0.3)" : "rgba(59,130,246,0.3)"}`,
            color: saved ? "#10b981" : "#60a5fa",
          }}>
          {saveFeeConfig.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : saved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
          {saveFeeConfig.isPending ? "Saving…" : saved ? "Saved!" : "Save Fee Configuration"}
        </button>
      </div>

      {/* Kill switch */}
      <div className="rounded-2xl p-4"
        style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)" }}>
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          <p className="text-xs font-bold text-red-400">Emergency Kill Switch</p>
        </div>
        <p className="text-[10px] text-muted-foreground mb-3">
          Immediately pause all swaps across the platform. Use only in emergencies.
        </p>
        <button
          onClick={() => {
            setLocal(prev => ({ ...prev, feeEnabled: false }));
            saveFeeConfig.mutate({ feeEnabled: false });
            toast.error("All swaps paused — kill switch activated");
          }}
          disabled={saveFeeConfig.isPending}
          className="w-full py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
          style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}>
          Pause All Swaps
        </button>
      </div>
    </div>
  );
}

// ─── Treasury Tab (DB-backed) ─────────────────────────────────────────────────
function TreasuryTab() {
  const { data: cfg, isLoading } = trpc.adminConfig.get.useQuery(undefined, { staleTime: 30_000 });
  const saveTreasury = trpc.adminConfig.saveTreasury.useMutation({
    onSuccess: () => toast.success("Treasury configuration saved"),
    onError: () => toast.error("Failed to save treasury configuration"),
  });

  const [wallets, setWallets] = useState<TreasuryWallet[]>([]);
  const [newWallet, setNewWallet] = useState({ label: "", chain: "solana" as TreasuryWallet["chain"], address: "", splitPercent: 0 });
  const [showAddWallet, setShowAddWallet] = useState(false);

  // Sync from DB when loaded
  useEffect(() => {
    if (!cfg) return;
    setWallets(cfg.treasuryWallets as TreasuryWallet[]);
  }, [cfg]);

  const totalSplit = wallets.reduce((s, w) => s + w.splitPercent, 0);

  const addWallet = () => {
    if (!newWallet.label || !newWallet.address) return;
    setWallets(prev => [...prev, { ...newWallet, id: `tw_${Date.now()}` }]);
    setNewWallet({ label: "", chain: "solana", address: "", splitPercent: 0 });
    setShowAddWallet(false);
  };

  const removeWallet = (id: string) => {
    setWallets(prev => prev.filter(w => w.id !== id));
  };

  const handleSave = () => {
    saveTreasury.mutate({ wallets });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="w-5 h-5 text-muted-foreground animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      {/* Split warning */}
      {wallets.length > 0 && totalSplit !== 100 && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl"
          style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" }}>
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <p className="text-xs text-amber-400">
            Split totals {totalSplit}% — must equal 100% for correct fee distribution
          </p>
        </div>
      )}

      {/* Wallet list */}
      <div className="space-y-3">
        {wallets.length === 0 && (
          <div className="rounded-2xl p-8 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <Wallet className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-sm font-semibold text-foreground">No treasury wallets configured</p>
            <p className="text-xs text-muted-foreground mt-1">Add wallets below to configure fee distribution.</p>
          </div>
        )}
        {wallets.map(wallet => (
          <div key={wallet.id} className="rounded-2xl p-4"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xs font-bold text-foreground">{wallet.label}</p>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase"
                    style={{
                      background: wallet.chain === "solana" ? "rgba(153,69,255,0.15)" : wallet.chain === "ethereum" ? "rgba(98,126,234,0.15)" : "rgba(247,147,26,0.15)",
                      color: wallet.chain === "solana" ? "#9945FF" : wallet.chain === "ethereum" ? "#627EEA" : "#F7931A",
                    }}>
                    {wallet.chain}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <p className="text-[10px] font-mono text-muted-foreground truncate">{wallet.address}</p>
                  <button onClick={() => { navigator.clipboard.writeText(wallet.address); toast.success("Copied"); }}>
                    <Copy className="w-3 h-3 text-muted-foreground hover:text-foreground shrink-0" />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="text-right">
                  <input
                    type="number"
                    value={wallet.splitPercent}
                    onChange={e => setWallets(prev => prev.map(w =>
                      w.id === wallet.id ? { ...w, splitPercent: parseInt(e.target.value) || 0 } : w
                    ))}
                    className="w-14 px-2 py-1 rounded-lg text-xs font-mono text-foreground text-right outline-none"
                    style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                    min={0} max={100}
                  />
                  <p className="text-[9px] text-muted-foreground mt-0.5 text-right">% split</p>
                </div>
                <button onClick={() => removeWallet(wallet.id)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-red-400 transition-colors hover:bg-red-400/10">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add wallet form */}
      <AnimatePresence>
        {showAddWallet && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-2xl p-4 space-y-3"
            style={{ background: "var(--card)", border: "1px solid rgba(59,130,246,0.25)" }}>
            <p className="text-xs font-bold text-foreground">Add Treasury Wallet</p>
            {[
              { key: "label", placeholder: "Label (e.g. Operations Treasury)", type: "text" },
              { key: "address", placeholder: "Wallet address", type: "text" },
              { key: "splitPercent", placeholder: "Split %", type: "number" },
            ].map(field => (
              <input key={field.key}
                type={field.type}
                placeholder={field.placeholder}
                value={(newWallet as Record<string, string | number>)[field.key] as string}
                onChange={e => setNewWallet(prev => ({ ...prev, [field.key]: field.type === "number" ? parseInt(e.target.value) || 0 : e.target.value }))}
                className="w-full px-3 py-2 rounded-xl text-xs font-mono text-foreground outline-none"
                style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
              />
            ))}
            <select value={newWallet.chain}
              onChange={e => setNewWallet(prev => ({ ...prev, chain: e.target.value as TreasuryWallet["chain"] }))}
              className="w-full px-3 py-2 rounded-xl text-xs font-mono text-foreground outline-none"
              style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
              <option value="solana">Solana</option>
              <option value="ethereum">Ethereum</option>
              <option value="bitcoin">Bitcoin</option>
            </select>
            <div className="flex gap-2">
              <button onClick={addWallet}
                className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
                style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)", color: "#10b981" }}>
                Add Wallet
              </button>
              <button onClick={() => setShowAddWallet(false)}
                className="flex-1 py-2 rounded-xl text-xs font-bold text-muted-foreground transition-all"
                style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!showAddWallet && (
        <button onClick={() => setShowAddWallet(true)}
          className="w-full py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all"
          style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.25)", color: "#60a5fa" }}>
          <Plus className="w-3.5 h-3.5" />
          Add Treasury Wallet
        </button>
      )}

      {/* Save splits */}
      <button
        onClick={handleSave}
        disabled={saveTreasury.isPending}
        className="w-full py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
        style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)", color: "#10b981" }}>
        {saveTreasury.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        {saveTreasury.isPending ? "Saving…" : "Save Treasury Configuration"}
      </button>
    </div>
  );
}

// ─── Node Health Tab (live health checks) ─────────────────────────────────────
interface NodeStatus {
  name: string;
  status: "live" | "degraded" | "offline";
  detail: string;
  latency?: string;
  error?: string;
}

function NodeHealthTab() {
  const [nodes, setNodes] = useState<NodeStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const checkHealth = useCallback(async () => {
    setLoading(true);
    const results: NodeStatus[] = [];

    // 1. Oracle VM health endpoint
    try {
      const t0 = Date.now();
      const resp = await fetch("http://141.253.123.101:4000/health", { signal: AbortSignal.timeout(5000) });
      const latency = `${Date.now() - t0}ms`;
      if (resp.ok) {
        const data = await resp.json() as {
          status?: string;
          rpc?: { eth?: { ok: boolean }; sol?: { ok: boolean }; btc?: { ok: boolean } };
        };
        results.push({
          name: "Oracle VM",
          status: "live",
          detail: `HTTP 200 · ${data.status ?? "ok"}`,
          latency,
        });
        // Derive RPC statuses from Oracle VM health
        if (data.rpc) {
          results.push({
            name: "Ethereum RPC",
            status: data.rpc.eth?.ok ? "live" : "degraded",
            detail: data.rpc.eth?.ok ? "Connected via Oracle VM" : "RPC unreachable",
            latency: data.rpc.eth?.ok ? latency : undefined,
          });
          results.push({
            name: "Solana RPC",
            status: data.rpc.sol?.ok ? "live" : "degraded",
            detail: data.rpc.sol?.ok ? "Connected via Oracle VM" : "RPC unreachable",
            latency: data.rpc.sol?.ok ? latency : undefined,
          });
          results.push({
            name: "Bitcoin RPC",
            status: data.rpc.btc?.ok ? "live" : "degraded",
            detail: data.rpc.btc?.ok ? "Connected via Oracle VM" : "RPC unreachable",
            latency: data.rpc.btc?.ok ? latency : undefined,
          });
        }
      } else {
        results.push({ name: "Oracle VM", status: "degraded", detail: `HTTP ${resp.status}`, latency });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Timeout";
      results.push({ name: "Oracle VM", status: "offline", detail: "Unreachable", error: msg });
      results.push({ name: "Ethereum RPC", status: "offline", detail: "Oracle VM offline" });
      results.push({ name: "Solana RPC", status: "offline", detail: "Oracle VM offline" });
      results.push({ name: "Bitcoin RPC", status: "offline", detail: "Oracle VM offline" });
    }

    // 2. IntercomSwap signaling server (HTTPS ping)
    try {
      const t0 = Date.now();
      const resp = await fetch("https://intercomswap.io", { method: "HEAD", signal: AbortSignal.timeout(5000) });
      results.push({
        name: "IntercomSwap Signaling",
        status: resp.ok || resp.status < 500 ? "live" : "degraded",
        detail: `HTTP ${resp.status}`,
        latency: `${Date.now() - t0}ms`,
      });
    } catch {
      results.push({ name: "IntercomSwap Signaling", status: "offline", detail: "Unreachable" });
    }

    setNodes(results);
    setLastChecked(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    checkHealth();
    const t = setInterval(checkHealth, 60_000);
    return () => clearInterval(t);
  }, [checkHealth]);

  const statusColor = (s: NodeStatus["status"]) =>
    s === "live" ? "#10b981" : s === "degraded" ? "#f59e0b" : "#ef4444";
  const statusBg = (s: NodeStatus["status"]) =>
    s === "live" ? "rgba(16,185,129,0.12)" : s === "degraded" ? "rgba(245,158,11,0.12)" : "rgba(239,68,68,0.12)";

  return (
    <div className="space-y-3 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-muted-foreground">
          {lastChecked ? `Last checked: ${lastChecked.toLocaleTimeString()}` : "Checking…"}
        </p>
        <button onClick={checkHealth} disabled={loading}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all disabled:opacity-50"
          style={{ background: "var(--muted)", border: "1px solid var(--border)", color: "var(--muted-foreground)" }}>
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {loading && nodes.length === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background: "var(--card)" }} />
          ))}
        </div>
      ) : (
        nodes.map(node => (
          <div key={node.name} className="rounded-2xl p-4"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full"
                  style={{ background: statusColor(node.status), boxShadow: node.status === "live" ? `0 0 6px ${statusColor(node.status)}` : "none" }} />
                <div>
                  <p className="text-xs font-semibold text-foreground">{node.name}</p>
                  <p className="text-[10px] text-muted-foreground">{node.detail}</p>
                  {node.error && <p className="text-[9px] text-red-400 font-mono mt-0.5">{node.error}</p>}
                </div>
              </div>
              <div className="text-right">
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: statusBg(node.status), color: statusColor(node.status) }}>
                  {node.status.toUpperCase()}
                </span>
                {node.latency && <p className="text-[10px] text-muted-foreground mt-0.5">{node.latency}</p>}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Users Tab (live analytics) ───────────────────────────────────────────────
function UsersTab() {
  const [days, setDays] = useState(30);
  const { data: summary, isLoading: sumLoading } = trpc.analytics.summary.useQuery({ days }, { staleTime: 30_000 });
  const { data: userStats, isLoading: usersLoading } = trpc.analytics.userStats.useQuery({ days }, { staleTime: 30_000 });
  const { data: topPairs, isLoading: pairsLoading } = trpc.analytics.topPairs.useQuery({ days, limit: 8 }, { staleTime: 30_000 });

  const isLoading = sumLoading || usersLoading || pairsLoading;

  const totalVolumeUsd = summary?.totalUsd ?? 0;
  const totalWallets = userStats?.totalWallets ?? 0;
  const activeWallets = userStats?.activeWallets ?? 0;
  const avgSwapUsd = userStats?.avgSwapUsd ?? 0;

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      {/* Time window selector */}
      <div className="flex items-center gap-2 justify-end">
        {[7, 30, 90, 365].map(d => (
          <button key={d} onClick={() => setDays(d)}
            className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all"
            style={{
              background: days === d ? "rgba(59,130,246,0.2)" : "var(--muted)",
              color: days === d ? "#3b82f6" : "var(--muted-foreground)",
              border: days === d ? "1px solid rgba(59,130,246,0.4)" : "1px solid var(--border)",
            }}>
            {d === 365 ? "1Y" : `${d}D`}
          </button>
        ))}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Total Wallets (ever)", value: isLoading ? "…" : totalWallets.toLocaleString(), icon: Wallet, color: "#60a5fa" },
          { label: `Active (${days}d)`, value: isLoading ? "…" : activeWallets.toLocaleString(), icon: Activity, color: "#10b981" },
          { label: "Avg Swap Size", value: isLoading ? "…" : `$${avgSwapUsd.toFixed(2)}`, icon: ArrowUpRight, color: "#a78bfa" },
          { label: `Volume (${days}d)`, value: isLoading ? "…" : `$${totalVolumeUsd >= 1000 ? (totalVolumeUsd / 1000).toFixed(1) + "K" : totalVolumeUsd.toFixed(2)}`, icon: Database, color: "#f59e0b" },
        ].map(stat => (
          <div key={stat.label} className="rounded-2xl p-4"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <stat.icon className="w-4 h-4 mb-2" style={{ color: stat.color }} />
            <p className="text-lg font-bold text-foreground font-mono">{stat.value}</p>
            <p className="text-[10px] text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Top pairs */}
      <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-foreground">Top Pairs by Volume</p>
          {isLoading && <RefreshCw className="w-3 h-3 text-muted-foreground animate-spin" />}
        </div>
        {!isLoading && (!topPairs || topPairs.length === 0) ? (
          <div className="py-6 text-center">
            <Database className="w-6 h-6 text-muted-foreground mx-auto mb-2 opacity-40" />
            <p className="text-xs text-muted-foreground">No swap data yet for this period.</p>
          </div>
        ) : (
          <div className="space-y-0">
            {(topPairs ?? []).map((row, i) => (
              <div key={row.pair} className="flex items-center gap-3 py-2"
                style={{ borderBottom: i < (topPairs?.length ?? 0) - 1 ? "1px solid var(--border)" : "none" }}>
                <div className="flex-1">
                  <p className="text-xs font-semibold text-foreground">{row.pair}</p>
                  <p className="text-[10px] text-muted-foreground">{row.swapCount} swaps</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold text-foreground">
                    ${row.totalUsd >= 1000 ? (row.totalUsd / 1000).toFixed(1) + "K" : row.totalUsd.toFixed(2)}
                  </p>
                  <p className="text-[10px] text-emerald-400">{row.pct}%</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Password Gate ────────────────────────────────────────────────────────────
function PasswordGate({ onAuth }: { onAuth: () => void }) {
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await new Promise(r => setTimeout(r, 600));
    if (password === ADMIN_PASSWORD) {
      sessionStorage.setItem(ADMIN_SESSION_KEY, "true");
      onAuth();
    } else {
      setError(true);
      setPassword("");
      toast.error("Invalid admin password");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "var(--background)" }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-sm">
        <div className="rounded-2xl overflow-hidden"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="px-6 py-5 text-center" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3"
              style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}>
              <Lock className="w-6 h-6 text-red-400" />
            </div>
            <p className="text-sm font-bold text-foreground">AFOS Admin Panel</p>
            <p className="text-[10px] text-muted-foreground mt-1">Operator access only · Not visible to users</p>
          </div>
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest block mb-1.5">
                Admin Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(false); }}
                  placeholder="Enter admin password"
                  className="w-full px-3 py-2.5 pr-10 rounded-xl text-sm font-mono text-foreground outline-none transition-all"
                  style={{
                    background: "var(--muted)",
                    border: `1px solid ${error ? "rgba(239,68,68,0.5)" : "var(--border)"}`,
                  }}
                  autoFocus
                />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {error && <p className="text-[10px] text-red-400 mt-1">Incorrect password</p>}
            </div>
            <button type="submit" disabled={!password || loading}
              className="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40"
              style={{ background: "rgba(59,130,246,0.2)", border: "1px solid rgba(59,130,246,0.4)", color: "#60a5fa" }}>
              {loading ? "Authenticating…" : "Enter Admin Panel"}
            </button>
          </form>
          <div className="px-5 pb-4 text-center">
            <p className="text-[9px] text-muted-foreground">
              Demo password: <span className="font-mono text-foreground/60">afos-admin-2024</span>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Operator Config Tab ────────────────────────────────────────────────────

function OperatorConfigField({
  label, value, onChange, type = "text", mono = false, placeholder = "", disabled = false, hint,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; mono?: boolean; placeholder?: string; disabled?: boolean; hint?: string;
}) {
  const [show, setShow] = useState(false);
  const isPassword = type === "password";
  return (
    <div>
      <label className="block text-[10px] text-muted-foreground mb-1">{label}</label>
      <div className="relative">
        <input
          type={isPassword && !show ? "password" : "text"}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={`w-full px-3 py-2 rounded-xl text-xs text-foreground outline-none transition-all disabled:opacity-40 disabled:cursor-not-allowed ${mono ? "font-mono" : ""}`}
          style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
        />
        {isPassword && (
          <button type="button" onClick={() => setShow(s => !s)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
            {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
      {hint && <p className="text-[9px] text-muted-foreground mt-0.5 font-mono">{hint}</p>}
    </div>
  );
}

function OperatorConfigToggle({ label, description, value, onChange }: {
  label: string; description?: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-xs font-medium text-foreground">{label}</p>
        {description && <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className="flex items-center gap-1 text-[10px] font-mono transition-colors shrink-0"
        style={{ color: value ? "#10b981" : "var(--muted-foreground)" }}
      >
        {value ? <ToggleRight className="w-5 h-5 text-emerald-400" /> : <ToggleLeft className="w-5 h-5" />}
        <span className="w-6 text-left">{value ? "ON" : "OFF"}</span>
      </button>
    </div>
  );
}

function OperatorConfigCard({
  icon: Icon, title, color, children,
}: {
  icon: React.ElementType; title: string; color: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${color}`} />
        <p className="text-xs font-bold text-foreground">{title}</p>
      </div>
      {children}
    </div>
  );
}

function OperatorConfigTab() {
  const [cfg, setCfg] = useState({
    llmModel: "kimi-k2-turbo",
    systemPrompt: "You are an autonomous financial agent. Execute swaps via IntercomSwap when instructed.",
    rendezvousChannel: "0000intercomswapbtcusdt",
    peerMode: "maker-taker" as "maker" | "taker" | "maker-taker",
    minSwapUsdt: "10",
    maxSwapUsdt: "1000",
    scBridgePort: "49222",
    btcHost: "localhost:8332",
    btcRpcPassword: "",
    btcTlsCert: "/root/.lnd/tls.cert",
    solanaRpc: "https://api.mainnet-beta.solana.com",
    solanaKeypairPath: "onchain/solana/keypair.json",
    escrowProgramId: "4RS6xpspM1V2K7FKSqeSH6VVaZbtzHzhJqacwrz8gJrF",
    tradeauto: false,
    maxTradeBtc: "0.01",
    feeBpsCap: "50",
    tickInterval: "3800",
    minRefundHours: "20",
    maxRefundHours: "40",
    moonpayApiKey: "",
    moonpayWallet: "",
  });

  const set = (key: string) => (v: string | boolean) =>
    setCfg(prev => ({ ...prev, [key]: v }));

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="rounded-2xl p-4" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-red-400">Operator-only configuration</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              These settings control the AFOS Oracle VM infrastructure. Changes affect all users. Do not expose to end users.
            </p>
          </div>
        </div>
      </div>

      <OperatorConfigCard icon={Bot} title="AFOS Agent" color="text-cyan-400">
        <OperatorConfigField label="LLM Model" value={cfg.llmModel} onChange={set("llmModel")} placeholder="kimi-k2-turbo" />
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">System Prompt</label>
          <textarea value={cfg.systemPrompt} onChange={e => set("systemPrompt")(e.target.value)} rows={3}
            className="w-full px-3 py-2 rounded-xl text-xs text-foreground outline-none resize-none"
            style={{ background: "var(--muted)", border: "1px solid var(--border)" }} />
        </div>
      </OperatorConfigCard>

      <OperatorConfigCard icon={Network} title="IntercomSwap Node" color="text-emerald-400">
        <OperatorConfigField label="Rendezvous Channel" value={cfg.rendezvousChannel} onChange={set("rendezvousChannel")} mono placeholder="0000intercomswapbtcusdt" />
        <div className="grid grid-cols-2 gap-2">
          <OperatorConfigField label="Min Swap (USDT)" value={cfg.minSwapUsdt} onChange={set("minSwapUsdt")} placeholder="10" />
          <OperatorConfigField label="Max Swap (USDT)" value={cfg.maxSwapUsdt} onChange={set("maxSwapUsdt")} placeholder="1000" />
        </div>
        <OperatorConfigField label="SC-Bridge Port" value={cfg.scBridgePort} onChange={set("scBridgePort")} mono placeholder="49222" />
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Peer Mode</label>
          <div className="flex gap-2">
            {(["maker", "taker", "maker-taker"] as const).map(mode => (
              <button key={mode} onClick={() => set("peerMode")(mode)}
                className="flex-1 py-1.5 rounded-xl text-[10px] font-mono border transition-all"
                style={{
                  background: cfg.peerMode === mode ? "rgba(16,185,129,0.12)" : "var(--muted)",
                  border: cfg.peerMode === mode ? "1px solid rgba(16,185,129,0.4)" : "1px solid var(--border)",
                  color: cfg.peerMode === mode ? "#34d399" : "var(--muted-foreground)",
                }}>{mode}</button>
            ))}
          </div>
        </div>
      </OperatorConfigCard>

      <OperatorConfigCard icon={Zap} title="Bitcoin Node (on-chain)" color="text-amber-400">
        <OperatorConfigField label="Node Host:Port" value={cfg.btcHost} onChange={set("btcHost")} mono placeholder="localhost:8332" />
        <OperatorConfigField label="RPC Password" value={cfg.btcRpcPassword} onChange={set("btcRpcPassword")} type="password" mono placeholder="rpcpassword" />
        <OperatorConfigField label="TLS Cert Path" value={cfg.btcTlsCert} onChange={set("btcTlsCert")} mono placeholder="/root/.lnd/tls.cert" />
      </OperatorConfigCard>

      <OperatorConfigCard icon={Wallet} title="Solana Wallet" color="text-purple-400">
        <OperatorConfigField label="RPC URL" value={cfg.solanaRpc} onChange={set("solanaRpc")} mono placeholder="https://api.mainnet-beta.solana.com" />
        <OperatorConfigField label="Keypair Path" value={cfg.solanaKeypairPath} onChange={set("solanaKeypairPath")} mono placeholder="onchain/solana/keypair.json" />
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Escrow Program ID</label>
          <div className="flex items-center gap-2 p-2 rounded-xl" style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-[10px] font-mono text-foreground/70 truncate">{cfg.escrowProgramId}</span>
          </div>
          <p className="text-[9px] text-muted-foreground mt-0.5 font-mono">Deployed on Solana mainnet — do not modify</p>
        </div>
      </OperatorConfigCard>

      <OperatorConfigCard icon={Repeat} title="Worker / Autopost" color="text-violet-400">
        <OperatorConfigToggle
          label="Autonomous Trading (tradeauto)"
          description="Worker auto-accepts matching quotes without manual approval"
          value={cfg.tradeauto}
          onChange={v => set("tradeauto")(v)}
        />
        <div className="grid grid-cols-2 gap-2">
          <OperatorConfigField label="Max trade amount (BTC)" value={cfg.maxTradeBtc} onChange={set("maxTradeBtc")} mono placeholder="0.01" />
          <OperatorConfigField label="Max fee cap (bps)" value={cfg.feeBpsCap} onChange={set("feeBpsCap")} mono placeholder="50" />
          <OperatorConfigField label="Tick interval (ms)" value={cfg.tickInterval} onChange={set("tickInterval")} mono placeholder="3800" />
          <OperatorConfigField label="Min HTLC refund (hours)" value={cfg.minRefundHours} onChange={set("minRefundHours")} mono placeholder="20" />
          <OperatorConfigField label="Max HTLC refund (hours)" value={cfg.maxRefundHours} onChange={set("maxRefundHours")} mono placeholder="40" />
        </div>
        <div className="p-2.5 rounded-xl" style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.2)" }}>
          <p className="text-[9px] font-mono text-violet-300/70">
            Worker polls IntercomSwap every {cfg.tickInterval}ms. When tradeauto is ON, auto-accepts quotes below {cfg.feeBpsCap} bps and under {cfg.maxTradeBtc} BTC. HTLC refund window: {cfg.minRefundHours}–{cfg.maxRefundHours}h.
          </p>
        </div>
      </OperatorConfigCard>

      <OperatorConfigCard icon={Moon} title="MoonPay Fiat On-ramp (Phase 2)" color="text-foreground/50">
        <div className="opacity-40 pointer-events-none space-y-3">
          <OperatorConfigField label="API Key" value={cfg.moonpayApiKey} onChange={set("moonpayApiKey")} type="password" placeholder="pk_live_…" disabled />
          <OperatorConfigField label="Destination Wallet Address" value={cfg.moonpayWallet} onChange={set("moonpayWallet")} mono placeholder="bc1q…" disabled />
          <p className="text-[10px] text-muted-foreground font-mono">MoonPay fiat on-ramp will be integrated in Phase 2 to auto-fund the agent wallet before executing swaps.</p>
        </div>
      </OperatorConfigCard>

      <button
        onClick={() => toast.success("Operator configuration saved")}
        className="w-full py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all"
        style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.3)", color: "#60a5fa" }}
      >
        <Save className="w-3.5 h-3.5" />
        Save Operator Config
      </button>
    </div>
  );
}

// ─── HTLC Wallet Section ─────────────────────────────────────────────────────

const CHAIN_COLORS: Record<string, string> = {
  bitcoin:  "#F7931A",
  ethereum: "#627EEA",
  solana:   "#9945FF",
};

function HtlcWalletSection({ onShowQr }: { onShowQr: (address: string, label: string, chainColor: string) => void }) {
  const { data, isLoading, refetch, isRefetching } = trpc.htlcWallet.getHtlcWallets.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const wallets = data?.assets ?? (data ? [data.btc, data.eth, data.sol] : []);
  const loading = isLoading;
  const refreshing = isRefetching;

  const totalUsd = wallets.reduce((sum, w) => {
    const usdNum = parseFloat((w.usd ?? "$0").replace(/[^\d.-]/g, "")) || 0;
    return sum + usdNum;
  }, 0);

  return (
    <>
      <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-400" />
            <p className="text-sm font-bold text-foreground">HTLC Escrow Wallet</p>
          </div>
          <button onClick={() => refetch()}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-all"
            style={{ background: "var(--muted)", border: "1px solid var(--border)", color: "var(--muted-foreground)" }}>
            <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mb-3">
          Dedicated HTLC escrow wallets (SOL_HTLC_KEY / ETH_HTLC_KEY / BTC_HTLC_WIF). Used exclusively to lock, claim, and refund atomic swaps. Separate from the fee collection wallets.
        </p>
        <div className="flex items-center gap-2 mb-3 p-2 rounded-lg" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
          <DollarSign className="w-3.5 h-3.5 text-amber-400" />
          {loading ? (
            <span className="text-xs font-mono text-muted-foreground">Loading...</span>
          ) : (
            <>
              <span className="text-xs font-mono font-bold text-foreground">${totalUsd.toFixed(2)}</span>
              <span className="text-[10px] text-muted-foreground">total across all 7 HTLC escrow assets</span>
            </>
          )}
        </div>
      </div>

      <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <p className="text-xs font-semibold text-foreground mb-3">HTLC Wallet Balances</p>
        {loading && wallets.length === 0 ? (
          <div className="space-y-2">
            {[1,2,3].map(i => (
              <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: "var(--muted)" }} />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {wallets.map((w) => {
              const chainColor = CHAIN_COLORS[w.chain] ?? "#888";
              const isStable = w.asset === "USDT" || w.asset === "USDC";
              const chainLabel = w.chain === "solana" ? "SOL" : w.chain === "ethereum" ? "ETH" : "BTC";
              return (
                <div key={`${w.chain}-${w.asset}`}
                  className="rounded-xl p-3"
                  style={{ background: `${chainColor}08`, border: `1px solid ${chainColor}25` }}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg flex flex-col items-center justify-center shrink-0"
                      style={{ background: `${chainColor}20`, border: `1px solid ${chainColor}40` }}>
                      <span className="text-[10px] font-bold font-mono leading-tight" style={{ color: chainColor }}>
                        {w.asset}
                      </span>
                      {isStable && (
                        <span className="text-[7px] font-mono leading-tight" style={{ color: chainColor, opacity: 0.7 }}>
                          {chainLabel}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-mono font-semibold text-foreground">{w.balance} {w.asset}</p>
                        <span className="text-[10px] font-mono text-muted-foreground">{w.usd}</span>
                        {isStable && (
                          <span className="text-[8px] px-1 py-0.5 rounded font-mono"
                            style={{ background: `${chainColor}12`, color: chainColor, border: `1px solid ${chainColor}25` }}>
                            {w.chain === "solana" ? "SPL" : "ERC-20"}
                          </span>
                        )}
                      </div>
                      {w.address ? (
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[9px] font-mono text-muted-foreground truncate max-w-[180px]">
                            {w.address}
                          </span>
                          <button onClick={() => { navigator.clipboard.writeText(w.address!); toast.success(`${w.asset}/${chainLabel} address copied`); }}
                            className="shrink-0 text-muted-foreground hover:text-foreground">
                            <Copy className="w-2.5 h-2.5" />
                          </button>
                          <button onClick={() => onShowQr(w.address!, `${w.asset} HTLC (${w.chain})`, chainColor)}
                            className="shrink-0 hover:opacity-80"
                            style={{ color: chainColor }}>
                            <QrCode className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ) : (
                        <p className="text-[9px] text-amber-400 mt-0.5">
                          {w.error ?? "Key not configured"}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                      <div className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: w.live ? "#10b981" : w.configured ? "#f59e0b" : "#6b7280" }} />
                        <span className="text-[9px] text-muted-foreground">
                          {w.live ? "live" : w.configured ? "pending" : "not set"}
                        </span>
                      </div>
                      {w.configured && (
                        <span className="text-[8px] px-1 py-0.5 rounded font-mono"
                          style={{ background: `${chainColor}15`, color: chainColor, border: `1px solid ${chainColor}30` }}>
                          {w.chain}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ─── HTLC Transaction History Section ───────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  pending:   { bg: "rgba(245,158,11,0.12)",  text: "#f59e0b",  label: "Pending" },
  completed: { bg: "rgba(16,185,129,0.12)",  text: "#10b981",  label: "Completed" },
  refunded:  { bg: "rgba(99,102,241,0.12)",  text: "#818cf8",  label: "Refunded" },
  expired:   { bg: "rgba(239,68,68,0.12)",   text: "#ef4444",  label: "Expired" },
};

function HtlcHistorySection() {
  const [chainFilter, setChainFilter] = useState<"all" | "bitcoin" | "ethereum" | "solana">("all");

  const { data, isLoading, refetch, isRefetching } = trpc.htlcWallet.getHtlcHistory.useQuery(
    { chain: chainFilter, limit: 20 },
    { refetchInterval: 30_000, staleTime: 15_000 }
  );

  const rows = data?.rows ?? [];

  const chainTabs: { key: "all" | "bitcoin" | "ethereum" | "solana"; label: string; color: string }[] = [
    { key: "all",      label: "All",      color: "#888" },
    { key: "bitcoin",  label: "BTC",      color: CHAIN_COLORS.bitcoin },
    { key: "ethereum", label: "ETH",      color: CHAIN_COLORS.ethereum },
    { key: "solana",   label: "SOL",      color: CHAIN_COLORS.solana },
  ];

  return (
    <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-indigo-400" />
          <p className="text-sm font-bold text-foreground">HTLC Transaction History</p>
        </div>
        <button onClick={() => refetch()}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-all"
          style={{ background: "var(--muted)", border: "1px solid var(--border)", color: "var(--muted-foreground)" }}>
          <RefreshCw className={`w-3 h-3 ${isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="flex gap-1 mb-3">
        {chainTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setChainFilter(tab.key)}
            className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all"
            style={{
              background: chainFilter === tab.key ? `${tab.color}20` : "var(--muted)",
              border: `1px solid ${chainFilter === tab.key ? tab.color + "50" : "var(--border)"}`,
              color: chainFilter === tab.key ? tab.color : "var(--muted-foreground)",
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => (
            <div key={i} className="h-12 rounded-xl animate-pulse" style={{ background: "var(--muted)" }} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center">
          <Database className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
          <p className="text-xs text-muted-foreground">No HTLC transactions recorded yet.</p>
          <p className="text-[10px] text-muted-foreground mt-1">Transactions will appear here once atomic swaps are executed.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(row => {
            const chainColor = CHAIN_COLORS[row.chain] ?? "#888";
            const statusStyle = STATUS_COLORS[row.status] ?? STATUS_COLORS.pending;
            const shortHash = (s: string | null | undefined) =>
              s ? `${s.slice(0, 6)}…${s.slice(-4)}` : "—";
            const timeAgo = (d: Date | null | undefined) => {
              if (!d) return "—";
              const diff = Date.now() - new Date(d).getTime();
              const mins = Math.floor(diff / 60_000);
              if (mins < 60) return `${mins}m ago`;
              const hrs = Math.floor(mins / 60);
              if (hrs < 24) return `${hrs}h ago`;
              return `${Math.floor(hrs / 24)}d ago`;
            };

            return (
              <div key={row.id}
                className="rounded-xl p-3"
                style={{ background: `${chainColor}06`, border: `1px solid ${chainColor}20` }}>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[9px] font-bold font-mono shrink-0"
                    style={{ background: `${chainColor}20`, color: chainColor, border: `1px solid ${chainColor}40` }}>
                    {row.chain === "bitcoin" ? "BTC" : row.chain === "ethereum" ? "ETH" : "SOL"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono font-semibold text-foreground">
                        {row.amountHuman} {row.chain === "bitcoin" ? "BTC" : row.chain === "ethereum" ? "ETH" : "SOL"}
                      </span>
                      {row.toToken && (
                        <span className="text-[9px] text-muted-foreground">
                          → {row.toToken} ({row.toChain ?? "?"})
                        </span>
                      )}
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold"
                        style={{ background: statusStyle.bg, color: statusStyle.text }}>
                        {statusStyle.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-[9px] font-mono text-muted-foreground">
                        Lock: {shortHash(row.lockTxId)}
                      </span>
                      {row.refundTxId && (
                        <span className="text-[9px] font-mono text-indigo-400">
                          Refund: {shortHash(row.refundTxId)}
                        </span>
                      )}
                      {row.peerId && (
                        <span className="text-[9px] text-muted-foreground">
                          Peer: {shortHash(row.peerId)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[9px] text-muted-foreground">{timeAgo(row.createdAt)}</p>
                    <p className="text-[8px] font-mono text-muted-foreground mt-0.5">#{row.id}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Peer Reports Tab ────────────────────────────────────────────

const REPORT_REASON_LABELS: Record<string, string> = {
  spam: 'Spam',
  suspicious_activity: 'Suspicious activity',
  fake_quotes: 'Fake quotes / price manipulation',
  harassment: 'Harassment',
  other: 'Other',
};

const REPORT_STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  reviewed: '#06b6d4',
  dismissed: '#64748b',
  actioned: '#10b981',
};

function PeerReportsTab() {
  const { data: reports = [], isLoading, refetch } = trpc.peerReports.listAll.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const updateStatus = trpc.peerReports.updateStatus.useMutation({
    onSuccess: () => refetch(),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="rounded-2xl p-8 text-center max-w-lg mx-auto" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <AlertTriangle className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm font-semibold text-foreground mb-1">No Peer Reports</p>
        <p className="text-xs text-muted-foreground">When users flag peers, reports will appear here for moderation.</p>
      </div>
    );
  }

  const pending = reports.filter(r => r.status === 'pending');
  const reviewed = reports.filter(r => r.status !== 'pending');

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-4 h-4 text-amber-400" />
        <h2 className="text-sm font-bold text-foreground">Peer Moderation Reports</h2>
        <span className="text-[10px] font-mono text-muted-foreground ml-auto">{reports.length} total · {pending.length} pending</span>
      </div>

      {pending.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] text-amber-400 font-semibold uppercase tracking-widest">Pending Review</p>
          {pending.map(report => (
            <div key={report.id} className="rounded-2xl p-4" style={{ background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-mono text-foreground">
                      Reporter: <span className="text-amber-400">{report.reporterPeerId.slice(0, 16)}…</span>
                    </span>
                    <span className="text-[9px] text-muted-foreground">→</span>
                    <span className="text-[10px] font-mono text-foreground">
                      Reported: <span className="text-red-400">{report.reportedPeerId.slice(0, 16)}…</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}>
                      {REPORT_REASON_LABELS[report.reason] ?? report.reason}
                    </span>
                    <span className="text-[9px] text-muted-foreground">{new Date(report.createdAt).toLocaleString()}</span>
                  </div>
                  {report.details && (
                    <p className="text-[9px] text-muted-foreground mt-1.5 italic">"{report.details}"</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => updateStatus.mutate({ id: report.id, status: 'actioned' })}
                  disabled={updateStatus.isPending}
                  className="flex-1 py-1.5 rounded-lg text-[9px] font-bold transition-all"
                  style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981' }}
                >
                  Take Action
                </button>
                <button
                  onClick={() => updateStatus.mutate({ id: report.id, status: 'reviewed' })}
                  disabled={updateStatus.isPending}
                  className="flex-1 py-1.5 rounded-lg text-[9px] font-bold transition-all"
                  style={{ background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.25)', color: '#06b6d4' }}
                >
                  Mark Reviewed
                </button>
                <button
                  onClick={() => updateStatus.mutate({ id: report.id, status: 'dismissed' })}
                  disabled={updateStatus.isPending}
                  className="flex-1 py-1.5 rounded-lg text-[9px] font-bold transition-all"
                  style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--muted-foreground)' }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {reviewed.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest">Reviewed</p>
          {reviewed.map(report => (
            <div key={report.id} className="rounded-2xl p-3 flex items-center justify-between gap-3" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[9px] font-mono text-muted-foreground">
                    {report.reporterPeerId.slice(0, 12)}… → {report.reportedPeerId.slice(0, 12)}…
                  </span>
                  <span className="text-[8px] px-1 py-0.5 rounded font-bold" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>
                    {REPORT_REASON_LABELS[report.reason] ?? report.reason}
                  </span>
                </div>
                {report.details && <p className="text-[8px] text-muted-foreground/60 mt-0.5 italic truncate">"{report.details}"</p>}
              </div>
              <span
                className="shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded"
                style={{
                  background: `${REPORT_STATUS_COLORS[report.status] ?? '#64748b'}18`,
                  color: REPORT_STATUS_COLORS[report.status] ?? '#64748b',
                  border: `1px solid ${REPORT_STATUS_COLORS[report.status] ?? '#64748b'}40`,
                }}
              >
                {report.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Admin Dashboard ──────────────────────────────────────────────────────────
// LP Node and Routing tabs removed — no backing system yet
type AdminTab = "revenue" | "fees" | "treasury" | "nodes" | "users" | "agent_wallet" | "operator_config" | "reports";

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<AdminTab>("revenue");

  // Agent wallet state (fetched from Oracle VM)
  const [nodeWalletData, setNodeWalletData] = useState<WalletAsset[]>([]);
  const [nodeKey, setNodeKey] = useState<string | null>(null);
  const [nodeWalletLoading, setNodeWalletLoading] = useState(false);
  const [oracleVmHealth, setOracleVmHealth] = useState<{
    rpc: { eth: { url: string; ok: boolean }; sol: { url: string; ok: boolean }; btc: { url: string; ok: boolean } };
  } | null>(null);

  const { data: oracleVmAddresses } = trpc.htlcWallet.getOracleVmAddresses.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });

  const [qrModal, setQrModal] = useState<{ address: string; label: string; chainColor: string } | null>(null);

  const fetchNodeWallet = async () => {
    setNodeWalletLoading(true);
    try {
      const data = await getWallet();
      setNodeWalletData(mergeWithAllAssets(data.wallets));
      setNodeKey(data.nodeKey);
    } catch { /* keep empty */ }
    try {
      const healthResp = await fetch("http://141.253.123.101:4000/health");
      if (healthResp.ok) {
        const healthData = await healthResp.json() as { rpc: { eth: { url: string; ok: boolean }; sol: { url: string; ok: boolean }; btc: { url: string; ok: boolean } } };
        setOracleVmHealth(healthData);
      }
    } catch { /* health optional */ }
    setNodeWalletLoading(false);
  };

  useEffect(() => {
    fetchNodeWallet();
    const t = setInterval(fetchNodeWallet, 30_000);
    return () => clearInterval(t);
  }, []);

  const TABS: { id: AdminTab; label: string; icon: React.ElementType }[] = [
    { id: "revenue", label: "Revenue", icon: BarChart3 },
    { id: "fees", label: "Fee Config", icon: Settings },
    { id: "treasury", label: "Treasury", icon: Wallet },
    { id: "nodes", label: "Node Health", icon: Server },
    { id: "users", label: "Users", icon: Users },
    { id: "agent_wallet", label: "Agent Wallet", icon: Cpu },
    { id: "operator_config", label: "Operator Config", icon: Settings },
    { id: "reports", label: "Peer Reports", icon: AlertTriangle },
  ];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--background)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4"
        style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}>
            <Shield className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">AFOS Admin</p>
            <p className="text-[10px] text-muted-foreground">Operator panel · Not visible to users</p>
          </div>
        </div>
        <button onClick={onLogout}
          className="text-[10px] font-semibold px-3 py-1.5 rounded-lg text-red-400 transition-colors"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
          Sign Out
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 px-4 py-3 overflow-x-auto" style={{ borderBottom: "1px solid var(--border)" }}>
        {TABS.map(tab => (
          <button key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all shrink-0"
            style={{
              background: activeTab === tab.id ? "rgba(59,130,246,0.15)" : "transparent",
              border: `1px solid ${activeTab === tab.id ? "rgba(59,130,246,0.3)" : "transparent"}`,
              color: activeTab === tab.id ? "#60a5fa" : "var(--muted-foreground)",
            }}>
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">

        {/* ── Revenue Tab ── */}
        {activeTab === "revenue" && <RevenueTab />}

        {/* ── Fee Config Tab ── */}
        {activeTab === "fees" && <FeeConfigTab />}

        {/* ── Treasury Tab ── */}
        {activeTab === "treasury" && <TreasuryTab />}

        {/* ── Node Health Tab ── */}
        {activeTab === "nodes" && <NodeHealthTab />}

        {/* ── Users Tab ── */}
        {activeTab === "users" && <UsersTab />}

        {/* ── Operator Config Tab ── */}
        {activeTab === "operator_config" && <OperatorConfigTab />}

        {/* ── Agent Wallet Tab ── */}
        {activeTab === "agent_wallet" && (
          <div className="space-y-4 max-w-lg mx-auto">
            {/* Node Key Header */}
            <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-cyan-400" />
                  <p className="text-sm font-bold text-foreground">AFOS Oracle VM Node Hot Wallet</p>
                </div>
                <button onClick={fetchNodeWallet}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-all"
                  style={{ background: "var(--muted)", border: "1px solid var(--border)", color: "var(--muted-foreground)" }}>
                  <RefreshCw className={`w-3 h-3 ${nodeWalletLoading ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mb-2">Fee collection wallets (SOL_AGENT_KEY / ETH_AGENT_KEY / BTC_AGENT_WIF). Receives 0.15% P2P and 0.20% DEX platform fees. Separate from HTLC escrow wallets.</p>
              {nodeKey ? (
                <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                  <span className="text-[10px] font-mono text-foreground truncate">{nodeKey}</span>
                  <button onClick={() => { navigator.clipboard.writeText(nodeKey); toast.success("Node key copied"); }}
                    className="shrink-0 text-muted-foreground hover:text-foreground">
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <p className="text-[10px] text-amber-400">No node key configured. Set AGENT_WALLET_ADDRESS in environment.</p>
              )}

              <div className="flex items-center gap-2 mt-3 p-2 rounded-lg" style={{ background: "rgba(6,182,212,0.06)", border: "1px solid rgba(6,182,212,0.15)" }}>
                <DollarSign className="w-3.5 h-3.5 text-cyan-400" />
                {nodeWalletLoading && nodeWalletData.length === 0 ? (
                  <span className="text-xs font-mono text-muted-foreground">Loading...</span>
                ) : (
                  <>
                    <span className="text-xs font-mono font-bold text-foreground">
                      ${nodeWalletData.reduce((sum, w) => {
                        const usdNum = parseFloat((w.usd || '$0').replace(/[$,]/g, ''));
                        return sum + (isNaN(usdNum) ? 0 : usdNum);
                      }, 0).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">total across all 7 node assets</span>
                  </>
                )}
              </div>

              {oracleVmHealth && (
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {(['eth', 'sol', 'btc'] as const).map(chain => {
                    const rpc = oracleVmHealth.rpc[chain];
                    const label = chain === 'eth' ? 'ETH RPC' : chain === 'sol' ? 'SOL RPC' : 'BTC RPC';
                    const color = chain === 'eth' ? '#627EEA' : chain === 'sol' ? '#9945FF' : '#F7931A';
                    return (
                      <div key={chain} className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-mono"
                        style={{ background: rpc.ok ? `${color}12` : 'rgba(239,68,68,0.1)', border: `1px solid ${rpc.ok ? color + '30' : 'rgba(239,68,68,0.3)'}`, color: rpc.ok ? color : '#ef4444' }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: rpc.ok ? '#10b981' : '#ef4444' }} />
                        {label}
                        <span className="text-muted-foreground ml-0.5 truncate max-w-[80px]" title={rpc.url}>{rpc.url.replace('https://', '').split('/')[0]}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Wallet Balances */}
            <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <p className="text-xs font-semibold text-foreground mb-3">Fee Collection Wallet Balances</p>
              {nodeWalletLoading && nodeWalletData.length === 0 ? (
                <div className="space-y-2">
                  {[1,2,3].map(i => (
                    <div key={i} className="h-12 rounded-xl animate-pulse" style={{ background: "var(--muted)" }} />
                  ))}
                </div>
              ) : nodeWalletData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No wallet data available. Ensure the Oracle VM is running at 141.253.123.101:4000.</p>
              ) : (
                <div className="space-y-2">
                  {nodeWalletData.map((w, i) => {
                    const chainColor = w.chain === "solana" ? "#9945FF" : w.chain === "ethereum" ? "#627EEA" : "#F7931A";
                    const addrEntry = oracleVmAddresses?.find(
                      a => a.asset.toUpperCase() === w.asset.toUpperCase() && a.chain === w.chain
                    );
                    const displayAddress = w.address || addrEntry?.address || null;
                    return (
                      <div key={`${w.asset}-${w.chain}-${i}`}
                        className="rounded-xl p-3"
                        style={{ background: `${chainColor}08`, border: `1px solid ${chainColor}25` }}>
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-[10px] font-bold font-mono shrink-0"
                            style={{ background: `${chainColor}20`, color: chainColor, border: `1px solid ${chainColor}40` }}>
                            {w.asset}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-mono font-semibold text-foreground">{w.balance} {w.asset}</p>
                              <span className="text-[10px] font-mono text-muted-foreground">{w.usd}</span>
                            </div>
                            {displayAddress ? (
                              <div className="flex items-center gap-1 mt-0.5">
                                <span className="text-[9px] font-mono text-muted-foreground truncate max-w-[180px]">
                                  {displayAddress}
                                </span>
                                <button onClick={() => { navigator.clipboard.writeText(displayAddress); toast.success(`${w.asset} address copied`); }}
                                  className="shrink-0 text-muted-foreground hover:text-foreground">
                                  <Copy className="w-2.5 h-2.5" />
                                </button>
                                <button onClick={() => setQrModal({ address: displayAddress, label: `${w.asset} (${w.network})`, chainColor })}
                                  className="shrink-0 hover:opacity-80"
                                  style={{ color: chainColor }}>
                                  <QrCode className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            ) : (
                              <p className="text-[9px] text-amber-400 mt-0.5">{w.network} · address not available</p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-0.5 shrink-0">
                            <div className="flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: w.live ? "#10b981" : "#6b7280" }} />
                              <span className="text-[9px] text-muted-foreground">{w.live ? "live" : "offline"}</span>
                            </div>
                            <span className="text-[8px] px-1 py-0.5 rounded font-mono"
                              style={{ background: `${chainColor}15`, color: chainColor, border: `1px solid ${chainColor}30` }}>
                              {w.chain}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button onClick={() => {
                const solAddr = oracleVmAddresses?.find(a => a.chain === "solana" && a.asset === "SOL")?.address;
                if (solAddr) {
                  setQrModal({ address: solAddr, label: "SOL Agent Wallet", chainColor: "#9945FF" });
                } else {
                  toast.warning("SOL_AGENT_KEY not configured", {
                    description: "Add SOL_AGENT_KEY to project secrets to generate the agent wallet address.",
                    duration: 8000,
                  });
                }
              }}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", color: "#10b981" }}>
                <Plus className="w-3 h-3" /> Fund Wallet
              </button>
              <button onClick={() => toast.info("Withdraw — connect to node wallet to withdraw")}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}>
                <ArrowUpRight className="w-3 h-3" /> Withdraw
              </button>
            </div>

            {/* HTLC Wallet Section */}
            <HtlcWalletSection onShowQr={(address, label, chainColor) => setQrModal({ address, label, chainColor })} />

            {/* HTLC Transaction History */}
            <HtlcHistorySection />
          </div>
        )}

        {/* ── Peer Reports Tab ── */}
        {activeTab === "reports" && <PeerReportsTab />}

      </div>

      {/* QR Code Modal */}
      {qrModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.75)" }}
          onClick={() => setQrModal(null)}>
          <div
            className="rounded-2xl p-6 max-w-xs w-full"
            style={{ background: "var(--card)", border: `1px solid ${qrModal.chainColor}40` }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-bold text-foreground">{qrModal.label}</p>
              <button onClick={() => setQrModal(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex justify-center mb-4">
              <div className="p-3 rounded-xl bg-white">
                <QRCode value={qrModal.address} size={180} />
              </div>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
              <span className="text-[9px] font-mono text-foreground truncate flex-1">{qrModal.address}</span>
              <button
                onClick={() => { navigator.clipboard.writeText(qrModal.address); toast.success("Address copied"); }}
                className="shrink-0 text-muted-foreground hover:text-foreground">
                <Copy className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default function AdminPanel() {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem(ADMIN_SESSION_KEY) === "true");

  const handleLogout = () => {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    setAuthed(false);
  };

  if (!authed) return <PasswordGate onAuth={() => setAuthed(true)} />;
  return <AdminDashboard onLogout={handleLogout} />;
}
