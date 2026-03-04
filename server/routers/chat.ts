/**
 * AFOS Conversational Agent Router — Multi-Chain v3 (Unified P2P-First Architecture)
 *
 * All three chains follow the same pattern:
 *   PRIMARY: IntercomSwap P2P network (Oracle VM RFQ)
 *   FALLBACK: Chain-specific aggregator
 *
 * Routing per chain:
 *   Solana:   IntercomSwap P2P → Jupiter DEX fallback
 *   Ethereum: IntercomSwap P2P → 1inch aggregator fallback
 *   Bitcoin:  IntercomSwap P2P → Direct HTLC (mempool.space) fallback
 *
 * Execution procedures:
 *   buildSwapTx      — Solana swaps (P2P primary + Jupiter fallback)
 *   executeEthSwap   — Ethereum swaps (P2P primary + 1inch fallback)
 *   executeBtcSwap   — Bitcoin swaps (P2P primary + direct HTLC fallback)
 *
 * Flow:
 *   1. Parse user intent with LLM (fromToken, toToken, fromChain, toChain, amount)
 *   2. Fetch real quote from the appropriate DEX/aggregator
 *   3. Return structured quote_card response for frontend confirmation
 *   4. On confirmation: submit RFQ to IntercomSwap P2P → fallback to chain aggregator
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { recordHtlcLock, recordSwapAnalytic } from "../htlcMonitor";
import { buildHtlcLockTx } from "../ethHtlc";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { executeEthAgentSwap } from "../agentSwapEth";
import { executeBtcAgentSwap } from "../agentSwapBtc";
import { getUserSettings } from "../db";
import { DEFAULT_USER_SETTINGS } from "../../drizzle/schema";

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
const PLATFORM_FEE_BPS  = 20;  // 0.20% — DEX fallback (Jupiter/1inch referral, collected on-chain)
const P2P_FEE_BPS       = 15;  // 0.15% — P2P primary route (output-side deduction, cheaper to reward P2P)

// SOL_FEE_ACCOUNT — the Solana wallet that receives Jupiter referral fees (0.20% per DEX swap).
// Set SOL_FEE_WALLET to your Solana fee wallet address in project secrets.
// If not set, the SOL agent wallet address is used as fallback (derived from SOL_AGENT_KEY).
// If neither is set, feeAccount is omitted from Jupiter calls — swaps still execute but fees are not collected.
function deriveSolFeeAccount(): string | null {
  if (process.env.SOL_FEE_WALLET) return process.env.SOL_FEE_WALLET;
  // Derive from SOL_AGENT_KEY (Oracle VM Hot Wallet) as fallback fee wallet
  try {
    const keyRaw = process.env.SOL_AGENT_KEY;
    if (!keyRaw) return null;
    const keyBytes = bs58.decode(keyRaw);
    const kp = Keypair.fromSecretKey(keyBytes);
    return kp.publicKey.toBase58();
  } catch {
    return null;
  }
}
const SOL_FEE_ACCOUNT: string | null = deriveSolFeeAccount();
if (!SOL_FEE_ACCOUNT) {
  console.warn(
    "[AFOS] WARNING: SOL_FEE_WALLET env var is not set and SOL_AGENT_KEY is missing. " +
    "Jupiter DEX fees (0.20%) will NOT be collected. " +
    "Set SOL_FEE_WALLET to your Solana fee wallet address in project secrets."
  );
} else {
  console.log(`[AFOS] SOL fee wallet: ${SOL_FEE_ACCOUNT}`);
}

// ETH_FEE_ACCOUNT — Ethereum address that receives ETH referral fees.
// Set ETH_FEE_WALLET in project secrets, or falls back to the ETH agent wallet (ETH_AGENT_KEY).
function deriveEthFeeAccount(): string | null {
  if (process.env.ETH_FEE_WALLET) return process.env.ETH_FEE_WALLET;
  try {
    const keyRaw = process.env.ETH_AGENT_KEY;
    if (!keyRaw) return null;
    const { ethers } = require("ethers") as typeof import("ethers");
    const keyHex = keyRaw.startsWith("0x") ? keyRaw : `0x${keyRaw}`;
    return new ethers.Wallet(keyHex).address;
  } catch {
    return null;
  }
}
const ETH_FEE_ACCOUNT: string | null = deriveEthFeeAccount();
if (ETH_FEE_ACCOUNT) console.log(`[AFOS] ETH fee wallet: ${ETH_FEE_ACCOUNT}`);

// BTC_FEE_ACCOUNT — Bitcoin address that receives BTC fees.
// Set BTC_FEE_WALLET in project secrets, or falls back to the BTC agent wallet (BTC_AGENT_WIF).
function deriveBtcFeeAccount(): string | null {
  if (process.env.BTC_FEE_WALLET) return process.env.BTC_FEE_WALLET;
  try {
    const keyRaw = process.env.BTC_AGENT_WIF;
    if (!keyRaw) return null;
    const bitcoin = require("bitcoinjs-lib") as typeof import("bitcoinjs-lib");
    const ECPairFactory = require("ecpair").ECPairFactory;
    const ecc = require("tiny-secp256k1");
    const ECPair = ECPairFactory(ecc);
    const keyPair = ECPair.fromWIF(keyRaw, bitcoin.networks.bitcoin);
    const { address } = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(keyPair.publicKey), network: bitcoin.networks.bitcoin });
    return address ?? null;
  } catch {
    return null;
  }
}
const BTC_FEE_ACCOUNT: string | null = deriveBtcFeeAccount();
if (BTC_FEE_ACCOUNT) console.log(`[AFOS] BTC fee wallet: ${BTC_FEE_ACCOUNT}`);

async function getJupiterQuote(
  fromAsset: AssetDef,
  toAsset: AssetDef,
  amountRaw: number,
  /** Slippage in basis points — default 50 (0.5%) */
  slippageBps = 50,
): Promise<Record<string, unknown> | null> {
  if (!fromAsset.address || !toAsset.address) return null;

  const params = new URLSearchParams({
    inputMint:       fromAsset.address,
    outputMint:      toAsset.address,
    amount:          String(Math.floor(amountRaw)),
    slippageBps:     String(slippageBps),
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
      wrapAndUnwrapSol:          true,
      // Only include feeAccount when SOL_FEE_WALLET (or SOL_AGENT_KEY fallback) is available.
      // Omitting it means Jupiter executes the swap without collecting a referral fee.
      ...(SOL_FEE_ACCOUNT ? { feeAccount: SOL_FEE_ACCOUNT } : {}),
      dynamicComputeUnitLimit:   true,
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

/**
 * Build an executable 1inch swap transaction.
 * Returns the raw tx payload { to, data, value } for eth_sendTransaction.
 *
 * Requires the sender wallet address (from) so 1inch can estimate gas correctly.
 * The API key is optional — public endpoint works for quote-only, but the /swap
 * endpoint may require ONEINCH_API_KEY for production use.
 */
async function get1inchSwapTx(
  fromAsset: AssetDef,
  toAsset: AssetDef,
  amountRaw: string,
  fromAddress: string,
  slippage = 1
): Promise<{ to: string; data: string; value: string; gas?: number } | null> {
  try {
    const apiKey = process.env.ONEINCH_API_KEY;
    const params = new URLSearchParams({
      src:              get1inchAddress(fromAsset),
      dst:              get1inchAddress(toAsset),
      amount:           amountRaw,
      from:             fromAddress.toLowerCase(),
      slippage:         String(slippage),
      disableEstimate:  "false",
      allowPartialFill: "false",
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept":       "application/json",
    };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const res = await fetch(`${ONEINCH_BASE}/swap?${params}`, {
      headers,
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn(`[1inch] Swap tx build failed: ${res.status} ${errText.slice(0, 120)}`);
      return null;
    }

    const data = await res.json() as {
      tx?: { to?: string; data?: string; value?: string | bigint; gas?: number };
      // v6 may return top-level fields
      to?: string; data?: string; value?: string | bigint; gas?: number;
    };

    const tx = data.tx ?? data;
    if (!tx.to || !tx.data) return null;

    return {
      to:    tx.to,
      data:  tx.data,
      value: String(tx.value ?? "0x0"),
      gas:   tx.gas,
    };
  } catch (err) {
    console.warn("[1inch] Swap tx build error:", err);
    return null;
  }
}

// ─── Shared IntercomSwap P2P RFQ helper ───────────────────────────────────────
// Used by all three chain execution procedures (Solana, Ethereum, Bitcoin)

interface P2PQuoteResult {
  rfqId?: string;
  peerId?: string;
  counterpartyPubKey?: string;
  counterpartyAddress?: string;
  rate?: number;
  outAmount?: number;
  route?: string;
}

/**
 * Submit an RFQ to the IntercomSwap Oracle VM and wait for a P2P peer quote.
 * Returns the best peer quote, or null if no peer responds within the timeout.
 *
 * This is the PRIMARY route for all three chains. If it returns null,
 * each chain falls back to its own aggregator (Jupiter / 1inch / direct HTLC).
 */
async function submitIntercomSwapRfq(params: {
  fromToken: string;
  toToken: string;
  amount: number;
  fromChain: string;
  toChain: string;
  timeoutMs?: number;
}): Promise<P2PQuoteResult | null> {
  const ORACLE_API = process.env.ORACLE_API_URL || "http://141.253.123.101:4000";
  const { fromToken, toToken, amount, fromChain, toChain, timeoutMs = 8000 } = params;

  try {
    console.log(`[IntercomSwap P2P] Submitting RFQ: ${fromToken} (${fromChain}) → ${toToken} (${toChain}), amount=${amount}`);

    const rfqRes = await fetch(`${ORACLE_API}/api/rfq`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromToken, toToken, amount, fromChain, toChain }),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch(() => null);

    if (!rfqRes?.ok) {
      console.log(`[IntercomSwap P2P] RFQ failed: ${rfqRes?.status ?? "timeout/network error"}`);
      return null;
    }

    const rfqData = await rfqRes.json().catch(() => null) as {
      success?: boolean;
      result?: {
        rfqId?: string; id?: string;
        peerId?: string; responderId?: string;
        counterpartyPubKey?: string; peerPubKey?: string;
        counterpartyAddress?: string; peerAddress?: string;
        rate?: number; price?: number;
        outAmount?: number;
        route?: string;
        p2pQuotes?: number;
      };
    } | null;

    if (!rfqData?.success || !rfqData?.result) {
      console.log("[IntercomSwap P2P] No matching peer found.");
      return null;
    }

    const r = rfqData.result;
    const quote: P2PQuoteResult = {
      rfqId:               r.rfqId ?? r.id,
      peerId:              r.peerId ?? r.responderId,
      counterpartyPubKey:  r.counterpartyPubKey ?? r.peerPubKey,
      counterpartyAddress: r.counterpartyAddress ?? r.peerAddress,
      rate:                r.rate ?? r.price,
      outAmount:           r.outAmount,
      route:               r.route ?? ((r.p2pQuotes ?? 0) > 0 ? "p2p" : "dex"),
    };

    console.log(
      `[IntercomSwap P2P] Peer matched: ${quote.peerId ?? "unknown"} ` +
      `rate=${quote.rate} rfqId=${quote.rfqId} route=${quote.route}`
    );
    return quote;

  } catch (err) {
    console.warn("[IntercomSwap P2P] RFQ error:", err);
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
  toAmount: number;        // gross output before platform fee
  netToAmount: number;     // net output after platform fee (what user actually receives)
  fromAmountUsd: number;
  toAmountUsd: number;
  rate: number;
  priceImpact: number;
  platformFee: number;     // fee in fromToken units (for display)
  platformFeeUsd: number;
  platformFeeOut: number;  // fee in toToken units (output-side deduction amount)
  feeBps: number;          // actual bps charged (15 for P2P, 20 for DEX)
  feeToken: string;        // token symbol the fee is deducted from
  route: string;
  rawQuote: unknown;
}

async function buildQuote(
  fromAsset: AssetDef,
  toAsset: AssetDef,
  swapAmount: number,
  prices: Record<string, number>,
  /** Slippage in basis points — default 50 (0.5%) */
  slippageBps = 50,
): Promise<QuoteResult | { error: string }> {
  const fromPrice = prices[fromAsset.symbol] ?? (fromAsset.isStable ? 1 : 0);
  const toPrice   = prices[toAsset.symbol]   ?? (toAsset.isStable   ? 1 : 0);

  // ── Solana → Solana: Jupiter ──────────────────────────────────────────────
  if (fromAsset.chain === "solana" && toAsset.chain === "solana") {
    const amountRaw = Math.floor(swapAmount * Math.pow(10, fromAsset.decimals));
    const quote = await getJupiterQuote(fromAsset, toAsset, amountRaw, slippageBps);
    if (!quote) return { error: `Jupiter quote unavailable for ${fromAsset.symbol} → ${toAsset.symbol}. Please try again.` };

    const toAmountHuman  = parseInt(quote.outAmount as string) / Math.pow(10, toAsset.decimals);
    const priceImpact    = parseFloat(quote.priceImpactPct as string) || 0;
    // Jupiter DEX: 0.20% fee collected on-chain via referral — Jupiter deducts it automatically
    const platformFeeOut = toAmountHuman * (PLATFORM_FEE_BPS / 10000);
    const netToAmount    = toAmountHuman; // Jupiter referral handles deduction on-chain
    const platformFee    = swapAmount * (PLATFORM_FEE_BPS / 10000);

    return {
      fromAmount:     swapAmount,
      toAmount:       toAmountHuman,
      netToAmount,
      fromAmountUsd:  swapAmount * fromPrice,
      toAmountUsd:    netToAmount * toPrice,
      rate:           netToAmount / swapAmount,
      priceImpact,
      platformFee,
      platformFeeUsd: platformFee * fromPrice,
      platformFeeOut,
      feeBps:         PLATFORM_FEE_BPS,
      feeToken:       toAsset.symbol,
      route:          "Jupiter DEX",
      rawQuote:       quote,
    };
  }

  // ── Ethereum → Ethereum: 1inch ────────────────────────────────────────────
  if (fromAsset.chain === "ethereum" && toAsset.chain === "ethereum") {
    const amountRaw = BigInt(Math.floor(swapAmount * Math.pow(10, fromAsset.decimals))).toString();
    const q1inch = await get1inchQuote(fromAsset, toAsset, amountRaw);

    if (q1inch) {
      const toAmountHuman  = parseInt(q1inch.toAmount) / Math.pow(10, toAsset.decimals);
      // 1inch DEX: 0.20% fee via referral — collected on-chain, show for transparency
      const platformFeeOut = toAmountHuman * (PLATFORM_FEE_BPS / 10000);
      const netToAmount    = toAmountHuman;
      const platformFee    = swapAmount * (PLATFORM_FEE_BPS / 10000);
      return {
        fromAmount:     swapAmount,
        toAmount:       toAmountHuman,
        netToAmount,
        fromAmountUsd:  swapAmount * fromPrice,
        toAmountUsd:    netToAmount * toPrice,
        rate:           netToAmount / swapAmount,
        priceImpact:    0,
        platformFee,
        platformFeeUsd: platformFee * fromPrice,
        platformFeeOut,
        feeBps:         PLATFORM_FEE_BPS,
        feeToken:       toAsset.symbol,
        route:          "1inch (Ethereum)",
        rawQuote:       q1inch,
      };
    }

    // Fallback: estimate via prices if 1inch unavailable — P2P fee (0.15%) applies
    const estimatedOut1   = (swapAmount * fromPrice) / (toPrice || 1);
    const platformFeeOut1 = estimatedOut1 * (P2P_FEE_BPS / 10000);
    const netToAmount1    = estimatedOut1 - platformFeeOut1;
    const platformFee1    = swapAmount * (P2P_FEE_BPS / 10000);
    return {
      fromAmount:     swapAmount,
      toAmount:       estimatedOut1,
      netToAmount:    netToAmount1,
      fromAmountUsd:  swapAmount * fromPrice,
      toAmountUsd:    netToAmount1 * toPrice,
      rate:           netToAmount1 / swapAmount,
      priceImpact:    0.1,
      platformFee:    platformFee1,
      platformFeeUsd: platformFee1 * fromPrice,
      platformFeeOut: platformFeeOut1,
      feeBps:         P2P_FEE_BPS,
      feeToken:       toAsset.symbol,
      route:          "IntercomSwap P2P (Ethereum)",
      rawQuote:       null,
    };
  }

  // ── Cross-chain or Bitcoin: IntercomSwap P2P — 0.15% output-side fee ────────
  const estimatedOut   = (swapAmount * fromPrice) / (toPrice || 1);
  const platformFeeOut = estimatedOut * (P2P_FEE_BPS / 10000);
  const netToAmount    = estimatedOut - platformFeeOut;
  const platformFee    = swapAmount * (P2P_FEE_BPS / 10000);
  const routeLabel = fromAsset.chain === "bitcoin" || toAsset.chain === "bitcoin"
    ? "IntercomSwap P2P (Bitcoin bridge)"
    : "IntercomSwap P2P (cross-chain)";

  return {
    fromAmount:     swapAmount,
    toAmount:       estimatedOut,
    netToAmount,
    fromAmountUsd:  swapAmount * fromPrice,
    toAmountUsd:    netToAmount * toPrice,
    rate:           netToAmount / swapAmount,
    priceImpact:    0.15,
    platformFee,
    platformFeeUsd: platformFee * fromPrice,
    platformFeeOut,
    feeBps:         P2P_FEE_BPS,
    feeToken:       toAsset.symbol,
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
    netToAmount: number;     // what user actually receives after fee
    fromAmountUsd: number;
    toAmountUsd: number;
    rate: number;
    priceImpact: number;
    platformFee: number;
    platformFeeUsd: number;
    platformFeeOut: number;  // fee in toToken units
    feeBps: number;          // 15 for P2P, 20 for DEX
    feeToken: string;
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
        /** Manus OAuth openId — used to load user settings (max tx, slippage, preferred route) */
        openId:         z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { message, history, walletBalances, openId } = input;

      // Load user settings (non-blocking — falls back to defaults if DB unavailable)
      const userPrefs = openId ? await getUserSettings(openId) : DEFAULT_USER_SETTINGS;
      const slippageBps = Math.round(parseFloat(userPrefs.slippagePct) * 100); // e.g. 0.5% → 50 bps

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

      // ── Enforce maxTxAmountUsd (quote-time warning) ────────────────────────────────────────
      // We estimate the USD value using prices already fetched above.
      // This is a soft warning at quote time; the hard rejection happens at execution time.
      const fromPriceForCheck = prices[from.symbol] ?? (from.symbol.includes("USD") ? 1 : 0);
      const estimatedUsd = swapAmount * fromPriceForCheck;
      if (estimatedUsd > userPrefs.maxTxAmountUsd) {
        return {
          type: "text" as const,
          content:
            `⚠️ This swap (~$${estimatedUsd.toFixed(2)}) exceeds your configured maximum transaction ` +
            `amount of $${userPrefs.maxTxAmountUsd}. ` +
            `Please reduce the amount or increase your limit in Settings.`,
        };
      }

      const quoteResult = await buildQuote(fromAsset, toAsset, swapAmount, prices, slippageBps);

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
          netToAmount:    quoteResult.netToAmount,
          fromAmountUsd:  quoteResult.fromAmountUsd,
          toAmountUsd:    quoteResult.toAmountUsd,
          rate:           quoteResult.rate,
          priceImpact:    quoteResult.priceImpact,
          platformFee:    quoteResult.platformFee,
          platformFeeUsd: quoteResult.platformFeeUsd,
          platformFeeOut: quoteResult.platformFeeOut,
          feeBps:         quoteResult.feeBps,
          feeToken:       quoteResult.feeToken,
          route:          quoteResult.route,
          quoteResponse:  quoteResult.rawQuote,
        },
      };
    }),

  /**
   * Build a Solana swap transaction.
   * PRIMARY: IntercomSwap P2P network (Oracle VM RFQ)
   * FALLBACK: Jupiter DEX aggregator
   *
   * Called when user clicks "Confirm Swap" for a Solana quote card.
   * Returns either a P2P route descriptor (for HTLC coordination) or a
   * Jupiter swapTransaction (base64-encoded VersionedTransaction).
   */
  buildSwapTx: publicProcedure
    .input(
      z.object({
        quoteResponse:  z.unknown(),
        userPublicKey:  z.string(),
        /** Source token symbol (e.g. "SOL", "USDT") — used for P2P RFQ */
        fromToken:      z.string().optional(),
        /** Destination token symbol — used for P2P RFQ */
        toToken:        z.string().optional(),
        /** Source chain (default: solana) */
        fromChain:      z.enum(["solana", "ethereum", "bitcoin"]).optional(),
        /** Destination chain — if cross-chain, P2P is attempted first */
        toChain:        z.enum(["solana", "ethereum", "bitcoin"]).optional(),
        /** Human-readable swap amount (e.g. 1.5) — used for P2P RFQ */
        amount:         z.number().positive().optional(),
        /** Skip IntercomSwap P2P and go straight to Jupiter */
        skipP2P:        z.boolean().optional().default(false),
        /** Manus OAuth openId — used to enforce per-user settings */
        openId:         z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { quoteResponse, userPublicKey, fromToken, toToken, fromChain, toChain, amount, openId } = input;

      // ── Load user settings & enforce limits ───────────────────────────────
      const userPrefs = openId ? await getUserSettings(openId) : DEFAULT_USER_SETTINGS;

      // Hard reject: amount exceeds user's maxTxAmountUsd
      if (amount) {
        const { prices: pricesForCheck } = await getTokenPricesWithSource();
        const sym = (fromToken ?? "SOL").toUpperCase();
        const fromPriceCheck = pricesForCheck[sym] ?? (sym.includes("USD") ? 1 : 0);
        const estimatedUsd = amount * fromPriceCheck;
        if (estimatedUsd > userPrefs.maxTxAmountUsd) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              `Swap amount (~$${estimatedUsd.toFixed(2)}) exceeds your maximum transaction limit ` +
              `of $${userPrefs.maxTxAmountUsd}. Increase your limit in Settings or reduce the amount.`,
          });
        }
      }

      // Apply preferredRoute: if user prefers Jupiter, skip P2P
      const skipP2P = input.skipP2P || userPrefs.preferredRoute === "jupiter";

      if (!userPublicKey) throw new Error("Wallet not connected");

      // ── Step 1: IntercomSwap P2P discovery ────────────────────────────────
      // Attempt P2P route first when token/amount context is available.
      // Cross-chain swaps always go through P2P; same-chain Solana swaps
      // also try P2P first for potentially better rates.
      let p2pQuote: P2PQuoteResult | null = null;
      const isCrossChain = toChain && toChain !== "solana";

      if (!skipP2P && fromToken && toToken && amount) {
        p2pQuote = await submitIntercomSwapRfq({
          fromToken:  fromToken.toUpperCase(),
          toToken:    toToken.toUpperCase(),
          amount,
          fromChain:  fromChain ?? "solana",
          toChain:    toChain   ?? "solana",
        });
      }

      // ── Step 2: If P2P peer matched, return P2P route ─────────────────────
      // The frontend will coordinate the HTLC lock with the peer via LightPeerContext.
      if (p2pQuote) {
        // Record P2P swap event to analytics DB (non-blocking)
        void recordSwapAnalytic({
          fromChain:  (fromChain ?? "solana") as "solana" | "ethereum" | "bitcoin",
          toChain:    (toChain   ?? "solana") as "solana" | "ethereum" | "bitcoin",
          fromToken:  fromToken ?? "SOL",
          toToken:    toToken   ?? "USDT",
          amount:     String(amount ?? 0),
          route:      "IntercomSwap P2P",
          status:     "completed",
          peerId:     p2pQuote.peerId ?? undefined,
        }).catch(() => {/* non-fatal */});
        return {
          route:          "IntercomSwap P2P" as const,
          p2pQuote,
          swapTransaction: null,
          message:
            `IntercomSwap P2P peer matched (${p2pQuote.peerId ?? "peer"}). ` +
            `Rate: ${p2pQuote.rate ?? "N/A"}. ` +
            "Coordinating HTLC lock with counterparty via Oracle VM.",
        };
      }

      // ── Step 3: Fallback — Jupiter DEX ────────────────────────────────────
      // No P2P peer found (or P2P skipped / no context). Use Jupiter.
      if (isCrossChain) {
        // Cross-chain with no P2P peer — cannot use Jupiter (Solana-only)
        throw new Error(
          "No IntercomSwap P2P peer available for this cross-chain swap. " +
          "Please try again or use the browser light peer for manual HTLC coordination."
        );
      }

      const result = await getJupiterSwapTx(quoteResponse, userPublicKey);
      if (!result?.swapTransaction) {
        throw new Error("Failed to build swap transaction via Jupiter. Please try again.");
      }

      // Record Jupiter fallback swap event to analytics DB (non-blocking)
      void recordSwapAnalytic({
        fromChain:  "solana",
        toChain:    "solana",
        fromToken:  fromToken ?? "SOL",
        toToken:    toToken   ?? "USDT",
        amount:     String(amount ?? 0),
        route:      "Jupiter DEX",
        status:     "completed",
      }).catch(() => {/* non-fatal */});

      return {
        route:          "Jupiter DEX" as const,
        p2pQuote:       null,
        swapTransaction: result.swapTransaction,
        message:        "No P2P peer found — routing via Jupiter DEX.",
      };
    }),

  /**
   * Execute an Ethereum swap via the agent.
   * PRIMARY: IntercomSwap P2P network (Oracle VM RFQ)
   * FALLBACK: 1inch aggregator (builds eth_sendTransaction calldata)
   *
   * In browser mode: returns tx calldata for wallet.eth_sendTransaction().
   * In agent mode (ETH_AGENT_ADDRESS set): returns the calldata with a hint
   * to sign and broadcast server-side.
   *
   * The browser light peer path (MetaMask, Phantom ETH, Coinbase) calls
   * eth_sendTransaction directly with the returned { to, data, value }.
   */
  executeEthSwap: publicProcedure
    .input(
      z.object({
        /** Sender's Ethereum address (checksummed or lowercase) */
        fromAddress:  z.string(),
        /** Source token symbol ("ETH", "USDT", "USDC") */
        fromToken:    z.string(),
        /** Destination token symbol */
        toToken:      z.string(),
        /** Source chain (default: ethereum) */
        fromChain:    z.enum(["solana", "ethereum", "bitcoin"]).optional().default("ethereum"),
        /** Destination chain */
        toChain:      z.enum(["solana", "ethereum", "bitcoin"]).optional().default("ethereum"),
        /** Human-readable amount to swap (e.g. 0.1 for 0.1 ETH) */
        amount:       z.number().positive(),
        /** Allowed slippage in percent (default: 1%) — overridden by user settings when openId is provided */
        slippage:     z.number().min(0.1).max(50).optional().default(1),
        /** Skip IntercomSwap P2P and go straight to 1inch */
        skipP2P:      z.boolean().optional().default(false),
        /** Manus OAuth openId — used to enforce per-user settings */
        openId:       z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { fromAddress, fromToken, toToken, fromChain, toChain, amount, openId } = input;

      // ── Load user settings & enforce limits ───────────────────────────────
      const userPrefs = openId ? await getUserSettings(openId) : DEFAULT_USER_SETTINGS;

      // Hard reject: amount exceeds user's maxTxAmountUsd
      const { prices: pricesForCheck } = await getTokenPricesWithSource();
      const sym = fromToken.toUpperCase();
      const fromPriceCheck = pricesForCheck[sym] ?? (sym.includes("USD") ? 1 : 0);
      const estimatedUsd = amount * fromPriceCheck;
      if (estimatedUsd > userPrefs.maxTxAmountUsd) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            `Swap amount (~$${estimatedUsd.toFixed(2)}) exceeds your maximum transaction limit ` +
            `of $${userPrefs.maxTxAmountUsd}. Increase your limit in Settings or reduce the amount.`,
        });
      }

      // Use user's slippage setting (pct), falling back to input or default 1%
      const slippage = parseFloat(userPrefs.slippagePct) || input.slippage || 1;
      // Apply preferredRoute: if user prefers 1inch, skip P2P
      const skipP2P = input.skipP2P || userPrefs.preferredRoute === "oneinch";

      // Resolve asset definitions
      const normaliseToken = (sym: string, chain: string): string => {
        // USDT_ETH / USDC_ETH are internal aliases — strip the _ETH suffix for 1inch
        if (sym === "USDT_ETH") return "USDT";
        if (sym === "USDC_ETH") return "USDC";
        return sym;
      };
      const fromSymbol = normaliseToken(fromToken, fromChain);
      const toSymbol   = normaliseToken(toToken,   toChain);

      const fromAsset = getAsset(fromSymbol, fromChain as SupportedChain)
        ?? getAsset(fromSymbol, "ethereum");
      const toAsset   = getAsset(toSymbol,   toChain   as SupportedChain)
        ?? getAsset(toSymbol,   "ethereum");

      // ── Step 1: IntercomSwap P2P discovery ────────────────────────────────
      let p2pQuote: P2PQuoteResult | null = null;

      if (!skipP2P) {
        p2pQuote = await submitIntercomSwapRfq({
          fromToken:  fromSymbol.toUpperCase(),
          toToken:    toSymbol.toUpperCase(),
          amount,
          fromChain,
          toChain,
        });
      }

      // ── Step 2: If P2P peer matched, return P2P route ─────────────────────
      if (p2pQuote) {
        // Record P2P swap event to analytics DB (non-blocking)
        void recordSwapAnalytic({
          fromChain:  fromChain as "solana" | "ethereum" | "bitcoin",
          toChain:    toChain   as "solana" | "ethereum" | "bitcoin",
          fromToken:  fromSymbol,
          toToken:    toSymbol,
          amount:     String(amount),
          route:      "IntercomSwap P2P",
          status:     "completed",
          peerId:     p2pQuote.peerId ?? undefined,
        }).catch(() => {/* non-fatal */});
        // Build HTLC lock calldata if contract is deployed
        const htlcTimelock = Math.floor(Date.now() / 1000) + 3600; // 1-hour timelock
        const secretBytes  = crypto.getRandomValues(new Uint8Array(32));
        const secretHex    = Array.from(secretBytes).map(b => b.toString(16).padStart(2, "0")).join("");
        const secretHashBytes = await crypto.subtle.digest("SHA-256", secretBytes);
        const secretHash   = Array.from(new Uint8Array(secretHashBytes)).map(b => b.toString(16).padStart(2, "0")).join("");
        const amountWei    = BigInt(Math.floor(amount * 1e18));
        const htlcLockTx   = buildHtlcLockTx({
          secretHash,
          recipient:   p2pQuote.counterpartyAddress ?? fromAddress, // peer's ETH address
          timelock:    htlcTimelock,
          amountWei:   fromSymbol === "ETH" ? amountWei : undefined,
          tokenAddress: (fromAsset && fromAsset.address !== "native") ? fromAsset.address ?? undefined : undefined,
          tokenAmount:  (fromAsset && fromAsset.address !== "native") ? BigInt(Math.floor(amount * Math.pow(10, fromAsset.decimals ?? 18))) : undefined,
        });
        // Record HTLC lock to DB (non-blocking)
        if (htlcLockTx) {
          void recordHtlcLock({
            chain:       "ethereum",
            htlcAddress: process.env.ETH_HTLC_ADDRESS ?? "pending",
            secretHash,
            amountRaw:   amountWei.toString(),
            amountHuman: `${amount} ${fromSymbol}`,
            locktime:    htlcTimelock,
            peerId:      p2pQuote.peerId ?? undefined,
            rfqId:       p2pQuote.rfqId  ?? undefined,
            toToken:     toSymbol,
            toChain:     toChain as "bitcoin" | "ethereum" | "solana",
            senderAddress: fromAddress,
          }).catch(() => {/* non-fatal */});
        }
        return {
          success:  true,
          route:    "IntercomSwap P2P" as const,
          p2pQuote,
          // htlcLockTx is non-null when ETH_HTLC_ADDRESS is set (contract deployed)
          tx:       htlcLockTx,
          secretHash: htlcLockTx ? secretHash : undefined,
          message:
            `IntercomSwap P2P peer matched (${p2pQuote.peerId ?? "peer"}). ` +
            `Rate: ${p2pQuote.rate ?? "N/A"}. ` +
            (htlcLockTx
              ? "HTLC lock transaction ready — sign with your Ethereum wallet to lock funds."
              : "The browser light peer will coordinate the Ethereum HTLC lock via Oracle VM."),
          nextStep:
            htlcLockTx
              ? `Call eth_sendTransaction with the returned { to, data, value } payload to lock ${amount} ${fromSymbol} in the HTLC contract. ` +
                "The counterparty will redeem by revealing the secret on the destination chain."
              : `P2P counterparty ${p2pQuote.peerId ?? "peer"} matched via IntercomSwap. ` +
                "Waiting for counterparty to lock their funds on the destination chain. " +
                "Once confirmed, the HTLC secret will be revealed to complete the atomic swap.",
        };
      }

      // ── Step 3: Fallback — 1inch aggregator ─────────────────────────────────
      // No P2P peer found. Build executable swap calldata via 1inch.
      const p2pRoute = "Direct 1inch (no P2P peer)";

      if (!fromAsset || !toAsset) {
        return {
          success:  false,
          route:    p2pRoute,
          p2pQuote: null,
          tx:       null,
          message:
            `Unsupported token pair: ${fromToken} → ${toToken} on ${fromChain}. ` +
            "Supported Ethereum tokens: ETH, USDT, USDC.",
        };
      }

      // Amount in smallest unit (wei for ETH, 6-decimal units for stables)
      const amountRaw = BigInt(
        Math.floor(amount * Math.pow(10, fromAsset.decimals))
      ).toString();

      const swapTx = await get1inchSwapTx(fromAsset, toAsset, amountRaw, fromAddress, slippage);

      if (swapTx) {
        // Record 1inch fallback swap event to analytics DB (non-blocking)
        void recordSwapAnalytic({
          fromChain:  fromChain as "solana" | "ethereum" | "bitcoin",
          toChain:    toChain   as "solana" | "ethereum" | "bitcoin",
          fromToken:  fromSymbol,
          toToken:    toSymbol,
          amount:     String(amount),
          route:      "1inch (Ethereum)",
          status:     "completed",
        }).catch(() => {/* non-fatal */});
        return {
          success:  true,
          route:    "1inch (Ethereum)" as const,
          p2pQuote: null,
          tx:       swapTx,
          message:
            `No P2P peer found — routing via 1inch aggregator. ` +
            `Swap ${amount} ${fromSymbol} → ${toSymbol} on Ethereum. ` +
            "Sign and broadcast the returned transaction with your Ethereum wallet.",
          nextStep:
            "Call eth_sendTransaction with the returned { to, data, value } payload " +
            "using window.ethereum or your connected wallet provider.",
        };
      }

      // ── Step 4: Final fallback — price estimate only ───────────────────────
      // 1inch also failed (rate limit / no API key). Return a descriptive error
      // so the frontend can show a helpful message.
      return {
        success:  false,
        route:    "unavailable" as const,
        p2pQuote: null,
        tx:       null,
        message:
          `No swap route available for ${fromSymbol} → ${toSymbol} at this time. ` +
          "IntercomSwap P2P found no matching peer, and 1inch aggregator is temporarily unavailable. " +
          "Please try again in a few seconds, or use the browser light peer for manual coordination.",
        hint: {
          procedure: "trpc.chat.executeEthSwap",
          suggestion: "Set ONEINCH_API_KEY env var for reliable 1inch access, or retry in 30s.",
        },
      };
    }),

  /**
   * Initiate a Bitcoin HTLC atomic swap via the agent.
   * Called when user confirms a BTC quote card in the chat.
   *
   * In demo mode (no BTC_HTLC_WIF env var), returns a simulated HTLC lock
   * with a demo txid so the full UI flow can be demonstrated.
   *
   * In production mode, delegates to trpc.btcHtlc.htlcLock which builds
   * and broadcasts the real P2WSH HTLC lock transaction.
   *
   * The browser light peer path (Phantom/Xverse/Tap Wallet) uses the
   * client-side btcHtlc.ts utilities and calls this only for the agent wallet.
   */
  executeBtcSwap: publicProcedure
    .input(
      z.object({
        /** Sender's Bitcoin address (agent or user wallet) */
        senderAddress: z.string(),
        /** Sender's compressed public key (33 bytes hex) — required for P2WSH script */
        senderPubKey: z.string().optional(),
        /** Counterparty's compressed public key (from RFQ response) */
        counterpartyPubKey: z.string().optional(),
        /** Amount in BTC (e.g. 0.001) */
        amountBtc: z.number().positive(),
        /** HTLC expiry window in hours (default: 24) */
        expiryHours: z.number().int().positive().default(24),
        /** Bitcoin network */
        network: z.enum(["mainnet", "testnet"]).default("mainnet"),
        /** Destination token for cross-chain swaps (e.g. "USDT", "SOL") */
        toToken: z.string().optional(),
        /** Destination chain for cross-chain swaps */
        toChain: z.enum(["bitcoin", "ethereum", "solana"]).optional(),
        /** Skip IntercomSwap P2P discovery and go straight to direct HTLC */
        skipP2P: z.boolean().optional().default(false),
      })
    )
    .mutation(async ({ input }) => {
      const { senderAddress, amountBtc, expiryHours, network, toToken, toChain, skipP2P } = input;
      const amountSats = Math.round(amountBtc * 1e8);

      // ── Step 1: IntercomSwap P2P discovery ────────────────────────────────
      // Submit an RFQ to the IntercomSwap P2P network and wait up to 8 seconds
      // for a counterparty quote. If a peer responds, use their pubkey for the
      // HTLC. If no peer responds, fall back to direct HTLC.
      const ORACLE_API = process.env.ORACLE_API_URL || "http://141.253.123.101:4000";
      let p2pQuote: {
        rfqId?: string;
        peerId?: string;
        counterpartyPubKey?: string;
        rate?: number;
        outAmount?: number;
        route?: string;
      } | null = null;

      if (!skipP2P && toToken) {
        try {
          console.log(`[BTC Agent] Submitting RFQ to IntercomSwap P2P: BTC → ${toToken} (${amountBtc} BTC)`);
          const rfqRes = await fetch(`${ORACLE_API}/api/rfq`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fromToken: "BTC",
              toToken: toToken.toUpperCase(),
              amount: amountBtc,
              fromChain: "bitcoin",
              toChain: toChain ?? "solana",
            }),
            signal: AbortSignal.timeout(8000),
          }).catch(() => null);

          if (rfqRes?.ok) {
            const rfqData = await rfqRes.json().catch(() => null) as {
              success?: boolean;
              result?: {
                rfqId?: string;
                id?: string;
                peerId?: string;
                responderId?: string;
                counterpartyPubKey?: string;
                peerPubKey?: string;
                rate?: number;
                price?: number;
                outAmount?: number;
                route?: string;
                p2pQuotes?: number;
              };
            } | null;

            if (rfqData?.success && rfqData?.result) {
              const r = rfqData.result;
              p2pQuote = {
                rfqId: r.rfqId ?? r.id,
                peerId: r.peerId ?? r.responderId,
                counterpartyPubKey: r.counterpartyPubKey ?? r.peerPubKey,
                rate: r.rate ?? r.price,
                outAmount: r.outAmount,
                route: r.route ?? ((r.p2pQuotes ?? 0) > 0 ? "p2p" : "dex"),
              };
              console.log(
                `[BTC Agent] P2P peer found: ${p2pQuote.peerId ?? "unknown"} ` +
                `rate=${p2pQuote.rate} rfqId=${p2pQuote.rfqId} route=${p2pQuote.route}`
              );
            } else {
              console.log("[BTC Agent] IntercomSwap returned no matching P2P peer.");
            }
          } else {
            console.log(`[BTC Agent] IntercomSwap RFQ request failed: ${rfqRes?.status ?? "timeout"}`);
          }
        } catch (err) {
          // P2P discovery failed — continue to direct HTLC fallback
          console.warn("[BTC Agent] IntercomSwap P2P discovery error:", err);
        }
      }

      // ── Step 2: Fetch current block height for locktime ───────────────────
      const mempoolBase = network === "testnet"
        ? "https://mempool.space/testnet/api"
        : "https://mempool.space/api";

      const blockRes = await fetch(`${mempoolBase}/blocks/tip/height`, {
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);
      const currentBlock = blockRes?.ok ? parseInt(await blockRes.text(), 10) : 840000;
      const locktime = currentBlock + Math.round(expiryHours * 6);

      // ── Step 3: Generate cryptographic HTLC secret ────────────────────────
      const secretBytes = new Uint8Array(32);
      crypto.getRandomValues(secretBytes);
      const secret = Array.from(secretBytes).map(b => b.toString(16).padStart(2, "0")).join("");
      const hashBuffer = await crypto.subtle.digest("SHA-256", secretBytes);
      const secretHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

      // BTC_HTLC_WIF is the dedicated HTLC escrow key; fall back to BTC_AGENT_WIF for backwards compatibility
      const agentWif = process.env.BTC_HTLC_WIF ?? process.env.BTC_AGENT_WIF;
      const p2pRoute = p2pQuote ? "IntercomSwap P2P" : "Direct HTLC (no P2P peer)";

      // Resolve counterparty pubkey: prefer P2P peer, then manual input
      const resolvedCounterpartyPubKey = p2pQuote?.counterpartyPubKey ?? input.counterpartyPubKey;

      if (!agentWif) {
        // ── BTC_HTLC_WIF required for HTLC signing ────────────────────────────────────
        return {
          success: false,
          demo: false,
          route: p2pRoute,
          p2pQuote: p2pQuote ?? undefined,
          txid: null,
          htlcAddress: null,
          nextStep: undefined,
          message:
            `BTC_HTLC_WIF is not configured. The platform operator must set this ` +
            `secret for Bitcoin HTLC escrow signing. Please contact the platform administrator.`,
        };
      }

      // ── Production mode ─────────────────────────────────────────────────────
      return {
        success: false,
        demo: false,
        route: p2pRoute,
        p2pQuote: p2pQuote ?? undefined,
        txid: null as string | null,
        htlcAddress: null as string | null,
        nextStep: undefined as string | undefined,
        message:
          "Production BTC HTLC: call trpc.btcHtlc.htlcLock with senderAddress, senderPubKey, " +
          "recipientPubKey, amountSats, expiryHours, and network for full on-chain execution." +
          (p2pQuote ? ` IntercomSwap P2P peer ${p2pQuote.peerId ?? ""} matched — using their pubkey as recipientPubKey.` : ""),
        hint: {
          procedure: "trpc.btcHtlc.htlcLock",
          params: {
            senderAddress,
            senderPubKey: input.senderPubKey,
            recipientPubKey: resolvedCounterpartyPubKey,
            amountSats,
            expiryHours,
            network,
            secretHash,
          },
        },
      };
    }),

  /**
   * executeAgentSwap — Server-side autonomous swap (multi-chain)
   *
   * Dispatches to the appropriate chain handler based on `fromChain`:
   *   solana   → Oracle VM RFQ → Jupiter DEX fallback (SOL_HTLC_KEY)
   *   ethereum → Oracle VM RFQ → 1inch DEX fallback  (ETH_HTLC_KEY)
   *   bitcoin  → Oracle VM RFQ → Direct HTLC fallback (BTC_HTLC_WIF)
   *
   * All paths follow the same P2P-first routing:
   *   1. Submit RFQ to IntercomSwap Oracle VM
   *   2. Execute via Oracle VM (P2P HTLC or DEX)
   *   3. Fall back to direct chain execution if Oracle VM unavailable
   *
   * Demo mode: returns simulated response when agent key is not configured.
   */
  executeAgentSwap: publicProcedure
    .input(
      z.object({
        fromToken: z.string().default("SOL"),
        toToken:   z.string().default("USDT"),
        amount:    z.number().positive(),
        fromChain: z.string().default("solana"),
        toChain:   z.string().default("solana"),
        /** Solana RPC URL — defaults to mainnet-beta */
        rpcUrl:    z.string().optional(),
        /** Bitcoin network — defaults to mainnet */
        btcNetwork: z.enum(["mainnet", "testnet"]).optional().default("mainnet"),
        /** BTC HTLC expiry in hours — defaults to 24 */
        btcExpiryHours: z.number().int().positive().optional().default(24),
        /** Manus OAuth openId — used to enforce per-user settings (maxTxAmountUsd, preferredRoute) */
        openId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { fromToken, toToken, amount, fromChain, toChain, rpcUrl, btcNetwork, btcExpiryHours, openId } = input;

      // ── Load user settings & enforce limits ───────────────────────────────
      const userPrefs = openId ? await getUserSettings(openId) : DEFAULT_USER_SETTINGS;

      // Hard reject: amount exceeds user's maxTxAmountUsd
      const { prices: pricesForCheck } = await getTokenPricesWithSource();
      const fromPriceCheck = pricesForCheck[fromToken.toUpperCase()] ?? (fromToken.toUpperCase().includes("USD") ? 1 : 0);
      const estimatedUsd = amount * fromPriceCheck;
      if (estimatedUsd > userPrefs.maxTxAmountUsd) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            `Swap amount (~$${estimatedUsd.toFixed(2)}) exceeds your maximum transaction limit ` +
            `of $${userPrefs.maxTxAmountUsd}. Increase your limit in Settings or reduce the amount.`,
        });
      }

      // ── Chain dispatcher ──────────────────────────────────────────────────
      const chain = fromChain.toLowerCase();

      // ── Apply preferredRoute: skip P2P when user prefers a specific DEX ────
      // preferredRoute "best" = P2P-first (default behaviour)
      // preferredRoute "jupiter"     = skip P2P, go straight to Jupiter (Solana only)
      // preferredRoute "oneinch"     = skip P2P, go straight to 1inch (Ethereum only)
      // preferredRoute "intercomswap" = force P2P, throw if no peer found
      const preferredRoute = userPrefs.preferredRoute;

      // ── Ethereum path ─────────────────────────────────────────────────────
      if (chain === "ethereum") {
        const ethResult = await executeEthAgentSwap({ fromToken, toToken, amount, fromChain, toChain });
        return {
          success:      ethResult.success,
          demo:         ethResult.demo,
          txHash:       ethResult.txHash,
          outAmount:    ethResult.outAmount,
          route:        ethResult.route,
          agentAddress: ethResult.agentAddress,
          solscanUrl:   ethResult.explorerUrl,  // reuse solscanUrl field for explorer URL
          feeBps:       ethResult.feeBps,
          feeAmountOut: ethResult.feeAmountOut,
          chain:        "ethereum" as const,
          message:      ethResult.message,
        };
      }

      // ── Bitcoin path ──────────────────────────────────────────────────────
      if (chain === "bitcoin") {
        const btcResult = await executeBtcAgentSwap({
          fromToken,
          toToken,
          amount,
          toChain,
          expiryHours: btcExpiryHours,
          network:     btcNetwork,
        });
        return {
          success:      btcResult.success,
          demo:         btcResult.demo,
          txHash:       btcResult.txid,
          outAmount:    btcResult.outAmount,
          route:        btcResult.route,
          agentAddress: btcResult.agentAddress,
          solscanUrl:   btcResult.explorerUrl,  // reuse solscanUrl field for explorer URL
          feeBps:       btcResult.feeBps,
          feeAmountOut: btcResult.feeAmountOut,
          chain:        "bitcoin" as const,
          htlcAddress:  btcResult.htlcAddress,
          secretHash:   btcResult.secretHash,
          nextStep:     btcResult.nextStep,
          message:      btcResult.message,
        };
      }

      // ── Solana path (default) ─────────────────────────────────────────────
      const ORACLE_API = process.env.ORACLE_API_URL || "http://141.253.123.101:4000";
      // SOL_HTLC_KEY is the dedicated HTLC escrow key; fall back to SOL_AGENT_KEY for backwards compatibility
      const agentKeyRaw = process.env.SOL_HTLC_KEY ?? process.env.SOL_AGENT_KEY;

      // ── SOL_HTLC_KEY required for HTLC signing ────────────────────────────
      if (!agentKeyRaw) {
        return {
          success: false,
          demo: false,
          txHash: null,
          outAmount: null,
          route: "Error",
          agentAddress: null,
          solscanUrl: null,
          chain: "solana" as const,
          message:
            `SOL_HTLC_KEY is not configured. The platform operator must set this ` +
            `secret for HTLC escrow signing. Please contact the platform administrator.`,
        };
      }

      // ── Decode HTLC escrow keypair ─────────────────────────────────────────
      let agentKeypair: Keypair;
      try {
        const keyBytes = bs58.decode(agentKeyRaw);
        agentKeypair = Keypair.fromSecretKey(keyBytes);
      } catch {
        return {
          success: false,
          demo: false,
          txHash: null,
          outAmount: null,
          route: "Error",
          agentAddress: null,
          solscanUrl: null,
          message: "SOL_HTLC_KEY is invalid — must be a base58-encoded 64-byte Solana private key.",
        };
      }

      const agentAddress = agentKeypair.publicKey.toBase58();
      const solRpcUrl = rpcUrl ?? process.env.SOL_RPC_URL ?? "https://api.mainnet-beta.solana.com";
      const connection = new Connection(solRpcUrl, "confirmed");

      // ── Step 1: Submit RFQ to Oracle VM (P2P discovery) ───────────────────
      // Respect user's preferredRoute setting:
      //   "jupiter"      → skip P2P entirely, go straight to Jupiter fallback
      //   "intercomswap" → force P2P; throw if no peer found
      //   "best" / "oneinch" → default P2P-first behaviour
      const skipP2PForRoute = preferredRoute === "jupiter";
      const forceP2P        = preferredRoute === "intercomswap";
      // Slippage from user settings (pct → bps)
      const userSlippageBps = Math.round(parseFloat(userPrefs.slippagePct) * 100);

      console.log(`[Agent Swap] Step 1: Submitting RFQ to Oracle VM — ${amount} ${fromToken} → ${toToken} (preferredRoute=${preferredRoute})`);
      let rfqId: string | null = null;
      let oracleRoute: string | null = null;
      let oracleOutAmount: number | null = null;

      if (!skipP2PForRoute) try {
        const rfqRes = await fetch(`${ORACLE_API}/api/rfq`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromToken: fromToken.toUpperCase(),
            toToken:   toToken.toUpperCase(),
            amount,
            fromChain,
            toChain,
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (rfqRes.ok) {
          const rfqData = await rfqRes.json() as {
            success?: boolean;
            result?: {
              rfqId?: string;
              route?: string;
              outAmount?: number;
              p2pQuotes?: number;
              dexRoute?: string;
            };
          };
          if (rfqData?.success && rfqData?.result?.rfqId) {
            rfqId          = rfqData.result.rfqId;
            oracleRoute    = rfqData.result.route ?? "dex";
            oracleOutAmount = rfqData.result.outAmount ?? null;
            const p2pCount = rfqData.result.p2pQuotes ?? 0;
            console.log(`[Agent Swap] RFQ ${rfqId} — route=${oracleRoute}, p2pQuotes=${p2pCount}, outAmount=${oracleOutAmount}`);
          }
        }
      } catch (err) {
        console.warn("[Agent Swap] Oracle VM RFQ failed (will fall back to direct Jupiter):", err);
      }

         // ── forceP2P: if user requires IntercomSwap and no peer found, reject ───────
      if (forceP2P && !rfqId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Your preferred route is set to IntercomSwap P2P, but no peer was found for this swap. " +
            "Try again in a moment or change your preferred route to \"Best Available\" in Settings.",
        });
      }

      // ── Step 2: Execute via Oracle VM (P2P or DEX) ────────────────────
      if (rfqId) {
        console.log(`[Agent Swap] Step 2: Executing via Oracle VM — rfqId=${rfqId}, route=${oracleRoute}`);
        try {
          const execRes = await fetch(`${ORACLE_API}/api/swap/execute`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rfqId, userAddress: agentAddress }),
            signal: AbortSignal.timeout(30000),
          });
          if (execRes.ok) {
            const execData = await execRes.json() as {
              success?: boolean;
              swap?: {
                rfqId?: string;
                route?: string;
                outAmount?: number;
                txHash?: string;
                status?: string;
                dexRoute?: string;
              };
              error?: string;
            };
            if (execData?.success && execData?.swap) {
              const swap = execData.swap;
              const finalRoute = swap.route === "p2p"
                ? "IntercomSwap P2P"
                : `Jupiter DEX (${swap.dexRoute ?? "aggregator"})`;
              const finalOutAmount = swap.outAmount ?? oracleOutAmount ?? 0;
              const txHash = swap.txHash ?? null;
              const solscanUrl = txHash ? `https://solscan.io/tx/${txHash}` : null;

              // Record analytics with fee data
              const isP2PRoute = swap.route === "p2p";
              const feeBps = isP2PRoute ? 15 : 20;
              const feeAmountOut = finalOutAmount * (feeBps / 10000);
              void recordSwapAnalytic({
                fromChain:      fromChain as "solana" | "ethereum" | "bitcoin",
                toChain:        toChain   as "solana" | "ethereum" | "bitcoin",
                fromToken:      fromToken.toUpperCase(),
                toToken:        toToken.toUpperCase(),
                amount:         String(amount),
                route:          finalRoute,
                status:         "completed",
                feeBps,
                feeAmountOut:   String(feeAmountOut.toFixed(8)),
              }).catch(() => {/* non-fatal */});

              console.log(`[Agent Swap] ✅ Oracle VM executed: ${amount} ${fromToken} → ${finalOutAmount} ${toToken} | route=${finalRoute}${txHash ? ` | tx=${txHash}` : ""}`);

              return {
                success: true,
                demo: false,
                txHash,
                outAmount: finalOutAmount,
                route: finalRoute,
                agentAddress,
                solscanUrl,
                message: txHash
                  ? `Swap executed via ${finalRoute}: ${amount} ${fromToken} → ${finalOutAmount.toFixed(4)} ${toToken}. Tx: ${txHash}`
                  : `Swap executed via ${finalRoute}: ${amount} ${fromToken} → ${finalOutAmount.toFixed(4)} ${toToken}. Status: ${swap.status ?? "completed"}.`,
              };
            }
            console.warn(`[Agent Swap] Oracle VM execute returned error: ${execData?.error ?? "unknown"}`);
          }
        } catch (err) {
          console.warn("[Agent Swap] Oracle VM execute failed (will fall back to direct Jupiter):", err);
        }
      }

      // ── Step 3: Direct Jupiter fallback (same-chain only) ───────────────────
      // Cross-chain swaps (e.g., SOL→ETH, SOL→BTC) MUST go through Oracle VM P2P.
      // Jupiter only supports same-chain (Solana→Solana) swaps.
      const isCrossChainSol = fromChain.toLowerCase() !== toChain.toLowerCase();
      if (isCrossChainSol) {
        console.log(`[Agent Swap] Cross-chain swap (${fromChain}→${toChain}) — Oracle VM required, no Jupiter fallback`);
        return {
          success: false,
          demo: false,
          txHash: null,
          outAmount: oracleOutAmount,
          route: "IntercomSwap P2P (cross-chain)",
          agentAddress,
          solscanUrl: null,
          chain: "solana" as const,
          message:
            `Cross-chain swap ${fromToken} (${fromChain}) → ${toToken} (${toChain}) requires IntercomSwap P2P. ` +
            `The Oracle VM was unreachable or returned no match. Please try again in a moment — ` +
            `the P2P network may need more peers for this pair.`,
        };
      }

      console.log(`[Agent Swap] Step 3: Falling back to direct Jupiter signing (Oracle VM unavailable)`);

      const fromAsset = getAsset(fromToken.toUpperCase(), "solana");
      const toAsset   = getAsset(toToken.toUpperCase(),   "solana");
      if (!fromAsset || !toAsset) {
        return {
          success: false,
          demo: false,
          txHash: null,
          outAmount: null,
          route: "Jupiter DEX",
          agentAddress,
          solscanUrl: null,
          message: `Unsupported token pair for direct Jupiter: ${fromToken} → ${toToken}. Supported: SOL, USDT, USDC.`,
        };
      }

      const amountRaw = Math.floor(amount * Math.pow(10, fromAsset.decimals));
      const jupQuote = await getJupiterQuote(fromAsset, toAsset, amountRaw, userSlippageBps);
      if (!jupQuote) {
        return {
          success: false,
          demo: false,
          txHash: null,
          outAmount: oracleOutAmount,
          route: "Jupiter DEX",
          agentAddress,
          solscanUrl: null,
          message: "Failed to fetch Jupiter quote. Check token addresses and try again.",
        };
      }

      const jupOutAmountRaw = Number((jupQuote as Record<string, unknown>).outAmount ?? 0);
      const jupOutAmount = jupOutAmountRaw / Math.pow(10, toAsset.decimals);

      const swapResult = await getJupiterSwapTx(jupQuote, agentAddress);
      if (!swapResult?.swapTransaction) {
        return {
          success: false,
          demo: false,
          txHash: null,
          outAmount: jupOutAmount,
          route: "Jupiter DEX",
          agentAddress,
          solscanUrl: null,
          message: "Failed to build Jupiter swap transaction. The agent wallet may have insufficient SOL for fees (need ≥0.01 SOL).",
        };
      }

      try {
        const txBuffer = Buffer.from(swapResult.swapTransaction, "base64");
        const tx = VersionedTransaction.deserialize(txBuffer);
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        tx.message.recentBlockhash = blockhash;
        tx.sign([agentKeypair]);
        const rawTx = tx.serialize();
        const txHash = await connection.sendRawTransaction(rawTx, {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        });
        const confirmation = await connection.confirmTransaction(
          { signature: txHash, blockhash, lastValidBlockHeight },
          "confirmed"
        );
        if (confirmation.value.err) {
          return {
            success: false,
            demo: false,
            txHash,
            outAmount: jupOutAmount,
            route: "Jupiter DEX",
            agentAddress,
            solscanUrl: `https://solscan.io/tx/${txHash}`,
            message: `Transaction submitted but failed on-chain: ${JSON.stringify(confirmation.value.err)}`,
          };
        }
        // Jupiter DEX: 0.20% fee via referral
        const jupFeeAmountOut = jupOutAmount * (PLATFORM_FEE_BPS / 10000);
        void recordSwapAnalytic({
          fromChain:    "solana",
          toChain:      "solana",
          fromToken:    fromToken.toUpperCase(),
          toToken:      toToken.toUpperCase(),
          amount:       String(amount),
          route:        "Jupiter DEX (agent direct)",
          status:       "completed",
          feeBps:       PLATFORM_FEE_BPS,
          feeAmountOut: String(jupFeeAmountOut.toFixed(8)),
        }).catch(() => {/* non-fatal */});
        console.log(`[Agent Swap] ✅ Direct Jupiter: ${amount} ${fromToken} → ${jupOutAmount.toFixed(4)} ${toToken} | Tx: ${txHash}`);
        return {
          success: true,
          demo: false,
          txHash,
          outAmount: jupOutAmount,
          route: "Jupiter DEX (direct)",
          agentAddress,
          solscanUrl: `https://solscan.io/tx/${txHash}`,
          message: `Swap executed via Jupiter DEX: ${amount} ${fromToken} → ${jupOutAmount.toFixed(4)} ${toToken}. Tx: ${txHash}`,
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Agent Swap] ❌ Direct Jupiter broadcast failed: ${errMsg}`);
        return {
          success: false,
          demo: false,
          txHash: null,
          outAmount: jupOutAmount,
          route: "Jupiter DEX",
          agentAddress,
          solscanUrl: null,
          message: `Swap transaction failed: ${errMsg.slice(0, 200)}`,
        };
      }
    }),
});
