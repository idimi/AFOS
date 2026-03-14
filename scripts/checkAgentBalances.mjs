/**
 * Quick script to check agent wallet balances for live-swap readiness.
 * Run: node scripts/checkAgentBalances.mjs
 */
import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { createRequire } from "module";
import { readFileSync } from "fs";
import { config } from "dotenv";

// Load .env if present
try { config({ path: ".env" }); } catch {}

// ── Solana agent balance ──────────────────────────────────────────────────────
const require = createRequire(import.meta.url);
let bs58;
try { bs58 = require("bs58"); } catch { bs58 = null; }

const solKeyStr = process.env.SOL_HTLC_KEY ?? process.env.SOL_AGENT_KEY ?? "";
const rpcUrl    = process.env.VITE_SOL_RPC_URL ?? "https://api.mainnet-beta.solana.com";

if (!solKeyStr) {
  console.log("SOL_HTLC_KEY / SOL_AGENT_KEY: NOT SET");
} else {
  let kp = null;
  if (bs58) {
    try { kp = Keypair.fromSecretKey(bs58.default.decode(solKeyStr)); } catch {}
  }
  if (!kp) {
    try { kp = Keypair.fromSecretKey(Buffer.from(solKeyStr, "hex")); } catch {}
  }
  if (!kp) {
    try { kp = Keypair.fromSecretKey(new Uint8Array(JSON.parse(solKeyStr))); } catch {}
  }

  if (kp) {
    const conn = new Connection(rpcUrl, "confirmed");
    try {
      const lamports = await conn.getBalance(kp.publicKey);
      console.log("Agent Solana pubkey :", kp.publicKey.toBase58());
      console.log("Agent SOL balance   :", (lamports / LAMPORTS_PER_SOL).toFixed(6), "SOL");

      // Check USDT balance
      const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
      const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
      const tokenAccounts = await conn.getParsedTokenAccountsByOwner(kp.publicKey, { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") });
      for (const ta of tokenAccounts.value) {
        const info = ta.account.data.parsed?.info;
        const mint = info?.mint;
        const amount = info?.tokenAmount?.uiAmount ?? 0;
        if (mint === USDT_MINT) console.log("Agent USDT balance  :", amount, "USDT");
        if (mint === USDC_MINT) console.log("Agent USDC balance  :", amount, "USDC");
      }
    } catch (e) {
      console.log("Solana RPC error:", e.message);
    }
  } else {
    console.log("Could not parse SOL key (tried base58, hex, JSON array)");
  }
}

// ── TNK agent balance (via trac-peer) ────────────────────────────────────────
const tnkEscrow = process.env.TNK_ESCROW_ADDRESS ?? "";
const tnkRpc    = process.env.TNK_PEER_RPC_URL ?? "http://localhost:5001";

if (!tnkEscrow) {
  console.log("TNK_ESCROW_ADDRESS  : NOT SET");
} else {
  console.log("Agent TNK address   :", tnkEscrow);
  try {
    const resp = await fetch(`${tnkRpc}/v1/state?key=balance/${tnkEscrow}`, { signal: AbortSignal.timeout(8000) });
    const data = await resp.json();
    console.log("Agent TNK balance   :", data?.value ?? "(not found)", "TNK (raw)");
  } catch (e) {
    console.log("TNK RPC error:", e.message);
    // Try alternative balance endpoint
    try {
      const resp2 = await fetch(`${tnkRpc}/v1/balance/${tnkEscrow}`, { signal: AbortSignal.timeout(8000) });
      const data2 = await resp2.json();
      console.log("Agent TNK balance   :", data2 ?? "(not found)", "TNK (alt endpoint)");
    } catch {}
  }
}

// ── TNK HTLC contract address ─────────────────────────────────────────────────
console.log("TNK HTLC contract   :", process.env.TNK_HTLC_CONTRACT_ADDRESS ?? "NOT SET");
console.log("TNK peer RPC        :", tnkRpc);
console.log("Solana RPC          :", rpcUrl);
console.log("Helius API key      :", process.env.HELIUS_API_KEY ? "SET" : "NOT SET");
