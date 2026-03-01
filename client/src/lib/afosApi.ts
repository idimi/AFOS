/**
 * AFOS API Service v2
 * All requests go through the Manus Express server proxy at /api/afos/*
 * The proxy forwards them server-side to http://141.253.123.101:4000
 * This avoids the browser mixed-content block (HTTPS frontend → HTTP Oracle VM)
 */

// Use relative URL so it works on both dev (localhost:3000) and production (manus.space)
export const BACKEND_URL = '/api/afos';
const TIMEOUT_MS = 12000;

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TokenPrice {
  usd: number;
  change24h: number;
  volume24h: number;
}

export interface SwapQuote {
  fromToken: string;
  toToken: string;
  inAmount: number;
  outAmount: number;
  rate: number;
  priceImpact: number;
  platformFeeBps: number;
  feeAmount: number;
  feeUsd: number;
  route: string;
}

export interface RfqResult {
  rfqId: string;
  route: 'p2p' | 'dex';
  fromToken: string;
  toToken: string;
  inAmount: number;
  outAmount: number;
  rate: number;
  platformFeeBps: number;
  feeUsd: number;
  p2pQuotes: number;
  dexRoute: string;
  timestamp: number;
}

export interface AgentLogEntry {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  data: Record<string, unknown>;
}

export interface AgentDecision {
  action: 'BROADCAST_RFQ' | 'MONITOR' | 'WAIT';
  reasoning: string;
  confidence: number;
  timestamp: number;
}

export interface BackendStats {
  totalVolumeUsd: number;
  totalFeesUsd: number;
  totalSwaps: number;
  p2pSwaps: number;
  dexSwaps: number;
  p2pRatio: number;
  activePeers: number;
  uptimeMs: number;
  pendingRfqs: number;
}

export interface AgentStatus {
  status: string;
  p2pNodeKey: string | null;
  activePeers: number;
  lastDecision: AgentDecision | null;
  uptime: number;
  stats: BackendStats;
}

// ─── SSE Stream ───────────────────────────────────────────────────────────────
// SSE uses the same proxy path: /api/afos/api/stream

export type SSEEventType =
  | 'init'
  | 'prices'
  | 'agent_log'
  | 'agent_decision'
  | 'peer_connected'
  | 'peer_disconnected'
  | 'p2p_rfq'
  | 'p2p_rfq_sent'
  | 'p2p_quote'
  | 'p2p_quote_accept'
  | 'rfq_result'
  | 'swap_executed';

export type SSEHandler = (data: unknown) => void;

let sseSource: EventSource | null = null;
const sseHandlers = new Map<SSEEventType, Set<SSEHandler>>();
let sseConnected = false;
let sseReconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connectSSE() {
  if (sseSource) {
    sseSource.close();
    sseSource = null;
  }

  try {
    // SSE through the proxy — same origin, no mixed-content issue
    sseSource = new EventSource(`${BACKEND_URL}/api/stream`);

    sseSource.onopen = () => {
      sseConnected = true;
      if (sseReconnectTimer) { clearTimeout(sseReconnectTimer); sseReconnectTimer = null; }
    };

    sseSource.onerror = () => {
      sseConnected = false;
      sseSource?.close();
      sseSource = null;
      // Reconnect after 5s
      if (!sseReconnectTimer) {
        sseReconnectTimer = setTimeout(() => { sseReconnectTimer = null; connectSSE(); }, 5000);
      }
    };

    // Register event handlers for all known event types
    const eventTypes: SSEEventType[] = [
      'init', 'prices', 'agent_log', 'agent_decision',
      'peer_connected', 'peer_disconnected',
      'p2p_rfq', 'p2p_rfq_sent', 'p2p_quote', 'p2p_quote_accept',
      'rfq_result', 'swap_executed',
    ];

    for (const type of eventTypes) {
      sseSource.addEventListener(type, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          const handlers = sseHandlers.get(type);
          if (handlers) handlers.forEach(h => h(data));
        } catch (_) {}
      });
    }
  } catch (_) {
    sseConnected = false;
  }
}

export function onSSEEvent(event: SSEEventType, handler: SSEHandler): () => void {
  if (!sseHandlers.has(event)) sseHandlers.set(event, new Set());
  sseHandlers.get(event)!.add(handler);

  // Start SSE connection if not already started
  if (!sseSource) connectSSE();

  // Return unsubscribe function
  return () => {
    sseHandlers.get(event)?.delete(handler);
  };
}

export function isSSEConnected(): boolean {
  return sseConnected;
}

// ─── REST API ─────────────────────────────────────────────────────────────────

export async function getPrices(): Promise<Record<string, TokenPrice>> {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/prices`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.prices;
}

export async function getSwapQuote(
  from: string,
  to: string,
  amount: string
): Promise<SwapQuote> {
  const params = new URLSearchParams({ from, to, amount });
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/quote?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.quote;
}

export async function submitRfq(
  fromToken: string,
  toToken: string,
  amount: number
): Promise<{ success: boolean; result: RfqResult }> {
  const res = await fetchWithTimeout(
    `${BACKEND_URL}/api/rfq`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromToken, toToken, amount }),
    },
    20000
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function executeSwap(rfqId: string, walletAddress?: string): Promise<unknown> {
  const res = await fetchWithTimeout(
    `${BACKEND_URL}/api/swap/execute`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rfqId, walletAddress }),
    },
    15000
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getAgentStatus(): Promise<AgentStatus> {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/agent/status`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data;
}

export async function getAgentLog(): Promise<AgentLogEntry[]> {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/agent/log`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.log || [];
}

export async function getStats(): Promise<BackendStats> {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/stats`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.stats;
}

export async function getSwaps(): Promise<{ pending: RfqResult[]; completed: RfqResult[] }> {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/swaps`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return { pending: data.pending || [], completed: data.completed || [] };
}

export function getBackendUrl(): string {
  return BACKEND_URL;
}
