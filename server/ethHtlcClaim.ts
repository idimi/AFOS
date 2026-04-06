/**
 * ethHtlcClaim.ts
 *
 * Server-side ETH HTLC claim (redeem) function.
 *
 * Calls HTLC.sol's redeem(bytes32 contractId, bytes32 secret) on behalf of
 * the Oracle VM agent, releasing locked ETH or ERC-20 tokens to the recipient.
 *
 * Mirrors the structure of solanaHtlcClaim.ts and tnkHtlcClaim.ts so that
 * doClaimA / doClaimB in chat.ts can call it with the same interface.
 */

import { ethers } from "ethers";
import { getHtlcAbi } from "./ethHtlc";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EthHtlcClaimParams {
  /** The contractId returned by HTLC.sol when the lock was created (bytes32 hex) */
  contractId: string;
  /** The pre-image secret (bytes32 hex, with or without 0x prefix) */
  secretHex: string;
  /** Human-readable label for logging (e.g. "rfq_abc123") */
  label?: string;
}

export interface EthHtlcClaimResult {
  ok: true;
  txHash: string;
  contractId: string;
  gasUsed: string;
}

export interface EthHtlcClaimError {
  ok: false;
  error: string;
  contractId: string;
}

export type EthHtlcClaimOutcome = EthHtlcClaimResult | EthHtlcClaimError;

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Claim an ETH HTLC by calling redeem(contractId, secret) on HTLC.sol.
 *
 * Uses ETH_HTLC_KEY (falls back to ETH_AGENT_KEY for backwards compatibility).
 * Returns { ok: true, txHash } on success or { ok: false, error } on failure.
 */
export async function claimEthHtlc(
  params: EthHtlcClaimParams
): Promise<EthHtlcClaimOutcome> {
  const { contractId, secretHex, label = contractId.slice(0, 16) } = params;

  // ── Resolve keys and contract address ──
  const agentKey = process.env.ETH_HTLC_KEY ?? process.env.ETH_AGENT_KEY;
  const rpcUrl = process.env.ETH_RPC_URL;
  const contractAddress = process.env.ETH_HTLC_ADDRESS;

  if (!agentKey) {
    return {
      ok: false,
      error: "ETH_HTLC_KEY and ETH_AGENT_KEY are both unset — cannot sign claim tx",
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

  // ── Normalise inputs ──
  const contractIdHex = contractId.startsWith("0x") ? contractId : "0x" + contractId;
  const secretHexNorm = secretHex.startsWith("0x") ? secretHex : "0x" + secretHex;

  // Pad to bytes32 if needed
  const contractIdBytes32 = ethers.zeroPadValue(contractIdHex, 32);
  const secretBytes32 = ethers.zeroPadValue(secretHexNorm, 32);

  console.log(
    `[EthHTLC] Claiming HTLC contractId=${contractIdHex.slice(0, 18)}… label=${label}`
  );

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(agentKey, provider);
    const contract = new ethers.Contract(contractAddress, getHtlcAbi(), wallet);

    // ── Gas estimation with fallback ──
    let gasLimit: bigint;
    try {
      const estimated = await contract.redeem.estimateGas(
        contractIdBytes32,
        secretBytes32
      );
      gasLimit = (estimated * 130n) / 100n; // 30% buffer
    } catch {
      // Estimation can fail if the HTLC is already claimed or the secret is wrong.
      // Use a safe fixed limit so we get a clear revert reason on-chain.
      gasLimit = 120_000n;
    }

    const tx = await contract.redeem(contractIdBytes32, secretBytes32, {
      gasLimit,
    });

    console.log(
      `[EthHTLC] Claim tx broadcast: ${tx.hash} | contractId=${contractIdHex.slice(0, 18)}…`
    );

    const receipt = await tx.wait(1);

    if (!receipt || receipt.status !== 1) {
      return {
        ok: false,
        error: `Claim tx reverted: ${tx.hash}`,
        contractId,
      };
    }

    console.log(
      `[EthHTLC] ✅ Claim confirmed: ${tx.hash} | gasUsed=${receipt.gasUsed} | block=${receipt.blockNumber}`
    );

    return {
      ok: true,
      txHash: tx.hash,
      contractId,
      gasUsed: receipt.gasUsed.toString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // ── Already claimed / already redeemed ──
    if (
      message.includes("HTLC: already") ||
      message.includes("already redeemed") ||
      message.includes("invalid state") ||
      message.includes("execution reverted") && message.includes("state")
    ) {
      console.warn(
        `[EthHTLC] HTLC ${contractIdHex.slice(0, 18)}… already claimed or in wrong state: ${message}`
      );
      return {
        ok: false,
        error: `AlreadyClaimed: ${message}`,
        contractId,
      };
    }

    console.error(
      `[EthHTLC] ❌ Claim failed contractId=${contractIdHex.slice(0, 18)}…:`,
      message
    );
    return { ok: false, error: message, contractId };
  }
}

/**
 * Returns true if the error indicates the HTLC was already claimed on-chain.
 * Used by doClaimA / doClaimB to distinguish "already done" from real failures.
 */
export function isEthHtlcAlreadyClaimed(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("AlreadyClaimed") ||
    message.includes("already redeemed") ||
    message.includes("HTLC: already") ||
    message.includes("invalid state")
  );
}
