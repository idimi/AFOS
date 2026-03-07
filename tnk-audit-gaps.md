# TNK / trac_network Consistency Audit — Gap Report

## ✅ Already Consistent (no changes needed)

| Location | Status |
|---|---|
| `drizzle/schema.ts` — `htlcSwaps.chain`, `fromChain`, `toChain` enums | ✅ includes `trac_network` |
| `server/htlcMonitor.ts` — `ChainHeights`, `HtlcRecord` types | ✅ includes `trac_network` |
| `server/routers/chat.ts` — `SupportedChain`, `ASSETS`, `defaultChain()`, price fetch | ✅ includes `trac_network` / TNK |
| `server/routers/history.ts` — `list` chain filter, `stats` TNK aggregates | ✅ includes `trac_network` |
| `server/routers/htlcWallet.ts` — `getTnkEscrowWallet`, `getHtlcWallets` | ✅ includes TNK |
| `client/src/pages/Swaps.tsx` — `CHAINS`, `TOKENS`, `SWAP_PAIRS`, chart tabs, `deriveTvSymbol`, peer depth strip | ✅ includes `trac_network` / TNK |
| `client/src/pages/SwapHistory.tsx` — `CHAIN_CONFIG`, chain filter chips, stats strip | ✅ includes `trac_network` / TNK |
| `client/src/pages/SwapHistoryTabs.tsx` — `HtlcSwapRow` type, `PRICE_ESTIMATES`, TNK refund/claim handlers | ✅ includes `trac_network` / TNK |
| `client/src/pages/AdminPanel.tsx` — `CHAIN_COLORS`, `chainTabs`, HTLC Wallet section, Oracle VM Addresses | ✅ includes `trac_network` / TNK |
| `client/src/pages/ChatPage.tsx` — `TOKEN_CHAIN_FALLBACK`, `TOKEN_COLORS` | ✅ includes `trac_network` / TNK |
| `client/src/contexts/LightPeerContext.tsx` — TNK HTLC branch | ✅ handles `trac_network` |
| `client/src/components/ConnectWalletModal.tsx` — `ChainTab`, `CHAIN_TABS`, Tap Wallet TNK | ✅ includes `trac_network` |
| `client/src/pages/NetworkPage.tsx` — HTLC Escrow Wallets card, Settlement label | ✅ includes TNK |

---

## ❌ Gaps Found — Fixes Required

### 1. `client/src/lib/afosApi.ts` — `SupportedChain` type missing `trac_network`
- Line 29: `export type SupportedChain = 'solana' | 'ethereum' | 'bitcoin';`
- **Fix:** Add `| 'trac_network'`
- Also add TNK to `ASSET_REGISTRY`
- Also fix `inferChain()` to return `'trac_network'` for TNK
- Also fix `inferChainFromNetwork()` to handle `'trac'` / `'trac network'`

### 2. `client/src/pages/AdminPanel.tsx` — Volume by Chain chart label/color missing TNK
- Lines 138–139: ternary `chain === "bitcoin" ? "BTC" : chain === "ethereum" ? "ETH" : "SOL"` — falls through to SOL for trac_network
- **Fix:** Add `trac_network` branch → label `"TNK"`, color `"#F97316"`

### 3. `client/src/pages/AdminPanel.tsx` — HtlcHistory row chain label missing TNK
- Lines 1500, 1505: same ternary pattern → shows "SOL" for TNK rows
- **Fix:** Add `trac_network` branch → `"TNK"`

### 4. `client/src/pages/AdminPanel.tsx` — TreasuryWallet chain type missing `trac_network`
- Line 35: `chain: "solana" | "ethereum" | "bitcoin"` — no `trac_network`
- Line 595–597: `<option>` dropdown missing TNK option
- `drizzle/schema.ts` line 301: same type missing `trac_network`
- `server/routers/adminConfig.ts` line 34: `z.enum(["solana", "ethereum", "bitcoin"])` missing `trac_network`
- **Fix:** Add `trac_network` to all four locations + add `<option value="trac_network">Trac Network (TNK)</option>`

### 5. `client/src/pages/AdminPanel.tsx` — Treasury wallet chain color/badge missing TNK
- Lines 530–531: ternary for background/color misses `trac_network`
- **Fix:** Add `trac_network` branch → `rgba(249,115,22,0.15)` / `#F97316`

