/**
 * AFOS — Swap History Page
 * Design: Glassmorphism + Agentic Sci-Fi
 * Features: Full transaction table, pair/status/date filters, chain explorer links, stats summary
 * Data: Real live data from trpc.history.list — wallet-scoped when wallet connected, global operator view otherwise
 */

import { useState, useMemo, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, ExternalLink, Copy, ChevronDown,
  CheckCircle2, XCircle, Clock, Loader2, Search,
  ArrowDownUp, TrendingUp, TrendingDown, BarChart3,
  RefreshCw, Download, ChevronLeft, ChevronRight,
  Shield, AlertTriangle, RotateCcw, History, Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useWallet } from "../contexts/WalletContext";
import { useMultiChainWallet } from "../contexts/MultiChainWalletContext";
import { OpenTradesTab, RefundsTab, HtlcSearchBar } from "./SwapHistoryTabs";
import { useAuth } from "@/_core/hooks/useAuth";

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
  bitcoin: { name: "Bitcoin", color: "#f7931a", explorer: "https://mempool.space/tx/", icon: "₿" },
  ethereum: { name: "Ethereum", color: "#627eea", explorer: "https://etherscan.io/tx/", icon: "Ξ" },
  solana: { name: "Solana", color: "#9945ff", explorer: "https://solscan.io/tx/", icon: "◎" },
};

const TOKEN_COLORS: Record<string, string> = {
  BTC: "#f7931a", ETH: "#627eea", SOL: "#9945ff",
  USDT: "#26a17b", USDC: "#2775ca", WBTC: "#f7931a",
};

// ─── DB Row → SwapRecord mapper ───────────────────────────────────────────────

function guessChain(token: string): ChainId {
  if (token === "BTC" || token === "WBTC") return "bitcoin";
  if (token === "ETH" || token === "USDC" || token === "USDT") return "ethereum";
  return "solana";
}

function mapDbRowToSwapRecord(row: {
  id: number;
  fromChain: "bitcoin" | "ethereum" | "solana";
  toChain: "bitcoin" | "ethereum" | "solana";
  fromToken: string;
  toToken: string;
  amount: string;
  amountUsd: string | null;
  route: string;
  status: "completed" | "failed" | "refunded";
  settlementMs: number | null;
  txId: string | null;
  peerId: string | null;
  platformFeeUsd: string | null;
  feeBps: number | null;
  feeAmountOut: string | null;
  outAmount: string | null;
  walletAddress: string | null;
  createdAt: Date;
}): SwapRecord {
  const fromSymbol = row.fromToken;
  const toSymbol = row.toToken;
  const fromAmount = parseFloat(row.amount);
  const toAmount = parseFloat(row.outAmount ?? "0");
  const fromUsd = parseFloat(row.amountUsd ?? "0");
  const fee = parseFloat(row.platformFeeUsd ?? "0");
  const feeBps = row.feeBps ?? 0;
  const settlementTime = row.settlementMs ?? (feeBps === 15 ? 600000 : feeBps === 20 ? 15000 : 0);
  const rawStatus = row.status;
  const status: SwapStatus = rawStatus === "completed" ? "complete" : rawStatus as SwapStatus;
  const protocol = row.route === "p2p" ? "IntercomSwap" : row.route === "dex" ? "DEX Aggregator" : (row.route ?? "Unknown");
  const peer = row.peerId ?? "P2P Network";
  const txHash = row.txId ?? "";

  return {
    id: String(row.id),
    timestamp: row.createdAt,
    fromSymbol,
    toSymbol,
    fromChain: row.fromChain,
    toChain: row.toChain,
    fromAmount,
    toAmount,
    fromUsd,
    toUsd: fromUsd, // approximation
    status,
    protocol,
    peer,
    txHash,
    fee,
    settlementTime,
    agentExecuted: true,
  };
}

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
  if (!hash || hash.length < 12) return hash || "—";
  if (hash.startsWith("0x")) return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SwapStatus }) {
  const config = {
    complete: { icon: <CheckCircle2 className="w-3 h-3" />, label: "Complete", bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.35)", color: "#10b981" },
    failed: { icon: <XCircle className="w-3 h-3" />, label: "Failed", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.35)", color: "#ef4444" },
    pending: { icon: <Loader2 className="w-3 h-3 animate-spin" />, label: "Pending", bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.35)", color: "#3b82f6" },
    refunded: { icon: <RefreshCw className="w-3 h-3" />, label: "Refunded", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.35)", color: "#f59e0b" },
  }[status] ?? { icon: null, label: status, bg: "var(--muted)", border: "var(--border)", color: "var(--muted-foreground)" };

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

// ─── Mobile Summary Stats (horizontal scroll strip) ─────────────────────────

function MobileSummaryStats({ stats }: { stats: { totalSwaps: number; totalVolumeUsd: number; totalFeesUsd: number; successRate: string } }) {
  const items = [
    { label: "Volume", value: `$${stats.totalVolumeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: "text-amber-400" },
    { label: "Txns", value: String(stats.totalSwaps), color: "text-cyan-400" },
    { label: "Fees", value: `$${stats.totalFeesUsd.toFixed(2)}`, color: "text-violet-400" },
    { label: "Success", value: `${stats.successRate}%`, color: "text-emerald-400" },
  ];
  return (
    <div className="sm:hidden flex gap-2 overflow-x-auto pb-2 mb-4 scrollbar-hide">
      {items.map(s => (
        <div
          key={s.label}
          className="flex-shrink-0 rounded-xl px-3 py-2.5 min-w-[90px]"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground mb-1">{s.label}</div>
          <div className={`text-sm font-bold font-mono ${s.color}`}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Summary Stats ────────────────────────────────────────────────────────────

function SummaryStats({ stats }: { stats: { totalSwaps: number; totalVolumeUsd: number; totalFeesUsd: number; successRate: string } }) {
  const items = [
    { label: "Total Volume", value: `$${stats.totalVolumeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, icon: <TrendingUp className="w-3.5 h-3.5" />, color: "text-amber-400" },
    { label: "Transactions", value: String(stats.totalSwaps), icon: <BarChart3 className="w-3.5 h-3.5" />, color: "text-cyan-400" },
    { label: "Fees Paid", value: `$${stats.totalFeesUsd.toFixed(2)}`, icon: <Shield className="w-3.5 h-3.5" />, color: "text-violet-400" },
    { label: "Success Rate", value: `${stats.successRate}%`, icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: "text-emerald-400" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {items.map((s, i) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06 }}
          className="rounded-xl px-4 py-3"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className={`flex items-center gap-1.5 mb-1.5 ${s.color}`}>
            {s.icon}
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{s.label}</span>
          </div>
          <div className={`text-lg font-bold font-mono ${s.color}`}>{s.value}</div>
        </motion.div>
      ))}
    </div>
  );
}

