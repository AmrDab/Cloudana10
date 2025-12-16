const hre = require("hardhat");
const fs = require("fs");

/**
 * Finalize the cap with a random value R
 * For testnet MVP, admin sets R manually
 * On mainnet, this would be called by VRF oracle
 */
async function main() {
  // Load deployment addresses
  const addresses = JSON.parse(fs.readFileSync("./deployment-addresses.json", "utf8"));
  
  const [deployer] = await hre.ethers.getSigners();
  console.log("Finalizing cap with account:", deployer.address);
  
  const MockCapOracle = await hre.ethers.getContractFactory("MockCapOracle");
  const oracle = MockCapOracle.attach(addresses.MockCapOracle);
  
  // For MVP testnet, use a test random value
  // R = 10,000,000 CLD (10M)
  // Final cap = 21M + 10M = 31M CLD
  const randomValue = hre.ethers.parseEther("10000000"); // 10M CLD
  
  console.log("Finalizing cap with random value:", randomValue.toString());
  console.log("Final cap will be: 21M +", hre.ethers.formatEther(randomValue), "=", 
    hre.ethers.formatEther(hre.ethers.parseEther("21000000").add(randomValue)), "CLD");
  
  const tx = await oracle.finalizeCap(randomValue);
  await tx.wait();
  
  console.log("Cap finalized!");
  console.log("Transaction hash:", tx.hash);
  
  const finalCap = await oracle.getFinalCap();
  console.log("Final cap:", hre.ethers.formatEther(finalCap), "CLD");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

