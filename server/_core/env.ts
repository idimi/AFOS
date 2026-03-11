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
  // Solana HTLC agent keys
  solHtlcKey: process.env.SOL_HTLC_KEY ?? "",
  solRpcUrl: process.env.VITE_SOL_RPC_URL ?? "https://solana-rpc.publicnode.com",
  // Ethereum HTLC agent keys
  ethHtlcKey: process.env.ETH_HTLC_KEY ?? "",
  ethRpcUrl: process.env.ETH_RPC_URL ?? "",
};
