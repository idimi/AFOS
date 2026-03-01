/**
 * AFOS API Service
 * Connects the frontend dashboard to the AFOS backend API on Oracle VM
 *
 * Backend URL: http://141.253.123.101:4000
 * (Port 4000 must be open in Oracle Cloud Security List)
 *
 * Falls back to mock data if backend is unreachable.
 */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://141.253.123.101:4000';
const TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(id);
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TokenPrice {
  usd: number;
  change24h: number;
  volume24h: number;
  marketCap?: number;
}

export interface PricesResponse {
  success: boolean;
  prices: Record<string, TokenPrice>;
  timestamp: number;
  source?: string;
}

export interface SwapQuote {
  from: string;
  to: string;
  inputAmount: number;
  outputAmount: number;
  exchangeRate: number;
  platformFee: {
    bps: number;
    percentage: number;
    amount: number;
    token: string;
  };
  slippageBps: number;
  priceImpact: number;
  route: string[];
  provider: string;
  network: string;
}

export interface QuoteResponse {
  success: boolean;
  quote: SwapQuote;
  timestamp: number;
}

export interface AgentActivity {
  id: number;
  type: string;
  message: string;
  timestamp: number;
  status: 'active' | 'completed' | 'info' | 'success' | 'error';
}

export interface AgentActivityResponse {
  success: boolean;
  activities: AgentActivity[];
  agentStatus: string;
  p2pPeers: number;
  timestamp: number;
}

export interface PlatformStats {
  totalSwaps: number;
  totalVolume: number;
  totalFees: number;
  p2pSwaps: number;
  dexSwaps: number;
  p2pRatio: number;
  activePeers: number;
  supportedChains: string[];
  btcPrice?: number;
  solPrice?: number;
}

export interface StatsResponse {
  success: boolean;
  stats: PlatformStats;
  timestamp: number;
}

// ─── Mock Data (fallback when backend is unreachable) ─────────────────────────

const MOCK_PRICES: PricesResponse = {
  success: true,
  prices: {
    BTC: { usd: 67090, change24h: 1.23, volume24h: 28400000000, marketCap: 1320000000000 },
    ETH: { usd: 3584, change24h: -0.45, volume24h: 12300000000, marketCap: 430000000000 },
    SOL: { usd: 87.2, change24h: 2.87, volume24h: 2100000000, marketCap: 40000000000 },
    USDT: { usd: 1.0, change24h: 0.01, volume24h: 45000000000, marketCap: 95000000000 },
  },
  timestamp: Date.now(),
  source: 'mock',
};

const MOCK_STATS: StatsResponse = {
  success: true,
  stats: {
    totalSwaps: 1247,
    totalVolume: 2840000,
    totalFees: 5680,
    p2pSwaps: 124,
    dexSwaps: 1123,
    p2pRatio: 0.0995,
    activePeers: 5,
    supportedChains: ['solana', 'ethereum', 'bitcoin'],
    btcPrice: 67090,
    solPrice: 87.2,
  },
  timestamp: Date.now(),
};

const MOCK_ACTIVITIES: AgentActivityResponse = {
  success: true,
  activities: [
    { id: 1, type: 'rfq_broadcast', message: 'Broadcasting RFQ: SOL→USDT 5.0 SOL', timestamp: Date.now() - 120000, status: 'completed' },
    { id: 2, type: 'p2p_timeout', message: 'P2P timeout (30s) — no peer responded', timestamp: Date.now() - 90000, status: 'info' },
    { id: 3, type: 'dex_fallback', message: 'Routing via Jupiter: SOL→USDT @ $87.20', timestamp: Date.now() - 85000, status: 'completed' },
    { id: 4, type: 'fee_collected', message: 'Platform fee collected: 0.01 SOL (0.2%)', timestamp: Date.now() - 84000, status: 'success' },
    { id: 5, type: 'price_monitor', message: `Monitoring BTC/USDT — current: $67,090`, timestamp: Date.now() - 30000, status: 'active' },
  ],
  agentStatus: 'running',
  p2pPeers: 5,
  timestamp: Date.now(),
};

// ─── API Functions ────────────────────────────────────────────────────────────

