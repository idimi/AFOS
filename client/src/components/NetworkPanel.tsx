/**
 * NetworkPanel — Unified P2P Network panel
 *
 * Combines "My Node" (Light Peer controls) and "Live Peers" (remote peer discovery)
 * into a single tabbed card so users see both sides of the P2P network in one place.
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Radio, Settings2, ChevronDown, ChevronUp, ChevronRight,
  CheckCircle2, XCircle, Clock, Zap, TrendingUp,
  Users, Shield, AlertCircle, Network,
  ToggleLeft, ToggleRight, Info, Lock, ExternalLink,
} from "lucide-react";
import { useLightPeer, type IncomingRfq, type HtlcStep } from "../contexts/LightPeerContext";
import { useWallet } from "../contexts/WalletContext";
import { useMultiChainWallet } from "../contexts/MultiChainWalletContext";
import { trpc } from "../lib/trpc";

// ─── Types (mirrored from Swaps.tsx) ─────────────────────────────────────────

interface LivePeer {
  id: string;
  alias: string;
  pairs: string[];
  latency: number;
  reputation: number;
  online: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

function timeLeft(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return "expired";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  return `${Math.floor(diff / 60_000)}m`;
}

// ─── HTLC Countdown Timer ─────────────────────────────────────────────────────────────────────────────────────────

/** Returns a block-explorer URL for the given chain + txId, or null if unknown. */
function htlcExplorerUrl(chain: string, txId?: string): string | null {
  if (!txId) return null;
  switch (chain.toLowerCase()) {
    case "solana":       return `https://solscan.io/tx/${txId}`;
    case "ethereum":     return `https://etherscan.io/tx/${txId}`;
    case "bitcoin":      return `https://mempool.space/tx/${txId}`;
    case "trac_network": return `https://explorer.trac.network/tx/${txId}`;
    default:             return null;
  }
}

