/**
 * POST /v1/deploy   — Deploy a workload manifest, routing to Akash or a Cloudana provider node.
 * GET  /v1/deployments/:id — Get deployment status.
 * DELETE /v1/deployments/:id — Close/terminate a deployment.
 *
 * Routing logic:
 *   provider = "akash" | undefined → deploy to Akash network (via AKASH_MNEMONIC wallet)
 *   providerEndpoint = "https://..." → deploy directly to that Cloudana provider node
 */

import { Hono } from "hono";
import {
  createAkashDeployment,
  getAkashDeployment,
  listAkashDeployments,
  refreshAkashDeploymentStatus,
  closeAkashDeployment,
} from "../../services/akash.service.js";
import { log } from "../../lib/logger.js";

const L = log.orchestratorEvent;

export const deployRouter = new Hono();

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/deploy
// Body:
//   {
//     manifest: string | object,   // SDL YAML or JSON workload manifest
//     provider?: "akash" | string, // "akash" = Akash network, otherwise ignored for routing
//     providerEndpoint?: string,   // If set, deploy directly to this Cloudana provider URL
//     name?: string,               // Optional human-readable name
//   }
// ─────────────────────────────────────────────────────────────────────────────
deployRouter.post("/deploy", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ status: "error", error: "Invalid JSON body" }, 400);
  }

  const { manifest, provider, providerEndpoint, name } = body as {
    manifest?: string | Record<string, unknown>;
    provider?: string;
    providerEndpoint?: string;
    name?: string;
  };

  if (!manifest) {
    return c.json({ status: "error", error: "'manifest' field is required" }, 400);
  }

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
        return c.json(
          { status: "error", error: `Provider returned ${res.status}`, detail: data },
          502
        );
      }

      return c.json({
        status: "success",
        provider: "cloudana",
        providerEndpoint,
        workloadId,
        instanceId,
        result: data,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      L.error(`[Deploy] Cloudana provider error: ${msg}`);
      return c.json({ status: "error", error: `Provider unreachable: ${msg}` }, 502);
    }
  }

  // ── Route: Akash network (default) ────────────────────────────────────────
  if (!provider || provider === "akash") {
    L.info("[Deploy] Routing to Akash network");

    if (!process.env.AKASH_MNEMONIC) {
      return c.json(
        {
          status: "error",
          error: "AKASH_MNEMONIC is not configured. Set it in the orchestrator .env to enable Akash deployments.",
        },
        503
      );
    }

    try {
      const deployment = await createAkashDeployment({ sdl, name });
      return c.json({
        status: "success",
        provider: "akash",
        deploymentId: deployment.id,
        dseq: deployment.dseq,
        owner: deployment.owner,
        network: process.env.AKASH_NETWORK ?? "mainnet",
        message: "Deployment initiated. Poll GET /v1/deployments/:id for status.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      L.error(`[Deploy] Akash deployment error: ${msg}`);
      return c.json({ status: "error", error: msg }, 500);
    }
  }

  return c.json(
    { status: "error", error: `Unknown provider '${provider}'. Use 'akash' or supply providerEndpoint.` },
    400
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/deployments
// ─────────────────────────────────────────────────────────────────────────────
deployRouter.get("/deployments", async (c) => {
  const deployments = listAkashDeployments();
  return c.json({ status: "success", deployments });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/deployments/:id
// ─────────────────────────────────────────────────────────────────────────────
deployRouter.get("/deployments/:id", async (c) => {
  const id = c.req.param("id");

  // Try refreshing from chain for Akash deployments
  let deployment = await refreshAkashDeploymentStatus(id).catch(() => getAkashDeployment(id));

  if (!deployment) {
    return c.json({ status: "error", error: "Deployment not found" }, 404);
  }

  return c.json({ status: "success", deployment });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /v1/deployments/:id  — close / terminate deployment
// ─────────────────────────────────────────────────────────────────────────────
deployRouter.delete("/deployments/:id", async (c) => {
  const id = c.req.param("id");

  const deployment = getAkashDeployment(id);
  if (!deployment) {
    return c.json({ status: "error", error: "Deployment not found" }, 404);
  }

  try {
    await closeAkashDeployment(id);
    return c.json({ status: "success", message: `Deployment ${id} closed` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ status: "error", error: msg }, 500);
  }
});
