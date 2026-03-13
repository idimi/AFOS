/**
 * Final DB reconciliation based on verified on-chain status bytes:
 *
 * ID 5 (5ze9TQPF): on-chain status=1 (REFUNDED), DB says 'pending' → fix to 'refunded'
 * ID 6 (4gKNVtZ4): on-chain status=0 (ACTIVE),   DB says 'refunded' → fix to 'pending' (CLAIMABLE)
 * ID 8 (8WkkEjom): on-chain status=1 (REFUNDED), DB says 'pending' → fix to 'refunded'
 *
 * Also fix the earlier script bug: getAccountInfo returning non-null ≠ HTLC is active.
 * Must read the status byte at offset 185 to know true state.
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Fix IDs 5 and 8: on-chain status=1 (REFUNDED) but DB says 'pending'
await conn.execute(
  `UPDATE htlc_swaps SET status='refunded' WHERE id IN (5, 8) AND status='pending'`
);
console.log('Fixed IDs 5, 8: status → refunded (on-chain status byte = 1)');

// Fix ID 6: on-chain status=0 (ACTIVE) but DB says 'refunded'
await conn.execute(
  `UPDATE htlc_swaps SET status='pending' WHERE id = 6 AND status='refunded'`
);
console.log('Fixed ID 6: status → pending (on-chain status byte = 0, 0.01 SOL still locked)');

// Verify final state
const [rows] = await conn.execute(
  `SELECT id, status, htlcAddress, amountHuman FROM htlc_swaps WHERE id IN (5, 6, 8)`
);
console.log('\nFinal DB state:');
for (const r of rows) {
  console.log(`  ID ${r.id} | ${r.status} | ${r.htlcAddress.slice(0,12)}... | ${r.amountHuman} SOL`);
}

await conn.end();
console.log('\nDone.');
