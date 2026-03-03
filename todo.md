# AFOS Dashboard — Code Audit & Overview Redesign Plan

## Audit Findings

### What's GOOD (keep)
- [x] Sidebar + topbar shell — clean, collapsible, mobile tab bar
- [x] AgentLogContext — shared log stream across pages
- [x] WalletContext — multi-chain wallet connection
- [x] TerminalPage — full-featured log viewer with filters, JSON expand, copy/download
- [x] Swaps page — detailed swap flow with progress tracker
- [x] SwapHistory — table with filters, pagination, stats
- [x] NetworkPage — animated P2P node graph
- [x] AdminPanel — operator dashboard at /admin
- [x] AgentSettings — config for all stack components
- [x] LiveFeedPage — P2P sidechannel message stream
- [x] Theme system — dark/light with OKLCH tokens

### What's WRONG with Overview (remove/fix)
- [ ] **3-column layout is cluttered** — Agent Command, Pipeline, Wallets, Pairs, Agent Log, Stack Status, Worker, LP Health all crammed in
- [ ] **Pipeline duplicated** — same 5-step pipeline exists in Overview AND should only live in Terminal
- [ ] **Agent Command input duplicated** — exists in Overview AND Terminal; confusing
- [ ] **Hardcoded mock data everywhere** — wallet balances, pair prices, LN channels all static
- [ ] **Agent Log in Overview is redundant** — Terminal page already shows full log; Overview just shows a truncated copy
- [ ] **Stack Status is static** — never changes, not useful as a dashboard widget
- [ ] **LN Channel Health card** — static mock data, belongs in Network page not Overview
- [ ] **Worker card** — fake ticks counter, not connected to anything real
- [ ] **LP Health card** — static reserves, not connected to real data
- [ ] **IntercomSwap Pairs** — static prices, no real feed
- [ ] **Mobile layout** — duplicates every desktop card in a long scroll

## Overview Redesign Plan — Production-Ready Agentic Dashboard

### Design Philosophy
The Overview should be an **operator's command center** — a single glance tells you:
1. Is the agent healthy and running?
2. What are my balances across chains?
3. What happened recently? (last 5 swaps)
4. What's the agent doing right now? (current task/status)
5. Key metrics (24h volume, fees earned, success rate)

### New Layout: 2-column (desktop), stacked (mobile)

#### LEFT COLUMN — Agent Status + Metrics
- [ ] **Agent Status Card** — live/offline indicator, uptime, current task, model info
- [ ] **Key Metrics Row** — 4 compact stat cards: 24h Volume, Fees Earned, Success Rate, Active Peers
- [ ] **Recent Activity Feed** — last 5 swap summaries (from/to/amount/status/time) with "View All" link to History
- [ ] **Quick Actions** — 3-4 action buttons: New Swap, Check Balances, Rebalance LN, View Peers

#### RIGHT COLUMN — Balances + Market
- [ ] **Portfolio Summary** — total USD value, 24h change, mini sparkline
- [ ] **Wallet Balances** — compact list with send/receive (keep existing WalletsCard but cleaner)
- [ ] **Market Rates** — live-updating BTC/USDT, SOL/USDT, ETH/USDT ticker strip
- [ ] **Agent Thought Stream** — compact 3-line live feed of what the agent is thinking/doing (not full terminal)

### What to REMOVE from Overview
- [ ] Pipeline tracker (move to Terminal only)
- [ ] Agent Command input (move to Terminal only)
- [ ] Full Agent Log panel (Terminal only)
- [ ] Stack Status card (move to Settings or Network)
- [ ] LN Channel Health (move to Network)
- [ ] Worker card (integrate into Agent Status)
- [ ] LP Health (move to Admin panel)
- [ ] Mobile duplicate of every card

### Implementation Steps
- [ ] Rewrite Dashboard.tsx Overview section (keep sidebar/topbar/routing shell)
- [ ] Create clean AgentStatusCard component
- [ ] Create MetricsRow component
- [ ] Create RecentSwapsCard component
- [ ] Create QuickActionsCard component
- [ ] Create PortfolioCard component
- [ ] Clean up WalletsCard (keep send/receive modals)
- [ ] Create MarketTicker component
- [ ] Create AgentThoughtStream mini-feed
- [ ] Remove pipeline state from Dashboard (keep in AgentLogContext for Terminal)
- [ ] Responsive mobile layout — single column, prioritized order

## Conversational Swap Agent (Real Product)

### Goal: User connects wallet → chats with AI agent → agent executes swaps on-chain

- [x] Add Phantom wallet adapter provider to App.tsx (already installed)
- [x] Create WalletConnectButton component (connect/disconnect, show address)
- [x] Build backend `/api/chat` tRPC endpoint — Gemini parses intent, fetches Jupiter quote, returns structured response
- [x] Create ChatPage.tsx — conversational interface with message thread
- [x] Build SwapConfirmCard component — shows quote details inline in chat with Confirm/Cancel
- [x] Wire Jupiter tx signing: deserialize tx, send to Phantom, submit to Solana RPC
- [x] Add Chat nav item to sidebar
- [x] Show wallet address + balance in chat header
- [x] Handle edge cases: unknown tokens, insufficient balance, slippage warnings
- [x] Add transaction history in chat (show Solscan links after execution)

## UX Polish — Chat Page Cleanup

- [x] Remove duplicate wallet connect banner from ChatPage (keep only header button)
- [x] Remove wallet connect button from ChatPage header (already in Dashboard topbar)
- [x] Use real Phantom and Solflare logos in wallet connect modal (from wallet adapter packages)
- [x] Clean up ChatPage header — show only agent name + status + connected wallet indicator
- [x] Wallet hint is now a subtle info bar, no duplicate button
- [ ] More breathing room in chat messages

## Mobile Navigation — Sidebar Drawer

