/**
 * AdminPanel — Hidden operator dashboard at /admin
 * NOT linked from consumer UI. Password protected.
 * Design: Dark terminal aesthetic, data-dense, operator-focused
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Lock, Eye, EyeOff, Shield, DollarSign, Wallet, Settings,
  BarChart3, Activity, AlertTriangle, CheckCircle2, Copy,
  Plus, Trash2, Save, RefreshCw, TrendingUp, Zap, Users,
  ArrowUpRight, ArrowDownRight, Server, Database,
  GitBranch, Layers, Droplets, Route, ToggleLeft, ToggleRight, ChevronDown, ChevronUp,
  Cpu
} from "lucide-react";
import { getWallet, type WalletAsset } from "@/lib/afosApi";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

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

interface FeeConfig {
  swapFeeBps: number;
  expressFeeBps: number;
  botFeeFlat: number;
  minTradeUsd: number;
  maxTradeUsd: number;
  enabled: boolean;
}

// ─── Mock revenue data ────────────────────────────────────────────────────────
const MOCK_REVENUE = {
  totalUsd: 12847.50,
  todayUsd: 284.20,
  weekUsd: 1923.40,
  monthUsd: 8341.80,
  totalSwaps: 4821,
  todaySwaps: 47,
  activeUsers: 312,
  avgSwapUsd: 2664,
  byChain: [
    { chain: "BTC/LN", volume: "$284K", fees: "$852", pct: 45 },
    { chain: "SOL", volume: "$198K", fees: "$594", pct: 31 },
    { chain: "ETH", volume: "$96K", fees: "$288", pct: 16 },
    { chain: "Other", volume: "$38K", fees: "$114", pct: 8 },
  ],
  daily: [
    { day: "Mon", fees: 180 }, { day: "Tue", fees: 240 }, { day: "Wed", fees: 195 },
    { day: "Thu", fees: 310 }, { day: "Fri", fees: 284 }, { day: "Sat", fees: 220 },
    { day: "Sun", fees: 175 },
  ],
};

const MOCK_NODE_STATUS = [
  { name: "IntercomSwap Node", status: "live", uptime: "99.8%", peers: 12 },
  { name: "Bitcoin Node", status: "live", uptime: "99.5%", channels: 8 },
  { name: "Solana RPC", status: "live", uptime: "100%", latency: "42ms" },
  { name: "Ethereum RPC", status: "degraded", uptime: "97.2%", latency: "180ms" },
];

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

// ─── Admin Dashboard ──────────────────────────────────────────────────────────
type AdminTab = "revenue" | "fees" | "treasury" | "lp" | "routing" | "nodes" | "users" | "agent_wallet";

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<AdminTab>("revenue");

  // Fee config state
  const [feeConfig, setFeeConfig] = useState<FeeConfig>({
    swapFeeBps: 30,
    expressFeeBps: 10,
    botFeeFlat: 0.10,
    minTradeUsd: 1,
    maxTradeUsd: 50000,
    enabled: true,
  });
  const [feeSaved, setFeeSaved] = useState(false);

  // Treasury wallets state
  const [treasuryWallets, setTreasuryWallets] = useState<TreasuryWallet[]>([
    { id: "tw1", label: "Operations Treasury", chain: "solana", address: "AFOS1xKp...9mNzSOL", splitPercent: 60 },
    { id: "tw2", label: "Liquidity Reserve", chain: "solana", address: "AFOS2f8a...c12dSOL", splitPercent: 30 },
    { id: "tw3", label: "Team / Founders", chain: "ethereum", address: "0xAFOS...3c4d", splitPercent: 10 },
  ]);
  const [newWallet, setNewWallet] = useState({ label: "", chain: "solana" as TreasuryWallet["chain"], address: "", splitPercent: 0 });
  const [showAddWallet, setShowAddWallet] = useState(false);

  const totalSplit = treasuryWallets.reduce((s, w) => s + w.splitPercent, 0);

  const saveFeeConfig = () => {
    setFeeSaved(true);
    toast.success("Fee configuration saved");
    setTimeout(() => setFeeSaved(false), 2000);
  };

  const addWallet = () => {
    if (!newWallet.label || !newWallet.address) return;
    setTreasuryWallets(prev => [...prev, { ...newWallet, id: `tw_${Date.now()}` }]);
    setNewWallet({ label: "", chain: "solana", address: "", splitPercent: 0 });
    setShowAddWallet(false);
    toast.success("Treasury wallet added");
  };

  const removeWallet = (id: string) => {
    setTreasuryWallets(prev => prev.filter(w => w.id !== id));
    toast.info("Wallet removed");
  };

  // Agent wallet state (fetched from Oracle VM)
  const [nodeWalletData, setNodeWalletData] = useState<WalletAsset[]>([]);
  const [nodeKey, setNodeKey] = useState<string | null>(null);
  const [nodeWalletLoading, setNodeWalletLoading] = useState(false);

  const fetchNodeWallet = async () => {
    setNodeWalletLoading(true);
    try {
      const data = await getWallet();
      setNodeWalletData(data.wallets);
      setNodeKey(data.nodeKey);
    } catch { /* keep empty */ }
    setNodeWalletLoading(false);
  };

  useEffect(() => {
    fetchNodeWallet();
    const t = setInterval(fetchNodeWallet, 30_000);
    return () => clearInterval(t);
  }, []);

  // LP node state
  const [lpConfig, setLpConfig] = useState({
    btcReserve: 0.85,
    usdtReserve: 42500,
    solReserve: 284,
    spreadBps: 15,
    maxSingleTradeBtc: 0.1,
    autoRebalance: true,
    lpEnabled: true,
  });

  // Routing config state
  const [routingConfig, setRoutingConfig] = useState({
    defaultRoute: "afos_lp" as "afos_lp" | "p2p" | "best",
    p2pEnabled: true,
    p2pMinImprovementBps: 10,
    maxPeerLatencyMs: 500,
    preferLpBelow: 1000,
    autoFallback: true,
  });

  const TABS: { id: AdminTab; label: string; icon: React.ElementType }[] = [
    { id: "revenue", label: "Revenue", icon: BarChart3 },
    { id: "fees", label: "Fee Config", icon: Settings },
    { id: "treasury", label: "Treasury", icon: Wallet },
    { id: "lp", label: "LP Node", icon: Droplets },
    { id: "routing", label: "Routing", icon: Route },
    { id: "nodes", label: "Node Health", icon: Server },
    { id: "users", label: "Users", icon: Users },
    { id: "agent_wallet", label: "Agent Wallet", icon: Cpu },
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
        {activeTab === "revenue" && (
          <div className="space-y-4 max-w-4xl mx-auto">
            {/* KPI cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Total Revenue", value: `$${MOCK_REVENUE.totalUsd.toLocaleString()}`, sub: "All time", icon: DollarSign, color: "#10b981", trend: "+12%" },
                { label: "Today", value: `$${MOCK_REVENUE.todayUsd}`, sub: `${MOCK_REVENUE.todaySwaps} swaps`, icon: TrendingUp, color: "#60a5fa", trend: "+8%" },
                { label: "This Month", value: `$${MOCK_REVENUE.monthUsd.toLocaleString()}`, sub: "30 days", icon: BarChart3, color: "#a78bfa", trend: "+23%" },
                { label: "Active Users", value: MOCK_REVENUE.activeUsers.toString(), sub: "Last 30 days", icon: Users, color: "#f59e0b", trend: "+41%" },
              ].map(kpi => (
                <div key={kpi.label} className="rounded-2xl p-4"
                  style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <div className="flex items-center justify-between mb-2">
                    <kpi.icon className="w-4 h-4" style={{ color: kpi.color }} />
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: `${kpi.color}18`, color: kpi.color }}>
                      {kpi.trend}
                    </span>
                  </div>
                  <p className="text-lg font-bold text-foreground">{kpi.value}</p>
                  <p className="text-[10px] text-muted-foreground">{kpi.label}</p>
                  <p className="text-[9px] text-muted-foreground mt-0.5">{kpi.sub}</p>
                </div>
              ))}
            </div>

            {/* Weekly bar chart */}
            <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <p className="text-xs font-semibold text-foreground mb-4">Daily Fee Revenue (This Week)</p>
              <div className="flex items-end gap-2 h-24">
                {MOCK_REVENUE.daily.map(d => {
                  const maxFee = Math.max(...MOCK_REVENUE.daily.map(x => x.fees));
                  const pct = (d.fees / maxFee) * 100;
                  return (
                    <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                      <p className="text-[9px] text-muted-foreground">${d.fees}</p>
                      <div className="w-full rounded-t-lg transition-all"
                        style={{
                          height: `${pct}%`,
                          background: "rgba(59,130,246,0.4)",
                          border: "1px solid rgba(59,130,246,0.3)",
                          minHeight: "4px",
                        }} />
                      <p className="text-[9px] text-muted-foreground">{d.day}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* By chain */}
            <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <p className="text-xs font-semibold text-foreground mb-3">Revenue by Chain</p>
              <div className="space-y-3">
                {MOCK_REVENUE.byChain.map(c => (
                  <div key={c.chain}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-semibold text-foreground">{c.chain}</p>
                      <div className="flex items-center gap-3">
                        <p className="text-[10px] text-muted-foreground">Vol: {c.volume}</p>
                        <p className="text-[10px] font-semibold text-emerald-400">Fees: {c.fees}</p>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full" style={{ background: "var(--muted)" }}>
                      <div className="h-full rounded-full" style={{ width: `${c.pct}%`, background: "rgba(59,130,246,0.6)" }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Fee Config Tab ── */}
        {activeTab === "fees" && (
          <div className="space-y-4 max-w-lg mx-auto">
            <div className="rounded-2xl p-5 space-y-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-foreground">Fee Configuration</p>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">Swaps</span>
                  <button
                    onClick={() => setFeeConfig(prev => ({ ...prev, enabled: !prev.enabled }))}
                    className="relative w-10 h-5 rounded-full transition-all"
                    style={{ background: feeConfig.enabled ? "rgba(16,185,129,0.4)" : "var(--muted)" }}>
                    <div className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
                      style={{
                        background: feeConfig.enabled ? "#10b981" : "var(--muted-foreground)",
                        left: feeConfig.enabled ? "calc(100% - 18px)" : "2px",
                      }} />
                  </button>
                  <span className="text-[10px]" style={{ color: feeConfig.enabled ? "#10b981" : "var(--muted-foreground)" }}>
                    {feeConfig.enabled ? "Active" : "Paused"}
                  </span>
                </div>
              </div>

              {[
                { key: "swapFeeBps" as const, label: "Swap Fee", unit: "bps", desc: "Base fee on every swap (30 bps = 0.3%)", min: 0, max: 100 },
                { key: "expressFeeBps" as const, label: "Express Fee", unit: "bps", desc: "Additional fee for priority routing", min: 0, max: 50 },
                { key: "botFeeFlat" as const, label: "Bot/Autopost Fee", unit: "USD", desc: "Flat fee per automated task execution", min: 0, max: 1 },
                { key: "minTradeUsd" as const, label: "Min Trade Size", unit: "USD", desc: "Minimum swap value accepted", min: 0.1, max: 100 },
                { key: "maxTradeUsd" as const, label: "Max Trade Size", unit: "USD", desc: "Maximum swap value per transaction", min: 1000, max: 1000000 },
              ].map(field => (
                <div key={field.key}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div>
                      <p className="text-xs font-semibold text-foreground">{field.label}</p>
                      <p className="text-[10px] text-muted-foreground">{field.desc}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        value={feeConfig[field.key]}
                        onChange={e => setFeeConfig(prev => ({ ...prev, [field.key]: parseFloat(e.target.value) || 0 }))}
                        className="w-20 px-2 py-1.5 rounded-lg text-xs font-mono text-foreground text-right outline-none"
                        style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                        step={field.unit === "bps" ? 1 : 0.01}
                        min={field.min}
                        max={field.max}
                      />
                      <span className="text-[10px] text-muted-foreground w-8">{field.unit}</span>
                    </div>
                  </div>
                  {field.key === "swapFeeBps" && (
                    <p className="text-[10px] text-emerald-400 font-semibold">
                      = {(feeConfig.swapFeeBps / 100).toFixed(2)}% per swap
                    </p>
                  )}
                </div>
              ))}

              <button onClick={saveFeeConfig}
                className="w-full py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
                style={{
                  background: feeSaved ? "rgba(16,185,129,0.15)" : "rgba(59,130,246,0.15)",
                  border: `1px solid ${feeSaved ? "rgba(16,185,129,0.3)" : "rgba(59,130,246,0.3)"}`,
                  color: feeSaved ? "#10b981" : "#60a5fa",
                }}>
                {feeSaved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                {feeSaved ? "Saved!" : "Save Fee Configuration"}
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
                onClick={() => { setFeeConfig(prev => ({ ...prev, enabled: false })); toast.error("All swaps paused — kill switch activated"); }}
                className="w-full py-2.5 rounded-xl text-xs font-bold transition-all"
                style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}>
                Pause All Swaps
              </button>
            </div>
          </div>
        )}

        {/* ── Treasury Tab ── */}
        {activeTab === "treasury" && (
          <div className="space-y-4 max-w-lg mx-auto">
            {/* Split warning */}
            {totalSplit !== 100 && (
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
              {treasuryWallets.map(wallet => (
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
                          onChange={e => setTreasuryWallets(prev => prev.map(w =>
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
                      value={(newWallet as any)[field.key]}
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
              onClick={() => toast.success("Treasury configuration saved")}
              className="w-full py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all"
              style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)", color: "#10b981" }}>
              <Save className="w-3.5 h-3.5" />
              Save Split Configuration
            </button>
          </div>
        )}

        {/* ── Node Health Tab ── */}
        {activeTab === "nodes" && (
          <div className="space-y-3 max-w-lg mx-auto">
            {MOCK_NODE_STATUS.map(node => (
              <div key={node.name} className="rounded-2xl p-4"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-2 h-2 rounded-full ${node.status === "live" ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
                    <div>
                      <p className="text-xs font-semibold text-foreground">{node.name}</p>
                      <p className="text-[10px] text-muted-foreground">Uptime: {node.uptime}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                      style={{
                        background: node.status === "live" ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)",
                        color: node.status === "live" ? "#10b981" : "#f59e0b",
                      }}>
                      {node.status.toUpperCase()}
                    </span>
                    {"peers" in node && <p className="text-[10px] text-muted-foreground mt-0.5">{node.peers} peers</p>}
                    {"channels" in node && <p className="text-[10px] text-muted-foreground mt-0.5">{node.channels} channels</p>}
                    {"latency" in node && <p className="text-[10px] text-muted-foreground mt-0.5">{node.latency}</p>}
                  </div>
                </div>
              </div>
            ))}
            <button onClick={() => toast.info("Refreshing node status…")}
              className="w-full py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all"
              style={{ background: "var(--muted)", border: "1px solid var(--border)", color: "var(--muted-foreground)" }}>
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh Status
            </button>
          </div>
        )}

        {/* ── LP Node Tab ── */}
        {activeTab === "lp" && (
          <div className="space-y-4 max-w-lg mx-auto">
            {/* LP Status Banner */}
            <div className="rounded-2xl p-4 flex items-center justify-between"
              style={{ background: lpConfig.lpEnabled ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)", border: `1px solid ${lpConfig.lpEnabled ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.25)"}` }}>
              <div>
                <p className="text-xs font-bold" style={{ color: lpConfig.lpEnabled ? "#10b981" : "#ef4444" }}>
                  {lpConfig.lpEnabled ? "AFOS LP Node — Active" : "AFOS LP Node — Paused"}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Serving as default counterparty for all trades</p>
              </div>
              <button onClick={() => { setLpConfig(p => ({ ...p, lpEnabled: !p.lpEnabled })); toast.success(lpConfig.lpEnabled ? "LP node paused" : "LP node activated"); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                style={{ background: lpConfig.lpEnabled ? "rgba(239,68,68,0.12)" : "rgba(16,185,129,0.12)", border: `1px solid ${lpConfig.lpEnabled ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.3)"}`, color: lpConfig.lpEnabled ? "#ef4444" : "#10b981" }}>
                {lpConfig.lpEnabled ? "Pause LP" : "Activate LP"}
              </button>
            </div>

            {/* Reserve Balances */}
            <div className="rounded-2xl p-4 space-y-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <p className="text-xs font-semibold text-foreground">LP Reserve Balances</p>
              {[
                { label: "BTC (on-chain)", value: `${lpConfig.btcReserve} BTC`, usd: `$${(lpConfig.btcReserve * 96420).toLocaleString()}`, color: "#f59e0b", pct: (lpConfig.btcReserve / 1.0) * 100 },
                { label: "USDT (Solana)", value: `${lpConfig.usdtReserve.toLocaleString()} USDT`, usd: `$${lpConfig.usdtReserve.toLocaleString()}`, color: "#10b981", pct: (lpConfig.usdtReserve / 100000) * 100 },
                { label: "SOL (Gas)", value: `${lpConfig.solReserve} SOL`, usd: `$${(lpConfig.solReserve * 142.8).toFixed(0)}`, color: "#a78bfa", pct: (lpConfig.solReserve / 500) * 100 },
              ].map(r => (
                <div key={r.label}>
                  <div className="flex justify-between mb-1">
                    <span className="text-[10px] text-muted-foreground">{r.label}</span>
                    <span className="text-[10px] font-semibold text-foreground">{r.value} <span className="text-muted-foreground">≈ {r.usd}</span></span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background: "var(--muted)" }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(r.pct, 100)}%`, background: r.color }} />
                  </div>
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <button onClick={() => toast.info("Fund LP — connect to node wallet to deposit")} className="flex-1 py-2 rounded-lg text-[10px] font-bold transition-all" style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", color: "#10b981" }}>+ Add Liquidity</button>
                <button onClick={() => toast.info("Withdraw — connect to node wallet to withdraw")} className="flex-1 py-2 rounded-lg text-[10px] font-bold transition-all" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}>Withdraw</button>
              </div>
            </div>

            {/* LP Config */}
            <div className="rounded-2xl p-4 space-y-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <p className="text-xs font-semibold text-foreground">LP Parameters</p>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">Spread (bps) — LP profit margin per trade</label>
                  <input type="number" value={lpConfig.spreadBps} onChange={e => setLpConfig(p => ({ ...p, spreadBps: +e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-transparent text-foreground"
                    style={{ border: "1px solid var(--border)" }} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">Max single trade (BTC)</label>
                  <input type="number" value={lpConfig.maxSingleTradeBtc} step="0.01" onChange={e => setLpConfig(p => ({ ...p, maxSingleTradeBtc: +e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-transparent text-foreground"
                    style={{ border: "1px solid var(--border)" }} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-semibold text-foreground">Auto-rebalance</p>
                    <p className="text-[9px] text-muted-foreground">Automatically rebalance BTC/USDT reserves</p>
                  </div>
                  <button onClick={() => setLpConfig(p => ({ ...p, autoRebalance: !p.autoRebalance }))}
                    style={{ color: lpConfig.autoRebalance ? "#10b981" : "var(--muted-foreground)" }}>
                    {lpConfig.autoRebalance ? <ToggleRight className="w-7 h-7" /> : <ToggleLeft className="w-7 h-7" />}
                  </button>
                </div>
              </div>
              <button onClick={() => toast.success("LP configuration saved")} className="w-full py-2.5 rounded-xl text-xs font-bold transition-all" style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)", color: "#60a5fa" }}>Save LP Config</button>
            </div>
          </div>
        )}

        {/* ── Routing Config Tab ── */}
        {activeTab === "routing" && (
          <div className="space-y-4 max-w-lg mx-auto">
            <div className="rounded-2xl p-4 space-y-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <p className="text-xs font-semibold text-foreground">Default Route Mode</p>
              <div className="grid grid-cols-3 gap-2">
                {(["afos_lp", "p2p", "best"] as const).map(mode => (
                  <button key={mode} onClick={() => setRoutingConfig(p => ({ ...p, defaultRoute: mode }))}
                    className="py-2.5 rounded-xl text-[10px] font-bold transition-all"
                    style={{
                      background: routingConfig.defaultRoute === mode ? "rgba(59,130,246,0.15)" : "var(--muted)",
                      border: `1px solid ${routingConfig.defaultRoute === mode ? "rgba(59,130,246,0.4)" : "var(--border)"}`,
                      color: routingConfig.defaultRoute === mode ? "#60a5fa" : "var(--muted-foreground)",
                    }}>
                    {mode === "afos_lp" ? "AFOS LP" : mode === "p2p" ? "P2P Only" : "Best Rate"}
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-muted-foreground">
                {routingConfig.defaultRoute === "afos_lp" && "All trades routed through AFOS LP node. Fastest execution, guaranteed liquidity."}
                {routingConfig.defaultRoute === "p2p" && "All trades routed to P2P peers. Best rates but requires peer availability."}
                {routingConfig.defaultRoute === "best" && "AFOS LP is default. P2P peers are used if they beat the LP rate by the threshold below."}
              </p>
            </div>

            <div className="rounded-2xl p-4 space-y-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <p className="text-xs font-semibold text-foreground">P2P Routing Rules</p>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-semibold text-foreground">Enable P2P routing</p>
                    <p className="text-[9px] text-muted-foreground">Allow trades to route to P2P peers</p>
                  </div>
                  <button onClick={() => setRoutingConfig(p => ({ ...p, p2pEnabled: !p.p2pEnabled }))} style={{ color: routingConfig.p2pEnabled ? "#10b981" : "var(--muted-foreground)" }}>
                    {routingConfig.p2pEnabled ? <ToggleRight className="w-7 h-7" /> : <ToggleLeft className="w-7 h-7" />}
                  </button>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">Min improvement over LP rate (bps) to use P2P</label>
                  <input type="number" value={routingConfig.p2pMinImprovementBps} onChange={e => setRoutingConfig(p => ({ ...p, p2pMinImprovementBps: +e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-transparent text-foreground" style={{ border: "1px solid var(--border)" }} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">Max peer latency (ms)</label>
                  <input type="number" value={routingConfig.maxPeerLatencyMs} onChange={e => setRoutingConfig(p => ({ ...p, maxPeerLatencyMs: +e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-transparent text-foreground" style={{ border: "1px solid var(--border)" }} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">Prefer LP for trades below ($USD)</label>
                  <input type="number" value={routingConfig.preferLpBelow} onChange={e => setRoutingConfig(p => ({ ...p, preferLpBelow: +e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-transparent text-foreground" style={{ border: "1px solid var(--border)" }} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-semibold text-foreground">Auto-fallback to LP</p>
                    <p className="text-[9px] text-muted-foreground">Fall back to AFOS LP if no P2P peer responds</p>
                  </div>
                  <button onClick={() => setRoutingConfig(p => ({ ...p, autoFallback: !p.autoFallback }))} style={{ color: routingConfig.autoFallback ? "#10b981" : "var(--muted-foreground)" }}>
                    {routingConfig.autoFallback ? <ToggleRight className="w-7 h-7" /> : <ToggleLeft className="w-7 h-7" />}
                  </button>
                </div>
              </div>
              <button onClick={() => toast.success("Routing configuration saved")} className="w-full py-2.5 rounded-xl text-xs font-bold transition-all" style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)", color: "#60a5fa" }}>Save Routing Config</button>
            </div>
          </div>
        )}

        {/* ── Users Tab ── */}
        {activeTab === "users" && (
          <div className="space-y-4 max-w-lg mx-auto">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Total Wallets", value: "1,284", icon: Wallet, color: "#60a5fa" },
                { label: "Active (30d)", value: "312", icon: Activity, color: "#10b981" },
                { label: "Avg Swap Size", value: `$${MOCK_REVENUE.avgSwapUsd.toLocaleString()}`, icon: ArrowUpRight, color: "#a78bfa" },
                { label: "Total Volume", value: "$616K", icon: Database, color: "#f59e0b" },
              ].map(stat => (
                <div key={stat.label} className="rounded-2xl p-4"
                  style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <stat.icon className="w-4 h-4 mb-2" style={{ color: stat.color }} />
                  <p className="text-lg font-bold text-foreground">{stat.value}</p>
                  <p className="text-[10px] text-muted-foreground">{stat.label}</p>
                </div>
              ))}
            </div>
            <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <p className="text-xs font-semibold text-foreground mb-3">Top Pairs by Volume</p>
              {[
                { pair: "USDT → BTC", vol: "$284K", swaps: 1842, pct: 46 },
                { pair: "BTC → USDT", vol: "$198K", swaps: 1204, pct: 32 },
                { pair: "SOL → USDT", vol: "$96K", swaps: 891, pct: 16 },
                { pair: "ETH → BTC", vol: "$38K", swaps: 284, pct: 6 },
              ].map(row => (
                <div key={row.pair} className="flex items-center gap-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-foreground">{row.pair}</p>
                    <p className="text-[10px] text-muted-foreground">{row.swaps} swaps</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold text-foreground">{row.vol}</p>
                    <p className="text-[10px] text-emerald-400">{row.pct}%</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Agent Wallet Tab ── */}
        {activeTab === "agent_wallet" && (
          <div className="space-y-4 max-w-lg mx-auto">
            {/* Node Key Header */}
            <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-cyan-400" />
                  <p className="text-sm font-bold text-foreground">AFOS Agent Hot Wallet</p>
                </div>
                <button onClick={fetchNodeWallet}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-all"
                  style={{ background: "var(--muted)", border: "1px solid var(--border)", color: "var(--muted-foreground)" }}>
                  <RefreshCw className={`w-3 h-3 ${nodeWalletLoading ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mb-2">Node hot wallet used for autonomous swaps. Fund this wallet to enable agent-executed trades.</p>
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
            </div>

            {/* Wallet Balances */}
            <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <p className="text-xs font-semibold text-foreground mb-3">Agent Wallet Balances</p>
              {nodeWalletLoading && nodeWalletData.length === 0 ? (
                <div className="space-y-2">
                  {[1,2,3].map(i => (
                    <div key={i} className="h-12 rounded-xl animate-pulse" style={{ background: "var(--muted)" }} />
                  ))}
                </div>
              ) : nodeWalletData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No wallet data available. Ensure the Oracle VM is running.</p>
              ) : (
                <div className="space-y-2">
                  {nodeWalletData.map((w, i) => {
                    const chainColor = w.chain === "solana" ? "#9945FF" : w.chain === "ethereum" ? "#627EEA" : "#F7931A";
                    return (
                      <div key={`${w.asset}-${w.chain}-${i}`}
                        className="flex items-center gap-3 p-3 rounded-xl"
                        style={{ background: `${chainColor}08`, border: `1px solid ${chainColor}25` }}>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold font-mono"
                          style={{ background: `${chainColor}20`, color: chainColor, border: `1px solid ${chainColor}40` }}>
                          {w.asset}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-mono font-semibold text-foreground">{w.balance}</p>
                          <p className="text-[10px] text-muted-foreground">{w.network}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-mono text-foreground">{w.usd}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: w.live ? "#10b981" : "#6b7280" }} />
                            <span className="text-[9px] text-muted-foreground">{w.live ? "live" : "offline"}</span>
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
              <button onClick={() => toast.info("Fund agent wallet — send assets to the node address above")}
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
            <HtlcWalletSection />

          </div>
        )}

      </div>
    </div>
  );
}

// ─── HTLC Wallet Section ─────────────────────────────────────────────────────

const CHAIN_COLORS: Record<string, string> = {
  bitcoin:  "#F7931A",
  ethereum: "#627EEA",
  solana:   "#9945FF",
};

function HtlcWalletSection() {
  const { data, isLoading, refetch, isRefetching } = trpc.htlcWallet.getHtlcWallets.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const wallets = data ? [data.btc, data.eth, data.sol] : [];
  const loading = isLoading;
  const refreshing = isRefetching;

  // Total USD
  const totalUsd = wallets.reduce((sum, w) => {
    const usdNum = parseFloat((w.usd ?? "$0").replace(/[^\d.-]/g, "")) || 0;
    return sum + usdNum;
  }, 0);

  return (
    <>
      {/* HTLC Wallet Header */}
      <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-400" />
            <p className="text-sm font-bold text-foreground">AFOS Agent HTLC Wallet</p>
          </div>
          <button onClick={() => refetch()}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-all"
            style={{ background: "var(--muted)", border: "1px solid var(--border)", color: "var(--muted-foreground)" }}>
            <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mb-3">
          HTLC signing wallets derived from agent private keys. Used to lock, claim, and refund atomic swaps across all 3 chains.
        </p>

        {/* Total value */}
        {totalUsd > 0 && (
          <div className="flex items-center gap-2 mb-3 p-2 rounded-lg" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
            <DollarSign className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs font-mono font-bold text-foreground">${totalUsd.toFixed(2)}</span>
            <span className="text-[10px] text-muted-foreground">total across HTLC wallets</span>
          </div>
        )}
      </div>

      {/* HTLC Wallet Balances */}
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
              return (
                <div key={w.chain}
                  className="rounded-xl p-3"
                  style={{ background: `${chainColor}08`, border: `1px solid ${chainColor}25` }}>
                  <div className="flex items-center gap-3">
                    {/* Asset badge */}
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center text-[10px] font-bold font-mono"
                      style={{ background: `${chainColor}20`, color: chainColor, border: `1px solid ${chainColor}40` }}>
                      {w.asset}
                    </div>
                    {/* Balance + address */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-mono font-semibold text-foreground">{w.balance} {w.asset}</p>
                        <span className="text-[10px] font-mono text-muted-foreground">{w.usd}</span>
                      </div>
                      {w.address ? (
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[9px] font-mono text-muted-foreground truncate max-w-[200px]">
                            {w.address}
                          </span>
                          <button onClick={() => { navigator.clipboard.writeText(w.address!); toast.success(`${w.asset} HTLC address copied`); }}
                            className="shrink-0 text-muted-foreground hover:text-foreground">
                            <Copy className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ) : (
                        <p className="text-[9px] text-amber-400 mt-0.5">
                          {w.error ?? "Key not configured"}
                        </p>
                      )}
                    </div>
                    {/* Status */}
                    <div className="flex flex-col items-end gap-0.5">
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
