import { run } from "hardhat";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Helper function to load contract addresses
export function loadAddresses(networkName: string = "baseSepolia"): any {
  const addressesFile = path.join(__dirname, `../../../shared/addresses.${networkName}.json`);
  
  if (!fs.existsSync(addressesFile)) {
    throw new Error(`Addresses file not found: ${addressesFile}`);
  }
  
  return JSON.parse(fs.readFileSync(addressesFile, "utf8"));
}

// Helper function to verify contract
export async function verifyContract(
  contractName: string,
  contractAddress: string,
  constructorArguments: any[],
  networkName: string
) {
  try {
    console.log(`\nVerifying ${contractName}...`);
    console.log(`Address: ${contractAddress}`);
    console.log(`Constructor Arguments:`, constructorArguments);
    
    await run("verify:verify", {
      address: contractAddress,
      constructorArguments: constructorArguments,
    });
    
    console.log(`✅ ${contractName} verified`);
    return true;
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log(`✅ ${contractName} already verified`);
      return true;
    } else {
      console.error(`❌ ${contractName} verification error:`, error.message);
      return false;
    }
  }
}

// Helper function to get network name
export async function getNetworkName(): Promise<string> {
  const network = await ethers.provider.getNetwork();
  return network.name === "unknown" ? "baseSepolia" : network.name;
}
