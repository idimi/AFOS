/**
 * ethHtlcRefund.ts
 *
 * Server-side ETH HTLC refund function.
 *
 * Calls HTLC.sol's refund(bytes32 contractId) after the timelock has expired,
 * returning locked ETH or ERC-20 tokens to the original sender.
 *
 * Called by htlcMonitor.ts → triggerEthRefund() when a swap expires.
 * Mirrors the structure of solanaHtlcRefund.ts.
 */

import { ethers } from "ethers";
import { getHtlcAbi } from "./ethHtlc";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EthHtlcRefundResult {
  ok: true;
  txHash: string;
  contractId: string;
  gasUsed: string;
}

export interface EthHtlcRefundError {
  ok: false;
  error: string;
  contractId: string;
}

export type EthHtlcRefundOutcome = EthHtlcRefundResult | EthHtlcRefundError;

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Refund an expired ETH HTLC by calling refund(contractId) on HTLC.sol.
 *
 * The timelock must have passed on-chain before this will succeed.
 * Uses ETH_HTLC_KEY (falls back to ETH_AGENT_KEY for backwards compatibility).
 *
 * Returns { ok: true, txHash } on success or { ok: false, error } on failure.
 */
export async function refundEthHtlc(
  contractId: string,
  label?: string
): Promise<EthHtlcRefundOutcome> {
  const logLabel = label ?? contractId.slice(0, 16);

  // ── Resolve keys and contract address ──
  const agentKey = process.env.ETH_HTLC_KEY ?? process.env.ETH_AGENT_KEY;
  const rpcUrl = process.env.ETH_RPC_URL;
  const contractAddress = process.env.ETH_HTLC_ADDRESS;

  if (!agentKey) {
    return {
      ok: false,
      error: "ETH_HTLC_KEY and ETH_AGENT_KEY are both unset — cannot sign refund tx",
      contractId,
    };
  }
  if (!rpcUrl) {
    return { ok: false, error: "ETH_RPC_URL is not set", contractId };
  }
  if (!contractAddress) {
    return {
      ok: false,
      error: "ETH_HTLC_ADDRESS is not set — deploy HTLC.sol first",
      contractId,
    };
  }

  // ── Normalise contractId to bytes32 ──
  const contractIdHex = contractId.startsWith("0x") ? contractId : "0x" + contractId;
  const contractIdBytes32 = ethers.zeroPadValue(contractIdHex, 32);

  console.log(
    `[EthHTLC] Refunding HTLC contractId=${contractIdHex.slice(0, 18)}… label=${logLabel}`
  );

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(agentKey, provider);
    const contract = new ethers.Contract(contractAddress, getHtlcAbi(), wallet);

    // ── Gas estimation with fallback ──
    let gasLimit: bigint;
    try {
      const estimated = await contract.refund.estimateGas(contractIdBytes32);
      gasLimit = (estimated * 130n) / 100n; // 30% buffer
    } catch {
      // Estimation fails if timelock has not yet expired — the tx will revert on-chain
      // with a clear error. Use a safe fixed limit.
      gasLimit = 100_000n;
    }

    const tx = await contract.refund(contractIdBytes32, { gasLimit });

    console.log(
      `[EthHTLC] Refund tx broadcast: ${tx.hash} | contractId=${contractIdHex.slice(0, 18)}…`
    );

    const receipt = await tx.wait(1);

    if (!receipt || receipt.status !== 1) {
      return {
        ok: false,
        error: `Refund tx reverted: ${tx.hash}`,
        contractId,
      };
    }

    console.log(
      `[EthHTLC] ✅ Refund confirmed: ${tx.hash} | gasUsed=${receipt.gasUsed} | block=${receipt.blockNumber}`
    );

    return {
      ok: true,
      txHash: tx.hash,
      contractId,
      gasUsed: receipt.gasUsed.toString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // ── Timelock not yet expired ──
    if (
      message.includes("timelock") ||
      message.includes("not expired") ||
      message.includes("too early") ||
      (message.includes("execution reverted") && message.includes("time"))
    ) {
      console.warn(
        `[EthHTLC] Refund too early for ${contractIdHex.slice(0, 18)}…: ${message}`
      );
      return {
        ok: false,
        error: `TimelockNotExpired: ${message}`,
        contractId,
      };
    }

    // ── Already refunded ──
    if (
      message.includes("already refunded") ||
      message.includes("invalid state") ||
      message.includes("HTLC: already")
    ) {
      console.warn(
        `[EthHTLC] HTLC ${contractIdHex.slice(0, 18)}… already refunded: ${message}`
      );
      return {
        ok: false,
        error: `AlreadyRefunded: ${message}`,
        contractId,
      };
    }

    console.error(
      `[EthHTLC] ❌ Refund failed contractId=${contractIdHex.slice(0, 18)}…:`,
      message
    );
    return { ok: false, error: message, contractId };
  }
}
