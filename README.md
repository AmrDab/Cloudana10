# Cloudana

[![Network: Base Sepolia](https://img.shields.io/badge/Network-Base%20Sepolia-0052FF?style=flat-square&logo=coinbase)](https://sepolia.basescan.org)
[![Chain ID: 84532](https://img.shields.io/badge/Chain%20ID-84532-blue?style=flat-square)](https://sepolia.basescan.org)
[![Version: MVP](https://img.shields.io/badge/Version-MVP-green?style=flat-square)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

**Cloudana** is a DePIN (Decentralized Physical Infrastructure Network) compute marketplace built on Base Sepolia. Users deploy containerized workloads on a global network of providers -- no AWS, no middlemen, no auctions.

Live at: **https://cloudana.cloud**

---

## Architecture

```
                  Base Sepolia (Chain ID 84532)
          WorkloadRegistry  *  ProviderRegistry  *  CLDToken
                        |            |
                        |   Events + Transactions
                        |
              +-----------+----------+
              |                      |
     +--------+---------+   +--------+---------+
     |   Orchestrator   |   |   Provider Node  |  x M providers
     |   (Hono / Node)  +-->|   (Hono / Node)  |
     |                  |   |                  |
     | - Listen events  |   | - Accept deploys |
     | - Match provider |   | - Run GPU mining |
     | - Push workload  |   | - Report status  |
     +------------------+   +--------+---------+
                                     |
                               kubectl / K8s API
                                     |
                            +--------+---------+
                            |  K3s / Kubernetes |
                            |  (per provider)   |
                            | - Isolated NS     |
                            | - User workloads  |
                            +------------------+
```

**Pattern: 1 Orchestrator + M Provider Nodes**

- Orchestrator: event-driven, watches the chain, pushes workloads instantly (no bidding/auction)
- Provider nodes: run OUTSIDE Kubernetes for security isolation -- clear trust boundary between control plane and tenant workloads
- SDL (Akash Stack Definition Language) format for workload manifests -- compatible with awesome-akash templates

---

## Deployed Contracts (Base Sepolia)

| Contract | Address |
|---|---|
| CLDToken | `0xcfd19DF5a3f963Dabf52aC7B46d4780Cc0E599e2` |
| WorkloadRegistry | `0x71a36e548a884019b4A60947551efB8229e2016a` |
| ProviderRegistry | `0x1e7b0039bdC27cB6B1e83d96D5Ad839fD15Af94a` |
| RewardContract | `0x427830A20C4752eb30C47e0d2572A457ebF4A8AD` |
| POUWVerifier | `0xc15c61E35D6d73dEf14460a1C7010fd169eD2e7F` |

Explorer: [https://sepolia.basescan.org](https://sepolia.basescan.org)

---

## Monorepo Structure

```
cloudana-mvp/
+-- client/                  # React 19 + TypeScript + Vite frontend (port 7003)
|   +-- api/                 # Hono.js orchestrator (port 7002)
+-- provider-node-server/    # Provider node HTTP server (port 4040)
+-- contract/                # Solidity contracts (Hardhat)
+-- pouw/                    # cuPOW TypeScript core
+-- pouw-gpu/                # Rust GPU miner
+-- circuits/                # Circom zkSNARK circuit (pouw_verify.circom)
+-- shared/                  # ABI files + contract addresses
```

---

## POUW -- Proof of Useful Work

Cloudana implements the **Komargodski & Weinstein 2025 cuPOW algorithm** for mining rewards.

**How it works:**

1. Provider receives a work certificate challenge
2. Performs matrix multiplication (n=128) with transcript hashing
3. Submits proof to `POUWVerifier` on-chain
4. Earns CLD tokens per verified certificate

**Parameters:**

| Parameter | Value |
|---|---|
| Algorithm | cuPOW (matrix multiply + transcript hash) |
| Difficulty | 12 |
| Matrix size (n) | 128 |
| Certs per TFLOP-day | 4.7 |
| Reward per cert (testnet) | 56 CLD |
| Mining pool (testnet) | 1,000,000 CLD (workload ID 999) |
| zkSNARK circuit | `circuits/pouw_verify.circom` |

**Mainnet mining:** inflationary minting, no hard cap, tail emission floor ~0.1 CLD/proof.

GPU miner: `pouw-gpu/` (Rust). CPU miner: `pouw/` (TypeScript).

---

## Tokenomics

| Item | Value |
|---|---|
| Testnet supply | 2,000,000 CLD (pre-minted) |
| Testnet mining pool | 1,000,000 CLD |
| Mainnet model | Inflationary minting -- no hard cap |
| Tail emission floor | ~0.1 CLD/proof |
| Fee split | 80% provider / 15% burned (EIP-1559) / 5% treasury |
| Provider bond | 1,000 CLD (refundable) |

---

## Hardware Tiers

Compute Score (CS) = `TFLOPS*10 + VRAM_GB*2 + CPU_threads*4 + RAM_GB*0.8`

| Tier | CS Range | Example Hardware |
|---|---|---|
| T1 Edge | < 50 | Raspberry Pi, NUC -- no GPU |
| T2 Consumer | 50 - 400 | Gaming PC, entry GPU |
| T3 Prosumer | 400 - 1000 | RTX 3090 / 4090 |
| T4 Professional | 1000 - 3000 | A100, L40S |
| T5 Enterprise | 3000+ | H100, B100, multi-GPU |

**Hardware auto-scan:** Provider node exposes `GET /hardware-scan` -- runs `nvidia-smi` (NVIDIA) or `rocm-smi` (AMD) and returns GPU name, VRAM, driver, utilization, TFLOPS, Compute Score, and tier. Orchestrator validates and stores results in MongoDB. Frontend shows a "Scan Hardware" button with a verified badge on the provider dashboard.

---

## Provider Node API

| Endpoint | Method | Description |
|---|---|---|
| `/device-info` | GET | Hardware specs + device ID |
| `/hardware-scan` | GET | Full GPU/CPU/RAM scan with Compute Score |
| `/deploy` | POST | Accept workload from orchestrator |
| `/status` | GET | List all running instances |
| `/workload/:id/status` | GET | Detailed workload status |
| `/workload/:id/logs` | GET | Container logs |
| `/workload/:id/endpoints` | GET | Service URLs |
| `/health` | GET | Health check |
| `/metrics` | GET | Prometheus-compatible metrics |
| `/diagnostics` | GET | System diagnostics |
| `DELETE /workload/:id` | DELETE | Terminate workload |

---

## Running Locally

**Prerequisites:** Node.js 18+, MongoDB on port 27017

```bash
# 1. Frontend (http://localhost:7003)
npm install
npm run dev

# 2. Orchestrator (http://localhost:7002)
cd client/api && npm install && npm run dev

# 3. Provider node -- optional, needs kubectl configured (http://localhost:4040)
cd provider-node-server && npm install && npm run dev
```

### Environment Files

**Frontend** -- `client/.env.local`:
```
VITE_API_URL=http://localhost:7002
VITE_WALLETCONNECT_PROJECT_ID=<your_project_id>
VITE_PINATA_JWT=<your_pinata_jwt>
```

**Orchestrator** -- `client/api/.env`:
```
ORCHESTRATOR_PRIVATE_KEY=<private_key>
RPC_URL=https://sepolia.base.org
POUW_DIFFICULTY=12
POUW_MATRIX_SIZE=128
```

**Provider node** -- `provider-node-server/.env`:
```
POUW_PROVIDER_ADDRESS=<wallet_address>
ORCHESTRATOR_URL=http://localhost:7002
```

---

## Deploying a Provider (Production)

Runs on Ubuntu 22.04+ VPS. Minimum: 4 CPU cores, 8 GB RAM, 50 GB SSD.

```bash
# 1. Install K3s
curl -sfL https://get.k3s.io | sh -

# 2. Set up kubeconfig
mkdir -p ~/.kube && sudo cat /etc/rancher/k3s/k3s.yaml > ~/.kube/config

# 3. Install and start provider node
cd provider-node-server && bash install-provider.sh
sudo systemctl start cloudana-provider-node

# 4. Get device ID and register on-chain
curl http://localhost:4040/device-info
# Then: connect wallet at https://cloudana.cloud, approve 1000 CLD bond, register
```

Provider node runs **outside** Kubernetes -- this is by design. K3s handles tenant workload isolation via namespaces (`cloudana-<workload_id>-<instance_id>`).

---

## Deploying a Workload (Users)

1. Visit [https://cloudana.cloud](https://cloudana.cloud) and connect a MetaMask wallet on Base Sepolia
2. Get testnet ETH from the [Base Sepolia faucet](https://faucet.quicknode.com/base/sepolia) and CLD tokens
3. Choose an SDL template (Nginx, PostgreSQL, etc.) or write a custom manifest
4. Click "Deploy" -- sign the `registerWorkload()` transaction
5. Orchestrator detects the on-chain event, matches a provider, and pushes the K8s manifest
6. Workload is running in ~30-120 seconds

**End-to-end timing:**

| Phase | Duration |
|---|---|
| Blockchain transaction | 10-30 s |
| Orchestrator detection | 0-60 s |
| Provider matching + HTTP push | 2-5 s |
| K8s resource creation + image pull | 15-90 s |
| **Total** | **~30-120 s** |

---

## Cloudana vs Akash

| Aspect | Cloudana | Akash |
|---|---|---|
| Workload delivery | Push (instant) | Pull (bid/auction) |
| Orchestration | 1 centralized orchestrator (MVP) | Fully decentralized |
| Provider setup | Simple -- receive assignments | Complex -- bidding engine |
| Time to running | ~30-120 s | 2-10 min (auction + user choice) |
| SDL compatibility | Yes (awesome-akash templates) | Yes (native) |
| AKT dependency | No | Yes |
| Token | CLD | AKT |

Cloudana uses the same SDL manifest format as Akash -- templates from the [awesome-akash](https://github.com/akash-network/awesome-akash) library deploy without modification.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, TailwindCSS, Shadcn/ui |
| Wallet | Wagmi + Viem, Reown AppKit (WalletConnect) |
| Orchestrator | Hono.js, Node.js 18+, MongoDB |
| Provider node | Hono.js, Node.js 18+, @kubernetes/client-node, Pino |
| Blockchain | Solidity 0.8.20, Hardhat, OpenZeppelin |
| Network | Base Sepolia (L2), Chain ID 84532 |
| Container runtime | K3s / Kubernetes |
| POUW core | TypeScript (pouw/), Rust GPU miner (pouw-gpu/) |
| zkSNARK | Circom, SnarkJS |
| Storage | On-chain (critical), IPFS via Pinata (metadata) |

---

## Smart Contract Summary

| Contract | Purpose |
|---|---|
| CLDToken | ERC-20 utility token -- payments, bonds, mining rewards |
| ProviderRegistry | On-chain provider registration, bond management |
| WorkloadRegistry | Workload lifecycle -- register, place, complete |
| RewardContract | Mining reward distribution from pool |
| POUWVerifier | Verifies cuPOW proofs and issues certificates |

Key events from `WorkloadRegistry`:
```solidity
event WorkloadRegistered(uint256 indexed workloadId, address indexed owner, string manifestCID);
event PlacementRecorded(uint256 indexed workloadId, address indexed provider, uint256 instanceId);
```

---

## Roadmap

- [x] Base Sepolia testnet -- contracts, orchestrator, provider node
- [x] SDL workload manifests (Akash-compatible)
- [x] POUW mining -- cuPOW algorithm, GPU miner, zkSNARK verifier
- [x] Hardware auto-scan (nvidia-smi / rocm-smi) + Compute Score tiers
- [ ] Security audit
- [ ] Mainnet deployment (Base)
- [ ] GPU workload support
- [ ] Persistent storage (Rook/Ceph)
- [ ] Custom domains + SSL termination
- [ ] Multiple orchestrators for redundancy
- [ ] Decentralized orchestration (staked rotation)
- [ ] Governance

---

## License

MIT
