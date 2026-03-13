import { PublicKey } from "@solana/web3.js";

const AFOS_HTLC_PROGRAM_ID = new PublicKey("XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW");

function htlcIdToBytes(htlcId) {
  const bytes = new Uint8Array(32);
  const encoded = new TextEncoder().encode(htlcId);
  bytes.set(encoded.slice(0, 32));
  return bytes;
}

function derivePda(htlcId) {
  const htlcIdBytes = htlcIdToBytes(htlcId);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("htlc"), htlcIdBytes],
    AFOS_HTLC_PROGRAM_ID
  );
  return pda.toBase58();
}

// The actual on-chain PDAs from the DB
const actualPdas = {
  "htlc_a_rfq_1773365303738_lp-c7de58616b": "8WkkEjomx9AHHy8BnAaCyn9Q5EfXLNq8WDMGPhFBqQUf",
  "htlc_a_rfq_1773359544103_lp-c7de58616b": "4gKNVtZ4dYHwuTXaKN2hXV3CTSzzZYs1y9KQZCbf8TZ6",
};

// The truncated htlcIds stored in DB
const truncatedIds = {
  "htlc_a_rfq_1773365303738_lp-c": "8WkkEjomx9AHHy8BnAaCyn9Q5EfXLNq8WDMGPhFBqQUf",
  "htlc_a_rfq_1773359544103_lp-c": "4gKNVtZ4dYHwuTXaKN2hXV3CTSzzZYs1y9KQZCbf8TZ6",
};

console.log("=== PDA Derivation Check ===\n");

for (const [htlcId, expectedPda] of Object.entries(actualPdas)) {
  const derived = derivePda(htlcId);
  console.log(`htlcId: ${htlcId}`);
  console.log(`  expected PDA: ${expectedPda}`);
  console.log(`  derived PDA:  ${derived}`);
  console.log(`  MATCH: ${derived === expectedPda ? "✅ YES" : "❌ NO"}\n`);
}

for (const [htlcId, expectedPda] of Object.entries(truncatedIds)) {
  const derived = derivePda(htlcId);
  console.log(`htlcId (truncated): ${htlcId}`);
  console.log(`  expected PDA: ${expectedPda}`);
  console.log(`  derived PDA:  ${derived}`);
  console.log(`  MATCH: ${derived === expectedPda ? "✅ YES" : "❌ NO"}\n`);
}
