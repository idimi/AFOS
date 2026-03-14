/**
 * agentSwapSolToTnk.ts — Server-side SOL/USDT → TNK cross-chain swap initiation
 *
 * Flow (Maker-Taker HTLC model):
 *   1. Agent (maker) locks TNK on Trac Network HTLC first
 *      → submitTnkHtlcLock(sender=TNK_ESCROW, recipient=user's TNK address)
 *   2. Returns a serialized Solana lock_token instruction for the user to sign
 *      → user locks USDT/SOL into the AFOS HTLC program on Solana
 *   3. Helius webhook detects user's Solana lock → triggers:
 *      a. claimSolanaHtlc()    — agent claims USDT/SOL from Solana
 *      b. submitTnkHtlcClaim() — user's TNK is released on Trac Network
 *
 * Both HTLCs share the same secret/secretHash, ensuring atomic settlement.
 *
 * Environment variables required:
 *   TNK_HTLC_WIF         — Trac Network HTLC signing key (WIF format)
 *   TNK_ESCROW_ADDRESS   — Agent's Trac Network address (sender in TNK lock)
 *   SOL_HTLC_KEY         — Agent's Solana keypair (base58) — used as recipient in SOL lock
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { randomBytes, createHash } from "crypto";
import { submitTnkHtlcLock } from "./tnkHtlcContract.js";
import { saveHtlcSecret } from "./db.js";
import { recordSwapAnalytic } from "./htlcMonitor.js";
import type { SupportedChain } from "@shared/const";

// ─── Constants ────────────────────────────────────────────────────────────────
const AFOS_HTLC_PROGRAM_ID = new PublicKey(
  "XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW"
);
const SPL_TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const SPL_ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
// Anchor discriminators
const LOCK_TOKEN_DISCRIMINATOR = Buffer.from([153, 150, 141, 190, 78, 115, 232, 80]);
const LOCK_SOL_DISCRIMINATOR   = Buffer.from([181, 15, 15, 99, 159, 87, 241, 42]);

// Well-known SPL token mints on mainnet
const TOKEN_MINTS: Record<string, { mint: string; decimals: number }> = {
  USDT: { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
  USDC: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
};

// TNK uses 8 decimal places (same as Bitcoin satoshis)
const TNK_DECIMALS = 8;
// Fee: 0.15% on the output (TNK) side
const P2P_FEE_BPS = 15;
// Default HTLC timelock: 24 hours (in seconds)
const DEFAULT_TIMELOCK_SECS = 24 * 60 * 60;

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

function getAgentSolanaKeypair(): Keypair {
  const keyStr = process.env.SOL_HTLC_KEY ?? process.env.SOL_AGENT_KEY;
  if (!keyStr) throw new Error("SOL_HTLC_KEY not set — cannot derive agent Solana address");
  try {
    return Keypair.fromSecretKey(bs58.decode(keyStr));
  } catch {
    const bytes = Buffer.from(keyStr, "hex");
    return Keypair.fromSecretKey(bytes);
  }
}

function getSolanaConnection(): Connection {
  const rpcUrl = process.env.VITE_SOL_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  return new Connection(rpcUrl, "confirmed");
}

// ─── Result type ──────────────────────────────────────────────────────────────
export interface SolToTnkSwapResult {
  success: boolean;
  demo: boolean;
  rfqId: string;
  /** Serialized Solana lock transaction (base64) for the user to sign and broadcast */
  solanaLockTxBase64: string | null;
  /** HTLC ID used on the Solana side (htlc_a_<rfqId>) */
  htlcId: string;
  /** Secret hash (hex) — stored in both HTLCs */
  secretHashHex: string;
  /** TNK lock result from Trac Network */
  tnkLockTxHash: string | null;
  /** Amount of TNK the user will receive (after fee) */
  outAmount: number;
  /** Fee in TNK */
  feeAmountOut: number;
  /** Agent's Solana address (recipient of user's USDT lock) */
  agentSolanaAddress: string;
  /** HTLC expiry timestamp (Unix ms) */
  htlcExpiresAt: number;
  message: string;
  nextStep: string;
}

