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

- [x] Add relay bridge endpoints on Oracle VM to forward RFQs between Hyperswarm and IntercomSwap networks
- [x] Rewrite Network Topology tab: replace mock peers (GammaNode, AlphaNode, etc.) with live data from Oracle VM /api/peers
- [x] Rewrite Network Topology stats (Online Peers, Active Channels, 24h Volume, Avg Latency) with live Oracle VM data
- [x] Rewrite Peer Directory sidebar with live peer list from Oracle VM
- [x] Rewrite Active Channels sidebar with live channel data from Oracle VM
- [x] Rewrite Network Liquidity Channels tab: replaced mock channels with empty state + real Open Channel form (now wired to Oracle VM)
- [x] Rewrite Network Invites tab: replaced mock invites with empty state + real Generate form
- [x] Add "You (Light Peer)" row at top of Peer Directory when Light Peer is online
- [x] Add peer count tooltip to header showing breakdown: "X Light Peer (you) · Y remote nodes"
- [x] Remove all hardcoded mock data from Network page — all PEERS/CHANNELS arrays replaced with live Oracle VM + Light Peer data

## Relay Bridge + Ping + Liquidity Channels

- [x] Add /api/relay/announce endpoint on Oracle VM — accepts IntercomSwap Light Peer announcements and stores them in a relay registry
- [x] Add /api/relay/peers endpoint on Oracle VM — returns merged list of Hyperswarm peers + relayed IntercomSwap peers
- [x] Broadcast Oracle VM Hyperswarm peers to IntercomSwap DHT via relay bridge
- [x] Add /api/peers/:id/ping endpoint on Oracle VM — probes a peer and returns latency in ms
- [x] Add Ping button to each peer row in Peer Directory with real-time latency update
- [x] Add /api/channels and /api/channels/open endpoints on Oracle VM for real channel management
- [x] Wire Open Channel form in Network page Liquidity Channels tab to Oracle VM /api/channels/open
- [x] Rename "LN Channels" → "Liquidity Channels" throughout the app (tab label, page title, all references)

## Relay Auto-Announce + Peer Reputation + Channel Health

- [x] Add relay auto-announce to LightPeerContext: announce on startup and re-announce every 60s
- [x] Add relay auto-announce to Oracle VM oracle-server.js: announce Hyperswarm peers to relay registry on connect/disconnect
- [x] Add peer reputation scoring: compute score from successful swaps, uptime, avg latency stored in DB
- [x] Add reputation DB table and server-side update logic (increment on swap success, decrement on failure)
- [x] Wire reputation score to Peer Directory badge (color-coded: green/amber/red)
- [ ] Add sort/filter by reputation to Peer Directory (future)
- [x] Add channel health heartbeat: ping each open channel every 30s from frontend
- [x] Add /api/channels/:id/health endpoint on Oracle VM
- [x] Show warning badge on unresponsive channels in Liquidity Channels tab
- [ ] Add channel health status to Active Channels sidebar (future)

## Peer Directory Sort/Filter + Swap Reputation Update

- [x] Add sort dropdown to Peer Directory: by Reputation (desc), Latency (asc), Channels (desc), Alias (A-Z)
- [x] Add filter toggle: show All / Online Only / High Reputation (≥80)
- [x] Sort remote peers in PeerList by selected criterion
- [x] Add recordSwap tRPC procedure to peerReputation router (already existed)
- [x] Wire swap_executed SSE event in NetworkPage to call recordSwap for the counterparty peer
- [x] Update reputation score computation to weight swap history more heavily

## Dual-DHT Network UI Fix

- [x] Update Network page empty state to mention both Hyperswarm DHT and IntercomSwap DHT
- [x] Update scanning badge to show both layers (Hyperswarm + IntercomSwap) with individual status
- [x] Update header subtitle to reflect dual-DHT topology
- [x] Show Light Peer connection status separately from Oracle VM status in the Network header

## Unified Analytics Leaderboard

- [x] Add getPeerLeaderboard tRPC procedure that joins swap history with peerReputation data
- [x] Rewrite Analytics P2P Peer Leaderboard table with columns: Alias, Layer (HW/IS), Score, Swaps, Volume, Avg Latency, Last Seen
- [x] Add layer badge (HW green / IS cyan) to each row
- [x] Add reputation score badge (color-coded 0-100) to each row
- [x] Sort leaderboard by score desc by default, allow sort pill buttons (Score/Swaps/Volume/Latency)

## Peer Detail Drawer + Score Label Fix

- [x] Add analytics.peerDetail tRPC procedure: returns swap history, ping stats, channel history for a given peerId
- [x] Build PeerDetailDrawer slide-over component with tabs: Overview, Swaps, Channels, Open Channel shortcut
- [x] Wire leaderboard rows to open PeerDetailDrawer on click
- [x] Add "All Time" tooltip/label to Score column header in leaderboard
- [x] Pre-fill Open Channel form with selected peer's ID when opened from drawer (via sessionStorage + custom event)

## Peer Notes/Tags + Keyboard Navigation

- [x] Add notes (text) and tags (JSON array) columns to peerReputation schema
- [x] Push DB migration for notes/tags columns
- [x] Add peerReputation.updateNotes tRPC mutation (upsert notes + tags for a peerId)
- [x] Add notes textarea and tag chip UI to PeerDetailDrawer Overview tab
- [x] Add Escape key handler to close drawer
- [x] Add ArrowUp/ArrowDown key handler to cycle through leaderboard rows
- [x] Show current row index indicator in drawer header (e.g. "3 / 12")

