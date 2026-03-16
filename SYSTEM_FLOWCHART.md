# Cloudana System Flowchart — Provider to User

## High-Level Architecture

```
                            BASE SEPOLIA (On-Chain)
    ┌─────────────────────────────────────────────────────────────┐
    │  CLDToken    ProviderRegistry   WorkloadRegistry            │
    │  (ERC-20)   (deviceId+IPFS)    (metadataUri+placement)     │
    │                                                             │
    │  RewardContract              POUWVerifier                   │
    │  (fund/reward/withdraw)      (certificate recording)        │
    │                                                             │
    │  CLDFaucet                   ChallengeManager               │
    │  (testnet token drip)        (anti-fraud disputes)          │
    └──────────────┬──────────────────────┬───────────────────────┘
                   │                      │
         ┌─────────┘                      └─────────┐
         ▼                                          ▼
    ┌──────────────┐                      ┌───────────────────┐
    │   Frontend   │◄────── REST ────────►│   Orchestrator    │
    │  React 19    │      API (Hono)      │   API :7002       │
    │  Vite :7003  │                      │                   │
    └──────┬───────┘                      └────────┬──────────┘
           │                                       │
           │ Wallet Connect                        │ HTTP POST /deploy
           │ (AppKit / WalletConnect)              │ GET /status, /logs
           ▼                                       ▼
    ┌──────────────┐                      ┌───────────────────┐
    │    User      │                      │  Provider Node    │
    │  (Browser)   │                      │  :4040 (K3s)      │
    └──────────────┘                      └───────────────────┘
```

---

## 1. Provider Registration Flow

```
  PROVIDER                    FRONTEND                 ORCHESTRATOR              CHAIN
  ────────                    ────────                 ────────────              ─────

  Opens /provider/register
       │
       ▼
  ┌──────────────────┐
  │ Type Selector    │
  │ ┌──────┐┌──────┐│
  │ │Data- ││Home  ││
  │ │center││Prov. ││
  │ └──┬───┘└──┬───┘│
  └────┼───────┼────┘
       │       │
       │       └─────────────────┐
       ▼                         ▼
  ┌──────────────┐        ┌──────────────┐
  │ Datacenter   │        │ Home Setup   │
  │ Multistep    │        │ (Cloudflare  │
  │ Registration │        │  Tunnel)     │
  │              │        │              │
  │ 1. SSH creds │        │ 1. Install   │
  │ 2. Hardware  │        │    cloudflared│
  │    scan      │        │ 2. Create    │
  │ 3. K3s setup │        │    tunnel    │
  │ 4. Metadata  │        │ 3. Config    │
  │    to IPFS   │        │ 4. Run node  │
  └──────┬───────┘        └──────┬───────┘
         │                       │
         └───────┬───────────────┘
                 ▼
  ┌──────────────────────────────────────┐
  │ POST /v1/build-provider              │
  │                                      │
  │  build-provider.service.ts           │
  │  ├─ SSH → remote machine             │
  │  ├─ Detect hardware (CPU/RAM/GPU)    │
  │  ├─ Install K3s cluster              │
  │  ├─ Upload provider-node-server      │
  │  ├─ Start provider node (:4040)      │
  │  └─ Upload metadata to IPFS          │
  └──────────────┬───────────────────────┘
                 │
                 ▼
  ┌──────────────────────────────────────┐
  │ User signs tx with wallet            │
  │                                      │
  │ ProviderRegistry.registerProvider(   │──────► On-Chain
  │   deviceId,     // keccak256(hw-id)  │       ProviderRegistered
  │   metadataUri   // ipfs://Qm...      │       event emitted
  │ )                                    │
  └──────────────────────────────────────┘
                                                  │
                                                  ▼
                                          ┌───────────────┐
                                          │ The Graph     │
                                          │ indexes event │
                                          │ → Provider    │
                                          │   entity      │
                                          └───────────────┘
```

---

## 2. User Workload Deployment Flow

