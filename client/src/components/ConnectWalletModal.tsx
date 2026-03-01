/**
 * ConnectWalletModal — Real Solana wallet connection via @solana/wallet-adapter-react
 * Supports: Phantom, Solflare
 * Uses the WalletModalProvider from @solana/wallet-adapter-react-ui
 */

import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@/contexts/WalletContext";
import { motion, AnimatePresence } from "framer-motion";
import { X, Wallet, CheckCircle2, ExternalLink } from "lucide-react";

interface ConnectWalletModalProps {
  open: boolean;
  onClose: () => void;
}

export default function ConnectWalletModal({ open, onClose }: ConnectWalletModalProps) {
  const { connected, walletName, shortAddress, balances, totalUsd, disconnect } = useWallet();
  const { setVisible } = useWalletModal();

  const handleConnect = () => {
    onClose();
    setVisible(true);
  };

  const handleDisconnect = async () => {
    await disconnect();
    onClose();
  };

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
            className="w-full max-w-sm rounded-2xl overflow-hidden"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(153,69,255,0.15)", border: "1px solid rgba(153,69,255,0.3)" }}>
                  <Wallet className="w-4 h-4" style={{ color: "#9945FF" }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">Solana Wallet</p>
                  <p className="text-[10px] text-muted-foreground">
                    {connected ? "Connected" : "Connect to swap tokens"}
                  </p>
                </div>
              </div>
              <button onClick={onClose}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                style={{ background: "var(--muted)" }}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {connected ? (
                <>
                  {/* Connected state */}
                  <div className="rounded-xl p-4 space-y-3"
                    style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
                    <div className="flex items-center gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-emerald-400">{walletName} connected</p>
                        <p className="text-[10px] font-mono text-muted-foreground">{shortAddress}</p>
                      </div>
                      <a
                        href={`https://solscan.io/account/${shortAddress?.replace("...", "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>

                  {/* Balances */}
                  <div className="space-y-2">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Balances</p>
                    {balances.map(b => (
                      <div key={b.symbol} className="flex items-center justify-between px-3 py-2.5 rounded-xl"
                        style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                            style={{
                              background: b.symbol === "SOL" ? "rgba(153,69,255,0.2)" : "rgba(38,161,123,0.2)",
                              color: b.symbol === "SOL" ? "#9945FF" : "#26a17b",
                            }}>
                            {b.symbol[0]}
                          </div>
                          <span className="text-sm font-semibold text-foreground">{b.symbol}</span>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-mono text-foreground">{b.amount}</p>
                          <p className="text-[10px] text-muted-foreground">${b.usdValue.toFixed(2)}</p>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-xs text-muted-foreground">Total</span>
                      <span className="text-sm font-bold text-foreground">${totalUsd.toFixed(2)}</span>
                    </div>
                  </div>

                  <button
                    onClick={handleDisconnect}
                    className="w-full py-2.5 rounded-xl text-xs font-semibold transition-all text-red-400 hover:text-red-300"
                    style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    Disconnect Wallet
                  </button>
                </>
              ) : (
                <>
                  {/* Not connected */}
                  <p className="text-sm text-muted-foreground text-center py-2">
                    Connect your Solana wallet to swap tokens with AFOS.
                  </p>

                  <div className="space-y-2">
                    {[
                      { name: "Phantom", icon: "👻", desc: "Most popular Solana wallet" },
                      { name: "Solflare", icon: "🌟", desc: "Native Solana wallet" },
                    ].map(w => (
                      <button
                        key={w.name}
                        onClick={handleConnect}
                        className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all text-left hover:opacity-90"
                        style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                      >
                        <span className="text-2xl">{w.icon}</span>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{w.name}</p>
                          <p className="text-[10px] text-muted-foreground">{w.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={handleConnect}
                    className="w-full py-3 rounded-xl text-sm font-bold transition-all"
                    style={{
                      background: "linear-gradient(135deg, #9945FF, #14F195)",
                      color: "white",
                    }}>
                    Connect Wallet
                  </button>

                  <p className="text-[10px] text-muted-foreground text-center">
                    AFOS never holds your private keys. All swaps are self-custodial.
                  </p>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
