// Contract addresses and ABIs
// Addresses are automatically loaded from addresses.baseSepolia.json
// This file is updated by the deploy scripts in ../contracts/scripts

import CLDTokenAbiData from "./abi/CLDToken.json";
import WorkloadRegistryAbiData from "./abi/WorkloadRegistry.json";
import ProviderRegistryAbiData from "./abi/ProviderRegistry.json";
import addressesData from "./addresses.baseSepolia.json";
import type { Abi } from "viem";

export interface ContractAddresses {
  chainId: number;
  network: string;
  contracts: {
    CLDToken: string;
    WorkloadRegistry: string;
    ProviderRegistry?: string;
  };
  roles?: {
    minter?: string;
    validator?: string;
  };
}

// Load addresses from addresses.baseSepolia.json
// This file is automatically updated by deploy scripts
export const CONTRACT_ADDRESSES: ContractAddresses = addressesData as ContractAddresses;

// Export ABIs as arrays (wagmi/viem expects arrays)
export const CLDTokenAbi = CLDTokenAbiData as Abi;
export const WorkloadRegistryAbi = WorkloadRegistryAbiData as Abi;
export const ProviderRegistryAbi = ProviderRegistryAbiData as Abi;

