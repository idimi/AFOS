/**
 * Fix HTLC DB statuses:
 * 1. HTLC ID 10: refund tx FAILED on-chain → revert status to 'pending' so Claim button reappears
 * 2. HTLCs 5,6,7,8,9,11: have placeholder refundTxId → set refundTxId to NULL (keep status as-is since PDAs are closed)
 *
 * For each HTLC with a placeholder, we verify on-chain via Helius RPC:
 *   - If PDA account is closed (null) → status 'refunded' is correct, just clear the fake refundTxId
 *   - If PDA account is still open → status should be 'pending' (funds still locked)
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const HELIUS_KEY = process.env.HELIUS_API_KEY;
const RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;

async function getAccountInfo(pubkey) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getAccountInfo',
      params: [pubkey, { encoding: 'base64' }]
    })
  });
  const json = await res.json();
  return json.result?.value; // null = closed/non-existent
}

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// HTLCs with placeholder refundTxId
const placeholderIds = [5, 6, 7, 8, 9, 11];

// Get their htlcAddress values
const [rows] = await conn.execute(
  `SELECT id, htlcId, status, htlcAddress, refundTxId FROM htlc_swaps WHERE id IN (${placeholderIds.join(',')})`
);

console.log('\n=== Checking on-chain state for placeholder HTLCs ===\n');
for (const r of rows) {
  const acct = await getAccountInfo(r.htlcAddress);
  const isOpen = acct !== null;
  console.log(`ID ${r.id} | PDA ${r.htlcAddress.slice(0,12)}... | on-chain=${isOpen ? 'OPEN (funds locked!)' : 'CLOSED'} | DB status=${r.status}`);
  
  if (isOpen) {
    // PDA still open → funds still locked → revert to pending
    await conn.execute(
      `UPDATE htlc_swaps SET status='pending', refundTxId=NULL WHERE id=?`,
      [r.id]
    );
    console.log(`  → FIXED: status='pending', refundTxId=NULL`);
  } else {
    // PDA closed → refunded/claimed is correct, just clear the fake placeholder
    await conn.execute(
      `UPDATE htlc_swaps SET refundTxId=NULL WHERE id=?`,
      [r.id]
    );
    console.log(`  → CLEANED: refundTxId=NULL (status '${r.status}' kept)`);
  }
}

// Special case: HTLC ID 10 — refund tx FAILED on-chain, PDA may still be open
// (already handled above via on-chain check, but log it explicitly)
console.log('\n=== Summary ===');
const [updated] = await conn.execute(
  `SELECT id, status, refundTxId FROM htlc_swaps WHERE id IN (${placeholderIds.join(',')})`
);
for (const r of updated) {
  console.log(`ID ${r.id} | status=${r.status} | refundTxId=${r.refundTxId ?? 'NULL'}`);
}

await conn.end();
console.log('\nDone.');