```
  USER                       FRONTEND                 ORCHESTRATOR              CHAIN
  ────                       ────────                 ────────────              ─────

  Connect wallet
  (MetaMask / Social)
       │
       ▼
  ┌──────────────┐
  │ Select from: │
  │ ┌──────────┐ │
  │ │Templates │ │    (nginx, postgres, games, etc.)
  │ └──────────┘ │
  │ ┌──────────┐ │
  │ │Custom    │ │    (Docker image + ports)
  │ │Container │ │
  │ └──────────┘ │
  │ ┌──────────┐ │
  │ │Custom SDL│ │    (raw Akash SDL YAML)
  │ └──────────┘ │
  └──────┬───────┘
         │
         ▼
  ┌──────────────────────────────────────┐
  │ Build manifest (JSON)                │
  │ {                                    │
  │   name: "My App",                   │
  │   sdl: "services:\n  web:\n...",    │
  │   requirements: {                   │
  │     cpu: 1000, memory: 1GB,         │
  │     storage: 10GB, gpu: 0           │
  │   }                                 │
  │ }                                    │
  │                                      │
  │ Upload to IPFS → CID                │
  └──────────────┬───────────────────────┘
                 │
                 ▼
  ┌──────────────────────────────────────┐
  │ Sign tx: WorkloadRegistry            │
  │   .registerWorkload(metadataUri)     │──────► On-Chain
  │                                      │       WorkloadRegistered
  │ Returns: workloadId (auto-increment) │       event emitted
  └──────────────┬───────────────────────┘
                 │
                 ▼
  ┌──────────────────────────────────────┐
  │ Sign tx: RewardContract              │
  │   .approve(rewardContract, amount)   │
  │   .fundWorkload(workloadId, amount)  │──────► On-Chain
  │                                      │       WorkloadFunded
  │ CLD tokens locked in contract        │       event emitted
  └──────────────────────────────────────┘
```

---

## 3. Orchestration & Placement Flow

```
  CHAIN EVENT                ORCHESTRATOR                        PROVIDER NODE
  ───────────                ────────────                        ─────────────

  WorkloadRegistered
  event emitted
       │
       ▼
  ┌──────────────────────────────────────────────────────────┐
  │ orchestrator-event.service.ts                            │
  │ (watches chain events, debounced 2s)                     │
  │                                                          │
  │ Triggers: runPlacementCycle()                            │
  └──────────────┬───────────────────────────────────────────┘
                 │
                 ▼
  ┌──────────────────────────────────────────────────────────┐
  │ placement.service.ts                                     │
  │                                                          │
  │ Step 1: Fetch pending workloads (Active, not placed)     │
  │         ↓                                                │
  │ Step 2: Build provider capacity cache                    │
  │         ├─ Query ProviderRegistry for active providers   │
  │         ├─ Fetch each provider's IPFS metadata           │
  │         └─ Parse: endpoint, CPU, RAM, GPU, storage       │
  │         ↓                                                │
  │ Step 3: Bin-packing match                                │
  │         ├─ For each workload:                            │
  │         │   Find provider where:                         │
  │         │     availableCPU  >= required CPU               │
  │         │     availableRAM  >= required RAM               │
  │         │     availableGPU  >= required GPU               │
  │         │     availableDisk >= required disk              │
  │         └─ Return PlacementDecision[]                    │
  └──────────────┬───────────────────────────────────────────┘
                 │
                 ▼
  ┌──────────────────────────────────────────────────────────┐
  │ deploy-to-provider.service.ts                            │
  │                                                          │
  │ Step 1: Fetch workload manifest from IPFS                │
  │         ↓                                                │
  │ Step 2: Parse SDL → extract services, images, ports      │
  │         ↓                                                │
  │ Step 3: Build K8s manifest                               │
  │         ├─ Namespace: cloudana-{workloadId}-{instanceId} │
  │         ├─ Deployment (replicas, image, resources)       │
  │         ├─ Service (ClusterIP / NodePort)                │
  │         └─ ConfigMap (env vars)                          │
  │         ↓                                                │
  │ Step 4: POST {provider-endpoint}/deploy ─────────────────┼──► Provider Node
  │         { workloadId, instanceId, k8sManifest }          │    receives manifest
  └──────────────┬───────────────────────────────────────────┘
                 │                                                    │
                 │                                                    ▼
                 │                                           ┌────────────────┐
                 │                                           │ kubectl apply  │
                 │                                           │ -f manifest    │
                 │                                           │                │
                 │                                           │ K3s creates:   │
                 │                                           │ ├─ Namespace   │
                 │                                           │ ├─ Deployment  │
                 │                                           │ ├─ Service     │
                 │                                           │ └─ Pods        │
                 │                                           │                │
                 │                                           │ Returns 200 OK │
                 │                                           └────────────────┘
                 ▼
  ┌──────────────────────────────────────────────────────────┐
  │ Record on-chain:                                         │
  │ WorkloadRegistry.recordPlacement(                        │
  │   workloadId, providerAddress, instanceId                │──► On-Chain
  │ )                                                        │    WorkloadPlaced
  │                                                          │    event emitted
  │ Register for status polling:                             │
  │ workload-status-poller.service.ts                        │
  │   polls GET /workload/:id/:inst/status every 15s         │
  └──────────────────────────────────────────────────────────┘
```

