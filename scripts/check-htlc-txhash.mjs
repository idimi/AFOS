import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute(
  `SELECT id, htlcId, status, htlcAddress, lockTxId, refundTxId, LEFT(secretHash,20) as secretHashPrefix, amountHuman
   FROM htlc_swaps WHERE chain = 'solana' ORDER BY id DESC LIMIT 8`
);
for (const r of rows) {
  console.log(JSON.stringify(r));
}
await conn.end();
