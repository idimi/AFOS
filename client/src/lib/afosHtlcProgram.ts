/**
 * AFOS HTLC Program Client
 *
 * Trustless on-chain HTLC for Solana — Program ID: XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW
 *
 * Instructions:
 *  - lockSol:    Lock native SOL into a PDA escrow
 *  - lockToken:  Lock SPL tokens (USDT/USDC) into a PDA vault
 *  - claim:      Reveal preimage to release funds to recipient (called by AFOS agent)
 *  - refund:     Recover funds after timelock expires (called by sender)
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";

// ─── Constants ───────────────────────────────────────────────────────────────

export const AFOS_HTLC_PROGRAM_ID = new PublicKey(
  "XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW"
);

export const SPL_TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

export const SPL_ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bE"
);

// Anchor discriminators (first 8 bytes of SHA256("global:<instruction_name>"))
const DISCRIMINATORS = {
  lockSol:    Buffer.from([181, 15, 15, 99, 159, 87, 241, 42]),
  lockToken:  Buffer.from([153, 150, 141, 190, 78, 115, 232, 80]),
  claim:      Buffer.from([62, 198, 214, 193, 213, 159, 108, 210]),
  refund:     Buffer.from([2, 96, 183, 251, 63, 208, 46, 46]),
};

// ─── PDA Helpers ─────────────────────────────────────────────────────────────

/**
 * Derive the HTLC PDA for a given htlcId (32 bytes)
 */
export function deriveHtlcPda(htlcId: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("htlc"), htlcId],
    AFOS_HTLC_PROGRAM_ID
  );
}

/**
 * Derive the Associated Token Account address
 */
export function deriveAta(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), SPL_TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    SPL_ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

/**
 * Convert a string htlcId to 32-byte buffer (right-padded with zeros)
 */
export function htlcIdToBytes(htlcId: string): Uint8Array {
  const bytes = new Uint8Array(32);
  const encoded = new TextEncoder().encode(htlcId.slice(0, 32));
  bytes.set(encoded);
  return bytes;
}

/**
 * Compute SHA-256 hash of a preimage
 */
export function computeSecretHash(preimage: Uint8Array): Uint8Array {
  return sha256(preimage);
}

// ─── Instruction Builders ────────────────────────────────────────────────────

/**
 * Build a lock_sol instruction — locks native SOL into the HTLC PDA
 */
