/**
 * ConnectWalletModal — Multi-chain wallet connection modal
 * Design: Dark glass card, chain tabs, wallet grid
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Wallet, CheckCircle2, Loader2, ChevronRight } from "lucide-react";
import { useWallet, WalletChain } from "@/contexts/WalletContext";

interface ConnectWalletModalProps {
  open: boolean;
  onClose: () => void;
}

const CHAINS: { id: WalletChain; label: string; color: string }[] = [
  { id: "solana", label: "Solana", color: "#9945FF" },
  { id: "evm", label: "Ethereum", color: "#627EEA" },
  { id: "bitcoin", label: "Bitcoin", color: "#F7931A" },
];

const WALLETS_BY_CHAIN: Record<WalletChain, { name: string; description: string; popular?: boolean }[]> = {
  solana: [
    { name: "Phantom", description: "Most popular Solana wallet", popular: true },
    { name: "Backpack", description: "Multi-chain xNFT wallet" },
    { name: "Solflare", description: "Native Solana wallet" },
  ],
  evm: [
    { name: "MetaMask", description: "Most popular EVM wallet", popular: true },
    { name: "Coinbase Wallet", description: "Coinbase self-custody wallet" },
  ],
  bitcoin: [
    { name: "Xverse", description: "Bitcoin & Ordinals wallet", popular: true },
    { name: "TAP Wallet", description: "Bitcoin, Ordinals & TAP Protocol" },
  ],
};

const WALLET_ICONS: Record<string, string> = {
  Phantom: "👻",
  Backpack: "🎒",
  Solflare: "🌟",
  MetaMask: "🦊",
  "Coinbase Wallet": "🔵",
  Xverse: "₿",
  "TAP Wallet": "🔷",
};

export default function ConnectWalletModal({ open, onClose }: ConnectWalletModalProps) {
  const { connectWallet, connectedWallets, disconnectWallet, isConnecting } = useWallet();
  const [activeChain, setActiveChain] = useState<WalletChain>("solana");
  const [connecting, setConnecting] = useState<string | null>(null);

  const handleConnect = async (walletName: string) => {
    setConnecting(walletName);
    await connectWallet(walletName, activeChain);
    setConnecting(null);
  };

  const isChainConnected = (chain: WalletChain) => connectedWallets.some(w => w.chain === chain);
  const connectedOnChain = connectedWallets.find(w => w.chain === activeChain);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
          onClick={e => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="w-full max-w-md rounded-2xl overflow-hidden"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)" }}>
                  <Wallet className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">Connect Wallet</p>
                  <p className="text-[10px] text-muted-foreground">
                    {connectedWallets.length > 0
                      ? `${connectedWallets.length} wallet${connectedWallets.length > 1 ? "s" : ""} connected`
                      : "Choose your wallet to get started"}
                  </p>
                </div>
              </div>
              <button onClick={onClose}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                style={{ background: "var(--muted)" }}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Chain tabs */}
            <div className="flex gap-1 p-3" style={{ borderBottom: "1px solid var(--border)" }}>
              {CHAINS.map(chain => (
                <button key={chain.id}
                  onClick={() => setActiveChain(chain.id)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all relative"
                  style={{
                    background: activeChain === chain.id ? `${chain.color}18` : "transparent",
                    border: `1px solid ${activeChain === chain.id ? `${chain.color}40` : "transparent"}`,
                    color: activeChain === chain.id ? chain.color : "var(--muted-foreground)",
                  }}>
                  {chain.label}
                  {isChainConnected(chain.id) && (
                    <span className="w-1.5 h-1.5 rounded-full absolute top-1.5 right-1.5"
                      style={{ background: chain.color }} />
                  )}
                </button>
              ))}
            </div>

            {/* Connected state for this chain */}
            {connectedOnChain && (
              <div className="mx-4 mt-3 px-4 py-3 rounded-xl flex items-center justify-between"
                style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-emerald-400">{connectedOnChain.name} connected</p>
                    <p className="text-[10px] font-mono text-muted-foreground">{connectedOnChain.address}</p>
                  </div>
                </div>
                <button
                  onClick={() => disconnectWallet(activeChain)}
                  className="text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-colors text-red-400 hover:text-red-300"
                  style={{ background: "rgba(239,68,68,0.1)" }}>
                  Disconnect
                </button>
              </div>
            )}

            {/* Wallet list */}
            <div className="p-4 space-y-2">
              {WALLETS_BY_CHAIN[activeChain].map(wallet => {
                const isConnected = connectedOnChain?.name === wallet.name;
                const isLoading = connecting === wallet.name;
                return (
                  <motion.button
                    key={wallet.name}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => !isConnected && !isLoading && handleConnect(wallet.name)}
                    disabled={isLoading || isConnecting}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all text-left"
                    style={{
                      background: isConnected ? "rgba(16,185,129,0.08)" : "var(--muted)",
                      border: `1px solid ${isConnected ? "rgba(16,185,129,0.25)" : "var(--border)"}`,
                      opacity: isConnecting && !isLoading ? 0.5 : 1,
                      cursor: isConnected ? "default" : "pointer",
                    }}>
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0"
                      style={{ background: "var(--card)" }}>
                      {WALLET_ICONS[wallet.name]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{wallet.name}</p>
                        {wallet.popular && !isConnected && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ background: "rgba(59,130,246,0.15)", color: "#60a5fa" }}>
                            POPULAR
                          </span>
                        )}
                        {isConnected && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}>
                            CONNECTED
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground">{wallet.description}</p>
                    </div>
                    {isLoading ? (
                      <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
                    ) : isConnected ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                  </motion.button>
                );
              })}
            </div>

            {/* Footer */}
            <div className="px-5 pb-4 pt-1">
              <p className="text-[10px] text-muted-foreground text-center">
                By connecting, you agree to AFOS Terms of Service. AFOS never holds your private keys.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