/**
 * Initiate a SOL/USDT → TNK cross-chain atomic swap.
 *
 * Steps:
 *   1. Generate HTLC secret
 *   2. Lock TNK on Trac Network (agent as maker)
 *   3. Build the Solana lock_token tx for the user to sign
 *   4. Save secret to DB
 *   5. Return the serialized Solana tx + metadata
 */
export async function initiateSolToTnkSwap(params: {
  /** User's Solana wallet address (public key, base58) */
  userSolanaAddress: string;
  /** User's Trac Network address (recipient of TNK) */
  userTnkAddress: string;
  /** Token the user is sending (e.g. "USDT", "SOL") */
  fromToken: string;
  /** Amount of fromToken the user is sending */
  amount: number;
  /** TNK amount the user will receive (from quote) */
  tnkOutAmount: number;
  /** rfqId from the quote (used as the HTLC seed) */
  rfqId: string;
  /** Timelock in seconds (default: 24h) */
  timelockSecs?: number;
}): Promise<SolToTnkSwapResult> {
  const {
    userSolanaAddress,
    userTnkAddress,
    fromToken,
    amount,
    tnkOutAmount,
    rfqId,
    timelockSecs = DEFAULT_TIMELOCK_SECS,
  } = params;

  const fromTokenUpper = fromToken.toUpperCase();
  const isTnkHtlcLive = !!(process.env.TNK_HTLC_WIF && process.env.TNK_ESCROW_ADDRESS);
  const isSolLive     = !!(process.env.SOL_HTLC_KEY || process.env.SOL_AGENT_KEY);
  const isDemo        = !isTnkHtlcLive || !isSolLive;

  console.log(`[SolToTnk] Initiating ${amount} ${fromTokenUpper} → ${tnkOutAmount.toFixed(6)} TNK (rfqId=${rfqId.slice(0, 12)}…) [${isDemo ? "DEMO" : "LIVE"}]`);

  // ── Step 1: Generate HTLC secret ────────────────────────────────────────────
  const secretBytes    = randomBytes(32);
  const secretHex      = secretBytes.toString("hex");
  const secretHashBytes = createHash("sha256").update(secretBytes).digest();
  const secretHashHex  = secretHashBytes.toString("hex");

  // HTLC IDs: agent's TNK lock = htlc_a_<rfqId>, user's SOL lock = htlc_b_<rfqId>
  const htlcIdA = `htlc_a_${rfqId.slice(0, 22)}`; // Agent's TNK lock (maker)
  const htlcIdB = `htlc_b_${rfqId.slice(0, 22)}`; // User's SOL lock (taker)

  const htlcExpiresAt = Date.now() + timelockSecs * 1000;
  const timelockUnix  = Math.floor(htlcExpiresAt / 1000);

  // Fee calculation
  const feeAmountOut  = tnkOutAmount * (P2P_FEE_BPS / 10000);
  const netTnkOut     = tnkOutAmount - feeAmountOut;
  const tnkAmountRaw  = BigInt(Math.round(netTnkOut * 10 ** TNK_DECIMALS)).toString();

  // ── Step 2: Lock TNK on Trac Network (agent as maker) ────────────────────────
  let tnkLockTxHash: string | null = null;
  const tnkEscrowAddress = process.env.TNK_ESCROW_ADDRESS ?? "";

  if (isTnkHtlcLive) {
    try {
      const tnkLockResult = await submitTnkHtlcLock({
        htlcId:     htlcIdA,
        secretHash: secretHashHex,
        amountRaw:  tnkAmountRaw,
        locktime:   timelockUnix,
        sender:     tnkEscrowAddress,
        recipient:  userTnkAddress,
      });
      if (tnkLockResult.ok) {
        // ContractTxResult.result may contain the txHash depending on the peer response
        const resultObj = tnkLockResult.result as { txHash?: string; hash?: string } | null | undefined;
        tnkLockTxHash = resultObj?.txHash ?? resultObj?.hash ?? null;
        console.log(`[SolToTnk] TNK locked on Trac Network: htlcId=${htlcIdA}, txHash=${tnkLockTxHash ?? "pending"}`);
      } else {
        console.error(`[SolToTnk] TNK lock failed: ${tnkLockResult.error ?? "unknown error"}`);
        return {
          success: false,
          demo: false,
          rfqId,
          solanaLockTxBase64: null,
          htlcId: htlcIdB,
          secretHashHex,
          tnkLockTxHash: null,
          outAmount: netTnkOut,
          feeAmountOut,
          agentSolanaAddress: "",
          htlcExpiresAt,
          message: `TNK lock failed on Trac Network: ${tnkLockResult.error ?? "unknown error"}. Please retry.`,
          nextStep: "Retry in 30 seconds — the Trac Network peer may be temporarily unavailable.",
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[SolToTnk] TNK lock exception: ${msg}`);
      return {
        success: false,
        demo: false,
        rfqId,
        solanaLockTxBase64: null,
        htlcId: htlcIdB,
        secretHashHex,
        tnkLockTxHash: null,
        outAmount: netTnkOut,
        feeAmountOut,
        agentSolanaAddress: "",
        htlcExpiresAt,
        message: `TNK lock exception: ${msg}`,
        nextStep: "Check TNK_HTLC_WIF and TNK_ESCROW_ADDRESS are set correctly in secrets.",
      };
    }
  } else {
    console.warn("[SolToTnk] TNK_HTLC_WIF or TNK_ESCROW_ADDRESS not set — running in demo mode");
    tnkLockTxHash = `demo_tnk_lock_${rfqId.slice(0, 16)}`;
  }

  // ── Step 3: Build Solana lock tx for user to sign ────────────────────────────
  let solanaLockTxBase64: string | null = null;
  let agentSolanaAddress = "";

  try {
    const agentKeypair  = getAgentSolanaKeypair();
    agentSolanaAddress  = agentKeypair.publicKey.toBase58();
    const userPubkey    = new PublicKey(userSolanaAddress);
    const agentPubkey   = agentKeypair.publicKey;
    const htlcIdBBytes  = htlcIdToBytes(htlcIdB);
    const htlcPda       = deriveHtlcPda(htlcIdBBytes);

    let lockInstruction: TransactionInstruction;

    if (fromTokenUpper === "SOL") {
      // Native SOL lock
      const amountLamports = BigInt(Math.round(amount * 1e9));
      const data = Buffer.alloc(8 + 32 + 32 + 32 + 8 + 8);
      LOCK_SOL_DISCRIMINATOR.copy(data, 0);
      Buffer.from(htlcIdBBytes).copy(data, 8);
      Buffer.from(secretHashBytes).copy(data, 40);
      agentPubkey.toBuffer().copy(data, 72);
      data.writeBigInt64LE(BigInt(timelockUnix), 104);
      data.writeBigUInt64LE(amountLamports, 112);
      lockInstruction = new TransactionInstruction({
        programId: AFOS_HTLC_PROGRAM_ID,
        keys: [
          { pubkey: userPubkey,                isSigner: true,  isWritable: true  },
          { pubkey: htlcPda,                   isSigner: false, isWritable: true  },
          { pubkey: SystemProgram.programId,   isSigner: false, isWritable: false },
        ],
        data,
      });
    } else {
      // SPL token lock (USDT, USDC)
      const tokenInfo = TOKEN_MINTS[fromTokenUpper];
      if (!tokenInfo) throw new Error(`Unsupported SPL token: ${fromTokenUpper}`);
      const tokenMint    = new PublicKey(tokenInfo.mint);
      const tokenAmount  = BigInt(Math.round(amount * 10 ** tokenInfo.decimals));
      const senderAta    = deriveAta(userPubkey, tokenMint);
      const vaultAta     = deriveAta(htlcPda, tokenMint);
      const data = Buffer.alloc(8 + 32 + 32 + 32 + 8 + 8);
      LOCK_TOKEN_DISCRIMINATOR.copy(data, 0);
      Buffer.from(htlcIdBBytes).copy(data, 8);
      Buffer.from(secretHashBytes).copy(data, 40);
      agentPubkey.toBuffer().copy(data, 72);
      data.writeBigInt64LE(BigInt(timelockUnix), 104);
      data.writeBigUInt64LE(tokenAmount, 112);
      lockInstruction = new TransactionInstruction({
        programId: AFOS_HTLC_PROGRAM_ID,
        keys: [
          { pubkey: userPubkey,                isSigner: true,  isWritable: true  },
          { pubkey: htlcPda,                   isSigner: false, isWritable: true  },
          { pubkey: tokenMint,                 isSigner: false, isWritable: false },
          { pubkey: senderAta,                 isSigner: false, isWritable: true  },
          { pubkey: vaultAta,                  isSigner: false, isWritable: true  },
          { pubkey: SPL_TOKEN_PROGRAM_ID,      isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId,   isSigner: false, isWritable: false },
        ],
        data,
      });
    }

    // Build the transaction (user must sign — we only set blockhash)
    const connection = getSolanaConnection();
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction();
    tx.add(lockInstruction);
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = userPubkey;
    // Serialize without signing — user will sign in their wallet
    solanaLockTxBase64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
    console.log(`[SolToTnk] Built Solana lock tx for user to sign (htlcId=${htlcIdB}, recipient=${agentSolanaAddress.slice(0, 8)}…)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[SolToTnk] Failed to build Solana lock tx: ${msg}`);
    // If we already locked TNK, we need to refund it — log for manual recovery
    if (tnkLockTxHash && isTnkHtlcLive) {
      console.error(`[SolToTnk] CRITICAL: TNK already locked (htlcId=${htlcIdA}) but Solana tx build failed. Manual refund needed after timelock expires.`);
    }
    return {
      success: false,
      demo: isDemo,
      rfqId,
      solanaLockTxBase64: null,
      htlcId: htlcIdB,
      secretHashHex,
      tnkLockTxHash,
      outAmount: netTnkOut,
      feeAmountOut,
      agentSolanaAddress,
      htlcExpiresAt,
      message: `Failed to build Solana lock transaction: ${msg}`,
      nextStep: "Check SOL_HTLC_KEY is set and the Solana RPC is reachable.",
    };
  }

  // ── Step 4: Save secret to DB ────────────────────────────────────────────────
  try {
    await saveHtlcSecret({
      rfqId,
      secretHex,
      secretHashHex,
      fromChain: "solana",
      toChain:   "trac_network",
      fromToken: fromTokenUpper,
      toToken:   "TNK",
      initiatorAddress:    userSolanaAddress,   // user locks USDT on Solana
      counterpartyAddress: userTnkAddress,       // user receives TNK on Trac Network
      htlcId:              htlcIdB,              // Solana HTLC ID (user's lock)
      expiresAt:           BigInt(htlcExpiresAt),
      status:              "locked" as const,
    });
    console.log(`[SolToTnk] Secret saved to DB (rfqId=${rfqId.slice(0, 12)}…)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[SolToTnk] Failed to save secret to DB: ${msg}`);
    // Non-fatal — the swap can still proceed; HtlcSecretsMonitor will retry
  }

  // ── Step 5: Record analytics ─────────────────────────────────────────────────
  // Analytics recorded as 'completed' once the TNK lock is confirmed (settlement will follow)
  // The Helius webhook will update this to 'completed' after both claims succeed
  void recordSwapAnalytic({
    fromChain:    "solana",
    toChain:      "trac_network",
    fromToken:    fromTokenUpper,
    toToken:      "TNK",
    amount:       String(amount),
    route:        "AFOS P2P (SOL→TNK)",
    status:       "completed",
    walletAddress: userSolanaAddress,
    feeBps:       P2P_FEE_BPS,
    feeAmountOut: String(feeAmountOut.toFixed(8)),
  }).catch(() => {/* non-fatal */});

  return {
    success: true,
    demo: isDemo,
    rfqId,
    solanaLockTxBase64,
    htlcId: htlcIdB,
    secretHashHex,
    tnkLockTxHash,
    outAmount: netTnkOut,
    feeAmountOut,
    agentSolanaAddress,
    htlcExpiresAt,
    message:
      `${isDemo ? "[DEMO] " : ""}TNK locked on Trac Network (${netTnkOut.toFixed(6)} TNK → ${userTnkAddress.slice(0, 12)}…). ` +
      `Please sign the Solana lock transaction to lock your ${amount} ${fromTokenUpper}. ` +
      `The swap will settle atomically once both locks are confirmed.`,
    nextStep:
      "Sign the Solana transaction in your wallet. " +
      "The AFOS agent will automatically claim both sides once your lock is confirmed on-chain.",
  };
}
