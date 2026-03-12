import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const RPC = process.env.VITE_SOL_RPC_URL || 'https://api.mainnet-beta.solana.com';
const conn = new Connection(RPC, 'confirmed');

// Get agent keypair
const keyStr = process.env.SOL_HTLC_KEY ?? process.env.SOL_AGENT_KEY;
if (!keyStr) {
  console.log('No SOL_HTLC_KEY or SOL_AGENT_KEY set');
  process.exit(1);
}

let agentKeypair;
try {
  const decoded = bs58.decode(keyStr);
  agentKeypair = Keypair.fromSecretKey(decoded);
} catch {
  const arr = JSON.parse(keyStr);
  agentKeypair = Keypair.fromSecretKey(Uint8Array.from(arr));
}

console.log('Agent pubkey:', agentKeypair.publicKey.toBase58());

const balance = await conn.getBalance(agentKeypair.publicKey);
console.log('Agent balance:', balance, 'lamports =', balance / 1e9, 'SOL');

if (balance < 5000) {
  console.log('WARNING: Agent wallet has insufficient SOL for transaction fees!');
  console.log('Need at least 0.000005 SOL (5000 lamports) for fees.');
} else {
  console.log('Agent wallet has sufficient SOL for transaction fees.');
}
