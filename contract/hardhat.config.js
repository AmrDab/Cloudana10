require("@nomicfoundation/hardhat-toolbox");
const dotenv = require('dotenv')
dotenv.config({ path: './.env' })

// Configure networks conditionally based on environment variables
const networks = {
  base_sepolia: {
    chainId: 84532
  }
};

// Only add base_sepolia network if environment variables are set
if (process.env.BASE_SEPOLIA_RPC_URL && process.env.DEPLOYER_PRIVATE_KEY && process.env.CHAIN_ID) {
  // Only deployer needs a private key (for signing transactions)
  // Validator and treasury admin are just addresses, not signers
  const accounts = [process.env.DEPLOYER_PRIVATE_KEY.trim()];
  
  console.log("✓ Deployer account configured for base_sepolia network");
  console.log("ℹ️  Note: Validator and treasury admin addresses should be set in .env as VALIDATOR_ADDRESS and TREASURY_ADMIN_ADDRESS");
  
  networks.base_sepolia = {
    url: process.env.BASE_SEPOLIA_RPC_URL,
    accounts: accounts,
    chainId: Number(process.env.CHAIN_ID),
  };
}
/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  defaultNetwork: 'base_sepolia', // Use hardhat network by default
  networks: networks,
  solidity: {
    compilers: [
      {
        version: '0.8.28',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000,
          },
          evmVersion: 'istanbul', // Compatible with 0.8.28
        },
      }
    ]
  },
  paths: {
    sources: './contracts',
    cache: './cache',
    artifacts: './artifacts',
  },
  mocha: {
    timeout: 20000,
  },
  etherscan: {
    apiKey: process.env.BASE_SEPOLIA_ETHERSCAN_API_KEY,
    customChains: [
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org"
        }
      }
    ]
  },
  sourcify: {
    enabled: true
  }
};
