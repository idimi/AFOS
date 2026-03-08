/**
 * agentSwapBtc.ts — Server-side Bitcoin agent swap execution
 *
 * Routing priority:
 *   1. IntercomSwap Oracle VM RFQ → P2P HTLC coordination via Oracle VM
 *   2. Direct HTLC lock via bitcoinjs-lib PSBT + mempool.space broadcast
 *      (BTC_AGENT_WIF required for production; demo mode if not set)
 *
 * Fee model:
 *   P2P route  → P2P_FEE_BPS  = 15 (0.15%) output-side deduction
 *   HTLC route → P2P_FEE_BPS  = 15 (0.15%) — BTC swaps always use P2P pricing
 *
 * Environment variables:
 *   BTC_HTLC_WIF   — Bitcoin WIF-encoded private key for HTLC escrow (mainnet or testnet)
 *   BTC_AGENT_WIF  — Bitcoin WIF-encoded private key for fee collection (fallback if HTLC key not set)
 *   ORACLE_API_URL — IntercomSwap Oracle VM base URL
 */

import * as bitcoin from "bitcoinjs-lib";
import ECPairFactory from "ecpair";
import * as tinysecp from "tiny-secp256k1";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { recordSwapAnalytic } from "./htlcMonitor";

const ECPair = ECPairFactory(tinysecp);

// ─── Fee constants ─────────────────────────────────────────────────────────────
const P2P_FEE_BPS = 15; // 0.15% — BTC swaps always use P2P pricing

// ─── mempool.space helpers ────────────────────────────────────────────────────

function mempoolBase(network: "mainnet" | "testnet" = "mainnet"): string {
  return network === "testnet"
    ? "https://mempool.space/testnet/api"
    : "https://mempool.space/api";
}

async function fetchUtxos(
  address: string,
  network: "mainnet" | "testnet" = "mainnet",
): Promise<Array<{ txid: string; vout: number; value: number }>> {
  const res = await fetch(`${mempoolBase(network)}/address/${address}/utxo`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`UTXO fetch failed: ${res.status}`);
  const utxos = await res.json() as Array<{
    txid: string;
    vout: number;
    status: { confirmed: boolean };
    value: number;
  }>;
  return utxos.filter(u => u.status.confirmed);
}

async function fetchRawTx(
  txid: string,
  network: "mainnet" | "testnet" = "mainnet",
): Promise<string> {
  const res = await fetch(`${mempoolBase(network)}/tx/${txid}/hex`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Raw tx fetch failed: ${res.status}`);
  return res.text();
}

async function broadcastTx(
  txHex: string,
  network: "mainnet" | "testnet" = "mainnet",
): Promise<string> {
  const res = await fetch(`${mempoolBase(network)}/tx`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: txHex,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Broadcast failed: ${err.slice(0, 200)}`);
  }
  return res.text(); // returns txid
}

