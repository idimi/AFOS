/**
 * solanaTokenHtlc.ts — Solana SPL Token HTLC Lock Transaction Builder
 *
 * Builds a Solana transaction that locks SPL tokens (USDT, USDC, etc.) into
 * the HTLC escrow wallet. Used when Agent B needs to lock their counter-asset
 * (e.g., USDT) in a SOL→USDT swap.
 *
 * Architecture:
 *   - Uses the agent escrow wallet (from VITE_SOL_HTLC_ESCROW) as destination
 *   - Creates/finds the escrow's Associated Token Account (ATA) for the token
 *   - Transfers SPL tokens from sender's ATA to escrow's ATA
 *   - Adds a memo instruction with HTLC metadata for server-side tracking
 *   - The server manages claim/refund using SOL_HTLC_KEY
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "@solana/spl-token";

// ─── Token Mint Addresses ────────────────────────────────────────────────────

export const TOKEN_MINTS: Record<string, { mint: string; decimals: number }> = {
  USDT: { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
  USDC: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SolanaTokenHtlcLockParams {
  /** Sender's Solana public key */
  senderPubkey: PublicKey;
  /** Recipient's Solana public key (counterparty — for memo tracking) */
  recipientPubkey: PublicKey;
  /** Token symbol (e.g., "USDT", "USDC") */
  tokenSymbol: string;
  /** Amount in human-readable units (e.g., 0.856 USDT) */
  amount: number;
  /** SHA-256 hash of the secret (32 bytes as hex string) */
  secretHash: string;
  /** Unix timestamp (seconds) when refund becomes available */
  timelock: number;
  /** Solana connection for fetching recent blockhash and account info */
  connection: Connection;
  /** Agent escrow wallet address (from VITE_SOL_HTLC_ESCROW / SOL_HTLC_KEY) */
  escrowAddress: string;
}

export interface SolanaTokenHtlcLockResult {
  /** The built transaction (unsigned) */
  transaction: Transaction;
  /** The escrow address where funds will be locked */
  escrowAddress: string;
  /** The escrow's ATA for the token */
  escrowAta: string;
  /** The secret hash used (hex) */
  secretHash: string;
  /** The timelock used (Unix seconds) */
  timelock: number;
  /** Token symbol locked */
  tokenSymbol: string;
  /** Amount locked (human-readable) */
  amount: number;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Build a Solana SPL token HTLC lock transaction.
 *
 * Transfers SPL tokens from the sender's ATA to the escrow wallet's ATA.
 * Includes a memo instruction with HTLC metadata for server-side tracking.
 */
export async function buildSolanaTokenHtlcLockTx(
  params: SolanaTokenHtlcLockParams
): Promise<SolanaTokenHtlcLockResult> {
  const {
    senderPubkey,
    recipientPubkey,
    tokenSymbol,
    amount,
    secretHash,
    timelock,
    connection,
    escrowAddress,
  } = params;

  // Look up the token mint and decimals
  const tokenInfo = TOKEN_MINTS[tokenSymbol.toUpperCase()];
  if (!tokenInfo) {
    throw new Error(`Unsupported token: ${tokenSymbol}. Supported: ${Object.keys(TOKEN_MINTS).join(", ")}`);
  }

  const mintPubkey = new PublicKey(tokenInfo.mint);
  const escrowPubkey = new PublicKey(escrowAddress);
  const tokenAmount = Math.floor(amount * Math.pow(10, tokenInfo.decimals));

  // Get the sender's ATA (must exist — they should have the tokens)
  const senderAta = await getAssociatedTokenAddress(mintPubkey, senderPubkey);

  // Get the escrow's ATA (may need to be created)
  const escrowAta = await getAssociatedTokenAddress(mintPubkey, escrowPubkey);

  // Fetch recent blockhash
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = senderPubkey;

  // Check if the escrow's ATA exists; if not, create it
  // The sender pays the rent for creating the ATA
  const escrowAtaInfo = await connection.getAccountInfo(escrowAta);
  if (!escrowAtaInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        senderPubkey,   // payer
        escrowAta,      // ATA to create
        escrowPubkey,   // owner of the ATA
        mintPubkey      // token mint
      )
    );
  }

  // Add memo instruction with HTLC metadata so the server can identify the deposit
  // Format: "htlc-token:<secretHash>:<timelock>:<recipientPubkey>:<tokenSymbol>:<amount>"
  const memoData = `htlc-token:${secretHash}:${timelock}:${recipientPubkey.toBase58()}:${tokenSymbol}:${amount}`;
  const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
  const memoIx = new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: senderPubkey, isSigner: true, isWritable: false }],
    data: Buffer.from(memoData, "utf-8"),
  });
  tx.add(memoIx);

  // Transfer SPL tokens from sender's ATA to escrow's ATA
  tx.add(
    createTransferInstruction(
      senderAta,      // source ATA
      escrowAta,      // destination ATA
      senderPubkey,   // owner of source ATA (signer)
      tokenAmount     // amount in smallest units
    )
  );

  return {
    transaction: tx,
    escrowAddress,
    escrowAta: escrowAta.toBase58(),
    secretHash,
    timelock,
    tokenSymbol: tokenSymbol.toUpperCase(),
    amount,
  };
}
