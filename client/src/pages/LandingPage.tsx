/**
 * LandingPage — Public-facing homepage at /
 *
 * Explains the AFOS P2P cross-chain value proposition to first-time visitors.
 * No auth required. "Launch App" CTA navigates to /app.
 *
 * Design: Sci-fi dark aesthetic matching the AFOS dashboard theme.
 * Layout: Asymmetric hero → stats bar → how-it-works → features grid → CTA footer
 */

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight, Zap, Shield, Globe, Lock, ChevronRight,
  ArrowLeftRight, Cpu, Network, Activity, ExternalLink,
  CheckCircle2, X, MoreHorizontal, Sun, Moon, Monitor, Wallet
} from "lucide-react";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";

// ─── Animated counter ─────────────────────────────────────────────────────────
function AnimatedNumber({ value, prefix = "", suffix = "", decimals = 0 }: {
  value: number; prefix?: string; suffix?: string; decimals?: number;
}) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const start = 0;
    const duration = 1800;
    const startTime = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + (value - start) * eased);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value]);
  return (
    <span>
      {prefix}{display.toFixed(decimals)}{suffix}
    </span>
  );
}

// ─── Floating grid background ─────────────────────────────────────────────────
function GridBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Grid lines */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: `
            linear-gradient(oklch(0.72 0.18 195) 1px, transparent 1px),
            linear-gradient(90deg, oklch(0.72 0.18 195) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />
      {/* Radial glow top-left */}
      <div
        className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full opacity-20"
        style={{ background: "radial-gradient(circle, oklch(0.72 0.18 195 / 0.4) 0%, transparent 70%)" }}
      />
      {/* Radial glow bottom-right */}
      <div
        className="absolute -bottom-40 -right-20 w-[500px] h-[500px] rounded-full opacity-15"
        style={{ background: "radial-gradient(circle, oklch(0.55 0.22 290 / 0.4) 0%, transparent 70%)" }}
      />
    </div>
  );
}

// ─── Chain badge ──────────────────────────────────────────────────────────────
function ChainBadge({ name, color, symbol }: { name: string; color: string; symbol: string }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold"
      style={{ background: `${color}18`, border: `1px solid ${color}40`, color }}
    >
      <span className="text-sm">{symbol}</span>
      {name}
    </div>
  );
}

// ─── Feature card ─────────────────────────────────────────────────────────────
function FeatureCard({
  icon: Icon, title, description, color, delay
}: {
  icon: React.ElementType; title: string; description: string; color: string; delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.5 }}
      className="rounded-2xl p-5 group hover:scale-[1.02] transition-transform duration-300"
      style={{
        background: "oklch(0.12 0.025 255 / 0.6)",
        border: "1px solid oklch(0.32 0.04 255 / 0.35)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
        style={{ background: `${color}18`, border: `1px solid ${color}35` }}
      >
        <Icon className="w-5 h-5" style={{ color }} />
      </div>
      <p className="text-sm font-bold text-foreground mb-1.5">{title}</p>
      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
    </motion.div>
  );
}

// ─── Step card ────────────────────────────────────────────────────────────────
function StepCard({ step, title, description, color }: {
  step: number; title: string; description: string; color: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ delay: step * 0.15, duration: 0.5 }}
      className="flex gap-4"
    >
      <div className="flex-shrink-0 flex flex-col items-center">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black"
          style={{ background: `${color}20`, border: `1.5px solid ${color}60`, color }}
        >
          {step}
        </div>
        {step < 3 && <div className="w-px flex-1 mt-2" style={{ background: `${color}25` }} />}
      </div>
      <div className="pb-8">
        <p className="text-sm font-bold text-foreground mb-1">{title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      </div>
    </motion.div>
  );
}

// ─── Comparison table ─────────────────────────────────────────────────────────
const COMPARISON = [
  { feature: "Cross-chain (BTC ↔ ETH ↔ SOL)", afos: true, uni: false, jup: false, inch: false },
  { feature: "No bridge or wrapped assets", afos: true, uni: false, jup: false, inch: false },
  { feature: "No AMM / no liquidity pools", afos: true, uni: false, jup: false, inch: false },
  { feature: "Zero slippage (exact P2P fill)", afos: true, uni: false, jup: false, inch: false },
  { feature: "No MEV / front-running exposure", afos: true, uni: false, jup: false, inch: false },
  { feature: "Atomic settlement (HTLC)", afos: true, uni: false, jup: false, inch: false },
  { feature: "AI-powered swap agent", afos: true, uni: false, jup: false, inch: false },
];

// ─── Theme persistence helpers ───────────────────────────────────────────────
type ThemeMode = "auto" | "light" | "dark";

function getStoredTheme(): ThemeMode {
  try { return (localStorage.getItem("afos-theme") as ThemeMode) ?? "auto"; } catch { return "auto"; }
}

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === "dark") {
    root.classList.add("dark"); root.classList.remove("light");
  } else if (mode === "light") {
    root.classList.add("light"); root.classList.remove("dark");
  } else {
    // auto — follow system
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark", prefersDark);
    root.classList.toggle("light", !prefersDark);
  }
  try { localStorage.setItem("afos-theme", mode); } catch { /* ignore */ }
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(getStoredTheme);
  const prefsRef = useRef<HTMLDivElement>(null);

  // Live prices — refetch every 30s
  const { data: livePrice } = trpc.prices.live.useQuery(undefined, {
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  // Apply theme on mount and on change
  useEffect(() => { applyTheme(theme); }, [theme]);

  // Close popover on outside click
  useEffect(() => {
    if (!prefsOpen) return;
    const handler = (e: MouseEvent) => {
      if (prefsRef.current && !prefsRef.current.contains(e.target as Node)) {
        setPrefsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [prefsOpen]);

  const handleTheme = (mode: ThemeMode) => {
    setTheme(mode);
    applyTheme(mode);
  };

  return (
    <div
      className="min-h-screen font-sans"
      style={{ background: "oklch(0.085 0.02 260)", color: "oklch(0.92 0.01 220)" }}
    >
      {/* ── Nav ──────────────────────────────────────────────────────────────── */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4"
        style={{
          background: "oklch(0.085 0.02 260 / 0.85)",
          backdropFilter: "blur(20px)",
          borderBottom: "1px solid oklch(0.32 0.04 255 / 0.2)",
        }}
      >
        <a href="/" className="flex items-center gap-3 group">
          {/* AFOS icon — glowing blue A mark */}
          <img
            src="https://d2xsxph8kpxj0f.cloudfront.net/87744282/Cv4Jvx35N7jGsqrM8y5HAD/afos-icon_17336ddd.png"
            alt="AFOS"
            className="h-9 w-9 object-contain flex-shrink-0"
            style={{ filter: "drop-shadow(0 0 8px oklch(0.72 0.18 195 / 0.5))" }}
          />
          {/* Wordmark */}
          <span
            className="text-xl font-black tracking-tight leading-none"
            style={{
              background: "linear-gradient(135deg, oklch(0.92 0.01 220) 0%, oklch(0.72 0.18 195) 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            AFOS
          </span>
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ background: "oklch(0.72 0.18 195 / 0.15)", border: "1px solid oklch(0.72 0.18 195 / 0.3)", color: "oklch(0.72 0.18 195)" }}
          >
            BETA
          </span>
        </a>

        {/* Desktop nav links */}
        <div className="hidden md:flex items-center gap-6 text-xs font-medium text-muted-foreground">
          <a href="#how-it-works" className="hover:text-foreground transition-colors">How it works</a>
          <a href="#features" className="hover:text-foreground transition-colors">Features</a>
          <a href="#compare" className="hover:text-foreground transition-colors">Compare</a>
        </div>

        <div className="flex items-center gap-2">
          {/* ··· Preferences button + popover */}
          <div className="relative" ref={prefsRef}>
            <button
              onClick={() => setPrefsOpen(o => !o)}
              className="flex items-center justify-center w-9 h-9 rounded-xl transition-all"
              style={{
                background: prefsOpen ? "oklch(0.22 0.04 265)" : "oklch(0.14 0.03 265)",
                border: `1px solid ${prefsOpen ? "oklch(0.72 0.18 195 / 0.4)" : "oklch(0.32 0.04 255 / 0.3)"}`,
                color: prefsOpen ? "oklch(0.72 0.18 195)" : "oklch(0.65 0.04 255)",
              }}
              aria-label="Preferences"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            <AnimatePresence>
              {prefsOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.96 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className="absolute right-0 top-12 w-72 rounded-2xl p-4 z-50"
                  style={{
                    background: "oklch(0.12 0.025 265)",
                    border: "1px solid oklch(0.28 0.04 255 / 0.5)",
                    boxShadow: "0 20px 60px oklch(0 0 0 / 0.6), 0 0 0 1px oklch(0.72 0.18 195 / 0.06)",
                  }}
                >
                  <p className="text-sm font-bold text-white mb-4">Global preferences</p>

                  {/* Theme row */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm" style={{ color: "oklch(0.72 0.06 255)" }}>Theme</span>
                    <div
                      className="flex items-center gap-0.5 p-1 rounded-xl"
                      style={{ background: "oklch(0.18 0.03 265)", border: "1px solid oklch(0.28 0.04 255 / 0.4)" }}
                    >
                      {([
                        { mode: "auto" as ThemeMode, icon: <Monitor className="w-3.5 h-3.5" />, label: "Auto" },
                        { mode: "light" as ThemeMode, icon: <Sun className="w-3.5 h-3.5" />, label: "" },
                        { mode: "dark" as ThemeMode, icon: <Moon className="w-3.5 h-3.5" />, label: "" },
                      ]).map(({ mode, icon, label }) => (
                        <button
                          key={mode}
                          onClick={() => handleTheme(mode)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all"
                          style={{
                            background: theme === mode ? "oklch(0.72 0.18 195 / 0.15)" : "transparent",
                            border: `1px solid ${theme === mode ? "oklch(0.72 0.18 195 / 0.4)" : "transparent"}`,
                            color: theme === mode ? "oklch(0.72 0.18 195)" : "oklch(0.55 0.04 255)",
                          }}
                        >
                          {icon}
                          {label && <span>{label}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Launch App */}
          <a
            href="/app"
            className="hidden md:flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all hover:opacity-90"
            style={{
              background: "oklch(0.72 0.18 195)",
              color: "oklch(0.085 0.02 260)",
            }}
          >
            Launch App
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
          {/* Mobile menu toggle */}
          <button
            className="md:hidden p-2 rounded-lg"
            style={{ background: "oklch(0.16 0.03 265)" }}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </nav>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div
          className="fixed top-16 left-0 right-0 z-40 p-4 space-y-3"
          style={{ background: "oklch(0.1 0.025 260 / 0.97)", borderBottom: "1px solid oklch(0.32 0.04 255 / 0.25)" }}
        >
          <a href="#how-it-works" className="block py-2 text-sm text-muted-foreground" onClick={() => setMobileMenuOpen(false)}>How it works</a>
          <a href="#features" className="block py-2 text-sm text-muted-foreground" onClick={() => setMobileMenuOpen(false)}>Features</a>
          <a href="#compare" className="block py-2 text-sm text-muted-foreground" onClick={() => setMobileMenuOpen(false)}>Compare</a>
          <a
            href="/app"
            className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold"
            style={{ background: "oklch(0.72 0.18 195)", color: "oklch(0.085 0.02 260)" }}
          >
            Launch App <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      )}

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center pt-20 pb-16 px-6">
        <GridBackground />
        <div className="relative z-10 max-w-6xl mx-auto w-full">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left: copy */}
            <div>
              <motion.div
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="flex items-center gap-2 mb-6"
              >
                <div
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold"
                  style={{ background: "oklch(0.72 0.18 195 / 0.12)", border: "1px solid oklch(0.72 0.18 195 / 0.3)", color: "oklch(0.72 0.18 195)" }}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                  LIVE ON MAINNET
                </div>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.6 }}
                className="text-4xl sm:text-5xl lg:text-6xl font-black leading-[1.1] tracking-tight mb-6"
              >
                The first{" "}
                <span style={{ color: "oklch(0.72 0.18 195)" }}>cross-chain</span>
                {" "}P2P DEX.
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.6 }}
                className="text-base text-muted-foreground leading-relaxed mb-8 max-w-lg"
              >
                Trade BTC, ETH, and SOL directly peer-to-peer — no bridges, no wrapped tokens, no AMM pools. Atomic HTLC settlement means your funds never touch a custodian.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.6 }}
                className="flex flex-wrap gap-3 mb-10"
              >
                <a
                  href="/app"
                  className="flex items-center gap-2 px-6 py-3 rounded-2xl text-sm font-bold transition-all hover:opacity-90 hover:scale-[1.02]"
                  style={{ background: "oklch(0.72 0.18 195)", color: "oklch(0.085 0.02 260)" }}
                >
                  Launch App
                  <ArrowRight className="w-4 h-4" />
                </a>
                <a
                  href="/app#connect+swaps"
                  className="flex items-center gap-2 px-6 py-3 rounded-2xl text-sm font-bold transition-all hover:opacity-90 hover:scale-[1.02]"
                  style={{
                    background: "oklch(0.16 0.03 265)",
                    border: "1px solid oklch(0.72 0.18 195 / 0.5)",
                    color: "oklch(0.72 0.18 195)",
                  }}
                >
                  <Wallet className="w-4 h-4" />
                  Connect Wallet
                </a>
                <a
                  href="#how-it-works"
                  className="flex items-center gap-2 px-6 py-3 rounded-2xl text-sm font-bold transition-all hover:opacity-80"
                  style={{
                    background: "oklch(0.16 0.03 265)",
                    border: "1px solid oklch(0.32 0.04 255 / 0.4)",
                    color: "oklch(0.88 0.01 220)",
                  }}
                >
                  How it works
                  <ChevronRight className="w-4 h-4" />
                </a>
              </motion.div>

              {/* Chain badges */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.45, duration: 0.6 }}
                className="flex flex-wrap gap-2"
              >
                <ChainBadge name="Bitcoin" color="#F7931A" symbol="₿" />
                <ChainBadge name="Ethereum" color="#627EEA" symbol="Ξ" />
                <ChainBadge name="Solana" color="#9945FF" symbol="◎" />
              </motion.div>
            </div>

            {/* Right: animated swap card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.35, duration: 0.7 }}
              className="hidden lg:block"
            >
              <div
                className="rounded-3xl p-6 relative overflow-hidden"
                style={{
                  background: "oklch(0.12 0.025 255 / 0.7)",
                  border: "1px solid oklch(0.32 0.04 255 / 0.4)",
                  backdropFilter: "blur(20px)",
                  boxShadow: "0 0 80px oklch(0.72 0.18 195 / 0.08)",
                }}
              >
                {/* Glow accent */}
                <div
                  className="absolute top-0 right-0 w-48 h-48 rounded-full opacity-20 pointer-events-none"
                  style={{ background: "radial-gradient(circle, oklch(0.72 0.18 195 / 0.5) 0%, transparent 70%)", transform: "translate(30%, -30%)" }}
                />

                <div className="flex items-center justify-between mb-5">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Live P2P Swap</p>
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[10px] text-emerald-400 font-bold">ATOMIC</span>
                  </div>
                </div>

                {/* From */}
                <div
                  className="rounded-2xl p-4 mb-2"
                  style={{ background: "oklch(0.16 0.03 265 / 0.8)", border: "1px solid oklch(0.32 0.04 255 / 0.25)" }}
                >
                  <p className="text-[10px] text-muted-foreground mb-1">You send</p>
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-black" style={{ color: "#F7931A" }}>
                      {livePrice ? `${livePrice.btcAmount} BTC` : "0.1 BTC"}
                    </span>
                    <ChainBadge name="Bitcoin" color="#F7931A" symbol="₿" />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    ≈ ${livePrice ? livePrice.btcUsd.toLocaleString() : "—"}
                  </p>
                </div>

                {/* Arrow */}
                <div className="flex justify-center my-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ background: "oklch(0.72 0.18 195 / 0.15)", border: "1px solid oklch(0.72 0.18 195 / 0.4)" }}
                  >
                    <ArrowLeftRight className="w-4 h-4" style={{ color: "oklch(0.72 0.18 195)" }} />
                  </div>
                </div>

                {/* To */}
                <div
                  className="rounded-2xl p-4 mb-5"
                  style={{ background: "oklch(0.16 0.03 265 / 0.8)", border: "1px solid oklch(0.32 0.04 255 / 0.25)" }}
                >
                  <p className="text-[10px] text-muted-foreground mb-1">You receive</p>
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-black" style={{ color: "#9945FF" }}>
                      {livePrice ? `${livePrice.solAmount} SOL` : "— SOL"}
                    </span>
                    <ChainBadge name="Solana" color="#9945FF" symbol="◎" />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    ≈ ${livePrice ? livePrice.solUsd.toLocaleString() : "—"} · 0.15% fee
                  </p>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-3 mb-5">
                  {[
                    { label: "Slippage", value: "0.00%", color: "#10b981" },
                    { label: "Bridge", value: "None", color: "#10b981" },
                    { label: "Settlement", value: "HTLC", color: "oklch(0.72 0.18 195)" },
                  ].map(s => (
                    <div key={s.label} className="text-center">
                      <p className="text-xs font-bold" style={{ color: s.color }}>{s.value}</p>
                      <p className="text-[9px] text-muted-foreground">{s.label}</p>
                    </div>
                  ))}
                </div>

                <a
                  href="/app"
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl text-sm font-bold transition-all hover:opacity-90"
                  style={{ background: "oklch(0.72 0.18 195)", color: "oklch(0.085 0.02 260)" }}
                >
                  Start Trading <ArrowRight className="w-4 h-4" />
                </a>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Stats bar ────────────────────────────────────────────────────────── */}
      <section
        className="py-8 px-6"
        style={{ background: "oklch(0.10 0.025 260 / 0.8)", borderTop: "1px solid oklch(0.32 0.04 255 / 0.2)", borderBottom: "1px solid oklch(0.32 0.04 255 / 0.2)" }}
      >
        <div className="max-w-4xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
          {[
            { label: "Chains Supported", value: 3, suffix: "", prefix: "" },
            { label: "Slippage", value: 0, suffix: "%", prefix: "" },
            { label: "Bridges Required", value: 0, suffix: "", prefix: "" },
            { label: "Custodians", value: 0, suffix: "", prefix: "" },
          ].map(stat => (
            <div key={stat.label}>
              <p className="text-2xl font-black" style={{ color: "oklch(0.72 0.18 195)" }}>
                <AnimatedNumber value={stat.value} prefix={stat.prefix} suffix={stat.suffix} />
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-20 px-6 relative">
        <GridBackground />
        <div className="relative z-10 max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-14"
          >
            <p className="text-[10px] font-bold tracking-widest uppercase mb-3" style={{ color: "oklch(0.72 0.18 195)" }}>
              The Protocol
            </p>
            <h2 className="text-3xl sm:text-4xl font-black">How AFOS works</h2>
            <p className="text-sm text-muted-foreground mt-3 max-w-xl mx-auto">
              Three steps. No trust required. Your keys, your coins — always.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-12 items-start">
            {/* Steps */}
            <div>
              <StepCard
                step={1}
                title="Connect your wallet"
                description="Link Phantom (Solana), MetaMask (Ethereum), or use AFOS's built-in Bitcoin wallet. No account, no KYC, no email."
                color="oklch(0.72 0.18 195)"
              />
              <StepCard
                step={2}
                title="Tell the AI agent what you want"
                description="Type naturally — 'swap 0.1 BTC for SOL' or 'get me the best rate for 1 ETH to USDT'. The agent finds a peer or routes through Jupiter DEX automatically."
                color="#9945FF"
              />
              <StepCard
                step={3}
                title="Atomic settlement — no trust needed"
                description="P2P swaps use Hash Time-Lock Contracts (HTLCs): funds are locked on both chains simultaneously. Either both sides settle, or both refund. No counterparty risk."
                color="#10b981"
              />
            </div>

            {/* HTLC explainer card */}
            <motion.div
              initial={{ opacity: 0, x: 24 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2, duration: 0.6 }}
              className="rounded-3xl p-6"
              style={{
                background: "oklch(0.12 0.025 255 / 0.6)",
                border: "1px solid oklch(0.32 0.04 255 / 0.35)",
              }}
            >
              <div className="flex items-center gap-2 mb-4">
                <Lock className="w-4 h-4" style={{ color: "#10b981" }} />
                <p className="text-xs font-bold text-foreground">HTLC Atomic Swap</p>
              </div>
              <div className="space-y-3">
                {[
                  { chain: "Bitcoin", color: "#F7931A", action: "Alice locks 0.1 BTC with hash H", icon: "₿" },
                  { chain: "Solana", color: "#9945FF", action: "Bob locks 80.1 SOL with same hash H", icon: "◎" },
                  { chain: "Settlement", color: "#10b981", action: "Alice reveals secret → both chains settle atomically", icon: "✓" },
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5"
                      style={{ background: `${step.color}18`, border: `1px solid ${step.color}40`, color: step.color }}
                    >
                      {step.icon}
                    </div>
                    <div>
                      <p className="text-[10px] font-bold" style={{ color: step.color }}>{step.chain}</p>
                      <p className="text-[10px] text-muted-foreground">{step.action}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div
                className="mt-4 p-3 rounded-xl text-[10px] text-muted-foreground"
                style={{ background: "oklch(0.16 0.03 265 / 0.6)", border: "1px solid oklch(0.32 0.04 255 / 0.2)" }}
              >
                If either party disappears, the timelock expires and both sides get their funds back automatically. Zero counterparty risk.
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Features grid ────────────────────────────────────────────────────── */}
      <section id="features" className="py-20 px-6" style={{ background: "oklch(0.095 0.022 260 / 0.5)" }}>
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-14"
          >
            <p className="text-[10px] font-bold tracking-widest uppercase mb-3" style={{ color: "oklch(0.55 0.22 290)" }}>
              Why AFOS
            </p>
            <h2 className="text-3xl sm:text-4xl font-black">Built different</h2>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <FeatureCard
              icon={Globe}
              title="True cross-chain"
              description="BTC ↔ ETH ↔ SOL without wrapped tokens or bridges. Native assets settle on their native chains."
              color="oklch(0.72 0.18 195)"
              delay={0}
            />
            <FeatureCard
              icon={Zap}
              title="Zero slippage"
              description="P2P fills are exact. You agree on a price, both sides lock, both sides settle. No AMM curve, no price impact."
              color="#10b981"
              delay={0.05}
            />
            <FeatureCard
              icon={Shield}
              title="Non-custodial"
              description="Your private keys never leave your device. AFOS never holds your funds. Not your keys, not your problem — solved."
              color="#f59e0b"
              delay={0.1}
            />
            <FeatureCard
              icon={Lock}
              title="MEV-resistant"
              description="P2P swaps never touch a public mempool. No front-running, no sandwich attacks, no miner extractable value."
              color="#ef4444"
              delay={0.15}
            />
            <FeatureCard
              icon={Cpu}
              title="AI-powered agent"
              description="Describe your trade in plain English. The agent handles routing, peer discovery, price negotiation, and execution."
              color="oklch(0.55 0.22 290)"
              delay={0.2}
            />
            <FeatureCard
              icon={Network}
              title="Peer network"
              description="Connect directly with counterparties via the IntercomSwap P2P network. Build reputation, set custom rates, trade privately."
              color="#14F195"
              delay={0.25}
            />
          </div>
        </div>
      </section>

      {/* ── Comparison table ─────────────────────────────────────────────────── */}
      <section id="compare" className="py-20 px-6 relative">
        <GridBackground />
        <div className="relative z-10 max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-14"
          >
            <p className="text-[10px] font-bold tracking-widest uppercase mb-3" style={{ color: "oklch(0.72 0.18 195)" }}>
              Comparison
            </p>
            <h2 className="text-3xl sm:text-4xl font-black">AFOS vs. the rest</h2>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="rounded-3xl overflow-hidden"
            style={{ border: "1px solid oklch(0.32 0.04 255 / 0.35)" }}
          >
            {/* Header */}
            <div
              className="grid grid-cols-5 gap-0 text-center"
              style={{ background: "oklch(0.14 0.03 260)" }}
            >
              <div className="p-4 text-left">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Feature</p>
              </div>
              {[
                { name: "AFOS", color: "oklch(0.72 0.18 195)" },
                { name: "Uniswap", color: "#ff007a" },
                { name: "Jupiter", color: "#14F195" },
                { name: "1inch", color: "#1b314f" },
              ].map(col => (
                <div key={col.name} className="p-4 text-center">
                  <p className="text-xs font-bold" style={{ color: col.color }}>{col.name}</p>
                </div>
              ))}
            </div>

            {/* Rows */}
            {COMPARISON.map((row, i) => (
              <div
                key={row.feature}
                className="grid grid-cols-5 gap-0 text-center"
                style={{
                  background: i % 2 === 0 ? "oklch(0.12 0.025 255 / 0.4)" : "oklch(0.10 0.02 260 / 0.4)",
                  borderTop: "1px solid oklch(0.32 0.04 255 / 0.15)",
                }}
              >
                <div className="p-3 text-left">
                  <p className="text-[11px] text-muted-foreground">{row.feature}</p>
                </div>
                {[row.afos, row.uni, row.jup, row.inch].map((val, j) => (
                  <div key={j} className="p-3 flex items-center justify-center">
                    {val
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      : <X className="w-3.5 h-3.5 text-red-400 opacity-60" />
                    }
                  </div>
                ))}
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── CTA footer ───────────────────────────────────────────────────────── */}
      <section
        className="py-24 px-6 text-center relative overflow-hidden"
        style={{ background: "oklch(0.095 0.022 260)" }}
      >
        <div
          className="absolute inset-0 opacity-30 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 80% 50% at 50% 100%, oklch(0.72 0.18 195 / 0.25) 0%, transparent 70%)" }}
        />
        <div className="relative z-10 max-w-2xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <p className="text-[10px] font-bold tracking-widest uppercase mb-4" style={{ color: "oklch(0.72 0.18 195)" }}>
              Get started
            </p>
            <h2 className="text-4xl sm:text-5xl font-black mb-4">
              Trade without<br />
              <span style={{ color: "oklch(0.72 0.18 195)" }}>compromise.</span>
            </h2>
            <p className="text-sm text-muted-foreground mb-10 max-w-md mx-auto">
              No bridges. No slippage. No custodians. Just pure peer-to-peer cross-chain trading, secured by cryptography.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href="/app"
                className="flex items-center justify-center gap-2 px-8 py-4 rounded-2xl text-base font-bold transition-all hover:opacity-90 hover:scale-[1.02]"
                style={{ background: "oklch(0.72 0.18 195)", color: "oklch(0.085 0.02 260)" }}
              >
                Launch App
                <ArrowRight className="w-5 h-5" />
              </a>
              <a
                href="https://intercomswap.io"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 px-8 py-4 rounded-2xl text-base font-bold transition-all hover:opacity-80"
                style={{
                  background: "oklch(0.16 0.03 265)",
                  border: "1px solid oklch(0.32 0.04 255 / 0.4)",
                  color: "oklch(0.88 0.01 220)",
                }}
              >
                P2P Network
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer
        className="py-8 px-6 text-center"
        style={{ borderTop: "1px solid oklch(0.32 0.04 255 / 0.2)" }}
      >
        <div className="flex items-center justify-center gap-3 mb-3">
          <img
            src="https://d2xsxph8kpxj0f.cloudfront.net/87744282/Cv4Jvx35N7jGsqrM8y5HAD/afos-icon_17336ddd.png"
            alt="AFOS"
            className="h-7 w-7 object-contain"
            style={{ filter: "drop-shadow(0 0 6px oklch(0.72 0.18 195 / 0.4))" }}
          />
          <div className="flex flex-col items-start">
            <span
              className="text-sm font-black tracking-tight leading-none"
              style={{
                background: "linear-gradient(135deg, oklch(0.92 0.01 220) 0%, oklch(0.72 0.18 195) 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              AFOS
            </span>
            <span className="text-[9px] text-muted-foreground mt-0.5">Agentic Financial Operating System</span>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Non-custodial · Open protocol · Beta
        </p>
      </footer>
    </div>
  );
}
