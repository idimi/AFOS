/**
 * AFOS Chat Page — Conversational Swap Agent
 * Users chat with the AI agent in natural language to execute swaps.
 * "swap 1 USDT to SOL" → agent parses → shows quote → user confirms → Phantom signs → on-chain
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Send, Wallet, ArrowLeftRight, CheckCircle2,
  Loader2, ExternalLink, AlertTriangle, Zap, RefreshCw,
  TrendingUp, X, ChevronDown, Sparkles, ShieldAlert, Settings,
  Clock, ArrowRight, Shield, Activity, Lock
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useWallet } from "@/contexts/WalletContext";
import { useMultiChainWallet } from "@/contexts/MultiChainWalletContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { useChat, type ChatMessage, type QuoteData, type SupportedChain } from "@/contexts/ChatContext";
import { useLightPeer } from "@/contexts/LightPeerContext";
import ConnectWalletModal from "../components/ConnectWalletModal";
import { Connection, VersionedTransaction } from "@solana/web3.js";
import { Link } from "wouter";
import { SUPPORTED_WALLETS_TEXT } from "@shared/const";

// ─── Types ────────────────────────────────────────────────────────────────────
// SupportedChain, QuoteData, and ChatMessage are imported from ChatContext

// ─── Suggestion chips ─────────────────────────────────────────────────────────
const SUGGESTIONS = [
  "swap 1 USDT to SOL",
  "swap 0.1 SOL to USDT",
  "what's the SOL price?",
  "swap 100 TNK to SOL",
  "what's the TNK price?",
  "show my balances",
  "swap 10 USDT to USDC",
];

// ─── Fallback token → chain (only used when quoteData.fromChain is missing) ──
const TOKEN_CHAIN_FALLBACK: Record<string, SupportedChain> = {
  SOL: "solana",
  BTC: "bitcoin",
  ETH: "ethereum",
  TNK: "trac_network",
  // USDT/USDC intentionally omitted — ambiguous without chain context, defaults to "solana"
};

// ─── Token colors ─────────────────────────────────────────────────────────────
const TOKEN_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  SOL: { bg: "rgba(153,69,255,0.15)", text: "#9945FF", border: "rgba(153,69,255,0.3)" },
  USDT: { bg: "rgba(38,161,123,0.15)", text: "#26a17b", border: "rgba(38,161,123,0.3)" },
  USDC: { bg: "rgba(39,117,202,0.15)", text: "#2775CA", border: "rgba(39,117,202,0.3)" },
  BTC: { bg: "rgba(247,147,26,0.15)", text: "#F7931A", border: "rgba(247,147,26,0.3)" },
  ETH: { bg: "rgba(98,126,234,0.15)", text: "#627EEA", border: "rgba(98,126,234,0.3)" },
  TNK: { bg: "rgba(245,158,11,0.15)",  text: "#f59e0b", border: "rgba(245,158,11,0.3)" },
};

function TokenBadge({ symbol }: { symbol: string }) {
  const c = TOKEN_COLORS[symbol] || { bg: "rgba(100,100,100,0.15)", text: "#aaa", border: "rgba(100,100,100,0.3)" };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
      {symbol}
    </span>
  );
}

// ─── Route Badge ────────────────────────────────────────────────────────────
// Shows which execution route was selected: AFOS P2P, Jupiter, 0x, 1inch, or Direct HTLC
const ROUTE_STYLES: Record<string, { bg: string; text: string; border: string; dot: string; label: string }> = {
  p2p: {
    bg:     "rgba(20,241,149,0.12)",
    text:   "#14F195",
    border: "rgba(20,241,149,0.3)",
    dot:    "#14F195",
    label:  "AFOS P2P",
  },
  jupiter: {
    bg:     "rgba(153,69,255,0.12)",
    text:   "#9945FF",
    border: "rgba(153,69,255,0.3)",
    dot:    "#9945FF",
    label:  "Jupiter DEX",
  },
  zerox: {
    bg:     "rgba(99,102,241,0.12)",
    text:   "#6366f1",
    border: "rgba(99,102,241,0.3)",
    dot:    "#6366f1",
    label:  "0x Protocol",
  },
  oneinch: {
    bg:     "rgba(98,126,234,0.12)",
    text:   "#627EEA",
    border: "rgba(98,126,234,0.3)",
    dot:    "#627EEA",
    label:  "1inch",
  },
  htlc: {
    bg:     "rgba(247,147,26,0.12)",
    text:   "#F7931A",
    border: "rgba(247,147,26,0.3)",
    dot:    "#F7931A",
    label:  "Direct HTLC",
  },
  default: {
    bg:     "rgba(100,100,100,0.12)",
    text:   "#aaa",
    border: "rgba(100,100,100,0.3)",
    dot:    "#aaa",
    label:  "Aggregator",
  },
};

function getRouteStyle(route: string) {
  const r = route.toLowerCase();
  if (r.includes("p2p") || r.includes("intercomswap")) return ROUTE_STYLES.p2p;
  if (r.includes("jupiter"))  return ROUTE_STYLES.jupiter;
  if (r.includes("0x") || r.includes("zerox")) return ROUTE_STYLES.zerox;
  if (r.includes("1inch"))    return ROUTE_STYLES.oneinch;
  if (r.includes("htlc"))     return ROUTE_STYLES.htlc;
  return ROUTE_STYLES.default;
}

function RouteBadge({ route }: { route: string }) {
  const s = getRouteStyle(route);
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}` }}
      title={route}
    >
      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: s.dot }} />
      {s.label}
    </span>
  );
}

// ─── Chain Pill ───────────────────────────────────────────────────────────────
// Shows source → destination chain for cross-chain swaps
const CHAIN_PILL_STYLES: Record<string, { color: string; label: string }> = {
  solana:       { color: "#9945FF", label: "SOL" },
  ethereum:     { color: "#627EEA", label: "ETH" },
  bitcoin:      { color: "#F7931A", label: "BTC" },
  trac_network: { color: "#F97316", label: "TNK" },
};

function ChainPill({ fromChain, toChain }: { fromChain?: string; toChain?: string }) {
  if (!fromChain || !toChain || fromChain === toChain) return null;
  const from = CHAIN_PILL_STYLES[fromChain] ?? { color: "#aaa", label: fromChain.toUpperCase() };
  const to   = CHAIN_PILL_STYLES[toChain]   ?? { color: "#aaa", label: toChain.toUpperCase() };
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#ccc" }}>
      <span style={{ color: from.color }}>{from.label}</span>
      <span className="opacity-50">→</span>
      <span style={{ color: to.color }}>{to.label}</span>
    </span>
  );
}

// // ─── Quote Card ──────────────────────────────────────────────────────────
function QuoteCard({
  data,
  onConfirm,
  onCancel,
  isExecuting,
  onRequestConnect,
  limitWarning,
  tnkPeerCount,
  walletConnected,
  bitcoinTap,
  preferredBtcWallet,
  setPreferredBtcWallet,
}: {
  data: QuoteData;
  onConfirm: () => void;
  onCancel: () => void;
  isExecuting: boolean;
  onRequestConnect: () => void;
  limitWarning?: string;
  tnkPeerCount?: number;
  /** Pass true when ANY wallet (SOL, ETH, BTC, TNK) is connected — overrides Solana-only hook */
  walletConnected?: boolean;
  /** Tap Wallet BTC state — non-null when Tap Wallet BTC is connected */
  bitcoinTap?: import("@/contexts/MultiChainWalletContext").ChainWallet | null;
  /** Which BTC wallet is preferred when multiple are connected */
  preferredBtcWallet?: import("@/contexts/MultiChainWalletContext").BtcProviderType | null;
  /** Callback to set the preferred BTC wallet */
  setPreferredBtcWallet?: (p: import("@/contexts/MultiChainWalletContext").BtcProviderType | null) => void;
}) {
  const { connected: solConnected } = useWallet();
  const { bitcoin: activeBitcoin } = useMultiChainWallet();
  // Use the multi-chain walletConnected prop when provided; fall back to Solana adapter
  const connected = walletConnected ?? solConnected;

  // Per-quote BTC wallet override — starts from the global preference, stays local to this card
  const [localBtcWallet, setLocalBtcWallet] = useState<import("@/contexts/MultiChainWalletContext").BtcProviderType | null>(
    preferredBtcWallet ?? null
  );

  // Show BTC wallet picker when both Phantom/MetaMask BTC and Tap Wallet BTC are connected
  const isBtcSwap = data.fromChain === "bitcoin" || data.toChain === "bitcoin" ||
    data.fromChain === "trac_network" || data.toChain === "trac_network";
  const hasPhantomMetaMaskBtc = activeBitcoin?.connected && activeBitcoin.walletName !== "Tap Wallet";
  const hasTapBtc = bitcoinTap?.connected;
  const showBtcPicker = isBtcSwap && hasPhantomMetaMaskBtc && hasTapBtc;

  // Helper to update both local and global preference
  const handleSetBtcWallet = (p: import("@/contexts/MultiChainWalletContext").BtcProviderType | null) => {
    setLocalBtcWallet(p);
    setPreferredBtcWallet?.(p);
  };

  // ── "Signing with" wallet label for the confirm button ──────────────────────
  // Derive which wallet + address will sign the swap so users know before confirming
  const { ethereum: activeEthereum, tracNetwork: activeTnk, phantomMultiChain } = useMultiChainWallet();
  const { shortAddress: solShortAddress } = useWallet();

  /** Derive wallet info for a given chain */
  const deriveWalletForChain = (chain: SupportedChain | undefined): { name: string; address: string } | null => {
    const c = chain ?? "solana";
    if (c === "bitcoin") {
      if (localBtcWallet === "tap" && bitcoinTap?.connected)
        return { name: "Tap Wallet", address: bitcoinTap.shortAddress };
      if (activeBitcoin?.connected)
        return { name: activeBitcoin.walletName, address: activeBitcoin.shortAddress };
      return null;
    }
    if (c === "trac_network") {
      if (activeTnk?.connected)
        return { name: activeTnk.walletName, address: activeTnk.shortAddress };
      // Fall back to Tap Wallet BTC address as proxy
      if (bitcoinTap?.connected)
        return { name: "Tap Wallet", address: bitcoinTap.shortAddress };
      return null;
    }
    if (c === "ethereum") {
      if (activeEthereum?.connected)
        return { name: activeEthereum.walletName, address: activeEthereum.shortAddress };
      return null;
    }
    // Solana
    const solAddr = phantomMultiChain?.solanaAddress
      ? `${phantomMultiChain.solanaAddress.slice(0, 4)}\u2026${phantomMultiChain.solanaAddress.slice(-4)}`
      : solShortAddress;
    const solName = phantomMultiChain?.solanaAddress ? "Phantom" : "Solana Wallet";
    if (solAddr) return { name: solName, address: solAddr };
    return null;
  };

  const signingWallet = deriveWalletForChain(data.fromChain);

  // Destination wallet — only shown for cross-chain swaps where fromChain ≠ toChain
  const isCrossChain = data.fromChain && data.toChain && data.fromChain !== data.toChain;
  const destinationWallet = isCrossChain ? deriveWalletForChain(data.toChain) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="rounded-2xl overflow-hidden mt-2"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2 flex-wrap"
        style={{ borderBottom: "1px solid var(--border)", background: "rgba(6,182,212,0.05)" }}>
        <Zap className="w-4 h-4 text-cyan-400" />
        <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">Swap Quote</span>
        <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
          {/* TNK peer count badge — shown when swap involves TNK */}
          {(data.fromToken === "TNK" || data.toToken === "TNK") && tnkPeerCount !== undefined && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
              style={{
                background: tnkPeerCount > 0 ? "rgba(249,115,22,0.15)" : "rgba(100,116,139,0.15)",
                color: tnkPeerCount > 0 ? "#f97316" : "#94a3b8",
                border: `1px solid ${tnkPeerCount > 0 ? "rgba(249,115,22,0.35)" : "rgba(100,116,139,0.25)"}`,
              }}
              title={tnkPeerCount > 0 ? `${tnkPeerCount} active TNK P2P peer${tnkPeerCount !== 1 ? "s" : ""} on the network` : "No TNK P2P peers online — will route via Oracle VM DEX"}
            >
              <span style={{ fontSize: "9px" }}>⬡</span>
              {tnkPeerCount > 0 ? `${tnkPeerCount} TNK peer${tnkPeerCount !== 1 ? "s" : ""}` : "No TNK peers"}
            </span>
          )}
          <ChainPill fromChain={data.fromChain} toChain={data.toChain} />
          <RouteBadge route={data.route} />
        </div>
      </div>

      {/* Swap summary */}
      <div className="px-4 py-4 space-y-3">
        {/* From → To */}
        <div className="flex items-center gap-3">
          <div className="flex-1 rounded-xl p-3 text-center"
            style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
            <p className="text-[10px] text-muted-foreground mb-1">You pay</p>
            <p className="text-xl font-bold text-foreground font-mono">{data.fromAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}</p>
            <div className="flex justify-center mt-1"><TokenBadge symbol={data.fromToken} /></div>
            <p className="text-[10px] text-muted-foreground mt-1">${data.fromAmountUsd.toFixed(2)}</p>
          </div>

          <div className="flex flex-col items-center gap-1">
            <ArrowLeftRight className="w-4 h-4 text-muted-foreground" />
          </div>

          <div className="flex-1 rounded-xl p-3 text-center"
            style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)" }}>
            <p className="text-[10px] text-muted-foreground mb-1">You receive</p>
            <p className="text-xl font-bold text-emerald-400 font-mono">{(data.netToAmount ?? data.toAmount).toLocaleString(undefined, { maximumFractionDigits: 6 })}</p>
            <div className="flex justify-center mt-1"><TokenBadge symbol={data.toToken} /></div>
            <p className="text-[10px] text-muted-foreground mt-1">${data.toAmountUsd.toFixed(2)}</p>
          </div>
        </div>

        {/* Details */}
        <div className="space-y-1.5 text-xs">
          {[
            { label: "Rate", value: `1 ${data.fromToken} = ${data.rate.toFixed(6)} ${data.toToken}` },
            { label: "Price Impact", value: `${data.priceImpact.toFixed(3)}%`, warn: data.priceImpact > 1 },
          ].map(row => (
            <div key={row.label} className="flex items-center justify-between">
              <span className="text-muted-foreground">{row.label}</span>
              <span className={row.warn ? "text-amber-400" : "text-foreground font-mono"}>{row.value}</span>
            </div>
          ))}
          {/* Fee breakdown row */}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              AFOS Fee ({data.feeBps != null ? `${(data.feeBps / 100).toFixed(2)}%` : "0.20%"})
              {data.feeBps === 15 && (
                <span className="ml-1 text-[9px] px-1 py-0.5 rounded" style={{ background: "rgba(20,241,149,0.15)", color: "#14F195" }}>P2P</span>
              )}
              {data.feeBps === 20 && (
                <span className="ml-1 text-[9px] px-1 py-0.5 rounded" style={{ background: "rgba(153,69,255,0.15)", color: "#9945FF" }}>DEX</span>
              )}
            </span>
            <span className="text-foreground font-mono">
              {data.platformFeeOut != null
                ? `${data.platformFeeOut.toFixed(6)} ${data.feeToken ?? data.toToken}`
                : `${data.platformFee.toFixed(6)} ${data.fromToken}`}
              {" "}(${data.platformFeeUsd.toFixed(4)})
            </span>
          </div>
        </div>

        {/* Warning for high price impact */}
        {data.priceImpact > 1 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
            style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)" }}>
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-amber-300">High price impact. Consider splitting into smaller swaps.</span>
          </div>
        )}

        {/* Near-limit warning banner */}
        {limitWarning && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-xl text-xs"
            style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)" }}>
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="text-amber-300">{limitWarning}</span>
              <Link href="/settings" className="ml-2 text-amber-400 underline hover:text-amber-300 transition-colors">Adjust limit</Link>
            </div>
          </div>
        )}
      </div>

      {/* BTC wallet picker — shown when both Phantom/MetaMask BTC and Tap Wallet BTC are connected */}
      {showBtcPicker && (
        <div className="px-4 pb-3">
          <div className="rounded-xl p-3 space-y-2"
            style={{ background: "rgba(247,147,26,0.08)", border: "1px solid rgba(247,147,26,0.25)" }}>
            <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">
              Which Bitcoin wallet to use?
            </p>
            <div className="flex gap-2">
              {/* Phantom / MetaMask BTC option */}
              <button
                onClick={() => handleSetBtcWallet(activeBitcoin?.walletName === "Phantom" ? "phantom" : "metamask")}
                className="flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all flex items-center gap-2"
                style={{
                  background: (!localBtcWallet || localBtcWallet !== "tap")
                    ? "rgba(247,147,26,0.2)" : "var(--muted)",
                  border: (!localBtcWallet || localBtcWallet !== "tap")
                    ? "1px solid rgba(247,147,26,0.5)" : "1px solid var(--border)",
                  color: (!localBtcWallet || localBtcWallet !== "tap") ? "#f97316" : "var(--muted-foreground)",
                }}
              >
                <span className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: (!localBtcWallet || localBtcWallet !== "tap") ? "#f97316" : "var(--muted-foreground)" }}
                />
                {activeBitcoin?.walletName ?? "Phantom/MetaMask"}
                <span className="ml-auto text-[9px] opacity-70">{activeBitcoin?.shortAddress}</span>
              </button>
              {/* Tap Wallet BTC option */}
              <button
                onClick={() => handleSetBtcWallet("tap")}
                className="flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all flex items-center gap-2"
                style={{
                  background: localBtcWallet === "tap" ? "rgba(247,147,26,0.2)" : "var(--muted)",
                  border: localBtcWallet === "tap" ? "1px solid rgba(247,147,26,0.5)" : "1px solid var(--border)",
                  color: localBtcWallet === "tap" ? "#f97316" : "var(--muted-foreground)",
                }}
              >
                <span className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: localBtcWallet === "tap" ? "#f97316" : "var(--muted-foreground)" }}
                />
                Tap Wallet
                <span className="ml-auto text-[9px] opacity-70">{bitcoinTap?.shortAddress}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="px-4 pb-4 flex gap-2">
        <button
          onClick={onCancel}
          disabled={isExecuting}
          className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all text-muted-foreground hover:text-foreground"
          style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
          Cancel
        </button>
        {connected ? (
          <div className="flex-1 flex flex-col gap-1">
            <button
              onClick={onConfirm}
              disabled={isExecuting}
              className="w-full py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
              style={{
                background: isExecuting ? "rgba(16,185,129,0.1)" : "linear-gradient(135deg, #9945FF, #14F195)",
                color: isExecuting ? "#10b981" : "white",
                border: isExecuting ? "1px solid rgba(16,185,129,0.3)" : "none",
              }}>
              {isExecuting ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Signing…</>
              ) : (
                <><CheckCircle2 className="w-3.5 h-3.5" /> Confirm Swap</>
              )}
            </button>
            {/* Signing wallet hint — shown when a wallet is identified */}
            {signingWallet && !isExecuting && (
              <p className="text-center text-[10px] text-muted-foreground truncate">
                Sending from <span className="font-semibold text-foreground">{signingWallet.name}</span>
                {" "}<span className="font-mono opacity-70">{signingWallet.address}</span>
              </p>
            )}
            {/* Destination wallet hint — shown for cross-chain swaps */}
            {destinationWallet && !isExecuting && (
              <p className="text-center text-[10px] text-muted-foreground truncate">
                Receiving to <span className="font-semibold text-foreground">{destinationWallet.name}</span>
                {" "}<span className="font-mono opacity-70">{destinationWallet.address}</span>
              </p>
            )}
            {isExecuting && signingWallet && (
              <p className="text-center text-[10px] text-emerald-400 truncate flex items-center justify-center gap-0.5 flex-wrap">
                <span>Awaiting signature from</span>
                <span className="font-semibold">{signingWallet.name}</span>
                {destinationWallet && (
                  <motion.span
                    key={destinationWallet.address}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3, duration: 0.35, ease: "easeOut" }}
                    className="inline-flex items-center gap-0.5"
                  >
                    <motion.span
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                      className="mx-0.5"
                    >→</motion.span>
                    <span className="font-semibold">{destinationWallet.name}</span>
                    <span className="font-mono opacity-70 ml-0.5">{destinationWallet.address}</span>
                  </motion.span>
                )}
                <span>…</span>
              </p>
            )}
          </div>
        ) : (
          <button
            onClick={onRequestConnect}
            className="flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
            style={{ background: "rgba(153,69,255,0.2)", border: "1px solid rgba(153,69,255,0.4)", color: "#9945FF" }}>
            <Wallet className="w-3.5 h-3.5" />
            Connect Wallet to Swap
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── Limit Exceeded Card ────────────────────────────────────────────────────
function LimitExceededCard({ blockedAmountUsd, limitUsd }: { blockedAmountUsd: number; limitUsd: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="rounded-2xl p-4 mt-2"
      style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}
    >
      <div className="flex items-center gap-2 mb-2">
        <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
        <span className="text-sm font-bold text-red-400">Transaction Limit Exceeded</span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        This swap (~<strong className="text-foreground">${blockedAmountUsd.toFixed(2)}</strong>) exceeds your
        configured maximum of <strong className="text-foreground">${limitUsd}</strong>.
        Reduce the amount or raise your limit in Settings.
      </p>
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors"
      >
        <Settings className="w-3.5 h-3.5" />
        Open Settings
      </Link>
    </motion.div>
  );
}

