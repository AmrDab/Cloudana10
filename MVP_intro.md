# Cloudana MVP - DePIN Compute Network
## Technical Presentation & Architecture Overview

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [What is Cloudana?](#what-is-cloudana)
3. [Core Architecture](#core-architecture)
4. [System Components](#system-components)
5. [Technical Stack](#technical-stack)
6. [Network Participants](#network-participants)
7. [Workload Execution Flow](#workload-execution-flow)
8. [Smart Contracts](#smart-contracts)
9. [Provider Infrastructure](#provider-infrastructure)
10. [Deployment Guide](#deployment-guide)
11. [Comparison with Akash](#comparison-with-akash)
12. [Tokenomics](#tokenomics)
13. [Security & Architecture Decisions](#security--architecture-decisions)
14. [Future Roadmap](#future-roadmap)

---

## Executive Summary

**Cloudana** is a decentralized physical infrastructure network (DePIN) that enables users to deploy workloads on a global network of compute providers without relying on centralized servers or databases. Built on Base Sepolia blockchain, Cloudana implements a true DePIN architecture with smart contract-based coordination and IPFS-based metadata storage.

**Key Highlights:**
- ✅ Fully decentralized infrastructure (no backend servers, no databases)
- ✅ 1 Orchestrator + M Providers architecture for optimal efficiency
- ✅ Push-based workload delivery for instant deployment
- ✅ Provider node + Kubernetes cluster on single VPS for easy management
- ✅ Complete MVP with smart contracts, orchestrator, and provider infrastructure

**Current Status:** Testnet MVP on Base Sepolia

---

## What is Cloudana?

### Problem Statement

Traditional cloud computing is:
- **Centralized**: AWS, Google Cloud, Azure dominate the market
- **Expensive**: High costs for compute resources
- **Limited**: Geographic and vendor lock-in
- **Opaque**: Hidden pricing and resource allocation

### Cloudana Solution

A **decentralized marketplace** for compute resources where:
- **Users** deploy workloads (containers, applications, services)
- **Providers** offer compute capacity (CPU, GPU, memory, storage)
- **Orchestrator** matches workloads to providers efficiently
- **Smart contracts** handle payments, registration, and coordination
- **IPFS** stores metadata for decentralized data availability

### Use Cases

1. **Web Applications**: Deploy React, Next.js, WordPress sites
2. **AI/ML Workloads**: Run GPU-accelerated inference and training
3. **Gaming Servers**: Host multiplayer game servers
4. **Mining**: Run cryptocurrency miners (CPU/GPU)
5. **Databases**: Deploy PostgreSQL, MongoDB, Redis instances
6. **APIs & Microservices**: Run backend services and APIs

---

## Core Architecture

### True DePIN Principles

```
✅ No Backend Server    - Direct smart contract interaction
✅ No Database          - All data on-chain or IPFS
✅ No WebSocket         - Real-time events via blockchain
✅ Decentralized Storage - IPFS for metadata
✅ Trustless            - Users interact directly with contracts
```

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Blockchain (Base Sepolia)                  │
│   WorkloadRegistry  •  ProviderRegistry                 │
└────────────────────┬────────────────────────────────────┘
                     │ Events & Transactions
        ┌────────────┴────────────┐
        ↓                         ↓
┌──────────────────┐      ┌─────────────────────────┐
│   Orchestrator   │      │   Provider Nodes        │
│   (Event-Driven) │─HTTP→│   (per provider)        │
│                  │      │                         │
│ • Listen events  │      │ • Execute workloads     │
│ • Match providers│      │ • Manage K8s            │
│ • Deploy requests│      │ • Report status         │
└──────────────────┘      └──────────┬──────────────┘
                                     │ kubectl
                                     ↓
                          ┌────────────────────────┐
                          │  Kubernetes Cluster(s) │
                          │  • User workloads      │
                          │  • Isolated namespaces │
                          └────────────────────────┘
```

### Architecture Pattern: 1 + M

**1 Orchestrator (Centralized Matching)**
- Listens to blockchain events
- Matches workloads to providers
- Pushes deployments to providers
- Records placement on-chain

**M Providers (Decentralized Execution)**
- Each provider owns infrastructure (VPS/hardware)
- Runs provider node + K8s cluster
- Executes tenant workloads
- Isolated by namespace

**Why This Pattern?**
- ✅ **Fast deployment**: No auction/bidding delay
- ✅ **Simple providers**: No complex bidding logic
- ✅ **Consistent matching**: Single algorithm
- ✅ **Future-proof**: Can decentralize orchestrator later

---

## System Components

### 1. Frontend Application (React + TypeScript)

**Technology:**
- React 18 + TypeScript + Vite
- Wagmi + Viem for Ethereum interactions
- Reown AppKit for wallet connection
- TailwindCSS + Shadcn/ui components

**User Features:**
- Wallet connection (MetaMask, WalletConnect)
- Workload registration and deployment
- Provider browsing with filtering
- Real-time deployment monitoring
- SDL (Stack Definition Language) editor
- Workload logs and status tracking

**Provider Features:**
- Provider node registration
- Hardware specification input
- IPFS metadata upload
- CLD token bond approval (1000 CLD)
- Provider status dashboard
- Earnings tracking

### 2. Orchestrator API (Node.js + Hono)

**Technology:**
- Node.js 18+ with Hono framework
- Event-driven architecture
- Direct blockchain integration

**Core Responsibilities:**

**Event Listening**
- Monitors `WorkloadRegistry` for new workloads
- Detects on-chain events in real-time
- Maintains event processing queue

**Placement Algorithm**
- Reads workload requirements (CPU, memory, GPU, storage)
- Queries active providers from `ProviderRegistry`
- Fetches provider capacity from IPFS
- Matches based on:
  - Resource availability
  - Geographic location
  - Provider attributes
  - Price/cost optimization

**SDL Parsing**
- Parses Akash-compatible SDL format
- Extracts services, images, resources
- Validates manifest structure

**K8s Manifest Generation**
- Converts SDL to Kubernetes resources
- Creates: Deployments, Services, PVCs, ConfigMaps
- Applies resource limits and requests

**Deployment Execution**
- Sends HTTP POST to provider node
- Payload includes workload ID, instance ID, K8s manifest
- Confirms provider acceptance
- Records placement transaction on-chain

**Status Polling**
- Polls provider nodes for workload status
- Updates on-chain status records
- Provides status API for frontend

### 3. Provider Node Server (TypeScript)

**Technology:**
- Node.js 18+ with Hono framework
- Kubernetes client library (@kubernetes/client-node)
- Structured logging with Pino

**Deployment Location:**
- Runs **outside** Kubernetes cluster
- On host OS (management server/VPS)
- Uses kubectl/K8s API to manage cluster

**Core Responsibilities:**

**Workload Reception**
- `POST /deploy` - Accepts deployment requests
- Validates workload manifest
- Returns immediate acknowledgment
- Executes workload asynchronously

**Kubernetes Execution**
- Creates isolated namespace per workload
- Applies K8s resources in order:
  1. Namespace
  2. ConfigMaps
  3. PersistentVolumeClaims
  4. Deployments
  5. Services
- Monitors pod status and health

**Status Reporting**
- `GET /status` - Lists all workload instances
- `GET /workload/:id/status` - Detailed workload status
- `GET /workload/:id/logs` - Container logs
- `GET /workload/:id/endpoints` - Service URLs

**Hardware Spec Reporting**
- `GET /device-info` - Provides device ID and hardware specs
- Used for on-chain provider registration
- Reports: CPU cores, memory, disk, hostname

**Health Monitoring**
- `GET /health` - Health check endpoint
- `GET /metrics` - Prometheus-compatible metrics
- `GET /diagnostics` - Comprehensive system diagnostics

### 4. Kubernetes Cluster (K3s/K8s)

**Technology:**
- K3s (lightweight Kubernetes) - Recommended
- Full Kubernetes (kubeadm) - Alternative
- Cloud managed K8s (EKS, GKE, AKS) - Enterprise

**Purpose:**
- Executes tenant workloads
- Provides container orchestration
- Manages networking and storage
- Isolates workloads by namespace

**Installation:**
- Automated via K3sService (SSH-based)
- Manual installation option
- Cloud provider integration

---

## Technical Stack

### Blockchain Layer

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Blockchain** | Base Sepolia (Testnet) | L2 with low gas fees |
| **Smart Contracts** | Solidity 0.8.20 | Token, registries, escrow |
| **Development** | Hardhat | Contract development & testing |
| **Libraries** | OpenZeppelin | Security & standards |

### Frontend Layer

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Framework** | React 18 + Vite | Fast, modern UI |
| **Language** | TypeScript | Type safety |
| **Wallet** | Wagmi + Viem | Ethereum interactions |
| **Wallet Connect** | Reown AppKit | Multi-wallet support |
| **Styling** | TailwindCSS | Utility-first CSS |
| **Components** | Shadcn/ui | Pre-built components |

### Backend Layer (Orchestrator)

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Runtime** | Node.js 18+ | JavaScript runtime |
| **Framework** | Hono | Lightweight web framework |
| **Blockchain** | Viem | Ethereum client |
| **Parser** | SDL Parser | Akash format support |

### Provider Infrastructure

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Node Server** | Node.js + Hono | Workload execution |
| **Orchestration** | Kubernetes (K3s) | Container management |
| **Logging** | Pino | Structured logging |
| **K8s Client** | @kubernetes/client-node | K8s API access |

### Storage Layer

| Component | Technology | Purpose |
|-----------|------------|---------|
| **On-chain** | Smart contracts | Critical data (IDs, status) |
| **IPFS** | Pinata (optional) | Metadata storage |
| **Local** | In-memory | Temporary state |

---

## Network Participants

### 1. Users (Workload Deployers)

**Who:** Anyone needing compute resources

**Requirements:**
- Web3 wallet (MetaMask, etc.)
- Base Sepolia testnet ETH
- CLD tokens (for payment)

**Actions:**
1. Connect wallet to Cloudana frontend
2. Create workload deployment
3. Choose SDL template or custom manifest
4. Register workload on-chain (transaction)
5. Monitor deployment status
6. Access deployed services

**Example User Flow:**
```
User → Frontend → WorkloadRegistry.registerWorkload()
     → Orchestrator detects event
     → Provider executes workload
     → User accesses service via URL
```

### 2. Providers (Infrastructure Owners)

**Who:** Anyone with compute resources to share

**Requirements:**
- VPS or bare metal server
- Kubernetes cluster (K3s recommended)
- 1000 CLD bond (refundable)
- Static IP or domain

**Setup Process:**
1. Prepare VPS with SSH access
2. Install K3s (automated or manual)
3. Install provider node server
4. Get device ID from provider node
5. Register on-chain via frontend
6. Approve CLD bond transaction
7. Start receiving workloads

**Provider VPS Example:**
```
Single VPS (203.0.113.10)
├── Ubuntu 22.04 LTS
├── 8 CPU cores, 32GB RAM
├── Provider Node Server (port 4040)
│   └── Installed at: ~/cloudana-mvp/provider-node-server
└── K3s Cluster
    └── Workload namespaces:
        ├── cloudana-123-1
        ├── cloudana-456-2
        └── cloudana-789-3
```

### 3. Orchestrator (Network Coordinator)

**Who:** Cloudana protocol operator

**Role:** Centralized matching service (MVP phase)

**Infrastructure:**
- Runs orchestrator API service
- Monitors blockchain continuously
- Maintains provider database
- Executes placement algorithm

**Future Evolution:**
- Phase 2: Multiple orchestrators for redundancy
- Phase 3: Decentralized orchestration (staked rotation)

---

## Workload Execution Flow

### Complete End-to-End Flow

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: USER DEPLOYS WORKLOAD                               │
├─────────────────────────────────────────────────────────────┤
│ User → Frontend → WorkloadRegistry.registerWorkload()       │
│                                                             │
│ Transaction includes:                                       │
│ • Owner address                                             │
│ • IPFS CID (manifest metadata)                              │
│ • Requirements (CPU, memory, GPU, storage)                  │
│ • Payment/escrow details                                    │
└─────────────────────────────────────────────────────────────┘
                           │
                           ↓ Blockchain emits event
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: ORCHESTRATOR DETECTS EVENT                          │
├─────────────────────────────────────────────────────────────┤
│ Orchestrator polls blockchain every 60 seconds              │
│ Detects: WorkloadRegistered event                           │
│                                                             │
│ Reads event data:                                           │
│ • workloadId: 123                                           │
│ • owner: 0x1234...                                          │
│ • manifestCID: bafybeig...                                  │
│ • requirements: {cpu: 2, memory: 4Gi, gpu: 0}               │
└─────────────────────────────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: ORCHESTRATOR MATCHES PROVIDER                       │
├─────────────────────────────────────────────────────────────┤
│ 1. Query active providers from ProviderRegistry             │
│ 2. For each provider, fetch capacity from IPFS              │
│ 3. Filter providers by requirements:                        │
│    ✓ CPU: 2 cores available                                 │
│    ✓ Memory: 4Gi available                                  │
│    ✓ GPU: Not required                                      │
│ 4. Select best provider based on:                           │
│    • Resource match                                         │
│    • Geographic proximity                                   │
│    • Provider reputation                                    │
│                                                             │
│ Selected: Provider 1 (provider-1.example.com)               │
└─────────────────────────────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: ORCHESTRATOR PREPARES DEPLOYMENT                    │
├─────────────────────────────────────────────────────────────┤
│ 1. Fetch manifest from IPFS (CID: bafybeig...)              │
│ 2. Parse SDL (Stack Definition Language):                   │
│    services:                                                │
│      nginx:                                                 │
│        image: nginx:latest                                  │
│        cpu: 2 cores                                         │
│        memory: 4Gi                                          │
│        ports: 80, 443                                       │
│                                                             │
│ 3. Build Kubernetes manifest:                               │
│    - Namespace: cloudana-123-1                              │
│    - Deployment: nginx (2 replicas)                         │
│    - Service: nginx (ClusterIP)                             │
│    - Resources: requests & limits                           │
└─────────────────────────────────────────────────────────────┘
                           │
                           ↓ HTTP POST
┌─────────────────────────────────────────────────────────────┐
│ STEP 5: ORCHESTRATOR SENDS TO PROVIDER                      │
├─────────────────────────────────────────────────────────────┤
│ POST http://provider-1.example.com:4040/deploy              │
│                                                             │
│ Body: {                                                     │
│   "workloadId": "123",                                      │
│   "instanceId": "1",                                        │
│   "k8sManifest": {                                          │
│     "namespace": "cloudana-123-1",                          │
│     "resources": [...]                                      │
│   }                                                         │
│ }                                                           │
│                                                             │
│ Response: 200 OK (accepted)                                 │
└─────────────────────────────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 6: PROVIDER NODE RECEIVES & EXECUTES                   │
├─────────────────────────────────────────────────────────────┤
│ Provider Node:                                              │
│ 1. Parse request                                            │
│ 2. Store instance: { workloadId, status: "pending" }        │
│ 3. Return 200 OK immediately                                │
│ 4. Execute asynchronously:                                  │
│    - Call executeWorkload()                                 │
│    - Use K8s API to create resources                        │
└─────────────────────────────────────────────────────────────┘
                           │
                           ↓ kubectl/K8s API
┌─────────────────────────────────────────────────────────────┐
│ STEP 7: KUBERNETES EXECUTION                                │
├─────────────────────────────────────────────────────────────┤
│ K8s Cluster:                                                │
│                                                             │
│ 1. Create namespace: cloudana-123-1                         │
│ 2. Create Deployment: nginx                                 │
│    → K8s Scheduler assigns pod to node                      │
│    → Kubelet pulls image: nginx:latest                      │
│    → Container starts                                       │
│ 3. Create Service: nginx                                    │
│    → Assigns ClusterIP                                      │
│    → Configures networking                                  │
│                                                             │
│ Status: Pod Running ✅                                      │
└─────────────────────────────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 8: ORCHESTRATOR RECORDS PLACEMENT                      │
├─────────────────────────────────────────────────────────────┤
│ WorkloadRegistry.recordPlacement(                           │
│   workloadId: 123,                                          │
│   provider: 0xABCD...,                                      │
│   instanceId: 1                                             │
│ )                                                           │
│                                                             │
│ On-chain record created ✅                                  │
└─────────────────────────────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 9: USER ACCESSES SERVICE                               │
├─────────────────────────────────────────────────────────────┤
│ User → Frontend → Check workload status                     │
│      → Get service URL from provider                        │
│      → Access: http://provider-1.example.com:nginx-port     │
│                                                             │
│ Application running and accessible! 🎉                      │
└─────────────────────────────────────────────────────────────┘
```

### Timing Breakdown

| Phase | Duration | Notes |
|-------|----------|-------|
| User registration | ~10-30s | Blockchain transaction |
| Orchestrator detection | 0-60s | Polling interval |
| Provider matching | ~1-2s | Algorithm execution |
| HTTP deployment | ~1-3s | Network latency |
| K8s resource creation | ~5-15s | Namespace, deployment, service |
| Container image pull | ~10-60s | Depends on image size |
| Container startup | ~1-10s | Application initialization |
| **Total** | **~30-120s** | From registration to running |

---

## Smart Contracts

### CLDToken (ERC-20)

**Purpose:** Utility token for payments and provider bonds

**Features:**
- Standard ERC-20 implementation
- Minting capability (controlled)
- Burning capability
- Total supply: 1,000,000 CLD

**Key Functions:**
```solidity
function mint(address to, uint256 amount) external onlyOwner
function burn(uint256 amount) external
function approve(address spender, uint256 amount) external
function transfer(address to, uint256 amount) external
```

### ProviderRegistry

**Purpose:** On-chain provider registration and management

**Data Stored:**
- Provider wallet address
- Public key hash (device ID)
- IPFS CID (metadata pointer)
- Bond amount (1000 CLD)
- Status (Registered/Active/Inactive)

**Key Functions:**
```solidity
function registerProvider(
    bytes32 pubKeyHash,
    string memory metadataURI
) external

function updateProvider(
    bytes32 pubKeyHash,
    string memory metadataURI
) external

function getProvider(bytes32 pubKeyHash) external view
    returns (Provider memory)
```

**Provider Metadata (IPFS):**
```json
{
  "deviceId": "0x1234...",
  "hostname": "provider-1",
  "endpoint": "http://provider-1.example.com:4040",
  "specs": {
    "cpu": { "model": "Intel Xeon", "cores": 8 },
    "memory": { "total": "32Gi" },
    "storage": { "total": "500Gi" },
    "gpu": null
  },
  "location": {
    "country": "DE",
    "city": "Frankfurt"
  },
  "attributes": {
    "persistent-storage": true,
    "gpu": false
  }
}
```

### WorkloadRegistry

**Purpose:** Workload registration and lifecycle management

**Data Stored:**
- Workload ID
- Owner address
- IPFS CID (manifest)
- Requirements (CPU, memory, GPU, storage)
- Status (Pending/Active/Completed/Failed)
- Assigned provider

**Key Functions:**
```solidity
function registerWorkload(
    string memory manifestCID,
    Requirements memory requirements
) external returns (uint256 workloadId)

function recordPlacement(
    uint256 workloadId,
    address provider,
    uint256 instanceId
) external onlyOrchestrator

function updateStatus(
    uint256 workloadId,
    Status status
) external
```

**Events:**
```solidity
event WorkloadRegistered(
    uint256 indexed workloadId,
    address indexed owner,
    string manifestCID
)

event PlacementRecorded(
    uint256 indexed workloadId,
    address indexed provider,
    uint256 instanceId
)
```
---

## Provider Infrastructure

### Physical Deployment

**Recommended Setup (Single VPS):**

```
Provider VPS
├── OS: Ubuntu 22.04 LTS
├── CPU: 4-16 cores
├── RAM: 8-64 GB
├── Storage: 50-500 GB SSD
├── Network: 1 Gbps
│
├── Provider Node Server
│   ├── Location: ~/cloudana-mvp/provider-node-server
│   ├── Runtime: Node.js 18+ with PM2
│   ├── Port: 4040 (HTTP API)
│   └── Logs: ~/.pm2/logs/
│
└── K3s Cluster
    ├── K3s server running
    ├── Kubeconfig: ~/.kube/config
    └── Tenant workloads in namespaces
```

### Installation Methods

**Method 1: Automated (Recommended)**

Via Cloudana Console:
1. Provider enters VPS credentials (IP, SSH key)
2. Console triggers K3sService
3. System automatically:
   - SSHs to VPS
   - Installs K3s
   - Configures networking (Calico CNI)
   - Installs provider node
   - Configures kubeconfig
   - Returns device ID for registration

**Method 2: Manual**

```bash
# 1. Install K3s
curl -sfL https://get.k3s.io | sh -

# 2. Setup kubeconfig
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $USER:$USER ~/.kube/config

# 3. Install provider node
cd ~
git clone <repo-url>
cd cloudana-mvp/provider-node-server
npm install

# 4. Start provider node
npm run start:pm2

# 5. Get device ID
curl http://localhost:4040/device-info

# 6. Register on-chain via frontend
```

### Resource Management

**Namespace Isolation:**
```
K3s Cluster
├── kube-system (system)
├── default (unused)
├── cloudana-123-1 (tenant 1)
│   ├── Deployment: nginx
│   ├── Service: nginx
│   └── Pods: nginx-xxxxx
├── cloudana-456-2 (tenant 2)
│   └── ...
└── cloudana-789-3 (tenant 3)
    └── ...
```

**Resource Limits:**
```yaml
resources:
  requests:
    cpu: "100m"      # Guaranteed
    memory: "128Mi"  # Guaranteed
  limits:
    cpu: "500m"      # Maximum
    memory: "256Mi"  # Maximum
```

### Provider Node API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/device-info` | GET | Hardware specs & device ID |
| `/deploy` | POST | Accept workload deployment |
| `/status` | GET | List all instances |
| `/workload/:id/status` | GET | Detailed workload status |
| `/workload/:id/logs` | GET | Container logs |
| `/workload/:id/endpoints` | GET | Service endpoints |
| `/health` | GET | Health check |
| `/metrics` | GET | Prometheus metrics |
| `/diagnostics` | GET | System diagnostics |

---

## Deployment Guide

### For Users: Deploy a Workload

**Step 1: Prepare Wallet**
```
• Install MetaMask
• Switch to Base Sepolia network
• Get testnet ETH from faucet
• Get CLD tokens (from faucet or DEX)
```

**Step 2: Access Cloudana**
```
• Visit: https://cloudana.app
• Connect wallet
• Approve CLD spending (if needed)
```

**Step 3: Create Deployment**
```
• Choose template or write custom SDL
• Configure resources (CPU, memory, storage)
• Set environment variables
• Add exposed ports
```

**Step 4: Register Workload**
```
• Click "Deploy"
• Sign blockchain transaction
• Wait for orchestrator to match provider
```

**Step 5: Monitor & Access**
```
• View deployment status
• Access logs
• Get service URL
• Use your application!
```

### For Providers: Setup Infrastructure

**Step 1: Prepare VPS**
```bash
# Minimum requirements:
# - 4 CPU cores
# - 8 GB RAM
# - 50 GB storage
# - Ubuntu 22.04 LTS

# Update system
sudo apt update && sudo apt upgrade -y
```

**Step 2: Automated Setup**
```
• Visit Cloudana Console
• Navigate to Provider Registration
• Enter VPS details:
  - IP address
  - SSH private key
  - Hostname
• Click "Build Provider Environment"
• Wait for automated installation
```

**Step 3: Register Provider**
```
• Copy device ID from console
• Approve 1000 CLD bond
• Sign registration transaction
• Wait for confirmation
```

**Step 4: Start Receiving Workloads**
```
• Provider node is now active
• Orchestrator can send workloads
• Monitor via dashboard
• Earn CLD tokens!
```

---

## Comparison with Akash

### Architecture Comparison

| Aspect | Cloudana | Akash |
|--------|----------|-------|
| **Orchestration** | 1 centralized orchestrator | Fully decentralized (no orchestrator) |
| **Workload Assignment** | PUSH (orchestrator assigns) | PULL (provider bids & wins) |
| **Provider Selection** | Orchestrator algorithm | User accepts bid |
| **Marketplace** | No bidding | Auction-based |
| **Speed** | Instant (no bidding wait) | Slower (auction process) |
| **Complexity (Provider)** | Simple (receive assignments) | Complex (bidding engine) |
| **Complexity (User)** | Simple (instant deploy) | Moderate (choose from bids) |

### Provider Deployment

| Aspect | Cloudana | Akash |
|--------|----------|-------|
| **Provider Location** | Outside K8s (external) | Inside K8s (pod) |
| **K8s Permissions** | kubectl (external config) | ClusterRole: cluster-admin |
| **Installation** | npm install + PM2/systemd | Helm chart in K8s |
| **ServiceAccount** | No (runs as OS user) | Yes (akash-provider) |
| **Multi-cluster** | Easy (multiple kubeconfigs) | Complex |

### Workflow Comparison

**Cloudana Workflow:**
```
User registers workload
  ↓ (instant)
Orchestrator matches provider
  ↓ (instant)
Provider receives deployment
  ↓ (30-120s)
Workload running
```

**Akash Workflow:**
```
User creates order
  ↓ (on-chain)
Providers bid on order
  ↓ (wait for bids, 1-5 min)
User accepts winning bid
  ↓ (creates lease)
Provider receives lease
  ↓ (30-120s)
Workload running
```

### Philosophy Comparison

**Cloudana:**
- ✅ MVP-first approach
- ✅ Optimize for user experience (speed)
- ✅ Simplify provider onboarding
- ✅ Can decentralize later

**Akash:**
- ✅ Decentralization-first
- ✅ Competitive marketplace (bidding)
- ✅ User choice (accept any bid)
- ✅ Fully decentralized from day 1

**Both are valid approaches!**
- Cloudana: Better UX, faster MVP
- Akash: More decentralized, established network

---

## Tokenomics

### CLD Token

**Total Supply:** 1,000,000 CLD

**Distribution:**
- Treasury: 800,000 CLD (80%)
- Team: 200,000 CLD (20%)

### Provider Economics

**Bond Requirement:**
- Amount: 1,000 CLD per provider
- Refundable when provider exits
- Maximum providers per wallet: 10

**Registration Fee:**
- 80% to Treasury
- 20% to Team

### Payment Flow

```
User deposits CLD to JobEscrow
  ↓
Workload executes on provider
  ↓
Provider reports usage (EIP-712 signature)
  ↓
Provider claims earnings
  ↓
Remaining balance refunded to user
```

### Future Enhancements

- Dynamic pricing based on demand
- Provider reputation system
- Staking for orchestrator role
- Governance token features

---

## Security & Architecture Decisions

### Why Provider Node Runs Outside K8s

**Security Isolation:**
```
Provider Control Plane (Provider Node)
  ↓ kubectl/API
Tenant Workloads (K8s Pods)
```

Benefits:
- ✅ Clear trust boundary
- ✅ Provider infrastructure protected
- ✅ Tenant workloads can't access provider node
- ✅ Multi-cluster management possible

### Why Centralized Orchestrator (MVP)

**MVP Benefits:**
- ✅ Faster development
- ✅ Simpler debugging
- ✅ Better user experience (instant placement)
- ✅ Consistent placement algorithm
- ✅ Can add redundancy later
- ✅ Can decentralize in future

**Mitigation:**
- Run multiple orchestrators for redundancy
- Open-source orchestrator code
- Clear path to decentralization

### Smart Contract Security

- OpenZeppelin libraries for standards
- Access control (Ownable, AccessControl)
- Reentrancy guards
- EIP-712 for signed messages
- Pausable for emergency response

### Network Security

- HTTPS for all API endpoints
- JWT authentication (optional)
- Rate limiting
- DDoS protection
- Firewall rules

---

## Future Roadmap

### Phase 1: MVP (Current)

✅ Smart contracts deployed
✅ Frontend operational
✅ Orchestrator working
✅ Provider infrastructure ready
✅ Testnet deployment

### Phase 2: Mainnet Launch

- [ ] Security audit
- [ ] Mainnet deployment (Base)
- [ ] Token launch (CLD)
- [ ] Provider incentive program
- [ ] Template marketplace

### Phase 3: Enhanced Features

- [ ] GPU support
- [ ] Persistent storage (Rook/Ceph)
- [ ] Custom domains & SSL
- [ ] Load balancing
- [ ] Auto-scaling

### Phase 4: Decentralization

- [ ] Multiple orchestrators
- [ ] Orchestrator staking
- [ ] Governance system
- [ ] Optional provider bidding mode
- [ ] Cross-chain support

### Phase 5: Enterprise

- [ ] Private deployments
- [ ] SLA guarantees
- [ ] Compliance tools
- [ ] Advanced monitoring
- [ ] Enterprise support

---

## Network Information

**Blockchain:** Base Sepolia Testnet
- Chain ID: 84532
- RPC: https://sepolia.base.org
- Explorer: https://sepolia.basescan.org

**Smart Contracts:**
- CLDToken: https://sepolia.basescan.org/address/0xcfd19DF5a3f963Dabf52aC7B46d4780Cc0E599e2
- ProviderRegistry: https://sepolia.basescan.org/address/0x45d62B862B3183ef5d4a8c532e6B0f8332020fC5
- WorkloadRegistry: https://sepolia.basescan.org/address/0x51fBe38cCfCE6b59f583Ed70c5829933D4FDE1dc

**Frontend:** https://cloudana.cloud

---

## Conclusion

Cloudana represents a pragmatic approach to decentralized compute infrastructure:

✅ **True DePIN**: No backend, no database, fully on-chain coordination
✅ **User-Friendly**: Instant deployment, no auction waiting
✅ **Provider-Friendly**: Simple setup, automated installation
✅ **Scalable**: Can grow from MVP to enterprise-grade
✅ **Future-Proof**: Clear path to full decentralization