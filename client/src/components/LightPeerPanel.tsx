/**
 * LightPeerPanel — Browser Wallet P2P Peer Management UI
 *
 * Shown as a collapsible panel on the Swaps page.
 * Lets users configure their light peer settings, view incoming RFQs,
 * accept/reject trades, and see their peer stats.
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Radio, Settings2, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Clock, Zap, TrendingUp,
  Users, Shield, AlertCircle, RefreshCw,
  ToggleLeft, ToggleRight, Info,
} from "lucide-react";
import { useLightPeer, type IncomingRfq } from "../contexts/LightPeerContext";
import { useWallet } from "../contexts/WalletContext";
import { useMultiChainWallet } from "../contexts/MultiChainWalletContext";

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

// ─── RFQ Card ─────────────────────────────────────────────────────────────────

function RfqCard({ rfq, onAccept, onReject }: {
  rfq: IncomingRfq;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-slate-400">
            {rfq.requestorPeer.slice(0, 8)}…
          </span>
          <span className={`flex items-center gap-1 text-[10px] font-medium ${statusColor}`}>
            {statusIcon}
            {rfq.status === "pending" ? timeLeft(rfq.expiresAt) : rfq.status}
          </span>
        </div>
        <span className="text-[10px] text-slate-500">{timeAgo(rfq.receivedAt)}</span>
      </div>

      {/* Trade details */}
      <div className="flex items-center gap-2 text-sm">
        <span className="font-semibold text-white">
          {rfq.amount.toFixed(4)} <span className="text-cyan-400">{rfq.fromToken}</span>
        </span>
        <span className="text-slate-500">→</span>
        <span className="font-semibold text-white">
          {rfq.suggestedOutAmount.toFixed(4)} <span className="text-emerald-400">{rfq.toToken}</span>
        </span>
      </div>

      {/* Rate */}
      <div className="text-[10px] text-slate-400">
        Rate: 1 {rfq.fromToken} = {rfq.suggestedRate.toFixed(6)} {rfq.toToken}
        &nbsp;·&nbsp;
        {rfq.fromChain} → {rfq.toChain}
      </div>

      {/* Actions */}
      {isPending && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onAccept(rfq.rfqId)}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-400 text-xs font-medium transition-colors"
          >
            <CheckCircle2 className="w-3 h-3" />
            Accept
          </button>
          <button
            onClick={() => onReject(rfq.rfqId)}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-medium transition-colors"
          >
            <XCircle className="w-3 h-3" />
            Reject
          </button>
        </div>
      )}
    </motion.div>
  );
}

// ─── Pair Toggle ──────────────────────────────────────────────────────────────

const ALL_PAIRS = [
  "SOL/USDT", "SOL/USDC", "ETH/USDT", "ETH/USDC",
  "BTC/USDT", "BTC/ETH", "BTC/SOL",
];

