import {
  ProviderRegistered,
  ProviderUpdated,
  ProviderDeregistered,
} from "../../shared/abi/ProviderRegistry";
import { Provider, GlobalStats } from "../generated/schema";
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

export function handleProviderRegistered(event: ProviderRegistered): void {
  let provider = new Provider(event.params.deviceId.toHexString());
  provider.providerAddress = event.params.providerAddr;
  provider.metadataUri = event.params.metadataUri;
  provider.status = "Active";
  provider.registeredAt = event.block.timestamp;
  provider.updatedAt = event.block.timestamp;
  provider.totalRewards = BigInt.fromI32(0);
  provider.totalCertificates = BigInt.fromI32(0);
  provider.save();

  let stats = getOrCreateGlobalStats();
  stats.totalProviders = stats.totalProviders.plus(BigInt.fromI32(1));
  stats.save();
}

export function handleProviderUpdated(event: ProviderUpdated): void {
  let provider = Provider.load(event.params.deviceId.toHexString());
  if (provider) {
    provider.metadataUri = event.params.metadataUri;
    provider.updatedAt = event.block.timestamp;
    provider.save();
  }
}

export function handleProviderDeregistered(event: ProviderDeregistered): void {
  let provider = Provider.load(event.params.deviceId.toHexString());
  if (provider) {
    provider.status = "Deregistered";
    provider.updatedAt = event.block.timestamp;
    provider.save();
  }
}
