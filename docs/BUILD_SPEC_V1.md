# Cloudana v1 local build — shared spec

The contract between the parallel build tracks. **Local only: no commits, no deploys, no pushes.**
Principle: **simple.** Design refs: `STRATEGY_NOTES.md`, `CLD_ISSUANCE_DESIGN.md`.

Three branches: **Users** (pay for jobs), **Providers** (run jobs, earn CLD), **Verifiers** (check results in the browser).

## 0. Local topology

| Service | Port | How |
|---|---|---|
| Local chain (Hardhat node) | 8545 | `contract/` — CLDToken + CloudanaSettlement deployed by `scripts/local/deploy.ts` |
| API (Cloudflare Worker, local D1/KV) | 8790 | `client/api` — `npx wrangler dev --port 8790 --local` |
| Website (static) | 7003 | Vite already serves `client/public/` → site lives in `client/public/app/` |
| Node agent(s) | — | `node-agent/` — `npm start` |
| Keeper (epoch settlement) | — | `contract/scripts/local/keeper.ts` |

`.dev.vars` (gitignored) holds local secrets. `DEV_MODE=true` enables the dev-credits endpoint.

## 1. PoUW core (DONE — `pouw/src`)

- `solveAssignedJob(sigma, A, B, n, provider, deviceId) → { certificate, result }` — one pass, difficulty 0; A, B, result are signed ints.
- `verify(certificate) → boolean` — full transcript re-execution (works at difficulty 0).
- `fieldHash(data, n) → string` — the hash a certificate must carry for a job's signed input (binding check).
- `freivalds(A, B, C, n, rounds=2) → boolean` — answer check, O(n²).
- `maxAbsEntry(n)` — exactness bound for inputs.
Import from the API as `../../../../pouw/src/index.js` (same pattern existing services use).

## 2. Units, money, time

- **Units:** `units = n³` multiply-adds, computed from the job, never from the certificate.
- **Money:** integer **µCLD** (1 CLD = 1,000,000 µCLD) everywhere off-chain, stored as INTEGER. On-chain wei = µCLD × 10¹².
- **Price:** `price_ucld = max(1, ceil(n³ × PRICE_UCLD_PER_MMAC / 1e6))`, default `PRICE_UCLD_PER_MMAC = 1000`.
- **Epoch:** `epoch = floor(nowMs / (EPOCH_SECONDS × 1000))`. Local default `EPOCH_SECONDS = 120` (prod 86400).

## 3. Minting rules (per completed job, fee F = price_ucld)

- **Lane A (fee-backed):** provider payout wallet `+0.975F`, treasury `+0.005F`; epoch `fees_burned += F`. Claimable at epoch settlement.
- **Lane B (subsidy):** `S = floor(SUBSIDY_RHO × F)` (default ρ = 0.25) if the **cluster test** passed at assignment and the epoch subsidy budget has room (`EPOCH_SUBSIDY_BUDGET_UCLD`, local default 200 CLD). Vests `VEST_B_SECONDS` after completion (local 120, prod 604800).
- **Cluster test:** among eligible active nodes at assignment: distinct payout wallets ≥ `CLUSTER_N_MIN` (local 1, prod 3) and largest payout wallet's share of verified throughput ≤ `CLUSTER_S_CAP` (0.5; skipped when only one wallet exists and N_MIN = 1).
- **Verifiers:** browser verdicts earn **credits** (points), not CLD, recorded in the ledger with lane `verify` — never minted. (Owner decision pending.)

## 4. Data model (append to `client/api/schema.sql`; also created at runtime `IF NOT EXISTS`)

