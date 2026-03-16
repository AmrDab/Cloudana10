import { Transfer as TransferEvent } from "../../shared/abi/CLDToken";
import { Transfer, TokenHolder, GlobalStats } from "../generated/schema";
import { BigInt, Bytes } from "@graphprotocol/graph-ts";

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

export function handleTransfer(event: TransferEvent): void {
  let transfer = new Transfer(
    event.transaction.hash.concatI32(event.logIndex.toI32()).toHexString()
  );
  transfer.from = event.params.from;
  transfer.to = event.params.to;
  transfer.amount = event.params.value;
  transfer.timestamp = event.block.timestamp;
  transfer.blockNumber = event.block.number;
  transfer.transactionHash = event.transaction.hash;
  transfer.save();

  // Update sender
  let fromHolder = TokenHolder.load(event.params.from.toHexString());
  if (!fromHolder) {
    fromHolder = new TokenHolder(event.params.from.toHexString());
    fromHolder.balance = BigInt.fromI32(0);
    fromHolder.totalTransferred = BigInt.fromI32(0);
    fromHolder.totalReceived = BigInt.fromI32(0);
    fromHolder.transferCount = BigInt.fromI32(0);
  }
  fromHolder.balance = fromHolder.balance.minus(event.params.value);
  fromHolder.totalTransferred = fromHolder.totalTransferred.plus(event.params.value);
  fromHolder.transferCount = fromHolder.transferCount.plus(BigInt.fromI32(1));
  fromHolder.save();

  // Update receiver
  let toHolder = TokenHolder.load(event.params.to.toHexString());
  if (!toHolder) {
    toHolder = new TokenHolder(event.params.to.toHexString());
    toHolder.balance = BigInt.fromI32(0);
    toHolder.totalTransferred = BigInt.fromI32(0);
    toHolder.totalReceived = BigInt.fromI32(0);
    toHolder.transferCount = BigInt.fromI32(0);
  }
  toHolder.balance = toHolder.balance.plus(event.params.value);
  toHolder.totalReceived = toHolder.totalReceived.plus(event.params.value);
  toHolder.save();

  // Update global stats
  let stats = getOrCreateGlobalStats();
  stats.totalTransfers = stats.totalTransfers.plus(BigInt.fromI32(1));
  stats.save();
}
