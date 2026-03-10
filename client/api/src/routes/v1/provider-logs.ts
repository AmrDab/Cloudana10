/**
 * Provider Logs API Routes
 * Allows provider owners to view logs and diagnostics from their provider nodes.
 * Requires wallet signature verification for authentication.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Address } from "viem";
import {
  fetchProviderLogs,
  fetchProviderDiagnostics,
  fetchProviderHealth,
  verifyProviderOwnership,
} from "../../services/provider-logs.service.js";

const providerLogsRouter = new Hono();
providerLogsRouter.use("*", cors({ origin: "*" }));

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
providerLogsRouter.get("/provider-logs/:providerAddress", async (c) => {
  try {
    const providerAddress = c.req.param("providerAddress") as Address;
    const ownerAddress = extractOwnerAddress(c);
    
    if (!ownerAddress) {
      return c.json(
        {
          success: false,
          error: "Owner address required. Provide via ?owner=0x... or X-Owner-Address header",
        },
        401
      );
    }

    // Verify ownership
    const isOwner = await verifyProviderOwnership(providerAddress, ownerAddress);
    if (!isOwner) {
      return c.json(
        {
          success: false,
          error: "Unauthorized: You are not the owner of this provider",
        },
        403
      );
    }

    // Fetch logs
    const limit = Math.min(Number(c.req.query("limit") || "500"), 5000);
    const sinceTimestamp = c.req.query("since") ? Number(c.req.query("since")) : undefined;
    const level = c.req.query("level");
    const category = c.req.query("category");

    const result = await fetchProviderLogs(providerAddress, {
      limit,
      sinceTimestamp,
      level,
      category,
    });

    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error || "Failed to fetch provider logs",
        },
        500
      );
    }

    return c.json({
      success: true,
      providerAddress,
      logs: result.logs,
      stats: result.stats,
      query: { limit, sinceTimestamp, level, category },
    });
  } catch (e) {
    console.error("Error fetching provider logs:", e);
    return c.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Failed to fetch provider logs",
      },
      500
    );
  }
});

// GET /v1/provider-diagnostics/:providerAddress — get comprehensive diagnostics (owner only)
providerLogsRouter.get("/provider-diagnostics/:providerAddress", async (c) => {
  try {
    const providerAddress = c.req.param("providerAddress") as Address;
    const ownerAddress = extractOwnerAddress(c);
    
    if (!ownerAddress) {
      return c.json(
        {
          success: false,
          error: "Owner address required. Provide via ?owner=0x... or X-Owner-Address header",
        },
        401
      );
    }

    // Verify ownership
    const isOwner = await verifyProviderOwnership(providerAddress, ownerAddress);
    if (!isOwner) {
      return c.json(
        {
          success: false,
          error: "Unauthorized: You are not the owner of this provider",
        },
        403
      );
    }

    // Fetch diagnostics
    const result = await fetchProviderDiagnostics(providerAddress);

    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error || "Failed to fetch provider diagnostics",
        },
        500
      );
    }

    return c.json({
      success: true,
      providerAddress,
      diagnostics: result.diagnostics,
    });
  } catch (e) {
    console.error("Error fetching provider diagnostics:", e);
    return c.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Failed to fetch provider diagnostics",
      },
      500
    );
  }
});

// GET /v1/provider-health/:providerAddress — get provider health (owner only)
providerLogsRouter.get("/provider-health/:providerAddress", async (c) => {
  try {
    const providerAddress = c.req.param("providerAddress") as Address;
    const ownerAddress = extractOwnerAddress(c);
    
    if (!ownerAddress) {
      return c.json(
        {
          success: false,
          error: "Owner address required. Provide via ?owner=0x... or X-Owner-Address header",
        },
        401
      );
    }

    // Verify ownership
    const isOwner = await verifyProviderOwnership(providerAddress, ownerAddress);
    if (!isOwner) {
      return c.json(
        {
          success: false,
          error: "Unauthorized: You are not the owner of this provider",
        },
        403
      );
    }

    // Fetch health
    const result = await fetchProviderHealth(providerAddress);

    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error || "Failed to fetch provider health",
        },
        500
      );
    }

    return c.json({
      success: true,
      providerAddress,
      health: result.health,
    });
  } catch (e) {
    console.error("Error fetching provider health:", e);
    return c.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Failed to fetch provider health",
      },
      500
    );
  }
});

export default providerLogsRouter;
