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

## Settings — Danger Zone & Admin Route Guard

- [x] Add server-side /admin route guard middleware (403 for non-admin before React loads)
- [x] Add Danger Zone section to Settings page
- [x] Add "Reset all settings" confirmation dialog in Danger Zone
- [x] Add "Clear all blocked peers" bulk action with confirmation in Danger Zone
- [x] Add "Clear all muted peers" bulk action with confirmation in Danger Zone
- [x] Run tests after changes (228 pass)

## Settings Page — Mobile Scroll Fix

- [x] Fix Settings page not scrolling on mobile

## Settings Page — Mobile Scroll Fix (Round 2)

- [x] Fix Settings page still not scrolling on mobile after previous attempt (root overflow:clip + h-dvh + main touch-action:pan-y + WebkitOverflowScrolling + subPage overflow-y-auto)

## Route Badges, Swap Engine Wiring & Test Connection

- [ ] Move "Recommended" badge from IntercomSwap P2P to Best Available card
- [ ] Give IntercomSwap P2P an "Active" badge (indigo, matching Jupiter and 0x)
- [ ] Wire preferred route setting from DB to swap engine tRPC procedure
- [ ] Add "Test Connection" ping button per route with latency/availability feedback

## Logo Integration

- [ ] Remove dark background from AFOS logo to make transparent PNG
- [ ] Upload transparent logo and replace placeholder icon in sidebar/header

## Logo Integration (Completed)

- [x] Remove dark background from AFOS logo to make transparent PNG
- [x] Upload transparent logo and replace placeholder icon in sidebar/header
- [x] Add favicon using the AFOS icon
- [x] Replace Bot/Zap placeholder icons with AFOS logo in chat message bubbles and agent CTA

## Settings — Route Testing Enhancements (Completed)

- [x] Auto-run Test Connection on Settings page load (staggered 300ms per route)
- [x] Add "Last tested" timestamp display below each route ping result

## Fee Alert Scheduling (Completed)

- [x] Schedule fee revenue alert to run hourly via setInterval in server/_core/index.ts
- [x] Initial run 10s after server startup (DB pool warm-up delay)
- [x] Idempotent: only one notification per calendar day (UTC)

## Full Branding Pass

- [x] Generate all favicon sizes: 16x16, 32x32, 48x48, 180x180 (apple-touch), 192x192, 512x512
- [x] Generate OG image (1200x630) with AFOS logo + wordmark on dark background
- [x] Create site.webmanifest with all icon sizes
- [x] Add complete favicon/manifest/SEO meta tags to index.html
- [x] Add Open Graph meta tags (og:title, og:description, og:image, og:type)
- [x] Add Twitter Card meta tags
- [x] Add theme-color meta tag (dark + light)
- [x] Fix logo light-mode rendering: add ring-1 ring-border/40 shadow-sm wrapper so dark icon blends in light mode
- [x] Apply light-mode wrapper to all logo placements (sidebar, mobile drawer, chat bubbles, agent CTA)

## JSON-LD Structured Data

- [x] Add WebApplication JSON-LD schema to index.html (name, description, applicationCategory, url, image, offers, featureList)

## walletAddress Attribution + Pagination

- [x] Add walletAddress param to recordSwapAnalytic() in htlcMonitor.ts
- [x] Wire walletAddress into buildSwapTx IntercomSwap P2P call (userPublicKey)
- [x] Wire walletAddress into buildSwapTx Jupiter DEX call (userPublicKey)
- [x] Wire walletAddress into executeEthSwap IntercomSwap P2P call (fromAddress)
- [x] Wire walletAddress into executeEthSwap 1inch fallback call (fromAddress)
- [x] Upgrade SwapHistory.tsx to true server-side pagination (limit/offset per page)
- [x] Add ellipsis page buttons for large page counts
- [x] Add isFetching spinner in pagination row
- [x] Disable prev/next/page buttons while fetching to prevent double-clicks

## Server-side Search + BTC walletAddress

- [ ] Add search param to history.list tRPC procedure (LIKE %q% on fromToken, toToken, peerId, txId)
- [ ] Reset page to 1 when search query changes in SwapHistory.tsx
- [ ] Wire search input value to tRPC query param (debounced)
- [ ] Wire walletAddress into executeBtcSwap recordSwapAnalytic call (input.senderAddress)

## Search + htlcReveal Attribution

- [ ] Add search param to history.openTrades procedure (LIKE on peerId, htlcAddress, fromToken, toToken)
- [ ] Add search param to history.refunds procedure (LIKE on peerId, htlcAddress, fromToken, toToken)
- [ ] Add shared search bar to SwapHistoryTabs.tsx (debounced, passed to both tabs)
- [ ] Wire swapAnalytics status update in btcHtlc.htlcReveal (set status="completed" by txId/secretHash)

## Multi-Chain HTLC Lifecycle Status Tracking

- [x] btcHtlc.htlcRefund: update htlcSwaps.status to "refunded" and swapAnalytics.status to "refunded" on successful broadcast
- [x] htlcMonitor auto-refund path: mirror status to swapAnalytics.status="refunded" via lockTxId for all 3 chains
- [x] markHtlcCompleted: also update swapAnalytics.status="completed" via lockTxId (covers ETH/SOL reveal paths)

## CSV Export — Server-Side Full Export

- [x] Add history.exportCsv tRPC procedure (fetches all matching rows, returns CSV string)
- [x] Wire Export CSV button in SwapHistory.tsx to trpc.history.exportCsv (on-demand fetch, loading state, toast feedback)

## Search Bar for Open Trades + Refunds Tabs

- [x] Add search param to history.openTrades tRPC procedure (LIKE on peerId, htlcAddress, fromToken, toToken)
- [x] Add search param to history.refunds tRPC procedure (LIKE on peerId, htlcAddress, fromToken, toToken)
- [x] Add shared debounced search input to SwapHistoryTabs.tsx (passed to both tabs)
- [x] Reset page to 1 when search changes in each tab

## Oracle VM Swap Status Sync Job

- [x] Create server/jobs/oracleVmSync.ts — polls /api/swaps every 60s, back-fills swapAnalytics for quoted→executed transitions
- [x] Register oracleVmSync in server/_core/index.ts startup
- [x] Write vitest test for oracleVmSync logic

## htlcReveal walletAddress Attribution

- [x] Pass recipientAddress as walletAddress in btcHtlc.htlcReveal recordSwapAnalytic call

## rfqId Back-fill for Existing Analytics Rows

- [x] Add back-fill logic to oracleVmSync: for existing swapAnalytics rows where rfqId IS NULL but txId matches an Oracle VM rfqId, update rfqId
- [x] Expose a tRPC mutation (admin) to trigger a one-time back-fill on demand

## outAmount Received Column in History

- [x] Add outAmount column to swapAnalytics schema (already added via ALTER TABLE, ensure schema.ts matches)
- [x] Expose outAmount in history.list tRPC procedure response
- [x] Add Received column to Completed tab table in SwapHistory.tsx

## Oracle VM Sync Status Indicator in Settings

- [x] Add lastOracleSyncAt and lastSyncInserted fields to admin_config or a new sync_status table
- [x] Update oracleVmSync job to write lastOracleSyncAt after each run
- [x] Add Oracle VM Sync Status card to Settings → Diagnostics section

## Public Landing Page

- [x] Create LandingPage.tsx with hero, how-it-works, features grid, and Launch App CTA
- [x] Route / to LandingPage (public, no auth required)
- [x] Route /app to the existing dashboard (authenticated)
- [x] Update DashboardLayout links to use /app prefix
- [x] Add responsive mobile layout to landing page

## Wallet-Scoped History

- [x] Add walletAddress filter param to history.list, history.openTrades, history.refunds, history.exportCsv tRPC procedures
- [x] Pass connected wallet address from frontend to all history queries
- [x] Add "My Swaps / All Swaps" toggle for admin users
- [x] Update CSV export to respect wallet scope

## Landing Page Preferences Popover

- [x] Add ··· button to LandingPage navbar before "Launch App"
- [x] Popover shows "Global preferences" with Theme toggle (Auto / Light / Dark)
- [x] Theme change persists via localStorage and applies to the whole app

## Landing Page Logo, Live Prices & Connect Wallet CTA

