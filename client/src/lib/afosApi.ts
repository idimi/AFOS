/**
 * AFOS API Service v3 — Multi-Chain
 * All requests go through the Manus Express server proxy at /api/afos/*
 * The proxy forwards them server-side to http://141.253.123.101:4000
 * This avoids the browser mixed-content block (HTTPS frontend → HTTP Oracle VM)
 *
 * Supported assets:
 *   Solana:   SOL, USDT (SPL), USDC (SPL)
 *   Ethereum: ETH, USDT (ERC-20), USDC (ERC-20)
 *   Bitcoin:  BTC
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

// ─── Chain / Asset constants ──────────────────────────────────────────────────

export type SupportedChain = 'solana' | 'ethereum' | 'bitcoin';

export interface AssetDefinition {
  symbol: string;
  chain: SupportedChain;
  /** Human-readable chain label */
  chainLabel: string;
  /** Contract / mint address — null for native assets */
  address: string | null;
  decimals: number;
  /** Whether this is a stablecoin pegged to $1.00 */
  isStable: boolean;
}

/** Canonical multi-chain asset registry */
export const ASSET_REGISTRY: AssetDefinition[] = [
  { symbol: 'SOL',       chain: 'solana',   chainLabel: 'Solana',   address: null,                                         decimals: 9,  isStable: false },
  { symbol: 'USDT',      chain: 'solana',   chainLabel: 'Solana',   address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6,  isStable: true  },
  { symbol: 'USDC',      chain: 'solana',   chainLabel: 'Solana',   address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6,  isStable: true  },
  { symbol: 'ETH',       chain: 'ethereum', chainLabel: 'Ethereum', address: null,                                         decimals: 18, isStable: false },
  { symbol: 'USDT',      chain: 'ethereum', chainLabel: 'Ethereum', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6,  isStable: true  },
  { symbol: 'USDC',      chain: 'ethereum', chainLabel: 'Ethereum', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6,  isStable: true  },
  { symbol: 'BTC',       chain: 'bitcoin',  chainLabel: 'Bitcoin',  address: null,                                         decimals: 8,  isStable: false  },
];

/** Look up an asset definition by symbol + chain */
export function getAssetDef(symbol: string, chain: SupportedChain): AssetDefinition | undefined {
  return ASSET_REGISTRY.find(a => a.symbol === symbol && a.chain === chain);
}

/** All unique symbols across all chains */
export const ALL_SYMBOLS = Array.from(new Set(ASSET_REGISTRY.map(a => a.symbol)));

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TokenPrice {
  usd: number;
  change24h: number;
  volume24h: number;
}

export interface SwapQuote {
  fromToken: string;
  fromChain: SupportedChain;
  toToken: string;
  toChain: SupportedChain;
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
  fromChain?: SupportedChain;
  toToken: string;
  toChain?: SupportedChain;
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
  /** Per-chain volume breakdown (may be absent on older Oracle VM versions) */
  byChain?: {
    solana?: { volumeUsd: number; swaps: number };
    ethereum?: { volumeUsd: number; swaps: number };
    bitcoin?: { volumeUsd: number; swaps: number };
  };
}

export interface WalletAsset {
  asset: string;
  /** e.g. "Solana", "Ethereum · 0x1234...abcd", "Bitcoin" */
  network: string;
  chain: SupportedChain;
  balance: string;
  usd: string;
  address: string | null;
  live: boolean;
}

export interface WalletData {
  wallets: WalletAsset[];
  totalUsd: number;
  note?: string;
  nodeKey: string | null;
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
          const raw = JSON.parse(e.data);
          // Normalise prices SSE event — always include USDC and USDT at $1.00
          const data = type === 'prices' ? normalisePricesEvent(raw) : raw;
          const handlers = sseHandlers.get(type);
          if (handlers) handlers.forEach(h => h(data));
        } catch (_) {}
      });
    }
  } catch (_) {
    sseConnected = false;
  }
}

