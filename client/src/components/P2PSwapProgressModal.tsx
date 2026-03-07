/**
 * P2PSwapProgressModal — Live P2P HTLC Atomic Swap Progress
 *
 * Shows the real-time state of a P2P atomic swap between two peers.
 * Displayed on both sides (requester and maker) as the swap progresses.
 */
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Loader2, XCircle, ExternalLink, Lock, Unlock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { P2PSwapState, P2PSwapPhase } from "../hooks/useP2PSwap";

interface P2PSwapProgressModalProps {
  swap: P2PSwapState | null;
  onDismiss: () => void;
}

interface Step {
  id: string;
  label: string;
  desc: string;
  phases: P2PSwapPhase[];
  completedPhases: P2PSwapPhase[];
}

const REQUESTER_STEPS: Step[] = [
  {
    id: "accepted",
    label: "Quote Accepted",
    desc: "P2P quote accepted from LP peer",
    phases: ["accepted"],
    completedPhases: ["locking_a", "waiting_b", "revealing", "complete"],
  },
  {
    id: "locking_a",
    label: "Lock Your Funds",
    desc: "Signing HTLC lock transaction — funds go into escrow",
    phases: ["locking_a"],
    completedPhases: ["waiting_b", "revealing", "complete"],
  },
  {
    id: "waiting_b",
    label: "LP Locks Their Side",
    desc: "Waiting for LP to lock their funds in escrow",
    phases: ["waiting_b"],
    completedPhases: ["revealing", "complete"],
  },
  {
    id: "revealing",
    label: "Reveal Secret",
    desc: "Revealing secret to complete atomic settlement",
    phases: ["revealing"],
    completedPhases: ["complete"],
  },
  {
    id: "complete",
    label: "Swap Complete",
    desc: "Atomic swap settled — funds in your wallet",
    phases: ["complete"],
    completedPhases: [],
  },
];

const MAKER_STEPS: Step[] = [
  {
    id: "received_params",
    label: "HTLC Params Received",
    desc: "Requester has locked their funds — your turn",
    phases: ["received_params"],
    completedPhases: ["locking_b", "locked_b", "claiming", "complete"],
  },
  {
    id: "locking_b",
    label: "Lock Your Side",
    desc: "Signing HTLC lock transaction for your side",
    phases: ["locking_b"],
    completedPhases: ["locked_b", "claiming", "complete"],
  },
  {
    id: "locked_b",
    label: "Waiting for Secret",
    desc: "Waiting for requester to reveal secret",
    phases: ["locked_b"],
    completedPhases: ["claiming", "complete"],
  },
  {
    id: "claiming",
    label: "Claim Funds",
    desc: "Claiming your funds using the revealed secret",
    phases: ["claiming"],
    completedPhases: ["complete"],
  },
  {
    id: "complete",
    label: "Swap Complete",
    desc: "Atomic swap settled — funds in your wallet",
    phases: ["complete"],
    completedPhases: [],
  },
];

function getStepStatus(step: Step, currentPhase: P2PSwapPhase): "complete" | "active" | "pending" {
  if (step.completedPhases.includes(currentPhase)) return "complete";
  if (step.phases.includes(currentPhase)) return "active";
  return "pending";
}

