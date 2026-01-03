// EIP-712 signature generation for usage reports
import { ethers } from "ethers";
import { CONTRACT_ADDRESSES } from "@shared/contracts";

const VALIDATOR_PRIVATE_KEY = process.env.VALIDATOR_PRIVATE_KEY;
if (!VALIDATOR_PRIVATE_KEY) {
  throw new Error("VALIDATOR_PRIVATE_KEY must be set in environment variables");
}

const wallet = new ethers.Wallet(VALIDATOR_PRIVATE_KEY);

export interface UsageReportData {
  jobId: string | bigint;
  user: string;
  provider: string;
  grossCost: string;
  providerEarn: string;
  nonce: string | bigint;
  deadline: string | bigint;
}

// EIP-712 domain for CloudanaJobEscrow
const domain = {
  name: "CloudanaJobEscrow",
  version: "1",
  chainId: CONTRACT_ADDRESSES.chainId,
  verifyingContract: CONTRACT_ADDRESSES.contracts.JobEscrow as string,
};

// EIP-712 types
const types = {
  UsageReport: [
    { name: "jobId", type: "uint256" },
    { name: "user", type: "address" },
    { name: "provider", type: "address" },
    { name: "grossCost", type: "uint256" },
    { name: "providerEarn", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

/**
 * Sign a usage report using EIP-712
 */
export async function signUsageReport(report: UsageReportData): Promise<string> {
  const value = {
    jobId: typeof report.jobId === "string" ? BigInt(report.jobId) : report.jobId,
    user: report.user as `0x${string}`,
    provider: report.provider as `0x${string}`,
    grossCost: ethers.parseEther(report.grossCost),
    providerEarn: ethers.parseEther(report.providerEarn),
    nonce: typeof report.nonce === "string" ? BigInt(report.nonce) : report.nonce,
    deadline: typeof report.deadline === "string" ? BigInt(report.deadline) : report.deadline,
  };

  const signature = await wallet.signTypedData(domain, types, value);
  return signature;
}

/**
 * Get the validator address (for verifying signatures)
 */
export function getValidatorAddress(): string {
  return wallet.address;
}