export function buildLockSolInstruction(params: {
  sender: PublicKey;
  htlcId: Uint8Array;
  secretHash: Uint8Array;
  recipient: PublicKey;
  timelock: number; // Unix timestamp (seconds)
  amountLamports: bigint;
}): { instruction: TransactionInstruction; htlcPda: PublicKey } {
  const [htlcPda] = deriveHtlcPda(params.htlcId);

  // Encode args: htlcId[32] + secretHash[32] + recipient[32] + timelock[8] + amount[8]
  const data = Buffer.alloc(8 + 32 + 32 + 32 + 8 + 8);
  DISCRIMINATORS.lockSol.copy(data, 0);
  Buffer.from(params.htlcId).copy(data, 8);
  Buffer.from(params.secretHash).copy(data, 40);
  params.recipient.toBuffer().copy(data, 72);
  data.writeBigInt64LE(BigInt(params.timelock), 104);
  data.writeBigUInt64LE(params.amountLamports, 112);

  const instruction = new TransactionInstruction({
    programId: AFOS_HTLC_PROGRAM_ID,
    keys: [
      { pubkey: params.sender, isSigner: true, isWritable: true },
      { pubkey: htlcPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  return { instruction, htlcPda };
}

/**
 * Build a lock_token instruction — locks SPL tokens into the HTLC vault ATA
 */
export function buildLockTokenInstruction(params: {
  sender: PublicKey;
  htlcId: Uint8Array;
  secretHash: Uint8Array;
  recipient: PublicKey;
  timelock: number;
  tokenMint: PublicKey;
  tokenAmount: bigint; // In token base units (e.g., USDT uses 6 decimals)
}): { instruction: TransactionInstruction; htlcPda: PublicKey; vaultAta: PublicKey } {
  const [htlcPda] = deriveHtlcPda(params.htlcId);
  const senderAta = deriveAta(params.sender, params.tokenMint);
  const vaultAta = deriveAta(htlcPda, params.tokenMint);

  const data = Buffer.alloc(8 + 32 + 32 + 32 + 8 + 8);
  DISCRIMINATORS.lockToken.copy(data, 0);
  Buffer.from(params.htlcId).copy(data, 8);
  Buffer.from(params.secretHash).copy(data, 40);
  params.recipient.toBuffer().copy(data, 72);
  data.writeBigInt64LE(BigInt(params.timelock), 104);
  data.writeBigUInt64LE(params.tokenAmount, 112);

  const instruction = new TransactionInstruction({
    programId: AFOS_HTLC_PROGRAM_ID,
    keys: [
      { pubkey: params.sender, isSigner: true, isWritable: true },
      { pubkey: htlcPda, isSigner: false, isWritable: true },
      { pubkey: params.tokenMint, isSigner: false, isWritable: false },
      { pubkey: senderAta, isSigner: false, isWritable: true },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  return { instruction, htlcPda, vaultAta };
}

/**
 * Build a claim instruction — reveals the preimage to release funds
 * Called by anyone who knows the preimage (typically Agent B claiming Agent A's HTLC)
 *
 * IMPORTANT: The program always requires token accounts in the account list
 * even for native SOL HTLCs (verified by on-chain simulation).
 * Account order: caller, htlcPda, recipient, vaultAta, recipientAta, tokenProgram, systemProgram
 */
export function buildClaimInstruction(params: {
  caller: PublicKey;    // Wallet signing the claim tx (can be anyone with the preimage)
  htlcId: Uint8Array;
  preimage: Uint8Array; // 32-byte secret
  recipient: PublicKey; // Must match the on-chain stored recipient
  tokenMint?: PublicKey; // Optional override; defaults to USDT
}): TransactionInstruction {
  const [htlcPda] = deriveHtlcPda(params.htlcId);

  const data = Buffer.alloc(8 + 32);
  DISCRIMINATORS.claim.copy(data, 0);
  Buffer.from(params.preimage).copy(data, 8);

  // Always include token accounts — program requires them even for SOL HTLCs
  const mint = params.tokenMint ?? DEFAULT_REFUND_TOKEN_MINT; // USDT by default
  const vaultAta = deriveAta(htlcPda, mint);
  const recipientAta = deriveAta(params.recipient, mint);

  const keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [
    { pubkey: params.caller, isSigner: true, isWritable: true },
    { pubkey: htlcPda, isSigner: false, isWritable: true },
    { pubkey: params.recipient, isSigner: false, isWritable: true },
    { pubkey: vaultAta, isSigner: false, isWritable: true },
    { pubkey: recipientAta, isSigner: false, isWritable: true },
    { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId: AFOS_HTLC_PROGRAM_ID,
    keys,
    data,
  });
}

// Default USDT mint — the program always requires token accounts in the refund instruction
// even for native SOL HTLCs (verified by on-chain simulation)
const DEFAULT_REFUND_TOKEN_MINT = new PublicKey(
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" // USDT
);

/**
 * Build a refund instruction — recovers funds after timelock expires
 * Called by the sender if the swap doesn't complete
 *
 * IMPORTANT: The program always requires token accounts in the account list
 * even for native SOL HTLCs. We always include USDT token accounts.
 * Account order: sender, htlcPda, vaultAta, senderAta, tokenProgram, systemProgram
 */
export function buildRefundInstruction(params: {
  sender: PublicKey;
  htlcId: Uint8Array;
  tokenMint?: PublicKey;
}): TransactionInstruction {
  const [htlcPda] = deriveHtlcPda(params.htlcId);

  const data = Buffer.from(DISCRIMINATORS.refund);

  // Always include token accounts — program requires them even for SOL HTLCs
  const mint = params.tokenMint ?? DEFAULT_REFUND_TOKEN_MINT;
  const vaultAta = deriveAta(htlcPda, mint);
  const senderAta = deriveAta(params.sender, mint);

  const keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [
    { pubkey: params.sender, isSigner: true, isWritable: true },
    { pubkey: htlcPda, isSigner: false, isWritable: true },
    { pubkey: vaultAta, isSigner: false, isWritable: true },
    { pubkey: senderAta, isSigner: false, isWritable: true },
    { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId: AFOS_HTLC_PROGRAM_ID,
    keys,
    data,
  });
}

// ─── Transaction Builders ────────────────────────────────────────────────────

/**
 * Build a complete lock_sol transaction ready for wallet signing
 */
export async function buildLockSolTx(
  connection: Connection,
  params: Parameters<typeof buildLockSolInstruction>[0]
): Promise<{ transaction: Transaction; htlcPda: PublicKey }> {
  const { instruction, htlcPda } = buildLockSolInstruction(params);
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = params.sender;
  tx.add(instruction);
  return { transaction: tx, htlcPda };
}

/**
 * Build a complete lock_token transaction ready for wallet signing
 * Note: The vault ATA must be created before calling this.
 * Use createVaultAtaIfNeeded() first.
 */
export async function buildLockTokenTx(
  connection: Connection,
  params: Parameters<typeof buildLockTokenInstruction>[0]
): Promise<{ transaction: Transaction; htlcPda: PublicKey; vaultAta: PublicKey }> {
  const { instruction, htlcPda, vaultAta } = buildLockTokenInstruction(params);
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = params.sender;
  tx.add(instruction);
  return { transaction: tx, htlcPda, vaultAta };
}

/**
 * Create the vault ATA for the HTLC PDA if it doesn't exist yet.
 * Returns null if the ATA already exists.
 */
export async function createVaultAtaIfNeeded(
  connection: Connection,
  payer: PublicKey,
  htlcPda: PublicKey,
  tokenMint: PublicKey
): Promise<TransactionInstruction | null> {
  const vaultAta = deriveAta(htlcPda, tokenMint);
  const info = await connection.getAccountInfo(vaultAta);
  if (info) return null; // Already exists

  // Build create_associated_token_account instruction
  const data = Buffer.alloc(0); // No data for create ATA
  return new TransactionInstruction({
    programId: SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: htlcPda, isSigner: false, isWritable: false },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}
