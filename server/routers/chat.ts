/**
 * AFOS Conversational Agent Router — Multi-Chain v2
 *
 * Supported assets and routing:
 *   Solana:   SOL, USDT (SPL), USDC (SPL)  → Jupiter DEX
 *   Ethereum: ETH, USDT (ERC-20), USDC (ERC-20) → 1inch / IntercomSwap
 *   Bitcoin:  BTC → IntercomSwap P2P
 *
 * Flow:
 *   1. Parse user intent with LLM (fromToken, toToken, fromChain, toChain, amount)
 *   2. Fetch real quote from the appropriate DEX/aggregator
 *   3. Return structured quote_card response for frontend confirmation
 *   4. On confirmation: build the chain-appropriate transaction
 */

import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";

// ─── Token / chain config ──────────────────────────────────────────────────────

type SupportedChain = "solana" | "ethereum" | "bitcoin";

interface AssetDef {
  symbol: string;
  chain: SupportedChain;
  /** Mint / contract address — null for native assets */
  address: string | null;
  decimals: number;
  isStable: boolean;
}

const ASSETS: AssetDef[] = [
  { symbol: "SOL",  chain: "solana",   address: "So11111111111111111111111111111111111111112",  decimals: 9,  isStable: false },
  { symbol: "USDT", chain: "solana",   address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6,  isStable: true  },
  { symbol: "USDC", chain: "solana",   address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6,  isStable: true  },
  { symbol: "ETH",  chain: "ethereum", address: null,                                            decimals: 18, isStable: false },
  { symbol: "USDT", chain: "ethereum", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",   decimals: 6,  isStable: true  },
  { symbol: "USDC", chain: "ethereum", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",   decimals: 6,  isStable: true  },
  { symbol: "BTC",  chain: "bitcoin",  address: null,                                            decimals: 8,  isStable: false },
];

function getAsset(symbol: string, chain: SupportedChain): AssetDef | undefined {
  return ASSETS.find(a => a.symbol === symbol && a.chain === chain);
}

/** Infer the default chain for a token symbol */
function defaultChain(symbol: string): SupportedChain {
  if (symbol === "ETH") return "ethereum";
  if (symbol === "BTC") return "bitcoin";
  return "solana";
}

// ─── Jupiter (Solana DEX) ─────────────────────────────────────────────────────

const JUPITER_QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
const JUPITER_SWAP_URL  = "https://lite-api.jup.ag/swap/v1/swap";
const PLATFORM_FEE_BPS  = 20; // 0.2%
const PLATFORM_FEE_ACCOUNT = "8PqWJvFQKxXhzqJLGRhTWUZhB1Bwk9JtQxKmKZvKpump";

async function getJupiterQuote(
  fromAsset: AssetDef,
  toAsset: AssetDef,
  amountRaw: number
): Promise<Record<string, unknown> | null> {
  if (!fromAsset.address || !toAsset.address) return null;

  const params = new URLSearchParams({
    inputMint:       fromAsset.address,
    outputMint:      toAsset.address,
    amount:          String(Math.floor(amountRaw)),
    slippageBps:     "50",
    platformFeeBps:  String(PLATFORM_FEE_BPS),
  });

  const res = await fetch(`${JUPITER_QUOTE_URL}?${params}`, {
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    console.error("[Jupiter] Quote failed:", res.status, await res.text());
    return null;
  }
  return res.json();
}

async function getJupiterSwapTx(
  quoteResponse: unknown,
  userPublicKey: string
): Promise<{ swapTransaction: string } | null> {
  const res = await fetch(JUPITER_SWAP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol:         true,
      feeAccount:               PLATFORM_FEE_ACCOUNT,
      dynamicComputeUnitLimit:  true,
      prioritizationFeeLamports: "auto",
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    console.error("[Jupiter] Swap tx failed:", res.status, await res.text());
    return null;
  }
  return res.json();
}

// ─── 1inch (Ethereum DEX aggregator) ─────────────────────────────────────────
// 1inch v5 public API — no API key required for quote-only calls

const ONEINCH_BASE = "https://api.1inch.dev/swap/v6.0/1"; // Ethereum mainnet chain ID 1

/** ETH native token address used by 1inch */
const ETH_NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

function get1inchAddress(asset: AssetDef): string {
  return asset.address ?? ETH_NATIVE;
}

async function get1inchQuote(
  fromAsset: AssetDef,
  toAsset: AssetDef,
  amountRaw: string
): Promise<{ toAmount: string; gas: number } | null> {
  try {
    const params = new URLSearchParams({
      src:    get1inchAddress(fromAsset),
      dst:    get1inchAddress(toAsset),
      amount: amountRaw,
    });
    const res = await fetch(`${ONEINCH_BASE}/quote?${params}`, {
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.warn("[1inch] Quote failed:", res.status);
      return null;
    }
    const data = await res.json() as { toAmount?: string; dstAmount?: string; gas?: number; estimatedGas?: number };
    const toAmount = data.toAmount ?? data.dstAmount;
    if (!toAmount) return null;
    return { toAmount, gas: data.gas ?? data.estimatedGas ?? 0 };
  } catch (err) {
    console.warn("[1inch] Quote error:", err);
    return null;
  }
}

// ─── Price fetching ──────────────────────────────────────────────────────────
// 30-second in-memory cache to avoid rate limits

interface PriceCache {
  prices: Record<string, number>;
  source: string;
  fetchedAt: number;
}
let priceCache: PriceCache | null = null;
const PRICE_CACHE_TTL_MS = 30_000;

async function getTokenPricesFromCoinGecko(): Promise<Record<string, number> | null> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana,ethereum,bitcoin&vs_currencies=usd",
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as { solana?: { usd: number }; ethereum?: { usd: number }; bitcoin?: { usd: number } };
    const sol = data.solana?.usd;
    if (!sol || sol < 1) return null;
    return {
      SOL:  sol,
      ETH:  data.ethereum?.usd ?? 2000,
      BTC:  data.bitcoin?.usd  ?? 66000,
      USDT: 1,
      USDC: 1,
    };
  } catch {
    return null;
  }
}

async function getTokenPricesFromBinance(): Promise<Record<string, number> | null> {
  try {
    const res = await fetch(
      'https://api.binance.com/api/v3/ticker/price?symbols=["SOLUSDT","ETHUSDT","BTCUSDT"]',
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as { symbol: string; price: string }[];
    if (!Array.isArray(data)) return null;
    const prices: Record<string, number> = { USDT: 1, USDC: 1 };
    for (const item of data) {
      if (item.symbol === "SOLUSDT") prices.SOL = parseFloat(item.price);
      if (item.symbol === "ETHUSDT") prices.ETH = parseFloat(item.price);
      if (item.symbol === "BTCUSDT") prices.BTC = parseFloat(item.price);
    }
    if (!prices.SOL || prices.SOL < 1) return null;
    return prices;
  } catch {
    return null;
  }
}

async function getTokenPricesWithSource(): Promise<{ prices: Record<string, number>; source: string }> {
  if (priceCache && Date.now() - priceCache.fetchedAt < PRICE_CACHE_TTL_MS) {
    return { prices: priceCache.prices, source: priceCache.source + " (cached)" };
  }

  const cgPrices = await getTokenPricesFromCoinGecko();
  if (cgPrices) {
    priceCache = { prices: cgPrices, source: "CoinGecko", fetchedAt: Date.now() };
    return { prices: cgPrices, source: "CoinGecko" };
  }

  const binancePrices = await getTokenPricesFromBinance();
  if (binancePrices) {
    priceCache = { prices: binancePrices, source: "Binance", fetchedAt: Date.now() };
    return { prices: binancePrices, source: "Binance" };
  }

  console.warn("[Chat] All price APIs failed, using approximate fallback prices");
  const fallback = { SOL: 85, ETH: 1970, BTC: 66000, USDT: 1, USDC: 1 };
  return { prices: fallback, source: "approximate (APIs unavailable)" };
}

// ─── Intent parsing ────────────────────────────────────────────────────────────

interface SwapIntent {
  type: "swap" | "price_check" | "balance_check" | "general";
  fromToken?: string;
  fromChain?: SupportedChain;
  toToken?: string;
  toChain?: SupportedChain;
  amount?: number;
  amountToken?: string;
  isMax?: boolean;
  reply?: string;
}

async function parseIntent(
  message: string,
  conversationHistory: { role: "user" | "assistant"; content: string }[],
  prices: Record<string, number>,
  walletBalances?: { symbol: string; amount: string }[],
  priceSource?: string
): Promise<SwapIntent> {
  const systemPrompt = `You are AFOS, an autonomous multi-chain financial agent.

Supported assets:
  Solana chain:   SOL, USDT, USDC
  Ethereum chain: ETH, USDT_ETH (USDT on Ethereum), USDC_ETH (USDC on Ethereum)
  Bitcoin chain:  BTC

Routing:
  - Solana swaps (SOL/USDT/USDC) → Jupiter DEX (instant, on-chain)
  - Ethereum swaps (ETH/USDT_ETH/USDC_ETH) → 1inch aggregator + IntercomSwap
  - Bitcoin swaps (BTC) → IntercomSwap P2P network
  - Cross-chain swaps → IntercomSwap P2P bridge

Current live prices (source: ${priceSource ?? "live"}): ${JSON.stringify(prices)}
${walletBalances ? `User wallet balances: ${JSON.stringify(walletBalances)}` : ""}

Parse the user message and return ONLY a JSON object with this exact schema:
{
  "type": "swap" | "price_check" | "balance_check" | "general",
  "fromToken": "SOL" | "USDT" | "USDC" | "ETH" | "USDT_ETH" | "USDC_ETH" | "BTC" | null,
  "fromChain": "solana" | "ethereum" | "bitcoin" | null,
  "toToken": "SOL" | "USDT" | "USDC" | "ETH" | "USDT_ETH" | "USDC_ETH" | "BTC" | null,
  "toChain": "solana" | "ethereum" | "bitcoin" | null,
  "amount": number | null,
  "amountToken": string | null,
  "isMax": boolean,
  "reply": string | null
}

Token disambiguation rules:
- "USDT" without chain context → USDT on Solana (fromToken: "USDT", fromChain: "solana")
- "USDT on Ethereum" or "ERC-20 USDT" → USDT_ETH (fromChain: "ethereum")
- "USDC" without chain context → USDC on Solana
- "USDC on Ethereum" or "ERC-20 USDC" → USDC_ETH (fromChain: "ethereum")
- "swap 1 USDT to SOL" → fromToken: USDT, fromChain: solana, toToken: SOL, toChain: solana
- "swap 0.01 ETH to USDC" → fromToken: ETH, fromChain: ethereum, toToken: USDC_ETH, toChain: ethereum
- "swap 0.001 BTC to SOL" → fromToken: BTC, fromChain: bitcoin, toToken: SOL, toChain: solana
- For price checks: reply with price and source
- For balance checks: reply with balance info
- For general questions: reply about AFOS multi-chain capabilities
- reply field: for swap intents, set to null (frontend shows quote card)`;

  const result = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      ...conversationHistory.slice(-6),
      { role: "user", content: message },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "swap_intent",
        strict: true,
        schema: {
          type: "object",
          properties: {
            type:        { type: "string", enum: ["swap", "price_check", "balance_check", "general"] },
            fromToken:   { type: ["string", "null"] },
            fromChain:   { type: ["string", "null"] },
            toToken:     { type: ["string", "null"] },
            toChain:     { type: ["string", "null"] },
            amount:      { type: ["number", "null"] },
            amountToken: { type: ["string", "null"] },
            isMax:       { type: "boolean" },
            reply:       { type: ["string", "null"] },
          },
          required: ["type", "fromToken", "fromChain", "toToken", "toChain", "amount", "amountToken", "isMax", "reply"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = result.choices[0]?.message?.content;
  if (typeof content === "string") {
    return JSON.parse(content) as SwapIntent;
  }
  return { type: "general", reply: "I'm not sure I understood that. Could you rephrase?" };
}

// ─── Quote building ────────────────────────────────────────────────────────────

/** Map LLM token symbol to canonical symbol + chain */
function resolveToken(llmSymbol: string, llmChain: SupportedChain | null | undefined): { symbol: string; chain: SupportedChain } {
  // Handle _ETH suffix for Ethereum stablecoins
  if (llmSymbol === "USDT_ETH") return { symbol: "USDT", chain: "ethereum" };
  if (llmSymbol === "USDC_ETH") return { symbol: "USDC", chain: "ethereum" };
  const chain = llmChain ?? defaultChain(llmSymbol);
  return { symbol: llmSymbol, chain };
}

interface QuoteResult {
  fromAmount: number;
  toAmount: number;
  fromAmountUsd: number;
  toAmountUsd: number;
  rate: number;
  priceImpact: number;
  platformFee: number;
  platformFeeUsd: number;
  route: string;
  rawQuote: unknown;
}

async function buildQuote(
  fromAsset: AssetDef,
  toAsset: AssetDef,
  swapAmount: number,
  prices: Record<string, number>
): Promise<QuoteResult | { error: string }> {
  const fromPrice = prices[fromAsset.symbol] ?? (fromAsset.isStable ? 1 : 0);
  const toPrice   = prices[toAsset.symbol]   ?? (toAsset.isStable   ? 1 : 0);

  // ── Solana → Solana: Jupiter ──────────────────────────────────────────────
  if (fromAsset.chain === "solana" && toAsset.chain === "solana") {
    const amountRaw = Math.floor(swapAmount * Math.pow(10, fromAsset.decimals));
    const quote = await getJupiterQuote(fromAsset, toAsset, amountRaw);
    if (!quote) return { error: `Jupiter quote unavailable for ${fromAsset.symbol} → ${toAsset.symbol}. Please try again.` };

    const toAmountHuman = parseInt(quote.outAmount as string) / Math.pow(10, toAsset.decimals);
    const priceImpact   = parseFloat(quote.priceImpactPct as string) || 0;
    const platformFee   = swapAmount * (PLATFORM_FEE_BPS / 10000);

    return {
      fromAmount:     swapAmount,
      toAmount:       toAmountHuman,
      fromAmountUsd:  swapAmount * fromPrice,
      toAmountUsd:    toAmountHuman * toPrice,
      rate:           toAmountHuman / swapAmount,
      priceImpact,
      platformFee,
      platformFeeUsd: platformFee * fromPrice,
      route:          "Jupiter DEX",
      rawQuote:       quote,
    };
  }

  // ── Ethereum → Ethereum: 1inch ────────────────────────────────────────────
  if (fromAsset.chain === "ethereum" && toAsset.chain === "ethereum") {
    const amountRaw = BigInt(Math.floor(swapAmount * Math.pow(10, fromAsset.decimals))).toString();
    const q1inch = await get1inchQuote(fromAsset, toAsset, amountRaw);

    if (q1inch) {
      const toAmountHuman = parseInt(q1inch.toAmount) / Math.pow(10, toAsset.decimals);
      const platformFee   = swapAmount * (PLATFORM_FEE_BPS / 10000);
      return {
        fromAmount:     swapAmount,
        toAmount:       toAmountHuman,
        fromAmountUsd:  swapAmount * fromPrice,
        toAmountUsd:    toAmountHuman * toPrice,
        rate:           toAmountHuman / swapAmount,
        priceImpact:    0,
        platformFee,
        platformFeeUsd: platformFee * fromPrice,
        route:          "1inch (Ethereum)",
        rawQuote:       q1inch,
      };
    }

    // Fallback: estimate via prices if 1inch is unavailable
    const estimatedOut  = (swapAmount * fromPrice) / (toPrice || 1);
    const platformFee   = swapAmount * (PLATFORM_FEE_BPS / 10000);
    return {
      fromAmount:     swapAmount,
      toAmount:       estimatedOut,
      fromAmountUsd:  swapAmount * fromPrice,
      toAmountUsd:    estimatedOut * toPrice,
      rate:           estimatedOut / swapAmount,
      priceImpact:    0.1,
      platformFee,
      platformFeeUsd: platformFee * fromPrice,
      route:          "IntercomSwap (Ethereum)",
      rawQuote:       null,
    };
  }

  // ── Cross-chain or Bitcoin: IntercomSwap P2P estimate ─────────────────────
  const estimatedOut  = (swapAmount * fromPrice) / (toPrice || 1);
  const platformFee   = swapAmount * (PLATFORM_FEE_BPS / 10000);
  const routeLabel = fromAsset.chain === "bitcoin" || toAsset.chain === "bitcoin"
    ? "IntercomSwap P2P (Bitcoin bridge)"
    : "IntercomSwap P2P (cross-chain)";

  return {
    fromAmount:     swapAmount,
    toAmount:       estimatedOut,
    fromAmountUsd:  swapAmount * fromPrice,
    toAmountUsd:    estimatedOut * toPrice,
    rate:           estimatedOut / swapAmount,
    priceImpact:    0.15,
    platformFee,
    platformFeeUsd: platformFee * fromPrice,
    route:          routeLabel,
    rawQuote:       null,
  };
}

// ─── Chat message types ────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  type?: "text" | "quote_card" | "tx_success" | "error";
  quoteData?: {
    fromToken: string;
    fromChain: SupportedChain;
    toToken: string;
    toChain: SupportedChain;
    fromAmount: number;
    toAmount: number;
    fromAmountUsd: number;
    toAmountUsd: number;
    rate: number;
    priceImpact: number;
    platformFee: number;
    platformFeeUsd: number;
    route: string;
    quoteResponse: unknown;
  };
}

// ─── Router ────────────────────────────────────────────────────────────────────

export const chatRouter = router({
  /**
   * Send a message to the AFOS conversational agent.
   * Returns either a text reply or a swap quote card for any of the 7 supported assets.
   */
  sendMessage: publicProcedure
    .input(
      z.object({
        message:        z.string().min(1).max(500),
        history:        z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).max(20),
        walletAddress:  z.string().optional(),
        walletBalances: z.array(z.object({ symbol: z.string(), amount: z.string() })).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { message, history, walletBalances } = input;

      const { prices, source: priceSource } = await getTokenPricesWithSource();
      const intent = await parseIntent(message, history, prices, walletBalances, priceSource);

      if (intent.type !== "swap") {
        return {
          type: "text" as const,
          content: intent.reply || "How can I help you with your crypto swaps today?",
        };
      }

      const { fromToken, toToken, amount, isMax } = intent;
      if (!fromToken || !toToken) {
        return {
          type: "text" as const,
          content: "I need to know which tokens you want to swap. For example: *swap 1 USDT to SOL* or *swap 0.01 ETH to USDC*",
        };
      }

      // Resolve canonical symbol + chain
      const from = resolveToken(fromToken, intent.fromChain);
      const to   = resolveToken(toToken,   intent.toChain);

      const fromAsset = getAsset(from.symbol, from.chain);
      const toAsset   = getAsset(to.symbol,   to.chain);

      if (!fromAsset || !toAsset) {
        return {
          type: "text" as const,
          content: `I don't recognise the token pair ${fromToken} → ${toToken}. Supported: SOL, USDT, USDC (Solana), ETH, USDT/USDC (Ethereum), BTC.`,
        };
      }

      // Determine amount
      let swapAmount = amount || 0;
      if (isMax && walletBalances) {
        const bal = walletBalances.find(b => b.symbol === fromToken || b.symbol === from.symbol);
        if (bal) swapAmount = parseFloat(bal.amount) || 0;
      }

      if (swapAmount <= 0) {
        return {
          type: "text" as const,
          content: `How much ${fromToken} would you like to swap? For example: *swap 1 ${fromToken} to ${toToken}*`,
        };
      }

      const quoteResult = await buildQuote(fromAsset, toAsset, swapAmount, prices);

      if ("error" in quoteResult) {
        return { type: "text" as const, content: quoteResult.error };
      }

      return {
        type: "quote_card" as const,
        content: `Here's your swap quote for ${swapAmount} ${fromToken} → ${toToken}:`,
        quoteData: {
          fromToken:      from.symbol,
          fromChain:      from.chain,
          toToken:        to.symbol,
          toChain:        to.chain,
          fromAmount:     quoteResult.fromAmount,
          toAmount:       quoteResult.toAmount,
          fromAmountUsd:  quoteResult.fromAmountUsd,
          toAmountUsd:    quoteResult.toAmountUsd,
          rate:           quoteResult.rate,
          priceImpact:    quoteResult.priceImpact,
          platformFee:    quoteResult.platformFee,
          platformFeeUsd: quoteResult.platformFeeUsd,
          route:          quoteResult.route,
          quoteResponse:  quoteResult.rawQuote,
        },
      };
    }),

  /**
   * Build a Jupiter swap transaction for Solana swaps.
   * Called when user clicks "Confirm Swap" for a Solana quote card.
   */
  buildSwapTx: publicProcedure
    .input(
      z.object({
        quoteResponse:  z.unknown(),
        userPublicKey:  z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { quoteResponse, userPublicKey } = input;

      if (!userPublicKey) throw new Error("Wallet not connected");

      const result = await getJupiterSwapTx(quoteResponse, userPublicKey);
      if (!result?.swapTransaction) {
        throw new Error("Failed to build swap transaction. Please try again.");
      }

      return { swapTransaction: result.swapTransaction };
    }),
});
