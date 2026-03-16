import { ethers } from "hardhat";

async function main() {
  const CLD_TOKEN_ADDRESS = "0xcfd19DF5a3f963Dabf52aC7B46d4780Cc0E599e2";

  console.log("Deploying CLDFaucet...");
  const CLDFaucet = await ethers.getContractFactory("CLDFaucet");
  const faucet = await CLDFaucet.deploy(CLD_TOKEN_ADDRESS);
  await faucet.waitForDeployment();

  const faucetAddress = await faucet.getAddress();
  console.log("CLDFaucet deployed to:", faucetAddress);

  // Fund the faucet with 100,000 CLD
  console.log("Funding faucet with 100,000 CLD...");
  const cldToken = await ethers.getContractAt("CLDToken", CLD_TOKEN_ADDRESS);
  const fundAmount = ethers.parseEther("100000");
  const tx = await cldToken.transfer(faucetAddress, fundAmount);
  await tx.wait();
  console.log("Faucet funded with 100,000 CLD");

  console.log("\nFaucet Details:");
  console.log("  Address:", faucetAddress);
  console.log("  Drip Amount: 1,000 CLD");
  console.log("  Cooldown: 24 hours");
  console.log("  Initial Balance: 100,000 CLD");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
