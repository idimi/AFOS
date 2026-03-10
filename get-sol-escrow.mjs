import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

const rawKey = process.env.SOL_HTLC_KEY || process.env.SOL_AGENT_KEY;
if (!rawKey) {
  console.log("No SOL_HTLC_KEY or SOL_AGENT_KEY set");
  process.exit(0);
}
try {
  let kp;
  if (rawKey.startsWith("[")) {
    kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(rawKey)));
  } else {
    kp = Keypair.fromSecretKey(bs58.decode(rawKey));
  }
  console.log("SOL escrow address:", kp.publicKey.toBase58());
} catch (e) {
  console.error("Error:", e.message);
}
