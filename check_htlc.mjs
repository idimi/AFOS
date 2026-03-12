import { Connection, PublicKey } from '@solana/web3.js';

const RPC = process.env.VITE_SOL_RPC_URL || 'https://api.mainnet-beta.solana.com';
const conn = new Connection(RPC, 'confirmed');

async function main() {
  // Check program
  const programId = new PublicKey('XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW');
  const programInfo = await conn.getAccountInfo(programId);
  console.log('Program deployed:', !!programInfo, 'executable:', programInfo?.executable);
  
  // Check the HTLC escrow account
  const escrow = new PublicKey('45jdLtyQBrbCMz6wpC1kgtuQZxASH3w5LWg6UhbTYTLQ');
  const escrowInfo = await conn.getAccountInfo(escrow);
  console.log('Escrow account exists:', !!escrowInfo);
  if (escrowInfo) {
    console.log('Escrow owner:', escrowInfo.owner.toBase58());
    console.log('Escrow lamports:', escrowInfo.lamports);
    console.log('Escrow data length:', escrowInfo.data.length);
    console.log('Escrow data (hex):', Buffer.from(escrowInfo.data).toString('hex').slice(0, 200));
  }
}
main().catch(console.error);
