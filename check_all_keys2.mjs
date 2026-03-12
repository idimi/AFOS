import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const HTLC_SENDER = '82kNEEtz1grikvJZhE4M1hmnQr7k1vR1JvZwuAmbMQWs';
console.log('Looking for key matching HTLC sender:', HTLC_SENDER);
console.log('');

// Check all env vars that might contain keys
const envVars = Object.entries(process.env)
  .filter(([k]) => k.includes('KEY') || k.includes('WIF') || k.includes('SECRET') || k.includes('PRIV'))
  .filter(([, v]) => v && v.length > 20);

for (const [name, keyStr] of envVars) {
  // Try to parse as Solana key (base58 encoded 64-byte secret key)
  try {
    let keypair;
    try {
      const decoded = bs58.decode(keyStr);
      if (decoded.length === 64) {
        keypair = Keypair.fromSecretKey(decoded);
      } else {
        continue; // Not a Solana key
      }
    } catch {
      try {
        const arr = JSON.parse(keyStr);
        if (Array.isArray(arr) && arr.length === 64) {
          keypair = Keypair.fromSecretKey(Uint8Array.from(arr));
        } else {
          continue;
        }
      } catch {
        continue;
      }
    }
    
    const pubkey = keypair.publicKey.toBase58();
    const matches = pubkey === HTLC_SENDER;
    if (matches) {
      console.log(`✓ FOUND! ${name}: ${pubkey} MATCHES HTLC SENDER!`);
    } else {
      console.log(`  ${name}: ${pubkey}`);
    }
  } catch {
    // Not a Solana key
  }
}