// ─── Filters ─────────────────────────────────────────────────────────────────

const DATE_RANGES = ["All time", "Last 24h", "Last 7d", "Last 30d"];

interface Filters {
  search: string;
  status: string;
  dateRange: string;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SwapHistory() {
  // Auth context — used for admin "All Swaps" toggle
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  // Admin toggle: admins can switch between wallet-scoped and global view
  const [showAllSwaps, setShowAllSwaps] = useState(false);

  // Wallet context — collect all connected wallet addresses
  const { publicKey } = useWallet();
  const { bitcoin, ethereum } = useMultiChainWallet();

  const connectedAddresses = useMemo(() => {
    const addrs: string[] = [];
    if (publicKey) addrs.push(publicKey.toString());
    if (bitcoin?.address) addrs.push(bitcoin.address);
    if (ethereum?.address) addrs.push(ethereum.address);
    return addrs;
  }, [publicKey, bitcoin?.address, ethereum?.address]);

  // When admin toggles "All Swaps", pass empty array to get global view
  const walletAddresses = isAdmin && showAllSwaps ? [] : connectedAddresses;

  const hasWallet = connectedAddresses.length > 0;

  const [activeTab, setActiveTab] = useState<"history" | "open" | "refunds">("history");
  const [filters, setFilters] = useState<Filters>({
    search: "", status: "All", dateRange: "All time",
  });
  const [sortField, setSortField] = useState<"timestamp" | "fromUsd" | "fee">("timestamp");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const PAGE_SIZE = 8;

  // Debounced search for Swaps tab — 350ms delay so we don't fire a server request on every keystroke
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(filters.search);
      setPage(1); // reset to page 1 when search changes
    }, 350);
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); };
  }, [filters.search]);

  // Shared search for Open Trades + Refunds tabs
  const [htlcSearch, setHtlcSearch] = useState("");
  const [debouncedHtlcSearch, setDebouncedHtlcSearch] = useState("");
  const htlcDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (htlcDebounceTimer.current) clearTimeout(htlcDebounceTimer.current);
    htlcDebounceTimer.current = setTimeout(() => {
      setDebouncedHtlcSearch(htlcSearch);
    }, 350);
    return () => { if (htlcDebounceTimer.current) clearTimeout(htlcDebounceTimer.current); };
  }, [htlcSearch]);

  // Compute days from dateRange filter
  const days = filters.dateRange === "Last 24h" ? 1
    : filters.dateRange === "Last 7d" ? 7
    : filters.dateRange === "Last 30d" ? 30
    : 90;

  // Map status filter to tRPC enum
  const statusParam = filters.status === "All" ? "all"
    : filters.status === "complete" ? "completed"
    : filters.status === "failed" ? "failed"
    : filters.status === "refunded" ? "refunded"
    : "all";

  // Fetch real data from tRPC — true server-side pagination with server-side search
  const { data: historyData, isLoading: historyLoading, isFetching, refetch } = trpc.history.list.useQuery({
    walletAddresses,
    status: statusParam as "all" | "completed" | "failed" | "refunded",
    days,
    search: debouncedSearch,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  }, { refetchInterval: 30000, placeholderData: (prev) => prev });

  const { data: statsData } = trpc.history.stats.useQuery({
    walletAddresses,
    days,
  }, { refetchInterval: 30000 });

  // Map DB rows to SwapRecord
  const allSwaps: SwapRecord[] = useMemo(() => {
    if (!historyData?.rows) return [];
    return historyData.rows.map(mapDbRowToSwapRecord);
  }, [historyData]);

  const stats = statsData ?? { totalSwaps: 0, totalVolumeUsd: 0, totalFeesUsd: 0, successRate: "0.0", isWalletScoped: false };

  // Client-side sort only (search is now server-side via debouncedSearch)
  const filtered = useMemo(() => {
    const result = [...allSwaps];
    result.sort((a, b) => {
      const va = sortField === "timestamp" ? a.timestamp.getTime() : a[sortField];
      const vb = sortField === "timestamp" ? b.timestamp.getTime() : b[sortField];
      return sortDir === "desc" ? (vb as number) - (va as number) : (va as number) - (vb as number);
    });
    return result;
  }, [allSwaps, sortField, sortDir]);

  // Server returns exactly PAGE_SIZE rows; total comes from server count
  const serverTotal = historyData?.total ?? 0;
  const totalPages = Math.ceil(serverTotal / PAGE_SIZE);
  const paginated = filtered;

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
    navigator.clipboard.writeText(hash).catch(() => {});
    toast.success("Hash copied", { description: truncateHash(hash) });
  };

  const openExplorer = (swap: SwapRecord) => {
    if (!swap.txHash) { toast.info("No transaction hash available"); return; }
    const chain = CHAIN_CONFIG[swap.fromChain];
    const url = chain.explorer + swap.txHash;
    window.open(url, "_blank");
  };

  const [isExporting, setIsExporting] = useState(false);
  const exportCsvQuery = trpc.history.exportCsv.useQuery(
    {
      walletAddresses,
      status: statusParam as "all" | "completed" | "failed" | "refunded",
      days,
      search: debouncedSearch,
    },
    { enabled: false } // only fetch on demand
  );

  const exportCsv = async () => {
    setIsExporting(true);
    try {
      const result = await exportCsvQuery.refetch();
      const csv = result.data?.csv ?? "";
      if (!csv) {
        toast.info("No data to export");
        return;
      }
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `afos-history-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSV exported", { description: `Downloaded ${csv.split("\n").length - 1} rows` });
    } catch {
      toast.error("Export failed", { description: "Could not fetch history for export" });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="max-w-[1280px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">History</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {hasWallet
              ? `Your swaps · Open trades · Refunds`
              : `All network swaps · Open trades · Refunds`}
          </p>
        </div>
        {activeTab === "history" && (
          <button
            onClick={() => { void exportCsv(); }}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            {isExporting
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Download className="w-3.5 h-3.5" />
            }
            {isExporting ? "Exporting…" : "Export CSV"}
          </button>
        )}
      </div>

      {/* Admin toggle: My Swaps / All Swaps */}
      {isAdmin && hasWallet && (
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => setShowAllSwaps(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: !showAllSwaps ? "rgba(6,182,212,0.12)" : "var(--muted)",
              border: `1px solid ${!showAllSwaps ? "rgba(6,182,212,0.4)" : "var(--border)"}`,
              color: !showAllSwaps ? "#22d3ee" : "var(--muted-foreground)",
            }}
          >
            <Wallet className="w-3 h-3" />
            My Swaps
          </button>
          <button
            onClick={() => setShowAllSwaps(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: showAllSwaps ? "rgba(139,92,246,0.12)" : "var(--muted)",
              border: `1px solid ${showAllSwaps ? "rgba(139,92,246,0.4)" : "var(--border)"}`,
              color: showAllSwaps ? "#a78bfa" : "var(--muted-foreground)",
            }}
          >
            <Shield className="w-3 h-3" />
            All Swaps
          </button>
        </div>
      )}
      {/* Wallet scope banner — shown when no wallet connected */}
      {!hasWallet && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl mb-4 text-xs"
          style={{ background: "rgba(6,182,212,0.07)", border: "1px solid rgba(6,182,212,0.2)" }}
        >
          <Wallet className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
          <span className="text-cyan-300/80">
            Connect a wallet to see only your transactions. Currently showing all network swaps (operator view).
          </span>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 p-1 rounded-xl" style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
        {([
          { id: "history", label: "Completed", icon: <History className="w-3.5 h-3.5" /> },
          { id: "open", label: "Open Trades", icon: <Activity className="w-3.5 h-3.5" /> },
          { id: "refunds", label: "Refunds", icon: <RotateCcw className="w-3.5 h-3.5" /> },
        ] as const).map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: activeTab === tab.id ? "var(--card)" : "transparent",
              color: activeTab === tab.id ? "var(--foreground)" : "var(--muted-foreground)",
              boxShadow: activeTab === tab.id ? "0 1px 4px rgba(0,0,0,0.2)" : "none",
            }}>
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Shared search bar for HTLC tabs */}
      {(activeTab === "open" || activeTab === "refunds") && (
        <HtlcSearchBar value={htlcSearch} onChange={setHtlcSearch} />
      )}

      {/* Open Trades Tab */}
      {activeTab === "open" && (
        <OpenTradesTab walletAddresses={walletAddresses} search={debouncedHtlcSearch} />
      )}

      {/* Refunds Tab */}
      {activeTab === "refunds" && (
        <RefundsTab walletAddresses={walletAddresses} search={debouncedHtlcSearch} />
      )}

      {/* History Tab */}
      {activeTab === "history" && <>
        {/* Summary Stats */}
        <div className="hidden sm:block"><SummaryStats stats={stats} /></div>
        <MobileSummaryStats stats={stats} />

        {/* Filters */}
        <div
          className="rounded-2xl p-4 mb-4"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search pair, peer, hash..."
                value={filters.search}
                onChange={e => setFilter("search", e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg text-xs bg-transparent text-foreground placeholder:text-muted-foreground outline-none"
                style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
              />
            </div>
            {/* Status filter */}
            <FilterSelect
              label="Status"
              value={filters.status}
              options={["All", "complete", "failed", "refunded"]}
              onChange={v => setFilter("status", v)}
            />
            {/* Date range filter */}
            <FilterSelect
              label="Range"
              value={filters.dateRange}
              options={DATE_RANGES}
              onChange={v => setFilter("dateRange", v)}
            />
            {/* Refresh */}
            <button
              onClick={() => refetch()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
              style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          {/* Desktop header */}
          <div
            className="hidden sm:grid text-[10px] font-mono uppercase tracking-widest text-muted-foreground px-5 py-3 border-b"
            style={{
              gridTemplateColumns: "1fr 1.6fr 1fr 0.8fr 0.8fr 0.8fr 0.8fr 0.6fr",
              borderColor: "var(--border)",
            }}
          >
            <SortHeader label="Time" field="timestamp" current={sortField} dir={sortDir} onClick={handleSort} />
            <span>Swap</span>
            <span>Protocol</span>
            <SortHeader label="Value" field="fromUsd" current={sortField} dir={sortDir} onClick={handleSort} />
            <span>Received</span>
            <SortHeader label="Fee" field="fee" current={sortField} dir={sortDir} onClick={handleSort} />
            <span>Status</span>
            <span>Tx</span>
          </div>

          {/* Loading state */}
          {historyLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 text-muted-foreground animate-spin mr-2" />
              <span className="text-xs text-muted-foreground">Loading transactions…</span>
            </div>
          )}

          {/* Rows */}
          {!historyLoading && (
            <AnimatePresence mode="popLayout">
              {paginated.length === 0 ? (
                <div className="py-16 text-center">
                  <History className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    {hasWallet ? "No transactions found for your wallet" : "No transactions match your filters"}
                  </p>
                  {hasWallet && (
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      Your swap history will appear here once you execute trades through AFOS
                    </p>
                  )}
                </div>
              ) : (
                paginated.map((swap, i) => (
                  <motion.div key={swap.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    {/* Desktop row */}
                    <div
                      className="hidden sm:grid items-center px-5 py-3.5 cursor-pointer hover:bg-muted transition-colors border-b"
                      style={{
                        gridTemplateColumns: "1fr 1.6fr 1fr 0.8fr 0.8fr 0.8fr 0.8fr 0.6fr",
                        borderColor: "var(--border)",
                      }}
                      onClick={() => setExpandedId(expandedId === swap.id ? null : swap.id)}
                    >
                      <div>
                        <div className="text-xs text-muted-foreground">{formatTime(swap.timestamp)}</div>
                        <div className="text-[9px] text-slate-600 mt-0.5">
                          {swap.timestamp.toLocaleDateString()} {swap.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold font-mono" style={{ color: TOKEN_COLORS[swap.fromSymbol] ?? "#94a3b8" }}>
                          {swap.fromAmount.toLocaleString(undefined, { maximumFractionDigits: 5 })} {swap.fromSymbol}
                        </span>
                        <span className="text-slate-600">→</span>
                        <span className="text-xs font-bold font-mono" style={{ color: TOKEN_COLORS[swap.toSymbol] ?? "#94a3b8" }}>
                          {swap.toAmount.toLocaleString(undefined, { maximumFractionDigits: 5 })} {swap.toSymbol}
                        </span>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground leading-tight">{swap.protocol}</div>
                        <div className="text-[9px] text-slate-600 mt-0.5">{swap.peer}</div>
                      </div>
                      <div className="text-xs font-mono text-amber-400 font-semibold">
                        ${swap.fromUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </div>
                      <div className="text-xs font-mono">
                        {swap.toAmount > 0 ? (
                          <span style={{ color: TOKEN_COLORS[swap.toSymbol] ?? "#94a3b8" }}>
                            {swap.toAmount.toLocaleString(undefined, { maximumFractionDigits: 5 })} {swap.toSymbol}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                      <div className="text-xs font-mono text-muted-foreground">
                        {swap.fee > 0 ? `$${swap.fee.toFixed(2)}` : "—"}
                      </div>
                      <StatusBadge status={swap.status} />
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-muted-foreground">{truncateHash(swap.txHash)}</span>
                        {swap.txHash && <>
                          <button onClick={e => { e.stopPropagation(); copyHash(swap.txHash); }} className="text-slate-600 hover:text-cyan-400 transition-colors"><Copy className="w-3 h-3" /></button>
                          <button onClick={e => { e.stopPropagation(); openExplorer(swap); }} className="text-slate-600 hover:text-cyan-400 transition-colors"><ExternalLink className="w-3 h-3" /></button>
                        </>}
                      </div>
                    </div>

                    {/* Mobile card */}
                    <div
                      className="sm:hidden px-3 py-3 cursor-pointer border-b active:bg-muted transition-colors"
                      style={{ borderColor: "var(--border)" }}
                      onClick={() => setExpandedId(expandedId === swap.id ? null : swap.id)}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="text-xs font-bold font-mono" style={{ color: TOKEN_COLORS[swap.fromSymbol] ?? "#94a3b8" }}>
                              {swap.fromAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {swap.fromSymbol}
                            </span>
                            <span className="text-muted-foreground text-xs">→</span>
                            <span className="text-xs font-bold font-mono" style={{ color: TOKEN_COLORS[swap.toSymbol] ?? "#94a3b8" }}>
                              {swap.toAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {swap.toSymbol}
                            </span>
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate mt-0.5">{swap.protocol}</div>
                        </div>
                        <StatusBadge status={swap.status} />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-mono text-amber-400 font-semibold">
                            ${swap.fromUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                          <span className="text-[10px] text-slate-600">{swap.peer}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground">{formatTime(swap.timestamp)}</span>
                          <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform ${expandedId === swap.id ? "rotate-180" : ""}`} />
                        </div>
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
                            className="px-4 sm:px-5 py-4 border-b grid grid-cols-2 md:grid-cols-4 gap-4"
                            style={{ background: "var(--muted)", borderColor: "var(--border)" }}
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
                              <span className="text-xs font-semibold text-cyan-400">🤖 AFOS Agent</span>
                            </div>
                            <div>
                              <div className="text-[9px] font-mono text-slate-600 uppercase tracking-widest mb-1">Peer</div>
                              <span className="text-xs font-mono text-foreground">{swap.peer}</span>
                            </div>
                            <div>
                              <div className="text-[9px] font-mono text-slate-600 uppercase tracking-widest mb-1">Fee</div>
                              <span className="text-xs font-mono text-foreground">{swap.fee > 0 ? `$${swap.fee.toFixed(2)}` : "—"}</span>
                            </div>
                            <div>
                              <div className="text-[9px] font-mono text-slate-600 uppercase tracking-widest mb-1">Settlement</div>
                              <span className="text-xs font-mono text-foreground">{formatSettlement(swap.settlementTime)}</span>
                            </div>
                            <div>
                              <div className="text-[9px] font-mono text-slate-600 uppercase tracking-widest mb-1">Rate</div>
                              <span className="text-xs font-mono text-foreground">
                                1 {swap.fromSymbol} = {swap.fromAmount > 0 ? (swap.toAmount / swap.fromAmount).toFixed(4) : "—"} {swap.toSymbol}
                              </span>
                            </div>
                            <div>
                              <div className="text-[9px] font-mono text-slate-600 uppercase tracking-widest mb-1">Tx Hash</div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[110px]">{truncateHash(swap.txHash)}</span>
                                {swap.txHash && <>
                                  <button onClick={() => copyHash(swap.txHash)} className="text-slate-600 hover:text-cyan-400 flex-shrink-0"><Copy className="w-3 h-3" /></button>
                                  <button onClick={() => openExplorer(swap)} className="text-slate-600 hover:text-cyan-400 flex-shrink-0"><ExternalLink className="w-3 h-3" /></button>
                                </>}
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          )}

          {/* Pagination — server-side */}
          {!historyLoading && totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-[10px] text-slate-600 flex items-center gap-1.5">
                {isFetching && !historyLoading && (
                  <span className="inline-block w-2.5 h-2.5 rounded-full border border-cyan-500 border-t-transparent animate-spin" />
                )}
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, serverTotal)} of {serverTotal}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1 || isFetching}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                  style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                {/* Show up to 7 page buttons with ellipsis for large page counts */}
                {(() => {
                  const pages: (number | "...")[] = [];
                  if (totalPages <= 7) {
                    for (let i = 1; i <= totalPages; i++) pages.push(i);
                  } else {
                    pages.push(1);
                    if (page > 3) pages.push("...");
                    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
                    if (page < totalPages - 2) pages.push("...");
                    pages.push(totalPages);
                  }
                  return pages.map((p, idx) =>
                    p === "..." ? (
                      <span key={`ellipsis-${idx}`} className="w-7 h-7 flex items-center justify-center text-xs text-muted-foreground">…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setPage(p as number)}
                        disabled={isFetching}
                        className="w-7 h-7 rounded-lg text-xs font-mono transition-all disabled:opacity-50"
                        style={{
                          background: p === page ? "rgba(59,130,246,0.15)" : "var(--muted)",
                          border: `1px solid ${p === page ? "rgba(59,130,246,0.4)" : "var(--border)"}`,
                          color: p === page ? "#3b82f6" : "var(--muted-foreground)",
                        }}
                      >
                        {p}
                      </button>
                    )
                  );
                })()}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages || isFetching}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                  style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </>}
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
        className="appearance-none pl-3 pr-7 py-2 rounded-lg text-xs text-foreground outline-none cursor-pointer"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        {options.map(o => <option key={o} value={o}>{label}: {o}</option>)}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
    </div>
  );
}

function SortHeader({ label, field, current, dir, onClick }: {
  label: string;
  field: "timestamp" | "fromUsd" | "fee";
  current: string;
  dir: "asc" | "desc";
  onClick: (f: "timestamp" | "fromUsd" | "fee") => void;
}) {
  const active = current === field;
  return (
    <button
      onClick={() => onClick(field)}
      className={`flex items-center gap-1 hover:text-foreground transition-colors ${active ? "text-cyan-400" : ""}`}
    >
      {label}
      <ArrowDownUp className="w-2.5 h-2.5" />
    </button>
  );
}
