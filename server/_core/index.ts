import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { createProxyMiddleware } from "http-proxy-middleware";
import { startHtlcMonitor } from "../htlcMonitor";
import { attachSignalingServer } from "../signaling";

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

  // ── Signaling peer ping endpoint ─────────────────────────────────────────
  // Used by the frontend Ping button for light peers (signaling-only)
  // Sends a real WebSocket ping/pong to measure RTT
  app.get("/api/signaling/peers/:peerId/ping", async (req, res) => {
    const { getSignalingPeerList, pingSignalingPeer } = await import("../signaling");
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

  // ── Signaling peer list endpoint ──────────────────────────────────────────
  app.get("/api/signaling/peers", async (_req, res) => {
    const { getSignalingPeerList } = await import("../signaling");
    res.json({ peers: getSignalingPeerList() });
  });

  // Attach WebSocket signaling server for P2P peer discovery
  attachSignalingServer(server);

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // Start HTLC timeout monitor — watches pending HTLCs and auto-refunds on CLTV expiry
    startHtlcMonitor();
  });
}

startServer().catch(console.error);
