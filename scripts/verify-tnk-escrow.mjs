import { config } from "dotenv";
config();

const addr = process.env.TNK_ESCROW_ADDRESS;
if (!addr || addr.includes("placeholder")) {
  console.error("TNK_ESCROW_ADDRESS not set or still placeholder:", addr);
  process.exit(1);
}
console.log("TNK_ESCROW_ADDRESS is set:", addr.slice(0, 12) + "..." + addr.slice(-6));
console.log("Length:", addr.length, "chars");
console.log("Looks valid:", addr.length >= 10);