- [x] Remove MobileTabBar (bottom tab bar) from Dashboard.tsx
- [x] Add hamburger menu button to mobile header
- [x] Build MobileSidebarDrawer component (slide-over from left, swipe-right to open, tap outside to close)
- [x] Match drawer content to desktop sidebar (logo, nav items, agent status, connect button)
- [x] Add swipe-right gesture to open drawer
- [x] Remove bottom padding from content area (was needed for tab bar)

## Overview UX — Agent Chat as Hero

- [x] Replace OpenClaw Agent status card in MobileHeroBanner with Agent Chat CTA hero card
- [x] Remove duplicate Agent Chat from QuickActions grid (hero card handles it); replaced with History
- [x] Add compact agent status indicator (uptime pill) inside the hero card
- [x] Improve overall mobile Overview hierarchy: Chat first, then metrics, then market data

## Branding — Rename openclaw-agent to AFOS Agent

- [x] Replace all visible "openclaw-agent" in header with "AFOS Agent"
- [x] Replace all visible "OpenClaw Agent" text in dashboard with "AFOS Agent"
- [x] Renamed in Dashboard.tsx (header + sidebar agent card), SwapHistory.tsx (Executed By field), AgentSettings.tsx (settings section label), NetworkPage.tsx (self node alias)

## Agent Activity — Wire to Live SSE Stream

- [x] Found MobileAgentActivity uses useAgentLog() hook — same as Terminal
- [x] Found AgentLogContext was using a mock LIVE_POOL cycling random fake entries every 3.8s
- [x] Rewrote AgentLogContext to load real /api/agent/log history on mount
- [x] Wired real SSE events: agent_decision, agent_log, p2p_rfq, swap_executed, peer_connected, peer_disconnected
- [x] Removed all "openclaw" references from boot entries and live pool (now "afos:init", "afos:ready", "afos:decision")

## Agent Insights — Replace Activity Card + Hide Terminal Nav

- [x] Hide Terminal from sidebar nav items (keep page accessible via Full log link)
- [x] Replace MobileAgentActivity raw log card with Agent Insights widget
- [x] Agent Insights: decision type breakdown (MONITOR / BROADCAST_RFQ / WAIT counts with animated bars)
- [x] Agent Insights: last meaningful event in readable format (not raw log lines)
- [x] Agent Insights: confidence score trend (last 5 decisions, mini bar chart)
- [x] Agent Insights: Full log link still accessible for power users
- [x] Renamed AgentThoughtStream to AgentInsights consistently across desktop and mobile

## Branding + Agent Insights Polish

- [x] Rename "OpenClaw" in STACK strip to "AFOS Agent"
- [x] Add Swaps Executed counter to Agent Insights widget (desktop + mobile)
- [x] Improve Last Event display: parse swap token amounts and show "1 USDT → 0.0058 SOL" format

## Desktop Chart Iframe Height Fix
- [x] Reduce TradingView chart iframe height on desktop from 520px to 360px (chart controls now fully visible)
- [x] Mobile chart height untouched

## Timeframe Toolbar Fix
- [x] Replace iframe embed with TradingView Advanced Chart widget so interval prop actually controls the chart timeframe (desktop + mobile)

## Mini Chat Widget on Overview
- [x] Replace Agent Status card on Overview with embedded mini Agent Chat widget (shared chat state with ChatPage)

## Live Price Injection in Chat
- [x] Fix chat agent to inject live prices from CoinGecko (primary) into system prompt — Binance was geo-blocked from server

## Price Cache & UX Improvements
- [x] Add 30-second in-memory price cache to chat.ts to avoid CoinGecko rate limits
- [x] Add ETH price? and BTC price? quick-action chips to MiniChatWidget
- [x] Show price source in agent reply (e.g. "SOL is $84.11 (via CoinGecko, live)")

## Multi-Chain Wallet Expansion
- [ ] Research Tap Wallet API, Xverse Bitcoin wallet API, MetaMask/Coinbase EIP-1193
- [ ] Update Connect Wallet modal: group wallets by chain (Solana / Ethereum / Bitcoin)
- [ ] Implement Ethereum wallet connection (MetaMask + Coinbase Wallet via window.ethereum)
- [ ] Add ETH balance to Wallets panel
- [ ] Implement Bitcoin wallet connection (Xverse + Tap Wallet)
- [ ] Add BTC balance to Wallets panel
- [ ] Update agent chat to support ETH and BTC chain context in price/balance replies

## Bitcoin Reference Fix
- [ ] Replace all Lightning Network Bitcoin references with regular on-chain Bitcoin across the UI (status bar, IntercomSwap labels, swap descriptions)

## IntercomSwap Primary Route + Multi-Chain Wallets
- [ ] Replace all Lightning Network references in Swaps, SwapHistory, AgentSettings, NetworkPage, SwapPage, AgentLogContext
- [ ] Redesign ConnectWalletModal with chain tabs: Solana (Phantom/Solflare), Ethereum (MetaMask/Coinbase), Bitcoin (Xverse/Tap Wallet)
- [ ] Update swap routing: IntercomSwap primary for ALL chains; Jupiter fallback for Solana; 1inch fallback for Ethereum
- [ ] Update Wallets panel to show ETH and BTC balances when connected
- [ ] Update swap UI to show IntercomSwap as the route with fallback indicators

## Mempool.space BTC Balance Fetch
- [x] Fetch real on-chain BTC balance from Mempool.space for Xverse (BTC) and Tap Wallet (BTC+TNK) after connection

## BTC Balance Auto-Refresh + Chat ETH/BTC + Wallet Logos
- [x] Add 60s polling for BTC balance refresh in MultiChainWalletContext
- [x] Add real logos for MetaMask, Coinbase Wallet, Xverse, Tap Wallet in ConnectWalletModal (CDN hosted)
- [x] Extend chat agent intent parser to detect ETH and BTC swap requests (routes via IntercomSwap)

