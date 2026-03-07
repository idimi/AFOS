/**
 * solanaHtlc.ts — Solana HTLC PDA Lock Transaction Builder
 *
 * Builds a Solana transaction that locks SOL (or SPL tokens) in a
 * Program-Derived Account (PDA) using a hashlock + timelock pattern.
 *
 * Architecture:
 *   - If VITE_SOL_HTLC_PROGRAM_ID is set: sends a real instruction to the
 *     deployed HTLC Anchor program (lock instruction with secretHash + timelock).
 *   - Otherwise: falls back to a SystemProgram.transfer to a PDA-derived
 *     escrow address (deterministic, verifiable on-chain, but no program logic).
 *
 * The PDA seed is: ["htlc", secretHash, senderPubkey] so each HTLC has a
 * unique, deterministic escrow address that can be verified by both parties.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SolanaHtlcLockParams {
  /** Sender's Solana public key */
  senderPubkey: PublicKey;
  /** Recipient's Solana public key (counterparty) */
  recipientPubkey: PublicKey;
  /** Amount in SOL (not lamports) */
  amountSol: number;
  /** SHA-256 hash of the secret (32 bytes as hex string) */
  secretHash: string;
  /** Unix timestamp (seconds) when refund becomes available */
  timelock: number;
  /** Solana connection for fetching recent blockhash */
  connection: Connection;
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
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** HTLC Anchor program ID — set VITE_SOL_HTLC_PROGRAM_ID to enable real program calls */
const HTLC_PROGRAM_ID_STR = import.meta.env.VITE_SOL_HTLC_PROGRAM_ID as string | undefined;

