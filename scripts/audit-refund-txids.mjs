import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute(
  `SELECT id, htlcId, status, htlcAddress, lockTxId, refundTxId, amountHuman, chain
   FROM htlc_swaps ORDER BY id DESC LIMIT 15`
);
console.log('=== All recent HTLCs ===');
for (const r of rows) {
  const isRealRefundTx = r.refundTxId && r.refundTxId.length >= 60 && !r.refundTxId.startsWith('auto-') && !r.refundTxId.startsWith('already-');
  console.log(`ID ${r.id} | ${r.status} | ${r.chain} | refundTxId=${r.refundTxId ?? 'NULL'} | realTx=${isRealRefundTx}`);
}
await conn.end();