function PairToggle({ pair, active, onToggle }: {
  pair: string;
  active: boolean;
  onToggle: () => void;
}) {
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

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function LightPeerPanel() {
  const peer = useLightPeer();
  const { connected: solConnected } = useWallet();
  const { ethereum, bitcoin } = useMultiChainWallet();

  const isWalletConnected = solConnected || !!ethereum?.address || !!bitcoin?.address;

  const [expanded, setExpanded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [spreadInput, setSpreadInput] = useState(String(peer.prefs.spreadBps));
  const [minInput, setMinInput] = useState(String(peer.prefs.minTradeUsd));
  const [maxInput, setMaxInput] = useState(String(peer.prefs.maxTradeUsd));

  // Listen for open-peer-panel event (from toast notification)
  useEffect(() => {
    const handler = () => setExpanded(true);
    window.addEventListener("afos:open-peer-panel", handler);
    return () => window.removeEventListener("afos:open-peer-panel", handler);
  }, []);

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
    <div className="rounded-xl border border-white/10 bg-[#0d1117]/80 backdrop-blur-sm overflow-hidden">
      {/* ── Header ── */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          {/* Status dot */}
          {isWalletConnected && peer.prefs.enabled ? (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
          ) : (
            <span className="h-2 w-2 rounded-full bg-slate-600" />
          )}

          <span className="text-sm font-semibold text-white">Light Peer</span>

          {isWalletConnected && peer.prefs.enabled ? (
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
          )}

          {pendingRfqs.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse">
              {pendingRfqs.length} RFQ{pendingRfqs.length > 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-slate-400">
          {peer.isOnline && (
            <span className="text-[10px] font-mono text-slate-500">
              {peer.peerAlias}
            </span>
          )}
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* ── Expanded content ── */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4 border-t border-white/10 pt-3">

              {/* ── No wallet connected ── */}
              {!isWalletConnected && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs">
                  <Info className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold mb-0.5">Connect a wallet to become a peer</p>
                    <p className="text-blue-400/70">
                      When you connect Phantom, MetaMask, or any supported wallet, you automatically
                      join the IntercomSwap P2P network as a quoting peer — no server required.
                    </p>
                  </div>
                </div>
              )}

              {/* ── Stats row ── */}
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

              {/* ── Enable/disable toggle ── */}
              {isWalletConnected && (
                <div className="flex items-center justify-between py-2 border-b border-white/10">
                  <div>
                    <p className="text-sm font-medium text-white">Peer Mode</p>
                    <p className="text-[10px] text-slate-500">
                      {peer.prefs.enabled
                        ? "Actively quoting on the P2P network"
                        : "Not quoting — you won't receive RFQs"}
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

              {/* ── Auto-accept toggle ── */}
              {isWalletConnected && peer.prefs.enabled && (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">Auto-Accept</p>
                    <p className="text-[10px] text-slate-500">
                      Automatically accept matching RFQs without confirmation
                    </p>
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

              {/* ── Settings panel ── */}
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
                          {/* Spread */}
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-1">
                              Spread (basis points) — your profit margin
                            </label>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min={1}
                                max={500}
                                value={spreadInput}
                                onChange={e => setSpreadInput(e.target.value)}
                                className="w-20 px-2 py-1 rounded bg-white/10 border border-white/15 text-white text-xs font-mono focus:outline-none focus:border-cyan-500/50"
                              />
                              <span className="text-[10px] text-slate-500">
                                = {(parseInt(spreadInput) / 100 || 0).toFixed(2)}% above market
                              </span>
                            </div>
                          </div>

                          {/* Trade size */}
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-1">Min trade (USD)</label>
                              <input
                                type="number"
                                min={1}
                                value={minInput}
                                onChange={e => setMinInput(e.target.value)}
                                className="w-full px-2 py-1 rounded bg-white/10 border border-white/15 text-white text-xs font-mono focus:outline-none focus:border-cyan-500/50"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-1">Max trade (USD)</label>
                              <input
                                type="number"
                                min={1}
                                value={maxInput}
                                onChange={e => setMaxInput(e.target.value)}
                                className="w-full px-2 py-1 rounded bg-white/10 border border-white/15 text-white text-xs font-mono focus:outline-none focus:border-cyan-500/50"
                              />
                            </div>
                          </div>

                          {/* Accepted pairs */}
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-1.5">Accepted pairs</label>
                            <div className="flex flex-wrap gap-1.5">
                              {ALL_PAIRS.map(pair => (
                                <PairToggle
                                  key={pair}
                                  pair={pair}
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

              {/* ── Incoming RFQs ── */}
              {isWalletConnected && peer.prefs.enabled && (
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
                      {peer.lastHeartbeat ? `Heartbeat ${timeAgo(peer.lastHeartbeat)}` : "Connecting…"}
                    </span>
                  </div>

                  {recentRfqs.length === 0 ? (
                    <div className="text-center py-4 text-slate-500 text-xs">
                      <Radio className="w-5 h-5 mx-auto mb-1 opacity-30" />
                      Listening for RFQs on accepted pairs…
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
                          />
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              )}

              {/* ── HTLC info ── */}
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
