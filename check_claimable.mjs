import { createConnection } from "mysql2/promise";
import { Connection, PublicKey } from "@solana/web3.js";
import * as dotenv from "dotenv";
dotenv.config();

const db = await createConnection(process.env.DATABASE_URL);
const conn = new Connection("http://localhost:3000/api/sol-rpc", "confirmed");

// Get all pending Solana HTLCs
const [rows] = await db.execute(
  `SELECT id, rfqId, htlcId, htlcAddress, lockTxId, status, createdAt, locktime
   FROM htlc_swaps
   WHERE chain = 'solana' AND status IN ('pending', 'locked')
   ORDER BY createdAt DESC
   LIMIT 10`
);

console.log("Pending/locked Solana HTLCs:", rows.length);

for (const row of rows) {
  const htlcAddr = row.htlcAddress;
  if (!htlcAddr || htlcAddr === "undefined") {
    console.log(`\n[${row.htlcId}] htlcAddress is missing/undefined — cannot check on-chain`);
    continue;
  }
  
  try {
    const pubkey = new PublicKey(htlcAddr);
    const info = await conn.getAccountInfo(pubkey);
    const exists = info !== null;
    const lamports = info?.lamports ?? 0;
    const locktimeMs = row.locktime ? Number(row.locktime) * 1000 : null;
    const now = Date.now();
    const expired = locktimeMs ? now > locktimeMs : null;
    
    console.log(`\n[${row.htlcId}]`);
    console.log(`  DB status: ${row.status}`);
    console.log(`  htlcAddress: ${htlcAddr}`);
    console.log(`  lockTxId: ${row.lockTxId}`);
    console.log(`  On-chain: ${exists ? `EXISTS (${lamports} lamports = ${(lamports/1e9).toFixed(6)} SOL)` : "CLOSED/NOT FOUND"}`);
    console.log(`  locktime: ${locktimeMs ? new Date(locktimeMs).toISOString() : "null"} | expired: ${expired}`);
    
    if (!exists) {
      console.log(`  → PDA is CLOSED — already refunded/claimed on-chain`);
    } else if (!expired) {
      console.log(`  → PDA is ACTIVE but timelock NOT yet expired — cannot refund yet`);
    } else {
      console.log(`  → PDA is ACTIVE and timelock EXPIRED — refund should work`);
    }
  } catch (e) {
    console.log(`\n[${row.htlcId}] Error checking on-chain:`, e.message);
  }
}

await db.end();
