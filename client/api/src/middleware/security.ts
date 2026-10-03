/**
 * Security policy shared by both runtimes (Cloudflare Worker and Node).
 *
 * Applied once in each entry point so the two never drift: which paths need a
 * JWT, and how hard each abuse-prone endpoint is rate limited.
 */
import type { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { requireAuth } from "./auth.js";
import { rateLimit } from "./rate-limit.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHono = Hono<any, any, any>;

export function applySecurity(app: AnyHono): void {
  // Sign-in: cheap to call, so cap tightly per IP.
  app.use("/v1/auth/*", rateLimit({ bucket: "auth", limit: 20, windowSec: 60 }));

  // Money and minting.
  app.use("/v1/payments/*", rateLimit({ bucket: "payments", limit: 60, windowSec: 60 }));
  app.use("/v1/faucet/claim", rateLimit({ bucket: "faucet", limit: 10, windowSec: 3600 }));

  // Verification is CPU-heavy (full re-execution of the matrix multiply).
  app.use("/v1/pouw/submit", rateLimit({ bucket: "pouw-submit", limit: 60, windowSec: 60 }));

  // Outbound fetch to a caller-supplied host.
  app.use("/v1/providers/scan", rateLimit({ bucket: "scan", limit: 10, windowSec: 60 }));
  app.use("/v1/providers/scan", requireAuth);

  // Server-side pinning spends the project's Pinata quota.
  app.use("/v1/ipfs/*", rateLimit({ bucket: "ipfs", limit: 30, windowSec: 60 }));
  app.use("/v1/ipfs/*", requireAuth);

  // Orchestrator-only surfaces (mounted on Node; harmless to declare on both).
  // Default-deny: every path a router exposes is listed here, not just the prefix.
  app.use("/v1/build-provider", requireAuth);
  app.use("/v1/build-provider/*", requireAuth);
  app.use("/v1/build-provider-status/*", requireAuth);
  app.use("/v1/update-provider-attributes", requireAuth);
  app.use("/v1/orchestration/*", requireAuth);
  app.use("/v1/deploy", requireAuth);
  app.use("/v1/deploy/*", requireAuth);
  app.use("/v1/deployments", requireAuth);
  app.use("/v1/deployments/*", requireAuth);
  // V3 hosted deployments (routes/v1/deployments.ts): create holds credits and stores up to ~2 MB.
  // Reads are polled by the console (list every 5 s + open rows); writes hold credits, so they stay tight.
  const deployRead = rateLimit({ bucket: "deployments-read", limit: 300, windowSec: 60 });
  const deployWrite = rateLimit({ bucket: "deployments-write", limit: 30, windowSec: 60 });
  const deployLimit: MiddlewareHandler = (c, next) => (c.req.method === "GET" ? deployRead(c, next) : deployWrite(c, next));
  app.use("/v1/deployments", deployLimit);
  app.use("/v1/deployments/*", deployLimit);
  // Node-only provider verification router (routes/v1/verify.ts). Listed per
  // path so the public browser-verifier feed (/v1/verify/task, /verdict) stays open.
  app.use("/v1/verify/control-machine", requireAuth);
  app.use("/v1/verify/control-and-worker", requireAuth);
  app.use("/v1/verify/open-ports", requireAuth);
  app.use("/v1/verify/dns", requireAuth);

  // ── v1 work pipeline ──────────────────────────────────────────────────────
  // Users (JWT).
  app.use("/v1/account", requireAuth);
  app.use("/v1/jobs", requireAuth);
  app.use("/v1/jobs/*", requireAuth);
  app.use("/v1/dev/credits", requireAuth);
  app.on("POST", "/v1/jobs", rateLimit({ bucket: "jobs-create", limit: 30, windowSec: 60 }));
  // Nodes heartbeat every few seconds; submit re-executes the transcript (CPU-heavy).
  app.use("/v1/nodes/*", rateLimit({ bucket: "nodes", limit: 120, windowSec: 60 }));
  // Providers: the caller's own nodes and datacenter fleet tokens.
  app.use("/v1/nodes/mine", requireAuth);
  app.use("/v1/fleets", requireAuth);
  app.use("/v1/fleets/*", requireAuth);
  app.on("POST", "/v1/fleets", rateLimit({ bucket: "fleets-create", limit: 10, windowSec: 3600 }));
  app.use("/v1/work/submit", rateLimit({ bucket: "work-submit", limit: 30, windowSec: 60 }));
  // Hosting status reports: one per deployment transition (plus re-reports on agent boot).
  app.use("/v1/nodes/deployments/*", rateLimit({ bucket: "node-deploy-status", limit: 120, windowSec: 60 }));
  // Browser verifiers (no login).
  // One check = one task + one verdict; 240/min allows a brisk browser without letting a script flood.
  app.use("/v1/verify/task", rateLimit({ bucket: "verify", limit: 240, windowSec: 60 }));
  app.use("/v1/verify/verdict", rateLimit({ bucket: "verify", limit: 240, windowSec: 60 }));

  // Waitlist (no login): a person signs up once; lookups back the "your position" view.
  app.on("POST", "/v1/waitlist", rateLimit({ bucket: "waitlist-join", limit: 5, windowSec: 60 }));
  app.on("GET", "/v1/waitlist/*", rateLimit({ bucket: "waitlist-read", limit: 60, windowSec: 60 }));
  // Public activity feed for the site.
  app.on("GET", "/v1/network/recent", rateLimit({ bucket: "network-read", limit: 60, windowSec: 60 }));
}
