/**
 * AgentChatHero — Animated futuristic chat simulation for the landing page.
 * Shows the AFOS agent autonomously executing a cross-chain swap step by step.
 * 
 * Sequence:
 * 1. User types "swap 0.1 BTC to SOL"
 * 2. Agent thinks (scanning peers...)
 * 3. Agent finds peer, shows quote
 * 4. Agent locks HTLC on Bitcoin chain
 * 5. Agent locks HTLC on Solana chain
 * 6. Atomic settlement — both sides reveal
 * 7. Success — swap complete
 * 
 * Then loops.
 */

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, CheckCircle2, Search, Lock, Unlock, ArrowRight,
  Radio, Zap, Shield
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type StepType = "user_typing" | "agent_thinking" | "agent_message" | "agent_action" | "success" | "pause";

interface ChatStep {
  type: StepType;
  text?: string;
  subtext?: string;
  icon?: React.ReactNode;
  duration: number; // ms to show before next step
  tag?: string;     // status tag like "SCANNING", "LOCKING", etc.
  tagColor?: string;
}

// ─── Animation sequence ──────────────────────────────────────────────────────

const CHAT_SEQUENCE: ChatStep[] = [
  // User types
  {
    type: "user_typing",
    text: "swap 0.1 BTC to SOL",
    duration: 2200,
  },
  // Agent starts thinking
  {
    type: "agent_thinking",
    text: "Analyzing request...",
    tag: "PROCESSING",
    tagColor: "#f59e0b",
    duration: 1200,
  },
  // Agent scans P2P network
  {
    type: "agent_action",
    text: "Scanning P2P network for counterparties",
    subtext: "Broadcasting RFQ to 12 peers on IntercomSwap relay",
    icon: <Radio className="w-3.5 h-3.5" />,
    tag: "SCANNING",
    tagColor: "#06b6d4",
    duration: 1800,
  },
  // Agent finds peer
  {
    type: "agent_message",
    text: "Found peer lp-a709a6 offering 79.74 SOL",
    subtext: "Rate: 1 BTC = 797.4 SOL · Spread: 0.12% · Score: 98/100",
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
    tag: "MATCHED",
    tagColor: "#10b981",
    duration: 1600,
  },
  // Lock BTC
  {
    type: "agent_action",
    text: "Locking 0.1 BTC in HTLC escrow",
    subtext: "Hash: 7f3a9b...c2d1 · Timelock: 144 blocks · Chain: Bitcoin",
    icon: <Lock className="w-3.5 h-3.5" />,
    tag: "LOCKING",
    tagColor: "#f59e0b",
    duration: 2000,
  },
  // Lock SOL
  {
    type: "agent_action",
    text: "Peer locked 79.74 SOL in HTLC escrow",
    subtext: "Same hash · Timelock: 72 blocks · Chain: Solana",
    icon: <Lock className="w-3.5 h-3.5" />,
    tag: "LOCKED",
    tagColor: "#8b5cf6",
    duration: 1600,
  },
  // Reveal & settle
  {
    type: "agent_action",
    text: "Revealing secret → atomic settlement",
    subtext: "Both chains settling simultaneously · No counterparty risk",
    icon: <Unlock className="w-3.5 h-3.5" />,
    tag: "SETTLING",
    tagColor: "#06b6d4",
    duration: 1800,
  },
  // Success
  {
    type: "success",
    text: "Swap complete! Received 79.74 SOL",
    subtext: "0.1 BTC → 79.74 SOL · Fee: 0.15% · Time: 8.2s · Tx: 4kR9...xF2m",
    icon: <Zap className="w-3.5 h-3.5" />,
    tag: "SETTLED",
    tagColor: "#10b981",
    duration: 3500,
  },
  // Pause before loop
  {
    type: "pause",
    duration: 2000,
  },
];

// ─── Typing animation ────────────────────────────────────────────────────────

function TypeWriter({ text, speed = 45 }: { text: string; speed?: number }) {
  const [displayed, setDisplayed] = useState("");
  const indexRef = useRef(0);

  useEffect(() => {
    setDisplayed("");
    indexRef.current = 0;
    const interval = setInterval(() => {
      indexRef.current++;
      setDisplayed(text.slice(0, indexRef.current));
      if (indexRef.current >= text.length) clearInterval(interval);
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed]);

  return (
    <span>
      {displayed}
      {displayed.length < text.length && (
        <span className="inline-block w-[2px] h-4 ml-0.5 align-middle animate-pulse" style={{ background: "oklch(0.72 0.18 195)" }} />
      )}
    </span>
  );
}

// ─── Pulsing dot ─────────────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 ml-1">
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: "oklch(0.72 0.18 195)" }}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </span>
  );
}

