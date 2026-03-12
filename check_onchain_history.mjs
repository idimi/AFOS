/**
 * Check on-chain transaction history for the HTLC PDA.
 * If the counterparty LP called claim, the preimage would be in the tx data.
 */
import { Connection, PublicKey } from '@solana/web3.js';

const RPC = process.env.VITE_SOL_RPC_URL || 'https://api.mainnet-beta.solana.com';
const conn = new Connection(RPC, 'confirmed');

const HTLC_ADDRESS = '45jdLtyQBrbCMz6wpC1kgtuQZxASH3w5LWg6UhbTYTLQ';
const htlcPubkey = new PublicKey(HTLC_ADDRESS);

console.log('Fetching transaction history for HTLC PDA:', HTLC_ADDRESS);

// Get all signatures for this account
const signatures = await conn.getSignaturesForAddress(htlcPubkey, { limit: 20 });
console.log('Found', signatures.length, 'transactions');

for (const sig of signatures) {
  console.log('\nTx:', sig.signature);
  console.log('  Slot:', sig.slot);
  console.log('  Time:', sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'unknown');
  console.log('  Status:', sig.err ? 'FAILED' : 'SUCCESS');
  
  if (!sig.err) {
    // Get full transaction
    try {
      const tx = await conn.getTransaction(sig.signature, { 
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });
      
      if (tx?.transaction?.message) {
        const msg = tx.transaction.message;
        // Get instruction data
        const instructions = msg.compiledInstructions ?? msg.instructions;
        for (const ix of (instructions || [])) {
          const data = ix.data;
          if (data && data.length > 8) {
            const dataHex = Buffer.from(data).toString('hex');
            const discriminator = dataHex.slice(0, 16);
            const CLAIM_DISC = '3ec6d6c1d59f6cd2';
            const REFUND_DISC = '0260b7fb3fd02e2e';
            
            if (discriminator === CLAIM_DISC) {
              const preimageHex = dataHex.slice(16, 80);
              console.log('  CLAIM INSTRUCTION FOUND!');
              console.log('  Preimage (hex):', preimageHex);
            } else if (discriminator === REFUND_DISC) {
              console.log('  REFUND INSTRUCTION FOUND!');
            } else {
              console.log('  Instruction discriminator:', discriminator);
            }
          }
        }
      }
    } catch (e) {
      console.log('  Error fetching tx:', e.message);
    }
  }
}
