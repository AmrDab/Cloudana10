# Architecture — as built, 2026-10-19

Cloudana is one orchestrator over independently operated machines. The orchestrator prices, assigns, checks and
bills; the machines do the work and are paid per verified job or per probed hour; settlement batches the payments
into one Merkle root per hour on Base. This document describes the system that exists in the repository, names the
trust each part carries, and points at the code. Status per capability: `CAPABILITY_MATRIX.md`.

## 1. Components

```
                    cloudana.io (homepage)  app.cloudana.io/control (console)      SDK / curl
                                    │  wallet session JWT · scoped API key cld_sk_  │
                                    ▼                                               ▼
 ┌──────────────────────────────── cloudana-api (Cloudflare Worker) ────────────────────────────────┐
 │ app.ts: auth · jobs/work · nodes · deployments · fleets · ledger · admin-epochs · network · …   │
 │ D1 cloudana-db (all state) · KV (rate limits, sign-in nonces) · R2 cloudana-artifacts          │
 │ cron (1 min): node duties, start timeouts, assignment, artifacts, storage checks, price, deposits│
 └───────┬───────────────────────────────┬──────────────────────────────┬───────────────────────────┘
         │ signed heartbeat instructions │ x-internal-key               │ x-internal-key
         ▼                               ▼                              ▼
   node agent (home PC / fleet)    cloudana-gateway (Worker)      cloudana-keeper (Worker, cron 5 min)
   matmul · static · containers    *.cloudana.run → route →       close → postEpoch → finalize → claimFor
   workstations · endpoints        RelayNode(node).proxy          │
   storage copies                        │                        ▼
         │ outbound wss (ticket)         │                  CloudanaSettlementV2 ── CLDTokenV2 (Base Sepolia)
         ▼                               ▼                  (not yet deployed; owner step 4)
   cloudana-relay (Worker): one RelayNode Durable Object per node, hibernating WebSocket, stream hub
```

| Component | Code | Runtime | Trust it carries |
|---|---|---|---|
| API / orchestrator | `client/api/src` (`app.ts` shared; `worker.ts` Cloudflare; `index.ts` Node + SQLite) | Worker (prod), Node (dev/independent) | Sets prices, draws assignments, verifies matmul, probes hosting, keeps the ledger, closes epochs. **The trusted party today.** Holds no chain key. |
| Node agent | `node-agent/src` | Node 22 in Docker or bare | Executes work; trusts only instructions signed by the pinned key; hardens tenant containers; opens secrets only for the deployment they were sealed for |
| Relay | `relay/src` | Worker + Durable Objects | Carries requests to nodes behind NAT; authenticates nodes by API-issued HMAC tickets; never sees plaintext secrets (TLS to the node app is terminated at the node, bodies pass through) |
| Gateway | `gateway/src` | Worker on `*.cloudana.run` | Public ingress; asks the API for the route (internal key); isolates tenants (sandbox CSP for sites, own origin per app); endpoint keys and per-key limits |
| Keeper | `keeper/src` | Worker cron | Rebuilds the Merkle tree from the API's leaves, refuses a root mismatch, posts, finalizes, claims. Holds the poster key (separate from the guardian Safe) |
| Contracts | `contract/contracts/v2` | Base Sepolia | Enforce the fee split and lane-B allowance on every post; guardian veto; lazy mint on claim; token-level annual net mint ceiling |
| Console + homepage | `client/src` | Cloudflare Pages | Seals secrets in the browser; verifies the node key against the node address; uses only the public API |
| Shared | `shared/` | all | Sealed-secret format, relay protocol, tickets, storage proofs, GPU tiers |

## 2. Control plane