## Mobile Layout Parity

- [x] Rewrite MobileWalletStrip to show all 7 assets using ALL_ASSETS registry + MultiChainWalletContext + WalletContext (same data sources as desktop WalletsCard)
- [x] Replace MobileHeroBanner with embedded MiniChatWidget (mobile-optimized height ~360px) + compact portfolio strip above
- [x] Update mobile PortfolioCard to show live total across all chains (now uses MobilePortfolioStrip with same useMemo as desktop PortfolioCard)
- [x] Ensure quick chips render properly on mobile within MiniChatWidget (MiniChatWidget includes QUICK_CHIPS already)

## Quick Chip Slider UX

- [x] Replace horizontal scroll chips in MiniChatWidget with auto-cycling slider (carousel) — shows 3 chips at a time, auto-advances every 3s, prev/next arrows, dot indicators, pauses on hover/touch

## Agent Insights Card Fix

- [x] Make Agent Insights card content area vertically scrollable so Last Event is not clipped (desktop + mobile)

## MetaMask Native Bitcoin Support

- [x] Research MetaMask BTC API — uses CAIP-25 wallet_createSession with bip122:000000000019d6689c085ae165831e93 scope
- [x] Replace Xverse with MetaMask on Bitcoin tab of ConnectWalletModal
- [x] Add connectMetaMaskBitcoin() to MultiChainWalletContext using wallet_createSession + wallet_getSession fallback
- [x] Fetch BTC balance from Mempool.space after MetaMask BTC connection
- [x] Update BtcProviderType: "metamask" | "tap" | "phantom" (removed "xverse")
- [x] Remove sats-connect import (no longer needed)

## Tap Wallet Badge Uniformity

- [x] Add BTC (orange) + TNK (black) pill chips to Tap Wallet (no badge), matching Phantom/MetaMask chip style

## TNK Chip Dark Mode Fix

- [x] Fix TNK chip color on Tap Wallet: uses CSS foreground variable (white in dark mode, dark in light mode) via themeText:true flag

## Wallet Chip Uniformity

- [x] Add ETH chip to Coinbase Wallet (Ethereum tab) — replace plain text description
- [x] Add SOL chip to Solflare (Solana tab) — replace plain text description

## Swap Page Production-Ready (Remove Mock Data)

- [x] Audit all mock/simulated data in Swap page (Swap tab, Live Feed tab, Autopost tab)
- [x] Swap tab: live order book uses real prices from getPrices() for rate calculation (peer names remain as P2P network identifiers)
- [x] Swap tab: P2P peers now sourced from SSE peer_connected/peer_disconnected events + getAgentStatus()
- [x] Swap tab: Recent Swaps now fetched from getSwaps() API with loading/empty states
- [x] Swap tab: HTLC escrow section kept (factual), random tx hash replaced with rfqId
- [x] Live Feed tab: tries real WebSocket first, falls back to simulation with "Simulated" label (production-ready fallback)
- [x] Autopost tab: removed default mock task, starts empty with "New Task" CTA
- [x] All fallback empty states are informative ("No recent swaps", "Waiting for peers to announce...", etc.)
- [x] SwapHistoryTabs.tsx: replaced MOCK_OPEN_TRADES and MOCK_REFUNDS with live getSwaps() data
- [x] ChainStatsBar: removed mock/live toggle, shows "Binance Live" or "(fallback)" labels
- [x] SwapProgressTracker: replaced Math.random() tx hash with real rfqId
- [x] SwapPage.tsx: fully production-ready with real getPrices/getSwapQuote/submitRfq/executeSwap/getSwaps

## Swap Page — Full Production Wiring (SSE + executeSwap)

- [x] Live Order Book: replaced generateOrders() simulation with real SSE p2p_quote event subscriptions
- [x] Live Order Book: falls back to buildFallbackOrders() (seeded from live prices) after 3s if no real quotes arrive
- [x] Live Order Book: header/footer shows "SSE Live" (green) vs "Fallback" (amber) data source indicator
- [x] Live Order Book: empty state shows spinner while waiting for first P2P quotes
- [x] Swap execution: handleSwap now calls executeSwap() after submitRfq() to settle on-chain
- [x] Swap execution: real txHash captured from executeSwap() response (txHash/tx/txid fields)
- [x] SwapProgressTracker: shows real txHash with copy button and chain explorer link (Solscan/Etherscan/Mempool.space)
- [x] SwapProgressTracker: falls back to rfqId display if executeSwap() fails (e.g. no wallet keys on backend)
- [x] Live Feed tab: replaced WebSocket connection logic with onSSEEvent() subscriptions for all P2P event types
- [x] Live Feed tab: maps SSE event types (p2p_rfq, p2p_quote, swap_executed, peer_connected, etc.) to FeedMsgKind
- [x] Live Feed tab: falls back to simulation after 5s if no real SSE events arrive; shows "SSE Live" vs "Simulated" label
- [x] Live Feed tab: starts empty (no pre-seeded mock messages); simulation only activates on fallback

## Swap Page — Live Peer Count, History Refresh, Order Quote Persistence

- [x] Wire hardcoded "142" peer count in Swap tab header to real activePeerCount from getAgentStatus()
- [x] Add swap_executed SSE subscription to RecentSwaps to refresh history live after each settlement
- [x] Persist accepted order-book quote: pre-fill swap form with peer's rfqId as preferredPeer when "Accept" is clicked

## Swap Page — UI Bug Fixes

- [x] Fix token selector scroll arrows overflowing into the amount input field

## Swap Page — Agent Mode Toggle

- [x] Audit Agent Mode toggle: confirmed purely cosmetic (no separate execution path)
- [x] Removed AgentModeToggle component — execution is always via submitRfq + executeSwap regardless of toggle state

## Dashboard Footer — Live Status Bar

