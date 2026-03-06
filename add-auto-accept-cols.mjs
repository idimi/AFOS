import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);
try {
  await conn.execute('ALTER TABLE user_settings ADD COLUMN autoAcceptRfq INT NOT NULL DEFAULT 0');
  console.log('✓ Added autoAcceptRfq');
} catch(e) { console.log('autoAcceptRfq:', e.message); }
try {
  await conn.execute('ALTER TABLE user_settings ADD COLUMN autoAcceptMaxUsd INT NOT NULL DEFAULT 0');
  console.log('✓ Added autoAcceptMaxUsd');
} catch(e) { console.log('autoAcceptMaxUsd:', e.message); }
await conn.end();
console.log('Done');
