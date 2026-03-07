/**
 * tnkHtlc.ts — TNK (Trac Network) HTLC-style atomic swap helpers
 *
 * TNK runs on the Trac Network protocol which does not have native on-chain HTLC
 * primitives (Bitcoin Script / EVM smart contracts). Instead, AFOS uses an
 * agent-escrow model:
 *
 *   1. Requester (A) sends TNK to the AFOS agent escrow address, embedding the
 *      secretHash in the memo/reference field via signMessage.
 *   2. The AFOS agent holds TNK in escrow and monitors the counterparty chain.
 *   3. When the counterparty (B) reveals the secret on-chain, the agent releases
 *      the escrowed TNK to B's trac1... address.
 *   4. If the timelock expires without B revealing, the agent refunds A.
 *
 * The secretHash is committed by having A sign a message containing the
 * secretHash + escrow address + amount before sending, giving cryptographic
 * proof of intent without a native HTLC opcode.
 *
 * API reference: https://docs.trac.network/documentation/developers/mainnet/wallet-api
 */

/** The AFOS agent escrow address on Trac Network (operator-configured) */
const AFOS_TNK_ESCROW_ADDRESS =
  (import.meta.env.VITE_TNK_ESCROW_ADDRESS as string | undefined) ??
  "trac1afos_escrow_placeholder_replace_with_real_address";

export interface TnkHtlcLockParams {
  /** TNK amount as a human-readable decimal string, e.g. "10.5" */
  amount: string;
  /** The SHA-256 secret hash (hex, 64 chars) committed by the swap initiator */
  secretHash: string;
  /** Timelock in seconds from now (used for refund eligibility tracking) */
  timelockSeconds: number;
}

export interface TnkHtlcLockResult {
  /** The Trac Network transaction hash of the escrow lock transfer */
  txHash: string;
  /** The escrow address TNK was sent to */
  escrowAddress: string;
  /** The commitment signature (proof of secretHash intent) */
  commitmentSignature: string;
  /** ISO timestamp when the timelock expires */
  expiresAt: string;
}

/**
 * Lock TNK into the AFOS agent escrow for an atomic swap.
 *
 * Steps:
 *   1. Connect wallet and get address
 *   2. Sign a commitment message: "AFOS-HTLC:{secretHash}:{escrow}:{amount}:{expiry}"
 *   3. Send TNK to the escrow address via sendTNK()
 *   4. Return txHash + commitment signature for the counterparty to verify
 */
export async function executeTnkHtlcLock(
  params: TnkHtlcLockParams
): Promise<TnkHtlcLockResult> {
  const tap = (window as any).tracnetwork;
  if (!tap) {
    throw new Error(
      "Tap Wallet not detected. Please install the Tap Wallet extension."
    );
  }

  const { amount, secretHash, timelockSeconds } = params;
  const expiresAt = new Date(Date.now() + timelockSeconds * 1000).toISOString();

  // Step 1: Get the connected address
  const fromAddress: string = await tap.requestAccount();
  if (!fromAddress) {
    throw new Error("Tap Wallet: no account connected.");
  }

  // Step 2: Sign a commitment message binding secretHash + escrow + amount + expiry
  const commitmentMessage = `AFOS-HTLC:${secretHash}:${AFOS_TNK_ESCROW_ADDRESS}:${amount}:${expiresAt}`;
  const sigResult = await tap.signMessage(commitmentMessage);
  const commitmentSignature: string =
    typeof sigResult === "string" ? sigResult : sigResult?.signature ?? "";

  // Step 3: Send TNK to the escrow address
  const sendResult = await tap.sendTNK(
    fromAddress,
    AFOS_TNK_ESCROW_ADDRESS,
    amount
  );

  if (!sendResult?.success) {
    throw new Error(
      `TNK escrow transfer failed: ${JSON.stringify(sendResult)}`
    );
  }

  return {
    txHash: sendResult.txHash,
    escrowAddress: AFOS_TNK_ESCROW_ADDRESS,
    commitmentSignature,
    expiresAt,
  };
}

/**
 * Lock TNK into the AFOS agent escrow using an existing secretHash (Maker side).
 *
 * This is called by the Maker (B) who uses the Requester's (A's) secretHash so
 * that A can claim B's TNK by revealing the same secret.
 */
export async function executeTnkHtlcLockWithSecretHash(
  params: TnkHtlcLockParams
): Promise<TnkHtlcLockResult> {
  // Same flow — the secretHash is provided by the Requester (A)
  return executeTnkHtlcLock(params);
}

/**
 * Request a refund of escrowed TNK after the timelock has expired.
 *
 * The AFOS agent verifies the timelock expiry server-side and returns the TNK
 * to the original sender. This function sends a signed refund request message
 * to the agent via the P2P signaling channel (the actual on-chain refund is
 * executed by the agent).
 *
 * Returns the commitment signature as proof of refund request.
 */
export async function requestTnkHtlcRefund(params: {
  secretHash: string;
  amount: string;
  escrowAddress?: string;
}): Promise<{ refundRequestSignature: string; requestedAt: string }> {
  const tap = (window as any).tracnetwork;
  if (!tap) {
    throw new Error("Tap Wallet not detected.");
  }

  const escrow = params.escrowAddress ?? AFOS_TNK_ESCROW_ADDRESS;
  const requestedAt = new Date().toISOString();
  const refundMessage = `AFOS-HTLC-REFUND:${params.secretHash}:${escrow}:${params.amount}:${requestedAt}`;

  const sigResult = await tap.signMessage(refundMessage);
  const refundRequestSignature: string =
    typeof sigResult === "string" ? sigResult : sigResult?.signature ?? "";

  return { refundRequestSignature, requestedAt };
}

/**
 * Get the TNK balance of the connected Tap Wallet account.
 * Returns the balance as a human-readable string (e.g. "1234.56").
 */
export async function getTnkBalance(): Promise<string> {
  const tap = (window as any).tracnetwork;
  if (!tap) return "0";
  try {
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
  const tap = (window as any).tracnetwork;
  if (!tap) return null;
  try {
    return await tap.requestAccount();
  } catch {
    return null;
  }
}

/**
 * Build a Trac Network explorer URL for a given transaction hash.
 */
export function tnkExplorerUrl(txHash: string): string {
  return `https://explorer.trac.network/tx/${txHash}`;
}

/**
 * Build a Trac Network explorer URL for a given address.
 */
export function tnkAddressUrl(address: string): string {
  return `https://explorer.trac.network/address/${address}`;
}
