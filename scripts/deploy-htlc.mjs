/**
 * Deploy HTLC.sol to Ethereum Sepolia testnet.
 *
 * Usage:
 *   ETH_HTLC_KEY=0x... node scripts/deploy-htlc.mjs
 *
 * The script uses the pre-compiled bytecode from contracts/HTLC.json.
 * No Hardhat/Foundry required — pure ethers.js v6.
 */

import { ethers } from "ethers";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────────────

const SEPOLIA_RPCS = [
  "https://rpc.sepolia.org",
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://sepolia.drpc.org",
  "https://rpc2.sepolia.org",
];

const PRIVATE_KEY = process.env.ETH_HTLC_KEY;
if (!PRIVATE_KEY) {
  console.error("❌  ETH_HTLC_KEY env var is required");
  process.exit(1);
}

// ─── Load ABI + Bytecode ─────────────────────────────────────────────────────

const artifact = JSON.parse(
  readFileSync(join(__dirname, "../contracts/HTLC.json"), "utf-8")
);

const { abi, bytecode } = artifact;

if (!bytecode || bytecode === "0x") {
  console.error("❌  No bytecode found in contracts/HTLC.json");
  process.exit(1);
}

// ─── Deploy ──────────────────────────────────────────────────────────────────

async function deploy() {
  let provider = null;

  // Try each RPC until one works
  for (const rpc of SEPOLIA_RPCS) {
    try {
      console.log(`🔌  Trying RPC: ${rpc}`);
      const p = new ethers.JsonRpcProvider(rpc);
      const network = await p.getNetwork();
      if (network.chainId === 11155111n) {
        provider = p;
        console.log(`✅  Connected to Sepolia via ${rpc}`);
        break;
      } else {
        console.log(`⚠️   Wrong chain: ${network.chainId} (expected 11155111)`);
      }
    } catch (e) {
      console.log(`⚠️   RPC failed: ${e.message}`);
    }
  }

  if (!provider) {
    console.error("❌  Could not connect to any Sepolia RPC");
    process.exit(1);
  }

  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const balance = await provider.getBalance(wallet.address);
  const balanceEth = ethers.formatEther(balance);

  console.log(`\n📍  Deployer:  ${wallet.address}`);
  console.log(`💰  Balance:   ${balanceEth} ETH (Sepolia)`);

  if (balance === 0n) {
    console.error(
      "\n❌  Deployer has 0 Sepolia ETH. Get testnet ETH from:\n" +
      "    https://faucets.chain.link/sepolia\n" +
      "    https://sepoliafaucet.com\n" +
      "    https://www.alchemy.com/faucets/ethereum-sepolia"
    );
    process.exit(1);
  }

  if (balance < ethers.parseEther("0.001")) {
    console.warn(`⚠️   Low balance (${balanceEth} ETH). Deployment may fail.`);
  }

  console.log("\n🚀  Deploying HTLC contract...");

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy();

  console.log(`📝  Tx hash:   ${contract.deploymentTransaction()?.hash}`);
  console.log("⏳  Waiting for confirmation...");

  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`\n✅  HTLC deployed at: ${address}`);
  console.log(`🔗  Etherscan:        https://sepolia.etherscan.io/address/${address}`);
  console.log(`\n📋  Add this to your secrets:`);
  console.log(`    VITE_ETH_HTLC_ADDRESS=${address}`);

  return address;
}

deploy().catch((err) => {
  console.error("❌  Deployment failed:", err.message);
  process.exit(1);
});
