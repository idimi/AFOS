/**
 * SwapPage — Consumer-facing swap interface
 * Design: Clean, trustless, non-custodial swap flow
 * Flow: Connect wallet → Select pair → Enter amount → Confirm → Execute
 * Fee: 0.3% AFOS protocol fee shown transparently on every swap
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDownUp, Wallet, Zap, ChevronDown, Info, CheckCircle2,
  Loader2, AlertTriangle, ExternalLink, Copy, RefreshCw, Shield
} from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@/contexts/WalletContext";
import ConnectWalletModal from "@/components/ConnectWalletModal";

// ─── Fee Config (matches admin panel) ────────────────────────────────────────
const AFOS_FEE_BPS = 30; // 0.3%

// ─── Supported Pairs ─────────────────────────────────────────────────────────
const TOKENS = [
  { symbol: "USDT", name: "Tether USD", chain: "Solana", icon: "💵", decimals: 6 },
  { symbol: "SOL", name: "Solana", chain: "Solana", icon: "◎", decimals: 9 },
  { symbol: "BTC", name: "Bitcoin", chain: "Lightning", icon: "₿", decimals: 8 },
  { symbol: "ETH", name: "Ethereum", chain: "Ethereum", icon: "Ξ", decimals: 18 },
];

const MOCK_RATES: Record<string, number> = {
  "USDT→BTC": 0.0000102,
  "BTC→USDT": 97800,
  "SOL→BTC": 0.00195,
  "BTC→SOL": 512.8,
  "USDT→SOL": 0.0052,
  "SOL→USDT": 192.4,
  "ETH→BTC": 0.0321,
  "BTC→ETH": 31.15,
  "USDT→ETH": 0.000312,
  "ETH→USDT": 3205,
};

type SwapStep = "idle" | "confirming" | "executing" | "done" | "error";

// ─── Token Selector ───────────────────────────────────────────────────────────
function TokenSelector({
  value, onChange, exclude
}: { value: string; onChange: (s: string) => void; exclude?: string }) {
  const [open, setOpen] = useState(false);
  const token = TOKENS.find(t => t.symbol === value);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl font-semibold text-sm transition-all"
        style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
        <span className="text-base">{token?.icon}</span>
        <span className="text-foreground">{value}</span>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute top-full mt-1 left-0 z-20 rounded-xl overflow-hidden min-w-[160px]"
            style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 8px 32px rgba(0,0,0,0.3)" }}>
            {TOKENS.filter(t => t.symbol !== exclude).map(t => (
              <button key={t.symbol}
                onClick={() => { onChange(t.symbol); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors hover:bg-muted text-left"
                style={{ color: t.symbol === value ? "#60a5fa" : "var(--foreground)" }}>
                <span className="text-base">{t.icon}</span>
                <div>
                  <p className="font-semibold leading-none">{t.symbol}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{t.chain}</p>
                </div>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main SwapPage ────────────────────────────────────────────────────────────
export default function SwapPage() {
  const { connectedWallets, primaryWallet, totalPortfolioUsd } = useWallet();
  const [showConnectModal, setShowConnectModal] = useState(false);

  const [fromToken, setFromToken] = useState("USDT");
  const [toToken, setToToken] = useState("BTC");
  const [fromAmount, setFromAmount] = useState("");
  const [lightningAddress, setLightningAddress] = useState("");
  const [swapStep, setSwapStep] = useState<SwapStep>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const rate = MOCK_RATES[`${fromToken}→${toToken}`] ?? 0;
  const fromAmountNum = parseFloat(fromAmount) || 0;
  const toAmountRaw = fromAmountNum * rate;
  const feeAmount = fromAmountNum * (AFOS_FEE_BPS / 10000);
  const feeUsd = fromToken === "USDT" ? feeAmount : feeAmount * (MOCK_RATES[`${fromToken}→USDT`] ?? 0);
  const toAmountAfterFee = toAmountRaw * (1 - AFOS_FEE_BPS / 10000);

  const needsLightningAddress = toToken === "BTC";
  const isConnected = connectedWallets.length > 0;

  const canSwap = useMemo(() => {
    if (!isConnected) return false;
    if (!fromAmount || fromAmountNum <= 0) return false;
    if (needsLightningAddress && !lightningAddress.trim()) return false;
    return true;
  }, [isConnected, fromAmount, fromAmountNum, needsLightningAddress, lightningAddress]);

  const handleFlip = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setFromAmount("");
  };

  const handleSwap = async () => {
    if (!canSwap) return;
    setSwapStep("confirming");
    await new Promise(r => setTimeout(r, 1200));
    setSwapStep("executing");

    // Simulate pipeline steps
    const steps = [
      "Parsing swap intent…",
      "Broadcasting RFQ to IntercomSwap channel…",
      "Peer negotiation — best quote selected…",
      "Locking HTLC escrow on Solana…",
      "Settling via Lightning Network…",
    ];
    for (const step of steps) {
      toast.info(step, { duration: 1800 });
      await new Promise(r => setTimeout(r, 1800));
    }

    const hash = `0x${Math.random().toString(16).slice(2, 10)}...${Math.random().toString(16).slice(2, 6)}`;
    setTxHash(hash);
    setSwapStep("done");
    toast.success("Swap settled!", { description: `${fromAmount} ${fromToken} → ${toAmountAfterFee.toFixed(8)} ${toToken}` });
  };

  const handleReset = () => {
    setSwapStep("idle");
    setFromAmount("");
    setTxHash(null);
  };

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
        </div>

        {/* Wallet button */}
        {isConnected ? (
          <button
            onClick={() => setShowConnectModal(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
            style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", color: "#10b981" }}>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {primaryWallet?.shortAddress}
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

          {/* Portfolio summary (if connected) */}
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
                      {connectedWallets.map(w => w.name).join(" + ")}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {connectedWallets.map(w => w.shortAddress).join(" · ")}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-foreground">${totalPortfolioUsd.toLocaleString()}</p>
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
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="p-6 text-center space-y-4">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
                    style={{ background: "rgba(16,185,129,0.15)", border: "2px solid rgba(16,185,129,0.4)" }}>
                    <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-lg font-bold text-foreground">Swap Complete!</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {fromAmount} {fromToken} → {toAmountAfterFee.toFixed(8)} {toToken}
                    </p>
                  </div>
                  {txHash && (
                    <div className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl"
                      style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                      <p className="text-[10px] font-mono text-muted-foreground">{txHash}</p>
                      <button onClick={() => { navigator.clipboard.writeText(txHash); toast.success("Copied"); }}>
                        <Copy className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                      </button>
                      <ExternalLink className="w-3 h-3 text-muted-foreground" />
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

            {/* Executing state */}
            <AnimatePresence>
              {swapStep === "executing" && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="p-6 text-center space-y-4">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
                    style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)" }}>
                    <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-foreground">Executing Swap</p>
                    <p className="text-xs text-muted-foreground mt-1">AFOS agent is routing your trade…</p>
                  </div>
                  <div className="space-y-1.5">
                    {["Parse intent", "Broadcast RFQ", "Peer negotiation", "HTLC escrow", "LN settlement"].map((step, i) => (
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
                    {isConnected && (
                      <button className="text-[10px] text-blue-400 font-semibold"
                        onClick={() => setFromAmount("1240.50")}>
                        Max
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      value={fromAmount}
                      onChange={e => setFromAmount(e.target.value)}
                      placeholder="0.00"
                      className="flex-1 bg-transparent text-2xl font-bold text-foreground outline-none placeholder:text-muted-foreground/40"
                    />
                    <TokenSelector value={fromToken} onChange={setFromToken} exclude={toToken} />
                  </div>
                  {fromAmountNum > 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      ≈ ${(fromAmountNum * (MOCK_RATES[`${fromToken}→USDT`] ?? (fromToken === "USDT" ? 1 : 0))).toFixed(2)} USD
                    </p>
                  )}
                </div>

                {/* Flip button */}
                <div className="flex justify-center">
                  <button onClick={handleFlip}
                    className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:rotate-180"
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
                  <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">You receive</p>
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <p className="text-2xl font-bold text-foreground">
                        {fromAmountNum > 0 ? toAmountAfterFee.toFixed(toToken === "BTC" ? 8 : 4) : "0.00"}
                      </p>
                    </div>
                    <TokenSelector value={toToken} onChange={setToToken} exclude={fromToken} />
                  </div>
                  {fromAmountNum > 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      Rate: 1 {fromToken} = {rate.toFixed(toToken === "BTC" ? 8 : 4)} {toToken}
                    </p>
                  )}
                </div>

                {/* Lightning address (if receiving BTC) */}
                <AnimatePresence>
                  {needsLightningAddress && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden">
                      <div className="rounded-xl p-3 space-y-2"
                        style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>
                        <div className="flex items-center gap-1.5">
                          <Zap className="w-3.5 h-3.5 text-amber-400" />
                          <p className="text-[11px] font-semibold text-amber-400">Lightning Receive Address</p>
                        </div>
                        <input
                          value={lightningAddress}
                          onChange={e => setLightningAddress(e.target.value)}
                          placeholder="user@wallet.io or lnbc..."
                          className="w-full bg-transparent text-xs font-mono text-foreground outline-none placeholder:text-muted-foreground/50"
                        />
                        <p className="text-[10px] text-muted-foreground">
                          Use any Lightning wallet: Strike, Wallet of Satoshi, Phoenix, etc.
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Fee breakdown */}
                <AnimatePresence>
                  {fromAmountNum > 0 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="space-y-1.5">
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
                            {feeAmount.toFixed(fromToken === "BTC" ? 8 : 4)} {fromToken}
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
                              {[
                                ["Protocol fee", `${AFOS_FEE_BPS / 100}%`, "AFOS network fee"],
                                ["Network fee", "~$0.01", "Solana transaction"],
                                ["Settlement", "~$0.00", "Lightning (free)"],
                                ["Slippage", "0.1%", "Max price impact"],
                              ].map(([label, value, desc]) => (
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
                    ) : !fromAmount ? (
                      "Enter an amount"
                    ) : needsLightningAddress && !lightningAddress ? (
                      "Enter Lightning address"
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
                    { icon: Zap, label: "Atomic swap" },
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

          {/* Recent activity (if connected) */}
          <AnimatePresence>
            {isConnected && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl p-4"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <p className="text-xs font-semibold text-foreground mb-3">Recent Swaps</p>
                <div className="space-y-2">
                  {[
                    { from: "50 USDT", to: "0.00051 BTC", time: "2m ago", status: "settled" },
                    { from: "0.5 SOL", to: "96.2 USDT", time: "1h ago", status: "settled" },
                    { from: "100 USDT", to: "0.00102 BTC", time: "3h ago", status: "settled" },
                  ].map((tx, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5">
                      <div>
                        <p className="text-xs font-semibold text-foreground">{tx.from} → {tx.to}</p>
                        <p className="text-[10px] text-muted-foreground">{tx.time}</p>
                      </div>
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(16,185,129,0.12)", color: "#10b981" }}>
                        {tx.status}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <ConnectWalletModal open={showConnectModal} onClose={() => setShowConnectModal(false)} />
    </div>
  );
}