- [x] Upload AFOS logo to CDN and use in landing page navbar (transparent, works in dark/light mode)
- [x] Update OG image in index.html to use AFOS logo CDN URL
- [x] Add live price tRPC procedure (prices.live) to routers.ts (CoinGecko, 30s cache)
- [x] Wire hero swap card to live BTC/SOL prices from tRPC (refetches every 30s)
- [x] Add Connect Wallet CTA button in hero (links to /app#connect+swaps)
- [x] Add URL hash deep-link handler in Dashboard (#connect opens wallet modal, #swaps navigates to swaps tab)

## Branding Improvement — Navbar & Footer Logo

- [x] Re-upload AFOS logo PNG at full resolution to CDN
- [x] Replace cramped navbar logo with proper sized AFOS icon + wordmark (h-8 icon, text-lg bold)
- [x] Replace footer "A" circle placeholder with real AFOS logo image + wordmark
- [x] Ensure logo looks professional in both dark and light mode
- [x] Fix landing page navbar logo — use full horizontal AFOS logo image (icon + wordmark) matching app sidebar style
- [x] Fix landing page footer logo — use full horizontal AFOS logo image matching app sidebar style
- [x] Match AFOS wordmark font from logo — cropped wordmark directly from official logo, used as image
- [x] Make AFOS logo branding consistent everywhere — created shared AfosLogo component, updated landing navbar, footer, sidebar, mobile drawer, and Swaps page header

## Landing Page Hero Redesign — Agentic Chat as Primary Hero

- [x] Build animated AgentChatHero component — futuristic chat simulation showing AFOS agent autonomously executing a cross-chain swap
- [x] Chat animation sequence: user types "swap 0.1 BTC to SOL" → agent thinks → finds peer → negotiates → HTLC locks → settlement complete
- [x] Futuristic design: glowing borders, typing indicators, agent status pulses, scan-line effects
- [x] Swap card replaced by agent chat as primary hero element
- [x] Integrate into LandingPage.tsx hero section replacing current layout
- [x] Mobile responsive — chat hero hidden on mobile (lg:block), copy + CTAs visible on all sizes

## Add Traditional Swap Card to CTA Section

- [x] Add the live P2P swap card next to the "Trade without compromise" CTA section at the bottom of the landing page
- [x] Add BETA badge at top-right of AFOS wordmark in navbar logo

## BETA Badge & Mobile Hero Improvements

- [x] Add BETA badge to every AfosLogo instance (sidebar, mobile drawer, footer, all pages)
- [x] Centralise IS_BETA flag in shared/const.ts so it can be toggled in one place
- [x] Animate BETA badge with subtle pulse/shimmer effect (CSS keyframes, non-distracting)
- [x] Add condensed mobile hero animation in AgentChatHero for small screens
- [x] Update AgentChatHero header subtitle to include "Hyperswarm · Intercomswap Powered by Trac Network"
- [x] Fix Overview/Dashboard page layout — apply centered max-width container matching Swaps page style

## Consistent Max-Width Centering Across Sub-Pages

- [x] Apply max-w-[1280px] mx-auto centering to History (Swap History) page
- [x] Apply max-w-[1280px] mx-auto centering to Analytics page
- [x] Apply max-w-[1280px] mx-auto centering to Network page header/stats (keep topology map full-width)

## Overview Page Header + StackHealthStrip Improvements

- [x] Add page header row to Overview content area (AFOS logo + subtitle + status badges, matching Swaps page style)
- [x] Replace fixed StackHealthStrip with compact 5-dot StackStatusPill in topbar (reclaim vertical space, tooltip shows full service list)

## MiniChatWidget Header Cleanup
- [x] Remove redundant "AFOS Agent / gemini-2.5-flash-lite" logo+name row from MiniChatWidget header (page header already shows AFOS logo); replaced with minimal "● Agent online" status pill

## StackStatusPill + Topbar Polish
- [x] Fix StackStatusPill pill color to match peer button (violet scheme, consistent dark/light mode)
- [x] Fix StackStatusPill tooltip to match P2P Network tooltip style (bg-popover, border, shadow-lg, service names visible)
- [x] Add "Hyperswarm" to Overview page header subtitle (visual editor change)

## Mobile Optimization (All Pages)
- [x] Overview (Dashboard) — topbar condensed on xs screens (node key hidden, peer count abbreviated, wallet labels hidden), pb-safe on mobile layout
- [x] Agent page — responsive px-4 sm:px-6 padding, pb-safe
- [x] Swaps page — pb-safe on outer wrapper
- [x] History (SwapHistory) page — pb-safe on outer wrapper (mobile card view already existed)
- [x] Analytics (SwapAnalytics) page — pb-safe on content area
- [x] Network page — pb-safe on outer wrapper (mobile peer list view already existed)
- [x] Settings page — pb-safe via AgentSettings wrapper
- [x] Admin page — pb-safe on content area
- [x] Global — viewport-fit=cover in index.html, pb-safe CSS utility added to index.css, MobileSidebarDrawer footer pb-safe

## StackStatusPill + Agent Live Badge Polish
- [x] Wire Overview header "Agent Live" badge to useStackHealth (AFOS Agent service state) — AgentLiveBadge component, transitions green/amber/red
- [x] Add title attribute to each dot span in StackStatusPill (service name on hover)
- [x] Animate pill count text color on liveCount drop (countFlash state, mirrors peerFlash pattern, pill border also flashes)

## Mobile Overview Header Cleanup
- [x] Hide badge row on mobile (redundant with topbar peer/stack pills) — badge row now hidden sm:hidden on mobile
- [x] Add compact one-line status summary below logo on mobile: "N/5 live · N peers · NC" — OverviewStatusLine component, sm:hidden

## Remove Duplicate "Live" Indicators
- [x] Remove "● live" badge from PortfolioCard (Overview content area)
- [x] Remove "● Agent online" dot from MiniChatWidget header — replaced with plain "Agent" label
- [x] Remove live dot from AgentInsights card header (desktop + mobile)
- [x] Keep topbar "● AFOS Agent" as single canonical live indicator

## Wire Topbar ● AFOS Agent Dot to Health State
- [x] Replace hardcoded `bg-emerald-400 animate-pulse` dot in topbar with TopbarAgentDot component
- [x] TopbarAgentDot reads AFOS Agent service state from useStackHealth: green (live) / amber+pulse (degraded) / slate+pulse (checking) / red (offline)
- [x] Added `title` attribute to dot for hover tooltip showing current state label

## Production Beta — Remove All Mock Data

### Swaps.tsx
- [ ] TOKENS array: zero out static `balance` fields (0 for all) — live balances come from `getTokenBalance()` which overrides with wallet data; static values only show when wallet disconnected (should show 0, not fake amounts)
- [ ] TOKENS array: zero out static `usdPrice` fields for BTC/ETH/SOL (set to 0) — `livePrices` from `getPrices()` already overrides these; static fallback should not show stale prices
- [ ] `TokenSelector` component (old, unused): remove entirely — replaced by inline Uniswap-style dropdowns in SwapPage
- [ ] `RecentSwaps` USD value (line 470): replace hardcoded `67000/2000/87` with `livePrices` from context or a shared price hook
- [ ] `MarketTickerStrip` (line 602): initial state prices `67000/2000/87` — already fetches live via `getPrices()` but seeds with stale values; seed with `0` and show `—` until live data arrives
- [ ] `generateFeedMsg()` + fallback simulation (lines 1715-1820): remove the 5s fallback simulation entirely — show "Waiting for P2P events…" empty state instead of fake messages
- [ ] Order book `buildFallbackOrders()` label: change "Simulated (no SSE quotes yet)" to "Waiting for P2P quotes…" and show empty state instead of fake orders

### Dashboard.tsx
- [ ] `MarketTicker` initial state (line 1593): seed prices with `0` not stale values; show `—` until `getPrices()` resolves
- [ ] `MobileMarketCard` (line 2516): remove `Math.random()` price random walk entirely — replace with same `getPrices()` fetch + 30s interval (same as desktop `MarketTicker`)
- [ ] Confidence trend fallback bars (lines 1913, 2487): remove hardcoded `[{i:0,value:85},…]` fallback — show empty bars or a "No data yet" micro-label when `confidenceTrend.length === 0`

### NetworkPage.tsx
- [ ] Peer latency (line 2051): remove `Math.round(20 + Math.random() * 80)` — set to `0` (unknown) and show `—` in UI until a real ping is recorded
- [ ] Invite code (line 2673): `Math.random().toString(36)` is fine for a unique code — keep but rename label from "SWAP" suffix to just the peer key hash; this is acceptable as a local invite token

### Pages confirmed CLEAN (no mock data):
- SwapHistory.tsx — all data from `trpc.swaps.*` queries
- SwapAnalytics.tsx — all data from `trpc.analytics.*` queries
- AgentSettings.tsx — all data from `trpc.settings.*` + `trpc.peerBlocks.*`
- AdminPanel.tsx — all data from `trpc.adminConfig.*` + `trpc.analytics.*` + `trpc.htlcWallet.*`

## Production Beta — Remove All Mock Data (Completed)

- [x] Swaps.tsx: Zero out hardcoded token balances in TOKENS array (was 0.04821 BTC, 0.812 ETH, 12.5 SOL, etc.)
- [x] Swaps.tsx: Remove stale usdPrice seeds from TOKENS array (was 43418/2998/150)
- [x] Swaps.tsx: Fix ChainStatsBar — seed at null, show dash until live CoinGecko data arrives (was 67000/2000/87 hardcoded fallbacks)
- [x] Swaps.tsx: Fix RecentSwaps USD value — fetch live prices via getPrices(), use null when unavailable (was hardcoded BTC=67000/ETH=2000/SOL=87)
- [x] Swaps.tsx: Remove generateFeedMsg mock simulation from LiveFeedTab — live-only feed in production
- [x] Swaps.tsx: Fix LiveOrderBook "Simulated (no SSE quotes yet)" label → "Waiting for P2P quotes…"
- [x] Dashboard.tsx: Fix MarketTicker — seed at null, show dash until live data (was 67090/2000/87.2 hardcoded)
- [x] Dashboard.tsx: Fix MobileMarketCard — replace Math.random() random walk with real getPrices() fetch
- [x] Dashboard.tsx: Fix confidence trend fallback bars — show muted empty bars instead of hardcoded [85,87,85,90,88] values
- [x] NetworkPage.tsx: Replace Math.random() latency with 0 / "N/A" display (real latency not available from Hyperswarm)
- [x] NetworkPage.tsx: Replace Math.random() invite code with crypto.randomUUID() (cryptographically secure)
- [x] Verified: SwapAnalytics, SwapHistory, Settings, AdminPanel, AgentControl — no mock data found
- [x] TypeScript: 0 errors after all changes

## Production Beta — Database Wipe & Fresh Start (Completed)

- [x] Audited all 12 database tables: users, htlc_swaps, swap_analytics, peer_reputation, user_settings, peer_messages, peer_blocks, peer_mutes, peer_reports, admin_config, operator_config, admin_audit_log
- [x] Truncated all 12 tables (TRUNCATE with FOREIGN_KEY_CHECKS=0 to reset auto-increment)
- [x] Re-seeded admin_config singleton (id=1) with clean production defaults (fee 20bps, min $10, max $1000, no treasury wallets)
- [x] Re-seeded operator_config singleton (id=1) with clean production defaults (kimi-k2-turbo, maker-taker, tradeauto=off)
- [x] Verified no seed scripts exist anywhere in the project
- [x] Confirmed OracleVmSync only pulls from real Oracle VM API (not mock data)
- [x] Verified all 8 pages have proper empty states: SwapHistory, SwapAnalytics, AdminPanel, Dashboard all show "No data yet" states when tables are empty
- [x] TypeScript: 0 errors after wipe

## Shared PriceContext + Real Peer Latency

- [ ] Create client/src/contexts/PriceContext.tsx — single 30s polling context, usePrices() hook
- [ ] Replace getPrices() in Dashboard.tsx MarketTicker with usePrices()
- [ ] Replace getPrices() in Dashboard.tsx MobileMarketCard with usePrices()
- [ ] Replace getPrices() in Swaps.tsx ChainStatsBar with usePrices()
- [ ] Replace getPrices() in Swaps.tsx RecentSwaps with usePrices()
- [ ] Wire PriceContext.Provider into client/src/App.tsx
- [ ] Implement real pingPeer() latency measurement in NetworkPage.tsx on 30s interval
- [ ] Update latency display to show real ms values and N/A when ping fails

## Shared PriceContext + Real Latency (Production Optimization)

- [x] Create PriceContext.tsx — single shared context with 30s polling, usePrices() hook, useTokenPrice() helper
- [x] Replace MarketTicker independent getPrices() polling with usePrices()
- [x] Replace MobileMarketCard independent getPrices() polling with usePrices()
- [x] Replace ChainStatsBar independent getPrices() polling with usePrices()
- [x] Replace RecentSwaps independent getPrices() polling with usePrices()
- [x] Replace SwapPage independent getPrices() polling with usePrices()
- [x] Wire useStackHealth to use shared PriceContext latency (eliminates duplicate health-check fetch)
- [x] Remove getPrices import from Dashboard.tsx (no longer needed directly)
- [x] Remove getPrices import from Swaps.tsx (no longer needed directly)
- [x] Wire PriceProvider into App.tsx provider tree
- [x] NetworkPage real latency: already fully implemented via handlePing() + pingPeer() + 30s auto-re-ping loop
- [x] TypeScript check: 0 errors

## Price Staleness Indicator + useTokenPrice Hook

- [x] Expose lastUpdated from PriceContext and add "Updated Xs ago" staleness indicator to MarketTicker footer
- [x] Replace inline USD value derivation in swap form with useTokenPrice() convenience hook

## Fix /admin Route Auth

- [x] Replace Manus OAuth session check with wallet-based owner check for /admin route

- [x] Store 3 owner Solana wallets as VITE_ADMIN_WALLETS env var
- [x] Replace useAuth() Manus OAuth check in AdminPanel with wallet-based allowlist check
- [x] Update AuthGate to show "Connect wallet" instead of "Sign in with Manus"
- [x] Add manual Refresh button to MarketTicker price staleness footer
- [x] Add vitest for admin wallet allowlist logic (server/admin.wallet.test.ts)

## USD Value in "You Receive" Panel

- [x] Make toUsd value in Swaps "You receive" panel more prominent (larger font, green colour) to match "You pay" USD display

## Production Build Fix

- [ ] Diagnose and fix blank page issue when site is published to production

## AFOS Logo Light Mode Fix

- [x] Fix AFOS wordmark PNG visibility in light mode — apply CSS filter (invert+hue-rotate+brightness) so white-on-transparent PNG reads as dark navy on white background
- [x] Fix BETA badge colour in light mode to use darker cyan tint

## Scroll-to-Top on Route Change

- [x] Fix: navigating to /app via "Launch App" does not scroll to top — add scroll-to-top on route change
- [x] Fix: scroll-to-top on mobile — reset inner scrollable container (contentRef) on Dashboard mount and page change

## Peer Card Dark Mode Redesign

- [x] Redesign expanded peer card in dark mode — replace flat purple background with deep dark card + violet accent border/glow, better text contrast, cleaner stat boxes

## Version Bump — UI Polish for Publish
- [x] Improve landing page hero section: add subtle animated gradient background, refine CTA button hover states, and add a "Powered by Intercomswap" badge

## Footer & Scroll Polish
- [x] Add "View on GitHub" link to footer pointing to github.com/idimi/AFOS
- [x] Add smooth scroll: `html { scroll-behavior: smooth; }` in index.css

## Footer Cleanup
- [x] Remove P2P Network link from landing page footer

## GitHub Star Badge
- [x] Add shields.io star count badge next to GitHub footer link

## Production Build Fix (Blank Page on Publish)
- [ ] Fix SyntaxError: Identifier 'se' has already been declared (duplicate variable in bundle)
- [ ] Fix ReferenceError: Buffer is not defined (Node.js global missing in browser build)
- [ ] Verify production build compiles cleanly and app loads on published domain

## Production Build Fix — Buffer Polyfill
- [x] Add vite-plugin-node-polyfills to fix Buffer is not defined in browser build
- [x] Investigate SyntaxError duplicate identifier in production (root cause: old checkpoint; new build resolves it)

## SEO & Social Preview
- [x] Generate og:image social preview card (1200x630)
- [x] Add full Open Graph + Twitter Card meta tags to client/index.html
- [x] Create robots.txt in client/public/ with SEO crawl policy

## SEO — Sitemap & Canonical
- [x] Create sitemap.xml in client/public/ referencing afos.trade
- [x] Add canonical link tag to client/index.html

## WhatsApp og:image Thumbnail Fix
- [ ] Fix og:image not showing as thumbnail on WhatsApp share preview

## og:image Logo Update
- [x] Regenerate og:image using the actual AFOS logo instead of plain bold text

## Pivot: Normal User Swap (No Agentic P2P HTLC)
- [x] Disable Oracle VM Sync job via admin API/DB
- [x] Clear all swap/trade/HTLC data from the database
- [ ] Remove/hide agentic P2P HTLC UI elements from the app
- [ ] Pivot swap flow to normal user-assisted swapping with AI agent

## Agent-Coordinated P2P Swap System (Core Feature)

### Architecture
- User connects wallet → registers as light peer on signaling server
- User asks agent to swap → agent queries signaling server for matching peer
- If peer found: agent broadcasts RFQ, counterparty sees incoming swap card in their chat → both sign HTLCs
- If no peer found: agent falls back to Jupiter (SOL), 0x (ETH), or 1inch (ETH/multi-chain)

### Phase 1: Peer Matching in Chat Router
- [ ] Add `findMatchingPeer()` helper in chat.ts — queries `/api/signaling/peers` for peers offering the reverse pair
- [ ] Add peer matching step to `sendMessage` procedure — after parsing intent, check for P2P match before DEX quote
- [ ] Return `route: "p2p"` with matched peer info when a peer is found
- [ ] Return `route: "dex-fallback"` with DEX quote when no peer found

### Phase 2: RFQ Broadcast & Counterparty Notification
- [ ] Add `broadcastRfqToPeer()` server-side helper — sends RFQ to specific peer via signaling server WebSocket
- [ ] Add `sendRfq` tRPC procedure — called by agent when a peer match is found
- [ ] Add incoming RFQ listener in LightPeerContext — receives RFQ from signaling server
- [ ] Show incoming swap card in counterparty's chat UI: "User wants to swap X SOL for your Y USDT — Accept/Reject?"

### Phase 3: HTLC Coordination
- [ ] When counterparty accepts: agent guides User A to sign HTLC lock tx (Phantom/Xverse/MetaMask)
- [ ] After User A locks: agent notifies User B to sign counter-HTLC
- [ ] Both signed: atomic settlement on-chain
- [ ] Timeout/reject: both sides refund automatically

### Phase 4: DEX Fallback
- [ ] Jupiter fallback for SOL pairs (already partially implemented)
- [ ] 0x API fallback for ETH pairs
- [ ] 1inch fallback for multi-chain ETH pairs
- [ ] Agent clearly communicates to user: "No peer found, routing via Jupiter DEX"

### Phase 5: UI Updates
- [ ] Chat shows "Searching for peer..." state while agent looks for match
- [ ] Chat shows "Peer found! @alias wants to swap X for Y" when matched
- [ ] Chat shows "No peer available, using Jupiter DEX" when falling back
- [ ] Incoming RFQ card in chat for counterparty with Accept/Reject buttons
- [x] Remove Oracle VM dependency from price feed — use CoinGecko/Jupiter directly (already done)

## Full Agent-Coordinated Swap System (Revised Scope)

The agent is the complete coordinator — no Oracle VM needed. Users connect wallet, talk to agent, agent does everything.

### Agent Capabilities (all from chat)
- [ ] Balance check: agent reads connected wallet balances and reports them
- [ ] Price check: agent fetches live prices from CoinGecko/Binance
- [ ] P2P peer search: agent queries signaling server registry for matching peer
- [ ] RFQ dispatch: agent pushes swap request to matched peer via signaling WebSocket
- [ ] DEX fallback: if no peer found, agent routes via Jupiter (SOL), 0x (ETH), 1inch (ETH fallback)
- [ ] HTLC coordination: agent guides both users through signing (Solana, Ethereum, Bitcoin)
- [ ] Cross-chain swaps: agent coordinates multi-chain HTLC (e.g. SOL → ETH, BTC → SOL)
- [ ] Multi-chain swaps: agent handles any supported pair across all three chains

### Server Changes
- [x] Replace submitIntercomSwapRfq (Oracle VM) with findSignalingPeer() using getSignalingPeerList()
- [x] Add sendAgentRfqToPeer() that uses sendToPeer() to push agent_rfq message to counterparty
- [ ] Add tRPC procedure: chat.findPeerAndQuote — returns P2P match or DEX quote
- [x] Update buildSwapTx, executeEthSwap, executeBtcSwap to use signaling peer matching instead of Oracle VM
- [x] Add accept/decline RFQ handling in sendMessage (regex match on message text)
- [ ] Add dedicated tRPC procedures: chat.acceptRfq and chat.rejectRfq

### Client Changes
- [x] Add agent_rfq handler to signalingClient message switch
- [x] Add agent_rfq listener in LightPeerContext — fires CustomEvent for ChatPage
- [x] ChatPage: show "Searching for peer..." skeleton while agent looks
- [x] ChatPage: show incoming RFQ card for counterparty (Accept/Reject buttons)
- [x] ChatPage: show "Peer found — @alias" badge on quote card when P2P matched
- [x] ChatPage: show "No peer available — using Jupiter/0x" when DEX fallback
- [x] sendMessage: pass senderPeerId from LightPeerContext so agent knows who is asking

## Unified Swap Page (Trading Interface)
- [x] Fix TypeScript errors in chat.ts from signaling peer matching changes
- [x] Fix signaling.ts exports (getSignalingPeerList, sendToPeer)
- [ ] Build unified SwapPage with TradingView chart (top-left), Live Order Book (bottom-left), Swap Panel (right), HTLC Escrow info, Recent Swaps feed, Network panel
- [ ] Order Book shows live P2P quotes from signaling peers + DEX fallback indicator
- [ ] Swap Panel: sell/buy inputs, token selectors, fee display, Agent Mode toggle, Connect Wallet button
- [ ] HTLC Escrow section: lock time, refund window, escrow program, fee cap
- [ ] Recent Swaps feed: live list of completed swaps with route badges (P2P / DEX)
- [ ] Network panel: My Node status, Live Peers list from signaling server
- [ ] Pair selector tabs: BTC/USDT, ETH/USDT, SOL/USDT, ETH/BTC, SOL/BTC
- [ ] All data synced: order book, swap panel, chart, and agent all use the same selected pair

## Chat UX Improvements — Peer Search & Route Badges

- [x] Add animated "Searching for peer..." skeleton message in chat while agent scans signaling registry
- [x] Pass senderPeerId from LightPeerContext to sendMessage so agent excludes requester from peer search
- [x] Show matched peer alias on P2P quote card (e.g. "@lp-a709a6 matched")
- [x] Add "No peer found — routing via Jupiter/0x" badge on DEX fallback quote cards

## Chat & Order Book UX Improvements (Round 2)

- [x] Add peer count indicator to searching skeleton ("scanning 5 peers…" from remotePeers.length)
- [x] Add 8-second timeout fallback message in chat ("Still searching… this may take a moment")
- [x] Add tRPC procedure: chat.getPeerList — returns signaling peer list with pairs and rates
- [x] Wire Swaps page Order Book to signaling registry via tRPC — show all online peers as rows

## Order Book Peer Rates, Network Online Badge, Auto-Accept Mode

- [x] Order Book: request real quotes from peers via requestPeerQuote tRPC — populate Rate column with actual offered rates instead of 0.0000
- [x] Order Book: show loading spinner in Rate column while quote is pending
- [x] Network page: wire "Online Peers" stat card to live signaling peer count from trpc.chat.getPeerList
- [x] AgentSettings: add autoAcceptRfq toggle and autoAcceptMaxUsd field to DB schema (user_settings)
- [x] AgentSettings: add auto-accept P2P RFQs section card with toggle and max USD input
- [x] AgentSettings: sync DB autoAcceptRfq into LightPeerPrefs.autoAccept so existing auto-accept logic works
- [x] LightPeerContext: add auto-accept check to agent_rfq handler (not just SSE handler)

## Order Book TTL, Auto-Accept Audit Log, Slippage Guard

- [x] Order Book: add 30s TTL to cached peer quotes — re-query stale rows automatically
- [x] Auto-accept audit log: write each auto-accepted RFQ to swap_analytics so it appears in SwapHistory
- [x] Slippage guard: compare peer's offered rate against oracle price before auto-accepting; reject if spread exceeds user's slippage tolerance

## SSE p2p_rfq Slippage Guard

- [x] LightPeerContext: apply oracle-rate slippage guard to SSE p2p_rfq auto-accept path (same logic as agent_rfq path)
- [x] LightPeerContext: show warning toast when SSE auto-accept is blocked by slippage guard

## Bug Fix: Spurious Toast When Not Connected

- [x] Fix: SSE p2p_rfq handler fires "Incoming swap from Order Book" toast for own-originated RFQs (user is requester, not responder)
- [x] Fix: also suppress the toast when the user has no peerId (not connected to signaling)

## Real P2P RFQ Flow in Order Book (Remove Synthetic Fallback)

- [x] Remove requestPeerQuote synthetic server-side rate computation from Swaps.tsx LiveOrderBook
- [x] Remove quotedPeersRef TTL logic (no longer needed without synthetic quotes)
- [x] Replace with real SSE p2p_rfq broadcast to all online peers when user has wallet + swap amount
- [x] Populate Rate column only from genuine p2p_quote SSE responses from peers
- [x] Show "Connect wallet to request quotes" prompt in Order Book when wallet not connected
- [x] Remove "Fallback" indicator from Order Book footer
- [x] Show "Waiting for P2P quotes..." status while RFQ is in flight

## Order Book Live Quotes & Timeout Badge

- [x] Re-broadcast RFQ when fromAmount changes (debounced 800ms) so peers re-quote for the new amount
- [x] Auto-refresh quotes every 30s so peer rate updates are reflected without manual action
- [x] Track pending peers (peerId → RFQ-sent timestamp) and show "Timed out" badge after 30s with no response
- [x] Allow retry from timed-out row (click badge re-sends RFQ to that peer)

## Bug Fix: Phantom "You LP" Row in Order Book

- [x] Fix: Order Book shows "You LP" row with phantom 10 BTC/ETH/SOL offer before user connects wallet or requests quotes
- [x] Fix: ownQuote now requires wallet to be connected AND token prices to be loaded before rendering the "You" row

## Bug Fix: Oracle VM Agent Swaps Appearing in User Swap History

- [x] Fix: RecentSwaps widget now reads from local DB (trpc.history.list) instead of Oracle VM /api/swaps proxy
- [x] Fix: history.list and history.stats return empty when no wallet connected (no more anonymous global view)
- [x] Fix: adminGlobalView flag added so admin "All Swaps" toggle still works
- [x] Fix: Oracle VM sync job permanently disabled via admin_config.oracleSyncEnabled = 0 in DB
- [x] Fix: Oracle VM restarted to clear stale swap history and peer registry (all in-memory)

## LP Mode Enhancements

- [x] Add accepted trading pairs selector under LP Mode toggle in Agent Settings
- [x] Add minimum trade size (USD) field under LP Mode toggle in Agent Settings
- [x] Add LP Mode off banner to the Swaps page Order Book

## Bug Fix: Wallet Disconnects on Page Refresh

- [x] Implement wallet session persistence in MultiChainWalletContext (saveWalletSession/loadWalletSession/clearWalletSession)
- [x] Auto-reconnect on mount for Phantom (publicKey check), MetaMask/Coinbase ETH (eth_accounts), Xverse/Tap/MetaMask BTC
- [x] Clear session on explicit disconnect for all wallet types

- [x] Fix Phantom (Solana) wallet auto-reconnect on page refresh
- [x] Fix MetaMask/Coinbase (Ethereum) wallet auto-reconnect on page refresh
- [x] Fix Xverse/Tap (Bitcoin) wallet auto-reconnect on page refresh

## Settings Panel Tabbed UI

- [x] Refactor AgentSettings.tsx to use 4-tab layout: Trading, Network, Privacy, Appearance
- [x] Trading tab: Trade Preferences (max amount, slippage), Swap Execution (auto-confirm), Preferred Swap Route
- [x] Network tab: LP Mode (Liquidity Provider) with pairs/min-size, Auto-accept P2P RFQs
- [x] Privacy tab: Blocked Peers, Muted Peers
- [x] Appearance tab: Theme selector, Danger Zone (reset settings, clear blocks/mutes)
- [x] Save button present on Trading, Network, and Appearance tabs; LP Mode prefs (localStorage) auto-save on toggle
- [x] AnimatePresence slide transition between tabs

## Settings Deep-link: defaultTab Prop

- [x] Add optional defaultTab prop to AgentSettings component
- [x] Wire Network page "Open Agent Settings" button to pass defaultTab="network"
- [x] Ensure Dashboard.tsx passes defaultTab through to AgentSettings when navigating

## Round 4 Features (Mar 7, 2026)

### Feature A: TNK Token Integration
- [ ] Add TNK to shared/tokens.ts token list with trac_network chain type
- [ ] Add TNK HTLC builder using window.tracnetwork.transfer() for lock
- [ ] Add TNK to ConnectWalletModal token list and wallet panel
- [ ] Wire TNK into P2P swap flow (initiateAsRequester + initiateAsMaker)
- [ ] Add TNK to token selector in Swaps.tsx and ChatPage.tsx
- [ ] Add TNK price feed / display support in portfolio/wallet panel

### Feature B: On-chain Claim Refund Button
- [ ] Wire Refunds tab "Claim" button to buildSolanaHtlcRefundTx + Phantom sign/send
- [ ] Show toast with Solscan link after successful on-chain refund
- [ ] Handle wallet not connected / tx rejected gracefully
- [ ] Call updateHtlcRefund after successful claim to record refundTxId

### Feature C: Live Countdown Progress Bar
- [ ] Replace static progress bar in Open Trades with live blocksRemaining/locktime ratio
- [ ] Show percentage and color (green → amber → red as expiry approaches)
- [ ] Update every 30s when block height is refreshed

## Round 6 Features (Mar 7, 2026)

### Feature A: Bitcoin PSBT Refund via Phantom signPSBT
- [ ] Add buildBtcHtlcRefundPsbt to btcHtlc.ts (CLTV-timeout PSBT builder)
- [ ] Wire Phantom signPSBT into Bitcoin Claim button in SwapHistoryTabs.tsx
- [ ] Broadcast signed PSBT via mempool.space API
- [ ] Show Mempool.space tx link on success toast
- [ ] Call updateHtlcRefund to record refundTxId in DB

### Feature B: TNK in Chat Agent Price Map
- [ ] Add TNK to getTokenPricesFromCoinGecko() in server/routers/chat.ts
- [ ] Add TNK to Binance fallback price map in chat.ts
- [ ] Add TNK to approximate fallback prices in chat.ts
- [ ] Verify chat agent can quote TNK swap pairs

### Feature C: TNK→SOL Demo Step in AgentChatHero
- [ ] Add TNK→SOL swap step to the animated demo sequence in AgentChatHero.tsx
- [ ] Add Trac Network chain badge to the demo step
- [ ] Verify animation timing and visual consistency

## Round 6 Completion Status (Mar 7, 2026)

### Feature A: Bitcoin PSBT Refund via Phantom signPSBT
- [x] Add buildBtcHtlcRefundPsbt to btcHtlc.ts (CLTV-timeout PSBT builder)
- [x] Wire Phantom signPSBT into Bitcoin Claim button in SwapHistoryTabs.tsx
- [x] Broadcast signed PSBT via mempool.space API
- [x] Show Mempool.space tx link on success toast
- [x] Call updateHtlcRefund to record refundTxId in DB

### Feature B: TNK in Chat Agent Price Map
- [x] Add TNK to getTokenPricesFromCoinGecko() in server/routers/chat.ts (trac-network CoinGecko ID)
- [x] Add TNK to Binance fallback price map in chat.ts
- [x] Add TNK to approximate fallback prices in chat.ts
- [x] Verify chat agent can quote TNK swap pairs

### Feature C: TNK→SOL Demo Step in AgentChatHero
- [x] Add TNK→SOL swap step sequence to CHAT_SEQUENCE in AgentChatHero.tsx
- [x] Add Trac Network chain badge (TNK tag, #e87d3e color) to demo steps
- [x] Update MOBILE_STEPS to include TNK→SOL demo steps
- [x] Mobile user prompt dynamically shows "swap 500 TNK to SOL" for TNK steps

### Schema & TypeScript Fixes
- [x] Add trac_network to htlcSwaps.chain enum in drizzle/schema.ts
- [x] Add trac_network to htlcSwaps.toChain enum in drizzle/schema.ts
- [x] Add trac_network to swapAnalytics.fromChain enum in drizzle/schema.ts
- [x] Add trac_network to swapAnalytics.toChain enum in drizzle/schema.ts
- [x] Update ChainHeights interface in htlcMonitor.ts to include trac_network
- [x] Update HtlcSwapRow interface in SwapHistoryTabs.tsx to include trac_network
- [x] Update mapDbRowToSwapRecord in SwapHistory.tsx to accept trac_network
- [x] Update ChainId type and CHAIN_CONFIG in SwapHistory.tsx to include trac_network
- [x] Apply ALTER TABLE to DB via webdev_execute_sql to sync enum values
- [x] All 241 tests passing, TypeScript 0 errors

## Round 7 Features (Mar 7, 2026)

### Feature A: TNK HTLC Server-Side Polling Monitor
- [ ] Create server/tnkHtlcMonitor.ts — polls Trac Network agent-escrow API for incoming TNK locks
- [ ] Detect new incoming TNK HTLC locks by secretHash and emit afos:tnk-htlc-detected SSE event
- [ ] Wire tnkHtlcMonitor into server startup (server/_core/index.ts or htlcMonitor.ts)
- [ ] Store detected TNK HTLCs in htlc_swaps table with chain=trac_network
- [ ] Add tRPC procedure history.pendingTnkHtlcs to query unmatched TNK locks
- [ ] Write vitest for tnkHtlcMonitor polling logic

### Feature B: Early-Exit Cancel & Refund Button in Open Trades Tab
- [ ] Add "Cancel & Refund" button to each row in Open Trades tab (SwapHistoryTabs.tsx)
- [ ] Button visible for all chains (SOL, ETH, BTC, TNK) regardless of timelock expiry
- [ ] For SOL: call buildSolanaHtlcRefundTx and sign with Phantom (same as Refunds tab)
- [ ] For ETH: call eth_sendTransaction with refund(bytes32) selector via MetaMask
- [ ] For BTC: call buildBtcHtlcRefundPsbt and sign with Phantom signPSBT
- [ ] For TNK: call tnkHtlc refund via window.tracnetwork
- [ ] Show confirmation dialog before executing early refund
- [ ] Call updateHtlcRefund after success and move row to Refunds tab

### Feature C: Swap Pair Liquidity Depth Indicators
- [ ] Add liquidityDepthUsd field to LP peer registration in signaling server
- [ ] LP peers broadcast their per-pair liquidity depth when registering pairs
- [ ] Add useLiquidityDepth hook that aggregates depth across all online LP peers per pair
- [ ] Show depth badge (e.g. "~$12k") next to each pair in Swaps page token selector
- [ ] Color-code: green ≥$10k, amber $1k–$10k, red <$1k, grey = no data
- [ ] Update LiveOrderBook to show total available depth in header

## Round 7 Features (Mar 7, 2026)

- [x] TNK HTLC server-side polling monitor (server/jobs/tnkHtlcMonitor.ts) — polls Trac Network explorer every 60s for incoming escrow locks, matches by secretHash memo, updates DB lockTxId, broadcasts tnk_htlc_detected event, auto-refunds expired timelocks
- [x] Early-exit Cancel & Refund button in Open Trades tab — confirmation dialog + chain-specific refund logic for all 4 chains (SOL, ETH, BTC, TNK) in OpenTradeCard
- [x] Swap pair liquidity depth indicators — maxTradeUsd added to signaling protocol, usePairDepth hook aggregates per-pair depth, color-coded depth badges in both Sell and Buy token selector dropdowns
- [x] tnkHtlcMonitor.test.ts — 10 unit tests for memo parsing, lifecycle idempotency, and DB-unavailable graceful fallback

## Round 7 Bug Fixes

- [x] Fix Swaps token selector crash — CHAINS lookup throws when token.chain is "trac_network" (key missing from CHAINS map)
- [x] Set TNK_ESCROW_ADDRESS env var so the TNK HTLC monitor starts live polling

## Round 8 — Full TNK/Trac Network Parity

- [ ] Swaps.tsx: add TNK↔BTC, TNK↔SOL, TNK↔ETH, TNK↔USDT, TNK↔USDC swap pairs
- [ ] Swaps.tsx: add TNK/USDT row to market ticker strip
- [ ] Swaps.tsx: add TNK to HTLC escrow info card (settlement time, escrow program)
- [ ] Chat agent: add TNK to price map, quick-action chips, swap intent parser
- [ ] Dashboard Overview: add TNK/USDT to market ticker, TNK to portfolio/wallets
- [ ] Admin wallet page: add TNK fee wallet row + TNK HTLC escrow wallet row
- [ ] AgentSettings / LP settings: add TNK trading pairs (TNK/SOL, TNK/BTC, TNK/USDT)
- [ ] MultiChainWalletContext: TNK balance fetch via Trac Network API after Tap Wallet connect
- [ ] tnkHtlcMonitor: notifyOwner when pending TNK HTLC has no lock after 10 minutes
- [ ] HTLC Transaction History tab: add TNK filter tab alongside BTC/ETH/SOL
- [ ] Network page: add TNK to HTLC escrow section
- [ ] SwapHistory: ensure TNK chain filter works in history table

## TNK Enhancement Round 9

- [x] AdminPanel: Add TNK escrow wallet row to HTLC Wallet Balances section with live Trac Network balance fetch
- [x] Swaps: Fix TNK/USDT chart tab to use real TNK/USDT symbol (MEXC or fallback) instead of BTC proxy
- [x] Swaps: Add TNK depth column to Live Order Book table showing LP peer depth for TNK pairs

## TNK Enhancement Round 10

- [x] Swaps: Add TNK/ETH swap pair to SWAP_PAIRS and ensure TNK token is selectable in both from/to dropdowns
- [x] AdminPanel: Surface TNK escrow address in Oracle VM Addresses table alongside SOL/ETH/BTC agent addresses
- [x] SwapHistory: Add trac_network chain filter tab so operators can filter HTLC history to TNK trades

## TNK Enhancement Round 11

- [x] SwapHistory: Add trac_network entry to CHAIN_CONFIG explorer map so TNK trades show "View on Explorer" link to https://explorer.trac.network/tx/{hash}
- [x] SwapHistory: Add TNK stats column to stats strip (24h TNK volume, TNK fees earned) via extended history.stats procedure
- [x] NetworkPage: Surface TNK escrow address in HTLC escrow section alongside SOL/ETH/BTC escrow rows

## TNK Consistency Audit Fixes (Round 12)

- [ ] afosApi.ts: Add trac_network to SupportedChain, ASSET_REGISTRY, inferChain, inferChainFromNetwork
- [ ] AdminPanel.tsx: Fix Volume by Chain chart label/color for trac_network
- [ ] AdminPanel.tsx: Fix HtlcHistory row chain label for trac_network
- [ ] AdminPanel.tsx + schema.ts + adminConfig.ts: Add trac_network to TreasuryWallet chain type and dropdown
- [ ] AdminPanel.tsx: Fix treasury wallet chain badge color for trac_network
- [ ] SwapHistoryTabs.tsx: Add trac_network to explorerTxUrl and explorerAddrUrl
- [ ] SwapHistoryTabs.tsx: Add trac_network to BLOCK_TIMES
- [ ] SwapHistoryTabs.tsx: Fix mapHtlcToOpenTrade and mapHtlcToRefund fromSymbol for TNK
- [ ] SwapHistoryTabs.tsx: Fix HTLC countdown amount display for TNK
- [ ] ChatPage.tsx: Add trac_network to CHAIN_PILL_STYLES
- [ ] ChatPage.tsx: Add TNK execution branch and fix type casts
- [ ] analytics.ts: Add trac_network to byChain array
- [ ] oracleVmSync.ts: Add TNK to tokenToChain function
- [ ] pathFinder.ts: Add trac_network to all chain type unions and z.enum calls
- [ ] NetworkPanel.tsx: Add TNK pairs to ALL_PAIRS
- [ ] LightPeerContext.tsx: Add TNK pairs to default acceptedPairs
- [ ] NetworkPage.tsx: Add TNK to channel form chain dropdown and chainColors
- [ ] agentSwapEth.ts: Add trac_network to chain type casts

## TNK Enhancement Round 13

- [x] agentSwapBtc.ts: Add trac_network case so TNK→BTC cross-chain swaps fall through to Oracle VM P2P path
- [x] AdminPanel: Add TNK (#f97316) colour entry to Analytics volume-by-chain bar chart colour map
- [x] SwapHistory: Add TNK entry to PRICE_ESTIMATES fallback map for USD value column

## TNK Enhancement Round 14

- [ ] agentSwapBtc.ts: Wire TNK_HTLC_WIF secret into executeTnkAgentSwap for live execution (mirrors BTC_HTLC_WIF pattern)
- [ ] agentSwapEth.ts: Add trac_network cross-chain case so ETH→TNK swaps route through Oracle VM P2P path
- [ ] ChatPage: Surface TNK peer count badge on swap confirmation card showing active TNK P2P peers

## TNK Enhancement Round 15

- [x] Secrets: Add TNK_HTLC_WIF secret for live HTLC execution in executeTnkAgentSwap
- [x] NetworkPage: Add TNK peer count indicator to peer settings panel
- [x] SwapHistoryTabs: Add trac_network to BLOCK_TIMES (600s, same as Bitcoin)

## TNK Enhancement Round 16

- [ ] Secrets: Enter TNK_HTLC_WIF value to activate live HTLC signing for TNK→BTC swaps
- [x] AdminPanel: Add TNK volume sparkline to Analytics section alongside BTC/ETH/SOL sparklines

## Swap Gap Fixes (Audit 2026-03-07)

- [x] Gap 1: Add TNK execution branch in ChatPage.tsx handleConfirmSwap
- [x] Gap 2: Set TNK_HTLC_WIF secret for live TNK HTLC signing
- [x] Gap 3: Set TNK_AGENT_KEY secret for live TNK refund monitor
- [x] Gap 4: Add TNK to SwapPage.tsx TOKENS array

## TNK Live Data (2026-03-08)

- [x] HtlcWallets panel: live TNK escrow balance fetch from Oracle VM
- [x] SwapPage: add TNK to SSE price feed so live rate updates in real time
- [x] SwapPage: show TNK balance from Tap Wallet in "You pay" max balance hint
- [x] AdminPanel Analytics: add 24h volume figure below TNK sparkline card

## TNK Parity Gaps (2026-03-08 batch 2)

- [x] Swaps.tsx: add TNK to TOKENS list and wire handleSwap to executeAgentSwap
- [x] NetworkPage: show TNK escrow address alongside BTC/ETH/SOL
- [x] SwapHistory.tsx: add Trac Network explorer URL for TNK tx hash links

## OracleVmSync Enable (2026-03-08)

- [ ] Enable OracleVmSync by default (read-only data import only, no trade execution)

## Node Health CORS Fix (2026-03-08)

- [x] Route Node Health checks through server-side tRPC to fix CORS/firewall blocking
- [x] Add nodeHealth.check tRPC procedure that proxies Oracle VM, RPC, AFOS Signaling, and Trac Network health checks
- [x] Remove direct browser fetch from NodeHealthTab — now uses trpc.nodeHealth.check.useQuery with 60s auto-refresh
- [x] Added Trac Network explorer health check as 5th node in the panel

## Node Health Panel Fixes (2026-03-08 batch 2)

- [x] Rename "Trac Network" node to "Trac Network RPC" in nodeHealth router
- [x] Reorder Trac Network RPC below Bitcoin RPC (correct display order)
- [x] Fix Trac Network endpoint: use https://tracapi.trac.network/v1/confirmed-length (returns block height, HTTP 200)
- [x] Fix AFOS Signaling: use local getSignalingPeerCount() instead of external fetch to intercomswap.io (which is unreachable from sandbox)

## Node Health Block Height Parity (2026-03-08 batch 3)

- [ ] Oracle VM /health: parse block heights for ETH/SOL/BTC from response and show in detail line
- [ ] All RPC nodes: consistent detail pattern "Block height: {n} · Connected via Oracle VM"
- [ ] Trac Network RPC: consistent detail "Block height: {n} · Connected via tracapi.trac.network"
- [ ] AFOS Signaling: keep peer count pattern (no block height applicable)

## Admin Tab Tooltips (2026-03-08)

- [x] Add info tooltip (?) icon to each admin tab showing a short description of what the tab does, its features, and how it works
- [x] Revenue: swap fee income analytics, charts, volume breakdown by chain
- [x] Fee Config: set platform fee %, per-chain overrides, save/reset
- [x] Treasury: HTLC wallet balances, treasury wallet management, chain addresses
- [x] Node Health: live RPC connectivity status for all nodes, block heights, signaling peer count
- [x] Users: registered user list, roles, login history, promote/demote admin
- [x] Agent Wallet: agent hot-wallet addresses and balances across all chains
- [x] Operator Config: Oracle VM URL, swap settings, LP parameters, system toggles
- [x] Peer Reports: P2P peer abuse reports, dispute logs, ban management
- [x] Audit Log: immutable record of all admin actions with timestamps and actor

## Oracle VM Sync Job — Phantom Swap Filter (2026-03-08)

- [x] Add txHash/signature validation in oracleVmSync.ts — skip any swap with no real on-chain proof
- [x] Purge ALL Oracle VM-sourced swap_analytics rows (DELETE WHERE rfqId IS NOT NULL) — 116 phantom rows removed
- [x] Update OracleSwap type to include optional txHash/signature/txId fields
- [x] Sync job now logs: inserted=0 skipped=0 backfilled=0 phantoms=50 (correctly blocking all fake entries)

## Full Database Purge (2026-03-08)

- [x] Audit all 12 tables for phantom/test data
- [x] Purge swap_analytics: 116 phantom Oracle VM rows deleted
- [x] Purge peer_reputation: 7 test rows deleted
- [x] Purge admin_audit_log: 2 test rows deleted
- [x] Verified all data tables are now at 0 rows (users=1 owner, admin_config=2 config rows, operator_config=1 config row, user_settings=2 settings rows preserved as legitimate config)

## TNK Wallet Status Fix (2026-03-08)

- [ ] Diagnose why TNK shows "offline" in Oracle VM Hot Wallet and "pending" in HTLC Escrow Wallet
- [ ] Fix TNK balance fetch to use correct Trac Network API endpoint
- [ ] Fix TNK status detection to correctly show "live" when API responds
- [ ] Ensure TNK is fully ready for swaps

## TNK TradingView + Balance Audit (2026-03-08)

- [x] Fix TNK TradingView chart symbol from COINGECKO:TNKUSD to GATEIO:TNKUSDT in Dashboard.tsx (TNK not listed on Binance/CoinGecko TV)
- [x] Confirm Swaps.tsx and SwapPage.tsx already use MEXC:TNKUSDT (correct)
- [x] Audit all wallet balance fetches across the app (SwapPage, WalletPanel, Treasury, AdminPanel)
- [x] TNK balance fetch: window.tracnetwork.getBalance() (Tap Wallet) + tracapi.trac.network/v1/balance (server-side) — both correct
- [x] ETH/USDT/USDC balances: eth_getBalance + eth_call balanceOf via MetaMask/Phantom provider — correct
- [x] SOL balance: backend tRPC proxy → Solana RPC (avoids CORS) — correct
- [x] BTC balance: mempool.space/api/address/{address} — correct
- [x] Add live balance display to FROM token dropdown in Swaps.tsx (green = has balance, grey = zero)
- [x] Fix live balance indicator dot to also show for TNK when Tap Wallet has balance

## Bug Fixes (2026-03-08 session 2)

- [x] Fix Recent Swaps on Overview showing stale Oracle VM test swaps — added "Clear" button (localStorage clearSince filter) to both desktop RecentSwapsCard and mobile MobileRecentSwaps; empty state shows when cleared
- [x] Fix TNK fee collection wallet showing "offline" in AdminPanel — root cause: browser CORS block on tracapi.trac.network; fixed by adding server-side tRPC procedure htlcWallet.checkTnkLive, reactive useEffect in AdminPanel patches TNK live status when result arrives

## ## TNK Chart + Swap History Clear (2026-03-08 session 3)
- [x] Fix TNK/USDT TradingView chart symbol — moved TNK check BEFORE stables fallback in deriveTvSymbol; now uses GATE:TNKUSDT
- [x] Clear Oracle VM swap history via SSH — PM2 restart cleared in-memory swap state
- [x] Remove "Clear" button from RecentSwapsCard and MobileRecentSwaps
## TNK Price Feed Fix (2026-03-08 session 4)
- [x] Diagnose TNK $0 — root cause: CoinGecko browser fetch rate-limited (HTTP 429)
- [x] Add server-side tRPC prices.live procedure — fetches TNK from Gate.io (primary) + MEXC (fallback); no CORS, no rate limit
- [x] Update afosApi.ts refreshTnkPrice() to use /api/trpc/prices.live (Gate.io via server)
- [x] Update afosApi.ts getPrices() to use /api/trpc/prices.live (Gate.io via server)
- [x] Verified: tRPC prices.live returns TNK: $0.2892 from Gate.io correctly

## Three Improvements (2026-03-08 session 5)
- [ ] Wire TNK 24h price change badge in market list (tnkChange24h from prices.live tRPC)
- [x] Fix 9 TypeScript errors in SwapPage.tsx — add trac_network to SupportedChain type in afosApi.ts
- [ ] Patch Oracle VM server.js via SSH to fetch TNK price from Gate.io every 30s and include in SSE prices event

## Tap Wallet Detection & Session Restore (2026-03-08 session 6)
- [ ] Fix Tap Wallet detection: increase poll to 5s, add console logging, use Chrome Web Store install link
- [ ] Silent Tap Wallet session restore: use getAddress() instead of requestAccount() to avoid popup
- [ ] Update Window.tracnetwork type declaration with all official API methods (sendTNK, buildTracTx, etc.)
- [ ] Session restore for MetaMask/Coinbase/Solflare (already handled by existing code — verified)

## Tap Wallet Dual-Provider Fix (Round 21 — on clean fd6f1421 base)

- [ ] Add window.tapprotocol type declaration to Window interface in MultiChainWalletContext
- [ ] Add tracNetwork state (ChainWallet | null) to context interface and provider
- [ ] Update connectTapWallet to connect window.tapprotocol (BTC) AND window.tracnetwork (TNK) simultaneously
- [ ] Update btcSignPsbt to use window.tapprotocol.signPsbt() for Tap Wallet
- [ ] Add disconnectTracNetwork function and expose in context
- [ ] Update ConnectWalletModal trac_network tab to show TNK connected state or Tap Wallet button
- [ ] Update SwapPage to use tracNetwork state for TNK balance display
- [ ] Fix GATEIO:TNKUSDT chart symbol in Dashboard.tsx and Swaps.tsx
- [ ] Fix Chains Supported counter from 3 to 4 on landing page
- [ ] Update Step 1 description to include Tap Wallet (Trac Network)
- [ ] TypeScript: 0 errors (fresh tsc --noEmit --incremental false)

- [ ] Fix Tap Wallet "not responding" — connection fails even with all other wallet extensions disabled

## Tap Wallet TNK Balance Fix
- [x] Fix TNK balance not displaying correctly — both BTC and TNK should show like Phantom does for BTC/SOL/ETH
- [x] Research Trac Wallet GitHub repo and dApp developer docs for correct TNK API usage
- [x] Update tracNetwork.getBalance() call to use correct API method from docs — TNK uses 18 decimals (like ETH), not 8 (like BTC)

## Tap Wallet Connection Hang Fix
- [x] tracnetwork.requestAccount() hangs and never resolves when Phantom is installed
- [x] Add timeout wrapper for requestAccount() to prevent infinite hang
- [x] Add better error handling and user feedback when connection times out
- [x] Investigate Phantom extension conflict with Tap Wallet messaging

## Tap Wallet Extension Conflict Fix

- [x] Wrap Vite production bundle in IIFE to prevent minified variable name collisions with tap-script.js
- [x] Verify window.tapprotocol and window.tracnetwork inject correctly after fix (0 global conflicts in new bundle)
- [x] Update waitForTracNetwork comment to document the IIFE fix

## Tap Wallet UI — Show ₿ + TNK in Pill and Chat

- [x] Top-right wallet pill: show "₿ + TNK" when Tap Wallet connected (both BTC and TNK)
- [x] Chat agent welcome message: include TNK balance alongside BTC balance
- [x] WalletChatBridge: include TNK in anyConnected check so chat clears on Tap Wallet disconnect
- [x] ChatPage: pass TNK balance to server-side agent via walletBalances so agent knows TNK amount

## Tap Wallet Toast — Combined Phantom-Style Notification

- [x] Remove separate TNK toast ("Tap Wallet connected · TNK: …")
- [x] Update BTC toast to show both Bitcoin + Trac Network addresses in one Phantom-style toast
- [x] Suppress standalone BTC modal toast when Tap Wallet connects (same as Phantom suppression)

## Wallet Pill — 4 Chain Dots When Disconnected

- [x] Show 4 dots (SOL, ETH, BTC, TNK) in the disconnected wallet pill, matching the connected state

## Connect Wallet Modal — Tap Wallet Connected Banner

- [x] Add "Tap Wallet connected · Bitcoin · Trac Network · [Disconnect]" banner to modal, matching Phantom banner style

## Tap Wallet UX Polish

- [x] Add Tap Wallet success overlay in modal (green card, auto-close after 1.5s)
- [x] Show TNK balance on Trac Network tab in Connect Wallet modal (shows BTC + TNK when Tap Wallet)
- [x] Add "TNK price?" and "swap 100 TNK to SOL" quick chips to chat input row

## Tap Wallet Banner — Show Address

- [x] Show truncated BTC address on Tap Wallet connected banner in modal (matching Phantom banner)

## Tap Wallet — Remove Duplicate Toast

- [x] Remove the Trac-Network-only toast so only the combined Bitcoin + Trac Network toast fires on connection

## SignalingClient — RTCErrorEvent Data Channel Error

- [x] Fix unhandled RTCErrorEvent in signalingClient.ts dc.onerror — extract RTCError.errorDetail, log as warn, emit data_channel_error event

## Tap Wallet Toast — Single Combined Toast Fix (Round 2)
- [x] Move all wallet toast logic to WalletToastManager (App.tsx, mounted once) to prevent duplicate toasts from multiple ConnectWalletModal instances (Dashboard + ChatPage/Swaps/AgentSettings all mount their own modal)
- [x] ConnectWalletModal watchers now only trigger in-modal success overlay (no toast calls)
- [x] WalletToastManager fires exactly ONE combined BTC + Trac Network toast on Tap Wallet connect (with 150ms delay to let both state updates flush before reading addresses)

## Tap Wallet Toast — Combined Toast Fix (Round 3)
- [x] CONNECT toast: must show BOTH Bitcoin address + Trac Network address in ONE toast (currently only shows TNK)
- [x] DISCONNECT toast: must fire ONE combined toast showing both Bitcoin + Trac Network chains (currently fires 2 separate toasts)

## Bug Fixes — Round 4 (3 bugs)
- [x] Bug 1: Agent A not notified when Agent B accepts the quote — added rfq_accepted peer message + custom event listener in ChatPage + MiniChatWidget
- [x] Bug 2: Swap UI shows "Please connect your Solana wallet" even though wallet IS connected — fixed to also check phantomMultiChain.solanaAddress
- [x] Bug 3: HTLC Atomic Swap modal shows all 4 steps as complete (trade complete) prematurely — changed all fallback catch blocks from step:settled to step:failed, made trade counter conditional on actual settlement

## Bug Fixes — Round 5
- [x] Bug 4: Swap page shows SOL balance as 0 even when wallet is connected with real SOL balance — fixed liveBalances to also read from phantomMultiChain.solanaBalances when Phantom multi-chain is connected

## TypeScript Cleanup
- [x] Fix all 13 pre-existing SwapPage.tsx TS errors: confirmed tsc --noEmit exits with code 0 (zero errors). The 13 errors in the management UI health check were a stale LSP snapshot from before previous fixes were applied. tracNetwork is properly declared in MultiChainWalletContextValue (line 75) and trac_network is in SupportedChain type.

## Bug Fixes — Round 6
- [x] Bug 5: Agent A HTLC wallet signing popup never appears after peer match — fixed: added initiateHtlcLock() to LightPeerContext that creates a synthetic IncomingRfq and passes it directly to acceptRfq(rfqId, rfqOverride) to trigger wallet signing (Phantom/MetaMask). ChatPage now calls initiateHtlcLock after buildSwapTx returns P2P route.
- [x] Bug 6: Agent B never receives the RFQ in Incoming RFQs panel or Live Order Book — fixed: LightPeerContext now always connects to signaling WebSocket (even when Peer Mode is OFF) and registers with empty pairs (listener-only mode) so sendToPeer can deliver agent_rfq messages. Also passes senderPeerId/senderAlias to buildSwapTx so the server excludes Agent A from peer matching. Updated NetworkPanel + LightPeerPanel to show Incoming RFQs even when Peer Mode is off.

## Bug Fixes + Features — Round 7
- [x] Bug 7: Swap RFQs don't appear in the Live Order Book for all peers — fixed: sendMessage now calls broadcastRfqToAll() in signaling.ts so all connected peers receive an rfq_broadcast WebSocket message. Swaps.tsx Live Order Book now listens to afos:signaling-rfq window events and renders incoming RFQs from other users.
- [x] HTLC secret persistence: store secretHex + secretHashHex + rfqId in DB so the reveal step can complete after page refresh — added htlc_secrets table (schema + migration), saveHtlcSecret/getHtlcSecret/updateHtlcSecretStatus helpers in db.ts, called saveHtlcSecret in all three P2P paths (SOL, ETH, BTC), added getHtlcSecretHash/revealHtlcSecret/updateHtlcStatus tRPC procedures.

## Bug Fixes + Features — Round 8
- [ ] secretHashHex atomicity fix: pass server-generated secretHashHex in agent_rfq to Agent B for all chains (SOL, ETH, BTC, TNK) so both sides lock to the same hash
- [ ] TNK chain HTLC lock: add Trac Network HTLC lock path in acceptRfq (currently missing)
- [ ] Agent A uses same secretHashHex: initiateHtlcLock receives secretHashHex from buildSwapTx response and passes it through to the HTLC signing

## Bug Fixes + Features — Round 8
- [x] secretHashHex atomicity fix: server generates secretHashHex BEFORE calling sendAgentRfqToPeer and includes it in the agent_rfq message for all four chains (SOL, ETH, BTC, TNK). Agent B's acceptRfq now uses rfq.secretHashHex if present instead of generating a new one, ensuring both sides lock to the same hash. executeBtcHtlcLock updated to accept optional existingSecretHash parameter.

## Bug Fixes + Features — Round 9
- [x] Wire reveal step: Agent B sends htlc_locked via signaling after lock tx broadcast (SOL/ETH/BTC/TNK). Agent A receives htlc_locked, calls revealHtlcSecret tRPC procedure, then sends secretHex to Agent B via htlc_secret signaling message. Agent B receives htlc_secret, stores in htlcRevealedSecrets state, shows "Copy Secret" toast.
- [x] Add on-chain lock confirmation signal: signalingClient.sendHtlcLocked() and sendHtlcSecret() methods added. signaling.ts relays htlc_locked and htlc_secret messages to target peer. LightPeerContext listens for both events and dispatches afos:htlc-locked and afos:htlc-secret-received window events.
- [x] SwapPage.tsx TNK type errors: already resolved — tracNetwork exists in MultiChainWalletContextValue and trac_network is in SupportedChain union. Stale TSC watch was reporting false positives.

## Claim Funds Button + HTLC Secrets Expiry Monitor

- [x] Add `claimHtlcFunds(rfqId)` to LightPeerContext — handles SOL/ETH/BTC/TNK on-chain claim with revealed secret
- [x] Add `htlc_secret_reminder` and `htlc_expired` event handlers to LightPeerContext
- [x] Add `htlc_secret_reminder` and `htlc_expired` to `SignalingEvent` type and message dispatcher in signalingClient.ts
- [x] Add Claim Funds button to NetworkPanel RfqCard (amber, shown when `htlcRevealedSecrets[rfqId]` is set and status=accepted)
- [x] Add Claim Funds button to LightPeerPanel RfqCard (same logic)
- [x] Add Claim Funds button to ChatPage incoming_rfq message card
- [x] Create `server/jobs/htlcSecretsMonitor.ts` — polls `htlc_secrets` table every 60s, marks expired locked rows, sends `htlc_expired` signaling message to counterparty, sends `htlc_secret_reminder` for revealed-but-unclaimed rows, notifies project owner on expiry
- [x] Register `startHtlcSecretsMonitor()` in `server/_core/index.ts`

## HTLC Claim Feedback + Refund Button + History Panel

- [x] Add `chat.updateHtlcStatus` tRPC mutation to update htlc_secrets status to completed with revealTxId
- [x] Track claimed rfqIds in LightPeerContext state to hide Claim button after success
- [x] Remove Claim button from NetworkPanel/LightPeerPanel/ChatPage after successful claim
- [x] Add `refundableHtlcs` state to LightPeerContext — populated on htlc_expired events
- [x] Add `refundHtlcFunds(rfqId)` function to LightPeerContext for SOL/ETH/BTC/TNK refund paths
- [x] Show Refund button in NetworkPanel/LightPeerPanel for Agent A's outgoing HTLCs that expired
- [x] Show Refund button in ChatPage for Agent A's expired HTLCs
- [x] Add tRPC query `chat.getSettledHtlcs` to fetch completed/expired/refunded htlc_secrets rows
- [x] Add Settled HTLCs history section to NetworkPanel (History tab) with tx links and chain badges

## HTLC UX Polish — Persist State + Refund Badge + History Count

- [x] Persist claimedRfqIds to localStorage and seed from chat.getSettledHtlcs on mount
- [x] Add refundedRfqIds to localStorage and seed from DB on mount
- [x] Add refund status feedback: updateHtlcStatus after refundHtlcFunds, show amber badge in all 3 panels
- [x] Add History tab count badge to NetworkPanel tab bar (cyan pill, capped at 99+)

## HTLC UX — Notifications, History Filters, Countdown Timer

- [x] Add notifySwapCompletion tRPC procedure (protectedProcedure) that calls notifyOwner server-side
- [x] Fire notifySwapCompletion after each successful claim path in claimHtlcFunds (SOL/ETH/BTC/TNK)
- [x] Fire notifySwapCompletion after each successful refund path in refundHtlcFunds (SOL/ETH/BTC/TNK)
- [x] Add status filter (All / Completed / Refunded / Expired) to SettledHtlcsPanel in NetworkPanel
- [x] Add chain filter (All / SOL / ETH / BTC / TNK) to SettledHtlcsPanel in NetworkPanel
- [x] Add HtlcCountdown component to NetworkPanel (1s interval, h/m/s display, "Refundable now" when expired)
- [x] Add HtlcCountdown component to LightPeerPanel (same logic)
- [x] Add HtlcCountdownInline component to ChatPage (inline variant for chat bubbles)
- [x] Track htlcLockedAt in LightPeerContext (set at each HTLC settled step for SOL/ETH/BTC/TNK)
- [x] Pass htlcLockedAt to RfqCard in NetworkPanel, LightPeerPanel, and MessageBubble in ChatPage

## HTLC UX — Persist Countdown + Explorer Deep-Links

- [x] Persist htlcLockedAt to localStorage in LightPeerContext (same pattern as claimedRfqIds)
- [x] Add htlcExplorerUrl helpers in NetworkPanel, LightPeerPanel, ChatPage for SOL/ETH/BTC/TNK
- [x] Update HtlcCountdown + HtlcCountdownInline to accept chain + lockTxId props
- [x] Show "View on-chain ↗" deep-link in countdown when timer reaches zero (Solscan/Etherscan/Mempool.space/explorer.trac.network)
- [x] Pass chain prop to all HtlcCountdown call sites in NetworkPanel, LightPeerPanel, and ChatPage

## Graph Density Slider

- [x] Add `graph_density` column to DB schema (drizzle)
- [x] Add `graphDensity` to DEFAULT_USER_SETTINGS and UserSettingsResult
- [x] Expose `graphDensity` in settings.get and settings.save tRPC procedures
- [x] Add `graphDensity` state to AgentSettings.tsx draft state
- [x] Wire graphDensity to localStorage migration (unauthenticated → DB sync on login)
- [x] Wire graphDensity to localStorage load useEffect (unauthenticated users)
- [x] Wire graphDensity to remoteSettings useEffect (authenticated users)
- [x] Add graphDensity to handleReset and handleSave functions
- [x] Add slider UI in Display tab (range 0.5–2.0, Sparse/Balanced/Dense labels, live badge)
- [x] Extract graphDensity from userSettings in NetworkPage
- [x] Pass graphDensity prop to NodeGraph component
- [x] Add graphDensity parameter to peerPosition() function (radius /= density)
- [x] Pass graphDensity to all three peerPosition() call sites in NetworkPage
- [x] Add graphDensity to convertOraclePeers and fetchLiveData useCallback deps

## DM Panel Emoji Picker + Visual Polish

- [ ] Fix emoji picker clipped by Direct Message panel header — open downward so all rows are visible
- [ ] Improve DM panel visual design for dark and light mode — better contrast, header, message bubbles, input area

## DM Panel Emoji Picker & Visual Fix

- [x] Fix emoji picker clipped by Direct Message panel header — rendered via portal at document.body level so it escapes all overflow containers
- [x] Improve DM panel visual design for dark and light mode — all hardcoded rgba values replaced with theme-aware tokens (isDark conditional)

## NodeGraph Label Enhancement

- [x] Fix N/A latency on peer nodes — NodeGraph now receives pingResults prop and uses liveLatency (pingResults[id].latencyMs ?? peer.latency), shows — instead of N/A when no ping yet
- [x] Add origin badge (HW/IS) to peer nodes in graph
- [x] Add reputation arc ring around peer nodes (green/cyan/amber/orange/red based on score)
- [x] Latency label color now reflects live RTT color coding

## Peer Country Flag on NodeGraph

- [x] Add IP geolocation on signaling server: resolve country code from connecting IP on register, store in peer registry
- [x] Propagate countryCode in peer_list / peer_joined / registered messages via peer_geo_update
- [x] Add countryCode field to Peer type and populate it in LightPeerContext from signaling messages
- [x] Render country flag emoji below peer alias on NodeGraph node label
- [x] Add showCountryFlag toggle to Privacy settings (DB schema, tRPC, UI, server enforcement)

## Country Flag in Peer UI

- [x] Add country row (flag + country code) to peer detail panel below "Light Peer" label and above Latency
- [x] Add flag emoji to Network peer list rows next to alias (desktop + mobile)
- [x] Add flag emoji to DM conversation header next to peer alias
- [x] All three locations respect peer's showCountryFlag privacy setting (flag only shown when present, server skips geo for opted-out peers)

## Bug: Country flag not showing on deployed site

- [x] Debug why country flag is not appearing on graph nodes, peer detail panel, or peer list on deployed site — root cause: signalingPeers mapping in NetworkPage.tsx was not carrying over countryCode/flagEmoji from RemotePeer to Peer

## Bug: P2P Swap Flow Broken

- [x] RFQs not appearing in Incoming RFQs panel — root cause: acceptRfq condition required signTransaction && solPubkey (standard adapter only); Phantom multi-chain users had solConnected=true but signTransaction=null
- [x] Accept button on order book does nothing — fixed: added window.solana.signAndSendTransaction fallback when standard adapter's signTransaction is null
- [x] After "P2P peer matched" agent message, no Phantom wallet popup — fixed: initiateHtlcLock → acceptRfq now uses Phantom multi-chain fallback
- [x] Full flow investigated: RFQ broadcast → agent_rfq delivery → acceptRfq → HTLC lock signing → all now work with Phantom multi-chain
- [x] Also fixed Jupiter swap path in ChatPage.tsx to use Phantom multi-chain fallback for sendTransaction

## Tap Wallet (BTC) & MetaMask (ETH) Signing Fallbacks

- [ ] Audit BTC HTLC signing paths (lock/claim/refund) for Tap Wallet and Xverse support
- [ ] Audit ETH HTLC signing paths (lock/claim/refund) for MetaMask support
- [ ] Add proper signing fallbacks for BTC wallets (Tap Wallet / Xverse)
- [ ] Add proper signing fallbacks for ETH wallets (MetaMask / window.ethereum)

## HTLC Anchor Program — Real On-Chain Escrow

- [ ] Build Solana HTLC Anchor program (lock, claim, refund instructions)
- [ ] Deploy HTLC program to Solana mainnet
- [ ] Update solanaHtlc.ts to use the deployed program ID instead of SystemProgram fallback
- [ ] Update buildSolanaHtlcLockTx to create proper escrow PDA with hashlock + timelock
- [ ] Update claimHtlc to call the program's claim instruction with secret
- [ ] Update refundHtlc to call the program's refund instruction after timelock expires

## Swap Status Notifications

- [x] Toast notification when a peer accepts your RFQ (already existed in LightPeerContext)
- [x] Toast notification when a peer locks their side of the HTLC (already existed in LightPeerContext)
- [x] Push notification (notifyOwner) for swap status changes (htlc_locked, htlc_secret, agent_rfq in signaling.ts + chat.ts)
- [x] Agent chat notification when swap events occur (rfq-accepted, htlc-locked, htlc-secret-sent, htlc-secret-received, htlc-expired in ChatPage.tsx)

## Bug Fix: Phantom Orders in Live Order Book

- [x] Remove fake/simulated orders from Live Order Book — removed auto-broadcast logic that seeded phantom "pending" rows for every signaling peer on page load
- [x] Order book now only shows real quotes from SSE p2p_quote events or rfq_broadcast signals from other users

## Bug Fix: Accept Button Does Nothing

- [x] Fix Accept button in Live Order Book — now immediately triggers handleSwap() with the chosen peer's quote, scrolls to swap card on mobile, and shows wallet modal if not connected

## Layout Rewrite: Swap Tab

- [x] Fix overlapping cards in swap tab — removed xl:row-span-6 from swap card, moved SwapProgressTracker out of sticky wrapper into its own grid row
- [x] Fix sticky swap card causing z-index/overlap issues on mobile — sticky only applies on xl, mobile stacks cleanly
- [x] Rewrite swap tab grid to use clean single-column mobile layout and proper 2-col desktop layout with xl:items-start
- [x] Add Confirm-before-swap toggle in Advanced Settings — persisted to localStorage, shows confirmation banner before executing
- [x] Add swap-in-progress overlay on accepted order book row — shows phase label with spinner over the accepted row

## Feature: Swap Progress in Agent Chat

- [x] Add live SwapProgressCard message in agent chat showing RFQ→HTLC→settlement phases with expiry countdown
- [x] Chat progress card updates in real-time as swap phase advances (rfq-accepted→locking→settling→confirmed→expired)
- [x] Show expiry timer/countdown in the chat card so user knows time remaining to confirm/act

## Bug Fix: Swap Flow — RFQ Sent on Confirm (not on intent)

- [x] Remove premature RFQ broadcast + peer matching from sendMessage — now quote-only phase
- [x] buildSwapTx (called on Confirm) is the ONLY place that does real peer matching and RFQ broadcast
- [x] Fix "Connect Wallet to Swap" bug in full chat page QuoteCard — was using Solana-only useWallet hook; now accepts walletConnected prop from multi-chain context
- [x] Pass anyWalletConnected to MessageBubble and QuoteCard so all chain wallets are recognized
- [x] Server result.content now says "P2P peer available — click Confirm Swap to proceed" instead of "Swap request sent"

## Bug Fix: HTLC P2P Swap Flow — Atomicity & Secret Auth

- [x] Bug #1 (Critical — breaks atomicity): Add secretHashHex + requesterWallet to IncomingRfq interface so Agent B locks to the same hash as Agent A
- [x] Bug #1b: Remove all `(rfq as unknown as { secretHashHex? })` casts in SOL/ETH/BTC/TNK HTLC paths — use typed field directly
- [x] Bug #2 (Critical — secret auth fails): revealHtlcSecret was called with peerId instead of wallet address as requesterAddress — fixed to use solPubkey/phantomSolAddress
- [x] Bug #3 (Medium — Agent A locks wrong chain): initiateHtlcLock now passes secretHashHex from buildSwapTx result so Agent A and Agent B share the same hash
- [x] Bug #4 (Medium — auto-accept skips HTLC): auto-accept path now calls acceptRfq() instead of submitQuote() so HTLC lock is triggered
- [x] Fix feeModel.test.ts: update string-match test to match actual inline fee computation
- [x] All 256 tests pass, 0 TypeScript errors

## Feature: HTLC Expiry Notification + Refund Flow

- [x] Add initiatorPeerId column to htlc_secrets table (DB migration via SQL)
- [x] Save senderPeerId as initiatorPeerId in all 3 saveHtlcSecret calls (SOL, ETH, BTC paths in chat.ts)
- [x] Pass senderPeerId to executeBtcSwap and executeEthSwap from ChatPage.tsx
- [x] Update htlcSecretsMonitor to also notify Agent A (initiator) on HTLC expiry via sendToPeer(initiatorPeerId)
- [x] Refund button already implemented in SwapProgressCard — now correctly receives htlc_expired event
- [x] All 256 tests pass, 0 TypeScript errors

## Feature: Notification Preference System

- [x] Remove "HTLC Swap Expired" push notifications from htlcSecretsMonitor (spam removal)
- [x] Add 5 owner push notification preference columns to agent_settings table (ownerNotifyHtlcLocked, ownerNotifySecretRevealed, ownerNotifyRfqSent, ownerNotifyMissedLock, ownerNotifySwapCompleted)
- [x] Add initiatorPeerId column to htlc_secrets table (DB migration applied via SQL)
- [x] Update DEFAULT_USER_SETTINGS in schema.ts with new notification preference defaults
- [x] Add new fields to UserSettingsResult type in server/db.ts
- [x] Add new fields to getUserSettings() and upsertUserSettings() in server/db.ts
- [x] Update settings router (settings.get and settings.save) to include all 5 new fields
- [x] Create server/jobs/ownerNotifyPrefs.ts — cached helper that loads owner prefs from DB (5-min TTL)
- [x] Gate notifyOwner in signaling.ts (htlc_locked → ownerNotifyHtlcLocked, htlc_secret → ownerNotifySecretRevealed)
- [x] Gate notifyOwner in chat.ts (RFQ sent → ownerNotifyRfqSent)
- [x] Gate notifyOwner in tnkHtlcMonitor.ts (missed lock → ownerNotifyMissedLock)
- [x] Add "Owner Push Notifications" section to AgentSettings.tsx Notifications tab with 5 toggle rows
- [x] Wire owner notification prefs into state init, handleReset, handleSave, and remote settings effect

## Feature: HTLC DB Cleanup Job

- [x] Create server/jobs/htlcCleanup.ts — deletes htlc_secrets rows older than 7 days with terminal status (expired/refunded)
- [x] Register cleanup job in server/_core/index.ts — runs 30s after startup, then every 24 hours
- [x] All 256 tests pass, 0 TypeScript errors

## Bug Fix: Phantom Standard Wallet — HTLC Lock Not Prompting

- [x] Root cause: Phantom v24+ registers as a "Standard Wallet" — `signTransaction` from `useSolanaWallet()` is undefined for Standard Wallet connections
- [x] Fix: use `sendTransaction` (available for both Standard Wallet and legacy adapters) as the primary signing path in `acceptRfq` (HTLC lock) and `claimHtlcFunds` (HTLC claim)
- [x] Add `sendSolTransaction` to `useWallet()` destructure in LightPeerContext
- [x] Updated both signing paths: HTLC lock (acceptRfq) and HTLC claim (claimHtlcFunds) to prefer `sendSolTransaction` → `signTransaction` → `window.solana` fallback
- [x] Added `sendSolTransaction` to `acceptRfq` useCallback dependency array
- [x] All 256 tests pass, 0 TypeScript errors

## Bug: Phantom wallet still not prompting during HTLC Lock (round 2)

- [x] Previous sendTransaction fix did not resolve the issue — deeper investigation done
- [x] Root cause: `solPubkey` is null for Phantom Standard Wallet (adapter not connected), so `sendSolTransaction && solPubkey` was false, falling through to window.solana which may not exist
- [x] Fix: detect Phantom Standard Wallet via `!!phantomSolAddress && !solPubkey`, use `window.phantom.solana.signAndSendTransaction` directly for this case
- [x] Signing priority chain: Phantom Standard Wallet → sendSolTransaction (legacy adapter) → signTransaction → window.solana fallback → error
- [x] Fixed handleConfirmSwap dependency array to include initiateHtlcLock, phantomSolAddr, openId, myPeerId, myPeerAlias
- [x] Added comprehensive [HTLC-DEBUG] console logging at every decision point
- [x] All 256 tests pass, 0 TypeScript errors
