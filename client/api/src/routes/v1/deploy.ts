/**
 * POST /v1/deploy   — Deploy a workload manifest, routing to Akash or a Cloudana provider node.
 * GET  /v1/deployments/:id — Get deployment status.
 * DELETE /v1/deployments/:id — Close/terminate a deployment.
 *
 * Routing logic:
 *   provider = "akash" | undefined → deploy to Akash network (via AKASH_MNEMONIC wallet)
 *   providerEndpoint = "https://..." → deploy directly to that Cloudana provider node
 */

import { createRoute } from "@hono/zod-openapi";
import {
  createAkashDeployment,
  getAkashDeployment,
  listAkashDeployments,
  refreshAkashDeploymentStatus,
  closeAkashDeployment,
} from "../../services/akash.service.js";
import { log } from "../../lib/logger.js";
import { ok, fail, errorMessage } from "../../lib/http.js";
import {
  CloseDeploymentResponseSchema,
  DeploymentIdParamsSchema,
  DeploymentResponseSchema,
  DeploymentsResponseSchema,
  DeployRequestSchema,
  DeployResponseSchema,
} from "../../schemas/deploy.schema.js";
import { BEARER_AUTH, createRouter, json, responses } from "./_openapi.js";

const L = log.orchestratorEvent;
const TAGS = ["Deploy"];

export const deployRouter = createRouter();

// requireAuth is applied to /v1/deploy/* in middleware/security.ts; the
// /v1/deployments routes fall outside that pattern and are documented without security.

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/deploy
// ─────────────────────────────────────────────────────────────────────────────
const deployRoute = createRoute({
  method: "post",
  path: "/deploy",
  tags: TAGS,
  security: BEARER_AUTH,
  request: { body: { required: true, content: { "application/json": { schema: DeployRequestSchema } } } },
  responses: responses({ 200: json(DeployResponseSchema, "Deployment started") }, 400, 401, 500, 502, 503),
});

deployRouter.openapi(deployRoute, async (c) => {
  const { manifest, provider, providerEndpoint, name } = c.req.valid("json");

  // Normalise manifest to SDL string
  const sdl: string =
    typeof manifest === "string"
      ? manifest
      : JSON.stringify(manifest, null, 2);

  // ── Route: explicit Cloudana provider endpoint ────────────────────────────
  if (providerEndpoint && provider !== "akash") {
    L.info(`[Deploy] Routing to Cloudana provider: ${providerEndpoint}`);

    const deployUrl = `${providerEndpoint.replace(/\/+$/, "")}/deploy`;
    const instanceId = `cli-${Date.now()}`;
    const workloadId = `w-${Date.now()}`;

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
      const res = await fetch(deployUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workloadId, instanceId, manifest: { name, sdl, raw: sdl } }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      const data = (await res.json()) as Record<string, unknown>;

      if (!res.ok) {
        return fail(c, "upstream_failed", `Provider returned ${res.status}`, data);
      }

      return ok(c, {
        provider: "cloudana",
        providerEndpoint,
        workloadId,
        instanceId,
        result: data,
      });
    } catch (err) {
      const msg = errorMessage(err);
      L.error(`[Deploy] Cloudana provider error: ${msg}`);
      return fail(c, "upstream_failed", `Provider unreachable: ${msg}`);
    }
  }

  // ── Route: Akash network (default) ────────────────────────────────────────
  if (!provider || provider === "akash") {
    L.info("[Deploy] Routing to Akash network");

    if (!process.env.AKASH_MNEMONIC) {
      return fail(
        c,
        "not_configured",
        "AKASH_MNEMONIC is not configured. Set it in the orchestrator .env to enable Akash deployments.",
      );
    }

    try {
      const deployment = await createAkashDeployment({ sdl, name });
      return ok(c, {
        provider: "akash",
        deploymentId: deployment.id,
        dseq: deployment.dseq,
        owner: deployment.owner,
        network: process.env.AKASH_NETWORK ?? "mainnet",
        message: "Deployment initiated. Poll GET /v1/deployments/:id for status.",
      });
    } catch (err) {
      const msg = errorMessage(err);
      L.error(`[Deploy] Akash deployment error: ${msg}`);
      return fail(c, "internal", msg);
    }
  }

  return fail(c, "bad_request", `Unknown provider '${provider}'. Use 'akash' or supply providerEndpoint.`);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/deployments
// ─────────────────────────────────────────────────────────────────────────────
const listDeploymentsRoute = createRoute({
  method: "get",
  path: "/deployments",
  tags: TAGS,
  responses: responses({ 200: json(DeploymentsResponseSchema, "Known Akash deployments") }, 500),
});

deployRouter.openapi(listDeploymentsRoute, async (c) => {
  const deployments = listAkashDeployments();
  return ok(c, { deployments });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/deployments/:id
// ─────────────────────────────────────────────────────────────────────────────
const getDeploymentRoute = createRoute({
  method: "get",
  path: "/deployments/{id}",
  tags: TAGS,
  request: { params: DeploymentIdParamsSchema },
  responses: responses({ 200: json(DeploymentResponseSchema, "Deployment status") }, 404),
});

deployRouter.openapi(getDeploymentRoute, async (c) => {
  const { id } = c.req.valid("param");

  // Try refreshing from chain for Akash deployments
  let deployment = await refreshAkashDeploymentStatus(id).catch(() => getAkashDeployment(id));

  if (!deployment) {
    return fail(c, "not_found", "Deployment not found");
  }

  return ok(c, { deployment });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /v1/deployments/:id  — close / terminate deployment
// ─────────────────────────────────────────────────────────────────────────────
const closeDeploymentRoute = createRoute({
  method: "delete",
  path: "/deployments/{id}",
  tags: TAGS,
  request: { params: DeploymentIdParamsSchema },
  responses: responses({ 200: json(CloseDeploymentResponseSchema, "Deployment closed") }, 404, 500),
});

deployRouter.openapi(closeDeploymentRoute, async (c) => {
  const { id } = c.req.valid("param");

  const deployment = getAkashDeployment(id);
  if (!deployment) {
    return fail(c, "not_found", "Deployment not found");
  }

  try {
    await closeAkashDeployment(id);
    return ok(c, { message: `Deployment ${id} closed` });
  } catch (err) {
    return fail(c, "internal", errorMessage(err));
  }
});
