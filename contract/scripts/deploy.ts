import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Helper function to wait for a specified number of milliseconds
function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// Helper function to deploy with retry logic
async function deployWithRetry(
  contractFactory: ethers.ContractFactory,
  args: any[],
  label: string,
  deployer: ethers.Signer,
  maxRetries: number = 5
) {
  console.log(`\nDeploying ${label}...`);
  
  let lastContract: any = null;
  let initialNonce = await ethers.provider.getTransactionCount(deployer.address, "latest");
  console.log(`Current nonce: ${initialNonce}`);
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Let ethers handle nonce automatically - don't specify nonce manually
      const contract = await contractFactory.deploy(...args);
      lastContract = contract;
      console.log(`Transaction hash: ${contract.deploymentTransaction()?.hash}`);
      console.log(`Waiting for confirmation...`);
      
      // Wait for deployment to be mined
      await contract.waitForDeployment();
      
      const contractAddress = await contract.getAddress();
      console.log(`${label} deployed to: ${contractAddress}`);
      
      return contract;
    } catch (error: any) {
      const errorMessage = error?.message || error?.toString() || "";
      const isAlreadyKnown = errorMessage.includes("already known");
      const isNonceError = isAlreadyKnown ||
                          errorMessage.includes("nonce too low") || 
                          errorMessage.includes("replacement transaction underpriced") ||
                          errorMessage.includes("nonce has already been used");
      
      if (isNonceError && attempt < maxRetries) {
        console.log(`Transaction error (attempt ${attempt}/${maxRetries}): ${errorMessage}`);
        
        // If "already known", the transaction is in mempool - wait and don't retry
        if (isAlreadyKnown) {
          console.log(`Transaction already in mempool. Waiting for it to be mined...`);
          
          // Wait longer for the transaction to be mined
          for (let wait = 0; wait < 30; wait++) {
            await delay(2000); // Check every 2 seconds for up to 60 seconds
            
            const currentNonce = await ethers.provider.getTransactionCount(deployer.address, "latest");
            if (currentNonce > initialNonce) {
              console.log(`Transaction mined! Nonce advanced from ${initialNonce} to ${currentNonce}.`);
              
              // Try to find the transaction with the specific nonce
              console.log(`Searching for transaction with nonce ${initialNonce}...`);
              const latestBlock = await ethers.provider.getBlockNumber();
              
              // Search recent blocks for the deployment transaction
              for (let blockOffset = 0; blockOffset < 20; blockOffset++) {
                const blockNum = latestBlock - blockOffset;
                if (blockNum < 0) break;
                
                try {
                  const block = await ethers.provider.getBlock(blockNum);
                  if (!block || !block.transactions) continue;
                  
                  // Check each transaction hash
                  for (const txHash of block.transactions) {
                    try {
                      const tx = await ethers.provider.getTransaction(txHash);
                      if (tx && 
                          tx.from.toLowerCase() === deployer.address.toLowerCase() && 
                          tx.nonce === initialNonce) {
                        console.log(`Found transaction: ${txHash}`);
                        
                        // Get receipt to find contract address
                        const receipt = await ethers.provider.getTransactionReceipt(txHash);
                        if (receipt && receipt.contractAddress) {
                          console.log(`Contract deployed at: ${receipt.contractAddress}`);
                          const contract = contractFactory.attach(receipt.contractAddress);
                          return contract;
                        }
                      }
                    } catch (txError) {
                      // Skip transaction if there's an error fetching it
                      continue;
                    }
                  }
                } catch (blockError) {
                  // Skip block if there's an error
                  continue;
                }
              }
              
              throw new Error(
                `${label} deployment transaction was mined but contract address could not be found.\n` +
                `Check blockchain explorer for transactions from ${deployer.address} with nonce ${initialNonce}.`
              );
            }
            
            console.log(`Still waiting... (${(wait + 1) * 2}s)`);
          }
          
          throw new Error(`Transaction timeout: still in mempool after 60 seconds.`);
        }
        
        // For other nonce errors, wait and retry
        const waitTime = attempt * 5000; // Longer backoff: 5s, 10s, 15s, 20s
        console.log(`Waiting ${waitTime}ms before retry...`);
        await delay(waitTime);
        
        // Update initial nonce
        initialNonce = await ethers.provider.getTransactionCount(deployer.address, "latest");
        continue;
      }
      
      // If not a nonce error or max retries reached, throw
      console.error(`Deployment error (attempt ${attempt}/${maxRetries}): ${errorMessage}`);
      throw error;
    }
  }
  
  throw new Error(`Failed to deploy ${label} after ${maxRetries} attempts`);
}