## Peer Directory: Origin Badge + Reputation-Gated Invite

- [x] Add HW/IS origin badge next to peer alias in Peer Directory (desktop table + mobile cards)
- [x] Add Invite button to each remote peer row — enabled only when reputation score >= 70
- [x] Show tooltip on disabled Invite button explaining the score threshold
- [x] Invite button opens Open Channel form pre-filled with that peer's ID

## Overview Stat Cards Audit + Enhancement

- [x] Enhance Active Peers card: show HW/IS dual-layer breakdown below the main count
- [x] Audit Total Volume card: reads from Oracle VM /api/stats; shows 'no data' hint when zero
- [x] Audit Fees Collected card: reads from Oracle VM /api/stats; shows 'no data' hint when zero
- [x] Audit P2P Ratio card: reads from Oracle VM /api/stats; shows 'P2P vs DEX' hint when no swaps
- [x] Fixed hardcoded +3.2%/+12.4% change badges; replaced with 'no data' / 'live' / 'earned' contextual labels

## Swaps Page Layout Reorder

- [x] Move Swap form to the top of the Swaps page (before chart and order book) on mobile; desktop 2-col layout unchanged

## Swaps Page Polish

- [x] Rename page title "Agentic Swap" → "AFOS"
- [x] Reorder mobile sections: Swap card, Chart (collapsible), Live Order Book, Recent Swaps, Light Peers, P2P Peers, HTLC Escrow
- [x] Sticky swap card column on desktop (position: sticky, top offset)
- [x] Collapsible chart on mobile with "Show chart ↓" toggle

## Chart Pair Selector + Best Rate Badge

- [x] Add chart pair selector to TradingView chart header (BTC/USDT, ETH/USDT, SOL/USDT, ETH/BTC, SOL/BTC) — independent of swap pair
- [x] Add "Best rate" badge to Live Order Book top offer — compares P2P rate vs Jupiter DEX (SOL pairs) and 1inch DEX (ETH pairs, API key placeholder)
- [x] Add dexBestRate state: fetch Jupiter quote for BTC/SOL pairs, 1inch quote stub for ETH pairs
- [x] Highlight top offer row in green when P2P rate beats DEX reference rate
- [x] Show badge "★ Best · beats Jupiter by X%" or "★ Best · beats 1inch by X%" on top row
- [x] 1inch API key wired via VITE_ONEINCH_API_KEY env var (placeholder, activate when user provides key)

## Chart Selector Custom Input + DEX Depth Row

- [x] Custom symbol input field in chart header — type any TradingView symbol (e.g. BINANCE:BNBUSDT) and press Enter to load
- [x] DEX depth row in order book header — show Jupiter/1inch quoted output for the exact current swap size (apples-to-apples vs P2P offers)

## Watchlist + Debounced DEX Depth

- [x] Save to watchlist button next to active custom symbol pill (bookmark icon)
- [x] Watchlist persisted in localStorage under key "afos_chart_watchlist"
- [x] Watchlist symbols appear as extra preset pills in the chart header (after the 5 defaults)
- [x] Remove from watchlist button on watchlist pills (×)
- [x] Debounce DEX depth quote refresh — 500ms after fromAmount changes, re-fetch Jupiter/1inch quote
- [x] Show loading spinner in DEX depth row while debounced fetch is in-flight

## Mobile Order Book Redesign

- [x] Replace cramped 5-column table rows with card-per-offer layout on mobile (sm breakpoint)
- [x] Each mobile card: peer name + badge top-left, rate large top-right, offer amount + USD value bottom-left, expires + Accept button bottom-right
- [x] Best rate badge displayed prominently below peer name on mobile card
- [x] Keep desktop table layout unchanged (only affects mobile)
- [x] Improve header on mobile: stack DEX depth row below offer count, larger text
- [x] Own-quote (You/LP) row also uses card layout on mobile

## Haptic Feedback on Accept

- [x] Call navigator.vibrate(50) on Accept button tap in order book (mobile only)
- [x] Also vibrate on Swap Now button tap in swap form

## First Agentic Swap — Implementation

- [x] Fix execute error handling: surface Oracle VM `success:false` as error state in Swaps.tsx
- [x] Chain RFQ → execute immediately (remove setTimeout gap that causes RFQ expiry)
- [x] Wire SOL_AGENT_KEY into server-side Jupiter swap signing (sign + broadcast server-side)
- [x] Add tRPC procedure `chat.executeAgentSwap` that signs and broadcasts Jupiter tx using SOL_AGENT_KEY
- [x] Add Fund Agent Wallet UI to HTLC Wallet panel (Fund Wallet button opens QR modal with SOL agent address)
- [x] Verified SOL_AGENT_KEY is SET — agent wallet: DYsF9Dq3LnPpinsSUfRkRwEkvyQdFBGmJcYUpifJhC68
- [ ] BLOCKER: Fund agent wallet with 0.01+ SOL before first swap (currently 0 SOL)

## P2P Primary + Jupiter Fallback Fix

