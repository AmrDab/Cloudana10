# Cloudana POUW Testnet Plan

## What Was Built

### Core cuPOW Algorithm (`pouw/`)
Implements Algorithm 6.4 from Komargodski & Weinstein (IACR 2025/685) exactly:

1. **Encode**: Derive low-rank noise E = E_L·E_R, F = F_L·F_R from σ (block hash seed)
2. **Block MatMul**: Compute (A+E)·(B+F) in r×r blocks, recording ALL intermediate states
3. **Transcript hash**: SHA-256 of every intermediate block → this is what makes it hard to fake
4. **Proof z**: SHA-256(σ || transcript_hash || H(A) || H(B)) — must have `difficulty` leading zero bits
5. **Decode**: Recover A·B from C' in O(n²·r) vs O(n³) for the main computation

Confirmed working: 108 attempts to find a cert at difficulty=8 (expected ~256). Verify rejects tampered certs.

### Provider Node (`provider-node-server/src/pouw-miner.ts`)
- Background mining loop: batches of attempts per tick, yields to event loop
- Fetches sigma from orchestrator `/v1/pouw/seed` (latest Base block hash)
- Submits certificates to `/v1/pouw/submit`
- Exposes `/pouw/stats` for monitoring
- Env vars: `POUW_ENABLED`, `POUW_PROVIDER_ADDRESS`, `POUW_DIFFICULTY`, `POUW_MATRIX_SIZE`

### Orchestrator POUW Layer (`client/api/src/`)
**Routes** (`routes/v1/pouw.ts`):
- `GET /v1/pouw/seed` — current mining seed (cached Base Sepolia block hash, 5s TTL)
- `POST /v1/pouw/submit` — verify + record + reward a certificate
- `GET /v1/pouw/stats` — network-wide mining stats
- `GET /v1/pouw/leaderboard` — providers ranked by total difficulty
- `GET /v1/pouw/certificates` — recent verified certificates

**Services**:
- `pouw-verifier.service.ts` — re-runs cuPOW verification (re-computes transcript from A, B)
- `certificate-store.service.ts` — in-memory store with replay protection, per-provider stats
- `mining-reward.service.ts` — distributes CLD via `RewardContract.rewardProvider()`, scaled by matrix size + difficulty
- `pouw-chain-recorder.service.ts` — records accepted certs on `POUWVerifier.sol`

### Smart Contract (`contract/contracts/POUWVerifier.sol`)
- `recordCertificate()` — ORCHESTRATOR_ROLE only, checks replay via `usedZ` mapping
- `getMinerStats()` — per-provider totals
- `CertificateRecorded` event — for frontend real-time feed
- All 17 contracts compile successfully

---

## Testnet vs Mainnet Differences

| Feature | Testnet (now) | Mainnet (future) |
|---|---|---|
| Verification | Orchestrator re-runs full computation | zkSNARK (Groth16/PLONK, O(1)) |
| Matrix privacy | A, B submitted in plaintext | zkSNARK — A, B stay private |
| Chain | Base Sepolia | Base Mainnet |
| Difficulty | 8–16 bits (fast) | Higher, auto-adjusted |
| Matrix size | 64–256 (CPU, seconds) | 512–4096 (GPU, ms with CUDA) |
| Trust model | Orchestrator is trusted | Fully trustless |

---

## Reward Formula

```
R = 10 CLD × (n/64)^1.5 × 2^((difficulty-8)/4)
```

Examples at difficulty=12:
- n=64:  10 × 1.0 × 4 = 40 CLD
- n=128: 10 × 2.83 × 4 = 113 CLD
- n=256: 10 × 8.0 × 4 = 320 CLD

---

## Work Monitoring (Testnet)

**Provider-side**: `/pouw/stats` — attempts, found, hash rate, uptime
**Orchestrator-side**:
- `GET /v1/pouw/leaderboard` — real-time provider rankings
- `GET /v1/pouw/certificates` — live feed of verified proofs
- `GET /v1/pouw/stats` — network totals

**On-chain** (Base Sepolia): `CertificateRecorded` events on `POUWVerifier.sol` — fully auditable

---

## Why MatMul Works (Security Intuition)

The noise E, F are low-rank (rank r << n), so:
- Computing the **output** C' = (A+E)·(B+F) is cheap — adversary can pick A=B=0 and E·F is low-rank
- But each **intermediate block** `C_{i,j}^{(l)} += A'_{i,l} × B'_{l,j}` is a product of marginally uniform r×r random matrices
- An adversary cannot predict/skip any intermediate block without actually computing it
- The transcript = SHA-256 of ALL blocks — so the adversary must compute all nb³ intermediates
- This means the full O(n³) computation is unavoidable

For testnet, the security assumption holds even without zkSNARK — the orchestrator spot-checks by re-running.

---

## Env Variables to Add

Provider node (`.env`):
```
POUW_ENABLED=true
POUW_PROVIDER_ADDRESS=0x...   # provider wallet
POUW_DIFFICULTY=12
POUW_MATRIX_SIZE=64
ORCHESTRATOR_URL=http://...
```

Orchestrator (`.env`):
```
POUW_MIN_DIFFICULTY=8
POUW_VERIFIER_CONTRACT_ADDRESS=0x...   # after deploying POUWVerifier
POUW_MINING_POOL_WORKLOAD_ID=...       # workload ID funded with mining rewards pool
MINING_REWARDS_ENABLED=true
```

---

## Next Steps (Prioritized)

1. **Deploy POUWVerifier.sol** to Base Sepolia
2. **Fund mining pool** — call `RewardContract.fundWorkload(POOL_ID, amount)` with CLD
3. **Onboard providers** — set env vars, restart provider nodes → mining begins automatically
4. **Frontend mining dashboard** — leaderboard page consuming `/v1/pouw/leaderboard` and `/v1/pouw/certificates`
5. **GPU acceleration** — replace pure-JS matmul with WebAssembly SIMD or native CUDA (Rust) for mainnet
6. **zkSNARK circuit** — Circom circuit for `verify(sigma, transcriptHash, n, r, difficulty, z)` for trustless mainnet
