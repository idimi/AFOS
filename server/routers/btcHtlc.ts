/**
 * Bitcoin HTLC Router — Server-side atomic swap support for the AFOS agent
 *
 * Provides tRPC procedures for the agent to:
 *   - Lock BTC in a P2WSH HTLC escrow (htlcLock)
 *   - Reveal the secret to claim counterparty funds (htlcReveal)
 *   - Refund BTC after CLTV timeout (htlcRefund)
 *   - Poll HTLC status via mempool.space (htlcStatus)
 *
 * Architecture:
 *   - Browser light peer: uses btcHtlc.ts client-side utilities + wallet signPsbt()
 *   - Agent (server): uses this router — builds raw tx, signs with WIF key (from env),
 *     broadcasts via mempool.space REST API
 *
 * The HTLC escrow private key is stored as BTC_HTLC_WIF in environment variables.
 * Falls back to BTC_AGENT_WIF for backwards compatibility.
 * If neither is set, procedures return a simulation response for demo purposes.
 */

import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { recordSwapAnalytic } from "../htlcMonitor";
import { getDb } from "../db";
import { htlcSwaps, swapAnalytics } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import * as bitcoin from "bitcoinjs-lib";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import ECPairFactory from "ecpair";
import * as tinysecp from "tiny-secp256k1";

const ECPair = ECPairFactory(tinysecp);

// ─── Constants ────────────────────────────────────────────────────────────────

const MEMPOOL_API = "https://mempool.space/api";
const MEMPOOL_TESTNET_API = "https://mempool.space/testnet/api";

