/**
 * agentSwapEth.ts — Server-side Ethereum agent swap execution
 *
 * Routing priority:
 *   1. IntercomSwap Oracle VM RFQ → P2P HTLC or DEX via Oracle VM
 *   2. 0x Protocol v2 (primary DEX, no KYC, 0.20% fee)  ← ZEROX_API_KEY required
 *   3. 1inch v6 (fallback DEX, 0.20% fee)               ← ONEINCH_API_KEY required (coming soon)
 *
 * Fee model:
 *   P2P route  → P2P_FEE_BPS  = 15 (0.15%) output-side deduction
 *   DEX route  → PLATFORM_FEE_BPS = 20 (0.20%) via 0x/1inch referral
 *
 * Environment variables required:
 *   ETH_AGENT_KEY   — Ethereum private key (hex, with or without 0x prefix)
 *   ETH_RPC_URL     — Ethereum JSON-RPC endpoint (defaults to Cloudflare)
 *   ORACLE_API_URL  — IntercomSwap Oracle VM base URL
 *   ZEROX_API_KEY   — 0x Protocol API key (primary DEX, no KYC)
 *   ONEINCH_API_KEY — 1inch API key (fallback DEX, coming soon — requires KYC)
 */

import { ethers } from "ethers";
import { recordSwapAnalytic } from "./htlcMonitor";
import { executeZeroxSwap } from "./zeroxSwap";

// ─── Fee constants (must match chat.ts) ──────────────────────────────────────
const P2P_FEE_BPS      = 15;   // 0.15% for IntercomSwap P2P
const PLATFORM_FEE_BPS = 20;   // 0.20% for 1inch DEX

// ─── 1inch v6 helpers (FALLBACK — requires ONEINCH_API_KEY) ─────────────────
// Kept in code and ready to activate once ONEINCH_API_KEY is provided.
const ONEINCH_BASE = "https://api.1inch.dev/swap/v6.0/1"; // Ethereum mainnet

const ETH_NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

const ETH_TOKENS: Record<string, { address: string; decimals: number; symbol: string }> = {
  ETH:  { address: ETH_NATIVE,                                      decimals: 18, symbol: "ETH"  },
  USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6,  symbol: "USDT" },
  USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6,  symbol: "USDC" },
  WBTC: { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8,  symbol: "WBTC" },
  DAI:  { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18, symbol: "DAI"  },
  WETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18, symbol: "WETH" },
};

function resolveEthToken(symbol: string) {
  const upper = symbol.toUpperCase();
  return ETH_TOKENS[upper] ?? null;
}

function get1inchHeaders(): Record<string, string> {
  const key = process.env.ONEINCH_API_KEY;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (key) headers["Authorization"] = `Bearer ${key}`;
  return headers;
}