// ─── Tx Success Card ──────────────────────────────────────────────────────────
// Celebratory messages — randomly selected on each swap completion
const SWAP_CELEBRATION_MESSAGES = [
  (from: string, fromAmt: number, to: string, toAmt: number) =>
    `🎉 Nailed it! ${fromAmt.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${from} just became ${toAmt.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${to}. Atomic, trustless, done.`,
  (from: string, fromAmt: number, to: string, toAmt: number) =>
    `⚡ Swap complete! ${fromAmt.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${from} → ${toAmt.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${to} — settled on-chain in seconds. No bridges, no custodians.`,
  (from: string, fromAmt: number, to: string, toAmt: number) =>
    `🚀 Done! Your ${fromAmt.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${from} is now ${toAmt.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${to}, sitting in your wallet. Ready for the next one?`,
  (from: string, fromAmt: number, to: string, toAmt: number) =>
    `✅ Swap confirmed on-chain! ${fromAmt.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${from} exchanged for ${toAmt.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${to}. Your balances are updated below.`,
  (from: string, fromAmt: number, to: string, toAmt: number) =>
    `💸 That's a wrap! ${fromAmt.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${from} out, ${toAmt.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${to} in. Fully on-chain, fully yours.`,
];

function getExplorerInfo(txHash: string, chain: string) {
  if (chain === "bitcoin") {
    const isTxid = /^[0-9a-f]{64}$/i.test(txHash);
    return {
      explorerUrl: isTxid ? `https://mempool.space/tx/${txHash}` : `https://mempool.space`,
      explorerLabel: isTxid ? `mempool.space: ${txHash.slice(0, 8)}…${txHash.slice(-8)}` : "View on mempool.space",
    };
  }
  if (chain === "ethereum") {
    const isTxHash = /^0x[0-9a-f]{64}$/i.test(txHash);
    return {
      explorerUrl: isTxHash ? `https://etherscan.io/tx/${txHash}` : `https://etherscan.io`,
      explorerLabel: isTxHash ? `Etherscan: ${txHash.slice(0, 10)}…${txHash.slice(-8)}` : "View on Etherscan",
    };
  }
  return {
    explorerUrl: `https://solscan.io/tx/${txHash}`,
    explorerLabel: `Solscan: ${txHash.slice(0, 8)}…${txHash.slice(-8)}`,
  };
}