let backendAvailable: boolean | null = null;
let lastBackendCheck = 0;

async function checkBackendAvailability(): Promise<boolean> {
  const now = Date.now();
  if (backendAvailable !== null && now - lastBackendCheck < 30000) {
    return backendAvailable;
  }
  try {
    const res = await fetchWithTimeout(`${BACKEND_URL}/health`, {}, 3000);
    backendAvailable = res.ok;
    lastBackendCheck = now;
    return backendAvailable;
  } catch {
    backendAvailable = false;
    lastBackendCheck = now;
    return false;
  }
}

export async function getPrices(): Promise<PricesResponse> {
  const available = await checkBackendAvailability();
  if (!available) return MOCK_PRICES;

  try {
    const res = await fetchWithTimeout(`${BACKEND_URL}/api/prices`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return MOCK_PRICES;
  }
}

export async function getPrice(symbol: string): Promise<TokenPrice | null> {
  const available = await checkBackendAvailability();
  if (!available) return MOCK_PRICES.prices[symbol.toUpperCase()] || null;

  try {
    const res = await fetchWithTimeout(`${BACKEND_URL}/api/price/${symbol}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      usd: data.price,
      change24h: data.change24h,
      volume24h: data.volume24h,
    };
  } catch {
    return MOCK_PRICES.prices[symbol.toUpperCase()] || null;
  }
}

export async function getSwapQuote(
  from: string,
  to: string,
  amount: string,
  slippage = '0.5'
): Promise<QuoteResponse | null> {
  const available = await checkBackendAvailability();
  if (!available) {
    // Return mock quote
    const rate = from.toUpperCase() === 'SOL' ? 87.2 : 0.01148;
    const inputAmount = parseFloat(amount);
    return {
      success: true,
      quote: {
        from: from.toUpperCase(),
        to: to.toUpperCase(),
        inputAmount,
        outputAmount: inputAmount * rate * 0.998, // subtract 0.2% fee
        exchangeRate: rate,
        platformFee: { bps: 20, percentage: 0.2, amount: inputAmount * 0.002, token: from.toUpperCase() },
        slippageBps: 50,
        priceImpact: 0,
        route: ['Jupiter (mock)'],
        provider: 'jupiter',
        network: 'solana',
      },
      timestamp: Date.now(),
    };
  }

  try {
    const params = new URLSearchParams({ from, to, amount, slippage });
    const res = await fetchWithTimeout(`${BACKEND_URL}/api/quote?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

export async function getAgentActivity(): Promise<AgentActivityResponse> {
  const available = await checkBackendAvailability();
  if (!available) return MOCK_ACTIVITIES;

  try {
    const res = await fetchWithTimeout(`${BACKEND_URL}/api/agent/activity`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return MOCK_ACTIVITIES;
  }
}

export async function getPlatformStats(): Promise<StatsResponse> {
  const available = await checkBackendAvailability();
  if (!available) return MOCK_STATS;

  try {
    const res = await fetchWithTimeout(`${BACKEND_URL}/api/stats`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return MOCK_STATS;
  }
}

export async function submitRfq(from: string, to: string, amount: string, walletAddress?: string) {
  const available = await checkBackendAvailability();
  if (!available) {
    // Simulate RFQ response
    await new Promise(r => setTimeout(r, 1000));
    return {
      success: true,
      rfqId: `rfq_${Date.now()}`,
      route: 'dex_fallback',
      provider: 'jupiter',
      p2pTimeout: true,
      quote: {
        from: from.toUpperCase(),
        to: to.toUpperCase(),
        inputAmount: parseFloat(amount),
        outputAmount: parseFloat(amount) * 87.2 * 0.998,
        platformFee: '0.2%',
        route: ['Jupiter (mock)'],
      },
      message: 'No P2P peer found — routed via Jupiter DEX aggregator (demo mode)',
    };
  }

  try {
    const res = await fetchWithTimeout(`${BACKEND_URL}/api/rfq`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, amount, walletAddress }),
    }, 35000); // 35s timeout for P2P RFQ
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    throw err;
  }
}

export function isBackendAvailable(): boolean {
  return backendAvailable === true;
}

export function getBackendUrl(): string {
  return BACKEND_URL;
}
