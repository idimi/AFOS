/**
 * AFOS Conversational Agent Router
 * Handles natural language swap requests:
 * 1. Parse user intent with LLM (fromToken, toToken, amount)
 * 2. Fetch real Jupiter quote
 * 3. Return structured response for frontend confirmation
 * 4. On confirmation: build Jupiter swap tx and return for wallet signing
 */

import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";

// ─── Token config ──────────────────────────────────────────────────────────────
const SUPPORTED_TOKENS = ["SOL", "USDT", "USDC", "ETH", "BTC"] as const;
type SupportedToken = typeof SUPPORTED_TOKENS[number];

const TOKEN_MINTS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};

const TOKEN_DECIMALS: Record<string, number> = {
  SOL: 9,
  USDT: 6,
  USDC: 6,
};

// ─── Jupiter API ───────────────────────────────────────────────────────────────
const JUPITER_QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
const JUPITER_SWAP_URL = "https://lite-api.jup.ag/swap/v1/swap";
const PLATFORM_FEE_BPS = 20; // 0.2%
const PLATFORM_FEE_ACCOUNT = "8PqWJvFQKxXhzqJLGRhTWUZhB1Bwk9JtQxKmKZvKpump";

async function getJupiterQuote(
  fromToken: string,
  toToken: string,
  amountRaw: number
): Promise<{
  inputMint: string;
  outputMint: string;
  inAmount: number;
  outAmount: number;
  priceImpactPct: number;
  routePlan: unknown[];
  swapMode: string;
  slippageBps: number;
  platformFee?: { amount: string; feeBps: number };
} | null> {
  const inputMint = TOKEN_MINTS[fromToken];
  const outputMint = TOKEN_MINTS[toToken];
  if (!inputMint || !outputMint) return null;

  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: String(Math.floor(amountRaw)),
    slippageBps: "50",
    platformFeeBps: String(PLATFORM_FEE_BPS),
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
      wrapAndUnwrapSol: true,
      feeAccount: PLATFORM_FEE_ACCOUNT,
      dynamicComputeUnitLimit: true,
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

// ─── Price fetching ──────────────────────────────────────────────────────────
// 30-second in-memory cache to avoid CoinGecko free-tier rate limits
interface PriceCache {
  prices: Record<string, number>;
  source: string;
  fetchedAt: number;
}
let priceCache: PriceCache | null = null;
const PRICE_CACHE_TTL_MS = 30_000; // 30 seconds

// CoinGecko is the primary source — works from the server without geo-restrictions
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
      SOL: sol,
      ETH: data.ethereum?.usd ?? 2000,
      BTC: data.bitcoin?.usd ?? 66000,
      USDT: 1,
      USDC: 1,
    };
  } catch {
    return null;
  }
}

