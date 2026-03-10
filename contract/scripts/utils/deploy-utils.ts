import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Helper function to wait for a specified number of milliseconds
export function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to deploy with retry logic
export async function deployWithRetry(
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
export async function sendTransactionWithRetry(
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

// Helper function to check for pending transactions
export async function waitForPendingTransactions(deployer: ethers.Signer) {
  console.log("\nChecking for pending transactions...");
  for (let i = 0; i < 30; i++) {
    const pendingNonce = await ethers.provider.getTransactionCount(deployer.address, "pending");
    const confirmedNonce = await ethers.provider.getTransactionCount(deployer.address, "latest");
    
    if (pendingNonce === confirmedNonce) {
      console.log(`No pending transactions. Ready to deploy (nonce: ${confirmedNonce}).`);
      return;
    }
    
    console.log(`Waiting for ${pendingNonce - confirmedNonce} pending transaction(s) to clear... (${i + 1}/30)`);
    await delay(3000);
    
    if (i === 29) {
      throw new Error(`Timeout: Pending transactions did not clear after 90 seconds. Please try again later.`);
    }
  }
}

// Helper function to save contract address and ABI
export async function saveContractInfo(
  contractName: string,
  contractAddress: string,
  networkName: string,
  chainId: number
) {
  const sharedDir = path.join(__dirname, "../../../shared");
  if (!fs.existsSync(sharedDir)) {
    fs.mkdirSync(sharedDir, { recursive: true });
  }

  // Update addresses file
  const addressesFile = path.join(sharedDir, `addresses.${networkName}.json`);
  let addresses: any = {};
  
  if (fs.existsSync(addressesFile)) {
    addresses = JSON.parse(fs.readFileSync(addressesFile, "utf8"));
  } else {
    addresses = {
      chainId,
      network: networkName,
      contracts: {},
    };
  }
  
  if (!addresses.contracts) {
    addresses.contracts = {};
  }
  
  addresses.contracts[contractName] = contractAddress;
  addresses.chainId = chainId;
  addresses.network = networkName;
  
  fs.writeFileSync(addressesFile, JSON.stringify(addresses, null, 2));
  console.log(`Addresses updated in ${addressesFile}`);

  // Export ABI
  const abiDir = path.join(sharedDir, "abi");
  if (!fs.existsSync(abiDir)) {
    fs.mkdirSync(abiDir, { recursive: true });
  }

  const artifactsPath = path.join(__dirname, "../../artifacts/contracts");
  const contractAbi = JSON.parse(
    fs.readFileSync(
      path.join(artifactsPath, `${contractName}.sol/${contractName}.json`),
      "utf8"
    )
  ).abi;

  fs.writeFileSync(
    path.join(abiDir, `${contractName}.json`),
    JSON.stringify(contractAbi, null, 2)
  );
  console.log(`${contractName} ABI exported to ${abiDir}`);
}