---

## 4. POUW (Proof of Useful Work) Mining Flow

```
  ORCHESTRATOR               PROVIDER NODE                     CHAIN
  ────────────               ─────────────                     ─────

                        ┌─────────────────────────┐
                        │ pouw-miner.ts            │
                        │ (runs continuously)      │
                        │                          │
  GET /v1/pouw/seed ◄───┤ 1. Fetch chain seed (σ)  │
  (latest block hash)   │    every 10s             │
       │                │                          │
       └───────────────►│ 2. cuPOW solve loop:     │
                        │                          │
                        │ ┌──────────────────────┐ │
                        │ │ For each attempt:     │ │
                        │ │                       │ │
                        │ │ a. Derive noise       │ │
                        │ │    matrices E,F       │ │
                        │ │    from σ             │ │
                        │ │                       │ │
                        │ │ b. Generate random    │ │
                        │ │    matrices A,B       │ │
                        │ │                       │ │
                        │ │ c. Block multiply:    │ │
                        │ │    C = (A+E) × (B+F)  │ │
                        │ │                       │ │
                        │ │ d. Hash transcript    │ │
                        │ │    of all blocks      │ │
                        │ │                       │ │
                        │ │ e. z = SHA256(σ ∥ t)  │ │
                        │ │                       │ │
                        │ │ f. Check: leading     │ │
                        │ │    zeros(z) ≥ diff?   │ │
                        │ │    ├─ No → next try   │ │
                        │ │    └─ Yes → submit!   │ │
                        │ └──────────┬───────────┘ │
                        └────────────┼─────────────┘
                                     │
                                     ▼
  ┌──────────────────────────────────────────────────────────┐
  │ POST /v1/pouw/submit                                     │
  │ { σ, n, r, A, B, transcriptHash, z, difficulty,          │
  │   providerAddress, deviceId, timestamp }                 │
  └──────────────┬───────────────────────────────────────────┘
                 │
                 ▼
  ┌──────────────────────────────────────────────────────────┐
  │ pouw-verifier.service.ts                                 │
  │                                                          │
  │ 1. Sanity checks (matrix size, difficulty range)         │
  │ 2. Freshness check (timestamp not too old)               │
  │ 3. Replay check (z not already used)                     │
  │ 4. Cryptographic verification:                           │
  │    ├─ Verify matrix hashes                               │
  │    ├─ Re-derive E,F from σ                               │
  │    ├─ Re-compute block multiply                          │
  │    ├─ Re-compute transcript hash                         │
  │    ├─ Re-compute z = SHA256(σ ∥ t)                       │
  │    └─ Verify leading zeros ≥ difficulty                  │
  │ 5. Store certificate in MongoDB                          │
  └──────────────┬───────────────────────────────────────────┘
                 │
                 ├─────────────────────────────────────────┐
                 ▼                                         ▼
  ┌──────────────────────────┐          ┌─────────────────────────┐
  │ pouw-chain-recorder.ts   │          │ mining-reward.service.ts │
  │                          │          │                         │
  │ POUWVerifier             │          │ Calculate reward based  │
  │  .recordCertificate(     │──► Chain │ on difficulty           │
  │    provider, deviceId,   │          │                         │
  │    matrixSize, difficulty│          │ providerPendingRewards  │
  │    transcriptHash, z     │          │   += reward             │
  │  )                       │          └─────────────────────────┘
  │                          │
  │ Event:                   │
  │ CertificateRecorded      │
  └──────────────────────────┘
```