// Binance fallback (may be geo-blocked in some regions)
async function getTokenPricesFromBinance(): Promise<Record<string, number> | null> {
  try {
    const res = await fetch(
      "https://api.binance.com/api/v3/ticker/price?symbols=[\"SOLUSDT\",\"ETHUSDT\",\"BTCUSDT\"]",
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
  // Return cached prices if still fresh
  if (priceCache && Date.now() - priceCache.fetchedAt < PRICE_CACHE_TTL_MS) {
    return { prices: priceCache.prices, source: priceCache.source + " (cached)" };
  }

  // Primary: CoinGecko (confirmed working from server)
  const cgPrices = await getTokenPricesFromCoinGecko();
  if (cgPrices) {
    console.log(`[Chat] Prices from CoinGecko: SOL=$${cgPrices.SOL}`);
    priceCache = { prices: cgPrices, source: "CoinGecko", fetchedAt: Date.now() };
    return { prices: cgPrices, source: "CoinGecko" };
  }

  // Fallback: Binance (may be geo-blocked)
  const binancePrices = await getTokenPricesFromBinance();
  if (binancePrices) {
    console.log(`[Chat] Prices from Binance: SOL=$${binancePrices.SOL}`);
    priceCache = { prices: binancePrices, source: "Binance", fetchedAt: Date.now() };
    return { prices: binancePrices, source: "Binance" };
  }

  // Final hardcoded fallback — approximate current values
  console.warn("[Chat] All price APIs failed, using approximate fallback prices");
  const fallback = { SOL: 85, ETH: 1970, BTC: 66000, USDT: 1, USDC: 1 };
  return { prices: fallback, source: "approximate (APIs unavailable)" };
}

async function getTokenPrices(): Promise<Record<string, number>> {
  return (await getTokenPricesWithSource()).prices;
}

// ─── Intent parsing ────────────────────────────────────────────────────────────
interface SwapIntent {
  type: "swap" | "price_check" | "balance_check" | "general";
  fromToken?: SupportedToken;
  toToken?: SupportedToken;
  amount?: number;
  amountToken?: SupportedToken;
  isMax?: boolean;
  reply?: string; // for general/price_check responses
}

async function parseIntent(
  message: string,
  conversationHistory: { role: "user" | "assistant"; content: string }[],
  prices: Record<string, number>,
  walletBalances?: { symbol: string; amount: string }[],
  priceSource?: string
): Promise<SwapIntent> {
  const systemPrompt = `You are AFOS, an autonomous financial agent that helps users swap crypto tokens across multiple chains via IntercomSwap (primary route), Jupiter (Solana fallback), and 1inch (Ethereum fallback).
Supported tokens: SOL, USDT, USDC (Solana), ETH (Ethereum), BTC (Bitcoin).
Current live prices (source: ${priceSource ?? "live"}): ${JSON.stringify(prices)}
${walletBalances ? `User wallet balances: ${JSON.stringify(walletBalances)}` : ""}

Parse the user's message and return a JSON object with this exact schema:
{
  "type": "swap" | "price_check" | "balance_check" | "general",
  "fromToken": "SOL" | "USDT" | "USDC" | "ETH" | "BTC" | null,
  "toToken": "SOL" | "USDT" | "USDC" | "ETH" | "BTC" | null,
  "amount": number | null,
  "amountToken": "SOL" | "USDT" | "USDC" | "ETH" | "BTC" | null,
  "isMax": boolean,
  "reply": string | null
}

Rules:
- For swap intents: extract fromToken, toToken, amount, amountToken
- "swap 1 USDT to SOL" → fromToken: USDT, toToken: SOL, amount: 1, amountToken: USDT
- "convert 0.5 SOL to USDT" → fromToken: SOL, toToken: USDT, amount: 0.5, amountToken: SOL
- "swap all my SOL to USDT" → fromToken: SOL, toToken: USDT, isMax: true
- "swap 0.01 ETH to USDT" → fromToken: ETH, toToken: USDT, amount: 0.01, amountToken: ETH
- "swap 0.001 BTC to SOL" → fromToken: BTC, toToken: SOL, amount: 0.001, amountToken: BTC
- For ETH/BTC swaps: these route through IntercomSwap. Mention this in the reply when confirming.
- For price checks: type: "price_check", reply with the current price AND cite the source, e.g. "SOL is $84.11 (via ${priceSource ?? "live"}, live)"
- For balance checks: type: "balance_check", reply with balance info
- For general questions: type: "general", provide a helpful reply about AFOS and its multi-chain capabilities
- If user says "Solana" they mean SOL, "Ethereum" means ETH, "Bitcoin" means BTC
- If user says "tether" or "tether usd" they mean USDT
- reply field: for non-swap types, write a friendly helpful response
- For Solana-only swaps (SOL/USDT/USDC), reply should be null (the frontend will show the quote card)
- For ETH or BTC swaps, set type to "general" and reply explaining that the swap will route via IntercomSwap and the user should confirm in the Swaps page with their connected ETH/BTC wallet`;

  const result = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      ...conversationHistory.slice(-6), // last 6 messages for context
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
            type: { type: "string", enum: ["swap", "price_check", "balance_check", "general"] },
            fromToken: { type: ["string", "null"] },
            toToken: { type: ["string", "null"] },
            amount: { type: ["number", "null"] },
            amountToken: { type: ["string", "null"] },
            isMax: { type: "boolean" },
            reply: { type: ["string", "null"] },
          },
          required: ["type", "fromToken", "toToken", "amount", "amountToken", "isMax", "reply"],
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

// ─── Chat message types ────────────────────────────────────────────────────────
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  type?: "text" | "quote_card" | "tx_success" | "error";
  quoteData?: {
    fromToken: string;
    toToken: string;
    fromAmount: number;
    toAmount: number;
    fromAmountUsd: number;
    toAmountUsd: number;
    rate: number;
    priceImpact: number;
    platformFee: number;
    platformFeeUsd: number;
    route: string;
    quoteResponse: unknown; // raw Jupiter quote for tx building
  };
}

// ─── Router ────────────────────────────────────────────────────────────────────
export const chatRouter = router({
  /**
   * Send a message to the AFOS conversational agent.
   * Returns either a text reply or a swap quote card.
   */
  sendMessage: publicProcedure
    .input(
      z.object({
        message: z.string().min(1).max(500),
        history: z.array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string(),
          })
        ).max(20),
        walletAddress: z.string().optional(),
        walletBalances: z
          .array(z.object({ symbol: z.string(), amount: z.string() }))
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { message, history, walletAddress, walletBalances } = input;

      // Fetch current prices (with 30s cache)
      const { prices, source: priceSource } = await getTokenPricesWithSource();

      // Parse intent
      const intent = await parseIntent(message, history, prices, walletBalances, priceSource);

      // Handle non-swap intents
      if (intent.type !== "swap") {
        return {
          type: "text" as const,
          content: intent.reply || "How can I help you with your crypto swaps today?",
        };
      }

      // Validate swap intent
      const { fromToken, toToken, amount, isMax } = intent;
      if (!fromToken || !toToken) {
        return {
          type: "text" as const,
          content: "I need to know which tokens you want to swap. For example: *swap 1 USDT to SOL*",
        };
      }

      if (!TOKEN_MINTS[fromToken] || !TOKEN_MINTS[toToken]) {
        return {
          type: "text" as const,
          content: `I currently support SOL, USDT, and USDC swaps on Solana. ${fromToken} or ${toToken} is not supported yet.`,
        };
      }

      // Determine amount
      let swapAmount = amount || 0;
      if (isMax && walletBalances) {
        const bal = walletBalances.find(b => b.symbol === fromToken);
        if (bal) swapAmount = parseFloat(bal.amount) || 0;
      }

      if (swapAmount <= 0) {
        return {
          type: "text" as const,
          content: `How much ${fromToken} would you like to swap? For example: *swap 1 ${fromToken} to ${toToken}*`,
        };
      }

      // Convert amount to raw units
      const decimals = TOKEN_DECIMALS[fromToken] || 9;
      const amountRaw = Math.floor(swapAmount * Math.pow(10, decimals));

      // Fetch Jupiter quote
      const quote = await getJupiterQuote(fromToken, toToken, amountRaw);
      if (!quote) {
        return {
          type: "text" as const,
          content: `I couldn't get a quote for ${fromToken} → ${toToken} right now. Jupiter may be temporarily unavailable. Please try again.`,
        };
      }

      // Calculate human-readable amounts
      const toDecimals = TOKEN_DECIMALS[toToken] || 9;
      const fromAmountHuman = swapAmount;
      const toAmountHuman = parseInt(quote.outAmount as unknown as string) / Math.pow(10, toDecimals);
      const fromAmountUsd = fromAmountHuman * (prices[fromToken] || 1);
      const toAmountUsd = toAmountHuman * (prices[toToken] || 1);
      const rate = toAmountHuman / fromAmountHuman;
      const priceImpact = parseFloat(quote.priceImpactPct as unknown as string) || 0;
      const platformFeeAmount = fromAmountHuman * (PLATFORM_FEE_BPS / 10000);
      const platformFeeUsd = platformFeeAmount * (prices[fromToken] || 1);

      return {
        type: "quote_card" as const,
        content: `Here's your swap quote for ${fromAmountHuman} ${fromToken} → ${toToken}:`,
        quoteData: {
          fromToken,
          toToken,
          fromAmount: fromAmountHuman,
          toAmount: toAmountHuman,
          fromAmountUsd,
          toAmountUsd,
          rate,
          priceImpact,
          platformFee: platformFeeAmount,
          platformFeeUsd,
          route: "Jupiter DEX",
          quoteResponse: quote,
        },
      };
    }),

  /**
   * Build a Jupiter swap transaction for the user to sign.
   * Called when user clicks "Confirm Swap" in the chat.
   */
  buildSwapTx: publicProcedure
    .input(
      z.object({
        quoteResponse: z.unknown(),
        userPublicKey: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { quoteResponse, userPublicKey } = input;

      if (!userPublicKey) {
        throw new Error("Wallet not connected");
      }

      const result = await getJupiterSwapTx(quoteResponse, userPublicKey);
      if (!result?.swapTransaction) {
        throw new Error("Failed to build swap transaction. Please try again.");
      }

      return {
        swapTransaction: result.swapTransaction, // base64 encoded transaction
      };
    }),
});
