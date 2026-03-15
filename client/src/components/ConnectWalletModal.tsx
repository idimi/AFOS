/**
 * ConnectWalletModal — Multi-chain wallet connection
 *
 * AFOS supports exactly 3 wallets:
 * ┌────────────┬────────┬──────────┬─────────┬────────────┐
 * │ Wallet     │ Solana │ Ethereum │ Bitcoin │ Trac/TNK   │
 * ├────────────┼────────┼──────────┼─────────┼────────────┤
 * │ Phantom    │   ✅   │    ✅    │   ✅    │     —      │
 * │ MetaMask   │   ✅   │    ✅    │   ✅    │     —      │
 * │ Tap Wallet │   —    │    —     │   ✅    │     ✅      │
 * └────────────┴────────┴──────────┴─────────┴────────────┘
 *
 * Conflict-free namespace isolation:
 *   Phantom   → window.phantom.{solana,ethereum,bitcoin}
 *   MetaMask  → window.ethereum (EIP-1193) + CAIP-25 bip122 for BTC
 *   Tap Wallet → window.tapprotocol (BTC) + window.tracnetwork (TNK)
 *
 * Removed: Coinbase Wallet, Solflare, Xverse
 */

import { useState, useEffect, useRef } from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { useWallet } from "@/contexts/WalletContext";
import { useMultiChainWallet } from "@/contexts/MultiChainWalletContext";
import { motion, AnimatePresence } from "framer-motion";
import { X, Wallet, CheckCircle2, ExternalLink, Loader2, Zap, Globe } from "lucide-react";
import { toast } from "sonner";
import type { SupportedChain } from "@shared/const";

// ─── Wallet logos ─────────────────────────────────────────────────────────────

const PHANTOM_ICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDgiIGhlaWdodD0iMTA4IiB2aWV3Qm94PSIwIDAgMTA4IDEwOCIgZmlsbD0ibm9uZSI+CjxyZWN0IHdpZHRoPSIxMDgiIGhlaWdodD0iMTA4IiByeD0iMjYiIGZpbGw9IiNBQjlGRjIiLz4KPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik00Ni41MjY3IDY5LjkyMjlDNDIuMDA1NCA3Ni44NTA5IDM0LjQyOTIgODUuNjE4MiAyNC4zNDggODUuNjE4MkMxOS41ODI0IDg1LjYxODIgMTUgODMuNjU2MyAxNSA3NS4xMzQyQzE1IDUzLjQzMDUgNDQuNjMyNiAxOS44MzI3IDcyLjEyNjggMTkuODMyN0M4Ny43NjggMTkuODMyNyA5NCAzMC42ODQ2IDk0IDQzLjAwNzlDOTQgNTguODI1OCA4My43MzU1IDc2LjkxMjIgNzMuNTMyMSA3Ni45MTIyQzcwLjI5MzkgNzYuOTEyMiA2OC43MDUzIDc1LjEzNDIgNjguNzA1MyA3Mi4zMTRDNjguNzA1MyA3MS41NzgzIDY4LjgyNzUgNzAuNzgxMiA2OS4wNzE5IDY5LjkyMjlDNjUuNTg5MyA3NS44Njk5IDU4Ljg2ODUgODEuMzg3OCA1Mi41NzU0IDgxLjM4NzhDNDcuOTkzIDgxLjM4NzggNDUuNjcxMyA3OC41MDYzIDQ1LjY3MTMgNzQuNDU5OEM0NS42NzEzIDcyLjk4ODQgNDUuOTc2OCA3MS40NTU2IDQ2LjUyNjcgNjkuOTIyOVpNODMuNjc2MSA0Mi41Nzk0QzgzLjY3NjEgNDYuMTcwNCA4MS41NTc1IDQ3Ljk2NTggNzkuMTg3NSA0Ny45NjU4Qzc2Ljc4MTYgNDcuOTY1OCA3NC42OTg5IDQ2LjE3MDQgNzQuNjk4OSA0Mi41Nzk0Qzc0LjY5ODkgMzguOTg4NSA3Ni43ODE2IDM3LjE5MzEgNzkuMTg3NSAzNy4xOTMxQzgxLjU1NzUgMzcuMTkzMSA4My42NzYxIDM4Ljk4ODUgODMuNjc2MSA0Mi41Nzk0Wk03MC4yMTAzIDQyLjU3OTVDNzAuMjEwMyA0Ni4xNzA0IDY4LjA5MTYgNDcuOTY1OCA2NS43MjE2IDQ3Ljk2NThDNjMuMzE1NyA0Ny45NjU4IDYxLjIzMyA0Ni4xNzA0IDYxLjIzMyA0Mi41Nzk1QzYxLjIzMyAzOC45ODg1IDYzLjMxNTcgMzcuMTkzMSA2NS43MjE2IDM3LjE5MzFDNjguMDkxNiAzNy4xOTMxIDcwLjIxMDMgMzguOTg4NSA3MC4yMTAzIDQyLjU3OTVaIiBmaWxsPSIjRkZGREY4Ii8+Cjwvc3ZnPg==";
// Removed: SOLFLARE_ICON, COINBASE_ICON, XVERSE_ICON
const METAMASK_ICON = "https://d2xsxph8kpxj0f.cloudfront.net/87744282/Cv4Jvx35N7jGsqrM8y5HAD/metamask-fox-v3_3ab72414.png";
const TAP_ICON = "https://d2xsxph8kpxj0f.cloudfront.net/87744282/Cv4Jvx35N7jGsqrM8y5HAD/tap-wallet-official_fa717684.png";

// ─── Chain config ─────────────────────────────────────────────────────────────

type ChainTab = SupportedChain;

const CHAIN_TABS: { id: ChainTab; label: string; color: string; accent: string; emoji: string }[] = [
  { id: "trac_network", label: "Trac Network", color: "#F97316", accent: "rgba(249,115,22,0.15)",  emoji: "⬡" },
  { id: "solana",       label: "Solana",       color: "#9945FF", accent: "rgba(153,69,255,0.15)",  emoji: "◎" },
  { id: "ethereum",     label: "Ethereum",     color: "#627EEA", accent: "rgba(98,126,234,0.15)",  emoji: "⟠" },
  { id: "bitcoin",      label: "Bitcoin",      color: "#F7931A", accent: "rgba(247,147,26,0.15)",  emoji: "₿" },
];

