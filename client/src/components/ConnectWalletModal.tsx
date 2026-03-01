/**
 * ConnectWalletModal — Real Solana wallet connection via @solana/wallet-adapter-react
 * Uses real Phantom and Solflare logos extracted directly from the wallet adapter packages.
 */

import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { useWallet } from "@/contexts/WalletContext";
import { motion, AnimatePresence } from "framer-motion";
import { X, Wallet, CheckCircle2, ExternalLink } from "lucide-react";

// Real logos from @solana/wallet-adapter-phantom and @solana/wallet-adapter-wallets
const PHANTOM_ICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDgiIGhlaWdodD0iMTA4IiB2aWV3Qm94PSIwIDAgMTA4IDEwOCIgZmlsbD0ibm9uZSI+CjxyZWN0IHdpZHRoPSIxMDgiIGhlaWdodD0iMTA4IiByeD0iMjYiIGZpbGw9IiNBQjlGRjIiLz4KPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik00Ni41MjY3IDY5LjkyMjlDNDIuMDA1NCA3Ni44NTA5IDM0LjQyOTIgODUuNjE4MiAyNC4zNDggODUuNjE4MkMxOS41ODI0IDg1LjYxODIgMTUgODMuNjU2MyAxNSA3NS4xMzQyQzE1IDUzLjQzMDUgNDQuNjMyNiAxOS44MzI3IDcyLjEyNjggMTkuODMyN0M4Ny43NjggMTkuODMyNyA5NCAzMC42ODQ2IDk0IDQzLjAwNzlDOTQgNTguODI1OCA4My43MzU1IDc2LjkxMjIgNzMuNTMyMSA3Ni45MTIyQzcwLjI5MzkgNzYuOTEyMiA2OC43MDUzIDc1LjEzNDIgNjguNzA1MyA3Mi4zMTRDNjguNzA1MyA3MS41NzgzIDY4LjgyNzUgNzAuNzgxMiA2OS4wNzE5IDY5LjkyMjlDNjUuNTg5MyA3NS44Njk5IDU4Ljg2ODUgODEuMzg3OCA1Mi41NzU0IDgxLjM4NzhDNDcuOTkzIDgxLjM4NzggNDUuNjcxMyA3OC41MDYzIDQ1LjY3MTMgNzQuNDU5OEM0NS42NzEzIDcyLjk4ODQgNDUuOTc2OCA3MS40NTU2IDQ2LjUyNjcgNjkuOTIyOVpNODMuNjc2MSA0Mi41Nzk0QzgzLjY3NjEgNDYuMTcwNCA4MS41NTc1IDQ3Ljk2NTggNzkuMTg3NSA0Ny45NjU4Qzc2Ljc4MTYgNDcuOTY1OCA3NC42OTg5IDQ2LjE3MDQgNzQuNjk4OSA0Mi41Nzk0Qzc0LjY5ODkgMzguOTg4NSA3Ni43ODE2IDM3LjE5MzEgNzkuMTg3NSAzNy4xOTMxQzgxLjU1NzUgMzcuMTkzMSA4My42NzYxIDM4Ljk4ODUgODMuNjc2MSA0Mi41Nzk0Wk03MC4yMTAzIDQyLjU3OTVDNzAuMjEwMyA0Ni4xNzA0IDY4LjA5MTYgNDcuOTY1OCA2NS43MjE2IDQ3Ljk2NThDNjMuMzE1NyA0Ny45NjU4IDYxLjIzMyA0Ni4xNzA0IDYxLjIzMyA0Mi41Nzk1QzYxLjIzMyAzOC45ODg1IDYzLjMxNTcgMzcuMTkzMSA2NS43MjE2IDM3LjE5MzFDNjguMDkxNiAzNy4xOTMxIDcwLjIxMDMgMzguOTg4NSA3MC4yMTAzIDQyLjU3OTVaIiBmaWxsPSIjRkZGREY4Ii8+Cjwvc3ZnPg==";

