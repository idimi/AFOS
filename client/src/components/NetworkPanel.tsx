/**
 * NetworkPanel — Unified P2P Network panel
 *
 * Combines "My Node" (Light Peer controls) and "Live Peers" (remote peer discovery)
 * into a single tabbed card so users see both sides of the P2P network in one place.
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Radio, Settings2, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Clock, Zap, TrendingUp,
  Users, Shield, AlertCircle, Network,
  ToggleLeft, ToggleRight, Info, Lock,
} from "lucide-react";
import { useLightPeer, type IncomingRfq, type HtlcStep } from "../contexts/LightPeerContext";
import { useWallet } from "../contexts/WalletContext";
import { useMultiChainWallet } from "../contexts/MultiChainWalletContext";

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

// ─── My Node Tab ──────────────────────────────────────────────────────────────

function MyNodeTab() {
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
              {peer.prefs.enabled ? "Actively quoting on the P2P network" : "Not quoting — you won't receive RFQs"}
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
                    <label className="text-[10px] text-slate-400 block mb-1.5">Accepted pairs</label>
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

      {/* Incoming RFQs */}
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
                  <RfqCard key={rfq.rfqId} rfq={rfq} onAccept={peer.acceptRfq} onReject={peer.rejectRfq} />
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

  const [activeTab, setActiveTab] = useState<"mynode" | "livepeers">(() => {
    try { return (localStorage.getItem("afos_network_tab") as "mynode" | "livepeers") || "mynode"; }
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
            {(["mynode", "livepeers"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-2 px-1 text-xs font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === tab
                    ? "border-cyan-400 text-cyan-400"
                    : "border-transparent text-slate-500 hover:text-slate-300"
                }`}
              >
                {tab === "mynode" ? "My Node" : "Live Peers"}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="px-4 py-4">
          <AnimatePresence mode="wait">
            {activeTab === "mynode" ? (
              <motion.div key="mynode" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.15 }}>
                <MyNodeTab />
              </motion.div>
            ) : (
              <motion.div key="livepeers" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }}>
                <LivePeersTab
                  fromToken={fromToken}
                  toToken={toToken}
                  livePeers={livePeers}
                  activePeerCount={activePeerCount}
                />
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
