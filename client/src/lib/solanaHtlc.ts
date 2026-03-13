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

    // NOTE: Do NOT pre-create the vault ATA separately.
    // The Anchor lock_token instruction uses `init_if_needed` to create both the
    // htlcPda state account and the vaultAta atomically in a single instruction.
    // Pre-creating the ATA before the htlcPda exists causes ProgramAccountNotFound
    // because the ATA owner (htlcPda) doesn't exist yet at that point.
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
 * Check if the AFOS HTLC program is deployed on-chain.
 * Returns { deployed: true } if the program account exists and is executable,
 * or { deployed: false, reason } with a human-readable explanation.
 */
export async function checkHtlcProgramDeployed(
  connection: Connection
): Promise<{ deployed: boolean; reason?: string }> {
  try {
    const info = await connection.getAccountInfo(AFOS_HTLC_PROGRAM_ID, "confirmed");
    if (!info) {
      return {
        deployed: false,
        reason: `AFOS HTLC program (${AFOS_HTLC_PROGRAM_ID.toBase58().slice(0, 8)}…) is not deployed on mainnet yet. On-chain refunds will be available once the program is live.`,
      };
    }
    if (!info.executable) {
      return {
        deployed: false,
        reason: `Program account exists but is not executable. Contact the AFOS team.`,
      };
    }
    return { deployed: true };
  } catch (err) {
    // RPC error — don't block the user, let the tx attempt proceed
    console.warn("[HTLC] Program deployment check failed (RPC error):", err);
    return { deployed: true }; // Optimistic: let the tx attempt and surface the real error
  }
}

/**
 * Check if Agent B's HTLC PDA exists on-chain.
 * Used for autonomous 30-second polling to detect Agent B's lock even if the
 * P2P htlc_locked message was dropped (network hiccup, page refresh, etc.).
 *
 * @param connection - Solana Connection (or any object with getAccountInfo)
 * @param htlcIdB    - Agent B's HTLC ID string (e.g. "htlc_b_rfq_..._lp-...")
 * @returns true if the PDA account exists on-chain (Agent B has locked)
 */
export async function checkAgentBHtlcLocked(
  connection: Connection,
  htlcIdB: string,
): Promise<boolean> {
  try {
    const { htlcIdToBytes: toBytes } = await import('./afosHtlcProgram');
    const idBytes = toBytes(htlcIdB);
    const [htlcPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('htlc'), idBytes],
      AFOS_HTLC_PROGRAM_ID,
    );
    const info = await connection.getAccountInfo(htlcPda, 'confirmed');
    return info !== null;
  } catch {
    return false;
  }
}

/**
 * Build a Solana HTLC refund transaction.
 * Calls the program's refund instruction — only succeeds after timelock expires.
 * The sender gets their funds back automatically.
 *
 * Throws a user-friendly error if the HTLC program is not deployed on mainnet.
 */
export async function buildSolanaHtlcRefundTx(
  params: SolanaHtlcRefundParams
): Promise<SolanaHtlcRefundResult> {
  const { senderPubkey, htlcId, connection, tokenSymbol } = params;

  // ── Pre-flight: verify program is deployed ────────────────────────────────
  const programCheck = await checkHtlcProgramDeployed(connection);
  if (!programCheck.deployed) {
    throw new Error(programCheck.reason ?? "HTLC program not deployed on mainnet.");
  }

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
