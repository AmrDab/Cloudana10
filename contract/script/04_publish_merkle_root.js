const hre = require("hardhat");
const fs = require("fs");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

/**
 * Publish merkle root for PoUW rewards
 * This script demonstrates how to build and publish a merkle root
 * In production, backend would do this automatically
 */
async function main() {
  // Load deployment addresses
  const addresses = JSON.parse(fs.readFileSync("./deployment-addresses.json", "utf8"));
  
  const [deployer, validator] = await hre.ethers.getSigners();
  console.log("Publishing merkle root with account:", validator.address);
  
  const MerkleRewardsPoUW = await hre.ethers.getContractFactory("MerkleRewardsPoUW");
  const merkleRewards = MerkleRewardsPoUW.attach(addresses.MerkleRewardsPoUW);
  
  const EmissionController = await hre.ethers.getContractFactory("EmissionController");
  const emissionController = EmissionController.attach(addresses.EmissionController);
  
  // Get current epoch
  const currentEpoch = await emissionController.getCurrentEpoch();
  console.log("Current epoch:", currentEpoch.toString());
  
  // Example: Create merkle tree with sample rewards
  // In production, this would come from backend calculations
  const rewards = [
    { provider: "0x1111111111111111111111111111111111111111", amount: hre.ethers.parseEther("100") },
    { provider: "0x2222222222222222222222222222222222222222", amount: hre.ethers.parseEther("200") },
    { provider: "0x3333333333333333333333333333333333333333", amount: hre.ethers.parseEther("150") },
  ];
  
  // Build merkle tree
  const leaves = rewards.map((r) =>
    keccak256(ethers.solidityPacked(["address", "uint256"], [r.provider, r.amount]))
  );
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const root = tree.getHexRoot();
  
  // Calculate total amount
  const totalAmount = rewards.reduce((sum, r) => sum + r.amount, 0n);
  
  console.log("Merkle root:", root);
  console.log("Total amount:", hre.ethers.formatEther(totalAmount), "CLD");
  console.log("Number of providers:", rewards.length);
  
  // Check budget
  const budget = await emissionController.getPouwBudget(currentEpoch);
  console.log("PoUW budget for epoch:", hre.ethers.formatEther(budget), "CLD");
  
  if (totalAmount > budget) {
    console.error("Error: Total amount exceeds budget!");
    process.exit(1);
  }
  
  // Publish root
  const tx = await merkleRewards.connect(validator).setRoot(currentEpoch, root, totalAmount);
  await tx.wait();
  
  console.log("Merkle root published!");
  console.log("Transaction hash:", tx.hash);
  
  // Save merkle tree data for claim demo
  const merkleData = {
    epoch: currentEpoch.toString(),
    root: root,
    totalAmount: totalAmount.toString(),
    rewards: rewards.map((r) => ({
      provider: r.provider,
      amount: r.amount.toString(),
    })),
    tree: tree.toString(),
  };
  
  fs.writeFileSync(
    `./merkle-epoch-${currentEpoch}.json`,
    JSON.stringify(merkleData, null, 2)
  );
  console.log("Merkle tree data saved to merkle-epoch-" + currentEpoch + ".json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

