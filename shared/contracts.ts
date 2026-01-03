// Contract addresses and ABIs
// These should be populated after deployment from ../contracts/scripts/deploy.ts output

import CLDTokenAbiData from "./abi/CLDToken.json";
import ProviderRegistryAbiData from "./abi/ProviderRegistry.json";
import JobEscrowAbiData from "./abi/JobEscrow.json";

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
    CLDToken: "0x0000000000000000000000000000000000000000", // Update after deployment
    ProviderRegistry: "0x0000000000000000000000000000000000000000", // Update after deployment
    JobEscrow: "0x0000000000000000000000000000000000000000", // Update after deployment
  },
};

// Export ABIs as arrays (wagmi/viem expects arrays)
export const CLDTokenAbi = CLDTokenAbiData as readonly unknown[];
export const ProviderRegistryAbi = ProviderRegistryAbiData as readonly unknown[];
export const JobEscrowAbi = JobEscrowAbiData as readonly unknown[];

