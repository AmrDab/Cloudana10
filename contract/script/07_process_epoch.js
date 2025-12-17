const hre = require("hardhat");
const fs = require("fs");

/**
 * Process epoch emissions
 * Processes the current epoch and sets PoUW budget
 * 
 * NOTE: Order-independent - can be called before or after setRoot
 * Both operations can run independently; validation happens at claim time
 */
async function main() {
  // Load deployment addresses
  const addresses = JSON.parse(fs.readFileSync("./deployment-addresses.json", "utf8"));
  
  const [deployer] = await hre.ethers.getSigners();
  console.log("Processing epoch with account:", deployer.address);
  
  const EmissionController = await hre.ethers.getContractFactory("EmissionController");
  const emissionController = EmissionController.attach(addresses.EmissionController);
  
  // Check if emissions have started
  const emissionsStarted = await emissionController.emissionsStarted();
  if (!emissionsStarted) {
    console.error("Error: Emissions have not been started yet!");
    console.error("Run script/03_start_emissions.js first");
    process.exit(1);
  }
  
  // Get current epoch
  const currentEpoch = await emissionController.getCurrentEpoch();
  console.log("Current epoch:", currentEpoch.toString());
  
  // Check if epoch already processed
  const epochProcessed = await emissionController.epochProcessed(currentEpoch);
  if (epochProcessed) {
    console.log("Epoch", currentEpoch.toString(), "has already been processed");
    const budget = await emissionController.getPouwBudget(currentEpoch);
    console.log("PoUW budget for epoch:", hre.ethers.formatEther(budget), "CLD");
    process.exit(0);
  }
  
  // Process current epoch
  console.log("Processing epoch", currentEpoch.toString(), "...");
  const tx = await emissionController.processCurrentEpoch();
  await tx.wait();
  
  console.log("Epoch processed successfully!");
  console.log("Transaction hash:", tx.hash);
  
  // Get PoUW budget
  const budget = await emissionController.getPouwBudget(currentEpoch);
  console.log("PoUW budget for epoch", currentEpoch.toString(), ":", hre.ethers.formatEther(budget), "CLD");
  
  // Get epoch emission details
  const totalEmission = await emissionController.calculateEmission(currentEpoch);
  console.log("Total emission for epoch:", hre.ethers.formatEther(totalEmission), "CLD");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

