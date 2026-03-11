/**
 * solanaHtlc.ts — Solana HTLC Lock Transaction Builder
 *
 * Uses the deployed AFOS HTLC Anchor program:
 *   Program ID: XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW
 *
 * Architecture:
 *   - lockSol:   Locks native SOL into a PDA escrow owned by the program
 *   - lockToken: Locks SPL tokens (USDT/USDC) into a PDA vault ATA
 *   - claim:     AFOS agent reveals preimage → program releases funds to recipient
 *   - refund:    Sender calls after timelock expires → program returns funds
 *
 * The program enforces all rules on-chain. AFOS agent is coordinator only.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  AFOS_HTLC_PROGRAM_ID,
  buildLockSolTx,
  buildLockTokenTx,
  buildRefundInstruction,
  htlcIdToBytes,
  createVaultAtaIfNeeded,
} from "./afosHtlcProgram";

// ─── Well-known SPL token mints ───────────────────────────────────────────────

export const SOLANA_TOKEN_MINTS: Record<string, string> = {
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  SOL:  "", // Native SOL — no mint
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SolanaHtlcLockParams {
  /** Sender's Solana public key */
  senderPubkey: PublicKey;
  /** Recipient's Solana public key (counterparty) */
  recipientPubkey: PublicKey;
  /** Amount in SOL (not lamports) — used for native SOL locks */
  amountSol: number;
  /** SHA-256 hash of the secret (32 bytes as hex string) */
  secretHash: string;
  /** Unix timestamp (seconds) when refund becomes available */
  timelock: number;
  /** Solana connection for fetching recent blockhash */
  connection: Connection;
  /** Optional: agent escrow wallet address (legacy, ignored when program is deployed) */
  escrowAddress?: string;
  /** HTLC ID — unique identifier for this swap (used as PDA seed) */
  htlcId?: string;
  /** Token symbol to lock (e.g., "USDT", "USDC"). If omitted, locks native SOL. */
  tokenSymbol?: string;
  /** Token amount in base units (e.g., 1 USDT = 1_000_000 for 6 decimals) */
  tokenAmountBase?: bigint;
}

