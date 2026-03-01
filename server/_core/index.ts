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

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
