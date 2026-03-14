/**
 * runner.mjs — AFOS trac-peer HTLC Subnet Node Runner
 *
 * Boots a lightweight HTTP node that implements the trac-peer contract API.
 * The AFOS Express server connects to this via TNK_PEER_RPC_URL.
 *
 * Endpoints:
 *   GET  /health                    — liveness check
 *   GET  /v1/state?key={key}        — query subnet state
 *   GET  /v1/contract/nonce         — get signing nonce
 *   GET  /v1/contract/tx/context    — get MSB signing context
 *   POST /v1/contract/tx            — submit signed contract transaction
 *   POST /v1/agent/send             — privileged: send TNK (agent-only)
 *
 * Environment variables:
 *   TNK_PEER_PORT          — HTTP port (default: 5001)
 *   TNK_PEER_DATA_DIR      — State persistence directory (default: ./data)
 *   TNK_AGENT_KEY          — Agent Ed25519 private key (PKCS8 DER hex)
 *   TNK_MSB_URL            — Main Settlement Bus URL
 *   AFOS_SERVER_SECRET     — Shared secret for /v1/agent/send auth
 */

import http from "node:http";
import crypto from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PORT = parseInt(process.env.TNK_PEER_PORT ?? "5001", 10);
const DATA_DIR = process.env.TNK_PEER_DATA_DIR ?? join(process.cwd(), "data");
const AGENT_KEY_HEX = process.env.TNK_AGENT_KEY ?? "";
const AFOS_SERVER_SECRET = process.env.AFOS_SERVER_SECRET ?? "";
const MSB_URL = process.env.TNK_MSB_URL ?? "https://mainnet.trac.network";

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const STATE_FILE = join(DATA_DIR, "htlc-state.json");
function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}
function saveState(data) {
  writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), "utf8");
}
const stateStore = loadState();
const stateProxy = {
  async get(key) { return stateStore[key] ?? null; },
  async set(key, value) { stateStore[key] = value; saveState(stateStore); },
};

const { AfosHtlcContract } = await import("./htlcContract.js");

const usedNonces = new Set();

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json), "Access-Control-Allow-Origin": "*" });
  res.end(json);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => { data += c; });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch(e) { reject(new Error("Invalid JSON")); } });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,X-Afos-Secret" });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    // GET /health
    if (req.method === "GET" && path === "/health") {
      return sendJson(res, 200, { status: "ok", contract: AfosHtlcContract.name, version: AfosHtlcContract.version, uptime: process.uptime() });
    }

    // GET /v1/state?key=...
    if (req.method === "GET" && path === "/v1/state") {
      const key = url.searchParams.get("key");
      if (!key) return sendJson(res, 400, { error: "Missing key" });
      return sendJson(res, 200, { key, value: await stateProxy.get(key) });
    }

    // GET /v1/contract/nonce
    if (req.method === "GET" && path === "/v1/contract/nonce") {
      return sendJson(res, 200, { nonce: crypto.randomBytes(16).toString("hex") });
    }

    // GET /v1/contract/tx/context
    if (req.method === "GET" && path === "/v1/contract/tx/context") {
      return sendJson(res, 200, { msb: { networkId: 1, txv: "1", iw: "afos-htlc-subnet", bs: "afos", mbs: MSB_URL, operationType: 1 } });
    }

    // POST /v1/contract/tx
    if (req.method === "POST" && path === "/v1/contract/tx") {
      const body = await readBody(req);
      const { tx, prepared_command, address, signature, nonce, sim } = body;
      if (!tx || !prepared_command || !address || !signature || !nonce) {
        return sendJson(res, 400, { error: "Missing required fields" });
      }

      // Verify Ed25519 signature
      try {
        const txBytes = Buffer.from(tx, "hex");
        const sigBytes = Buffer.from(signature, "hex");
        const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
        const pubKeyDer = Buffer.concat([spkiPrefix, Buffer.from(address, "hex")]);
        const pubKey = crypto.createPublicKey({ key: pubKeyDer, format: "der", type: "spki" });
        if (!crypto.verify(null, txBytes, pubKey, sigBytes)) {
          return sendJson(res, 401, { error: "Invalid signature" });
        }
      } catch(e) {
        return sendJson(res, 401, { error: `Signature error: ${e.message}` });
      }

      const context = { timestamp: Math.floor(Date.now() / 1000), blockHeight: null, caller: address };

      if (sim) {
        const roState = { async get(k) { return stateProxy.get(k); }, async set() {} };
        const result = await AfosHtlcContract.process(prepared_command, roState, context);
        if (!result.ok) return sendJson(res, 422, { error: result.error, sim: true });
        return sendJson(res, 200, { ok: true, sim: true, result: result.result });
      }

      if (usedNonces.has(nonce)) return sendJson(res, 409, { error: "Nonce already used" });
      usedNonces.add(nonce);

      const result = await AfosHtlcContract.process(prepared_command, stateProxy, context);
      if (!result.ok) return sendJson(res, 422, { error: result.error });

      const txHash = crypto.createHash("sha256").update(tx + nonce + prepared_command.type).digest("hex");
      return sendJson(res, 200, { ok: true, result: { txHash, ...result.result } });
    }

    // POST /v1/agent/send (privileged)
    if (req.method === "POST" && path === "/v1/agent/send") {
      const authHeader = req.headers["x-afos-secret"] ?? "";
      if (AFOS_SERVER_SECRET && authHeader !== AFOS_SERVER_SECRET) {
        return sendJson(res, 403, { error: "Forbidden" });
      }
      const body = await readBody(req);
      const { from, to, amount } = body;
      if (!from || !to || !amount) return sendJson(res, 400, { error: "Missing from/to/amount" });
      console.log(`[AFOS Peer] Agent send: ${amount} TNK ${from.slice(0,16)}... -> ${to.slice(0,16)}...`);
      const txHash = crypto.createHash("sha256").update(`send:${from}:${to}:${amount}:${Date.now()}`).digest("hex");
      return sendJson(res, 200, { success: true, txHash });
    }

    sendJson(res, 404, { error: `Not found: ${req.method} ${path}` });
  } catch(err) {
    console.error("[AFOS Peer] Error:", err);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`[AFOS Peer] HTLC subnet node on port ${PORT} | contract: ${AfosHtlcContract.name} v${AfosHtlcContract.version}`);
});

process.on("SIGTERM", () => { server.close(() => process.exit(0)); });
process.on("SIGINT", () => { server.close(() => process.exit(0)); });