export interface SolanaHtlcLockResult {
  /** The built transaction (unsigned) */
  transaction: Transaction;
  /** The PDA escrow address where funds will be locked */
  escrowAddress: string;
  /** The secret hash used (hex) */
  secretHash: string;
  /** The timelock used (Unix seconds) */
  timelock: number;
  /** The HTLC ID used as PDA seed */
  htlcId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a hex string to a Uint8Array */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Build a Solana HTLC lock transaction using the deployed AFOS HTLC program.
 *
 * For native SOL: calls lock_sol instruction → funds locked in PDA
 * For SPL tokens: calls lock_token instruction → funds locked in PDA vault ATA
 *
 * The program enforces:
 *   - Only the recipient can claim (by revealing the preimage)
 *   - Only the sender can refund (after timelock expires)
 *   - Preimage must hash to secretHash
 */
export async function buildSolanaHtlcLockTx(
  params: SolanaHtlcLockParams
): Promise<SolanaHtlcLockResult> {
  const {
    senderPubkey,
    recipientPubkey,
    amountSol,
    secretHash,
    timelock,
    connection,
    htlcId: providedHtlcId,
    tokenSymbol,
    tokenAmountBase,
  } = params;

  // Use provided htlcId or derive from secretHash (first 16 chars for brevity)
  const htlcId = providedHtlcId ?? `htlc_${secretHash.slice(0, 16)}`;
  const htlcIdBytes = htlcIdToBytes(htlcId);
  const secretHashBytes = hexToBytes(secretHash);

  const isTokenLock = tokenSymbol && tokenSymbol !== "SOL" && tokenSymbol !== "WSOL";

  if (isTokenLock) {
    // ── SPL Token Lock ─────────────────────────────────────────────────────────
    const mintAddress = SOLANA_TOKEN_MINTS[tokenSymbol.toUpperCase()];
    if (!mintAddress) {
      throw new Error(`Unknown token symbol: ${tokenSymbol}. Add mint to SOLANA_TOKEN_MINTS.`);
    }
    const tokenMint = new PublicKey(mintAddress);
    const amount = tokenAmountBase ?? BigInt(Math.floor(amountSol * 1_000_000)); // Default 6 decimals

    const { transaction, htlcPda, vaultAta } = await buildLockTokenTx(connection, {
      sender: senderPubkey,
      htlcId: htlcIdBytes,
      secretHash: secretHashBytes,
      recipient: recipientPubkey,
      timelock,
      tokenMint,
      tokenAmount: amount,
    });

    // Create vault ATA if it doesn't exist yet (prepend to tx)
    const createAtaIx = await createVaultAtaIfNeeded(connection, senderPubkey, htlcPda, tokenMint);
    if (createAtaIx) {
      const ataSetupTx = new Transaction();
      ataSetupTx.recentBlockhash = transaction.recentBlockhash;
      ataSetupTx.feePayer = senderPubkey;
      ataSetupTx.add(createAtaIx);
      // Merge: add the lock instruction to the setup tx
      for (const ix of transaction.instructions) {
        ataSetupTx.add(ix);
      }
      return {
        transaction: ataSetupTx,
        escrowAddress: vaultAta.toBase58(),
        secretHash,
        timelock,
        htlcId,
      };
    }

    return {
      transaction,
      escrowAddress: vaultAta.toBase58(),
      secretHash,
      timelock,
      htlcId,
    };
  } else {
    // ── Native SOL Lock ────────────────────────────────────────────────────────
    const lamports = BigInt(Math.floor(amountSol * LAMPORTS_PER_SOL));

    const { transaction, htlcPda } = await buildLockSolTx(connection, {
      sender: senderPubkey,
      htlcId: htlcIdBytes,
      secretHash: secretHashBytes,
      recipient: recipientPubkey,
      timelock,
      amountLamports: lamports,
    });

    return {
      transaction,
      escrowAddress: htlcPda.toBase58(),
      secretHash,
      timelock,
      htlcId,
    };
  }
}

/**
 * Generate a random secret and its SHA-256 hash for use in an HTLC.
 * Returns { secretHex, secretHashHex } — store secretHex securely, share only secretHashHex.
 */
export async function generateHtlcSecret(): Promise<{
  secretHex: string;
  secretHashHex: string;
}> {
  const secretBytes   = crypto.getRandomValues(new Uint8Array(32));
  const secretHashBuf = await crypto.subtle.digest("SHA-256", secretBytes);
  const toHex = (b: Uint8Array) =>
    Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");
  return {
    secretHex:     toHex(secretBytes),
    secretHashHex: toHex(new Uint8Array(secretHashBuf)),
  };
}

// ─── Refund Transaction Builder ───────────────────────────────────────────────

export interface SolanaHtlcRefundParams {
  senderPubkey: PublicKey;
  htlcId: string;
  connection: Connection;
  tokenSymbol?: string;
}

export interface SolanaHtlcRefundResult {
  transaction: Transaction;
  escrowAddress: string;
}

/**
 * Build a Solana HTLC refund transaction.
 * Calls the program's refund instruction — only succeeds after timelock expires.
 * The sender gets their funds back automatically.
 */
export async function buildSolanaHtlcRefundTx(
  params: SolanaHtlcRefundParams
): Promise<SolanaHtlcRefundResult> {
  const { senderPubkey, htlcId, connection, tokenSymbol } = params;

  const htlcIdBytes = htlcIdToBytes(htlcId);
  const isTokenLock = tokenSymbol && tokenSymbol !== "SOL" && tokenSymbol !== "WSOL";

  let tokenMint: PublicKey | undefined;
  if (isTokenLock) {
    const mintAddress = SOLANA_TOKEN_MINTS[tokenSymbol.toUpperCase()];
    if (mintAddress) tokenMint = new PublicKey(mintAddress);
  }

  const refundIx = buildRefundInstruction({
    sender: senderPubkey,
    htlcId: htlcIdBytes,
    tokenMint,
  });

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = senderPubkey;
  tx.add(refundIx);

  // Derive the PDA address for reference
  const [htlcPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("htlc"), htlcIdBytes],
    AFOS_HTLC_PROGRAM_ID
  );

  return {
    transaction: tx,
    escrowAddress: htlcPda.toBase58(),
  };
}
