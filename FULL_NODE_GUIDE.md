# Running Your Own AFOS Full Node

This guide explains how the AFOS P2P network is layered, what the difference is between a **Full Node** and a **Light Peer**, and how to install and operate your own full node so that your agent can participate in the Hyperswarm DHT autonomously — without requiring you to be at your computer.

---

## Table of Contents

- [The Two Network Layers](#the-two-network-layers)
  - [Layer 1 — Full Node (Oracle VM / Hyperswarm DHT)](#layer-1--full-node-oracle-vm--hyperswarm-dht)
  - [Layer 2 — Light Peer (Browser / Signaling Server)](#layer-2--light-peer-browser--signaling-server)
  - [Side-by-Side Comparison](#side-by-side-comparison)
- [Why Run Your Own Full Node?](#why-run-your-own-full-node)
- [Prerequisites](#prerequisites)
- [Step 1 — Clone the IntercomSwap Node](#step-1--clone-the-intercomswap-node)
- [Step 2 — Install Dependencies](#step-2--install-dependencies)
- [Step 3 — Generate Your Keypairs and Wallets](#step-3--generate-your-keypairs-and-wallets)
- [Step 4 — Configure the Node](#step-4--configure-the-node)
- [Step 5 — Fund Your Wallets](#step-5--fund-your-wallets)
- [Step 6 — Start the Node](#step-6--start-the-node)
- [Step 7 — Point Your AFOS Dashboard at Your Node](#step-7--point-your-afos-dashboard-at-your-node)
- [Step 8 — Verify Connectivity](#step-8--verify-connectivity)
- [Operating Your Node](#operating-your-node)
- [TNK (Trac Network) Support](#tnk-trac-network-support)
  - [What Makes TNK Different](#what-makes-tnk-different)
  - [TNK Key Types](#tnk-key-types)
  - [Step A — Generate TNK_HTLC_WIF (Escrow Wallet Key)](#step-a--generate-tnk_htlc_wif-escrow-wallet-key)
  - [Step B — Derive Your trac1 Escrow Address](#step-b--derive-your-trac1-escrow-address)
  - [Step C — Generate TNK_AGENT_KEY (Subnet Contract Signing Key)](#step-c--generate-tnk_agent_key-subnet-contract-signing-key)
  - [Step D — Set Up the trac-peer Node](#step-d--set-up-the-trac-peer-node)
  - [Step E — Configure AFOS Dashboard Secrets for TNK](#step-e--configure-afos-dashboard-secrets-for-tnk)
  - [Step F — Fund the TNK Escrow Wallet](#step-f--fund-the-tnk-escrow-wallet)
  - [TNK Fallback Mode (No trac-peer)](#tnk-fallback-mode-no-trac-peer)
  - [Supported TNK Swap Pairs](#supported-tnk-swap-pairs)
- [Security Considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)

---

## The Two Network Layers

AFOS operates across two distinct P2P layers that serve different roles. Understanding the difference is essential before deciding which one is right for your use case.

### Layer 1 — Full Node (Oracle VM / Hyperswarm DHT)

A **Full Node** is a server-side process that runs the [IntercomSwap](https://github.com/TracSystems/intercom-swap) runtime — a fork of the [Intercom](https://github.com/Trac-Systems/intercom) stack built on [Hyperswarm](https://github.com/hyperswarm/hyperswarm) and HyperDHT. It connects directly to the global Hyperswarm Distributed Hash Table (DHT), which is a decentralised peer discovery network with no central server.

**Key characteristics of a Full Node:**

- Runs as a persistent background process on a server (VPS, cloud VM, or dedicated machine).
- Holds its own private keys (`SOL_HTLC_KEY`, `ETH_HTLC_KEY`, `BTC_HTLC_WIF`) and signs transactions autonomously.
- Discovers counterparties directly through the Hyperswarm DHT — no signaling server required.
- Can accept RFQs, negotiate quotes, lock HTLC funds, and claim settlement **entirely unattended**, 24 hours a day.
- Exposes a REST + SSE API (the "Oracle VM" interface) that the AFOS dashboard proxies through `/api/afos/*`.
- Identified on the network by a stable **node key** (a Hyperswarm keypair, not a wallet key).

A Full Node is the equivalent of running a Bitcoin full node or a Lightning node: it is a first-class participant in the network with its own identity, its own liquidity, and the ability to act autonomously.

### Layer 2 — Light Peer (Browser / Signaling Server)

A **Light Peer** is a browser-based participant that connects to the AFOS signaling server (`/api/ws/signaling`) over a WebSocket. It does not join the Hyperswarm DHT directly — instead, the signaling server acts as a relay between browser peers and (optionally) the Full Node layer.

**Key characteristics of a Light Peer:**

- Runs entirely inside a browser tab using React context (`LightPeerContext`).
- Uses the user's browser wallet (Phantom, MetaMask, Tap Wallet) for transaction signing — every on-chain action requires a manual wallet pop-up approval.
- Is only online while the browser tab is open and the wallet is connected.
- Can participate in Smart Auto-Accept (automatically deciding to accept an RFQ), but the actual HTLC lock transaction still requires the user to click "Approve" in their wallet extension.
- Identified on the network by a randomly generated `peerId` stored in `localStorage`.
- Suitable for occasional trading by regular users who are actively present at their computer.

A Light Peer is analogous to an SPV (Simplified Payment Verification) client in Bitcoin: it participates in the network but relies on the infrastructure layer for heavy lifting.

### Side-by-Side Comparison

| Property | Full Node (Layer 1) | Light Peer (Layer 2) |
|---|---|---|
| **Runtime** | Server process (Node.js + Pear) | Browser tab (React) |
| **Peer discovery** | Hyperswarm DHT (global, decentralised) | AFOS signaling server (WebSocket relay) |
| **Transaction signing** | Server-side private key (automated) | Browser wallet pop-up (manual approval) |
| **Availability** | 24/7 as long as the server is running | Only while the browser tab is open |
| **User presence required** | No — fully unattended | Yes — wallet approval needed per trade |
| **Identity** | Stable node key (Hyperswarm keypair) | Ephemeral `peerId` in `localStorage` |
| **Liquidity** | Server holds funds in its own wallets | User's connected browser wallet |
| **Setup complexity** | High — requires a server, funded wallets, LN channels | Low — connect wallet and open the app |
| **Best for** | Market makers, liquidity providers, automated agents | Occasional traders, manual swaps |

---

## Why Run Your Own Full Node?

Running your own Full Node gives you several advantages over relying on the shared Oracle VM at `141.253.123.101:4000`:

- **Sovereignty** — your private keys never leave your server. You are not trusting a third-party Oracle VM with your funds.
- **Always-on liquidity** — your node can accept and fill swaps 24/7 without you being at your computer.
- **Custom configuration** — set your own spread, trade size limits, accepted pairs, and slippage tolerance.
- **Privacy** — your swap history and peer interactions are stored locally on your own server.
- **Resilience** — if the shared Oracle VM goes offline, your dashboard continues to function through your own node.
- **Earn fees** — as a counterparty in P2P swaps, you earn the spread between your quoted rate and the oracle price.

---

## Prerequisites

Before starting, ensure the following are available:

| Requirement | Notes |
|---|---|
| **Server** | A VPS or cloud VM with at least 2 GB RAM and 20 GB disk. Ubuntu 22.04 LTS is recommended. |
| **Node.js 22+** | Install via [nvm](https://github.com/nvm-sh/nvm) or the NodeSource repository. |
| **Pear runtime** | The Hyperswarm/Holepunch runtime. Install with `npm install -g pear`. |
| **Git** | Standard; available via `apt install git`. |
| **Rust + Cargo** | Required only if you intend to run the Solana escrow program locally for e2e tests. Install via [rustup](https://rustup.rs/). |
| **Solana CLI** | Required only for local e2e tests. Install via the [official installer](https://docs.solana.com/cli/install-solana-cli-tools). |
| **Funded Solana wallet** | SOL for transaction fees, plus USDT/USDC inventory if you intend to quote those pairs. |
| **Funded Ethereum wallet** | ETH for gas, plus USDT/USDC inventory for ETH-side pairs. |
| **Bitcoin wallet + Lightning node** | Required for BTC/LN pairs. LND (Neutrino mode) is recommended for mainnet to avoid running a full `bitcoind`. |

> **Note on Lightning:** If you do not intend to trade BTC/LN pairs, you can skip the Lightning node setup entirely. The Full Node operates independently for Solana and Ethereum pairs.

---

## Step 1 — Clone the IntercomSwap Node

The Full Node runtime is the open-source [IntercomSwap](https://github.com/TracSystems/intercom-swap) repository by Trac Systems. Clone it on your server:

```bash
git clone https://github.com/TracSystems/intercom-swap.git
cd intercom-swap
```

> **Important:** IntercomSwap uses pinned dependency commits for stability. Do not run `npm update` or change the pinned versions in `package.json` unless you are intentionally upgrading and have run the full test suite.

---

## Step 2 — Install Dependencies

```bash
npm install
```

Verify that Pear is installed and accessible:

```bash
pear --version
```

If Pear is not found, install it globally:

```bash
npm install -g pear
pear --version
```

---

## Step 3 — Generate Your Keypairs and Wallets

All secrets and keypairs are stored under the `onchain/` directory, which is gitignored. Never commit anything under `onchain/`.

### Solana Keypair

```bash
# Generate a new Solana keypair for the node agent
./scripts/solctl.sh keygen --name sol-agent
# The keypair is saved to onchain/sol-agent.json
# Print the public key
./scripts/solctl.sh pubkey --keypair onchain/sol-agent.json
```

Fund this address with SOL (for transaction fees) and USDT/USDC (for inventory) before the node can quote those pairs.

### Ethereum Private Key

Generate a new Ethereum private key using any standard tool (e.g., `cast wallet new` from Foundry, or a hardware wallet export). Store the hex-encoded private key securely:

```bash
# Example using cast (Foundry)
cast wallet new
# Save the private key hex to onchain/eth-agent.key (gitignored)
echo "0xYOUR_PRIVATE_KEY_HEX" > onchain/eth-agent.key
chmod 600 onchain/eth-agent.key
```

### Bitcoin / Lightning Wallet (Optional — BTC pairs only)

```bash
# Initialise an LND node directory
./scripts/lndctl.sh init --store mainnet-maker
# Start LND (interactive — required once to create the wallet)
./scripts/lndctl.sh start --store mainnet-maker
# In a separate terminal, create the wallet (interactive)
./scripts/lndctl.sh create-wallet --store mainnet-maker
```

Follow the on-screen prompts to save your seed phrase securely. After wallet creation, LND will start syncing.

---

## Step 4 — Configure the Node

Create the promptd configuration file. This is the main configuration for the node runtime:

```bash
./scripts/promptd.sh --print-template > onchain/prompt/mainnet/setup.json
```

Edit `onchain/prompt/mainnet/setup.json` with your values. The critical fields are:

```json
{
  "server": {
    "port": 9334,
    "tradeauto_autostart": true,
    "tradeauto_channels": ["0000intercomswapbtcusdt", "0000intercom"]
  },
  "peer": {
    "keypair": "stores/mainnet-maker/db/keypair.json"
  },
  "solana": {
    "rpc_url": "https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY",
    "keypair": "onchain/sol-agent.json"
  },
  "ln": {
    "impl": "lnd",
    "backend": "cli",
    "network": "mainnet",
    "wallet_password_file": "onchain/lnd/mainnet/maker.wallet-password.txt",
    "lnd": {
      "rpcserver": "localhost:10009",
      "tlscert": "onchain/lnd/mainnet/tls.cert",
      "macaroon": "onchain/lnd/mainnet/admin.macaroon"
    }
  },
  "receipts": {
    "db": "onchain/receipts/mainnet/swap-maker.sqlite"
  }
}
```

> **Tip:** If you are not trading BTC/LN pairs, omit the `ln` block entirely. The node will operate in Solana/Ethereum-only mode.

---

## Step 5 — Fund Your Wallets

Before the node can quote and fill swaps, its wallets must hold sufficient inventory.

### Solana

```bash
# Check SOL balance
./scripts/solctl.sh balance --keypair onchain/sol-agent.json

# Check USDT balance (mainnet USDT mint: Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB)
./scripts/solctl.sh token-balance \
  --keypair onchain/sol-agent.json \
  --mint Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB
```

Transfer SOL and USDT to the address printed by `./scripts/solctl.sh pubkey --keypair onchain/sol-agent.json`.

### Lightning (BTC pairs only)

```bash
# Get a funding address for the LN on-chain wallet
./scripts/lnctl.sh newaddr

# After sending BTC and waiting for confirmation, check the balance
./scripts/lnctl.sh balance

# Open a public channel to a well-connected peer
./scripts/lnctl.sh fundchannel \
  --node_id 03abc...PEER_NODE_ID \
  --amount_sats 2000000 \
  --push_sats 400000
# push_sats = 20% of capacity for balanced two-sided trading
```

Wait until the channel is confirmed and active:

```bash
./scripts/lnctl.sh listchannels
```

---

## Step 6 — Start the Node

Start the node using the peer manager (recommended — runs headless, survives terminal disconnection):

```bash
./scripts/peermgr.sh start \
  --name mainnet-maker \
  --store mainnet-maker \
  --sc-port 49222 \
  --sidechannels 0000intercomswapbtcusdt,0000intercom
```

Then start the promptd tool gateway (exposes the REST + SSE API that the AFOS dashboard connects to):

```bash
./scripts/promptd.sh --config onchain/prompt/mainnet/setup.json &
```

The node is now:
- Connected to the Hyperswarm DHT via the `0000intercomswapbtcusdt` rendezvous channel.
- Listening for incoming RFQs and broadcasting service announcements.
- Running backend trade automation (`tradeauto`) to negotiate and execute swaps unattended.
- Exposing the Oracle VM API at `http://YOUR_SERVER_IP:9334`.

Verify the node is running:

```bash
./scripts/promptctl.sh --config onchain/prompt/mainnet/setup.json \
  --prompt "Show peer status and joined channels"
```

---

## Step 7 — Point Your AFOS Dashboard at Your Node

In the AFOS dashboard, navigate to **Admin Panel → Operator Config** and update the **Oracle VM URL** field to point to your server:

```
http://YOUR_SERVER_IP:9334
```

If your server is behind a reverse proxy (recommended for production), use the HTTPS URL:

```
https://your-node.example.com
```

Alternatively, update the `ORACLE_API_URL` environment variable in your AFOS dashboard deployment and restart the server.

> **Security note:** The Oracle VM API has no built-in authentication. If you expose it on a public IP, restrict access using a firewall rule so that only your AFOS dashboard server can reach it, or place it behind a reverse proxy with authentication.

---

## Step 8 — Verify Connectivity

In the AFOS dashboard:

1. Open the **Network** page. Your node should appear in the peer list with `origin: hyperswarm`.
2. Open the **Admin Panel → Node Health** tab. All RPC endpoints should show green.
3. Open the **Chat** page and type `swap 1 SOL to USDT`. The agent should route the RFQ through your node and return a quote from the DHT within a few seconds.

If the node does not appear, check:

```bash
# Confirm the peer is running
./scripts/peermgr.sh status --name mainnet-maker

# Confirm promptd is reachable
curl http://YOUR_SERVER_IP:9334/api/status

# Check peer logs
./scripts/peermgr.sh logs --name mainnet-maker --lines 50
```

---

## Operating Your Node

### Posting Offers (Liquidity Announcements)

To advertise your liquidity to other peers in the DHT, post a service announcement:

```bash
./scripts/promptctl.sh \
  --config onchain/prompt/mainnet/setup.json \
  --prompt "Post a sell-USDT offer for 0.1 to 5 SOL at 0.5% spread in 0000intercomswapbtcusdt"
```

For continuous reposting (sidechannels have no message history — announcements expire when peers disconnect):

```bash
./scripts/promptctl.sh \
  --config onchain/prompt/mainnet/setup.json \
  --prompt "Start auto-posting the sell-USDT offer every 60 seconds"
```

### Monitoring Swaps

```bash
# List recent swap receipts
./scripts/swaprecover.sh list --db onchain/receipts/mainnet/swap-maker.sqlite

# Show details of a specific swap
./scripts/swaprecover.sh show \
  --db onchain/receipts/mainnet/swap-maker.sqlite \
  --trade-id TRADE_ID
```

### Recovering a Stuck Swap

If a swap stalled after the Lightning payment was made but before the Solana claim was submitted:

```bash
./scripts/swaprecover.sh recover \
  --db onchain/receipts/mainnet/swap-maker.sqlite \
  --trade-id TRADE_ID
```

### Stopping and Restarting

```bash
# Stop the peer
./scripts/peermgr.sh stop --name mainnet-maker

# Restart after a config change
./scripts/peermgr.sh restart --name mainnet-maker
```

---

## TNK (Trac Network) Support

TNK is the native token of [Trac Network](https://trac.network) — a Bitcoin meta-protocol that uses Bitcoin-compatible P2WPKH addressing (`trac1…` addresses) and Ed25519 signing for contract transactions. AFOS has deep, production-grade TNK integration covering all six bidirectional swap pairs (SOL↔TNK, USDT↔TNK, USDC↔TNK).

TNK support is fully compatible with a self-hosted Full Node, but it requires one additional component — the **trac-peer node** — that the other chains do not need.

### What Makes TNK Different

Because Trac Network does not have native HTLC opcodes, AFOS uses an **agent-escrow model**: TNK is sent to a designated escrow address with a memo in the format `AFOS-HTLC:{secretHash}:{escrow}:{amount}:{expiry}`. The server monitors the Trac Network for incoming transfers to that address and matches them to pending HTLC rows in the database.

The trac-peer node is a separate Node.js process that runs the AFOS HTLC subnet contract — a smart contract layer on top of the Trac Network that manages HTLC lock, claim, and refund state. The AFOS dashboard communicates with it via `TNK_PEER_RPC_URL` (default: `http://localhost:5001`). If the trac-peer is unreachable, the system automatically falls back to **legacy explorer mode** — polling `explorer.trac.network` directly — so TNK swaps still work, just with slightly slower lock detection.

### TNK Key Types

TNK requires three separate keys, each serving a distinct purpose:

| Secret | Format | Purpose |
|---|---|---|
| `TNK_HTLC_WIF` | 64-byte hex (128 chars): `seed[32] + pubkey[32]` | Signs real on-chain TNK transfers via `tracapi.trac.network`. This is the escrow wallet that physically holds locked TNK. |
| `TNK_ESCROW_ADDRESS` | `trac1…` address | The public address derived from `TNK_HTLC_WIF`. Users lock TNK to this address when initiating a swap. |
| `TNK_AGENT_KEY` | Ed25519 PKCS8 DER hex (96 chars) or raw 64-byte hex (128 chars) | Signs trac-peer subnet contract transactions (HTLC lock/claim/refund commands on the subnet). Separate from the escrow wallet key. |
| `TNK_HTLC_CONTRACT_ADDRESS` | `trac1…` address | The address of the AFOS HTLC contract deployed on the trac-peer subnet. |
| `TNK_PEER_RPC_URL` | URL | Base URL of your trac-peer node (e.g. `http://localhost:5001`). Optional — falls back to explorer mode if not set. |

### Step A — Generate TNK_HTLC_WIF (Escrow Wallet Key)

`TNK_HTLC_WIF` is a 64-byte Ed25519 keypair in raw hex format (`seed[32] + pubkey[32]`, 128 hex characters total). Generate it with Node.js:

```bash
node -e "
const { generateKeyPairSync } = require('crypto');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
// Export as raw 64-byte hex: seed[32] + pubkey[32]
const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });
const seed = privDer.slice(-32);   // last 32 bytes of PKCS8 DER = seed
const pubDer = publicKey.export({ format: 'der', type: 'spki' });
const pub = pubDer.slice(-32);     // last 32 bytes of SPKI DER = pubkey
console.log('TNK_HTLC_WIF=' + Buffer.concat([seed, pub]).toString('hex'));
"
```

Save the output securely. This is the private key for the TNK escrow wallet — **anyone who has this key can spend all TNK held in the escrow address**.

> **Alternative:** If you already have a trac-peer node running, you can export the existing agent key from `onchain/trac-peer/keypair.json` and use that as `TNK_HTLC_WIF`. The format is the same 64-byte hex.

### Step B — Derive Your trac1 Escrow Address

The `TNK_ESCROW_ADDRESS` is derived from `TNK_HTLC_WIF` using Bitcoin-compatible P2WPKH addressing (Trac Network uses the same address format as Bitcoin bech32). Derive it with Node.js:

```bash
node -e "
const bitcoin = require('bitcoinjs-lib');
const { ECPair } = require('ecpair');
const ecc = require('tiny-secp256k1');

// Replace with your TNK_HTLC_WIF value
const wifHex = process.env.TNK_HTLC_WIF;
const keyBytes = Buffer.from(wifHex, 'hex');
// The first 32 bytes are the Ed25519 seed — use as secp256k1 private key for address derivation
const keyPair = ECPair.fromPrivateKey(keyBytes.slice(0, 32), { compressed: true });
const { address } = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(keyPair.publicKey) });
console.log('TNK_ESCROW_ADDRESS=' + address);
"
```

First install the required packages if not already present:

```bash
npm install bitcoinjs-lib ecpair tiny-secp256k1
```

The derived `trac1…` address is your `TNK_ESCROW_ADDRESS`. This is the address you will fund with TNK inventory and the address that users lock TNK to when swapping.

### Step C — Generate TNK_AGENT_KEY (Subnet Contract Signing Key)

`TNK_AGENT_KEY` is used to sign trac-peer subnet contract transactions (HTLC lock/claim/refund). It is a separate key from the escrow wallet key. Generate it with Node.js:

```bash
node -e "
const { generateKeyPairSync } = require('crypto');
const { privateKey } = generateKeyPairSync('ed25519');
// Export as PKCS8 DER hex (96 hex chars = 48 bytes)
const der = privateKey.export({ format: 'der', type: 'pkcs8' });
console.log('TNK_AGENT_KEY=' + der.toString('hex'));
"
```

The AFOS server accepts two formats for `TNK_AGENT_KEY`:

- **PKCS8 DER hex** (96 chars = 48 bytes) — generated by the command above, the recommended format.
- **Raw 64-byte hex** (128 chars) — the native trac-peer / Solana format (`seed[32] + pubkey[32]`), compatible with keys exported from a trac-peer node.

### Step D — Set Up the trac-peer Node

The trac-peer node is the AFOS HTLC subnet runtime. It is a separate Node.js service that must run alongside your AFOS dashboard server.

**Clone and install:**

```bash
# The trac-peer node is part of the AFOS server infrastructure
# Clone the AFOS repo if you have not already
git clone https://github.com/idimi/AFOS.git
cd AFOS
npm install
```

**Start the trac-peer node:**

```bash
# The trac-peer node is started as part of the AFOS server
# Set TNK_PEER_RPC_URL to point to it (default: http://localhost:5001)
export TNK_PEER_RPC_URL=http://localhost:5001
export TNK_AGENT_KEY=<your_96_char_hex_key>
export TNK_HTLC_CONTRACT_ADDRESS=<contract_address>

# Start the trac-peer subnet node
node server/jobs/tnkHtlcMonitor.js
```

> **Note:** The `TNK_HTLC_CONTRACT_ADDRESS` is the address of the AFOS HTLC contract deployed on the Trac Network subnet. Contact the AFOS team or check the [Trac Network explorer](https://explorer.trac.network) for the current deployed contract address. If you are running a private subnet for testing, you can deploy your own contract using the trac-peer contract tooling.

**Verify the trac-peer node is healthy:**

```bash
curl http://localhost:5001/v1/health
# Expected: { "ok": true }
```

In the AFOS dashboard, navigate to **Admin Panel → Node Health**. The "TNK HTLC Subnet" row should show green with the current block height.

### Step E — Configure AFOS Dashboard Secrets for TNK

In the AFOS dashboard, navigate to **Admin Panel → Operator Config** (or set these as environment secrets in your deployment) and add the following:

```env
TNK_HTLC_WIF=<your_128_char_hex_key>
TNK_ESCROW_ADDRESS=<your_trac1_address>
TNK_AGENT_KEY=<your_96_char_hex_key>
TNK_HTLC_CONTRACT_ADDRESS=<contract_trac1_address>
TNK_PEER_RPC_URL=http://localhost:5001
VITE_TNK_ESCROW_ADDRESS=<your_trac1_address>
```

`VITE_TNK_ESCROW_ADDRESS` is the frontend-visible version of the escrow address — it is shown in the Swap UI so users know where to lock TNK. It should be the same value as `TNK_ESCROW_ADDRESS`.

### Step F — Fund the TNK Escrow Wallet

Before your node can act as a maker in SOL→TNK swaps, the escrow wallet must hold TNK inventory.

```bash
# Check your escrow wallet balance
curl https://tracapi.trac.network/v1/balance/<your_trac1_address>
# Response: { "address": "trac1...", "balance": 0 }
```

Transfer TNK to your `TNK_ESCROW_ADDRESS` from any Trac Network wallet (e.g. Tap Wallet). The escrow wallet also needs a small buffer of TNK to cover the **0.03 TNK network fee** charged per on-chain transfer. A minimum balance of `(expected_inventory) + 1 TNK` is recommended to ensure the fee buffer never runs dry.

**Fee structure for TNK swaps:**

| Fee | Amount | Who pays | When |
|---|---|---|---|
| Platform fee | 0.15% of output amount | Deducted from user's received amount | Every swap |
| Trac Network transfer fee | 0.03 TNK flat | Charged to user via reduced output | Every on-chain TNK transfer |
| Gas (SOL side) | ~0.000005 SOL | Agent pays from `SOL_HTLC_KEY` | Every Solana HTLC claim |

### TNK Fallback Mode (No trac-peer)

If `TNK_PEER_RPC_URL` is not set or the trac-peer node is unreachable, the AFOS server automatically switches to **legacy explorer mode**. In this mode:

- The TNK HTLC monitor polls `explorer.trac.network` every 60 seconds instead of querying the subnet.
- Lock detection is slower (up to 60 seconds vs. near-instant with the subnet).
- Subnet contract state (HTLC lock/claim/refund) is not available — the monitor relies on the public explorer API and the local database.
- Refunds in legacy mode use a simplified path that may require manual intervention for edge cases.

For production use, running the trac-peer node is strongly recommended. For testing or low-volume deployments, legacy explorer mode is sufficient.

### Supported TNK Swap Pairs

Once your node is configured and funded, the following swap pairs are available through the AFOS Chat and Swap interfaces:

| From | To | Route | Settlement |
|---|---|---|---|
| SOL | TNK | Agent locks TNK first → user signs Solana lock → Helius webhook settles | ~30–60 seconds |
| USDT (Solana) | TNK | Same as SOL→TNK | ~30–60 seconds |
| USDC (Solana) | TNK | Same as SOL→TNK | ~30–60 seconds |
| TNK | SOL | Agent locks SOL first → user signs TNK lock via Tap Wallet → TNK monitor settles | ~1–5 minutes |
| TNK | USDT (Solana) | Same as TNK→SOL | ~1–5 minutes |
| TNK | USDC (Solana) | Same as TNK→SOL | ~1–5 minutes |

TNK↔ETH and TNK↔BTC pairs are routed through the Oracle VM P2P network (Hyperswarm DHT) and require a counterparty peer advertising those pairs. They do not require additional configuration beyond the keys above.

---

## Security Considerations

Running a Full Node means holding private keys on a server. The following practices are strongly recommended:

- **Dedicated server** — do not run the node on a machine used for general browsing or development.
- **Firewall** — expose only the ports you need. The Oracle VM API port (default `9334`) should be accessible only from your AFOS dashboard server, not the public internet.
- **Key separation** — use dedicated keypairs for the node agent (`SOL_HTLC_KEY`, `ETH_HTLC_KEY`, `BTC_HTLC_WIF`, `TNK_HTLC_WIF`, `TNK_AGENT_KEY`) that are separate from your personal wallets. Fund them with only the inventory you intend to trade.
- **Trade size limits** — configure `maxTradeUsd` in your node's offer announcements to cap the maximum exposure per trade.
- **Timelock parameters** — the HTLC timelock (default 24 hours on Solana, 48 hours on Bitcoin) is your safety net. If a counterparty disappears, your funds are automatically refunded after the timelock expires. Do not reduce the timelock below safe values.
- **Backup** — back up `onchain/` (excluding the `node_modules` and build artifacts) regularly. This directory contains your peer store, keypairs, receipts database, and LN wallet data. Loss of this directory means loss of access to any funds locked in open HTLCs.
- **Secrets hygiene** — the `onchain/` directory is gitignored. Verify this before pushing any changes to a public repository.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Node does not appear in the AFOS Network page | `ORACLE_API_URL` not updated, or firewall blocking port 9334 | Update Operator Config in Admin Panel; check firewall rules |
| Swaps route to DEX instead of P2P | Node is not announcing offers, or no matching pair | Post a service announcement for the relevant pair |
| `NO_ROUTE` error on Lightning payment | Insufficient outbound liquidity on LN channels | Open additional channels or rebalance existing ones |
| HTLC lock succeeds but claim never fires | Helius webhook not configured, or HTLC Secrets Monitor not running | Check Admin Panel → Webhook Health; verify `HELIUS_API_KEY` is set |
| `spawn lncli ENOENT` | LND CLI not in PATH or `ln.impl` not set | Set `ln.cli_bin` in `setup.json` or add `lncli` to PATH |
| Peer store locked / already running | Previous peer process did not exit cleanly | Run `./scripts/peermgr.sh stop --name mainnet-maker` and restart |
| Solana claim fails with `insufficient funds` | SOL balance too low for transaction fees | Top up the agent wallet with SOL (0.01 SOL per claim is sufficient) |
| TNK HTLC Subnet shows "offline" in Node Health | `TNK_PEER_RPC_URL` not set or trac-peer node not running | Start the trac-peer node; the system will fall back to legacy explorer mode automatically |
| TNK swap stuck in "pending" for >10 minutes | trac-peer unreachable and explorer fallback missed the lock | Check `TNK_ESCROW_ADDRESS` is correct; verify the transfer appears on `explorer.trac.network` |
| `TNK_HTLC_WIF not set or invalid length` error | Key is not 128 hex chars | Re-generate using the Node.js command in Step A; ensure no spaces or newlines |
| `TNK_HTLC_WIF derives address X but expected Y` | `TNK_ESCROW_ADDRESS` does not match the key | Re-derive the address using the Node.js command in Step B and update `TNK_ESCROW_ADDRESS` |
| TNK claim succeeds but on-chain transfer fails | Escrow wallet balance too low (needs amount + 0.03 TNK fee) | Top up the escrow wallet; the monitor will retry the transfer automatically |

---

## Balance Display Precision Convention

The AFOS dashboard uses the following decimal precision convention for all wallet balance displays:

| Asset type | Display precision | Example |
|---|---|---|
| BTC, TNK | 8 decimal places | `2.00000000 BTC` |
| ETH, SOL | 6 decimal places | `1.183214 SOL` |
| USDT, USDC (stablecoins) | 2 decimal places | `100.00 USDT` |

This convention is applied consistently across the **HTLC Escrow Wallet** panel, the **Oracle VM Hot Wallet** panel, and all client-side balance fallbacks.

### Known Issue: Oracle VM TNK Balance Float Truncation

The Oracle VM (`/api/wallet` endpoint) serialises the TNK balance as a JavaScript `Number` (64-bit float). Because TNK uses 18 decimal places internally (raw units = human-readable × 10^18), the float representation loses 8 significant digits of precision:

```
Raw value:         2000000000000000000  (2 TNK × 10^18)
Oracle VM sends:   "20000000000.00000000"  (float truncation — 8 digits lost)
Correct display:   "2.00000000 TNK"
```

The AFOS dashboard server-side proxy (`server/_core/index.ts`) intercepts `/api/afos/api/wallet` responses and normalises TNK balances by dividing by `1e10` before forwarding to the client. This fix is transparent — it works regardless of whether the Oracle VM is updated.

**If you run your own Oracle VM node**, you can fix this at the source by serialising the TNK balance as a full integer string:

```js
// ❌ Wrong — float truncation
balance: tracBalance / 1e18

// ✅ Correct — full precision string
balance: (BigInt(rawBalance) * 100000000n / BigInt(1e18)).toString() + '.' +
         String(Number(BigInt(rawBalance) % BigInt(1e10))).padStart(8, '0')

// Or simpler — return the raw BigInt string and let the client divide:
balance_raw: rawBalance.toString()  // e.g. "2000000000000000000"
```

---

## Further Reading

- [IntercomSwap Repository](https://github.com/TracSystems/intercom-swap) — the upstream Full Node runtime, including `SKILL.md` as the canonical installer/runbook.
- [Intercom (upstream)](https://github.com/Trac-Systems/intercom) — the Hyperswarm/HyperDHT transport layer that IntercomSwap builds on.
- [Hyperswarm](https://github.com/hyperswarm/hyperswarm) — the DHT peer discovery library.
- [LND Neutrino Guide](https://docs.lightning.engineering/lightning-network-tools/lnd/enable-neutrino-mode-in-bitcoin-core) — running a Lightning node without a full Bitcoin node.
- [Helius Webhooks](https://docs.helius.dev/webhooks-and-websockets/what-are-webhooks) — real-time Solana HTLC event notifications used by the AFOS dashboard.
- [Trac Network Explorer](https://explorer.trac.network) — block explorer for the Trac Network; used by the TNK HTLC legacy fallback mode.
- [Trac Network API](https://tracapi.trac.network/v1/confirmed-length) — public REST API for balance queries and transaction broadcasting on Trac Network.
- [Trac Systems GitHub](https://github.com/Trac-Systems) — upstream repositories for the Trac Network protocol and tooling.

---

*AFOS and IntercomSwap are beta software. Running a Full Node involves holding private keys and real funds on a server. Always test on devnet/testnet before committing mainnet liquidity. Use at your own risk.*
