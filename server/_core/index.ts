import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { sdk } from "./sdk";
import { createProxyMiddleware } from "http-proxy-middleware";
import { startHtlcMonitor } from "../htlcMonitor";
import { startTnkHtlcMonitor } from "../jobs/tnkHtlcMonitor";
import { startHtlcSecretsMonitor } from "../jobs/htlcSecretsMonitor";
import { attachSignalingServer, getSignalingPeerList, pingSignalingPeer } from "../signaling";

// Oracle VM backend URL — proxied server-side to avoid HTTPS→HTTP mixed-content block
const ORACLE_API = process.env.ORACLE_API_URL || "http://141.253.123.101:4000";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // Oracle VM API proxy — all /api/afos/* requests are forwarded to the Oracle VM backend
  // This avoids the browser mixed-content block (HTTPS frontend → HTTP Oracle VM)
  app.use(
    "/api/afos",
    createProxyMiddleware({
      target: ORACLE_API,
      changeOrigin: true,
      pathRewrite: { "^/api/afos": "" },
      on: {
        error: (err, _req, res) => {
          console.error("[AFOS Proxy] Error:", err.message);
          if (res && typeof (res as import('express').Response).status === 'function') {
            (res as import('express').Response).status(502).json({ error: "Oracle VM backend unavailable", detail: err.message });
          }
        },
      },
    })
  );

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // ── Signaling peer REST endpoints ─────────────────────────────────────────
  // MUST be registered BEFORE Vite middleware, otherwise Vite's catch-all
  // serves the SPA HTML instead of our JSON response.

  // Ping a specific signaling peer via WebSocket native ping/pong to measure RTT
  app.get("/api/signaling/peers/:peerId/ping", async (req, res) => {
    const peerId = decodeURIComponent(req.params.peerId);
    const peerList = getSignalingPeerList();
    const peer = peerList.find(p => p.peerId === peerId);
    if (!peer) {
      res.status(404).json({ error: "Peer not connected", online: false });
      return;
    }
    // Send a real WebSocket ping/pong to measure RTT
    const latencyMs = await pingSignalingPeer(peerId, 5000);
    if (latencyMs === null) {
      // Peer is in registry but didn't respond to ping — still report as online
      // with a fallback latency estimate from heartbeat age
      const ageMs = Date.now() - peer.lastHeartbeat;
      res.json({ latencyMs: Math.min(ageMs, 999), online: true, alias: peer.alias, estimated: true });
    } else {
      res.json({ latencyMs, online: true, alias: peer.alias });
    }
  });

  // Get the list of all signaling peers
  app.get("/api/signaling/peers", (_req, res) => {
    res.json({ peers: getSignalingPeerList() });
  });

  // ── /admin route guard ──────────────────────────────────────────────────────
  // Blocks any GET /admin* request before Vite/React loads.
  // Non-admin users receive a 403 HTML page — the React bundle is never served.
  app.use("/admin", async (req, res, next) => {
    // Only guard GET requests (the HTML shell). API calls under /api/trpc handle
    // their own auth via adminProcedure.
    if (req.method !== "GET") return next();

    try {
      const user = await sdk.authenticateRequest(req);
      if (user.role === "admin") {
        return next(); // Authenticated admin — let Vite/static serve the page
      }
      // Authenticated but not admin
      res.status(403).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>403 — Access Denied</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0a0a0f; color: #e2e8f0; font-family: system-ui, sans-serif;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.25);
            border-radius: 1rem; padding: 2.5rem 3rem; text-align: center; max-width: 420px; }
    .icon { font-size: 2.5rem; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; font-weight: 700; color: #f87171; margin-bottom: 0.5rem; }
    p  { font-size: 0.875rem; color: #94a3b8; line-height: 1.6; }
    a  { display: inline-block; margin-top: 1.5rem; padding: 0.6rem 1.5rem;
         background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3);
         border-radius: 0.75rem; color: #f87171; text-decoration: none;
         font-size: 0.8rem; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔒</div>
    <h1>Access Denied</h1>
    <p>You do not have permission to access the admin panel.<br/>Admin role required.</p>
    <a href="/">← Back to AFOS</a>
  </div>
</body>
</html>`);
    } catch {
      // Not authenticated at all
      res.status(403).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>403 — Sign In Required</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0a0a0f; color: #e2e8f0; font-family: system-ui, sans-serif;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: rgba(6,182,212,0.06); border: 1px solid rgba(6,182,212,0.2);
            border-radius: 1rem; padding: 2.5rem 3rem; text-align: center; max-width: 420px; }
    .icon { font-size: 2.5rem; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; font-weight: 700; color: #22d3ee; margin-bottom: 0.5rem; }
    p  { font-size: 0.875rem; color: #94a3b8; line-height: 1.6; }
    a  { display: inline-block; margin-top: 1.5rem; padding: 0.6rem 1.5rem;
         background: rgba(6,182,212,0.12); border: 1px solid rgba(6,182,212,0.3);
         border-radius: 0.75rem; color: #22d3ee; text-decoration: none;
         font-size: 0.8rem; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔐</div>
    <h1>Sign In Required</h1>
    <p>Please sign in with an admin account to access this page.</p>
    <a href="/">← Back to AFOS</a>
  </div>
</body>
</html>`);
    }
  });

  // ── Vite / Static serving ─────────────────────────────────────────────────
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  // Attach WebSocket signaling server for P2P peer discovery
  attachSignalingServer(server);

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // Start HTLC timeout monitor — watches pending HTLCs and auto-refunds on CLTV expiry
    startHtlcMonitor();
    // Start TNK HTLC escrow monitor — polls Trac Network explorer for incoming TNK locks
    startTnkHtlcMonitor();
    // Start HTLC secrets expiry monitor — marks expired locked secrets and notifies both parties
    startHtlcSecretsMonitor();
    // ── HTLC cleanup job ──────────────────────────────────────────────────────
    // Deletes htlc_secrets rows older than 7 days with terminal status (expired/refunded).
    // Runs once on startup (after a 30s warm-up) and then every 24 hours.
    const runCleanup = async () => {
      try {
        const { runHtlcCleanup } = await import("../jobs/htlcCleanup");
        const result = await runHtlcCleanup();
        if (result.deleted > 0) {
          console.log(`[HtlcCleanup] Deleted ${result.deleted} stale HTLC row(s) older than 7 days`);
        }
        if (result.error) {
          console.warn(`[HtlcCleanup] Cleanup skipped: ${result.error}`);
        }
      } catch (err) {
        console.error("[HtlcCleanup] Error running cleanup:", err);
      }
    };
    setTimeout(runCleanup, 30_000);                    // initial run after warm-up
    setInterval(runCleanup, 24 * 60 * 60 * 1_000);    // repeat every 24 hours
    // ── Hourly fee revenue alert ───────────────────────────────────────────────
    // Run once on startup (after a 10s warm-up delay), then every hour.
    // The job is idempotent — it only fires one notification per calendar day.
    const runFeeAlert = async () => {
      try {
        const { runFeeRevenueAlert } = await import("../jobs/feeRevenueAlert");
        const result = await runFeeRevenueAlert();
        if (result.alerted) {
          console.log(`[FeeAlert] Notification sent — $${result.totalFeeUsd.toFixed(2)} today (threshold $${result.thresholdUsd.toFixed(2)})`);
        }
      } catch (err) {
        console.error("[FeeAlert] Error running fee revenue alert:", err);
      }
    };
    setTimeout(runFeeAlert, 10_000);          // initial run after DB pool warms up
    setInterval(runFeeAlert, 60 * 60 * 1000); // repeat every hour

    // ── Oracle VM swap status sync ─────────────────────────────────────────────
    // Polls /api/swaps every 60s and back-fills swapAnalytics for completed
    // swaps that were never recorded locally (browser-initiated swaps, etc.).
    const runOracleSync = async () => {
      try {
        const { runOracleVmSync } = await import("../jobs/oracleVmSync");
        const result = await runOracleVmSync();
        if (result.inserted > 0 || result.backfilled > 0) {
          console.log(
            `[OracleVmSync] Inserted ${result.inserted} new row(s), back-filled ${result.backfilled} rfqId(s). ` +
            `Skipped ${result.skipped} duplicate(s).`
          );
        }
        if (result.error) {
          console.warn(`[OracleVmSync] Sync skipped: ${result.error}`);
        }
      } catch (err) {
        console.error("[OracleVmSync] Error running Oracle VM sync:", err);
      }
    };
    setTimeout(runOracleSync, 15_000);         // initial run 15s after startup
    setInterval(runOracleSync, 60_000);        // repeat every 60s

    // ── Auto-refund job ─────────────────────────────────────────────────────────────────────────────────
    // Scans SOL/ETH/BTC every 5 minutes for expired HTLCs.
    // Auto-refunds server-owned HTLCs; notifies owner about user-owned ones.
    const runAutoRefundJob = async () => {
      try {
        const { runAutoRefund } = await import("../jobs/autoRefund");
        const result = await runAutoRefund();
        if (result.autoRefunded > 0 || result.userNotified > 0) {
          console.log(
            `[AutoRefund] Scanned ${result.scanned} expired HTLCs. ` +
            `Auto-refunded: ${result.autoRefunded}, User-notified: ${result.userNotified}` +
            (result.errors.length > 0 ? `, Errors: ${result.errors.length}` : "")
          );
        }
      } catch (err) {
        console.error("[AutoRefund] Error running auto-refund job:", err);
      }
    };
    setTimeout(runAutoRefundJob, 60_000);              // initial run after 60s warm-up
    setInterval(runAutoRefundJob, 5 * 60_000);         // repeat every 5 minutes
  });
}

startServer().catch(console.error);
