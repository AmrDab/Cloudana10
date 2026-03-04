/**
 * Terminate workload on provider node: call DELETE /workload/:workloadId/:instanceId
 * (provider-node-server) so the provider deletes the Kubernetes namespace and cleans up.
 * Used by the orchestrator when WorkloadDeregistered or WorkloadDeleted events fire.
 */
import { getProviderByAddress } from "./chain-client.js";
import { fetchProviderCapacityAndEndpointFromIpfsUrl } from "./provider-metadata.service.js";
import { log } from "../lib/logger.js";
import type { Address } from "viem";

const TERMINATE_TIMEOUT_MS = Number(process.env.ORCHESTRATOR_TERMINATE_TIMEOUT_MS ?? 15_000);
const L = log.orchestratorEvent;

/**
 * Resolve provider endpoint from chain + IPFS metadata.
 */
async function getProviderEndpoint(providerAddress: Address): Promise<string | null> {
  const provider = await getProviderByAddress(providerAddress);
  if (!provider?.metadataUri) return null;
  const cap = await fetchProviderCapacityAndEndpointFromIpfsUrl(provider.metadataUri);
  return cap?.endpoint ?? null;
}

/**
 * Call provider node DELETE /workload/:workloadId/:instanceId to terminate the workload
 * and delete the Kubernetes namespace.
 * Returns true if the provider accepted and succeeded.
 */
export async function terminateWorkloadOnProvider(
  workloadId: bigint,
  instanceId: bigint,
  providerAddress: Address
): Promise<boolean> {
  const endpoint = await getProviderEndpoint(providerAddress);
  if (!endpoint) {
    L.warn(
      `[Terminate] No endpoint for provider ${providerAddress.slice(0, 10)}... — cannot terminate workload ${workloadId}/${instanceId}`
    );
    return false;
  }

  const baseUrl = endpoint.replace(/\/+$/, "");
  const url = `${baseUrl}/workload/${workloadId}/${instanceId}`;
  L.info(`[Terminate] Calling DELETE ${url} for workload ${workloadId}/${instanceId}`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TERMINATE_TIMEOUT_MS);
    const res = await fetch(url, { method: "DELETE", signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text();
      L.error(`[Terminate] Provider returned ${res.status}: ${text.slice(0, 200)}`);
      return false;
    }

    const data = (await res.json()) as { status?: string; message?: string };
    if (data.status !== "success" && data.status !== "ok") {
      L.warn(`[Terminate] Unexpected response status: ${data.status}`);
    }
    L.success(`[Terminate] Workload ${workloadId}/${instanceId} terminated on provider`);
    return true;
  } catch (e) {
    L.error(
      `[Terminate] Failed to terminate workload ${workloadId}/${instanceId}: ${e instanceof Error ? e.message : String(e)}`
    );
    return false;
  }
}
