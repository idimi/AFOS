/**
 * solanaHtlc.ts — Solana HTLC Lock Transaction Builder
 *
 * Builds a Solana transaction that locks SOL into an HTLC escrow.
 *
 * Architecture (priority order):
 *   1. If VITE_SOL_HTLC_PROGRAM_ID is set: sends a real instruction to the
 *      deployed HTLC Anchor program (lock instruction with secretHash + timelock).
 *   2. If an escrowAddress is provided (agent escrow wallet from SOL_HTLC_KEY):
 *      builds a SystemProgram.transfer to the agent's escrow wallet.
 *      The server monitors the deposit and handles claim/refund using SOL_HTLC_KEY.
 *   3. Fallback: derives a PDA from the secretHash (demo/testnet only).
 *
 * The agent escrow model (option 2) is the recommended production path when
 * no custom Anchor program is deployed. The server records the HTLC in the
 * htlc_swaps table and the HTLC monitor handles refunds on expiry.
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
  /** Optional: agent escrow wallet address (from SOL_HTLC_KEY).
   *  When provided and no Anchor program is deployed, funds are sent here
   *  instead of a PDA. The server manages claim/refund. */
  escrowAddress?: string;
}

export interface SolanaHtlcLockResult {
  /** The built transaction (unsigned) */
  transaction: Transaction;
  /** The escrow address where funds will be locked */
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
 * Priority:
 *   1. Anchor program (if VITE_SOL_HTLC_PROGRAM_ID is set)
 *   2. Agent escrow wallet (if escrowAddress is provided)
 *   3. PDA fallback (demo only)
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
    escrowAddress: agentEscrowAddress,
  } = params;

  const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  const secretHashBytes = hexToBytes(secretHash);

  // ── Fetch recent blockhash ─────────────────────────────────────────────────
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  void lastValidBlockHeight;

  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = senderPubkey;

  if (HTLC_PROGRAM_ID_STR) {
    // ── Path 1: Real Anchor program instruction ─────────────────────────────
    const htlcProgramId = new PublicKey(HTLC_PROGRAM_ID_STR);

    const [escrowPda] = await PublicKey.findProgramAddress(
      [
        Buffer.from("htlc"),
        Buffer.from(secretHashBytes),
        senderPubkey.toBuffer(),
      ],
      htlcProgramId
    );

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

    return {
      transaction: tx,
      escrowAddress: escrowPda.toBase58(),
      secretHash,
      timelock,
    };
  } else if (agentEscrowAddress) {
    // ── Path 2: Agent escrow wallet (recommended production path) ────────────
    // Transfer SOL to the agent's HTLC escrow wallet (derived from SOL_HTLC_KEY).
    // The server records the HTLC in htlc_swaps and manages claim/refund.
    const escrowPubkey = new PublicKey(agentEscrowAddress);

    // Add a memo instruction with HTLC metadata so the server can identify the deposit
    // Format: "htlc:<secretHash>:<timelock>:<recipientPubkey>"
    const memoData = `htlc:${secretHash}:${timelock}:${recipientPubkey.toBase58()}`;
    const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
    const memoIx = new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [{ pubkey: senderPubkey, isSigner: true, isWritable: false }],
      data: Buffer.from(memoData, "utf-8"),
    });

    tx.add(memoIx);
    tx.add(
      SystemProgram.transfer({
        fromPubkey: senderPubkey,
        toPubkey:   escrowPubkey,
        lamports,
      })
    );

    return {
      transaction: tx,
      escrowAddress: agentEscrowAddress,
      secretHash,
      timelock,
    };
  } else {
    // ── Path 3: PDA fallback (demo/testnet only) ────────────────────────────
    // Derive a PDA from SystemProgram.programId — this is a demo path only.
    // The PDA cannot be refunded without a deployed program.
    const [escrowPda] = await PublicKey.findProgramAddress(
      [
        Buffer.from("htlc"),
        Buffer.from(secretHashBytes),
        senderPubkey.toBuffer(),
      ],
      SystemProgram.programId
    );

    tx.add(
      SystemProgram.transfer({
        fromPubkey: senderPubkey,
        toPubkey:   escrowPda,
        lamports,
      })
    );

    return {
      transaction: tx,
      escrowAddress: escrowPda.toBase58(),
      secretHash,
      timelock,
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
 * Without a deployed program, the server handles refunds automatically via
 * the HTLC monitor (using SOL_HTLC_KEY to sign the refund transaction).
 * This function is only needed for the Anchor program path.
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
    // ── Agent escrow model: refund is handled server-side ────────────────────
    // The HTLC monitor detects expired HTLCs and uses SOL_HTLC_KEY to send
    // funds back to the original sender. No client-side refund tx needed.
    // This transaction is a no-op placeholder for the UI flow.
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
