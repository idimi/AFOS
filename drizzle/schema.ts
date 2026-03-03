import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

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
  /** Chain where the HTLC was locked: bitcoin | ethereum | solana */
  chain:          mysqlEnum("chain", ["bitcoin", "ethereum", "solana"]).notNull(),
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
  toChain:        mysqlEnum("toChain", ["bitcoin", "ethereum", "solana"]),
  /** Refund transaction ID (set when status = refunded) */
  refundTxId:     varchar("refundTxId", { length: 128 }),
  /** User's wallet address (sender) */
  senderAddress:  varchar("senderAddress", { length: 128 }),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
  updatedAt:      timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  refundedAt:     timestamp("refundedAt"),
});

export type HtlcSwap = typeof htlcSwaps.$inferSelect;
export type InsertHtlcSwap = typeof htlcSwaps.$inferInsert;

// ─── Swap Analytics ───────────────────────────────────────────────────────────
// Records every completed/failed swap for the analytics dashboard.
// Populated by all three chain execution procedures after settlement.
export const swapAnalytics = mysqlTable("swap_analytics", {
  id:             int("id").autoincrement().primaryKey(),
  /** Source chain */
  fromChain:      mysqlEnum("fromChain", ["bitcoin", "ethereum", "solana"]).notNull(),
  /** Destination chain */
  toChain:        mysqlEnum("toChain", ["bitcoin", "ethereum", "solana"]).notNull(),
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
});

export type PeerReputation = typeof peerReputation.$inferSelect;
export type InsertPeerReputation = typeof peerReputation.$inferInsert;
