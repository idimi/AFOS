/**
 * agentSwapEthToTnk.ts
 *
 * Dedicated agent swap: ETH / USDT (Ethereum) / USDC (Ethereum) → TNK
 *
 * Flow (mirrors agentSwapSolToTnk.ts but uses HTLC.sol on the ETH side):
 *
 *   Step 1 — Agent locks TNK on Trac Network
 *             (server-side, signed with TNK_HTLC_WIF via Oracle VM)
 *   Step 2 — Server returns a pre-built ETH HTLC lock tx for the user to sign
 *             (eth_sendTransaction payload — user signs with MetaMask)
 *   Step 3 — User broadcasts the ETH lock transaction
 *   Step 4 — htlcSecretsMonitor detects the ETH lock event and claims TNK
 *             from Trac Network, releasing it to the user's TNK address
 *
 * The atomic guarantee:
 *   - If the user never signs the ETH lock → agent's TNK lock expires and is refunded
 *   - If the user locks ETH but the agent fails to claim → user can refund ETH after timelock
 *   - Both sides settle or both sides refund — no partial execution
 */

import { ethers } from "ethers";
import { buildHtlcLockTx } from "./ethHtlc";
import { recordSwapAnalytic, saveHtlcSecret } from "./db";

// ─── Constants ────────────────────────────────────────────────────────────────

const TNK_DECIMALS          = 8;
const TNK_NETWORK_FEE_TNK   = 0.03;  // 0.03 TNK network fee for Trac Network broadcast
const P2P_FEE_BPS           = 30;    // 0.30% platform fee on output amount
const DEFAULT_TIMELOCK_SECS = 86_400; // 24h agent TNK lock; user ETH lock = 12h
const ORACLE_API            = process.env.ORACLE_API_URL ?? "http://141.253.123.101:4000";

// ERC-20 token addresses on Ethereum mainnet
const ETH_TOKENS: Record<string, { address: string | null; decimals: number }> = {
  ETH:  { address: null,                                           decimals: 18 },
  USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",  decimals: 6  },
  USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",  decimals: 6  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EthToTnkParams {
  /** User's Ethereum address — locks ETH/USDT/USDC here */
  userEthAddress: string;
  /** User's Trac Network address — receives TNK here */
  userTnkAddress: string;
  /** Source token: "ETH" | "USDT" | "USDC" */
  fromToken: string;
  /** Amount of ETH/USDT/USDC the user wants to swap */
  amount: number;
  /** Pre-calculated TNK output amount (from quote) */
  tnkOutAmount: number;
  /** RFQ identifier for DB tracking */
  rfqId: string;
}

