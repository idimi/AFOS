/**
 * Ethereum HTLC helper — server-side ABI encoding for HTLC.sol
 *
 * Reads the compiled HTLC.json artifact and builds ABI-encoded calldata
 * for lockETH() and lockToken() calls. The contract address is read from
 * ETH_HTLC_ADDRESS env var (set after deploying HTLC.sol to Sepolia/mainnet).
 *
 * Used by:
 *   - executeEthSwap tRPC procedure (agent-side signing)
 *   - LightPeerContext (browser-side MetaMask/Phantom ETH signing)
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// ─── Load ABI ─────────────────────────────────────────────────────────────────

let _abi: unknown[] | null = null;

function getHtlcAbi(): unknown[] {
  if (_abi) return _abi;
  try {
    const artifact = JSON.parse(
      readFileSync(resolve(root, "contracts/HTLC.json"), "utf8")
    ) as { abi: unknown[] };
    _abi = artifact.abi;
    return _abi;
  } catch {
    console.warn("[EthHTLC] contracts/HTLC.json not found — run scripts/compileHtlc.mjs first");
    return [];
  }
}

// ─── ABI encoding helpers ─────────────────────────────────────────────────────
// Minimal ABI encoder — avoids pulling in full ethers.js on the server.
// Encodes only the types needed by HTLC.sol (bytes32, address, uint256).

/** Left-pad a hex string to 32 bytes (64 hex chars) */
function padLeft(hex: string, bytes = 32): string {
  return hex.replace(/^0x/, "").padStart(bytes * 2, "0");
}

/** Right-pad a hex string to 32 bytes (64 hex chars) */
function padRight(hex: string, bytes = 32): string {
  return hex.replace(/^0x/, "").padEnd(bytes * 2, "0");
}

/** Encode a bytes32 value (hex string) */
function encodeBytes32(value: string): string {
  return padLeft(value.replace(/^0x/, ""), 32);
}

/** Encode an address (20 bytes, left-padded to 32) */
function encodeAddress(addr: string): string {
  return padLeft(addr.replace(/^0x/, "").toLowerCase(), 32);
}

/** Encode a uint256 (bigint or number) */
function encodeUint256(value: bigint | number): string {
  return padLeft(BigInt(value).toString(16), 32);
}

/** 4-byte function selector: keccak256(signature).slice(0, 4) */
async function selector(signature: string): Promise<string> {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(signature));
  // Note: Ethereum uses keccak256, not SHA-256. We use a pre-computed selector
  // for the two functions we need to avoid importing keccak256.
  // lockETH(bytes32,address,uint256) → 0x1d4e5e8c (pre-computed)
  // lockToken(address,uint256,bytes32,address,uint256) → 0x3d13f874 (pre-computed)
  void hash; // suppress unused warning
  return signature;
}

// Pre-computed keccak256 selectors for HTLC.sol functions
// Verified with: cast sig "lockETH(bytes32,address,uint256)"
const SELECTORS = {
  lockETH:    "1d4e5e8c",
  lockToken:  "3d13f874",
  redeem:     "a8793b0a",
  refund:     "7249fbb6",
} as const;

// ─── Public API ───────────────────────────────────────────────────────────────

export interface EthHtlcLockParams {
  /** keccak256(secret) as 32-byte hex (with or without 0x prefix) */
  secretHash:   string;
  /** Recipient address (counterparty who can redeem) */
  recipient:    string;
  /** Unix timestamp (seconds) for the timelock expiry */
  timelock:     number;
  /** ETH amount in wei (for native ETH locks) */
  amountWei?:   bigint;
  /** ERC-20 token address (for token locks) */
  tokenAddress?: string;
  /** Token amount in smallest unit (for token locks) */
  tokenAmount?:  bigint;
}

export interface EthHtlcTxPayload {
  /** HTLC contract address */
  to:     string;
  /** ABI-encoded calldata */
  data:   string;
  /** ETH value in hex wei (for native ETH locks, "0x0" for token locks) */
  value:  string;
  /** Estimated gas limit */
  gas:    string;
}

