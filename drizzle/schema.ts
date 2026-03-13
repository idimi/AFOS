import { bigint, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── HTLC Swaps ──────────────────────────────────────────────────────────────
// Tracks every HTLC lock across all three chains for timeout monitoring.
// The background poller (server/htlcMonitor.ts) watches this table and
// auto-triggers refund when the CLTV locktime is reached.
export const htlcSwaps = mysqlTable("htlc_swaps", {
  id:             int("id").autoincrement().primaryKey(),
  /** Chain where the HTLC was locked: bitcoin | ethereum | solana | trac_network */
  chain:          mysqlEnum("chain", ["bitcoin", "ethereum", "solana", "trac_network"]).notNull(),
  /** HTLC address / contract address / PDA */
  htlcAddress:    varchar("htlcAddress", { length: 128 }).notNull(),
  /** SHA-256 hash of the preimage secret */
  secretHash:     varchar("secretHash", { length: 64 }).notNull(),
  /** Lock transaction ID on the source chain */
  lockTxId:       varchar("lockTxId", { length: 128 }),
  /** Amount locked (in smallest unit: sats for BTC, wei for ETH, lamports for SOL) */
  amountRaw:      varchar("amountRaw", { length: 32 }).notNull(),
  /** Human-readable amount (e.g. 0.001 for BTC) */
  amountHuman:    varchar("amountHuman", { length: 32 }).notNull(),
  /** Block height / slot at which the HTLC expires (CLTV locktime) */
  locktime:       int("locktime").notNull(),
  /** Current status of the HTLC */
  status:         mysqlEnum("status", ["pending", "completed", "refunded", "expired"]).default("pending").notNull(),
  /** Counterparty peer ID from IntercomSwap P2P (if P2P route) */
  peerId:         varchar("peerId", { length: 128 }),
  /** RFQ ID from IntercomSwap Oracle */
  rfqId:          varchar("rfqId", { length: 128 }),
  /** Destination token symbol */
  toToken:        varchar("toToken", { length: 16 }),
  /** Destination chain */
  toChain:        mysqlEnum("toChain", ["bitcoin", "ethereum", "solana", "trac_network"]),
  /** Refund transaction ID (set when status = refunded) */
  refundTxId:     varchar("refundTxId", { length: 128 }),
  /** User's wallet address (sender) */
  senderAddress:    varchar("senderAddress", { length: 128 }),
  /** Recipient wallet address (counterparty who will receive funds on claim) */
  recipientAddress: varchar("recipientAddress", { length: 128 }),
  /** HTLC PDA seed used to derive the on-chain PDA (e.g. htlc_a_<rfqId slice>) */
  htlcId:           varchar("htlcId", { length: 64 }),
  /**
   * The counterparty's wallet address on the same chain.
   * For Agent A rows: this is Agent B's wallet (who will receive the locked funds on claim).
   * For Agent B rows: this is Agent A's wallet (the initiator).
   * Stored here so HtlcSecretsMonitor can auto-claim without a separate htlc_secrets lookup.
   */
  counterpartyAddress: varchar("counterpartyAddress", { length: 128 }),
  createdAt:        timestamp("createdAt").defaultNow().notNull(),
  updatedAt:        timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  refundedAt:       timestamp("refundedAt"),
});

export type HtlcSwap = typeof htlcSwaps.$inferSelect;
export type InsertHtlcSwap = typeof htlcSwaps.$inferInsert;

// ─── Swap Analytics ───────────────────────────────────────────────────────────
// Records every completed/failed swap for the analytics dashboard.
// Populated by all three chain execution procedures after settlement.
export const swapAnalytics = mysqlTable("swap_analytics", {
  id:             int("id").autoincrement().primaryKey(),
  /** Source chain */
  fromChain:      mysqlEnum("fromChain", ["bitcoin", "ethereum", "solana", "trac_network"]).notNull(),
  /** Destination chain */
  toChain:        mysqlEnum("toChain", ["bitcoin", "ethereum", "solana", "trac_network"]).notNull(),
  /** Source token symbol */
  fromToken:      varchar("fromToken", { length: 16 }).notNull(),
  /** Destination token symbol */
  toToken:        varchar("toToken", { length: 16 }).notNull(),
  /** Amount in human-readable units */
  amount:         varchar("amount", { length: 32 }).notNull(),
  /** USD value at time of swap */
  amountUsd:      varchar("amountUsd", { length: 32 }),
  /** Route used: IntercomSwap P2P | Jupiter DEX | 1inch | Direct HTLC */
  route:          varchar("route", { length: 64 }).notNull(),
  /** Swap outcome */
  status:         mysqlEnum("status", ["completed", "failed", "refunded"]).notNull(),
  /** Time from quote to settlement in milliseconds */
  settlementMs:   int("settlementMs"),
  /** Transaction / HTLC ID on the source chain */
  txId:           varchar("txId", { length: 128 }),
  /** Peer ID if P2P route */
  peerId:         varchar("peerId", { length: 128 }),
  /** Platform fee charged in USD (0.15% for P2P, 0.20% for DEX) */
  platformFeeUsd: varchar("platformFeeUsd", { length: 32 }),
  /** Fee basis points: 15 for P2P, 20 for DEX */
  feeBps:         int("feeBps"),
  /** Fee amount in output token units */
  feeAmountOut:   varchar("feeAmountOut", { length: 32 }),
  /** Output amount in human-readable units (e.g. 24.01 SOL) */
  outAmount:      varchar("outAmount", { length: 32 }),
  /** Wallet address of the user who initiated the swap (for per-user history filtering) */
  walletAddress:  varchar("walletAddress", { length: 128 }),
  /** Oracle VM RFQ ID — used by the Oracle VM sync job to back-fill/de-duplicate rows */
  rfqId:          varchar("rfqId", { length: 128 }),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type SwapAnalytic = typeof swapAnalytics.$inferSelect;
export type InsertSwapAnalytic = typeof swapAnalytics.$inferInsert;

// ─── Peer Reputation ─────────────────────────────────────────────────────────
// Tracks per-peer reputation signals: successful swaps, failed pings, uptime.
// Score is computed 0–100 from these signals and shown as a badge in the
// Network → Peer Directory tab.
export const peerReputation = mysqlTable("peer_reputation", {
  id:               int("id").autoincrement().primaryKey(),
  /** Full peer public key (hex) or wallet address for Light Peers */
  peerId:           varchar("peerId", { length: 128 }).notNull().unique(),
  /** Human-readable alias (e.g. lp-abc123) */
  alias:            varchar("alias", { length: 64 }),
  /** Origin network: hyperswarm | intercomswap */
  origin:           varchar("origin", { length: 32 }).default("hyperswarm").notNull(),
  /** Number of swaps this peer successfully completed as counterparty */
  successfulSwaps:  int("successfulSwaps").default(0).notNull(),
  /** Number of failed or timed-out pings */
  failedPings:      int("failedPings").default(0).notNull(),
  /** Number of successful pings (used to compute uptime %) */
  successfulPings:  int("successfulPings").default(0).notNull(),
  /** Sum of all recorded latencies in ms (divide by successfulPings for avg) */
  totalLatencyMs:   int("totalLatencyMs").default(0).notNull(),
  /** Computed reputation score 0–100 (updated on each ping / swap event) */
  score:            int("score").default(50).notNull(),
  /** Timestamp of first sighting */
  firstSeenAt:      timestamp("firstSeenAt").defaultNow().notNull(),
  /** Timestamp of last successful interaction */
  lastSeenAt:       timestamp("lastSeenAt").defaultNow().notNull(),
  updatedAt:        timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  /** Operator free-text notes about this peer */
  notes:            text("notes"),
  /** JSON-encoded array of tag strings, e.g. ["main LP","slow ETH"] */
  tags:             text("tags"),
});

export type PeerReputation = typeof peerReputation.$inferSelect;
export type InsertPeerReputation = typeof peerReputation.$inferInsert;

// ─── User Settings ────────────────────────────────────────────────────────────
// Stores per-user trading preferences, keyed by walletAddress.
// A user can have multiple connected wallets; each wallet gets its own row.
// Falls back to sensible defaults when no row exists yet.
export const userSettings = mysqlTable("user_settings", {
  id:               int("id").autoincrement().primaryKey(),
  /** Manus OAuth openId — links to users.openId */
  openId:           varchar("openId", { length: 64 }).notNull().unique(),
  /** Maximum single-swap amount in USD the user will allow */
  maxTxAmountUsd:   int("maxTxAmountUsd").default(500).notNull(),
  /** When true the agent executes swaps without asking for confirmation */
  autoConfirm:      int("autoConfirm").default(0).notNull(), // 0 = false, 1 = true (MySQL tinyint)
  /** Slippage tolerance as a percentage, e.g. 0.5 means 0.5% */
  slippagePct:      varchar("slippagePct", { length: 8 }).default("0.5").notNull(),
  /** Preferred swap route: intercomswap | jupiter | zerox | oneinch | best */
  preferredRoute:   mysqlEnum("preferredRoute", ["intercomswap", "jupiter", "zerox", "oneinch", "best"]).default("best").notNull(),
  /** Appearance theme preference: dark | light | system */
  theme:            mysqlEnum("theme", ["dark", "light", "system"]).default("dark").notNull(),
  /** When true the agent automatically accepts incoming P2P RFQs within the configured limits */
  autoAcceptRfq:    int("autoAcceptRfq").default(0).notNull(), // 0 = false, 1 = true
  /** Maximum USD value of a single RFQ the agent will auto-accept (0 = use maxTxAmountUsd) */
  autoAcceptMaxUsd: int("autoAcceptMaxUsd").default(0).notNull(),
  // ── Notification preferences ──────────────────────────────────────────────
  /** Fire a toast when someone reacts to your message (0 = off, 1 = on) */
  notifyReactions:      int("notifyReactions").default(0).notNull(),
  /** Fire a toast when an incoming DM arrives (0 = off, 1 = on) */
  notifyIncomingDm:     int("notifyIncomingDm").default(1).notNull(),
  /** Show pulsing unread badge on peer graph nodes (0 = off, 1 = on) */
  notifyUnreadBadge:    int("notifyUnreadBadge").default(1).notNull(),
  /** Fire a toast when a peer clicks a pair badge to start an RFQ (0 = off, 1 = on) */
  notifyTradeInquiry:   int("notifyTradeInquiry").default(1).notNull(),
  // ── Message preferences ───────────────────────────────────────────────────
  /** Let peers see read receipts when you read their messages (0 = off, 1 = on) */
  showReadReceipts:     int("showReadReceipts").default(1).notNull(),
  /** Send typing indicator signal to peers while you type (0 = off, 1 = on) */
  showTypingIndicator:  int("showTypingIndicator").default(1).notNull(),
  // ── Privacy preferences ───────────────────────────────────────────────────
  /** Broadcast your country flag emoji to other peers on the network (0 = off, 1 = on) */
  showCountryFlag:      int("showCountryFlag").default(1).notNull(),
  // ── Owner push notification preferences (server-side notifyOwner calls) ─────────────────────
  /** Send owner push notification when an HTLC is locked on-chain (0 = off, 1 = on) */
  ownerNotifyHtlcLocked:     int("ownerNotifyHtlcLocked").default(0).notNull(),
  /** Send owner push notification when an HTLC secret is revealed (0 = off, 1 = on) */
  ownerNotifySecretRevealed: int("ownerNotifySecretRevealed").default(0).notNull(),
  /** Send owner push notification when a P2P RFQ is sent to a peer (0 = off, 1 = on) */
  ownerNotifyRfqSent:        int("ownerNotifyRfqSent").default(0).notNull(),
  /** Send owner push notification when a TNK HTLC lock is missed (0 = off, 1 = on) */
  ownerNotifyMissedLock:     int("ownerNotifyMissedLock").default(1).notNull(),
  /** Send owner push notification when a swap is completed successfully (0 = off, 1 = on) */
  ownerNotifySwapCompleted:  int("ownerNotifySwapCompleted").default(1).notNull(),
  createdAt:        timestamp("createdAt").defaultNow().notNull(),
  updatedAt:        timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = typeof userSettings.$inferInsert;

/** Default settings returned when no row exists yet for a user */
// ─── Peer Direct Messages ────────────────────────────────────────────────────
// Stores informal pre-swap messages exchanged between Light Peers via the relay.
// Messages are keyed by sender/recipient peer IDs (wallet-derived).
export const peerMessages = mysqlTable("peer_messages", {
  id:           int("id").autoincrement().primaryKey(),
  /** Sender peer ID (wallet-derived, e.g. lp-eth-8dfa0f) */
  fromPeerId:   varchar("fromPeerId", { length: 128 }).notNull(),
  /** Recipient peer ID */
  toPeerId:     varchar("toPeerId", { length: 128 }).notNull(),
  /** Message body (plain text, max 500 chars) */
  body:         varchar("body", { length: 500 }).notNull(),
  /** Timestamp when the message was read by the recipient (null = unread) */
  readAt:       timestamp("readAt"),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
});

export type PeerMessage = typeof peerMessages.$inferSelect;
export type InsertPeerMessage = typeof peerMessages.$inferInsert;

// ─── Peer Blocks ─────────────────────────────────────────────────────────────
// Tracks which peers a user has blocked. Blocked peers cannot send DMs.
export const peerBlocks = mysqlTable("peer_blocks", {
  id:          int("id").autoincrement().primaryKey(),
  /** The peer who initiated the block (local peer ID) */
  blockerPeerId: varchar("blockerPeerId", { length: 128 }).notNull(),
  /** The peer being blocked */
  blockedPeerId: varchar("blockedPeerId", { length: 128 }).notNull(),
  /** Optional note/reason for the block */
  reason:      varchar("reason", { length: 256 }),
  createdAt:   timestamp("createdAt").defaultNow().notNull(),
});

export type PeerBlock = typeof peerBlocks.$inferSelect;
export type InsertPeerBlock = typeof peerBlocks.$inferInsert;

export const DEFAULT_USER_SETTINGS = {
  maxTxAmountUsd: 500,
  autoConfirm: false,
  slippagePct: "0.5",
  preferredRoute: "best" as "intercomswap" | "jupiter" | "zerox" | "oneinch" | "best",
  theme: "dark" as const,
  autoAcceptRfq: false,
  autoAcceptMaxUsd: 0,
  // Notification prefs (stored as 0/1 in DB, exposed as boolean)
  notifyReactions: false,
  notifyIncomingDm: true,
  notifyUnreadBadge: true,
  notifyTradeInquiry: true,
  // Message prefs
  showReadReceipts: true,
  showTypingIndicator: true,
  // Privacy prefs
  showCountryFlag: true,
  // Owner push notification prefs (server-side notifyOwner calls)
  ownerNotifyHtlcLocked: false,
  ownerNotifySecretRevealed: false,
  ownerNotifyRfqSent: false,
  ownerNotifyMissedLock: true,
  ownerNotifySwapCompleted: true,
  // Display prefs
  graphDensity: 1.0,
};

// ─── Peer Reports ─────────────────────────────────────────────────────────────
// Users can flag peers as spammy or malicious. Reports are visible in Admin Panel.
export const peerReports = mysqlTable("peer_reports", {
  id:           int("id").autoincrement().primaryKey(),
  /** The peer who submitted the report (local peer ID) */
  reporterPeerId: varchar("reporterPeerId", { length: 128 }).notNull(),
  /** The peer being reported */
  reportedPeerId: varchar("reportedPeerId", { length: 128 }).notNull(),
  /** Reason category: spam | suspicious_activity | fake_quotes | harassment | other */
  reason:       varchar("reason", { length: 64 }).notNull(),
  /** Optional free-text details */
  details:      text("details"),
  /** Admin review status: pending | reviewed | dismissed */
  status:       varchar("status", { length: 32 }).default("pending").notNull(),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
});
export type PeerReport = typeof peerReports.$inferSelect;
export type InsertPeerReport = typeof peerReports.$inferInsert;

// ─── Peer Mutes ───────────────────────────────────────────────────────────────
// Muting hides notifications from a peer without blocking their messages.
export const peerMutes = mysqlTable("peer_mutes", {
  id:           int("id").autoincrement().primaryKey(),
  /** The peer who muted */
  muterPeerId:  varchar("muterPeerId", { length: 128 }).notNull(),
  /** The peer being muted */
  mutedPeerId:  varchar("mutedPeerId", { length: 128 }).notNull(),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
});
export type PeerMute = typeof peerMutes.$inferSelect;
export type InsertPeerMute = typeof peerMutes.$inferInsert;

// ─── Admin Config ─────────────────────────────────────────────────────────────
// Singleton table (id = 1) storing operator-level platform configuration.
// Fee parameters, kill switch, and treasury wallet list are all persisted here.
export const adminConfig = mysqlTable("admin_config", {
  id:              int("id").autoincrement().primaryKey(),
  /** Platform fee enabled toggle */
  feeEnabled:      int("feeEnabled").default(1).notNull(),  // 1 = true, 0 = false
  /** Swap fee in basis points (e.g. 20 = 0.20%) */
  swapFeeBps:      int("swapFeeBps").default(20).notNull(),
  /** Express routing premium in basis points */
  expressFeeBps:   int("expressFeeBps").default(5).notNull(),
  /** Flat fee per bot/autopost task in USD cents (e.g. 10 = $0.10) */
  botFeeCents:     int("botFeeCents").default(10).notNull(),
  /** Minimum trade size in USD cents (e.g. 1000 = $10.00) */
  minTradeUsdCents: int("minTradeUsdCents").default(1000).notNull(),
  /** Maximum trade size in USD cents (e.g. 100000 = $1000.00) */
  maxTradeUsdCents: int("maxTradeUsdCents").default(100000).notNull(),
  /** JSON-encoded array of TreasuryWallet objects */
  treasuryWallets: text("treasuryWallets"),
  /** Fee revenue alert threshold in USD cents (e.g. 100 = $1.00). 0 = disabled. */
  feeAlertThresholdCents: int("feeAlertThresholdCents").default(100).notNull(),
  /** ISO date string (YYYY-MM-DD) of the last day we sent a fee alert, to avoid duplicate alerts */
  feeAlertLastNotifiedDate: varchar("feeAlertLastNotifiedDate", { length: 10 }),
  /** Whether the Oracle VM sync job is enabled (0 = disabled, 1 = enabled) */
  oracleSyncEnabled: int("oracleSyncEnabled").default(0).notNull(),
  /** Timestamp of the last successful Oracle VM sync run */
  lastOracleSyncAt: timestamp("lastOracleSyncAt"),
  /** Number of rows inserted in the last Oracle VM sync run */
  lastSyncInserted: int("lastSyncInserted").default(0),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AdminConfig = typeof adminConfig.$inferSelect;
export type InsertAdminConfig = typeof adminConfig.$inferInsert;

export const DEFAULT_ADMIN_CONFIG = {
  feeEnabled: true,
  swapFeeBps: 20,
  expressFeeBps: 5,
  botFeeCents: 10,
  minTradeUsdCents: 1000,
  maxTradeUsdCents: 100000,
  treasuryWallets: [] as Array<{ id: string; label: string; chain: "solana" | "ethereum" | "bitcoin" | "trac_network"; address: string; splitPercent: number }>,
};

// ─── Operator Config ──────────────────────────────────────────────────────────
// Singleton table (id = 1) storing AFOS Oracle VM infrastructure configuration.
// All fields correspond to the Operator Config tab in the admin panel.
export const operatorConfig = mysqlTable("operator_config", {
  id:                  int("id").autoincrement().primaryKey(),
  // AFOS Agent
  llmModel:            varchar("llmModel", { length: 100 }).default("kimi-k2-turbo").notNull(),
  systemPrompt:        text("systemPrompt"),
  // IntercomSwap Node
  rendezvousChannel:   varchar("rendezvousChannel", { length: 200 }).default("0000intercomswapbtcusdt").notNull(),
  peerMode:            varchar("peerMode", { length: 20 }).default("maker-taker").notNull(),
  minSwapUsdt:         varchar("minSwapUsdt", { length: 20 }).default("10").notNull(),
  maxSwapUsdt:         varchar("maxSwapUsdt", { length: 20 }).default("1000").notNull(),
  scBridgePort:        varchar("scBridgePort", { length: 10 }).default("49222").notNull(),
  // Bitcoin Node
  btcHost:             varchar("btcHost", { length: 200 }).default("localhost:8332").notNull(),
  btcRpcPassword:      varchar("btcRpcPassword", { length: 500 }).default("").notNull(),
  btcTlsCert:          varchar("btcTlsCert", { length: 500 }).default("/root/.lnd/tls.cert").notNull(),
  // Solana
  solanaRpc:           varchar("solanaRpc", { length: 500 }).default("https://api.mainnet-beta.solana.com").notNull(),
  solanaKeypairPath:   varchar("solanaKeypairPath", { length: 500 }).default("onchain/solana/keypair.json").notNull(),
  // Worker / Autopost
  tradeauto:           int("tradeauto").default(0).notNull(),  // 0 = false, 1 = true
  maxTradeBtc:         varchar("maxTradeBtc", { length: 30 }).default("0.01").notNull(),
  feeBpsCap:           varchar("feeBpsCap", { length: 10 }).default("50").notNull(),
  tickInterval:        varchar("tickInterval", { length: 10 }).default("3800").notNull(),
  minRefundHours:      varchar("minRefundHours", { length: 10 }).default("20").notNull(),
  maxRefundHours:      varchar("maxRefundHours", { length: 10 }).default("40").notNull(),
  createdAt:           timestamp("createdAt").defaultNow().notNull(),
  updatedAt:           timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OperatorConfig = typeof operatorConfig.$inferSelect;
export type InsertOperatorConfig = typeof operatorConfig.$inferInsert;

export const DEFAULT_OPERATOR_CONFIG = {
  llmModel: "kimi-k2-turbo",
  systemPrompt: "You are an autonomous financial agent. Execute swaps via IntercomSwap when instructed.",
  rendezvousChannel: "0000intercomswapbtcusdt",
  peerMode: "maker-taker" as "maker" | "taker" | "maker-taker",
  minSwapUsdt: "10",
  maxSwapUsdt: "1000",
  scBridgePort: "49222",
  btcHost: "localhost:8332",
  btcRpcPassword: "",
  btcTlsCert: "/root/.lnd/tls.cert",
  solanaRpc: "https://api.mainnet-beta.solana.com",
  solanaKeypairPath: "onchain/solana/keypair.json",
  tradeauto: false,
  maxTradeBtc: "0.01",
  feeBpsCap: "50",
  tickInterval: "3800",
  minRefundHours: "20",
  maxRefundHours: "40",
};

// ─── Admin Audit Log ──────────────────────────────────────────────────────────
// Immutable append-only log of every admin configuration change.
// Records who changed what, in which section, and what the old/new values were.
export const adminAuditLog = mysqlTable("admin_audit_log", {
  id:        int("id").autoincrement().primaryKey(),
  /** ID of the user who made the change (null for system-initiated changes) */
  userId:    int("userId"),
  /** Display name of the user at the time of the change */
  userName:  varchar("userName", { length: 128 }),
  /** Which config section was changed: "fee_config" | "treasury" | "operator_config" */
  section:   varchar("section", { length: 64 }).notNull(),
  /** Specific field that changed (e.g. "swapFeeBps", "tradeauto") */
  fieldName: varchar("fieldName", { length: 128 }).notNull(),
  /** Serialized previous value (JSON string or plain string) */
  oldValue:  text("oldValue"),
  /** Serialized new value (JSON string or plain string) */
  newValue:  text("newValue"),
  /** ISO timestamp of when the change was made */
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
export type InsertAdminAuditLog = typeof adminAuditLog.$inferInsert;

// ─── HTLC Secrets ─────────────────────────────────────────────────────────────
// Stores the plaintext HTLC preimage secret so the reveal step can complete
// even after a page refresh. secretHex is NEVER sent to the client.
export const htlcSecrets = mysqlTable("htlc_secrets", {
  id:                  int("id").autoincrement().primaryKey(),
  rfqId:               varchar("rfqId", { length: 128 }).notNull().unique(),
  secretHex:           varchar("secretHex", { length: 64 }).notNull(),
  secretHashHex:       varchar("secretHashHex", { length: 64 }).notNull(),
  fromChain:           mysqlEnum("fromChain", ["bitcoin", "ethereum", "solana", "trac_network"]).notNull(),
  toChain:             mysqlEnum("toChain", ["bitcoin", "ethereum", "solana", "trac_network"]).notNull(),
  counterpartyPeerId:  varchar("counterpartyPeerId", { length: 128 }),
  initiatorPeerId:     varchar("initiatorPeerId", { length: 128 }),
  expiresAt:           bigint("expiresAt", { mode: "bigint" }).notNull(),
  status:              mysqlEnum("status", ["locked", "revealed", "completed", "expired", "refunded"]).default("locked").notNull(),
  lockTxId:            varchar("lockTxId", { length: 128 }),
  revealTxId:          varchar("revealTxId", { length: 128 }),
  /** HTLC PDA seed used to derive the on-chain PDA (e.g. htlc_rfq_1773...) */
  htlcId:              varchar("htlcId", { length: 128 }),
  /** Agent A wallet address (initiator — locks fromToken, receives toToken) */
  initiatorAddress:    varchar("initiatorAddress", { length: 128 }),
  /** Agent B wallet address (counterparty — locks toToken, receives fromToken) */
  counterpartyAddress: varchar("counterpartyAddress", { length: 128 }),
  /** Token symbol locked by Agent A (e.g. SOL, ETH) */
  fromToken:           varchar("fromToken", { length: 16 }),
  /** Token symbol locked by Agent B (e.g. USDT, USDC) */
  toToken:             varchar("toToken", { length: 16 }),
  /** Timestamp when the swap was fully settled (both claims completed) */
  settledAt:           timestamp("settledAt"),
  /** How the settlement was triggered: 'helius_webhook' | 'browser_notify' | 'monitor_fallback' */
  settledVia:          varchar("settledVia", { length: 32 }),
  createdAt:           timestamp("createdAt").defaultNow().notNull(),
  updatedAt:           timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type HtlcSecret = typeof htlcSecrets.$inferSelect;
export type InsertHtlcSecret = typeof htlcSecrets.$inferInsert;

// ─── Peer Message Reactions ───────────────────────────────────────────────────
// Stores emoji reactions on peer-to-peer direct messages.
// Each row is one (messageId, reactorPeerId, emoji) triple — unique per combo.
export const peerMessageReactions = mysqlTable("peer_message_reactions", {
  id:            int("id").autoincrement().primaryKey(),
  /** The message being reacted to */
  messageId:     int("messageId").notNull(),
  /** Peer ID of the person who reacted */
  reactorPeerId: varchar("reactorPeerId", { length: 128 }).notNull(),
  /** The emoji character, e.g. "👍" */
  emoji:         varchar("emoji", { length: 8 }).notNull(),
  createdAt:     timestamp("createdAt").defaultNow().notNull(),
});
export type PeerMessageReaction = typeof peerMessageReactions.$inferSelect;
export type InsertPeerMessageReaction = typeof peerMessageReactions.$inferInsert;