- [x] Wire AFOS Agent indicator to getAgentStatus() — live if status=active or activePeers present
- [x] Wire IntercomSwap indicator to isSSEConnected() — live if SSE stream is open
- [x] Wire Bitcoin indicator to getPrices() — live if BTC price > 0
- [x] Wire Solana indicator to getPrices() — live if SOL price > 0
- [x] Wire Ethereum indicator to getPrices() — live if ETH price > 0
- [x] Show live count of active services in "X/5 live" badge with color (green/amber/red)
- [x] Hover tooltip shows latency (ms) for each service
- [x] Poll every 30s + re-check IntercomSwap on SSE reconnect

## Swap Page — UX Improvements (Round 3)

- [x] Add quote expiry countdown ("Rate valid for 30s") with auto-refresh when expired — color shifts green→amber→red
- [x] Add selected-peer badge above Swap button with alias and clear (×) button
- [x] Add "Send to Agent" button that pre-fills chat with current swap params and navigates to Agent Chat
- [x] Wire ChatPage to read sessionStorage prefill on mount and auto-focus input

## Swap Page — Unified Mode-Aware Button

- [x] Replace two separate buttons (Swap Now + Send to Agent Chat) with single mode-aware button
- [x] Add segmented Manual/Agent toggle above the swap button (blue for Manual, purple gradient for Agent)
- [x] Manual mode: button says "Swap Now" with Zap icon, blue bg — calls submitRfq → executeSwap
- [x] Agent mode: button says "Send to Agent" with Bot icon, purple gradient bg — auto-sends swap command to chat
- [x] Wire Agent mode to auto-send message via sessionStorage afos_chat_autosend flag + ChatPage handleSend on mount

## Swap Button — Replace Segmented Control with Compact Toggle

- [x] Replace full-width segmented Manual/Agent control with small toggle switch + label

## Swap Wallet Connect Modal Fixes

- [ ] Fix duplicate MetaMask in wallet connect modal
- [ ] Fix chain label — should say FROM token's chain, not always "Solana"
- [ ] Filter wallet list to show only chain-compatible or multi-chain wallets based on FROM token

## ChatPage Wallet Connect Fix

- [x] Replace Solana adapter modal with ConnectWalletModal in ChatPage for swap quote cards
- [x] Pass correct defaultChain based on swap's FROM token (e.g., bitcoin for BTC→USDT)
- [x] Fix duplicate MetaMask issue (Solana adapter modal shows MetaMask twice)

## ChatPage — Fix TOKEN_CHAIN Multi-Chain Mapping

- [x] Fix TOKEN_CHAIN: USDT/USDC exist on both Ethereum and Solana — use fromChain from quote, fallback only for unambiguous symbols

## ChatPage Footer — Update Powered By Text

- [x] Change "Powered by Jupiter" to mention all three: IntercomSwap P2P · Jupiter · 1inch

## Dashboard Header — Live Data

- [x] Replace hardcoded "intercomswap@mainnet" with live agent/node identity from backend
- [x] Replace hardcoded "0000intercomswapbtcusdt" with live active pair or last swap pair
- [x] Replace hardcoded "3 peers" with live peer count from backend

## Dashboard Header — UX Improvements

- [x] Add tooltip on node key showing full key + copy button
- [x] Make peers pill clickable to navigate to Network page

## Dashboard Header — Real-time UX Polish

- [x] Add sonner toast on node key copy
- [x] Peer pill flash animation (green/red) on SSE peer_connected/peer_disconnected
- [x] Real-time headerLastPair update via SSE swap_executed event

## Wallet Connection UX Polish

- [x] Improve toast visual in light mode (custom rich toast with chain chips, address, green border)
- [x] Add connected success animation overlay to ConnectWalletModal with auto-dismiss after 1.6s

## Wallets Panel Redesign — Two-Section Split

- [x] Split WalletsCard into "My Wallets" (browser) and "AFOS Node Wallet" (agent) sections
- [x] My Wallets: SOL, USDT/SOL, USDC/SOL (from Phantom/Solflare via WalletContext), ETH, USDT/ETH, USDC/ETH (from MetaMask via MultiChainWalletContext), BTC (from MetaMask/Tap via MultiChainWalletContext)
- [x] AFOS Node Wallet: SOL, USDT/SOL, USDC/SOL, ETH, USDT/ETH, USDC/ETH, BTC — all from backend /api/wallet, show node address for each chain
- [x] Show node wallet address (from backend nodeKey/address field) inline for each asset
- [x] Show "not connected" for browser wallets not yet connected, "no balance" for node assets not yet funded
- [ ] Update mobile WalletStrip to match the same two-section structure

## Swap UI Redesign — Uniswap-style Compact Card

- [ ] Constrain swap card to max-width ~480px, centered on page
- [ ] Compact token selector rows (icon + name + chain, amount input on same row)
- [ ] Large amount input field like Uniswap (big number, USD below)
- [ ] Tighter fee summary section
- [ ] Keep all existing state/logic (route chips, agent mode toggle, send button)

## Swap UI Redesign — Uniswap-style Compact Card

- [x] Redesign swap card to Uniswap-style compact layout (max 480px, unified token+amount panels, collapsed fee line)
- [x] Sell/Buy panels: big amount input on left, token pill selector on right (with dropdown)
- [x] Compact flip button between panels
- [x] Fee summary collapsed into single line (expandable via Advanced settings toggle)
- [x] Protocol chips as small rounded pills instead of large badges
- [x] Right panel (order book, peers, recent swaps) flows beside card on xl, below on mobile

