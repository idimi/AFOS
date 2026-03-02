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
