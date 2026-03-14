/**
 * agentSwapTnkToSol.ts — Server-side TNK → SOL/USDT/USDC cross-chain swap initiation
 *
 * Flow (Maker-Taker HTLC model — reverse of SOL→TNK):
 *   1. Agent (maker) locks SOL/USDT/USDC on Solana HTLC first
 *      → agent signs and broadcasts a lock_sol / lock_token instruction
 *   2. Returns a serialized Trac Network lock instruction for the user to sign
 *      → user locks TNK into the AFOS HTLC contract on Trac Network
 *   3. Helius webhook detects user's TNK lock → triggers:
 *      a. claimTnkHtlc()      — agent claims TNK from Trac Network
 *      b. claimSolanaHtlc()   — user's SOL/USDT/USDC is released on Solana
 *
 * Both HTLCs share the same secret/secretHash, ensuring atomic settlement.
 *
 * Environment variables required:
 *   SOL_HTLC_KEY         — Agent's Solana keypair (base58) — signs the Solana lock
 *   TNK_HTLC_WIF         — Trac Network HTLC signing key (WIF format)
 *   TNK_ESCROW_ADDRESS   — Agent's Trac Network address (recipient of user's TNK lock)
 *   TNK_HTLC_CONTRACT_ADDRESS — AFOS HTLC contract address on Trac Network
 *
 * Supported fromToken values: "TNK"
 * Supported toToken values:   "SOL", "USDT", "USDC"
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import bs58 from "bs58";
import { randomBytes, createHash } from "crypto";
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

// Anchor discriminators (must match AFOS HTLC program)
const LOCK_TOKEN_DISCRIMINATOR = Buffer.from([153, 150, 141, 190, 78, 115, 232, 80]);
const LOCK_SOL_DISCRIMINATOR   = Buffer.from([181, 15, 15, 99, 159, 87, 241, 42]);

// Well-known SPL token mints on mainnet
const TOKEN_MINTS: Record<string, { mint: string; decimals: number }> = {
  USDT: { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
  USDC: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
};

// TNK uses 8 decimal places
const TNK_DECIMALS = 8;
// Fee: 0.15% on the output (SOL/USDT/USDC) side
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
  if (!keyStr) throw new Error("SOL_HTLC_KEY not set — cannot sign Solana HTLC lock");
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

// ─── Return type ──────────────────────────────────────────────────────────────
export interface TnkToSolSwapResult {
  success: boolean;
  demo: boolean;
  rfqId: string;
  /** Base64-encoded Trac Network lock transaction for the user to broadcast */
  tnkLockTxPayload: string | null;
  /** HTLC ID on the Trac Network side (htlc_b_<rfqId>) — user locks TNK here */
  htlcIdB: string;
  /** HTLC ID on the Solana side (htlc_a_<rfqId>) — agent locks SOL/USDT/USDC here */
  htlcIdA: string;
  secretHashHex: string;
  /** Solana lock tx signature (agent's lock — already on-chain) */
  solanaLockTxSig: string | null;
  /** Amount of SOL/USDT/USDC the user will receive (after fee) */
  outAmount: number;
  /** Fee amount in toToken units */
  feeAmountOut: number;
  /** Agent's Trac Network address (recipient of user's TNK lock) */
  agentTnkAddress: string;
  htlcExpiresAt: number;
  message: string;
  nextStep?: string;
}

/**
 * Initiate a TNK → SOL/USDT/USDC cross-chain atomic swap.
 *
 * The agent acts as maker:
 *   1. Generates HTLC secret + hash
 *   2. Locks SOL/USDT/USDC on Solana (agent signs and broadcasts)
 *   3. Returns a Trac Network lock payload for the user to sign and broadcast
 *
 * Settlement is triggered by the Helius webhook when the user's TNK lock is detected.
 */