/** Ensure USDC and USDT are always present in prices SSE events */
function normalisePricesEvent(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const event = raw as Record<string, unknown>;
  const prices = (event.prices ?? {}) as Record<string, unknown>;
  if (!prices.USDC) prices.USDC = { usd: 1, change24h: 0, volume24h: 0 };
  if (!prices.USDT) prices.USDT = { usd: 1, change24h: 0, volume24h: 0 };
  return { ...event, prices };
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

/**
 * GET /api/prices
 * Returns prices for all 7 supported assets.
 * USDC and USDT are always $1.00 (stablecoins) — injected if Oracle VM omits them.
 */
export async function getPrices(): Promise<Record<string, TokenPrice>> {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/prices`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const prices: Record<string, TokenPrice> = data.prices ?? {};
  // Stablecoins are always $1.00 — inject them if the Oracle VM omits them
  if (!prices.USDC) prices.USDC = { usd: 1, change24h: 0, volume24h: 0 };
  if (!prices.USDT) prices.USDT = { usd: 1, change24h: 0, volume24h: 0 };
  return prices;
}

/**
 * GET /api/quote
 * Fetch a swap quote from the Oracle VM.
 * Includes fromChain/toChain for multi-chain routing context.
 */
export async function getSwapQuote(
  from: string,
  to: string,
  amount: string,
  fromChain?: SupportedChain,
  toChain?: SupportedChain
): Promise<SwapQuote> {
  const params = new URLSearchParams({ from, to, amount });
  if (fromChain) params.set('fromChain', fromChain);
  if (toChain) params.set('toChain', toChain);
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/quote?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return {
    ...data.quote,
    fromChain: data.quote.fromChain ?? fromChain ?? 'solana',
    toChain: data.quote.toChain ?? toChain ?? 'solana',
  };
}

/**
 * POST /api/rfq
 * Submit a Request-for-Quote to the P2P network.
 * Now includes fromChain/toChain for cross-chain routing.
 */
export async function submitRfq(
  fromToken: string,
  toToken: string,
  amount: number,
  fromChain: SupportedChain = 'solana',
  toChain: SupportedChain = 'solana',
  preferredPeer?: string // optional: rfqId of a specific P2P peer to target directly
): Promise<{ success: boolean; result: RfqResult }> {
  const res = await fetchWithTimeout(
    `${BACKEND_URL}/api/rfq`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromToken, toToken, amount, fromChain, toChain, preferredPeer }),
    },
    20000
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return {
    ...data,
    result: {
      ...data.result,
      fromChain: data.result?.fromChain ?? fromChain,
      toChain: data.result?.toChain ?? toChain,
    },
  };
}

/**
 * POST /api/swap/execute
 * Execute a confirmed swap.
 * Passes chain context and wallet address per chain.
 */
export async function executeSwap(
  rfqId: string,
  walletAddress?: string,
  chain?: SupportedChain
): Promise<unknown> {
  const res = await fetchWithTimeout(
    `${BACKEND_URL}/api/swap/execute`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rfqId, walletAddress, chain: chain ?? 'solana' }),
    },
    15000
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * GET /api/agent/status
 */
export async function getAgentStatus(): Promise<AgentStatus> {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/agent/status`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data;
}

/**
 * GET /api/agent/log
 */
export async function getAgentLog(): Promise<AgentLogEntry[]> {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/agent/log`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.log || [];
}

/**
 * GET /api/stats
 * Returns aggregate stats + per-chain breakdown if available.
 */
export async function getStats(): Promise<BackendStats> {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/stats`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const s = data.stats ?? {};
  // Defensively coerce all numeric fields — Oracle VM may return null/string
  return {
    ...s,
    totalVolumeUsd: Number(s.totalVolumeUsd) || 0,
    totalFeesUsd:   Number(s.totalFeesUsd)   || 0,
    totalSwaps:     Number(s.totalSwaps)     || 0,
    p2pSwaps:       Number(s.p2pSwaps)       || 0,
    dexSwaps:       Number(s.dexSwaps)       || 0,
    p2pRatio:       Number(s.p2pRatio)       || 0,
    activePeers:    Number(s.activePeers)    || 0,
    uptimeMs:       Number(s.uptimeMs)       || 0,
    pendingRfqs:    Number(s.pendingRfqs)    || 0,
  };
}

/**
 * GET /api/swaps
 * Returns pending and completed swaps.
 * Normalises each swap to include chain context.
 */
export async function getSwaps(): Promise<{ pending: RfqResult[]; completed: RfqResult[] }> {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/swaps`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const normalise = (swaps: RfqResult[]): RfqResult[] =>
    swaps.map(s => ({
      ...s,
      // Defensively coerce numeric fields — Oracle VM may return null/string
      inAmount:  typeof s.inAmount  === 'number' ? s.inAmount  : parseFloat(String(s.inAmount  ?? 0)) || 0,
      outAmount: typeof s.outAmount === 'number' ? s.outAmount : parseFloat(String(s.outAmount ?? 0)) || 0,
      rate:      typeof s.rate      === 'number' ? s.rate      : parseFloat(String(s.rate      ?? 0)) || 0,
      fromChain: s.fromChain ?? inferChain(s.fromToken),
      toChain:   s.toChain   ?? inferChain(s.toToken),
    }));
  return {
    pending: normalise(data.pending || []),
    completed: normalise(data.completed || []),
  };
}

/**
 * GET /api/wallet
 * Returns Oracle VM node wallet balances for all 7 assets across 3 chains.
 * Normalises each asset to include chain field derived from the `network` field.
 */
export async function getWallet(): Promise<WalletData> {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/wallet`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const wallets: WalletAsset[] = (data.wallets || []).map((w: WalletAsset) => ({
    ...w,
    // Derive chain from network label if chain field is absent
    chain: w.chain ?? inferChainFromNetwork(w.network) ?? inferChain(w.asset),
  }));
  return { ...data, wallets };
}

export function getBackendUrl(): string {
  return BACKEND_URL;
}

/**
 * Merge Oracle VM wallet response with the full ASSET_REGISTRY.
 * Any asset not returned by the Oracle VM is shown with 0 balance and live=false.
 * This ensures all 7 supported assets are always visible in the UI.
 */
export function mergeWithAllAssets(wallets: WalletAsset[]): WalletAsset[] {
  const result: WalletAsset[] = [];
  for (const def of ASSET_REGISTRY) {
    const existing = wallets.find(
      w => w.asset.toUpperCase() === def.symbol.toUpperCase() && w.chain === def.chain
    );
    if (existing) {
      result.push(existing);
    } else {
      result.push({
        asset:   def.symbol,
        network: def.chainLabel,
        chain:   def.chain,
        balance: def.decimals === 8 ? '0.00000000' : def.decimals === 18 ? '0.000000' : '0.000000',
        usd:     '$0',
        address: null,
        live:    false,
      });
    }
  }
  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Infer the most likely chain for a given token symbol.
 * Used to normalise legacy Oracle VM responses that omit chain context.
 */
export function inferChain(symbol: string): SupportedChain {
  const upper = symbol?.toUpperCase();
  if (upper === 'ETH') return 'ethereum';
  if (upper === 'BTC') return 'bitcoin';
  return 'solana'; // SOL, USDT, USDC default to Solana
}

/**
 * Infer chain from the `network` label returned by the Oracle VM.
 * e.g. "Solana" → 'solana', "Ethereum" → 'ethereum', "Bitcoin" → 'bitcoin'
 */
export function inferChainFromNetwork(network: string | undefined): SupportedChain | null {
  if (!network) return null;
  const lower = network.toLowerCase();
  if (lower.includes('ethereum')) return 'ethereum';
  if (lower.includes('bitcoin')) return 'bitcoin';
  if (lower.includes('solana')) return 'solana';
  return null;
}