- [x] Fix executeAgentSwap: add IntercomSwap P2P check BEFORE Jupiter (P2P is primary, Jupiter is fallback)
- [x] Diagnose Oracle VM connectivity from server (141.253.123.101:4000 is ONLINE, 10 pending RFQs confirmed)
- [x] Add ORACLE_API_URL env var so Oracle VM URL is configurable (not hardcoded, falls back to IP)
- [x] buildSwapTx (user wallet path) already routes P2P first via submitIntercomSwapRfq — confirmed correct
- [x] Add clear logging: Step 1 (RFQ), Step 2 (Oracle VM execute), Step 3 (Jupiter direct fallback)
- [x] Pass fromChain/toChain to executeAgentSwap from ChatPage.tsx
- [x] Add solscanUrl to success response and show "View on Solscan" action in toast
- [x] Show route label in success message ("IntercomSwap P2P" vs "Jupiter DEX (Whirlpool → AlphaQ)")

## ORACLE_API_URL Secret

- [x] Add ORACLE_API_URL to project secrets (value: http://141.253.123.101:4000)
- [x] All 5 server files already use process.env.ORACLE_API_URL || fallback — no code change needed
- [x] Add ORACLE_API_URL to server/_core/env.ts as ENV.oracleApiUrl
- [x] Vitest passes: secret set + Oracle VM reachable (status: active, uptime confirmed)

## Platform Fee System (P2P Primary Route)

- [x] Design fee architecture: P2P 0.15% (15 bps) + DEX 0.20% (20 bps) output-side deduction
- [x] Add P2P_FEE_BPS (15) and PLATFORM_FEE_BPS (20) constants to chat.ts
- [x] Apply output-side fee deduction in buildQuote: netToAmount = toAmount - fee
- [x] Add fee breakdown display in quote card: AFOS Fee row with P2P/DEX badge, fee amount in output token
- [x] Add fee revenue tracking: platformFeeUsd, feeBps, feeAmountOut columns in swap_analytics DB table
- [x] Wire recordSwapAnalytic calls with fee data in executeAgentSwap (Oracle VM + direct Jupiter)
- [x] Add analytics.feeRevenue tRPC procedure: total/P2P/DEX fee revenue, recent fee events
- [x] Replace mock Revenue tab in AdminPanel with DB-backed RevenueTab component (KPIs, route split, volume by chain, recent fees)
- [x] Replace placeholder PLATFORM_FEE_ACCOUNT with env var PLATFORM_FEE_WALLET (fallback to AFOS token address)
- [x] Add vitest feeModel.test.ts: 14 tests covering constants, interfaces, schema, analytics, math
- [ ] Add fee sweep logic: when fee account balance > threshold, sweep % to agent gas wallet

## Multi-Chain Agentic Swap (ETH + BTC support)

- [x] Audit executeAgentSwap and multi-chain swap helpers
- [x] Implement ETH agent swap: Oracle VM RFQ → 1inch DEX fallback via ETH_AGENT_KEY (agentSwapEth.ts)
- [x] Implement BTC agent swap: Oracle VM RFQ → Direct HTLC/PSBT fallback via BTC_AGENT_WIF (agentSwapBtc.ts)
- [x] Update executeAgentSwap to dispatch by fromChain (solana/ethereum/bitcoin)
- [x] Wire P2P_FEE_BPS (15) / PLATFORM_FEE_BPS (20) fee deduction for ETH and BTC paths
- [x] Record fee analytics (feeBps, feeAmountOut) for all three chains via recordSwapAnalytic
- [x] Update ChatPage: noWalletConnected check for all chains, chain-aware TxSuccessCard explorer links
- [x] Add vitest multiChainAgentSwap.test.ts — 113 tests all passing (ETH, BTC, SOL paths)

## Cross-Chain Agentic Swap (all 3 chains ↔ all 3 chains)

- [x] Audit cross-chain routing: executeAgentSwap, buildQuote, and all 3 chain helpers
- [x] buildQuote already returns IntercomSwap P2P quotes for cross-chain pairs (0.15% fee)
- [x] ETH agent: skip 1inch fallback for cross-chain, return "Oracle VM required" message
- [x] SOL agent: skip Jupiter fallback for cross-chain, return "Oracle VM required" message
- [x] BTC agent: already cross-chain only (no DEX fallback, always P2P)
- [x] All 3 chains send fromChain + toChain to Oracle VM RFQ for cross-chain discovery
- [x] ChatPage: ChainPill shows cross-chain labels, fromChain/toChain passed to executeAgentSwap
- [x] Add vitest cross-chain tests: 126 tests all passing (cross-chain routing, fee math, chain dispatch)

## Fee Wallet Security Fix

- [x] Remove unknown hardcoded fallback address from PLATFORM_FEE_ACCOUNT
- [x] Replace with null/no-op: if PLATFORM_FEE_WALLET not set, feeAccount is omitted from Jupiter call
- [x] Add server startup warning log when PLATFORM_FEE_WALLET is not configured
- [x] Update feeModel.test.ts to reflect new no-op behavior (assert address NOT present)
- [x] 126 tests passing, 0 TypeScript errors
- [ ] Save checkpoint

## Mode B Removal + Fee Wallet Wiring

- [x] Remove Mode B from executeAgentSwap (SOL path): return wallet-required error instead of fronting capital
- [x] Remove Mode B from agentSwapEth.ts: return wallet-required error instead of demo mode
- [x] Remove Mode B from agentSwapBtc.ts: return wallet-required error instead of demo mode
- [x] Update ChatPage: noWalletConnected block now calls openWalletForChain() instead of executeAgentSwap
- [x] Rename PLATFORM_FEE_WALLET → SOL_FEE_WALLET (env var + code + warning log)
- [x] SOL_FEE_WALLET: derived from SOL_AGENT_KEY at startup (DYsF9Dq3… = HTLC Escrow Wallet)
- [x] ETH_FEE_WALLET: derived from ETH_AGENT_KEY at startup (0xF548Dc3c… = HTLC Escrow Wallet)
- [x] BTC_FEE_WALLET: derived from BTC_AGENT_WIF at startup (bc1qkuduxus7c6… = HTLC Escrow Wallet)
- [x] Update feeModel.test.ts: renamed PLATFORM_FEE_WALLET → SOL_FEE_WALLET, added ETH/BTC fee wallet checks
- [x] Update multiChainAgentSwap.test.ts: 5 tests updated to reflect Mode B removal
- [x] 126 tests all passing, 0 TypeScript errors
- [x] Save checkpoint

## Fee Wallet vs HTLC Escrow Wallet Separation

- [x] Wire SOL_FEE_WALLET to derive from SOL_AGENT_KEY (Oracle VM Hot Wallet = fee collection)
- [x] Wire ETH_FEE_WALLET to derive from ETH_AGENT_KEY (Oracle VM Hot Wallet = fee collection)
- [x] Wire BTC_FEE_WALLET to derive from BTC_AGENT_WIF (Oracle VM Hot Wallet = fee collection)
- [x] Add SOL_HTLC_KEY, ETH_HTLC_KEY, BTC_HTLC_WIF as dedicated HTLC escrow signing keys
- [x] htlcWallet.ts getHtlcWallets: reads SOL_HTLC_KEY/ETH_HTLC_KEY/BTC_HTLC_WIF (fallback to agent keys)
- [x] chat.ts executeAgentSwap (SOL path): uses SOL_HTLC_KEY ?? SOL_AGENT_KEY for HTLC signing
- [x] chat.ts executeBtcSwap: uses BTC_HTLC_WIF ?? BTC_AGENT_WIF for HTLC signing
- [x] agentSwapEth.ts: uses ETH_HTLC_KEY ?? ETH_AGENT_KEY for HTLC signing
- [x] agentSwapBtc.ts: uses BTC_HTLC_WIF ?? BTC_AGENT_WIF for HTLC signing
- [x] htlcMonitor.ts: uses HTLC keys (with agent key fallback) for refund signing
- [x] btcHtlc.ts: uses BTC_HTLC_WIF ?? BTC_AGENT_WIF for all HTLC procedures
- [x] Update Admin Panel: "Fee Collection Wallet Balances" label for agent key wallets
- [x] Update Admin Panel: "HTLC Escrow Wallet" label + description for HTLC key wallets
- [x] Update Admin Panel: Oracle VM Hot Wallet description clarifies fee collection role
- [x] htlcWallet.test.ts: 12 tests updated — dual-key priority + fallback logic verified
- [x] multiChainAgentSwap.test.ts: 3 tests updated to reference new HTLC key env vars
- [x] 129 tests all passing, 0 TypeScript errors
- [x] SOL_HTLC_KEY, ETH_HTLC_KEY, BTC_HTLC_WIF secrets added to project
- [x] Save checkpoint

## Settings Page Audit — Separate User Settings from Admin/Operator Config

### Audit findings
- ADMIN-ONLY → move to Admin Panel: AFOS Agent (LLM Model, System Prompt), IntercomSwap Node (Rendezvous Channel, Min/Max Swap, SC-Bridge Port, Peer Mode), Bitcoin Node (Host:Port, RPC Password, TLS Cert Path), Solana Wallet (RPC URL, Keypair Path, Escrow Program ID), Worker/Autopost (Autonomous Trading toggle, tick interval, HTLC refund windows), MoonPay Phase 2 stub
- USER-FACING → keep in Settings: Max Transaction Amount (USD), Auto-confirm swaps toggle, theme toggle (dark/light), slippage tolerance, preferred swap route (IntercomSwap / Jupiter / 1inch)

### Tasks
- [x] Rewrite AgentSettings.tsx as clean user-facing Settings page (max tx amount, auto-confirm, theme, slippage, preferred route)
- [x] Add "Operator Config" tab to AdminPanel.tsx containing all moved cards (AFOS Agent, IntercomSwap Node, Bitcoin Node, Solana Wallet, Worker/Autopost, MoonPay)
- [x] Settings page has "Admin Panel" link card pointing to /admin for operator config
- [x] 129 tests passing, 0 TypeScript errors
- [x] Save checkpoint

## User Settings Persistence (DB-backed)

- [x] Add userSettings table to drizzle/schema.ts (openId PK, maxTxAmountUsd, autoConfirm, slippagePct, preferredRoute, theme, updatedAt)
- [x] Run pnpm db:push to migrate (migration 0005 applied successfully)
- [x] Add getUserSettings / upsertUserSettings helpers to server/db.ts
- [x] Add settings router (settings.get + settings.save) to server/routers/settings.ts
- [x] Register settingsRouter in server/routers.ts
- [x] Wire AgentSettings.tsx: load via trpc.settings.get on mount, save via trpc.settings.save with optimistic update
- [x] Show loading skeleton while settings are fetching
- [x] Auth gate: unauthenticated users see a "Connect Account" prompt instead of blank form
- [x] Theme selector synced with next-themes setTheme on change
- [x] Write 11 vitest tests for settings.get and settings.save procedures (all passing)
- [x] 140 tests total passing, 0 TypeScript errors
- [x] Save checkpoint

## Server-Side Settings Enforcement

- [x] Audit chat.ts: identified 3 enforcement points (executeAgentSwap, executeEthSwap, buildSwapTx)
- [x] Enforce maxTxAmountUsd in executeAgentSwap: loads user settings, fetches live prices, throws BAD_REQUEST if exceeded
- [x] Enforce maxTxAmountUsd in executeEthSwap: same pattern, uses ETH live price
- [x] Enforce maxTxAmountUsd in buildSwapTx: same pattern, uses fromToken live price
- [x] Pass slippagePct (pct→bps) to getJupiterQuote in executeAgentSwap Jupiter fallback
- [x] Pass slippagePct to get1inchSwapTx in executeEthSwap (overrides input.slippage)
- [x] Apply preferredRoute in executeAgentSwap: skipP2P for "jupiter", forceP2P for "intercomswap" (PRECONDITION_FAILED if no peer)
- [x] Apply preferredRoute in buildSwapTx: skipP2P for "jupiter"
- [x] Apply preferredRoute in executeEthSwap: skipP2P for "oneinch"
- [x] 7 new vitest tests in settingsEnforcement.test.ts — all 147 tests passing, 0 TypeScript errors
- [x] Save checkpoint

## Chat UX — Limit Error Card + Quote Warning + Settings Reset

- [x] Add inline LimitExceededCard component in ChatPage — shown when executeAgentSwap/executeEthSwap/buildSwapTx returns BAD_REQUEST "maximum transaction limit"
- [x] LimitExceededCard shows: blocked amount (USD), user's current limit, link to Settings to raise it, animated ShieldAlert icon
- [x] Wire LimitExceededCard: catch BAD_REQUEST in handleConfirmSwap, push limit_exceeded type message into thread
- [x] Add limitWarning field to sendMessage quote_card response (server-side: checks 90% threshold)
- [x] Surface limitWarning as yellow banner in QuoteCard (client-side: shown before Confirm button)
- [x] Add "Reset to defaults" button to AgentSettings.tsx — calls settings.save with defaults, shows toast
- [x] Pass openId from useAuth to sendMessage, buildSwapTx, executeEthSwap mutation calls
- [x] 147 tests passing, 0 TypeScript errors
- [x] Save checkpoint

## Chat Input Wallet Gate

- [x] MiniChatWidget (Overview): replace input with compact "Connect wallet to chat" gradient button when no wallet connected
- [x] MiniChatWidget (Overview): hide quick-action chips when no wallet connected
- [x] ChatPage: replace input + quick-action chips with Connect Wallet prompt card when no wallet connected
- [x] ChatPage: prompt card shows Wallet icon, title, description, and Connect Wallet button that opens modal
- [x] Both: once wallet connects, the prompt disappears and the input becomes available
- [x] 147 tests passing, 0 TypeScript errors
- [x] Save checkpoint

## Overview UX — Wallet Connect Inline + Welcome Message + New Swap Gate

- [x] MiniChatWidget: wire "Connect wallet to chat" button to call onOpenWallet() directly (open modal inline, no navigation)
- [x] MiniChatWidget: initial welcome message is now wallet-aware (shows connect prompt when no wallet connected)
- [x] MiniChatWidget: after wallet connects, inject personalised welcome message with all chain balances (SOL, ETH, BTC)
- [x] QuickActions: disable "New Swap" button when no wallet connected; show tooltip "Connect a wallet to swap" on hover
- [x] Save checkpoint

## Swaps Page — Wallet Gate on Action Buttons
- [x] Replace "Swap Now" button with "Connect Wallet" button when no wallet is connected
- [x] Replace "Send to Agent" button with "Connect Wallet" button when no wallet is connected
- [x] Connect Wallet button opens the wallet modal (ConnectWalletModal)
- [x] Save checkpoint

## Polish — Theme-Aware Warnings + Save Confirmation + Wallet Text Sync
- [x] Add --warning-foreground and --warning-bg CSS variables to .light and .dark blocks in index.css
- [x] Update AgentSettings.tsx warning banners to use CSS variables instead of hardcoded #78350f
- [x] Settings save button: show inline "Saved ✓" success state for 2s after mutation completes
- [x] Centralise SUPPORTED_WALLETS_TEXT constant in shared/const.ts
- [x] Update ChatPage to use the shared constant (only consumer found)
- [x] Save checkpoint

## Six UX & Polish Improvements (Swaps + Settings)
- [x] Add --success-foreground/--success-bg CSS variables to index.css (dark + light)
- [x] Extend --warning-* to Swaps page high-slippage warning (replace hardcoded amber colour)
- [x] Disable/overlay Advanced Settings panel on Swaps page when no wallet connected
- [x] Auto-select chain tab in wallet modal based on currently selected sell token (already implemented via defaultChain prop)
- [x] Show "Balance too low" warning below Sell amount field when amount exceeds wallet balance
- [x] Apply --success-* variables to Save button flash in AgentSettings.tsx
- [x] Add Reset button resetFlash pattern (brief "Reset ✓" state after reset completes)
- [x] Save checkpoint

## Swap Button Gate + Advanced Settings Persistence
- [x] Disable Swap Now / Send to Agent button when balance is insufficient; change label to "Insufficient balance"
- [x] Persist Advanced Settings panel open/closed state in localStorage across page navigations
- [x] Save checkpoint

## Network Panel Unification
- [x] Merge Light Peer and P2P Peers into a single "Network" panel with "My Node" / "Live Peers" tabs
- [x] Persist selected tab in localStorage (afos_network_tab)
- [x] Save checkpoint

## P2P Network Improvements (Phase 2)

- [ ] 5-minute TTL for relay light peers — client-side expiry filtering + heartbeat keeps own peer alive
- [ ] Peer type badges in Peer Directory — "Light Peer" (cyan) vs "Hyperswarm" (emerald) colored tags
- [ ] Copy Invite Link button — generates ?peer=<peerId> shareable URL for direct peer connection
- [ ] Handle ?peer= URL param on load — auto-highlight or connect to the specified peer

## P2P UX Improvements (Mar 5, 2026)
- [x] Add "My invite link" button to self-peer popup
- [x] Show "Peer found via invite link" banner when ?peer= matches
- [x] Add heartbeat "last seen" timestamp to Light Peer rows in Peer Directory

## P2P Invite & Direct Message (Mar 5, 2026)
- [ ] Pending invite banner state with spinner when invited peer not yet online
- [ ] Persist invite peerId in sessionStorage for post-wallet-connect banner re-show
- [ ] Peer direct message system via relay (send/receive + UI)

## Phantom Solana Connection Fix

- [x] Fix SOL tab in ConnectWalletModal to show connected state when Phantom multi-chain has a Solana address (was checking only solana wallet adapter `connected` state, not `phantomMultiChain.solanaAddress`)
- [x] Fix LightPeerContext peer ID derivation to use `phantomMultiChain.solanaAddress` when adapter is not connected
- [x] Fix LightPeerPanel, NetworkPanel, SwapPage, Dashboard (MiniChatWidget, QuickActions, PortfolioCard, MobilePortfolioStrip) to also recognize Phantom multi-chain Solana as a connected state

## Phantom Multi-Chain Balance + Toast Fixes

- [x] Fix SOL balance showing "—" / $0.00 when connected via Phantom multi-chain (fetched via direct Solana RPC in connectPhantomMultiChain)
- [x] Fix connected toast showing only Ethereum address — now shows all 3 addresses (SOL + ETH + BTC) by suppressing standalone ETH/BTC toasts when isPhantom=true

## SOL Balance Still $0 + Chat Welcome Multi-Chain

- [x] Fix SOL balance still showing $0 — routed through backend tRPC procedure (getSolanaBalanceByAddress) to avoid browser CORS/403 from Solana public RPC
- [x] Update chat welcome message to show all connected chain balances (SOL + ETH + BTC) — checks phantomMultiChain.solanaBalances as fallback

## Chat Welcome Timing + Connection Speed

- [x] Fix chat welcome message only showing ETH — debounced 2.5s to wait for all chain balances to settle
- [x] Optimize Phantom connection speed — set state immediately, fetch SOL balance in background async

## IntercomSwap DHT Activation Fix

- [x] Fix IntercomSwap DHT showing "Connect wallet to activate" — optimistic isOnline when peerId is set + 10s announce timeout instead of 60s hang

## Shared Chat State + Agent Page Wallet Fix

- [x] Unify MiniChatWidget (Overview) and ChatPage (Agent) into shared persistent conversation state
- [x] Fix Agent page showing "Wallet not connected" when Phantom multi-chain is connected
- [x] Add "New Chat" button to Agent page header to clear conversation and start fresh
- [x] Auto-clear chat conversation on wallet disconnect for privacy
- [x] Fix feeModel.test.ts to check ChatContext.tsx instead of ChatPage.tsx for QuoteData fields

## WebSocket Signaling Server (Option A) — Real P2P Peer Discovery

- [x] Build WebSocket signaling server endpoint on AFOS backend (peer registry, heartbeat, matchmaking)
- [x] Implement WebRTC signaling relay (SDP offer/answer, ICE candidate exchange)
- [x] Update LightPeerContext to connect to real signaling server instead of in-memory simulation
- [x] Establish WebRTC data channels between discovered peers for direct browser-to-browser communication
- [x] Wire peer-to-peer messaging (chat + swap negotiation) through WebRTC data channels
- [x] Update Network page UI to reflect real remote peer connections and status
- [x] Write tests for signaling server and peer discovery
- [x] Fix page refresh loop: moved signaling WebSocket to /api/ws/signaling, switched to noServer mode with manual upgrade handling, added MAX_RECONNECT_ATTEMPTS=5, stabilized useEffect deps
- [x] Fix StacksProvider redefine property error (Phantom wallet extension bug — not our code, harmless)
- [x] Fix Network page topology canvas: node labels and latency text invisible in light mode
- [x] Fix topology SVG: "You" label and latency text still invisible in light mode (hardcoded white fills in SVG text elements)
- [x] Add TURN server configuration to WebRTC signaling client for NAT traversal (Open Relay Project TURN + custom VITE_TURN_URL/USERNAME/CREDENTIAL env vars)
- [x] Persist peer reputation scores to database across sessions (peerReputation table, signaling server calls recordPeerPing on register+heartbeat, Reputation Leaderboard tab added to Network page)

## Header Peer Count Fix

- [x] Fix top header peer count badge showing "1 peer" when there are 2 peers (You + 1 remote) — now reads signaling peers from LightPeerContext and adds self node to total

## Header Peer Tooltip Enhancement

- [x] Enhance peer count tooltip: show peer IDs, connection type (direct/relay), status dots, trading pairs, total breakdown with proper values

## Theme Visibility Fixes — Topology + Tooltip

- [x] Fix topology canvas peer alias/latency text: dark mode text invisible — fixed with DOM classList fallback when resolvedTheme is undefined
- [x] Fix peer count tooltip background/text: now uses bg-popover text-popover-foreground with dark: variants for status colors

## Peer Directory Row Cleanup

- [x] Redesign Peer Directory rows: action buttons (Ping/Invite/Link) now hidden in hover-revealed strip, badge labels shortened (HW/LP), LastSeenBadge uses darker colors in light mode

## PeerDetail Panel Layout Fix

- [x] Fix PeerDetail panel: now uses flex-col with max-height calc(100%-2rem) and overflow-y-auto scrollable body, sticky header stays fixed while content scrolls

## Ping Bug Fix

- [x] Fix "Peer not connected" error when pinging light peers: added /api/signaling/peers/:id/ping REST endpoint with real WebSocket ping/pong RTT, frontend now routes signaling peers (origin=intercomswap) to local endpoint instead of Oracle VM

## Ping Fix + Live Latency + Auto-Ping

- [x] Fix ping request failure for signaling peers — REST endpoints moved before Vite middleware so they're no longer caught by SPA fallback
- [x] Show live latency in topology canvas after successful ping — handlePing now updates livePeers state, edge labels + node labels reflect real RTT
- [x] Auto-ping on connect for new signaling peers — useEffect watches livePeers for new intercomswap peers and silently pings them with staggered timing

## PeerDetail Modal + Network Graph UX Fixes

- [x] Move Direct Message section above Share section in PeerDetail overlay
- [x] Expand topology canvas to fill available viewport height (not fixed 480px)
- [x] Add periodic re-ping every 30s for connected peers
- [x] Add latency history sparkline in PeerDetail overlay panel
- [x] Add visual ping animation on topology edge when ping is in progress

## Pair Badge → Direct Message Quick Trade

- [x] Clicking an active pair badge in PeerDetail opens DM section and pre-fills input with trade inquiry template for that pair

## PeerChat Input UX

- [x] Replace single-line input with auto-resizing textarea in PeerChat DM panel

## Unread Message UX — Who Sent the Message?

- [x] Show unread message badge on peer nodes in topology canvas (glowing dot above node)
- [x] Show unread badge on peer rows in Peer Directory list
- [x] Show clickable toast with sender alias + message snippet when a new message arrives, clicking it auto-selects that peer's PeerDetail panel
- [x] Add pulsing ring animation on node contour when peer has unread messages (3 staggered Framer Motion rings expanding outward)

## Peer Block / Unblock System

- [x] Add peerBlocks table to DB schema (blocker, blocked, createdAt)
- [x] Run db:push migration
- [x] Add block/unblock/isBlocked/listBlocked tRPC procedures
- [x] Enforce block on peerMessages.send — reject if recipient has blocked sender
- [x] Add Block/Unblock button in PeerDetail overlay panel
- [x] Show visual indicator (red tint / lock icon) on blocked peer nodes in topology canvas and Peer Directory
- [x] Add Blocked Peers section in Settings page with unblock button

## Unified Multi-Chain Peer Identity

- [x] Audit peer ID generation — understand how lp-eth-XXXX vs lp-XXXX IDs are created
- [x] Fix peer ID to always use stable signaling node key (not wallet address) so one user = one peer ID
- [x] Add walletAddresses JSON field to peer profile (SOL, ETH, BTC addresses as metadata)
- [x] Update LightPeerContext to broadcast wallet addresses as peer metadata on connect/wallet-change
- [x] Update PeerDetail overlay to show chain address badges (SOL/ETH/BTC) for the peer
- [x] Update Peer Directory rows to show chain icons instead of chain-prefixed peer IDs
- [ ] Clean up old lp-eth-XXXX duplicate entries from peerReputation table (manual DB cleanup)

## Peer Moderation — Report, Block with Reason, Mute

- [x] Add peerReports DB table (reporterId, reportedId, reason, details, createdAt)
- [x] Add peerMutes DB table (muterPeerId, mutedPeerId, createdAt)
- [x] Run db:push migration
- [x] Add report/listReports/listAll/updateStatus tRPC procedures (report stores to DB; listAll for admin)
- [x] Add mute/unmute/isMuted/listMuted tRPC procedures
- [x] Update block UI to show reason dropdown (Spam / Suspicious activity / Other) before confirming
- [x] Update PeerDetail: replace plain Block button with confirmation dialog (reason dropdown + confirm)
- [x] Add Mute/Unmute button in PeerDetail (below Block button)
- [x] Add Report button in PeerDetail (opens report dialog with reason + optional details textarea)
- [x] Suppress toast notifications for muted peers (check mutedPeerIds in new-message effect)
- [x] Show muted badge in Peer Directory rows + NodeGraph muted indicator
- [x] Add Muted Peers section in Settings page with Unmute button
- [x] Add Peer Reports tab in Admin Panel (pending/reviewed/actioned/dismissed with action buttons)
- [x] Write vitest tests for peerReports and peerMutes routers (11 tests passing)

## Mobile UX — Network Page Reputation & Topology Tabs

- [x] Reputation tab: replace table with card-based layout on mobile (rank badge, peer ID, score, last seen)
- [x] Reputation tab: hide table header on mobile, use compact card rows
- [x] Topology tab: enhanced mobile peer list with mini stats bar (online/channels/avg latency)
- [x] Topology tab: peer cards show HW/IS badge, latency, channels, rep score, muted/blocked indicators, expandable detail panel

## Mobile UX — Network Page Tab Bar Fix

- [x] Fix tab bar overflow on mobile (tabs clipping into header)
- [x] Make tab bar show icon + short label stacked vertically on mobile (Nodes/Channels/Invites/Rep)
- [x] Hide Non-custodial badge on mobile to free header space; error toast is a proxy socket hang-up (non-critical)

## Mobile UX — Network Page Scroll Fix

- [x] Fix unresponsive scroll on Network page mobile (overflow-hidden blocking touch scroll)
- [x] DashboardLayout main container: added overflow-y-auto so all pages scroll on mobile
- [x] NetworkPage root div: overflow-y-auto on mobile, overflow-hidden on sm+ (desktop sidebar layout)

## DEX Routing Architecture Overhaul

- [x] Add ZEROX_API_KEY + VITE_ZEROX_API_KEY secrets (validated with live 0x v2 API test)
- [x] Implement 0x API swap module for Ethereum with 0.2% referral fee (server/zeroxSwap.ts)
- [x] Update agentSwapEth.ts: primary = 0x API, fallback = 1inch stub (ready when ONEINCH_API_KEY provided)
- [x] Update Solana path: Jupiter primary (0.2% fee confirmed), 1inch SOL fallback stub
- [x] Fix SwapPage routing bug: wire handleSwap to trpc.chat.executeAgentSwap instead of Oracle VM direct
- [x] Update Settings preferredRoute dropdown: add "0x Protocol" option, 1inch shows "Needs Key" badge
- [x] Update route labels in ChatPage/SwapPage/Swaps/SwapAnalytics to show "0x Protocol" for ETH swaps
- [x] Update fee display in all pages to show 0.2% for all routes
- [x] Keep 1inch code for both SOL and ETH but gate behind ONEINCH_API_KEY presence check
- [x] Fix 0x v2 API: use permit2/price endpoint, 0x-version: v2 header, WETH address for native ETH
- [x] Fix 0x v2 fee params: swapFeeBps/swapFeeRecipient/swapFeeToken (not integratorFee)
- [x] Write vitest tests for 0x API integration (3 tests passing)
- [x] Update multiChainAgentSwap test for new cross-chain message
- [x] All 208 tests passing across 15 test files

## Admin Panel — Remove Mock Data & Wire Live Data

- [x] Add `adminConfig` table to schema (fee config + treasury wallets as JSON)
- [x] Add `analytics.topPairs` tRPC procedure (aggregate by fromToken→toToken)
- [x] Add `adminConfig` tRPC router (get/save fee config, get/save treasury wallets)
- [x] Wire Users tab to live analytics (summary + routeDistribution + topPairs)
- [x] Replace MOCK_NODE_STATUS with live health checks (Oracle VM + RPC pings)
- [x] Wire Fee Config tab to DB via adminConfig.saveFeeConfig
- [x] Wire Treasury tab to DB via adminConfig.saveTreasury
- [x] Remove LP Node tab (no backing system)
- [x] Remove Routing tab (no backing system)
- [x] Run all tests after changes (216 tests pass)

## Admin Panel — Phase 2 (Operator Config + Auth Guards + Alerts)

- [x] Add `operatorConfig` table to schema (all operator config fields)
- [x] Add `operatorConfig` tRPC router (get/save)
- [x] Wire Operator Config tab to DB (load on mount, persist on save)
- [x] Add `adminProcedure` guard to adminConfig router (fee config + treasury)
- [x] Add `adminProcedure` guard to operatorConfig router
- [x] Add fee revenue threshold alert via notifyOwner (daily check, first $1 earned)
- [x] Run all tests after changes (222 tests pass)

## Admin Audit Log

- [x] Add `admin_audit_log` table to schema (userId, action, section, fieldName, oldValue, newValue, createdAt)
- [x] Add `writeAuditLog` server helper function
- [x] Wire audit logging into `adminConfig.saveFeeConfig`
- [x] Wire audit logging into `adminConfig.saveTreasury`
- [x] Wire audit logging into `operatorConfig.save`
- [x] Add `adminConfig.getAuditLog` tRPC procedure (paginated, filterable by section)
- [x] Add Audit Log tab to Admin Panel (table with filters, pagination, diff view)
- [x] Run tests after changes (228 tests pass)

## Admin Panel — Security Hardening

- [x] Change `adminConfig.get` from `publicProcedure` to `adminProcedure`
- [x] Change `operatorConfig.get` from `publicProcedure` to `adminProcedure`
- [x] Replace frontend password gate with real OAuth + `role === 'admin'` check
- [x] Remove hardcoded `ADMIN_PASSWORD` constant from client bundle
- [x] Remove `sessionStorage` auth bypass vector
- [x] Run all tests after changes (228 pass)

## Settings Page — User-Facing Fix

- [x] Remove OAuth auth gate from Settings page (it is for regular users, not admins)
- [x] Replace "Connect Account" prompt with "Connect Wallet" prompt
- [x] Show settings content to all users (wallet-connected or not)
- [x] Wallet-dependent settings (save/sync) should prompt wallet connect, not OAuth login
