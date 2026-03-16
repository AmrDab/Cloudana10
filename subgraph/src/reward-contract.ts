import {
  WorkloadFunded as WorkloadFundedEvent,
  ProviderRewarded as ProviderRewardedEvent,
  EarningsWithdrawn as EarningsWithdrawnEvent,
} from "../../shared/abi/RewardContract";
import { Reward, WorkloadFunding, WithdrawalEvent, Workload, GlobalStats } from "../generated/schema";
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

export function handleWorkloadFunded(event: WorkloadFundedEvent): void {
  let funding = new WorkloadFunding(
    event.transaction.hash.concatI32(event.logIndex.toI32()).toHexString()
  );
  funding.workload = event.params.workloadId.toString();
  funding.funder = event.params.funder;
  funding.amount = event.params.amount;
  funding.timestamp = event.block.timestamp;
  funding.transactionHash = event.transaction.hash;
  funding.save();

  // Update workload total funded
  let workload = Workload.load(event.params.workloadId.toString());
  if (workload) {
    workload.totalFunded = workload.totalFunded.plus(event.params.amount);
    workload.save();
  }
}

export function handleProviderRewarded(event: ProviderRewardedEvent): void {
  let reward = new Reward(
    event.transaction.hash.concatI32(event.logIndex.toI32()).toHexString()
  );
  reward.workload = event.params.workloadId.toString();
  reward.provider = event.params.provider.toHexString();
  reward.amount = event.params.amount;
  reward.timestamp = event.block.timestamp;
  reward.transactionHash = event.transaction.hash;
  reward.save();

  let stats = getOrCreateGlobalStats();
  stats.totalRewardsDistributed = stats.totalRewardsDistributed.plus(event.params.amount);
  stats.save();
}

export function handleEarningsWithdrawn(event: EarningsWithdrawnEvent): void {
  let withdrawal = new WithdrawalEvent(
    event.transaction.hash.concatI32(event.logIndex.toI32()).toHexString()
  );
  withdrawal.provider = event.params.provider;
  withdrawal.amount = event.params.amount;
  withdrawal.timestamp = event.block.timestamp;
  withdrawal.transactionHash = event.transaction.hash;
  withdrawal.save();
}