const SOLFLARE_ICON = "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz48c3ZnIGlkPSJTIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MCA1MCI+PGRlZnM+PHN0eWxlPi5jbHMtMXtmaWxsOiMwMjA1MGE7c3Ryb2tlOiNmZmVmNDY7c3Ryb2tlLW1pdGVybGltaXQ6MTA7c3Ryb2tlLXdpZHRoOi41cHg7fS5jbHMtMntmaWxsOiNmZmVmNDY7fTwvc3R5bGU+PC9kZWZzPjxyZWN0IGNsYXNzPSJjbHMtMiIgeD0iMCIgd2lkdGg9IjUwIiBoZWlnaHQ9IjUwIiByeD0iMTIiIHJ5PSIxMiIvPjxwYXRoIGNsYXNzPSJjbHMtMSIgZD0iTTI0LjIzLDI2LjQybDIuNDYtMi4zOCw0LjU5LDEuNWMzLjAxLDEsNC41MSwyLjg0LDQuNTEsNS40MywwLDEuOTYtLjc1LDMuMjYtMi4yNSw0LjkzbC0uNDYuNS4xNy0xLjE3Yy42Ny00LjI2LS41OC02LjA5LTQuNzItNy40M2wtNC4zLTEuMzhoMFpNMTguMDUsMTEuODVsMTIuNTIsNC4xNy0yLjcxLDIuNTktNi41MS0yLjE3Yy0yLjI1LS43NS0zLjAxLTEuOTYtMy4zLTQuNTF2LS4wOGgwWk0xNy4zLDMzLjA2bDIuODQtMi43MSw1LjM0LDEuNzVjMi44LjkyLDMuNzYsMi4xMywzLjQ2LDUuMThsLTExLjY1LTQuMjJoMFpNMTMuNzEsMjAuOTVjMC0uNzkuNDItMS41NCwxLjEzLTIuMTcuNzUsMS4wOSwyLjA1LDIuMDUsNC4wOSwyLjcxbDQuNDIsMS40Ni0yLjQ2LDIuMzgtNC4zNC0xLjQyYy0yLS42Ny0yLjg0LTEuNjctMi44NC0yLjk2TTI2LjgyLDQyLjg3YzkuMTgtNi4wOSwxNC4xMS0xMC4yMywxNC4xMS0xNS4zMiwwLTMuMzgtMi01LjI2LTYuNDMtNi43MmwtMy4zNC0xLjEzLDkuMTQtOC43Ny0xLjg0LTEuOTYtMi43MSwyLjM4LTEyLjgxLTQuMjJjLTMuOTcsMS4yOS04Ljk3LDUuMDktOC45Nyw4Ljg5LDAsLjQyLjA0LjgzLjE3LDEuMjktMy4zLDEuODgtNC42MywzLjYzLTQuNjMsNS44LDAsMi4wNSwxLjA5LDQuMDksNC41NSw1LjIybDIuNzUuOTItOS41Miw5LjE0LDEuODQsMS45NiwyLjk2LTIuNzEsMTQuNzMsNS4yMmgwWiIvPjwvc3ZnPg==";

interface ConnectWalletModalProps {
  open: boolean;
  onClose: () => void;
}