**State** lives in D1 (`client/api/schema.sql` for fresh databases; `src/lib/schema.ts` applies the same tables and
idempotent `ALTER`s at runtime, once per isolate). Core tables: `balances` (µCLD spendable/held), `nodes`,
`work_jobs`, `reward_entries`, `epochs`, `deployments` (+ `deployment_events`, `deployment_bills`,
`deployment_stale_nodes`, `deployment_reports`, `endpoint_keys`), `fleets`, `storage_objects/copies/checks`,
`node_nonces`, `testnet_claims`, `price_state`, `schema_meta`.

**Work jobs** (`jobs.service.ts`): `queued → assigned (TTL 60 s) → done | failed`. Enqueue holds the fee at the
current quote. Assignment is a weighted random draw over eligible, bound, recently seen nodes: `draw_seed =
sha256(seed_source ‖ job id)`, `seed_source` = latest Base block hash (`CHAIN_RPC_URL`) or a flagged local fallback;
σ binds job, node, nonce and seed; `eligible_hash` records who was eligible. Weight is verified throughput (EMA),
never the self-reported benchmark. Submit: assigned-to-this-node and unexpired → node bound → certificate σ/n/r and
A/B hash → Freivalds (n²) → on a random 1 in `VERIFY_SAMPLE_K` (10), transcript re-execution over the API's own A, B
(n³) → `done`, capture, rewards held (clawable for at least `PAY_HOLD_SECONDS`, 24 h). Three failed verifications
fail the job and release the hold. A sampled job with a right answer and a wrong transcript is kept and charged, but
its A/B and every held A/B entry of the node's payout wallet (any of its nodes) are clawed and the node is suspended,
in the same batch (B-6); `POST /v1/admin/claws/{jobId}/reverse` undoes a claw.

**Deployments** (`deployments.service.ts`, `deployment-duties.service.ts`): `queued → assigned → running ⇄ unreachable
→ stopped | failed`. Create validates the spec, prices it in USD at the current table, converts to µCLD once, holds the
first hour. Per-node duties run on that node's heartbeat (auto-stop, assign within capacity/fit/fleet/relay rules,
probe due rows, bill full hours, emit start/stop/purge instructions). Global duties run on the cron: G1 dead-node
re-queue, G2 preemption of interruptible workstations, G3 matmul assignment, G4 start timeouts (this pass). Billing is
per hour claimed conditionally (`held_ucld = fee → 0`) then charged; outages (since the last passing probe) are not
charged; stops settle the elapsed part of the hour pro rata.

**Node instructions** are the heartbeat response `{ assignment, deployments[], storage? }` signed as
`personal_sign(keccak256(canonicalJSON({ nodeAddress, ts, nonce, body })))` with `INSTRUCTION_SIGNING_KEY`; the agent
pins the signer, checks ±60 s and an unseen nonce, and ignores everything else. Node → API requests are signed over
method, path, timestamp, body hash and a single-use nonce (`node-auth.ts`).

**Placement policy** (the network chooses, users do not): static sites → any bound hosting node with room (20);
containers/workstations/endpoints → fleet nodes that announced `container` (and `gpu`, `any-image` as needed), fit
CPU/RAM/GPU against the manifest minus a host reserve, ≤ 5 per node, relay nodes only for relayed kinds, public-host
nodes only for direct workstations, agents ≥ 1.5.0 for anything carrying secrets, no sibling replica on the same node,
and never a node that just refused the row. Outcomes are recorded as `deployment_events` and (for jobs) as the draw
record, published signed at `GET /v1/draws/{id}` (seed, eligible set with a keyed operator id in place of wallets — an operator that won a paid job can still be matched to its wallet through the epoch job lists — σ once done).

**Pricing** (`pricing.service.ts`): nano-USD per tera-MAC moved hourly by a utilization controller (±2 %, hold when
idle, floor/ceiling around a 30-day EMA), converted at the reference rate; quotes lock for 5 minutes. Hosting and
GPU prices are a fixed USD table (`docs/PRICES_USD.md`).