// Helper function to send transaction with retry logic
async function sendTransactionWithRetry(
  contract: ethers.Contract,
  methodName: string,
  args: any[],
  deployer: ethers.Signer,
  maxRetries: number = 3
) {
  const initialNonce = await ethers.provider.getTransactionCount(deployer.address, "latest");
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Let ethers handle nonce automatically
      const tx = await contract.connect(deployer)[methodName](...args);
      
      console.log(`Transaction hash: ${tx.hash}`);
      await tx.wait();
      return tx;
    } catch (error: any) {
      const errorMessage = error?.message || error?.toString() || "";
      const isAlreadyKnown = errorMessage.includes("already known");
      const isNonceError = isAlreadyKnown ||
                          errorMessage.includes("nonce too low") || 
                          errorMessage.includes("replacement transaction underpriced") ||
                          errorMessage.includes("nonce has already been used");
      
      if (isNonceError && attempt < maxRetries) {
        console.log(`Transaction error (attempt ${attempt}/${maxRetries}): ${errorMessage}`);
        
        // If "already known", wait for the transaction to be mined
        if (isAlreadyKnown) {
          console.log(`Transaction already in mempool. Waiting for it to be mined...`);
          
          for (let wait = 0; wait < 15; wait++) {
            await delay(2000);
            
            const currentNonce = await ethers.provider.getTransactionCount(deployer.address, "latest");
            if (currentNonce > initialNonce) {
              console.log(`Transaction mined successfully!`);
              // Transaction was mined, consider it successful
              return null as any; // Return success even though we don't have tx reference
            }
            
            console.log(`Waiting... (${(wait + 1) * 2}s)`);
          }
          
          throw new Error(`Transaction timeout after 30 seconds.`);
        }
        
        // For other nonce errors, wait and retry
        const waitTime = attempt * 3000;
        console.log(`Waiting ${waitTime}ms before retry...`);
        await delay(waitTime);
        continue;
      }
      
      console.error(`Transaction error (attempt ${attempt}/${maxRetries}): ${errorMessage}`);
      throw error;
    }
  }
  
  throw new Error(`Failed to send transaction after ${maxRetries} attempts`);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  
  const TEAM_WALLET = process.env.TEAM_WALLET || deployer.address;
  const TREASURY_WALLET = process.env.TREASURY_WALLET || deployer.address;

  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());
  
  // Check for pending transactions and wait for them to clear
  console.log("\nChecking for pending transactions...");
  for (let i = 0; i < 30; i++) {
    const pendingNonce = await ethers.provider.getTransactionCount(deployer.address, "pending");
    const confirmedNonce = await ethers.provider.getTransactionCount(deployer.address, "latest");
    
    if (pendingNonce === confirmedNonce) {
      console.log(`No pending transactions. Ready to deploy (nonce: ${confirmedNonce}).`);
      break;
    }
    
    console.log(`Waiting for ${pendingNonce - confirmedNonce} pending transaction(s) to clear... (${i + 1}/30)`);
    await delay(3000);
    
    if (i === 29) {
      throw new Error(`Timeout: Pending transactions did not clear after 90 seconds. Please try again later.`);
    }
  }
  
  // Wait a bit before starting deployment to ensure network is ready
  await delay(1000);

  // Deploy CLDToken
  // const CLDToken = await ethers.getContractFactory("CLDToken");
  // const cldToken = await deployWithRetry(CLDToken, [TREASURY_WALLET, TEAM_WALLET], "CLDToken", deployer);
  const cldTokenAddress = "0xcfd19DF5a3f963Dabf52aC7B46d4780Cc0E599e2";
  //const cldTokenAddress = await cldToken.getAddress();
  // console.log("CLDToken deployed to:", cldTokenAddress);
  // // Add a small delay between deployments
  // await delay(1000);

  // Deploy providerRegistry
  const providerRegistryContract = await ethers.getContractFactory("ProviderRegistry");
  const providerRegistry = await deployWithRetry(
    providerRegistryContract,
    [cldTokenAddress, TEAM_WALLET, TREASURY_WALLET],
    "ProviderRegistry",
    deployer
  );
  const providerRegistryAddress = await providerRegistry.getAddress();
  console.log("Team Wallet:", TEAM_WALLET);
  console.log("Treasury Wallet:", TREASURY_WALLET);

  // Add a small delay between deployments
  await delay(1000);

  // Deploy JobEscrow
  // const JobEscrow = await ethers.getContractFactory("JobEscrow");
  // const jobEscrow = await deployWithRetry(
  //   JobEscrow,
  //   [cldTokenAddress, providerRegistryAddress],
  //   "JobEscrow",
  //   deployer
  // );
  // const jobEscrowAddress = await jobEscrow.getAddress();

  // // Grant roles
  // console.log("\nGranting roles...");
  // const MINTER_ROLE = await cldToken.MINTER_ROLE();
  // await sendTransactionWithRetry(cldToken, "grantRole", [MINTER_ROLE, deployer.address], deployer);
  // console.log("Granted MINTER_ROLE to deployer");

  // const VALIDATOR_ADDRESS = process.env.VALIDATOR_ADDRESS || deployer.address;
  // const VALIDATOR_ROLE = await jobEscrow.VALIDATOR_ROLE();
  // await sendTransactionWithRetry(jobEscrow, "grantRole", [VALIDATOR_ROLE, VALIDATOR_ADDRESS], deployer);
  // console.log(`Granted VALIDATOR_ROLE to ${VALIDATOR_ADDRESS}`);

  // // Get network info
  // const network = await ethers.provider.getNetwork();
  // const chainId = Number(network.chainId);
  // const networkName = network.name === "unknown" ? "baseSepolia" : network.name;

  // // Prepare addresses object
  // const addresses = {
  //   chainId,
  //   network: networkName,
  //   contracts: {
  //     CLDToken: cldTokenAddress,
  //     ProviderRegistry: providerRegistryAddress,
  //     JobEscrow: jobEscrowAddress,
  //   },
  //   roles: {
  //     minter: deployer.address,
  //     validator: VALIDATOR_ADDRESS,
  //   },
  // };

  // // Write addresses to shared folder
  // const sharedDir = path.join(__dirname, "../../shared");
  // if (!fs.existsSync(sharedDir)) {
  //   fs.mkdirSync(sharedDir, { recursive: true });
  // }

  // const addressesFile = path.join(sharedDir, `addresses.${networkName}.json`);
  // fs.writeFileSync(addressesFile, JSON.stringify(addresses, null, 2));
  // console.log(`\nAddresses written to ${addressesFile}`);

  // // Export ABIs
  // const abiDir = path.join(sharedDir, "abi");
  // if (!fs.existsSync(abiDir)) {
  //   fs.mkdirSync(abiDir, { recursive: true });
  // }

  // // Read compiled artifacts
  // const artifactsPath = path.join(__dirname, "../artifacts/contracts");
  // const cldTokenAbi = JSON.parse(
  //   fs.readFileSync(path.join(artifactsPath, "CLDToken.sol/CLDToken.json"), "utf8")
  // ).abi;
  // const providerRegistryAbi = JSON.parse(
  //   fs.readFileSync(
  //     path.join(artifactsPath, "ProviderRegistry.sol/ProviderRegistry.json"),
  //     "utf8"
  //   )
  // ).abi;
  // const jobEscrowAbi = JSON.parse(
  //   fs.readFileSync(path.join(artifactsPath, "JobEscrow.sol/JobEscrow.json"), "utf8")
  // ).abi;

  // fs.writeFileSync(path.join(abiDir, "CLDToken.json"), JSON.stringify(cldTokenAbi, null, 2));
  // fs.writeFileSync(
  //   path.join(abiDir, "ProviderRegistry.json"),
  //   JSON.stringify(providerRegistryAbi, null, 2)
  // );
  // fs.writeFileSync(path.join(abiDir, "JobEscrow.json"), JSON.stringify(jobEscrowAbi, null, 2));
  // console.log(`ABIs exported to ${abiDir}`);

  // // Write EIP-712 schema
  // const eip712Dir = path.join(sharedDir, "eip712");
  // if (!fs.existsSync(eip712Dir)) {
  //   fs.mkdirSync(eip712Dir, { recursive: true });
  // }

  // const eip712Schema = {
  //   domain: {
  //     name: "CloudanaJobEscrow",
  //     version: "1",
  //     chainId: chainId,
  //     verifyingContract: jobEscrowAddress,
  //   },
  //   types: {
  //     UsageReport: [
  //       { name: "jobId", type: "uint256" },
  //       { name: "user", type: "address" },
  //       { name: "provider", type: "address" },
  //       { name: "grossCost", type: "uint256" },
  //       { name: "providerEarn", type: "uint256" },
  //       { name: "nonce", type: "uint256" },
  //       { name: "deadline", type: "uint256" },
  //     ],
  //   },
  // };

  // fs.writeFileSync(
  //   path.join(eip712Dir, "usageReport.json"),
  //   JSON.stringify(eip712Schema, null, 2)
  // );
  // console.log(`EIP-712 schema written to ${path.join(eip712Dir, "usageReport.json")}`);

  console.log("\n=== Deployment Summary ===");
  // console.log("CLDToken:", cldTokenAddress);
  // console.log("JobEscrow:", jobEscrowAddress);
  console.log("providerRegistry:", providerRegistryAddress);
  // console.log("Team Wallet:", TEAM_WALLET);
  // console.log("Treasury Wallet:", TREASURY_WALLET);
  // console.log("Validator:", VALIDATOR_ADDRESS);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