## Swaps Page — Full Professional Redesign
- [x] Redesign entire Swaps page layout with cohesive professional DEX styling
- [x] Clean up TradingView chart — proper card with header showing pair name, styled border
- [x] Polish swap card — tighter spacing, better visual hierarchy
- [x] Redesign order book — below chart in left column, cleaner table
- [x] Redesign P2P peers and recent swaps — right column below swap card
- [x] Redesign HTLC escrow info — compact, integrated below order book
- [x] Improve overall spacing, shadows, borders, visual consistency
- [x] Make the whole page feel like one cohesive professional DEX product
- [x] Remove WBTC from token list, add USDT/ETH and USDC/SOL
- [x] Update SWAP_PAIRS to cover all 7 supported assets
- [x] Add TradingView chart paired to selected token pair

## Swaps Page — UX Polish Round 4

- [x] Token dropdown: click-outside-to-close behavior
- [x] Token dropdown: show chain label (Ethereum/Solana) next to each stablecoin
- [x] TradingView chart: sync light/dark theme with app theme toggle
- [x] Price impact warning: yellow/red banner in Buy panel when impact > 1%

## Swaps Page — Compact & Centered Layout

- [x] Constrain outer wrapper to max-w-[1280px] and center with mx-auto
- [x] Tighten padding and gaps throughout the page (gap-3, space-y-3)
- [x] Make the chart + swap card top row more proportional (360px right column)
- [x] Compact the bottom panels (order book, peers, recent swaps)

## Swaps Page — Token Balance Auto-Refresh + Swap History Detail View

- [x] Wire Sell panel balance to live on-chain data from WalletContext (Solana) and MultiChainWalletContext (ETH/BTC)
- [x] Auto-refresh Solana balances every 15 seconds via refreshBalances() interval
- [x] MAX button uses live getTokenBalance() — shows actual on-chain amount, not hardcoded static value
- [x] Live balance indicator: pulsing green dot next to balance when wallet is connected and live data is present
- [x] Expandable Recent Swaps rows: click any row to expand full transaction detail panel
- [x] Detail panel shows: full tx hash with copy button, block explorer link (Solscan/Etherscan/mempool.space), ISO timestamp, USD value, counterparty/peer name, route type, platform fee, chain
- [x] Copy button shows checkmark confirmation for 2 seconds after copy
- [x] Smooth AnimatePresence expand/collapse animation on detail panel
- [x] Recent Swaps shows up to 8 entries (was 5), with count badge in header
- [x] "Click row for details" hint in Recent Swaps header

## Light Peer Registration — Browser Wallet as P2P Node (Mass Adoption)

### Goal: Every wallet connection = a peer on the IntercomSwap network. No server required.

- [x] Audit Oracle VM API for peer announce/heartbeat/quote endpoints
- [x] Design LightPeerContext: wallet-derived peer identity (pubkey as node key), quote engine, HTLC signing
- [x] Build LightPeerContext provider: auto-announce on wallet connect, heartbeat every 30s, handle incoming RFQs via SSE
- [x] Build quote engine: calculate competitive quotes from live prices + user-set spread/slippage preferences
- [x] Build LightPeerPanel UI component: peer status (online/offline), quote settings (spread, accepted pairs, min/max size), active incoming RFQs
- [x] Add peer badge to Swaps page header showing "You are a peer" when light peer is active
- [x] Wire light peer into order book: show user's own quotes in the live order book

## Wallet Connection Toast — Unified Single Toast

- [x] Remove duplicate toast.success from MultiChainWalletContext (Phantom + ETH + BTC)
- [x] Upgrade WalletConnectedToast to show per-chain address rows (Solana / Ethereum / Bitcoin)
- [x] Single rich toast card shows all connected wallet addresses when Phantom connects all chains
- [x] Handle incoming RFQ: show notification/toast when someone wants to trade with you, allow accept/reject
- [x] In-browser HTLC signing: use connected wallet to sign HTLC lock transaction when accepting a trade
- [x] Graceful disconnect: send peer_disconnected announcement when wallet disconnects or tab closes
- [x] Persist peer preferences (spread, pairs, limits) in localStorage

## Wallet UX — Disconnect Toast + Topbar Badge

- [x] Unified disconnect toast: replace separate per-chain disconnect toasts with one card listing dropped chains
- [x] Export showWalletDisconnectedToast from ConnectWalletModal and call from contexts
- [x] Persistent multi-chain badge in topbar: SOL/ETH/BTC colored dots reflecting live connection status
- [x] Badge opens Connect modal on click for quick wallet management

## Advanced P2P Features — Order Book, HTLC, Reputation

- [x] Order book: inject own light peer quote as highlighted "You" row with live rate vs other nodes
- [x] Order book: show rate delta (better/worse %) vs best competing quote
- [x] In-browser HTLC signing: prompt wallet to sign lock tx on RFQ accept (Solana + ETH)
- [x] HTLC signing: show step-by-step progress (Lock → Reveal → Settle) in accept dialog
- [x] Peer reputation score: track trades completed / quotes given per peer ID in localStorage
- [x] Reputation badge: display score (0–100) and tier (New/Trusted/Elite) in order book rows
- [x] Reputation: persist cross-session in localStorage, seed from SSE peer_connected events

## Bitcoin HTLC Atomic Swap — Browser + Agent

### Goal: BTC HTLC signing works in both browser (Xverse/Tap Wallet via PSBT) and AFOS agent (server-side via mempool.space)

