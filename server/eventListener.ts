import { ethers } from "ethers";
import { CONTRACT_ADDRESSES, ProviderRegistryAbi } from "@shared/contracts";
import { storage } from "./storage";
import { stringToBytes32 } from "./contracts";

const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
const provider = new ethers.JsonRpcProvider(RPC_URL);

let isListening = false;
let lastProcessedBlock = 0;

export async function startEventListener() {
  if (isListening) {
    console.log("[EventListener] Already running");
    return;
  }

  const providerRegistryAddress = CONTRACT_ADDRESSES.contracts.ProviderRegistry as string;
  if (!providerRegistryAddress || providerRegistryAddress === "0x0000000000000000000000000000000000000000") {
    console.error("[EventListener] ProviderRegistry contract address not set");
    return;
  }

  const contract = new ethers.Contract(providerRegistryAddress, ProviderRegistryAbi as any, provider);

  // Get current block number
  try {
    const currentBlock = await provider.getBlockNumber();
    lastProcessedBlock = Math.max(0, currentBlock - 100); // Start from 100 blocks ago to catch any missed events
    console.log(`[EventListener] Starting from block ${lastProcessedBlock} (current: ${currentBlock})`);
  } catch (error) {
    console.error("[EventListener] Failed to get current block number:", error);
    return;
  }

  isListening = true;

  // Listen for new blocks and process events
  provider.on("block", async (blockNumber: number) => {
    try {
      await processEvents(contract, lastProcessedBlock, blockNumber);
      lastProcessedBlock = blockNumber;
    } catch (error) {
      console.error(`[EventListener] Error processing events at block ${blockNumber}:`, error);
    }
  });

  // Also set up a polling mechanism as backup (every 15 seconds)
  setInterval(async () => {
    try {
      const currentBlock = await provider.getBlockNumber();
      if (currentBlock > lastProcessedBlock) {
        await processEvents(contract, lastProcessedBlock, currentBlock);
        lastProcessedBlock = currentBlock;
      }
    } catch (error) {
      console.error("[EventListener] Error in polling mechanism:", error);
    }
  }, 15000);

  console.log("[EventListener] Started successfully");
}

async function processEvents(contract: ethers.Contract, fromBlock: number, toBlock: number) {
  try {
    // Query ProviderRegistered events
    const filter = contract.filters.ProviderRegistered();
    const events = await contract.queryFilter(filter, fromBlock, toBlock);

    if (events.length > 0) {
      console.log(`[EventListener] Found ${events.length} ProviderRegistered event(s) in blocks ${fromBlock}-${toBlock}`);
    }

    for (const event of events) {
      if (event.args && event.args.length >= 6) {
        const owner = event.args[0] as string;
        const providerkeyBytes32 = event.args[1] as string;
        const region = event.args[2] as string;
        const hardwareTier = Number(event.args[3]);
        const capacity = Number(event.args[4]);
        const bondAmount = event.args[5].toString();
        const txHash = event.transactionHash;
        const blockNumber = event.blockNumber;

        // Convert bytes32 back to hex string
        // The bytes32 from event is already in the format "0x..." with 66 characters (0x + 64 hex chars)
        // We need to ensure it matches our providerkey format (64 hex chars after 0x)
        // bytes32 from ethers is always exactly 32 bytes, so it's already correct
        let providerkey = providerkeyBytes32;
        if (!providerkey.startsWith("0x")) {
          providerkey = `0x${providerkey}`;
        }
        // Ensure it's exactly 66 characters (0x + 64 hex chars)
        // bytes32 should already be correct, but normalize just in case
        const hexPart = providerkey.slice(2);
        if (hexPart.length !== 64) {
          // Pad to 64 characters using padEnd to match frontend conversion
          const paddedHex = hexPart.padEnd(64, "0").slice(0, 64);
          providerkey = `0x${paddedHex}`;
        }

        console.log(`[EventListener] Processing ProviderRegistered event:`, {
          owner,
          providerkey,
          region,
          hardwareTier,
          capacity,
          bondAmount,
          blockNumber,
          txHash,
        });

        // Find pending provider by providerkey
        const pendingProvider = await storage.getPendingProviderByProviderkey(providerkey);

        if (pendingProvider) {
          // Update status from Pending to Registered
          await storage.updateProviderStatusByProviderkey(providerkey, "Registered");
          
          // Update registeredAt timestamp from block timestamp
          try {
            const block = await provider.getBlock(blockNumber);
            if (block && block.timestamp) {
              const registeredAt = new Date(Number(block.timestamp) * 1000);
              await storage.updateProviderRegisteredAt(providerkey, registeredAt);
            }
          } catch (error) {
            console.warn(`[EventListener] Failed to get block timestamp for block ${blockNumber}:`, error);
            // Use current time as fallback
            await storage.updateProviderRegisteredAt(providerkey, new Date());
          }

          console.log(`[EventListener] ✓ Updated provider ${providerkey} from Pending to Registered`);
        } else {
          // Provider not found in pending state - might have been registered directly
          // or event was processed already, or provider was created without going through validation
          const existingProvider = await storage.getProviderByProviderkey(providerkey);
          if (existingProvider) {
            if (existingProvider.status !== "Registered") {
              // Update to Registered if it exists but isn't Registered yet
              await storage.updateProviderStatusByProviderkey(providerkey, "Registered");
              console.log(`[EventListener] ✓ Updated existing provider ${providerkey} to Registered`);
            } else {
              console.log(`[EventListener] Provider ${providerkey} already Registered, skipping`);
            }
          } else {
            console.log(`[EventListener] ⚠ Provider ${providerkey} not found in database, event may be for external registration`);
          }
        }
      }
    }
  } catch (error) {
    console.error("[EventListener] Error processing events:", error);
    throw error;
  }
}

export function stopEventListener() {
  isListening = false;
  provider.removeAllListeners();
  console.log("[EventListener] Stopped");
}

