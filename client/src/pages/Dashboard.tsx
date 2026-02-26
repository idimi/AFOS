/**
 * AFOS Dashboard — Agentic Financial Operating System
 * Design: Glassmorphism + Agentic Sci-Fi
 * Colors: Deep navy-black base, cyan-teal primary, violet secondary, gold for financial values
 * Typography: Outfit Bold for headings/values, JetBrains Mono for addresses/hashes
 * Layout: Left sidebar (agent status + nav) | Main content (pipeline + stats) | Right feed (activity log)
 * Features: Voice Command Simulator, Swap Rate Chart (Recharts), Agent Settings Panel (slide-out drawer)
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone, ArrowLeftRight, Send, ChevronRight,
  Zap, Globe, TrendingUp, Clock, CheckCircle2, AlertCircle,
  Loader2, PhoneCall, Bot, CreditCard, Network, BarChart3, Settings,
  Bell, LogOut, Menu, X, ExternalLink, Copy, RefreshCw,
  Mic, MicOff, CornerDownLeft, Wallet, Shield, Activity,
  Save, ChevronDown, ChevronUp, ToggleLeft, ToggleRight
} from "lucide-react";
import { toast } from "sonner";
import Swaps from "./Swaps";
// Pure SVG chart — no recharts dependency needed for sparkline

// ─── Types ───────────────────────────────────────────────────────────────────

type StepStatus = "idle" | "active" | "complete" | "error";

interface PipelineStep {
  id: number;
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  color: string;
  glowColor: string;
  status: StepStatus;
  detail?: string;
}

interface ActivityItem {
  id: string;
  time: string;
  type: "call" | "buy" | "swap" | "send" | "confirm";
  message: string;
  amount?: string;
  status: "success" | "pending" | "error";
}

interface BalanceItem {
  symbol: string;
  name: string;
  amount: string;
  usd: string;
  change: string;
  positive: boolean;
  color: string;
}

interface AgentSettings {
  llmModel: string;
  clawfingerPhone: string;
  moonpayWallet: string;
  intercomPeers: string;
  autoConfirm: boolean;
  maxTxAmount: string;
  dcaEnabled: boolean;
  dcaAmount: string;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const INITIAL_STEPS: PipelineStep[] = [
  {
    id: 1, label: "Voice Call", sublabel: "Clawfinger",
    icon: <Phone size={18} />, color: "text-cyan-400", glowColor: "#06b6d4",
    status: "idle", detail: "+1 (555) 0192 · Agent answered"
  },
  {
    id: 2, label: "Buy Crypto", sublabel: "MoonPay Agents",
    icon: <CreditCard size={18} />, color: "text-violet-400", glowColor: "#7c3aed",
    status: "idle", detail: "$100 USDT via bank transfer"
  },
  {
    id: 3, label: "Atomic Swap", sublabel: "IntercomSwap",
    icon: <ArrowLeftRight size={18} />, color: "text-amber-400", glowColor: "#f59e0b",
    status: "idle", detail: "USDT → BTC · Lightning Network"
  },
  {
    id: 4, label: "Send Payment", sublabel: "Non-custodial wallet",
    icon: <Send size={18} />, color: "text-emerald-400", glowColor: "#10b981",
    status: "idle", detail: "0.00231 BTC → bc1q...4f2a"
  },
  {
    id: 5, label: "Confirmed", sublabel: "OpenClaw notifies",
    icon: <CheckCircle2 size={18} />, color: "text-cyan-300", glowColor: "#67e8f9",
    status: "idle", detail: "WhatsApp: Payment confirmed ✓"
  },
];

const ACTIVITY_LOG: ActivityItem[] = [
  { id: "a1", time: "2s ago", type: "confirm", message: "Payment confirmed to Ben", amount: "0.00231 BTC", status: "success" },
  { id: "a2", time: "18s ago", type: "send", message: "Outbound transfer executed", amount: "0.00231 BTC", status: "success" },
  { id: "a3", time: "34s ago", type: "swap", message: "Atomic swap settled", amount: "$100 USDT → BTC", status: "success" },
  { id: "a4", time: "52s ago", type: "buy", message: "MoonPay on-ramp complete", amount: "$100.00 USDT", status: "success" },
  { id: "a5", time: "1m ago", type: "call", message: "Voice instruction received", amount: undefined, status: "success" },
  { id: "a6", time: "8m ago", type: "swap", message: "Swap quote negotiated P2P", amount: "Rate: 0.0000231", status: "success" },
  { id: "a7", time: "22m ago", type: "buy", message: "Recurring DCA executed", amount: "$50.00 BTC", status: "success" },
  { id: "a8", time: "1h ago", type: "send", message: "Invoice paid automatically", amount: "0.00089 BTC", status: "success" },
  { id: "a9", time: "3h ago", type: "call", message: "Inbound call: portfolio check", amount: undefined, status: "success" },
  { id: "a10", time: "5h ago", type: "swap", message: "Swap failed — retrying", amount: "ETH → USDC", status: "error" },
];

const BALANCES: BalanceItem[] = [
  { symbol: "BTC", name: "Bitcoin", amount: "0.04821", usd: "$4,821.00", change: "+2.4%", positive: true, color: "#f59e0b" },
  { symbol: "USDT", name: "Tether", amount: "1,240.00", usd: "$1,240.00", change: "+0.01%", positive: true, color: "#10b981" },
  { symbol: "SOL", name: "Solana", amount: "12.50", usd: "$1,875.00", change: "-1.2%", positive: false, color: "#7c3aed" },
  { symbol: "ETH", name: "Ethereum", amount: "0.812", usd: "$2,436.00", change: "+3.1%", positive: true, color: "#06b6d4" },
];

// Generate realistic BTC/USDT rate history
function generateRateHistory() {
  const base = 43250;
  const points = [];
  for (let i = 23; i >= 0; i--) {
    const noise = (Math.random() - 0.48) * 400;
    const trend = (23 - i) * 12;
    points.push({
      time: `${String(i).padStart(2, "0")}:00`,
      rate: Math.round((base + trend + noise) * 100) / 100,
    });
  }
  return points;
}

const RATE_HISTORY = generateRateHistory();

// Parse voice command into pipeline steps
function parseCommand(cmd: string): { steps: PipelineStep[]; summary: string } {
  const lower = cmd.toLowerCase();

  // Extract amount
  const amountMatch = lower.match(/\$?(\d+(?:\.\d+)?)/);
  const amount = amountMatch ? amountMatch[1] : "100";

  // Extract recipient
  const toMatch = lower.match(/(?:to|send to|pay)\s+([a-z]+)/i);
  const recipient = toMatch ? toMatch[1] : "recipient";

  // Detect token
  const isBTC = lower.includes("btc") || lower.includes("bitcoin");
  const isETH = lower.includes("eth") || lower.includes("ethereum");
  const isSol = lower.includes("sol") || lower.includes("solana");
  const toToken = isBTC ? "BTC" : isETH ? "ETH" : isSol ? "SOL" : "BTC";
  const toTokenColor = isBTC ? "#f59e0b" : isETH ? "#06b6d4" : isSol ? "#7c3aed" : "#f59e0b";

  const btcAmount = (parseFloat(amount) / 43250).toFixed(5);

  const steps: PipelineStep[] = [
    {
      id: 1, label: "Voice Call", sublabel: "Clawfinger",
      icon: <Phone size={18} />, color: "text-cyan-400", glowColor: "#06b6d4",
      status: "idle", detail: `"${cmd.slice(0, 40)}${cmd.length > 40 ? "…" : ""}" · Parsed`
    },
    {
      id: 2, label: "Buy Crypto", sublabel: "MoonPay Agents",
      icon: <CreditCard size={18} />, color: "text-violet-400", glowColor: "#7c3aed",
      status: "idle", detail: `$${amount} USDT via linked card`
    },
    {
      id: 3, label: "Atomic Swap", sublabel: "IntercomSwap",
      icon: <ArrowLeftRight size={18} />, color: "text-amber-400", glowColor: "#f59e0b",
      status: "idle", detail: `USDT → ${toToken} · Lightning Network`
    },
    {
      id: 4, label: "Send Payment", sublabel: "Non-custodial wallet",
      icon: <Send size={18} />, color: "text-emerald-400", glowColor: "#10b981",
      status: "idle", detail: `${btcAmount} ${toToken} → ${recipient}'s wallet`
    },
    {
      id: 5, label: "Confirmed", sublabel: "OpenClaw notifies",
      icon: <CheckCircle2 size={18} />, color: "text-cyan-300", glowColor: "#67e8f9",
      status: "idle", detail: `WhatsApp: Sent $${amount} to ${recipient} ✓`
    },
  ];

  return { steps, summary: `$${amount} → ${toToken} → ${recipient}` };
}

const EXAMPLE_COMMANDS = [
  "Send $50 to Alice in BTC",
  "Pay Bob $200 in ETH",
  "Buy $100 of Bitcoin and send to Carol",
  "Transfer $75 SOL to Dave",
];

const DEFAULT_SETTINGS: AgentSettings = {
  llmModel: "kimi-k2-turbo",
  clawfingerPhone: "+1 (555) 019-2847",
  moonpayWallet: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  intercomPeers: "142",
  autoConfirm: true,
  maxTxAmount: "500",
  dcaEnabled: false,
  dcaAmount: "50",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function AgentStatusOrb({ isActive }: { isActive: boolean }) {
  return (
    <div className="relative flex items-center justify-center w-14 h-14">
      {isActive && (
        <>
          <div className="absolute inset-0 rounded-full bg-cyan-400/10 animate-ping" />
          <div className="absolute inset-1 rounded-full bg-cyan-400/15 animate-pulse" />
        </>
      )}
      <div
        className="relative w-10 h-10 rounded-full flex items-center justify-center"
        style={{
          background: isActive
            ? "radial-gradient(circle, oklch(0.72 0.18 195 / 0.3), oklch(0.72 0.18 195 / 0.05))"
            : "radial-gradient(circle, oklch(0.3 0.02 260 / 0.5), transparent)",
          border: `1.5px solid ${isActive ? "oklch(0.72 0.18 195 / 0.7)" : "oklch(0.4 0.04 260 / 0.4)"}`,
          boxShadow: isActive ? "0 0 20px oklch(0.72 0.18 195 / 0.5)" : "none"
        }}
      >
        <Bot size={18} className={isActive ? "text-cyan-400" : "text-slate-500"} />
      </div>
    </div>
  );
}

function PipelineStepCard({ step, index, isRunning }: { step: PipelineStep; index: number; isRunning: boolean }) {
  const statusColors: Record<StepStatus, string> = {
    idle: "border-white/10 bg-white/3",
    active: "border-cyan-400/40 bg-cyan-400/5",
    complete: "border-emerald-400/40 bg-emerald-400/5",
    error: "border-red-400/40 bg-red-400/5",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      className={`relative rounded-xl border p-4 transition-all duration-500 ${statusColors[step.status]}`}
      style={{
        backdropFilter: "blur(12px)",
        boxShadow: step.status === "active"
          ? `0 0 16px ${step.glowColor}30`
          : step.status === "complete"
          ? "0 0 10px #10b98120"
          : "none"
      }}
    >
      <div className="absolute -top-2.5 -left-2.5 w-5 h-5 rounded-full bg-slate-800 border border-white/15 flex items-center justify-center">
        <span className="text-[10px] font-mono text-slate-400">{step.id}</span>
      </div>

      <div className="flex items-start gap-3">
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${step.color}`}
          style={{ background: `${step.glowColor}15`, border: `1px solid ${step.glowColor}30` }}
        >
          {step.status === "active" && isRunning ? (
            <Loader2 size={16} className="animate-spin" />
          ) : step.status === "complete" ? (
            <CheckCircle2 size={16} className="text-emerald-400" />
          ) : (
            step.icon
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-white/90">{step.label}</span>
            {step.status === "complete" && <span className="text-[10px] text-emerald-400 font-mono">DONE</span>}
            {step.status === "active" && <span className="text-[10px] text-cyan-400 font-mono animate-pulse">LIVE</span>}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">{step.sublabel}</div>
          {step.detail && (
            <div className="text-[11px] text-slate-400 mt-1.5 font-mono truncate">{step.detail}</div>
          )}
        </div>
      </div>

      {step.id < 5 && (
        <div className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5 z-10">
          <div className="w-px h-2 bg-white/10" />
          <ChevronRight size={10} className="text-white/20 rotate-90" />
        </div>
      )}
    </motion.div>
  );
}

function ActivityRow({ item, delay }: { item: ActivityItem; delay: number }) {
  const typeConfig = {
    call: { icon: <PhoneCall size={12} />, color: "text-cyan-400", bg: "bg-cyan-400/10" },
    buy: { icon: <CreditCard size={12} />, color: "text-violet-400", bg: "bg-violet-400/10" },
    swap: { icon: <ArrowLeftRight size={12} />, color: "text-amber-400", bg: "bg-amber-400/10" },
    send: { icon: <Send size={12} />, color: "text-emerald-400", bg: "bg-emerald-400/10" },
    confirm: { icon: <CheckCircle2 size={12} />, color: "text-cyan-300", bg: "bg-cyan-300/10" },
  };
  const cfg = typeConfig[item.type];

  return (
    <motion.div
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
      className="flex items-start gap-2.5 py-2.5 border-b border-white/5 last:border-0"
    >
      <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${cfg.bg} ${cfg.color}`}>
        {cfg.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-white/80 truncate">{item.message}</span>
          {item.status === "error" && <AlertCircle size={11} className="text-red-400 flex-shrink-0" />}
        </div>
        {item.amount && (
          <div className="text-[11px] font-mono text-amber-400/80 mt-0.5">{item.amount}</div>
        )}
        <div className="text-[10px] text-slate-600 mt-0.5">{item.time}</div>
      </div>
    </motion.div>
  );
}

function StatCard({ label, value, sub, icon, color, delay }: {
  label: string; value: string; sub: string; icon: React.ReactNode; color: string; delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="glass-card rounded-xl p-4"
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs text-slate-500 uppercase tracking-wider">{label}</span>
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${color}`}
          style={{ background: "oklch(0.72 0.18 195 / 0.1)" }}>
          {icon}
        </div>
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{sub}</div>
    </motion.div>
  );
}

// ─── Swap Rate Chart (pure SVG sparkline) ────────────────────────────────────

function SwapRateChart() {
  const [data, setData] = useState(RATE_HISTORY);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; rate: number; time: string } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const latestRate = data[data.length - 1]?.rate ?? 43250;
  const prevRate = data[data.length - 2]?.rate ?? 43250;
  const isUp = latestRate >= prevRate;

  useEffect(() => {
    const interval = setInterval(() => {
      setData(prev => {
        const last = prev[prev.length - 1];
        const newRate = Math.round((last.rate + (Math.random() - 0.48) * 80) * 100) / 100;
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, "00")}:${String(now.getMinutes()).padStart(2, "00")}`;
        return [...prev.slice(1), { time: timeStr, rate: newRate }];
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const W = 500, H = 72;
  const pad = { t: 4, r: 4, b: 16, l: 4 };
  const rates = data.map(d => d.rate);
  const minR = Math.min(...rates);
  const maxR = Math.max(...rates);
  const rangeR = maxR - minR || 1;

  const px = (i: number) => pad.l + (i / (data.length - 1)) * (W - pad.l - pad.r);
  const py = (r: number) => pad.t + (1 - (r - minR) / rangeR) * (H - pad.t - pad.b);

  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"} ${px(i).toFixed(1)} ${py(d.rate).toFixed(1)}`).join(" ");
  const areaPath = linePath + ` L ${px(data.length - 1).toFixed(1)} ${(H - pad.b).toFixed(1)} L ${px(0).toFixed(1)} ${(H - pad.b).toFixed(1)} Z`;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round((relX - pad.l) / (W - pad.l - pad.r) * (data.length - 1));
    const clamped = Math.max(0, Math.min(data.length - 1, idx));
    const d = data[clamped];
    setTooltip({ x: px(clamped), y: py(d.rate), rate: d.rate, time: d.time });
  };

  // X-axis labels: show every 4th
  const xLabels = data.filter((_, i) => i % 4 === 0);

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold text-amber-400">${latestRate.toLocaleString()}</span>
          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${isUp ? "text-emerald-400 bg-emerald-400/10" : "text-red-400 bg-red-400/10"}`}>
            {isUp ? "▲" : "▼"} {Math.abs(latestRate - prevRate).toFixed(0)}
          </span>
        </div>
        <span className="text-[10px] text-slate-600">BTC/USDT · 24h</span>
      </div>
      <div className="relative w-full" style={{ height: 88 }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full h-full"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setTooltip(null)}
        >
          <defs>
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Horizontal grid lines */}
          {[0.25, 0.5, 0.75].map(t => (
            <line
              key={t}
              x1={pad.l} y1={pad.t + t * (H - pad.t - pad.b)}
              x2={W - pad.r} y2={pad.t + t * (H - pad.t - pad.b)}
              stroke="rgba(255,255,255,0.05)" strokeWidth="0.5"
            />
          ))}
          {/* Area fill */}
          <path d={areaPath} fill="url(#areaGrad)" />
          {/* Line */}
          <path d={linePath} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinejoin="round" />
          {/* X-axis labels */}
          {xLabels.map((d, i) => {
            const origIdx = data.indexOf(d);
            return (
              <text
                key={i}
                x={px(origIdx)}
                y={H - 2}
                textAnchor="middle"
                fontSize="7"
                fill="#475569"
              >{d.time}</text>
            );
          })}
          {/* Tooltip crosshair */}
          {tooltip && (
            <>
              <line x1={tooltip.x} y1={pad.t} x2={tooltip.x} y2={H - pad.b} stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="3 2" />
              <circle cx={tooltip.x} cy={tooltip.y} r="3" fill="#f59e0b" stroke="#0a0a1a" strokeWidth="1.5" />
            </>
          )}
        </svg>
        {/* Tooltip bubble */}
        {tooltip && (
          <div
            className="absolute pointer-events-none px-2 py-1 rounded-lg text-[10px] font-mono"
            style={{
              background: "oklch(0.16 0.03 265)",
              border: "1px solid oklch(0.32 0.04 255 / 0.35)",
              left: `${Math.min(Math.max((tooltip.x / W) * 100, 5), 80)}%`,
              top: 0,
              transform: "translateX(-50%)",
            }}
          >
            <div className="text-amber-400">${tooltip.rate.toLocaleString()}</div>
            <div className="text-slate-500">{tooltip.time}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Agent Settings Panel ─────────────────────────────────────────────────────

function AgentSettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [section, setSection] = useState<"agent" | "voice" | "payments" | "advanced">("agent");

  const handleSave = async () => {
    setSaving(true);
    await new Promise(r => setTimeout(r, 900));
    setSaving(false);
    toast.success("Settings saved", { description: "Agent configuration updated successfully." });
  };

  const Field = ({ label, value, onChange, placeholder, mono = false }: {
    label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean;
  }) => (
    <div className="space-y-1.5">
      <label className="text-[11px] text-slate-500 uppercase tracking-wider">{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-3 py-2 rounded-lg text-xs text-white/90 outline-none transition-all ${mono ? "font-mono" : ""}`}
        style={{
          background: "oklch(0.14 0.025 260 / 0.8)",
          border: "1px solid oklch(0.32 0.04 255 / 0.3)",
        }}
        onFocus={e => { e.target.style.borderColor = "oklch(0.72 0.18 195 / 0.5)"; }}
        onBlur={e => { e.target.style.borderColor = "oklch(0.32 0.04 255 / 0.3)"; }}
      />
    </div>
  );

  const Toggle = ({ label, desc, value, onChange }: {
    label: string; desc: string; value: boolean; onChange: (v: boolean) => void;
  }) => (
    <div className="flex items-start justify-between gap-3 py-2.5 border-b border-white/5 last:border-0">
      <div>
        <div className="text-xs font-medium text-white/80">{label}</div>
        <div className="text-[10px] text-slate-600 mt-0.5">{desc}</div>
      </div>
      <button onClick={() => onChange(!value)} className="flex-shrink-0 mt-0.5">
        {value
          ? <ToggleRight size={22} className="text-cyan-400" />
          : <ToggleLeft size={22} className="text-slate-600" />
        }
      </button>
    </div>
  );

  const sectionTabs = [
    { id: "agent", label: "Agent", icon: <Bot size={12} /> },
    { id: "voice", label: "Voice", icon: <Phone size={12} /> },
    { id: "payments", label: "Payments", icon: <CreditCard size={12} /> },
    { id: "advanced", label: "Advanced", icon: <Settings size={12} /> },
  ] as const;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/50"
            onClick={onClose}
          />
          {/* Drawer */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-80 flex flex-col border-l border-white/10"
            style={{
              background: "oklch(0.11 0.025 260)",
              backdropFilter: "blur(24px)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ background: "oklch(0.72 0.18 195 / 0.15)", border: "1px solid oklch(0.72 0.18 195 / 0.3)" }}>
                  <Settings size={13} className="text-cyan-400" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white">Agent Settings</div>
                  <div className="text-[10px] text-slate-500">OpenClaw configuration</div>
                </div>
              </div>
              <button onClick={onClose} className="text-slate-600 hover:text-slate-300 transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* Section tabs */}
            <div className="flex gap-1 px-4 py-3 border-b border-white/8">
              {sectionTabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setSection(tab.id)}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                    section === tab.id
                      ? "bg-cyan-400/10 text-cyan-400 border border-cyan-400/20"
                      : "text-slate-600 hover:text-slate-400"
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {section === "agent" && (
                <>
                  <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">LLM Model</div>
                  <div className="grid grid-cols-1 gap-2">
                    {["kimi-k2-turbo", "gpt-4o", "claude-3-5-sonnet", "gemini-2.5-flash"].map(m => (
                      <button
                        key={m}
                        onClick={() => setSettings(s => ({ ...s, llmModel: m }))}
                        className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-xs transition-all ${
                          settings.llmModel === m
                            ? "border border-cyan-400/30 bg-cyan-400/8 text-cyan-400"
                            : "border border-white/8 text-slate-500 hover:text-slate-300 hover:border-white/15"
                        }`}
                      >
                        <span className="font-mono">{m}</span>
                        {settings.llmModel === m && <CheckCircle2 size={12} className="text-cyan-400" />}
                      </button>
                    ))}
                  </div>

                  <div className="pt-2">
                    <Toggle
                      label="Auto-confirm transactions"
                      desc="Agent executes without manual approval"
                      value={settings.autoConfirm}
                      onChange={v => setSettings(s => ({ ...s, autoConfirm: v }))}
                    />
                  </div>

                  <Field
                    label="Max Transaction Amount (USD)"
                    value={settings.maxTxAmount}
                    onChange={v => setSettings(s => ({ ...s, maxTxAmount: v }))}
                    placeholder="500"
                  />
                </>
              )}

              {section === "voice" && (
                <>
                  <Field
                    label="Clawfinger Phone Number"
                    value={settings.clawfingerPhone}
                    onChange={v => setSettings(s => ({ ...s, clawfingerPhone: v }))}
                    placeholder="+1 (555) 000-0000"
                    mono
                  />
                  <div className="rounded-xl p-3 border border-white/8 bg-white/2">
                    <div className="text-[10px] text-slate-500 mb-2">Connection Status</div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-xs text-emerald-400">Android device connected</span>
                    </div>
                    <div className="text-[10px] text-slate-600 mt-1 font-mono">SIM: Carrier · Signal: 4G LTE</div>
                  </div>
                  <div className="space-y-0">
                    <Toggle
                      label="Answer incoming calls"
                      desc="Agent picks up calls to this number"
                      value={true}
                      onChange={() => toast.info("Feature coming soon")}
                    />
                    <Toggle
                      label="Outbound call capability"
                      desc="Agent can place calls on your behalf"
                      value={true}
                      onChange={() => toast.info("Feature coming soon")}
                    />
                    <Toggle
                      label="Call recording"
                      desc="Store transcripts for audit trail"
                      value={false}
                      onChange={() => toast.info("Feature coming soon")}
                    />
                  </div>
                </>
              )}

              {section === "payments" && (
                <>
                  <Field
                    label="MoonPay Wallet Address"
                    value={settings.moonpayWallet}
                    onChange={v => setSettings(s => ({ ...s, moonpayWallet: v }))}
                    placeholder="bc1q..."
                    mono
                  />
                  <Field
                    label="IntercomSwap Peer Limit"
                    value={settings.intercomPeers}
                    onChange={v => setSettings(s => ({ ...s, intercomPeers: v }))}
                    placeholder="142"
                  />
                  <div className="space-y-0">
                    <Toggle
                      label="DCA Mode"
                      desc="Recurring automated purchases"
                      value={settings.dcaEnabled}
                      onChange={v => setSettings(s => ({ ...s, dcaEnabled: v }))}
                    />
                  </div>
                  {settings.dcaEnabled && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
                      <Field
                        label="DCA Amount (USD / week)"
                        value={settings.dcaAmount}
                        onChange={v => setSettings(s => ({ ...s, dcaAmount: v }))}
                        placeholder="50"
                      />
                    </motion.div>
                  )}
                  <div className="rounded-xl p-3 border border-amber-400/15 bg-amber-400/5">
                    <div className="text-[10px] text-amber-400 font-medium mb-1">Non-custodial</div>
                    <div className="text-[10px] text-slate-500">Your keys are stored locally. MoonPay and AFOS never hold your funds.</div>
                  </div>
                </>
              )}

              {section === "advanced" && (
                <>
                  <div className="space-y-0">
                    <Toggle
                      label="P2P Peer Discovery"
                      desc="Auto-discover IntercomSwap peers"
                      value={true}
                      onChange={() => toast.info("Feature coming soon")}
                    />
                    <Toggle
                      label="Tor Routing"
                      desc="Route transactions through Tor"
                      value={false}
                      onChange={() => toast.info("Feature coming soon")}
                    />
                    <Toggle
                      label="Webhook Notifications"
                      desc="POST events to your endpoint"
                      value={false}
                      onChange={() => toast.info("Feature coming soon")}
                    />
                    <Toggle
                      label="Debug Logging"
                      desc="Verbose agent event logs"
                      value={false}
                      onChange={() => toast.info("Feature coming soon")}
                    />
                  </div>
                  <div className="rounded-xl p-3 border border-white/8 bg-white/2 space-y-1.5">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider">Version Info</div>
                    <div className="text-[11px] font-mono text-slate-400">OpenClaw v0.4.2 · Clawfinger v1.1.0</div>
                    <div className="text-[11px] font-mono text-slate-400">IntercomSwap v0.2.1 · MoonPay Agents API v3</div>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-white/8">
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-60"
                style={{
                  background: "linear-gradient(135deg, oklch(0.72 0.18 195 / 0.25), oklch(0.55 0.22 290 / 0.25))",
                  border: "1px solid oklch(0.72 0.18 195 / 0.35)",
                  color: "oklch(0.72 0.18 195)",
                  boxShadow: "0 0 14px oklch(0.72 0.18 195 / 0.15)"
                }}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? "Saving..." : "Save Configuration"}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Voice Command Simulator ──────────────────────────────────────────────────

function VoiceCommandSimulator({
  onExecute,
  isRunning,
}: {
  onExecute: (cmd: string) => void;
  isRunning: boolean;
}) {
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    const cmd = input.trim();
    if (!cmd || isRunning) return;
    onExecute(cmd);
    setInput("");
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
  };

  const handleExample = (cmd: string) => {
    setInput(cmd);
    inputRef.current?.focus();
  };

  const handleMic = () => {
    if (isRunning) return;
    setListening(l => !l);
    if (!listening) {
      setTimeout(() => {
        const ex = EXAMPLE_COMMANDS[Math.floor(Math.random() * EXAMPLE_COMMANDS.length)];
        setInput(ex);
        setListening(false);
        toast.success("Voice captured", { description: `"${ex}"` });
      }, 1800);
    }
  };

  return (
    <div className="px-4 py-4 border-t border-white/8 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-slate-500 uppercase tracking-wider">Voice Command Simulator</div>
        {isRunning && (
          <div className="flex items-center gap-1">
            <Loader2 size={9} className="animate-spin text-cyan-400" />
            <span className="text-[9px] text-cyan-400">Executing...</span>
          </div>
        )}
      </div>

      {/* Input row */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all"
        style={{
          background: "oklch(0.13 0.025 260 / 0.8)",
          border: listening
            ? "1px solid oklch(0.72 0.18 195 / 0.5)"
            : "1px solid oklch(0.32 0.04 255 / 0.3)",
          boxShadow: listening ? "0 0 10px oklch(0.72 0.18 195 / 0.2)" : "none",
        }}
      >
        <button
          onClick={handleMic}
          disabled={isRunning}
          className={`flex-shrink-0 transition-colors ${listening ? "text-cyan-400" : "text-slate-600 hover:text-slate-400"}`}
        >
          {listening ? <Mic size={13} className="animate-pulse" /> : <MicOff size={13} />}
        </button>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          disabled={isRunning || listening}
          placeholder={listening ? "Listening..." : "Type a command..."}
          className="flex-1 bg-transparent text-[12px] text-white/80 placeholder-slate-600 outline-none min-w-0"
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim() || isRunning}
          className="flex-shrink-0 text-slate-600 hover:text-cyan-400 disabled:opacity-30 transition-colors"
        >
          <CornerDownLeft size={13} />
        </button>
      </div>

      {/* Example chips */}
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLE_COMMANDS.map(cmd => (
          <button
            key={cmd}
            onClick={() => handleExample(cmd)}
            disabled={isRunning}
            className="text-[10px] px-2 py-1 rounded-md border border-white/8 text-slate-500 hover:text-slate-300 hover:border-white/20 transition-all disabled:opacity-40 truncate max-w-full"
          >
            {cmd}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 justify-center">
        <ExternalLink size={9} className="text-slate-700" />
        <span className="text-[9px] text-slate-700">Powered by Clawfinger + OpenClaw</span>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [steps, setSteps] = useState<PipelineStep[]>(INITIAL_STEPS);
  const [isRunning, setIsRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [agentActive] = useState(true);
  const [activity, setActivity] = useState<ActivityItem[]>(ACTIVITY_LOG);
  const [txCount, setTxCount] = useState(47);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activePage, setActivePage] = useState<"dashboard" | "swaps">("dashboard");
  const runRef = useRef(false);

  const BG_URL = "https://private-us-east-1.manuscdn.com/sessionFile/Rf8GQw20ieLRndEIY01aHd/sandbox/CMHXyEbOGZ9uI8wwGu3io8-img-1_1772065364000_na1fn_YWZvcy1iZw.png?x-oss-process=image/resize,w_1920,h_1920/format,webp/quality,q_80&Expires=1798761600&Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9wcml2YXRlLXVzLWVhc3QtMS5tYW51c2Nkbi5jb20vc2Vzc2lvbkZpbGUvUmY4R1F3MjBpZUxSbmRFSVkwMWFIZC9zYW5kYm94L0NNSFh5RWJPR1o5dUk4d3dHdTNpbzgtaW1nLTFfMTc3MjA2NTM2NDAwMF9uYTFmbl9ZV1p2Y3kxaVp3LnBuZz94LW9zcy1wcm9jZXNzPWltYWdlL3Jlc2l6ZSx3XzE5MjAsaF8xOTIwL2Zvcm1hdCx3ZWJwL3F1YWxpdHkscV84MCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc5ODc2MTYwMH19fV19&Key-Pair-Id=K2HSFNDJXOU9YS&Signature=s7lioW45otsoPZdYjq~k8BWx~~dUJTFmAxl5JPa7x97vrjTPi9yjYO7IQ8sHYVP-EhsudPQzUBGnDBOltdoNp6TLh8ULLv42iyR8IxmMY0ZB9M1Ah~JqPctENNRau3vLDzFyFgJwp6iHRiSTU9UH9C7pToZHQblD1h5-oTnftnurrEjUJg9gBA8WrB6a6f~PgEGjtYIbhHcTEcWsJIRvAAYFy64aR1DjSaujb92eQR2bN6Gw4yFSQmmmxw9~8~fD9K6KTVYUJk~j8vtvJ5NR9qa-TPgHLvl1v-t4N7UxIKecb6fEY2P9HkcJbE3A2Oe3~tuR6OhPxQQxyeKy6R-tQw__";

  const runPipeline = useCallback(async (customSteps?: PipelineStep[], summary?: string) => {
    if (runRef.current) return;
    runRef.current = true;
    setIsRunning(true);

    const stepsToRun = customSteps ?? INITIAL_STEPS.map(s => ({ ...s, status: "idle" as StepStatus }));
    setSteps(stepsToRun.map(s => ({ ...s, status: "idle" as StepStatus })));
    setCurrentStep(-1);

    const delays = [1200, 2500, 2000, 1500, 1000];

    for (let i = 0; i < stepsToRun.length; i++) {
      setCurrentStep(i);
      setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: "active" } : s));
      await new Promise(r => setTimeout(r, delays[i]));
      setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: "complete" } : s));
    }

    const label = summary ?? "Demo payment confirmed";
    const newItem: ActivityItem = {
      id: `a${Date.now()}`,
      time: "just now",
      type: "confirm",
      message: label,
      amount: stepsToRun[3]?.detail?.split(" → ")[0] ?? "0.00231 BTC",
      status: "success"
    };
    setActivity(prev => [newItem, ...prev.slice(0, 9)]);
    setTxCount(c => c + 1);

    toast.success("Transaction complete", { description: label });

    setIsRunning(false);
    runRef.current = false;
  }, []);

  const handleVoiceCommand = useCallback((cmd: string) => {
    const { steps: parsed, summary } = parseCommand(cmd);
    runPipeline(parsed, summary);
  }, [runPipeline]);

  const copyAddress = () => {
    toast.success("Address copied", { description: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh" });
  };

  const navItems = [
    { icon: <BarChart3 size={16} />, label: "Dashboard", active: activePage === "dashboard", action: () => setActivePage("dashboard") },
    { icon: <Wallet size={16} />, label: "Wallets", active: false, action: undefined },
    { icon: <ArrowLeftRight size={16} />, label: "Swaps", active: activePage === "swaps", action: () => setActivePage("swaps") },
    { icon: <Phone size={16} />, label: "Voice Calls", active: false, action: undefined },
    { icon: <Activity size={16} />, label: "Activity", active: false, action: undefined },
    { icon: <Network size={16} />, label: "P2P Network", active: false, action: undefined },
    { icon: <Shield size={16} />, label: "Security", active: false, action: undefined },
    { icon: <Settings size={16} />, label: "Settings", active: false, action: () => setSettingsOpen(true) },
  ];

  return (
    <div
      className="min-h-screen flex overflow-hidden"
      style={{ background: "oklch(0.085 0.02 260)", fontFamily: "'Outfit', sans-serif" }}
    >
      {/* Background */}
      <div className="fixed inset-0 z-0 opacity-20"
        style={{ backgroundImage: `url(${BG_URL})`, backgroundSize: "cover", backgroundPosition: "center" }} />
      <div className="fixed inset-0 z-0"
        style={{ background: "radial-gradient(ellipse 80% 60% at 50% 0%, oklch(0.55 0.22 290 / 0.08), transparent)" }} />

      {/* Settings Panel */}
      <AgentSettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* ── Sidebar ── */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ x: -240 }}
            animate={{ x: 0 }}
            exit={{ x: -240 }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="relative z-20 w-56 flex-shrink-0 flex flex-col border-r border-white/8"
            style={{ background: "oklch(0.1 0.025 260 / 0.92)", backdropFilter: "blur(20px)" }}
          >
            {/* Logo */}
            <div className="px-5 py-5 border-b border-white/8">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, oklch(0.72 0.18 195), oklch(0.55 0.22 290))" }}>
                  <Zap size={14} className="text-white" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white tracking-tight">AFOS</div>
                  <div className="text-[9px] text-slate-500 tracking-widest uppercase">Agent OS</div>
                </div>
              </div>
            </div>

            {/* Agent status */}
            <div className="px-4 py-4 border-b border-white/8">
              <div className="flex items-center gap-3">
                <AgentStatusOrb isActive={agentActive} />
                <div>
                  <div className="text-xs font-semibold text-white/90">OpenClaw</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                      style={{ boxShadow: "0 0 6px #10b981" }} />
                    <span className="text-[10px] text-slate-500">Active · Listening</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Nav */}
            <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
              {navItems.map((item) => (
                <button
                  key={item.label}
                  onClick={() => item.action ? item.action() : toast.info("Feature coming soon")}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs transition-all duration-200 ${
                    item.active
                      ? "bg-cyan-400/10 text-cyan-400 border border-cyan-400/20"
                      : "text-slate-500 hover:text-slate-300 hover:bg-white/5"
                  }`}
                >
                  {item.icon}
                  <span className="font-medium">{item.label}</span>
                  {item.active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-cyan-400" />}
                </button>
              ))}
            </nav>

            {/* Bottom */}
            <div className="px-4 py-4 border-t border-white/8">
              <div className="flex items-center gap-2 px-1">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center">
                  <span className="text-[9px] font-bold text-white">A</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-white/80 truncate">Alex</div>
                  <div className="text-[10px] text-slate-600 truncate">alex@afos.ai</div>
                </div>
                <button onClick={() => toast.info("Feature coming soon")} className="text-slate-600 hover:text-slate-400">
                  <LogOut size={12} />
                </button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ── Main Content ── */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0">

        {/* Top bar */}
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-white/8"
          style={{ background: "oklch(0.1 0.02 260 / 0.7)", backdropFilter: "blur(16px)" }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(s => !s)}
              className="text-slate-500 hover:text-slate-300 transition-colors">
              {sidebarOpen ? <X size={16} /> : <Menu size={16} />}
            </button>
            <div>
              <h1 className="text-sm font-bold text-white">Agentic Financial OS</h1>
              <p className="text-[10px] text-slate-500">OpenClaw · Clawfinger · IntercomSwap · MoonPay Agents</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-400/20 bg-emerald-400/5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-emerald-400 font-medium">All Systems Operational</span>
            </div>
            <button onClick={() => setSettingsOpen(true)}
              className="w-7 h-7 rounded-lg border border-white/10 flex items-center justify-center text-slate-500 hover:text-cyan-400 hover:border-cyan-400/30 transition-all">
              <Settings size={13} />
            </button>
            <button onClick={() => toast.info("Feature coming soon")}
              className="w-7 h-7 rounded-lg border border-white/10 flex items-center justify-center text-slate-500 hover:text-slate-300 hover:border-white/20 transition-all">
              <Bell size={13} />
            </button>
          </div>
        </header>

        {/* Content grid */}
        <div className="flex-1 flex overflow-hidden">
          {/* Swaps Page */}
          {activePage === "swaps" && <Swaps />}

          {/* Center: Stats + Pipeline */}
          {activePage === "dashboard" && <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

            {/* Stats row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard label="Total Volume" value="$10,372" sub="Last 30 days" icon={<TrendingUp size={14} />} color="text-cyan-400" delay={0.05} />
              <StatCard label="Transactions" value={String(txCount)} sub="This month" icon={<Activity size={14} />} color="text-violet-400" delay={0.1} />
              <StatCard label="Avg. Swap Time" value="8.3s" sub="P2P settlement" icon={<Clock size={14} />} color="text-amber-400" delay={0.15} />
              <StatCard label="Network Peers" value="142" sub="IntercomSwap nodes" icon={<Globe size={14} />} color="text-emerald-400" delay={0.2} />
            </div>

            {/* Pipeline */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="glass-card rounded-2xl p-5"
            >
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-sm font-bold text-white">Transaction Pipeline</h2>
                  <p className="text-[11px] text-slate-500 mt-0.5">Live agentic flow · Voice → Buy → Swap → Send → Confirm</p>
                </div>
                <button
                  onClick={() => runPipeline()}
                  disabled={isRunning}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200 disabled:opacity-50"
                  style={{
                    background: isRunning ? "oklch(0.72 0.18 195 / 0.1)" : "linear-gradient(135deg, oklch(0.72 0.18 195 / 0.2), oklch(0.55 0.22 290 / 0.2))",
                    border: "1px solid oklch(0.72 0.18 195 / 0.3)",
                    color: "oklch(0.72 0.18 195)",
                    boxShadow: isRunning ? "none" : "0 0 12px oklch(0.72 0.18 195 / 0.2)"
                  }}
                >
                  {isRunning ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                  {isRunning ? "Running..." : "Run Demo"}
                </button>
              </div>

              <div className="space-y-4">
                {steps.map((step, i) => (
                  <PipelineStepCard key={step.id} step={step} index={i} isRunning={isRunning && currentStep === i} />
                ))}
              </div>
            </motion.div>

            {/* Swap Rate Chart — embedded in Atomic Swap context */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.32 }}
              className="glass-card rounded-2xl p-5"
            >
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ background: "#f59e0b15", border: "1px solid #f59e0b30" }}>
                  <ArrowLeftRight size={14} className="text-amber-400" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">Swap Rate · BTC/USDT</h2>
                  <p className="text-[11px] text-slate-500">IntercomSwap P2P · Live rate feed · Updates every 3s</p>
                </div>
              </div>
              <SwapRateChart />
            </motion.div>

            {/* Wallet balances */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.38 }}
              className="glass-card rounded-2xl p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-bold text-white">Non-Custodial Wallet</h2>
                  <p className="text-[11px] text-slate-500 mt-0.5">You hold the keys · MoonPay managed</p>
                </div>
                <button onClick={() => toast.info("Feature coming soon")}
                  className="text-slate-600 hover:text-slate-400 transition-colors">
                  <RefreshCw size={13} />
                </button>
              </div>

              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/3 border border-white/8 mb-4">
                <span className="text-[11px] font-mono text-slate-500 flex-1 truncate">bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh</span>
                <button onClick={copyAddress} className="text-slate-600 hover:text-cyan-400 transition-colors flex-shrink-0">
                  <Copy size={11} />
                </button>
              </div>

              <div className="space-y-2">
                {BALANCES.map((b, i) => (
                  <motion.div
                    key={b.symbol}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.42 + i * 0.06 }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/3 transition-colors"
                  >
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                      style={{ background: `${b.color}20`, color: b.color, border: `1px solid ${b.color}30` }}>
                      {b.symbol.slice(0, 1)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-white/90">{b.name}</div>
                      <div className="text-[10px] font-mono text-slate-500">{b.amount} {b.symbol}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold text-amber-400">{b.usd}</div>
                      <div className={`text-[10px] ${b.positive ? "text-emerald-400" : "text-red-400"}`}>{b.change}</div>
                    </div>
                  </motion.div>
                ))}
              </div>

              <div className="mt-3 pt-3 border-t border-white/8 flex items-center justify-between">
                <span className="text-xs text-slate-500">Total Portfolio</span>
                <span className="text-sm font-bold text-amber-400">$10,372.00</span>
              </div>
            </motion.div>

            {/* Stack components */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
              className="glass-card rounded-2xl p-5"
            >
              <h2 className="text-sm font-bold text-white mb-4">Stack Components</h2>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { name: "OpenClaw", role: "Agent Brain", status: "Online", color: "#06b6d4", icon: <Bot size={14} />, action: () => setSettingsOpen(true) },
                  { name: "Clawfinger", role: "Voice Gateway", status: "Listening", color: "#7c3aed", icon: <Phone size={14} />, action: () => setSettingsOpen(true) },
                  { name: "IntercomSwap", role: "P2P Exchange", status: "142 Peers", color: "#f59e0b", icon: <ArrowLeftRight size={14} />, action: () => setSettingsOpen(true) },
                  { name: "MoonPay Agents", role: "Fiat Bridge", status: "Connected", color: "#10b981", icon: <CreditCard size={14} />, action: () => setSettingsOpen(true) },
                ].map((comp, i) => (
                  <motion.button
                    key={comp.name}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.5 + i * 0.07 }}
                    onClick={comp.action}
                    className="rounded-xl p-3 border border-white/8 hover:border-white/20 transition-all text-left"
                    style={{ background: `${comp.color}08` }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 rounded-md flex items-center justify-center"
                        style={{ background: `${comp.color}20`, color: comp.color }}>
                        {comp.icon}
                      </div>
                      <span className="text-xs font-semibold text-white/90">{comp.name}</span>
                    </div>
                    <div className="text-[10px] text-slate-500">{comp.role}</div>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: comp.color }} />
                      <span className="text-[10px]" style={{ color: comp.color }}>{comp.status}</span>
                    </div>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </div>}

          {/* Right: Activity feed + Voice Command Simulator */}
          {activePage === "dashboard" && <>
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="w-72 flex-shrink-0 border-l border-white/8 flex flex-col overflow-hidden"
            style={{ background: "oklch(0.1 0.022 260 / 0.7)", backdropFilter: "blur(16px)" }}
          >
            <div className="px-4 py-3.5 border-b border-white/8 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-white">Live Activity</h3>
                <p className="text-[10px] text-slate-500 mt-0.5">Agent event stream</p>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] text-emerald-400">Live</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-2">
              <AnimatePresence>
                {activity.map((item, i) => (
                  <ActivityRow key={item.id} item={item} delay={i * 0.04} />
                ))}
              </AnimatePresence>
            </div>

            {/* Voice Command Simulator */}
            <VoiceCommandSimulator onExecute={handleVoiceCommand} isRunning={isRunning} />
          </motion.div>
          </>}

        </div>
      </div>
    </div>
  );
}
