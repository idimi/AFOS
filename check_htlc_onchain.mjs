import { Connection, PublicKey } from "@solana/web3.js";

const connection = new Connection("http://localhost:3000/api/sol-rpc", "confirmed");

// Escrow addresses from the screenshot
const escrows = [
  "8WkkEjomx9AHHy8BnAaCyn9Q5EfXLNq8WDMGPhFBqQUf",
  "4gKNVtZ4dYHwuTXaKN2hXV3CTSzzZYs1y9KQZCbf8TZ6",
  "5ze9TQPFJcJS7Ry8TRfhQmqHCzTqKiSJfCa5Hm2DKZQ9",
];

for (const addr of escrows) {
  try {
    const pk = new PublicKey(addr);
    const info = await connection.getAccountInfo(pk);
    if (info) {
      console.log(`${addr.slice(0,12)}: EXISTS (${info.lamports} lamports, owner: ${info.owner.toBase58().slice(0,12)})`);
    } else {
      console.log(`${addr.slice(0,12)}: CLOSED/NOT FOUND — already refunded or never locked`);
    }
  } catch(e) {
    console.log(`${addr.slice(0,12)}: ERROR - ${e.message}`);
  }
}
