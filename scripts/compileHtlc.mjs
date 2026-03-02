/**
 * Compile HTLC.sol and write the ABI + bytecode to contracts/HTLC.json
 * Usage: node scripts/compileHtlc.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import solc from "solc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const source = readFileSync(resolve(root, "contracts/HTLC.sol"), "utf8");

const input = {
  language: "Solidity",
  sources: {
    "HTLC.sol": { content: source },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
  const errors = output.errors.filter(e => e.severity === "error");
  if (errors.length > 0) {
    console.error("Compilation errors:");
    errors.forEach(e => console.error(e.formattedMessage));
    process.exit(1);
  }
  const warnings = output.errors.filter(e => e.severity === "warning");
  if (warnings.length > 0) {
    console.warn("Compilation warnings:");
    warnings.forEach(w => console.warn(w.formattedMessage));
  }
}

const contract = output.contracts["HTLC.sol"]["HTLC"];
if (!contract) {
  console.error("HTLC contract not found in compilation output");
  process.exit(1);
}

const artifact = {
  contractName: "HTLC",
  abi: contract.abi,
  bytecode: "0x" + contract.evm.bytecode.object,
  deployedBytecode: "0x" + contract.evm.deployedBytecode.object,
  compiledAt: new Date().toISOString(),
  solcVersion: solc.version(),
};

mkdirSync(resolve(root, "contracts"), { recursive: true });
writeFileSync(
  resolve(root, "contracts/HTLC.json"),
  JSON.stringify(artifact, null, 2)
);

console.log(`✅ HTLC.sol compiled successfully`);
console.log(`   ABI functions: ${artifact.abi.filter(x => x.type === "function").map(x => x.name).join(", ")}`);
console.log(`   Bytecode size: ${artifact.bytecode.length / 2 - 1} bytes`);
console.log(`   Output: contracts/HTLC.json`);
