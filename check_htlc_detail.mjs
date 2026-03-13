import { Connection, PublicKey } from "@solana/web3.js";

const connection = new Connection("http://localhost:3000/api/sol-rpc", "confirmed");

const SPL_TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SPL_ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const USDT_MINT = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");

function deriveAta(owner, mint) {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), SPL_TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    SPL_ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

// The two active HTLC PDAs
const htlcPdas = [
  "8WkkEjomx9AHHy8BnAaCyn9Q5EfXLNq8WDMGPhFBqQUf",
  "4gKNVtZ4dYHwuTXaKN2hXV3CTSzzZYs1y9KQZCbf8TZ6",
];

for (const pdaAddr of htlcPdas) {
  const pda = new PublicKey(pdaAddr);
  const vaultAta = deriveAta(pda, USDT_MINT);
  
  const pdaInfo = await connection.getAccountInfo(pda);
  const vaultAtaInfo = await connection.getAccountInfo(vaultAta);
  
  console.log(`\nHTLC PDA: ${pdaAddr.slice(0,12)}`);
  console.log(`  PDA exists: ${pdaInfo ? 'YES' : 'NO'} (${pdaInfo?.lamports ?? 0} lamports)`);
  console.log(`  Vault ATA (${vaultAta.toBase58().slice(0,12)}): ${vaultAtaInfo ? 'EXISTS' : 'NOT FOUND'}`);
  
  // Read the HTLC PDA data to understand its state
  if (pdaInfo && pdaInfo.data.length > 0) {
    console.log(`  PDA data length: ${pdaInfo.data.length} bytes`);
    // First 8 bytes are discriminator, then the HTLC state
    const data = pdaInfo.data;
    console.log(`  Discriminator: ${Buffer.from(data.slice(0,8)).toString('hex')}`);
  }
}
