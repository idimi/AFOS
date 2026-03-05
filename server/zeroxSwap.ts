/**
 * zeroxSwap.ts — 0x Protocol v2 (Permit2) Ethereum DEX aggregator
 *
 * Primary DEX aggregator for Ethereum swaps (replaces 1inch as primary).
 * Uses the 0x Swap API v2 with Permit2 for gasless token approvals.
 *
 * Fee model:
 *   0.20% (20 bps) platform fee via 0x Protocol's built-in fee mechanism
 *   Fee is collected in the buy token (output side).
 *
 * Routing priority in agentSwapEth.ts:
 *   1. IntercomSwap Oracle VM P2P
 *   2. 0x Protocol (this module)  ← primary DEX
 *   3. 1inch (fallback — requires ONEINCH_API_KEY)
 *
 * Environment variables:
 *   ZEROX_API_KEY  — 0x API key (required, get free at dashboard.0x.org)
 *   ETH_AGENT_KEY  — Ethereum private key for signing transactions
 *   ETH_RPC_URL    — Ethereum JSON-RPC endpoint
 */

import { ethers } from "ethers";

// ─── Constants ────────────────────────────────────────────────────────────────
const ZEROX_BASE    = "https://api.0x.org/swap/permit2";
const CHAIN_ID      = 1; // Ethereum mainnet
const PLATFORM_FEE_BPS = 20; // 0.20%
const ETH_NATIVE    = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const WETH_ADDRESS  = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// Permit2 contract address (universal across EVM chains)
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

// ─── Token registry ───────────────────────────────────────────────────────────
export const ZEROX_TOKENS: Record<string, { address: string; decimals: number; symbol: string }> = {
  ETH:  { address: ETH_NATIVE,                                      decimals: 18, symbol: "ETH"  },
  WETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18, symbol: "WETH" },
  USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6,  symbol: "USDT" },
  USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6,  symbol: "USDC" },
  WBTC: { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8,  symbol: "WBTC" },
  DAI:  { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18, symbol: "DAI"  },
};

export function resolveZeroxToken(symbol: string) {
  return ZEROX_TOKENS[symbol.toUpperCase()] ?? null;
}

// ─── 0x API helpers ───────────────────────────────────────────────────────────

interface ZeroxPriceResponse {
  buyAmount:         string;
  sellAmount:        string;
  price:             string;
  estimatedPriceImpact?: string;
  issues?: {
    allowance?: { spender: string; currentAllowance: string };
    balance?:   { token: string; actual: string; expected: string };
  };
}

interface ZeroxQuoteResponse extends ZeroxPriceResponse {
  transaction: {
    to:       string;
    data:     string;
    value:    string;
    gas:      string;
    gasPrice: string;
  };
  permit2?: {
    type:    string;
    hash:    string;
    eip712:  unknown;
  };
  fees?: {
    integratorFee?: { amount: string; token: string; type: string };
    zeroExFee?:     { amount: string; token: string; type: string };
    gasFee?:        { amount: string; token: string; type: string };
  };
}

function getZeroxHeaders(): Record<string, string> {
  const key = process.env.ZEROX_API_KEY;
  if (!key) throw new Error("ZEROX_API_KEY is not set");
  return {
    "0x-api-key":  key,
    "0x-version":  "v2",
    "Content-Type": "application/json",
    "Accept":       "application/json",
  };
}

/**
 * Get a price estimate from 0x (no signing required).
 * Used for quote display in the chat agent.
 */
