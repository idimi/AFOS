/**
 * tnkOnChainTransfer.ts — Real TNK on-chain transfer via trac-crypto-api + tracapi.trac.network
 *
 * This module implements the real TNK transfer on the Trac Network mainnet.
 * It replaces the stub `/v1/agent/send` endpoint that previously returned fake txHashes.
 *
 * Architecture:
 *   1. GET https://tracapi.trac.network/v1/txv         → current indexer sequence state
 *   2. tracCrypto.transaction.preBuild(from, to, amountHex, txv) → unsigned tx data
 *   3. tracCrypto.transaction.build(txData, secretKey) → base64-encoded signed payload
 *   4. POST https://tracapi.trac.network/v1/broadcast-transaction → broadcast to MSB network
 *
 * Environment variables:
 *   TNK_HTLC_WIF   — 64-byte hex (128 chars): seed[32] + pubkey[32], the escrow wallet key
 *   TNK_TRAC_API   — optional override for tracapi base URL (default: https://tracapi.trac.network)
 *
 * Amount encoding:
 *   TNK uses 18 decimal places (like ETH). 1 TNK = 1_000_000_000_000_000_000 raw units.
 *   The amount field in the payload is a hex string of a 16-byte big-endian integer.
 */

// @ts-expect-error — trac-crypto-api is a CommonJS module without TS types
import tracCrypto from "trac-crypto-api";

const TRAC_API = process.env.TNK_TRAC_API ?? "https://tracapi.trac.network";
const TNK_UNIT = BigInt("1000000000000000000"); // 10^18 — 1 TNK in raw units

// ─── Amount helpers ───────────────────────────────────────────────────────────

/**
 * Convert a human-readable TNK amount string (e.g. "2") to raw bigint units.
 * Supports up to 18 decimal places.
 */
export function tnkToRaw(amount: string): bigint {
  const [intPart, fracPart = ""] = amount.split(".");
  const fracPadded = fracPart.padEnd(18, "0").slice(0, 18);
  return BigInt(intPart) * TNK_UNIT + BigInt(fracPadded);
}

/**
 * Convert raw bigint units to a human-readable TNK string.
 */
export function rawToTnk(raw: bigint): string {
  const whole = raw / TNK_UNIT;
  const frac = raw % TNK_UNIT;
  if (frac === BigInt(0)) return whole.toString();
  return `${whole}.${frac.toString().padStart(18, "0").replace(/0+$/, "")}`;
}

/**
 * Convert raw bigint to the 16-byte big-endian hex string expected by trac-crypto-api.
 */
function rawToAmountHex(raw: bigint): string {
  // 16 bytes = 32 hex chars, big-endian
  return raw.toString(16).padStart(32, "0");
}

// ─── Core transfer ────────────────────────────────────────────────────────────

export interface TnkTransferResult {
  ok: boolean;
  txHash?: string;
  error?: string;
}

/**
 * Broadcast a real TNK transfer on the Trac Network mainnet.
 *
 * @param from     — sender trac1 address (must match TNK_HTLC_WIF)
 * @param to       — recipient trac1 address
 * @param rawAmount — amount in raw units (bigint), e.g. 2_000_000_000_000_000_000n for 2 TNK
 */
export async function broadcastTnkTransfer(
  from: string,
  to: string,
  rawAmount: bigint,
): Promise<TnkTransferResult> {
  const wifHex = process.env.TNK_HTLC_WIF ?? "";
  if (!wifHex || wifHex.length !== 128) {
    return { ok: false, error: `TNK_HTLC_WIF not set or invalid length (got ${wifHex.length}, expected 128)` };
  }

  const secretKey = Buffer.from(wifHex, "hex");

  // Verify the key matches the expected sender address
  const { address: derivedAddress } = tracCrypto.address.fromSecretKey("trac", secretKey);
  if (derivedAddress !== from) {
    return {
      ok: false,
      error: `TNK_HTLC_WIF derives address ${derivedAddress} but expected ${from}`,
    };
  }

  // Step 1: Get current indexer sequence state (txv)
  let txv: string;
  try {
    const txvRes = await fetch(`${TRAC_API}/v1/txv`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!txvRes.ok) throw new Error(`txv HTTP ${txvRes.status}`);
    const txvData = (await txvRes.json()) as { txv: string };
    txv = txvData.txv;
    if (!txv || txv.length !== 64) throw new Error(`Invalid txv: ${txv}`);
  } catch (err) {
    return { ok: false, error: `Failed to fetch txv: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Step 2: Build unsigned transaction
  const amountHex = rawToAmountHex(rawAmount);
  let txData: {
    hash: Buffer;
    from: string;
    to: string;
    amount: string;
    validity: string;
    nonce: Buffer;
    networkId: number;
  };
  try {
    txData = await tracCrypto.transaction.preBuild(from, to, amountHex, txv);
  } catch (err) {
    return { ok: false, error: `preBuild failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Step 3: Sign and encode the transaction
  let payload: string;
  try {
    payload = tracCrypto.transaction.build(txData, secretKey);
  } catch (err) {
    return { ok: false, error: `build failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Step 4: Broadcast to the Trac Network
  try {
    const broadcastRes = await fetch(`${TRAC_API}/v1/broadcast-transaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload }),
      signal: AbortSignal.timeout(20_000),
    });

    const responseText = await broadcastRes.text();
    let responseJson: Record<string, unknown> = {};
    try { responseJson = JSON.parse(responseText); } catch { /* ignore */ }

    if (!broadcastRes.ok) {
      return {
        ok: false,
        error: `broadcast HTTP ${broadcastRes.status}: ${responseText.slice(0, 300)}`,
      };
    }

    // Extract txHash from response
    const txHash = (responseJson.result as { tx?: string })?.tx
      ?? txData.hash.toString("hex");

    console.log(`[TNK Transfer] Broadcast success: ${from.slice(0, 20)}… → ${to.slice(0, 20)}… amount=${rawToTnk(rawAmount)} TNK txHash=${txHash.slice(0, 16)}…`);
    return { ok: true, txHash };
  } catch (err) {
    return { ok: false, error: `broadcast failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Convenience wrapper: transfer TNK using a human-readable amount string.
 * e.g. transferTnk(from, to, "2") sends 2 TNK
 */
export async function transferTnk(
  from: string,
  to: string,
  amount: string,
): Promise<TnkTransferResult> {
  const raw = tnkToRaw(amount);
  return broadcastTnkTransfer(from, to, raw);
}

/**
 * Get the TNK balance of an address (in raw units as string).
 */
export async function getTnkOnChainBalance(address: string): Promise<bigint | null> {
  try {
    const res = await fetch(`${TRAC_API}/v1/balance/${address}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { balance?: string };
    return data.balance ? BigInt(data.balance) : null;
  } catch {
    return null;
  }
}