// ─── Scan line effect ────────────────────────────────────────────────────────

function ScanLine() {
  return (
    <motion.div
      className="absolute left-0 right-0 h-[1px] pointer-events-none z-20"
      style={{ background: "linear-gradient(90deg, transparent, oklch(0.72 0.18 195 / 0.4), transparent)" }}
      animate={{ top: ["0%", "100%"] }}
      transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
    />
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function AgentChatHero() {
  const [stepIndex, setStepIndex] = useState(0);
  const [visibleMessages, setVisibleMessages] = useState<ChatStep[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Run the animation sequence
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    const runStep = (idx: number) => {
      const step = CHAT_SEQUENCE[idx];
      if (!step) {
        // Loop: reset
        setVisibleMessages([]);
        setStepIndex(0);
        timeout = setTimeout(() => runStep(0), 800);
        return;
      }

      setStepIndex(idx);

      if (step.type !== "pause") {
        setVisibleMessages(prev => [...prev, step]);
      }

      timeout = setTimeout(() => runStep(idx + 1), step.duration);
    };

    // Start after a brief delay
    timeout = setTimeout(() => runStep(0), 1200);

    return () => clearTimeout(timeout);
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleMessages]);

  return (
    <div className="relative w-full max-w-lg">
      {/* Outer glow */}
      <div
        className="absolute -inset-[1px] rounded-3xl opacity-60 pointer-events-none"
        style={{
          background: "linear-gradient(135deg, oklch(0.72 0.18 195 / 0.3), oklch(0.6 0.2 280 / 0.2), oklch(0.72 0.18 195 / 0.15))",
          filter: "blur(1px)",
        }}
      />

      {/* Main container */}
      <div
        className="relative rounded-3xl overflow-hidden"
        style={{
          background: "oklch(0.09 0.02 260 / 0.95)",
          border: "1px solid oklch(0.28 0.04 255 / 0.5)",
          backdropFilter: "blur(20px)",
          boxShadow: "0 0 80px oklch(0.72 0.18 195 / 0.06), inset 0 1px 0 oklch(1 0 0 / 0.03)",
        }}
      >
        <ScanLine />

        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3.5"
          style={{ borderBottom: "1px solid oklch(0.28 0.04 255 / 0.4)" }}
        >
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <img
                src="/afos-icon.png"
                alt="AFOS"
                className="w-8 h-8 rounded-xl object-contain ring-1 ring-white/10 shadow-sm"
                style={{ filter: "drop-shadow(0 0 8px oklch(0.72 0.18 195 / 0.3))" }}
              />
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border border-black" />
            </div>
            <div>
              <p className="text-xs font-bold text-white leading-none">AFOS Agent</p>
              <p className="text-[9px] font-mono mt-0.5" style={{ color: "oklch(0.55 0.04 255)" }}>
                P2P · Hyperswarm · Intercomswap Powered by Trac Network
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[9px] font-mono font-bold text-emerald-400">LIVE</span>
          </div>
        </div>

        {/* Chat messages area */}
        <div
          ref={scrollRef}
          className="px-4 py-4 space-y-3 overflow-y-auto"
          style={{ height: 340, scrollBehavior: "smooth" }}
        >
          <AnimatePresence>
            {visibleMessages.map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              >
                {step.type === "user_typing" ? (
                  /* User message — right aligned */
                  <div className="flex justify-end">
                    <div
                      className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md"
                      style={{
                        background: "linear-gradient(135deg, oklch(0.72 0.18 195 / 0.2), oklch(0.6 0.2 280 / 0.15))",
                        border: "1px solid oklch(0.72 0.18 195 / 0.3)",
                      }}
                    >
                      <p className="text-sm font-medium text-white">
                        <TypeWriter text={step.text || ""} speed={55} />
                      </p>
                    </div>
                  </div>
                ) : step.type === "agent_thinking" ? (
                  /* Agent thinking */
                  <div className="flex items-start gap-2.5">
                    <div
                      className="w-6 h-6 rounded-lg shrink-0 flex items-center justify-center mt-0.5"
                      style={{ background: "oklch(0.72 0.18 195 / 0.12)", border: "1px solid oklch(0.72 0.18 195 / 0.25)" }}
                    >
                      <Bot className="w-3.5 h-3.5" style={{ color: "oklch(0.72 0.18 195)" }} />
                    </div>
                    <div
                      className="px-4 py-2.5 rounded-2xl rounded-tl-md"
                      style={{
                        background: "oklch(0.14 0.025 260)",
                        border: "1px solid oklch(0.28 0.04 255 / 0.35)",
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: "oklch(0.65 0.04 255)" }}>
                          {step.text}
                        </span>
                        <ThinkingDots />
                      </div>
                    </div>
                  </div>
                ) : step.type === "agent_message" || step.type === "agent_action" ? (
                  /* Agent action/message */
                  <div className="flex items-start gap-2.5">
                    <div
                      className="w-6 h-6 rounded-lg shrink-0 flex items-center justify-center mt-0.5"
                      style={{
                        background: `${step.tagColor}15`,
                        border: `1px solid ${step.tagColor}40`,
                      }}
                    >
                      <span style={{ color: step.tagColor }}>{step.icon}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div
                        className="px-4 py-3 rounded-2xl rounded-tl-md"
                        style={{
                          background: "oklch(0.14 0.025 260)",
                          border: "1px solid oklch(0.28 0.04 255 / 0.35)",
                        }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          {step.tag && (
                            <span
                              className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider"
                              style={{
                                background: `${step.tagColor}15`,
                                border: `1px solid ${step.tagColor}35`,
                                color: step.tagColor,
                              }}
                            >
                              {step.tag}
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-medium text-white leading-relaxed">{step.text}</p>
                        {step.subtext && (
                          <p className="text-[10px] mt-1.5 font-mono leading-relaxed" style={{ color: "oklch(0.55 0.04 255)" }}>
                            {step.subtext}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : step.type === "success" ? (
                  /* Success message */
                  <div className="flex items-start gap-2.5">
                    <div
                      className="w-6 h-6 rounded-lg shrink-0 flex items-center justify-center mt-0.5"
                      style={{
                        background: "rgba(16,185,129,0.15)",
                        border: "1px solid rgba(16,185,129,0.35)",
                      }}
                    >
                      <Zap className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div
                        className="px-4 py-3 rounded-2xl rounded-tl-md relative overflow-hidden"
                        style={{
                          background: "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(6,182,212,0.06))",
                          border: "1px solid rgba(16,185,129,0.3)",
                        }}
                      >
                        {/* Success shimmer */}
                        <motion.div
                          className="absolute inset-0 pointer-events-none"
                          style={{
                            background: "linear-gradient(90deg, transparent, rgba(16,185,129,0.1), transparent)",
                          }}
                          animate={{ x: ["-100%", "200%"] }}
                          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                        />
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider"
                            style={{
                              background: "rgba(16,185,129,0.15)",
                              border: "1px solid rgba(16,185,129,0.35)",
                              color: "#10b981",
                            }}
                          >
                            {step.tag}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-emerald-400 leading-relaxed relative z-10">{step.text}</p>
                        {step.subtext && (
                          <p className="text-[10px] mt-1.5 font-mono leading-relaxed relative z-10" style={{ color: "oklch(0.55 0.04 255)" }}>
                            {step.subtext}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Input area (decorative) */}
        <div
          className="px-4 py-3"
          style={{ borderTop: "1px solid oklch(0.28 0.04 255 / 0.3)" }}
        >
          <div
            className="flex items-center gap-3 px-4 py-2.5 rounded-2xl"
            style={{
              background: "oklch(0.14 0.025 260)",
              border: "1px solid oklch(0.28 0.04 255 / 0.35)",
            }}
          >
            <span className="text-xs flex-1" style={{ color: "oklch(0.45 0.03 255)" }}>
              Tell the agent what to swap...
            </span>
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "oklch(0.72 0.18 195 / 0.15)", border: "1px solid oklch(0.72 0.18 195 / 0.3)" }}
            >
              <ArrowRight className="w-3.5 h-3.5" style={{ color: "oklch(0.72 0.18 195)" }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Mobile condensed hero ──────────────────────────────────────────────────
// Shows a single animated step at a time — compact enough for small screens.

const MOBILE_STEPS = [
  { tag: "SCANNING",  tagColor: "#06b6d4",  text: "Finding best peer for 0.1 BTC → SOL",   icon: <Radio className="w-4 h-4" /> },
  { tag: "MATCHED",   tagColor: "#10b981",  text: "Peer matched · 79.74 SOL · Score 98/100", icon: <CheckCircle2 className="w-4 h-4" /> },
  { tag: "LOCKING",   tagColor: "#f59e0b",  text: "Locking HTLC escrow on Bitcoin chain",    icon: <Lock className="w-4 h-4" /> },
  { tag: "LOCKED",    tagColor: "#8b5cf6",  text: "Peer locked SOL escrow · Same hash",      icon: <Lock className="w-4 h-4" /> },
  { tag: "SETTLING",  tagColor: "#06b6d4",  text: "Revealing secret → atomic settlement",   icon: <Unlock className="w-4 h-4" /> },
  { tag: "SETTLED",   tagColor: "#10b981",  text: "Swap complete · 79.74 SOL received",     icon: <Zap className="w-4 h-4" /> },
];

export function MobileAgentHero() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % MOBILE_STEPS.length), 2000);
    return () => clearInterval(t);
  }, []);

  const step = MOBILE_STEPS[idx];

  return (
    <div
      className="relative w-full rounded-2xl overflow-hidden mt-6"
      style={{
        background: "oklch(0.09 0.02 260 / 0.95)",
        border: "1px solid oklch(0.28 0.04 255 / 0.45)",
        boxShadow: "0 0 40px oklch(0.72 0.18 195 / 0.08)",
      }}
    >
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: "1px solid oklch(0.28 0.04 255 / 0.35)" }}
      >
        <div className="flex items-center gap-2">
          <img src="/afos-icon.png" alt="AFOS" className="w-6 h-6 rounded-lg object-contain ring-1 ring-white/10" />
          <span className="text-xs font-bold text-white">AFOS Agent</span>
          <span className="text-[9px] font-mono" style={{ color: "oklch(0.55 0.04 255)" }}>autonomous · P2P</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[9px] font-mono font-bold text-emerald-400">LIVE</span>
        </div>
      </div>

      {/* Animated step */}
      <div className="px-4 py-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="flex items-center gap-3"
          >
            {/* Icon */}
            <div
              className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center"
              style={{
                background: `${step.tagColor}18`,
                border: `1px solid ${step.tagColor}40`,
              }}
            >
              <span style={{ color: step.tagColor }}>{step.icon}</span>
            </div>
            {/* Text */}
            <div className="flex-1 min-w-0">
              <span
                className="inline-block text-[8px] font-mono font-bold px-1.5 py-0.5 rounded mb-1 uppercase tracking-widest"
                style={{
                  background: `${step.tagColor}18`,
                  border: `1px solid ${step.tagColor}35`,
                  color: step.tagColor,
                }}
              >
                {step.tag}
              </span>
              <p className="text-sm font-medium text-white leading-snug">{step.text}</p>
            </div>
            {/* Step counter */}
            <span className="text-[9px] font-mono shrink-0" style={{ color: "oklch(0.45 0.03 255)" }}>
              {idx + 1}/{MOBILE_STEPS.length}
            </span>
          </motion.div>
        </AnimatePresence>

        {/* Progress dots */}
        <div className="flex items-center gap-1.5 mt-4 justify-center">
          {MOBILE_STEPS.map((_, i) => (
            <div
              key={i}
              className="rounded-full transition-all duration-300"
              style={{
                width: i === idx ? 16 : 6,
                height: 4,
                background: i === idx ? "oklch(0.72 0.18 195)" : "oklch(0.28 0.04 255 / 0.5)",
              }}
            />
          ))}
        </div>
      </div>

      {/* User prompt row */}
      <div
        className="px-4 py-2.5 flex items-center gap-2"
        style={{ borderTop: "1px solid oklch(0.28 0.04 255 / 0.3)" }}
      >
        <span className="text-xs flex-1 truncate" style={{ color: "oklch(0.45 0.03 255)" }}>
          swap 0.1 BTC to SOL
        </span>
        <div
          className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "oklch(0.72 0.18 195 / 0.15)", border: "1px solid oklch(0.72 0.18 195 / 0.3)" }}
        >
          <ArrowRight className="w-3 h-3" style={{ color: "oklch(0.72 0.18 195)" }} />
        </div>
      </div>
    </div>
  );
}

export default AgentChatHero;