async function get1inchQuote(
  fromAddr: string,
  toAddr: string,
  amountRaw: string,
): Promise<{ toAmount: string } | null> {
  if (!process.env.ONEINCH_API_KEY) return null; // 1inch requires API key
  try {
    const url = `${ONEINCH_BASE}/quote?src=${fromAddr}&dst=${toAddr}&amount=${amountRaw}`;
    const res = await fetch(url, {
      headers: get1inchHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.json() as { toAmount: string };
  } catch {
    return null;
  }
}

async function get1inchSwapTx(
  fromAddr: string,
  toAddr: string,
  amountRaw: string,
  walletAddress: string,
  slippage = 1,
): Promise<{ tx: { to: string; data: string; value: string; gas: number } } | null> {
  if (!process.env.ONEINCH_API_KEY) return null; // 1inch requires API key
  try {
    const url =
      `${ONEINCH_BASE}/swap?src=${fromAddr}&dst=${toAddr}` +
      `&amount=${amountRaw}&from=${walletAddress}&slippage=${slippage}&disableEstimate=true`;
    const res = await fetch(url, {
      headers: get1inchHeaders(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.warn(`[1inch ETH] swap tx failed: ${res.status} ${err.slice(0, 120)}`);
      return null;
    }
    const data = await res.json() as {
      tx?: { to: string; data: string; value: string; gas: number };
      transaction?: { to: string; data: string; value: string; gas: number };
    };
    return data.tx ? { tx: data.tx } : (data.transaction ? { tx: data.transaction } : null);
  } catch (err) {
    console.warn("[1inch ETH] swap tx error:", err);
    return null;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface EthAgentSwapResult {
  success: boolean;
  demo: boolean;
  txHash: string | null;
  outAmount: number | null;
  route: string;
  agentAddress: string | null;
  explorerUrl: string | null;
  feeBps: number;
  feeAmountOut: number;
  message: string;
}

export async function executeEthAgentSwap(params: {
  fromToken: string;
  toToken: string;
  amount: number;
  fromChain?: string;
  toChain?: string;
}): Promise<EthAgentSwapResult> {
  const { fromToken, toToken, amount } = params;
  const fromChain = params.fromChain ?? "ethereum";
  const toChain   = params.toChain   ?? "ethereum";

  const ORACLE_API = process.env.ORACLE_API_URL || "http://141.253.123.101:4000";
  // ETH_HTLC_KEY is the dedicated HTLC escrow key; fall back to ETH_AGENT_KEY for backwards compatibility
  const ethKeyRaw  = process.env.ETH_HTLC_KEY ?? process.env.ETH_AGENT_KEY;
  const ethRpcUrl  = process.env.ETH_RPC_URL   || "https://cloudflare-eth.com";

  // ── ETH_HTLC_KEY required for HTLC signing ────────────────────────────────────
  if (!ethKeyRaw) {
    return {
      success: false,
      demo: false,
      txHash: null,
      outAmount: null,
      route: "Error",
      agentAddress: null,
      explorerUrl: null,
      feeBps: PLATFORM_FEE_BPS,
      feeAmountOut: 0,
      message:
        `ETH_HTLC_KEY is not configured. The platform operator must set this ` +
        `secret for Ethereum HTLC escrow signing. Please contact the platform administrator.`,
    };
  }

  // ── Derive HTLC escrow wallet ─────────────────────────────────────────────────
  let wallet: ethers.Wallet;
  try {
    const keyHex = ethKeyRaw.startsWith("0x") ? ethKeyRaw : `0x${ethKeyRaw}`;
    const provider = new ethers.JsonRpcProvider(ethRpcUrl);
    wallet = new ethers.Wallet(keyHex, provider);
  } catch {
    return {
      success: false,
      demo: false,
      txHash: null,
      outAmount: null,
      route: "Error",
      agentAddress: null,
      explorerUrl: null,
      feeBps: PLATFORM_FEE_BPS,
      feeAmountOut: 0,
      message: "ETH_HTLC_KEY is invalid — must be a 32-byte hex private key.",
    };
  }

  const agentAddress = wallet.address;
  console.log(`[ETH Agent Swap] Agent: ${agentAddress} | ${amount} ${fromToken} → ${toToken}`);

  // ── Step 1: Oracle VM RFQ (P2P discovery) ─────────────────────────────────
  let rfqId: string | null = null;
  let oracleRoute: string | null = null;
  let oracleOutAmount: number | null = null;

  try {
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
        result?: { rfqId?: string; route?: string; outAmount?: number };
      };
      if (rfqData?.success && rfqData?.result?.rfqId) {
        rfqId           = rfqData.result.rfqId;
        oracleRoute     = rfqData.result.route ?? "dex";
        oracleOutAmount = rfqData.result.outAmount ?? null;
        console.log(`[ETH Agent Swap] RFQ ${rfqId} — route=${oracleRoute}, outAmount=${oracleOutAmount}`);
      }
    }
  } catch (err) {
    console.warn("[ETH Agent Swap] Oracle VM RFQ failed:", err);
  }

  // ── Step 2: Execute via Oracle VM ────────────────────────────────────────────
  if (rfqId) {
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
          swap?: { route?: string; outAmount?: number; txHash?: string; status?: string };
          error?: string;
        };
        if (execData?.success && execData?.swap) {
          const swap = execData.swap;
          const finalRoute     = swap.route === "p2p" ? "IntercomSwap P2P" : "1inch DEX (Oracle VM)";
          const finalOutAmount = swap.outAmount ?? oracleOutAmount ?? 0;
          const txHash         = swap.txHash ?? null;
          const isP2P          = swap.route === "p2p";
          const feeBps         = isP2P ? P2P_FEE_BPS : PLATFORM_FEE_BPS;
          const feeAmountOut   = finalOutAmount * (feeBps / 10000);

          void recordSwapAnalytic({
            fromChain:     fromChain as "ethereum",
            toChain:       toChain   as "solana" | "ethereum" | "bitcoin" | "trac_network",
            fromToken:     fromToken.toUpperCase(),
            toToken:       toToken.toUpperCase(),
            amount:        String(amount),
            route:         finalRoute,
            status:        "completed",
            txId:          txHash ?? undefined,
            feeBps,
            feeAmountOut:  String(feeAmountOut.toFixed(8)),
          }).catch(() => {/* non-fatal */});

          return {
            success: true,
            demo: false,
            txHash,
            outAmount: finalOutAmount,
            route: finalRoute,
            agentAddress,
            explorerUrl: txHash ? `https://etherscan.io/tx/${txHash}` : null,
            feeBps,
            feeAmountOut,
            message: txHash
              ? `ETH swap via ${finalRoute}: ${amount} ${fromToken} → ${finalOutAmount.toFixed(6)} ${toToken}. Tx: ${txHash}`
              : `ETH swap via ${finalRoute}: ${amount} ${fromToken} → ${finalOutAmount.toFixed(6)} ${toToken}. Status: ${swap.status ?? "completed"}.`,
          };
        }
      }
    } catch (err) {
      console.warn("[ETH Agent Swap] Oracle VM execute failed:", err);
    }
  }

  // ── Step 3: 0x Protocol (primary DEX fallback — same-chain only) ────────────
  // Cross-chain swaps (e.g., ETH→SOL, ETH→BTC) MUST go through Oracle VM P2P.
  const isCrossChain = fromChain.toLowerCase() !== toChain.toLowerCase();
  if (isCrossChain) {
    console.log(`[ETH Agent Swap] Cross-chain swap (${fromChain}→${toChain}) — Oracle VM required, no DEX fallback`);
    return {
      success: false,
      demo: false,
      txHash: null,
      outAmount: oracleOutAmount,
      route: "IntercomSwap P2P (cross-chain)",
      agentAddress,
      explorerUrl: null,
      feeBps: P2P_FEE_BPS,
      feeAmountOut: 0,
      message:
        `Cross-chain swap ${fromToken} (${fromChain}) → ${toToken} (${toChain}) requires IntercomSwap P2P. ` +
        `The Oracle VM was unreachable or returned no match. Please try again in a moment — ` +
        `the P2P network may need more peers for this pair.`,
    };
  }

  console.log("[ETH Agent Swap] Falling back to 0x Protocol (primary DEX)");

  const zeroxResult = await executeZeroxSwap({ fromToken, toToken, amount, toChain });
  if (zeroxResult.success) {
    void recordSwapAnalytic({
      fromChain:    "ethereum",
      toChain:      toChain as "solana" | "ethereum" | "bitcoin" | "trac_network",
      fromToken:    fromToken.toUpperCase(),
      toToken:      toToken.toUpperCase(),
      amount:       String(amount),
      route:        "0x Protocol (agent direct)",
      status:       "completed",
      txId:         zeroxResult.txHash ?? "",
      feeBps:       PLATFORM_FEE_BPS,
      feeAmountOut: String(zeroxResult.feeAmountOut.toFixed(8)),
    }).catch(() => {});
    return zeroxResult;
  }

  console.warn(`[ETH Agent Swap] 0x failed: ${zeroxResult.message}`);
  console.log("[ETH Agent Swap] Falling back to 1inch (requires ONEINCH_API_KEY)");

  const fromAsset = resolveEthToken(fromToken);
  const toAsset   = resolveEthToken(toToken);

  if (!fromAsset || !toAsset) {
    return {
      success: false,
      demo: false,
      txHash: null,
      outAmount: null,
      route: "1inch DEX",
      agentAddress,
      explorerUrl: null,
      feeBps: PLATFORM_FEE_BPS,
      feeAmountOut: 0,
      message: `Unsupported token pair for 1inch: ${fromToken} → ${toToken}. Supported: ETH, USDT, USDC, WBTC, DAI, WETH.`,
    };
  }

  const amountRaw = BigInt(Math.floor(amount * Math.pow(10, fromAsset.decimals))).toString();

  // Get quote first for outAmount
  const quote = await get1inchQuote(fromAsset.address, toAsset.address, amountRaw);
  const quotedOutAmount = quote
    ? Number(quote.toAmount) / Math.pow(10, toAsset.decimals)
    : null;

  // Get executable swap tx
  const swapData = await get1inchSwapTx(
    fromAsset.address,
    toAsset.address,
    amountRaw,
    agentAddress,
  );

  if (!swapData?.tx) {
    return {
      success: false,
      demo: false,
      txHash: null,
      outAmount: quotedOutAmount ?? oracleOutAmount,
      route: "1inch DEX",
      agentAddress,
      explorerUrl: null,
      feeBps: PLATFORM_FEE_BPS,
      feeAmountOut: 0,
      message:
        "Failed to build 1inch swap transaction. " +
        "The agent wallet may have insufficient ETH for gas (need ≥0.01 ETH). " +
        "Note: 1inch requires ONEINCH_API_KEY — add it in Settings to enable.",
    };
  }

  // If from-token is ERC-20, approve 1inch router first
  if (fromAsset.address !== ETH_NATIVE) {
    try {
      const erc20Abi = [
        "function allowance(address owner, address spender) view returns (uint256)",
        "function approve(address spender, uint256 amount) returns (bool)",
      ];
      const tokenContract = new ethers.Contract(fromAsset.address, erc20Abi, wallet);
      const ONEINCH_ROUTER = "0x1111111254EEB25477B68fb85Ed929f73A960582"; // 1inch v5 router
      const currentAllowance = await tokenContract.allowance(agentAddress, ONEINCH_ROUTER) as bigint;
      const neededAmount = BigInt(amountRaw);
      if (currentAllowance < neededAmount) {
        console.log(`[ETH Agent Swap] Approving 1inch router for ${fromAsset.symbol}...`);
        const approveTx = await tokenContract.approve(ONEINCH_ROUTER, ethers.MaxUint256) as ethers.TransactionResponse;
        await approveTx.wait(1);
        console.log(`[ETH Agent Swap] Approval confirmed: ${approveTx.hash}`);
      }
    } catch (err) {
      console.warn("[ETH Agent Swap] ERC-20 approval failed:", err);
      // Continue anyway — tx may still succeed if allowance is sufficient
    }
  }

  // Sign and broadcast
  try {
    const tx = swapData.tx;
    const response = await wallet.sendTransaction({
      to:       tx.to,
      data:     tx.data,
      value:    BigInt(tx.value || "0"),
      gasLimit: BigInt(Math.ceil(tx.gas * 1.2)), // 20% buffer
    });
    console.log(`[ETH Agent Swap] Tx submitted: ${response.hash}`);

    const receipt = await response.wait(1);
    if (!receipt || receipt.status === 0) {
      return {
        success: false,
        demo: false,
        txHash: response.hash,
        outAmount: quotedOutAmount,
        route: "1inch DEX",
        agentAddress,
        explorerUrl: `https://etherscan.io/tx/${response.hash}`,
        feeBps: PLATFORM_FEE_BPS,
        feeAmountOut: 0,
        message: `Transaction submitted but reverted on-chain. Tx: ${response.hash}`,
      };
    }

    const outAmount = quotedOutAmount ?? 0;
    const feeAmountOut = outAmount * (PLATFORM_FEE_BPS / 10000);

    void recordSwapAnalytic({
      fromChain:    "ethereum",
      toChain:      toChain as "solana" | "ethereum" | "bitcoin" | "trac_network",
      fromToken:    fromToken.toUpperCase(),
      toToken:      toToken.toUpperCase(),
      amount:       String(amount),
      route:        "1inch DEX (agent direct, fallback)",
      status:       "completed",
      txId:         response.hash,
      feeBps:       PLATFORM_FEE_BPS,
      feeAmountOut: String(feeAmountOut.toFixed(8)),
    }).catch(() => {/* non-fatal */});

    console.log(`[ETH Agent Swap] ✅ ${amount} ${fromToken} → ${outAmount.toFixed(6)} ${toToken} | Tx: ${response.hash}`);

    return {
      success: true,
      demo: false,
      txHash: response.hash,
      outAmount,
      route: "1inch DEX (direct)",
      agentAddress,
      explorerUrl: `https://etherscan.io/tx/${response.hash}`,
      feeBps: PLATFORM_FEE_BPS,
      feeAmountOut,
      message: `ETH swap via 1inch DEX: ${amount} ${fromToken} → ${outAmount.toFixed(6)} ${toToken}. Tx: ${response.hash}`,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[ETH Agent Swap] ❌ Broadcast failed: ${errMsg}`);
    return {
      success: false,
      demo: false,
      txHash: null,
      outAmount: quotedOutAmount,
      route: "1inch DEX",
      agentAddress,
      explorerUrl: null,
      feeBps: PLATFORM_FEE_BPS,
      feeAmountOut: 0,
      message: `ETH swap transaction failed: ${errMsg.slice(0, 200)}`,
    };
  }
}
