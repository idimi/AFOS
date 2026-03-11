/**
 * solanaHtlcClaim.ts — Server-Side HTLC Claim Executor
 *
 * Called by the AFOS agent after both sides have locked funds.
 * Uses SOL_HTLC_KEY to sign and submit the claim instruction to the
 * deployed AFOS HTLC program (XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW).
 *
 * The program automatically releases:
 *   - SOL/SPL tokens locked by Agent A → to Agent B's wallet
 *   - SOL/SPL tokens locked by Agent B → to Agent A's wallet
 *
 * No custodial control — the program enforces all rules on-chain.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { ENV } from "./_core/env";

// ─── Constants ────────────────────────────────────────────────────────────────

const AFOS_HTLC_PROGRAM_ID = new PublicKey(
  "XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW"
);

const SPL_TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

const SPL_ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bE"
);

// Anchor discriminators (first 8 bytes of SHA256("global:<instruction_name>"))
const CLAIM_DISCRIMINATOR = Buffer.from([62, 198, 214, 193, 213, 159, 108, 210]);

// Well-known SPL token mints on mainnet
const TOKEN_MINTS: Record<string, { mint: string; decimals: number }> = {
  USDT: { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
  USDC: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deriveHtlcPda(htlcIdBytes: Uint8Array): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("htlc"), htlcIdBytes],
    AFOS_HTLC_PROGRAM_ID
  );
  return pda;
}

function deriveAta(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), SPL_TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    SPL_ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

function htlcIdToBytes(htlcId: string): Uint8Array {
  const bytes = new Uint8Array(32);
  const encoded = new TextEncoder().encode(htlcId.slice(0, 32));
  bytes.set(encoded);
  return bytes;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function getAgentKeypair(): Keypair {
  const keyStr = ENV.solHtlcKey;
  if (!keyStr) throw new Error("SOL_HTLC_KEY not set in environment");
  try {
    const decoded = bs58.decode(keyStr);
    return Keypair.fromSecretKey(decoded);
  } catch {
    // Try JSON array format
    const arr = JSON.parse(keyStr) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
}

function getSolanaConnection(): Connection {
  const rpcUrl = ENV.solRpcUrl || "https://solana-rpc.publicnode.com";
  return new Connection(rpcUrl, "confirmed");
}

// ─── Claim Result ─────────────────────────────────────────────────────────────

export interface HtlcClaimResult {
  txSignature: string;
  htlcId: string;
  recipient: string;
  tokenSymbol?: string;
}

// ─── Main Claim Function ──────────────────────────────────────────────────────

/**
 * Submit a claim instruction to the AFOS HTLC program.
 *
 * The AFOS agent (SOL_HTLC_KEY) signs the transaction.
 * The program verifies the preimage hash matches secretHash,
 * then releases the locked funds to the recipient.
 *
 * @param htlcId - The HTLC ID used as PDA seed (e.g., "htlc_rfq_1773...")
 * @param secretHex - The 32-byte preimage as hex string
 * @param recipientAddress - Solana wallet address of the recipient
 * @param tokenSymbol - Optional: "USDT" or "USDC" for SPL token claims
 */
export async function claimSolanaHtlc(params: {
  htlcId: string;
  secretHex: string;
  recipientAddress: string;
  tokenSymbol?: string;
}): Promise<HtlcClaimResult> {
  const { htlcId, secretHex, recipientAddress, tokenSymbol } = params;

  const agentKeypair = getAgentKeypair();
  const connection = getSolanaConnection();
  const recipient = new PublicKey(recipientAddress);
  const htlcIdBytes = htlcIdToBytes(htlcId);
  const preimage = hexToBytes(secretHex);
  const htlcPda = deriveHtlcPda(htlcIdBytes);

  // Build claim instruction data: discriminator[8] + preimage[32]
  const data = Buffer.alloc(8 + 32);
  CLAIM_DISCRIMINATOR.copy(data, 0);
  Buffer.from(preimage).copy(data, 8);

  // Build account keys
  const keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [
    { pubkey: agentKeypair.publicKey, isSigner: true, isWritable: true },
    { pubkey: htlcPda, isSigner: false, isWritable: true },
    { pubkey: recipient, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Add SPL token accounts if this is a token claim
  if (tokenSymbol) {
    const tokenInfo = TOKEN_MINTS[tokenSymbol.toUpperCase()];
    if (!tokenInfo) {
      throw new Error(`Unknown token symbol: ${tokenSymbol}`);
    }
    const tokenMint = new PublicKey(tokenInfo.mint);
    const vaultAta = deriveAta(htlcPda, tokenMint);
    const recipientAta = deriveAta(recipient, tokenMint);

    // Ensure recipient's ATA exists — create if needed
    await ensureAtaExists(connection, agentKeypair, recipient, tokenMint, recipientAta);

    keys.push(
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
    );
  }

  const claimIx = new TransactionInstruction({
    programId: AFOS_HTLC_PROGRAM_ID,
    keys,
    data,
  });

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = agentKeypair.publicKey;
  tx.add(claimIx);

  const txSignature = await sendAndConfirmTransaction(
    connection,
    tx,
    [agentKeypair],
    { commitment: "confirmed", maxRetries: 3 }
  );

  console.log(`[HTLC] Claim submitted: ${txSignature} | htlcId=${htlcId} | recipient=${recipientAddress}`);

  return {
    txSignature,
    htlcId,
    recipient: recipientAddress,
    tokenSymbol,
  };
}

// ─── ATA Creation Helper ──────────────────────────────────────────────────────

/**
 * Ensure a recipient's Associated Token Account exists.
 * If it doesn't, the agent pays to create it (small rent cost ~0.002 SOL).
 */
async function ensureAtaExists(
  connection: Connection,
  payer: Keypair,
  owner: PublicKey,
  mint: PublicKey,
  ata: PublicKey
): Promise<void> {
  const info = await connection.getAccountInfo(ata);
  if (info) return; // Already exists

  console.log(`[HTLC] Creating recipient ATA for ${owner.toBase58()} / mint ${mint.toBase58()}`);

  // Build create_associated_token_account instruction
  const createAtaIx = new TransactionInstruction({
    programId: SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.alloc(0),
  });

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = payer.publicKey;
  tx.add(createAtaIx);

  await sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
}