---

## 5. Reward & Payment Flow

```
  USER                       SMART CONTRACTS                    PROVIDER
  ────                       ───────────────                    ────────

  ┌─────────────┐
  │ Fund workload│
  │             │
  │ 1. Approve  │     CLDToken.approve(rewardContract, amt)
  │    CLD      │────────────────────────────────────────────►
  │             │
  │ 2. Fund     │     RewardContract.fundWorkload(wId, amt)
  │             │────────────────────────────────────────────►
  └─────────────┘     workloadDeposits[wId] += amt
                      Event: WorkloadFunded
                                     │
                                     ▼
                      ┌──────────────────────────┐
                      │  ORCHESTRATOR decides     │
                      │  provider earned reward   │
                      │                           │
                      │  rewardProvider(           │
                      │    provider, wId, amt      │
                      │  )                         │
                      │                            │
                      │  workloadDeposits[wId]     │
                      │    -= amt                  │
                      │  providerPendingRewards    │
                      │    [provider] += amt       │
                      │                            │
                      │  Event: ProviderRewarded   │
                      └──────────────┬─────────────┘
                                     │
                                     ▼
                                                        ┌─────────────┐
                                                        │ Withdraw    │
                                                        │             │
                      RewardContract                    │ withdrawEar │
                        .withdrawEarnings()  ◄──────────│ nings()     │
                                                        │             │
                      providerPendingRewards = 0        │ CLD tokens  │
                      CLDToken.transfer(provider, amt)  │ received    │
                      Event: EarningsWithdrawn          └─────────────┘

  ┌─────────────┐
  │ Cancel /    │
  │ Refund      │     RewardContract.refundWorkload(wId, user)
  │             │◄───────────────────────────────────────────
  │ Remaining   │     workloadDeposits[wId] = 0
  │ CLD refunded│     CLDToken.transfer(user, remaining)
  └─────────────┘     Event: WorkloadRefunded
```

---

## 6. Monitoring & Observability

