/**
 * ConnectWalletModal — Multi-chain wallet connection
 * Chains: Solana (Phantom, Solflare) · Ethereum (MetaMask, Coinbase) · Bitcoin (Xverse, Tap Wallet)
 * IntercomSwap is the primary swap route for all chains.
 */

import { useState } from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { useWallet } from "@/contexts/WalletContext";
import { useMultiChainWallet } from "@/contexts/MultiChainWalletContext";
import { motion, AnimatePresence } from "framer-motion";
import { X, Wallet, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";

// ─── Wallet logos ─────────────────────────────────────────────────────────────

const PHANTOM_ICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDgiIGhlaWdodD0iMTA4IiB2aWV3Qm94PSIwIDAgMTA4IDEwOCIgZmlsbD0ibm9uZSI+CjxyZWN0IHdpZHRoPSIxMDgiIGhlaWdodD0iMTA4IiByeD0iMjYiIGZpbGw9IiNBQjlGRjIiLz4KPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik00Ni41MjY3IDY5LjkyMjlDNDIuMDA1NCA3Ni44NTA5IDM0LjQyOTIgODUuNjE4MiAyNC4zNDggODUuNjE4MkMxOS41ODI0IDg1LjYxODIgMTUgODMuNjU2MyAxNSA3NS4xMzQyQzE1IDUzLjQzMDUgNDQuNjMyNiAxOS44MzI3IDcyLjEyNjggMTkuODMyN0M4Ny43NjggMTkuODMyNyA5NCAzMC42ODQ2IDk0IDQzLjAwNzlDOTQgNTguODI1OCA4My43MzU1IDc2LjkxMjIgNzMuNTMyMSA3Ni45MTIyQzcwLjI5MzkgNzYuOTEyMiA2OC43MDUzIDc1LjEzNDIgNjguNzA1MyA3Mi4zMTRDNjguNzA1MyA3MS41NzgzIDY4LjgyNzUgNzAuNzgxMiA2OS4wNzE5IDY5LjkyMjlDNjUuNTg5MyA3NS44Njk5IDU4Ljg2ODUgODEuMzg3OCA1Mi41NzU0IDgxLjM4NzhDNDcuOTkzIDgxLjM4NzggNDUuNjcxMyA3OC41MDYzIDQ1LjY3MTMgNzQuNDU5OEM0NS42NzEzIDcyLjk4ODQgNDUuOTc2OCA3MS40NTU2IDQ2LjUyNjcgNjkuOTIyOVpNODMuNjc2MSA0Mi41Nzk0QzgzLjY3NjEgNDYuMTcwNCA4MS41NTc1IDQ3Ljk2NTggNzkuMTg3NSA0Ny45NjU4Qzc2Ljc4MTYgNDcuOTY1OCA3NC42OTg5IDQ2LjE3MDQgNzQuNjk4OSA0Mi41Nzk0Qzc0LjY5ODkgMzguOTg4NSA3Ni43ODE2IDM3LjE5MzEgNzkuMTg3NSAzNy4xOTMxQzgxLjU1NzUgMzcuMTkzMSA4My42NzYxIDM4Ljk4ODUgODMuNjc2MSA0Mi41Nzk0Wk03MC4yMTAzIDQyLjU3OTVDNzAuMjEwMyA0Ni4xNzA0IDY4LjA5MTYgNDcuOTY1OCA2NS43MjE2IDQ3Ljk2NThDNjMuMzE1NyA0Ny45NjU4IDYxLjIzMyA0Ni4xNzA0IDYxLjIzMyA0Mi41Nzk1QzYxLjIzMyAzOC45ODg1IDYzLjMxNTcgMzcuMTkzMSA2NS43MjE2IDM3LjE5MzFDNjguMDkxNiAzNy4xOTMxIDcwLjIxMDMgMzguOTg4NSA3MC4yMTAzIDQyLjU3OTVaIiBmaWxsPSIjRkZGREY4Ii8+Cjwvc3ZnPg==";
const SOLFLARE_ICON = "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz48c3ZnIGlkPSJTIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MCA1MCI+PGRlZnM+PHN0eWxlPi5jbHMtMXtmaWxsOiMwMjA1MGE7c3Ryb2tlOiNmZmVmNDY7c3Ryb2tlLW1pdGVybGltaXQ6MTA7c3Ryb2tlLXdpZHRoOi41cHg7fS5jbHMtMntmaWxsOiNmZmVmNDY7fTwvc3R5bGU+PC9kZWZzPjxyZWN0IGNsYXNzPSJjbHMtMiIgeD0iMCIgd2lkdGg9IjUwIiBoZWlnaHQ9IjUwIiByeD0iMTIiIHJ5PSIxMiIvPjxwYXRoIGNsYXNzPSJjbHMtMSIgZD0iTTI0LjIzLDI2LjQybDIuNDYtMi4zOCw0LjU5LDEuNWMzLjAxLDEsNC41MSwyLjg0LDQuNTEsNS40MywwLDEuOTYtLjc1LDMuMjYtMi4yNSw0LjkzbC0uNDYuNS4xNy0xLjE3Yy42Ny00LjI2LS41OC02LjA5LTQuNzItNy40M2wtNC4zLTEuMzhoMFpNMTguMDUsMTEuODVsMTIuNTIsNC4xNy0yLjcxLDIuNTktNi41MS0yLjE3Yy0yLjI1LS43NS0zLjAxLTEuOTYtMy4zLTQuNTF2LS4wOGgwWk0xNy4zLDMzLjA2bDIuODQtMi43MSw1LjM0LDEuNzVjMi44LjkyLDMuNzYsMi4xMywzLjQ2LDUuMThsLTExLjY1LTQuMjJoMFpNMTMuNzEsMjAuOTVjMC0uNzkuNDItMS41NCwxLjEzLTIuMTcuNzUsMS4wOSwyLjA1LDIuMDUsNC4wOSwyLjcxbDQuNDIsMS40Ni0yLjQ2LDIuMzgtNC4zNC0xLjQyYy0yLS42Ny0yLjg0LTEuNjctMi44NC0yLjk2TTI2LjgyLDQyLjg3YzkuMTgtNi4wOSwxNC4xMS0xMC4yMywxNC4xMS0xNS4zMiwwLTMuMzgtMi01LjI2LTYuNDMtNi43MmwtMy4zNC0xLjEzLDkuMTQtOC43Ny0xLjg0LTEuOTYtMi43MSwyLjM4LTEyLjgxLTQuMjJjLTMuOTcsMS4yOS04Ljk3LDUuMDktOC45Nyw4Ljg5LDAsLjQyLjA0LjgzLjE3LDEuMjktMy4zLDEuODgtNC42MywzLjYzLTQuNjMsNS44LDAsMi4wNSwxLjA5LDQuMDksNC41NSw1LjIybDIuNzUuOTItOS41Miw5LjE0LDEuODQsMS45NiwyLjk2LTIuNzEsMTQuNzMsNS4yMmgwWiIvPjwvc3ZnPg==";

// Real wallet logos from CDN
const METAMASK_ICON = "https://d2xsxph8kpxj0f.cloudfront.net/87744282/Cv4Jvx35N7jGsqrM8y5HAD/metamask_82c05d81.png";
const COINBASE_ICON = "https://d2xsxph8kpxj0f.cloudfront.net/87744282/Cv4Jvx35N7jGsqrM8y5HAD/coinbase-wallet_e8d0feb0.png";
const XVERSE_ICON = "https://d2xsxph8kpxj0f.cloudfront.net/87744282/Cv4Jvx35N7jGsqrM8y5HAD/xverse_fbfa3f0a.jpg";
const TAP_ICON = "https://d2xsxph8kpxj0f.cloudfront.net/87744282/Cv4Jvx35N7jGsqrM8y5HAD/tap-wallet_c2b2a572.png";

// ─── Chain config ─────────────────────────────────────────────────────────────

type ChainTab = "solana" | "ethereum" | "bitcoin";

const CHAIN_TABS: { id: ChainTab; label: string; color: string; accent: string }[] = [
  { id: "solana",   label: "Solana",   color: "#9945FF", accent: "rgba(153,69,255,0.15)" },
  { id: "ethereum", label: "Ethereum", color: "#627EEA", accent: "rgba(98,126,234,0.15)" },
  { id: "bitcoin",  label: "Bitcoin",  color: "#F7931A", accent: "rgba(247,147,26,0.15)" },
];

interface ConnectWalletModalProps {
  open: boolean;
  onClose: () => void;
}

export default function ConnectWalletModal({ open, onClose }: ConnectWalletModalProps) {
  const [activeChain, setActiveChain] = useState<ChainTab>("solana");

  // Solana
  const { connected: solConnected, walletName: solWalletName, shortAddress: solShortAddr, balances, totalUsd, disconnect: solDisconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const { publicKey } = useSolanaWallet();

  // Ethereum + Bitcoin
  const { ethereum, bitcoin, connectEthereum, connectBitcoin, disconnectEthereum, disconnectBitcoin, ethConnecting, btcConnecting } = useMultiChainWallet();

  const handleSolanaConnect = () => {
    onClose();
    setTimeout(() => setVisible(true), 100);
  };

  const handleSolanaDisconnect = async () => {
    await solDisconnect();
    onClose();
  };

  const chainConfig = CHAIN_TABS.find(c => c.id === activeChain)!;

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
              {/* ── SOLANA ── */}
              {activeChain === "solana" && (
                solConnected ? (
                  <ConnectedCard
                    walletName={solWalletName || "Phantom"}
                    shortAddress={solShortAddr ?? ""}
                    explorerUrl={publicKey ? `https://solscan.io/account/${publicKey.toString()}` : undefined}
                    balances={balances.map(b => ({ symbol: b.symbol, amount: b.amount, usdValue: b.usdValue }))}
                    totalUsd={totalUsd}
                    accentColor="#9945FF"
                    onDisconnect={handleSolanaDisconnect}
                  />
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground text-center py-1">
                      Connect your Solana wallet to swap via IntercomSwap.
                    </p>
                    <WalletButton icon={PHANTOM_ICON} name="Phantom" desc="Most popular Solana wallet" bg="rgba(171,159,242,0.12)" border="rgba(171,159,242,0.25)" onClick={handleSolanaConnect} />
                    <WalletButton icon={SOLFLARE_ICON} name="Solflare" desc="Native Solana wallet" bg="rgba(255,239,70,0.08)" border="rgba(255,239,70,0.2)" onClick={handleSolanaConnect} />
                    <PrimaryCTA label="Connect Solana Wallet" gradient="linear-gradient(135deg,#9945FF 0%,#14F195 100%)" shadow="rgba(153,69,255,0.3)" onClick={handleSolanaConnect} />
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
                    onDisconnect={disconnectEthereum}
                  />
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground text-center py-1">
                      Connect your Ethereum wallet to swap via IntercomSwap.
                    </p>
                    <WalletButton icon={METAMASK_ICON} name="MetaMask" desc="Most popular Ethereum wallet" bg="rgba(246,133,27,0.1)" border="rgba(246,133,27,0.25)" loading={ethConnecting} onClick={() => connectEthereum("metamask")} />
                    <WalletButton icon={COINBASE_ICON} name="Coinbase Wallet" desc="Easy self-custody by Coinbase" bg="rgba(0,82,255,0.08)" border="rgba(0,82,255,0.2)" loading={ethConnecting} onClick={() => connectEthereum("coinbase")} />
                    <PrimaryCTA label="Connect Ethereum Wallet" gradient="linear-gradient(135deg,#627EEA 0%,#A78BFA 100%)" shadow="rgba(98,126,234,0.3)" onClick={() => connectEthereum("metamask")} loading={ethConnecting} />
                  </>
                )
              )}

              {/* ── BITCOIN ── */}
              {activeChain === "bitcoin" && (
                bitcoin?.connected ? (
                  <ConnectedCard
                    walletName={bitcoin.walletName}
                    shortAddress={bitcoin.shortAddress}
                    explorerUrl={`https://mempool.space/address/${bitcoin.address}`}
                    balances={[{ symbol: bitcoin.symbol, amount: bitcoin.balance, usdValue: bitcoin.balanceUsd }]}
                    totalUsd={bitcoin.balanceUsd}
                    accentColor="#F7931A"
                    onDisconnect={disconnectBitcoin}
                  />
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground text-center py-1">
                      Connect your Bitcoin wallet to swap via IntercomSwap.
                    </p>
                    <WalletButton icon={XVERSE_ICON} name="Xverse" desc="On-chain BTC wallet" bg="rgba(247,147,26,0.08)" border="rgba(247,147,26,0.2)" loading={btcConnecting} onClick={() => connectBitcoin("xverse")} />
                    <WalletButton icon={TAP_ICON} name="Tap Wallet" desc="BTC + TNK (Trac Network)" bg="rgba(255,153,0,0.08)" border="rgba(255,153,0,0.2)" loading={btcConnecting} onClick={() => connectBitcoin("tap")} />
                    <PrimaryCTA label="Connect Bitcoin Wallet" gradient="linear-gradient(135deg,#F7931A 0%,#FFCC00 100%)" shadow="rgba(247,147,26,0.3)" onClick={() => connectBitcoin("xverse")} loading={btcConnecting} />
                  </>
                )
              )}

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

// ─── Sub-components ───────────────────────────────────────────────────────────

function WalletButton({ icon, name, desc, bg, border, onClick, loading }: {
  icon: string; name: string; desc: string; bg: string; border: string;
  onClick: () => void; loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl transition-all text-left hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
      style={{ background: bg, border: `1px solid ${border}` }}
    >
      <img src={icon} alt={`${name} logo`} className="w-9 h-9 rounded-xl shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-bold text-foreground">{name}</p>
        <p className="text-[11px] text-muted-foreground">{desc}</p>
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

function ConnectedCard({ walletName, shortAddress, explorerUrl, balances, totalUsd, accentColor, onDisconnect }: {
  walletName: string; shortAddress: string; explorerUrl?: string;
  balances: { symbol: string; amount: string; usdValue: number }[];
  totalUsd: number; accentColor: string; onDisconnect: () => void;
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
            <p className="text-[11px] font-mono text-muted-foreground truncate">{shortAddress}</p>
          </div>
          {explorerUrl && (
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors" title="View on explorer">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
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

      <button onClick={onDisconnect}
        className="w-full py-3 rounded-xl text-xs font-semibold transition-all text-red-400 hover:text-red-300 active:scale-[0.98]"
        style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.18)" }}>
        Disconnect Wallet
      </button>
    </>
  );
}
