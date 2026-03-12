/**
 * Test the refund instruction with token accounts included.
 * The program requires sender_token_account even for SOL HTLCs.
 * Try different account orderings with USDT token accounts.
 */
import { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';

const RPC = process.env.VITE_SOL_RPC_URL || 'https://api.mainnet-beta.solana.com';
const conn = new Connection(RPC, 'confirmed');

const PROGRAM_ID = new PublicKey('XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW');
const HTLC_PDA = new PublicKey('45jdLtyQBrbCMz6wpC1kgtuQZxASH3w5LWg6UhbTYTLQ');
const USER_WALLET = new PublicKey('AuSUBiVV1FYnCkBiqKCAHWesvDm6BQipQ3hcRcvg6HQk');
const USDT_MINT = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');

// Derive token accounts
const userUsdtAta = getAssociatedTokenAddressSync(USDT_MINT, USER_WALLET);
const htlcUsdtVault = getAssociatedTokenAddressSync(USDT_MINT, HTLC_PDA, true); // allowOwnerOffCurve=true for PDA

console.log('User USDT ATA:', userUsdtAta.toBase58());
console.log('HTLC USDT Vault:', htlcUsdtVault.toBase58());

const REFUND_DISCRIMINATOR = Buffer.from([2, 96, 183, 251, 63, 208, 46, 46]);

// Try different orderings
const accountSets = [
  {
    name: 'sender, htlc, sender_ata, system',
    keys: [
      { pubkey: USER_WALLET, isSigner: true, isWritable: true },
      { pubkey: HTLC_PDA, isSigner: false, isWritable: true },
      { pubkey: userUsdtAta, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]
  },
  {
    name: 'sender, htlc, vault_ata, sender_ata, token_prog, system',
    keys: [
      { pubkey: USER_WALLET, isSigner: true, isWritable: true },
      { pubkey: HTLC_PDA, isSigner: false, isWritable: true },
      { pubkey: htlcUsdtVault, isSigner: false, isWritable: true },
      { pubkey: userUsdtAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]
  },
  {
    name: 'sender, htlc, USDT_mint, vault_ata, sender_ata, token_prog, system',
    keys: [
      { pubkey: USER_WALLET, isSigner: true, isWritable: true },
      { pubkey: HTLC_PDA, isSigner: false, isWritable: true },
      { pubkey: USDT_MINT, isSigner: false, isWritable: false },
      { pubkey: htlcUsdtVault, isSigner: false, isWritable: true },
      { pubkey: userUsdtAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]
  },
  {
    name: 'sender, htlc, sender_ata, vault_ata, token_prog, system',
    keys: [
      { pubkey: USER_WALLET, isSigner: true, isWritable: true },
      { pubkey: HTLC_PDA, isSigner: false, isWritable: true },
      { pubkey: userUsdtAta, isSigner: false, isWritable: true },
      { pubkey: htlcUsdtVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]
  },
];

const { blockhash } = await conn.getLatestBlockhash('confirmed');

for (const { name, keys } of accountSets) {
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys,
    data: Buffer.from(REFUND_DISCRIMINATOR),
  });
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = USER_WALLET;
  tx.add(ix);

  const sim = await conn.simulateTransaction(tx, undefined, [USER_WALLET]);
  const err = sim.value.err;
  if (!err) {
    console.log(`✓ PASSED: ${name}`);
    console.log('Logs:', sim.value.logs?.join('\n'));
  } else {
    const errLog = sim.value.logs?.find(l => l.includes('Error') || l.includes('error'));
    console.log(`✗ FAILED (${name}): ${errLog || JSON.stringify(err)}`);
  }
}