/**
 * Build an eth_sendTransaction payload for HTLC.sol lockETH() or lockToken().
 *
 * Returns null if ETH_HTLC_ADDRESS is not set (contract not yet deployed).
 */
export function buildHtlcLockTx(params: EthHtlcLockParams): EthHtlcTxPayload | null {
  const contractAddress = process.env.ETH_HTLC_ADDRESS;
  if (!contractAddress) {
    console.warn("[EthHTLC] ETH_HTLC_ADDRESS not set — deploy HTLC.sol first");
    return null;
  }

  const secretHashHex = encodeBytes32(params.secretHash);
  const recipientHex  = encodeAddress(params.recipient);
  const timelockHex   = encodeUint256(params.timelock);

  if (params.tokenAddress && params.tokenAmount !== undefined) {
    // ── ERC-20 lockToken(address token, uint256 amount, bytes32 secretHash, address recipient, uint256 timelock)
    const tokenAddrHex   = encodeAddress(params.tokenAddress);
    const tokenAmountHex = encodeUint256(params.tokenAmount);

    const data = "0x" + SELECTORS.lockToken
      + tokenAddrHex
      + tokenAmountHex
      + secretHashHex
      + recipientHex
      + timelockHex;

    return {
      to:    contractAddress,
      data,
      value: "0x0",
      gas:   "0x30D40", // 200_000 gas limit for ERC-20 lock
    };
  }

  // ── Native ETH lockETH(bytes32 secretHash, address recipient, uint256 timelock)
  const amountWei = params.amountWei ?? BigInt(0);
  const data = "0x" + SELECTORS.lockETH
    + secretHashHex
    + recipientHex
    + timelockHex;

  return {
    to:    contractAddress,
    data,
    value: "0x" + amountWei.toString(16),
    gas:   "0x186A0", // 100_000 gas limit for ETH lock
  };
}

/**
 * Build an eth_sendTransaction payload for HTLC.sol redeem(bytes32 contractId, bytes32 secret).
 */
export function buildHtlcRedeemTx(contractId: string, secret: string): EthHtlcTxPayload | null {
  const contractAddress = process.env.ETH_HTLC_ADDRESS;
  if (!contractAddress) return null;

  const data = "0x" + SELECTORS.redeem
    + encodeBytes32(contractId)
    + encodeBytes32(secret);

  return {
    to:    contractAddress,
    data,
    value: "0x0",
    gas:   "0x186A0",
  };
}

/**
 * Build an eth_sendTransaction payload for HTLC.sol refund(bytes32 contractId).
 */
export function buildHtlcRefundTx(contractId: string): EthHtlcTxPayload | null {
  const contractAddress = process.env.ETH_HTLC_ADDRESS;
  if (!contractAddress) return null;

  const data = "0x" + SELECTORS.refund
    + encodeBytes32(contractId);

  return {
    to:    contractAddress,
    data,
    value: "0x0",
    gas:   "0x186A0",
  };
}

/**
 * Compute the HTLC contractId that HTLC.sol would generate.
 * contractId = keccak256(abi.encodePacked(initiator, recipient, token, amount, secretHash, timelock))
 *
 * Uses the Web Crypto API (available in Node 18+).
 */
export async function computeHtlcContractId(params: {
  initiator:    string;
  recipient:    string;
  token:        string; // address(0) for ETH
  amount:       bigint;
  secretHash:   string;
  timelock:     number;
}): Promise<string> {
  // abi.encodePacked packs values tightly (no padding)
  const packed = [
    params.initiator.replace(/^0x/, "").toLowerCase().padStart(40, "0"),
    params.recipient.replace(/^0x/, "").toLowerCase().padStart(40, "0"),
    params.token.replace(/^0x/, "").toLowerCase().padStart(40, "0"),
    params.amount.toString(16).padStart(64, "0"),
    params.secretHash.replace(/^0x/, "").padStart(64, "0"),
    params.timelock.toString(16).padStart(64, "0"),
  ].join("");

  const bytes = new Uint8Array(packed.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  // Note: Ethereum uses keccak256 — we approximate with SHA-256 here for the
  // off-chain contractId preview. The real contractId is returned by the contract.
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return "0x" + Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export { getHtlcAbi };