export async function getZeroxPrice(
  sellToken: string,
  buyToken:  string,
  sellAmount: string,
): Promise<ZeroxPriceResponse | null> {
  try {
    // 0x v2 uses WETH address for native ETH
    const sell0x = sellToken.toLowerCase() === ETH_NATIVE.toLowerCase() ? WETH_ADDRESS : sellToken;
    const buy0x  = buyToken.toLowerCase()  === ETH_NATIVE.toLowerCase() ? WETH_ADDRESS : buyToken;
    const feeRecipient = process.env.ETH_FEE_WALLET ?? (await getAgentAddress());
    const params = new URLSearchParams({
      chainId:    String(CHAIN_ID),
      sellToken:  sell0x,
      buyToken:   buy0x,
      sellAmount,
      // 0.20% platform fee collected in buy token
      swapFeeBps:        String(PLATFORM_FEE_BPS),
      swapFeeRecipient:  feeRecipient,
      swapFeeToken:      buy0x,
    });
    const url = `${ZEROX_BASE}/price?${params}`;
    const res = await fetch(url, {
      headers: getZeroxHeaders(),
      signal:  AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.warn(`[0x] Price failed: ${res.status} ${err.slice(0, 120)}`);
      return null;
    }
    return await res.json() as ZeroxPriceResponse;
  } catch (err) {
    console.warn("[0x] Price error:", err);
    return null;
  }
}

/**
 * Get a full executable quote from 0x (includes transaction calldata).
 */
export async function getZeroxQuote(
  sellToken:     string,
  buyToken:      string,
  sellAmount:    string,
  takerAddress:  string,
): Promise<ZeroxQuoteResponse | null> {
  try {
    // 0x v2 uses WETH address for native ETH
    const sell0x = sellToken.toLowerCase() === ETH_NATIVE.toLowerCase() ? WETH_ADDRESS : sellToken;
    const buy0x  = buyToken.toLowerCase()  === ETH_NATIVE.toLowerCase() ? WETH_ADDRESS : buyToken;
    const feeRecipient = process.env.ETH_FEE_WALLET ?? takerAddress;
    const params = new URLSearchParams({
      chainId:    String(CHAIN_ID),
      sellToken:  sell0x,
      buyToken:   buy0x,
      sellAmount,
      taker:      takerAddress,
      // 0.20% platform fee collected in buy token
      swapFeeBps:        String(PLATFORM_FEE_BPS),
      swapFeeRecipient:  feeRecipient,
      swapFeeToken:      buy0x,
      slippageBps:       "50", // 0.5% slippage tolerance
    });
    const url = `${ZEROX_BASE}/quote?${params}`;
    const res = await fetch(url, {
      headers: getZeroxHeaders(),
      signal:  AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.warn(`[0x] Quote failed: ${res.status} ${err.slice(0, 200)}`);
      return null;
    }
    return await res.json() as ZeroxQuoteResponse;
  } catch (err) {
    console.warn("[0x] Quote error:", err);
    return null;
  }
}

// ─── Agent address helper ─────────────────────────────────────────────────────
async function getAgentAddress(): Promise<string> {
  const keyRaw = process.env.ETH_AGENT_KEY ?? "";
  const keyHex = keyRaw.startsWith("0x") ? keyRaw : `0x${keyRaw}`;
  const wallet = new ethers.Wallet(keyHex);
  return wallet.address;
}

// ─── ERC-20 Permit2 allowance helper ─────────────────────────────────────────
const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

async function ensurePermit2Allowance(
  tokenAddress: string,
  wallet:       ethers.Wallet,
  amountRaw:    bigint,
): Promise<void> {
  if (tokenAddress.toLowerCase() === ETH_NATIVE.toLowerCase()) return; // ETH needs no approval
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  const current = await token.allowance(wallet.address, PERMIT2_ADDRESS) as bigint;
  if (current < amountRaw) {
    console.log(`[0x] Approving Permit2 for token ${tokenAddress}…`);
    const tx = await token.approve(PERMIT2_ADDRESS, ethers.MaxUint256) as ethers.TransactionResponse;
    await tx.wait(1);
    console.log(`[0x] Permit2 approval confirmed: ${tx.hash}`);
  }
}

// ─── Result type ──────────────────────────────────────────────────────────────
export interface ZeroxSwapResult {
  success:      boolean;
  demo:         boolean;
  txHash:       string | null;
  outAmount:    number | null;
  route:        string;
  agentAddress: string;
  explorerUrl:  string | null;
  feeBps:       number;
  feeAmountOut: number;
  message:      string;
}

// ─── Main execution function ──────────────────────────────────────────────────
/**
 * Execute an Ethereum swap via 0x Protocol v2 (Permit2).
 * Signs and broadcasts the transaction from the agent wallet.
 */
export async function executeZeroxSwap(params: {
  fromToken: string;
  toToken:   string;
  amount:    number;
  toChain?:  string;
}): Promise<ZeroxSwapResult> {
  const { fromToken, toToken, amount, toChain = "ethereum" } = params;

  const apiKey = process.env.ZEROX_API_KEY;
  if (!apiKey) {
    return {
      success: false, demo: false, txHash: null, outAmount: null,
      route: "0x Protocol",
      agentAddress: "",
      explorerUrl: null,
      feeBps: PLATFORM_FEE_BPS, feeAmountOut: 0,
      message: "ZEROX_API_KEY is not configured. Please add it in Settings → Secrets.",
    };
  }

  const keyRaw = process.env.ETH_AGENT_KEY;
  if (!keyRaw) {
    return {
      success: false, demo: false, txHash: null, outAmount: null,
      route: "0x Protocol",
      agentAddress: "",
      explorerUrl: null,
      feeBps: PLATFORM_FEE_BPS, feeAmountOut: 0,
      message: "ETH_AGENT_KEY is not configured.",
    };
  }

  const rpcUrl     = process.env.ETH_RPC_URL || "https://cloudflare-eth.com";
  const provider   = new ethers.JsonRpcProvider(rpcUrl);
  const keyHex     = keyRaw.startsWith("0x") ? keyRaw : `0x${keyRaw}`;
  const wallet     = new ethers.Wallet(keyHex, provider);
  const agentAddress = wallet.address;

  const fromAsset = resolveZeroxToken(fromToken);
  const toAsset   = resolveZeroxToken(toToken);

  if (!fromAsset || !toAsset) {
    return {
      success: false, demo: false, txHash: null, outAmount: null,
      route: "0x Protocol",
      agentAddress,
      explorerUrl: null,
      feeBps: PLATFORM_FEE_BPS, feeAmountOut: 0,
      message: `Unsupported token pair for 0x: ${fromToken} → ${toToken}. Supported: ETH, WETH, USDT, USDC, WBTC, DAI.`,
    };
  }

  const amountRaw = BigInt(Math.floor(amount * Math.pow(10, fromAsset.decimals)));

  // Get executable quote
  const quote = await getZeroxQuote(
    fromAsset.address,
    toAsset.address,
    amountRaw.toString(),
    agentAddress,
  );

  if (!quote?.transaction) {
    return {
      success: false, demo: false, txHash: null, outAmount: null,
      route: "0x Protocol",
      agentAddress,
      explorerUrl: null,
      feeBps: PLATFORM_FEE_BPS, feeAmountOut: 0,
      message:
        "Failed to get executable quote from 0x Protocol. " +
        "The agent wallet may have insufficient ETH for gas (need ≥0.01 ETH). " +
        "Check ZEROX_API_KEY is valid.",
    };
  }

  const outAmountRaw   = Number(quote.buyAmount) / Math.pow(10, toAsset.decimals);
  const feeAmountOut   = outAmountRaw * (PLATFORM_FEE_BPS / 10000);

  // Ensure Permit2 allowance for ERC-20 sell tokens
  try {
    await ensurePermit2Allowance(fromAsset.address, wallet, amountRaw);
  } catch (err) {
    console.warn("[0x] Permit2 allowance check failed:", err);
    // Continue — may still work if allowance is already set
  }

  // Sign and broadcast the transaction
  try {
    const tx = quote.transaction;
    const response = await wallet.sendTransaction({
      to:       tx.to,
      data:     tx.data,
      value:    BigInt(tx.value || "0"),
      gasLimit: BigInt(Math.ceil(Number(tx.gas) * 1.2)), // 20% gas buffer
    });

    console.log(`[0x] Tx submitted: ${response.hash}`);
    const receipt = await response.wait(1);

    if (!receipt || receipt.status === 0) {
      return {
        success: false, demo: false,
        txHash: response.hash,
        outAmount: outAmountRaw,
        route: "0x Protocol",
        agentAddress,
        explorerUrl: `https://etherscan.io/tx/${response.hash}`,
        feeBps: PLATFORM_FEE_BPS, feeAmountOut: 0,
        message: `Transaction submitted but reverted on-chain. Tx: ${response.hash}`,
      };
    }

    console.log(`[0x] ✅ ${amount} ${fromToken} → ${outAmountRaw.toFixed(6)} ${toToken} | Tx: ${response.hash}`);

    return {
      success: true, demo: false,
      txHash: response.hash,
      outAmount: outAmountRaw,
      route: "0x Protocol (direct)",
      agentAddress,
      explorerUrl: `https://etherscan.io/tx/${response.hash}`,
      feeBps: PLATFORM_FEE_BPS,
      feeAmountOut,
      message: `ETH swap via 0x Protocol: ${amount} ${fromToken} → ${outAmountRaw.toFixed(6)} ${toToken}. Tx: ${response.hash}`,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[0x] ❌ Broadcast failed: ${errMsg}`);
    return {
      success: false, demo: false, txHash: null, outAmount: outAmountRaw,
      route: "0x Protocol",
      agentAddress,
      explorerUrl: null,
      feeBps: PLATFORM_FEE_BPS, feeAmountOut: 0,
      message: `0x swap transaction failed: ${errMsg.slice(0, 200)}`,
    };
  }
}
