/**
 * btcHtlc.ts — Bitcoin HTLC (Hash Time-Locked Contract) utilities
 *
 * Supports all four Bitcoin wallet providers:
 *   - Phantom       → window.phantom.bitcoin.signPSBT(bytes)
 *   - Xverse        → window.XverseProviders.BitcoinProvider.signPsbt(base64, opts)
 *   - Tap Wallet    → window.tracnetwork.signPsbt(hex)
 *   - MetaMask      → wallet_invokeSnap (BTC snap)
 *
 * Uses bitcoinjs-lib for PSBT construction and P2WSH script encoding.
 * The HTLC script follows BIP-199 (HTLC for atomic swaps):
 *
 *   OP_IF
 *     OP_SHA256 <secretHash> OP_EQUALVERIFY
 *     OP_DUP OP_HASH160 <recipientPubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
 *   OP_ELSE
 *     <locktime> OP_CHECKLOCKTIMEVERIFY OP_DROP
 *     OP_DUP OP_HASH160 <senderPubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
 *   OP_ENDIF
 */

import * as bitcoin from "bitcoinjs-lib";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BtcWalletProvider = "phantom" | "xverse" | "tap" | "metamask" | "unknown";

export interface HtlcParams {
  /** SHA256 hash of the atomic swap secret (32 bytes hex) */
  secretHash: string;
  /** Recipient's compressed public key (33 bytes hex) */
  recipientPubKey: string;
  /** Sender's compressed public key (33 bytes hex) */
  senderPubKey: string;
  /** CLTV locktime: Unix timestamp (seconds) or block height */
  locktime: number;
  /** Amount to lock in satoshis */
  amountSats: number;
  /** Network: mainnet or testnet */
  network?: "mainnet" | "testnet";
}

export interface HtlcLockResult {
  /** P2WSH address to send BTC to */
  htlcAddress: string;
  /** The witness script (hex) — needed to spend */
  witnessScript: string;
  /** PSBT in base64 for signing */
  psbtBase64: string;
  /** PSBT in hex for wallets that prefer hex */
  psbtHex: string;
}

export interface BroadcastResult {
  txid: string;
  explorerUrl: string;
}

// ─── Provider Detection ───────────────────────────────────────────────────────

/**
 * Detect which Bitcoin wallet provider is currently active in the browser.
 * Priority: Phantom > Xverse > Tap Wallet > MetaMask BTC Snap
 */
export function detectBtcProvider(): BtcWalletProvider {
  if (typeof window === "undefined") return "unknown";
  if ((window as any).phantom?.bitcoin?.isPhantom) return "phantom";
  if ((window as any).XverseProviders?.BitcoinProvider) return "xverse";
  if ((window as any).tracnetwork?.signPsbt) return "tap";
  if ((window as any).ethereum?.isMetaMask) return "metamask";
  return "unknown";
}

/**
 * Get the active Bitcoin address from the detected provider.
 * Returns null if no BTC wallet is connected.
 */
