/**
 * agentSwapTnkToEth.ts
 *
 * Dedicated agent swap: TNK → ETH / USDT (Ethereum) / USDC (Ethereum)
 *
 * Flow (mirrors agentSwapTnkToSol.ts but uses HTLC.sol on the ETH side):
 *
 *   Step 1 — Agent locks ETH/USDT/USDC in HTLC.sol on Ethereum
 *             (server-side, signed with ETH_HTLC_KEY)
 *   Step 2 — Server returns a TNK lock payload for the user to sign in Tap Wallet
 *             (htlcIdB, secretHash, amountRaw, locktime, sender, recipient)
 *   Step 3 — User broadcasts the TNK lock transaction
 *   Step 4 — Helius / htlcSecretsMonitor detects the TNK lock and calls claimEthHtlc()
 *             to release ETH/USDT/USDC to the user's Ethereum address
 *
 * The atomic guarantee:
 *   - If the user never locks TNK → agent's ETH lock expires and is refunded automatically
 *   - If the user locks TNK but the agent fails to claim → user can refund TNK after timelock
 *   - Both sides settle or both sides refund — no partial execution
 */

import { ethers } from "ethers";
import { buildHtlcLockTx } from "./ethHtlc";
import { recordSwapAnalytic } from "./db";
import { saveHtlcSecret } from "./db";

// ─── Constants ────────────────────────────────────────────────────────────────

const TNK_DECIMALS        = 8;
const TNK_NETWORK_FEE_TNK = 0.03;   // 0.03 TNK charged to cover Trac Network broadcast fee
const P2P_FEE_BPS         = 30;     // 0.30% platform fee on output amount
const DEFAULT_TIMELOCK_SECS = 86_400; // 24h agent ETH lock; user TNK lock = 12h

// ERC-20 token addresses on Ethereum mainnet
const ETH_TOKENS: Record<string, { address: string | null; decimals: number }> = {
  ETH:  { address: null,                                           decimals: 18 },
  USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",  decimals: 6  },
  USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",  decimals: 6  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TnkToEthParams {
  /** User's Ethereum address — receives ETH/USDT/USDC */
  userEthAddress: string;
  /** User's Trac Network address — locks TNK here */
  userTnkAddress: string;
  /** Destination token: "ETH" | "USDT" | "USDC" */
  toToken: string;
  /** Amount of TNK the user wants to swap */
  amount: number;
  /** Pre-calculated ETH/USDT/USDC output amount (from quote) */
  ethOutAmount: number;
  /** RFQ identifier for DB tracking */
  rfqId: string;
}

