# AFOS — Agentic Financial Operating System

**AFOS** is a self-custodial, cross-chain swap platform that lets an AI agent execute trades on your behalf across Bitcoin, Ethereum, Solana, and Trac Network. It combines a natural-language chat interface with a real-time P2P liquidity network, on-chain Hash Time-Lock Contracts (HTLCs), and DEX aggregator fallbacks — all without ever taking custody of user funds.

> **Beta Notice:** AFOS is currently in public beta. The protocol is live on mainnet but should be treated as experimental software. Always verify on-chain transactions independently.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Supported Chains and Assets](#supported-chains-and-assets)
3. [How a Swap Works](#how-a-swap-works)
4. [P2P Network and IntercomSwap Protocol](#p2p-network-and-intercomswap-protocol)
5. [HTLC Settlement Paths](#htlc-settlement-paths)
6. [Server Architecture](#server-architecture)
7. [Client Architecture](#client-architecture)
8. [Database Schema](#database-schema)
9. [Background Jobs](#background-jobs)
10. [Fee Model](#fee-model)
11. [Admin Panel](#admin-panel)
12. [Environment Variables](#environment-variables)
13. [Development Setup](#development-setup)
14. [Testing](#testing)
15. [Acknowledgements](#acknowledgements)

---

## Architecture Overview

AFOS is a full-stack TypeScript application built on a React 19 + Tailwind 4 frontend, an Express 4 + tRPC 11 backend, and a MySQL/TiDB database managed with Drizzle ORM. The system has three principal layers that work together to execute atomic cross-chain swaps.

The **Oracle VM** is an external service (run separately from this repository) that maintains a live view of the P2P peer network, prices, and liquidity. The AFOS server proxies Oracle VM requests from the browser to avoid mixed-content issues, and the Oracle VM pushes real-time events to connected browsers via Server-Sent Events (SSE).

The **Signaling Server** (`server/signaling.ts`) is a WebSocket server embedded in the same Express process. It acts as a matchmaker for WebRTC peer connections: browsers register their peer ID and offered trading pairs, and the server relays SDP offers, ICE candidates, and P2P messages until a direct WebRTC channel is established between two peers.

The **HTLC Settlement Layer** handles the on-chain atomic swap execution. When two peers agree on a trade, the initiating agent (Agent A) generates a random secret, hashes it, and locks funds into an HTLC on its chain. The counterparty (Agent B) locks funds on the other chain to the same hash. Agent A then reveals the secret to claim Agent B's funds, and Agent B uses the revealed secret to claim Agent A's funds. This is fully atomic: either both claims succeed or both parties can refund after the timelock expires.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          AFOS System Diagram                            │
│                                                                         │
│  Browser (React)                                                        │
│  ├── LightPeerContext  ──── WebSocket ──── Signaling Server (WS)       │
│  ├── ChatPage          ──── tRPC ────────── Express + tRPC Routers     │
│  ├── WalletContext     ──── Phantom / MetaMask / Tap Wallet             │
│  └── afosApi.ts        ──── SSE ─────────── Oracle VM (external)       │
│                                                                         │
│  Express Server                                                         │
│  ├── /api/trpc         ──── tRPC procedures (chat, history, analytics) │
│  ├── /api/afos/*       ──── Oracle VM proxy                            │
│  ├── /ws/signaling     ──── WebSocket signaling relay                  │
│  ├── /api/webhooks/helius-htlc ── Helius real-time HTLC events         │
│  └── Background Jobs   ──── HTLC monitor, auto-refund, cleanup        │
│                                                                         │
│  Database (MySQL/TiDB)                                                  │
│  └── htlc_swaps, htlc_secrets, swap_analytics, peer_reputation, ...   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Supported Chains and Assets

AFOS supports four blockchain networks with eight tradeable assets. Each asset is identified by a canonical symbol and chain pair, defined in `client/src/lib/afosApi.ts` and `shared/const.ts`.

| Symbol | Chain | Type | Contract / Mint Address |
|---|---|---|---|
| SOL | Solana | Native | — |
| USDT | Solana | SPL Token | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` |
| USDC | Solana | SPL Token | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| ETH | Ethereum | Native | — |
| USDT | Ethereum | ERC-20 | `0xdAC17F958D2ee523a2206206994597C13D831ec7` |
| USDC | Ethereum | ERC-20 | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| BTC | Bitcoin | Native | — |
| TNK | Trac Network | Native | — |

Prices are sourced from CoinGecko (BTC/SOL/ETH) and Gate.io / MEXC (TNK), cached in-process for 30 seconds to avoid rate limits.

---

## How a Swap Works

Every swap request begins in the **Agent Chat** (`ChatPage.tsx`). The user types a natural-language instruction such as "swap 1 SOL to USDT" and the AI agent (powered by the built-in LLM via `server/_core/llm.ts`) parses the intent, determines the best execution route, and guides the user through the transaction.

### Route Selection

The agent evaluates three route types in priority order:

1. **IntercomSwap P2P** — submits an RFQ to the Oracle VM, which broadcasts it to connected peers. If a peer responds with a quote within the timeout window, the swap executes atomically via HTLC. This route charges 0.15% (15 bps).

2. **DEX Aggregator** — if no P2P peer is available, the agent falls back to a DEX. For Solana, it uses the Jupiter aggregator via `buildSwapTx`. For Ethereum, it uses 0x Protocol v2 (`zeroxSwap.ts`) with a 1inch v6 fallback (`agentSwapEth.ts`). DEX routes charge 0.20% (20 bps) collected via the aggregator's referral mechanism.

3. **Direct HTLC** — for Bitcoin swaps, the agent always uses the HTLC path via `agentSwapBtc.ts`, constructing a PSBT with `bitcoinjs-lib` and broadcasting via mempool.space.

The `pathFinder.ts` module handles multi-hop routing when no direct pair exists. For example, a BTC → SOL swap with no direct peer is decomposed into BTC → USDT → SOL, executing each hop in sequence with a shared bridge token.

### Swap Execution Flow (P2P HTLC)

The following sequence describes a complete P2P atomic swap between Agent A (initiator, selling SOL) and Agent B (counterparty, selling USDT):

1. **RFQ Broadcast** — Agent A submits `POST /api/afos/rfq` to the Oracle VM with `fromToken=SOL`, `toToken=USDT`, `amount`. The Oracle VM broadcasts a `p2p_rfq` SSE event to all connected peers.

2. **Quote Response** — Agent B's `LightPeerContext` receives the `p2p_rfq` event, calculates a quote at live price plus its configured spread, and responds via the Oracle VM or directly over WebRTC.

3. **Secret Generation** — Agent A generates a 32-byte random secret (`generateHtlcSecret()` in `client/src/lib/solanaHtlc.ts`), computes its SHA-256 hash, and stores both in the `htlc_secrets` table via `trpc.chat.storeHtlcSecret`.

4. **Agent A Locks** — Agent A calls `buildSolanaHtlcLockTx()` to construct a Solana transaction that locks SOL into the AFOS HTLC program (`XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW`) with the secret hash and a CLTV expiry. The transaction is signed by the user's Phantom wallet and broadcast to the network.

5. **Agent B Notified** — Agent A sends an `htlc_locked` WebSocket message to Agent B via the signaling server, including the `rfqId`, lock transaction hash, and chain. Simultaneously, the Helius webhook (`server/webhooks/heliusHtlc.ts`) receives the on-chain lock event and can trigger the next step even if Agent B's browser is offline.

6. **Agent B Locks** — Agent B's `LightPeerContext` receives the lock notification and calls `buildSolanaTokenHtlcLockTx()` to lock USDT SPL tokens into the same HTLC program, referencing the same secret hash. This is signed by Agent B's wallet.

7. **Agent A Claims** — The server's `htlcSecretsMonitor` detects that both sides are locked. It calls `claimSolanaHtlc()` in `server/solanaHtlcClaim.ts`, which constructs a claim instruction using the plaintext secret from `htlc_secrets`. The claim is signed by the server's agent keypair (`SOL_AGENT_KEY`) and submitted on-chain. Agent A receives USDT.

8. **Agent B Claims** — The secret is now public on-chain. Agent B's browser (or the server monitor as fallback) calls the same claim instruction with the revealed secret. Agent B receives SOL.

9. **Settlement Recording** — `recordSwapAnalytic()` writes the completed swap to `swap_analytics` with `settlementMs` (time from lock to claim). The `htlc_secrets` row is updated with `settledAt` and `settledVia` (one of `helius_webhook`, `browser_notify`, `monitor_fallback`, or `admin_force_claim`).

10. **6 On-Chain Proof Links** — The completed swap card displays six verifiable on-chain records: the Agent A lock tx, Agent B lock tx, Agent A escrow address, Agent B escrow address (`peerEscrowAddress`), Agent A claim tx, and Agent B claim tx. A **Copy Proof** button copies all six explorer links plus the `rfqId` to clipboard. These proof fields are persisted in `htlc_secrets` and loaded from the DB on page refresh via `trpc.history.getSwapProof`, so confirmed swap cards survive browser restarts. The **Swap History** page exposes the same data via a "View Proof" modal on each completed row.

---

## P2P Network and IntercomSwap Protocol

AFOS implements a compatible subset of the **IntercomSwap P2P swap protocol** developed by [Trac Systems](https://github.com/Trac-Systems). The protocol defines how two autonomous agents discover each other, negotiate a rate, and execute an atomic cross-chain swap without a trusted intermediary.

### Peer Discovery

When a user connects their wallet, `LightPeerContext` registers the browser as a light peer on the network. The peer identity is derived from the wallet public key. Registration happens over two channels simultaneously:

- **Oracle VM** (`announceToRelay()` in `afosApi.ts`) — the Oracle VM maintains a global peer registry and broadcasts `peer_list` updates to all connected clients via SSE.
- **Signaling Server** (`/ws/signaling`) — the browser opens a WebSocket connection and sends a `register` message containing its `peerId`, `alias`, offered trading `pairs`, and `walletAddresses`. The server adds the peer to its in-memory registry and broadcasts a `peer_joined` event to all other connected peers.

### Message Protocol

The signaling server (`server/signaling.ts`) relays the following message types between peers. These message types are directly modelled on the IntercomSwap protocol specification:

| Direction | Type | Purpose |
|---|---|---|
| Client → Server | `register` | Announce peer identity and offered pairs |
| Client → Server | `heartbeat` | Keep-alive ping every 30 seconds |
| Client → Server | `rfq_broadcast` | Broadcast a request-for-quote to all peers |
| Client → Server | `peer_message` | Send a direct message to a specific peer |
| Client → Server | `htlc_locked` | Notify counterparty that HTLC lock is confirmed |
| Client → Server | `htlc_secret` | Reveal the HTLC preimage to the counterparty |
| Client → Server | `rtc_offer` / `rtc_answer` / `rtc_ice` | WebRTC signaling for direct peer channel |
| Server → Client | `peer_list` | Full list of currently connected peers |
| Server → Client | `peer_joined` / `peer_left` | Real-time peer presence updates |
| Server → Client | `rfq_broadcast` | Forwarded RFQ from another peer |

Once a WebRTC channel is established between two peers, subsequent messages (quotes, HTLC coordination) flow directly between browsers without passing through the signaling server.

### Light Peer Mode

The `LightPeerContext` implements the Agent B role entirely in the browser. A user with a connected wallet can act as a liquidity provider: they configure their accepted pairs, spread in basis points, and trade size limits in `AgentSettings.tsx`. When an RFQ arrives that matches their preferences and the `autoAccept` flag is enabled, the browser automatically quotes and locks without any user interaction. The `usePeerReputation` hook tracks counterparty reliability scores to inform auto-accept decisions.

---

## HTLC Settlement Paths

AFOS implements four distinct HTLC settlement paths, each targeting a different chain. All paths share the same secret/hash preimage model: the initiator generates a secret, both parties lock to its hash, and the initiator's claim reveals the secret that the counterparty uses to claim their funds.

### Solana Native (SOL)

Implemented in `client/src/lib/solanaHtlc.ts` (lock) and `server/solanaHtlcClaim.ts` (claim/refund). The AFOS HTLC program (`XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW`) is a custom Anchor program deployed on Solana mainnet. It exposes four instructions identified by their Anchor discriminators: `lockSol`, `lockToken`, `claim`, and `refund`. The program derives a PDA (Program Derived Address) from the `htlcId` seed, which is stored in `htlc_secrets.htlcId` for server-side claim construction.

### Solana SPL Token (USDT, USDC)

Implemented in `client/src/lib/solanaTokenHtlc.ts`. Uses the same HTLC program but calls the `lockToken` instruction, which transfers SPL tokens into an Associated Token Account owned by the PDA. The server's claim path (`solanaHtlcClaim.ts`) handles both native SOL and SPL token claims by inspecting the `fromToken` field of the `htlc_secrets` row.

### Ethereum (ETH, USDT, USDC)

Implemented in `server/ethHtlc.ts` and `server/agentSwapEth.ts`. Uses a standard EVM HTLC contract. The server holds the agent's Ethereum private key (`ETH_AGENT_KEY`) and constructs claim transactions using `ethers.js`. The `ETH_RPC_URL` environment variable points to the JSON-RPC endpoint (defaults to Cloudflare's public endpoint).

### Bitcoin (BTC)

Implemented in `client/src/lib/btcHtlc.ts` (browser lock via Tap Wallet) and `server/agentSwapBtc.ts` (server-side PSBT construction). Bitcoin HTLCs use `OP_SHA256 <hash> OP_EQUALVERIFY` script paths with a CLTV timelock fallback. Transactions are broadcast via the mempool.space API. The server holds `BTC_HTLC_WIF` (HTLC escrow key) and `BTC_AGENT_WIF` (fee collection key).

### Trac Network (TNK)

Implemented in `client/src/lib/tnkHtlc.ts` and `server/jobs/tnkHtlcMonitor.ts`. Because Trac Network does not have native HTLC opcodes, AFOS uses an agent-escrow model: TNK is sent to a designated escrow address (`TNK_ESCROW_ADDRESS`) with a memo in the format `AFOS-HTLC:{secretHash}:{escrow}:{amount}:{expiry}`. The server polls the Trac Network explorer API every 60 seconds to detect incoming escrow transfers and match them to pending `htlc_swaps` rows.

---

## Server Architecture

The server entry point is `server/_core/index.ts`, which bootstraps Express, registers all routes, and starts background jobs. The application uses a single HTTP server with both Express middleware and a WebSocket server attached to the same port.

### tRPC Routers

All API procedures are defined in `server/routers.ts` and split across feature-specific router files. The full router tree is:

| Router | File | Purpose |
|---|---|---|
| `chat` | `routers/chat.ts` | Swap execution, HTLC coordination, AI agent responses |
| `history` | `routers/history.ts` | Swap history, `getSwapProof`, `batchGetSwapProofs`, refund management |
| `analytics` | `routers/analytics.ts` | Swap volume, fee revenue, settlement metrics |
| `btcHtlc` | `routers/btcHtlc.ts` | Bitcoin HTLC lock/claim/refund procedures |
| `htlcWallet` | `routers/htlcWallet.ts` | Agent wallet balance queries across all chains |
| `pathFinder` | `pathFinder.ts` | Multi-hop route discovery |
| `peerReputation` | `routers/peerReputation.ts` | Peer scoring, ping recording, reputation queries |
| `peerMessages` | `routers/peerMessages.ts` | P2P direct message persistence |
| `peerBlocks` | `routers/peerBlocks.ts` | Block/unblock peers |
| `peerMutes` | `routers/peerMutes.ts` | Mute/unmute peers |
| `peerReports` | `routers/peerReports.ts` | Report abusive peers |
| `settings` | `routers/settings.ts` | Per-user agent settings (route preference, limits) |
| `adminConfig` | `routers/adminConfig.ts` | Platform fee config, treasury addresses |
| `operatorConfig` | `routers/operatorConfig.ts` | Oracle VM URL, BTC/SOL RPC, trade automation |
| `nodeHealth` | `routers/nodeHealth.ts` | RPC node connectivity checks |
| `webhookHealth` | `routers/webhookHealth.ts` | Helius webhook status and claim statistics |
| `prices` | `routers.ts` (inline) | Live price feed for the landing page |
| `auth` | `routers.ts` (inline) | Manus OAuth session management |
| `system` | `_core/systemRouter.ts` | Owner notifications |

### Oracle VM Proxy

All requests to the Oracle VM are proxied through the Express server at `/api/afos/*`. This is necessary because the Oracle VM runs over HTTP and the frontend is served over HTTPS. The proxy is registered in `server/_core/index.ts` and forwards requests to `ORACLE_API_URL` with a 12-second timeout.

### Helius Webhook

`server/webhooks/heliusHtlc.ts` registers a Helius "raw" webhook on the AFOS HTLC program address at server startup. When Helius POSTs a transaction notification, the handler:

1. Verifies the `authorization` header against `HELIUS_WEBHOOK_SECRET`.
2. Parses the instruction data and identifies the instruction type using Anchor discriminators.
3. For `lockSol` or `lockToken` events: looks up the matching `htlc_secrets` row by scanning the instruction accounts for the known PDA. If both Agent A and Agent B have locked, triggers immediate claims for both sides.
4. For `claim` or `refund` events: updates the corresponding `htlc_swaps` row status.

This eliminates the 5-minute polling fallback for the common case, reducing settlement time to under 30 seconds.

---

## Client Architecture

The frontend is a single-page React 19 application served by Vite in development and by the Express static file server in production. The application is structured around a set of React contexts that provide shared state across the component tree.

### Context Hierarchy

```
App
└── ThemeProvider
    └── WalletProvider (Solana wallet adapter)
        └── MultiChainWalletProvider (ETH + BTC wallet detection)
            └── LightPeerProvider (P2P peer registration + HTLC coordination)
                └── ChatProvider (AI agent conversation state)
                    └── PriceProvider (live price feed)
                        └── AgentLogProvider (real-time event log)
                            └── Router
```

**`WalletContext`** wraps the Solana wallet adapter and adds balance fetching for SOL, USDT, and USDC. The `refreshBalances()` function returns the new balances directly (not just updates state) so callers can embed the fresh values in completion messages synchronously.

**`MultiChainWalletContext`** detects MetaMask (Ethereum) and Tap Wallet (Bitcoin) via `window.ethereum` and `window.tapwallet` respectively, and exposes `ethAddress`, `btcAddress`, and chain-specific signing functions.

**`LightPeerContext`** is the most complex context. It manages the full Agent B lifecycle: WebSocket connection to the signaling server, SSE subscription to Oracle VM events, incoming RFQ processing, auto-accept logic, HTLC lock construction, secret receipt, and claim execution. It also manages the `htlcLockTimestamps` map for settlement time tracking and the `refundableHtlcs` map for expired HTLC recovery.

**`ChatContext`** stores the conversation message history and exposes `addMessage` / `updateMessage` for the AI agent to append to the chat. Messages have a `type` field (`text`, `quote`, `tx_success`, `htlc_progress`, `error`) that controls how they are rendered in `ChatPage.tsx`.

### Key Pages

| Page | Route | Description |
|---|---|---|
| `LandingPage` | `/` | Public marketing page with live swap preview card |
| `Dashboard` | `/app` | Main app shell with sidebar navigation |
| `ChatPage` | (embedded in Dashboard) | AI agent chat, swap execution, TxSuccessCard |
| `Swaps` | (embedded in Dashboard) | Order book with live P2P quotes |
| `SwapHistory` | (embedded in Dashboard) | Open trades, completed swaps, refunds, **View Proof modal** (6 on-chain links per completed swap) |
| `SwapAnalytics` | (embedded in Dashboard) | Volume charts, fee revenue, settlement metrics |
| `NetworkPage` | (embedded in Dashboard) | Connected peers, reputation, direct messaging |
| `AgentSettings` | (embedded in Dashboard) | Light peer config, route preference, limits |
| `TerminalPage` | (embedded in Dashboard) | Raw event log for debugging |
| `AdminPanel` | `/admin` | Platform config, HTLC recovery, webhook health |

---

## Database Schema

The database uses MySQL/TiDB managed via Drizzle ORM. Schema is defined in `drizzle/schema.ts` and migrations are applied with `pnpm db:push`.

| Table | Purpose |
|---|---|
| `users` | Manus OAuth user accounts with `role` (admin/user) |
| `htlc_swaps` | One row per HTLC swap attempt, tracking status across all chains |
| `htlc_secrets` | Plaintext HTLC preimage secrets (never sent to client), with `settledAt` and `settledVia` |
| `swap_analytics` | Completed swap records with `settlementMs`, `feeBps`, `feeUsd`, `rfqId` |
| `peer_reputation` | Per-peer reliability scores, ping counts, and last-seen timestamps |
| `user_settings` | Per-user agent configuration (route preference, spread, trade limits) |
| `peer_messages` | Persistent P2P direct message history |
| `peer_blocks` | Block list (user → blocked peer) |
| `peer_mutes` | Mute list (user → muted peer) |
| `peer_reports` | Abuse reports with reason codes |
| `admin_config` | Platform-wide fee configuration and treasury wallet addresses |
| `operator_config` | Oracle VM URL, RPC endpoints, trade automation settings |
| `admin_audit_log` | Immutable append-only log of all admin configuration changes |
| `peer_message_reactions` | Emoji reactions on P2P direct messages |

### Key Fields in `htlc_secrets`

The `htlc_secrets` table is the heart of the atomic swap settlement system. Beyond storing the plaintext `secretHex` and `secretHashHex`, it tracks:

- `fromChain` / `toChain` — the two chains involved in the swap.
- `htlcId` — the PDA seed used to derive the on-chain account address.
- `initiatorAddress` / `counterpartyAddress` — wallet addresses for both parties.
- `lockTxId` / `counterpartyLockTxId` — Agent A and Agent B lock transaction hashes.
- `revealTxId` / `counterpartyRevealTxId` — Agent A and Agent B claim transaction hashes (reveal the secret).
- `escrowAddress` / `peerEscrowAddress` — Agent A and Agent B HTLC escrow contract/PDA addresses.
- `settledAt` — UTC timestamp when the swap was fully settled.
- `settledVia` — how settlement was triggered: `helius_webhook` (fastest, sub-30s), `browser_notify` (Agent B's browser was open), `monitor_fallback` (5-minute polling cycle), or `admin_force_claim` (manual recovery).

---

## Background Jobs

Six background jobs run on the server process, all started from `server/_core/index.ts`:

**HTLC Monitor** (`server/htlcMonitor.ts`) — runs continuously, watching `htlc_swaps` rows in `pending` status. When a lock is detected on-chain (via RPC polling), it updates the row and triggers the claim path.

**HTLC Secrets Monitor** (`server/jobs/htlcSecretsMonitor.ts`) — the primary auto-claim engine. Every polling cycle, it queries `htlc_secrets` rows in `locked` status where both sides have confirmed locks. For each such row, it constructs and submits the claim transaction using the server's agent keypair. This is the 5-minute fallback path when the Helius webhook is unavailable.

**Auto-Refund Job** (`server/jobs/autoRefund.ts`) — runs every 5 minutes. Scans all chains for expired HTLCs (current block height > CLTV expiry). For server-owned HTLCs (where the agent keypair is the refund authority), it constructs and submits the refund transaction automatically. For user-owned HTLCs, it sends an owner notification so the user can manually refund.

**TNK HTLC Monitor** (`server/jobs/tnkHtlcMonitor.ts`) — runs every 60 seconds. Polls the Trac Network explorer API for incoming transfers to the TNK escrow address. Matches transfers by memo format and updates the corresponding `htlc_swaps` row.

**HTLC Cleanup Job** (`server/jobs/htlcCleanup.ts`) — runs once at startup (after a 30-second warm-up) and then every 24 hours. Deletes `htlc_secrets` rows older than 7 days with terminal status (`expired` or `refunded`) to keep the table size manageable.

**Oracle VM Sync** (`server/jobs/oracleVmSync.ts`) — runs every 60 seconds. Polls the Oracle VM's `/api/swaps` endpoint and back-fills `swap_analytics` for completed swaps that were initiated in the browser without a server-side record (e.g., swaps where the user closed the tab before the completion message was recorded).

**Fee Revenue Alert** (`server/jobs/feeRevenueAlert.ts`) — runs every hour. Calculates total platform fee revenue for the current calendar day. If the total exceeds the configured threshold, sends an owner notification. Fires at most once per day.

---

## Fee Model

AFOS charges a platform fee on every completed swap. The fee is taken from the output side of the trade (the token the user receives) and is never added on top — the quoted `netToAmount` already reflects the fee deduction.

| Route | Fee | Collection Method |
|---|---|---|
| IntercomSwap P2P | 15 bps (0.15%) | Deducted from `outAmount` before settlement |
| Jupiter (Solana DEX) | 15 bps (0.15%) | Jupiter referral fee account (`SOL_FEE_WALLET`) |
| 0x Protocol (Ethereum DEX) | 20 bps (0.20%) | 0x referral fee mechanism |
| 1inch v6 (Ethereum fallback) | 20 bps (0.20%) | 1inch referral fee mechanism |
| Bitcoin HTLC | 15 bps (0.15%) | Deducted from `outAmount` before settlement |

Fee wallet addresses are read from environment variables (`SOL_FEE_WALLET`, `ETH_FEE_WALLET`, `BTC_FEE_WALLET`) with fallback to the agent keypairs. No hardcoded fee addresses exist in the codebase — if the fee wallet env var is not set, a startup warning is emitted and fees are not collected for that chain.

The `QuoteResult` interface in `server/routers/chat.ts` exposes `netToAmount`, `platformFeeOut`, `feeBps`, and `feeToken` so the frontend can display the exact fee before the user confirms a swap.

---

## Admin Panel

The Admin Panel (`/admin`) is accessible only to users with `role = 'admin'` in the `users` table. It provides the following management tabs:

- **Fee Config** — adjust `swapFeeBps`, `p2pFeeBps`, and treasury wallet addresses. All changes are written to `admin_config` and logged to `admin_audit_log`.
- **Operator Config** — configure the Oracle VM URL, BTC/SOL RPC endpoints, trade automation toggle, and HTLC timelock parameters.
- **HTLC Recovery** — view stuck swaps (locked but not settled after 30+ minutes), force-claim individual swaps using the server's agent keypairs, or trigger bulk refunds for expired HTLCs.
- **Webhook** — live Helius webhook health card showing the registered webhook ID, URL, last event timestamp, total events received, total claims triggered, and a settlement source breakdown (Webhook / Browser / Monitor / Admin percentages). Refreshes every 30 seconds.
- **Audit Log** — read-only view of all admin configuration changes with timestamps and before/after values.

---

## Environment Variables

The following environment variables must be set for full functionality. Variables marked **Required** will cause the server to fail or degrade silently if absent.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Required | MySQL/TiDB connection string |
| `JWT_SECRET` | Required | Session cookie signing secret |
| `ORACLE_API_URL` | Required | IntercomSwap Oracle VM base URL |
| `HELIUS_API_KEY` | Required | Helius API key for Solana RPC and webhooks |
| `HELIUS_WEBHOOK_SECRET` | Recommended | Shared secret for Helius webhook signature verification |
| `SOL_AGENT_KEY` | Required | Solana agent keypair (base58) for server-side claims |
| `SOL_HTLC_KEY` | Recommended | Dedicated Solana keypair for HTLC escrow |
| `ETH_AGENT_KEY` | Required for ETH | Ethereum private key (hex) for server-side claims |
| `ETH_RPC_URL` | Recommended | Ethereum JSON-RPC endpoint (defaults to Cloudflare) |
| `BTC_AGENT_WIF` | Required for BTC | Bitcoin WIF-encoded private key for fee collection |
| `BTC_HTLC_WIF` | Recommended | Dedicated Bitcoin WIF key for HTLC escrow |
| `TNK_AGENT_KEY` | Required for TNK | Trac Network agent key (PKCS8 DER hex) |
| `TNK_HTLC_CONTRACT_ADDRESS` | Required for TNK | AFOS HTLC contract address on Trac Network subnet |
| `TNK_PEER_RPC_URL` | Required for TNK | trac-peer node URL (default: `http://localhost:5001`) |
| `AFOS_SERVER_SECRET` | Required | Internal secret for authenticating agent/send calls |
| `TNK_ESCROW_ADDRESS` | Required for TNK | TNK escrow address for incoming locks |
| `TNK_HTLC_WIF` | Required for TNK | TNK HTLC WIF key |
| `ZEROX_API_KEY` | Required for ETH DEX | 0x Protocol API key |
| `SOL_FEE_WALLET` | Recommended | Solana address to receive platform fees |
| `ETH_FEE_WALLET` | Recommended | Ethereum address to receive platform fees |
| `BTC_FEE_WALLET` | Recommended | Bitcoin address to receive platform fees |
| `VITE_APP_ID` | Required | Manus OAuth application ID |
| `OAUTH_SERVER_URL` | Required | Manus OAuth backend base URL |
| `VITE_OAUTH_PORTAL_URL` | Required | Manus login portal URL |
| `VITE_SOL_RPC_URL` | Recommended | Solana RPC URL for the frontend |
| `VITE_SOL_HTLC_ESCROW` | Required | HTLC escrow address shown to users |
| `VITE_ADMIN_WALLETS` | Recommended | Comma-separated admin wallet addresses |

---

## Development Setup

```bash
# Clone the repository
git clone https://github.com/idimi/AFOS.git
cd AFOS

# Install dependencies
pnpm install

# Push the database schema
pnpm db:push

# Start the development server (Express + Vite HMR on port 3000)
pnpm dev
```

The development server runs both the Express API and the Vite frontend on port 3000. API requests to `/api/*` are handled by Express; all other requests are proxied to Vite's HMR server.

### Project Structure

```
client/
  src/
    contexts/       ← React contexts (wallet, peer, chat, price)
    pages/          ← Page-level components (Dashboard, ChatPage, etc.)
    components/     ← Reusable UI components and shadcn/ui wrappers
    lib/            ← Chain-specific HTLC helpers, API client, signaling
    hooks/          ← Custom React hooks
drizzle/
  schema.ts         ← Database table definitions
  migrations/       ← Generated SQL migration files
server/
  _core/            ← Framework plumbing (tRPC, OAuth, LLM, storage)
  routers/          ← tRPC feature routers
  jobs/             ← Background jobs (monitor, cleanup, sync)
  webhooks/         ← Helius webhook handler
  *.ts              ← Chain-specific swap execution modules
shared/
  const.ts          ← Shared constants and types
  types.ts          ← Shared TypeScript types
```

---

## Testing

AFOS has **425 Vitest tests across 33 test files** covering the server-side logic. Tests are located alongside the modules they test (e.g., `server/routers/settings.test.ts` tests `server/routers/settings.ts`).

```bash
# Run all tests
pnpm test

# Run a specific test file
pnpm test -- server/webhooks/heliusHtlc.test.ts
```

Key test suites include:

- **`signaling.test.ts`** — WebSocket signaling protocol, peer registration, heartbeat, and relay logic.
- **`heliusHtlc.test.ts`** — Helius webhook signature verification, discriminator parsing, and auto-claim triggering.
- **`multiChainSwap.test.ts`** — Unified 3-chain swap architecture, P2P route vs DEX fallback, Oracle VM timeout handling.
- **`settingsEnforcement.test.ts`** — Route enforcement when `preferredRoute = "intercomswap"` and no peer is available.
- **`feeModel.test.ts`** — Fee constant values, `QuoteResult` interface shape, fee wallet env var handling.
- **`peerReputation.test.ts`** — Peer scoring, ping recording, and reputation query procedures.
- **`webhookHealth.test.ts`** — Webhook status procedure, claim statistics aggregation.
- **`swapProgressPersistence.test.ts`** — Proof field hydration from DB on page reload, `getSwapProof` query correctness.
- **`btcSwapP2P.test.ts`** — Bitcoin P2WSH HTLC construction, PSBT signing, mempool.space broadcast.

---

## Acknowledgements

AFOS implements a compatible subset of the **[IntercomSwap](https://github.com/TracSystems/intercom-swap) P2P swap protocol** by **[Trac Systems](https://github.com/Trac-Systems)**.

IntercomSwap is the open-source reference implementation of the Intercom protocol stack for autonomous agents. AFOS derives the following from IntercomSwap:

- The **RFQ / quote / quote-accept message flow** (`p2p_rfq`, `p2p_quote`, `p2p_quote_accept` event types).
- The **HTLC preimage-based settlement pattern** — the `secretHashHex` / `secretHex` field naming convention and the lock → reveal → claim state machine.
- The **`htlc_locked` / `htlc_secret` signaling message types** used to coordinate HTLC state between peers over the relay.
- The **rendezvous channel naming convention** (e.g., `0000intercomswapbtcusdt`) used for pair-specific peer discovery.
- The **Solana HTLC escrow program interface** — AFOS deploys its own program (`XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW`) that implements the same lock/claim/refund instruction interface as the IntercomSwap `ln_usdt_escrow` program.

IntercomSwap is licensed under the [MIT License](https://github.com/TracSystems/intercom-swap/blob/main/LICENSE.md) (Copyright © 2026 Trac Systems).

> **Powered by IntercomSwap** — open-source P2P swap protocol by Trac Systems.
> [https://github.com/TracSystems/intercom-swap](https://github.com/TracSystems/intercom-swap)

---

*AFOS is beta software. Use at your own risk. Always verify on-chain transactions independently before considering a swap complete.*
