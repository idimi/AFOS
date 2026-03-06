/**
 * AFOS — User Settings Page (Tabbed)
 *
 * Organised into 4 tabs:
 *   Trading   — Trade Preferences, Swap Execution, Preferred Swap Route
 *   Network   — LP Mode (Liquidity Provider), Auto-accept P2P RFQs
 *   Privacy   — Blocked Peers, Muted Peers
 *   Appearance — Theme settings, Danger Zone
 *
 * Settings are persisted to the database via trpc.settings.get / trpc.settings.save.
 * Operator/infrastructure config lives in Admin Panel → Operator Config.
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Settings2,
  ShieldCheck,
  Route,
  Sun,
  Moon,
  Monitor,
  Save,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
  Loader2,
  RotateCcw,
  UserX,
  Unlock,
  BellOff,
  Bell,
  Wifi,
  WifiOff,
  Network,
  Lock,
  Palette,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

import { useLightPeer } from "@/contexts/LightPeerContext";
import ConnectWalletModal from "@/components/ConnectWalletModal";
import { Wallet } from "lucide-react";

// ─── Slippage options ──────────────────────────────────────────────────────────
const SLIPPAGE_PRESETS = ["0.1", "0.5", "1.0", "2.0"];

// ─── Route options ─────────────────────────────────────────────────────────────
const ROUTES = [
  {
    id: "intercomswap",
    label: "AFOS P2P",
    description: "Best rates via agent-coordinated P2P atomic swaps (0.15% fee)",
    badge: "Active",
    badgeColor: "#6366f1",
  },
  {
    id: "jupiter",
    label: "Jupiter (Solana)",
    description: "Aggregated DEX liquidity on Solana (0.20% fee)",
    badge: "Active",
    badgeColor: "#6366f1",
  },
  {
    id: "zerox",
    label: "0x Protocol (Ethereum)",
    description: "0x API DEX aggregator on Ethereum (0.20% fee)",
    badge: "Active",
    badgeColor: "#6366f1",
  },
  {
    id: "oneinch",
    label: "1inch (SOL + ETH)",
    description: "1inch aggregator — fallback for Solana & Ethereum (requires API key)",
    badge: "Needs Key",
    badgeColor: "#f59e0b",
  },
  {
    id: "best",
    label: "Best Available",
    description: "Auto-selects: P2P → 0x (ETH) / Jupiter (SOL) → 1inch fallback",
    badge: "Recommended",
    badgeColor: "#10b981",
  },
];

// ─── Tab definitions ───────────────────────────────────────────────────────────
type TabId = "trading" | "network" | "privacy" | "appearance";
const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "trading",    label: "Trading",    icon: TrendingUp },
  { id: "network",    label: "Network",    icon: Network },
  { id: "privacy",    label: "Privacy",    icon: Lock },
  { id: "appearance", label: "Appearance", icon: Palette },
];

// ─── Loading skeleton ──────────────────────────────────────────────────────────
function SettingsSkeleton() {
  return (
    <div className="px-4 sm:px-6 py-5 max-w-2xl mx-auto space-y-4 animate-pulse">
      <div className="h-7 w-32 rounded-lg bg-muted mb-6" />
      {/* Tab bar skeleton */}
      <div className="flex gap-1 p-1 rounded-2xl bg-muted mb-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="flex-1 h-9 rounded-xl bg-muted/60" />
        ))}
      </div>
      {[1, 2, 3].map(i => (
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
  const { isAuthenticated } = useAuth();
  const lightPeer = useLightPeer();

  // A wallet is connected if any chain address is present
  const isWalletConnected = !!(lightPeer.solanaAddress || lightPeer.ethereumAddress || lightPeer.bitcoinAddress);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  // ── Active tab ────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabId>("trading");

  // ── Blocked peers ─────────────────────────────────────────────────────────────
  const { data: blockedPeersRaw = [], refetch: refetchBlocked } = trpc.peerBlocks.listBlocked.useQuery(
    { blockerPeerId: lightPeer.peerId! },
    { enabled: !!lightPeer.peerId }
  );
  const unblockMutation = trpc.peerBlocks.unblock.useMutation({
    onSuccess: () => {
      refetchBlocked();
      toast.success('Peer unblocked', { description: 'They can now send you direct messages again.' });
    },
    onError: () => toast.error('Failed to unblock peer'),
  });

  // ── Muted peers ──────────────────────────────────────────────────────────────
  const { data: mutedPeersRaw = [], refetch: refetchMuted } = trpc.peerMutes.listMuted.useQuery(
    { muterPeerId: lightPeer.peerId! },
    { enabled: !!lightPeer.peerId }
  );
  const unmuteMutation = trpc.peerMutes.unmute.useMutation({
    onSuccess: () => {
      refetchMuted();
      toast.success('Peer unmuted', { description: 'You will receive notifications from this peer again.' });
    },
    onError: () => toast.error('Failed to unmute peer'),
  });

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

  // ── Danger Zone mutations ────────────────────────────────────────────────────
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showClearBlocksConfirm, setShowClearBlocksConfirm] = useState(false);
  const [showClearMutesConfirm, setShowClearMutesConfirm] = useState(false);

  const clearBlocksMutation = trpc.peerBlocks.clearAll.useMutation({
    onSuccess: (res) => {
      refetchBlocked();
      setShowClearBlocksConfirm(false);
      toast.success(`Cleared ${res.deleted} blocked peer${res.deleted !== 1 ? 's' : ''}`);
    },
    onError: () => toast.error('Failed to clear blocked peers'),
  });

  const clearMutesMutation = trpc.peerMutes.clearAll.useMutation({
    onSuccess: (res) => {
      refetchMuted();
      setShowClearMutesConfirm(false);
      toast.success(`Cleared ${res.deleted} muted peer${res.deleted !== 1 ? 's' : ''}`);
    },
    onError: () => toast.error('Failed to clear muted peers'),
  });

  // ── Test route connection ──────────────────────────────────────────────────────
  const [routePingState, setRoutePingState] = useState<Record<string, { loading: boolean; ok?: boolean; latencyMs?: number; message?: string; lastTestedAt?: Date }>>({}); 
  const testRouteMutation = trpc.settings.testRouteConnection.useMutation({
    onSuccess: (result, variables) => {
      setRoutePingState(prev => ({ ...prev, [variables.routeId]: { loading: false, ...result, lastTestedAt: new Date() } }));
    },
    onError: (err, variables) => {
      setRoutePingState(prev => ({ ...prev, [variables.routeId]: { loading: false, ok: false, message: err.message, lastTestedAt: new Date() } }));
    },
  });

  const handleTestRoute = (e: React.MouseEvent, routeId: string) => {
    e.stopPropagation();
    setRoutePingState(prev => ({ ...prev, [routeId]: { loading: true } }));
    testRouteMutation.mutate({ routeId: routeId as "intercomswap" | "jupiter" | "zerox" | "oneinch" | "best" });
  };

  // Auto-run Test Connection on mount for all testable routes (not "best")
  useEffect(() => {
    const testableRoutes = ROUTES.filter(r => r.id !== "best");
    // Stagger requests by 300ms to avoid hammering all endpoints simultaneously
    testableRoutes.forEach((route, i) => {
      setTimeout(() => {
        setRoutePingState(prev => ({ ...prev, [route.id]: { loading: true } }));
        testRouteMutation.mutate({ routeId: route.id as "intercomswap" | "jupiter" | "zerox" | "oneinch" | "best" });
      }, i * 300);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Local draft state (mirrors remote, editable before save) ─────────────────
  const [maxTxAmount, setMaxTxAmount] = useState("500");
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [slippage, setSlippage] = useState("0.5");
  const [customSlippage, setCustomSlippage] = useState("");
  const [preferredRoute, setPreferredRoute] = useState<"intercomswap" | "jupiter" | "zerox" | "oneinch" | "best">("best");
  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");
  const [autoAcceptRfq, setAutoAcceptRfq] = useState(false);
  const [autoAcceptMaxUsd, setAutoAcceptMaxUsd] = useState("0");

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
    if ('autoAcceptRfq' in remoteSettings) {
      const aar = remoteSettings.autoAcceptRfq as boolean;
      setAutoAcceptRfq(aar);
      // Sync into LightPeerPrefs (localStorage) so the peer context picks it up
      try {
        const stored = localStorage.getItem("afos_light_peer_prefs");
        const parsed = stored ? JSON.parse(stored) : {};
        parsed.autoAcceptRfq = aar;
        localStorage.setItem("afos_light_peer_prefs", JSON.stringify(parsed));
      } catch { /* best-effort */ }
    }
    if ('autoAcceptMaxUsd' in remoteSettings) {
      const aam = (remoteSettings as Record<string, unknown>).autoAcceptMaxUsd ?? 0;
      setAutoAcceptMaxUsd(String(aam));
      try {
        const stored = localStorage.getItem("afos_light_peer_prefs");
        const parsed = stored ? JSON.parse(stored) : {};
        parsed.autoAcceptMaxUsd = Number(aam);
        localStorage.setItem("afos_light_peer_prefs", JSON.stringify(parsed));
      } catch { /* best-effort */ }
    }
    // Sync slippagePct into LightPeerPrefs so the slippage guard in LightPeerContext
    // uses the user's configured tolerance when auto-accepting RFQs
    if ('slippagePct' in remoteSettings) {
      try {
        const stored = localStorage.getItem("afos_light_peer_prefs");
        const parsed = stored ? JSON.parse(stored) : {};
        parsed.slippagePct = remoteSettings.slippagePct;
        localStorage.setItem("afos_light_peer_prefs", JSON.stringify(parsed));
      } catch { /* best-effort */ }
    }
  }, [remoteSettings]);

  const effectiveSlippage = customSlippage || slippage;

  const handleReset = () => {
    setMaxTxAmount("500");
    setAutoConfirm(false);
    setSlippage("0.5");
    setCustomSlippage("");
    setPreferredRoute("best");
    setTheme("dark");
    setAutoAcceptRfq(false);
    setAutoAcceptMaxUsd("0");
    // Also apply the theme to next-themes via ThemeSelector's onChange
    // ThemeSelector handles next-themes internally; we trigger it via the state change
    saveMutation.mutate({
      maxTxAmountUsd: 500,
      autoConfirm: false,
      slippagePct: "0.5",
      preferredRoute: "best",
      theme: "dark",
      autoAcceptRfq: false,
      autoAcceptMaxUsd: 0,
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
    const parsedAutoAcceptMax = parseInt(autoAcceptMaxUsd, 10);
    saveMutation.mutate({
      maxTxAmountUsd: parsedMax,
      autoConfirm,
      slippagePct: effectiveSlippage,
      preferredRoute,
      theme,
      autoAcceptRfq,
      autoAcceptMaxUsd: isNaN(parsedAutoAcceptMax) ? 0 : parsedAutoAcceptMax,
    });
  };

  // Show skeleton only while loading remote settings for authenticated users
  if (settingsLoading && isAuthenticated) return <SettingsSkeleton />;

  return (
    <div className="px-4 sm:px-6 py-5 pb-safe max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your personal trading preferences and UI options.
        </p>
      </div>

      {/* Wallet connect banner — shown when no wallet is connected */}
      {!isWalletConnected && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-5 flex items-center justify-between gap-4 p-4 rounded-2xl"
          style={{ background: "rgba(6,182,212,0.06)", border: "1px solid rgba(6,182,212,0.2)" }}
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.25)" }}>
              <Wallet className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Connect a wallet to save settings</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Your preferences will sync across devices once a wallet is connected.
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowWalletModal(true)}
            className="shrink-0 px-4 py-2 rounded-xl text-xs font-semibold transition-all"
            style={{ background: "rgba(6,182,212,0.15)", border: "1px solid rgba(6,182,212,0.35)", color: "#22d3ee" }}
          >
            Connect Wallet
          </button>
        </motion.div>
      )}

      <ConnectWalletModal open={showWalletModal} onClose={() => setShowWalletModal(false)} />

      {/* ── Tab navigation ──────────────────────────────────────────────────────── */}
      <div
        className="flex gap-1 p-1 rounded-2xl mb-5"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
      >
        {TABS.map(tab => {
          const active = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all"
              style={{
                background: active ? "rgba(6,182,212,0.12)" : "transparent",
                border: active ? "1px solid rgba(6,182,212,0.3)" : "1px solid transparent",
                color: active ? "#22d3ee" : "var(--muted-foreground)",
              }}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {/* ════════════════════════════════════════════════════════════════════════
            TRADING TAB
            Sections: Trade Preferences, Swap Execution, Preferred Swap Route
           ════════════════════════════════════════════════════════════════════════ */}
        {activeTab === "trading" && (
          <motion.div
            key="trading"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.15 }}
            className="space-y-4"
          >
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

            {/* ── Preferred Route ────────────────────────────────────────────────── */}
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
                        {/* Ping result + last tested */}
                        {routePingState[route.id] && !routePingState[route.id].loading && (
                          <div className="mt-1 space-y-0.5">
                            <p className={`text-[10px] font-medium ${routePingState[route.id].ok ? 'text-emerald-400' : 'text-red-400'}`}>
                              {routePingState[route.id].ok ? '✓' : '✗'} {routePingState[route.id].message}
                            </p>
                            {routePingState[route.id].lastTestedAt && (
                              <p className="text-[10px] text-muted-foreground">
                                Last tested: {routePingState[route.id].lastTestedAt!.toLocaleTimeString()}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                      {/* Test Connection button */}
                      <button
                        onClick={(e) => handleTestRoute(e, route.id)}
                        disabled={routePingState[route.id]?.loading}
                        className="shrink-0 p-1.5 rounded-lg transition-colors hover:bg-white/5 disabled:opacity-50"
                        title="Test connection"
                      >
                        {routePingState[route.id]?.loading ? (
                          <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
                        ) : routePingState[route.id]?.ok === true ? (
                          <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                        ) : routePingState[route.id]?.ok === false ? (
                          <WifiOff className="w-3.5 h-3.5 text-red-400" />
                        ) : (
                          <Wifi className="w-3.5 h-3.5 text-muted-foreground" />
                        )}
                      </button>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                The agent will try your preferred route first and fall back automatically if liquidity is unavailable.
              </p>
            </SectionCard>

            {/* Save button */}
            <SaveBar
              isWalletConnected={isWalletConnected}
              isPending={saveMutation.isPending}
              savedFlash={savedFlash}
              onSave={handleSave}
              onConnectWallet={() => setShowWalletModal(true)}
            />
          </motion.div>
        )}

        {/* ════════════════════════════════════════════════════════════════════════
            NETWORK TAB
            Sections: LP Mode (Liquidity Provider), Auto-accept P2P RFQs
           ════════════════════════════════════════════════════════════════════════ */}
        {activeTab === "network" && (
          <motion.div
            key="network"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.15 }}
            className="space-y-4"
          >
            {/* ── LP Mode ─────────────────────────────────────────────────────── */}
            <SectionCard
              icon={Wifi}
              title="LP Mode (Liquidity Provider)"
              color="text-cyan-400"
              border="rgba(6,182,212,0.2)"
              bg="rgba(6,182,212,0.04)"
              delay={0}
            >
              <ToggleRow
                label="Enable LP Mode"
                description="Broadcast your wallet as a liquidity provider on the AFOS P2P network. When enabled, peers can discover you, send RFQ requests, and you can respond with quotes. Disable this to browse the Order Book without being visible to other peers."
                value={lightPeer.prefs?.enabled ?? false}
                onChange={(v) => lightPeer.setPrefs({ enabled: v })}
                warning="LP Mode is ON. Your peer ID and accepted trading pairs are visible to all nodes on the network. Make sure your wallets are funded before accepting RFQs."
              />
              {lightPeer.prefs?.enabled && (
                <>
                  {/* Online status pill */}
                  <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)" }}>
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[11px] font-mono text-emerald-400">
                      {lightPeer.isOnline ? `Online · ${lightPeer.peerId?.slice(0, 16)}…` : "Connecting to P2P network…"}
                    </span>
                  </div>

                  {/* ── Accepted trading pairs ── */}
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-medium text-foreground">Accepted Trading Pairs</p>
                    <p className="text-[11px] text-muted-foreground">
                      Select which pairs you are willing to quote. Only peers requesting these pairs will send you RFQs.
                    </p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {["SOL/USDT", "SOL/USDC", "ETH/USDT", "ETH/USDC", "BTC/USDT", "BTC/ETH", "BTC/SOL"].map((pair) => {
                        const accepted = (lightPeer.prefs?.acceptedPairs ?? []).includes(pair);
                        return (
                          <button
                            key={pair}
                            onClick={() => {
                              const current = lightPeer.prefs?.acceptedPairs ?? [];
                              const next = accepted
                                ? current.filter((p) => p !== pair)
                                : [...current, pair];
                              // Must keep at least one pair
                              if (next.length === 0) return;
                              lightPeer.setPrefs({ acceptedPairs: next });
                            }}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold transition-all hover:opacity-90 active:scale-95"
                            style={{
                              background: accepted ? "rgba(6,182,212,0.15)" : "rgba(100,116,139,0.08)",
                              border: `1px solid ${accepted ? "rgba(6,182,212,0.4)" : "rgba(100,116,139,0.2)"}`,
                              color: accepted ? "#06b6d4" : "var(--muted-foreground)",
                            }}
                          >
                            {accepted ? "✓ " : ""}{pair}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-muted-foreground/60">
                      {(lightPeer.prefs?.acceptedPairs ?? []).length} of 7 pairs selected
                    </p>
                  </div>

                  {/* ── Minimum trade size ── */}
                  <div className="mt-4 space-y-2">
                    <label className="text-xs font-medium text-foreground">Minimum Trade Size (USD)</label>
                    <p className="text-[11px] text-muted-foreground">
                      RFQs below this value will be automatically ignored. Prevents dust and spam requests.
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground font-mono">$</span>
                      <input
                        type="number"
                        min={1}
                        max={1_000_000}
                        value={lightPeer.prefs?.minTradeUsd ?? 10}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (!isNaN(val) && val >= 1) {
                            lightPeer.setPrefs({ minTradeUsd: val });
                          }
                        }}
                        className="flex-1 rounded-xl px-3 py-2 text-sm font-mono bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                        placeholder="10"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground/60">
                      Current: ${lightPeer.prefs?.minTradeUsd ?? 10} minimum · Max: ${lightPeer.prefs?.maxTradeUsd ?? 10000}
                    </p>
                  </div>
                </>
              )}
            </SectionCard>

            {/* ── Auto-accept P2P RFQs ──────────────────────────────────────────── */}
            <SectionCard
              icon={Wifi}
              title="Auto-accept P2P RFQs"
              color="text-cyan-400"
              border="rgba(6,182,212,0.2)"
              bg="rgba(6,182,212,0.04)"
              delay={0.09}
            >
              <ToggleRow
                label="Auto-accept incoming RFQs"
                description="Agent automatically accepts P2P quote requests from peers within your configured limits, without requiring manual confirmation."
                value={autoAcceptRfq}
                onChange={setAutoAcceptRfq}
                warning="Auto-accept is ON. The agent will automatically respond to incoming P2P RFQs and commit to trades within your limits."
              />
              {autoAcceptRfq && (
                <div className="space-y-2 pt-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Max auto-accept amount (USD)
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground font-mono">$</span>
                    <input
                      type="number"
                      min={0}
                      max={1_000_000}
                      value={autoAcceptMaxUsd}
                      onChange={e => setAutoAcceptMaxUsd(e.target.value)}
                      className="flex-1 rounded-xl px-3 py-2 text-sm font-mono bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                      placeholder="0 = use max tx amount"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Set to 0 to use your Max Transaction Amount (${maxTxAmount}) as the cap.
                    The agent will reject any incoming RFQ whose USD value exceeds this limit.
                  </p>
                </div>
              )}
            </SectionCard>

            {/* Save button (for auto-accept settings that persist to DB) */}
            <SaveBar
              isWalletConnected={isWalletConnected}
              isPending={saveMutation.isPending}
              savedFlash={savedFlash}
              onSave={handleSave}
              onConnectWallet={() => setShowWalletModal(true)}
            />
          </motion.div>
        )}

        {/* ════════════════════════════════════════════════════════════════════════
            PRIVACY TAB
            Sections: Blocked Peers, Muted Peers
           ════════════════════════════════════════════════════════════════════════ */}
        {activeTab === "privacy" && (
          <motion.div
            key="privacy"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.15 }}
            className="space-y-4"
          >
            {/* ── Blocked Peers ─────────────────────────────────────────────────── */}
            <SectionCard
              icon={UserX}
              title="Privacy — Blocked Peers"
              color="text-red-400"
              border="rgba(239,68,68,0.2)"
              bg="rgba(239,68,68,0.04)"
              delay={0}
            >
              {blockedPeersRaw.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">
                  You have not blocked any peers. Block a peer from their profile in the Network page.
                </p>
              ) : (
                <div className="space-y-2">
                  {blockedPeersRaw.map(b => (
                    <div
                      key={b.blockedPeerId}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl"
                      style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(239,68,68,0.12)' }}>
                          <UserX className="w-3 h-3 text-red-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] font-mono text-foreground truncate">{b.blockedPeerId}</p>
                          <p className="text-[9px] text-muted-foreground mt-0.5">
                            Blocked {new Date(b.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => unblockMutation.mutate({ blockerPeerId: lightPeer.peerId!, blockedPeerId: b.blockedPeerId })}
                        disabled={unblockMutation.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-all shrink-0 disabled:opacity-60"
                        style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}
                        title="Unblock this peer"
                      >
                        <Unlock className="w-3 h-3" />
                        Unblock
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            {/* ── Muted Peers ───────────────────────────────────────────────────── */}
            <SectionCard
              icon={BellOff}
              title="Privacy — Muted Peers"
              color="text-slate-400"
              border="rgba(100,116,139,0.2)"
              bg="rgba(100,116,139,0.04)"
              delay={0.07}
            >
              <p className="text-[11px] text-muted-foreground">
                Muted peers can still send you messages, but you won't receive notifications or badge indicators.
              </p>
              {mutedPeersRaw.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">
                  You have not muted any peers. Mute a peer from their profile in the Network page.
                </p>
              ) : (
                <div className="space-y-2">
                  {mutedPeersRaw.map(m => (
                    <div
                      key={m.mutedPeerId}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl"
                      style={{ background: 'rgba(100,116,139,0.06)', border: '1px solid rgba(100,116,139,0.15)' }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(100,116,139,0.12)' }}>
                          <BellOff className="w-3 h-3 text-slate-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] font-mono text-foreground truncate">{m.mutedPeerId}</p>
                          <p className="text-[9px] text-muted-foreground mt-0.5">
                            Muted {new Date(m.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => unmuteMutation.mutate({ muterPeerId: lightPeer.peerId!, mutedPeerId: m.mutedPeerId })}
                        disabled={unmuteMutation.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-all shrink-0 disabled:opacity-60"
                        style={{ background: 'rgba(100,116,139,0.12)', border: '1px solid rgba(100,116,139,0.3)', color: '#94a3b8' }}
                        title="Unmute this peer"
                      >
                        <Bell className="w-3 h-3" />
                        Unmute
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </motion.div>
        )}

        {/* ════════════════════════════════════════════════════════════════════════
            APPEARANCE TAB
            Sections: Theme, Danger Zone
           ════════════════════════════════════════════════════════════════════════ */}
        {activeTab === "appearance" && (
          <motion.div
            key="appearance"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.15 }}
            className="space-y-4"
          >
            {/* ── Appearance ────────────────────────────────────────────────────── */}
            <SectionCard
              icon={Sun}
              title="Appearance"
              color="text-amber-400"
              border="rgba(245,158,11,0.2)"
              bg="rgba(245,158,11,0.04)"
              delay={0}
            >
              <div>
                <label className="block text-xs font-medium text-foreground/70 mb-2">
                  Theme
                </label>
                <ThemeSelector value={theme} onChange={setTheme} />
              </div>
            </SectionCard>

            {/* ── Danger Zone ─────────────────────────────────────────────────────── */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.07 }}
              className="rounded-2xl p-5 space-y-4"
              style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-red-400">Danger Zone</p>
                  <p className="text-xs text-muted-foreground">Irreversible actions — proceed with caution</p>
                </div>
              </div>

              <div className="space-y-3">
                {/* Reset all settings */}
                <div className="flex items-center justify-between gap-4 py-3 px-4 rounded-xl" style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.12)' }}>
                  <div>
                    <p className="text-sm font-medium text-foreground">Reset all settings</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Restore all trading preferences to factory defaults</p>
                  </div>
                  {!showResetConfirm ? (
                    <button
                      onClick={() => setShowResetConfirm(true)}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Reset
                    </button>
                  ) : (
                    <div className="shrink-0 flex items-center gap-2">
                      <span className="text-xs text-red-400 font-medium">Confirm?</span>
                      <button
                        onClick={() => { handleReset(); setShowResetConfirm(false); }}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                        style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171' }}
                      >
                        Yes, reset
                      </button>
                      <button
                        onClick={() => setShowResetConfirm(false)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                        style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--muted-foreground)' }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {/* Clear blocked peers */}
                <div className="flex items-center justify-between gap-4 py-3 px-4 rounded-xl" style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.12)' }}>
                  <div>
                    <p className="text-sm font-medium text-foreground">Clear all blocked peers</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Unblock all {blockedPeersRaw.length > 0 ? `${blockedPeersRaw.length} ` : ''}blocked peer{blockedPeersRaw.length !== 1 ? 's' : ''} — they can message you again
                    </p>
                  </div>
                  {!showClearBlocksConfirm ? (
                    <button
                      onClick={() => setShowClearBlocksConfirm(true)}
                      disabled={blockedPeersRaw.length === 0 || !lightPeer.peerId}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}
                    >
                      <UserX className="w-3.5 h-3.5" />
                      Clear all
                    </button>
                  ) : (
                    <div className="shrink-0 flex items-center gap-2">
                      <span className="text-xs text-red-400 font-medium">Confirm?</span>
                      <button
                        onClick={() => clearBlocksMutation.mutate({ blockerPeerId: lightPeer.peerId! })}
                        disabled={clearBlocksMutation.isPending}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-60"
                        style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171' }}
                      >
                        {clearBlocksMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Yes, clear'}
                      </button>
                      <button
                        onClick={() => setShowClearBlocksConfirm(false)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                        style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--muted-foreground)' }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {/* Clear muted peers */}
                <div className="flex items-center justify-between gap-4 py-3 px-4 rounded-xl" style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.12)' }}>
                  <div>
                    <p className="text-sm font-medium text-foreground">Clear all muted peers</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Unmute all {mutedPeersRaw.length > 0 ? `${mutedPeersRaw.length} ` : ''}muted peer{mutedPeersRaw.length !== 1 ? 's' : ''} — you will receive their notifications again
                    </p>
                  </div>
                  {!showClearMutesConfirm ? (
                    <button
                      onClick={() => setShowClearMutesConfirm(true)}
                      disabled={mutedPeersRaw.length === 0 || !lightPeer.peerId}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}
                    >
                      <BellOff className="w-3.5 h-3.5" />
                      Clear all
                    </button>
                  ) : (
                    <div className="shrink-0 flex items-center gap-2">
                      <span className="text-xs text-red-400 font-medium">Confirm?</span>
                      <button
                        onClick={() => clearMutesMutation.mutate({ muterPeerId: lightPeer.peerId! })}
                        disabled={clearMutesMutation.isPending}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-60"
                        style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171' }}
                      >
                        {clearMutesMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Yes, clear'}
                      </button>
                      <button
                        onClick={() => setShowClearMutesConfirm(false)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                        style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--muted-foreground)' }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>

            {/* Save button (theme persists to DB) */}
            <SaveBar
              isWalletConnected={isWalletConnected}
              isPending={saveMutation.isPending}
              savedFlash={savedFlash}
              onSave={handleSave}
              onConnectWallet={() => setShowWalletModal(true)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Reusable save bar ────────────────────────────────────────────────────────
function SaveBar({
  isWalletConnected,
  isPending,
  savedFlash,
  onSave,
  onConnectWallet,
}: {
  isWalletConnected: boolean;
  isPending: boolean;
  savedFlash: boolean;
  onSave: () => void;
  onConnectWallet: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-3 pt-1">
      <button
        onClick={!isWalletConnected ? onConnectWallet : onSave}
        disabled={isPending}
        className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-60"
        style={savedFlash
          ? { background: 'var(--success-bg)', border: '1px solid var(--success-border)', color: 'var(--success-foreground)' }
          : { background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.3)', color: '#22d3ee' }
        }
      >
        {isPending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : savedFlash ? (
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="2 8 6 12 14 4" /></svg>
        ) : !isWalletConnected ? (
          <Wallet className="w-4 h-4" />
        ) : (
          <Save className="w-4 h-4" />
        )}
        {isPending ? "Saving…" : savedFlash ? "Saved ✓" : !isWalletConnected ? "Connect Wallet to Save" : "Save Settings"}
      </button>
    </div>
  );
}
