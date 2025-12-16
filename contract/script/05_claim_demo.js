const hre = require("hardhat");
const fs = require("fs");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

/**
 * Demo script for claiming PoUW rewards
 */
async function main() {
  // Load deployment addresses
  const addresses = JSON.parse(fs.readFileSync("./deployment-addresses.json", "utf8"));
  
  // Get epoch from command line or use latest
  const epoch = process.argv[2] || "0";
  
  // Load merkle tree data
  let merkleData;
  try {
    merkleData = JSON.parse(fs.readFileSync(`./merkle-epoch-${epoch}.json`, "utf8"));
  } catch (error) {
    console.error("Error: Could not load merkle tree data for epoch", epoch);
    console.error("Run 04_publish_merkle_root.js first");
    process.exit(1);
  }
  
  const [claimant] = await hre.ethers.getSigners();
  console.log("Claiming rewards with account:", claimant.address);
  
  const MerkleRewardsPoUW = await hre.ethers.getContractFactory("MerkleRewardsPoUW");
  const merkleRewards = MerkleRewardsPoUW.attach(addresses.MerkleRewardsPoUW);
  
  // Find reward for claimant
  const reward = merkleData.rewards.find(
    (r) => r.provider.toLowerCase() === claimant.address.toLowerCase()
  );
  
  if (!reward) {
    console.error("Error: No reward found for address", claimant.address);
    process.exit(1);
  }
  
  console.log("Reward amount:", hre.ethers.formatEther(reward.amount), "CLD");
  
  // Rebuild merkle tree
  const leaves = merkleData.rewards.map((r) =>
    keccak256(ethers.solidityPacked(["address", "uint256"], [r.provider, r.amount]))
  );
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  
  // Get proof
  const leaf = keccak256(
    ethers.solidityPacked(["address", "uint256"], [claimant.address, reward.amount])
  );
  const proof = tree.getHexProof(leaf);
  
  console.log("Merkle proof:", proof);
  
  // Check if already claimed
  const hasClaimed = await merkleRewards.hasClaimed(epoch, claimant.address);
  if (hasClaimed) {
    console.error("Error: Already claimed for this epoch");
    process.exit(1);
  }
  
  // Claim
  console.log("Claiming reward...");
  const tx = await merkleRewards.claim(epoch, reward.amount, proof);
  await tx.wait();
  
  console.log("Reward claimed successfully!");
  console.log("Transaction hash:", tx.hash);
  
  // Check balance
  const CLDToken = await hre.ethers.getContractFactory("CLDToken");
  const token = CLDToken.attach(addresses.CLDToken);
  const balance = await token.balanceOf(claimant.address);
  console.log("New CLD balance:", hre.ethers.formatEther(balance), "CLD");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