function HtlcCountdown({
  lockedAt,
  timelockMs = 3_600_000,
  chain,
  lockTxId,
}: {
  lockedAt: number;
  timelockMs?: number;
  /** Chain of the locked HTLC — used to build explorer deep-link on expiry */
  chain?: string;
  /** Lock tx hash — used to build explorer deep-link on expiry */
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
    const explorerHref = chain ? htlcExplorerUrl(chain, lockTxId) : null;
    return (
      <span className="text-[10px] text-red-400 font-medium flex items-center gap-1">
        ⏰ Refundable now
        {explorerHref && (
          <a
            href={explorerHref}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-red-300 transition-colors"
            onClick={e => e.stopPropagation()}
          >
            View on-chain ↗
          </a>
        )}
      </span>
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
  return <span className="text-[10px] text-slate-400 font-medium">⏳ Refundable in {label}</span>;
}

// ─── RFQ Card ─────────────────────────────────────────────────────────────────────────────

function RfqCard({ rfq, onAccept, onReject, onClaim, hasSecret, isClaimed, onRefund, isRefundable, isRefunded, htlcLockedAt, htlcExpiresAt, lockTxId }: {
  rfq: IncomingRfq;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onClaim?: (id: string) => void;
  hasSecret?: boolean;
  isClaimed?: boolean;
  onRefund?: (id: string) => void;
  isRefundable?: boolean;
  isRefunded?: boolean;
  /** Unix ms when HTLC was locked — used to show countdown to refund window */
  htlcLockedAt?: number;
  /** Actual on-chain expiry (Unix ms) from refundableHtlcs — overrides default 1h timelock */
  htlcExpiresAt?: number;
  /** Lock tx hash — used to build explorer deep-link on expiry */
  lockTxId?: string;
}) {
  const [claiming, setClaiming] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const isExpired = rfq.status === "expired" || rfq.expiresAt < Date.now();
  const isPending = rfq.status === "pending" && !isExpired;

  const statusColor = {
    pending: "text-amber-400",
    accepted: "text-emerald-400",
    rejected: "text-red-400",
    expired: "text-slate-500",
  }[rfq.status];

  const statusIcon = {
    pending: <Clock className="w-3 h-3" />,
    accepted: <CheckCircle2 className="w-3 h-3" />,
    rejected: <XCircle className="w-3 h-3" />,
    expired: <AlertCircle className="w-3 h-3" />,
  }[rfq.status];

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-slate-400">{rfq.requestorPeer.slice(0, 8)}…</span>
          <span className={`flex items-center gap-1 text-[10px] font-medium ${statusColor}`}>
            {statusIcon}
            {rfq.status === "pending" ? timeLeft(rfq.expiresAt) : rfq.status}
          </span>
        </div>
        <span className="text-[10px] text-slate-500">{timeAgo(rfq.receivedAt)}</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="font-semibold text-white">
          {rfq.amount.toFixed(4)} <span className="text-cyan-400">{rfq.fromToken}</span>
        </span>
        <span className="text-slate-500">→</span>
        <span className="font-semibold text-white">
          {rfq.suggestedOutAmount.toFixed(4)} <span className="text-emerald-400">{rfq.toToken}</span>
        </span>
      </div>
      <div className="text-[10px] text-slate-400">
        Rate: 1 {rfq.fromToken} = {rfq.suggestedRate.toFixed(6)} {rfq.toToken}
        &nbsp;·&nbsp;{rfq.fromChain} → {rfq.toChain}
      </div>
      {/* HTLC countdown timer — shown on accepted cards where Agent B has locked funds */}
      {rfq.status === "accepted" && htlcLockedAt && !isClaimed && !isRefunded && (
        <div className="pt-0.5">
          <HtlcCountdown
            lockedAt={htlcLockedAt}
            timelockMs={htlcExpiresAt ? htlcExpiresAt - htlcLockedAt : 3_600_000}
            chain={rfq.fromChain}
            lockTxId={lockTxId}
          />
        </div>
      )}
      {isPending && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onAccept(rfq.rfqId)}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-400 text-xs font-medium transition-colors"
          >
            <CheckCircle2 className="w-3 h-3" /> Accept
          </button>
          <button
            onClick={() => onReject(rfq.rfqId)}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-medium transition-colors"
          >
            <XCircle className="w-3 h-3" /> Reject
          </button>
        </div>
      )}
      {/* Claim Funds button — shown when Agent A has revealed the secret and not yet claimed */}
      {hasSecret && !isClaimed && onClaim && rfq.status === "accepted" && (
        <div className="pt-1">
          <button
            onClick={async () => {
              setClaiming(true);
              try { await onClaim(rfq.rfqId); } finally { setClaiming(false); }
            }}
            disabled={claiming}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Lock className="w-3.5 h-3.5" />
            {claiming ? "Claiming…" : "Claim Funds (Secret Revealed)"}
          </button>
        </div>
      )}
      {/* Claimed badge — shown after successful claim */}
      {isClaimed && (
        <div className="pt-1 flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Funds claimed successfully
        </div>
      )}
      {/* Refund button — shown for Agent A when HTLC has expired */}
      {isRefundable && !isRefunded && onRefund && (
        <div className="pt-1">
          <button
            onClick={async () => {
              setRefunding(true);
              try { await onRefund(rfq.rfqId); } finally { setRefunding(false); }
            }}
            disabled={refunding}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-md bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 text-xs font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <AlertCircle className="w-3.5 h-3.5" />
            {refunding ? "Refunding…" : "Refund Locked Funds (Expired)"}
          </button>
        </div>
      )}
      {/* Refunded badge — shown after successful refund */}
      {isRefunded && (
        <div className="pt-1 flex items-center gap-1.5 text-amber-400 text-xs font-medium">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Funds refunded successfully
        </div>
      )}
    </motion.div>
  );
}

// ─── Pair Toggle ──────────────────────────────────────────────────────────────

const ALL_PAIRS = [
  "SOL/USDT", "SOL/USDC", "ETH/USDT", "ETH/USDC",
  "BTC/USDT", "BTC/ETH", "BTC/SOL",
  "TNK/USDT", "TNK/ETH", "TNK/SOL", "TNK/BTC",
];

function PairToggle({ pair, active, onToggle }: { pair: string; active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`px-2 py-1 rounded text-[10px] font-mono font-medium border transition-all ${
        active
          ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-300"
          : "bg-white/5 border-white/10 text-slate-500 hover:border-white/20"
      }`}
    >
      {pair}
    </button>
  );
}

// ─── My Node Tab ────────────────────────────────────────────────────────────

