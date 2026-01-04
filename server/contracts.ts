// Contract interaction utilities for providerRegistry
import { ethers } from "ethers";
import { CONTRACT_ADDRESSES, ProviderRegistryAbi } from "@shared/contracts";

const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
const provider = new ethers.JsonRpcProvider(RPC_URL);

// Get providerRegistry contract instance (read-only for now)
export function getproviderRegistryContract() {
  const providerRegistryAddress = CONTRACT_ADDRESSES.contracts.ProviderRegistry as string;
  if (!providerRegistryAddress || providerRegistryAddress === "0x0000000000000000000000000000000000000000") {
    throw new Error("providerRegistry contract address not set");
  }
  return new ethers.Contract(providerRegistryAddress, ProviderRegistryAbi as any, provider);
}

// Helper to convert hex string to bytes32
export function stringToBytes32(str: string): string {
  if (str.startsWith("0x")) {
    str = str.slice(2);
  }
  // Pad or truncate to 64 hex characters (32 bytes)
  const padded = str.padEnd(64, "0").slice(0, 64);
  return `0x${padded}`;
}

// Helper to validate providerkey format
export function isValidProviderKey(providerkey: string): boolean {
  if (!providerkey.startsWith("0x")) {
    return false;
  }
  const hex = providerkey.slice(2);
  return /^[0-9a-fA-F]{64}$/.test(hex);
}