- [x] Audit all four BTC wallet signing APIs: Phantom (window.phantom.bitcoin.signPSBT), Xverse (window.XverseProviders.BitcoinProvider.signPsbt), Tap Wallet (window.tapwallet.signPsbt), MetaMask Snaps (BTC snap via wallet_invokeSnap)
- [x] Build shared client-side BTC HTLC utilities (client/src/lib/btcHtlc.ts): P2WSH script builder, PSBT constructor (bitcoinjs-lib v7 + @noble/hashes), secret hash generator, provider auto-detection
- [x] Provider detection: detect which BTC wallet is active (Phantom native SegWit / Xverse / Tap Wallet / MetaMask Snap) and route to correct signPsbt() call
- [x] Extend LightPeerContext acceptRfq() with BTC path: build P2WSH PSBT, call detected provider's signPsbt(), broadcast signed PSBT via mempool.space /api/tx
- [x] Show BTC HTLC steps in same Lock → Reveal → Settle progress dialog (reuse existing HtlcStep flow)
- [x] Build server-side BTC HTLC router (server/routers/btcHtlc.ts): build raw HTLC tx, sign with ecpair/WIF, broadcast via mempool.space API
- [x] Add tRPC procedure: btcHtlc.htlcLock — agent locks BTC in P2WSH HTLC escrow
- [x] Add tRPC procedure: btcHtlc.htlcReveal — agent reveals secret and claims counterparty funds
- [x] Add tRPC procedure: btcHtlc.htlcRefund — agent reclaims BTC after CLTV timeout
- [x] Add tRPC procedure: btcHtlc.htlcStatus — polls mempool.space for confirmation count and HTLC state
- [x] Wire agent BTC HTLC into chat intent parser: chat.executeBtcSwap procedure + ChatPage/Dashboard BTC path
- [x] MultiChainWalletContext: expose btcSignPsbt() helper that auto-routes to Phantom/Xverse/Tap/MetaMask signPsbt API
- [x] Xverse added as fully supported BTC provider in connectBitcoin flow

## BTC Agent — IntercomSwap P2P Path

- [x] Wire BTC agent swap through IntercomSwap RFQ (submitRfq → poll quotes → pick best peer → htlcLock)
- [x] Fallback: if no IntercomSwap peer found within timeout, fall back to direct mempool.space HTLC
- [x] chat.executeBtcSwap: add toToken/toChain/skipP2P inputs for P2P discovery control
- [x] chat.executeBtcSwap: Step 1 queries Oracle VM /api/rfq with 8s timeout, extracts counterpartyPubKey
- [x] chat.executeBtcSwap: resolvedCounterpartyPubKey prefers P2P peer, falls back to manual input
- [x] chat.executeBtcSwap: response includes route ("IntercomSwap P2P" vs "Direct HTLC") and p2pQuote metadata
- [x] Vitest coverage: 12 tests for router structure, input schema validation, and P2P discovery logic

## Unified 3-Chain Agent Swap Architecture (P2P-first)

- [x] executeEthSwap tRPC procedure: IntercomSwap P2P primary + 1inch aggregator fallback
- [x] executeEthSwap: submitIntercomSwapRfq shared helper (8s timeout, Oracle VM /api/rfq)
- [x] executeEthSwap: get1inchSwapTx helper builds executable eth_sendTransaction calldata
- [x] executeEthSwap: returns route ("IntercomSwap P2P" | "1inch (Ethereum)" | "unavailable")
- [x] executeEthSwap: returns tx { to, data, value, gas } for 1inch route
- [x] executeEthSwap: returns p2pQuote + nextStep for P2P route (HTLC via LightPeerContext)
- [x] buildSwapTx (Solana): upgraded to IntercomSwap P2P primary + Jupiter DEX fallback
- [x] buildSwapTx: accepts new optional fields: fromToken, toToken, amount, fromChain, toChain, skipP2P
- [x] buildSwapTx: cross-chain with no P2P peer throws descriptive error (Jupiter is Solana-only)
- [x] ChatPage: executeEthSwap mutation wired; routes ETH swaps to P2P or eth_sendTransaction
- [x] ChatPage: Solana swaps now use P2P-first buildSwapTx (P2P route or Jupiter fallback)
- [x] Dashboard.tsx: buildSwapTx updated to handle new return type (swapTransaction | null)
- [x] TypeScript: 0 errors across all files after multi-chain refactor
- [x] Vitest: 35 tests pass (17 new multi-chain tests + 12 BTC P2P + 5 chat + 1 auth)

## Phase: Full Unified 3-Chain Architecture (P2P-first + Analytics + HTLC Monitor)

- [x] DB schema: htlc_swaps table (id, chain, htlcAddress, secretHash, amountSats/Wei/Lamports, status, locktime, createdAt, refundedAt)
- [x] DB schema: swap_analytics table (id, chain, fromToken, toToken, amount, amountUsd, route, settlementMs, status, createdAt)
- [x] DB migration pushed (pnpm db:push)
- [x] QuoteCard: styled P2P route badge (chain icon + "IntercomSwap P2P" vs "Jupiter DEX" vs "1inch" vs "Direct HTLC")
- [x] QuoteCard: show fromChain → toChain chain pill (e.g. SOL → ETH cross-chain indicator)
- [x] HTLC timeout monitor: server/htlcMonitor.ts — background poller checking pending HTLCs, auto-triggers refund on CLTV expiry
- [x] HTLC monitor: BTC branch — polls mempool.space /api/blocks/tip/height for block height
- [x] HTLC monitor: ETH branch — polls Cloudflare Ethereum RPC for block number
- [x] HTLC monitor: SOL branch — polls mainnet-beta getSlot RPC
- [x] HTLC monitor auto-triggers refund, updates status to 'refunded', sets refundTxId + refundedAt
- [x] Wire HTLC monitor startup in server/_core/index.ts
- [x] Cross-chain path-finder: server/pathFinder.ts — finds multi-hop routes (BTC→USDT→SOL) when no direct P2P peer
- [x] Path-finder: findSwapPath + getSupportedPairs tRPC procedures
- [x] pathFinderRouter registered in routers.ts
- [x] Swap analytics page: SwapAnalytics.tsx — volume by chain, avg settlement time, HTLC success/refund ratio, peer reputation
- [x] Analytics: "Analytics" nav item added to Dashboard sidebar
- [x] analyticsRouter: 7 DB-backed procedures (volumeByChain, settlementTime, htlcRatio, peerLeaderboard, routeDistribution, recentSwaps, summary)
- [ ] 1inch API key: set ONEINCH_API_KEY secret (deferred by user)
- [x] Vitest tests for htlcMonitor, pathFinder, and analyticsRouter (19 new tests)
- [x] All 54 tests passing, 0 TypeScript errors

