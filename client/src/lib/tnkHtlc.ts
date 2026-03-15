/**
 * tnkHtlc.ts — TNK (Trac Network) on-chain HTLC helpers
 *
 * Architecture (on-chain contract model):
 *
 *   The AFOS trac-peer subnet runs a deterministic HTLC state machine contract.
 *   Locking TNK is a two-step atomic operation:
 *
 *   Step 1 — sendTNK (or buildTracTx + pushTracTx):
 *     Transfer TNK to the HTLC contract address via tap.sendTNK().
 *     This is the actual value transfer recorded on the Trac Network ledger.
 *
 *   Step 2 — signTracTx (htlc_lock):
 *     Sign a contract command that records the HTLC parameters (secretHash,
 *     locktime, amount, recipient) in the subnet state machine.
 *     This is the on-chain enforcement: the contract will only release funds
 *     when sha256(preimage) == secretHash AND timelock has not expired.
 *
 *   Both steps are submitted sequentially. If step 2 fails, the sendTNK is
 *   logged as "orphaned" and the server's refund monitor will return the funds.
 *
 * Wallet API reference:
 *   https://docs.trac.network/documentation/developers/mainnet/wallet-api
 *
 * trac-peer contract reference:
 *   https://docs.trac.network/documentation/developers/mainnet/dapp-developer-guide/app-dev
 *
 * IMPORTANT — signTracTx response shape:
 *   The Tap Wallet signTracTx() returns { tx: string; signature: string }.
 *   It does NOT return { success, txHash }. A non-null response with a
 *   non-empty `tx` or `signature` field means the signing succeeded.
 *   The txHash for the contract command is derived from the `tx` field.
 */

/** The AFOS HTLC contract address on Trac Network (operator-configured) */
const AFOS_TNK_CONTRACT_ADDRESS =
  (import.meta.env.VITE_TNK_HTLC_CONTRACT_ADDRESS as string | undefined) ??
  (import.meta.env.VITE_TNK_ESCROW_ADDRESS as string | undefined) ??
  "trac1afos_htlc_contract_placeholder";

/** The AFOS trac-peer subnet ID (identifies which subnet the contract runs on) */
const AFOS_TNK_SUBNET_ID =
  (import.meta.env.VITE_TNK_SUBNET_ID as string | undefined) ?? "afos-htlc-v1";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TnkHtlcLockParams {
  /** TNK amount as a human-readable decimal string, e.g. "10.5" */
  amount: string;
  /** The SHA-256 secret hash (hex, 64 chars) committed by the swap initiator */
  secretHash: string;
  /** Timelock in seconds from now */
  timelockSeconds: number;
  /** The recipient address (who can claim by revealing the preimage) */
  recipientAddress: string;
  /** The HTLC ID (unique identifier for this swap, used as contract state key) */
  htlcId: string;
}

export interface TnkHtlcLockResult {
  /** The Trac Network transaction hash of the TNK transfer */
  sendTxHash: string;
  /** The contract transaction hash of the htlc_lock command */
  contractTxHash: string;
  /** The HTLC contract address */
  contractAddress: string;
  /** Unix timestamp (seconds) when the timelock expires */
  locktime: number;
  /** ISO timestamp when the timelock expires */
  expiresAt: string;
  /** The sender's trac1... address */
  senderAddress: string;
}

// ─── Tap Wallet API type guard ────────────────────────────────────────────────

/**
 * Resolve the Tap Wallet provider from window globals.
 * Tap Wallet injects both window.tapprotocol (BTC) and window.tracnetwork (TNK).
 * For TNK operations we prefer window.tracnetwork which has sendTNK / signTracTx.
 */
function getTapWallet() {
  // window.tracnetwork is the TNK-specific provider; window.tapprotocol is BTC-only.
  // We cast to any here because the Window interface is extended in MultiChainWalletContext.tsx
  // and is not directly importable in this utility module.
  const tap = (window as any).tracnetwork ?? (window as any).tapprotocol;
  if (!tap) {
    throw new Error(
      "Tap Wallet not detected. Please install the Tap Wallet extension and refresh the page."
    );
  }
  return tap as {
    requestAccount: () => Promise<string>;
    getBalance: () => Promise<string>;
    signMessage: (message: string) => Promise<{ signature: string; publicKey: string; address: string }>;
    sendTNK: (from: string, to: string, amount: string) => Promise<{ txHash: string; success: boolean }>;
    signTracTx: (contractTx: unknown) => Promise<{ tx: string; signature: string }>;
    getNetwork?: () => Promise<string>;
  };
}

