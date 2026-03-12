import { createConnection } from 'mysql2/promise';

const conn = await createConnection(process.env.DATABASE_URL);

// Get the HTLC record
const [rows] = await conn.execute(
  `SELECT id, htlc_address, htlc_id, secret_hash, secret_preimage, status, sender_address, recipient_address, chain, amount, token_symbol, created_at 
   FROM htlc_swaps 
   WHERE htlc_address = '45jdLtyQBrbCMz6wpC1kgtuQZxASH3w5LWg6UhbTYTLQ'
   OR htlc_id LIKE '%rfq_1773205346880%'
   LIMIT 5`
);

console.log('HTLC records found:', rows.length);
for (const row of rows) {
  console.log('\n--- HTLC Record ---');
  console.log('ID:', row.id);
  console.log('htlc_address:', row.htlc_address);
  console.log('htlc_id:', row.htlc_id);
  console.log('secret_hash:', row.secret_hash);
  console.log('secret_preimage:', row.secret_preimage ? row.secret_preimage.slice(0, 20) + '...' : 'NULL');
  console.log('status:', row.status);
  console.log('sender_address:', row.sender_address);
  console.log('recipient_address:', row.recipient_address);
  console.log('chain:', row.chain);
  console.log('amount:', row.amount);
  console.log('token_symbol:', row.token_symbol);
}

// Also check the rfq_swaps table
const [rfqRows] = await conn.execute(
  `SELECT id, rfq_id, status, sol_htlc_id, sol_htlc_address, sol_preimage, sol_secret_hash, sol_recipient, created_at
   FROM rfq_swaps 
   WHERE rfq_id LIKE '%1773205346880%'
   LIMIT 5`
);

console.log('\n\nRFQ records found:', rfqRows.length);
for (const row of rfqRows) {
  console.log('\n--- RFQ Record ---');
  console.log('ID:', row.id);
  console.log('rfq_id:', row.rfq_id);
  console.log('status:', row.status);
  console.log('sol_htlc_id:', row.sol_htlc_id);
  console.log('sol_htlc_address:', row.sol_htlc_address);
  console.log('sol_preimage:', row.sol_preimage ? row.sol_preimage.slice(0, 20) + '...' : 'NULL');
  console.log('sol_secret_hash:', row.sol_secret_hash);
  console.log('sol_recipient:', row.sol_recipient);
}

await conn.end();