```
  FRONTEND                   ORCHESTRATOR                  PROVIDER NODE
  ────────                   ────────────                  ─────────────

  ┌─────────────┐     ┌───────────────────────┐
  │ User checks │     │ workload-status-      │     ┌──────────────────┐
  │ deployment  │────►│ poller.service.ts      │────►│ GET /workload/   │
  │ status      │     │                       │     │   :id/:inst/     │
  │             │     │ Polls every 15s       │     │   status         │
  │ Shows:      │◄────│ Caches (TTL 60s)      │◄────│                  │
  │ - Phase     │     │                       │     │ Returns:         │
  │ - Pods      │     └───────────────────────┘     │ - K8s pod phase  │
  │ - URLs      │                                   │ - Ready replicas │
  │ - Logs      │                                   │ - Service URLs   │
  └─────────────┘                                   │ - Endpoints      │
                                                    └──────────────────┘

  ┌─────────────┐     ┌───────────────────────┐     ┌──────────────────┐
  │ Provider    │     │ provider-logs.        │     │ GET /diagnostics │
  │ dashboard   │────►│ service.ts            │────►│                  │
  │             │     │                       │     │ Returns:         │
  │ Shows:      │◄────│ Verifies wallet owner │◄────│ - Health status  │
  │ - Health    │     │                       │     │ - Active wkloads │
  │ - Workloads │     └───────────────────────┘     │ - System metrics │
  │ - Earnings  │                                   │ - K8s status     │
  │ - Mining    │                                   │ - Log entries    │
  └─────────────┘                                   └──────────────────┘


  PROMETHEUS                 ORCHESTRATOR                  THE GRAPH
  ──────────                 ────────────                  ─────────

  ┌─────────────┐     ┌───────────────────────┐     ┌──────────────────┐
  │ Scrapes     │     │ GET /metrics          │     │ Subgraph indexes │
  │ every 15s   │────►│                       │     │ all on-chain     │
  │             │     │ metrics.ts middleware  │     │ events:          │
  │ Alerts:     │     │                       │     │                  │
  │ - Down      │     │ Tracks:               │     │ - Providers      │
  │ - Errors    │     │ - HTTP req count      │     │ - Workloads      │
  │ - Latency   │     │ - Request duration    │     │ - Placements     │
  │ - No place  │     │ - Workloads placed    │     │ - Rewards        │
  │   -ments    │     │ - Active workloads    │     │ - Certificates   │
  └─────────────┘     └───────────────────────┘     │ - Transfers      │
                                                    │                  │
                                                    │ GraphQL API for  │
                                                    │ frontend queries │
                                                    └──────────────────┘
```

---

## Complete End-to-End Sequence

```
  ┌──────────┐  ┌───────────┐  ┌────────────┐  ┌──────────┐  ┌──────────┐
  │ PROVIDER │  │  USER     │  │ORCHESTRATOR│  │ PROVIDER │  │  CHAIN   │
  │ (Setup)  │  │ (Deploy)  │  │  (API)     │  │  (Node)  │  │          │
  └────┬─────┘  └─────┬─────┘  └─────┬──────┘  └────┬─────┘  └────┬─────┘
       │              │              │              │              │
  1.   │──register───►│              │              │              │
       │   provider   │              │              │              │
       │              │              │              │     registerProvider()
       │──────────────┼──────────────┼──────────────┼─────────────►│
       │              │              │              │              │
  2.   │              │──deploy──────┼──────────────┼──────────────┤
       │              │  workload    │              │              │
       │              │              │              │     registerWorkload()
       │              │──────────────┼──────────────┼─────────────►│
       │              │              │              │              │
  3.   │              │──fund────────┼──────────────┼──────────────┤
       │              │  workload    │              │     fundWorkload()
       │              │──────────────┼──────────────┼─────────────►│
       │              │              │              │              │
  4.   │              │              │◄─event───────┼──────────────│
       │              │              │ WorkloadReg. │              │
       │              │              │              │              │
  5.   │              │              │──placement───┤              │
       │              │              │  algorithm   │              │
       │              │              │              │              │
  6.   │              │              │──POST /deploy┤              │
       │              │              │──────────────►──kubectl─────┤
       │              │              │              │  apply       │
       │              │              │              │              │
  7.   │              │              │              │     recordPlacement()
       │              │              │──────────────┼─────────────►│
       │              │              │              │              │
  8.   │              │              │──poll status─┤              │
       │              │◄─status──────┤◄─────────────│              │
       │              │              │              │              │
  9.   │              │              │              │──mine POUW──►│
       │              │              │◄─submit cert─│              │
       │              │              │──verify──────┤              │
       │              │              │              │     recordCertificate()
       │              │              │──────────────┼─────────────►│
       │              │              │              │              │
  10.  │              │              │              │     rewardProvider()
       │              │              │──────────────┼─────────────►│
       │              │              │              │              │
  11.  │              │              │              │──withdraw────┤
       │              │              │              │     withdrawEarnings()
       │              │              │              │─────────────►│
       │              │              │              │              │
  12.  │              │──cancel──────┤              │              │
       │              │  workload    │              │     refundWorkload()
       │              │──────────────┼──────────────┼─────────────►│
       │              │              │              │              │
```

