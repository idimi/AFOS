/**
 * Deploy HTLC.sol to Ethereum Sepolia testnet.
 *
 * Prerequisites:
 *   - ETH_DEPLOYER_KEY env var: private key of the deployer wallet (with Sepolia ETH)
 *   - ETH_RPC_URL env var (optional): custom RPC, defaults to Cloudflare Sepolia
 *
 * Usage:
 *   ETH_DEPLOYER_KEY=0x... node scripts/deployHtlc.mjs
 *
 * Get Sepolia ETH from: https://sepoliafaucet.com or https://faucet.quicknode.com/ethereum/sepolia
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// ─── Config ───────────────────────────────────────────────────────────────────

const DEPLOYER_KEY = process.env.ETH_DEPLOYER_KEY;
if (!DEPLOYER_KEY) {
  console.error("❌ ETH_DEPLOYER_KEY env var is required");
  console.error("   Set it via: ETH_DEPLOYER_KEY=0x<private-key> node scripts/deployHtlc.mjs");
  process.exit(1);
}

const RPC_URL = process.env.ETH_RPC_URL
  || "https://cloudflare-eth.com"  // mainnet default — override with Sepolia RPC
  || "https://rpc.sepolia.org";

// ─── Load compiled artifact ───────────────────────────────────────────────────

const artifact = JSON.parse(
  readFileSync(resolve(root, "contracts/HTLC.json"), "utf8")
);

// ─── Deploy ───────────────────────────────────────────────────────────────────

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(DEPLOYER_KEY, provider);

  const network = await provider.getNetwork();
  const balance = await provider.getBalance(wallet.address);

  console.log(`\n🔗 Network:   ${network.name} (chainId: ${network.chainId})`);
  console.log(`👛 Deployer:  ${wallet.address}`);
  console.log(`💰 Balance:   ${ethers.formatEther(balance)} ETH`);

  if (balance < ethers.parseEther("0.001")) {
    console.error("❌ Insufficient balance. Need at least 0.001 ETH for deployment gas.");
    process.exit(1);
  }

  console.log("\n📦 Deploying HTLC.sol...");

  const factory  = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy();

  console.log(`⏳ Waiting for deployment tx: ${contract.deploymentTransaction()?.hash}`);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`\n✅ HTLC deployed at: ${address}`);
  console.log(`   Explorer: https://sepolia.etherscan.io/address/${address}`);

  // ─── Save deployment info ─────────────────────────────────────────────────

  const deployInfo = {
    contractAddress: address,
    network:         network.name,
    chainId:         Number(network.chainId),
    deployedAt:      new Date().toISOString(),
    deployer:        wallet.address,
    txHash:          contract.deploymentTransaction()?.hash,
  };

  writeFileSync(
    resolve(root, "contracts/HTLC.deployment.json"),
    JSON.stringify(deployInfo, null, 2)
  );

  console.log(`\n📝 Deployment info saved to contracts/HTLC.deployment.json`);
  console.log(`\n🔑 Next step: Set ETH_HTLC_ADDRESS=${address} in your environment secrets.`);
  console.log(`   Then the executeEthSwap procedure will use real HTLC locking.`);
}

main().catch(err => {
  console.error("❌ Deployment failed:", err.message);
  process.exit(1);
});
