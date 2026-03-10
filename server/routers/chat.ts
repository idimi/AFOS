/**
 * AFOS Conversational Agent Router — Multi-Chain v3 (Unified P2P-First Architecture)
 *
 * All three chains follow the same pattern:
 *   PRIMARY: AFOS P2P network (agent-coordinated, no Oracle VM)
 *   FALLBACK: Chain-specific aggregator
 *
 * Routing per chain:
 *   Solana:   AFOS P2P → Jupiter DEX fallback
 *   Ethereum: AFOS P2P → 0x Protocol (primary DEX) → 1inch (fallback, requires ONEINCH_API_KEY)
 *   Bitcoin:  AFOS P2P → Direct HTLC (mempool.space) fallback
 *
 * Execution procedures:
 *   buildSwapTx      — Solana swaps (P2P primary + Jupiter fallback)
 *   executeEthSwap   — Ethereum swaps (P2P primary + 0x DEX + 1inch fallback)
 *   executeBtcSwap   — Bitcoin swaps (P2P primary + direct HTLC fallback)
 *
 * Flow:
 *   1. Parse user intent with LLM (fromToken, toToken, fromChain, toChain, amount)
 *   2. Fetch real quote from the appropriate DEX/aggregator
 *   3. Return structured quote_card response for frontend confirmation
 *   4. On confirmation: match peer via AFOS P2P signaling → fallback to chain aggregator
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
import { executeBtcAgentSwap, executeTnkAgentSwap } from "../agentSwapBtc";
import { getUserSettings, saveHtlcSecret, getHtlcSecret, updateHtlcSecretStatus, getSettledHtlcSecrets } from "../db";
import { DEFAULT_USER_SETTINGS } from "../../drizzle/schema";
import { getSignalingPeerList, sendToPeer, broadcastRfqToAll } from "../signaling";
import { notifyOwner } from "../_core/notification";

// ─── Token / chain config ──────────────────────────────────────────────────────

import type { SupportedChain } from "@shared/const";

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
  { symbol: "TNK",  chain: "trac_network", address: null,                                         decimals: 8,  isStable: false },
];

function getAsset(symbol: string, chain: SupportedChain): AssetDef | undefined {
  return ASSETS.find(a => a.symbol === symbol && a.chain === chain);
}

/** Infer the default chain for a token symbol */
function defaultChain(symbol: string): SupportedChain {
  if (symbol === "ETH") return "ethereum";
  if (symbol === "BTC") return "bitcoin";
  if (symbol === "TNK") return "trac_network";
  return "solana";
}

// ─── Jupiter (Solana DEX) ─────────────────────────────────────────────────────

const JUPITER_QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
const JUPITER_SWAP_URL  = "https://lite-api.jup.ag/swap/v1/swap";
const PLATFORM_FEE_BPS  = 20;  // 0.20% — DEX fallback (Jupiter/0x/1inch referral, collected on-chain)
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

// ─── 0x Protocol (primary Ethereum DEX aggregator) ──────────────────────────
const ZEROX_BASE = "https://api.0x.org/swap/permit2";

