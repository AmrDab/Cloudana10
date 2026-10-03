/**
 * The Cloudana API, independent of where it runs.
 *
 * Both entry points build their app here so middleware order, security policy,
 * the shared routers and the OpenAPI document cannot drift between the
 * Cloudflare Worker (api.cloudana.io) and the Node orchestrator. Each entry
 * point then adds only what is specific to its runtime.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";
import { applySecurity } from "./middleware/security.js";
import { requestLog, type RequestLogVariables } from "./middleware/request-log.js";
import type { AuthVariables } from "./middleware/auth.js";
import { authRouter } from "./routes/v1/auth.js";
import { templatesRouter } from "./routes/v1/templates.js";
import { pouwRouter } from "./routes/v1/pouw.js";
import { hardwareScanRouter } from "./routes/v1/hardware-scan.js";
import { paymentsRouter } from "./routes/v1/payments.js";
import { faucetRouter } from "./routes/v1/faucet.js";
import { ipfsRouter } from "./routes/v1/ipfs.js";
import { devRouter } from "./routes/v1/dev.js";
import { accountRouter } from "./routes/v1/account.js";
import { jobsRouter } from "./routes/v1/jobs.js";
import { nodesRouter } from "./routes/v1/nodes.js";
import { workRouter } from "./routes/v1/work.js";
import { ledgerRouter } from "./routes/v1/ledger.js";
import { verifyFeedRouter } from "./routes/v1/verify-feed.js";
import { adminEpochsRouter } from "./routes/v1/admin-epochs.js";
import { networkRouter } from "./routes/v1/network.js";
import { waitlistRouter } from "./routes/v1/waitlist.js";
import { fleetsRouter } from "./routes/v1/fleets.js";
import { deploymentsRouter } from "./routes/v1/deployments.js";
import { nodesDeploymentsRouter } from "./routes/v1/nodes-deployments.js";
import { adminTemplatesRouter } from "./routes/v1/admin-templates.js";
import { ensureSchema } from "./lib/schema.js";

export const API_VERSION = "1.1.0";

export type AppEnv<B extends object = Record<string, unknown>> = {
  Bindings: B;
  Variables: AuthVariables & RequestLogVariables;
};

export interface BuildAppOptions<B extends object> {
  /** Human-readable runtime name reported by /health. */
  runtime: "cloudflare-workers" | "node";
  /** Middleware that must run before anything else (e.g. binding bridges). */
  pre?: MiddlewareHandler<AppEnv<B>>[];
  /** Extra dependency probes for /health. Return "connected" or an error string. */
  checks?: () => Promise<Record<string, string>>;
}

export function buildApp<B extends object = Record<string, unknown>>(opts: BuildAppOptions<B>) {
  const app = new OpenAPIHono<AppEnv<B>>();

  for (const mw of opts.pre ?? []) app.use("*", mw);
  app.use("*", requestLog);
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "stripe-signature",
        "X-Node",
        "X-Node-Timestamp",
        "X-Node-Signature",
        "X-Internal-Key",
      ],
      exposeHeaders: ["X-Request-Id", "X-RateLimit-Limit", "X-RateLimit-Remaining", "Retry-After"],
    }),
  );
  applySecurity(app);

  // v1 work-pipeline tables + µCLD balance columns, once per isolate. A failure
  // is logged by ensureSchema and retried on the next request.
  app.use("/v1/*", async (_c, next) => {
    await ensureSchema().catch(() => undefined);
    await next();
  });

  app.openAPIRegistry.registerComponent("securitySchemes", "BearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "Obtain via GET /v1/auth/nonce then POST /v1/auth/login.",
  });

  app.get("/health", async (c) => {
    const services = opts.checks ? await opts.checks() : {};
    const degraded = Object.values(services).some((v) => v !== "connected");
    return c.json(
      {
        status: degraded ? "degraded" : "ok",
        version: API_VERSION,
        runtime: opts.runtime,
        timestamp: new Date().toISOString(),
        services,
      },
      degraded ? 503 : 200,
    );
  });

  // Routers available on every runtime.
  app.route("/v1", authRouter);
  app.route("/v1", templatesRouter);
  app.route("/v1", pouwRouter);
  app.route("/v1", hardwareScanRouter);
  app.route("/v1", paymentsRouter);
  app.route("/v1", faucetRouter);
  app.route("/v1", ipfsRouter);
  // v1 work pipeline (docs/BUILD_SPEC_V1.md §5)
  app.route("/v1", devRouter);
  app.route("/v1", accountRouter);
  app.route("/v1", jobsRouter);
  app.route("/v1", nodesRouter);
  app.route("/v1", workRouter);
  app.route("/v1", ledgerRouter);
  app.route("/v1", verifyFeedRouter);
  app.route("/v1", adminEpochsRouter);
  app.route("/v1", networkRouter);
  app.route("/v1", waitlistRouter);
  app.route("/v1", fleetsRouter);
  // V3 hosting (docs/V3_CONTRACT.md §4). Registered before the Node-only legacy Akash deployRouter,
  // so these answer /v1/deployments and /v1/deployments/{id} on both runtimes.
  app.route("/v1", deploymentsRouter);
  app.route("/v1", nodesDeploymentsRouter);
  app.route("/v1", adminTemplatesRouter);

  app.get("/v1/doc", (c) =>
    c.json(
      app.getOpenAPIDocument({
        openapi: "3.0.0",
        info: {
          title: "Cloudana API",
          version: API_VERSION,
          description:
            "Decentralized compute with Proof of Useful Work. Wallet sign-in issues a JWT; " +
            "all responses use `{status:\"success\",…}` or `{status:\"error\",error:{code,message}}`.",
        },
        servers: [{ url: new URL(c.req.url).origin, description: opts.runtime }],
      }),
    ),
  );
  app.get("/v1/swagger", swaggerUI({ url: "/v1/doc" }));

  return app;
}
