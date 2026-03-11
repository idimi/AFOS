import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const conn = await mysql.createConnection({
  uri: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const [rows] = await conn.execute("SELECT rfqId, htlcId, status FROM htlc_secrets LIMIT 10");
console.log("htlc_secrets rows:");
for (const row of rows) {
  console.log(JSON.stringify(row));
}

const [count] = await conn.execute("SELECT COUNT(*) as cnt FROM htlc_secrets");
console.log("Total rows:", count[0].cnt);

await conn.end();
