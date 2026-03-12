const { Connection, PublicKey } = require('@solana/web3.js');
const conn = new Connection('https://solana-rpc.publicnode.com', 'confirmed');

async function main() {
  const programId = new PublicKey('XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW');

  // The escrow address from the DB (htlcAddress column)
  const escrowAddr = 'C6cFZfKkk1cwLVdwoRf5LTMe9SUVVenevMuwfxNdM9hK';
  const escrow = new PublicKey(escrowAddr);
  const escrowInfo = await conn.getAccountInfo(escrow);
  console.log('HTLC escrow exists:', !!escrowInfo);
  if (escrowInfo) {
    // Decode the htlcId from the escrow data (first field after 8-byte discriminator)
    const data = escrowInfo.data;
    // Anchor stores strings as: 4-byte length LE + bytes
    // After 8-byte discriminator, the htlcId string starts
    const strLen = data.readUInt32LE(8);
    const htlcIdFromChain = data.slice(12, 12 + strLen).toString('utf8');
    console.log('htlcId stored in escrow:', htlcIdFromChain);
    console.log('Escrow lamports:', escrowInfo.lamports);

    // Now derive the PDA from this htlcId and see if it matches the escrow address
    const [derivedPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('htlc'), Buffer.from(htlcIdFromChain)],
      programId
    );
    console.log('Derived PDA from htlcId:', derivedPda.toBase58());
    console.log('Matches escrow address:', derivedPda.toBase58() === escrowAddr);
  }

  // Now try deriving PDA from the lockTxId stored in DB
  const lockTxId = '3n8UotKG3iUCC4SwmpnGxdYgpxmhZwNT2Vtx5zD8cKbStW9GWoBJ2VkLKBJzKhDEVjmFNJGQXmPfmtPFkQGNk4E';
  const htlcIdFromDb = 'htlc_a_rfq_1773283782213_lp-c';
  const [pdaFromDb] = PublicKey.findProgramAddressSync(
    [Buffer.from('htlc'), Buffer.from(htlcIdFromDb)],
    programId
  );
  console.log('\nPDA derived from DB htlcId:', pdaFromDb.toBase58());
  console.log('DB htlcId:', htlcIdFromDb);
}
main().catch(console.error);
