/**
 * Is the Node orchestrator (verify, build-provider, orchestration, workload-status,
 * provider-logs, deploy) reachable? Those routes are not served by the edge Worker,
 * so when NODE_API_URL falls back to the edge URL they 404.
 */
import { useQuery } from "@tanstack/react-query";
import { NODE_API_URL } from "@/lib/api-base";
import { ApiError } from "@/lib/api-error";

export type OrchestratorAvailability = boolean | "unknown";

async function checkOrchestrator(): Promise<boolean> {
  try {
    const res = await fetch(`${NODE_API_URL}/health`);
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { runtime?: unknown } | null;
    // The edge Worker answers /health too; only the Node runtime serves orchestrator routes.
    return body?.runtime === undefined || body.runtime === "node";
  } catch {
    return false;
  }
}

/** true / false once /health has answered, "unknown" while checking. Cached for 60 s. */
export function useOrchestratorAvailable(): OrchestratorAvailability {
  const { data } = useQuery({
    queryKey: ["orchestrator-health", NODE_API_URL],
    queryFn: checkOrchestrator,
    staleTime: 60_000,
    gcTime: 60_000,
    retry: false,
  });
  return data ?? "unknown";
}

/** An error meaning the orchestrator route isn't there at all (not deployed / unreachable). */
export function isOrchestratorUnavailable(e: unknown): boolean {
  // Envelope errors always carry a code; a code-less 404/5xx or a network failure means
  // the request never reached an orchestrator route handler.
  return e instanceof ApiError && !e.code && (e.status === 0 || e.status === 404 || e.status >= 502);
}

export const ORCHESTRATOR_UNAVAILABLE =
  "Orchestrator unavailable — this feature needs the Cloudana orchestrator, which isn't reachable right now.";
