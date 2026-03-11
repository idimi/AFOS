/**
 * solanaTokenHtlc.ts — Solana SPL Token HTLC Lock Transaction Builder
 *
 * Delegates to the deployed AFOS HTLC program (lock_token instruction).
 * Locks SPL tokens (USDT, USDC) into a PDA vault ATA owned by the program.
 *
 * The program enforces:
 *   - Only the recipient can claim (by revealing the preimage)
 *   - Only the sender can refund (after timelock expires)
 *   - Preimage must hash to secretHash
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { buildSolanaHtlcLockTx, SolanaHtlcLockResult } from "./solanaHtlc";

// ─── Token Mint Addresses ────────────────────────────────────────────────────

export const TOKEN_MINTS: Record<string, { mint: string; decimals: number }> = {
  USDT: { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
  USDC: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SolanaTokenHtlcLockParams {
  senderPubkey: PublicKey;
  recipientPubkey: PublicKey;
  tokenSymbol: string;
  amount: number;
  secretHash: string;
  timelock: number;
  connection: Connection;
  htlcId?: string;
  /** @deprecated escrowAddress is ignored — program PDA is used instead */
  escrowAddress?: string;
}

export interface SolanaTokenHtlcLockResult extends SolanaHtlcLockResult {
  escrowAta: string;
  tokenSymbol: string;
  amount: number;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Build a Solana SPL token HTLC lock transaction using the deployed AFOS HTLC program.
 * Funds are locked in a PDA vault ATA — only claimable by the recipient with the preimage.
 */
export async function buildSolanaTokenHtlcLockTx(
  params: SolanaTokenHtlcLockParams
): Promise<SolanaTokenHtlcLockResult> {
  const { tokenSymbol, amount, connection } = params;

  const tokenInfo = TOKEN_MINTS[tokenSymbol.toUpperCase()];
  if (!tokenInfo) {
    throw new Error(`Unsupported token: ${tokenSymbol}. Supported: ${Object.keys(TOKEN_MINTS).join(", ")}`);
  }

  const tokenAmountBase = BigInt(Math.floor(amount * Math.pow(10, tokenInfo.decimals)));

  const result = await buildSolanaHtlcLockTx({
    senderPubkey: params.senderPubkey,
    recipientPubkey: params.recipientPubkey,
    amountSol: amount,
    secretHash: params.secretHash,
    timelock: params.timelock,
    connection,
    htlcId: params.htlcId,
    tokenSymbol: tokenSymbol.toUpperCase(),
    tokenAmountBase,
  });

  return {
    ...result,
    escrowAta: result.escrowAddress, // For SPL locks, escrowAddress IS the vault ATA
    tokenSymbol: tokenSymbol.toUpperCase(),
    amount,
  };
}
