import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv } from "vite";

/**
 * Vite dev plugin: serves the Vercel-style functions in /api during `npm run dev`
 * so sign-up, checkout and the Stripe webhook can be exercised locally.
 * Each function exports Web-standard handlers (GET/POST taking a Request).
 */
export function devApi() {
  return {
    name: "paintmomo-dev-api",
    config(_config, { mode }) {
      // Expose the non-VITE_ secrets from .env files to the function handlers.
      const all = loadEnv(mode, process.cwd(), "");
      for (const [key, value] of Object.entries(all)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith("/api/")) return next();
        const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
        const route = url.pathname.replace(/^\/api\//, "").replace(/\/+$/, "");
        const file = resolve(process.cwd(), "api", `${route}.js`);
        if (!route || route.includes("..") || !existsSync(file)) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        try {
          const mod = await server.ssrLoadModule(`/api/${route}.js`);
          const method = (req.method || "GET").toUpperCase();
          const handler =
            mod[method] ??
            (method === "HEAD" ? mod.GET : undefined) ??
            (mod.default && typeof mod.default.fetch === "function"
              ? mod.default.fetch.bind(mod.default)
              : undefined);
          if (!handler) {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          const chunks = [];
          if (method !== "GET" && method !== "HEAD") {
            for await (const chunk of req) chunks.push(chunk);
          }
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
            else if (value !== undefined) headers.set(key, value);
          }
          const request = new Request(url, {
            method,
            headers,
            body: chunks.length ? Buffer.concat(chunks) : undefined,
          });
          const response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          console.error(`[dev-api] ${req.method} ${req.url} failed:`, err);
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ code: "server_error", error: String(err?.message || err) }));
        }
      });
    },
  };
}
