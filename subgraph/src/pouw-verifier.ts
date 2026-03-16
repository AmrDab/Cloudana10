import { CertificateSubmitted } from "../../shared/abi/POUWVerifier";
import { POUWCertificate, MinerStats, GlobalStats } from "../generated/schema";
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

export function handleCertificateSubmitted(event: CertificateSubmitted): void {
  let cert = new POUWCertificate(
    event.transaction.hash.concatI32(event.logIndex.toI32()).toHexString()
  );
  cert.provider = event.params.provider.toHexString();
  cert.deviceId = event.params.deviceId;
  cert.matrixSize = event.params.matrixSize;
  cert.difficulty = event.params.difficulty;
  cert.z = event.params.z;
  cert.timestamp = event.block.timestamp;
  cert.blockNumber = event.block.number;
  cert.transactionHash = event.transaction.hash;
  cert.save();

  // Update miner stats
  let minerStats = MinerStats.load(event.params.provider.toHexString());
  if (!minerStats) {
    minerStats = new MinerStats(event.params.provider.toHexString());
    minerStats.totalCertificates = BigInt.fromI32(0);
    minerStats.totalDifficulty = BigInt.fromI32(0);
    minerStats.lastSubmittedBlock = BigInt.fromI32(0);
  }
  minerStats.totalCertificates = minerStats.totalCertificates.plus(BigInt.fromI32(1));
  minerStats.totalDifficulty = minerStats.totalDifficulty.plus(event.params.difficulty);
  minerStats.lastSubmittedBlock = event.block.number;
  minerStats.save();

  let stats = getOrCreateGlobalStats();
  stats.totalCertificates = stats.totalCertificates.plus(BigInt.fromI32(1));
  stats.save();
}