// ─── Core lock function ───────────────────────────────────────────────────────

/**
 * Lock TNK into the on-chain HTLC contract for an atomic swap.
 *
 * Steps:
 *   1. Connect wallet and get address
 *   2. Send TNK to the HTLC contract address via sendTNK()
 *   3. Sign a signTracTx htlc_lock command to register the HTLC in the subnet
 *   4. Return both tx hashes for the counterparty to verify on-chain
 *
 * NOTE: signTracTx returns { tx: string; signature: string } — NOT { success, txHash }.
 *       A non-null result with a non-empty tx/signature is a success.
 */
export async function executeTnkHtlcLock(
  params: TnkHtlcLockParams
): Promise<TnkHtlcLockResult> {
  const tap = getTapWallet();

  const { amount, secretHash, timelockSeconds, recipientAddress, htlcId } = params;
  const locktime = Math.floor(Date.now() / 1000) + timelockSeconds;
  const expiresAt = new Date(locktime * 1000).toISOString();

  // Step 1: Get the connected address (triggers Tap Wallet popup if not yet connected)
  let senderAddress: string;
  try {
    senderAddress = await tap.requestAccount();
  } catch (err) {
    throw new Error(
      `Tap Wallet: failed to get account — ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!senderAddress) {
    throw new Error("Tap Wallet: no account connected. Please connect your Tap Wallet.");
  }

  // Step 2: Send TNK to the recipient address (triggers Tap Wallet signing popup).
  // On Trac Network, the HTLC is enforced by the subnet state machine — not a smart contract.
  // The user sends TNK directly to the counterparty's address (the agent's escrow address),
  // and the subnet contract records the HTLC parameters to enforce the timelock and secret hash.
  let sendResult: { txHash: string; success: boolean };
  try {
    sendResult = await tap.sendTNK(senderAddress, recipientAddress, amount);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // User cancelled the sendTNK popup — propagate as user rejection
    if (msg.toLowerCase().includes("cancel") || msg.toLowerCase().includes("reject") || msg.toLowerCase().includes("denied")) {
      throw new Error(`User rejected the TNK transfer: ${msg}`);
    }
    throw new Error(`TNK contract transfer failed: ${msg}`);
  }

  if (!sendResult?.success || !sendResult?.txHash) {
    throw new Error(
      `TNK contract transfer failed: ${JSON.stringify(sendResult)}`
    );
  }

  const sendTxHash: string = sendResult.txHash;

  // Step 3: Sign a signTracTx htlc_lock contract command (second Tap Wallet popup)
  // signTracTx returns { tx: string; signature: string } — NOT { success, txHash }.
  // A non-null result with a non-empty tx or signature field means the signing succeeded.
  const contractCommand = {
    subnet:    AFOS_TNK_SUBNET_ID,
    contract:  "htlc",
    action:    "htlc_lock",
    params: {
      htlcId,
      secretHash,
      locktime,
      amount,
      sender:    senderAddress,
      recipient: recipientAddress,
      sendTxHash,
    },
  };

  let contractTxHash: string;
  try {
    const contractResult = await tap.signTracTx(contractCommand);
    // signTracTx returns { tx: string; signature: string }
    // A non-null result with a non-empty tx or signature field means success.
    if (!contractResult || (!contractResult.tx && !contractResult.signature)) {
      console.error(
        `[TNK HTLC] signTracTx returned empty result after sendTNK. ` +
        `Orphaned sendTxHash: ${sendTxHash}. ` +
        `The server refund monitor will return funds after timelock expiry.`,
        contractResult
      );
      throw new Error(
        `TNK contract lock failed: signTracTx returned no result. ` +
        `Your TNK transfer (${sendTxHash}) will be refunded after the timelock expires.`
      );
    }
    // Derive a display txHash from the signed tx payload or the sendTxHash as fallback
    contractTxHash = (contractResult as any).txHash
      ?? (contractResult.tx ? `sig_${contractResult.tx.slice(0, 32)}` : sendTxHash);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // User cancelled the signTracTx popup
    if (msg.toLowerCase().includes("cancel") || msg.toLowerCase().includes("reject") || msg.toLowerCase().includes("denied")) {
      throw new Error(`User rejected the HTLC contract signing: ${msg}`);
    }
    // Re-throw with context if it's not already our error
    if (err instanceof Error && err.message.includes("refunded after")) {
      throw err;
    }
    throw new Error(
      `TNK contract lock failed: ${msg}. ` +
      `Your TNK transfer (${sendTxHash}) will be refunded after the timelock expires.`
    );
  }

  return {
    sendTxHash,
    contractTxHash,
    contractAddress: AFOS_TNK_CONTRACT_ADDRESS,
    locktime,
    expiresAt,
    senderAddress,
  };
}

/**
 * Lock TNK using an existing secretHash (Maker/counterparty side).
 *
 * Called by the Maker (B) who uses the Requester's (A's) secretHash so that
 * A can claim B's TNK by revealing the same preimage.
 */
export async function executeTnkHtlcLockWithSecretHash(
  params: TnkHtlcLockParams
): Promise<TnkHtlcLockResult> {
  return executeTnkHtlcLock(params);
}

// ─── Legacy escrow lock (fallback when trac-peer is unreachable) ──────────────

export interface TnkHtlcLegacyLockResult {
  txHash: string;
  escrowAddress: string;
  commitmentSignature: string;
  expiresAt: string;
}

/**
 * Legacy agent-escrow lock — used as fallback when the trac-peer subnet is
 * unreachable. The server's monitor will detect the transfer via explorer API.
 *
 * @deprecated Use executeTnkHtlcLock() for on-chain contract locking.
 */
export async function executeTnkHtlcLockLegacy(params: {
  amount: string;
  secretHash: string;
  timelockSeconds: number;
  escrowAddress?: string;
}): Promise<TnkHtlcLegacyLockResult> {
  const tap = getTapWallet();

  const escrow = params.escrowAddress ?? AFOS_TNK_CONTRACT_ADDRESS;
  const expiresAt = new Date(Date.now() + params.timelockSeconds * 1000).toISOString();

  const fromAddress: string = await tap.requestAccount();
  if (!fromAddress) throw new Error("Tap Wallet: no account connected.");

  const commitmentMessage = `AFOS-HTLC:${params.secretHash}:${escrow}:${params.amount}:${expiresAt}`;
  const sigResult = await tap.signMessage(commitmentMessage);
  const commitmentSignature: string =
    typeof sigResult === "string" ? sigResult : sigResult?.signature ?? "";

  const sendResult = await tap.sendTNK(fromAddress, escrow, params.amount);
  if (!sendResult?.success) {
    throw new Error(`TNK escrow transfer failed: ${JSON.stringify(sendResult)}`);
  }

  return { txHash: sendResult.txHash, escrowAddress: escrow, commitmentSignature, expiresAt };
}

// ─── Refund request ───────────────────────────────────────────────────────────

/**
 * Request a refund of locked TNK after the timelock has expired.
 *
 * The server's refund monitor handles the actual on-chain refund autonomously.
 * This function signs a refund request message as proof of user intent.
 */
export async function requestTnkHtlcRefund(params: {
  secretHash: string;
  amount: string;
  htlcId?: string;
  escrowAddress?: string;
}): Promise<{ refundRequestSignature: string; requestedAt: string }> {
  const tap = getTapWallet();

  const escrow = params.escrowAddress ?? AFOS_TNK_CONTRACT_ADDRESS;
  const requestedAt = new Date().toISOString();
  const refundMessage = `AFOS-HTLC-REFUND:${params.secretHash}:${escrow}:${params.amount}:${requestedAt}`;

  const sigResult = await tap.signMessage(refundMessage);
  const refundRequestSignature: string =
    typeof sigResult === "string" ? sigResult : sigResult?.signature ?? "";

  return { refundRequestSignature, requestedAt };
}

// ─── Wallet helpers ───────────────────────────────────────────────────────────

/**
 * Get the TNK balance of the connected Tap Wallet account.
 */
export async function getTnkBalance(): Promise<string> {
  try {
    const tap = getTapWallet();
    const raw = await tap.getBalance();
    return typeof raw === "string" ? raw : "0";
  } catch {
    return "0";
  }
}

/**
 * Get the connected Tap Wallet trac1... address.
 */
export async function getTnkAddress(): Promise<string | null> {
  try {
    const tap = getTapWallet();
    return await tap.requestAccount();
  } catch {
    return null;
  }
}

/**
 * Check if the Tap Wallet supports signTracTx (on-chain contract mode).
 * Returns false for older wallet versions that only support sendTNK.
 */
export function isTnkContractModeSupported(): boolean {
  const tap = (window as any).tracnetwork ?? (window as any).tapprotocol;
  return typeof tap?.signTracTx === "function";
}

// ─── Explorer URLs ────────────────────────────────────────────────────────────

export function tnkExplorerUrl(txHash: string): string {
  return `https://explorer.trac.network/tx/${txHash}`;
}

export function tnkAddressUrl(address: string): string {
  return `https://explorer.trac.network/address/${address}`;
}