```
nodes(address TEXT PK, payout TEXT, manifest_json TEXT, work_types TEXT, throughput_mmac_s REAL DEFAULT 1,
      jobs_done INTEGER DEFAULT 0, jobs_failed INTEGER DEFAULT 0, announced_at INTEGER, bound_at INTEGER, last_seen INTEGER)
work_jobs(id TEXT PK, owner TEXT, work_type TEXT, n INTEGER, a_json TEXT, b_json TEXT, price_ucld INTEGER,
          public INTEGER DEFAULT 1, status TEXT, node TEXT, sigma TEXT, seed_source TEXT, draw_seed TEXT,
          eligible_hash TEXT, cluster_ok INTEGER, assigned_at INTEGER, expires_at INTEGER,
          result_json TEXT, cert_z TEXT, created_at INTEGER, completed_at INTEGER)
      status: queued → assigned → done | expired (re-queued) | failed
reward_entries(id TEXT PK, job_id TEXT, epoch INTEGER, address TEXT, lane TEXT, work_type TEXT,
               amount_ucld INTEGER, vests_at INTEGER, status TEXT, created_at INTEGER)
      lane: A | B | treasury | verify      status: pending → posted → settled | clawed
epochs(id INTEGER PK, closed_at INTEGER, fees_burned_ucld INTEGER, mint_a_ucld INTEGER, mint_b_ucld INTEGER,
       leaves_json TEXT, root TEXT, tx_hash TEXT, status TEXT)       status: closed → posted → settled
verify_tasks(id TEXT PK, job_id TEXT, n INTEGER, a_json TEXT, b_json TEXT, c_json TEXT, planted INTEGER,
             expected TEXT, created_at INTEGER)
verify_verdicts(id TEXT PK, task_id TEXT, session TEXT, address TEXT, verdict TEXT, correct INTEGER, created_at INTEGER)
balances: add balance_ucld INTEGER DEFAULT 0, held_ucld INTEGER DEFAULT 0 (migrate from REAL once)
```

## 5. API (all under `/v1`, response envelope from `src/lib/http.ts`)

### Users (JWT from `/auth/nonce` + `/auth/login`)
- `POST /dev/credits` — DEV_MODE only; +10 CLD credits to caller → `{ balanceUcld }`
- `GET /account` → `{ address, balanceUcld, heldUcld }`
- `POST /jobs` `{ workType:"matmul", n, matrixA, matrixB, public?:true }` → holds price → `{ jobId, priceUcld, balanceUcld }`
  (n ∈ [8, 256] locally; entries within `maxAbsEntry(n)`; 422 if insufficient credits)
- `GET /jobs` → `{ jobs:[summary] }` · `GET /jobs/:id` → summary + `result` (owner only) + `certificate` fields (z, sigma, node)

### Providers (node-signed requests)
Headers: `X-Node: <address>`, `X-Node-Timestamp: <ms>`, `X-Node-Signature: sign("<METHOD> <path> <timestamp> <sha256(body) hex>")`
(personal_sign / `signMessage` by the node key; timestamp within 60 s; verified with viem `verifyMessage`).
- `POST /nodes/announce` (node-signed) `{ manifest:{ cpuThreads, ramGB, gpus:[{name,vramGB}], os }, benchmarkMmacPerSec, workTypes:["matmul"] }` → `{ bound, payout }`
- `POST /nodes/bind` (NOT node-signed; payout wallet signs) `{ node, payout, message, signature }`, message exactly
  `Cloudana node binding\nNode: <node lowercase>\nPayout: <payout lowercase>\nIssued: <ISO>` (Issued within 10 min) → `{ bound:true }`
- `POST /nodes/heartbeat` (node-signed) `{}` → `{ assignment: null | { jobId, workType, n, matrixA, matrixB, sigma, expiresAt } }`
  Heartbeat updates `last_seen`, runs assignment for queued jobs, returns this node's active assignment.
- `POST /work/submit` (node-signed) `{ jobId, certificate, result }` → checks, in order:
  job assigned to this node & not expired · `certificate.sigma === job.sigma` · `certificate.matrixAHash/BHash === fieldHash(job A/B)` ·
  `verify(certificate)` · `freivalds(A, B, result, n)` → on success: job done, ledger entries written, throughput updated →
  `{ units, earned:{ laneAUcld, laneBUcld }, vestsAt }`; on failure 422 + `jobs_failed++`, job re-queued.
- `GET /ledger/:address` → `{ pending:{A,B,treasury}, vesting:{B}, settled:{A,B}, credits, entries:[latest 50] }`