## Bug Fix: Dashboard toFixed crash

- [x] Fix TypeError: Cannot read properties of undefined (reading 'toFixed') in RecentSwapsCard (line 935-936)
- [x] Fix same issue in mobile MobileRecentSwaps section (line 2285-2286)
- [x] Added null guards: (s.inAmount ?? 0) and (s.outAmount ?? 0) before .toFixed()/.toString()

## Phase: Full HTLC Completion + DB Analytics Wiring

### DB Analytics Recording
- [ ] executeBtcSwap: call recordHtlcLock() + recordSwapAnalytic() after P2P match or HTLC lock
- [ ] executeEthSwap: call recordHtlcLock() + recordSwapAnalytic() after P2P match or 1inch route
- [ ] buildSwapTx (Solana): call recordHtlcLock() + recordSwapAnalytic() after P2P match or Jupiter route
- [ ] Analytics dashboard shows real data from DB

### Ethereum HTLC.sol
- [ ] Write HTLC.sol smart contract (ETH + ERC-20 hashlock + timelock, lock/claim/refund)
- [ ] Compile HTLC.sol and extract ABI + bytecode
- [ ] Deploy HTLC.sol to Sepolia testnet (requires ETH_DEPLOYER_KEY + Sepolia ETH)
- [ ] Store deployed contract address in env (HTLC_CONTRACT_ADDRESS_SEPOLIA)
- [ ] Wire real ABI-encoded lock() call in executeEthSwap (replace placeholder)
- [ ] Wire real ABI-encoded lock() call in LightPeerContext ETH branch
- [ ] Wire ETH_AGENT_KEY for htlcMonitor refund() trigger

### Solana HTLC Program
- [ ] Research existing Solana HTLC programs (SPL or Anchor-based)
- [ ] Implement Solana HTLC PDA instruction builder using @solana/web3.js
- [ ] Replace mock signTransaction in LightPeerContext Solana branch with real PDA instruction
- [ ] Wire SOL_AGENT_KEY for htlcMonitor PDA close trigger

### Agent Keys
- [ ] Set BTC_AGENT_WIF secret (enables real BTC HTLC execution)
- [ ] Set ETH_AGENT_KEY secret (enables ETH HTLC monitor refund trigger)
- [ ] Set SOL_AGENT_KEY secret (enables SOL HTLC monitor PDA close)

## Bug Fix: RecentSwaps toFixed crash (recurring — deeper fix)

- [x] Find all .toFixed() calls on potentially-undefined swap fields in RecentSwaps and related components
- [x] Fix Swaps.tsx: swap.inAmount.toFixed(4), swap.outAmount.toFixed(4), usdValue.toFixed(2) — all guarded with ?? 0
- [x] Fix Dashboard.tsx: quoteData.toAmount/fromAmountUsd/toAmountUsd/platformFee/platformFeeUsd/priceImpact — all guarded
- [x] Fix ConnectWalletModal.tsx: b.usdValue.toFixed(2) — guarded with ?? 0
- [x] Fix SwapHistory.tsx: division-by-zero guard on rate calculation (fromAmount > 0 check)
- [x] Fix afosApi.ts getSwaps(): added defensive numeric coercion in normalise() for inAmount/outAmount/rate
- [x] Fix afosApi.ts getStats(): added defensive Number() coercion for all numeric fields
- [x] 54 tests still passing, 0 TypeScript errors

## Restructure: AFOS Agent Wallet → Admin, Platform Liquidity → Analytics

- [x] Move AFOS Agent wallet tab from Dashboard wallets panel to /admin page (admin-gated)
- [x] Remove "AFOS Agent" tab from the Dashboard wallet panel (keep "My Wallets" only for regular users)
- [x] Add Platform Liquidity section to Analytics page (reserves by chain, utilization, total value)
- [x] Admin page is password-gated (operator access only)

## Admin Agent Wallet — HTLC Wallet Section

- [x] Add backend tRPC procedure to derive BTC/ETH/SOL HTLC wallet addresses from stored keys and fetch on-chain balances
- [x] Add AFOS Agent HTLC Wallet card below Hot Wallet in Admin Agent Wallet tab
- [x] Show BTC address (P2WPKH from WIF), ETH address (from private key), SOL address (from keypair)
- [x] Show on-chain balances for each HTLC address (BTC via mempool.space, ETH via etherscan/RPC, SOL via RPC)
- [x] Write vitest tests for htlcWallet router (6 tests — structure, missing keys, ETH derivation)

## ETH RPC + HTLC Transaction History

- [x] Add ETH_RPC_URL secret (Infura) and update htlcWallet router to use it with Cloudflare as fallback
- [x] Add HTLC transaction history section to Admin panel showing recent lock/claim/refund transactions per chain
- [x] Backend: tRPC htlcWallet.getHtlcHistory procedure queries htlc_swaps table with chain filter and limit
- [x] Frontend: HTLC Tx History section in Admin Agent Wallet tab with All/BTC/ETH/SOL filter tabs, status badges, chain icons, timeAgo, and empty state

## Oracle VM Hot Wallet Rename + Asset Expansion

- [x] Rename "AFOS Agent Hot Wallet" to "AFOS Oracle VM Node Hot Wallet" in Admin panel
- [x] Add mergeWithAllAssets() helper to afosApi.ts — fills in all 7 assets (SOL, USDT/SOL, USDC/SOL, BTC, ETH, USDT/ETH, USDC/ETH) with 0 balance for any not returned by Oracle VM
- [x] Apply mergeWithAllAssets in Admin panel fetchNodeWallet and Analytics PlatformLiquidity fetchData

