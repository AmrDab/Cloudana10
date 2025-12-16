const hre = require("hardhat");
const fs = require("fs");

/**
 * Start emissions with initial daily emission E0
 * E0 should be calculated such that total emissions don't exceed final cap
 */
async function main() {
  // Load deployment addresses
  const addresses = JSON.parse(fs.readFileSync("./deployment-addresses.json", "utf8"));
  
  const [deployer] = await hre.ethers.getSigners();
  console.log("Starting emissions with account:", deployer.address);
  
  const EmissionController = await hre.ethers.getContractFactory("EmissionController");
  const emissionController = EmissionController.attach(addresses.EmissionController);
  
  // Calculate E0 based on final cap
  // For MVP: Assume 3 years of emissions, exponential decay
  // Total emissions ≈ E0 / k (for k << 1)
  // We want: Genesis (12.8M) + Total Emissions ≤ Final Cap
  
  // Example: If final cap is 31M, genesis is 12.8M
  // Available for emissions: 31M - 12.8M = 18.2M
  // With k = 0.003, E0 should be around 18.2M * 0.003 ≈ 54,600 CLD/day
  
  // For MVP testnet, use a smaller value
  const E0 = hre.ethers.parseEther("10000"); // 10,000 CLD per day initial
  
  console.log("Starting emissions with E0:", hre.ethers.formatEther(E0), "CLD/day");
  
  const tx = await emissionController.startEmissions(E0);
  await tx.wait();
  
  console.log("Emissions started!");
  console.log("Transaction hash:", tx.hash);
  
  const startTimestamp = await emissionController.startTimestamp();
  console.log("Start timestamp:", startTimestamp.toString());
  console.log("Start date:", new Date(Number(startTimestamp) * 1000).toISOString());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

