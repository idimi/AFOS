/**
 * AFOS — Swap History Page
 * Design: Glassmorphism + Agentic Sci-Fi
 * Features: Full transaction table, pair/status/date filters, chain explorer links, stats summary
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, Filter, ExternalLink, Copy, ChevronDown,
  CheckCircle2, XCircle, Clock, Loader2, Search,
  ArrowDownUp, TrendingUp, TrendingDown, BarChart3,
  Calendar, RefreshCw, Download, ChevronLeft, ChevronRight,
  Zap, Globe, Shield
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

type SwapStatus = "complete" | "failed" | "pending" | "refunded";
type ChainId = "bitcoin" | "ethereum" | "solana";

interface SwapRecord {
  id: string;
  timestamp: Date;
  fromSymbol: string;
  toSymbol: string;
  fromChain: ChainId;
  toChain: ChainId;
  fromAmount: number;
  toAmount: number;
  fromUsd: number;
  toUsd: number;
  status: SwapStatus;
  protocol: string;
  peer: string;
  txHash: string;
  fee: number;
  settlementTime: number; // ms
  agentExecuted: boolean;
}

// ─── Chain Config ─────────────────────────────────────────────────────────────

const CHAIN_CONFIG: Record<ChainId, { name: string; color: string; explorer: string; icon: string }> = {
  bitcoin: { name: "Lightning", color: "#f7931a", explorer: "https://mempool.space/tx/", icon: "₿" },
  ethereum: { name: "Ethereum", color: "#627eea", explorer: "https://etherscan.io/tx/", icon: "Ξ" },
  solana: { name: "Solana", color: "#9945ff", explorer: "https://solscan.io/tx/", icon: "◎" },
};

const TOKEN_COLORS: Record<string, string> = {
  BTC: "#f7931a", ETH: "#627eea", SOL: "#9945ff",
  USDT: "#26a17b", USDC: "#2775ca", WBTC: "#f7931a",
};

// ─── Mock Transaction Data ────────────────────────────────────────────────────

function makeHash(): string {
  return "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

function makeLnHash(): string {
  return Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

const RAW_SWAPS: Omit<SwapRecord, "id" | "txHash">[] = [
  { timestamp: new Date(Date.now() - 2 * 60000), fromSymbol: "BTC", toSymbol: "USDT", fromChain: "bitcoin", toChain: "solana", fromAmount: 0.0023, toAmount: 99.86, fromUsd: 99.86, toUsd: 99.86, status: "complete", protocol: "Lightning ↔ Solana HTLC", peer: "GammaLN", fee: 0.50, settlementTime: 2800, agentExecuted: true },
  { timestamp: new Date(Date.now() - 18 * 60000), fromSymbol: "ETH", toSymbol: "SOL", fromChain: "ethereum", toChain: "solana", fromAmount: 0.12, toAmount: 24.01, fromUsd: 359.76, toUsd: 360.15, status: "complete", protocol: "EVM ↔ Solana Bridge", peer: "BetaSwap", fee: 2.16, settlementTime: 19200, agentExecuted: true },
  { timestamp: new Date(Date.now() - 1 * 3600000), fromSymbol: "SOL", toSymbol: "USDT", fromChain: "solana", toChain: "solana", fromAmount: 5.0, toAmount: 749.25, fromUsd: 750.00, toUsd: 749.25, status: "complete", protocol: "Solana SPL Swap", peer: "AlphaNode", fee: 2.25, settlementTime: 420, agentExecuted: false },
  { timestamp: new Date(Date.now() - 3 * 3600000), fromSymbol: "BTC", toSymbol: "ETH", fromChain: "bitcoin", toChain: "ethereum", fromAmount: 0.005, toAmount: 0.0718, fromUsd: 217.09, toUsd: 215.24, status: "failed", protocol: "Lightning ↔ EVM HTLC", peer: "DeltaNode", fee: 0, settlementTime: 0, agentExecuted: true },
  { timestamp: new Date(Date.now() - 5 * 3600000), fromSymbol: "USDC", toSymbol: "SOL", fromChain: "ethereum", toChain: "solana", fromAmount: 300.00, toAmount: 1.99, fromUsd: 300.00, toUsd: 298.50, status: "complete", protocol: "EVM DEX Route", peer: "GammaLN", fee: 0.90, settlementTime: 14500, agentExecuted: true },
  { timestamp: new Date(Date.now() - 8 * 3600000), fromSymbol: "BTC", toSymbol: "USDT", fromChain: "bitcoin", toChain: "solana", fromAmount: 0.0115, toAmount: 499.30, fromUsd: 499.30, toUsd: 499.30, status: "complete", protocol: "Lightning ↔ Solana HTLC", peer: "GammaLN", fee: 2.50, settlementTime: 3100, agentExecuted: true },
  { timestamp: new Date(Date.now() - 12 * 3600000), fromSymbol: "ETH", toSymbol: "USDC", fromChain: "ethereum", toChain: "ethereum", fromAmount: 0.5, toAmount: 1497.50, fromUsd: 1499.00, toUsd: 1497.50, status: "complete", protocol: "EVM DEX Route", peer: "BetaSwap", fee: 4.50, settlementTime: 11800, agentExecuted: false },
  { timestamp: new Date(Date.now() - 16 * 3600000), fromSymbol: "SOL", toSymbol: "BTC", fromChain: "solana", toChain: "bitcoin", fromAmount: 20.0, toAmount: 0.0691, fromUsd: 3000.00, toUsd: 2998.72, status: "complete", protocol: "Solana ↔ Lightning HTLC", peer: "AlphaNode", fee: 9.00, settlementTime: 4200, agentExecuted: true },
  { timestamp: new Date(Date.now() - 22 * 3600000), fromSymbol: "BTC", toSymbol: "USDT", fromChain: "bitcoin", toChain: "solana", fromAmount: 0.003, toAmount: 130.25, fromUsd: 130.25, toUsd: 130.25, status: "refunded", protocol: "Lightning ↔ Solana HTLC", peer: "EpsilonPeer", fee: 0, settlementTime: 0, agentExecuted: true },
  { timestamp: new Date(Date.now() - 26 * 3600000), fromSymbol: "USDT", toSymbol: "SOL", fromChain: "solana", toChain: "solana", fromAmount: 450.00, toAmount: 2.99, fromUsd: 450.00, toUsd: 448.50, status: "complete", protocol: "Solana SPL Swap", peer: "AlphaNode", fee: 1.35, settlementTime: 380, agentExecuted: false },
  { timestamp: new Date(Date.now() - 30 * 3600000), fromSymbol: "ETH", toSymbol: "BTC", fromChain: "ethereum", toChain: "bitcoin", fromAmount: 0.25, toAmount: 0.01726, fromUsd: 749.50, toUsd: 748.89, status: "complete", protocol: "EVM ↔ Lightning HTLC", peer: "BetaSwap", fee: 5.99, settlementTime: 17200, agentExecuted: true },
  { timestamp: new Date(Date.now() - 36 * 3600000), fromSymbol: "BTC", toSymbol: "SOL", fromChain: "bitcoin", toChain: "solana", fromAmount: 0.008, toAmount: 23.09, fromUsd: 347.34, toUsd: 346.35, status: "complete", protocol: "Lightning ↔ Solana HTLC", peer: "GammaLN", fee: 2.43, settlementTime: 2900, agentExecuted: true },
  { timestamp: new Date(Date.now() - 2 * 86400000), fromSymbol: "SOL", toSymbol: "USDC", fromChain: "solana", toChain: "ethereum", fromAmount: 8.0, toAmount: 1198.40, fromUsd: 1200.00, toUsd: 1198.40, status: "complete", protocol: "Solana ↔ EVM Bridge", peer: "BetaSwap", fee: 7.20, settlementTime: 22100, agentExecuted: false },
  { timestamp: new Date(Date.now() - 2.5 * 86400000), fromSymbol: "BTC", toSymbol: "USDT", fromChain: "bitcoin", toChain: "solana", fromAmount: 0.023, toAmount: 998.14, fromUsd: 998.14, toUsd: 998.14, status: "complete", protocol: "Lightning ↔ Solana HTLC", peer: "GammaLN", fee: 4.99, settlementTime: 3400, agentExecuted: true },
  { timestamp: new Date(Date.now() - 3 * 86400000), fromSymbol: "ETH", toSymbol: "SOL", fromChain: "ethereum", toChain: "solana", fromAmount: 0.8, toAmount: 159.68, fromUsd: 2398.40, toUsd: 2395.20, status: "failed", protocol: "EVM ↔ Solana Bridge", peer: "DeltaNode", fee: 0, settlementTime: 0, agentExecuted: true },
  { timestamp: new Date(Date.now() - 4 * 86400000), fromSymbol: "USDT", toSymbol: "BTC", fromChain: "solana", toChain: "bitcoin", fromAmount: 2000.00, toAmount: 0.04608, fromUsd: 2000.00, toUsd: 1999.60, status: "complete", protocol: "Solana ↔ Lightning HTLC", peer: "GammaLN", fee: 10.00, settlementTime: 3800, agentExecuted: true },
  { timestamp: new Date(Date.now() - 5 * 86400000), fromSymbol: "SOL", toSymbol: "ETH", fromChain: "solana", toChain: "ethereum", fromAmount: 15.0, toAmount: 0.7497, fromUsd: 2250.00, toUsd: 2248.59, status: "complete", protocol: "Solana ↔ EVM Bridge", peer: "BetaSwap", fee: 13.50, settlementTime: 19800, agentExecuted: false },
  { timestamp: new Date(Date.now() - 6 * 86400000), fromSymbol: "BTC", toSymbol: "USDT", fromChain: "bitcoin", toChain: "solana", fromAmount: 0.046, toAmount: 1997.23, fromUsd: 1997.23, toUsd: 1997.23, status: "complete", protocol: "Lightning ↔ Solana HTLC", peer: "AlphaNode", fee: 9.99, settlementTime: 2600, agentExecuted: true },
  { timestamp: new Date(Date.now() - 7 * 86400000), fromSymbol: "ETH", toSymbol: "USDT", fromChain: "ethereum", toChain: "solana", fromAmount: 1.2, toAmount: 3597.60, fromUsd: 3597.60, toUsd: 3597.60, status: "pending", protocol: "EVM ↔ Solana Bridge", peer: "BetaSwap", fee: 10.79, settlementTime: 0, agentExecuted: true },
  { timestamp: new Date(Date.now() - 8 * 86400000), fromSymbol: "SOL", toSymbol: "BTC", fromChain: "solana", toChain: "bitcoin", fromAmount: 50.0, toAmount: 0.1728, fromUsd: 7500.00, toUsd: 7499.23, status: "complete", protocol: "Solana ↔ Lightning HTLC", peer: "GammaLN", fee: 37.50, settlementTime: 4100, agentExecuted: true },
];

const SWAP_HISTORY: SwapRecord[] = RAW_SWAPS.map((s, i) => ({
  ...s,
  id: `swap_${i.toString().padStart(4, "0")}`,
  txHash: s.fromChain === "bitcoin" ? makeLnHash() : makeHash(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function formatSettlement(ms: number): string {
  if (ms === 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function truncateHash(hash: string): string {
  if (hash.startsWith("0x")) return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SwapStatus }) {
  const config = {
    complete: { icon: <CheckCircle2 className="w-3 h-3" />, label: "Complete", bg: "oklch(0.55 0.18 165 / 0.12)", border: "oklch(0.55 0.18 165 / 0.3)", color: "oklch(0.75 0.18 165)" },
    failed: { icon: <XCircle className="w-3 h-3" />, label: "Failed", bg: "oklch(0.55 0.22 25 / 0.12)", border: "oklch(0.55 0.22 25 / 0.3)", color: "oklch(0.75 0.22 25)" },
    pending: { icon: <Loader2 className="w-3 h-3 animate-spin" />, label: "Pending", bg: "oklch(0.55 0.2 220 / 0.12)", border: "oklch(0.55 0.2 220 / 0.3)", color: "oklch(0.75 0.2 220)" },
    refunded: { icon: <RefreshCw className="w-3 h-3" />, label: "Refunded", bg: "oklch(0.55 0.18 60 / 0.12)", border: "oklch(0.55 0.18 60 / 0.3)", color: "oklch(0.75 0.18 60)" },
  }[status];

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-semibold"
      style={{ background: config.bg, border: `1px solid ${config.border}`, color: config.color }}
    >
      {config.icon}
      {config.label}
    </span>
  );
}

// ─── Chain Tag ────────────────────────────────────────────────────────────────

function ChainTag({ chain }: { chain: ChainId }) {
  const c = CHAIN_CONFIG[chain];
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono"
      style={{ background: `${c.color}15`, color: c.color, border: `1px solid ${c.color}30` }}
    >
      {c.icon} {c.name}
    </span>
  );
}

// ─── Summary Stats ────────────────────────────────────────────────────────────

function SummaryStats({ swaps }: { swaps: SwapRecord[] }) {
  const completed = swaps.filter(s => s.status === "complete");
  const totalVolume = completed.reduce((acc, s) => acc + s.fromUsd, 0);
  const totalFees = completed.reduce((acc, s) => acc + s.fee, 0);
  const avgSettlement = completed.length > 0
    ? completed.reduce((acc, s) => acc + s.settlementTime, 0) / completed.length
    : 0;
  const successRate = swaps.length > 0 ? (completed.length / swaps.length) * 100 : 0;

  const stats = [
    { label: "Total Volume", value: `$${totalVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, icon: <TrendingUp className="w-3.5 h-3.5" />, color: "text-amber-400", glow: "#f59e0b" },
    { label: "Transactions", value: String(swaps.length), icon: <BarChart3 className="w-3.5 h-3.5" />, color: "text-cyan-400", glow: "#06b6d4" },
    { label: "Fees Paid", value: `$${totalFees.toFixed(2)}`, icon: <Shield className="w-3.5 h-3.5" />, color: "text-violet-400", glow: "#7c3aed" },
    { label: "Success Rate", value: `${successRate.toFixed(1)}%`, icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: "text-emerald-400", glow: "#10b981" },
    { label: "Avg Settlement", value: formatSettlement(avgSettlement), icon: <Clock className="w-3.5 h-3.5" />, color: "text-sky-400", glow: "#38bdf8" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      {stats.map((s, i) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06 }}
          className="rounded-xl px-4 py-3"
          style={{
            background: "oklch(0.13 0.03 265 / 0.8)",
            border: "1px solid oklch(0.28 0.04 255 / 0.2)",
          }}
        >
          <div className={`flex items-center gap-1.5 mb-1.5 ${s.color}`}>
            {s.icon}
            <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">{s.label}</span>
          </div>
          <div className={`text-lg font-bold font-mono ${s.color}`}>{s.value}</div>
        </motion.div>
      ))}
    </div>
  );
}

// ─── Filters ─────────────────────────────────────────────────────────────────

const ALL_PAIRS = Array.from(new Set(SWAP_HISTORY.map(s => `${s.fromSymbol}/${s.toSymbol}`))).sort();
const ALL_STATUSES: SwapStatus[] = ["complete", "failed", "pending", "refunded"];
const DATE_RANGES = ["All time", "Last 24h", "Last 7d", "Last 30d"];

interface Filters {
  search: string;
  pair: string;
  status: string;
  dateRange: string;
  chain: string;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SwapHistory() {
  const [filters, setFilters] = useState<Filters>({
    search: "", pair: "All", status: "All", dateRange: "All time", chain: "All"
  });
  const [sortField, setSortField] = useState<"timestamp" | "fromUsd" | "fee" | "settlementTime">("timestamp");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const PAGE_SIZE = 8;

  const filtered = useMemo(() => {
    let result = [...SWAP_HISTORY];

    // Search
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(s =>
        s.fromSymbol.toLowerCase().includes(q) ||
        s.toSymbol.toLowerCase().includes(q) ||
        s.peer.toLowerCase().includes(q) ||
        s.txHash.toLowerCase().includes(q) ||
        s.protocol.toLowerCase().includes(q)
      );
    }

    // Pair
    if (filters.pair !== "All") {
      result = result.filter(s => `${s.fromSymbol}/${s.toSymbol}` === filters.pair);
    }

    // Status
    if (filters.status !== "All") {
      result = result.filter(s => s.status === filters.status);
    }

    // Chain
    if (filters.chain !== "All") {
      result = result.filter(s => s.fromChain === filters.chain || s.toChain === filters.chain);
    }

    // Date range
    const now = Date.now();
    if (filters.dateRange === "Last 24h") result = result.filter(s => now - s.timestamp.getTime() < 86400000);
    if (filters.dateRange === "Last 7d") result = result.filter(s => now - s.timestamp.getTime() < 7 * 86400000);
    if (filters.dateRange === "Last 30d") result = result.filter(s => now - s.timestamp.getTime() < 30 * 86400000);

    // Sort
    result.sort((a, b) => {
      const va = sortField === "timestamp" ? a.timestamp.getTime() : a[sortField];
      const vb = sortField === "timestamp" ? b.timestamp.getTime() : b[sortField];
      return sortDir === "desc" ? (vb as number) - (va as number) : (va as number) - (vb as number);
    });

    return result;
  }, [filters, sortField, sortDir]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortField(field); setSortDir("desc"); }
    setPage(1);
  };

  const setFilter = (key: keyof Filters, val: string) => {
    setFilters(f => ({ ...f, [key]: val }));
    setPage(1);
  };

  const copyHash = (hash: string) => {
    toast.success("Hash copied", { description: truncateHash(hash) });
  };

  const openExplorer = (swap: SwapRecord) => {
    const chain = CHAIN_CONFIG[swap.fromChain];
    const url = chain.explorer + swap.txHash;
    toast.info("Opening explorer", { description: url });
    window.open(url, "_blank");
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Swap History</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            All past swaps · IntercomSwap P2P · {SWAP_HISTORY.length} total transactions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => toast.info("Export coming soon")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200 transition-colors"
            style={{ background: "oklch(0.17 0.03 265)", border: "1px solid oklch(0.28 0.04 255 / 0.2)" }}
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <SummaryStats swaps={filtered} />

      {/* Filters */}
      <div
        className="rounded-2xl p-4 mb-4"
        style={{
          background: "oklch(0.13 0.03 265 / 0.8)",
          border: "1px solid oklch(0.28 0.04 255 / 0.2)",
        }}
      >
        <div className="flex flex-wrap gap-3 items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search pair, peer, hash..."
              value={filters.search}
              onChange={e => setFilter("search", e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg text-xs text-slate-300 placeholder-slate-600 outline-none"
              style={{ background: "oklch(0.17 0.03 265)", border: "1px solid oklch(0.28 0.04 255 / 0.25)" }}
            />
          </div>

          {/* Pair filter */}
          <FilterSelect
            label="Pair"
            value={filters.pair}
            options={["All", ...ALL_PAIRS]}
            onChange={v => setFilter("pair", v)}
          />

          {/* Status filter */}
          <FilterSelect
            label="Status"
            value={filters.status}
            options={["All", ...ALL_STATUSES]}
            onChange={v => setFilter("status", v)}
          />

          {/* Chain filter */}
          <FilterSelect
            label="Chain"
            value={filters.chain}
            options={["All", "bitcoin", "ethereum", "solana"]}
            onChange={v => setFilter("chain", v)}
          />

          {/* Date range */}
          <FilterSelect
            label="Date"
            value={filters.dateRange}
            options={DATE_RANGES}
            onChange={v => setFilter("dateRange", v)}
          />

          {/* Reset */}
          <button
            onClick={() => { setFilters({ search: "", pair: "All", status: "All", dateRange: "All time", chain: "All" }); setPage(1); }}
            className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            Reset
          </button>
        </div>
      </div>

      {/* Table */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: "oklch(0.13 0.03 265 / 0.8)",
          border: "1px solid oklch(0.28 0.04 255 / 0.2)",
        }}
      >
        {/* Table header */}
        <div
          className="grid text-[10px] font-mono uppercase tracking-widest text-slate-500 px-5 py-3 border-b"
          style={{
            gridTemplateColumns: "1fr 1.4fr 1fr 0.8fr 0.8fr 0.7fr 0.8fr 0.6fr",
            borderColor: "oklch(0.28 0.04 255 / 0.15)",
          }}
        >
          <SortHeader label="Time" field="timestamp" current={sortField} dir={sortDir} onClick={handleSort} />
          <span>Swap</span>
          <span>Protocol</span>
          <SortHeader label="Value" field="fromUsd" current={sortField} dir={sortDir} onClick={handleSort} />
          <SortHeader label="Fee" field="fee" current={sortField} dir={sortDir} onClick={handleSort} />
          <SortHeader label="Speed" field="settlementTime" current={sortField} dir={sortDir} onClick={handleSort} />
          <span>Status</span>
          <span>Tx</span>
        </div>

        {/* Rows */}
        <AnimatePresence mode="popLayout">
          {paginated.length === 0 ? (
            <div className="py-16 text-center text-slate-600 text-sm">
              No transactions match your filters
            </div>
          ) : (
            paginated.map((swap, i) => (
              <motion.div key={swap.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                {/* Main row */}
                <div
                  className="grid items-center px-5 py-3.5 cursor-pointer hover:bg-white/3 transition-colors border-b"
                  style={{
                    gridTemplateColumns: "1fr 1.4fr 1fr 0.8fr 0.8fr 0.7fr 0.8fr 0.6fr",
                    borderColor: "oklch(0.28 0.04 255 / 0.08)",
                  }}
                  onClick={() => setExpandedId(expandedId === swap.id ? null : swap.id)}
                >
                  {/* Time */}
                  <div>
                    <div className="text-xs text-slate-400">{formatTime(swap.timestamp)}</div>
                    <div className="text-[9px] text-slate-600 mt-0.5">
                      {swap.timestamp.toLocaleDateString()} {swap.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>

                  {/* Swap pair */}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold font-mono" style={{ color: TOKEN_COLORS[swap.fromSymbol] ?? "#94a3b8" }}>
                        {swap.fromAmount.toLocaleString(undefined, { maximumFractionDigits: 5 })} {swap.fromSymbol}
                      </span>
                      <span className="text-slate-600">→</span>
                      <span className="text-xs font-bold font-mono" style={{ color: TOKEN_COLORS[swap.toSymbol] ?? "#94a3b8" }}>
                        {swap.toAmount.toLocaleString(undefined, { maximumFractionDigits: 5 })} {swap.toSymbol}
                      </span>
                    </div>
                  </div>

                  {/* Protocol */}
                  <div>
                    <div className="text-[10px] text-slate-400 leading-tight">{swap.protocol}</div>
                    <div className="text-[9px] text-slate-600 mt-0.5">{swap.peer}</div>
                  </div>

                  {/* Value */}
                  <div className="text-xs font-mono text-amber-400 font-semibold">
                    ${swap.fromUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>

                  {/* Fee */}
                  <div className="text-xs font-mono text-slate-400">
                    {swap.fee > 0 ? `$${swap.fee.toFixed(2)}` : "—"}
                  </div>

                  {/* Speed */}
                  <div className="text-xs font-mono text-slate-400">
                    {formatSettlement(swap.settlementTime)}
                  </div>

                  {/* Status */}
                  <StatusBadge status={swap.status} />

                  {/* Tx hash */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-slate-500">{truncateHash(swap.txHash)}</span>
                    <button onClick={e => { e.stopPropagation(); copyHash(swap.txHash); }}
                      className="text-slate-600 hover:text-cyan-400 transition-colors">
                      <Copy className="w-3 h-3" />
                    </button>
                    <button onClick={e => { e.stopPropagation(); openExplorer(swap); }}
                      className="text-slate-600 hover:text-cyan-400 transition-colors">
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Expanded detail */}
                <AnimatePresence>
                  {expandedId === swap.id && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div
                        className="px-5 py-4 border-b grid grid-cols-2 md:grid-cols-4 gap-4"
                        style={{
                          background: "oklch(0.11 0.025 265 / 0.8)",
                          borderColor: "oklch(0.28 0.04 255 / 0.08)",
                        }}
                      >
                        <div>
                          <div className="text-[9px] font-mono text-slate-600 uppercase tracking-widest mb-1">From Chain</div>
                          <ChainTag chain={swap.fromChain} />
                        </div>
                        <div>
                          <div className="text-[9px] font-mono text-slate-600 uppercase tracking-widest mb-1">To Chain</div>
                          <ChainTag chain={swap.toChain} />
                        </div>
                        <div>
                          <div className="text-[9px] font-mono text-slate-600 uppercase tracking-widest mb-1">Executed By</div>
                          <span className={`text-xs font-semibold ${swap.agentExecuted ? "text-cyan-400" : "text-slate-400"}`}>
                            {swap.agentExecuted ? "🤖 OpenClaw Agent" : "👤 Manual"}
                          </span>
                        </div>
                        <div>
                          <div className="text-[9px] font-mono text-slate-600 uppercase tracking-widest mb-1">Full Tx Hash</div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono text-slate-400 truncate max-w-[140px]">{swap.txHash}</span>
                            <button onClick={() => copyHash(swap.txHash)} className="text-slate-600 hover:text-cyan-400 flex-shrink-0">
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] font-mono text-slate-600 uppercase tracking-widest mb-1">Settlement Time</div>
                          <span className="text-xs font-mono text-slate-300">{formatSettlement(swap.settlementTime)}</span>
                        </div>
                        <div>
                          <div className="text-[9px] font-mono text-slate-600 uppercase tracking-widest mb-1">Peer</div>
                          <span className="text-xs font-mono text-slate-300">{swap.peer}</span>
                        </div>
                        <div>
                          <div className="text-[9px] font-mono text-slate-600 uppercase tracking-widest mb-1">Rate</div>
                          <span className="text-xs font-mono text-slate-300">
                            1 {swap.fromSymbol} = {(swap.toAmount / swap.fromAmount).toFixed(4)} {swap.toSymbol}
                          </span>
                        </div>
                        <div>
                          <div className="text-[9px] font-mono text-slate-600 uppercase tracking-widest mb-1">Explorer</div>
                          <button
                            onClick={() => openExplorer(swap)}
                            className="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                          >
                            View on {CHAIN_CONFIG[swap.fromChain].name}
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))
          )}
        </AnimatePresence>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3">
            <span className="text-[10px] text-slate-600">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-300 disabled:opacity-30 transition-colors"
                style={{ background: "oklch(0.17 0.03 265)", border: "1px solid oklch(0.28 0.04 255 / 0.2)" }}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className="w-7 h-7 rounded-lg text-xs font-mono transition-all"
                  style={{
                    background: p === page ? "oklch(0.55 0.2 220 / 0.2)" : "oklch(0.17 0.03 265)",
                    border: `1px solid ${p === page ? "oklch(0.55 0.2 220 / 0.4)" : "oklch(0.28 0.04 255 / 0.2)"}`,
                    color: p === page ? "oklch(0.75 0.2 220)" : "#64748b",
                  }}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-300 disabled:opacity-30 transition-colors"
                style={{ background: "oklch(0.17 0.03 265)", border: "1px solid oklch(0.28 0.04 255 / 0.2)" }}
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FilterSelect({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none pl-3 pr-7 py-2 rounded-lg text-xs text-slate-300 outline-none cursor-pointer"
        style={{
          background: "oklch(0.17 0.03 265)",
          border: "1px solid oklch(0.28 0.04 255 / 0.25)",
        }}
      >
        {options.map(o => <option key={o} value={o}>{label}: {o}</option>)}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
    </div>
  );
}

function SortHeader({ label, field, current, dir, onClick }: {
  label: string;
  field: "timestamp" | "fromUsd" | "fee" | "settlementTime";
  current: string;
  dir: "asc" | "desc";
  onClick: (f: "timestamp" | "fromUsd" | "fee" | "settlementTime") => void;
}) {
  const active = current === field;
  return (
    <button
      onClick={() => onClick(field)}
      className={`flex items-center gap-1 hover:text-slate-300 transition-colors ${active ? "text-cyan-400" : ""}`}
    >
      {label}
      <ArrowDownUp className="w-2.5 h-2.5" />
    </button>
  );
}