export interface TnkToEthResult {
  success: boolean;
  demo: boolean;
  rfqId: string;
  /** Base64-encoded TNK lock payload for Tap Wallet */
  tnkLockTxPayload: string | null;
  /** Agent's HTLC lock ID on Ethereum (contractId) */
  htlcIdA: string;
  /** User's HTLC lock ID on Trac Network */
  htlcIdB: string;
  secretHashHex: string;
  /** Ethereum tx hash of the agent's lock */
  ethLockTxHash: string | null;
  outAmount: number;
  feeAmountOut: number;
  networkFeeAmountOut: number;
  /** Agent's TNK address (user sends TNK here) */
  agentTnkAddress: string;
  /** Unix ms when the user's TNK lock expires */
  htlcExpiresAt: number;
  message: string;
  nextStep: string;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Initiate a TNK → ETH/USDT/USDC atomic swap.
 *
 * The agent locks ETH/USDT/USDC on Ethereum first, then returns a TNK lock
 * payload for the user to sign in their Tap Wallet.
 */
export async function initiateTnkToEthSwap(params: TnkToEthParams): Promise<TnkToEthResult> {
  const { userEthAddress, userTnkAddress, toToken, amount, ethOutAmount, rfqId } = params;
  const toTokenUpper = toToken.toUpperCase();
  const tokenInfo = ETH_TOKENS[toTokenUpper];

  if (!tokenInfo) {
    return {
      success: false,
      demo: false,
      rfqId,
      tnkLockTxPayload: null,
      htlcIdA: "",
      htlcIdB: "",
      secretHashHex: "",
      ethLockTxHash: null,
      outAmount: 0,
      feeAmountOut: 0,
      networkFeeAmountOut: TNK_NETWORK_FEE_TNK,
      agentTnkAddress: "",
      htlcExpiresAt: 0,
      message: `Unsupported destination token: ${toToken}. Supported: ETH, USDT, USDC.`,
      nextStep: "Use a supported token.",
    };
  }

  // ── Resolve agent keys ──
  const ethHtlcKey = process.env.ETH_HTLC_KEY ?? process.env.ETH_AGENT_KEY;
  const agentTnkAddress = process.env.TNK_AGENT_KEY
    ? (() => {
        try {
          // TNK_AGENT_KEY is a PKCS8 DER hex — derive address via trac-peer convention
          // For now use the env var directly if it looks like an address
          const raw = process.env.TNK_AGENT_KEY!;
          return raw.length === 40 || raw.length === 42 ? raw : `tnk_agent_${raw.slice(0, 12)}`;
        } catch { return ""; }
      })()
    : "";

  // Resolve agent ETH address for the lock
  let agentEthAddress = "";
  if (ethHtlcKey) {
    try {
      const wallet = new ethers.Wallet(ethHtlcKey);
      agentEthAddress = wallet.address;
    } catch { /* handled below */ }
  }

  const isDemo = !ethHtlcKey || !process.env.ETH_HTLC_ADDRESS;
  if (isDemo) {
    console.warn(
      "[TnkToEth] ETH_HTLC_KEY or ETH_HTLC_ADDRESS not set — running in demo mode"
    );
  }

  // ── Generate secret ──
  const secretBytes = ethers.randomBytes(32);
  const secretHex = ethers.hexlify(secretBytes);
  const secretHashHex = ethers.keccak256(secretBytes);

  // ── HTLC IDs ──
  const now = Math.floor(Date.now() / 1000);
  const htlcIdA = `htlc_a_tnketh_${rfqId.slice(0, 12)}_${now}`;
  const htlcIdB = `htlc_b_tnketh_${rfqId.slice(0, 12)}_${now}`;

  // ── Fee calculation ──
  const feeAmountOut = (ethOutAmount * P2P_FEE_BPS) / 10_000;
  const netEthOut    = ethOutAmount - feeAmountOut;

  // ── Timelocks ──
  // Agent ETH lock: 24h (longer — agent locks first)
  const ethTimelockUnix = now + DEFAULT_TIMELOCK_SECS;
  // User TNK lock: 12h (shorter — must settle before agent's lock expires)
  const tnkTimelockUnix = now + Math.floor(DEFAULT_TIMELOCK_SECS / 2);
  const htlcExpiresAt   = tnkTimelockUnix * 1000; // ms for frontend

  // ── Step 1: Agent locks ETH/USDT/USDC on Ethereum ────────────────────────
  let ethLockTxHash: string | null = null;

  if (!isDemo) {
    try {
      const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL!);
      const agentWallet = new ethers.Wallet(ethHtlcKey!, provider);

      if (toTokenUpper === "ETH") {
        // ── Lock native ETH ──
        const amountWei = BigInt(Math.round(netEthOut * 1e18));
        const lockTxPayload = buildHtlcLockTx({
          secretHash:  secretHashHex,
          recipient:   userEthAddress,
          timelock:    ethTimelockUnix,
          amountWei,
        });
        if (!lockTxPayload) throw new Error("ETH_HTLC_ADDRESS not set");

        const tx = await agentWallet.sendTransaction({
          to:       lockTxPayload.to,
          data:     lockTxPayload.data,
          value:    amountWei,
          gasLimit: BigInt(parseInt(lockTxPayload.gas, 16)) * 2n, // 2x buffer for safety
        });
        const receipt = await tx.wait(1);
        if (!receipt || receipt.status !== 1) throw new Error(`ETH lock tx reverted: ${tx.hash}`);
        ethLockTxHash = tx.hash;
        console.log(`[TnkToEth] Agent locked ${netEthOut.toFixed(6)} ETH on Ethereum: ${ethLockTxHash}`);

      } else {
        // ── Lock ERC-20 (USDT or USDC) ──
        const tokenAddress = tokenInfo.address!;
        const tokenAmount  = BigInt(Math.round(netEthOut * 10 ** tokenInfo.decimals));

        // First approve the HTLC contract to spend tokens
        const erc20Abi = [
          "function approve(address spender, uint256 amount) returns (bool)",
          "function allowance(address owner, address spender) view returns (uint256)",
        ];
        const erc20 = new ethers.Contract(tokenAddress, erc20Abi, agentWallet);
        const contractAddress = process.env.ETH_HTLC_ADDRESS!;

        const currentAllowance: bigint = await erc20.allowance(agentEthAddress, contractAddress);
        if (currentAllowance < tokenAmount) {
          const approveTx = await erc20.approve(contractAddress, tokenAmount * 2n); // approve 2x for efficiency
          await approveTx.wait(1);
          console.log(`[TnkToEth] Approved ${toTokenUpper} spending for HTLC contract`);
        }

        const lockTxPayload = buildHtlcLockTx({
          secretHash:   secretHashHex,
          recipient:    userEthAddress,
          timelock:     ethTimelockUnix,
          tokenAddress,
          tokenAmount,
        });
        if (!lockTxPayload) throw new Error("ETH_HTLC_ADDRESS not set");

        const tx = await agentWallet.sendTransaction({
          to:       lockTxPayload.to,
          data:     lockTxPayload.data,
          value:    0n,
          gasLimit: BigInt(parseInt(lockTxPayload.gas, 16)) * 2n,
        });
        const receipt = await tx.wait(1);
        if (!receipt || receipt.status !== 1) throw new Error(`ERC-20 lock tx reverted: ${tx.hash}`);
        ethLockTxHash = tx.hash;
        console.log(`[TnkToEth] Agent locked ${netEthOut.toFixed(6)} ${toTokenUpper} on Ethereum: ${ethLockTxHash}`);
      }

      // Save secret to DB immediately after ETH lock
      void saveHtlcSecret({
        rfqId,
        secretHex,
        secretHashHex,
        fromChain:           "trac_network",
        toChain:             "ethereum",
        fromToken:           "TNK",
        toToken:             toTokenUpper,
        initiatorAddress:    userTnkAddress,
        counterpartyAddress: userEthAddress,
        htlcId:              htlcIdA,
        expiresAt:           BigInt(ethTimelockUnix),
        status:              "locked" as const,
        lockTxId:            ethLockTxHash ?? undefined,
      }).catch(() => {/* non-fatal */});

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[TnkToEth] ETH lock failed: ${msg}`);
      return {
        success: false,
        demo: false,
        rfqId,
        tnkLockTxPayload: null,
        htlcIdA,
        htlcIdB,
        secretHashHex,
        ethLockTxHash: null,
        outAmount: netEthOut,
        feeAmountOut,
        networkFeeAmountOut: TNK_NETWORK_FEE_TNK,
        agentTnkAddress,
        htlcExpiresAt,
        message: `Ethereum lock failed: ${msg}`,
        nextStep: "Check ETH_HTLC_KEY balance and ETH_RPC_URL connectivity.",
      };
    }
  } else {
    ethLockTxHash = `demo_eth_lock_${rfqId.slice(0, 16)}`;
    console.warn(`[TnkToEth] DEMO mode — simulated ETH lock: ${ethLockTxHash}`);
  }

  // ── Step 2: Build TNK lock payload for user ───────────────────────────────
  // User locks TNK into htlcIdB on Trac Network.
  // Amount includes 0.03 TNK network fee to cover the claim broadcast.
  const tnkLockTotal  = amount + TNK_NETWORK_FEE_TNK;
  const tnkAmountRaw  = Math.round(tnkLockTotal * 10 ** TNK_DECIMALS).toString();

  const tnkLockPayload = {
    type: "htlc_lock",
    value: {
      htlcId:     htlcIdB,
      secretHash: secretHashHex,
      amountRaw:  tnkAmountRaw,
      locktime:   tnkTimelockUnix,
      sender:     userTnkAddress,
      recipient:  agentTnkAddress,
    },
  };
  const tnkLockTxPayload = Buffer.from(JSON.stringify(tnkLockPayload)).toString("base64");

  // ── Record analytics ──────────────────────────────────────────────────────
  void recordSwapAnalytic({
    fromChain:    "trac_network",
    toChain:      "ethereum",
    fromToken:    "TNK",
    toToken:      toTokenUpper,
    amount:       String(amount),
    route:        `AFOS TNK→${toTokenUpper}(ETH) HTLC`,
    status:       "completed",
    walletAddress: userEthAddress,
    feeBps:       P2P_FEE_BPS,
    feeAmountOut: String(feeAmountOut.toFixed(8)),
  }).catch(() => {/* non-fatal */});

  return {
    success:             true,
    demo:                isDemo,
    rfqId,
    tnkLockTxPayload,
    htlcIdA,
    htlcIdB,
    secretHashHex,
    ethLockTxHash,
    outAmount:           netEthOut,
    feeAmountOut,
    networkFeeAmountOut: TNK_NETWORK_FEE_TNK,
    agentTnkAddress,
    htlcExpiresAt,
    message:
      isDemo
        ? `[DEMO] Agent would lock ${netEthOut.toFixed(6)} ${toTokenUpper} on Ethereum. ` +
          `Sign the TNK lock transaction in your Tap Wallet to complete the swap.`
        : `Agent locked ${netEthOut.toFixed(6)} ${toTokenUpper} on Ethereum (tx: ${ethLockTxHash?.slice(0, 18)}…). ` +
          `Sign the TNK lock transaction in your Tap Wallet to complete the swap.`,
    nextStep:
      "Sign and broadcast the TNK lock transaction in your Tap Wallet. " +
      `The agent will claim TNK and release your ${toTokenUpper} on Ethereum automatically.`,
  };
}