### Assignment (inside heartbeat / after enqueue)
Oldest queued job first. Eligible = nodes bound, `last_seen` within `NODE_ACTIVE_SECONDS` (15), no active assignment, supporting the work type.
`seed_source` = latest block hash from `CHAIN_RPC_URL` (fallback `"local:"+Date.now()`, flagged). `draw_seed = sha256(seed_source ‖ jobId)`;
weighted draw by `throughput_mmac_s` using `draw_seed`; `eligible_hash = sha256(sorted eligible "addr:weight" list)`.
`sigma = sha256(jobId ‖ node ‖ random nonce ‖ seed_source)`. `expires_at = now + ASSIGNMENT_TTL_SECONDS (60)`; expired → re-queued.

### Verifiers (browser; no login needed, optional address)
- `GET /verify/task?session=<uuid>` → `{ taskId, n, matrixA, matrixB, matrixC }` from done public jobs, ~1 in 6 planted (C corrupted, `expected:"invalid"`).
- `POST /verify/verdict` `{ taskId, session, verdict:"valid"|"invalid", address? }` → `{ correct, credits }` (graded against the orchestrator's own verification or the plant).

### Settlement (keeper; header `X-Internal-Key`)
- `POST /admin/epochs/close` → closes every past epoch with pending entries whose `vests_at ≤ now` (lanes A, B, treasury) →
  `{ epochs:[{ id, feesBurnedUcld, mintAUcld, mintBUcld, leaves:[{ address, amountUcld }] }] }` (leaves aggregated per address; entries → posted)
- `POST /admin/epochs/:id/posted` `{ root, txHash }` · `POST /admin/epochs/:id/settled` `{ txHash }` (entries → settled)

### Network
- `GET /network` → `{ nodesOnline, nodesBound, jobsQueued, jobsDone, certificates, mintedUcld, burnedUcld, verifiersToday, epoch, priceUcldPerMmac }`

## 6. Contracts (`contract/`)

`CloudanaSettlement.sol` — the only minter on `CLDToken` (local deploy grants MINTER to it and revokes the deployer's).
- `deposit(amount)` / `depositFor(user, amount)` — escrow CLD backing users' credits.
- `postEpoch(epoch, root, mintA, mintB, feesBurned)` — POSTER_ROLE; one per epoch; requires `mintA ≤ feesBurned × 9800/10000`
  and `mintB ≤ allowance(epoch)` (schedule: supply × rate/365; 8% → ×0.85/yr → 1.5% floor, prorated to `EPOCH_SECONDS`).
- `veto(epoch)` — GUARDIAN_ROLE, before `postedAt + VETO_DELAY` (local 30 s).
- `finalize(epoch)` — permissionless after the delay; burns `feesBurned` from escrow.
- `claim(epoch, account, amount, proof)` / `claimFor(epoch, accounts[], amounts[], proofs[][])` — mints to `account` (lazy mint), once.
- Leaves: OpenZeppelin `StandardMerkleTree` over `["uint256","address","uint256"]` = (epoch, account, amountWei).
- `scripts/local/deploy.ts` writes `shared/addresses.local.json` + ABIs; `scripts/local/keeper.ts` loops: close → build tree →
  (dev) top up escrow → post → wait → finalize → claimFor → report back.

## 7. Node agent (`node-agent/`)

`npm start`: load or create key (`node-agent/.data/key.json`, gitignored) → detect hardware (os.cpus, totalmem, `nvidia-smi` if present) →
benchmark (time one 64×64 multiply) → announce → if unbound print `Bind this node: http://localhost:7003/app/provide.html?node=<address>` →
heartbeat every 3 s → on assignment: `solveAssignedJob` → submit → print `earned … µCLD`. Flags: `--api`, `--name` (separate key per name).

## 8. Website (`client/public/app/`)

Four simple pages sharing `app.css` + `app.js`: `index.html` (home: one line of what Cloudana is, the three branches, live `/network` numbers,
how CLD is minted), `run.html` (users), `provide.html` (providers: run the agent, bind with wallet, see earnings), `verify.html` (verifiers).
Wallet: injected (`window.ethereum`) if present, else a local **burner wallet** (clearly labelled, stored in localStorage) via viem from
`cdn.jsdelivr.net/npm/viem`. Same tokens as the current site (`--bg #07090D`, teal `--ok`, amber `--work`, Space Grotesk + IBM Plex Mono).
Plain, few words, no jargon.
