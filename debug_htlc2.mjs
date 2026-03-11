/**
 * Debug script 2: The htlcId from on-chain is "htlc_a_rfq_1773205346880_lp-3" (29 chars)
 * but deriveHtlcPda with that htlcId gives HhFbhSQ9... not 45jdLty...
 * 
 * This means the PDA was derived with DIFFERENT seeds.
 * Let's try to figure out what seeds produce 45jdLtyQBrbCMz6wpC1kgtuQZxASH3w5LWg6UhbTYTLQ
 */
import { PublicKey } from "@solana/web3.js";

const AFOS_HTLC_PROGRAM_ID = new PublicKey("XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW");
const KNOWN_PDA = "45jdLtyQBrbCMz6wpC1kgtuQZxASH3w5LWg6UhbTYTLQ";

function htlcIdToBytes(htlcId) {
  const bytes = new Uint8Array(32);
  const encoded = new TextEncoder().encode(htlcId.slice(0, 32));
  bytes.set(encoded);
  return bytes;
}

function deriveHtlcPda(htlcIdBytes) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("htlc"), htlcIdBytes],
    AFOS_HTLC_PROGRAM_ID
  );
}

// The on-chain htlcId is "htlc_a_rfq_1773205346880_lp-3" (29 chars)
// But maybe the lock was done with a different htlcId format?
// Let's try various possibilities:

const candidates = [
  // Original htlcId from on-chain data
  "htlc_a_rfq_1773205346880_lp-3",
  // Maybe the rfqId was used directly as the htlcId seed?
  "rfq_1773205346880_lp-3",
  "rfq_1773205346880_lp-3dcc9",
  // Maybe just the rfq part without prefix
  "1773205346880_lp-3",
  "1773205346880_lp-3dcc9",
  // Maybe the htlcId was the full rfqId with htlc_ prefix
  "htlc_rfq_1773205346880_lp-3",
  "htlc_rfq_1773205346880_lp-3dcc",
  "htlc_rfq_1773205346880_lp-3dcc9",
  // Maybe different timestamp
  "htlc_a_rfq_1773205346880_lp-3d",
  "htlc_a_rfq_1773205346880_lp-3dc",
  // Maybe the htlcId was stored differently in the lock instruction
  // Let's try with the full 32-char string that was in the on-chain data
];

// Also try: maybe the seed is NOT "htlc" + htlcIdBytes but something else
// Let's check if the PDA was derived with just the htlcId bytes (no "htlc" prefix)
function derivePdaNoPrefix(htlcIdBytes) {
  return PublicKey.findProgramAddressSync(
    [htlcIdBytes],
    AFOS_HTLC_PROGRAM_ID
  );
}

console.log("=== Testing with 'htlc' prefix seed ===");
for (const c of candidates) {
  const bytes = htlcIdToBytes(c);
  const [pda] = deriveHtlcPda(bytes);
  const match = pda.toBase58() === KNOWN_PDA;
  if (match) console.log(`✅ MATCH: "${c}" => ${pda.toBase58()}`);
  else console.log(`   "${c}" (${c.length} chars) => ${pda.toBase58()}`);
}

console.log("\n=== Testing WITHOUT 'htlc' prefix seed ===");
for (const c of candidates) {
  const bytes = htlcIdToBytes(c);
  const [pda] = derivePdaNoPrefix(bytes);
  const match = pda.toBase58() === KNOWN_PDA;
  if (match) console.log(`✅ MATCH: "${c}" => ${pda.toBase58()}`);
}

// Let's also try: the htlcId bytes as raw (not padded to 32)
console.log("\n=== Testing with raw (unpadded) htlcId bytes ===");
for (const c of candidates) {
  const rawBytes = new TextEncoder().encode(c);
  try {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("htlc"), rawBytes],
      AFOS_HTLC_PROGRAM_ID
    );
    const match = pda.toBase58() === KNOWN_PDA;
    if (match) console.log(`✅ MATCH (raw): "${c}" => ${pda.toBase58()}`);
  } catch {}
}

// The most likely scenario: the lock transaction used a different htlcId
// Let's check the transaction that funded this account
console.log("\n=== Checking the funding transaction ===");
import { Connection } from "@solana/web3.js";
const SOL_RPC_URL = process.env.VITE_SOL_RPC_URL || "https://solana-rpc.publicnode.com";
const connection = new Connection(SOL_RPC_URL, "confirmed");

try {
  const sigs = await connection.getSignaturesForAddress(new PublicKey(KNOWN_PDA), { limit: 5 });
  console.log(`Found ${sigs.length} signatures:`);
  for (const sig of sigs) {
    console.log(`  ${sig.signature} (slot: ${sig.slot}, err: ${sig.err})`);
  }
  
  if (sigs.length > 0) {
    const tx = await connection.getTransaction(sigs[0].signature, {
      maxSupportedTransactionVersion: 0,
    });
    if (tx) {
      console.log("\nTransaction details:");
      console.log("  Block time:", tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : "unknown");
      console.log("  Fee:", tx.meta?.fee);
      console.log("  Log messages:");
      tx.meta?.logMessages?.forEach(m => console.log("    ", m));
      
      // Check the instruction data
      const msg = tx.transaction.message;
      console.log("\n  Account keys:");
      const keys = msg.getAccountKeys ? msg.getAccountKeys() : msg.staticAccountKeys;
      if (keys) {
        const keyList = keys.staticAccountKeys || keys;
        for (let i = 0; i < keyList.length; i++) {
          console.log(`    [${i}] ${keyList[i].toBase58()}`);
        }
      }
    }
  }
} catch (err) {
  console.error("Error fetching tx:", err.message);
}