**Ledger and epochs** (`ledger.service.ts`): per verified job or hosting bill, lane A = min(floor(0.95F), floor(0.98F)
− treasury), treasury = ceil(0.03F), lane B = floor(ρF) (ρ ≤ 0.04) when the per-operator cluster gate passes; the
epoch close scales lane B pro rata to the budget, sums per-address leaves, computes the OZ double-hash Merkle root
and the fees burned; the keeper re-verifies the root before posting. Veto reopens an epoch; claws remove pending
entries.

## 3. Data plane

- **Matmul**: matrices travel in the heartbeat assignment (n ≤ 256), results in the submit; finished matrices move
  from D1 to R2 (`moveJobArtifacts`) and, in storage phase 1, encrypted copies are placed on storage-capable nodes
  and Merkle-challenged through the relay.
- **Static sites**: files (≤ 2 MB, base64 in `spec_json`) travel in the start instruction; the agent serves them on
  127.0.0.1 (relayed) or the public host (direct); the gateway fetches through `RelayNode.proxy`.
- **Containers / endpoints**: image reference + env + sealed secrets in the start instruction; `docker run` with the
  hardening flags; ports published on 127.0.0.1 when relayed; the relay carries visitor requests as framed streams
  (JSON control, binary body frames, 64 streams per node, 512 KiB window, head/idle timeouts, 4 slots reserved for
  the orchestrator's probes).

## 4. Edge

The gateway resolves `<uuid>.cloudana.run` → `GET /v1/deployments/{id}/route` (internal key, cached 30 s) →
`{ relayed, targets[{node, dep}], kind, auth, keys }` → `RelayNode(node).fetch("/proxy")` with `x-relay-dep`,
`x-relay-class`, `x-relay-path`. Static sites: GET/HEAD only, cookie-less, `CSP: sandbox allow-scripts allow-forms
allow-popups`. Containers and endpoints on the separate user-content domain: all methods, cookies kept host-only,
`Location` rewritten so the node's loopback never leaks. Endpoints: `Authorization: Bearer cld_ek_…` checked
against the route's key hashes, per-key rate limit, random replica with retry when nothing reached an app. Legacy
direct nodes: proxy to the verified public endpoint with `cacheTtl 0`. Not built: custom domains, CDN cache,
WAF, request logs (B-15, B-21).

## 5. Provider side

Agent boot: key in `.data/<name>.json` (identity = address; uncompressed pubkey announced for sealing) → hardware
detection (`nvidia-smi` for GPUs) → benchmark → optional hardening self-check (Docker ≥ 28, quota-capable storage,
`cld-tenant` bridge with icc off, egress DROP rules installed) → announce (capabilities: `matmul`, `hosting`,
`container`, `gpu`, `any-image`, `relay`, `storage`) → bind link or fleet token → relay ticket → heartbeat loop every
15 s. Home machines announce compute + static hosting only; containers need `CLOUDANA_ALLOW_CONTAINERS=1`, a
passing self-check and a fleet. Deployments persist in `.data/deployments.json` and resume after a restart; GPUs are
reserved per container and re-read from Docker on resume.

## 6. Trust and settlement (today)

| Decision | Who makes it | Who can check it |
|---|---|---|
| Price | orchestrator controller | anyone: `/v1/network` is signed by the instruction key |
| Assignment | orchestrator draw | anyone, from the signed `GET /v1/draws/{id}` (seed, eligible set, draw); the set is attested, not committed before the seed — pull-based assignment (B-17) closes that |
| Verification | orchestrator (Freivalds on every matmul job, the transcript on a sampled 1 in 10; for int8-mlp and int8-model, the drawn segments of the node's commitment); browsers re-check planted matmul tasks | the keeper re-verifies only the root; results are reproducible from stored inputs |
| Billing of hosting | orchestrator probes through the node's socket | the owner (events, report-a-problem) |
| Epoch root | orchestrator computes; keeper re-verifies and posts | guardian Safe (veto); anyone, from the signed `GET /v1/epochs/{n}` leaves (`scripts/verify/replay.ts`) |
| Mint | contract, bounded by fees burned + allowance + annual ceiling | anyone on-chain |
| Claims | permissionless with a proof | anyone |

**Verification tiers (2026-10-26).** Four labels; each service carries the one for what is actually checked
(`docs/V4_VERIFIED_SERVICES.md` §5, §5a), never more:

| Tier | What is checked | Services |
|---|---|---|
| **Proven** | the answer is checked exactly. matmul: Freivalds on every job (C bounded, so exact over the integers); the full cuPOW transcript re-executed on a random 1 in `VERIFY_SAMPLE_K` (10). int8: commit-then-challenge — the node commits to every segment's output (a hash chain bound to σ and the job's inputs); after the commitment is stored the API draws segments to open, answered within `CHALLENGE_TTL_SECONDS` (30); each opened GEMM is Freivalds-checked and each elementwise step recomputed. Every job's provider pay is held `PAY_HOLD_SECONDS` (24 h; booked into `epochOf(now + H) + 1`); a failed check claws the wallet's held pay and suspends the node (int8: the owner is refunded); `POST /v1/admin/claws/{jobId}/reverse` undoes a claw | matmul; int8-mlp (agent ≥ 1.7.0; 2 of 4 segments, a faked one caught with probability ½ per job); int8-model (agent ≥ 1.8.0; L ≤ 16 blocks, d, h ≤ 64; max(3, L) of 4·L segments drawn uniformly, ≥ ¼ per job). Per-job probabilities: "caught within N jobs" is an average, not a guarantee; a brand-new wallet with no held pay risks only suspension |
| **Possession proven** | AES-GCM encrypted copies answer Merkle challenges on random 64 KiB leaves, re-challenged before a failure counts, with audits and cooldowns; retrievable now, never proof of replication | storage phase 1 (copies of job artifacts; R2 stays durable) |
| **Probed** | a probe through the node's socket saw it working; only time between passing probes is charged | static sites (content hash every minute through the relay), containers, GPU workstations, GPU endpoints running the user's own model server |
| **Planned** | nothing yet | spot-checked inference for endpoints (B-19; needs a GPU node), a TEE tier (B-24) |

Not a tier: the GPU model a node reports is attested by the node, not re-checked. Cloudana never picks or brands a
model; a user's own model on an endpoint is probed, not verified.

The interface (`shared/verification.ts`: tensors, hashes, the chain, the kind-generic opening check) is shared by the
API and the agent; a work type supplies its plan, inputs and kernels (`client/api/src/services/work-types.ts`).
Challenge-mode work is two node-initiated calls — `POST /v1/work/submit` with the commitment, then `POST
/v1/work/answer` with the drawn openings before a deadline (`CHALLENGE_TTL_SECONDS`, 30); no relay, works behind NAT;
D1 stores hashes, the draw and the result, never openings.

Litmus test ("if Cloudana vanished tonight"): FAIL. The Node runtime lets anyone run the orchestrator software, but
nodes pin Cloudana's instruction key and users hold credits in Cloudana's D1. The sequence that changes this is in
`DECENTRALIZATION_ROADMAP.md` and backlog B-2, B-16, B-17.

## 7. Known limits of the design

- One D1 database is the write path for everything; heartbeats dominate it (B-5).
- ~~Verification costs the orchestrator as much CPU as the work (B-6).~~ Closed 2026-10-21: Freivalds on every job,
  the transcript on a sampled 1 in 10 (≈ 50× cheaper unsampled at n = 256).
- The relay Durable Object is a single socket per node; a relay deploy drops every node socket (deploy rarely).
- Hosting ingress and DNS are Cloudflare-operated single points; this is disclosed, not hidden.
- Secrets are visible to the provider's Docker daemon by construction; a TEE tier is the only real fix.
