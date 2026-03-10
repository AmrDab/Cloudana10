/**
 * Akash Network integration for Cloudana provider node.
 *
 * Usage:
 *   import { isAkashManifest, executeAkashWorkload } from "./akash/index.js";
 *
 *   if (isAkashManifest(manifest)) {
 *     const result = await executeAkashWorkload(workloadId, instanceId, manifest);
 *   }
 *
 * Environment variables:
 *   AKASH_MNEMONIC          - BIP39 mnemonic (required)
 *   AKASH_RPC_URL           - RPC endpoint (default: https://rpc.akash.forbole.com:443)
 *   AKASH_REST_URL          - REST/LCD endpoint (default: https://api.akash.forbole.com)
 *   AKASH_CHAIN_ID          - Chain ID (default: akashnet-2)
 *   AKASH_GAS_PRICE         - Gas price (default: 0.025, denominated in uakt)
 *   AKASH_EXECUTION_MODE    - Set to "true" to route ALL workloads to Akash
 */

export {
  // Core execution
  isAkashManifest,
  executeAkashWorkload,
  refreshAkashInstanceState,
  terminateAkashDeployment,
  // Types
  type CloudanaManifest,
  type AkashExecutionResult,
  type AkashInstanceState,
} from "./akash-execution.js";

export {
  // SDL conversion
  convertToSDL,
  validateWorkload,
  buildWebServiceSDL,
  buildGpuWorkloadSDL,
  // Types
  type CloudanaWorkload,
  type SDLConversionResult,
} from "./sdl-converter.js";

export {
  // Akash client
  AkashClient,
  createAkashClientFromEnv,
  // Types
  type AkashClientConfig,
  type AkashDeploymentId,
  type AkashBid,
  type AkashLeaseId,
  type AkashLeaseInfo,
  type AkashDeploymentStatus,
  type AkashEndpoint,
} from "./akash-client.js";
