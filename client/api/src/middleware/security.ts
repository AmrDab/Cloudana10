/**
 * Security policy shared by both runtimes (Cloudflare Worker and Node).
 *
 * Applied once in each entry point so the two never drift: which paths need a
 * JWT, and how hard each abuse-prone endpoint is rate limited.
 */
import type { Context, Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { requireAuth } from "./auth.js";
import { rateLimit } from "./rate-limit.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHono = Hono<any, any, any>;

export function applySecurity(app: AnyHono): void {
  // Sign-in: cheap to call, so cap tightly per IP.
  app.use("/v1/auth/*", rateLimit({ bucket: "auth", limit: 20, windowSec: 60 }));
  app.use("/v1/auth/logout", requireAuth);

  // Money and minting.
  app.use("/v1/payments/*", rateLimit({ bucket: "payments", limit: 60, windowSec: 60 }));

  // Verification is CPU-heavy on a sampled job (full re-execution of the matrix multiply, 1 in VERIFY_SAMPLE_K).

  // Outbound fetch to a caller-supplied host.
  app.use("/v1/providers/scan", rateLimit({ bucket: "scan", limit: 10, windowSec: 60 }));
  app.use("/v1/providers/scan", requireAuth);

  // Server-side pinning spends the project's Pinata quota.
  app.use("/v1/ipfs/*", rateLimit({ bucket: "ipfs", limit: 30, windowSec: 60 }));
  app.use("/v1/ipfs/*", requireAuth);

  // Default-deny: every path a router exposes is listed here, not just the prefix.
  app.use("/v1/deployments", requireAuth);
  // GET /v1/deployments/:id/route skips JWT: the hosting gateway authenticates with X-Internal-Key (route-level).
  const isPublicRoute = (c: Context) => c.req.method === "GET" && /^\/v1\/deployments\/[^/]+\/route$/.test(c.req.path);
  app.use("/v1/deployments/*", (c, next) => (isPublicRoute(c) ? next() : requireAuth(c, next)));
  // V3 hosted deployments (routes/v1/deployments.ts): create holds credits and stores up to ~2 MB.
  // Reads are polled by the console (list every 5 s + open rows); writes hold credits, so they stay tight.
  // The route lookup gets its own bucket: the gateway's requests all arrive from a few Cloudflare egress IPs,
  // which would exhaust the per-IP read bucket for every site at once.
  // Both are polled (gateway lookups, the console every 5 s): counted per isolate, not against the KV quota.
  const routeRead = rateLimit({ bucket: "deployments-route", limit: 3000, windowSec: 60, store: "memory" });
  const deployRead = rateLimit({ bucket: "deployments-read", limit: 300, windowSec: 60, store: "memory" });
  const deployWrite = rateLimit({ bucket: "deployments-write", limit: 30, windowSec: 60 });
  const deployLimit: MiddlewareHandler = (c, next) =>
    isPublicRoute(c) ? routeRead(c, next) : c.req.method === "GET" ? deployRead(c, next) : deployWrite(c, next);
  app.use("/v1/deployments", deployLimit);
  app.use("/v1/deployments/*", deployLimit);
  // Live logs reach the node through the relay: a bucket per deployment on top of the per-IP read bucket.
  app.on("GET", "/v1/deployments/:id/logs", rateLimit({ bucket: "deployments-logs", limit: 20, windowSec: 60, keyBy: (c) => c.req.path }));
  // ── v1 work pipeline ──────────────────────────────────────────────────────
  // Users (JWT).
  app.use("/v1/account", requireAuth);
  app.use("/v1/jobs", requireAuth);
  app.use("/v1/jobs/*", requireAuth);
  app.use("/v1/dev/credits", requireAuth);
  // Developer API keys: wallet session only (a key cannot mint or revoke keys — auth.ts scopeFor).
  app.use("/v1/keys", requireAuth);
  app.use("/v1/keys/*", requireAuth);
  app.on("POST", "/v1/keys", rateLimit({ bucket: "keys-create", limit: 20, windowSec: 3600 }));
  app.on("POST", "/v1/jobs", rateLimit({ bucket: "jobs-create", limit: 30, windowSec: 60 }));
  // Nodes heartbeat every 15 s and re-announce while unbound; submit re-executes a sampled job's transcript (CPU-heavy).
  // Before the signature check only a per-IP layer applies, sized for a datacenter NAT (hundreds of nodes behind
  // one address). Per-node limits key on the VERIFIED address and live on the routes after requireNode
  // (routes/v1/nodes.ts): keyed on the raw X-Node header they would let anyone 429 a victim node offline.
  // Per isolate: it runs on every heartbeat, and a shared counter would spend two KV operations on each.
  app.use("/v1/nodes/*", rateLimit({ bucket: "nodes", limit: 2000, windowSec: 60, store: "memory" }));
  // Bind: a wallet signature check per call; the bind code is guessable only by brute force, so keep it tight per IP.
  app.on("POST", "/v1/nodes/bind", rateLimit({ bucket: "nodes-bind", limit: 10, windowSec: 60 }));
  // Providers: the caller's own nodes and datacenter fleet tokens.
  app.use("/v1/nodes/mine", requireAuth);
  app.use("/v1/nodes/mine/*", requireAuth);
  app.use("/v1/fleets", requireAuth);
  app.use("/v1/fleets/*", requireAuth);
  app.on("POST", "/v1/fleets", rateLimit({ bucket: "fleets-create", limit: 10, windowSec: 3600 }));
  app.use("/v1/work/submit", rateLimit({ bucket: "work-submit", limit: 30, windowSec: 60 }));
  // Hosting status reports: one per deployment transition (plus re-reports on agent boot).
  app.use("/v1/nodes/deployments/*", rateLimit({ bucket: "node-deploy-status", limit: 120, windowSec: 60, store: "memory" }));
  // Browser verifiers (no login).
  // One check = one task + one verdict; 240/min allows a brisk browser without letting a script flood.
  app.use("/v1/verify/task", rateLimit({ bucket: "verify", limit: 240, windowSec: 60 }));
  app.use("/v1/verify/verdict", rateLimit({ bucket: "verify", limit: 240, windowSec: 60 }));

  // Waitlist (no login): a person signs up once; lookups back the "your position" view.
  app.on("POST", "/v1/waitlist", rateLimit({ bucket: "waitlist-join", limit: 5, windowSec: 60 }));
  app.on("GET", "/v1/waitlist/*", rateLimit({ bucket: "waitlist-read", limit: 60, windowSec: 60 }));
  // Public activity feed for the site.
  app.on("GET", "/v1/network/recent", rateLimit({ bucket: "network-read", limit: 60, windowSec: 60 }));
  // The stats answer is signed on every request: keep scripts from turning it into a signing oracle / CPU sink.
  app.on("GET", "/v1/network", rateLimit({ bucket: "network-stats", limit: 120, windowSec: 60 }));
  // Public per-epoch payloads and job lists (up to 500 rows a page), and public draw records.
  app.on("GET", "/v1/epochs/*", rateLimit({ bucket: "epochs-read", limit: 60, windowSec: 60 }));
  app.on("GET", "/v1/draws/*", rateLimit({ bucket: "draws-read", limit: 60, windowSec: 60 }));
}
