/**
 * solanaHtlcRefund.ts — Server-Side HTLC Refund Executor
 *
 * Called by the AFOS agent to reclaim locked SOL from an expired HTLC.
 * The agent (SOL_HTLC_KEY) is the on-chain sender, so only it can call refund.
 * The refund returns the locked SOL back to the agent wallet.
 *
 * Program: XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
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

// Anchor discriminator for refund instruction: SHA256("global:refund")[0..8]
const REFUND_DISCRIMINATOR = Buffer.from([2, 96, 183, 251, 63, 208, 46, 46]);

// Well-known SPL token mints on mainnet
const TOKEN_MINTS: Record<string, string> = {
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
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

function getAgentKeypair(): Keypair {
  // SOL_HTLC_KEY is the dedicated HTLC escrow key; fall back to SOL_AGENT_KEY
  const keyStr = process.env.SOL_HTLC_KEY ?? process.env.SOL_AGENT_KEY;
  if (!keyStr) throw new Error("SOL_HTLC_KEY not set in environment");
  try {
    const decoded = bs58.decode(keyStr);
    return Keypair.fromSecretKey(decoded);
  } catch {
    const arr = JSON.parse(keyStr) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
}

function getSolanaConnection(): Connection {
  const rpcUrl = ENV.solRpcUrl || "https://solana-rpc.publicnode.com";
  return new Connection(rpcUrl, "confirmed");
}

// ─── Main Refund Function ─────────────────────────────────────────────────────

export interface HtlcRefundResult {
  txSignature: string;
  htlcId: string;
  senderAddress: string;
}

/**
 * Submit a refund instruction to the AFOS HTLC program.
 *
 * The AFOS agent (SOL_HTLC_KEY) signs the transaction as the on-chain sender.
 * The program verifies the timelock has expired, then returns the locked SOL
 * back to the agent wallet.
 *
 * @param htlcId - The HTLC ID used as PDA seed (e.g., "htlc_a_rfq_1773...")
 * @param tokenSymbol - Optional: "USDT" or "USDC" for SPL token refunds
 */
export async function refundSolanaHtlc(params: {
  htlcId: string;
  tokenSymbol?: string;
}): Promise<HtlcRefundResult> {
  const { htlcId, tokenSymbol } = params;

  const agentKeypair = getAgentKeypair();
  const connection = getSolanaConnection();
  const htlcIdBytes = htlcIdToBytes(htlcId);
  const htlcPda = deriveHtlcPda(htlcIdBytes);

  console.log(`[SolRefund] Agent pubkey: ${agentKeypair.publicKey.toBase58()}`);
  console.log(`[SolRefund] HTLC PDA: ${htlcPda.toBase58()}`);
  console.log(`[SolRefund] htlcId: ${htlcId}`);

  // Build refund instruction data: just the discriminator (no args needed)
  const data = Buffer.from(REFUND_DISCRIMINATOR);

  // Build account keys
  const keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [
    { pubkey: agentKeypair.publicKey, isSigner: true, isWritable: true },
    { pubkey: htlcPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Add SPL token accounts if this is a token refund
  if (tokenSymbol) {
    const mintAddress = TOKEN_MINTS[tokenSymbol.toUpperCase()];
    if (!mintAddress) {
      throw new Error(`Unknown token symbol: ${tokenSymbol}`);
    }
    const tokenMint = new PublicKey(mintAddress);
    const vaultAta = deriveAta(htlcPda, tokenMint);
    const senderAta = deriveAta(agentKeypair.publicKey, tokenMint);

    keys.push(
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: senderAta, isSigner: false, isWritable: true },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
    );
  }

  const refundIx = new TransactionInstruction({
    programId: AFOS_HTLC_PROGRAM_ID,
    keys,
    data,
  });

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = agentKeypair.publicKey;
  tx.add(refundIx);

  console.log(`[SolRefund] Submitting refund tx for HTLC ${htlcId}…`);

  const txSignature = await sendAndConfirmTransaction(
    connection,
    tx,
    [agentKeypair],
    { commitment: "confirmed", maxRetries: 3 }
  );

  console.log(`[SolRefund] Refund confirmed: ${txSignature} | htlcId=${htlcId}`);

  return {
    txSignature,
    htlcId,
    senderAddress: agentKeypair.publicKey.toBase58(),
  };
}
