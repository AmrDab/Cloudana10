# Cloudana DePIN MVP

A decentralized physical infrastructure network (DePIN) for compute resource sharing, built on Base Sepolia.

## 🎯 Architecture

This is a **true DePIN application** with:
- ✅ **No backend server** - Direct smart contract interaction
- ✅ **No database** - All data on-chain or IPFS
- ✅ **No WebSocket** - Real-time events via blockchain
- ✅ **Decentralized storage** - IPFS for metadata
- ✅ **Trustless** - Users interact directly with contracts

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

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

Visit `http://localhost:5002`

### Smart Contract Deployment

```bash
cd contract
npm install
npx hardhat compile
npx hardhat run scripts/deploy.ts --network baseSepolia
```

After deployment, update `shared/contracts.ts` with new addresses.

## 📁 Project Structure

```
cloudana-mvp/
├── client/                 # Frontend application
│   ├── src/
│   │   ├── components/    # UI components
│   │   ├── hooks/         # Custom hooks
│   │   ├── lib/           # Utilities & contract hooks
│   │   ├── pages/         # Page components
│   │   └── context/       # React context
├── contract/              # Smart contracts
│   ├── contracts/         # Solidity contracts
│   ├── scripts/           # Deployment scripts
│   └── test/              # Contract tests
├── shared/                # Shared types & ABIs
│   ├── abi/              # Contract ABIs
│   └── contracts.ts       # Contract addresses
└── DEPIN_MIGRATION.md    # Migration documentation
```

## 🔑 Key Features

### Provider Registration
1. Fill in node details (hardware specs, location, etc.)
2. Upload metadata to IPFS
3. Approve CLD token bond (1000 CLD)
4. Register on-chain with pubKeyHash + IPFS CID
5. Start earning from compute jobs

### Direct Contract Interaction
- No API calls to backend
- Real-time blockchain events
- Trustless verification
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

- [DePIN Migration Guide](./DEPIN_MIGRATION.md) - Complete migration documentation
- [API Configuration](./API_CONFIGURATION.md) - API setup (legacy)
- [Deployment Guide](./DEPLOYMENT.md) - Deployment instructions

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

