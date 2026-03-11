import { Connection, PublicKey } from '@solana/web3.js';

const AFOS_HTLC_PROGRAM_ID = new PublicKey('XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW');
const conn = new Connection(process.env.VITE_SOL_RPC_URL || 'https://solana-rpc.publicnode.com', 'confirmed');

console.log('RPC URL:', process.env.VITE_SOL_RPC_URL || 'https://solana-rpc.publicnode.com');
console.log('Program ID:', AFOS_HTLC_PROGRAM_ID.toBase58());

try {
  const accounts = await conn.getProgramAccounts(AFOS_HTLC_PROGRAM_ID, {
    filters: [{ dataSize: 219 }],
  });
  console.log('Found', accounts.length, 'program accounts with dataSize=219');

  for (const { pubkey, account } of accounts) {
    const data = Buffer.from(account.data);
    let offset = 8;
    const htlcId = data.slice(offset, offset + 32).toString('utf8').replace(/\0/g, '');
    offset += 32;
    const sender = new PublicKey(data.slice(offset, offset + 32)).toBase58();
    offset += 32;
    const recipient = new PublicKey(data.slice(offset, offset + 32)).toBase58();
    offset += 32 + 32; // skip secretHash
    const timelock = Number(data.readBigInt64LE(offset));
    offset += 8;
    const amountLamports = Number(data.readBigUInt64LE(offset));
    offset += 8 + 32; // skip tokenMint
    const claimed = data[offset] !== 0;
    const refunded = data[offset + 1] !== 0;
    console.log({
      pda: pubkey.toBase58(),
      htlcId,
      sender,
      claimed,
      refunded,
      amountSOL: amountLamports / 1e9,
      timelock: new Date(timelock * 1000).toISOString(),
    });
  }
} catch (err) {
  console.error('Error:', err.message);
}