export default function ConnectWalletModal({ open, onClose }: ConnectWalletModalProps) {
  const { connected, walletName, shortAddress, balances, totalUsd, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const { publicKey } = useSolanaWallet();

  const handleSelectWallet = (walletName: string) => {
    onClose();
    // Small delay so modal closes before wallet adapter modal opens
    setTimeout(() => setVisible(true), 100);
  };

  const handleDisconnect = async () => {
    await disconnect();
    onClose();
  };

  const wallets = [
    {
      name: "Phantom",
      icon: PHANTOM_ICON,
      desc: "Most popular Solana wallet",
      bg: "rgba(171,159,242,0.12)",
      border: "rgba(171,159,242,0.25)",
    },
    {
      name: "Solflare",
      icon: SOLFLARE_ICON,
      desc: "Native Solana wallet",
      bg: "rgba(255,239,70,0.08)",
      border: "rgba(255,239,70,0.2)",
    },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(10px)" }}
          onClick={e => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl overflow-hidden"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            {/* Drag handle (mobile) */}
            <div className="flex justify-center pt-3 pb-1 sm:hidden">
              <div className="w-10 h-1 rounded-full" style={{ background: "var(--border)" }} />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-3 pb-4 sm:pt-4"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(153,69,255,0.15)", border: "1px solid rgba(153,69,255,0.3)" }}>
                  <Wallet className="w-4.5 h-4.5" style={{ color: "#9945FF" }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">
                    {connected ? "Wallet Connected" : "Connect Wallet"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {connected ? shortAddress : "Solana · Self-custodial"}
                  </p>
                </div>
              </div>
              <button onClick={onClose}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                style={{ background: "var(--muted)" }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              {connected ? (
                <>
                  {/* Connected state */}
                  <div className="rounded-2xl p-4 space-y-3"
                    style={{ background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.18)" }}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center"
                        style={{ background: "rgba(16,185,129,0.15)" }}>
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-emerald-400">{walletName}</p>
                        <p className="text-[11px] font-mono text-muted-foreground truncate">{shortAddress}</p>
                      </div>
                      {publicKey && (
                        <a
                          href={`https://solscan.io/account/${publicKey.toString()}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="View on Solscan"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Balances */}
                  {balances.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-1">Balances</p>
                      {balances.map(b => (
                        <div key={b.symbol} className="flex items-center justify-between px-3.5 py-2.5 rounded-xl"
                          style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold"
                              style={{
                                background: b.symbol === "SOL" ? "rgba(153,69,255,0.2)" : "rgba(38,161,123,0.2)",
                                color: b.symbol === "SOL" ? "#9945FF" : "#26a17b",
                              }}>
                              {b.symbol[0]}
                            </div>
                            <span className="text-sm font-semibold text-foreground">{b.symbol}</span>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-mono font-semibold text-foreground">{b.amount}</p>
                            <p className="text-[10px] text-muted-foreground">${b.usdValue.toFixed(2)}</p>
                          </div>
                        </div>
                      ))}
                      <div className="flex items-center justify-between px-3.5 py-2">
                        <span className="text-xs text-muted-foreground">Total portfolio</span>
                        <span className="text-sm font-bold text-foreground">${totalUsd.toFixed(2)}</span>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleDisconnect}
                    className="w-full py-3 rounded-xl text-xs font-semibold transition-all text-red-400 hover:text-red-300 active:scale-[0.98]"
                    style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.18)" }}>
                    Disconnect Wallet
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground text-center py-1">
                    Connect your Solana wallet to swap tokens with AFOS.
                  </p>

                  {/* Wallet options with real logos */}
                  <div className="space-y-2">
                    {wallets.map(w => (
                      <button
                        key={w.name}
                        onClick={() => handleSelectWallet(w.name)}
                        className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl transition-all text-left hover:scale-[1.01] active:scale-[0.99]"
                        style={{ background: w.bg, border: `1px solid ${w.border}` }}
                      >
                        <img
                          src={w.icon}
                          alt={`${w.name} logo`}
                          className="w-9 h-9 rounded-xl shrink-0"
                        />
                        <div>
                          <p className="text-sm font-bold text-foreground">{w.name}</p>
                          <p className="text-[11px] text-muted-foreground">{w.desc}</p>
                        </div>
                        <div className="ml-auto text-muted-foreground">
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Primary CTA */}
                  <button
                    onClick={() => handleSelectWallet("")}
                    className="w-full py-3.5 rounded-2xl text-sm font-bold transition-all hover:opacity-90 active:scale-[0.98]"
                    style={{
                      background: "linear-gradient(135deg, #9945FF 0%, #14F195 100%)",
                      color: "white",
                      boxShadow: "0 4px 20px rgba(153,69,255,0.3)",
                    }}>
                    Connect Wallet
                  </button>

                  <p className="text-[10px] text-muted-foreground text-center pb-1">
                    AFOS never holds your private keys · All swaps are self-custodial
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
