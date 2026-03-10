#!/usr/bin/env tsx
/**
 * Manually register a workload for status polling
 * Usage: tsx scripts/register-workload-for-polling.ts <workloadId> <instanceId> <providerEndpoint>
 */

import { registerWorkloadForPolling } from "../client/api/src/services/workload-status-poller.service.js";

const workloadId = process.argv[2];
const instanceId = process.argv[3];
const providerEndpoint = process.argv[4];

if (!workloadId || !instanceId || !providerEndpoint) {
  console.error("Usage: tsx scripts/register-workload-for-polling.ts <workloadId> <instanceId> <providerEndpoint>");
  console.error("Example: tsx scripts/register-workload-for-polling.ts 4 1 http://89.116.117.169:8080");
  process.exit(1);
}

console.log(`Registering workload for polling...`);
console.log(`  Workload ID: ${workloadId}`);
console.log(`  Instance ID: ${instanceId}`);
console.log(`  Provider: ${providerEndpoint}`);

registerWorkloadForPolling(
  BigInt(workloadId),
  BigInt(instanceId),
  providerEndpoint
);

console.log(`✅ Workload registered! Status will be polled every 15 seconds.`);
console.log(`   Check status at: http://localhost:5173/user/deployment/job/${workloadId}`);
