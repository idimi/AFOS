/**
 * AFOS — Agent Settings Page
 * Configure OpenClaw agent, IntercomSwap node, Bitcoin, Solana wallet, and future MoonPay integration
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { Bot, Zap, Network, Wallet, Moon, Save, Eye, EyeOff, CheckCircle2, Clock, ToggleLeft, ToggleRight, Repeat } from "lucide-react";
import { toast } from "sonner";

interface Section {
  id: string;
  label: string;
  icon: React.ElementType;
  color: string;
  border: string;
  bg: string;
}

const SECTIONS: Section[] = [
  { id: "openclaw", label: "AFOS Agent", icon: Bot, color: "text-cyan-400", border: "border-cyan-500/20", bg: "bg-cyan-500/5" },
  { id: "intercomswap", label: "IntercomSwap Node", icon: Network, color: "text-emerald-400", border: "border-emerald-500/20", bg: "bg-emerald-500/5" },
  { id: "lnd", label: "Bitcoin (on-chain)", icon: Zap, color: "text-amber-400", border: "border-amber-500/20", bg: "bg-amber-500/5" },
  { id: "solana", label: "Solana Wallet", icon: Wallet, color: "text-purple-400", border: "border-purple-500/20", bg: "bg-purple-500/5" },
  { id: "worker", label: "Worker / Autopost", icon: Repeat, color: "text-violet-400", border: "border-violet-500/20", bg: "bg-violet-500/5" },
  { id: "moonpay", label: "MoonPay (Phase 2)", icon: Moon, color: "text-foreground/70", border: "border-border", bg: "bg-muted" },
];

function WorkerConfigSection() {
  const [tradeauto, setTradeauto] = useState(false);
  const [maxAmount, setMaxAmount] = useState("0.01");
  const [feeBpsCap, setFeeBpsCap] = useState("50");
  const [tickInterval, setTickInterval] = useState("3800");
  const [minRefundHours, setMinRefundHours] = useState("20");
  const [maxRefundHours, setMaxRefundHours] = useState("40");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between p-3 rounded-xl" style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
        <div>
          <p className="text-xs font-semibold text-foreground">Autonomous Trading (tradeauto)</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Worker auto-accepts matching quotes without manual approval</p>
        </div>
        <button onClick={() => setTradeauto(v => !v)}
          className="flex items-center gap-1.5 text-xs font-mono transition-colors"
          style={{ color: tradeauto ? "#10b981" : "var(--muted-foreground)" }}>
          {tradeauto ? <ToggleRight className="w-5 h-5 text-emerald-400" /> : <ToggleLeft className="w-5 h-5" />}
          {tradeauto ? "ON" : "OFF"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Max trade amount (BTC)", value: maxAmount, set: setMaxAmount, placeholder: "0.01", mono: true },
          { label: "Max fee cap (bps)", value: feeBpsCap, set: setFeeBpsCap, placeholder: "50", mono: true },
          { label: "Tick interval (ms)", value: tickInterval, set: setTickInterval, placeholder: "3800", mono: true },
          { label: "Min HTLC refund (hours)", value: minRefundHours, set: setMinRefundHours, placeholder: "20", mono: true },
          { label: "Max HTLC refund (hours)", value: maxRefundHours, set: setMaxRefundHours, placeholder: "40", mono: true },
        ].map(field => (
          <div key={field.label}>
            <label className="block text-xs text-foreground/70 mb-1.5">{field.label}</label>
            <input
              value={field.value}
              onChange={e => field.set(e.target.value)}
              placeholder={field.placeholder}
              className={`w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-foreground/70 focus:outline-none focus:border-violet-500/35 transition-colors font-mono`}
            />
          </div>
        ))}
      </div>

      <div className="p-3 rounded-xl" style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.2)" }}>
        <p className="text-[10px] font-mono text-violet-300/70">
          Worker polls the IntercomSwap rendezvous channel every {tickInterval}ms.
          When tradeauto is ON, it auto-accepts quotes below {feeBpsCap} bps fee and under {maxAmount} BTC.
          HTLC refund window: {minRefundHours}–{maxRefundHours}h.
        </p>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", mono = false, placeholder = "", disabled = false }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; mono?: boolean; placeholder?: string; disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  const isPassword = type === "password";
  return (
    <div>
      <label className="block text-xs text-foreground/70 mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={isPassword && !show ? "password" : "text"}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={`w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-foreground/70 focus:outline-none focus:border-cyan-500/35 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${mono ? "font-mono" : ""}`}
        />
        {isPassword && (
          <button onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/70 hover:text-foreground/70 transition-colors">
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

function Toggle({ label, description, value, onChange, disabled = false }: {
  label: string; description?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm text-foreground/70">{label}</p>
        {description && <p className="text-xs text-foreground/70 mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => !disabled && onChange(!value)}
        disabled={disabled}
        className={`relative w-10 h-5.5 rounded-full transition-colors duration-200 disabled:opacity-30 disabled:cursor-not-allowed ${value ? "bg-cyan-500/60" : "bg-muted"}`}
      >
        <motion.div
          animate={{ x: value ? 18 : 2 }}
          transition={{ duration: 0.15 }}
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow"
        />
      </button>
    </div>
  );
}

export default function AgentSettings() {
  const [settings, setSettings] = useState({
    // OpenClaw
    llmModel: "kimi-k2-turbo",
    systemPrompt: "You are an autonomous financial agent. Execute swaps via IntercomSwap when instructed.",
    autoConfirm: true,
    maxTxAmount: "500",
    // IntercomSwap
    rendezvousChannel: "0000intercomswapbtcusdt",
    peerMode: "maker-taker",
    minSwapUsdt: "10",
    maxSwapUsdt: "1000",
    scBridgePort: "49222",
    // Bitcoin
    lndHost: "localhost:8332",
    lndMacaroon: "",
    lndTlsCert: "",
    // Solana
    solanaRpc: "https://api.mainnet-beta.solana.com",
    solanaKeypairPath: "onchain/solana/keypair.json",
    escrowProgramId: "4RS6xpspM1V2K7FKSqeSH6VVaZbtzHzhJqacwrz8gJrF",
    // MoonPay (future)
    moonpayApiKey: "",
    moonpayWallet: "",
  });

  const set = (key: string) => (v: string | boolean) =>
    setSettings(prev => ({ ...prev, [key]: v }));

  const handleSave = () => {
    toast.success("Settings saved", { description: "Agent configuration updated" });
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">Agent Settings</h1>
        <p className="text-sm text-foreground/70 mt-1">Configure your OpenClaw agent and IntercomSwap node</p>
      </div>

      <div className="space-y-4">
        {SECTIONS.map((section, si) => {
          const Icon = section.icon;
          const isPlanned = section.id === "moonpay";
          return (
            <motion.div key={section.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: si * 0.07 }}
              className={`rounded-2xl border ${section.border} ${section.bg} p-5`}>
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${section.bg} border ${section.border}`}>
                  <Icon className={`w-4 h-4 ${section.color}`} />
                </div>
                <p className={`text-sm font-semibold ${isPlanned ? "text-foreground/70" : "text-foreground"}`}>{section.label}</p>
                {isPlanned && (
                  <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
                    <Clock className="w-3 h-3 text-amber-400" />
                    <span className="text-xs text-amber-400 font-mono">Phase 2</span>
                  </div>
                )}
              </div>

              {section.id === "openclaw" && (
                <div className="space-y-4">
                  <Field label="LLM Model" value={settings.llmModel} onChange={set("llmModel")} placeholder="kimi-k2-turbo" />
                  <div>
                    <label className="block text-xs text-foreground/70 mb-1.5">System Prompt</label>
                    <textarea value={settings.systemPrompt} onChange={e => set("systemPrompt")(e.target.value)} rows={3}
                      className="w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-foreground/70 focus:outline-none focus:border-cyan-500/35 resize-none" />
                  </div>
                  <Field label="Max Transaction Amount (USD)" value={settings.maxTxAmount} onChange={set("maxTxAmount")} placeholder="500" />
                  <Toggle label="Auto-confirm swaps" description="Agent executes without asking for confirmation" value={settings.autoConfirm} onChange={set("autoConfirm") as (v: boolean) => void} />
                </div>
              )}

              {section.id === "intercomswap" && (
                <div className="space-y-4">
                  <Field label="Rendezvous Channel" value={settings.rendezvousChannel} onChange={set("rendezvousChannel")} mono placeholder="0000intercomswapbtcusdt" />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Min Swap (USDT)" value={settings.minSwapUsdt} onChange={set("minSwapUsdt")} placeholder="10" />
                    <Field label="Max Swap (USDT)" value={settings.maxSwapUsdt} onChange={set("maxSwapUsdt")} placeholder="1000" />
                  </div>
                  <Field label="SC-Bridge Port" value={settings.scBridgePort} onChange={set("scBridgePort")} mono placeholder="49222" />
                  <div>
                    <label className="block text-xs text-foreground/70 mb-1.5">Peer Mode</label>
                    <div className="flex gap-2">
                      {["maker", "taker", "maker-taker"].map(mode => (
                        <button key={mode} onClick={() => set("peerMode")(mode)}
                          className={`flex-1 py-2 rounded-xl text-xs font-mono border transition-all ${
                            settings.peerMode === mode
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                              : "border-border bg-muted text-foreground/70 hover:border-border"
                          }`}>
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {section.id === "lnd" && (
                <div className="space-y-4">
                  <Field label="Bitcoin Node Host:Port" value={settings.lndHost} onChange={set("lndHost")} mono placeholder="localhost:8332" />
                  <Field label="RPC Password" value={settings.lndMacaroon} onChange={set("lndMacaroon")} type="password" mono placeholder="rpcpassword" />
                  <Field label="TLS Cert Path" value={settings.lndTlsCert} onChange={set("lndTlsCert")} mono placeholder="/root/.lnd/tls.cert" />
                </div>
              )}

              {section.id === "solana" && (
                <div className="space-y-4">
                  <Field label="RPC URL" value={settings.solanaRpc} onChange={set("solanaRpc")} mono placeholder="https://api.mainnet-beta.solana.com" />
                  <Field label="Keypair Path" value={settings.solanaKeypairPath} onChange={set("solanaKeypairPath")} mono placeholder="onchain/solana/keypair.json" />
                  <div>
                    <label className="block text-xs text-foreground/70 mb-1.5">Escrow Program ID</label>
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-muted border border-border">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="text-xs font-mono text-foreground/70 truncate">{settings.escrowProgramId}</span>
                    </div>
                    <p className="text-[10px] text-foreground/70 mt-1 font-mono">Deployed on Solana mainnet — do not modify</p>
                  </div>
                </div>
              )}

              {section.id === "worker" && (
                <WorkerConfigSection />
              )}

              {section.id === "moonpay" && (
                <div className="space-y-4 opacity-40 pointer-events-none">
                  <Field label="API Key" value={settings.moonpayApiKey} onChange={set("moonpayApiKey")} type="password" placeholder="pk_live_…" disabled />
                  <Field label="Destination Wallet Address" value={settings.moonpayWallet} onChange={set("moonpayWallet")} mono placeholder="bc1q…" disabled />
                  <p className="text-xs text-foreground/70 font-mono">MoonPay fiat on-ramp will be integrated in Phase 2 to auto-fund the agent wallet before executing swaps.</p>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="mt-6 flex justify-end">
        <button onClick={handleSave}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-cyan-500/15 border border-cyan-500/25 text-cyan-300 hover:bg-cyan-500/25 transition-all font-semibold text-sm">
          <Save className="w-4 h-4" />
          Save Configuration
        </button>
      </div>
    </div>
  );
}