function MyNodeTab({ tnkPeerCount = 0 }: { tnkPeerCount?: number }) {
  const peer = useLightPeer();
  const { connected: solAdapterConnected } = useWallet();
  const { ethereum, bitcoin, phantomMultiChain } = useMultiChainWallet();
  const isWalletConnected = solAdapterConnected || !!phantomMultiChain?.solanaAddress || !!ethereum?.address || !!bitcoin?.address;

  const [showSettings, setShowSettings] = useState(false);
  const [spreadInput, setSpreadInput] = useState(String(peer.prefs.spreadBps));
  const [minInput, setMinInput] = useState(String(peer.prefs.minTradeUsd));
  const [maxInput, setMaxInput] = useState(String(peer.prefs.maxTradeUsd));

  const pendingRfqs = peer.incomingRfqs.filter(r => r.status === "pending" && r.expiresAt > Date.now());
  const recentRfqs = peer.incomingRfqs.slice(0, 8);

  const applySettings = () => {
    const spread = parseInt(spreadInput, 10);
    const min = parseFloat(minInput);
    const max = parseFloat(maxInput);
    if (!isNaN(spread) && !isNaN(min) && !isNaN(max)) {
      peer.setPrefs({ spreadBps: spread, minTradeUsd: min, maxTradeUsd: max });
    }
    setShowSettings(false);
  };

  const togglePair = (pair: string) => {
    const pairs = peer.prefs.acceptedPairs;
    if (pairs.includes(pair)) {
      peer.setPrefs({ acceptedPairs: pairs.filter(p => p !== pair) });
    } else {
      peer.setPrefs({ acceptedPairs: [...pairs, pair] });
    }
  };

  return (
    <div className="space-y-4">
      {/* No wallet */}
      {!isWalletConnected && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold mb-0.5">Connect a wallet to become a peer</p>
            <p className="text-blue-400/70">
              When you connect Phantom, MetaMask, or any supported wallet, you automatically
              join the AFOS P2P network as a quoting peer — no server required.
            </p>
          </div>
        </div>
      )}

      {/* Stats */}
      {isWalletConnected && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Quotes Given", value: peer.quotesGiven, icon: <Zap className="w-3 h-3" /> },
            { label: "Trades Done", value: peer.tradesCompleted, icon: <TrendingUp className="w-3 h-3" /> },
            { label: "Volume USD", value: `$${peer.totalVolumeUsd.toFixed(0)}`, icon: <Users className="w-3 h-3" /> },
          ].map(s => (
            <div key={s.label} className="rounded-lg bg-white/5 border border-white/10 p-2 text-center">
              <div className="flex items-center justify-center gap-1 text-slate-400 mb-1">
                {s.icon}
                <span className="text-[10px]">{s.label}</span>
              </div>
              <div className="text-sm font-bold text-white">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Peer Mode toggle */}
      {isWalletConnected && (
        <div className="flex items-center justify-between py-2 border-b border-white/10">
          <div>
            <p className="text-sm font-medium text-white">Peer Mode</p>
            <p className="text-[10px] text-slate-500">
              {peer.prefs.enabled ? "Actively quoting on the P2P network" : "Not quoting — RFQs still delivered to you"}
            </p>
          </div>
          <button
            onClick={peer.toggleEnabled}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
              peer.prefs.enabled
                ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30"
                : "bg-slate-500/10 border-slate-500/20 text-slate-400 hover:bg-slate-500/20"
            }`}
          >
            {peer.prefs.enabled
              ? <><ToggleRight className="w-4 h-4" /> Active</>
              : <><ToggleLeft className="w-4 h-4" /> Inactive</>}
          </button>
        </div>
      )}

      {/* Auto-Accept */}
      {isWalletConnected && peer.prefs.enabled && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white">Auto-Accept</p>
            <p className="text-[10px] text-slate-500">Automatically accept matching RFQs without confirmation</p>
          </div>
          <button
            onClick={() => peer.setPrefs({ autoAccept: !peer.prefs.autoAccept })}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
              peer.prefs.autoAccept
                ? "bg-cyan-500/20 border-cyan-500/30 text-cyan-400"
                : "bg-slate-500/10 border-slate-500/20 text-slate-400"
            }`}
          >
            {peer.prefs.autoAccept
              ? <><ToggleRight className="w-4 h-4" /> On</>
              : <><ToggleLeft className="w-4 h-4" /> Off</>}
          </button>
        </div>
      )}

      {/* Auto-Claim */}
      {isWalletConnected && peer.prefs.enabled && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white">Auto-Claim</p>
            <p className="text-[10px] text-slate-500">Automatically claim HTLC funds when secret is received</p>
          </div>
          <button
            onClick={() => peer.setPrefs({ autoClaim: !peer.prefs.autoClaim })}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
              peer.prefs.autoClaim
                ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-400"
                : "bg-slate-500/10 border-slate-500/20 text-slate-400"
            }`}
          >
            {peer.prefs.autoClaim
              ? <><ToggleRight className="w-4 h-4" /> On</>
              : <><ToggleLeft className="w-4 h-4" /> Off</>}
          </button>
        </div>
      )}
      {/* Quote Settings */}
      {isWalletConnected && peer.prefs.enabled && (
        <div>
          <button
            onClick={() => setShowSettings(s => !s)}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <Settings2 className="w-3.5 h-3.5" />
            Quote Settings
            {showSettings ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          <AnimatePresence>
            {showSettings && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">
                      Spread (basis points) — your profit margin
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number" min={1} max={500} value={spreadInput}
                        onChange={e => setSpreadInput(e.target.value)}
                        className="w-20 px-2 py-1 rounded bg-white/10 border border-white/15 text-white text-xs font-mono focus:outline-none focus:border-cyan-500/50"
                      />
                      <span className="text-[10px] text-slate-500">
                        = {(parseInt(spreadInput) / 100 || 0).toFixed(2)}% above market
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Min trade (USD)</label>
                      <input type="number" min={1} value={minInput} onChange={e => setMinInput(e.target.value)}
                        className="w-full px-2 py-1 rounded bg-white/10 border border-white/15 text-white text-xs font-mono focus:outline-none focus:border-cyan-500/50"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Max trade (USD)</label>
                      <input type="number" min={1} value={maxInput} onChange={e => setMaxInput(e.target.value)}
                        className="w-full px-2 py-1 rounded bg-white/10 border border-white/15 text-white text-xs font-mono focus:outline-none focus:border-cyan-500/50"
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <label className="text-[10px] text-slate-400">Accepted pairs</label>
                      {tnkPeerCount > 0 ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30">
                          {tnkPeerCount} TNK peer{tnkPeerCount !== 1 ? 's' : ''} online
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-500/10 text-slate-500 border border-slate-500/20">
                          No TNK peers
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {ALL_PAIRS.map(pair => (
                        <PairToggle
                          key={pair} pair={pair}
                          active={peer.prefs.acceptedPairs.includes(pair)}
                          onToggle={() => togglePair(pair)}
                        />
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={applySettings}
                    className="w-full py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/30 text-cyan-400 text-xs font-medium transition-colors"
                  >
                    Apply Settings
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Incoming RFQs — shown whenever there are RFQs (even when Peer Mode is off) */}
      {isWalletConnected && (peer.prefs.enabled || recentRfqs.length > 0) && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-white flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-cyan-400" />
              Incoming RFQs
              {pendingRfqs.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold">
                  {pendingRfqs.length}
                </span>
              )}
            </span>
            <span className="text-[10px] text-slate-500">
              {peer.prefs.enabled
                ? (peer.lastHeartbeat ? `Heartbeat ${timeAgo(peer.lastHeartbeat)}` : "Connecting…")
                : "Peer Mode off — receiving only"}
            </span>
          </div>
          {recentRfqs.length === 0 ? (
            <div className="text-center py-4 text-slate-500 text-xs">
              <Radio className="w-5 h-5 mx-auto mb-1 opacity-30" />
              {peer.prefs.enabled ? "Listening for RFQs on accepted pairs…" : "Enable Peer Mode to quote on the P2P network"}
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              <AnimatePresence initial={false}>
                {recentRfqs.map(rfq => (
                  <RfqCard
                    key={rfq.rfqId}
                    rfq={rfq}
                    onAccept={peer.acceptRfq}
                    onReject={peer.rejectRfq}
                    onClaim={peer.claimHtlcFunds}
                    hasSecret={!!peer.htlcRevealedSecrets[rfq.rfqId]}
                    isClaimed={peer.claimedRfqIds.has(rfq.rfqId)}
                    onRefund={peer.refundHtlcFunds}
                    isRefundable={!!peer.refundableHtlcs[rfq.rfqId]}
                    isRefunded={peer.refundedRfqIds.has(rfq.rfqId)}
                    htlcLockedAt={peer.htlcLockedAt[rfq.rfqId]}
                    htlcExpiresAt={peer.refundableHtlcs[rfq.rfqId]?.expiresAt}
                    lockTxId={peer.refundableHtlcs[rfq.rfqId]?.lockTxId}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      {/* HTLC info */}
      {isWalletConnected && peer.prefs.enabled && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-white/5 border border-white/10 text-[10px] text-slate-400">
          <Shield className="w-3.5 h-3.5 mt-0.5 shrink-0 text-cyan-400" />
          <span>
            All trades use <strong className="text-white">HTLC atomic swap</strong> escrow.
            Your funds are never sent directly to a counterparty — both sides lock simultaneously
            or both refund automatically.
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Live Peers Tab ───────────────────────────────────────────────────────────

function LivePeersTab({ fromToken, toToken, livePeers, activePeerCount }: {
  fromToken: { symbol: string };
  toToken: { symbol: string };
  livePeers: LivePeer[];
  activePeerCount: number;
}) {
  const pair = `${fromToken.symbol}/${toToken.symbol}`;
  const relevantPeers = livePeers.filter(p =>
    p.pairs.some(pp => pp === pair || pp === `${toToken.symbol}/${fromToken.symbol}`)
  );
  const displayPeers = relevantPeers.length > 0 ? relevantPeers : livePeers.slice(0, 3);

  return (
    <div className="space-y-3">
      {displayPeers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <Users className="w-5 h-5 text-slate-400" />
          <p className="text-xs text-slate-300 font-medium">
            Waiting for peers to announce…
          </p>
          <p className="text-[10px] text-slate-500">Peers will appear once DHT connects</p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayPeers.map(peer => (
            <div
              key={peer.id}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
              style={{ background: "var(--muted)" }}
            >
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${peer.online ? "bg-emerald-400" : "bg-slate-600"}`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono text-slate-300 truncate">{peer.alias}</div>
                <div className="text-[9px] text-slate-600">{peer.id}</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-[10px] font-mono text-cyan-400">{peer.latency}ms</div>
                <div className="text-[9px] text-slate-600">{peer.reputation}%</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="pt-2 border-t border-white/10 flex items-center justify-between">
        <span className="text-[10px] text-slate-400 font-medium">AFOS P2P DHT</span>
        <span className={`text-[10px] font-mono font-semibold ${
          activePeerCount > 0 ? "text-cyan-400" : "text-amber-400"
        }`}>
          {activePeerCount > 0 ? `${activePeerCount} total peers` : "Connecting…"}
        </span>
      </div>
    </div>
  );
}