function TxSuccessCard({ txHash, fromToken, toToken, fromAmount, toAmount, fromChain, balancesAfterSwap, signedBy, onSwapAgain }: {
  txHash: string;
  fromToken: string;
  toToken: string;
  fromAmount: number;
  toAmount: number;
  fromChain?: string;
  balancesAfterSwap?: Array<{ symbol: string; amount: string; usdValue: number }>;
  /** Wallet that signed the swap — shown for audit trail */
  signedBy?: { name: string; address: string };
  onSwapAgain?: () => void;
}) {
  const chain = fromChain?.toLowerCase() ?? (fromToken === "BTC" ? "bitcoin" : fromToken === "ETH" ? "ethereum" : "solana");
  const { explorerUrl, explorerLabel } = getExplorerInfo(txHash, chain);

  // Pick a celebration message deterministically from the txHash so it stays stable on re-render
  const msgIdx = txHash.charCodeAt(0) % SWAP_CELEBRATION_MESSAGES.length;
  const celebrationMsg = SWAP_CELEBRATION_MESSAGES[msgIdx](fromToken, fromAmount, toToken, toAmount);

  // Only show balances for the two tokens involved in the swap
  const relevantBalances = balancesAfterSwap?.filter(
    b => b.symbol === fromToken || b.symbol === toToken
  ) ?? [];

  const fromColor = TOKEN_COLORS[fromToken] ?? { bg: "rgba(100,100,100,0.15)", text: "#aaa", border: "rgba(100,100,100,0.3)" };
  const toColor   = TOKEN_COLORS[toToken]   ?? { bg: "rgba(100,100,100,0.15)", text: "#aaa", border: "rgba(100,100,100,0.3)" };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="rounded-2xl overflow-hidden mt-2"
      style={{ border: "1px solid rgba(16,185,129,0.3)" }}
    >
      {/* Header band */}
      <div className="flex items-center gap-2.5 px-4 py-3"
        style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.18) 0%, rgba(16,185,129,0.06) 100%)" }}
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.15, type: "spring", stiffness: 400, damping: 15 }}
        >
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
        </motion.div>
        <span className="text-sm font-bold text-emerald-400">Swap Confirmed!</span>
        <motion.span
          initial={{ opacity: 0, x: 6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.25 }}
          className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full"
          style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}
        >
          ON-CHAIN
        </motion.span>
      </div>

      {/* Swap summary row */}
      <div className="px-4 py-3" style={{ background: "rgba(16,185,129,0.04)" }}>
        <div className="flex items-center gap-2 justify-center">
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-lg font-bold" style={{ color: fromColor.text }}>
              {fromAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
            </span>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ background: fromColor.bg, color: fromColor.text, border: `1px solid ${fromColor.border}` }}>
              {fromToken}
            </span>
          </div>
          <motion.div
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, type: "spring" }}
            className="flex items-center justify-center w-8 h-8 rounded-full shrink-0"
            style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)" }}
          >
            <ArrowRight className="w-4 h-4 text-emerald-400" />
          </motion.div>
          <div className="flex flex-col items-center gap-0.5">
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3, type: "spring", stiffness: 300 }}
              className="text-lg font-bold"
              style={{ color: toColor.text }}
            >
              {toAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
            </motion.span>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ background: toColor.bg, color: toColor.text, border: `1px solid ${toColor.border}` }}>
              {toToken}
            </span>
          </div>
        </div>
      </div>

      {/* Updated balances */}
      {relevantBalances.length > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          transition={{ delay: 0.4 }}
          className="px-4 py-2.5 border-t"
          style={{ borderColor: "rgba(16,185,129,0.15)", background: "rgba(0,0,0,0.15)" }}
        >
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Updated Balances</p>
          <div className="flex gap-3 flex-wrap">
            {relevantBalances.map(b => {
              const c = TOKEN_COLORS[b.symbol] ?? { bg: "rgba(100,100,100,0.1)", text: "#aaa", border: "rgba(100,100,100,0.2)" };
              return (
                <div key={b.symbol} className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: c.bg, color: c.text }}>
                    {b.symbol}
                  </span>
                  <span className="text-xs font-semibold text-foreground">
                    {parseFloat(b.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                  </span>
                  {b.usdValue > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      (${b.usdValue.toLocaleString(undefined, { maximumFractionDigits: 2 })})
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Footer: explorer link + signed-by + swap again */}
      <div className="px-4 py-2.5 flex flex-col gap-1.5 border-t"
        style={{ borderColor: "rgba(16,185,129,0.15)", background: "rgba(0,0,0,0.1)" }}
      >
        <div className="flex items-center justify-between">
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            {explorerLabel}
          </a>
          {onSwapAgain && (
            <button
              onClick={onSwapAgain}
              className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-all hover:opacity-80"
              style={{ background: "rgba(16,185,129,0.15)", color: "#10b981", border: "1px solid rgba(16,185,129,0.3)" }}
            >
              <ArrowLeftRight className="w-3 h-3" />
              Swap again
            </button>
          )}
        </div>
        {/* Signed-by audit trail — shown when the signing wallet is known */}
        {signedBy && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-[10px] text-muted-foreground"
          >
            Signed by{" "}
            <span className="font-semibold text-foreground">{signedBy.name}</span>
            {" "}
            <span className="font-mono opacity-70">{signedBy.address}</span>
          </motion.p>
        )}
      </div>

      {/* Celebration message from agent */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="px-4 py-3 border-t"
        style={{ borderColor: "rgba(16,185,129,0.15)", background: "rgba(16,185,129,0.03)" }}
      >
        <p className="text-xs text-muted-foreground leading-relaxed">{celebrationMsg}</p>
      </motion.div>
    </motion.div>
  );
}

// // ─── Swap Progress Card (shown in chat when P2P swap is in progress) ──────────────
const SWAP_PHASES = [
  { key: "broadcasting", label: "Broadcasting RFQ",  desc: "Sending request-for-quote to P2P network",  icon: "broadcast" },
  { key: "negotiating",  label: "Peer Negotiation",   desc: "Peer accepted — confirming terms",           icon: "negotiate" },
  { key: "locking",      label: "HTLC Lock",          desc: "Locking funds in atomic escrow",            icon: "lock" },
  { key: "settling",     label: "Atomic Settlement",  desc: "Releasing secret — claiming funds",         icon: "settle" },
  { key: "confirmed",    label: "Confirmed",           desc: "Swap complete — funds in your wallet",     icon: "done" },
] as const;

type SwapPhase = "broadcasting" | "negotiating" | "locking" | "settling" | "confirmed" | "failed" | "expired";

const CHAIN_COLORS: Record<string, string> = {
  solana:       "#9945FF",
  ethereum:     "#627EEA",
  bitcoin:      "#F7931A",
  trac_network: "#F97316",
};

const CHAIN_LABELS: Record<string, string> = {
  solana:       "SOL",
  ethereum:     "ETH",
  bitcoin:      "BTC",
  trac_network: "TNK",
};

function getExplorerUrl(chain: string | undefined, txHash: string): string {
  switch ((chain ?? "solana").toLowerCase()) {
    case "ethereum":     return `https://etherscan.io/tx/${txHash}`;
    case "bitcoin":      return `https://mempool.space/tx/${txHash}`;
    case "trac_network": return `https://explorer.trac.network/tx/${txHash}`;
    default:             return `https://solscan.io/tx/${txHash}`;
  }
}

function SwapProgressCard({ data }: { data: NonNullable<ChatMessage["swapProgressData"]> }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (data.phase === "confirmed" || data.phase === "failed" || data.phase === "expired") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [data.phase]);

  const currentIdx = SWAP_PHASES.findIndex(p => p.key === data.phase);
  const isDone = data.phase === "confirmed";
  const isFailed = data.phase === "failed" || data.phase === "expired";
  const isExpired = data.phase === "expired";

  // Elapsed time since swap started
  const elapsedLabel = (() => {
    if (!data.startedAt) return null;
    const diff = now - data.startedAt;
    const totalSecs = Math.floor(diff / 1000);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
  })();

  // Expiry countdown
  const expiryInfo = (() => {
    if (!data.expiresAt || isDone || isFailed) return null;
    const diff = data.expiresAt - now;
    if (diff <= 0) return { label: "Expired", urgent: true };
    const totalSecs = Math.floor(diff / 1000);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    const label = m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
    return { label, urgent: totalSecs < 60 };
  })();

  // Accent color based on state
  const accent = isFailed ? "#f87171" : isDone ? "#34d399" : "#818cf8";
  const accentBorder = isFailed ? "rgba(239,68,68,0.2)" : isDone ? "rgba(16,185,129,0.2)" : "rgba(99,102,241,0.2)";

  // Exchange rate display
  const rateDisplay = (() => {
    if (!data.rate && data.fromAmount > 0 && data.toAmount > 0) {
      return (data.toAmount / data.fromAmount).toFixed(4);
    }
    return data.rate ? data.rate.toFixed(4) : null;
  })();

  const fromChainColor = CHAIN_COLORS[data.fromChain ?? "solana"] ?? "#aaa";
  const toChainColor   = CHAIN_COLORS[data.toChain   ?? "solana"] ?? "#aaa";
  const fromChainLabel = CHAIN_LABELS[data.fromChain ?? "solana"] ?? (data.fromChain?.toUpperCase() ?? "SOL");
  const toChainLabel   = CHAIN_LABELS[data.toChain   ?? "solana"] ?? (data.toChain?.toUpperCase()   ?? "SOL");
  const isCrossChain   = data.fromChain && data.toChain && data.fromChain !== data.toChain;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="w-full mt-2 overflow-hidden"
      style={{
        borderRadius: "16px",
        background: "rgba(10,10,18,0.85)",
        border: `1px solid ${accentBorder}`,
        boxShadow: `0 0 0 1px rgba(255,255,255,0.04) inset, 0 4px 24px rgba(0,0,0,0.4)`,
      }}
    >
      {/* Top accent bar */}
      <div style={{ height: "2px", background: `linear-gradient(90deg, ${accent}60, ${accent}20, transparent)` }} />

      <div className="p-4 space-y-3.5">
        {/* ── Header row ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {isDone ? (
              <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.4)" }}>
                <CheckCircle2 className="w-3 h-3" style={{ color: "#34d399" }} />
              </div>
            ) : isFailed ? (
              <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.4)" }}>
                <AlertTriangle className="w-3 h-3" style={{ color: "#f87171" }} />
              </div>
            ) : (
              <div className="relative w-5 h-5 shrink-0">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0 rounded-full border-2 border-transparent"
                  style={{ borderTopColor: accent, borderRightColor: `${accent}40` }}
                />
              </div>
            )}
            <div>
              <p className="text-xs font-semibold tracking-wide" style={{ color: accent }}>
                {isDone ? "Swap Complete" : isFailed ? (isExpired ? "HTLC Expired" : "Swap Failed") : "Swap In Progress"}
              </p>
              {!isDone && !isFailed && elapsedLabel && (
                <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>Running {elapsedLabel}</p>
              )}
            </div>
          </div>

          {/* Route badge */}
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
            <Shield className="w-2.5 h-2.5" style={{ color: "#818cf8" }} />
            <span className="text-[9px] font-semibold tracking-wider" style={{ color: "#818cf8" }}>HTLC ATOMIC</span>
          </div>
        </div>

        {/* ── Swap summary row ── */}
        <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center justify-between">
            {/* From */}
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>You send</span>
              <span className="text-sm font-bold" style={{ color: "rgba(255,255,255,0.95)" }}>
                {data.fromAmount.toFixed(4)}
                <span className="ml-1 text-xs font-semibold" style={{ color: fromChainColor }}>{data.fromToken}</span>
              </span>
              {isCrossChain && (
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full mt-0.5 w-fit" style={{ background: `${fromChainColor}18`, color: fromChainColor }}>{fromChainLabel}</span>
              )}
            </div>

            {/* Arrow */}
            <div className="flex flex-col items-center gap-0.5">
              <ArrowRight className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.2)" }} />
              {rateDisplay && (
                <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.3)" }}>1:{rateDisplay}</span>
              )}
            </div>

            {/* To */}
            <div className="flex flex-col gap-0.5 items-end">
              <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>You receive</span>
              <span className="text-sm font-bold" style={{ color: isDone ? "#34d399" : "rgba(255,255,255,0.95)" }}>
                {data.toAmount.toFixed(4)}
                <span className="ml-1 text-xs font-semibold" style={{ color: toChainColor }}>{data.toToken}</span>
              </span>
              {isCrossChain && (
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full mt-0.5 w-fit" style={{ background: `${toChainColor}18`, color: toChainColor }}>{toChainLabel}</span>
              )}
            </div>
          </div>
        </div>

        {/* ── Meta row: peer + expiry ── */}
        <div className="flex items-center justify-between">
          {data.peerAlias ? (
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#34d399" }} />
              <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>Peer</span>
              <span className="text-[11px] font-semibold" style={{ color: "rgba(255,255,255,0.8)" }}>@{data.peerAlias}</span>
            </div>
          ) : <div />}

          {expiryInfo && (
            <div className="flex items-center gap-1" style={{ color: expiryInfo.urgent ? "#f87171" : "#f59e0b" }}>
              <Clock className="w-3 h-3" />
              <span className="text-[10px] font-mono font-medium">HTLC {expiryInfo.label}</span>
            </div>
          )}
        </div>

        {/* ── Step tracker ── */}
        {!isFailed && (
          <div className="space-y-0">
            {SWAP_PHASES.map((phase, idx) => {
              const isActive  = idx === currentIdx;
              const isDoneStep = isDone || idx < currentIdx;
              const isLast     = idx === SWAP_PHASES.length - 1;
              return (
                <div key={phase.key} className="flex items-stretch gap-3">
                  {/* Left: connector line + dot */}
                  <div className="flex flex-col items-center" style={{ width: "16px", flexShrink: 0 }}>
                    {/* Top connector */}
                    {idx > 0 && (
                      <div className="w-px flex-none" style={{
                        height: "6px",
                        background: isDoneStep ? "rgba(52,211,153,0.4)" : "rgba(255,255,255,0.08)",
                      }} />
                    )}
                    {/* Dot */}
                    {isDoneStep ? (
                      <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.5)" }}>
                        <span className="text-[8px] font-bold" style={{ color: "#34d399" }}>✓</span>
                      </div>
                    ) : isActive ? (
                      <motion.div
                        animate={{ scale: [1, 1.2, 1], opacity: [0.8, 1, 0.8] }}
                        transition={{ duration: 1.4, repeat: Infinity }}
                        className="w-4 h-4 rounded-full shrink-0"
                        style={{ background: `${accent}25`, border: `2px solid ${accent}` }}
                      />
                    ) : (
                      <div className="w-4 h-4 rounded-full shrink-0" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)" }} />
                    )}
                    {/* Bottom connector */}
                    {!isLast && (
                      <div className="w-px flex-1" style={{
                        minHeight: "6px",
                        background: isDoneStep ? "rgba(52,211,153,0.4)" : "rgba(255,255,255,0.08)",
                      }} />
                    )}
                  </div>

                  {/* Right: label + desc */}
                  <div className="flex-1 min-w-0 pb-2.5">
                    <p
                      className="text-[11px] font-semibold leading-none"
                      style={{
                        color: isDoneStep ? "#34d399" : isActive ? accent : "rgba(255,255,255,0.25)",
                        marginTop: idx === 0 ? "0" : "1px",
                      }}
                    >
                      {phase.label}
                      {isActive && !isDone && (
                        <motion.span
                          animate={{ opacity: [1, 0.3, 1] }}
                          transition={{ duration: 1.2, repeat: Infinity }}
                          className="ml-1.5 text-[9px] font-normal"
                          style={{ color: `${accent}90` }}
                        >
                          ●
                        </motion.span>
                      )}
                    </p>
                    {(isActive || isDoneStep) && (
                      <p className="text-[10px] mt-0.5 leading-snug" style={{ color: "rgba(255,255,255,0.3)" }}>
                        {phase.desc}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Error / expired message ── */}
        {isFailed && (
          <div className="rounded-lg px-3 py-2" style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)" }}>
            <p className="text-[11px]" style={{ color: "#f87171" }}>
              {data.errorMsg ?? (isExpired ? "HTLC window expired. Funds will be refunded automatically." : "Swap could not be completed.")}
            </p>
          </div>
        )}

        {/* ── Tx hash ── */}
        {data.txHash && (
          <a
            href={getExplorerUrl(data.fromChain, data.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[10px] font-mono group"
            style={{ color: "rgba(103,232,249,0.7)" }}
          >
            <ExternalLink className="w-3 h-3 group-hover:opacity-100" style={{ opacity: 0.7 }} />
            <span className="group-hover:underline">{data.txHash.slice(0, 20)}…</span>
          </a>
        )}
      </div>
    </motion.div>
  );
}

// ─── Message bubble ─────────────────────────────────────────────────────
// ─── HTLC Countdown (inline variant for chat bubbles) ──────────────────────────
function htlcInlineExplorerUrl(chain: string, txId?: string): string | null {
  if (!txId) return null;
  switch (chain.toLowerCase()) {
    case "solana":       return `https://solscan.io/tx/${txId}`;
    case "ethereum":     return `https://etherscan.io/tx/${txId}`;
    case "bitcoin":      return `https://mempool.space/tx/${txId}`;
    case "trac_network": return `https://explorer.trac.network/tx/${txId}`;
    default:             return null;
  }
}

function HtlcCountdownInline({
  lockedAt,
  timelockMs = 3_600_000,
  chain,
  lockTxId,
}: {
  lockedAt: number;
  timelockMs?: number;
  chain?: string;
  lockTxId?: string;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const expiresAt = lockedAt + timelockMs;
  const diff = expiresAt - now;
  if (diff <= 0) {
    const explorerHref = chain ? htlcInlineExplorerUrl(chain, lockTxId) : null;
    return (
      <div className="text-xs font-medium py-1 flex items-center gap-1.5" style={{ color: "#f87171" }}>
        ⏰ HTLC refundable now
        {explorerHref && (
          <a
            href={explorerHref}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:opacity-80 transition-opacity"
            onClick={e => e.stopPropagation()}
          >
            View on-chain ↗
          </a>
        )}
      </div>
    );
  }
  const totalSecs = Math.floor(diff / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const label = h > 0
    ? `${h}h ${m.toString().padStart(2, "0")}m`
    : m > 0
    ? `${m}m ${s.toString().padStart(2, "0")}s`
    : `${s}s`;
  return (
    <div className="text-xs font-medium py-1" style={{ color: "var(--muted-foreground)" }}>
      ⏳ Refundable in {label}
    </div>
  );
}

function MessageBubble({
  msg,
  onConfirmSwap,
  onCancelSwap,
  executingId,
  onRequestConnect,
  onAcceptRfq,
  onDeclineRfq,
  onClaimHtlc,
  htlcRevealedSecrets,
  claimedRfqIds,
  onRefundHtlc,
  refundableHtlcs,
  refundedRfqIds,
  htlcLockedAt,
  tnkPeerCount,
  anyWalletConnected,
  onSwapAgain,
  bitcoinTap,
  preferredBtcWallet,
  setPreferredBtcWallet,
}: {
  msg: ChatMessage;
  onConfirmSwap: (msgId: string, quoteData: QuoteData) => void;
  onCancelSwap: (msgId: string) => void;
  executingId: string | null;
  onRequestConnect: (fromToken: string, fromChain?: SupportedChain) => void;
  onAcceptRfq?: (rfqId: string, fromToken: string, toToken: string, amount: number, outAmount: number) => void;
  onDeclineRfq?: (rfqId: string) => void;
  onClaimHtlc?: (rfqId: string) => void;
  htlcRevealedSecrets?: Record<string, string>;
  claimedRfqIds?: Set<string>;
  onRefundHtlc?: (rfqId: string) => void;
  refundableHtlcs?: Record<string, { fromChain: string; toChain: string; expiresAt: number; lockTxId?: string }>;
  refundedRfqIds?: Set<string>;
  /** Map of rfqId → Unix ms when HTLC was locked (for countdown timer) */
  htlcLockedAt?: Record<string, number>;
  tnkPeerCount?: number;
  /** Whether ANY wallet (SOL, ETH, BTC, TNK) is connected — passed to QuoteCard */
  anyWalletConnected?: boolean;
  /** Called when user clicks "Swap again" on the completion card */
  onSwapAgain?: () => void;
  /** Tap Wallet BTC state — passed to QuoteCard for BTC wallet picker */
  bitcoinTap?: import("@/contexts/MultiChainWalletContext").ChainWallet | null;
  /** Which BTC wallet is preferred when multiple are connected */
  preferredBtcWallet?: import("@/contexts/MultiChainWalletContext").BtcProviderType | null;
  /** Callback to set the preferred BTC wallet */
  setPreferredBtcWallet?: (p: import("@/contexts/MultiChainWalletContext").BtcProviderType | null) => void;
}) {
  const isUser = msg.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
      {/* Avatar */}
      {!isUser && (
        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-1"
          style={{ background: "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(139,92,246,0.2))", border: "1px solid rgba(6,182,212,0.3)" }}>
          <Bot className="w-4 h-4 text-cyan-400" />
        </div>
      )}

      <div className={`flex-1 max-w-[85%] ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        {/* Text bubble */}
        <div
          className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${isUser ? "rounded-tr-sm" : "rounded-tl-sm"}`}
          style={{
            background: isUser
              ? "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(139,92,246,0.2))"
              : "var(--card)",
            border: isUser
              ? "1px solid rgba(6,182,212,0.3)"
              : "1px solid var(--border)",
            color: "var(--foreground)",
          }}
        >
          {msg.content}
        </div>

        {/* Peer searching skeleton */}
        {msg.type === "peer_searching" && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs" style={{ background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.2)" }}>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
              className="w-3.5 h-3.5 rounded-full border-2 border-transparent"
              style={{ borderTopColor: "#06b6d4", borderRightColor: "rgba(6,182,212,0.3)" }}
            />
            <span style={{ color: "#67e8f9" }}>{msg.content}</span>
            <motion.span
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="ml-auto text-[10px] shrink-0"
              style={{ color: "rgba(6,182,212,0.5)" }}
            >
              {msg.content.startsWith("Still") ? "⏳" : "live"}
            </motion.span>
          </div>
        )}

        {/* Quote card (inline) */}
        {msg.type === "quote_card" && msg.quoteData && executingId !== msg.id && (
          <div className="w-full mt-1">
            {/* Route badge — shown above the quote card */}
            {msg.routeBadge && (
              <div className="flex items-center gap-1.5 mb-1.5">
                {msg.routeBadge === "p2p" ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: "rgba(16,185,129,0.12)", color: "#10b981", border: "1px solid rgba(16,185,129,0.3)" }}>
                    <span>🤝</span> P2P matched{msg.matchedPeerAlias ? ` — @${msg.matchedPeerAlias}` : ""}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: "rgba(234,179,8,0.1)", color: "#eab308", border: "1px solid rgba(234,179,8,0.25)" }}>
                    <span>⚡</span> No peer found — routing via {msg.dexName ?? "DEX"}
                  </span>
                )}
              </div>
            )}
            <QuoteCard
              data={msg.quoteData}
              onConfirm={() => onConfirmSwap(msg.id, msg.quoteData!)}
              onCancel={() => onCancelSwap(msg.id)}
              isExecuting={executingId === msg.id}
              onRequestConnect={() => onRequestConnect(msg.quoteData!.fromToken, msg.quoteData!.fromChain)}
              limitWarning={msg.limitWarning}
              tnkPeerCount={tnkPeerCount}
              walletConnected={anyWalletConnected}
              bitcoinTap={bitcoinTap}
              preferredBtcWallet={preferredBtcWallet}
              setPreferredBtcWallet={setPreferredBtcWallet}
            />
          </div>
        )}

        {/* Limit exceeded card */}
        {msg.type === "limit_exceeded" && msg.limitExceededData && (
          <div className="w-full mt-1">
            <LimitExceededCard
              blockedAmountUsd={msg.limitExceededData.blockedAmountUsd}
              limitUsd={msg.limitExceededData.limitUsd}
            />
          </div>
        )}

        {/* Incoming P2P RFQ from agent matching */}
        {msg.type === "incoming_rfq" && msg.incomingRfqData && (
          <div className="w-full mt-2 rounded-xl border p-3 space-y-3" style={{ background: "rgba(99,102,241,0.08)", borderColor: "rgba(99,102,241,0.3)" }}>
            <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: "#818cf8" }}>
              <span>🤝</span>
              <span>AFOS Agent P2P Match</span>
              <span className="ml-auto text-[10px] font-normal" style={{ color: "var(--muted-foreground)" }}>
                Expires {new Date(msg.incomingRfqData.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg p-2" style={{ background: "var(--muted)" }}>
                <p className="text-muted-foreground mb-0.5">You send</p>
                <p className="font-semibold text-foreground">{msg.incomingRfqData.outAmount.toFixed(4)} {msg.incomingRfqData.toToken}</p>
                <p className="text-muted-foreground text-[10px]">{msg.incomingRfqData.toChain}</p>
              </div>
              <div className="rounded-lg p-2" style={{ background: "var(--muted)" }}>
                <p className="text-muted-foreground mb-0.5">You receive</p>
                <p className="font-semibold text-foreground">{msg.incomingRfqData.amount.toFixed(4)} {msg.incomingRfqData.fromToken}</p>
                <p className="text-muted-foreground text-[10px]">{msg.incomingRfqData.fromChain}</p>
              </div>
            </div>
            {/* HTLC countdown timer — shown on accepted cards where Agent B has locked funds */}
            {htlcLockedAt?.[msg.incomingRfqData.rfqId] && !claimedRfqIds?.has(msg.incomingRfqData.rfqId) && !refundedRfqIds?.has(msg.incomingRfqData.rfqId) && (
              <HtlcCountdownInline
                lockedAt={htlcLockedAt[msg.incomingRfqData.rfqId]}
                timelockMs={refundableHtlcs?.[msg.incomingRfqData.rfqId]?.expiresAt
                  ? refundableHtlcs[msg.incomingRfqData.rfqId].expiresAt - htlcLockedAt[msg.incomingRfqData.rfqId]
                  : 3_600_000}
                chain={msg.incomingRfqData.fromChain}
                lockTxId={refundableHtlcs?.[msg.incomingRfqData.rfqId]?.lockTxId}
              />
            )}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const rfq = msg.incomingRfqData!;
                  onAcceptRfq?.(rfq.rfqId, rfq.fromToken, rfq.toToken, rfq.amount, rfq.outAmount);
                }}
                className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors"
                style={{ background: "rgba(16,185,129,0.15)", color: "#10b981", border: "1px solid rgba(16,185,129,0.3)" }}
              >
                Accept Swap
              </button>
              <button
                onClick={() => {
                  const rfq = msg.incomingRfqData!;
                  onDeclineRfq?.(rfq.rfqId);
                }}
                className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors"
                style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" }}
              >
                Decline
              </button>
            </div>
            {/* Claim Funds — shown when Agent A has revealed the secret and not yet claimed */}
            {htlcRevealedSecrets?.[msg.incomingRfqData.rfqId] && !claimedRfqIds?.has(msg.incomingRfqData.rfqId) && onClaimHtlc && (
              <button
                onClick={() => onClaimHtlc(msg.incomingRfqData!.rfqId)}
                className="w-full py-2 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.35)" }}
              >
                🔓 Claim Funds (Secret Revealed)
              </button>
            )}
            {/* Claimed badge — shown after successful claim */}
            {claimedRfqIds?.has(msg.incomingRfqData.rfqId) && (
              <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium py-1">
                ✅ Funds claimed successfully
              </div>
            )}
            {/* Refund button — shown for Agent A when HTLC has expired and not yet refunded */}
            {refundableHtlcs?.[msg.incomingRfqData.rfqId] && !refundedRfqIds?.has(msg.incomingRfqData.rfqId) && onRefundHtlc && (
              <button
                onClick={() => onRefundHtlc(msg.incomingRfqData!.rfqId)}
                className="w-full py-2 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" }}
              >
                ⚠️ Refund Locked Funds (Expired)
              </button>
            )}
            {/* Refunded badge — shown after successful refund */}
            {refundedRfqIds?.has(msg.incomingRfqData.rfqId) && (
              <div className="flex items-center gap-1.5 text-amber-400 text-xs font-medium py-1">
                ↩ Funds refunded successfully
              </div>
            )}
          </div>
        )}
        {/* Live swap progress tracker */}
        {msg.type === "swap_progress" && msg.swapProgressData && (
          <SwapProgressCard data={msg.swapProgressData} />
        )}

        {/* Tx success */}
        {msg.type === "tx_success" && msg.txHash && msg.quoteData && (
          <TxSuccessCard
            txHash={msg.txHash}
            fromToken={msg.quoteData.fromToken}
            toToken={msg.quoteData.toToken}
            fromAmount={msg.quoteData.fromAmount}
            toAmount={msg.quoteData.toAmount}
            fromChain={msg.quoteData.fromChain}
            balancesAfterSwap={msg.balancesAfterSwap}
            signedBy={msg.signedBy}
            onSwapAgain={onSwapAgain}
          />
        )}

        {/* Timestamp */}
        <span className="text-[10px] text-muted-foreground mt-1 px-1">
          {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </motion.div>
  );
}

