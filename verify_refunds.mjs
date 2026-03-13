import { createConnection } from "mysql2/promise";
import { Connection, PublicKey } from "@solana/web3.js";
import * as dotenv from "dotenv";
dotenv.config();

const db = await createConnection(process.env.DATABASE_URL);
const conn = new Connection("http://localhost:3000/api/sol-rpc", "confirmed");

// Get all HTLCs marked as refunded
const [rows] = await db.execute(
  `SELECT id, rfqId, htlcId, htlcAddress, lockTxId, refundTxId, status, senderAddress, amountHuman
   FROM htlc_swaps
   WHERE chain = 'solana' AND status = 'refunded'
   ORDER BY id DESC
   LIMIT 20`
);

console.log(`\nChecking ${rows.length} refunded Solana HTLCs on-chain:\n`);

for (const row of rows) {
  const htlcAddr = row.htlcAddress;
  const lockTx = row.lockTxId;
  
  if (!htlcAddr || htlcAddr === "undefined") {
    console.log(`[ID ${row.id}] ${row.htlcId?.slice(0, 30)} — NO htlcAddress in DB`);
    continue;
  }

  try {
    const pubkey = new PublicKey(htlcAddr);
    const info = await conn.getAccountInfo(pubkey);
    const lamports = info?.lamports ?? 0;
    const exists = info !== null;
    
    // Check the lock tx to see how much was locked
    let lockedLamports = 0;
    if (lockTx && lockTx !== "undefined" && lockTx.length > 40) {
      try {
        const txResp = await fetch("http://localhost:3000/api/sol-rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0", id: 1,
            method: "getTransaction",
            params: [lockTx, { encoding: "json", maxSupportedTransactionVersion: 0 }]
          })
        });
        const txData = await txResp.json();
        const meta = txData?.result?.meta;
        if (meta && !meta.err) {
          const pre = meta.preBalances || [];
          const post = meta.postBalances || [];
          // Account[1] is typically the HTLC PDA
          if (pre[1] !== undefined && post[1] !== undefined) {
            lockedLamports = post[1] - pre[1];
          }
        }
      } catch (e) {
        // ignore tx fetch errors
      }
    }
    
    // Read the on-chain HTLC status byte
    let onChainStatus = "unknown";
    let onChainAmount = 0;
    if (exists && info.data && info.data.length >= 153) {
      const statusByte = info.data[152];
      onChainStatus = statusByte === 0 ? "active" : statusByte === 1 ? "refunded" : statusByte === 2 ? "claimed" : `unknown(${statusByte})`;
      // Read amount from bytes 144-152
      const buf = Buffer.from(info.data);
      onChainAmount = Number(buf.readBigUInt64LE(144));
    }
    
    // Determine if funds were actually returned
    // If PDA is closed (null) or status byte is 1/2 (refunded/claimed) → funds are gone from escrow
    // If PDA exists with status=0 (active) and amount > 0 → funds still locked!
    const fundsStillLocked = exists && onChainStatus === "active" && onChainAmount > 0;
    
    const verdict = fundsStillLocked 
      ? "⚠️  FUNDS STILL LOCKED — incorrectly marked as refunded!"
      : exists 
        ? `✅ Funds withdrawn (PDA exists, status=${onChainStatus}, remaining=${lamports} lamports rent)`
        : "✅ PDA closed — fully refunded/claimed";
    
    console.log(`[ID ${row.id}] ${htlcAddr.slice(0, 8)}... | DB: ${row.status} | refundTx: ${row.refundTxId?.slice(0, 25)}`);
    console.log(`  On-chain: ${exists ? `EXISTS (${lamports} lam, status=${onChainStatus}, amount=${onChainAmount})` : "CLOSED"}`);
    console.log(`  ${verdict}\n`);
    
  } catch (e) {
    console.log(`[ID ${row.id}] ${htlcAddr?.slice(0, 8)}... ERROR: ${e.message}\n`);
  }
}

await db.end();
