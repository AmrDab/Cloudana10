import {
  WorkloadRegistered,
  WorkloadPlaced,
  WorkloadDeregistered,
} from "../../shared/abi/WorkloadRegistry";
import { Workload, Provider, GlobalStats } from "../generated/schema";
import { BigInt } from "@graphprotocol/graph-ts";

function getOrCreateGlobalStats(): GlobalStats {
  let stats = GlobalStats.load("global");
  if (!stats) {
    stats = new GlobalStats("global");
    stats.totalProviders = BigInt.fromI32(0);
    stats.totalWorkloads = BigInt.fromI32(0);
    stats.totalTransfers = BigInt.fromI32(0);
    stats.totalCertificates = BigInt.fromI32(0);
    stats.totalRewardsDistributed = BigInt.fromI32(0);
  }
  return stats;
}

export function handleWorkloadRegistered(event: WorkloadRegistered): void {
  let workload = new Workload(event.params.workloadId.toString());
  workload.owner = event.params.owner;
  workload.metadataUri = event.params.metadataUri;
  workload.status = "Active";
  workload.registeredAt = event.block.timestamp;
  workload.totalFunded = BigInt.fromI32(0);
  workload.save();

  let stats = getOrCreateGlobalStats();
  stats.totalWorkloads = stats.totalWorkloads.plus(BigInt.fromI32(1));
  stats.save();
}

export function handleWorkloadPlaced(event: WorkloadPlaced): void {
  let workload = Workload.load(event.params.workloadId.toString());
  if (workload) {
    // Link to provider by address - find matching provider
    workload.placementInstanceId = event.params.instanceId;
    workload.placedAt = event.block.timestamp;
    workload.save();
  }
}

export function handleWorkloadDeregistered(event: WorkloadDeregistered): void {
  let workload = Workload.load(event.params.workloadId.toString());
  if (workload) {
    workload.status = "Inactive";
    workload.save();
  }
}
