import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const HTLC_SENDER = '82kNEEtz1grikvJZhE4M1hmnQr7k1vR1JvZwuAmbMQWs';
console.log('Looking for key matching HTLC sender:', HTLC_SENDER);
console.log('');

const keys = {
  SOL_HTLC_KEY: process.env.SOL_HTLC_KEY,
  SOL_AGENT_KEY: process.env.SOL_AGENT_KEY,
  BTC_HTLC_WIF: process.env.BTC_HTLC_WIF,
  BTC_AGENT_WIF: process.env.BTC_AGENT_WIF,
};

for (const [name, keyStr] of Object.entries(keys)) {
  if (!keyStr) {
    console.log(`${name}: NOT SET`);
    continue;
  }
  
  // Try to parse as Solana key
  try {
    let keypair;
    try {
      const decoded = bs58.decode(keyStr);
      if (decoded.length === 64) {
        keypair = Keypair.fromSecretKey(decoded);
      } else {
        console.log(`${name}: base58 decoded but wrong length (${decoded.length}), skipping`);
        continue;
      }
    } catch {
      try {
        const arr = JSON.parse(keyStr);
        keypair = Keypair.fromSecretKey(Uint8Array.from(arr));
      } catch {
        console.log(`${name}: not a valid Solana key format`);
        continue;
      }
    }
    
    const pubkey = keypair.publicKey.toBase58();
    const matches = pubkey === HTLC_SENDER;
    console.log(`${name}: ${pubkey} ${matches ? '✓ MATCHES HTLC SENDER!' : ''}`);
  } catch (e) {
    console.log(`${name}: error parsing - ${e.message}`);
  }
}
