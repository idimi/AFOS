import { Connection, PublicKey } from "@solana/web3.js";

const connection = new Connection("http://localhost:3000/api/sol-rpc", "confirmed");

const htlcPdas = [
  "8WkkEjomx9AHHy8BnAaCyn9Q5EfXLNq8WDMGPhFBqQUf",
  "4gKNVtZ4dYHwuTXaKN2hXV3CTSzzZYs1y9KQZCbf8TZ6",
];

for (const pdaAddr of htlcPdas) {
  const pda = new PublicKey(pdaAddr);
  const pdaInfo = await connection.getAccountInfo(pda);
  
  if (!pdaInfo || pdaInfo.data.length < 160) {
    console.log(`${pdaAddr.slice(0,12)}: No data (len=${pdaInfo?.data.length})`);
    continue;
  }
  
  const data = pdaInfo.data;
  const sender = new PublicKey(data.slice(8, 40));
  const recipient = new PublicKey(data.slice(40, 72));
  const amountBuf = data.slice(72, 80);
  const amount = Number(new DataView(amountBuf.buffer, amountBuf.byteOffset).getBigUint64(0, true));
  const timelockBuf = data.slice(80, 88);
  const timelock = Number(new DataView(timelockBuf.buffer, timelockBuf.byteOffset).getBigInt64(0, true));
  const isClaimed = data[152] === 1;
  const isRefunded = data[153] === 1;
  
  console.log(`\nHTLC PDA: ${pdaAddr.slice(0,12)}`);
  console.log(`  sender:     ${sender.toBase58()}`);
  console.log(`  recipient:  ${recipient.toBase58()}`);
  console.log(`  amount:     ${amount} lamports (${(amount / 1e9).toFixed(6)} SOL)`);
  console.log(`  timelock:   ${new Date(timelock * 1000).toISOString()}`);
  console.log(`  isClaimed:  ${isClaimed}`);
  console.log(`  isRefunded: ${isRefunded}`);
}
