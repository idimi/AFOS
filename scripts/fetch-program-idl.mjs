import { Connection, PublicKey } from '@solana/web3.js';
import zlib from 'zlib';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const RPC = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
const conn = new Connection(RPC, 'confirmed');
const PROGRAM_ID = new PublicKey('XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW');

// Anchor IDL is stored at: findProgramAddress(['anchor:idl', programId], programId)
const [idlAddress] = PublicKey.findProgramAddressSync(
  [Buffer.from('anchor:idl'), PROGRAM_ID.toBuffer()],
  PROGRAM_ID
);
console.log('IDL address:', idlAddress.toBase58());
const idlAccount = await conn.getAccountInfo(idlAddress);
if (!idlAccount) {
  console.log('No IDL account found on-chain');
  process.exit(1);
}

const data = idlAccount.data;
console.log('IDL account data length:', data.length);
// Skip 8 (discriminator) + 32 (authority) = 40, then 4 bytes for compressed data length
const compressedLen = data.readUInt32LE(40);
console.log('Compressed IDL length:', compressedLen);
const compressed = data.slice(44, 44 + compressedLen);
const decompressed = zlib.inflateSync(compressed);
const idl = JSON.parse(decompressed.toString());

console.log('\n=== Program:', idl.name, '===');
console.log('Instructions:', idl.instructions?.map(i => i.name).join(', '));

for (const ix of (idl.instructions ?? [])) {
  console.log(`\n--- ${ix.name} ---`);
  (ix.accounts ?? []).forEach((a, i) => {
    console.log(`  [${i}] ${a.name.padEnd(20)} writable=${String(a.isMut ?? a.writable ?? false).padEnd(5)} signer=${a.isSigner ?? a.signer ?? false}`);
  });
}