// Chain dots for multi-chain badge
const CHAIN_DOTS: Record<ChainTab, string> = {
  solana:       "#9945FF",
  ethereum:     "#627EEA",
  bitcoin:      "#F7931A",
  trac_network: "#F97316",
};

// ─── Custom toast renderer for wallet connection ───────────────────────────────

/** Per-chain address entry shown in the unified toast */
type ChainAddress = { chain: ChainTab; address: string };

function WalletConnectedToast({
  walletName,
  chainAddresses,
}: {
  walletName: string;
  chainAddresses: ChainAddress[];
}) {
  const CHAIN_LABELS: Record<ChainTab, string> = { solana: "Solana", ethereum: "Ethereum", bitcoin: "Bitcoin", trac_network: "Trac Network" };
  return (
    <div className="flex items-start gap-3">
      {/* Green check circle */}
      <div
        className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5"
        style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)" }}
      >
        <CheckCircle2 className="w-4 h-4" style={{ color: "#10b981" }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold" style={{ color: "var(--foreground)" }}>
          {walletName} connected
        </p>
        {/* Per-chain address rows */}
        <div className="mt-1.5 flex flex-col gap-1">
          {chainAddresses.map(({ chain, address }) => (
            <div key={chain} className="flex items-center gap-1.5">
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
                style={{
                  background: `${CHAIN_DOTS[chain]}22`,
                  color: CHAIN_DOTS[chain],
                  border: `1px solid ${CHAIN_DOTS[chain]}44`,
                }}
              >
                {CHAIN_LABELS[chain]}
              </span>
              {address && (
                <span className="text-[11px] font-mono truncate" style={{ color: "var(--muted-foreground)" }}>
                  {address}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Fire a rich wallet-disconnected toast — shows which chains were dropped */
export function showWalletDisconnectedToast(walletName: string, chains: ChainTab[]) {
  const CHAIN_LABELS: Record<ChainTab, string> = { solana: "Solana", ethereum: "Ethereum", bitcoin: "Bitcoin", trac_network: "Trac Network" };
  toast.custom(
    () => (
      <div
        className="w-full max-w-sm rounded-xl px-4 py-3 shadow-lg"
        style={{
          background: "var(--popover)",
          border: "1px solid rgba(100,116,139,0.35)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08)",
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5"
            style={{ background: "rgba(100,116,139,0.15)", border: "1px solid rgba(100,116,139,0.3)" }}
          >
            <Wallet className="w-4 h-4" style={{ color: "#94a3b8" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold" style={{ color: "var(--foreground)" }}>
              {walletName} disconnected
            </p>
            <div className="mt-1.5 flex items-center gap-1 flex-wrap">
              {chains.map(chain => (
                <span
                  key={chain}
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                  style={{
                    background: `${CHAIN_DOTS[chain]}18`,
                    color: `${CHAIN_DOTS[chain]}99`,
                    border: `1px solid ${CHAIN_DOTS[chain]}30`,
                    textDecoration: "line-through",
                  }}
                >
                  {CHAIN_LABELS[chain]}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    ),
    { duration: 3000 }
  );
}

/** Fire a "BTC wallet switched" toast when preferredBtcWallet auto-falls-back on disconnect */
export function showBtcWalletSwitchedToast(newWalletName: string) {
  toast.custom(
    () => (
      <div
        className="w-full max-w-sm rounded-xl px-4 py-3 shadow-lg"
        style={{
          background: "var(--popover)",
          border: "1px solid rgba(245,158,11,0.35)",
          boxShadow: "0 4px 24px rgba(245,158,11,0.12), 0 1px 4px rgba(0,0,0,0.08)",
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5"
            style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)" }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>₿</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold" style={{ color: "var(--foreground)" }}>
              BTC wallet switched
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              Now signing with <span className="font-semibold" style={{ color: "#f59e0b" }}>{newWalletName}</span>
            </p>
          </div>
        </div>
      </div>
    ),
    { duration: 3500 }
  );
}

/** Fire a rich wallet-connected toast — shows all connected chain addresses in one card */
export function showWalletConnectedToast(walletName: string, chainAddresses: ChainAddress[]) {
  toast.custom(
    () => (
      <div
        className="w-full max-w-sm rounded-xl px-4 py-3 shadow-lg"
        style={{
          background: "var(--popover)",
          border: "1px solid rgba(16,185,129,0.35)",
          boxShadow: "0 4px 24px rgba(16,185,129,0.12), 0 1px 4px rgba(0,0,0,0.08)",
        }}
      >
        <WalletConnectedToast walletName={walletName} chainAddresses={chainAddresses} />
      </div>
    ),
    { duration: 5000 }
  );
}

interface ConnectWalletModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-select a chain tab when opening */
  defaultChain?: ChainTab;
}

export default function ConnectWalletModal({ open, onClose, defaultChain = "trac_network" }: ConnectWalletModalProps) {
  const [activeChain, setActiveChain] = useState<ChainTab>(defaultChain);
  // Success overlay state: null = hidden, otherwise holds the connection info to display
  const [successState, setSuccessState] = useState<{
    walletName: string;
    chains: ChainTab[];
    address: string;
    accentColor: string;
  } | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync active tab when modal opens with a new defaultChain
  useEffect(() => {
    if (open) {
      setActiveChain(defaultChain);
      setSuccessState(null);
    }
  }, [open, defaultChain]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  /**
   * Show the in-modal success overlay and auto-close.
   * NOTE: Toast is intentionally NOT fired here.
   * WalletToastManager (App.tsx) is mounted once globally and handles all toasts.
   * This prevents duplicate toasts when multiple ConnectWalletModal instances are
   * mounted simultaneously (Dashboard + ChatPage / Swaps / AgentSettings).
   */
  const showSuccessAndClose = (
    walletName: string,
    chainAddresses: { chain: ChainTab; address: string }[],
    accentColor: string
  ) => {
    const chains = chainAddresses.map(ca => ca.chain);
    const address = chainAddresses[0]?.address ?? "";
    setSuccessState({ walletName, chains, address, accentColor });
    dismissTimerRef.current = setTimeout(() => {
      setSuccessState(null);
      onClose();
    }, 1600);
  };

  // Solana
  const { connected: solAdapterConnected, walletName: solWalletName, shortAddress: solShortAddr, balances, totalUsd, disconnect: solDisconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const { publicKey } = useSolanaWallet();

  // Ethereum + Bitcoin + Phantom multi-chain
  const {
    ethereum, bitcoin, bitcoinTap, tracNetwork,
    phantomMultiChain, phantomBtcBalance,
    preferredBtcWallet, setPreferredBtcWallet,
    connectEthereum, connectBitcoin,
    connectPhantomMultiChain,
    disconnectEthereum, disconnectBitcoin, disconnectTracNetwork,
    disconnectPhantom,
    ethConnecting, btcConnecting, phantomConnecting,
  } = useMultiChainWallet();

  // Solana is connected if the standard adapter is connected OR if Phantom multi-chain has a Solana address
  const phantomSolAddr = phantomMultiChain?.solanaAddress;
  const solConnected = solAdapterConnected || !!phantomSolAddr;
  // When Phantom multi-chain is used, derive display values from its state
  const effectiveSolWalletName = solAdapterConnected ? solWalletName : (phantomSolAddr ? "Phantom" : null);
  const effectiveSolShortAddr = solAdapterConnected
    ? solShortAddr
    : phantomSolAddr
    ? `${phantomSolAddr.slice(0, 4)}…${phantomSolAddr.slice(-4)}`
    : null;
  const effectiveSolExplorerUrl = solAdapterConnected && publicKey
    ? `https://solscan.io/account/${publicKey.toString()}`
    : phantomSolAddr
    ? `https://solscan.io/account/${phantomSolAddr}`
    : undefined;
  // Balances: use adapter balances when adapter-connected, else use Phantom multi-chain RPC-fetched balances
  const effectiveSolBalances = solAdapterConnected
    ? balances.map(b => ({ symbol: b.symbol, amount: b.amount, usdValue: b.usdValue }))
    : phantomSolAddr && phantomMultiChain?.solanaBalances
    ? phantomMultiChain.solanaBalances
    : phantomSolAddr
    ? [{ symbol: "SOL", amount: "…", usdValue: 0 }]  // loading state
    : [];
  const effectiveSolTotalUsd = solAdapterConnected
    ? totalUsd
    : phantomMultiChain?.solanaTotalUsd ?? 0;

  // ── In-modal success overlay watchers ──────────────────────────────────────
  // These watchers ONLY trigger the visual success overlay inside the modal.
  // Toasts are handled exclusively by WalletToastManager in App.tsx (mounted once)
  // to prevent duplicate toasts when multiple ConnectWalletModal instances are
  // mounted simultaneously (Dashboard + ChatPage / Swaps / AgentSettings).

  // Phantom multi-chain → overlay when modal is open
  const prevPhantomRef = useRef(phantomMultiChain?.connected ?? false);
  useEffect(() => {
    const wasConnected = prevPhantomRef.current;
    const isNowConnected = phantomMultiChain?.connected ?? false;
    prevPhantomRef.current = isNowConnected;
    if (!wasConnected && isNowConnected && open && !successState) {
      const chainAddresses: { chain: ChainTab; address: string }[] = [];
      if (phantomMultiChain?.solanaAddress) {
        const a = phantomMultiChain.solanaAddress;
        chainAddresses.push({ chain: "solana", address: `${a.slice(0, 4)}…${a.slice(-4)}` });
      }
      if (phantomMultiChain?.ethereumAddress) {
        const a = phantomMultiChain.ethereumAddress;
        chainAddresses.push({ chain: "ethereum", address: `${a.slice(0, 6)}…${a.slice(-4)}` });
      }
      if (phantomMultiChain?.bitcoinAddress) {
        const a = phantomMultiChain.bitcoinAddress;
        chainAddresses.push({ chain: "bitcoin", address: `${a.slice(0, 6)}…${a.slice(-4)}` });
      }
      showSuccessAndClose("Phantom", chainAddresses, "#AB9FF2");
    }
  }, [phantomMultiChain?.connected, open]);

  // Ethereum → overlay when modal is open (non-Phantom)
  const prevEthRef = useRef(ethereum?.connected ?? false);
  useEffect(() => {
    const wasConnected = prevEthRef.current;
    const isNowConnected = ethereum?.connected ?? false;
    prevEthRef.current = isNowConnected;
    if (!wasConnected && isNowConnected && open && !successState && !ethereum?.isPhantom) {
      showSuccessAndClose(
        ethereum?.walletName ?? "Ethereum Wallet",
        [{ chain: "ethereum", address: ethereum?.shortAddress ?? "" }],
        "#627EEA"
      );
    }
  }, [ethereum?.connected, open]);

  // Bitcoin → overlay when modal is open (non-Phantom, non-Tap Wallet)
  const prevBtcRef = useRef(bitcoin?.connected ?? false);
  useEffect(() => {
    const wasConnected = prevBtcRef.current;
    const isNowConnected = bitcoin?.connected ?? false;
    prevBtcRef.current = isNowConnected;
    const isTapWalletBtc = bitcoin?.walletName === "Tap Wallet";
    if (!wasConnected && isNowConnected && open && !successState && !bitcoin?.isPhantom && !isTapWalletBtc) {
      showSuccessAndClose(
        bitcoin?.walletName ?? "Bitcoin Wallet",
        [{ chain: "bitcoin", address: bitcoin?.shortAddress ?? "" }],
        "#F7931A"
      );
    }
  }, [bitcoin?.connected, open]);

  // Tap Wallet (BTC + TNK) → overlay when modal is open
  // Uses 150ms delay so both bitcoin and tracNetwork state have flushed
  // (TNK connects first, BTC connects ~50ms later in connectTapWallet).
  const prevTnkRef = useRef(tracNetwork?.connected ?? false);
  useEffect(() => {
    const wasConnected = prevTnkRef.current;
    const isNowConnected = tracNetwork?.connected ?? false;
    prevTnkRef.current = isNowConnected;
    if (!wasConnected && isNowConnected && open && !successState) {
      const id = setTimeout(() => {
        const chainAddresses: { chain: ChainTab; address: string }[] = [];
        if (bitcoin?.connected && bitcoin.walletName === "Tap Wallet" && bitcoin.shortAddress) {
          chainAddresses.push({ chain: "bitcoin", address: bitcoin.shortAddress });
        }
        if (tracNetwork?.shortAddress) {
          chainAddresses.push({ chain: "trac_network", address: tracNetwork.shortAddress });
        }
        if (chainAddresses.length > 0) {
          showSuccessAndClose("Tap Wallet", chainAddresses, "#F97316");
        }
      }, 150);
      return () => clearTimeout(id);
    }
  }, [tracNetwork?.connected, open]);

  const handleSolanaConnect = () => {
    onClose();
    setTimeout(() => setVisible(true), 100);
  };

  const handleSolanaDisconnect = async () => {
    await solDisconnect();
    onClose();
  };

  const chainConfig = CHAIN_TABS.find(c => c.id === activeChain)!;

  // Is Phantom connected on the current chain?
  const phantomConnectedOnChain = phantomMultiChain?.connected && (
    (activeChain === "solana" && solConnected && solWalletName?.toLowerCase().includes("phantom")) ||
    (activeChain === "ethereum" && ethereum?.isPhantom) ||
    (activeChain === "bitcoin" && bitcoin?.isPhantom)
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(10px)" }}
          onClick={e => e.target === e.currentTarget && !successState && onClose()}
        >
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl overflow-hidden relative"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            {/* ── Success overlay ── */}
            <AnimatePresence>
              {successState && (
                <motion.div
                  key="success-overlay"
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.04 }}
                  transition={{ type: "spring", stiffness: 400, damping: 28 }}
                  className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 px-6"
                  style={{
                    background: "var(--card)",
                    borderRadius: "inherit",
                  }}
                >
                  {/* Animated ring + check */}
                  <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 22, delay: 0.05 }}
                    className="relative flex items-center justify-center"
                  >
                    {/* Outer glow ring */}
                    <motion.div
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1.15, opacity: 0 }}
                      transition={{ duration: 0.8, ease: "easeOut", delay: 0.1 }}
                      className="absolute w-24 h-24 rounded-full"
                      style={{ background: `${successState.accentColor}30` }}
                    />
                    {/* Inner circle */}
                    <div
                      className="w-20 h-20 rounded-full flex items-center justify-center"
                      style={{
                        background: `${successState.accentColor}18`,
                        border: `2px solid ${successState.accentColor}55`,
                        boxShadow: `0 0 32px ${successState.accentColor}30`,
                      }}
                    >
                      <motion.div
                        initial={{ scale: 0, rotate: -30 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ type: "spring", stiffness: 600, damping: 20, delay: 0.1 }}
                      >
                        <CheckCircle2 className="w-10 h-10" style={{ color: successState.accentColor }} />
                      </motion.div>
                    </div>
                  </motion.div>

                  {/* Text */}
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.18 }}
                    className="text-center space-y-2"
                  >
                    <p className="text-lg font-bold text-foreground">{successState.walletName} connected</p>
                    {/* Chain chips */}
                    <div className="flex items-center justify-center gap-1.5 flex-wrap">
                      {successState.chains.map(c => (
                        <span
                          key={c}
                          className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                          style={{
                            background: `${CHAIN_DOTS[c]}20`,
                            color: CHAIN_DOTS[c],
                            border: `1px solid ${CHAIN_DOTS[c]}40`,
                          }}
                        >
                          {c === "solana" ? "Solana" : c === "ethereum" ? "Ethereum" : c === "trac_network" ? "Trac Network" : "Bitcoin"}
                        </span>
                      ))}
                    </div>
                    {successState.address && (
                      <p className="text-xs font-mono text-muted-foreground">{successState.address}</p>
                    )}
                  </motion.div>

                  {/* Progress bar */}
                  <motion.div
                    className="w-full max-w-[160px] h-0.5 rounded-full overflow-hidden"
                    style={{ background: "var(--border)" }}
                  >
                    <motion.div
                      initial={{ width: "0%" }}
                      animate={{ width: "100%" }}
                      transition={{ duration: 1.5, ease: "linear" }}
                      className="h-full rounded-full"
                      style={{ background: successState.accentColor }}
                    />
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Drag handle (mobile) */}
            <div className="flex justify-center pt-3 pb-1 sm:hidden">
              <div className="w-10 h-1 rounded-full" style={{ background: "var(--border)" }} />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-3 pb-4 sm:pt-4"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: chainConfig.accent, border: `1px solid ${chainConfig.color}40` }}>
                  <Wallet className="w-4.5 h-4.5" style={{ color: chainConfig.color }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">Connect Wallet</p>
                  <p className="text-[11px] text-muted-foreground">Multi-chain · Self-custodial</p>
                </div>
              </div>
              <button onClick={onClose}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                style={{ background: "var(--muted)" }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Chain tabs */}
            <div className="flex gap-1 px-5 pt-4 pb-2">
              {CHAIN_TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveChain(tab.id)}
                  className="flex-1 py-1.5 rounded-xl text-xs font-semibold transition-all"
                  style={{
                    background: activeChain === tab.id ? tab.accent : "var(--muted)",
                    color: activeChain === tab.id ? tab.color : "var(--muted-foreground)",
                    border: `1px solid ${activeChain === tab.id ? tab.color + "40" : "var(--border)"}`,
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="p-5 pt-3 space-y-3">

              {/* ── Tap Wallet multi-chain banner (shown when Tap Wallet is connected) ── */}
              {(tracNetwork?.connected || (bitcoin?.connected && bitcoin.walletName === "Tap Wallet")) && (
                <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl"
                  style={{ background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.25)" }}>
                  <img src={TAP_ICON} alt="Tap Wallet" className="w-5 h-5 rounded-md shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold text-foreground">Tap Wallet connected</p>
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                      {bitcoin?.connected && bitcoin.walletName === "Tap Wallet" && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                          style={{ background: `${CHAIN_DOTS.bitcoin}18`, color: CHAIN_DOTS.bitcoin }}>
                          Bitcoin
                        </span>
                      )}
                      {tracNetwork?.connected && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                          style={{ background: `${CHAIN_DOTS.trac_network}18`, color: CHAIN_DOTS.trac_network }}>
                          Trac Network
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => { disconnectTracNetwork(); }}
                    className="text-[10px] text-red-400 hover:text-red-300 font-semibold px-2 py-1 rounded-lg transition-colors"
                    style={{ background: "rgba(239,68,68,0.08)" }}>
                    Disconnect
                  </button>
                </div>
              )}

              {/* ── Phantom multi-chain banner (shown when Phantom is connected across chains) ── */}
              {phantomMultiChain?.connected && (
                <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl"
                  style={{ background: "rgba(171,159,242,0.1)", border: "1px solid rgba(171,159,242,0.25)" }}>
                  <img src={PHANTOM_ICON} alt="Phantom" className="w-5 h-5 rounded-md shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold text-foreground">Phantom connected</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      {phantomMultiChain.chains.map(c => (
                        <span key={c} className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                          style={{ background: `${CHAIN_DOTS[c as ChainTab]}18`, color: CHAIN_DOTS[c as ChainTab] }}>
                          {c === "solana" ? "Solana" : c === "ethereum" ? "Ethereum" : c === "trac_network" ? "Trac Network" : "Bitcoin"}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={disconnectPhantom}
                    className="text-[10px] text-red-400 hover:text-red-300 font-semibold px-2 py-1 rounded-lg transition-colors"
                    style={{ background: "rgba(239,68,68,0.08)" }}>
                    Disconnect
                  </button>
                </div>
              )}

              {/* ── SOLANA ── */}
              {activeChain === "solana" && (
                solConnected ? (
                  <ConnectedCard
                    walletName={effectiveSolWalletName || "Phantom"}
                    shortAddress={effectiveSolShortAddr ?? ""}
                    explorerUrl={effectiveSolExplorerUrl}
                    balances={effectiveSolBalances}
                    totalUsd={effectiveSolTotalUsd}
                    accentColor="#9945FF"
                    onDisconnect={phantomSolAddr && !solAdapterConnected ? disconnectPhantom : handleSolanaDisconnect}
                  />
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground text-center py-1">
                      Connect your Solana wallet to swap via AFOS P2P.
                    </p>

                    {/* Phantom — multi-chain */}
                    <PhantomMultiChainButton
                      loading={phantomConnecting}
                      onClick={connectPhantomMultiChain}
                    />

                    {/* MetaMask — multi-chain: SOL + ETH + BTC (second position) */}
                    <WalletButton
                      icon={METAMASK_ICON}
                      name="MetaMask"
                      desc="Native BTC · ETH · SOL · Multichain"
                      chains={["solana", "ethereum", "bitcoin"]}
                      accentColor="#F6851B"
                      bg="rgba(246,133,27,0.08)"
                      border="rgba(246,133,27,0.2)"
                      onClick={handleSolanaConnect}
                    />

                    <PrimaryCTA
                      label="Connect Solana Wallet"
                      gradient="linear-gradient(135deg,#9945FF 0%,#14F195 100%)"
                      shadow="rgba(153,69,255,0.3)"
                      onClick={handleSolanaConnect}
                    />
                  </>
                )
              )}

              {/* ── ETHEREUM ── */}
              {activeChain === "ethereum" && (
                ethereum?.connected ? (
                  <ConnectedCard
                    walletName={ethereum.walletName}
                    shortAddress={ethereum.shortAddress}
                    explorerUrl={`https://etherscan.io/address/${ethereum.address}`}
                    balances={[{ symbol: "ETH", amount: ethereum.balance, usdValue: ethereum.balanceUsd }]}
                    totalUsd={ethereum.balanceUsd}
                    accentColor="#627EEA"
                    onDisconnect={ethereum.isPhantom ? disconnectPhantom : disconnectEthereum}
                  />
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground text-center py-1">
                      Connect your Ethereum wallet to swap via AFOS P2P.
                    </p>

                    {/* Phantom — multi-chain */}
                    <PhantomMultiChainButton
                      loading={phantomConnecting}
                      onClick={connectPhantomMultiChain}
                    />

                    {/* MetaMask — multi-chain: SOL + ETH + BTC */}
                    <WalletButton
                      icon={METAMASK_ICON}
                      name="MetaMask"
                      desc="Native BTC · ETH · SOL · Multichain"
                      chains={["solana", "ethereum", "bitcoin"]}
                      accentColor="#F6851B"
                      bg="rgba(246,133,27,0.1)"
                      border="rgba(246,133,27,0.25)"
                      loading={ethConnecting}
                      onClick={() => connectEthereum("metamask")}
                    />

                    <PrimaryCTA
                      label="Connect Ethereum Wallet"
                      gradient="linear-gradient(135deg,#627EEA 0%,#A78BFA 100%)"
                      shadow="rgba(98,126,234,0.3)"
                      onClick={() => connectEthereum("metamask")}
                      loading={ethConnecting}
                    />
                  </>
                )
              )}

              {/* ── TRAC NETWORK ── */}
              {activeChain === "trac_network" && (
                tracNetwork?.connected ? (
                  <ConnectedCard
                    walletName={tracNetwork.walletName}
                    shortAddress={tracNetwork.shortAddress}
                    explorerUrl={`https://explorer.trac.network/address/${tracNetwork.address}`}
                    balances={[
                      // Only show TNK balance on Trac Network tab — BTC balance belongs on the Bitcoin tab
                      { symbol: "TNK", amount: tracNetwork.balance, usdValue: tracNetwork.balanceUsd },
                    ]}
                    totalUsd={tracNetwork.balanceUsd}
                    accentColor="#F97316"
                    onDisconnect={disconnectTracNetwork}
                  />
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground text-center py-1">
                      Connect your Tap Wallet to swap TNK via AFOS P2P.
                    </p>

                    {/* Tap Wallet — BTC + TNK (Trac Network) */}
                    <WalletButton
                      icon={TAP_ICON}
                      name="Tap Wallet"
                      desc="The native wallet for Trac Network"
                      chains={["bitcoin", "trac_network"]}
                      customChips={[
                        { label: "BTC", color: "#F7931A" },
                        { label: "TNK", color: "#F97316" },
                      ]}
                      accentColor="#F97316"
                      bg="rgba(249,115,22,0.08)"
                      border="rgba(249,115,22,0.25)"
                      loading={btcConnecting}
                      onClick={() => connectBitcoin("tap")}
                    />

                    <PrimaryCTA
                      label="Connect Tap Wallet"
                      gradient="linear-gradient(135deg,#F97316 0%,#FBBF24 100%)"
                      shadow="rgba(249,115,22,0.3)"
                      loading={btcConnecting}
                      onClick={() => connectBitcoin("tap")}
                    />
                  </>
                )
              )}

              {/* ── BITCOIN ── */}
              {activeChain === "bitcoin" && (() => {
                // Detect each wallet independently:
                // - Tap Wallet BTC is always in bitcoinTap (separate state)
                // - Phantom/MetaMask BTC: check phantomMultiChain.bitcoinAddress OR bitcoin state that isn't Tap Wallet
                const tapConnected = !!(bitcoinTap?.connected);
                // When Tap is the active/preferred wallet, bitcoin state is set to Tap Wallet.
                // Detect Phantom/MetaMask BTC independently via phantomMultiChain or the raw bitcoin state.
                const phantomBtcConnected = !!(phantomMultiChain?.bitcoinAddress);
                const metamaskBtcConnected = !!(bitcoin?.connected && !bitcoin.isPhantom && bitcoin.walletName !== "Tap Wallet");
                const phantomOrMmConnected = phantomBtcConnected || metamaskBtcConnected;
                const bothConnected = tapConnected && phantomOrMmConnected;

                if (bothConnected) {
                  // ── Multi-wallet picker: both Tap Wallet and Phantom/MetaMask BTC are connected ──
                  const tapWallet = bitcoinTap!;
                  // Reconstruct the non-tap wallet: prefer the raw bitcoin state if it's not Tap, else use phantomMultiChain data
                  const rawNonTap = bitcoin?.walletName !== "Tap Wallet" ? bitcoin : null;
                  const otherWallet: typeof bitcoin = rawNonTap ?? (phantomMultiChain?.bitcoinAddress ? {
                    chain: "bitcoin",
                    connected: true,
                    connecting: false,
                    walletName: "Phantom",
                    address: phantomMultiChain.bitcoinAddress,
                    shortAddress: `${phantomMultiChain.bitcoinAddress.slice(0, 6)}\u2026${phantomMultiChain.bitcoinAddress.slice(-6)}`,
                    balance: phantomBtcBalance?.balance ?? "... BTC",
                    balanceUsd: phantomBtcBalance?.balanceUsd ?? 0,
                    symbol: "BTC",
                    isPhantom: true,
                  } : null);
                  const activePref = preferredBtcWallet;
                  // isTapActive: true if preference is tap, OR if no preference and bitcoin state is Tap Wallet
                  const isTapActive = activePref === "tap" || (!activePref && (bitcoin?.walletName === "Tap Wallet" || !phantomOrMmConnected));
                  const isOtherActive = !isTapActive;

                  return (
                    <>
                      {/* Active wallet indicator */}
                      <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl"
                        style={{ background: "rgba(247,147,26,0.06)", border: "1px solid rgba(247,147,26,0.18)" }}>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Active BTC wallet</span>
                        <span className="ml-auto text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                          style={{ background: "rgba(247,147,26,0.18)", color: "#F7931A" }}>
                          <span>₿</span>
                          <span>{isTapActive ? "Tap" : (otherWallet?.walletName === "MetaMask" ? "MetaMask" : "Phantom")}</span>
                        </span>
                      </div>

                      {/* Tap Wallet option */}
                      <div className="relative">
                        <button
                          onClick={() => setPreferredBtcWallet("tap")}
                          className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all text-left"
                          style={{
                            background: isTapActive ? "rgba(249,115,22,0.12)" : "var(--muted)",
                            border: isTapActive ? "1.5px solid rgba(249,115,22,0.45)" : "1px solid var(--border)",
                            boxShadow: isTapActive ? "0 0 0 2px rgba(249,115,22,0.12)" : "none",
                          }}
                        >
                          <img src={TAP_ICON} alt="Tap Wallet" className="w-8 h-8 rounded-xl shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-bold text-foreground">Tap Wallet</p>
                              {isTapActive && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                                  style={{ background: "rgba(249,115,22,0.2)", color: "#F97316" }}>ACTIVE</span>
                              )}
                            </div>
                            <p className="text-[11px] font-mono text-muted-foreground truncate">{tapWallet.shortAddress}</p>
                            <p className="text-[10px] text-muted-foreground">{tapWallet.balance}</p>
                          </div>
                          <div className="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0"
                            style={{ borderColor: isTapActive ? "#F97316" : "var(--border)" }}>
                            {isTapActive && <div className="w-2 h-2 rounded-full" style={{ background: "#F97316" }} />}
                          </div>
                        </button>
                        {/* Explorer link — positioned top-right, stops propagation so it doesn't trigger wallet selection */}
                        <a
                          href={`https://mempool.space/address/${tapWallet.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="absolute top-2.5 right-10 p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
                          title="View on mempool.space"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>

                      {/* Phantom / MetaMask option */}
                      {otherWallet && (
                        <div className="relative">
                          <button
                            onClick={() => setPreferredBtcWallet(otherWallet.isPhantom ? "phantom" : "metamask")}
                            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all text-left"
                            style={{
                              background: isOtherActive ? "rgba(171,159,242,0.12)" : "var(--muted)",
                              border: isOtherActive ? "1.5px solid rgba(171,159,242,0.45)" : "1px solid var(--border)",
                              boxShadow: isOtherActive ? "0 0 0 2px rgba(171,159,242,0.12)" : "none",
                            }}
                          >
                            <img
                              src={otherWallet.isPhantom ? PHANTOM_ICON : METAMASK_ICON}
                              alt={otherWallet.walletName}
                              className="w-8 h-8 rounded-xl shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-bold text-foreground">{otherWallet.walletName}</p>
                                {isOtherActive && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                                    style={{ background: "rgba(171,159,242,0.2)", color: "#AB9FF2" }}>ACTIVE</span>
                                )}
                              </div>
                              <p className="text-[11px] font-mono text-muted-foreground truncate">{otherWallet.shortAddress}</p>
                              <p className="text-[10px] text-muted-foreground">{otherWallet.balance}</p>
                            </div>
                            <div className="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0"
                              style={{ borderColor: isOtherActive ? "#AB9FF2" : "var(--border)" }}>
                              {isOtherActive && <div className="w-2 h-2 rounded-full" style={{ background: "#AB9FF2" }} />}
                            </div>
                          </button>
                          {/* Explorer link */}
                          <a
                            href={`https://mempool.space/address/${otherWallet.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="absolute top-2.5 right-10 p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
                            title="View on mempool.space"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      )}

                      <p className="text-[10px] text-muted-foreground text-center px-2">
                        Tap a wallet above to set it as the active BTC signer for swaps.
                      </p>

                      {/* Consolidated BTC balances */}
                      {(() => {
                        const tapUsd = tapWallet.balanceUsd ?? 0;
                        const otherUsd = otherWallet?.balanceUsd ?? 0;
                        const totalUsd = tapUsd + otherUsd;
                        // Parse BTC amounts from balance strings like "0.00123456 BTC"
                        const parseBtc = (s: string) => parseFloat(s?.replace(/[^0-9.]/g, "") || "0") || 0;
                        const tapBtc = parseBtc(tapWallet.balance);
                        const otherBtc = parseBtc(otherWallet?.balance ?? "0");
                        const totalBtc = tapBtc + otherBtc;
                        return (
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-1">Balances</p>
                            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl"
                              style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                              <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold"
                                  style={{ background: "rgba(247,147,26,0.3)", color: "#F7931A" }}>B</div>
                                <span className="text-sm font-semibold text-foreground">BTC</span>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-mono font-semibold text-foreground">{totalBtc.toFixed(8)} BTC</p>
                                <p className="text-[10px] text-muted-foreground">${totalUsd.toFixed(2)}</p>
                              </div>
                            </div>
                            <div className="flex items-center justify-between px-3.5 py-2">
                              <span className="text-xs text-muted-foreground">Total portfolio</span>
                              <span className="text-sm font-bold text-foreground">${totalUsd.toFixed(2)}</span>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Disconnect both */}
                      <div className="flex gap-2">
                        <button
                          onClick={disconnectTracNetwork}
                          className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all text-red-400 hover:text-red-300"
                          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.18)" }}>
                          Disconnect Tap
                        </button>
                        <button
                          onClick={otherWallet?.isPhantom ? disconnectPhantom : disconnectBitcoin}
                          className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all text-red-400 hover:text-red-300"
                          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.18)" }}>
                          Disconnect {otherWallet?.walletName ?? "Other"}
                        </button>
                      </div>
                    </>
                  );
                }

                // ── Single wallet connected ──
                if (bitcoin?.connected) {
                  // Determine which other wallet type could be connected as a second BTC wallet
                  const isTapActive = bitcoin.walletName === "Tap Wallet";
                  return (
                    <>
                      <ConnectedCard
                        walletName={bitcoin.walletName}
                        shortAddress={bitcoin.shortAddress}
                        explorerUrl={`https://mempool.space/address/${bitcoin.address}`}
                        balances={[{ symbol: bitcoin.symbol, amount: bitcoin.balance, usdValue: bitcoin.balanceUsd }]}
                        totalUsd={bitcoin.balanceUsd}
                        accentColor="#F7931A"
                        onDisconnect={bitcoin.isPhantom ? disconnectPhantom : (bitcoin.walletName === "Tap Wallet" ? disconnectTracNetwork : disconnectBitcoin)}
                      />

                      {/* ── Add second BTC wallet section ── */}
                      <div className="mt-1 space-y-2">
                        <p className="text-[11px] text-muted-foreground text-center font-medium tracking-wide uppercase opacity-60">
                          Add a second BTC wallet
                        </p>

                        {/* When Tap is active — show Phantom + MetaMask connect buttons */}
                        {isTapActive && (
                          <>
                            <PhantomMultiChainButton
                              loading={phantomConnecting}
                              onClick={connectPhantomMultiChain}
                            />
                            <WalletButton
                              icon={METAMASK_ICON}
                              name="MetaMask"
                              desc="Native BTC · ETH · SOL · Multichain"
                              chains={["solana", "ethereum", "bitcoin"]}
                              accentColor="#F6851B"
                              bg="rgba(247,147,26,0.08)"
                              border="rgba(247,147,26,0.2)"
                              loading={btcConnecting}
                              onClick={() => connectBitcoin("metamask")}
                            />
                          </>
                        )}

                        {/* When Phantom/MetaMask is active — show Tap Wallet connect button */}
                        {!isTapActive && (
                          <WalletButton
                            icon={TAP_ICON}
                            name="Tap Wallet"
                            desc="BTC + TNK (Trac Network)"
                            chains={["bitcoin"]}
                            customChips={[
                              { label: "BTC", color: "#F7931A" },
                              { label: "TNK", color: "#F97316" },
                            ]}
                            bg="rgba(255,153,0,0.08)"
                            border="rgba(255,153,0,0.2)"
                            loading={btcConnecting}
                            onClick={() => connectBitcoin("tap")}
                          />
                        )}
                      </div>
                    </>
                  );
                }

                // ── No BTC wallet connected ──
                return (
                  <>
                    <p className="text-sm text-muted-foreground text-center py-1">
                      Connect your Bitcoin wallet to swap via AFOS P2P.
                    </p>

                    {/* Phantom — multi-chain */}
                    <PhantomMultiChainButton
                      loading={phantomConnecting}
                      onClick={connectPhantomMultiChain}
                    />

                    {/* MetaMask — native Bitcoin via Multichain API */}
                    <WalletButton
                      icon={METAMASK_ICON}
                      name="MetaMask"
                      desc="Native BTC · ETH · SOL · Multichain"
                      chains={["solana", "ethereum", "bitcoin"]}
                      accentColor="#F6851B"
                      bg="rgba(247,147,26,0.08)"
                      border="rgba(247,147,26,0.2)"
                      loading={btcConnecting}
                      onClick={() => connectBitcoin("metamask")}
                    />

                    {/* Tap Wallet — Bitcoin + TNK */}
                    <WalletButton
                      icon={TAP_ICON}
                      name="Tap Wallet"
                      desc="BTC + TNK (Trac Network)"
                      chains={["bitcoin"]}
                          customChips={[
                            { label: "BTC", color: "#F7931A" },
                            { label: "TNK", color: "#F97316" },
                          ]}
                      bg="rgba(255,153,0,0.08)"
                      border="rgba(255,153,0,0.2)"
                      loading={btcConnecting}
                      onClick={() => connectBitcoin("tap")}
                    />

                    <PrimaryCTA
                      label="Connect Bitcoin Wallet"
                      gradient="linear-gradient(135deg,#F7931A 0%,#FFCC00 100%)"
                      shadow="rgba(247,147,26,0.3)"
                      onClick={() => connectBitcoin("metamask")}
                      loading={btcConnecting}
                    />
                  </>
                );
              })()}

              <p className="text-[10px] text-muted-foreground text-center pb-1">
                AFOS never holds your private keys · All swaps are self-custodial
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Phantom Multi-Chain Button ───────────────────────────────────────────────

function PhantomMultiChainButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl transition-all text-left hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 relative overflow-hidden"
      style={{
        background: "rgba(171,159,242,0.12)",
        border: "1px solid rgba(171,159,242,0.35)",
      }}
    >
      <img src={PHANTOM_ICON} alt="Phantom logo" className="w-9 h-9 rounded-xl shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-bold text-foreground">Phantom</p>
          {/* Multi-chain badge */}
          <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold"
            style={{ background: "rgba(171,159,242,0.2)", color: "#AB9FF2" }}>
            <Zap className="w-2.5 h-2.5" />
            Multi-chain
          </span>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          {(["solana", "ethereum", "bitcoin"] as const).map(c => (
            <span key={c} className="text-[9px] font-medium px-1 py-0.5 rounded"
              style={{ background: `${CHAIN_DOTS[c]}18`, color: CHAIN_DOTS[c] }}>
              {c === "solana" ? "SOL" : c === "ethereum" ? "ETH" : "BTC"}
            </span>
          ))}
        </div>
      </div>
      {loading ? (
        <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground" />
        </svg>
      )}
    </button>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function WalletButton({ icon, name, desc, chains, bg, border, onClick, loading, accentColor, customChips }: {
  icon: string; name: string; desc: string;
  chains: ChainTab[];
  bg: string; border: string;
  onClick: () => void; loading?: boolean;
  /** Optional accent color for the Multi-chain badge (defaults to first chain color) */
  accentColor?: string;
  /** Optional custom chip labels+colors — overrides the chains-derived chips (no badge shown).
   *  Set themeText:true to use CSS foreground color instead of the hex (for dark/light-aware chips). */
  customChips?: { label: string; color: string; themeText?: boolean }[];
}) {
  const isMultiChain = chains.length > 1;
  const badgeColor = accentColor ?? CHAIN_DOTS[chains[0]];
  // Determine what to show below the name:
  // 1. customChips — explicit chips, no badge (e.g. Tap Wallet: BTC + TNK)
  // 2. isMultiChain — standard chain chips with Multi-chain badge
  // 3. fallback — plain description text
  const showCustomChips = customChips && customChips.length > 0;
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl transition-all text-left hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
      style={{ background: bg, border: `1px solid ${border}` }}
    >
      <img src={icon} alt={`${name} logo`} className="w-9 h-9 rounded-xl shrink-0 object-cover" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-bold text-foreground">{name}</p>
          {/* Multi-chain badge — only for standard multi-chain wallets, NOT for customChips wallets */}
          {isMultiChain && !showCustomChips && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold"
              style={{ background: `${badgeColor}22`, color: badgeColor }}>
              <Globe className="w-2.5 h-2.5" />
              Multi-chain
            </span>
          )}
        </div>
        {/* Chip row: custom chips > standard chain chips > plain desc */}
        {showCustomChips ? (
          <div className="flex items-center gap-1 mt-0.5">
            {customChips!.map(chip => (
              <span key={chip.label}
                className={`text-[9px] font-medium px-1 py-0.5 rounded-full${chip.themeText ? " text-foreground" : ""}`}
                style={{ background: `${chip.color}18`, ...(chip.themeText ? {} : { color: chip.color }) }}>
                {chip.label}
              </span>
            ))}
          </div>
        ) : isMultiChain ? (
          <div className="flex items-center gap-1 mt-0.5">
            {chains.map(c => (
              <span key={c} className="text-[9px] font-medium px-1 py-0.5 rounded-full"
                style={{ background: `${CHAIN_DOTS[c]}18`, color: CHAIN_DOTS[c] }}>
                {c === "solana" ? "SOL" : c === "ethereum" ? "ETH" : "BTC"}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
        )}
      </div>
      {loading ? (
        <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground" />
        </svg>
      )}
    </button>
  );
}

function PrimaryCTA({ label, gradient, shadow, onClick, loading }: {
  label: string; gradient: string; shadow: string; onClick: () => void; loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full py-3.5 rounded-2xl text-sm font-bold transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
      style={{ background: gradient, color: "white", boxShadow: `0 4px 20px ${shadow}` }}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {label}
    </button>
  );
}

function ConnectedCard({ walletName, shortAddress, explorerUrl, balances, totalUsd, accentColor, onDisconnect, chains, addresses }: {
  walletName: string; shortAddress: string; explorerUrl?: string;
  balances: { symbol: string; amount: string; usdValue: number }[];
  totalUsd: number; accentColor: string; onDisconnect: () => void;
  /** Chain badge chips to show below the wallet name */
  chains?: { label: string; color: string }[];
  /** Multiple addresses to show (overrides shortAddress when provided) */
  addresses?: { label: string; address: string; shortAddress: string; explorerUrl?: string }[];
}) {
  return (
    <>
      <div className="rounded-2xl p-4 space-y-3"
        style={{ background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.18)" }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: "rgba(16,185,129,0.15)" }}>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-emerald-400">{walletName}</p>
            {/* Chain badges */}
            {chains && chains.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {chains.map(c => (
                  <span key={c.label}
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ background: `${c.color}22`, color: c.color, border: `1px solid ${c.color}44` }}>
                    {c.label}
                  </span>
                ))}
              </div>
            )}
            {/* Single address (when no multi-address list) */}
            {!addresses && (
              <p className="text-[11px] font-mono text-muted-foreground truncate mt-0.5">{shortAddress}</p>
            )}
          </div>
          {/* Single explorer link when no multi-address list */}
          {!addresses && explorerUrl && (
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors" title="View on explorer">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
        {/* Multi-address rows */}
        {addresses && addresses.length > 0 && (
          <div className="space-y-1.5 pt-1">
            {addresses.map(addr => (
              <div key={addr.label} className="flex items-center gap-2 px-2 py-1.5 rounded-xl"
                style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.12)" }}>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ background: `${accentColor}22`, color: accentColor, border: `1px solid ${accentColor}44` }}>
                  {addr.label}
                </span>
                <p className="text-[11px] font-mono text-muted-foreground truncate flex-1">{addr.shortAddress}</p>
                {addr.explorerUrl && (
                  <a href={addr.explorerUrl} target="_blank" rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors shrink-0" title="View on explorer">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {balances.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-1">Balances</p>
          {balances.map(b => (
            <div key={b.symbol} className="flex items-center justify-between px-3.5 py-2.5 rounded-xl"
              style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold"
                  style={{ background: `${accentColor}30`, color: accentColor }}>
                  {b.symbol[0]}
                </div>
                <span className="text-sm font-semibold text-foreground">{b.symbol}</span>
              </div>
              <div className="text-right">
                <p className="text-sm font-mono font-semibold text-foreground">{b.amount}</p>
                <p className="text-[10px] text-muted-foreground">${(b.usdValue ?? 0).toFixed(2)}</p>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between px-3.5 py-2">
            <span className="text-xs text-muted-foreground">Total portfolio</span>
            <span className="text-sm font-bold text-foreground">${totalUsd.toFixed(2)}</span>
          </div>
        </div>
      )}

      <button onClick={onDisconnect}
        className="w-full py-3 rounded-xl text-xs font-semibold transition-all text-red-400 hover:text-red-300 active:scale-[0.98]"
        style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.18)" }}>
        Disconnect Wallet
      </button>
    </>
  );
}
