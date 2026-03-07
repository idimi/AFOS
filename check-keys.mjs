import 'dotenv/config';

const solKey = process.env.SOL_HTLC_KEY || process.env.SOL_AGENT_KEY;
const ethKey = process.env.ETH_HTLC_KEY || process.env.ETH_AGENT_KEY;
const btcKey = process.env.BTC_HTLC_WIF || process.env.BTC_AGENT_WIF;
const oracleUrl = process.env.ORACLE_API_URL;
const solRpc = process.env.SOL_RPC_URL;

console.log('SOL_HTLC_KEY set:', !!solKey, solKey ? `(length=${solKey.length})` : '(MISSING)');
console.log('ETH_HTLC_KEY set:', !!ethKey, ethKey ? `(length=${ethKey.length})` : '(MISSING)');
console.log('BTC_HTLC_WIF set:', !!btcKey, btcKey ? `(length=${btcKey.length})` : '(MISSING)');
console.log('ORACLE_API_URL  :', oracleUrl || 'not set → default http://141.253.123.101:4000');
console.log('SOL_RPC_URL     :', solRpc || 'not set → default mainnet-beta public RPC');
