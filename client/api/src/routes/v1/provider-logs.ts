/**
 * Provider Logs API Routes
 * Allows provider owners to view logs and diagnostics from their provider nodes.
 * Requires wallet signature verification for authentication.
 */
import { createRoute } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import type { Address } from "viem";
import { ok, fail } from "../../lib/http.js";
import {
  fetchProviderLogs,
  fetchProviderDiagnostics,
  fetchProviderHealth,
  verifyProviderOwnership,
} from "../../services/provider-logs.service.js";
import {
  OwnerHeaderSchema,
  OwnerQuerySchema,
  ProviderAddressParamsSchema,
  ProviderDiagnosticsResponseSchema,
  ProviderHealthResponseSchema,
  ProviderLogsQuerySchema,
  ProviderLogsResponseSchema,
} from "../../schemas/provider-logs.schema.js";
import { createRouter, json, responses } from "./_openapi.js";

const providerLogsRouter = createRouter();
providerLogsRouter.use("*", cors({ origin: "*" }));

const TAGS = ["Provider Logs"];
const OWNER_REQUIRED = "Owner address required. Provide via ?owner=0x... or X-Owner-Address header";
const NOT_OWNER = "Unauthorized: You are not the owner of this provider";

/**
 * Middleware to extract and verify owner address from request.
 * In production, this should verify a wallet signature.
 * For MVP, we accept address from query/header.
 */
function extractOwnerAddress(c: any): Address | null {
  // Try query param first
  const queryAddress = c.req.query("owner");
  if (queryAddress && /^0x[a-fA-F0-9]{40}$/.test(queryAddress)) {
    return queryAddress as Address;
  }

  // Try header
  const headerAddress = c.req.header("X-Owner-Address");
  if (headerAddress && /^0x[a-fA-F0-9]{40}$/.test(headerAddress)) {
    return headerAddress as Address;
  }

  return null;
}

// GET /v1/provider-logs/:providerAddress — get logs for a provider (owner only)
const logsRoute = createRoute({
  method: "get",
  path: "/provider-logs/{providerAddress}",
  tags: TAGS,
  request: { params: ProviderAddressParamsSchema, query: ProviderLogsQuerySchema, headers: OwnerHeaderSchema },
  responses: responses({ 200: json(ProviderLogsResponseSchema, "Provider logs") }, 401, 403, 500),
});

providerLogsRouter.openapi(logsRoute, async (c) => {
  try {
    const providerAddress = c.req.valid("param").providerAddress as Address;
    const ownerAddress = extractOwnerAddress(c);

    if (!ownerAddress) return fail(c, "unauthorized", OWNER_REQUIRED);

    // Verify ownership
    const isOwner = await verifyProviderOwnership(providerAddress, ownerAddress);
    if (!isOwner) return fail(c, "forbidden", NOT_OWNER);

    // Fetch logs
    const q = c.req.valid("query");
    const limit = Math.min(Number(q.limit || "500"), 5000);
    const sinceTimestamp = q.since ? Number(q.since) : undefined;
    const level = q.level;
    const category = q.category;

    const result = await fetchProviderLogs(providerAddress, {
      limit,
      sinceTimestamp,
      level,
      category,
    });

    if (!result.success) {
      return fail(c, "internal", result.error || "Failed to fetch provider logs");
    }

    return ok(c, {
      providerAddress,
      logs: result.logs,
      stats: result.stats,
      query: { limit, sinceTimestamp, level, category },
    });
  } catch (e) {
    console.error("Error fetching provider logs:", e);
    return fail(c, "internal", e instanceof Error ? e.message : "Failed to fetch provider logs");
  }
});

// GET /v1/provider-diagnostics/:providerAddress — get comprehensive diagnostics (owner only)
const diagnosticsRoute = createRoute({
  method: "get",
  path: "/provider-diagnostics/{providerAddress}",
  tags: TAGS,
  request: { params: ProviderAddressParamsSchema, query: OwnerQuerySchema, headers: OwnerHeaderSchema },
  responses: responses({ 200: json(ProviderDiagnosticsResponseSchema, "Provider diagnostics") }, 401, 403, 500),
});

providerLogsRouter.openapi(diagnosticsRoute, async (c) => {
  try {
    const providerAddress = c.req.valid("param").providerAddress as Address;
    const ownerAddress = extractOwnerAddress(c);

    if (!ownerAddress) return fail(c, "unauthorized", OWNER_REQUIRED);

    // Verify ownership
    const isOwner = await verifyProviderOwnership(providerAddress, ownerAddress);
    if (!isOwner) return fail(c, "forbidden", NOT_OWNER);

    // Fetch diagnostics
    const result = await fetchProviderDiagnostics(providerAddress);

    if (!result.success) {
      return fail(c, "internal", result.error || "Failed to fetch provider diagnostics");
    }

    return ok(c, {
      providerAddress,
      diagnostics: result.diagnostics,
    });
  } catch (e) {
    console.error("Error fetching provider diagnostics:", e);
    return fail(c, "internal", e instanceof Error ? e.message : "Failed to fetch provider diagnostics");
  }
});

// GET /v1/provider-health/:providerAddress — get provider health (owner only)
const healthRoute = createRoute({
  method: "get",
  path: "/provider-health/{providerAddress}",
  tags: TAGS,
  request: { params: ProviderAddressParamsSchema, query: OwnerQuerySchema, headers: OwnerHeaderSchema },
  responses: responses({ 200: json(ProviderHealthResponseSchema, "Provider health") }, 401, 403, 500),
});

providerLogsRouter.openapi(healthRoute, async (c) => {
  try {
    const providerAddress = c.req.valid("param").providerAddress as Address;
    const ownerAddress = extractOwnerAddress(c);

    if (!ownerAddress) return fail(c, "unauthorized", OWNER_REQUIRED);

    // Verify ownership
    const isOwner = await verifyProviderOwnership(providerAddress, ownerAddress);
    if (!isOwner) return fail(c, "forbidden", NOT_OWNER);

    // Fetch health
    const result = await fetchProviderHealth(providerAddress);

    if (!result.success) {
      return fail(c, "internal", result.error || "Failed to fetch provider health");
    }

    return ok(c, {
      providerAddress,
      health: result.health,
    });
  } catch (e) {
    console.error("Error fetching provider health:", e);
    return fail(c, "internal", e instanceof Error ? e.message : "Failed to fetch provider health");
  }
});

export default providerLogsRouter;
