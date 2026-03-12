/**
 * AFOS Production Readiness Audit — SOL→USDT P2P Swap
 * Checks: wallet balances, HTLC program, DB state, swap flow components
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import mysql from "mysql2/promise";
import * as dotenv from "dotenv";
import { createHash } from "crypto";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

dotenv.config();

const SOL_RPC = process.env.VITE_SOL_RPC_URL || "https://api.mainnet-beta.solana.com";
const USDT_MINT = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
const HTLC_PROGRAM_ID = new PublicKey("XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW");

const conn = new Connection(SOL_RPC, "confirmed");

const results = [];
const pass = (label, detail) => { results.push({ status: "✅ PASS", label, detail }); };
const fail = (label, detail) => { results.push({ status: "❌ FAIL", label, detail }); };
const warn = (label, detail) => { results.push({ status: "⚠️  WARN", label, detail }); };

async function checkWallet(name, envKey, minSol = 0.01) {
  const raw = process.env[envKey];
  if (!raw) { fail(`${name} key`, `${envKey} not set`); return null; }
  try {
    const kp = Keypair.fromSecretKey(bs58.decode(raw));
    const addr = kp.publicKey.toBase58();
    const bal = await conn.getBalance(kp.publicKey);
    const sol = bal / 1e9;
    if (sol < minSol) {
      fail(`${name} balance`, `${addr} has ${sol.toFixed(4)} SOL — needs ≥${minSol} SOL for fees`);
    } else {
      pass(`${name} balance`, `${addr} has ${sol.toFixed(4)} SOL`);
    }
    // Check USDT ATA
    const ata = await getAssociatedTokenAddress(USDT_MINT, kp.publicKey);
    const ataInfo = await conn.getAccountInfo(ata);
    if (ataInfo) {
      pass(`${name} USDT ATA`, `${ata.toBase58()} exists`);
    } else {
      warn(`${name} USDT ATA`, `${ata.toBase58()} does not exist — will be created on first swap (costs ~0.002 SOL)`);
    }
    return kp;
  } catch (e) {
    fail(`${name} key parse`, `${e.message}`);
    return null;
  }
}

async function checkHtlcProgram() {
  try {
    const info = await conn.getAccountInfo(HTLC_PROGRAM_ID);
    if (info && info.executable) {
      pass("HTLC program", `${HTLC_PROGRAM_ID.toBase58()} is deployed and executable`);
    } else {
      fail("HTLC program", `Program not found or not executable`);
    }
  } catch (e) {
    fail("HTLC program", e.message);
  }
}

async function checkDb() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { fail("DB", "DATABASE_URL not set"); return; }
  try {
    const db = await mysql.createConnection(dbUrl);
    // Check for any stuck pending HTLCs
    const [pendingRows] = await db.execute(
      "SELECT id, htlc_id, status, lock_tx_id, sender_address, created_at FROM htlc_swaps WHERE status = 'pending' ORDER BY created_at DESC LIMIT 5"
    );
    if (pendingRows.length === 0) {
      pass("DB pending HTLCs", "No stuck pending HTLCs");
    } else {
      warn("DB pending HTLCs", `${pendingRows.length} pending HTLC(s) — may be in-progress or stuck:\n  ${pendingRows.map(r => `id=${r.id} htlc_id=${r.htlc_id}`).join("\n  ")}`);
    }
    // Check htlc_secrets table has correct schema
    const [secretCount] = await db.execute("SELECT COUNT(*) as cnt FROM htlc_secrets");
    pass("DB htlc_secrets", `Table exists, ${secretCount[0].cnt} secret(s) stored`);
    // Check for any secrets where hash doesn't match (data integrity)
    const [allSecrets] = await db.execute("SELECT secret_hex, secret_hash_hex FROM htlc_secrets WHERE secret_hex IS NOT NULL LIMIT 20");
    let hashMismatches = 0;
    for (const row of allSecrets) {
      if (row.secret_hex && row.secret_hash_hex) {
        const computed = createHash("sha256").update(Buffer.from(row.secret_hex, "hex")).digest("hex");
        if (computed !== row.secret_hash_hex) hashMismatches++;
      }
    }
    if (hashMismatches > 0) {
      fail("DB secret integrity", `${hashMismatches} secret(s) have hash mismatch — preimage won't match on-chain`);
    } else {
      pass("DB secret integrity", `All ${allSecrets.length} checked secrets have correct hashes`);
    }
    await db.end();
  } catch (e) {
    fail("DB", e.message);
  }
}

async function checkOracleEnv() {
  const oracleUrl = process.env.ORACLE_API_URL;
  if (!oracleUrl) { warn("Oracle URL", "ORACLE_API_URL not set — agent cannot broadcast RFQs"); return; }
  pass("Oracle URL", oracleUrl);
  // Try to reach Oracle
  try {
    const res = await fetch(`${oracleUrl}/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      pass("Oracle reachable", `${oracleUrl}/health → ${res.status}`);
    } else {
      warn("Oracle reachable", `${oracleUrl}/health → ${res.status} — may be degraded`);
    }
  } catch (e) {
    warn("Oracle reachable", `Cannot reach ${oracleUrl} — ${e.message}`);
  }
}

async function checkHelius() {
  const key = process.env.HELIUS_API_KEY;
  if (!key) { warn("Helius", "HELIUS_API_KEY not set — webhook events won't work"); return; }
  try {
    const res = await fetch(`https://api.helius.xyz/v0/addresses/So11111111111111111111111111111111111111112/transactions?api-key=${key}&limit=1`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      pass("Helius API", "Key valid, API reachable");
    } else {
      warn("Helius API", `Status ${res.status}`);
    }
  } catch (e) {
    warn("Helius API", e.message);
  }
}

async function checkEnvVars() {
  const required = ["SOL_HTLC_KEY", "SOL_AGENT_KEY", "VITE_SOL_HTLC_ESCROW", "VITE_SOL_RPC_URL", "DATABASE_URL", "JWT_SECRET"];
  for (const v of required) {
    if (process.env[v]) {
      pass(`Env: ${v}`, "set");
    } else {
      fail(`Env: ${v}`, "NOT SET — required for swap");
    }
  }
  const optional = ["HELIUS_API_KEY", "HELIUS_WEBHOOK_SECRET", "ORACLE_API_URL"];
  for (const v of optional) {
    if (process.env[v]) {
      pass(`Env: ${v}`, "set");
    } else {
      warn(`Env: ${v}`, "not set — some features may be limited");
    }
  }
}

async function checkHtlcEscrowAddress() {
  const escrow = process.env.VITE_SOL_HTLC_ESCROW;
  if (!escrow) { fail("HTLC escrow address", "VITE_SOL_HTLC_ESCROW not set"); return; }
  try {
    new PublicKey(escrow);
    pass("HTLC escrow address", `${escrow} is valid Solana pubkey`);
  } catch {
    fail("HTLC escrow address", `${escrow} is not a valid Solana pubkey`);
  }
}

async function main() {
  console.log("\n🔍 AFOS Production Readiness Audit — SOL→USDT P2P Swap\n");
  console.log("=".repeat(60));

  await checkEnvVars();
  await checkHtlcProgram();
  await checkHtlcEscrowAddress();
  await checkWallet("SOL_HTLC_KEY (agent HTLC signer)", "SOL_HTLC_KEY", 0.05);
  await checkWallet("SOL_AGENT_KEY (agent hot wallet)", "SOL_AGENT_KEY", 0.01);
  await checkDb();
  await checkOracleEnv();
  await checkHelius();

  console.log("\n" + "=".repeat(60));
  console.log("AUDIT RESULTS:\n");
  const passes = results.filter(r => r.status.startsWith("✅"));
  const warns = results.filter(r => r.status.startsWith("⚠️"));
  const fails = results.filter(r => r.status.startsWith("❌"));

  for (const r of results) {
    console.log(`${r.status}  ${r.label}`);
    if (!r.status.startsWith("✅")) console.log(`         → ${r.detail}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Summary: ${passes.length} passed, ${warns.length} warnings, ${fails.length} failures`);
  if (fails.length === 0 && warns.length === 0) {
    console.log("\n🚀 PRODUCTION READY — all checks passed!");
  } else if (fails.length === 0) {
    console.log("\n⚠️  MOSTLY READY — warnings should be reviewed before first swap");
  } else {
    console.log("\n❌ NOT READY — fix failures before initiating live swap");
  }
}

main().catch(console.error);