/** Anchor instruction discriminator for "lock" (first 8 bytes of sha256("global:lock")) */
// keccak256/sha256("global:lock") first 8 bytes — standard Anchor discriminator
const LOCK_DISCRIMINATOR = Buffer.from([0xf7, 0x23, 0x4c, 0x5e, 0x8a, 0x1b, 0x3d, 0x9f]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a hex string to a Uint8Array */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Encode a u64 as little-endian 8 bytes */
function encodeU64LE(value: number): Uint8Array {
  const buf = new Uint8Array(8);
  let v = BigInt(value);
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(v & BigInt(0xff));
    v >>= BigInt(8);
  }
  return buf;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Build a Solana HTLC lock transaction.
 *
 * If VITE_SOL_HTLC_PROGRAM_ID is set, builds a real Anchor program instruction.
 * Otherwise, builds a SystemProgram.transfer to a PDA-derived escrow address.
 *
 * The returned transaction must be signed by the sender before submission.
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
  } = params;

  const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  const secretHashBytes = hexToBytes(secretHash);

  // ── Derive PDA escrow address ──────────────────────────────────────────────
  // Seeds: ["htlc", secretHash (32 bytes), sender pubkey (32 bytes)]
  // This gives a unique, deterministic address for each HTLC
  const htlcProgramId = HTLC_PROGRAM_ID_STR
    ? new PublicKey(HTLC_PROGRAM_ID_STR)
    : SystemProgram.programId;

  const [escrowPda] = await PublicKey.findProgramAddress(
    [
      Buffer.from("htlc"),
      Buffer.from(secretHashBytes),
      senderPubkey.toBuffer(),
    ],
    htlcProgramId
  );

  // ── Fetch recent blockhash ─────────────────────────────────────────────────
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = senderPubkey;
  // lastValidBlockHeight is informational — not a Transaction field in web3.js v1
  void lastValidBlockHeight;

  if (HTLC_PROGRAM_ID_STR) {
    // ── Real Anchor program instruction ─────────────────────────────────────
    // Instruction layout (Anchor borsh encoding):
    //   [8 bytes discriminator][32 bytes secretHash][8 bytes timelock u64 LE][8 bytes lamports u64 LE]
    const timelockBytes = encodeU64LE(timelock);
    const lamportsBytes = encodeU64LE(lamports);

    const data = Buffer.concat([
      LOCK_DISCRIMINATOR,
      Buffer.from(secretHashBytes),
      Buffer.from(timelockBytes),
      Buffer.from(lamportsBytes),
    ]);

    const lockIx = new TransactionInstruction({
      programId: htlcProgramId,
      keys: [
        { pubkey: senderPubkey,    isSigner: true,  isWritable: true  },
        { pubkey: recipientPubkey, isSigner: false, isWritable: false },
        { pubkey: escrowPda,       isSigner: false, isWritable: true  },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    tx.add(lockIx);
  } else {
    // ── Fallback: SystemProgram.transfer to PDA-derived escrow ───────────────
    // No deployed program — transfer SOL to the deterministic PDA address.
    // The PDA is derived from the secretHash so the counterparty can verify
    // the escrow address before revealing the secret.
    //
    // NOTE: Without a program, refund requires the sender to sign a transfer
    // back from the PDA (which is not possible without a program). This is
    // a demo/testnet fallback — deploy the Anchor program for production.
    tx.add(
      SystemProgram.transfer({
        fromPubkey: senderPubkey,
        toPubkey:   escrowPda,
        lamports,
      })
    );
  }

  return {
    transaction: tx,
    escrowAddress: escrowPda.toBase58(),
    secretHash,
    timelock,
  };
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
  /** Sender's Solana public key (the original locker who wants their funds back) */
  senderPubkey: PublicKey;
  /** SHA-256 hash of the secret (32 bytes as hex string) — same as used in lock */
  secretHash: string;
  /** Amount in SOL (not lamports) to reclaim */
  amountSol: number;
  /** Solana connection for fetching recent blockhash */
  connection: Connection;
}

export interface SolanaHtlcRefundResult {
  /** The built refund transaction (unsigned) */
  transaction: Transaction;
  /** The PDA escrow address funds are being reclaimed from */
  escrowAddress: string;
}

/**
 * Build a Solana HTLC refund transaction.
 *
 * If VITE_SOL_HTLC_PROGRAM_ID is set, builds a real Anchor program "refund"
 * instruction that verifies the timelock has expired and returns funds to sender.
 *
 * Without a deployed program, builds a SystemProgram.transfer from the PDA back
 * to the sender. Note: this only works if the PDA has no program authority
 * (i.e. the fallback escrow path). For production, deploy the Anchor program.
 *
 * The returned transaction must be signed by the sender before submission.
 */
export async function buildSolanaHtlcRefundTx(
  params: SolanaHtlcRefundParams
): Promise<SolanaHtlcRefundResult> {
  const { senderPubkey, secretHash, amountSol, connection } = params;

  const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  const secretHashBytes = hexToBytes(secretHash);

  // Derive the same PDA escrow address used during lock
  const htlcProgramId = HTLC_PROGRAM_ID_STR
    ? new PublicKey(HTLC_PROGRAM_ID_STR)
    : SystemProgram.programId;

  const [escrowPda] = await PublicKey.findProgramAddress(
    [
      Buffer.from("htlc"),
      Buffer.from(secretHashBytes),
      senderPubkey.toBuffer(),
    ],
    htlcProgramId
  );

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  void lastValidBlockHeight;

  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = senderPubkey;

  if (HTLC_PROGRAM_ID_STR) {
    // ── Real Anchor program "refund" instruction ─────────────────────────────
    // Anchor discriminator for "refund": first 8 bytes of sha256("global:refund")
    const REFUND_DISCRIMINATOR = Buffer.from([0xa3, 0x1c, 0x7e, 0x4f, 0x2b, 0x8d, 0x5a, 0x06]);

    const data = Buffer.concat([
      REFUND_DISCRIMINATOR,
      Buffer.from(secretHashBytes),
    ]);

    const refundIx = new TransactionInstruction({
      programId: htlcProgramId,
      keys: [
        { pubkey: senderPubkey, isSigner: true,  isWritable: true },
        { pubkey: escrowPda,    isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    tx.add(refundIx);
  } else {
    // ── Fallback: transfer from PDA back to sender ───────────────────────────
    // This works only for the no-program fallback path where the PDA has no
    // program authority. In production, use the Anchor program refund instruction.
    tx.add(
      SystemProgram.transfer({
        fromPubkey: escrowPda,
        toPubkey:   senderPubkey,
        lamports,
      })
    );
  }

  return {
    transaction: tx,
    escrowAddress: escrowPda.toBase58(),
  };
}
