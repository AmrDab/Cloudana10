// Contract addresses and ABIs
// These should be populated after deployment from ../contracts/scripts/deploy.ts output

import CLDTokenAbiData from "./abi/CLDToken.json";
import ProviderRegistryAbiData from "./abi/ProviderRegistry.json";
import JobEscrowAbiData from "./abi/JobEscrow.json";
import type { Abi } from "viem";

export interface ContractAddresses {
  chainId: number;
  network: string;
  contracts: {
    CLDToken: string;
    ProviderRegistry: string;
    JobEscrow: string;
  };
  roles?: {
    minter?: string;
    validator?: string;
  };
}

// Default addresses for Base Sepolia (update after deployment)
// These should be updated after running deploy script from ../contracts
// The deploy script writes to addresses.baseSepolia.json
export const CONTRACT_ADDRESSES: ContractAddresses = {
  chainId: 84532,
  network: "baseSepolia",
  contracts: {
    CLDToken: "0xcfd19DF5a3f963Dabf52aC7B46d4780Cc0E599e2", // Update after deployment
    ProviderRegistry: "0xdad6609Cf35352c12e0DC540F6486aBACDd089fc", // Updated to match deployed contract
    JobEscrow: "0x5F2Be10E979B5Bf7ed1743807227c859990D2B07", // Update after deployment
  },
};

// Export ABIs as arrays (wagmi/viem expects arrays)
export const CLDTokenAbi = CLDTokenAbiData as Abi;
export const ProviderRegistryAbi = ProviderRegistryAbiData as Abi;
export const JobEscrowAbi = JobEscrowAbiData as Abi;