export async function getBtcAddress(provider: BtcWalletProvider): Promise<string | null> {
  try {
    switch (provider) {
      case "phantom": {
        const ph = (window as any).phantom?.bitcoin;
        if (!ph) return null;
        const accounts = await ph.requestAccounts();
        const paymentAcc = accounts.find((a: any) =>
          a.purpose === "payment" || a.addressType === "p2wpkh" || a.addressType === "p2tr"
        ) ?? accounts[0];
        return paymentAcc?.address ?? null;
      }
      case "xverse": {
        const xverse = (window as any).XverseProviders?.BitcoinProvider;
        if (!xverse) return null;
        const resp = await xverse.request("getAccounts", {
          purposes: ["payment"],
          message: "AFOS HTLC swap",
        });
        return resp?.result?.addresses?.[0]?.address ?? null;
      }
      case "tap": {
        const tap = (window as any).tracnetwork;
        if (!tap) return null;
        return await tap.requestAccount();
      }
      case "metamask": {
        // MetaMask BTC address comes from CAIP-25 session
        const eth = (window as any).ethereum;
        if (!eth) return null;
        const session = await eth.request({ method: "wallet_getSession" }) as any;
        const btcScope = session?.sessionScopes?.["bip122:000000000019d6689c085ae165831e93"];
        const accounts = btcScope?.accounts ?? [];
        if (!accounts.length) return null;
        // CAIP-10 format: "bip122:000000000019d6689c085ae165831e93:bc1q..."
        return accounts[0].split(":").pop() ?? null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ─── HTLC Script Builder ──────────────────────────────────────────────────────

/**
 * Build the P2WSH HTLC witness script.
 * Returns the compiled script Buffer.
 */
export function buildHtlcScript(params: HtlcParams): Uint8Array {
  const secretHashBuf = hexToBytes(params.secretHash);
  const recipientPubKeyBuf = hexToBytes(params.recipientPubKey);
  const senderPubKeyBuf = hexToBytes(params.senderPubKey);

  // Hash160 of the public keys (RIPEMD160(SHA256(pubkey)))
  const recipientPubKeyHash = bitcoin.crypto.hash160(recipientPubKeyBuf);
  const senderPubKeyHash = bitcoin.crypto.hash160(senderPubKeyBuf);

  // Encode locktime as little-endian script number
  const locktimeBuf = bitcoin.script.number.encode(params.locktime);

  // Build the HTLC script following BIP-199
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

/**
 * Derive the P2WSH address from the HTLC witness script.
 */
export function htlcScriptToAddress(witnessScript: Uint8Array, network: "mainnet" | "testnet" = "mainnet"): string {
  const net = network === "testnet" ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
  const p2wsh = bitcoin.payments.p2wsh({ redeem: { output: witnessScript }, network: net });
  return p2wsh.address!;
}

// ─── PSBT Builder ─────────────────────────────────────────────────────────────

export interface UtxoInput {
  txid: string;
  vout: number;
  value: number; // satoshis
  /** Raw transaction hex — required for non-SegWit inputs */
  rawTx?: string;
  /** Witness UTXO script (hex) — for SegWit inputs */
  witnessUtxoScript?: string;
}

/**
 * Build a PSBT that locks BTC into the HTLC P2WSH address.
 * The PSBT will have one output to the HTLC address and one change output.
 *
 * @param params HTLC parameters
 * @param utxos UTXOs to spend from the sender's wallet
 * @param senderAddress Sender's Bitcoin address (for change output)
 * @param feeRateSatsPerVbyte Fee rate in sat/vbyte (default: 5)
 */
export function buildHtlcLockPsbt(
  params: HtlcParams,
  utxos: UtxoInput[],
  senderAddress: string,
  feeRateSatsPerVbyte = 5,
): HtlcLockResult {
  const net = params.network === "testnet" ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
  const witnessScript = buildHtlcScript(params);
  const htlcAddress = htlcScriptToAddress(witnessScript, params.network);

  const psbt = new bitcoin.Psbt({ network: net });

  // Add inputs
  let totalInput = 0;
  for (const utxo of utxos) {
    totalInput += utxo.value;
    const inputData: any = {
      hash: utxo.txid,
      index: utxo.vout,
    };

    if (utxo.witnessUtxoScript) {
      // SegWit input (P2WPKH / P2WSH)
      inputData.witnessUtxo = {
        script: hexToBytes(utxo.witnessUtxoScript),
        value: BigInt(utxo.value),
      };
    } else if (utxo.rawTx) {
      // Legacy input
      inputData.nonWitnessUtxo = hexToBytes(utxo.rawTx);
    }

    psbt.addInput(inputData);
  }

  // Estimate fee: ~200 vbytes for a typical 1-in 2-out P2WPKH → P2WSH tx
  const estimatedFee = feeRateSatsPerVbyte * 200;
  const changeAmount = totalInput - params.amountSats - estimatedFee;

  if (changeAmount < 0) {
    throw new Error(
      `Insufficient funds: need ${params.amountSats + estimatedFee} sats, have ${totalInput} sats`
    );
  }

  // Output 0: HTLC lock
  psbt.addOutput({
    address: htlcAddress,
    value: BigInt(params.amountSats),
  });

  // Output 1: Change back to sender (only if above dust threshold: 546 sats)
  if (changeAmount >= 546) {
    psbt.addOutput({
      address: senderAddress,
      value: BigInt(changeAmount),
    });
  }

  const psbtBase64 = psbt.toBase64();
  const psbtHex = psbt.toHex();

  return {
    htlcAddress,
    witnessScript: bytesToHex(witnessScript),
    psbtBase64,
    psbtHex,
  };
}

// ─── Wallet Signing ───────────────────────────────────────────────────────────

/**
 * Sign a PSBT using the detected Bitcoin wallet provider.
 * Returns the signed PSBT as base64.
 */
export async function signPsbtWithWallet(
  psbtBase64: string,
  provider: BtcWalletProvider,
  inputsToSign?: number[],
): Promise<string> {
  const psbtBytes = Buffer.from(psbtBase64, "base64");
  const psbtHex = psbtBytes.toString("hex");

  switch (provider) {
    case "phantom": {
      const ph = (window as any).phantom?.bitcoin;
      if (!ph) throw new Error("Phantom Bitcoin provider not found");
      // Phantom signPSBT takes Uint8Array and returns Uint8Array
      const signedBytes = await ph.signPSBT(psbtBytes, {
        inputsToSign: inputsToSign?.map(i => ({ signingIndexes: [i] })),
      });
      return Buffer.from(signedBytes).toString("base64");
    }

    case "xverse": {
      const xverse = (window as any).XverseProviders?.BitcoinProvider;
      if (!xverse) throw new Error("Xverse Bitcoin provider not found");
      // Xverse signPsbt takes base64 and returns { psbt: base64 }
      const result = await xverse.request("signPsbt", {
        psbt: psbtBase64,
        message: "Sign HTLC lock transaction for atomic swap",
        broadcast: false,
        inputsToSign: inputsToSign?.map(i => ({
          address: "", // Xverse fills this from the PSBT
          signingIndexes: [i],
        })),
      });
      return result?.result?.psbt ?? psbtBase64;
    }

    case "tap": {
      const tap = (window as any).tracnetwork;
      if (!tap) throw new Error("Tap Wallet provider not found");
      // Tap Wallet signPsbt takes hex and returns signed hex
      const signedHex = await tap.signPsbt(psbtHex);
      return Buffer.from(signedHex, "hex").toString("base64");
    }

    case "metamask": {
      // MetaMask BTC signing via the Bitcoin Snap
      const eth = (window as any).ethereum;
      if (!eth) throw new Error("MetaMask not found");
      // MetaMask Bitcoin Snap ID (official Consensys BTC snap)
      const BITCOIN_SNAP_ID = "npm:@consensys/bitcoin-snap";
      const result = await eth.request({
        method: "wallet_invokeSnap",
        params: {
          snapId: BITCOIN_SNAP_ID,
          request: {
            method: "btc_signPsbt",
            params: {
              psbt: psbtBase64,
              network: "mainnet",
            },
          },
        },
      }) as { signedPsbt: string };
      return result.signedPsbt;
    }

    default:
      throw new Error(`Unsupported Bitcoin wallet provider: ${provider}`);
  }
}

// ─── Broadcast ────────────────────────────────────────────────────────────────

/**
 * Finalize and broadcast a signed PSBT via mempool.space.
 * Returns the txid and explorer URL.
 */
export async function broadcastSignedPsbt(
  signedPsbtBase64: string,
  network: "mainnet" | "testnet" = "mainnet",
): Promise<BroadcastResult> {
  // Finalize the PSBT and extract the raw transaction
  const psbt = bitcoin.Psbt.fromBase64(signedPsbtBase64);

  // Try to finalize all inputs
  psbt.finalizeAllInputs();
  const rawTxHex = psbt.extractTransaction().toHex();

  // Broadcast via mempool.space
  const baseUrl = network === "testnet"
    ? "https://mempool.space/testnet"
    : "https://mempool.space";

  const response = await fetch(`${baseUrl}/api/tx`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: rawTxHex,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Broadcast failed: ${errText}`);
  }

  const txid = await response.text();
  const explorerUrl = `${baseUrl}/tx/${txid}`;

  return { txid, explorerUrl };
}

// ─── CLTV Refund PSBT Builder ─────────────────────────────────────────────────

export interface HtlcRefundParams {
  /** The HTLC witness script (hex) — from the original lock */
  witnessScript: string;
  /** The HTLC P2WSH address that holds the locked funds */
  htlcAddress: string;
  /** The UTXO that holds the locked BTC (the lock tx output) */
  lockTxid: string;
  lockVout: number;
  /** Amount locked in satoshis */
  amountSats: number;
  /** CLTV locktime value used when building the HTLC script */
  locktime: number;
  /** Refund destination address (the original sender) */
  refundAddress: string;
  /** Fee rate in sat/vbyte (default: 5) */
  feeRateSatsPerVbyte?: number;
  network?: "mainnet" | "testnet";
}

/**
 * Build a CLTV-timeout refund PSBT for an HTLC lock output.
 *
 * The HTLC script has the structure:
 *   OP_IF
 *     OP_SHA256 <secretHash> OP_EQUALVERIFY OP_DUP OP_HASH160 <recipientPKH> OP_EQUALVERIFY OP_CHECKSIG
 *   OP_ELSE
 *     <locktime> OP_CHECKLOCKTIMEVERIFY OP_DROP OP_DUP OP_HASH160 <senderPKH> OP_EQUALVERIFY OP_CHECKSIG
 *   OP_ENDIF
 *
 * The refund path uses the ELSE branch: set nSequence=0xFFFFFFFE, nLockTime=locktime,
 * push OP_0 (false) as the branch selector, then the witness script.
 */
export function buildBtcHtlcRefundPsbt(params: HtlcRefundParams): { psbtBase64: string; psbtHex: string } {
  const {
    witnessScript: witnessScriptHex,
    lockTxid,
    lockVout,
    amountSats,
    locktime,
    refundAddress,
    feeRateSatsPerVbyte = 5,
    network = "mainnet",
  } = params;

  const net = network === "testnet" ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
  const witnessScript = hexToBytes(witnessScriptHex);

  const psbt = new bitcoin.Psbt({ network: net });

  // Set nLockTime to the CLTV value so OP_CHECKLOCKTIMEVERIFY passes
  psbt.setLocktime(locktime);

  // Add the HTLC UTXO as input with nSequence < 0xFFFFFFFF (required for CLTV)
  psbt.addInput({
    hash: lockTxid,
    index: lockVout,
    sequence: 0xfffffffe, // CLTV requires sequence < 0xFFFFFFFF
    witnessUtxo: {
      // P2WSH script: OP_0 <sha256(witnessScript)>
      script: bitcoin.payments.p2wsh({ redeem: { output: witnessScript, network: net }, network: net }).output!,
      value: BigInt(amountSats),
    },
    witnessScript,
  });

  // Estimate fee: ~200 vbytes for a P2WSH refund tx
  const estimatedFee = feeRateSatsPerVbyte * 200;
  const refundAmount = amountSats - estimatedFee;
  if (refundAmount < 546) {
    throw new Error(`Refund amount (${refundAmount} sats) is below dust threshold after fee`);
  }

  // Output: refund to sender address
  psbt.addOutput({ address: refundAddress, value: BigInt(refundAmount) });

  return { psbtBase64: psbt.toBase64(), psbtHex: psbt.toHex() };
}

// ─── HTLC Status ─────────────────────────────────────────────────────────────

export interface HtlcStatus {
  confirmed: boolean;
  confirmations: number;
  blockHeight?: number;
  fee?: number;
  status: "pending" | "confirmed" | "spent" | "refunded";
}

/**
 * Poll mempool.space for the status of an HTLC lock transaction.
 */
export async function getHtlcStatus(txid: string, network: "mainnet" | "testnet" = "mainnet"): Promise<HtlcStatus> {
  const baseUrl = network === "testnet"
    ? "https://mempool.space/testnet"
    : "https://mempool.space";

  try {
    const response = await fetch(`${baseUrl}/api/tx/${txid}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const tx = await response.json();

    const confirmed = tx.status?.confirmed ?? false;
    const confirmations = confirmed
      ? Math.max(0, (tx.status?.block_height ?? 0))
      : 0;

    return {
      confirmed,
      confirmations,
      blockHeight: tx.status?.block_height,
      fee: tx.fee,
      status: confirmed ? "confirmed" : "pending",
    };
  } catch (err) {
    console.warn("[HTLC Status] Failed to fetch:", err);
    return { confirmed: false, confirmations: 0, status: "pending" };
  }
}

// ─── Secret Generation ────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random 32-byte secret and its SHA256 hash.
 * The secret is revealed to claim funds; the hash is embedded in the HTLC script.
 */
export function generateHtlcSecret(): { secret: string; secretHash: string } {
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = bytesToHex(secretBytes);
  const secretHash = bytesToHex(sha256(hexToBytes(secret)));
  return { secret, secretHash };
}

/**
 * Verify that a revealed secret matches the expected hash.
 */
export function verifyHtlcSecret(secret: string, expectedHash: string): boolean {
  try {
    const hash = bytesToHex(sha256(hexToBytes(secret)));
    return hash === expectedHash;
  } catch {
    return false;
  }
}

// ─── UTXO Fetching ────────────────────────────────────────────────────────────

/**
 * Fetch UTXOs for a Bitcoin address from mempool.space.
 * Returns UTXOs sorted by value descending (largest first).
 */
export async function fetchUtxos(address: string, network: "mainnet" | "testnet" = "mainnet"): Promise<UtxoInput[]> {
  const baseUrl = network === "testnet"
    ? "https://mempool.space/testnet"
    : "https://mempool.space";

  const response = await fetch(`${baseUrl}/api/address/${address}/utxo`);
  if (!response.ok) throw new Error(`Failed to fetch UTXOs: HTTP ${response.status}`);

  const utxos = await response.json() as Array<{
    txid: string;
    vout: number;
    value: number;
    status: { confirmed: boolean };
  }>;

  // Only use confirmed UTXOs, sorted by value descending
  return utxos
    .filter(u => u.status.confirmed)
    .sort((a, b) => b.value - a.value)
    .map(u => ({
      txid: u.txid,
      vout: u.vout,
      value: u.value,
    }));
}

/**
 * Fetch the witness UTXO script for a P2WPKH or P2WSH address.
 * This is needed to populate the witnessUtxo field in PSBT inputs.
 */
export async function fetchWitnessUtxoScript(
  txid: string,
  vout: number,
  network: "mainnet" | "testnet" = "mainnet",
): Promise<string | null> {
  const baseUrl = network === "testnet"
    ? "https://mempool.space/testnet"
    : "https://mempool.space";

  try {
    const response = await fetch(`${baseUrl}/api/tx/${txid}`);
    if (!response.ok) return null;
    const tx = await response.json();
    return tx.vout?.[vout]?.scriptpubkey ?? null;
  } catch {
    return null;
  }
}

// ─── Full HTLC Lock Flow ──────────────────────────────────────────────────────

export interface HtlcLockFlowResult {
  txid: string;
  htlcAddress: string;
  witnessScript: string;
  secret: string;
  secretHash: string;
  explorerUrl: string;
  amountSats: number;
}

/**
 * Complete HTLC lock flow for the browser:
 * 1. Generate secret + hash
 * 2. Fetch UTXOs from mempool.space
 * 3. Build PSBT
 * 4. Sign with detected wallet
 * 5. Broadcast via mempool.space
 *
 * @param senderAddress Sender's BTC address (from connected wallet)
 * @param recipientPubKey Counterparty's compressed public key (hex)
 * @param senderPubKey Sender's compressed public key (hex)
 * @param amountSats Amount to lock in satoshis
 * @param locktimeHours Hours until HTLC expires (default: 24)
 * @param provider Wallet provider to use for signing
 * @param network Bitcoin network
 */
export async function executeBtcHtlcLock(
  senderAddress: string,
  recipientPubKey: string,
  senderPubKey: string,
  amountSats: number,
  locktimeHours = 24,
  provider: BtcWalletProvider = "unknown",
  network: "mainnet" | "testnet" = "mainnet",
): Promise<HtlcLockFlowResult> {
  // Auto-detect provider if not specified
  const detectedProvider = provider === "unknown" ? detectBtcProvider() : provider;

  // 1. Generate secret
  const { secret, secretHash } = generateHtlcSecret();

  // 2. Fetch UTXOs
  const utxos = await fetchUtxos(senderAddress, network);
  if (!utxos.length) throw new Error("No confirmed UTXOs found for this address");

  // Enrich UTXOs with witness scripts
  const enrichedUtxos = await Promise.all(
    utxos.map(async (utxo) => {
      const script = await fetchWitnessUtxoScript(utxo.txid, utxo.vout, network);
      return { ...utxo, witnessUtxoScript: script ?? undefined };
    })
  );

  // 3. Build PSBT
  const locktime = Math.floor(Date.now() / 1000) + locktimeHours * 3600;
  const htlcParams: HtlcParams = {
    secretHash,
    recipientPubKey,
    senderPubKey,
    locktime,
    amountSats,
    network,
  };

  const { htlcAddress, witnessScript, psbtBase64 } = buildHtlcLockPsbt(
    htlcParams,
    enrichedUtxos,
    senderAddress,
  );

  // 4. Sign with wallet
  const signedPsbt = await signPsbtWithWallet(psbtBase64, detectedProvider);

  // 5. Broadcast
  const { txid, explorerUrl } = await broadcastSignedPsbt(signedPsbt, network);

  return {
    txid,
    htlcAddress,
    witnessScript,
    secret,
    secretHash,
    explorerUrl,
    amountSats,
  };
}