// ─── Settled HTLCs Panel ─────────────────────────────────────────────────────

// Chain label helper
const CHAIN_LABEL: Record<string, string> = {
  solana: "SOL",
  ethereum: "ETH",
  bitcoin: "BTC",
  trac_network: "TNK",
};

function SettledHtlcsPanel() {
  const [offset, setOffset] = useState(0);
  const PAGE_SIZE = 50;

  const { data: settled, isLoading } = trpc.chat.getSettledHtlcs.useQuery({ limit: PAGE_SIZE + offset }, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "refunded" | "expired">("all");
  const [chainFilter, setChainFilter] = useState<"all" | "solana" | "ethereum" | "bitcoin" | "trac_network">("all");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const explorerUrl = (chain: string, txId: string | null): string | null => {
    if (!txId) return null;
    switch (chain.toLowerCase()) {
      case "solana": return `https://solscan.io/tx/${txId}`;
      case "ethereum": return `https://etherscan.io/tx/${txId}`;
      case "bitcoin": return `https://mempool.space/tx/${txId}`;
      case "trac_network": return txId ? `https://explorer.trac.network/tx/${txId}` : null;
      default: return null;
    }
  };

  const statusColor: Record<string, string> = {
    completed: "text-emerald-400",
    expired:   "text-slate-500",
    refunded:  "text-amber-400",
  };
  const statusBg: Record<string, string> = {
    completed: "bg-emerald-500/10 border-emerald-500/20",
    expired:   "bg-slate-500/10 border-slate-500/20",
    refunded:  "bg-amber-500/10 border-amber-500/20",
  };
  const statusIcon: Record<string, string> = {
    completed: "✓",
    expired:   "✗",
    refunded:  "↩",
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-14 rounded-lg bg-white/5 animate-pulse" />
        ))}
      </div>
    );
  }

  const filtered = (settled ?? []).filter(row => {
    const matchStatus = statusFilter === "all" || row.status === statusFilter;
    const matchChain  = chainFilter === "all" || row.fromChain === chainFilter || row.toChain === chainFilter;
    return matchStatus && matchChain;
  });

  const hasMore = (settled ?? []).length >= PAGE_SIZE + offset;

  return (
    <div className="space-y-3">
      {/* ── Filter bar ── */}
      <div className="space-y-1.5">
        {/* Status filters */}
        <div className="flex gap-1 flex-wrap">
          {(["all", "completed", "refunded", "expired"] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors border ${
                statusFilter === s
                  ? s === "all"
                    ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
                    : `${statusBg[s] ?? "bg-white/10 border-white/10"} ${statusColor[s] ?? "text-slate-400"}`
                  : "bg-white/5 text-slate-500 border-white/10 hover:text-slate-300"
              }`}
            >
              {s === "all" ? "All" : `${statusIcon[s]} ${s}`}
            </button>
          ))}
        </div>
        {/* Chain filters */}
        <div className="flex gap-1 flex-wrap">
          {(["all", "solana", "ethereum", "bitcoin", "trac_network"] as const).map(c => (
            <button
              key={c}
              onClick={() => setChainFilter(c)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors border ${
                chainFilter === c
                  ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
                  : "bg-white/5 text-slate-500 border-white/10 hover:text-slate-300"
              }`}
            >
              {c === "all" ? "All chains" : CHAIN_LABEL[c] ?? c}
            </button>
          ))}
        </div>
      </div>

      {/* ── Results ── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <Shield className="w-5 h-5 text-slate-500" />
          {(settled ?? []).length === 0 ? (
            <>
              <p className="text-xs text-slate-400 font-medium">No settled swaps yet</p>
              <p className="text-[10px] text-slate-600">Completed, refunded, and expired HTLCs appear here</p>
            </>
          ) : (
            <p className="text-xs text-slate-400 font-medium">No results match the current filters</p>
          )}
        </div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {filtered.map(row => {
            const claimUrl = explorerUrl(row.toChain, row.revealTxId);
            const lockUrl  = explorerUrl(row.fromChain, row.lockTxId);
            const isExpanded = expandedRow === row.rfqId;
            return (
              <div
                key={row.rfqId}
                className="rounded-lg border border-white/10 bg-white/5 overflow-hidden"
              >
                {/* ── Collapsed header row (always visible, click to expand) ── */}
                <button
                  onClick={() => setExpandedRow(isExpanded ? null : row.rfqId)}
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-mono text-slate-400 shrink-0">{row.rfqId.slice(0, 8)}…</span>
                    <span className={`text-[10px] font-semibold shrink-0 ${statusColor[row.status] ?? "text-slate-400"}`}>
                      {statusIcon[row.status] ?? "?"} {row.status}
                    </span>
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 min-w-0">
                      <span className="truncate">{CHAIN_LABEL[row.fromChain] ?? row.fromChain}</span>
                      <span>→</span>
                      <span className="truncate">{CHAIN_LABEL[row.toChain] ?? row.toChain}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] text-slate-500">
                      {new Date(row.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <ChevronRight
                      className={`w-3 h-3 text-slate-500 transition-transform duration-200 ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                    />
                  </div>
                </button>

                {/* ── Expanded detail panel ── */}
                <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.div
                      key="detail"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="px-3 pb-3 pt-1 border-t border-white/10 space-y-2">
                        {/* Full RFQ ID */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-slate-500 shrink-0">RFQ ID:</span>
                          <span className="text-[10px] font-mono text-slate-300 break-all">{row.rfqId}</span>
                        </div>

                        {/* Tx audit trail */}
                        <div className="grid grid-cols-2 gap-2">
                          {/* Lock tx */}
                          <div className="rounded-md border border-white/10 bg-white/5 p-2 space-y-1">
                            <p className="text-[10px] text-slate-500 font-medium">Lock Transaction</p>
                            <p className="text-[10px] text-slate-400">
                              {CHAIN_LABEL[row.fromChain] ?? row.fromChain}
                            </p>
                            {lockUrl ? (
                              <a
                                href={lockUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300 font-mono break-all"
                              >
                                <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                                {row.lockTxId ? `${row.lockTxId.slice(0, 12)}…` : "View"}
                              </a>
                            ) : (
                              <span className="text-[10px] text-slate-600">No tx recorded</span>
                            )}
                          </div>

                          {/* Claim / Refund tx */}
                          <div className="rounded-md border border-white/10 bg-white/5 p-2 space-y-1">
                            <p className="text-[10px] text-slate-500 font-medium">
                              {row.status === "refunded" ? "Refund Transaction" : "Claim Transaction"}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              {CHAIN_LABEL[row.toChain] ?? row.toChain}
                            </p>
                            {claimUrl ? (
                              <a
                                href={claimUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`flex items-center gap-1 text-[10px] font-mono break-all ${
                                  row.status === "refunded" ? "text-amber-400 hover:text-amber-300" : "text-emerald-400 hover:text-emerald-300"
                                }`}
                              >
                                <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                                {row.revealTxId ? `${row.revealTxId.slice(0, 12)}…` : "View"}
                              </a>
                            ) : (
                              <span className="text-[10px] text-slate-600">No tx recorded</span>
                            )}
                          </div>
                        </div>

                        {/* Settled at */}
                        <p className="text-[10px] text-slate-600">
                          Settled {new Date(row.updatedAt).toLocaleString()}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}

          {/* ── Load more button ── */}
          {hasMore && (
            <button
              onClick={() => setOffset(prev => prev + PAGE_SIZE)}
              className="w-full py-2 rounded-lg text-[10px] font-medium text-slate-400 hover:text-slate-200 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
            >
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main NetworkPanel ────────────────────────────────────────────────────────

export default function NetworkPanel({ fromToken, toToken, livePeers, activePeerCount }: {
  fromToken: { symbol: string };
  toToken: { symbol: string };
  livePeers: LivePeer[];
  activePeerCount: number;
}) {
  const peer = useLightPeer();
  const { connected: solAdapterConnected } = useWallet();
  const { ethereum, bitcoin, phantomMultiChain } = useMultiChainWallet();
  const isWalletConnected = solAdapterConnected || !!phantomMultiChain?.solanaAddress || !!ethereum?.address || !!bitcoin?.address;

  const [activeTab, setActiveTab] = useState<"mynode" | "livepeers" | "history">(() => {
    try { return (localStorage.getItem("afos_network_tab") as "mynode" | "livepeers" | "history") || "mynode"; }
    catch { return "mynode"; }
  });

  useEffect(() => {
    try { localStorage.setItem("afos_network_tab", activeTab); } catch { /* ignore */ }
  }, [activeTab]);

  // Listen for open-peer-panel event (from toast notification)
  useEffect(() => {
    const handler = () => setActiveTab("mynode");
    window.addEventListener("afos:open-peer-panel", handler);
    return () => window.removeEventListener("afos:open-peer-panel", handler);
  }, []);

  const pendingRfqs = peer.incomingRfqs.filter(r => r.status === "pending" && r.expiresAt > Date.now());
  const onlineCount = livePeers.filter(p => p.online).length;
  const tnkPeerCount = livePeers.filter(p => p.pairs.some(pair => pair.toUpperCase().includes("TNK"))).length;
  // Count settled HTLCs for the History tab badge — uses the same query as SettledHtlcsPanel
  const { data: settledForBadge } = trpc.chat.getSettledHtlcs.useQuery({ limit: 500 }, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const settledCount = settledForBadge?.length ?? 0;

  return (
    <>
      {/* ── Main panel ── */}
      <div className="rounded-xl border border-white/10 bg-[#0d1117]/80 backdrop-blur-sm overflow-hidden">
        {/* Header */}
        <div className="px-4 pt-3 pb-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Network className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-sm font-semibold text-white">Network</span>
              {/* My Node status badge */}
              {activeTab === "mynode" && (
                isWalletConnected && peer.prefs.enabled ? (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                    ONLINE
                  </span>
                ) : !isWalletConnected ? (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-500/15 text-slate-400 border border-slate-500/25">
                    WALLET NEEDED
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-500/15 text-slate-400 border border-slate-500/25">
                    DISABLED
                  </span>
                )
              )}
              {/* Live Peers count badge */}
              {activeTab === "livepeers" && (
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[10px] text-slate-500">{onlineCount} online</span>
                </div>
              )}
              {/* Pending RFQ badge */}
              {pendingRfqs.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse">
                  {pendingRfqs.length} RFQ{pendingRfqs.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
            {/* Peer alias */}
            {peer.isOnline && (
              <span className="text-[10px] font-mono text-slate-500">{peer.peerAlias}</span>
            )}
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 border-b border-white/10 -mx-4 px-4">
            {(["mynode", "livepeers", "history"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-2 px-1 text-xs font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === tab
                    ? "border-cyan-400 text-cyan-400"
                    : "border-transparent text-slate-500 hover:text-slate-300"
                }`}>
                <span className="flex items-center gap-1.5">
                  {tab === "mynode" ? "My Node" : tab === "livepeers" ? "Live Peers" : "History"}
                  {tab === "history" && settledCount > 0 && (
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                      {settledCount > 99 ? "99+" : settledCount}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="px-4 py-4">
          <AnimatePresence mode="wait">
            {activeTab === "mynode" ? (
              <motion.div key="mynode" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.15 }}>
                <MyNodeTab tnkPeerCount={tnkPeerCount} />
              </motion.div>
            ) : activeTab === "livepeers" ? (
              <motion.div key="livepeers" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }}>
                <LivePeersTab
                  fromToken={fromToken}
                  toToken={toToken}
                  livePeers={livePeers}
                  activePeerCount={activePeerCount}
                />
              </motion.div>
            ) : (
              <motion.div key="history" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }}>
                <SettledHtlcsPanel />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── HTLC Signing Progress Dialog (preserved from LightPeerPanel) ── */}
      <AnimatePresence>
        {peer.htlcSigning && peer.htlcSigning.step !== "idle" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
            onClick={(e) => {
              const step = peer.htlcSigning?.step;
              if (e.target === e.currentTarget && step !== "signing" && step !== "locking") {
                peer.dismissHtlc();
              }
            }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="rounded-2xl p-6 w-80"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-center gap-2 mb-4">
                <Lock className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-bold text-foreground">HTLC Atomic Swap</span>
              </div>
              <div className="space-y-3 mb-5">
                {(["signing", "locking", "revealing", "settled"] as HtlcStep[]).map((step, stepIdx) => {
                  const steps: HtlcStep[] = ["signing", "locking", "revealing", "settled"];
                  const currentIdx = steps.indexOf(peer.htlcSigning!.step);
                  const isDone = peer.htlcSigning!.step === "settled" || stepIdx < currentIdx;
                  const isActive = peer.htlcSigning!.step === step;
                  const labels: Record<string, string> = {
                    signing: "Sign HTLC lock transaction",
                    locking: "Lock funds in escrow",
                    revealing: "Reveal secret hash",
                    settled: "Atomic settlement complete",
                  };
                  return (
                    <div key={step} className="flex items-center gap-3">
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold"
                        style={{
                          background: isDone ? "rgba(16,185,129,0.2)" : isActive ? "rgba(6,182,212,0.2)" : "var(--muted)",
                          border: `1px solid ${isDone ? "#10b981" : isActive ? "#06b6d4" : "var(--border)"}`,
                          color: isDone ? "#10b981" : isActive ? "#06b6d4" : "var(--muted-foreground)",
                        }}
                      >
                        {isDone ? "✓" : isActive ? <span className="animate-spin inline-block">◌</span> : stepIdx + 1}
                      </div>
                      <span className="text-xs" style={{ color: isDone ? "#10b981" : isActive ? "#06b6d4" : "var(--muted-foreground)" }}>
                        {labels[step]}
                      </span>
                    </div>
                  );
                })}
                {peer.htlcSigning.step === "failed" && (
                  <div className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold"
                      style={{ background: "rgba(239,68,68,0.2)", border: "1px solid #ef4444", color: "#ef4444" }}
                    >✗</div>
                    <span className="text-xs text-red-400">{peer.htlcSigning.error ?? "Signing failed"}</span>
                  </div>
                )}
              </div>
              {peer.htlcSigning.txHash && (
                <div className="rounded-lg px-3 py-2 mb-4" style={{ background: "var(--muted)" }}>
                  <div className="text-[9px] text-slate-500 mb-0.5">Transaction Hash</div>
                  <div className="text-[10px] font-mono text-emerald-400 break-all">{peer.htlcSigning.txHash}</div>
                </div>
              )}
              {(peer.htlcSigning.step === "settled" || peer.htlcSigning.step === "failed") && (
                <button
                  onClick={peer.dismissHtlc}
                  className="w-full py-2 rounded-xl text-xs font-bold transition-all hover:opacity-80"
                  style={{ background: "rgba(6,182,212,0.15)", color: "#06b6d4", border: "1px solid rgba(6,182,212,0.3)" }}
                >
                  {peer.htlcSigning.step === "settled" ? "Done" : "Dismiss"}
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