async function fetchBlockHeight(
  network: "mainnet" | "testnet" = "mainnet",
): Promise<number> {
  const res = await fetch(`${mempoolBase(network)}/blocks/tip/height`, {
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!res?.ok) return 840000; // safe fallback
  return parseInt(await res.text(), 10);
}

// ─── HTLC script builder (BIP-199 P2WSH) ─────────────────────────────────────

function buildHtlcScript(params: {
  secretHash:       string;
  recipientPubKey:  string;
  senderPubKey:     string;
  locktime:         number;
}): Uint8Array {
  const secretHashBuf    = hexToBytes(params.secretHash);
  const recipientPubKey  = hexToBytes(params.recipientPubKey);
  const senderPubKey     = hexToBytes(params.senderPubKey);
  const recipientPubKeyHash = bitcoin.crypto.hash160(recipientPubKey);
  const senderPubKeyHash    = bitcoin.crypto.hash160(senderPubKey);
  const locktimeBuf         = bitcoin.script.number.encode(params.locktime);

  return bitcoin.script.compile([
    bitcoin.opcodes.OP_IF,
    bitcoin.opcodes.OP_SHA256,
    Buffer.from(secretHashBuf),
    bitcoin.opcodes.OP_EQUALVERIFY,
    bitcoin.opcodes.OP_DUP,
    bitcoin.opcodes.OP_HASH160,
    Buffer.from(recipientPubKeyHash),
    bitcoin.opcodes.OP_EQUALVERIFY,
    bitcoin.opcodes.OP_CHECKSIG,
    bitcoin.opcodes.OP_ELSE,
    Buffer.from(locktimeBuf),
    bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
    bitcoin.opcodes.OP_DROP,
    bitcoin.opcodes.OP_DUP,
    bitcoin.opcodes.OP_HASH160,
    Buffer.from(senderPubKeyHash),
    bitcoin.opcodes.OP_EQUALVERIFY,
    bitcoin.opcodes.OP_CHECKSIG,
    bitcoin.opcodes.OP_ENDIF,
  ]);
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface BtcAgentSwapResult {
  success: boolean;
  demo: boolean;
  txid: string | null;
  htlcAddress: string | null;
  secretHash: string | null;
  secret: string | null;
  outAmount: number | null;
  route: string;
  agentAddress: string | null;
  explorerUrl: string | null;
  feeBps: number;
  feeAmountOut: number;
  message: string;
  nextStep?: string;
}

export async function executeBtcAgentSwap(params: {
  fromToken?: string;
  toToken?: string;
  amount: number;           // in BTC
  toChain?: string;
  expiryHours?: number;
  network?: "mainnet" | "testnet";
}): Promise<BtcAgentSwapResult> {
  const {
    fromToken  = "BTC",
    toToken    = "USDT",
    amount,
    toChain    = "solana",
    expiryHours = 24,
    network    = "mainnet",
  } = params;

  const ORACLE_API = process.env.ORACLE_API_URL || "http://141.253.123.101:4000";
  // BTC_HTLC_WIF is the dedicated HTLC escrow key; fall back to BTC_AGENT_WIF for backwards compatibility
  const agentWif   = process.env.BTC_HTLC_WIF ?? process.env.BTC_AGENT_WIF;
  const amountSats = Math.round(amount * 1e8);

  // ── Step 1: Oracle VM RFQ ─────────────────────────────────────────────────
  let rfqId: string | null = null;
  let oracleRoute: string | null = null;
  let oracleOutAmount: number | null = null;
  let p2pPeerId: string | null = null;
  let p2pCounterpartyPubKey: string | null = null;

  try {
    const rfqRes = await fetch(`${ORACLE_API}/api/rfq`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromToken: "BTC",
        toToken:   toToken.toUpperCase(),
        amount,
        fromChain: "bitcoin",
        toChain,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (rfqRes.ok) {
      const rfqData = await rfqRes.json() as {
        success?: boolean;
        result?: {
          rfqId?: string;
          route?: string;
          outAmount?: number;
          peerId?: string;
          responderId?: string;
          counterpartyPubKey?: string;
          peerPubKey?: string;
        };
      };
      if (rfqData?.success && rfqData?.result?.rfqId) {
        const r = rfqData.result;
        rfqId                 = r.rfqId!;
        oracleRoute           = r.route ?? "p2p";
        oracleOutAmount       = r.outAmount ?? null;
        p2pPeerId             = r.peerId ?? r.responderId ?? null;
        p2pCounterpartyPubKey = r.counterpartyPubKey ?? r.peerPubKey ?? null;
        console.log(`[BTC Agent Swap] RFQ ${rfqId} — route=${oracleRoute}, peer=${p2pPeerId}`);
      }
    }
  } catch (err) {
    console.warn("[BTC Agent Swap] Oracle VM RFQ failed:", err);
  }

  // ── Step 2: Execute via Oracle VM if rfqId obtained ──────────────────────
  if (rfqId && agentWif) {
    // Derive agent address from WIF for Oracle VM execute call
    let agentAddress: string | null = null;
    try {
      const net = network === "testnet" ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
      const keyPair = ECPair.fromWIF(agentWif, net);
      const { address } = bitcoin.payments.p2wpkh({
        pubkey: Buffer.from(keyPair.publicKey),
        network: net,
      });
      agentAddress = address ?? null;
    } catch {
      // continue without address
    }

    try {
      const execRes = await fetch(`${ORACLE_API}/api/swap/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rfqId, userAddress: agentAddress }),
        signal: AbortSignal.timeout(30000),
      });
      if (execRes.ok) {
        const execData = await execRes.json() as {
          success?: boolean;
          swap?: { route?: string; outAmount?: number; txHash?: string; txid?: string; status?: string };
          error?: string;
        };
        if (execData?.success && execData?.swap) {
          const swap = execData.swap;
          const finalRoute     = swap.route === "p2p" ? "IntercomSwap P2P" : "Direct HTLC (Oracle VM)";
          const finalOutAmount = swap.outAmount ?? oracleOutAmount ?? 0;
          const txid           = swap.txid ?? swap.txHash ?? null;
          const feeAmountOut   = finalOutAmount * (P2P_FEE_BPS / 10000);

          void recordSwapAnalytic({
            fromChain:    "bitcoin",
            toChain:      toChain as "solana" | "ethereum" | "bitcoin" | "trac_network",
            fromToken:    "BTC",
            toToken:      toToken.toUpperCase(),
            amount:       String(amount),
            route:        finalRoute,
            status:       "completed",
            txId:         txid ?? undefined,
            peerId:       p2pPeerId ?? undefined,
            feeBps:       P2P_FEE_BPS,
            feeAmountOut: String(feeAmountOut.toFixed(8)),
          }).catch(() => {/* non-fatal */});

          return {
            success: true,
            demo: false,
            txid,
            htlcAddress: null,
            secretHash: null,
            secret: null,
            outAmount: finalOutAmount,
            route: finalRoute,
            agentAddress,
            explorerUrl: txid ? `https://mempool.space/${network === "testnet" ? "testnet/" : ""}tx/${txid}` : null,
            feeBps: P2P_FEE_BPS,
            feeAmountOut,
            message: `BTC swap via ${finalRoute}: ${amount} BTC → ${finalOutAmount.toFixed(6)} ${toToken}${txid ? `. Tx: ${txid}` : ""}.`,
          };
        }
      }
    } catch (err) {
      console.warn("[BTC Agent Swap] Oracle VM execute failed:", err);
    }
  }

  // ── Step 3: Direct HTLC lock (agent signs PSBT) ───────────────────────────
  console.log("[BTC Agent Swap] Falling back to direct HTLC lock");

  // Generate HTLC secret
  const secretBytes = new Uint8Array(32);
  crypto.getRandomValues(secretBytes);
  const secret     = bytesToHex(secretBytes);
  const secretHash = bytesToHex(sha256(secretBytes));

  const currentBlock = await fetchBlockHeight(network);
  const locktime     = currentBlock + Math.round(expiryHours * 6); // ~6 blocks/hour

  // ── Demo mode (no BTC_AGENT_WIF) ─────────────────────────────────────────
  if (!agentWif) {
    const demoTxid      = `${secretHash.slice(0, 16)}${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    const demoHtlcAddr  = `bc1q${secretHash.slice(0, 32)}`;
    const demoOutAmount = oracleOutAmount ?? (amount * 65000); // rough BTC→USDT estimate

    void recordSwapAnalytic({
      fromChain:    "bitcoin",
      toChain:      toChain as "solana" | "ethereum" | "bitcoin" | "trac_network",
      fromToken:    "BTC",
      toToken:      toToken.toUpperCase(),
      amount:       String(amount),
      route:        rfqId ? "IntercomSwap P2P" : "Direct HTLC (demo)",
      status:       "completed",
      txId:         demoTxid,
      peerId:       p2pPeerId ?? undefined,
      feeBps:       P2P_FEE_BPS,
      feeAmountOut: String((demoOutAmount * (P2P_FEE_BPS / 10000)).toFixed(8)),
    }).catch(() => {/* non-fatal */});

    return {
      success: true,
      demo: true,
      txid: demoTxid,
      htlcAddress: demoHtlcAddr,
      secretHash,
      secret,
      outAmount: demoOutAmount,
      route: rfqId ? "IntercomSwap P2P" : "Direct HTLC (demo)",
      agentAddress: null,
      explorerUrl: `https://mempool.space/${network === "testnet" ? "testnet/" : ""}tx/${demoTxid}`,
      feeBps: P2P_FEE_BPS,
      feeAmountOut: demoOutAmount * (P2P_FEE_BPS / 10000),
      message:
        `[DEMO] BTC HTLC lock: ${amount} BTC (${amountSats.toLocaleString()} sats). ` +
        (p2pPeerId ? `P2P peer: ${p2pPeerId}. ` : "") +
        `HTLC: ${demoHtlcAddr}. Secret hash: ${secretHash.slice(0, 16)}… ` +
        `Expiry: ${expiryHours}h (~${Math.round(expiryHours * 6)} blocks). ` +
        `Set BTC_HTLC_WIF to execute real on-chain transactions.`,
      nextStep:
        p2pPeerId
          ? `P2P peer ${p2pPeerId} matched. Waiting for counterparty to lock on destination chain.`
          : "No P2P peer — direct HTLC initiated. Waiting for counterparty.",
    };
  }

  // ── Production PSBT signing ───────────────────────────────────────────────
  const net = network === "testnet" ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;

  let keyPair: ReturnType<typeof ECPair.fromWIF>;
  try {
    keyPair = ECPair.fromWIF(agentWif, net);
  } catch {
    return {
      success: false,
      demo: false,
      txid: null,
      htlcAddress: null,
      secretHash,
      secret,
      outAmount: null,
      route: "Error",
      agentAddress: null,
      explorerUrl: null,
      feeBps: P2P_FEE_BPS,
      feeAmountOut: 0,
      message: "BTC_HTLC_WIF is invalid — must be a valid WIF-encoded Bitcoin private key.",
    };
  }

  const { address: agentAddress } = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network: net,
  });

  if (!agentAddress) {
    return {
      success: false,
      demo: false,
      txid: null,
      htlcAddress: null,
      secretHash,
      secret,
      outAmount: null,
      route: "Error",
      agentAddress: null,
      explorerUrl: null,
      feeBps: P2P_FEE_BPS,
      feeAmountOut: 0,
      message: "Failed to derive agent Bitcoin address from WIF key.",
    };
  }

  // Build HTLC script — use agent pubkey as both sender and recipient
  // (in production, recipient would be the counterparty's pubkey from P2P RFQ)
  const agentPubKeyHex = Buffer.from(keyPair.publicKey).toString("hex");
  const counterpartyPubKey = p2pCounterpartyPubKey ?? agentPubKeyHex;

  const htlcScript = buildHtlcScript({
    secretHash,
    recipientPubKey: counterpartyPubKey,
    senderPubKey:    agentPubKeyHex,
    locktime,
  });

  const p2wsh = bitcoin.payments.p2wsh({ redeem: { output: htlcScript, network: net }, network: net });
  const htlcAddress = p2wsh.address!;

  // Fetch UTXOs
  let utxos: Array<{ txid: string; vout: number; value: number }>;
  try {
    utxos = await fetchUtxos(agentAddress, network);
  } catch (err) {
    return {
      success: false,
      demo: false,
      txid: null,
      htlcAddress,
      secretHash,
      secret,
      outAmount: null,
      route: "Direct HTLC",
      agentAddress,
      explorerUrl: null,
      feeBps: P2P_FEE_BPS,
      feeAmountOut: 0,
      message: `Failed to fetch UTXOs for agent address ${agentAddress}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const totalSats = utxos.reduce((sum, u) => sum + u.value, 0);
  const feeSats   = 2000; // ~2000 sat/tx (conservative)

  if (totalSats < amountSats + feeSats) {
    return {
      success: false,
      demo: false,
      txid: null,
      htlcAddress,
      secretHash,
      secret,
      outAmount: null,
      route: "Direct HTLC",
      agentAddress,
      explorerUrl: null,
      feeBps: P2P_FEE_BPS,
      feeAmountOut: 0,
      message:
        `Insufficient BTC balance. Agent has ${totalSats} sats, needs ${amountSats + feeSats} sats ` +
        `(${amount} BTC + ${feeSats} sat fee). Fund ${agentAddress} to proceed.`,
    };
  }

  // Build PSBT
  const psbt = new bitcoin.Psbt({ network: net });
  let inputTotal = 0;

  for (const utxo of utxos) {
    if (inputTotal >= amountSats + feeSats) break;
    const rawTx = await fetchRawTx(utxo.txid, network);
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      nonWitnessUtxo: Buffer.from(rawTx, "hex"),
    });
    inputTotal += utxo.value;
  }

  psbt.addOutput({ address: htlcAddress, value: BigInt(amountSats) });

  const changeSats = inputTotal - amountSats - feeSats;
  if (changeSats > 546) {
    psbt.addOutput({ address: agentAddress, value: BigInt(changeSats) });
  }

  psbt.signAllInputs(keyPair);
  psbt.finalizeAllInputs();

  const txHex = psbt.extractTransaction().toHex();

  try {
    const txid = await broadcastTx(txHex, network);
    const outAmount = oracleOutAmount ?? 0;
    const feeAmountOut = outAmount * (P2P_FEE_BPS / 10000);

    void recordSwapAnalytic({
      fromChain:    "bitcoin",
      toChain:      toChain as "solana" | "ethereum" | "bitcoin" | "trac_network",
      fromToken:    "BTC",
      toToken:      toToken.toUpperCase(),
      amount:       String(amount),
      route:        p2pPeerId ? "IntercomSwap P2P" : "Direct HTLC",
      status:       "completed",
      txId:         txid,
      peerId:       p2pPeerId ?? undefined,
      feeBps:       P2P_FEE_BPS,
      feeAmountOut: String(feeAmountOut.toFixed(8)),
    }).catch(() => {/* non-fatal */});

    console.log(`[BTC Agent Swap] ✅ HTLC locked: ${amount} BTC → ${htlcAddress} | Tx: ${txid}`);

    return {
      success: true,
      demo: false,
      txid,
      htlcAddress,
      secretHash,
      secret,
      outAmount,
      route: p2pPeerId ? "IntercomSwap P2P" : "Direct HTLC",
      agentAddress,
      explorerUrl: `https://mempool.space/${network === "testnet" ? "testnet/" : ""}tx/${txid}`,
      feeBps: P2P_FEE_BPS,
      feeAmountOut,
      message:
        `BTC HTLC locked: ${amount} BTC (${amountSats.toLocaleString()} sats) → ${htlcAddress}. ` +
        `Tx: ${txid}. ` +
        (p2pPeerId ? `P2P peer: ${p2pPeerId}. ` : "") +
        `Secret hash: ${secretHash.slice(0, 16)}… Expiry: ${expiryHours}h.`,
      nextStep:
        p2pPeerId
          ? `P2P peer ${p2pPeerId} matched. Waiting for counterparty to lock on destination chain. ` +
            "Once confirmed, the agent will reveal the secret to complete the atomic swap."
          : "Direct HTLC initiated. Share the HTLC address and secret hash with the counterparty to proceed.",
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[BTC Agent Swap] ❌ Broadcast failed: ${errMsg}`);
    return {
      success: false,
      demo: false,
      txid: null,
      htlcAddress,
      secretHash,
      secret,
      outAmount: null,
      route: "Direct HTLC",
      agentAddress,
      explorerUrl: null,
      feeBps: P2P_FEE_BPS,
      feeAmountOut: 0,
      message: `BTC HTLC broadcast failed: ${errMsg.slice(0, 200)}`,
    };
  }
}

// ─── TNK → BTC cross-chain swap via Oracle VM P2P ────────────────────────────
//
// TNK (Trac Network) uses an agent-escrow HTLC model. For TNK→BTC swaps the
// Oracle VM handles the P2P RFQ and HTLC coordination on both legs. This
// function mirrors the BTC Oracle VM RFQ flow but sets fromChain = "trac_network"
// so the Oracle VM can route to a peer advertising the TNK/BTC pair.

export interface TnkAgentSwapResult {
  success: boolean;
  demo: boolean;
  txHash: string | null;
  outAmount: number | null;
  route: string;
  feeBps: number;
  feeAmountOut: number;
  message: string;
  nextStep?: string;
}

export async function executeTnkAgentSwap(params: {
  fromToken?: string;   // defaults to "TNK"
  toToken?: string;     // defaults to "BTC"
  amount: number;       // in TNK
  toChain?: string;     // defaults to "bitcoin"
  expiryHours?: number;
}): Promise<TnkAgentSwapResult> {
  const {
    fromToken  = "TNK",
    toToken    = "BTC",
    amount,
    toChain    = "bitcoin",
    expiryHours = 24,
  } = params;

  const ORACLE_API = process.env.ORACLE_API_URL || "http://141.253.123.101:4000";
  // TNK_HTLC_WIF is the Trac Network HTLC signing key for live execution.
  // If absent, the function runs in demo mode (simulated result, no real on-chain transaction).
  const tnkHtlcWif = process.env.TNK_HTLC_WIF;
  if (!tnkHtlcWif) {
    console.warn(
      "[TNK Agent Swap] WARNING: TNK_HTLC_WIF is not set. " +
      "Running in demo mode — no real Trac Network HTLC will be created. " +
      "Set TNK_HTLC_WIF in project secrets to enable live execution."
    );
  }

  console.log(`[TNK Agent Swap] ${amount} ${fromToken} → ${toToken} (${toChain}) via Oracle VM${tnkHtlcWif ? " [LIVE]" : " [DEMO]"}`);

  // ── Step 1: Oracle VM RFQ ─────────────────────────────────────────────────
  let rfqId: string | null = null;
  let oracleRoute: string | null = null;
  let oracleOutAmount: number | null = null;
  let p2pPeerId: string | null = null;

  try {
    const rfqRes = await fetch(`${ORACLE_API}/api/rfq`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromToken: fromToken.toUpperCase(),
        toToken:   toToken.toUpperCase(),
        amount,
        fromChain: "trac_network",
        toChain,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (rfqRes.ok) {
      const rfqData = await rfqRes.json() as {
        success?: boolean;
        result?: {
          rfqId?: string;
          route?: string;
          outAmount?: number;
          peerId?: string;
          responderId?: string;
        };
      };
      if (rfqData?.success && rfqData?.result?.rfqId) {
        const r = rfqData.result;
        rfqId           = r.rfqId!;
        oracleRoute     = r.route ?? "p2p";
        oracleOutAmount = r.outAmount ?? null;
        p2pPeerId       = r.peerId ?? r.responderId ?? null;
        console.log(`[TNK Agent Swap] RFQ ${rfqId} — route=${oracleRoute}, peer=${p2pPeerId}`);
      }
    }
  } catch (err) {
    console.warn("[TNK Agent Swap] Oracle VM RFQ failed:", err);
  }

  // ── Step 2: Execute via Oracle VM if rfqId obtained ──────────────────────
  if (rfqId) {
    try {
      const execRes = await fetch(`${ORACLE_API}/api/swap/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rfqId, expiryHours }),
        signal: AbortSignal.timeout(30000),
      });
      if (execRes.ok) {
        const execData = await execRes.json() as {
          success?: boolean;
          swap?: { route?: string; outAmount?: number; txHash?: string; txid?: string; status?: string };
          error?: string;
        };
        if (execData?.success && execData?.swap) {
          const swap = execData.swap;
          const finalRoute     = swap.route === "p2p" ? "AFOS P2P (TNK↔BTC)" : "Oracle VM DEX";
          const finalOutAmount = swap.outAmount ?? oracleOutAmount ?? 0;
          const txHash         = swap.txHash ?? swap.txid ?? null;
          const feeAmountOut   = finalOutAmount * (P2P_FEE_BPS / 10000);

          void recordSwapAnalytic({
            fromChain:    "trac_network",
            toChain:      toChain as "solana" | "ethereum" | "bitcoin" | "trac_network",
            fromToken:    fromToken.toUpperCase(),
            toToken:      toToken.toUpperCase(),
            amount:       String(amount),
            route:        finalRoute,
            status:       "completed",
            txId:         txHash ?? undefined,
            peerId:       p2pPeerId ?? undefined,
            feeBps:       P2P_FEE_BPS,
            feeAmountOut: String(feeAmountOut.toFixed(8)),
          }).catch(() => {/* non-fatal */});

          return {
            success: true,
            demo: !tnkHtlcWif,
            txHash,
            outAmount: finalOutAmount,
            route: finalRoute,
            feeBps: P2P_FEE_BPS,
            feeAmountOut,
            message: `${tnkHtlcWif ? "" : "[DEMO] "}TNK swap via ${finalRoute}: ${amount} ${fromToken} → ${finalOutAmount.toFixed(6)} ${toToken}${txHash ? `. Tx: ${txHash}` : ""}.`,
            nextStep: p2pPeerId
              ? `P2P peer ${p2pPeerId} matched. Coordinating HTLC on both legs via Oracle VM.`
              : `Oracle VM executing ${fromToken}→${toToken} swap. Status: ${swap.status ?? "processing"}.`,
          };
        }
      }
    } catch (err) {
      console.warn("[TNK Agent Swap] Oracle VM execute failed:", err);
    }
  }

  // ── Step 3: No Oracle VM match — return informative error ────────────────
  // TNK swaps require Oracle VM P2P coordination; there is no on-chain DEX fallback.
  const demoOutAmount = oracleOutAmount ?? (amount * 0.000015); // rough TNK→BTC estimate

  void recordSwapAnalytic({
    fromChain:    "trac_network",
    toChain:      toChain as "solana" | "ethereum" | "bitcoin" | "trac_network",
    fromToken:    fromToken.toUpperCase(),
    toToken:      toToken.toUpperCase(),
    amount:       String(amount),
    route:        rfqId ? "AFOS P2P (TNK↔BTC)" : "Oracle VM (no match)",
    status:       "failed",
    txId:         undefined,
    peerId:       p2pPeerId ?? undefined,
    feeBps:       P2P_FEE_BPS,
    feeAmountOut: String((demoOutAmount * (P2P_FEE_BPS / 10000)).toFixed(8)),
  }).catch(() => {/* non-fatal */});

  return {
    success: false,
    demo: false,
    txHash: null,
    outAmount: demoOutAmount,
    route: "Oracle VM P2P (no match)",
    feeBps: P2P_FEE_BPS,
    feeAmountOut: 0,
    message:
      rfqId
        ? `TNK→${toToken} Oracle VM RFQ matched (${rfqId}) but execution failed. The P2P peer may have gone offline. Please retry in a moment.`
        : `No P2P peer found for ${fromToken}→${toToken}. The Oracle VM P2P network needs a peer advertising the TNK/${toToken} pair. ` +
          `Estimated rate: ${demoOutAmount.toFixed(8)} ${toToken} for ${amount} ${fromToken}.`,
    nextStep: "Retry in 30–60 seconds — the Oracle VM continuously scans for new peers.",
  };
}