async function getZeroxPrice(
  sellTokenAddr: string,
  buyTokenAddr:  string,
  sellAmountRaw: string,
): Promise<{ buyAmount: string } | null> {
  const key = process.env.ZEROX_API_KEY;
  if (!key) return null;
  try {
    const params = new URLSearchParams({
      chainId:    "1",
      sellToken:  sellTokenAddr,
      buyToken:   buyTokenAddr,
      sellAmount: sellAmountRaw,
    });
    const res = await fetch(`${ZEROX_BASE}/price?${params}`, {
      headers: { "0x-api-key": key, "0x-version": "v2", Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) { console.warn("[0x] Price failed:", res.status); return null; }
    return await res.json() as { buyAmount: string };
  } catch (err) {
    console.warn("[0x] Price error:", err);
    return null;
  }
}

// ─── 1inch (Ethereum DEX fallback — requires ONEINCH_API_KEY) ────────────────
// Kept in code and ready to activate once ONEINCH_API_KEY is provided.

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

// ─── Agent P2P Peer Matching (Signaling Server — no Oracle VM needed) ──────────
// Used by all three chain execution procedures (Solana, Ethereum, Bitcoin)

interface P2PQuoteResult {
  rfqId?: string;
  peerId?: string;
  peerAlias?: string;
  counterpartyPubKey?: string;
  counterpartyAddress?: string;
  counterpartyWallets?: { solana?: string; ethereum?: string; bitcoin?: string };
  rate?: number;
  outAmount?: number;
  route?: string;
}

/**
 * Find a matching light peer from the in-memory signaling server registry.
 *
 * A peer matches when:
 *  - They are registered on the signaling server (live WebSocket connection)
 *  - They have declared the reverse pair (e.g. user wants SOL→USDT, peer has USDT/SOL)
 *  - They are not the requesting user (different peerId / wallet)
 *
 * This replaces the Oracle VM RFQ entirely — no external server needed.
 * The signaling server is built into the AFOS backend.
 */
function findSignalingPeer(params: {
  fromToken: string;
  toToken: string;
  fromChain: string;
  toChain: string;
  amount: number;
  prices: Record<string, number>;
  senderPeerId?: string;
  senderWallet?: string;
}): P2PQuoteResult | null {
  const { fromToken, toToken, fromChain, toChain, amount, prices, senderPeerId, senderWallet } = params;

  const peers = getSignalingPeerList();
  if (peers.length === 0) return null;

  // The pair the requester wants: they give fromToken, they want toToken
  // A matching peer must offer the reverse: they give toToken, they want fromToken
  const wantedPair   = `${toToken}/${fromToken}`;   // peer offers toToken in exchange for fromToken
  const altPair      = `${fromToken}/${toToken}`;   // some peers list both directions
  const crossChain   = fromChain !== toChain;

  for (const peer of peers) {
    // Skip the requesting user's own peer
    if (senderPeerId && peer.peerId === senderPeerId) continue;
    if (senderWallet) {
      const wallets = Object.values(peer.walletAddresses ?? {});
      if (wallets.some(w => w?.toLowerCase() === senderWallet.toLowerCase())) continue;
    }

    const hasPair = peer.pairs.some(p => {
      const norm = p.toUpperCase();
      return norm === wantedPair || norm === altPair ||
        // Cross-chain: accept any pair involving both tokens regardless of chain suffix
        (crossChain && (norm.includes(fromToken) || norm.includes(toToken)));
    });

    if (!hasPair) continue;

    // Calculate the rate based on live prices
    const fromPrice = prices[fromToken.toUpperCase()] ?? (fromToken.includes("USD") ? 1 : 0);
    const toPrice   = prices[toToken.toUpperCase()]   ?? (toToken.includes("USD")   ? 1 : 0);
    if (!fromPrice || !toPrice) continue;

    const rate      = fromPrice / toPrice;
    const outAmount = amount * rate * (1 - P2P_FEE_BPS / 10000); // apply P2P fee
    const rfqId     = `rfq_${Date.now()}_${peer.peerId.slice(0, 8)}`;

    console.log(
      `[AFOS Agent] P2P peer matched from signaling registry: ${peer.alias} (${peer.peerId.slice(0, 12)}…) ` +
      `pair=${wantedPair} rate=${rate.toFixed(6)} outAmount=${outAmount.toFixed(6)}`
    );

    return {
      rfqId,
      peerId:              peer.peerId,
      peerAlias:           peer.alias,
      counterpartyWallets: peer.walletAddresses,
      counterpartyPubKey:  peer.walletAddresses?.solana,
      counterpartyAddress: peer.walletAddresses?.ethereum ?? peer.walletAddresses?.bitcoin,
      rate,
      outAmount,
      route:               crossChain ? "AFOS P2P (cross-chain)" : "AFOS P2P",
    };
  }

  console.log(`[AFOS Agent] No signaling peer found for ${fromToken}→${toToken}. Falling back to DEX.`);
  return null;
}

/**
 * Push an agent RFQ notification to the matched peer via the signaling server WebSocket.
 * The peer's browser receives this as an `agent_rfq` message and shows an incoming swap card.
 */
function sendAgentRfqToPeer(params: {
  rfqId: string;
  targetPeerId: string;
  fromToken: string;
  toToken: string;
  fromChain: string;
  toChain: string;
  amount: number;
  outAmount: number;
  rate: number;
  requesterAlias?: string;
  requesterPeerId?: string;
  requesterWallet?: string;
  expiresAt: number;
  /** SHA-256 hash of the HTLC secret (hex). Agent B MUST lock to this hash so the swap is atomic. */
  secretHashHex?: string;
}): boolean {
  const delivered = sendToPeer(params.targetPeerId, {
    type:            "agent_rfq",
    rfqId:           params.rfqId,
    fromToken:       params.fromToken,
    toToken:         params.toToken,
    fromChain:       params.fromChain,
    toChain:         params.toChain,
    amount:          params.amount,
    outAmount:       params.outAmount,
    rate:            params.rate,
    requesterAlias:  params.requesterAlias ?? "Anonymous",
    requesterPeerId: params.requesterPeerId,
    requesterWallet: params.requesterWallet,
    expiresAt:       params.expiresAt,
    // Critical for atomicity: Agent B must lock to this exact hash
    secretHashHex:   params.secretHashHex,
    timestamp:       Date.now(),
  });
  // Push notification for swap activity
  void notifyOwner({
    title: `P2P Swap RFQ ${delivered ? "Sent" : "Failed"}`,
    content: `${params.amount} ${params.fromToken} → ${params.outAmount.toFixed(4)} ${params.toToken} @ rate ${params.rate.toFixed(6)} — ${delivered ? `delivered to @${params.targetPeerId.slice(0, 12)}` : `peer @${params.targetPeerId.slice(0, 12)} offline`}`,
  }).catch(() => {});
  return delivered;
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

/** Fetch live TNK price from Gate.io (same source as the Oracle VM, updated every 30s). */
async function getTnkPriceFromGateio(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.gateio.ws/api/v4/spot/tickers?currency_pair=TNK_USDT",
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as { last?: string }[];
    if (!Array.isArray(data) || !data[0]?.last) return null;
    const price = parseFloat(data[0].last);
    return price > 0 ? price : null;
  } catch {
    return null;
  }
}

async function getTokenPricesFromCoinGecko(): Promise<Record<string, number> | null> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana,ethereum,bitcoin,trac-network&vs_currencies=usd",
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as {
      solana?: { usd: number };
      ethereum?: { usd: number };
      bitcoin?: { usd: number };
      "trac-network"?: { usd: number };
    };
    const sol = data.solana?.usd;
    if (!sol || sol < 1) return null;
    // Prefer Gate.io for TNK (more liquid, faster updates) over CoinGecko
    const tnkLive = await getTnkPriceFromGateio();
    return {
      SOL:  sol,
      ETH:  data.ethereum?.usd ?? 2000,
      BTC:  data.bitcoin?.usd  ?? 66000,
      TNK:  tnkLive ?? data["trac-network"]?.usd ?? 0.28,
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
    // TNK is not on Binance; fetch from Gate.io instead
    const tnkLive = await getTnkPriceFromGateio();
    prices.TNK = tnkLive ?? 0.28;
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
  const tnkLive = await getTnkPriceFromGateio();
  const fallback = { SOL: 85, ETH: 1970, BTC: 66000, TNK: tnkLive ?? 0.28, USDT: 1, USDC: 1 };
  return { prices: fallback, source: tnkLive ? "Gate.io (TNK) + approximate (SOL/ETH/BTC)" : "approximate (APIs unavailable)" };
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
  Solana chain:        SOL, USDT, USDC
  Ethereum chain:      ETH, USDT_ETH (USDT on Ethereum), USDC_ETH (USDC on Ethereum)
  Bitcoin chain:       BTC
  Trac Network chain:  TNK

Routing:
  - Solana swaps (SOL/USDT/USDC) → Jupiter DEX (instant, on-chain)
  - Ethereum swaps (ETH/USDT_ETH/USDC_ETH) → 1inch aggregator + AFOS P2P
  - Bitcoin swaps (BTC) → AFOS P2P network
  - Trac Network swaps (TNK) → AFOS P2P HTLC (agent-escrow model, ~5–10m)
  - Cross-chain swaps → AFOS P2P bridge

Current live prices (source: ${priceSource ?? "live"}): ${JSON.stringify(prices)}
${walletBalances ? `User wallet balances: ${JSON.stringify(walletBalances)}` : ""}

Parse the user message and return ONLY a JSON object with this exact schema:
{
  "type": "swap" | "price_check" | "balance_check" | "general",
  "fromToken": "SOL" | "USDT" | "USDC" | "ETH" | "USDT_ETH" | "USDC_ETH" | "BTC" | "TNK" | null,
  "fromChain": SupportedChain | null,
  "toToken": "SOL" | "USDT" | "USDC" | "ETH" | "USDT_ETH" | "USDC_ETH" | "BTC" | "TNK" | null,
  "toChain": SupportedChain | null,
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
- "TNK" or "Trac Network" → fromToken: TNK, fromChain: trac_network
- "swap 100 TNK to SOL" → fromToken: TNK, fromChain: trac_network, toToken: SOL, toChain: solana
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

  // ── Ethereum → Ethereum: 0x Protocol (primary) → 1inch (fallback) ──────────
  if (fromAsset.chain === "ethereum" && toAsset.chain === "ethereum") {
    const amountRaw = BigInt(Math.floor(swapAmount * Math.pow(10, fromAsset.decimals))).toString();
    const ethNativeAddr = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
    const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    // 0x v2 uses WETH address for native ETH
    const sell0x = (fromAsset.address ?? ethNativeAddr).toLowerCase() === ethNativeAddr.toLowerCase() ? WETH : (fromAsset.address ?? ethNativeAddr);
    const buy0x  = (toAsset.address ?? ethNativeAddr).toLowerCase() === ethNativeAddr.toLowerCase() ? WETH : (toAsset.address ?? ethNativeAddr);
    // Try 0x Protocol first (primary DEX, no KYC)
    const q0x = await getZeroxPrice(
      sell0x,
      buy0x,
      amountRaw,
    );
    if (q0x) {
      const toAmountHuman  = parseInt(q0x.buyAmount) / Math.pow(10, toAsset.decimals);
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
        route:          "0x Protocol (Ethereum)",
        rawQuote:       q0x,
      };
    }
    // Try 1inch as fallback (requires ONEINCH_API_KEY)
    const q1inch = await get1inchQuote(fromAsset, toAsset, amountRaw);
    if (q1inch) {
      const toAmountHuman  = parseInt(q1inch.toAmount) / Math.pow(10, toAsset.decimals);
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
        route:          "1inch (Ethereum, fallback)",
        rawQuote:       q1inch,
      };
    }
    // Final fallback: estimate via prices — P2P fee (0.15%) applies
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
      route:          "AFOS P2P (Ethereum)",
      rawQuote:       null,
    };
  }

  // ── Cross-chain or Bitcoin: AFOS P2P — 0.15% output-side fee ────────
  const estimatedOut   = (swapAmount * fromPrice) / (toPrice || 1);
  const platformFeeOut = estimatedOut * (P2P_FEE_BPS / 10000);
  const netToAmount    = estimatedOut - platformFeeOut;
  const platformFee    = swapAmount * (P2P_FEE_BPS / 10000);
  const routeLabel = fromAsset.chain === "bitcoin" || toAsset.chain === "bitcoin"
    ? "AFOS P2P (Bitcoin bridge)"
    : "AFOS P2P (cross-chain)";

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
   *
   * P2P-first flow:
   *  1. Parse intent
   *  2. Search signaling server for a matching peer (no Oracle VM)
   *  3a. Peer found → push agent_rfq to peer, return quote_card with p2p route + peer info
   *  3b. No peer → build DEX quote (Jupiter / 0x / 1inch) and return quote_card
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
        /** Sender's signaling peerId — used to exclude them from peer matching */
        senderPeerId:   z.string().optional(),
        /** Sender's peer alias — shown to the counterparty in the incoming RFQ card */
        senderAlias:    z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { message, history, walletBalances, openId, walletAddress: senderWalletAddress, senderPeerId, senderAlias } = input;

      // Load user settings (non-blocking — falls back to defaults if DB unavailable)
      const userPrefs = openId ? await getUserSettings(openId) : DEFAULT_USER_SETTINGS;
      const slippageBps = Math.round(parseFloat(userPrefs.slippagePct) * 100); // e.g. 0.5% → 50 bps

      const { prices, source: priceSource } = await getTokenPricesWithSource();
      const intent = await parseIntent(message, history, prices, walletBalances, priceSource);

      // ── Handle accept/decline RFQ from counterparty (User B) ──────────────────────────
      const acceptMatch = message.match(/accept\s+swap.*rfq:([\w_]+)/i);
      const declineMatch = message.match(/decline\s+swap.*rfq:([\w_]+)/i);
      if (acceptMatch) {
        const rfqId = acceptMatch[1];
        return {
          type: "text" as const,
          content: `Great! I'm coordinating the HTLC atomic swap for RFQ \`${rfqId}\`. The requester will be notified and both sides will be guided through signing. Please connect your wallet if you haven't already, and I'll walk you through locking your side of the swap.`,
        };
      }
      if (declineMatch) {
        const rfqId = declineMatch[1];
        return {
          type: "text" as const,
          content: `Understood — I've declined the swap request (RFQ \`${rfqId.slice(0, 12)}…\`). The requester will be notified and I'll route their swap via DEX instead.`,
        };
      }

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
          content: `I don't recognise the token pair ${fromToken} → ${toToken}. Supported: SOL, USDT, USDC (Solana), ETH, USDT/USDC (Ethereum), BTC (Bitcoin), TNK (Trac Network).`,
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

      // Near-limit soft warning (90–99% of limit) — shown as banner inside QuoteCard
      const nearLimitWarning = (estimatedUsd >= userPrefs.maxTxAmountUsd * 0.9 && estimatedUsd <= userPrefs.maxTxAmountUsd)
        ? `This swap (~$${estimatedUsd.toFixed(2)}) is close to your $${userPrefs.maxTxAmountUsd} transaction limit.`
        : undefined;

      // ── Quote-only phase: NO peer matching, NO RFQ broadcast yet ─────────────────────
      // Peer matching and RFQ broadcast happen ONLY when the user clicks "Confirm Swap".
      // This prevents peers from waiting before the user has reviewed and approved the quote.
      const skipP2P = userPrefs.preferredRoute === "jupiter" || userPrefs.preferredRoute === "zerox";

      // Peek at online peers to show an estimated P2P rate — but do NOT notify them yet.
      const p2pEstimate: P2PQuoteResult | null = !skipP2P
        ? findSignalingPeer({
            fromToken:    from.symbol,
            toToken:      to.symbol,
            fromChain:    from.chain,
            toChain:      to.chain,
            amount:       swapAmount,
            prices,
            senderPeerId: senderPeerId,
            senderWallet: senderWalletAddress,
          })
        : null;

      // Build DEX quote as baseline (used when no P2P peer is available, or as fallback)
      const quoteResult = await buildQuote(fromAsset, toAsset, swapAmount, prices, slippageBps);
      if ("error" in quoteResult) {
        return { type: "text" as const, content: quoteResult.error };
      }

      // If a P2P peer is available, show their estimated rate in the quote card.
      // The peer is NOT notified yet — notification happens on Confirm.
      const finalToAmount   = p2pEstimate?.outAmount ?? quoteResult.toAmount;
      const finalRate       = p2pEstimate?.rate       ?? quoteResult.rate;
      const finalFeeBps     = p2pEstimate ? P2P_FEE_BPS : quoteResult.feeBps;
      const finalFeeToken   = quoteResult.feeToken;
      const peerLabel       = p2pEstimate?.peerAlias ?? p2pEstimate?.peerId?.slice(0, 8) ?? "peer";
      const finalRoute      = p2pEstimate
        ? `AFOS P2P — matched @${peerLabel}`
        : quoteResult.route;

      return {
        type: "quote_card" as const,
        content: p2pEstimate
          ? `P2P peer available (@${peerLabel}). Review the quote and click **Confirm Swap** to proceed.`
          : skipP2P
            ? `Here's your swap quote for ${swapAmount} ${from.symbol} → ${to.symbol}:`
            : `Here's the best rate for ${swapAmount} ${from.symbol} → ${to.symbol}. Click **Confirm Swap** to proceed.`,
        limitWarning: nearLimitWarning,
        // p2pPeer carries the estimated match info — peer is NOT notified until Confirm
        p2pPeer: p2pEstimate ? {
          peerId:        p2pEstimate.peerId,
          alias:         p2pEstimate.peerAlias,
          rfqId:         p2pEstimate.rfqId,
          wallets:       p2pEstimate.counterpartyWallets,
          delivered:     false, // will be set to true after Confirm
          expiresAt:     Date.now() + 120_000, // 2 min to review quote
          secretHashHex: "",   // generated on Confirm
        } : null,
        quoteData: {
          fromToken:      from.symbol,
          fromChain:      from.chain,
          toToken:        to.symbol,
          toChain:        to.chain,
          fromAmount:     swapAmount,
          toAmount:       finalToAmount,
          netToAmount:    finalToAmount * (1 - finalFeeBps / 10000),
          fromAmountUsd:  estimatedUsd,
          toAmountUsd:    finalToAmount * (prices[to.symbol] ?? 1),
          rate:           finalRate,
          priceImpact:    p2pEstimate ? 0 : quoteResult.priceImpact,
          platformFee:    swapAmount * (finalFeeBps / 10000),
          platformFeeUsd: estimatedUsd * (finalFeeBps / 10000),
          platformFeeOut: finalToAmount * (finalFeeBps / 10000),
          feeBps:         finalFeeBps,
          feeToken:       finalFeeToken,
          route:          finalRoute,
          quoteResponse:  p2pEstimate ? null : quoteResult.rawQuote,
        },
      };
    }),

  /**
   * Build a Solana swap transaction.
   * PRIMARY: AFOS P2P network (agent-coordinated, no Oracle VM)
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
        fromChain:      z.enum(["solana", "ethereum", "bitcoin", "trac_network"]).optional(),
        /** Destination chain — if cross-chain, P2P is attempted first */
        toChain:        z.enum(["solana", "ethereum", "bitcoin", "trac_network"]).optional(),
        /** Human-readable swap amount (e.g. 1.5) — used for P2P RFQ */
        amount:         z.number().positive().optional(),
        /** Skip AFOS P2P and go straight to Jupiter */
        skipP2P:        z.boolean().optional().default(false),
        /** Manus OAuth openId — used to enforce per-user settings */
        openId:         z.string().optional(),
        /** Sender's signaling peerId — used to exclude them from peer matching */
        senderPeerId:   z.string().optional(),
        /** Sender's peer alias — shown to the counterparty in the incoming RFQ card */
        senderAlias:    z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { quoteResponse, userPublicKey, fromToken, toToken, fromChain, toChain, amount, openId, senderPeerId, senderAlias } = input;

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

      // Apply preferredRoute: if user prefers Jupiter or 0x (ETH-only, not applicable on Solana), skip P2P
      const skipP2P = input.skipP2P ||
        userPrefs.preferredRoute === "jupiter" ||
        userPrefs.preferredRoute === "zerox"; // 0x is ETH-only; on Solana fall back to Jupiter

      if (!userPublicKey) throw new Error("Wallet not connected");

      // ── Step 1: Agent P2P peer discovery via signaling server ───────────────
      // No Oracle VM needed — query the in-memory signaling registry directly.
      let p2pQuote: P2PQuoteResult | null = null;
      const isCrossChain = toChain && toChain !== "solana";

      if (!skipP2P && fromToken && toToken && amount) {
        const { prices: p2pPrices } = await getTokenPricesWithSource();
        p2pQuote = findSignalingPeer({
          fromToken:  fromToken.toUpperCase(),
          toToken:    toToken.toUpperCase(),
          fromChain:  fromChain ?? "solana",
          toChain:    toChain   ?? "solana",
          amount,
          prices:     p2pPrices,
          senderPeerId,
          senderWallet: userPublicKey,
        });
      }

      // ── Step 2: If P2P peer matched, send agent_rfq to peer and return P2P route ─────────────────────
      // The frontend will coordinate the HTLC lock with the peer via LightPeerContext.
      if (p2pQuote && p2pQuote.peerId && p2pQuote.rfqId) {
        const expiresAt = Date.now() + 60_000; // 60s for counterparty to accept
        // Generate HTLC secret BEFORE sending agent_rfq so the hash can be included
        const htlcSecretBytes = crypto.getRandomValues(new Uint8Array(32));
        const htlcSecretHex   = Array.from(htlcSecretBytes).map(b => b.toString(16).padStart(2, "0")).join("");
        const htlcHashBytes   = await crypto.subtle.digest("SHA-256", htlcSecretBytes);
        const htlcSecretHash  = Array.from(new Uint8Array(htlcHashBytes)).map(b => b.toString(16).padStart(2, "0")).join("");
        // Persist to DB so reveal survives page refresh
        void saveHtlcSecret({
          rfqId:              p2pQuote.rfqId,
          secretHex:          htlcSecretHex,
          secretHashHex:      htlcSecretHash,
          fromChain:          (fromChain ?? "solana") as "bitcoin" | "ethereum" | "solana" | "trac_network",
          toChain:            (toChain   ?? "solana") as "bitcoin" | "ethereum" | "solana" | "trac_network",
          requesterAddress:   userPublicKey ?? undefined,
          counterpartyPeerId: p2pQuote.peerId ?? undefined,
          initiatorPeerId:    senderPeerId ?? undefined,
          expiresAt:          BigInt(expiresAt),
          status:             "locked",
        }).catch(() => {/* non-fatal */});
        // Push agent_rfq to the matched peer's browser via signaling WebSocket
        const delivered = sendAgentRfqToPeer({
          rfqId:           p2pQuote.rfqId,
          targetPeerId:    p2pQuote.peerId,
          fromToken:       (fromToken ?? "SOL").toUpperCase(),
          toToken:         (toToken ?? "USDT").toUpperCase(),
          fromChain:       fromChain ?? "solana",
          toChain:         toChain   ?? "solana",
          amount:          amount ?? 0,
          outAmount:       p2pQuote.outAmount ?? 0,
          rate:            p2pQuote.rate ?? 0,
          requesterAlias:  senderAlias ?? userPublicKey?.slice(0, 8) ?? "Anonymous",
          requesterPeerId: senderPeerId,
          requesterWallet: userPublicKey,
          expiresAt,
          secretHashHex:   htlcSecretHash,
        });
        console.log(`[AFOS buildSwapTx] agent_rfq ${delivered ? "delivered" : "NOT delivered (peer offline)"} to ${p2pQuote.peerId?.slice(0, 12)}…`);
        // Record P2P swap event to analytics DB (non-blocking)
        void recordSwapAnalytic({
          fromChain:  (fromChain ?? "solana") as SupportedChain,
          toChain:    (toChain   ?? "solana") as SupportedChain,
          fromToken:  fromToken ?? "SOL",
          toToken:    toToken   ?? "USDT",
          amount:     String(amount ?? 0),
          route:      "AFOS P2P",
          status:     "completed",
          peerId:     p2pQuote.peerId ?? undefined,
          walletAddress: userPublicKey,
        }).catch(() => {/* non-fatal */});
        return {
          route:          "AFOS P2P" as const,
          p2pQuote:       { ...p2pQuote, expiresAt, delivered, secretHashHex: htlcSecretHash },
          swapTransaction: null,
          message:
            `P2P peer matched: @${p2pQuote.peerAlias ?? p2pQuote.peerId?.slice(0, 8) ?? "peer"}. ` +
            `Rate: ${p2pQuote.rate?.toFixed(6) ?? "N/A"}. ` +
            "Agent coordinating HTLC lock — please sign the transaction in your wallet.",
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
        walletAddress: userPublicKey,
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
   * PRIMARY: AFOS P2P network (agent-coordinated, no Oracle VM)
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
        fromChain:    z.enum(["solana", "ethereum", "bitcoin", "trac_network"]).optional().default("ethereum"),
        /** Destination chain */
        toChain:      z.enum(["solana", "ethereum", "bitcoin", "trac_network"]).optional().default("ethereum"),
        /** Human-readable amount to swap (e.g. 0.1 for 0.1 ETH) */
        amount:       z.number().positive(),
        /** Allowed slippage in percent (default: 1%) — overridden by user settings when openId is provided */
        slippage:     z.number().min(0.1).max(50).optional().default(1),
        /** Skip IntercomSwap P2P and go straight to 1inch */
        skipP2P:      z.boolean().optional().default(false),
        /** Manus OAuth openId — used to enforce per-user settings */
        openId:       z.string().optional(),
        /** Sender's signaling peerId — used to notify Agent A on HTLC expiry */
        senderPeerId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { fromAddress, fromToken, toToken, fromChain, toChain, amount, openId, senderPeerId: ethSenderPeerId } = input;

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

      // ── Step 1: Agent P2P peer discovery via signaling server ───────────────
      let p2pQuote: P2PQuoteResult | null = null;

      if (!skipP2P) {
        const { prices: p2pPrices } = await getTokenPricesWithSource();
        p2pQuote = findSignalingPeer({
          fromToken:  fromSymbol.toUpperCase(),
          toToken:    toSymbol.toUpperCase(),
          fromChain,
          toChain,
          amount,
          prices:     p2pPrices,
          senderWallet: fromAddress,
        });
      }

      // ── Step 2: If P2P peer matched, return P2P route ─────────────────────
      if (p2pQuote) {
        // Record P2P swap event to analytics DB (non-blocking)
        void recordSwapAnalytic({
          fromChain:  fromChain as SupportedChain,
          toChain:    toChain   as SupportedChain,
          fromToken:  fromSymbol,
          toToken:    toSymbol,
          amount:     String(amount),
          route:      "IntercomSwap P2P",
          status:     "completed",
          peerId:     p2pQuote.peerId ?? undefined,
          walletAddress: fromAddress,
        }).catch(() => {/* non-fatal */});
        // Build HTLC lock calldata if contract is deployed
        const htlcTimelock = Math.floor(Date.now() / 1000) + 3600; // 1-hour timelock
        const secretBytes  = crypto.getRandomValues(new Uint8Array(32));
        const secretHex    = Array.from(secretBytes).map(b => b.toString(16).padStart(2, "0")).join("");
        const secretHashBytes = await crypto.subtle.digest("SHA-256", secretBytes);
        const secretHash   = Array.from(new Uint8Array(secretHashBytes)).map(b => b.toString(16).padStart(2, "0")).join("");
        // Persist HTLC secret to DB so reveal can survive page refresh
        if (p2pQuote.rfqId) {
          void saveHtlcSecret({
            rfqId:              p2pQuote.rfqId,
            secretHex,
            secretHashHex:      secretHash,
            fromChain:          fromChain as "bitcoin" | "ethereum" | "solana" | "trac_network",
            toChain:            toChain   as "bitcoin" | "ethereum" | "solana" | "trac_network",
          requesterAddress:   fromAddress ?? undefined,
          counterpartyPeerId: p2pQuote.peerId ?? undefined,
          initiatorPeerId:    ethSenderPeerId ?? undefined,
          expiresAt:          BigInt(Date.now() + 3600_000),
          status:             "locked",
        }).catch(() => {/* non-fatal */});
        }
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
        // Notify Agent B with the secretHashHex so they lock to the same hash
        if (p2pQuote.peerId && p2pQuote.rfqId) {
          sendAgentRfqToPeer({
            rfqId:           p2pQuote.rfqId,
            targetPeerId:    p2pQuote.peerId,
            fromToken:       fromSymbol,
            toToken:         toSymbol,
            fromChain,
            toChain,
            amount,
            outAmount:       p2pQuote.outAmount ?? 0,
            rate:            p2pQuote.rate ?? 0,
            requesterWallet: fromAddress ?? undefined,
            expiresAt:       Date.now() + 60_000,
            secretHashHex:   secretHash,
          });
        }
        return {
          success:  true,
          route:    "IntercomSwap P2P" as const,
          p2pQuote: { ...p2pQuote, secretHashHex: secretHash },
          // htlcLockTx is non-null when ETH_HTLC_ADDRESS is set (contract deployed)
          tx:       htlcLockTx,
          secretHash: htlcLockTx ? secretHash : undefined,
          secretHashHex: secretHash, // Always include for Agent A's HTLC lock
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
          fromChain:  fromChain as SupportedChain,
          toChain:    toChain   as SupportedChain,
          fromToken:  fromSymbol,
          toToken:    toSymbol,
          amount:     String(amount),
          route:      "1inch (Ethereum)",
          status:     "completed",
          walletAddress: fromAddress,
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
        toChain: z.enum(["bitcoin", "ethereum", "solana", "trac_network"]).optional(),
        /** Skip IntercomSwap P2P discovery and go straight to direct HTLC */
        skipP2P: z.boolean().optional().default(false),
        /** Sender's signaling peerId — used to notify Agent A on HTLC expiry */
        senderPeerId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { senderAddress, amountBtc, expiryHours, network, toToken, toChain, skipP2P, senderPeerId: btcSenderPeerId } = input;
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
      // Persist HTLC secret to DB so reveal can survive page refresh
      if (p2pQuote?.rfqId) {
        void saveHtlcSecret({
          rfqId:              p2pQuote.rfqId,
          secretHex:          secret,
          secretHashHex:      secretHash,
          fromChain:          "bitcoin",
          toChain:            (input.toChain ?? "bitcoin") as "bitcoin" | "ethereum" | "solana" | "trac_network",
          requesterAddress:   input.senderAddress ?? undefined,
          counterpartyPeerId: p2pQuote.peerId ?? undefined,
          initiatorPeerId:    btcSenderPeerId ?? undefined,
          expiresAt:          BigInt(Date.now() + expiryHours * 3_600_000),
          status:             "locked",
        }).catch(() => {/* non-fatal */});
      }
      // Notify Agent B with the secretHashHex so they lock to the same hash (atomicity)
      if (p2pQuote?.peerId && p2pQuote?.rfqId) {
        sendAgentRfqToPeer({
          rfqId:           p2pQuote.rfqId,
          targetPeerId:    p2pQuote.peerId,
          fromToken:       "BTC",
          toToken:         input.toToken   ?? "BTC",
          fromChain:       "bitcoin",
          toChain:         input.toChain   ?? "bitcoin",
          amount:          input.amountBtc ?? 0,
          outAmount:       p2pQuote.outAmount ?? 0,
          rate:            p2pQuote.rate ?? 0,
          requesterWallet: input.senderAddress ?? undefined,
          expiresAt:       Date.now() + 60_000,
          secretHashHex:   secretHash,
        });
      }
      // BTC_HTLC_WIF is the dedicated HTLC escrow key; fall back to BTC_AGENT_WIF for backwards compatibilityy
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
      // preferredRoute "best"         = P2P-first (default behaviour)
      // preferredRoute "jupiter"      = skip P2P, go straight to Jupiter (Solana only)
      // preferredRoute "zerox"        = skip P2P, go straight to 0x Protocol (Ethereum only)
      // preferredRoute "oneinch"      = skip P2P, go straight to 1inch (Ethereum only, requires ONEINCH_API_KEY)
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
      // ── Trac Network (TNK) path ──────────────────────────────────────────────
      if (chain === "trac_network") {
        // Generate HTLC secret BEFORE executing so Agent B can lock to the same hash
        const tnkSecretBytes = crypto.getRandomValues(new Uint8Array(32));
        const tnkSecretHex   = Array.from(tnkSecretBytes).map(b => b.toString(16).padStart(2, "0")).join("");
        const tnkHashBuf     = await crypto.subtle.digest("SHA-256", tnkSecretBytes);
        const tnkSecretHash  = Array.from(new Uint8Array(tnkHashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
        const tnkRfqId       = `rfq_tnk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        // Persist to DB
        void saveHtlcSecret({
          rfqId:         tnkRfqId,
          secretHex:     tnkSecretHex,
          secretHashHex: tnkSecretHash,
          fromChain:     "trac_network",
          toChain:       (toChain ?? "bitcoin") as "bitcoin" | "ethereum" | "solana" | "trac_network",
          expiresAt:     BigInt(Date.now() + btcExpiryHours * 3_600_000),
          status:        "locked",
        }).catch(() => {/* non-fatal */});
        // Broadcast to all peers so they can see the TNK RFQ
        broadcastRfqToAll(undefined, {
          rfqId:     tnkRfqId,
          fromToken: fromToken.toUpperCase(),
          toToken:   toToken.toUpperCase(),
          fromChain: "trac_network",
          toChain:   toChain ?? "bitcoin",
          amount,
          secretHashHex: tnkSecretHash,
          expiresAt:     Date.now() + 60_000,
        });
        const tnkResult = await executeTnkAgentSwap({
          fromToken,
          toToken,
          amount,
          toChain,
          expiryHours: btcExpiryHours,
        });
        return {
          success:       tnkResult.success,
          demo:          tnkResult.demo,
          txHash:        tnkResult.txHash,
          outAmount:     tnkResult.outAmount,
          route:         tnkResult.route,
          agentAddress:  null,
          solscanUrl:    tnkResult.txHash ? `https://explorer.trac.network/tx/${tnkResult.txHash}` : null,
          feeBps:        tnkResult.feeBps,
          feeAmountOut:  tnkResult.feeAmountOut,
          chain:         "trac_network" as const,
          nextStep:      tnkResult.nextStep,
          message:       tnkResult.message,
          secretHashHex: tnkSecretHash, // For Agent A's HTLC lock on Trac Network
          rfqId:         tnkRfqId,
        };
      }
      // ── Solana path (default) ─────────────────────────────────────────────────────
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
                fromChain:      fromChain as SupportedChain,
                toChain:        toChain   as SupportedChain,
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

  /**
   * Request a quote from a specific signaling peer for the Order Book.
   * Pushes an agent_rfq message to the peer via the signaling server and
   * returns the computed rate based on live prices + the peer's spread.
   * The peer's browser will also receive the RFQ and can accept/reject it.
   */
  requestPeerQuote: publicProcedure
    .input(z.object({
      peerId:          z.string(),
      fromToken:       z.string(),
      toToken:         z.string(),
      fromChain:       z.string().optional(),
      toChain:         z.string().optional(),
      amount:          z.number().positive(),
      spreadBps:       z.number().optional(),   // peer's declared spread, forwarded from getPeerList
      requesterPeerId: z.string().optional(),   // caller's own peerId so the LP can filter echo events
    }))
    .query(async ({ input }) => {
      const { prices } = await getTokenPricesWithSource();
      const fromSymbol = input.fromToken.toUpperCase();
      const toSymbol   = input.toToken.toUpperCase();
      const fromPrice  = prices[fromSymbol] ?? (fromSymbol.includes("USD") ? 1 : 0);
      const toPrice    = prices[toSymbol]   ?? (toSymbol.includes("USD")   ? 1 : 0);
      if (!fromPrice || !toPrice) {
        return { rate: 0, outAmount: 0, delivered: false };
      }
      const spreadBps      = input.spreadBps ?? 30;
      const spreadMult     = 1 - spreadBps / 10_000;
      const baseRate       = fromPrice / toPrice;
      const quotedRate     = baseRate * spreadMult;
      const outAmount      = input.amount * quotedRate;
      const rfqId          = `rfq_${Date.now()}_${input.peerId.slice(0, 8)}`;
      const fromChain      = (input.fromChain ?? defaultChain(input.fromToken)) as SupportedChain;
      const toChain        = (input.toChain   ?? defaultChain(input.toToken))   as SupportedChain;
      const delivered = sendAgentRfqToPeer({
        rfqId,
        targetPeerId:    input.peerId,
        fromToken:       input.fromToken,
        toToken:         input.toToken,
        fromChain,
        toChain,
        amount:          input.amount,
        outAmount,
        rate:            quotedRate,
        requesterAlias:  "Order Book",
        requesterPeerId: input.requesterPeerId,  // forwarded so LP can echo-filter
        expiresAt:       Date.now() + 60_000,
      });
      return { rate: quotedRate, outAmount, delivered };
    }),

  /**
   * Write an auto-accepted P2P RFQ to swap_analytics so the user can audit
   * what the agent accepted on their behalf in SwapHistory.
   */
  logAutoAcceptedRfq: publicProcedure
    .input(z.object({
      rfqId:         z.string(),
      fromToken:     z.string(),
      toToken:       z.string(),
      fromChain:     z.string().optional(),
      toChain:       z.string().optional(),
      amount:        z.number(),
      outAmount:     z.number(),
      rate:          z.number(),
      peerAlias:     z.string().optional(),
      peerId:        z.string().optional(),
      walletAddress: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const fromChain = (input.fromChain ?? defaultChain(input.fromToken)) as SupportedChain;
      const toChain   = (input.toChain   ?? defaultChain(input.toToken))   as SupportedChain;
      const { prices } = await getTokenPricesWithSource();
      const fromSym   = input.fromToken.toUpperCase();
      const fromPrice = prices[fromSym] ?? (fromSym.includes("USD") ? 1 : 0);
      const amountUsd = fromPrice > 0 ? (input.amount * fromPrice).toFixed(4) : undefined;
      const feeBps    = P2P_FEE_BPS;
      const feeOut    = input.outAmount * (feeBps / 10_000);
      await recordSwapAnalytic({
        fromChain,
        toChain,
        fromToken:     input.fromToken,
        toToken:       input.toToken,
        amount:        input.amount.toFixed(8),
        amountUsd,
        route:         "AFOS P2P (auto-accepted)",
        status:        "completed",
        peerId:        input.peerId ?? input.peerAlias,
        feeBps,
        feeAmountOut:  feeOut.toFixed(8),
        outAmount:     input.outAmount.toFixed(8),
        walletAddress: input.walletAddress,
        rfqId:         input.rfqId,
      });
      return { ok: true };
    }),

  /**
   * Retrieve the HTLC secret hash for a given rfqId.
   * Returns only the secretHashHex (public) and status — never the plaintext secretHex.
   * Used by the frontend to verify the counterparty locked against the correct hash.
   */
  getHtlcSecretHash: publicProcedure
    .input(z.object({ rfqId: z.string() }))
    .query(async ({ input }) => {
      const row = await getHtlcSecret(input.rfqId);
      if (!row) return null;
      return {
        rfqId:         row.rfqId,
        secretHashHex: row.secretHashHex,
        fromChain:     row.fromChain,
        toChain:       row.toChain,
        status:        row.status,
        expiresAt:     Number(row.expiresAt),
        lockTxId:      row.lockTxId,
        revealTxId:    row.revealTxId,
      };
    }),
  /**
   * Reveal the HTLC secret for a given rfqId (called after counterparty locks).
   * Returns the plaintext secretHex so the requester can claim on the destination chain.
   * Only the requester (matched by walletAddress) may retrieve the secret.
   */
  revealHtlcSecret: publicProcedure
    .input(z.object({ rfqId: z.string(), requesterAddress: z.string() }))
    .mutation(async ({ input }) => {
      const row = await getHtlcSecret(input.rfqId);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "HTLC secret not found for this RFQ" });
      if (row.requesterAddress && row.requesterAddress.toLowerCase() !== input.requesterAddress.toLowerCase()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the requester may reveal the HTLC secret" });
      }
      if (row.status === "expired" || row.status === "refunded") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `HTLC is ${row.status} — cannot reveal` });
      }
      // Mark as revealed
      await updateHtlcSecretStatus(input.rfqId, "revealed");
      return { secretHex: row.secretHex, secretHashHex: row.secretHashHex };
    }),
  /**
   * Mark an HTLC swap as completed or refunded (called after on-chain confirmation).
   */
  updateHtlcStatus: publicProcedure
    .input(z.object({
      rfqId:      z.string(),
      status:     z.enum(["completed", "refunded", "expired"]),
      lockTxId:   z.string().optional(),
      revealTxId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await updateHtlcSecretStatus(input.rfqId, input.status, {
        lockTxId:   input.lockTxId,
        revealTxId: input.revealTxId,
      });
      return { ok: true };
    }),
  /**
   * Return the current live signaling peer list for the Order Book.
   * Each peer includes their peerId, alias, accepted pairs, wallet addresses,
   * connection time, and last heartbeat. No WebSocket refs are exposed.
   */
  /**
   * Return recently settled (completed/expired/refunded) HTLC secrets for the history panel.
   */
  getSettledHtlcs: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(50) }).optional())
    .query(async ({ input }) => {
      const rows = await getSettledHtlcSecrets(input?.limit ?? 50);
      return rows.map(r => ({
        rfqId:              r.rfqId,
        fromChain:          r.fromChain,
        toChain:            r.toChain,
        status:             r.status,
        lockTxId:           r.lockTxId ?? null,
        revealTxId:         r.revealTxId ?? null,
        counterpartyPeerId: r.counterpartyPeerId ?? null,
        expiresAt:          Number(r.expiresAt),
        updatedAt:          r.updatedAt,
        createdAt:          r.createdAt,
      }));
    }),

  // ── Notify owner of swap completion (claim or refund) ──────────────────────
  notifySwapCompletion: publicProcedure
    .input(z.object({
      rfqId:  z.string().min(1),
      type:   z.enum(["claimed", "refunded"]),
      chain:  z.string().min(1),
      txHash: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { rfqId, type, chain, txHash } = input;
      const title = type === "claimed"
        ? `✅ HTLC Claimed — ${chain.toUpperCase()}`
        : `↩ HTLC Refunded — ${chain.toUpperCase()}`;
      const content = type === "claimed"
        ? `Agent B successfully claimed funds on ${chain} for RFQ ${rfqId.slice(0, 8)}…${txHash ? `\nTx: ${txHash}` : ""}`
        : `Agent A refunded locked funds on ${chain} for RFQ ${rfqId.slice(0, 8)}…${txHash ? `\nTx: ${txHash}` : ""}`;
      const delivered = await notifyOwner({ title, content });
      return { delivered };
    }),

  getPeerList: publicProcedure.query(() => {
    const peerList = getSignalingPeerList();
    return peerList.map(p => ({
      peerId:          p.peerId,
      alias:           p.alias,
      pairs:           p.pairs,
      walletAddresses: p.walletAddresses,
      connectedAt:     p.connectedAt,
      lastHeartbeat:   p.lastHeartbeat,
      maxTradeUsd:     p.maxTradeUsd,
      // Compute a simple "online" score: 100 if heartbeat < 30s ago, else decays
      score: Math.max(0, Math.round(100 - (Date.now() - p.lastHeartbeat) / 1000)),
    }));
  }),
});