## Admin Wallet Cards — Addresses, QR Codes, and HTLC Refund DB Write

- [x] Add backend tRPC procedure (htlcWallet.getOracleVmAddresses) to derive all 7 wallet addresses from agent keys (SOL, USDT/SOL, USDC/SOL, BTC, ETH, USDT/ETH, USDC/ETH)
- [x] Update Oracle VM Node Hot Wallet balance cards to show real addresses with copy + QR button + chain badge (matching HTLC card pattern)
- [x] Add QR code modal (react-qr-code) to both Oracle VM and HTLC wallet cards — click QR icon to open modal with scannable code
- [x] Wire HTLC monitor refund trigger to write htlc_swaps rows (confirmed already done in htlcMonitor.ts lines 229-235)
- [x] Fix test timeout — added { timeout: 30_000 } to live RPC test (60 tests pass)

## Oracle VM Node Hot Wallet — 3-Chain Setup

- [x] Generate new dedicated SOL wallet for Oracle VM Node Hot Wallet (DRipB6UHbcK9NXrvRUjkge1ungV65U1U8eun74KhP5rR)
- [x] Generate new dedicated ETH wallet for Oracle VM Node Hot Wallet (0x4d171Af4aa3E78D65bd25a6599eB05f76fF8fAdd)
- [x] Generate new dedicated BTC wallet for Oracle VM Node Hot Wallet (bc1qee49tcut6rf2mmsnpa5kmmzttk7w09hfskcvtm)
- [x] Update Oracle VM server.js to support AGENT_WALLET_ADDRESS (SOL), AGENT_ETH_ADDRESS (ETH), AGENT_BTC_ADDRESS (BTC)
- [x] Add ETH balance fetching (eth_getBalance via ETH_RPC_URL) to Oracle VM
- [x] Add ERC-20 USDT/USDC balance fetching (eth_call balanceOf) to Oracle VM
- [x] Add BTC balance fetching (mempool.space API) to Oracle VM
- [x] Add SOL USDC balance fetching (getTokenAccountsByOwner with USDC mint) to Oracle VM
- [x] Set AGENT_WALLET_ADDRESS, AGENT_ETH_ADDRESS, AGENT_BTC_ADDRESS in Oracle VM ecosystem.json
- [x] Restart Oracle VM PM2 process with new env vars — all 7 assets return live=true
- [x] Fix inferChainFromNetwork() in afosApi.ts so ETH USDT/USDC map to ethereum chain correctly
- [x] All 60 tests passing, 0 TypeScript errors

## HTLC Wallet — Full 7-Asset Token Balances

- [x] Set ETH_RPC_URL (Infura) in Oracle VM ecosystem.json and restart PM2
- [x] Extend htlcWallet.ts getSolHtlcWallet() to also fetch USDT/SOL and USDC/SOL SPL token balances
- [x] Extend htlcWallet.ts getEthHtlcWallet() to also fetch USDT/ETH and USDC/ETH ERC-20 balances
- [x] Update getHtlcWallets tRPC procedure to return all 7 assets (not just SOL/ETH/BTC)
- [x] Update HtlcWalletSection UI to render all 7 asset rows with chain badges and QR codes
- [x] Update htlcWallet tests to cover new token balance fields

## Bug Fix — USDT/USDC SOL showing "pending" instead of "live 0.00"

- [x] Fix fetchSplBalance to return 0 (not null) when wallet has no token account — empty accounts array = 0 balance, not an error
- [x] Fix live flag for SPL/ERC-20 tokens: if the RPC call succeeded (even with 0 balance), set live=true not pending
- [x] Fix balance display: show "0.00" not "—" when balance is 0

## Portfolio Totals + Oracle VM Health + Analytics Wiring

- [x] Add /api/health endpoint to Oracle VM server.js reporting ETH_RPC_URL, uptime, and RPC connectivity
- [x] Add oracleVmHealth state to AdminPanel fetching Oracle VM /health endpoint on refresh
- [x] Always show portfolio total row in HTLC Wallet header (remove totalUsd > 0 guard)
- [x] Always show portfolio total row in Oracle VM Node Hot Wallet header
- [x] Surface Oracle VM RPC health badges (ETH/SOL/BTC) in Admin panel Agent Wallet tab
- [x] Confirmed Platform Liquidity in Analytics is wired to Oracle VM /api/wallet balances (already correct)

## Bug Fixes — Header Wallet Badge + Peer Count

- [x] Fix header wallet badge: show SOL dot when Solana wallet is connected — now checks both wallet-adapter connected AND phantomMultiChain.chains.includes('solana')
- [x] Fix peer count: include local Light Peer as +1 when it is ONLINE and active — total = Oracle VM activePeers + (lightPeerOnline ? 1 : 0)

## Network Page — Production Ready + P2P Bridge + Peer Tooltip

- [ ] Add relay bridge endpoints on Oracle VM to forward RFQs between Hyperswarm and IntercomSwap networks
- [x] Rewrite Network Topology tab: replace mock peers (GammaNode, AlphaNode, etc.) with live data from Oracle VM /api/peers
- [x] Rewrite Network Topology stats (Online Peers, Active Channels, 24h Volume, Avg Latency) with live Oracle VM data
- [x] Rewrite Peer Directory sidebar with live peer list from Oracle VM
- [x] Rewrite Active Channels sidebar with live channel data from Oracle VM
- [x] Rewrite Network LN Channels tab: replaced mock channels with empty state + real Open Channel form
- [x] Rewrite Network Invites tab: replaced mock invites with empty state + real Generate form
- [x] Add "You (Light Peer)" row at top of Peer Directory when Light Peer is online
- [x] Add peer count tooltip to header showing breakdown: "X Light Peer (you) · Y remote nodes"
- [x] Remove all hardcoded mock data from Network page — all PEERS/CHANNELS arrays replaced with live Oracle VM + Light Peer data