function TxLink({ hash, chain }: { hash: string; chain?: string }) {
  const url = chain === "ethereum"
    ? `https://etherscan.io/tx/${hash}`
    : `https://solscan.io/tx/${hash}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 font-mono"
    >
      {hash.slice(0, 12)}…
      <ExternalLink className="w-3 h-3" />
    </a>
  );
}

export function P2PSwapProgressModal({ swap, onDismiss }: P2PSwapProgressModalProps) {
  if (!swap) return null;

  const steps = swap.role === "requester" ? REQUESTER_STEPS : MAKER_STEPS;
  const isFailed = swap.phase === "failed";
  const isComplete = swap.phase === "complete";

  return (
    <AnimatePresence>
      {swap && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
          onClick={(e) => { if (e.target === e.currentTarget && (isComplete || isFailed)) onDismiss(); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="w-full max-w-md rounded-2xl p-6 relative"
            style={{
              background: "linear-gradient(135deg, rgba(10,15,30,0.98) 0%, rgba(5,10,25,0.98) 100%)",
              border: isFailed
                ? "1px solid rgba(239,68,68,0.4)"
                : isComplete
                  ? "1px solid rgba(16,185,129,0.4)"
                  : "1px solid rgba(6,182,212,0.3)",
              boxShadow: isComplete
                ? "0 0 40px rgba(16,185,129,0.15)"
                : isFailed
                  ? "0 0 40px rgba(239,68,68,0.15)"
                  : "0 0 40px rgba(6,182,212,0.1)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background: isFailed
                      ? "rgba(239,68,68,0.15)"
                      : isComplete
                        ? "rgba(16,185,129,0.15)"
                        : "rgba(6,182,212,0.15)",
                  }}
                >
                  {isFailed ? (
                    <XCircle className="w-5 h-5 text-red-400" />
                  ) : isComplete ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <Lock className="w-5 h-5 text-cyan-400 animate-pulse" />
                  )}
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">
                    {isFailed ? "Swap Failed" : isComplete ? "Swap Complete" : "HTLC Atomic Swap"}
                  </div>
                  <div className="text-xs text-slate-400 font-mono">
                    {swap.role === "requester" ? "Requester" : "Liquidity Provider"} · {swap.rfqId.slice(0, 12)}…
                  </div>
                </div>
              </div>
              {(isComplete || isFailed) && (
                <button
                  onClick={onDismiss}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  ×
                </button>
              )}
            </div>

            {/* Trade Summary */}
            <div
              className="rounded-xl p-3 mb-5 flex items-center justify-between"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="text-center">
                <div className="text-lg font-bold text-white font-mono">{swap.fromAmount}</div>
                <div className="text-xs text-slate-400">{swap.fromToken}</div>
              </div>
              <ArrowRight className="w-4 h-4 text-cyan-400" />
              <div className="text-center">
                <div className="text-lg font-bold text-emerald-400 font-mono">{swap.toAmount}</div>
                <div className="text-xs text-slate-400">{swap.toToken}</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-slate-500">Rate</div>
                <div className="text-xs text-white font-mono">{swap.rate.toFixed(4)}</div>
              </div>
            </div>

            {/* Failed state */}
            {isFailed && (
              <div
                className="rounded-xl p-4 mb-5"
                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}
              >
                <div className="text-sm text-red-300 font-medium mb-1">Swap failed</div>
                <div className="text-xs text-red-400/70">{swap.error ?? "Unknown error"}</div>
                <div className="text-xs text-slate-500 mt-2">
                  Your funds are safe — the HTLC will automatically refund after the timelock expires.
                </div>
              </div>
            )}

            {/* Steps */}
            {!isFailed && (
              <div className="space-y-3 mb-5">
                {steps.map((step, i) => {
                  const status = getStepStatus(step, swap.phase);
                  return (
                    <div key={step.id} className="flex items-start gap-3">
                      <div className="flex flex-col items-center mt-0.5 flex-shrink-0">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center transition-all duration-500"
                          style={{
                            background: status === "complete"
                              ? "rgba(16,185,129,0.2)"
                              : status === "active"
                                ? "rgba(6,182,212,0.2)"
                                : "rgba(255,255,255,0.05)",
                            border: status === "complete"
                              ? "1.5px solid rgba(16,185,129,0.6)"
                              : status === "active"
                                ? "1.5px solid rgba(6,182,212,0.6)"
                                : "1.5px solid rgba(255,255,255,0.1)",
                            boxShadow: status === "active" ? "0 0 12px rgba(6,182,212,0.3)" : "none",
                          }}
                        >
                          {status === "complete" ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          ) : status === "active" ? (
                            <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                          ) : (
                            <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                          )}
                        </div>
                        {i < steps.length - 1 && (
                          <div
                            className="w-px h-5 mt-1 transition-all duration-700"
                            style={{
                              background: status === "complete"
                                ? "rgba(16,185,129,0.4)"
                                : "rgba(255,255,255,0.08)",
                            }}
                          />
                        )}
                      </div>
                      <div className="flex-1 pb-1">
                        <div
                          className="text-sm font-medium transition-colors duration-300"
                          style={{
                            color: status === "complete"
                              ? "#10b981"
                              : status === "active"
                                ? "#e2e8f0"
                                : "#64748b",
                          }}
                        >
                          {step.label}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">{step.desc}</div>

                        {/* Tx links for relevant steps */}
                        {step.id === "locking_a" && swap.lockTxHashA && (
                          <div className="mt-1">
                            <TxLink hash={swap.lockTxHashA} chain={swap.fromChain} />
                          </div>
                        )}
                        {step.id === "locking_b" && swap.lockTxHashB && (
                          <div className="mt-1">
                            <TxLink hash={swap.lockTxHashB} chain={swap.toChain} />
                          </div>
                        )}
                        {step.id === "revealing" && swap.revealTxHash && (
                          <div className="mt-1">
                            <TxLink hash={swap.revealTxHash} chain={swap.fromChain} />
                          </div>
                        )}
                        {step.id === "claiming" && swap.claimTxHash && (
                          <div className="mt-1">
                            <TxLink hash={swap.claimTxHash} chain={swap.toChain} />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Complete state */}
            {isComplete && (
              <div
                className="rounded-xl p-4 mb-5"
                style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Unlock className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm text-emerald-300 font-medium">Atomic swap complete</span>
                </div>
                <div className="text-xs text-emerald-400/60">
                  Funds settled atomically — no counterparty risk at any point.
                </div>
              </div>
            )}

            {/* HTLC escrow addresses */}
            {(swap.escrowAddressA || swap.escrowAddressB) && (
              <div
                className="rounded-lg p-3 mb-4 space-y-1.5"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}
              >
                <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Escrow Addresses</div>
                {swap.escrowAddressA && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">Side A:</span>
                    <span className="text-xs font-mono text-slate-300">
                      {swap.escrowAddressA.slice(0, 8)}…{swap.escrowAddressA.slice(-6)}
                    </span>
                  </div>
                )}
                {swap.escrowAddressB && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">Side B:</span>
                    <span className="text-xs font-mono text-slate-300">
                      {swap.escrowAddressB.slice(0, 8)}…{swap.escrowAddressB.slice(-6)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Action buttons */}
            {(isComplete || isFailed) && (
              <Button
                onClick={onDismiss}
                className="w-full"
                style={{
                  background: isComplete
                    ? "linear-gradient(135deg, #059669 0%, #10b981 100%)"
                    : "rgba(255,255,255,0.08)",
                  color: "white",
                  border: "none",
                }}
              >
                {isComplete ? "Done" : "Close"}
              </Button>
            )}

            {/* In-progress footer */}
            {!isComplete && !isFailed && (
              <div className="text-center text-xs text-slate-600 mt-2">
                Do not close this window — swap is in progress
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
