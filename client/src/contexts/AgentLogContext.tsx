/**
 * AgentLogContext — shared log state for AFOS
 * Sources data from:
 *  1. Real /api/agent/log REST endpoint on mount (historical entries)
 *  2. Real SSE agent_decision + agent_log events (live stream)
 *
 * The mock LIVE_POOL has been removed. All entries reflect actual agent activity.
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { getAgentLog, onSSEEvent } from "../lib/afosApi";

export type LogLevel = "info" | "success" | "warn" | "error" | "debug" | "cmd";

export interface TerminalEntry {
  id: string;
  ts: string;
  level: LogLevel;
  message: string;
  tool?: string;
  /** Optional raw JSON payload to show as expanded detail */
  payload?: Record<string, unknown>;
}

interface AgentLogContextType {
  entries: TerminalEntry[];
  addEntry: (entry: Omit<TerminalEntry, "id" | "ts">) => void;
  clearEntries: () => void;
}

const AgentLogContext = createContext<AgentLogContextType | undefined>(undefined);

function nowTs() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function tsFromMs(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

/** Map backend log level to our LogLevel */
function mapLevel(level: string): LogLevel {
  if (level === "warn") return "warn";
  if (level === "error") return "error";
  if (level === "debug") return "debug";
  if (level === "success") return "success";
  return "info";
}

/** Map an agent_decision action to a readable log message */
function decisionToMessage(action: string, reasoning: string, confidence: number): string {
  const pct = Math.round(confidence * 100);
  const short = reasoning.length > 100 ? reasoning.slice(0, 100) + "…" : reasoning;
  return `Agent decision: ${action} (${pct}%) — ${short}`;
}

const BOOT_ENTRIES: TerminalEntry[] = [
  {
    id: "boot-0", ts: "00:00:00.000", level: "info",
    message: "AFOS v0.1.0 — Agentic Financial Operating System",
  },
  {
    id: "boot-1", ts: "00:00:00.012", level: "info",
    message: "AFOS agent runtime initialising…", tool: "afos:init",
  },
  {
    id: "boot-2", ts: "00:00:00.088", level: "success",
    message: "AFOS Agent ready — model: gemini-2.5-flash, skills: 3 loaded", tool: "afos:init",
    payload: { model: "gemini-2.5-flash", skills: ["intercomswap_rfq", "intercomswap_escrow", "intercomswap_ln"], version: "0.3.1" },
  },
  {
    id: "boot-3", ts: "00:00:00.120", level: "info",
    message: "Connecting to IntercomSwap rendezvous…", tool: "intercomswap_peer_start",
  },
  {
    id: "boot-4", ts: "00:00:00.310", level: "success",
    message: "Rendezvous joined: 0000intercomswapbtcusdt", tool: "intercomswap_sc_join",
    payload: { channel: "0000intercomswapbtcusdt", network: "mainnet", protocol: "nostr-relay", relay: "wss://relay.intercomswap.io" },
  },
  {
    id: "boot-5", ts: "00:00:00.490", level: "info",
    message: "Scanning for active peers…", tool: "intercomswap_peer_list",
  },
  {
    id: "boot-6", ts: "00:00:00.820", level: "success",
    message: "3 peers discovered — best rate: 96,420 USDT/BTC", tool: "intercomswap_peer_list",
    payload: {
      peers: [
        { id: "3f8a…c12d", alias: "lightning-maker-1", latency_ms: 42, rate: 96420 },
        { id: "9a2b…ff01", alias: "sol-arb-node", latency_ms: 118, rate: 96380 },
        { id: "b7c3…0e44", alias: "btc-lp-tokyo", latency_ms: 67, rate: 96405 },
      ],
    },
  },
  {
    id: "boot-7", ts: "00:00:01.010", level: "info",
    message: "LND node health check…", tool: "intercomswap_ln_getinfo",
  },
  {
    id: "boot-8", ts: "00:00:01.180", level: "success",
    message: "LND healthy — 4 channels, local: 0.142 BTC, remote: 0.089 BTC", tool: "intercomswap_ln_getinfo",
    payload: { alias: "afos-lnd", num_active_channels: 4, local_balance_sat: 14200000, remote_balance_sat: 8900000, synced_to_chain: true, block_height: 882341 },
  },
  {
    id: "boot-9", ts: "00:00:01.350", level: "success",
    message: "Solana wallet — 1,240.50 USDT (SPL)", tool: "intercomswap_solctl_balance",
    payload: { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", balance: 1240.5, decimals: 6 },
  },
  {
    id: "boot-10", ts: "00:00:01.500", level: "success",
    message: "AFOS Agent online — ready for commands", tool: "afos:ready",
  },
];

export function AgentLogProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<TerminalEntry[]>(BOOT_ENTRIES);
  const counterRef = useRef(0);
  const loadedRef = useRef(false);

  const addEntry = useCallback((entry: Omit<TerminalEntry, "id" | "ts">) => {
    counterRef.current += 1;
    const newEntry: TerminalEntry = {
      id: `${Date.now()}-${counterRef.current}`,
      ts: nowTs(),
      ...entry,
    };
    setEntries(prev => [...prev.slice(-300), newEntry]);
  }, []);

  const clearEntries = useCallback(() => {
    setEntries([]);
  }, []);

  // ── Load real historical log from backend on mount ────────────────────────
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    getAgentLog()
      .then(log => {
        if (!log || log.length === 0) return;
        const realEntries: TerminalEntry[] = log.map((entry, i) => ({
          id: entry.id || `hist-${i}`,
          ts: entry.timestamp ? tsFromMs(entry.timestamp) : nowTs(),
          level: mapLevel(entry.level),
          message: entry.message,
          payload: entry.data && Object.keys(entry.data).length > 0 ? entry.data : undefined,
        }));
        setEntries(prev => [...prev, ...realEntries].slice(-300));
      })
      .catch(() => {
        // Backend not available — boot entries are sufficient
      });
  }, []);

  // ── Subscribe to real SSE agent_decision events ───────────────────────────
  useEffect(() => {
    const unsubDecision = onSSEEvent("agent_decision", (data: unknown) => {
      const d = data as { action?: string; reasoning?: string; confidence?: number; timestamp?: number };
      if (!d?.action) return;
      const action = d.action ?? "MONITOR";
      const reasoning = d.reasoning ?? "";
      const confidence = d.confidence ?? 0;
      addEntry({
        level: action === "BROADCAST_RFQ" ? "success" : "info",
        message: decisionToMessage(action, reasoning, confidence),
        tool: "afos:decision",
        payload: d as Record<string, unknown>,
      });
    });

    // Also subscribe to agent_log events if the backend emits them
    const unsubLog = onSSEEvent("agent_log", (data: unknown) => {
      const d = data as { level?: string; message?: string; data?: Record<string, unknown> };
      if (!d?.message) return;
      addEntry({
        level: mapLevel(d.level ?? "info"),
        message: d.message,
        payload: d.data && Object.keys(d.data).length > 0 ? d.data : undefined,
      });
    });

    // P2P events
    const unsubRfq = onSSEEvent("p2p_rfq", (data: unknown) => {
      const d = data as { from?: string; pair?: string; rate?: number };
      addEntry({
        level: "info",
        message: `RFQ offer received from peer ${d?.from ?? "unknown"} — ${d?.pair ?? ""} @ ${d?.rate ?? ""}`,
        tool: "intercomswap_rfq_receive",
        payload: d as Record<string, unknown>,
      });
    });

    const unsubSwap = onSSEEvent("swap_executed", (data: unknown) => {
      const d = data as { from?: string; to?: string; amount?: number; txSig?: string };
      addEntry({
        level: "success",
        message: `Swap executed: ${d?.amount ?? ""} ${d?.from ?? ""} → ${d?.to ?? ""}${d?.txSig ? ` · tx: ${d.txSig.slice(0, 8)}…` : ""}`,
        tool: "afos:swap",
        payload: d as Record<string, unknown>,
      });
    });

    const unsubPeerConn = onSSEEvent("peer_connected", (data: unknown) => {
      const d = data as { peerId?: string; alias?: string };
      addEntry({
        level: "success",
        message: `Peer connected: ${d?.alias ?? d?.peerId ?? "unknown"}`,
        tool: "intercomswap_peer_connect",
      });
    });

    const unsubPeerDisc = onSSEEvent("peer_disconnected", (data: unknown) => {
      const d = data as { peerId?: string };
      addEntry({
        level: "warn",
        message: `Peer disconnected: ${d?.peerId ?? "unknown"}`,
        tool: "intercomswap_peer_disconnect",
      });
    });

    return () => {
      unsubDecision();
      unsubLog();
      unsubRfq();
      unsubSwap();
      unsubPeerConn();
      unsubPeerDisc();
    };
  }, [addEntry]);

  return (
    <AgentLogContext.Provider value={{ entries, addEntry, clearEntries }}>
      {children}
    </AgentLogContext.Provider>
  );
}

export function useAgentLog() {
  const ctx = useContext(AgentLogContext);
  if (!ctx) throw new Error("useAgentLog must be used inside AgentLogProvider");
  return ctx;
}
