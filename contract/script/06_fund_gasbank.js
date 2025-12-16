const hre = require("hardhat");
const fs = require("fs");

/**
 * Fund the GasBank with ETH for relayed transactions
 */
async function main() {
  // Load deployment addresses
  const addresses = JSON.parse(fs.readFileSync("./deployment-addresses.json", "utf8"));
  
  const [funder] = await hre.ethers.getSigners();
  console.log("Funding GasBank with account:", funder.address);
  console.log("Account balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(funder.address)), "ETH");
  
  const GasBank = await hre.ethers.getContractFactory("GasBank");
  const gasBank = GasBank.attach(addresses.GasBank);
  
  // Amount to fund (from command line or default)
  const amount = process.argv[2] 
    ? hre.ethers.parseEther(process.argv[2])
    : hre.ethers.parseEther("1"); // Default 1 ETH
  
  console.log("Funding amount:", hre.ethers.formatEther(amount), "ETH");
  
  const tx = await gasBank.depositETH({ value: amount });
  await tx.wait();
  
  console.log("GasBank funded!");
  console.log("Transaction hash:", tx.hash);
  
  const balance = await gasBank.getETHBalance();
  console.log("GasBank balance:", hre.ethers.formatEther(balance), "ETH");
  
  const remainingLimit = await gasBank.getRemainingDailyLimit();
  console.log("Remaining daily limit:", hre.ethers.formatEther(remainingLimit), "ETH");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

