import { createConnection } from "mysql2/promise";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const conn = await createConnection(dbUrl);
const [rows] = await conn.query(
  "SELECT id, htlcAddress, htlcId, status, lockTxId, toToken, chain FROM htlc_swaps WHERE status = 'pending' ORDER BY createdAt DESC LIMIT 6"
);
for (const r of rows) {
  console.log(JSON.stringify(r));
}
await conn.end();