// ─── Main ChatPage ─────────────────────────────────────────────────────────────
export default function ChatPage() {
  const { connected, shortAddress, walletName, balances, totalUsd, connect, publicKey, sendTransaction, refreshBalances } = useWallet();
  const { bitcoin, bitcoinTap, preferredBtcWallet, setPreferredBtcWallet, ethereum, tracNetwork: tnkWallet, phantomMultiChain } = useMultiChainWallet();
  const { user } = useAuth();
  const openId = user?.openId;

  // ── Phantom multi-chain: treat as connected if any chain address is present ──
  const phantomSolAddr = phantomMultiChain?.solanaAddress;
  const solConnected = connected || !!phantomSolAddr;
  // For swap execution gating: any wallet connected means the user can chat
  const anyWalletConnected = solConnected || !!ethereum?.address || !!bitcoin?.address || !!tnkWallet?.address;

  const [showWalletModal, setShowWalletModal] = useState(false);
  const [walletModalChain, setWalletModalChain] = useState<SupportedChain>("solana");

  // ── Shared chat state from ChatContext ──────────────────────────────────────
  const { messages, setMessages, addMessage, clearMessages, isTyping, setIsTyping } = useChat();
  const lightPeer = useLightPeer();
  const { peerId: myPeerId, peerAlias: myPeerAlias, remotePeers, initiateHtlcLock } = lightPeer;

  const [input, setInput] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close emoji picker when clicking outside
  useEffect(() => {
    if (!showEmoji) return;
    const handler = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmoji]);

  const sendMessage = trpc.chat.sendMessage.useMutation();
  const buildSwapTx = trpc.chat.buildSwapTx.useMutation();
  const executeBtcSwap = trpc.chat.executeBtcSwap.useMutation();
  const executeEthSwap = trpc.chat.executeEthSwap.useMutation();
  // Agent-mode: server-side autonomous swap (no wallet required)
  const executeAgentSwap = trpc.chat.executeAgentSwap.useMutation();

  // Read prefill from Swaps page "Send to Agent" button on mount
  // If afos_chat_autosend is set, auto-send the message immediately
  const hasAutoSentRef = useRef(false);
  useEffect(() => {
    const prefill = sessionStorage.getItem('afos_chat_prefill');
    const autoSend = sessionStorage.getItem('afos_chat_autosend');
    if (prefill) {
      sessionStorage.removeItem('afos_chat_prefill');
      sessionStorage.removeItem('afos_chat_autosend');
      if (autoSend === 'true' && !hasAutoSentRef.current) {
        hasAutoSentRef.current = true;
        // Auto-send after a short delay to let component fully mount
        setTimeout(() => handleSend(prefill), 300);
      } else {
        setInput(prefill);
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Listen for agent_rfq events — show incoming swap card when agent matches this user as counterparty
  useEffect(() => {
    const handler = (e: Event) => {
      const rfq = (e as CustomEvent).detail as {
        rfqId: string;
        fromToken: string;
        toToken: string;
        fromChain: string;
        toChain: string;
        amount: number;
        outAmount: number;
        rate: number;
        requesterAlias?: string;
        requesterPeerId?: string;
        expiresAt: number;
      };
      if (!rfq?.rfqId) return;
      const alias = rfq.requesterAlias ?? rfq.requesterPeerId?.slice(0, 8) ?? "Someone";
      addMessage({
        role: "assistant",
        type: "incoming_rfq",
        content: `The AFOS agent matched you with **@${alias}** who wants to swap **${rfq.amount.toFixed(4)} ${rfq.fromToken}** for your **${rfq.outAmount.toFixed(4)} ${rfq.toToken}**. Do you want to accept this P2P swap?`,
        incomingRfqData: rfq,
      });
    };
    window.addEventListener("afos:agent-rfq", handler);
    return () => window.removeEventListener("afos:agent-rfq", handler);
  }, [addMessage]);

  // Listen for rfq_accepted events — counterparty accepted our swap request
  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail as {
        rfqId?: string;
        acceptorAlias?: string;
        acceptorPeerId?: string;
        fromToken?: string;
        toToken?: string;
        amount?: number;
        outAmount?: number;
      };
      if (!data?.rfqId) return;
      const alias = data.acceptorAlias ?? data.acceptorPeerId?.slice(0, 8) ?? "Peer";
      // Update the swap_progress card in-place if it exists for this rfqId
      setMessages(prev => {
        const progressIdx = prev.findIndex(m => m.type === "swap_progress" && m.swapProgressData?.rfqId === data.rfqId);
        if (progressIdx !== -1) {
          const updated = [...prev];
          updated[progressIdx] = { ...updated[progressIdx], swapProgressData: { ...updated[progressIdx].swapProgressData!, phase: "negotiating", peerAlias: alias } };
          return updated;
        }
        // No progress card found — fall back to text message
        return [...prev, { id: `rfq-accepted-${Date.now()}`, role: "assistant" as const, type: "text" as const, content: `✅ **@${alias}** accepted your swap! **${data.amount?.toFixed(4) ?? "?"} ${data.fromToken ?? "?"}** → **${data.outAmount?.toFixed(4) ?? "?"} ${data.toToken ?? "?"}**. HTLC atomic settlement is in progress…`, timestamp: Date.now() }];
      });
      toast.success(`Swap accepted by @${alias}`, {
        description: `${data.amount?.toFixed(4)} ${data.fromToken} → ${data.outAmount?.toFixed(4)} ${data.toToken}`,
      });
    };
    window.addEventListener("afos:rfq-accepted", handler);
    return () => window.removeEventListener("afos:rfq-accepted", handler);
  }, [addMessage, setMessages]);

  // ── HTLC locked: counterparty locked their side ─────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail as {
        fromPeerId?: string; rfqId?: string; txHash?: string; chain?: string; amountLocked?: number;
      };
      if (!data?.rfqId) return;
      const peerAlias = data.fromPeerId?.slice(0, 12) ?? "Peer";
      setMessages(prev => {
        const idx = prev.findIndex(m => m.type === "swap_progress" && m.swapProgressData?.rfqId === data.rfqId);
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], swapProgressData: { ...updated[idx].swapProgressData!, phase: "settling", peerAlias, txHash: data.txHash } };
          return updated;
        }
        const chainLabel = data.chain ? data.chain.charAt(0).toUpperCase() + data.chain.slice(1) : "";
        return [...prev, { id: `htlc-locked-${Date.now()}`, role: "assistant" as const, type: "text" as const, content: `\uD83D\uDD12 **@${peerAlias}** locked **${data.amountLocked?.toFixed(4) ?? "?"} ${chainLabel}** in HTLC escrow. Tx: \`${(data.txHash ?? "").slice(0, 20)}\u2026\``, timestamp: Date.now() }];
      });
    };
    window.addEventListener("afos:htlc-locked", handler);
    return () => window.removeEventListener("afos:htlc-locked", handler);
  }, [setMessages]);

    // ── HTLC secret sent: we revealed the secret to counterparty ────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail as { rfqId?: string; secretHex?: string };
      if (!data?.rfqId) return;
      setMessages(prev => {
        const idx = prev.findIndex(m => m.type === "swap_progress" && m.swapProgressData?.rfqId === data.rfqId);
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], swapProgressData: { ...updated[idx].swapProgressData!, phase: "settling" } };
          return updated;
        }
        // No matching swap card in this session — this rfqId belongs to a previous session.
        // Silently ignore to avoid ghost "HTLC secret revealed" messages.
        return prev;
      });
    };
    window.addEventListener("afos:htlc-secret-sent", handler);
    return () => window.removeEventListener("afos:htlc-secret-sent", handler);
  }, [setMessages]);

  // ── HTLC secret received: counterparty revealed the secret to us ────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail as { rfqId?: string; secretHex?: string };
      if (!data?.rfqId) return;
      setMessages(prev => {
        const idx = prev.findIndex(m => m.type === "swap_progress" && m.swapProgressData?.rfqId === data.rfqId);
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], swapProgressData: { ...updated[idx].swapProgressData!, phase: "confirmed" } };
          return updated;
        }
            // No matching swap card — ghost event from a previous session. Suppress silently.
        return prev;
      });
    };
    window.addEventListener("afos:htlc-secret-received", handler);
    return () => window.removeEventListener("afos:htlc-secret-received", handler);
  }, [setMessages]);

  // ── HTLC expired: swap window passed without settlement ─────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail as { rfqId?: string; chain?: string };
      if (!data?.rfqId) return;
      setMessages(prev => {
        const idx = prev.findIndex(m => m.type === "swap_progress" && m.swapProgressData?.rfqId === data.rfqId);
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], swapProgressData: { ...updated[idx].swapProgressData!, phase: "expired", errorMsg: "HTLC window expired. Funds will be refunded automatically." } };
          return updated;
        }
          // No matching swap card — ghost event from a previous session. Suppress silently.
        return prev;
      });
    };
    window.addEventListener("afos:htlc-expired", handler);
    return () => window.removeEventListener("afos:htlc-expired", handler);
  }, [setMessages]);

  // ── HTLC completed: atomic settlement finished, both parties received funds ────────────
  useEffect(() => {
    const handler = async (e: Event) => {
      const data = (e as CustomEvent).detail as { rfqId?: string; txHash?: string; chain?: string };
      if (!data?.rfqId) return;
      // Refresh balances to show updated amounts
      let freshBalances = balances;
      try {
        const updated = await refreshBalances();
        if (updated && updated.length > 0) freshBalances = updated;
      } catch { /* non-critical */ }
      // Update the swap_progress card to confirmed phase
      setMessages(prev => {
        const idx = prev.findIndex(m => m.type === "swap_progress" && m.swapProgressData?.rfqId === data.rfqId);
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], swapProgressData: { ...updated[idx].swapProgressData!, phase: "confirmed" } };
          // Append a success text message with new balance
          const balanceLine = freshBalances.length > 0
            ? `\n\n**Your new balances:** ${freshBalances.map(b => `${parseFloat(b.amount).toFixed(4)} ${b.symbol}`).join(' · ')}`
            : "";
          const successMsg = {
            id: `htlc-done-${Date.now()}`,
            role: "assistant" as const,
            type: "text" as const,
            content: `✅ **Swap complete!** Atomic settlement confirmed on-chain. Both parties have received their funds.${balanceLine}`,
            timestamp: Date.now(),
          };
          return [...updated, successMsg];
        }
        return prev;
      });
    };
    const wrappedHandler = (e: Event) => void handler(e);
    window.addEventListener("afos:htlc-completed", wrappedHandler);
    return () => window.removeEventListener("afos:htlc-completed", wrappedHandler);
  }, [setMessages, balances, refreshBalances]);

  const handleSend = useCallback(async (text?: string) => {
    const messageText = (text || input).trim();
    if (!messageText || isTyping) return;

    setInput("");
    addMessage({ role: "user", content: messageText, type: "text" });
    setIsTyping(true);

    // Detect if this looks like a swap intent so we can show the peer-searching skeleton
    const isSwapIntent = /\bswap\b|\bbridge\b|\bconvert\b|\bexchange\b/i.test(messageText);

    // Insert a temporary "Searching for peer..." skeleton for swap intents
    const searchingMsgId = `searching-${Date.now()}`;
    const peerCount = remotePeers.length;
    if (isSwapIntent) {
      addMessage({
        id: searchingMsgId,
        role: "assistant",
        content: peerCount > 0
          ? `Scanning ${peerCount} peer${peerCount !== 1 ? 's' : ''} on the P2P network…`
          : "Scanning P2P network for a matching peer…",
        type: "peer_searching",
        timestamp: Date.now(),
      } as ChatMessage);
    }

    // 8-second timeout fallback — update the skeleton message text if still waiting
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    if (isSwapIntent) {
      timeoutHandle = setTimeout(() => {
        setMessages(prev => prev.map(m =>
          m.id === searchingMsgId
            ? { ...m, content: "Still searching… this may take a moment" }
            : m
        ));
      }, 8000);
    }

    try {
      const history = messages
        .filter(m => m.type !== "quote_card" && m.type !== "tx_success" && m.type !== "peer_searching")
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content }));

      const result = await sendMessage.mutateAsync({
        message: messageText,
        history,
        walletAddress: publicKey?.toString(),
        walletBalances: [
          ...balances.map(b => ({ symbol: b.symbol, amount: b.amount })),
          ...(bitcoin?.connected ? [{ symbol: "BTC", amount: bitcoin.balance }] : []),
          ...(tnkWallet?.connected ? [{ symbol: "TNK", amount: tnkWallet.balance }] : []),
          ...(ethereum?.connected ? [{ symbol: "ETH", amount: ethereum.balance }] : []),
        ],
        openId,
        senderPeerId: myPeerId ?? undefined,
        senderAlias: myPeerAlias ?? undefined,
      });

      // Clear the 8s timeout and remove the searching skeleton before adding the real result
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (isSwapIntent) {
        setMessages(prev => prev.filter(m => m.id !== searchingMsgId));
      }

      if (result.type === "quote_card" && result.quoteData) {
        // Determine route badge from the result
        const p2pPeer = (result as { p2pPeer?: { peerId?: string; alias?: string } | null }).p2pPeer;
        const routeBadge: "p2p" | "dex" = p2pPeer?.peerId ? "p2p" : "dex";
        const matchedPeerAlias = p2pPeer?.alias ?? p2pPeer?.peerId?.slice(0, 8);
        // Extract DEX name from route string (e.g. "Jupiter DEX" → "Jupiter")
        const routeStr = result.quoteData.route ?? "";
        const dexName = routeBadge === "dex"
          ? (routeStr.match(/Jupiter|0x|1inch|Uniswap|Raydium/i)?.[0] ?? "DEX")
          : undefined;
        addMessage({
          role: "assistant",
          content: result.content,
          type: "quote_card",
          quoteData: result.quoteData as QuoteData,
          limitWarning: (result as { limitWarning?: string }).limitWarning,
          routeBadge,
          matchedPeerAlias,
          dexName,
        });
      } else {
        addMessage({
          role: "assistant",
          content: result.content,
          type: "text",
        });
      }
    } catch (err) {
      // Clear the 8s timeout and remove the searching skeleton on error too
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (isSwapIntent) {
        setMessages(prev => prev.filter(m => m.id !== searchingMsgId));
      }
      addMessage({
        role: "assistant",
        content: "Sorry, I encountered an error. Please try again.",
        type: "error",
      });
      console.error("[ChatPage] sendMessage error:", err);
    } finally {
      setIsTyping(false);
    }
  }, [input, isTyping, messages, sendMessage, addMessage, publicKey, balances, myPeerId, myPeerAlias, remotePeers, setMessages]);

  // Open wallet modal for a specific chain based on the quote's FROM token
  const openWalletForChain = useCallback((fromToken: string, fromChain?: SupportedChain) => {
    const chain = fromChain || TOKEN_CHAIN_FALLBACK[fromToken] || "solana";
    setWalletModalChain(chain);
    setShowWalletModal(true);
  }, []);

  const handleConfirmSwap = useCallback(async (msgId: string, quoteData: QuoteData) => {
    // ── Wallet required — AFOS is non-custodial, user must connect their own wallet ──
    const fromChainNorm = (quoteData.fromChain ?? "solana").toLowerCase();
    const toChainNorm = (quoteData.toChain ?? "solana").toLowerCase();
    // Accept Phantom multi-chain Solana address as a valid Solana wallet
    const effectivePublicKey = publicKey || (phantomSolAddr ? { toString: () => phantomSolAddr } : null);
    const noWalletConnected =
      (!connected && !phantomSolAddr) || !effectivePublicKey ||
      (fromChainNorm === "ethereum"    && !ethereum?.address) ||
      (fromChainNorm === "bitcoin"     && !bitcoin?.address) ||
      (fromChainNorm === "trac_network" && !bitcoin?.address); // TNK uses BTC-style HTLC wallet

    if (noWalletConnected) {
      // Non-custodial: the agent cannot execute swaps on behalf of the user.
      // Prompt the user to connect their wallet for the appropriate chain.
      openWalletForChain(quoteData.fromToken, quoteData.fromChain);
      return;
    }

    // ── Destination wallet check for cross-chain swaps ─────────────────────────────────────────────
    // For cross-chain swaps, both source AND destination wallets must be connected.
    // The destination wallet is needed to receive the output tokens.
    if (fromChainNorm !== toChainNorm) {
      // Check if destination wallet is connected
      const destWalletMissing =
        (toChainNorm === "solana"       && !effectivePublicKey) ||
        (toChainNorm === "ethereum"     && !ethereum?.address) ||
        (toChainNorm === "bitcoin"      && !bitcoin?.address) ||
        (toChainNorm === "trac_network" && !tnkWallet?.address);

      if (destWalletMissing) {
        const destChainLabel = {
          solana:       "Solana (Phantom/MetaMask)",
          ethereum:     "Ethereum (MetaMask/Phantom)",
          bitcoin:      "Bitcoin (Phantom/MetaMask/Tap Wallet)",
          trac_network: "Trac Network (Tap Wallet)",
        }[toChainNorm] ?? toChainNorm;
        toast.error("Destination wallet not connected", {
          description: `This cross-chain swap sends ${quoteData.toToken} to ${destChainLabel}. Please connect that wallet first.`,
          duration: 6000,
        });
        openWalletForChain(quoteData.toToken, quoteData.toChain as SupportedChain);
        return;
      }
    }

    setExecutingId(msgId);

    // ── Derive the signing wallet for the audit trail in TxSuccessCard ──────────
    const signingWalletForAudit: { name: string; address: string } | undefined = (() => {
      const chain = fromChainNorm;
      if (chain === "bitcoin" || chain === "trac_network") {
        if (preferredBtcWallet === "tap" && bitcoinTap?.connected) {
          return { name: "Tap Wallet", address: bitcoinTap.shortAddress };
        }
        if (bitcoin?.connected) return { name: bitcoin.walletName, address: bitcoin.shortAddress };
        return undefined;
      }
      if (chain === "ethereum") {
        if (ethereum?.connected) return { name: ethereum.walletName, address: ethereum.shortAddress };
        return undefined;
      }
      // Solana
      const solAddr = phantomMultiChain?.solanaAddress
        ? `${phantomMultiChain.solanaAddress.slice(0, 4)}\u2026${phantomMultiChain.solanaAddress.slice(-4)}`
        : (publicKey ? `${publicKey.toString().slice(0, 4)}\u2026${publicKey.toString().slice(-4)}` : undefined);
      const solName = phantomMultiChain?.solanaAddress ? "Phantom" : "Solana Wallet";
      if (solAddr) return { name: solName, address: solAddr };
      return undefined;
    })();

    try {
      // ── BTC swaps: use executeBtcSwap (agent HTLC) or btcSignPsbt (browser light peer) ──
      if (quoteData.fromChain === "bitcoin" || quoteData.toChain === "bitcoin") {
        const btcAddress = bitcoin?.address ?? "";
        if (!btcAddress) {
          toast.error("Bitcoin wallet not connected", { description: "Please connect a Bitcoin wallet to execute BTC swaps." });
          setExecutingId(null);
          return;
        }

        toast.loading("Initiating BTC HTLC lock\u2026", { id: "btc-htlc" });
        const result = await executeBtcSwap.mutateAsync({
          senderAddress: btcAddress,
          amountBtc: quoteData.fromChain === "bitcoin" ? quoteData.fromAmount : quoteData.toAmount,
          expiryHours: 24,
          network: "mainnet",
          senderPeerId: myPeerId ?? undefined,
        });
        toast.dismiss("btc-htlc");

        if (result.success) {
          const isDemoStr = result.demo ? " [DEMO]" : "";
          toast.success(`BTC HTLC lock initiated${isDemoStr}`, {
            description: `Tx: ${result.txid?.slice(0, 12)}\u2026`,
          });

          setMessages(prev => prev.map(m =>
            m.id === msgId
              ? { ...m, type: "tx_success" as const, txHash: result.txid ?? "", signedBy: signingWalletForAudit }
              : m
          ));

          addMessage({
            role: "assistant",
            content: result.message ?? `BTC HTLC lock created. ${result.nextStep ?? "Waiting for counterparty."}`,
            type: "text",
          });
        } else {
          addMessage({
            role: "assistant",
            content: result.message ?? "BTC HTLC lock could not be completed. Please try again.",
            type: "error",
          });
        }

        setExecutingId(null);
        return;
      }

      // ── Ethereum swaps: AFOS P2P primary + 1inch fallback ────────────────
      if (quoteData.fromChain === "ethereum" || quoteData.toChain === "ethereum") {
        const ethAddress = ethereum?.address ?? "";
        if (!ethAddress) {
          toast.error("Ethereum wallet not connected", { description: "Please connect an Ethereum wallet (MetaMask or Phantom ETH) to execute ETH swaps." });
          setExecutingId(null);
          return;
        }

        toast.loading("Finding best ETH swap route…", { id: "eth-swap" });
        const ethResult = await executeEthSwap.mutateAsync({
          fromAddress: ethAddress,
          fromToken:   quoteData.fromToken,
          toToken:     quoteData.toToken,
          fromChain:   (quoteData.fromChain as SupportedChain) ?? "ethereum",
          toChain:     (quoteData.toChain   as SupportedChain) ?? "ethereum",
          amount:      quoteData.fromAmount,
          slippage:    1,
          openId,
          senderPeerId: myPeerId ?? undefined,
        });
        toast.dismiss("eth-swap");

        if (!ethResult.success) {
          addMessage({ role: "assistant", content: ethResult.message ?? "ETH swap route unavailable. Please try again.", type: "error" });
          setExecutingId(null);
          return;
        }

        // P2P route: HTLC will be coordinated by LightPeerContext / Oracle VM
        if (ethResult.route === "AFOS P2P") {
          const p2pQ = ethResult.p2pQuote as { peerId?: string; rfqId?: string } | null | undefined;
          toast.success("P2P peer matched!", { description: `Peer: ${p2pQ?.peerId ?? "unknown"}` });
          setMessages(prev => prev.map(m =>
            m.id === msgId ? { ...m, type: "tx_success" as const, txHash: p2pQ?.rfqId ?? "p2p", signedBy: signingWalletForAudit } : m
          ));
          addMessage({
            role: "assistant",
            content: ethResult.nextStep ?? ethResult.message ?? "AFOS P2P peer matched. Coordinating HTLC via Oracle VM.",
            type: "text",
          });
          setExecutingId(null);
          return;
        }

        // 1inch route: sign and broadcast via window.ethereum
        if (ethResult.tx) {
          const rawEth = (window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<string> } }).ethereum;
          if (!rawEth) {
            toast.error("No Ethereum provider", { description: "Install MetaMask or Phantom to sign ETH transactions." });
            setExecutingId(null);
            return;
          }
          toast.loading("Waiting for wallet signature…", { id: "eth-sign" });
          try {
            const txHash = await rawEth.request({
              method: "eth_sendTransaction",
              params: [{
                from:  ethAddress,
                to:    ethResult.tx.to,
                data:  ethResult.tx.data,
                value: ethResult.tx.value,
                ...(ethResult.tx.gas ? { gas: `0x${ethResult.tx.gas.toString(16)}` } : {}),
              }],
            });
            toast.dismiss("eth-sign");
            toast.success("ETH swap submitted!", { description: `Tx: ${txHash.slice(0, 12)}…` });
            setMessages(prev => prev.map(m =>
              m.id === msgId
                ? {
                    ...m,
                    type: "tx_success" as const,
                    txHash,
                    // ETH balances not tracked in WalletContext — show card without balance section
                    balancesAfterSwap: [],
                    signedBy: signingWalletForAudit,
                  }
                : m
            ));
          } catch (ethErr: unknown) {
            toast.dismiss("eth-sign");
            const msg = ethErr instanceof Error ? ethErr.message : String(ethErr);
            if (msg.toLowerCase().includes("user rejected") || msg.toLowerCase().includes("rejected")) {
              toast.info("ETH swap cancelled");
              addMessage({ role: "assistant", content: "ETH swap cancelled. Let me know if you'd like to try again.", type: "text" });
            } else {
              toast.error("ETH swap failed", { description: msg.slice(0, 100) });
              addMessage({ role: "assistant", content: `ETH swap failed: ${msg.slice(0, 150)}`, type: "error" });
            }
          }
          setExecutingId(null);
          return;
        }

        // Fallback: no tx and no P2P
        addMessage({ role: "assistant", content: ethResult.message ?? "ETH swap unavailable at this time.", type: "error" });
        setExecutingId(null);
        return;
      }

      // ── Trac Network (TNK) swaps: AFOS P2P HTLC via executeAgentSwap ──────
      if (quoteData.fromChain === "trac_network" || quoteData.toChain === "trac_network") {
        const btcAddress = bitcoin?.address ?? "";
        if (!btcAddress) {
          toast.error("Trac Network wallet not connected", {
            description: "Please connect your Tap Wallet (BTC+TNK) to execute TNK swaps.",
          });
          setExecutingId(null);
          return;
        }

        toast.loading("Routing TNK swap via AFOS P2P HTLC…", { id: "tnk-swap" });
        const tnkResult = await executeAgentSwap.mutateAsync({
          fromToken:  quoteData.fromToken,
          toToken:    quoteData.toToken,
          amount:     quoteData.fromAmount,
          fromChain:  "trac_network",
          toChain:    (quoteData.toChain as SupportedChain) ?? "bitcoin",
        });
        toast.dismiss("tnk-swap");

        if (tnkResult.success) {
          const isDemoStr = tnkResult.demo ? " [DEMO]" : "";
          toast.success(`TNK swap initiated${isDemoStr}`, {
            description: tnkResult.txHash ? `Tx: ${tnkResult.txHash.slice(0, 14)}…` : "Awaiting counterparty",
          });
          setMessages(prev => prev.map(m =>
            m.id === msgId
              ? { ...m, type: "tx_success" as const, txHash: tnkResult.txHash ?? "pending", signedBy: signingWalletForAudit }
              : m
          ));
          addMessage({
            role: "assistant",
            content: tnkResult.message ?? `TNK swap submitted${isDemoStr}. ${tnkResult.nextStep ?? "Waiting for HTLC settlement."}`,
            type: "text",
          });
        } else {
          addMessage({
            role: "assistant",
            content: tnkResult.message ?? "TNK swap could not be completed. Please try again.",
            type: "error",
          });
        }

        setExecutingId(null);
        return;
      }

      // ── Solana swaps: AFOS P2P primary + Jupiter fallback ──────────────────
      const solResult = await buildSwapTx.mutateAsync({
        quoteResponse: quoteData.quoteResponse,
        userPublicKey: effectivePublicKey!.toString(),
        fromToken:     quoteData.fromToken,
        toToken:       quoteData.toToken,
        fromChain:     (quoteData.fromChain as SupportedChain) ?? "solana",
        toChain:       (quoteData.toChain   as SupportedChain) ?? "solana",
        amount:        quoteData.fromAmount,
        openId,
        // Pass sender's peer identity so the server can: (1) exclude them from peer
        // matching, and (2) attribute the agent_rfq notification correctly.
        senderPeerId: myPeerId ?? undefined,
        senderAlias:  myPeerAlias ?? undefined,
      });

      // P2P route matched: trigger HTLC lock signing for Agent A (the requester)
      console.error("[HTLC-DEBUG] buildSwapTx result", { route: solResult.route, hasP2pQuote: !!solResult.p2pQuote, hasSwapTx: !!solResult.swapTransaction });
      if (solResult.route === "AFOS P2P") {
        const p2p = solResult.p2pQuote;
        const peerLabel = p2p?.peerAlias ?? p2p?.peerId?.slice(0, 8) ?? "peer";
        toast.success("P2P peer matched!", { description: `Peer: @${peerLabel} — signing HTLC lock…` });
        // Update the quote card to tx_success state
        setMessages(prev => prev.map(m =>
          m.id === msgId ? { ...m, type: "tx_success" as const, txHash: p2p?.rfqId ?? "p2p", signedBy: signingWalletForAudit } : m
        ));
        // Inject a live swap progress card so the user can track the flow inside chat
        const progressMsgId = `progress-${p2p?.rfqId ?? Date.now()}`;
        const htlcExpiry = Date.now() + 10 * 60 * 1000; // 10 min default HTLC lock time
        setMessages(prev => [...prev, {
          id: progressMsgId,
          role: "assistant" as const,
          content: "",
          type: "swap_progress" as const,
          timestamp: Date.now(),
          swapProgressData: {
            rfqId: p2p?.rfqId ?? progressMsgId,
            fromAmount: quoteData.fromAmount,
            fromToken: quoteData.fromToken,
            toAmount: p2p?.outAmount ?? quoteData.toAmount,
            toToken: quoteData.toToken,
            phase: "locking" as const,
            peerAlias: peerLabel,
            expiresAt: htlcExpiry,
            rate: p2p?.rate ?? quoteData.rate,
            fromChain: (quoteData.fromChain as string) ?? "solana",
            toChain: (quoteData.toChain as string) ?? "solana",
            startedAt: Date.now(),
          },
        }]);
        setExecutingId(null);
        // Bug 5 fix: trigger HTLC lock signing for Agent A via LightPeerContext
        console.error("[HTLC-DEBUG] About to call initiateHtlcLock", { rfqId: p2p?.rfqId, hasInitiateHtlcLock: typeof initiateHtlcLock });
        if (p2p?.rfqId) {
          void initiateHtlcLock({
            rfqId:             p2p.rfqId,
            fromToken:         quoteData.fromToken,
            toToken:           quoteData.toToken,
            fromChain:         (quoteData.fromChain as string) ?? "solana",
            toChain:           (quoteData.toChain   as string) ?? "solana",
            amount:            quoteData.fromAmount,
            outAmount:         p2p.outAmount ?? quoteData.toAmount,
            rate:              p2p.rate ?? quoteData.rate,
            counterpartyPeerId: p2p.peerId ?? undefined,
            counterpartyWallet: p2p.counterpartyPubKey ?? p2p.counterpartyAddress ?? undefined,
            // Pass the secret hash from buildSwapTx so Agent A locks to the same hash stored in DB
            secretHashHex:     p2p.secretHashHex ?? undefined,
          });
        }
        return;
      }    // Jupiter route: deserialize and send via Solana wallet
      const swapTransaction = solResult.swapTransaction;
      if (!swapTransaction) {
        throw new Error("No swap transaction returned from Jupiter. Please try again.");
      }

      // Deserialize the transaction
      const txBytes = Buffer.from(swapTransaction, "base64");
      const transaction = VersionedTransaction.deserialize(txBytes);

      // Send to wallet for signing and submission
      // Use server-side Solana RPC proxy (routes through Helius) for reliable tx submission
      const solRpcUrl = `${window.location.origin}/api/sol-rpc`;
      const connection = new Connection(solRpcUrl, "confirmed");
      let txHash: string;
      if (sendTransaction && connected) {
        // Standard Solana wallet adapter path
        txHash = await (sendTransaction as (tx: VersionedTransaction, conn: Connection) => Promise<string>)(transaction, connection);
      } else {
        // Phantom multi-chain fallback — use window.solana.signAndSendTransaction
        const phantom = (window as unknown as { solana?: { signAndSendTransaction: (tx: unknown) => Promise<{ signature: string }> } }).solana;
        if (!phantom?.signAndSendTransaction) {
          throw new Error("Phantom wallet not found. Please install Phantom to execute swaps.");
        }
        const { signature } = await phantom.signAndSendTransaction(transaction);
        txHash = signature;
      }

      // Wait for confirmation — poll getSignatureStatus every 3s for up to 90s.
      // This is far more reliable than confirmTransaction which hard-times-out at 30s.
      toast.loading("Confirming transaction…", { id: "swap-confirm" });
      const MAX_SWAP_POLLS = 30; // 30 × 3s = 90s
      let swapConfirmed = false;
      for (let poll = 0; poll < MAX_SWAP_POLLS; poll++) {
        await new Promise(r => setTimeout(r, 3000));
        const statusResp = await connection.getSignatureStatus(txHash, { searchTransactionHistory: true });
        const txStatus = statusResp?.value;
        if (txStatus?.err) throw new Error(`Swap transaction failed on-chain: ${JSON.stringify(txStatus.err)}`);
        if (txStatus?.confirmationStatus === "confirmed" || txStatus?.confirmationStatus === "finalized") {
          swapConfirmed = true;
          break;
        }
      }
      if (!swapConfirmed) {
        const finalResp = await connection.getSignatureStatus(txHash, { searchTransactionHistory: true });
        if (finalResp?.value?.err) throw new Error(`Swap transaction failed on-chain: ${JSON.stringify(finalResp.value.err)}`);
        // If found with any status (even processed), treat as success
        if (!finalResp?.value) throw new Error(`Swap not confirmed after 90s. Check Solscan: ${txHash.slice(0, 16)}…`);
      }
      toast.dismiss("swap-confirm");
      toast.success("Swap confirmed on-chain!", { description: `Tx: ${txHash.slice(0, 8)}…` });

      // Refresh balances so the completion card shows updated amounts
      // refreshBalances() returns the new balances directly so we don't need to wait for state update
      let freshBalances = balances;
      try {
        const updated = await refreshBalances();
        if (updated.length > 0) freshBalances = updated;
      } catch {
        // Non-critical — card will show without balance section
      }

      // Update the message to show success with updated balances embedded
      setMessages(prev => prev.map(m =>
        m.id === msgId
          ? {
              ...m,
              type: "tx_success" as const,
              txHash,
              balancesAfterSwap: freshBalances.map(b => ({
                symbol: b.symbol,
                amount: b.amount,
                usdValue: b.usdValue,
              })),
              signedBy: signingWalletForAudit,
            }
          : m
      ));

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("User rejected") || msg.includes("rejected")) {
        toast.info("Swap cancelled");
        addMessage({ role: "assistant", content: "Swap cancelled. Let me know if you'd like to try again.", type: "text" });
      } else if (msg.toLowerCase().includes("maximum transaction limit") || msg.toLowerCase().includes("exceeds your")) {
        // Extract the blocked amount and limit from the error message if possible
        const amountMatch = msg.match(/\$(\d+(?:\.\d+)?)/g);
        const blockedAmountUsd = amountMatch ? parseFloat(amountMatch[0].replace("$", "")) : 0;
        const limitUsd = amountMatch && amountMatch.length > 1 ? parseFloat(amountMatch[1].replace("$", "")) : 500;
        toast.error("Transaction limit exceeded", { description: "Raise your limit in Settings." });
        addMessage({
          role: "assistant",
          content: "This swap exceeds your configured transaction limit.",
          type: "limit_exceeded",
          limitExceededData: { blockedAmountUsd, limitUsd },
        });
      } else {
        toast.error("Swap failed", { description: msg.slice(0, 100) });
        addMessage({ role: "assistant", content: `Swap failed: ${msg.slice(0, 150)}. Please try again.`, type: "error" });
      }
    } finally {
      setExecutingId(null);
    }
  }, [connected, publicKey, buildSwapTx, executeEthSwap, executeBtcSwap, executeAgentSwap, sendTransaction, addMessage, openWalletForChain, bitcoin, ethereum, initiateHtlcLock, phantomSolAddr, openId, myPeerId, myPeerAlias]);

  const handleCancelSwap = useCallback((msgId: string) => {
    setCancelledIds(prev => { const next = new Set(prev); next.add(msgId); return next; });
    addMessage({ role: "assistant", content: "Swap cancelled. What else can I help you with?", type: "text" });
  }, [addMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--background)" }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between shrink-0"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--card)" }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(139,92,246,0.2))", border: "1px solid rgba(6,182,212,0.3)" }}>
            <Bot className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-foreground">AFOS Agent</p>
              {/* Agent Mode badge — green when both Smart Auto-Accept and Auto-Claim are active */}
              {(() => {
                const isAgentMode = lightPeer.prefs.autoAccept && lightPeer.prefs.autoClaim;
                const isPartial = lightPeer.prefs.autoAccept || lightPeer.prefs.autoClaim;
                if (isAgentMode) return (
                  <span className="flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                    AGENT MODE
                  </span>
                );
                if (isPartial) return (
                  <span className="flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                    SEMI-AUTO
                  </span>
                );
                return null;
              })()}
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-muted-foreground">Autonomous · Gemini 2.5 Flash</span>
            </div>
          </div>
        </div>

        {/* New Chat button + Wallet status */}
        <div className="flex items-center gap-2">
          {/* New Chat button — clears conversation */}
          <button
            onClick={() => {
              clearMessages(anyWalletConnected);
              setCancelledIds(new Set());
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all hover:opacity-80"
            style={{ background: "var(--muted)", border: "1px solid var(--border)", color: "var(--muted-foreground)" }}
            title="Start a new conversation"
          >
            <RefreshCw className="w-3 h-3" />
            New Chat
          </button>

          {/* Wallet status — read-only indicator, no connect button (header has it) */}
          {anyWalletConnected && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
              style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <div className="text-right">
                <p className="text-[10px] font-semibold text-emerald-400">
                  {connected ? walletName : phantomSolAddr ? "Phantom" : ethereum?.address ? "MetaMask" : "Wallet"}
                </p>
                <p className="text-[9px] font-mono text-muted-foreground">
                  {connected ? shortAddress : phantomSolAddr ? `${phantomSolAddr.slice(0, 4)}…${phantomSolAddr.slice(-4)}` : ethereum?.address ? `${ethereum.address.slice(0, 6)}…${ethereum.address.slice(-4)}` : ""}
                </p>
              </div>
              {totalUsd > 0 && (
                <span className="text-[10px] font-bold text-foreground ml-1">${totalUsd.toFixed(2)}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Subtle hint when not connected — no button, header has the connect action */}
        {!anyWalletConnected && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl px-4 py-3 flex items-center gap-2.5"
            style={{ background: "rgba(153,69,255,0.06)", border: "1px solid rgba(153,69,255,0.15)" }}>
            <Wallet className="w-3.5 h-3.5 shrink-0" style={{ color: "#9945FF" }} />
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Wallet not connected.</span> Use the Connect button above to execute swaps. You can still get quotes.
            </p>
          </motion.div>
        )}

        {/* Message list */}
        {messages.map(msg => (
          !cancelledIds.has(msg.id) || msg.type !== "quote_card" ? (
            <MessageBubble
              key={msg.id}
              msg={msg}
              onConfirmSwap={handleConfirmSwap}
              onCancelSwap={handleCancelSwap}
              executingId={executingId}
              onRequestConnect={openWalletForChain}
              tnkPeerCount={remotePeers.filter(p => p.pairs.some(pair => pair.toUpperCase().includes("TNK"))).length}
              anyWalletConnected={anyWalletConnected}
              onAcceptRfq={(rfqId, fromToken, toToken, amount, outAmount) => {
                const text = `accept swap ${amount.toFixed(4)} ${fromToken} for ${outAmount.toFixed(4)} ${toToken} rfq:${rfqId}`;
                handleSend(text);
              }}
              onDeclineRfq={(rfqId) => {
                handleSend(`decline swap rfq:${rfqId}`);
              }}
              onClaimHtlc={lightPeer.claimHtlcFunds}
              htlcRevealedSecrets={lightPeer.htlcRevealedSecrets}
              claimedRfqIds={lightPeer.claimedRfqIds}
              onRefundHtlc={lightPeer.refundHtlcFunds}
              refundableHtlcs={lightPeer.refundableHtlcs}
              refundedRfqIds={lightPeer.refundedRfqIds}
              htlcLockedAt={lightPeer.htlcLockedAt}
              onSwapAgain={() => {
                setInput("swap ");
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
              bitcoinTap={bitcoinTap}
              preferredBtcWallet={preferredBtcWallet}
              setPreferredBtcWallet={setPreferredBtcWallet}
            />
          ) : null
        ))}

        {/* Typing indicator */}
        <AnimatePresence>
          {isTyping && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="flex gap-3"
            >
              <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(139,92,246,0.2))", border: "1px solid rgba(6,182,212,0.3)" }}>
                <Bot className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-1.5"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={messagesEndRef} />
      </div>

      {/* Suggestion chips — only when a wallet is connected and few messages */}
      {anyWalletConnected && messages.length <= 2 && (
        <div className="px-4 pb-2 flex gap-2 overflow-x-auto scrollbar-hide">
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              onClick={() => handleSend(s)}
              className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all hover:opacity-80"
              style={{ background: "var(--muted)", border: "1px solid var(--border)", color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input area — gated behind wallet connection */}
      {anyWalletConnected ? (
        <div className="px-4 pb-4 pt-2 shrink-0"
          style={{ borderTop: "1px solid var(--border)" }}>
          <div className="flex gap-2 items-end">
            <div className="flex-1 rounded-2xl overflow-hidden flex items-center gap-2 px-4 py-3"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <Sparkles className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="swap 1 USDT to SOL…"
                disabled={isTyping}
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 outline-none"
              />
              {/* Emoji picker */}
              <div className="relative shrink-0" ref={emojiPickerRef}>
                <button
                  type="button"
                  onClick={() => setShowEmoji(v => !v)}
                  className="text-[16px] leading-none opacity-50 hover:opacity-90 transition-opacity"
                  title="Add emoji"
                  tabIndex={-1}
                >
                  😊
                </button>
                {showEmoji && (
                  <div
                    className="absolute bottom-8 right-0 z-50"
                    style={{ filter: 'drop-shadow(0 4px 24px rgba(0,0,0,0.6))' }}
                  >
                    <Picker
                      data={data}
                      theme="dark"
                      previewPosition="none"
                      skinTonePosition="none"
                      set="native"
                      onEmojiSelect={(emoji: { native: string }) => {
                        setInput(v => v + emoji.native);
                        setShowEmoji(false);
                        inputRef.current?.focus();
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isTyping}
              className="w-11 h-11 rounded-2xl flex items-center justify-center transition-all shrink-0"
              style={{
                background: input.trim() && !isTyping
                  ? "linear-gradient(135deg, #06b6d4, #8b5cf6)"
                  : "var(--muted)",
                opacity: input.trim() && !isTyping ? 1 : 0.5,
              }}>
              {isTyping ? (
                <Loader2 className="w-4 h-4 text-foreground animate-spin" />
              ) : (
                <Send className="w-4 h-4 text-white" />
              )}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground text-center mt-2">
            AFOS never holds your keys · All swaps are self-custodial · Powered by AFOS P2P · Jupiter · 0x Protocol · 1inch
          </p>
        </div>
      ) : (
        /* Connect Wallet prompt — shown when no wallet is connected */
        <div className="px-4 pb-5 pt-3 shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="rounded-2xl p-5 flex flex-col items-center gap-3 text-center"
            style={{ background: "color-mix(in srgb, var(--foreground) 4%, var(--background))", border: "1px solid var(--border)" }}>
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, rgba(6,182,212,0.15), rgba(139,92,246,0.15))", border: "1px solid rgba(6,182,212,0.3)" }}>
              <Wallet className="w-6 h-6 text-cyan-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Connect a wallet to start</p>
              <p className="text-xs text-muted-foreground mt-1">You need a wallet to ask questions or request swaps</p>
            </div>
            <button
              onClick={() => { setWalletModalChain("solana"); setShowWalletModal(true); }}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.97] hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #06b6d4, #8b5cf6)", color: "white" }}>
              Connect Wallet
            </button>
            <p className="text-[10px] text-muted-foreground">
              Supports {SUPPORTED_WALLETS_TEXT} · Non-custodial
            </p>
          </div>
        </div>
      )}
      <ConnectWalletModal
        open={showWalletModal}
        onClose={() => setShowWalletModal(false)}
        defaultChain={walletModalChain}
      />
    </div>
  );
}
