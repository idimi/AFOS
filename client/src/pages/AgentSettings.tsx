/**
 * AFOS — User Settings Page
 *
 * Contains only settings that are meaningful to a regular user:
 *   - Trade preferences (max amount, auto-confirm, slippage)
 *   - Preferred swap route
 *   - UI theme
 *
 * Operator/infrastructure config (LLM model, IntercomSwap node, Bitcoin node,
 * Solana RPC, Worker/Autopost, MoonPay) lives in Admin Panel → Operator Config.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Settings2,
  ShieldCheck,
  Route,
  Sun,
  Moon,
  Monitor,
  Save,
  ChevronRight,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "next-themes";

// ─── Slippage options ──────────────────────────────────────────────────────────
const SLIPPAGE_PRESETS = ["0.1", "0.5", "1.0", "2.0"];

// ─── Route options ─────────────────────────────────────────────────────────────
const ROUTES = [
  {
    id: "intercomswap",
    label: "IntercomSwap P2P",
    description: "Best rates via peer-to-peer atomic swaps (0.15% fee)",
    badge: "Recommended",
    badgeColor: "#10b981",
  },
  {
    id: "jupiter",
    label: "Jupiter (Solana)",
    description: "Aggregated DEX liquidity on Solana (0.20% fee)",
    badge: null,
    badgeColor: null,
  },
  {
    id: "oneinch",
    label: "1inch (Ethereum)",
    description: "Aggregated DEX liquidity on Ethereum (0.20% fee)",
    badge: null,
    badgeColor: null,
  },
];

// ─── Theme selector ─────────────────────────────────────────────────────────────
function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const options = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
    { id: "system", label: "System", icon: Monitor },
  ];
  return (
    <div className="flex gap-2">
      {options.map(({ id, label, icon: Icon }) => {
        const active = theme === id;
        return (
          <button
            key={id}
            onClick={() => setTheme(id)}
            className="flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-all text-xs font-medium"
            style={{
              background: active ? "rgba(99,102,241,0.12)" : "var(--muted)",
              border: active ? "1px solid rgba(99,102,241,0.4)" : "1px solid var(--border)",
              color: active ? "#818cf8" : "var(--muted-foreground)",
            }}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Toggle row ─────────────────────────────────────────────────────────────────
function ToggleRow({
  label,
  description,
  value,
  onChange,
  warning,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  warning?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
        <button
          onClick={() => onChange(!value)}
          className="flex items-center gap-1.5 text-xs font-mono transition-colors shrink-0"
          style={{ color: value ? "#10b981" : "var(--muted-foreground)" }}
        >
          {value ? (
            <ToggleRight className="w-6 h-6 text-emerald-400" />
          ) : (
            <ToggleLeft className="w-6 h-6" />
          )}
          <span className="w-7 text-left">{value ? "ON" : "OFF"}</span>
        </button>
      </div>
      {warning && value && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg"
          style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-300/80">{warning}</p>
        </div>
      )}
    </div>
  );
}

// ─── Section card ────────────────────────────────────────────────────────────────
function SectionCard({
  icon: Icon,
  title,
  color,
  border,
  bg,
  children,
  delay = 0,
}: {
  icon: React.ElementType;
  title: string;
  color: string;
  border: string;
  bg: string;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="rounded-2xl p-5 space-y-4"
      style={{ background: bg, border: `1px solid ${border}` }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: bg, border: `1px solid ${border}` }}
        >
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
      </div>
      {children}
    </motion.div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────────
export default function AgentSettings() {
  const [maxTxAmount, setMaxTxAmount] = useState("500");
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [slippage, setSlippage] = useState("0.5");
  const [customSlippage, setCustomSlippage] = useState("");
  const [preferredRoute, setPreferredRoute] = useState("intercomswap");

  const handleSave = () => {
    toast.success("Settings saved", {
      description: "Your trading preferences have been updated.",
    });
  };

  const effectiveSlippage = customSlippage || slippage;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your personal trading preferences and UI options.
        </p>
      </div>

      <div className="space-y-4">

        {/* ── Trade Preferences ─────────────────────────────────────────────── */}
        <SectionCard
          icon={Settings2}
          title="Trade Preferences"
          color="text-cyan-400"
          border="rgba(6,182,212,0.2)"
          bg="rgba(6,182,212,0.04)"
          delay={0}
        >
          {/* Max transaction amount */}
          <div>
            <label className="block text-xs font-medium text-foreground/70 mb-1.5">
              Max Transaction Amount (USD)
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-mono">$</span>
              <input
                type="number"
                value={maxTxAmount}
                onChange={e => setMaxTxAmount(e.target.value)}
                placeholder="500"
                className="w-full bg-muted border border-border rounded-xl pl-8 pr-4 py-2.5 text-sm text-foreground font-mono focus:outline-none focus:border-cyan-500/40 transition-colors"
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              The agent will not execute any single swap above this amount.
            </p>
          </div>

          {/* Slippage tolerance */}
          <div>
            <label className="block text-xs font-medium text-foreground/70 mb-1.5">
              Slippage Tolerance
            </label>
            <div className="flex gap-2 mb-2">
              {SLIPPAGE_PRESETS.map(p => (
                <button
                  key={p}
                  onClick={() => { setSlippage(p); setCustomSlippage(""); }}
                  className="flex-1 py-2 rounded-xl text-xs font-mono border transition-all"
                  style={{
                    background: slippage === p && !customSlippage ? "rgba(6,182,212,0.12)" : "var(--muted)",
                    border: slippage === p && !customSlippage ? "1px solid rgba(6,182,212,0.4)" : "1px solid var(--border)",
                    color: slippage === p && !customSlippage ? "#22d3ee" : "var(--muted-foreground)",
                  }}
                >
                  {p}%
                </button>
              ))}
            </div>
            <div className="relative">
              <input
                type="number"
                value={customSlippage}
                onChange={e => setCustomSlippage(e.target.value)}
                placeholder="Custom %"
                className="w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground font-mono focus:outline-none focus:border-cyan-500/40 transition-colors"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
            </div>
            {parseFloat(effectiveSlippage) > 1 && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <AlertTriangle className="w-3 h-3 text-amber-400" />
                <p className="text-[11px] text-amber-300/80">High slippage — you may receive a worse rate.</p>
              </div>
            )}
          </div>
        </SectionCard>

        {/* ── Swap Execution ────────────────────────────────────────────────── */}
        <SectionCard
          icon={ShieldCheck}
          title="Swap Execution"
          color="text-emerald-400"
          border="rgba(16,185,129,0.2)"
          bg="rgba(16,185,129,0.04)"
          delay={0.07}
        >
          <ToggleRow
            label="Auto-confirm swaps"
            description="Agent executes swaps without asking for your confirmation each time."
            value={autoConfirm}
            onChange={setAutoConfirm}
            warning="Auto-confirm is ON. The agent will execute swaps up to your max transaction limit without prompting you."
          />
        </SectionCard>

        {/* ── Preferred Route ───────────────────────────────────────────────── */}
        <SectionCard
          icon={Route}
          title="Preferred Swap Route"
          color="text-violet-400"
          border="rgba(139,92,246,0.2)"
          bg="rgba(139,92,246,0.04)"
          delay={0.14}
        >
          <div className="space-y-2">
            {ROUTES.map(route => {
              const active = preferredRoute === route.id;
              return (
                <button
                  key={route.id}
                  onClick={() => setPreferredRoute(route.id)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all"
                  style={{
                    background: active ? "rgba(139,92,246,0.1)" : "var(--muted)",
                    border: active ? "1px solid rgba(139,92,246,0.35)" : "1px solid var(--border)",
                  }}
                >
                  <div
                    className="w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center"
                    style={{ borderColor: active ? "#a78bfa" : "var(--muted-foreground)" }}
                  >
                    {active && <div className="w-2 h-2 rounded-full bg-violet-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{route.label}</span>
                      {route.badge && (
                        <span
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                          style={{ background: `${route.badgeColor}18`, color: route.badgeColor!, border: `1px solid ${route.badgeColor}30` }}
                        >
                          {route.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{route.description}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            The agent will try your preferred route first and fall back automatically if liquidity is unavailable.
          </p>
        </SectionCard>

        {/* ── Appearance ────────────────────────────────────────────────────── */}
        <SectionCard
          icon={Sun}
          title="Appearance"
          color="text-amber-400"
          border="rgba(245,158,11,0.2)"
          bg="rgba(245,158,11,0.04)"
          delay={0.21}
        >
          <div>
            <label className="block text-xs font-medium text-foreground/70 mb-2">
              Theme
            </label>
            <ThemeSelector />
          </div>
        </SectionCard>

        {/* ── Admin link ────────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28 }}
          className="rounded-2xl p-4 flex items-center justify-between"
          style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
        >
          <div>
            <p className="text-sm font-medium text-foreground">Operator Configuration</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              LLM model, IntercomSwap node, Bitcoin/Solana RPC, Worker settings — admin only.
            </p>
          </div>
          <a
            href="/admin"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all shrink-0"
            style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.25)", color: "#818cf8" }}
          >
            Admin Panel
            <ChevronRight className="w-3.5 h-3.5" />
          </a>
        </motion.div>

      </div>

      {/* Save button */}
      <div className="mt-6 flex justify-end">
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all"
          style={{ background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.3)", color: "#22d3ee" }}
        >
          <Save className="w-4 h-4" />
          Save Settings
        </button>
      </div>
    </div>
  );
}
