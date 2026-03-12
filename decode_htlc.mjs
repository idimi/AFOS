import { Connection, PublicKey } from '@solana/web3.js';

const RPC = process.env.VITE_SOL_RPC_URL || 'https://api.mainnet-beta.solana.com';
const conn = new Connection(RPC, 'confirmed');

async function main() {
  const escrow = new PublicKey('45jdLtyQBrbCMz6wpC1kgtuQZxASH3w5LWg6UhbTYTLQ');
  const escrowInfo = await conn.getAccountInfo(escrow);
  
  if (!escrowInfo) {
    console.log('Escrow account not found');
    return;
  }
  
  const data = Buffer.from(escrowInfo.data);
  console.log('Total data length:', data.length);
  console.log('Full hex:', data.toString('hex'));
  
  // Anchor account discriminator is first 8 bytes
  console.log('\nDiscriminator (8 bytes):', data.slice(0, 8).toString('hex'));
  
  // Try to decode the HTLC state
  // Based on the program structure, after discriminator:
  // - sender: PublicKey (32 bytes)
  // - recipient: PublicKey (32 bytes)
  // - htlcId: [u8; 32] (32 bytes)
  // - secretHash: [u8; 32] (32 bytes)
  // - timelock: i64 (8 bytes)
  // - amount: u64 (8 bytes)
  // - status: u8 (1 byte)
  // - tokenMint: Option<PublicKey> (1 + 32 bytes)
  
  let offset = 8; // skip discriminator
  
  const sender = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('\nSender:', sender.toBase58());
  
  const recipient = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('Recipient:', recipient.toBase58());
  
  const htlcId = data.slice(offset, offset + 32);
  offset += 32;
  // Remove null padding
  const htlcIdStr = Buffer.from(htlcId).toString('utf8').replace(/\0+$/, '');
  console.log('HTLC ID:', htlcIdStr);
  
  const secretHash = data.slice(offset, offset + 32);
  offset += 32;
  console.log('Secret Hash:', Buffer.from(secretHash).toString('hex'));
  
  const timelock = data.readBigInt64LE(offset);
  offset += 8;
  console.log('Timelock (unix):', timelock.toString(), '=', new Date(Number(timelock) * 1000).toISOString());
  
  const amount = data.readBigUInt64LE(offset);
  offset += 8;
  console.log('Amount (lamports):', amount.toString(), '=', Number(amount) / 1e9, 'SOL');
  
  const status = data[offset];
  offset += 1;
  console.log('Status:', status, '(0=active, 1=claimed, 2=refunded)');
  
  // Check if there's more data (token mint option)
  if (offset < data.length) {
    const hasTokenMint = data[offset];
    offset += 1;
    console.log('Has token mint:', hasTokenMint);
    if (hasTokenMint) {
      const tokenMint = new PublicKey(data.slice(offset, offset + 32));
      console.log('Token mint:', tokenMint.toBase58());
    }
  }
  
  console.log('\nRemaining bytes:', data.length - offset);
  
  // Now check what PDA the refund instruction would derive
  const htlcIdBytes = new Uint8Array(32);
  const htlcIdEncoded = new TextEncoder().encode('htlc_a_rfq_1773205346880_lp-3'.slice(0, 32));
  htlcIdBytes.set(htlcIdEncoded);
  
  const programId = new PublicKey('XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW');
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('htlc'), htlcIdBytes],
    programId
  );
  console.log('\nDerived PDA for htlc_a_rfq_1773205346880_lp-3:', pda.toBase58());
  console.log('Actual escrow address:', escrow.toBase58());
  console.log('PDA matches escrow:', pda.toBase58() === escrow.toBase58());
}
main().catch(console.error);
