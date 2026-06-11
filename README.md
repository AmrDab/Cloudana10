# Cloudana DePIN MVP

A decentralized physical infrastructure network (DePIN) for compute resource sharing, built on Base Sepolia.

## 🎯 Architecture

This is a **trust-minimized DePIN application**:
- ✅ **On-chain settlement** - Provider registry, staking, slashing, and CLD rewards live in smart contracts on Base Sepolia
- ✅ **Orchestrator-coordinated (testnet)** - An open-source orchestrator verifies PoUW certificates and coordinates workloads; mainnet replaces its attestation with zkSNARK verification (see `circuits/`)
- ✅ **Decentralized storage** - IPFS for metadata
- ✅ **Honest about the trust model** - see `DECENTRALIZATION_ROADMAP.md` for what is decentralized today vs. planned

## 🏗️ Tech Stack

### Frontend
- **React** + **TypeScript** + **Vite**
- **Wagmi** + **Viem** - Ethereum interactions
- **Reown AppKit** - Wallet connection
- **TailwindCSS** - Styling
- **Shadcn/ui** - UI components

### Smart Contracts
- **Solidity 0.8.20**
- **OpenZeppelin** - Security & standards
- **Hardhat** - Development & deployment

### Storage
- **On-chain**: Owner, pubKeyHash, IPFS CID, bond, status
- **IPFS**: Full node metadata (hardware specs, location, etc.)

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- MetaMask or compatible wallet
- Base Sepolia testnet ETH

### For Users (Deploy Workloads)

```bash
# Install dependencies and start frontend
npm install
npm run dev
```

Visit `http://localhost:5002` to:
- Register workloads
- Browse providers
- Monitor deployments

### For Orchestrators (Event-Driven Placement)

```bash
# Start orchestrator API (listens to blockchain events)
cd client/api
npm install
npm run dev

# Requires ORCHESTRATOR_PRIVATE_KEY in .env
```

The orchestrator automatically:
- Monitors WorkloadRegistry events
- Matches workloads to providers
- Deploys to provider nodes
- Records placement on-chain

### For Providers (Run Infrastructure)

```bash
# Install and run provider node
cd provider-node-server
npm install
npm run dev

# Requires kubectl access to Kubernetes cluster
# See provider-node-server/README.md for production deployment
```

Provider nodes:
- Accept deployment requests
- Execute workloads on K8s
- Report status
- Provide hardware specs

**Architecture:** Providers run **outside** K8s clusters for security isolation.

### Smart Contract Deployment

```bash
cd contract
npm install
npx hardhat compile
npx hardhat run scripts/deploy.ts --network baseSepolia
```

After deployment, contracts are auto-registered in `shared/addresses.baseSepolia.json`.

## 📁 Project Structure

```
cloudana-mvp/
├── client/                      # Frontend application + Orchestrator API
│   ├── src/                     # Frontend (React + Vite)
│   │   ├── components/          # UI components
│   │   ├── hooks/               # Custom hooks
│   │   ├── lib/                 # Utilities & contract hooks
│   │   ├── pages/               # Page components
│   │   └── context/             # React context
│   └── api/                     # Orchestrator backend (Hono + Node.js)
│       ├── src/services/        # Placement, SDL parsing, K8s building
│       └── src/routes/          # Orchestration API endpoints
├── provider-node-server/        # Provider node (runs per provider)
│   ├── src/
│   │   ├── index.ts             # Workload execution server
│   │   └── k8s-client.ts        # Kubernetes client wrapper
│   └── README.md                # Provider deployment guide
├── contract/                    # Smart contracts (Solidity)
│   ├── contracts/               # WorkloadRegistry, ProviderRegistry, etc.
│   ├── scripts/                 # Deployment scripts
│   └── test/                    # Contract tests
├── shared/                      # Shared types & ABIs
│   ├── abi/                     # Contract ABIs (auto-generated)
│   ├── addresses.*.json         # Deployed contract addresses
│   └── contracts.ts             # Contract address exports
└── DEPIN_MIGRATION.md          # Migration documentation
```

### Architecture Components