---

## Infrastructure Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PRODUCTION STACK                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │
│  │  Frontend   │  │ Orchestrator│  │  MongoDB    │                │
│  │  (Nginx)    │  │  (Node.js)  │  │  (Data)     │                │
│  │  :7003      │  │  :7002      │  │  :27017     │                │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                │
│         │                │                │                        │
│  ┌──────┴────────────────┴────────────────┴──────┐                │
│  │              Docker Compose / K8s              │                │
│  │  ┌─────────────────────────────────────────┐  │                │
│  │  │ Kubernetes (k8s/)                       │  │                │
│  │  │ ├─ namespace.yaml                       │  │                │
│  │  │ ├─ orchestrator.yaml (Deployment)       │  │                │
│  │  │ ├─ frontend.yaml (2 replicas)           │  │                │
│  │  │ ├─ mongodb.yaml (StatefulSet + PVC)     │  │                │
│  │  │ ├─ ingress.yaml (TLS, cloudana.cloud)   │  │                │
│  │  │ └─ monitoring/                          │  │                │
│  │  │     ├─ prometheus-config.yaml           │  │                │
│  │  │     └─ alerts.yml (5 alert rules)       │  │                │
│  │  └─────────────────────────────────────────┘  │                │
│  └───────────────────────────────────────────────┘                │
│                                                                     │
│  ┌───────────────────────────────────────────────┐                │
│  │ CI/CD (.github/workflows/)                     │                │
│  │ ├─ ci.yml: lint → test → build → docker        │                │
│  │ └─ deploy.yml: push image → kubectl apply       │                │
│  └───────────────────────────────────────────────┘                │
│                                                                     │
│  ┌───────────────────────────────────────────────┐                │
│  │ The Graph Subgraph                             │                │
│  │ ├─ 5 contract data sources                     │                │
│  │ ├─ 10 entity types indexed                     │                │
│  │ └─ GraphQL API for frontend queries             │                │
│  └───────────────────────────────────────────────┘                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Smart Contract Interaction Map

```
                    ┌────────────────┐
                    │   CLDToken     │
                    │   (ERC-20)     │
                    │                │
                    │ mint()         │
                    │ burn()         │
                    │ transfer()     │
                    │ approve()      │
                    └───────┬────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
  ┌───────────────┐ ┌──────────────┐ ┌──────────────┐
  │ CLDFaucet     │ │RewardContract│ │ StakingMgr   │
  │               │ │              │ │ (future)     │
  │ drip()        │ │fundWorkload()│ │              │
  │ 1000 CLD/24h  │ │rewardProv() │ │              │
  └───────────────┘ │withdrawEarn()│ └──────────────┘
                    │refundWkld()  │
                    │batchReward() │
                    └──────────────┘

  ┌───────────────┐ ┌──────────────┐ ┌──────────────┐
  │ProviderReg.   │ │WorkloadReg.  │ │ POUWVerifier │
  │               │ │              │ │              │
  │registerProv() │ │registerWkld()│ │recordCert()  │
  │updateProvider│ │updateWkld() │ │              │
  │deregisterP() │ │deregisterW()│ │ Replay       │
  │activateProv()│ │activateWkld()│ │ protection   │
  │              │ │deleteWkld() │ │              │
  │ No staking   │ │recordPlace()│ │ Per-provider  │
  │ DeviceId key │ │              │ │ stats        │
  └───────────────┘ └──────────────┘ └──────────────┘

  Roles:
  ├─ DEFAULT_ADMIN_ROLE  → deployer (grant/revoke roles)
  ├─ ORCHESTRATOR_ROLE   → orchestrator wallet
  │   ├─ WorkloadRegistry.recordPlacement()
  │   ├─ RewardContract.rewardProvider()
  │   ├─ RewardContract.refundWorkload()
  │   ├─ RewardContract.batchRewardProviders()
  │   └─ POUWVerifier.recordCertificate()
  └─ MINTER_ROLE         → deployer (CLDToken.mint)
```
