/**
 * Merkle Tree Builder Utility
 * For backend use to generate merkle roots and proofs
 * 
 * Usage:
 *   node merkle-builder.js <epoch> <rewards-json-file>
 * 
 * Example rewards-json-file format:
 * [
 *   { "provider": "0x...", "amount": "1000000000000000000" },
 *   { "provider": "0x...", "amount": "2000000000000000000" }
 * ]
 */

const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");
const fs = require("fs");
const ethers = require("ethers");

function buildMerkleTree(rewards) {
  // Create leaves: keccak256(abi.encodePacked(provider, amount))
  const leaves = rewards.map((r) =>
    keccak256(
      ethers.solidityPacked(
        ["address", "uint256"],
        [r.provider, r.amount]
      )
    )
  );
  
  // Build tree
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const root = tree.getHexRoot();
  
  // Calculate total amount
  const totalAmount = rewards.reduce(
    (sum, r) => sum + BigInt(r.amount),
    0n
  );
  
  // Generate proofs for all providers
  const proofs = rewards.map((r) => {
    const leaf = keccak256(
      ethers.solidityPacked(
        ["address", "uint256"],
        [r.provider, r.amount]
      )
    );
    return {
      provider: r.provider,
      amount: r.amount,
      proof: tree.getHexProof(leaf),
    };
  });
  
  return {
    root,
    totalAmount: totalAmount.toString(),
    tree: tree.toString(),
    proofs,
  };
}

function main() {
  const epoch = process.argv[2];
  const rewardsFile = process.argv[3];
  
  if (!epoch || !rewardsFile) {
    console.error("Usage: node merkle-builder.js <epoch> <rewards-json-file>");
    process.exit(1);
  }
  
  // Load rewards
  const rewards = JSON.parse(fs.readFileSync(rewardsFile, "utf8"));
  
  console.log(`Building merkle tree for epoch ${epoch}...`);
  console.log(`Number of providers: ${rewards.length}`);
  
  // Build tree
  const result = buildMerkleTree(rewards);
  
  console.log("\n=== Merkle Tree Data ===");
  console.log("Root:", result.root);
  console.log("Total Amount:", ethers.formatEther(result.totalAmount), "CLD");
  console.log("\nTree structure:");
  console.log(result.tree);
  
  // Save results
  const output = {
    epoch,
    root: result.root,
    totalAmount: result.totalAmount,
    rewards: rewards,
    proofs: result.proofs,
    tree: result.tree,
  };
  
  const outputFile = `merkle-epoch-${epoch}.json`;
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  
  console.log(`\nResults saved to ${outputFile}`);
  console.log("\nTo publish on-chain, use:");
  console.log(`  merkleRewards.setRoot(${epoch}, "${result.root}", ${result.totalAmount})`);
  
  console.log("\nExample claim proof for first provider:");
  if (result.proofs.length > 0) {
    console.log("  Provider:", result.proofs[0].provider);
    console.log("  Amount:", result.proofs[0].amount);
    console.log("  Proof:", JSON.stringify(result.proofs[0].proof));
  }
}

if (require.main === module) {
  main();
}

module.exports = { buildMerkleTree };