### 6. `client/src/pages/SwapHistoryTabs.tsx` — `explorerTxUrl` / `explorerAddrUrl` missing trac_network
- Lines 90–93, 98–101: no `trac_network` branch → returns `"#"` for TNK txs
- **Fix:** Add `trac_network` branch → `https://explorer.trac.network/tx/{hash}` and `https://explorer.trac.network/address/{addr}`

### 7. `client/src/pages/SwapHistoryTabs.tsx` — `BLOCK_TIMES` missing trac_network
- Lines 120–123: no `trac_network` entry → countdown timer broken for TNK HTLCs
- **Fix:** Add `trac_network: 5` (Trac Network ~5s block time)

### 8. `client/src/pages/SwapHistoryTabs.tsx` — `mapHtlcToOpenTrade` / `mapHtlcToRefund` fromSymbol ternary missing TNK
- Lines 402, 936: `row.chain === "bitcoin" ? "BTC" : row.chain === "ethereum" ? "ETH" : "SOL"` → shows "SOL" for TNK
- **Fix:** Add `row.chain === "trac_network" ? "TNK" :` branch before the final `"SOL"` fallback

### 9. `client/src/pages/SwapHistoryTabs.tsx` — HTLC countdown amount display missing TNK
- Lines 269, 402 (countdown panel): same ternary pattern
- **Fix:** Add `trac_network` → `"TNK"` branch

### 10. `client/src/pages/ChatPage.tsx` — `CHAIN_PILL_STYLES` missing trac_network
- Lines 143–145: no `trac_network` entry → falls back to `fromChain.toUpperCase()` (shows "TRAC_NETWORK")
- **Fix:** Add `trac_network: { color: "#F97316", label: "TNK" }`

### 11. `client/src/pages/ChatPage.tsx` — TNK swap execution branch missing
- Lines 863–864, 950–951: type casts `as "solana" | "ethereum" | "bitcoin"` exclude `trac_network`
- No TNK-specific execution branch before the Solana fallback
- **Fix:** Add `trac_network` to type casts; add TNK execution branch (agent-escrow via `window.tracnetwork`)

### 12. `server/routers/analytics.ts` — `byChain` array missing `trac_network`
- Line 64: `const chains = ["bitcoin", "ethereum", "solana"] as const` — no `trac_network`
- **Fix:** Add `"trac_network"` to the array

### 13. `server/jobs/oracleVmSync.ts` — `tokenToChain()` missing TNK
- Lines 51–57: no TNK branch → TNK swaps get mapped to `"solana"` incorrectly
- **Fix:** Add `if (t === "TNK") return "trac_network";`

### 14. `server/pathFinder.ts` — chain enums missing `trac_network`
- Lines 28, 32, 86–88, 146, 148, 272, 274: all use `"bitcoin" | "ethereum" | "solana"` without `trac_network`
- **Fix:** Add `trac_network` to all chain type unions and z.enum() calls; add TNK execution procedure

### 15. `client/src/components/NetworkPanel.tsx` — `ALL_PAIRS` missing TNK pairs
- Lines 121–124: no `TNK/*` pairs in the pair toggle list
- **Fix:** Add `"TNK/BTC"`, `"TNK/ETH"`, `"TNK/SOL"`, `"TNK/USDT"` to `ALL_PAIRS`

### 16. `client/src/contexts/LightPeerContext.tsx` — default `acceptedPairs` missing TNK
- Lines 121–126: no TNK pairs in default accepted pairs
- **Fix:** Add `"TNK/ETH"`, `"TNK/SOL"`, `"TNK/BTC"` to default `acceptedPairs`

### 17. `client/src/pages/NetworkPage.tsx` — channel form chain dropdown missing TNK
- Lines 1909, 2580, 2586: `"BTC" | "ETH" | "SOL"` type, no TNK option
- `chainColors` map line 2632 missing TNK
- **Fix:** Add `"TNK"` to type union, add `<option value="TNK">Trac Network (TNK)</option>`, add `TNK: '#f97316'` to chainColors

### 18. `server/agentSwapEth.ts` — chain type casts missing `trac_network`
- Lines 240, 300, 423: `as "solana" | "ethereum" | "bitcoin"` — narrow cast excludes trac_network
- **Fix:** Add `| "trac_network"` to the type casts
