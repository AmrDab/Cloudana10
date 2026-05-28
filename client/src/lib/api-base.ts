/**
 * API base URLs.
 *
 * Cloudana has two backends:
 *  - the Cloudflare Worker "edge" API (templates, pouw, payments, faucet, hardware-scan, auth)
 *  - the Node "orchestrator" (verify, build-provider, deploy, orchestration, provider-logs,
 *    workload-status) — can't run on Workers; deployed separately (e.g. Akash).
 *
 * Heavy/Node-only calls use NODE_API_URL / nodeApiBase(). It falls back to the edge URL,
 * then localhost, so behavior is unchanged until VITE_NODE_API_URL is set at deploy time.
 */
export const NODE_API_URL: string =
  import.meta.env.VITE_NODE_API_URL || import.meta.env.VITE_API_URL || "http://localhost:7002";

/** Base for Node-only orchestrator endpoints, including the /v1 prefix. */
export const nodeApiBase = (): string => `${NODE_API_URL}/v1`;
