/**
 * AFOS — User Settings Page
 *
 * Contains only settings that are meaningful to a regular user:
 *   - Trade preferences (max amount, auto-confirm, slippage)
 *   - Preferred swap route
 *   - UI theme
 *
 * Settings are persisted to the database via trpc.settings.get / trpc.settings.save.
 * Operator/infrastructure config lives in Admin Panel → Operator Config.
 */

import { useState, useEffect } from "react";
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
  Loader2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";

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
  {
    id: "best",
    label: "Best Available",
    description: "Automatically picks the route with the best rate and lowest fee",
    badge: null,
    badgeColor: null,
  },
];

// ─── Loading skeleton ──────────────────────────────────────────────────────────
function SettingsSkeleton() {
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4 animate-pulse">
      <div className="h-7 w-32 rounded-lg bg-muted mb-6" />
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="rounded-2xl p-5 space-y-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-muted" />
            <div className="h-4 w-40 rounded bg-muted" />
          </div>
          <div className="h-10 rounded-xl bg-muted" />
          <div className="h-10 rounded-xl bg-muted w-3/4" />
        </div>
      ))}
    </div>
  );
}

// ─── Theme selector ─────────────────────────────────────────────────────────────
function ThemeSelector({
  value,
  onChange,
}: {
  value: "dark" | "light" | "system";
  onChange: (v: "dark" | "light" | "system") => void;
}) {
  const { setTheme } = useTheme();
  const options: { id: "dark" | "light" | "system"; label: string; icon: React.ElementType }[] = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
    { id: "system", label: "System", icon: Monitor },
  ];
  return (
    <div className="flex gap-2">
      {options.map(({ id, label, icon: Icon }) => {
        const active = value === id;
        return (
          <button
            key={id}
            onClick={() => { onChange(id); setTheme(id); }}
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
        <div className="flex items-start gap-2 p-3 rounded-lg"
          style={{ background: "var(--warning-bg)", border: "1.5px solid var(--warning-border)" }}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "var(--warning-icon)" }} />
          <p className="text-[11px] font-semibold" style={{ color: "var(--warning-foreground)" }}>{warning}</p>
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
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [savedFlash, setSavedFlash] = useState(false);

  // ── Remote state ──────────────────────────────────────────────────────────────
  const { data: remoteSettings, isLoading: settingsLoading } = trpc.settings.get.useQuery(
    undefined,
    { enabled: isAuthenticated },
  );

  const utils = trpc.useUtils();
  const saveMutation = trpc.settings.save.useMutation({
    // Optimistic update: apply locally before the server responds
    onMutate: async (patch) => {
      await utils.settings.get.cancel();
      const prev = utils.settings.get.getData();
      utils.settings.get.setData(undefined, old =>
        old ? { ...old, ...patch } : old,
      );
      return { prev };
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.prev) utils.settings.get.setData(undefined, ctx.prev);
      toast.error("Failed to save settings");
    },
    onSuccess: () => {
      toast.success("Settings saved", {
        description: "Your trading preferences have been updated.",
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    },
    onSettled: () => {
      utils.settings.get.invalidate();
    },
  });

  // ── Local draft state (mirrors remote, editable before save) ─────────────────
  const [maxTxAmount, setMaxTxAmount] = useState("500");
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [slippage, setSlippage] = useState("0.5");
  const [customSlippage, setCustomSlippage] = useState("");
  const [preferredRoute, setPreferredRoute] = useState<"intercomswap" | "jupiter" | "oneinch" | "best">("best");
  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");

  // Populate local draft when remote data arrives
  useEffect(() => {
    if (!remoteSettings) return;
    setMaxTxAmount(String(remoteSettings.maxTxAmountUsd));
    setAutoConfirm(remoteSettings.autoConfirm as boolean);
    const isPreset = SLIPPAGE_PRESETS.includes(remoteSettings.slippagePct);
    if (isPreset) {
      setSlippage(remoteSettings.slippagePct);
      setCustomSlippage("");
    } else {
      setSlippage("0.5");
      setCustomSlippage(remoteSettings.slippagePct);
    }
    setPreferredRoute(remoteSettings.preferredRoute as typeof preferredRoute);
    setTheme(remoteSettings.theme as typeof theme);
  }, [remoteSettings]);

  const effectiveSlippage = customSlippage || slippage;

  const handleReset = () => {
    setMaxTxAmount("500");
    setAutoConfirm(false);
    setSlippage("0.5");
    setCustomSlippage("");
    setPreferredRoute("best");
    setTheme("dark");
    // Also apply the theme to next-themes via ThemeSelector's onChange
    // ThemeSelector handles next-themes internally; we trigger it via the state change
    saveMutation.mutate({
      maxTxAmountUsd: 500,
      autoConfirm: false,
      slippagePct: "0.5",
      preferredRoute: "best",
      theme: "dark",
    });
    toast.success("Settings reset to defaults");
  };

  const handleSave = () => {
    const parsedMax = parseInt(maxTxAmount, 10);
    if (isNaN(parsedMax) || parsedMax < 1) {
      toast.error("Max transaction amount must be a positive number");
      return;
    }
    const parsedSlippage = parseFloat(effectiveSlippage);
    if (isNaN(parsedSlippage) || parsedSlippage <= 0) {
      toast.error("Slippage must be a positive number");
      return;
    }
    saveMutation.mutate({
      maxTxAmountUsd: parsedMax,
      autoConfirm,
      slippagePct: effectiveSlippage,
      preferredRoute,
      theme,
    });
  };

  // ── Auth gate ─────────────────────────────────────────────────────────────────
  if (authLoading) return <SettingsSkeleton />;
  if (!isAuthenticated) {
    return (
      <div className="p-6 max-w-2xl mx-auto flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <p className="text-sm text-muted-foreground text-center">
          Connect your account to save and sync your settings across devices.
        </p>
        <a
          href={getLoginUrl()}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
          style={{ background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.3)", color: "#22d3ee" }}
        >
          Connect Account
        </a>
      </div>
    );
  }

  if (settingsLoading) return <SettingsSkeleton />;

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
                <p className="text-[11px] font-semibold" style={{ color: "var(--warning-foreground)" }}>High slippage — you may receive a worse rate.</p>
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
                  onClick={() => setPreferredRoute(route.id as typeof preferredRoute)}
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
            <ThemeSelector value={theme} onChange={setTheme} />
          </div>
        </SectionCard>



      </div>

      {/* Save / Reset buttons */}
      <div className="mt-6 flex items-center justify-between gap-3">
        <button
          onClick={handleReset}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all disabled:opacity-60 text-muted-foreground hover:text-foreground"
          style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset to defaults
        </button>
        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-60"
          style={savedFlash
            ? { background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.45)", color: "#34d399" }
            : { background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.3)", color: "#22d3ee" }
          }
        >
          {saveMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : savedFlash ? (
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="2 8 6 12 14 4" /></svg>
          ) : (
            <Save className="w-4 h-4" />
          )}
          {saveMutation.isPending ? "Saving…" : savedFlash ? "Saved ✓" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
