/**
 * AgentLogContext — shared log state for AFOS
 * Allows Overview pipeline, Swaps page, and Terminal to share the same log stream.
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";

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

const BOOT_ENTRIES: TerminalEntry[] = [
  {
    id: "boot-0", ts: "00:00:00.000", level: "info",
    message: "AFOS v0.1.0 — Agentic Financial Operating System",
  },
  {
    id: "boot-1", ts: "00:00:00.012", level: "info",
    message: "OpenClaw agent runtime initialising…", tool: "openclaw:init",
  },
  {
    id: "boot-2", ts: "00:00:00.088", level: "success",
    message: "OpenClaw ready — model: gpt-4o-mini, skills: 3 loaded", tool: "openclaw:init",
    payload: { model: "gpt-4o-mini", skills: ["intercomswap_rfq", "intercomswap_escrow", "intercomswap_ln"], version: "0.3.1" },
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
    message: "Agent online — ready for commands", tool: "openclaw:ready",
  },
];

const LIVE_POOL: Omit<TerminalEntry, "id" | "ts">[] = [
  { level: "info", message: "Heartbeat — peer 3f8a…c12d alive (42ms)", tool: "intercomswap_peer_ping",
    payload: { peer_id: "3f8a…c12d", latency_ms: 42, status: "alive" } },
  { level: "info", message: "RFQ offer received from peer 3f8a…c12d", tool: "intercomswap_rfq_receive",
    payload: { from: "3f8a…c12d", pair: "BTC/USDT", rate: 96420, min_btc: 0.001, max_btc: 0.5, expires_in_s: 30 } },
  { level: "success", message: "Quote accepted: 0.001 BTC → 96.42 USDT", tool: "intercomswap_quote_accept",
    payload: { btc_amount: 0.001, usdt_amount: 96.42, rate: 96420, fee_pct: 0.1, peer: "3f8a…c12d" } },
  { level: "info", message: "Monitoring escrow PDA 7xKp…9mNz", tool: "intercomswap_escrow_watch",
    payload: { pda: "7xKp9mNz", program: "IntercomSwapEscrow", state: "locked", timeout_slot: 882400 } },
  { level: "warn", message: "Peer 9a2b…ff01 slow response (1.8s)", tool: "intercomswap_peer_probe",
    payload: { peer_id: "9a2b…ff01", latency_ms: 1800, threshold_ms: 500 } },
  { level: "success", message: "LN channel balanced — local: 0.08 BTC", tool: "intercomswap_ln_getinfo",
    payload: { local_balance_sat: 8000000, remote_balance_sat: 14200000 } },
  { level: "info", message: "svc_announce broadcast sent", tool: "intercomswap_svc_announce",
    payload: { channel: "0000intercomswapbtcusdt", pairs: ["BTC/USDT", "SOL/USDT"], liquidity_btc: 0.142 } },
  { level: "success", message: "Escrow claimed — preimage revealed", tool: "intercomswap_escrow_claim",
    payload: { pda: "7xKp…9mNz", preimage: "a3f8c1…d92b", tx_sig: "5Kj2…Xm9p", settled_usdt: 96.32 } },
  { level: "debug", message: "openclaw:parse — intent: swap, confidence: 0.97", tool: "openclaw:parse",
    payload: { intent: "swap", from: "BTC", to: "USDT", amount: 0.01, confidence: 0.97 } },
  { level: "info", message: "ETH HTLC contract deployed at 0x3f2…a91b", tool: "intercomswap_eth_htlc",
    payload: { contract: "0x3f2a91b", hashlock: "0xd8f3…", timelock: 1772100000, value_eth: 0.05 } },
];

export function AgentLogProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<TerminalEntry[]>(BOOT_ENTRIES);
  const counterRef = useRef(0);

  const addEntry = useCallback((entry: Omit<TerminalEntry, "id" | "ts">) => {
    counterRef.current += 1;
    const newEntry: TerminalEntry = {
      id: `${Date.now()}-${counterRef.current}`,
      ts: nowTs(),
      ...entry,
    };
    setEntries(prev => [...prev.slice(-200), newEntry]);
  }, []);

  const clearEntries = useCallback(() => {
    setEntries([]);
  }, []);

  // Live background log stream
  useEffect(() => {
    const interval = setInterval(() => {
      const entry = LIVE_POOL[Math.floor(Math.random() * LIVE_POOL.length)];
      addEntry(entry);
    }, 3800);
    return () => clearInterval(interval);
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
