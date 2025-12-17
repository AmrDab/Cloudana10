const hre = require("hardhat");
const fs = require("fs");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

/**
 * Publish merkle root for PoUW rewards
 * This script demonstrates how to build and publish a merkle root
 * In production, backend would do this automatically
 * 
 * NOTE: Order-independent - can be called before or after processEpoch
 * Validation happens at claim time when both root and epoch processing must be complete
 */
async function main() {
  // Load deployment addresses
  const addresses = JSON.parse(fs.readFileSync("./deployment-addresses.json", "utf8"));
  
  const [deployer] = await hre.ethers.getSigners();
  
  // Get validator address from deployment addresses (use first validator)
  // If validator is the deployer, use deployer; otherwise try to get signer
  const validatorAddress = addresses.Validators && addresses.Validators.length > 0 
    ? addresses.Validators[0] 
    : addresses.Deployer;
  
  let validator;
  try {
    // Try to get validator as signer (if it's in the accounts)
    const signers = await hre.ethers.getSigners();
    validator = signers.find(s => s.address.toLowerCase() === validatorAddress.toLowerCase());
    if (!validator) {
      // If validator is not in signers, use deployer (assuming validator was granted role)
      validator = deployer;
      console.log("⚠️  Validator address not found in signers, using deployer");
      console.log("   Validator address from deployment:", validatorAddress);
    }
  } catch (e) {
    validator = deployer;
    console.log("⚠️  Using deployer as validator");
  }
  
  console.log("Publishing merkle root with account:", validator.address);
  
  const MerkleRewardsPoUW = await hre.ethers.getContractFactory("MerkleRewardsPoUW");
  const merkleRewards = MerkleRewardsPoUW.attach(addresses.MerkleRewardsPoUW);
  
  const EmissionController = await hre.ethers.getContractFactory("EmissionController");
  const emissionController = EmissionController.attach(addresses.EmissionController);
  
  // Get current epoch
  const currentEpoch = await emissionController.getCurrentEpoch();
  console.log("Current epoch:", currentEpoch.toString());
  
  // Check if epoch has been processed (informational only - order doesn't matter)
  const epochProcessed = await emissionController.epochProcessed(currentEpoch);
  if (epochProcessed) {
    console.log("✓ Epoch", currentEpoch.toString(), "has been processed");
    const budget = await emissionController.getPouwBudget(currentEpoch);
    console.log("  PoUW budget:", hre.ethers.formatEther(budget), "CLD");
  } else {
    console.log("ℹ️  Epoch", currentEpoch.toString(), "not yet processed (order-independent)");
    console.log("   Root can be published now; validation happens at claim time");
  }
  
  // Example: Create merkle tree with sample rewards
  // In production, this would come from backend calculations
  const rewards = [
    { provider: "0x1111111111111111111111111111111111111111", amount: hre.ethers.parseEther("100") },
    { provider: "0x2222222222222222222222222222222222222222", amount: hre.ethers.parseEther("200") },
    { provider: "0x3333333333333333333333333333333333333333", amount: hre.ethers.parseEther("150") },
  ];
  
  // Build merkle tree
  const leaves = rewards.map((r) =>
    keccak256(hre.ethers.solidityPacked(["address", "uint256"], [r.provider, r.amount]))
  );
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const root = tree.getHexRoot();
  
  // Calculate total amount
  const totalAmount = rewards.reduce((sum, r) => sum + r.amount, 0n);
  
  console.log("Merkle root:", root);
  console.log("Total amount:", hre.ethers.formatEther(totalAmount), "CLD");
  console.log("Number of providers:", rewards.length);
  
  // Check budget (informational - validation happens at claim time)
  const budget = await emissionController.getPouwBudget(currentEpoch);
  if (budget > 0) {
    console.log("PoUW budget for epoch:", hre.ethers.formatEther(budget), "CLD");
    if (totalAmount > budget) {
      console.warn("⚠️  Warning: Total amount exceeds budget!");
      console.warn("   Claims will fail until budget is increased or amount is reduced");
    } else {
      console.log("✓ Total amount is within budget");
    }
  } else {
    console.log("ℹ️  Budget not yet set (epoch not processed)");
    console.log("   Budget validation will happen at claim time");
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

