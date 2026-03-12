import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const TARGET = '82kNEEtz1grikvJZhE4M1hmnQr7k1vR1JvZwuAmbMQWs';

const candidates = [
  ['SOL_AGENT_KEY', process.env.SOL_AGENT_KEY],
  ['SOL_HTLC_KEY', process.env.SOL_HTLC_KEY],
  ['TNK_AGENT_KEY', process.env.TNK_AGENT_KEY],
  ['TNK_HTLC_WIF', process.env.TNK_HTLC_WIF],
  ['JWT_SECRET', process.env.JWT_SECRET],
  ['HELIUS_WEBHOOK_SECRET', process.env.HELIUS_WEBHOOK_SECRET],
  ['BTC_AGENT_WIF', process.env.BTC_AGENT_WIF],
  ['BTC_HTLC_WIF', process.env.BTC_HTLC_WIF],
];

for (const [name, val] of candidates) {
  if (!val) { console.log(name + ': not set'); continue; }
  try {
    let kp;
    if (val.startsWith('[')) {
      kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(val)));
    } else {
      try {
        kp = Keypair.fromSecretKey(bs58.decode(val));
      } catch {
        try {
          kp = Keypair.fromSecretKey(Buffer.from(val.replace('0x',''), 'hex'));
        } catch { console.log(name + ': not a valid Solana key'); continue; }
      }
    }
    const addr = kp.publicKey.toBase58();
    const match = addr === TARGET ? ' *** MATCH! ***' : '';
    console.log(name + ': ' + addr + match);
  } catch(e) {
    console.log(name + ': error - ' + e.message);
  }
}
console.log('\nTarget:', TARGET);