export async function initiateTnkToSolSwap(params: {
  /** User's Solana address (recipient of SOL/USDT/USDC) */
  userSolanaAddress: string;
  /** User's Trac Network address (sender of TNK lock) */
  userTnkAddress: string;
  /** Token the user is receiving (e.g. "SOL", "USDT", "USDC") */
  toToken: string;
  /** Amount of TNK the user is sending */
  amount: number;
  /** SOL/USDT/USDC amount the user will receive (from quote) */
  solOutAmount: number;
  /** Pre-generated rfqId (for DB correlation) */
  rfqId: string;
}): Promise<TnkToSolSwapResult> {
  const { userSolanaAddress, userTnkAddress, toToken, amount, solOutAmount, rfqId } = params;

  const toTokenUpper = toToken.toUpperCase();
  const isSolLive    = !!(process.env.SOL_HTLC_KEY || process.env.SOL_AGENT_KEY);
  const isTnkLive    = !!(process.env.TNK_HTLC_WIF && process.env.TNK_ESCROW_ADDRESS);
  const isDemo       = !isSolLive;

  console.log(`[TnkToSol] Initiating ${amount} TNK → ${solOutAmount.toFixed(6)} ${toTokenUpper} (rfqId=${rfqId.slice(0, 12)}…) [${isDemo ? "DEMO" : "LIVE"}]`);

  // ── Generate HTLC secret ──────────────────────────────────────────────────
  const secretBytes    = randomBytes(32);
  const secretHex      = secretBytes.toString("hex");
  const secretHashBytes = createHash("sha256").update(secretBytes).digest();
  const secretHashHex  = secretHashBytes.toString("hex");

  // ── HTLC IDs ─────────────────────────────────────────────────────────────
  // htlc_a_ = agent's Solana lock (maker) — agent locks SOL/USDT/USDC
  // htlc_b_ = user's TNK lock (taker) — user locks TNK on Trac Network
  const htlcIdA = `htlc_a_${rfqId.slice(0, 22)}`; // Agent's Solana lock
  const htlcIdB = `htlc_b_${rfqId.slice(0, 22)}`; // User's TNK lock

  // Fee: 0.15% on output (SOL/USDT/USDC) side
  const feeAmountOut = solOutAmount * (P2P_FEE_BPS / 10000);
  const netSolOut    = solOutAmount - feeAmountOut;

  // HTLC timelock: 24h for agent's Solana lock, 12h for user's TNK lock (user must lock first)
  const now            = Math.floor(Date.now() / 1000);
  const timelockUnix   = now + DEFAULT_TIMELOCK_SECS;
  const htlcExpiresAt  = timelockUnix * 1000; // ms for frontend

  // ── Persist HTLC secret to DB ─────────────────────────────────────────────
  void saveHtlcSecret({
    rfqId,
    secretHex,
    secretHashHex,
    fromChain:  "trac_network",
    toChain:    "solana",
    expiresAt:  BigInt(htlcExpiresAt),
    status:     "locked",
  }).catch(err => console.error("[TnkToSol] DB saveHtlcSecret failed:", err));

  // ── Step 1: Agent locks SOL/USDT/USDC on Solana ──────────────────────────
  let solanaLockTxSig: string | null = null;
  const agentTnkAddress = process.env.TNK_ESCROW_ADDRESS ?? "demo_agent_tnk_address";

  if (isSolLive) {
    try {
      const agentKeypair   = getAgentSolanaKeypair();
      const connection     = getSolanaConnection();
      const agentPubkey    = agentKeypair.publicKey;
      const userPubkey     = new PublicKey(userSolanaAddress);
      const htlcIdABytes   = htlcIdToBytes(htlcIdA);
      const htlcPda        = deriveHtlcPda(htlcIdABytes);
      let lockInstruction: TransactionInstruction;

      if (toTokenUpper === "SOL") {
        // Native SOL lock — agent locks SOL into HTLC PDA
        const amountLamports = BigInt(Math.round(netSolOut * 1e9));
        const data = Buffer.alloc(8 + 32 + 32 + 32 + 8 + 8);
        LOCK_SOL_DISCRIMINATOR.copy(data, 0);
        Buffer.from(htlcIdABytes).copy(data, 8);
        Buffer.from(secretHashBytes).copy(data, 40);
        userPubkey.toBuffer().copy(data, 72);          // recipient = user
        data.writeBigInt64LE(BigInt(timelockUnix), 104);
        data.writeBigUInt64LE(amountLamports, 112);
        lockInstruction = new TransactionInstruction({
          programId: AFOS_HTLC_PROGRAM_ID,
          keys: [
            { pubkey: agentPubkey, isSigner: true,  isWritable: true  },
            { pubkey: htlcPda,     isSigner: false, isWritable: true  },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data,
        });
      } else {
        // SPL token lock (USDT, USDC) — agent locks tokens into HTLC vault ATA
        const tokenInfo = TOKEN_MINTS[toTokenUpper];
        if (!tokenInfo) throw new Error(`Unsupported SPL token: ${toTokenUpper}`);
        const tokenMint   = new PublicKey(tokenInfo.mint);
        const tokenAmount = BigInt(Math.round(netSolOut * 10 ** tokenInfo.decimals));
        const agentAta    = deriveAta(agentPubkey, tokenMint);
        const vaultAta    = deriveAta(htlcPda, tokenMint);
        const data = Buffer.alloc(8 + 32 + 32 + 32 + 8 + 8);
        LOCK_TOKEN_DISCRIMINATOR.copy(data, 0);
        Buffer.from(htlcIdABytes).copy(data, 8);
        Buffer.from(secretHashBytes).copy(data, 40);
        userPubkey.toBuffer().copy(data, 72);          // recipient = user
        data.writeBigInt64LE(BigInt(timelockUnix), 104);
        data.writeBigUInt64LE(tokenAmount, 112);
        lockInstruction = new TransactionInstruction({
          programId: AFOS_HTLC_PROGRAM_ID,
          keys: [
            { pubkey: agentPubkey,           isSigner: true,  isWritable: true  },
            { pubkey: htlcPda,               isSigner: false, isWritable: true  },
            { pubkey: tokenMint,             isSigner: false, isWritable: false },
            { pubkey: agentAta,              isSigner: false, isWritable: true  },
            { pubkey: vaultAta,              isSigner: false, isWritable: true  },
            { pubkey: SPL_TOKEN_PROGRAM_ID,  isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data,
        });
      }

      // Build, sign, and send the Solana lock transaction
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({
        recentBlockhash: blockhash,
        feePayer: agentPubkey,
      });
      tx.add(lockInstruction);
      tx.sign(agentKeypair);
      solanaLockTxSig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      await connection.confirmTransaction({ signature: solanaLockTxSig, blockhash, lastValidBlockHeight }, "confirmed");
      console.log(`[TnkToSol] Agent locked ${netSolOut.toFixed(6)} ${toTokenUpper} on Solana: ${solanaLockTxSig}`);

      // Update DB with Solana lock tx
      void saveHtlcSecret({
        rfqId,
        secretHex,
        secretHashHex,
        fromChain:  "trac_network",
        toChain:    "solana",
        expiresAt:  BigInt(htlcExpiresAt),
        status:     "locked",
        lockTxId:   solanaLockTxSig ?? undefined,
      }).catch(() => {/* non-fatal */});

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[TnkToSol] Solana lock failed: ${msg}`);
      return {
        success: false,
        demo: false,
        rfqId,
        tnkLockTxPayload: null,
        htlcIdA,
        htlcIdB,
        secretHashHex,
        solanaLockTxSig: null,
        outAmount: netSolOut,
        feeAmountOut,
        agentTnkAddress,
        htlcExpiresAt,
        message: `Solana lock failed: ${msg}`,
        nextStep: "Check SOL_HTLC_KEY balance and RPC connectivity.",
      };
    }
  } else {
    console.warn("[TnkToSol] SOL_HTLC_KEY not set — running in demo mode");
    solanaLockTxSig = `demo_sol_lock_${rfqId.slice(0, 16)}`;
  }

  // ── Step 2: Build Trac Network lock payload for user ─────────────────────
  // The user must lock TNK into htlc_b_ on Trac Network.
  // We return the lock parameters as a JSON payload — the frontend (Tap Wallet)
  // signs and broadcasts this to the Trac Network peer node.
  //
  // TNK HTLC lock payload format (matches trac-peer /v1/contract/submit):
  // {
  //   type: "htlc_lock",
  //   value: { htlcId, secretHash, amountRaw, locktime, sender, recipient }
  // }
  const tnkAmountRaw = Math.round(amount * 10 ** TNK_DECIMALS).toString();
  // User's TNK lock timelock is shorter (12h) — must settle before agent's Solana lock expires
  const tnkTimelockUnix = now + Math.floor(DEFAULT_TIMELOCK_SECS / 2);

  const tnkLockPayload = {
    type: "htlc_lock",
    value: {
      htlcId:     htlcIdB,
      secretHash: secretHashHex,
      amountRaw:  tnkAmountRaw,
      locktime:   tnkTimelockUnix,
      sender:     userTnkAddress,
      recipient:  agentTnkAddress,
    },
  };
  const tnkLockTxPayload = Buffer.from(JSON.stringify(tnkLockPayload)).toString("base64");

  // ── Record analytics ──────────────────────────────────────────────────────
  void recordSwapAnalytic({
    fromChain:    "trac_network",
    toChain:      "solana",
    fromToken:    "TNK",
    toToken:      toTokenUpper,
    amount:       String(amount),
    route:        "AFOS TNK→SOL HTLC",
    status:       "completed",
    walletAddress: userSolanaAddress,
  }).catch(() => {/* non-fatal */});

  return {
    success:          true,
    demo:             isDemo,
    rfqId,
    tnkLockTxPayload,
    htlcIdA,
    htlcIdB,
    secretHashHex,
    solanaLockTxSig,
    outAmount:        netSolOut,
    feeAmountOut,
    agentTnkAddress,
    htlcExpiresAt,
    message:
      isDemo
        ? `[DEMO] Agent would lock ${netSolOut.toFixed(6)} ${toTokenUpper} on Solana. ` +
          `Sign the TNK lock transaction in your Tap Wallet to complete the swap.`
        : `Agent locked ${netSolOut.toFixed(6)} ${toTokenUpper} on Solana (tx: ${solanaLockTxSig?.slice(0, 16)}…). ` +
          `Sign the TNK lock transaction in your Tap Wallet to complete the swap.`,
    nextStep: "Sign and broadcast the TNK lock transaction in your Tap Wallet. The agent will claim TNK and release your SOL/USDT/USDC automatically.",
  };
}
