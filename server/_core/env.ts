export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  oracleApiUrl: process.env.ORACLE_API_URL ?? "http://141.253.123.101:4000",
  // Solana RPC & HTLC
  heliusApiKey: process.env.HELIUS_API_KEY ?? "",
  solHtlcKey: process.env.SOL_HTLC_KEY ?? "",
  // Prefer Helius when key is set, fall back to VITE_SOL_RPC_URL, then publicnode
  get solRpcUrl() {
    if (this.heliusApiKey) return `https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`;
    return process.env.VITE_SOL_RPC_URL ?? "https://solana-rpc.publicnode.com";
  },
  // Ethereum HTLC agent keys
  ethHtlcKey: process.env.ETH_HTLC_KEY ?? "",
  ethRpcUrl: process.env.ETH_RPC_URL ?? "",
  // Trac Network (TNK) on-chain HTLC
  // URL of the trac-peer node running the AFOS HTLC subnet contract
  tnkPeerRpcUrl: process.env.TNK_PEER_RPC_URL ?? "http://localhost:5001",
  // Address of the HTLC contract on the Trac Network subnet
  tnkHtlcContractAddress: process.env.TNK_HTLC_CONTRACT_ADDRESS ?? "",
  // Agent key for signing trac-peer contract transactions (PKCS8 DER hex)
  tnkAgentKey: process.env.TNK_AGENT_KEY ?? "",
  // Server secret for authenticating internal agent/send calls
  afosServerSecret: process.env.AFOS_SERVER_SECRET ?? "",
};
