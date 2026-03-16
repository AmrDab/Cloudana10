// Contract addresses and ABIs
// Addresses are automatically loaded from addresses.baseSepolia.json
// This file is updated by the deploy scripts in ../contract/scripts

import CLDTokenAbiData from "./abi/CLDToken.json";
import WorkloadRegistryAbiData from "./abi/WorkloadRegistry.json";
import ProviderRegistryAbiData from "./abi/ProviderRegistry.json";
import RewardContractAbiData from "./abi/RewardContract.json";
import POUWVerifierAbiData from "./abi/POUWVerifier.json";
import StakingManagerAbiData from "./abi/StakingManager.json";
import ChallengeManagerAbiData from "./abi/ChallengeManager.json";
import ProviderMinterAbiData from "./abi/ProviderMinter.json";
import addressesData from "./addresses.baseSepolia.json";
import type { Abi } from "viem";

export interface ContractAddresses {
  chainId: number;
  network: string;
  contracts: {
    CLDToken: string;
    WorkloadRegistry: string;
    ProviderRegistry: string;
    RewardContract: string;
    POUWVerifier: string;
    StakingManager: string;
    ChallengeManager: string;
    ProviderMinter: string;
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
export const RewardContractAbi = RewardContractAbiData as Abi;
export const POUWVerifierAbi = POUWVerifierAbiData as Abi;
export const StakingManagerAbi = StakingManagerAbiData as Abi;
export const ChallengeManagerAbi = ChallengeManagerAbiData as Abi;
export const ProviderMinterAbi = ProviderMinterAbiData as Abi;