function mempoolApi(network: "mainnet" | "testnet" = "mainnet"): string {
  return network === "testnet" ? MEMPOOL_TESTNET_API : MEMPOOL_API;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch confirmed UTXOs for an address from mempool.space
 */
async function fetchUtxos(address: string, network: "mainnet" | "testnet" = "mainnet") {
  const res = await fetch(`${mempoolApi(network)}/address/${address}/utxo`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`mempool.space UTXO fetch failed: ${res.status}`);
  const utxos = await res.json() as Array<{
    txid: string;
    vout: number;
    status: { confirmed: boolean };
    value: number;
  }>;
  return utxos.filter(u => u.status.confirmed);
}

/**
 * Fetch raw transaction hex from mempool.space
 */
async function fetchRawTx(txid: string, network: "mainnet" | "testnet" = "mainnet"): Promise<string> {
  const res = await fetch(`${mempoolApi(network)}/tx/${txid}/hex`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`mempool.space raw tx fetch failed: ${res.status}`);
  return res.text();
}

/**
 * Broadcast a raw transaction hex to mempool.space
 */
async function broadcastTx(txHex: string, network: "mainnet" | "testnet" = "mainnet"): Promise<string> {
  const res = await fetch(`${mempoolApi(network)}/tx`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: txHex,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Broadcast failed: ${err}`);
  }
  return res.text(); // returns txid
}

/**
 * Build the P2WSH HTLC witness script (BIP-199)
 */
function buildHtlcScript(params: {
  secretHash: string;
  recipientPubKey: string;
  senderPubKey: string;
  locktime: number;
}): Uint8Array {
  const secretHashBuf = hexToBytes(params.secretHash);
  const recipientPubKeyBuf = hexToBytes(params.recipientPubKey);
  const senderPubKeyBuf = hexToBytes(params.senderPubKey);

  const recipientPubKeyHash = bitcoin.crypto.hash160(recipientPubKeyBuf);
  const senderPubKeyHash = bitcoin.crypto.hash160(senderPubKeyBuf);
  const locktimeBuf = bitcoin.script.number.encode(params.locktime);

  return bitcoin.script.compile([
    bitcoin.opcodes.OP_IF,
      bitcoin.opcodes.OP_SHA256,
      secretHashBuf,
      bitcoin.opcodes.OP_EQUALVERIFY,
      bitcoin.opcodes.OP_DUP,
      bitcoin.opcodes.OP_HASH160,
      recipientPubKeyHash,
      bitcoin.opcodes.OP_EQUALVERIFY,
      bitcoin.opcodes.OP_CHECKSIG,
    bitcoin.opcodes.OP_ELSE,
      locktimeBuf,
      bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
      bitcoin.opcodes.OP_DROP,
      bitcoin.opcodes.OP_DUP,
      bitcoin.opcodes.OP_HASH160,
      senderPubKeyHash,
      bitcoin.opcodes.OP_EQUALVERIFY,
      bitcoin.opcodes.OP_CHECKSIG,
    bitcoin.opcodes.OP_ENDIF,
  ]);
}

function htlcScriptToAddress(witnessScript: Uint8Array, network: "mainnet" | "testnet" = "mainnet"): string {
  const net = network === "testnet" ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
  const p2wsh = bitcoin.payments.p2wsh({ redeem: { output: witnessScript }, network: net });
  if (!p2wsh.address) throw new Error("Failed to derive P2WSH address");
  return p2wsh.address;
}

/**
 * Generate a random 32-byte secret and its SHA256 hash
 */
function generateSecret(): { secret: string; secretHash: string } {
  const secretBytes = new Uint8Array(32);
  crypto.getRandomValues(secretBytes);
  const secret = bytesToHex(secretBytes);
  const secretHash = bytesToHex(sha256(secretBytes));
  return { secret, secretHash };
}

// ─── Demo mode helpers ────────────────────────────────────────────────────────

/**
 * In demo mode (no BTC_AGENT_WIF set), return a simulated response
 * so the agent can demonstrate the full HTLC flow without real funds.
 */
function demoTxid(prefix: string): string {
  return `${prefix}_demo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const btcHtlcRouter = router({
  /**
   * Lock BTC in a P2WSH HTLC escrow.
   * Called by the agent when initiating a BTC atomic swap.
   *
   * Returns: htlcAddress, witnessScript, txid, secretHash, explorerUrl
   * The agent must store the secret securely and reveal it after the counterparty locks.
   */
  htlcLock: publicProcedure
    .input(z.object({
      /** Agent's Bitcoin address (sender) */
      senderAddress: z.string(),
      /** Compressed public key of the sender (33 bytes hex) */
      senderPubKey: z.string(),
      /** Compressed public key of the counterparty (recipient) */
      recipientPubKey: z.string(),
      /** Amount to lock in satoshis */
      amountSats: z.number().int().positive(),
      /** HTLC expiry in hours (default: 24) */
      expiryHours: z.number().int().positive().default(24),
      /** Bitcoin network */
      network: z.enum(["mainnet", "testnet"]).default("mainnet"),
      /** Optional: pre-generated secret hash (if coordinating with counterparty) */
      secretHash: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { senderAddress, senderPubKey, recipientPubKey, amountSats, expiryHours, network } = input;

      // Generate or use provided secret
      const { secret, secretHash } = input.secretHash
        ? { secret: "", secretHash: input.secretHash }
        : generateSecret();

      // Calculate locktime: current block height + ~blocks per hour * expiryHours
      // Bitcoin: ~6 blocks/hour
      const currentBlockRes = await fetch(`${mempoolApi(network)}/blocks/tip/height`, {
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);
      const currentBlock = currentBlockRes?.ok
        ? parseInt(await currentBlockRes.text(), 10)
        : 840000; // fallback estimate
      const locktime = currentBlock + Math.round(expiryHours * 6);

      // Build HTLC script and address
      const witnessScript = buildHtlcScript({ secretHash, recipientPubKey, senderPubKey, locktime });
      const htlcAddress = htlcScriptToAddress(witnessScript, network);

      // Check if HTLC escrow WIF key is configured (BTC_HTLC_WIF preferred; BTC_AGENT_WIF as fallback)
      const agentWif = process.env.BTC_HTLC_WIF ?? process.env.BTC_AGENT_WIF;

      if (!agentWif) {
        // Demo mode: return simulated response
        const demoTx = demoTxid("htlc_lock");
        return {
          success: true,
          demo: true,
          htlcAddress,
          witnessScript: bytesToHex(witnessScript),
          txid: demoTx,
          secretHash,
          secret: secret || "(stored securely by agent)",
          locktime,
          amountSats,
          explorerUrl: `https://mempool.space/${network === "testnet" ? "testnet/" : ""}tx/${demoTx}`,
          message: `[DEMO] BTC HTLC lock simulated. Set BTC_HTLC_WIF env var to execute real transactions. HTLC address: ${htlcAddress}`,
        };
      }

      // Real mode: fetch UTXOs, build PSBT, sign, broadcast
      const utxos = await fetchUtxos(senderAddress, network);
      if (utxos.length === 0) {
        throw new Error(`No confirmed UTXOs found for ${senderAddress}. Please fund the agent wallet first.`);
      }

      const net = network === "testnet" ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
      const psbt = new bitcoin.Psbt({ network: net });

      // Add inputs
      let totalInput = 0;
      const feeRate = 5; // sats/vbyte
      for (const utxo of utxos) {
        totalInput += utxo.value;
        const rawTx = await fetchRawTx(utxo.txid, network);
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          nonWitnessUtxo: hexToBytes(rawTx),
        });
      }

      const estimatedFee = 200 * feeRate; // ~200 vbytes for 1-in-2-out P2WPKH
      const changeAmount = totalInput - amountSats - estimatedFee;
      if (changeAmount < 0) {
        throw new Error(`Insufficient funds: need ${amountSats + estimatedFee} sats, have ${totalInput} sats`);
      }

      // Output 0: HTLC lock
      psbt.addOutput({ address: htlcAddress, value: BigInt(amountSats) });
      // Output 1: Change
      if (changeAmount >= 546) {
        psbt.addOutput({ address: senderAddress, value: BigInt(changeAmount) });
      }

      // Sign with agent WIF key
      const keyPair = ECPair.fromWIF(agentWif, net);
      psbt.signAllInputs(keyPair);
      psbt.finalizeAllInputs();

      const txHex = psbt.extractTransaction().toHex();
      const txid = await broadcastTx(txHex, network);

      // Record analytics — attribute to the sender's BTC address
      const btcAmountHuman = (amountSats / 1e8).toFixed(8);
      void recordSwapAnalytic({
        fromChain:    "bitcoin",
        toChain:      "bitcoin",
        fromToken:    "BTC",
        toToken:      "BTC",
        amount:       btcAmountHuman,
        route:        "IntercomSwap P2P (HTLC)",
        status:       "completed",
        feeBps:       15,
        feeAmountOut: String((amountSats * 0.0015 / 1e8).toFixed(8)),
        walletAddress: senderAddress,
      }).catch(() => {/* non-fatal */});

      return {
        success: true,
        demo: false,
        htlcAddress,
        witnessScript: bytesToHex(witnessScript),
        txid,
        secretHash,
        secret, // agent must store this securely
        locktime,
        amountSats,
        explorerUrl: `https://mempool.space/${network === "testnet" ? "testnet/" : ""}tx/${txid}`,
        message: `BTC HTLC locked: ${amountSats.toLocaleString()} sats → ${htlcAddress}. Tx: ${txid}`,
      };
    }),

  /**
   * Reveal the secret to claim funds from a counterparty's HTLC.
   * Called by the agent after the counterparty has locked their funds.
   */
  htlcReveal: publicProcedure
    .input(z.object({
      /** The HTLC address to claim from */
      htlcAddress: z.string(),
      /** The witness script (hex) */
      witnessScript: z.string(),
      /** The secret (preimage) to reveal */
      secret: z.string(),
      /** The recipient address to send claimed funds to */
      recipientAddress: z.string(),
      /** Recipient compressed public key (33 bytes hex) */
      recipientPubKey: z.string(),
      /** Network */
      network: z.enum(["mainnet", "testnet"]).default("mainnet"),
    }))
    .mutation(async ({ input }) => {
      const { htlcAddress, witnessScript, secret, recipientAddress, network } = input;

      // Verify the secret matches the hash in the script
      const secretBytes = hexToBytes(secret);
      const computedHash = bytesToHex(sha256(secretBytes));

      // BTC_HTLC_WIF is the dedicated HTLC escrow key; fall back to BTC_AGENT_WIF for backwards compatibility
      const agentWif = process.env.BTC_HTLC_WIF ?? process.env.BTC_AGENT_WIF;

      if (!agentWif) {
        // Demo mode
        const demoTx = demoTxid("htlc_reveal");
        return {
          success: true,
          demo: true,
          txid: demoTx,
          secretHash: computedHash,
          explorerUrl: `https://mempool.space/${network === "testnet" ? "testnet/" : ""}tx/${demoTx}`,
          message: `[DEMO] BTC HTLC reveal simulated. Secret hash: ${computedHash.slice(0, 16)}…`,
        };
      }

      // Fetch UTXOs at the HTLC address
      const utxos = await fetchUtxos(htlcAddress, network);
      if (utxos.length === 0) {
        throw new Error(`No confirmed UTXOs at HTLC address ${htlcAddress}. The lock tx may not be confirmed yet.`);
      }

      const net = network === "testnet" ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
      const psbt = new bitcoin.Psbt({ network: net });
      const witnessScriptBuf = hexToBytes(witnessScript);

      let totalInput = 0;
      for (const utxo of utxos) {
        totalInput += utxo.value;
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            script: bitcoin.payments.p2wsh({ redeem: { output: witnessScriptBuf }, network: net }).output!,
            value: BigInt(utxo.value),
          },
          witnessScript: witnessScriptBuf,
        });
      }

      const feeRate = 5;
      const estimatedFee = 250 * feeRate;
      const claimAmount = totalInput - estimatedFee;
      if (claimAmount < 546) throw new Error("Claim amount below dust threshold after fees");

      psbt.addOutput({ address: recipientAddress, value: BigInt(claimAmount) });

      // Sign and finalize with secret reveal
      const keyPair = ECPair.fromWIF(agentWif, net);

      psbt.signAllInputs(keyPair);

      // Finalize with OP_IF path (reveal secret)
      for (let i = 0; i < psbt.data.inputs.length; i++) {
        const sig = psbt.data.inputs[i].partialSig?.[0]?.signature;
        if (!sig) throw new Error(`Missing signature for input ${i}`);
        const pubKey = hexToBytes(input.recipientPubKey);
        psbt.finalizeInput(i, () => ({
          finalScriptWitness: bitcoin.script.compile([
            sig,
            pubKey,
            secretBytes,
            new Uint8Array([1]), // OP_TRUE for OP_IF branch
            witnessScriptBuf,
          ]),
        }));
      }

       const txHex = psbt.extractTransaction().toHex();
      const txid = await broadcastTx(txHex, network);

      // Update htlcSwaps + swapAnalytics status to "completed" on successful reveal
      void (async () => {
        try {
          const db = await getDb();
          if (!db) return;
          // 1. Mark the HTLC lock row as completed
          await db
            .update(htlcSwaps)
            .set({ status: "completed", updatedAt: new Date() })
            .where(eq(htlcSwaps.htlcAddress, htlcAddress));
          // 2. Find the matching swapAnalytics row via lockTxId and update its status.
          //    Also back-fill walletAddress with recipientAddress for per-user history scoping.
          const [htlcRow] = await db
            .select({ lockTxId: htlcSwaps.lockTxId })
            .from(htlcSwaps)
            .where(eq(htlcSwaps.htlcAddress, htlcAddress))
            .limit(1);
          if (htlcRow?.lockTxId) {
            await db
              .update(swapAnalytics)
              .set({
                status:        "completed",
                walletAddress: recipientAddress, // attribute reveal to recipient wallet
              })
              .where(eq(swapAnalytics.txId, htlcRow.lockTxId));
          }
        } catch (e) {
          console.error("[htlcReveal] Failed to update analytics status:", e);
        }
      })();

      return {
        success: true,
        demo: false,
        txid,
        secretHash: computedHash,
        claimAmount,
        explorerUrl: `https://mempool.space/${network === "testnet" ? "testnet/" : ""}tx/${txid}`,
        message: `BTC HTLC claimed: ${claimAmount.toLocaleString()} sats → ${recipientAddress}. Tx: ${txid}`,
      };
    }),
  /**
   * Refund BTC after HTLC timeout (CLTV expired)..
   * Called by the agent if the counterparty never revealed the secret.
   */
  htlcRefund: publicProcedure
    .input(z.object({
      htlcAddress: z.string(),
      witnessScript: z.string(),
      senderAddress: z.string(),
      senderPubKey: z.string(),
      locktime: z.number().int(),
      network: z.enum(["mainnet", "testnet"]).default("mainnet"),
    }))
    .mutation(async ({ input }) => {
      const { htlcAddress, witnessScript, senderAddress, network, locktime } = input;

      // BTC_HTLC_WIF is the dedicated HTLC escrow key; fall back to BTC_AGENT_WIF for backwards compatibility
      const agentWif = process.env.BTC_HTLC_WIF ?? process.env.BTC_AGENT_WIF;

      if (!agentWif) {
        const demoTx = demoTxid("htlc_refund");
        return {
          success: true,
          demo: true,
          txid: demoTx,
          explorerUrl: `https://mempool.space/${network === "testnet" ? "testnet/" : ""}tx/${demoTx}`,
          message: `[DEMO] BTC HTLC refund simulated. Locktime: ${locktime}`,
        };
      }

      const utxos = await fetchUtxos(htlcAddress, network);
      if (utxos.length === 0) {
        throw new Error(`No confirmed UTXOs at HTLC address ${htlcAddress}`);
      }

      const net = network === "testnet" ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
      const psbt = new bitcoin.Psbt({ network: net });
      psbt.setLocktime(locktime);

      const witnessScriptBuf = hexToBytes(witnessScript);
      let totalInput = 0;

      for (const utxo of utxos) {
        totalInput += utxo.value;
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          sequence: 0xfffffffe, // enable nLockTime
          witnessUtxo: {
            script: bitcoin.payments.p2wsh({ redeem: { output: witnessScriptBuf }, network: net }).output!,
            value: BigInt(utxo.value),
          },
          witnessScript: witnessScriptBuf,
        });
      }

      const feeRate = 5;
      const estimatedFee = 250 * feeRate;
      const refundAmount = totalInput - estimatedFee;
      if (refundAmount < 546) throw new Error("Refund amount below dust threshold");

      psbt.addOutput({ address: senderAddress, value: BigInt(refundAmount) });

      const keyPair = ECPair.fromWIF(agentWif, net);

      psbt.signAllInputs(keyPair);

      // Finalize with OP_ELSE path (refund after timeout)
      for (let i = 0; i < psbt.data.inputs.length; i++) {
        const sig = psbt.data.inputs[i].partialSig?.[0]?.signature;
        if (!sig) throw new Error(`Missing signature for input ${i}`);
        const pubKey = hexToBytes(input.senderPubKey);
        psbt.finalizeInput(i, () => ({
          finalScriptWitness: bitcoin.script.compile([
            sig,
            pubKey,
            new Uint8Array([]), // empty for OP_ELSE branch
            witnessScriptBuf,
          ]),
        }));
      }

      const txHex = psbt.extractTransaction().toHex();
      const txid = await broadcastTx(txHex, network);

      // Update htlcSwaps + swapAnalytics status to "refunded" on successful broadcast
      void (async () => {
        try {
          const db = await getDb();
          if (!db) return;
          // 1. Mark the HTLC lock row as refunded
          await db
            .update(htlcSwaps)
            .set({ status: "refunded", updatedAt: new Date() })
            .where(eq(htlcSwaps.htlcAddress, htlcAddress));
          // 2. Find the matching swapAnalytics row via lockTxId and update its status
          const [htlcRow] = await db
            .select({ lockTxId: htlcSwaps.lockTxId })
            .from(htlcSwaps)
            .where(eq(htlcSwaps.htlcAddress, htlcAddress))
            .limit(1);
          if (htlcRow?.lockTxId) {
            await db
              .update(swapAnalytics)
              .set({ status: "refunded" })
              .where(eq(swapAnalytics.txId, htlcRow.lockTxId));
          }
        } catch (e) {
          console.error("[htlcRefund] Failed to update analytics status:", e);
        }
      })();

      return {
        success: true,
        demo: false,
        txid,
        refundAmount,
        explorerUrl: `https://mempool.space/${network === "testnet" ? "testnet/" : ""}tx/${txid}`,
        message: `BTC HTLC refunded: ${refundAmount.toLocaleString()} sats → ${senderAddress}. Tx: ${txid}`,
      };
    }),

  /**
   * Poll the status of an HTLC by checking the HTLC address UTXOs and
   * the lock/reveal/refund transactions on mempool.space.
   */
  htlcStatus: publicProcedure
    .input(z.object({
      htlcAddress: z.string(),
      lockTxid: z.string().optional(),
      network: z.enum(["mainnet", "testnet"]).default("mainnet"),
    }))
    .query(async ({ input }) => {
      const { htlcAddress, lockTxid, network } = input;

      try {
        const utxos = await fetchUtxos(htlcAddress, network);
        const totalLocked = utxos.reduce((sum, u) => sum + u.value, 0);

        let lockConfirmations = 0;
        if (lockTxid) {
          const txRes = await fetch(`${mempoolApi(network)}/tx/${lockTxid}`, {
            signal: AbortSignal.timeout(5000),
          }).catch(() => null);
          if (txRes?.ok) {
            const txData = await txRes.json() as { status?: { confirmed?: boolean; block_height?: number } };
            if (txData.status?.confirmed) {
              const tipRes = await fetch(`${mempoolApi(network)}/blocks/tip/height`, {
                signal: AbortSignal.timeout(5000),
              }).catch(() => null);
              const tipHeight = tipRes?.ok ? parseInt(await tipRes.text(), 10) : 0;
              lockConfirmations = tipHeight - (txData.status.block_height ?? tipHeight);
            }
          }
        }

        return {
          htlcAddress,
          utxoCount: utxos.length,
          totalLockedSats: totalLocked,
          lockConfirmations,
          isLocked: utxos.length > 0,
          isClaimed: utxos.length === 0 && lockTxid !== undefined,
          explorerUrl: `https://mempool.space/${network === "testnet" ? "testnet/" : ""}address/${htlcAddress}`,
        };
      } catch (err) {
        return {
          htlcAddress,
          utxoCount: 0,
          totalLockedSats: 0,
          lockConfirmations: 0,
          isLocked: false,
          isClaimed: false,
          error: err instanceof Error ? err.message : "Status check failed",
          explorerUrl: `https://mempool.space/${network === "testnet" ? "testnet/" : ""}address/${htlcAddress}`,
        };
      }
    }),
});
