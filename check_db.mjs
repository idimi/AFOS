import dotenv from 'dotenv';
dotenv.config();
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute(
  "SELECT rfqId, status, expiresAt, fromChain, fromToken, toToken, lockTxId, initiatorAddress, counterpartyAddress FROM htlc_secrets ORDER BY createdAt DESC LIMIT 5"
);
const now = Date.now();
for (const row of rows) {
  const expiresAt = Number(row.expiresAt);
  console.log({
    rfqId: row.rfqId,
    status: row.status,
    expiresAtDate: new Date(expiresAt).toISOString(),
    expired: expiresAt < now,
    fromToken: row.fromToken,
    toToken: row.toToken,
    lockTxId: row.lockTxId?.slice(0, 20) + '...',
    initiatorAddress: row.initiatorAddress?.slice(0, 12) + '...',
    counterpartyAddress: row.counterpartyAddress?.slice(0, 12),
  });
}
await conn.end();
