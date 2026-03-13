/**
 * Compare successful SOL lock tx account layout vs failed USDT lock tx account layout
 * to understand what account order the program actually expects.
 */
import { Connection } from '@solana/web3.js';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const RPC = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
const conn = new Connection(RPC, 'confirmed');
const db = await mysql.createConnection(process.env.DATABASE_URL);

// Get all Solana HTLCs with their lock tx IDs
const [rows] = await db.execute(
  `SELECT id, lockTxId, status, htlcAddress, senderAddress, amountHuman
   FROM htlc_swaps WHERE chain = 'solana' AND lockTxId IS NOT NULL AND lockTxId != ''
   ORDER BY id ASC`
);
await db.end();

console.log('=== Solana HTLC Lock Transactions ===\n');

for (const r of rows) {
  console.log(`ID ${r.id} | status: ${r.status} | amount: ${r.amountHuman}`);
  console.log(`  lockTxId: ${r.lockTxId}`);
  
  try {
    const tx = await conn.getTransaction(r.lockTxId, { maxSupportedTransactionVersion: 0 });
    if (!tx) { console.log('  → tx not found\n'); continue; }
    
    const err = tx.meta?.err;
    const logs = tx.meta?.logMessages ?? [];
    const accounts = tx.transaction?.message?.staticAccountKeys?.map(k => k.toBase58()) ?? [];
    
    console.log(`  → result: ${err ? 'FAILED: ' + JSON.stringify(err) : 'SUCCESS'}`);
    console.log(`  → instruction: ${logs.find(l => l.includes('Instruction:')) ?? 'unknown'}`);
    console.log(`  → accounts:`);
    accounts.forEach((a, i) => console.log(`      [${i}] ${a}`));
  } catch (e) {
    console.log(`  → error fetching: ${e.message}`);
  }
  console.log('');
}

// Also decode the failed USDT tx
console.log('=== Failed USDT Lock Tx (5LGvcTeuA48j...) ===');
const failedTx = await conn.getTransaction('5LGvcTeuA48jy1bXToHTJXL9REvaa1z3J9Vcy7Se1cAHBdGrEmfn5FFrRDhP6xap6oTTxWjrh32NJ68Znvhn5TPv', { maxSupportedTransactionVersion: 0 });
if (failedTx) {
  const accounts = failedTx.transaction?.message?.staticAccountKeys?.map(k => k.toBase58()) ?? [];
  console.log('Accounts:');
  accounts.forEach((a, i) => console.log(`  [${i}] ${a}`));
  console.log('Logs:');
  failedTx.meta?.logMessages?.forEach(l => console.log(' ', l));
}
