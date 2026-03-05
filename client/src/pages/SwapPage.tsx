/**
 * SwapPage — Production-ready consumer swap interface
 * Design: Clean, trustless, non-custodial swap flow
 * Flow: Connect wallet → Select pair → Fetch real quote → Confirm → Execute via P2P / fallback
 * Fee: 0.3% AFOS protocol fee shown transparently on every swap
 *
 * Data sources (NO mock data):
 *  - Prices: getPrices() via Oracle VM SSE + REST
 *  - Quote:  getSwapQuote() → Oracle VM /api/quote
 *  - RFQ:    submitRfq() → Oracle VM /api/rfq (P2P network)
 *  - Execute: executeSwap() → Oracle VM /api/swap/execute
 *  - History: getSwaps() → Oracle VM /api/swaps
 *  - Balances: WalletContext (Solana), MultiChainWalletContext (ETH/BTC)
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDownUp, Wallet, Zap, ChevronDown, Info, CheckCircle2,
  Loader2, ExternalLink, Copy, RefreshCw, Shield, AlertTriangle,
  Activity
} from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@/contexts/WalletContext";
import { useMultiChainWallet } from "@/contexts/MultiChainWalletContext";
import ConnectWalletModal from "@/components/ConnectWalletModal";
import { trpc } from "@/lib/trpc";
import {
  getPrices, getSwapQuote, getSwaps,
  onSSEEvent, isSSEConnected,
  type SupportedChain, type SwapQuote, type RfqResult, type TokenPrice
} from "@/lib/afosApi";

// ─── Fee Config (matches admin panel) ────────────────────────────────────────
const AFOS_FEE_BPS = 30; // 0.3%

// ─── Supported Tokens ────────────────────────────────────────────────────────
interface TokenDef {
  symbol: string;
  name: string;
  chain: SupportedChain;
  chainLabel: string;
  icon: string;
  decimals: number;
}

const TOKENS: TokenDef[] = [
  { symbol: "USDT",  name: "Tether USD",    chain: "solana",   chainLabel: "Solana",   icon: "💵", decimals: 6  },
  { symbol: "USDC",  name: "USD Coin",      chain: "solana",   chainLabel: "Solana",   icon: "🔵", decimals: 6  },
  { symbol: "SOL",   name: "Solana",        chain: "solana",   chainLabel: "Solana",   icon: "◎",  decimals: 9  },
  { symbol: "BTC",   name: "Bitcoin",       chain: "bitcoin",  chainLabel: "Bitcoin",  icon: "₿",  decimals: 8  },
  { symbol: "ETH",   name: "Ethereum",      chain: "ethereum", chainLabel: "Ethereum", icon: "Ξ",  decimals: 18 },
  { symbol: "USDT",  name: "Tether USD",    chain: "ethereum", chainLabel: "Ethereum", icon: "💵", decimals: 6  },
  { symbol: "USDC",  name: "USD Coin",      chain: "ethereum", chainLabel: "Ethereum", icon: "🔵", decimals: 6  },
];

function tokenKey(t: { symbol: string; chain: SupportedChain }) {
  return `${t.symbol}:${t.chain}`;
}

type SwapStep = "idle" | "confirming" | "executing" | "done" | "error";

// ─── Token Selector ───────────────────────────────────────────────────────────
function TokenSelector({
  value, chain, onChange, exclude
}: {
  value: string;
  chain: SupportedChain;
  onChange: (symbol: string, chain: SupportedChain) => void;
  exclude?: string;
}) {
  const [open, setOpen] = useState(false);
  const token = TOKENS.find(t => t.symbol === value && t.chain === chain);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl font-semibold text-sm transition-all"
        style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
        <span className="text-base">{token?.icon}</span>
        <div className="text-left">
          <p className="text-foreground leading-none">{value}</p>
          <p className="text-[9px] text-muted-foreground leading-none mt-0.5">{token?.chainLabel}</p>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute top-full mt-1 left-0 z-20 rounded-xl overflow-hidden min-w-[180px]"
            style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 8px 32px rgba(0,0,0,0.3)" }}>
            {TOKENS.filter(t => !(t.symbol === exclude && t.chain === chain)).map(t => (
              <button key={tokenKey(t)}
                onClick={() => { onChange(t.symbol, t.chain); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors hover:bg-muted text-left"
                style={{ color: tokenKey(t) === tokenKey({ symbol: value, chain }) ? "#60a5fa" : "var(--foreground)" }}>
                <span className="text-base">{t.icon}</span>
                <div>
                  <p className="font-semibold leading-none">{t.symbol}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{t.chainLabel}</p>
                </div>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatAmount(amount: number, decimals: number): string {
  if (decimals >= 8) return amount.toFixed(8);
  if (decimals >= 6) return amount.toFixed(4);
  return amount.toFixed(4);
}

function chainExplorerUrl(txHash: string, chain: SupportedChain): string {
  if (chain === "solana") return `https://solscan.io/tx/${txHash}`;
  if (chain === "ethereum") return `https://etherscan.io/tx/${txHash}`;
  if (chain === "bitcoin") return `https://mempool.space/tx/${txHash}`;
  return "#";
}

// ─── Main SwapPage ────────────────────────────────────────────────────────────
export default function SwapPage() {
  // ── Wallet state ──────────────────────────────────────────────────────────
  const {
    connected: solAdapterConnected,
    shortAddress: solShortAddress,
    balances: solBalances,
    totalUsd: solTotalUsd,
  } = useWallet();

  const {
    ethereum: ethWallet,
    bitcoin: btcWallet,
    erc20Balances,
    phantomMultiChain,
  } = useMultiChainWallet();

  // Solana is connected if the standard adapter is connected OR Phantom multi-chain has a Solana address
  const phantomSolAddress = phantomMultiChain?.solanaAddress;
  const solConnected = solAdapterConnected || !!phantomSolAddress;
  // Use Phantom multi-chain address as short address when adapter is not connected
  const effectiveSolShortAddress = solAdapterConnected
    ? solShortAddress
    : phantomSolAddress
    ? `${phantomSolAddress.slice(0, 4)}…${phantomSolAddress.slice(-4)}`
    : null;

  const isConnected = solConnected || !!ethWallet?.address || !!btcWallet?.address;

  const totalPortfolioUsd = useMemo(() => {
    let total = solTotalUsd;
    if (ethWallet) total += ethWallet.balanceUsd;
    total += (erc20Balances.usdc + erc20Balances.usdt);
    if (btcWallet) total += btcWallet.balanceUsd;
    return total;
  }, [solTotalUsd, ethWallet, btcWallet, erc20Balances]);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [fromToken, setFromToken] = useState("USDT");
  const [fromChain, setFromChain] = useState<SupportedChain>("solana");
  const [toToken, setToToken] = useState("BTC");
  const [toChain, setToChain] = useState<SupportedChain>("bitcoin");
  const [fromAmount, setFromAmount] = useState("");
  const [bitcoinAddress, setBitcoinAddress] = useState("");
  const [swapStep, setSwapStep] = useState<SwapStep>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  // ── Live prices from Oracle VM ────────────────────────────────────────────
  const [prices, setPrices] = useState<Record<string, TokenPrice>>({});
  const [pricesLoading, setPricesLoading] = useState(true);

  useEffect(() => {
    getPrices()
      .then(p => { setPrices(p); setPricesLoading(false); })
      .catch(() => setPricesLoading(false));

    const unsub = onSSEEvent("prices", (data: unknown) => {
      const d = data as { prices?: Record<string, TokenPrice> };
      if (d?.prices) setPrices(d.prices);
    });
    return unsub;
  }, []);

  // ── Live quote from Oracle VM ─────────────────────────────────────────────
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const quoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fromAmountNum = parseFloat(fromAmount) || 0;

  const fetchQuote = useCallback(async () => {
    if (!fromAmount || fromAmountNum <= 0) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    setQuoteLoading(true);
    setQuoteError(null);
    try {
      const q = await getSwapQuote(fromToken, toToken, fromAmount, fromChain, toChain);
      setQuote(q);
    } catch (_) {
      // Fallback: derive rate from live prices
      const fromPrice = prices[fromToken]?.usd ?? 0;
      const toPrice = prices[toToken]?.usd ?? 0;
      if (fromPrice > 0 && toPrice > 0) {
        const rate = fromPrice / toPrice;
        const feeAmt = fromAmountNum * (AFOS_FEE_BPS / 10000);
        const outAmount = (fromAmountNum - feeAmt) * rate;
        setQuote({
          fromToken,
          fromChain,
          toToken,
          toChain,
          inAmount: fromAmountNum,
          outAmount,
          rate,
          priceImpact: 0,
          platformFeeBps: AFOS_FEE_BPS,
          feeAmount: feeAmt,
          feeUsd: feeAmt * fromPrice,
          route: "fallback (live prices)",
        });
        setQuoteError(null);
      } else {
        setQuoteError("Could not fetch quote — Oracle VM offline");
        setQuote(null);
      }
    } finally {
      setQuoteLoading(false);
    }
  }, [fromToken, toToken, fromAmount, fromAmountNum, fromChain, toChain, prices]);

  useEffect(() => {
    if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
    quoteTimerRef.current = setTimeout(fetchQuote, 500);
    return () => { if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current); };
  }, [fetchQuote]);

  // ── Max balance helper ────────────────────────────────────────────────────
  const maxBalance = useMemo(() => {
    if (fromChain === "solana") {
      const b = solBalances.find(b => b.symbol === fromToken);
      return b ? parseFloat(b.amount) : 0;
    }
    if (fromChain === "ethereum") {
      if (fromToken === "ETH") return ethWallet ? parseFloat(ethWallet.balance) : 0;
      if (fromToken === "USDC") return erc20Balances.usdc;
      if (fromToken === "USDT") return erc20Balances.usdt;
    }
    if (fromChain === "bitcoin") {
      return btcWallet ? parseFloat(btcWallet.balance) : 0;
    }
    return 0;
  }, [fromChain, fromToken, solBalances, ethWallet, btcWallet, erc20Balances]);

  // ── Swap execution ────────────────────────────────────────────────────────
  const needsBitcoinAddress = toChain === "bitcoin" && !btcWallet?.address;

  const canSwap = useMemo(() => {
    if (!isConnected) return false;
    if (!fromAmount || fromAmountNum <= 0) return false;
    if (needsBitcoinAddress && !bitcoinAddress.trim()) return false;
    if (quoteLoading || !!quoteError) return false;
    return true;
  }, [isConnected, fromAmount, fromAmountNum, needsBitcoinAddress, bitcoinAddress, quoteLoading, quoteError]);

  const loadSwapHistory = useCallback(async () => {
    if (!isConnected) return;
    setHistoryLoading(true);
    try {
      const { completed } = await getSwaps();
      setSwapHistory(completed.slice(0, 5));
    } catch (_) {
      // non-critical
    } finally {
      setHistoryLoading(false);
    }
  }, [isConnected]);

  // ── tRPC executeAgentSwap mutation (replaces broken Oracle VM direct call) ────────
  const executeAgentSwapMutation = trpc.chat.executeAgentSwap.useMutation();

  const handleSwap = async () => {
    if (!canSwap) return;
    setSwapStep("confirming");
    setErrorMsg(null);

    try {
      toast.info("Routing swap via AFOS agent…", { duration: 2000 });
      setSwapStep("executing");

      const result = await executeAgentSwapMutation.mutateAsync({
        fromToken,
        toToken,
        amount: fromAmountNum,
        fromChain,
        toChain,
      });

      if (!result.success) {
        throw new Error((result as { error?: string }).error ?? "Swap failed — agent returned an error");
      }

      const routeLabel = result.route ?? "DEX";
      toast.info(`Swap executed via ${routeLabel}`, { duration: 2000 });

      const hash = result.txHash ?? "pending";
      setTxHash(hash);
      setSwapStep("done");

      const toTokenDef = TOKENS.find(t => t.symbol === toToken && t.chain === toChain);
      const outAmt = result.outAmount
        ? formatAmount(Number(result.outAmount), toTokenDef?.decimals ?? 8)
        : quote
        ? formatAmount(quote.outAmount, toTokenDef?.decimals ?? 8)
        : "?";
      toast.success("Swap settled!", {
        description: `${fromAmount} ${fromToken} → ${outAmt} ${toToken}`,
      });

      loadSwapHistory();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Swap failed — please try again";
      setErrorMsg(msg);
      setSwapStep("error");
      toast.error("Swap failed", { description: msg });
    }
  };

  const handleReset = () => {
    setSwapStep("idle");
    setFromAmount("");
    setTxHash(null);
    setErrorMsg(null);
    setQuote(null);
  };

  const handleFlip = () => {
    setFromToken(toToken);
    setFromChain(toChain);
    setToToken(fromToken);
    setToChain(fromChain);
    setFromAmount("");
    setQuote(null);
  };

  // ── Swap history from Oracle VM ───────────────────────────────────────────
  const [swapHistory, setSwapHistory] = useState<RfqResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    loadSwapHistory();
  }, [loadSwapHistory]);

  useEffect(() => {
    const unsub = onSSEEvent("swap_executed", () => loadSwapHistory());
    return unsub;
  }, [loadSwapHistory]);

  // Auto-fill BTC address from connected wallet
  useEffect(() => {
    if (btcWallet?.address && toChain === "bitcoin") {
      setBitcoinAddress(btcWallet.address);
    }
  }, [btcWallet?.address, toChain]);

  // ── Derived values ────────────────────────────────────────────────────────
  const fromPrice = prices[fromToken]?.usd ?? 0;
  const fromAmountUsd = fromAmountNum * fromPrice;
  const feeAmount = quote?.feeAmount ?? (fromAmountNum * AFOS_FEE_BPS / 10000);
  const feeUsd = quote?.feeUsd ?? (feeAmount * fromPrice);
  const outAmount = quote?.outAmount ?? 0;
  const toTokenDef = TOKENS.find(t => t.symbol === toToken && t.chain === toChain);
  const fromTokenDef = TOKENS.find(t => t.symbol === fromToken && t.chain === fromChain);

  const [sseOk, setSseOk] = useState(isSSEConnected());
  useEffect(() => {
    const interval = setInterval(() => setSseOk(isSSEConnected()), 3000);
    return () => clearInterval(interval);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--background)" }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4"
        style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)" }}>
            <Zap className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground tracking-tight">AFOS Swap</p>
            <p className="text-[10px] text-muted-foreground">P2P · Non-custodial · 0.3% fee</p>
          </div>
          <div className="flex items-center gap-1 ml-1">
            <div className={`w-1.5 h-1.5 rounded-full ${sseOk ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
            <span className="text-[9px] text-muted-foreground">{sseOk ? "Live" : "Polling"}</span>
          </div>
        </div>

        {isConnected ? (
          <button
            onClick={() => setShowConnectModal(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
            style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", color: "#10b981" }}>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {solConnected
              ? effectiveSolShortAddress
              : ethWallet?.address
                ? ethWallet.address.slice(0, 6) + "…" + ethWallet.address.slice(-4)
                : btcWallet?.address?.slice(0, 8) + "…"}
            <ChevronDown className="w-3 h-3" />
          </button>
        ) : (
          <button
            onClick={() => setShowConnectModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all"
            style={{ background: "rgba(59,130,246,0.2)", border: "1px solid rgba(59,130,246,0.4)", color: "#60a5fa" }}>
            <Wallet className="w-3.5 h-3.5" />
            Connect Wallet
          </button>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-md space-y-3">

          {/* Portfolio summary */}
          <AnimatePresence>
            {isConnected && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="rounded-2xl px-4 py-3 flex items-center justify-between"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <div>
                    <p className="text-xs font-semibold text-foreground">
                      {[solConnected && "Solana", ethWallet?.address && "Ethereum", btcWallet?.address && "Bitcoin"]
                        .filter(Boolean).join(" · ") || "Wallet connected"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {solConnected
                        ? effectiveSolShortAddress
                        : ethWallet?.address
                          ? ethWallet.address.slice(0, 6) + "…" + ethWallet.address.slice(-4)
                          : btcWallet?.address?.slice(0, 8) + "…"}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-foreground">
                    ${totalPortfolioUsd > 0
                      ? totalPortfolioUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                      : "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Portfolio</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Swap card */}
          <div className="rounded-2xl overflow-hidden"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}>

            {/* Success state */}
            <AnimatePresence>
              {swapStep === "done" && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-6 text-center space-y-4">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
                    style={{ background: "rgba(16,185,129,0.15)", border: "2px solid rgba(16,185,129,0.4)" }}>
                    <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-lg font-bold text-foreground">Swap Complete!</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {fromAmount} {fromToken} → {outAmount > 0 ? formatAmount(outAmount, toTokenDef?.decimals ?? 8) : "?"} {toToken}
                    </p>
                  </div>
                  {txHash && (
                    <div className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl"
                      style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                      <p className="text-[10px] font-mono text-muted-foreground truncate max-w-[200px]">{txHash}</p>
                      <button onClick={() => { navigator.clipboard.writeText(txHash); toast.success("Copied"); }}>
                        <Copy className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                      </button>
                      <a href={chainExplorerUrl(txHash, toChain)} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                      </a>
                    </div>
                  )}
                  <button onClick={handleReset}
                    className="w-full py-3 rounded-xl text-sm font-bold transition-all"
                    style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)", color: "#60a5fa" }}>
                    New Swap
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Error state */}
            <AnimatePresence>
              {swapStep === "error" && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-6 text-center space-y-4">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
                    style={{ background: "rgba(239,68,68,0.12)", border: "2px solid rgba(239,68,68,0.3)" }}>
                    <AlertTriangle className="w-8 h-8 text-red-400" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-foreground">Swap Failed</p>
                    <p className="text-xs text-muted-foreground mt-1">{errorMsg}</p>
                  </div>
                  <button onClick={handleReset}
                    className="w-full py-3 rounded-xl text-sm font-bold transition-all"
                    style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)", color: "#60a5fa" }}>
                    Try Again
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Executing state */}
            <AnimatePresence>
              {swapStep === "executing" && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-6 text-center space-y-4">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
                    style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)" }}>
                    <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-foreground">Executing Swap</p>
                    <p className="text-xs text-muted-foreground mt-1">AFOS agent routing via P2P network…</p>
                  </div>
                  <div className="space-y-1.5">
                    {[
                      "Parse intent",
                      "Broadcast RFQ to P2P network",
                      "Peer negotiation",
                      "HTLC atomic escrow",
                      `Settle on ${toChain === "bitcoin" ? "Bitcoin" : toChain === "ethereum" ? "Ethereum" : "Solana"}`,
                    ].map((step) => (
                      <div key={step} className="flex items-center gap-2 px-3 py-2 rounded-lg"
                        style={{ background: "var(--muted)" }}>
                        <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" />
                        <p className="text-[11px] font-mono text-muted-foreground">{step}</p>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Idle / Confirming state */}
            {(swapStep === "idle" || swapStep === "confirming") && (
              <div className="p-4 space-y-3">
                {/* From */}
                <div className="rounded-xl p-4 space-y-2" style={{ background: "var(--muted)" }}>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">You pay</p>
                    {isConnected && maxBalance > 0 && (
                      <button
                        className="text-[10px] text-blue-400 font-semibold"
                        onClick={() => setFromAmount(maxBalance.toString())}>
                        Max: {formatAmount(maxBalance, fromTokenDef?.decimals ?? 6)}
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      value={fromAmount}
                      onChange={e => setFromAmount(e.target.value)}
                      placeholder="0.00"
                      min="0"
                      className="flex-1 bg-transparent text-2xl font-bold text-foreground outline-none placeholder:text-muted-foreground/40"
                    />
                    <TokenSelector
                      value={fromToken}
                      chain={fromChain}
                      onChange={(s, c) => { setFromToken(s); setFromChain(c); setQuote(null); }}
                      exclude={toToken}
                    />
                  </div>
                  {fromAmountNum > 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      {fromPrice > 0
                        ? `≈ $${fromAmountUsd.toFixed(2)} USD`
                        : pricesLoading
                          ? "Loading price…"
                          : "Price unavailable"}
                    </p>
                  )}
                </div>

                {/* Flip button */}
                <div className="flex justify-center">
                  <button onClick={handleFlip}
                    className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      transition: "transform 0.3s ease",
                    }}>
                    <ArrowDownUp className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>

                {/* To */}
                <div className="rounded-xl p-4 space-y-2" style={{ background: "var(--muted)" }}>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">You receive</p>
                    {quoteLoading && (
                      <div className="flex items-center gap-1">
                        <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
                        <span className="text-[10px] text-blue-400">Fetching quote…</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <p className="text-2xl font-bold text-foreground">
                        {quoteLoading
                          ? <span className="text-muted-foreground/40 text-lg">…</span>
                          : fromAmountNum > 0 && outAmount > 0
                            ? formatAmount(outAmount, toTokenDef?.decimals ?? 8)
                            : "0.00"}
                      </p>
                    </div>
                    <TokenSelector
                      value={toToken}
                      chain={toChain}
                      onChange={(s, c) => { setToToken(s); setToChain(c); setQuote(null); }}
                      exclude={fromToken}
                    />
                  </div>
                  {quote && fromAmountNum > 0 && (
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] text-muted-foreground">
                        Rate: 1 {fromToken} = {formatAmount(quote.rate, toTokenDef?.decimals ?? 8)} {toToken}
                      </p>
                      {quote.route && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                          style={{
                            background: quote.route.toLowerCase().includes("p2p")
                              ? "rgba(16,185,129,0.12)" : "rgba(59,130,246,0.12)",
                            color: quote.route.toLowerCase().includes("p2p") ? "#10b981" : "#60a5fa",
                          }}>
                          {quote.route.toLowerCase().includes("p2p") ? "P2P" : "DEX"}
                        </span>
                      )}
                    </div>
                  )}
                  {quoteError && (
                    <p className="text-[10px] text-amber-400">{quoteError}</p>
                  )}
                </div>

                {/* Bitcoin address (if receiving BTC and no BTC wallet connected) */}
                <AnimatePresence>
                  {needsBitcoinAddress && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden">
                      <div className="rounded-xl p-3 space-y-2"
                        style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>
                        <div className="flex items-center gap-1.5">
                          <Zap className="w-3.5 h-3.5 text-amber-400" />
                          <p className="text-[11px] font-semibold text-amber-400">Bitcoin Receive Address</p>
                        </div>
                        <input
                          value={bitcoinAddress}
                          onChange={e => setBitcoinAddress(e.target.value)}
                          placeholder="bc1q… or 1… or 3…"
                          className="w-full bg-transparent text-xs font-mono text-foreground outline-none placeholder:text-muted-foreground/50"
                        />
                        <p className="text-[10px] text-muted-foreground">
                          Connect MetaMask or Tap Wallet for auto-fill, or enter manually.
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Fee breakdown */}
                <AnimatePresence>
                  {fromAmountNum > 0 && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-1.5">
                      <button
                        onClick={() => setShowDetails(!showDetails)}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-[11px] transition-colors"
                        style={{ background: "var(--muted)" }}>
                        <div className="flex items-center gap-1.5">
                          <Info className="w-3 h-3 text-muted-foreground" />
                          <span className="text-muted-foreground">AFOS fee (0.3%)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-foreground">
                            {formatAmount(feeAmount, fromTokenDef?.decimals ?? 6)} {fromToken}
                          </span>
                          <span className="text-muted-foreground">(≈${feeUsd.toFixed(2)})</span>
                          <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform ${showDetails ? "rotate-180" : ""}`} />
                        </div>
                      </button>
                      <AnimatePresence>
                        {showDetails && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden">
                            <div className="px-3 py-2.5 rounded-xl space-y-1.5"
                              style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                              {([
                                ["Protocol fee", `${AFOS_FEE_BPS / 100}%`, "AFOS network fee"],
                                ["Network fee",
                                  fromChain === "bitcoin" ? "~$1–5" : fromChain === "ethereum" ? "~$0.50–2" : "~$0.01",
                                  `${fromChain.charAt(0).toUpperCase() + fromChain.slice(1)} transaction`],
                                ["Settlement", "Atomic HTLC", "Hash time-locked contract"],
                                ["Price impact",
                                  quote?.priceImpact != null ? `${(quote.priceImpact * 100).toFixed(2)}%` : "< 0.1%",
                                  "Market impact"],
                                ["Route", quote?.route ?? "P2P / DEX fallback", "Execution path"],
                              ] as [string, string, string][]).map(([label, value, desc]) => (
                                <div key={label} className="flex items-center justify-between">
                                  <div>
                                    <p className="text-[10px] font-semibold text-foreground">{label}</p>
                                    <p className="text-[9px] text-muted-foreground">{desc}</p>
                                  </div>
                                  <p className="text-[10px] font-mono text-foreground">{value}</p>
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* CTA */}
                {!isConnected ? (
                  <button
                    onClick={() => setShowConnectModal(true)}
                    className="w-full py-4 rounded-xl text-sm font-bold transition-all"
                    style={{ background: "rgba(59,130,246,0.2)", border: "1px solid rgba(59,130,246,0.4)", color: "#60a5fa" }}>
                    <div className="flex items-center justify-center gap-2">
                      <Wallet className="w-4 h-4" />
                      Connect Wallet to Swap
                    </div>
                  </button>
                ) : (
                  <button
                    onClick={handleSwap}
                    disabled={!canSwap || swapStep === "confirming"}
                    className="w-full py-4 rounded-xl text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: canSwap ? "rgba(16,185,129,0.2)" : "var(--muted)",
                      border: `1px solid ${canSwap ? "rgba(16,185,129,0.4)" : "var(--border)"}`,
                      color: canSwap ? "#10b981" : "var(--muted-foreground)",
                    }}>
                    {swapStep === "confirming" ? (
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Confirming…
                      </div>
                    ) : quoteLoading ? (
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Fetching quote…
                      </div>
                    ) : !fromAmount ? (
                      "Enter an amount"
                    ) : needsBitcoinAddress && !bitcoinAddress ? (
                      "Enter Bitcoin address"
                    ) : quoteError ? (
                      "Quote unavailable"
                    ) : (
                      <div className="flex items-center justify-center gap-2">
                        <Zap className="w-4 h-4" />
                        Swap {fromToken} → {toToken}
                      </div>
                    )}
                  </button>
                )}

                {/* Trust indicators */}
                <div className="flex items-center justify-center gap-4 pt-1">
                  {[
                    { icon: Shield, label: "Non-custodial" },
                    { icon: Zap, label: "Atomic HTLC" },
                    { icon: RefreshCw, label: "P2P routing" },
                  ].map(({ icon: Icon, label }) => (
                    <div key={label} className="flex items-center gap-1">
                      <Icon className="w-3 h-3 text-muted-foreground" />
                      <p className="text-[9px] text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Recent swaps — live from Oracle VM */}
          <AnimatePresence>
            {isConnected && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl p-4"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-foreground">Recent Network Swaps</p>
                  <div className="flex items-center gap-1.5">
                    <Activity className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground">Live</span>
                    {historyLoading && <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />}
                  </div>
                </div>
                {swapHistory.length === 0 && !historyLoading ? (
                  <p className="text-[11px] text-muted-foreground text-center py-2">
                    No completed swaps yet — be the first!
                  </p>
                ) : (
                  <div className="space-y-2">
                    {swapHistory.map((tx, i) => {
                      const timeAgo = tx.timestamp
                        ? (() => {
                            const diff = Date.now() - tx.timestamp;
                            if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
                            if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
                            return `${Math.floor(diff / 3600000)}h ago`;
                          })()
                        : "—";
                      return (
                        <div key={tx.rfqId ?? i} className="flex items-center justify-between py-1.5">
                          <div>
                            <p className="text-xs font-semibold text-foreground">
                              {tx.inAmount?.toFixed(4)} {tx.fromToken} → {tx.outAmount?.toFixed(4)} {tx.toToken}
                            </p>
                            <p className="text-[10px] text-muted-foreground">{timeAgo}</p>
                          </div>
                          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                            style={{
                              background: tx.route === "p2p" ? "rgba(16,185,129,0.12)" : "rgba(59,130,246,0.12)",
                              color: tx.route === "p2p" ? "#10b981" : "#60a5fa",
                            }}>
                            {tx.route === "p2p" ? "P2P" : "DEX"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <ConnectWalletModal open={showConnectModal} onClose={() => setShowConnectModal(false)} />
    </div>
  );
}