```
┌─────────────────────────────────────────────────────────┐
│                 Blockchain (Base Sepolia)               │
│  • WorkloadRegistry  • ProviderRegistry  • Rewards     │
└────────────────────┬────────────────────────────────────┘
                     │ Events, state, transactions
      ┌──────────────┴─────────────────┐
      │                                │
      ↓                                ↓
┌──────────────────┐          ┌─────────────────────────┐
│   Orchestrator   │          │  Provider Node          │
│   (client/api)   │          │  (per provider)         │
│                  │          │                         │
│ • Event listener │──HTTP───>│ • Workload execution   │
│ • Placement algo │ /deploy  │ • K8s management       │
│ • SDL parsing    │          │ • Status reporting     │
└──────────────────┘          └──────────┬──────────────┘
                                         │ kubectl/K8s API
                                         ↓
                              ┌────────────────────────┐
                              │  Kubernetes Cluster(s) │
                              │  • Tenant workloads    │
                              │  • Isolated namespaces │
                              └────────────────────────┘
```

**Key design principle:** Provider nodes run **outside** Kubernetes for security isolation,
similar to Akash's architecture. See [Provider Node README](./provider-node-server/README.md).

## 🔑 Key Features

### Provider Registration
1. Fill in node details (hardware specs, location, etc.)
2. Upload metadata to IPFS
3. Approve CLD token bond (1000 CLD)
4. Register on-chain with pubKeyHash + IPFS CID
5. Start earning from compute jobs

### Contract Interaction
- Registration, staking, and rewards settle on-chain
- Real-time blockchain events
- PoUW certificates verified by the orchestrator on testnet; zkSNARK on-chain verification is the mainnet milestone
- Transparent on-chain data

### IPFS Metadata Storage
- Detailed hardware specifications
- Location information
- Provider description
- Immutable and verifiable

## 💰 Tokenomics

### CLD Token
- **Initial Supply**: 1,000,000 CLD
- **Distribution**: 80% Treasury, 20% Team

### Provider Bond
- **Amount**: 1000 CLD per node
- **Fee Split**: 80% Treasury, 20% Team
- **Max Nodes**: 10 per wallet

## 🔗 Smart Contracts

### CLDToken
ERC-20 token with minting and burning capabilities.

### ProviderRegistry
Minimal on-chain registry storing:
- Owner address
- Public key hash (node ID)
- IPFS CID (metadata pointer)
- Bond amount
- Status (Registered/Active/Inactive)

### JobEscrow
Escrow system for job payments with:
- Job creation and deposits
- Usage reporting (EIP-712 signatures)
- Provider earnings tracking
- User refund management

## 🌐 Network

- **Chain**: Base Sepolia Testnet
- **Chain ID**: 84532
- **RPC**: https://sepolia.base.org
- **Explorer**: https://sepolia.basescan.org

## 📝 Environment Variables

```env
# Required
VITE_WALLET_CONNECT_PROJECT_ID=your_project_id

# Optional (for production IPFS)
VITE_PINATA_JWT=your_pinata_jwt
VITE_PINATA_GATEWAY=your_gateway_url
```

## 🧪 Testing

```bash
# Frontend type checking
npm run check

# Smart contract tests
cd contract
npx hardhat test
```

## 📚 Documentation

- [Provider Architecture](./PROVIDER_ARCHITECTURE.md) - **Why providers run outside K8s (recommended reading)**
- [Provider Node Deployment](./provider-node-server/README.md) - Production deployment guide
- [Orchestrator Design](./ORCHESTRATOR_CONTRACT_ADDRESS_DESIGN.md) - Contract address architecture
- [DePIN Migration Guide](./DEPIN_MIGRATION.md) - Complete migration documentation

## 🛠️ Development

### Adding New Features
1. Update smart contracts if needed
2. Deploy and update ABIs
3. Create/update contract hooks in `client/src/lib/contracts.ts`
4. Build UI components
5. Test end-to-end

### IPFS Integration
Current implementation uses mock IPFS. For production:

```typescript
// Install Pinata SDK
npm install pinata-web3

// Update client/src/lib/api.ts
import { PinataSDK } from "pinata-web3";

const pinata = new PinataSDK({
  pinataJwt: process.env.VITE_PINATA_JWT,
  pinataGateway: process.env.VITE_PINATA_GATEWAY,
});

export async function uploadToIPFS(metadata: ProviderMetadata) {
  const upload = await pinata.upload.json(metadata);
  return upload.IpfsHash;
}
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🔐 Security

- Smart contracts use OpenZeppelin libraries
- EIP-712 signatures for usage reports
- Access control for privileged functions
- Reentrancy guards on financial functions

## 🚨 Important Notes

- This is a testnet MVP - not audited for production
- Use testnet tokens only
- Smart contracts are upgradeable (UUPS pattern available)
- IPFS integration is currently mocked for development

## 📞 Support

For issues and questions:
- Open a GitHub issue
- Check existing documentation
- Review smart contract comments

---

**Built with ❤️ for the DePIN ecosystem**