export interface EthToTnkResult {
  success: boolean;
  demo: boolean;
  rfqId: string;
  /** Base64-encoded ETH lock tx for MetaMask (eth_sendTransaction payload) */
  ethLockTxBase64: string | null;
  /** Raw eth_sendTransaction payload { to, data, value, gas } */
  ethLockTxPayload: { to: string; data: string; value: string; gas: string } | null;
  /** User's HTLC lock ID on Ethereum */
  htlcId: string;
  secretHashHex: string;
  /** Trac Network tx hash of the agent's TNK lock */
  tnkLockTxHash: string | null;
  outAmount: number;
  feeAmountOut: number;
  networkFeeAmountOut: number;
  /** Agent's Ethereum address (user sends ETH/USDT/USDC here via HTLC) */
  agentEthAddress: string;
  /** Unix ms when the user's ETH lock expires */
  htlcExpiresAt: number;
  message: string;
  nextStep: string;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Initiate an ETH/USDT/USDC → TNK atomic swap.
 *
 * The agent locks TNK on Trac Network first, then returns a pre-built ETH HTLC
 * lock transaction for the user to sign with MetaMask.
 */
export async function initiateEthToTnkSwap(params: EthToTnkParams): Promise<EthToTnkResult> {
  const { userEthAddress, userTnkAddress, fromToken, amount, tnkOutAmount, rfqId } = params;
  const fromTokenUpper = fromToken.toUpperCase();
  const tokenInfo = ETH_TOKENS[fromTokenUpper];

  if (!tokenInfo) {
    return {
      success: false,
      demo: false,
      rfqId,
      ethLockTxBase64: null,
      ethLockTxPayload: null,
      htlcId: "",
      secretHashHex: "",
      tnkLockTxHash: null,
      outAmount: 0,
      feeAmountOut: 0,
      networkFeeAmountOut: TNK_NETWORK_FEE_TNK,
      agentEthAddress: "",
      htlcExpiresAt: 0,
      message: `Unsupported source token: ${fromToken}. Supported: ETH, USDT, USDC.`,
      nextStep: "Use a supported token.",
    };
  }

  // ── Resolve agent keys ──
  const ethHtlcKey     = process.env.ETH_HTLC_KEY ?? process.env.ETH_AGENT_KEY;
  const tnkHtlcWif     = process.env.TNK_HTLC_WIF;
  const isEthKeySet    = !!ethHtlcKey && !!process.env.ETH_HTLC_ADDRESS;
  const isTnkHtlcLive  = !!tnkHtlcWif;
  const isDemo         = !isEthKeySet || !isTnkHtlcLive;

  if (isDemo) {
    console.warn(
      "[EthToTnk] ETH_HTLC_KEY, ETH_HTLC_ADDRESS, or TNK_HTLC_WIF not set — running in demo mode"
    );
  }

  // Resolve agent ETH address
  let agentEthAddress = "";
  if (ethHtlcKey) {
    try {
      agentEthAddress = new ethers.Wallet(ethHtlcKey).address;
    } catch { /* handled below */ }
  }

  // ── Generate secret ──
  const secretBytes   = ethers.randomBytes(32);
  const secretHex     = ethers.hexlify(secretBytes);
  const secretHashHex = ethers.keccak256(secretBytes);

  // ── HTLC IDs ──
  const now    = Math.floor(Date.now() / 1000);
  const htlcId = `htlc_b_ethtink_${rfqId.slice(0, 12)}_${now}`; // user's ETH lock = B side

  // ── Fee calculation ──
  const feeAmountOut        = (tnkOutAmount * P2P_FEE_BPS) / 10_000;
  const netTnkOut           = tnkOutAmount - feeAmountOut;
  const networkFeeAmountOut = TNK_NETWORK_FEE_TNK;

  // ── Timelocks ──
  // Agent TNK lock: 24h (longer — agent locks first)
  const tnkTimelockUnix = now + DEFAULT_TIMELOCK_SECS;
  // User ETH lock: 12h (shorter — must settle before agent's TNK lock expires)
  const ethTimelockUnix = now + Math.floor(DEFAULT_TIMELOCK_SECS / 2);
  const htlcExpiresAt   = ethTimelockUnix * 1000; // ms for frontend

  // ── Step 1: Agent locks TNK on Trac Network via Oracle VM ────────────────
  let tnkLockTxHash: string | null = null;

  if (isTnkHtlcLive) {
    try {
      // Call Oracle VM to lock TNK on Trac Network
      const tnkLockRes = await fetch(`${ORACLE_API}/api/htlc/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromToken:   "TNK",
          toToken:     fromTokenUpper,
          amount:      netTnkOut + networkFeeAmountOut,
          secretHash:  secretHashHex,
          recipient:   userTnkAddress,
          locktime:    tnkTimelockUnix,
          rfqId,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (tnkLockRes.ok) {
        const tnkLockData = await tnkLockRes.json() as {
          success?: boolean;
          txHash?: string;
          result?: { txHash?: string };
        };
        tnkLockTxHash =
          tnkLockData.txHash ??
          tnkLockData.result?.txHash ??
          null;
        if (tnkLockTxHash) {
          console.log(`[EthToTnk] Agent locked ${netTnkOut.toFixed(6)} TNK on Trac Network: ${tnkLockTxHash}`);
        } else {
          throw new Error("Oracle VM returned success but no txHash");
        }
      } else {
        const errText = await tnkLockRes.text();
        throw new Error(`Oracle VM TNK lock failed (${tnkLockRes.status}): ${errText.slice(0, 200)}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[EthToTnk] TNK lock failed: ${msg}`);
      return {
        success: false,
        demo: false,
        rfqId,
        ethLockTxBase64: null,
        ethLockTxPayload: null,
        htlcId,
        secretHashHex,
        tnkLockTxHash: null,
        outAmount: netTnkOut,
        feeAmountOut,
        networkFeeAmountOut,
        agentEthAddress,
        htlcExpiresAt,
        message: `Trac Network TNK lock failed: ${msg}`,
        nextStep: "Check TNK_HTLC_WIF and Oracle VM connectivity.",
      };
    }
  } else {
    tnkLockTxHash = `demo_tnk_lock_${rfqId.slice(0, 16)}`;
    console.warn(`[EthToTnk] DEMO mode — simulated TNK lock: ${tnkLockTxHash}`);
  }

  // ── Step 2: Build ETH HTLC lock tx for user to sign ──────────────────────
  let ethLockTxPayload: { to: string; data: string; value: string; gas: string } | null = null;
  let ethLockTxBase64: string | null = null;

  if (isEthKeySet) {
    const lockParams = fromTokenUpper === "ETH"
      ? {
          secretHash: secretHashHex,
          recipient:  agentEthAddress,
          timelock:   ethTimelockUnix,
          amountWei:  BigInt(Math.round(amount * 1e18)),
        }
      : {
          secretHash:   secretHashHex,
          recipient:    agentEthAddress,
          timelock:     ethTimelockUnix,
          tokenAddress: tokenInfo.address!,
          tokenAmount:  BigInt(Math.round(amount * 10 ** tokenInfo.decimals)),
        };

    ethLockTxPayload = buildHtlcLockTx(lockParams);
    if (ethLockTxPayload) {
      ethLockTxBase64 = Buffer.from(JSON.stringify(ethLockTxPayload)).toString("base64");
    }
  } else {
    // Demo mode — return a placeholder payload
    ethLockTxPayload = {
      to:    process.env.ETH_HTLC_ADDRESS ?? "0x0000000000000000000000000000000000000000",
      data:  "0x",
      value: fromTokenUpper === "ETH" ? "0x" + BigInt(Math.round(amount * 1e18)).toString(16) : "0x0",
      gas:   "0x30D40",
    };
    ethLockTxBase64 = Buffer.from(JSON.stringify(ethLockTxPayload)).toString("base64");
  }

  // ── Step 3: Save secret to DB ─────────────────────────────────────────────
  void saveHtlcSecret({
    rfqId,
    secretHex,
    secretHashHex,
    fromChain:           "ethereum",
    toChain:             "trac_network",
    fromToken:           fromTokenUpper,
    toToken:             "TNK",
    initiatorAddress:    userEthAddress,
    counterpartyAddress: userTnkAddress,
    htlcId,
    expiresAt:           BigInt(ethTimelockUnix),
    status:              "locked" as const,
    lockTxId:            tnkLockTxHash ?? undefined,
  }).catch(() => {/* non-fatal */});

  // ── Record analytics ──────────────────────────────────────────────────────
  void recordSwapAnalytic({
    fromChain:    "ethereum",
    toChain:      "trac_network",
    fromToken:    fromTokenUpper,
    toToken:      "TNK",
    amount:       String(amount),
    route:        `AFOS ${fromTokenUpper}(ETH)→TNK HTLC`,
    status:       "completed",
    walletAddress: userEthAddress,
    feeBps:       P2P_FEE_BPS,
    feeAmountOut: String(feeAmountOut.toFixed(8)),
  }).catch(() => {/* non-fatal */});

  return {
    success:             true,
    demo:                isDemo,
    rfqId,
    ethLockTxBase64,
    ethLockTxPayload,
    htlcId,
    secretHashHex,
    tnkLockTxHash,
    outAmount:           netTnkOut,
    feeAmountOut,
    networkFeeAmountOut,
    agentEthAddress,
    htlcExpiresAt,
    message:
      isDemo
        ? `[DEMO] Agent would lock ${netTnkOut.toFixed(6)} TNK on Trac Network. ` +
          `Sign the Ethereum lock transaction in MetaMask to complete the swap.`
        : `Agent locked ${netTnkOut.toFixed(6)} TNK on Trac Network (tx: ${tnkLockTxHash?.slice(0, 18)}…). ` +
          `Sign the Ethereum lock transaction in MetaMask to complete the swap.`,
    nextStep:
      "Call eth_sendTransaction with the returned { to, data, value } payload using MetaMask. " +
      "The AFOS agent will automatically claim ETH and release your TNK once your lock is confirmed.",
  };
}
