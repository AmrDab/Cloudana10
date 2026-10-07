# Cloudana — strategy working notes (2026-09-28)

> **Superseded values (2026-10-05).** Fee split is now 95 % provider / 3 % treasury / 2 % net burn, price unit nCLD/TMAC + base fee, 1 h testnet epochs, per-operator cluster gate with N_MIN 3, 100M mainnet genesis — see [DECISIONS_CONSENSUS.md](DECISIONS_CONSENSUS.md) and [IMPL_SPEC_2026-10.md](IMPL_SPEC_2026-10.md). Figures below (0.975 / 0.005, 250M, 120 s epochs) are kept as the historical record of this analysis.

Compiled from the owner ↔ engineering discussion. **Nothing here is implemented yet unless marked ✅.**
Status: draft for review. Supersedes nothing until the owner signs off; the whitepaper is unchanged.

---

## 0. Urgent — found while answering "how is CLD generated?"

- **The leaked orchestrator key can mint unlimited CLD.** Wallet `0xF292…c61A` (key committed to git in
  `86fa598`, repo public) holds **MINTER_ROLE and DEFAULT_ADMIN_ROLE on CLDToken** and has ~0.25 ETH for gas.
  Anyone with the repo can mint testnet CLD and grant themselves roles. Testnet CLD has no value, but this
  breaks testnet integrity and contradicts whitepaper §7.3 ("EmissionController holds the only active minter
  role"). **Owner action:** revoke both roles from that wallet (from another admin), rotate the key, never
  reuse it. Never deploy mainnet with any key that has touched this repo.

## 1. Vision (owner)

Cloudana is the **decentralized foundation for the internet**: CPUs and GPUs worldwide coordinated by an
orchestrator, with **Proof of Useful Work to verify computation and commoditize data** — outputs that carry a
proof anyone can check become trustworthy, tradable data.

Refinements agreed in discussion:
- **Cloudana is an orchestrator, not a marketplace.** It sets price from supply and demand; nobody bids.
- "Cluster" over the internet = a **swarm of independent workers**, not one tightly coupled machine
  (home links are ~10⁶× slower than datacenter interconnect). Loosely coupled work scales; tightly coupled
  work (large-model training, multi-GPU fabrics) does not.
- Cloudana's durable edge is **proof**, not hardware. The path to "foundation of the internet" is one
  *provable* layer at a time.

## 2. Verification model

| Question | Mechanism | Cost | Who runs it |
|---|---|---|---|
| Was the work done? (gates rewards) | cuPOW transcript re-execution | O(n³) — same as the work | Orchestrator today → **CPU node quorum** → zk (mainnet) |
| Is the answer right? (C = A·B) | **Freivalds' check** | O(n²) — measured ≈0.1% of the work check | Browsers / any CPU |
| Is an inference answer right? | Freivalds per layer + recompute cheap elementwise ops (batch int8) · **sampled canaries** (chat) | cheap / probabilistic | CPUs, browsers |

- **Freivalds verifies the product, not the transcript.** Browsers cannot gate emission; they confirm answers.
- **cuPOW limits today:** integer-only over F_p (p = 1e9+7), exactness bound |entry| ≤ √(p/2n) (int8 fits),
  n ≤ 1024, JS/BigInt on CPU, full re-execution to verify.
- **Canaries / ringers** (Golle & Mironov): known-answer tasks mixed into normal traffic. Detection after k
  canaries = 1 − (1 − q)^k (q = fraction a cheater fakes). Must be **indistinguishable** from real work
  (same path, realistic distributions, rotating pool). Canary jobs can replace today's "filler" mining.
- **Verifiers are verified too:** planted known-bad results catch lazy "✓" verifiers.
- **Redundancy:** each public result goes to 3–5 random verifiers; any ✗ escalates to the orchestrator.
- **Privacy:** crowd (browser) verification only for **public** data. Private jobs → orchestrator / TEE.
- **Bandwidth:** full check downloads A, B, C (~8 MB at n=1024). Light mode for phones: spot-check random
  entries (one row + one column each, ~8 KB) — catches widespread errors, can miss a single bad entry.
- **ChallengeManager** (bonded challengers) is **replaced** by planted tasks + multi-verifier redundancy.
  As deployed it is unused (0 challengers), resolved by a trusted role, and its block-count windows assume
  12 s blocks — on Base (2 s) a provider has 50 s to respond or lose 50% stake.

## 3. Workload scope

- **Now: verifiable batch AI** — embeddings, classification, scoring, int8 batch inference on open models,
  plus raw matrix jobs. Fully provable (cuPOW + Freivalds).
- **Next: chat inference** — sampled auditing via canaries (call it auditing, not proof: GPU nondeterminism
  needs tolerances).
- **Later: confidential tier** — TEE-attested nodes (AMD SEV-SNP, Intel TDX, NVIDIA H100 CC). **The container
  path returns here**, now verifiable by attestation.
- **Parked, not deleted:** K3s builder, SSH provisioning, SDL parser, Akash bridge, deploy pipeline
  (~9.8k backend + ~9.5k console lines). Move to a labelled `legacy/containers` area, keep it compiling in
  CI, remove it from UI and claims until verifiable. None of it runs in production today (routes 404,
  orchestrator not deployed), so parking removes no working feature.
- **Web/VPN analysis:** canaries verify *outputs*, not *misuse of inputs*. Static hosting is fully
  verifiable (known hashes). Dynamic apps/DBs: availability and durability only. **VPN: no-logging is
  unverifiable without TEEs**, and exit nodes put legal exposure on home providers → out of scope.
- Probe canaries for hosting must come from many IPs (browser verifiers make good residential probes).

## 4. Roles by hardware (providers are *any* hardware)

| Hardware | Role |
|---|---|
| GPUs | Heavy AI jobs, large matrix jobs |
| Desktop/server CPUs | Small matrix jobs (cuPOW already runs on CPU), small models, **work verification quorum** (decentralizes the orchestrator before zk) |
| Laptops/browsers | Answer checks on public results |
| Phones/low-power | Light spot-checks |
| Storage-heavy machines (later) | Store/serve published results and datasets |
| TEE-capable servers (later) | Confidential tier, verified containers |

Earnings follow work done ((n/64)^1.5 today); route by hardware so CPUs aren't losing races to GPUs.

## 5. Audiences

- **Demand:** (1) on-chain builders needing verifiable off-chain compute — strongest fit, certificates
  already settle on Base; (2) open science / public-good data — the "cause"; (3) AI teams doing batch work
  on open models — proof must be the reason, not price alone (Runpod/Vast are cheap); (4) regulated
  industries — after the TEE tier.
- **Supply:** GPU owners (earn), CPU owners (earn, verify), browser contributors (cause, teams).
- **Not yet:** real-time chat apps, large-model training, enterprises needing SLAs, pure price shoppers.

## 6. Pricing (orchestrator-set)

- **Price per unit of verified work** (CLD per billion multiply-adds) — hardware-neutral; cuPOW makes the
  work measurable and proven. Today's `(n/64)^1.5` is a crude version.
- **Supply/demand adjustment** like Ethereum's base fee: backlog → price up a few % per interval; idle →
  down; bounded. Users get a quote locked for a few minutes.
- **Optional provider floor, pre-filled with an estimate:** measured watts (nvidia-smi / RAPL) ÷ benchmarked
  throughput × electricity price × (1 + margin). Floor compares against **fee + expected mining reward**
  (emission bridges the gap while demand is thin).
- **Optional user ceiling, pre-filled with an estimate:** current price + headroom; plus an optional
  deadline (refund if unmatched).
- **Match rule:** provider floor ≤ current price ≤ user ceiling. Floors/ceilings filter eligibility; they
  never set the price.
- **Hold the ceiling, charge the actual price,** refund the difference at settlement.
- **Keep individual floors/ceilings private;** publish only aggregate price and supply.
- **Show what a ceiling means:** "~140 GPUs eligible, est. start 2 min".
- Recommended: **FIFO** among eligible jobs (a higher ceiling buys eligibility, not priority); optional
  fixed protocol surcharge for priority later. *(Owner decision.)*
- Open: CLD↔USD conversion needs a price feed (today fixed `CLD_USD_RATE=100`) — a trust point to name.

## 7. Placement

- Today: PoUW queue = first provider to poll gets the oldest job; container placement = first fit.
- Proposed: **hard filters** (hardware fits, price window, optional region) → **score** (estimated finish time
  = queue wait + transfer (size ÷ bandwidth) + compute (size ÷ throughput); reliability; latency weighted only
  for interactive jobs) → **weighted random draw among the top few** (prevents centralization, resists
  gaming, spreads load).
- **Orchestrator assigns** on a ~1 s cycle; providers poll only for their own assignment.
- Inputs: startup benchmark (checked against certificates), bandwidth test, latency to regional probes,
  IP region, reliability from settlement records.

## 8. Fault tolerance

- Batch jobs: the provider only holds a working copy. ✅ **Expired claims are already reassigned**
  (`claimJob`). No double charge; unfinished work unpaid.
- Add: **heartbeats** (~15 s) for ~30 s reassignment (claim TTL is 5 min today); **checkpoint by cuPOW block**;
  **speculative duplicate** near deadlines; **reliability score** (no slashing for honest outages).
- **Gap:** job inputs/results are stored as JSON inside D1 rows — too large at real sizes. Move to object
  storage (R2 / content-addressed IPFS); rows keep the hash. Required before job #1 at real scale.
- Stateful work (DBs, sites) needs replication, consensus, snapshots, failover — the hardest problem in
  decentralized infra and a reason it waits for the later tier. Datacenters can register **as a cluster**
  (they handle internal failover; Cloudana treats them as one pool).

## 9. Homepage direction

- Prototype: `client/public/prototype-verify.html` (Folding@home model, unlinked, noindex). Real in-browser
  verifier: work check vs answer check with measured cost; ~13% planted corrupted tasks; live stats band;
  honest empty states.
- Fable's critique adopted: Folding@home works because the beneficiary isn't the operator — Cloudana needs a
  **cause**: **public job #1** (Cloudana funds an open workload and publishes results). Contributor
  economics: design for intrinsic motivation; credits are a ledger, not a wage.
- **Owner decisions:** (a) which workload is job #1 and does the treasury fund it; (b) hero leads with
  **contributors** or **on-chain builders**; (c) never state "credits may convert" publicly until legal review.

## 10. Code impact (measured)

- Stays: PoUW core + API foundation (~4.9k lines).
- Changes (small): submit fixes; queue becomes the product; provider node → GPU worker (miner is 273 lines).
- New (moderate): browser task feed + verdicts + redundancy + planted tasks; verifier ledger + teams;
  int8 inference job format (layer chains); job #1; pricing layer; placement scorer; heartbeats/checkpoints;
  object storage for job data.
- Parked: the container path (§3).

## 11. Known bugs (must fix first)

1. `/pouw/submit` does not check that the certificate's A, B are the claimed job's matrices → a miner can
   attach any certificate to a paid job and be paid as "backed".
2. `/pouw/submit` never checks C → the owner can receive a wrong answer. Fix: compare `matHash(job.A/B)`
   with the certificate, and Freivalds-check C before `completeJob`.

## 11b. Extensible foundation — one pipeline, pluggable work types

Goal: add GPU, CPU, storage, bandwidth, etc. contributions later **without redesigning** identity, assignment,
ledger, settlement or minting. Rule: **no proof, no mint** — a resource earns only once it has a verification method.

**Shared core (built once):** node identity + capability manifest (CPU, RAM, GPU/VRAM, disk, bandwidth, TEE, region —
auto-detected), assignment engine (capacity-weighted draw, cluster test), pricing (price per unit, floors/ceilings),
integer-wei ledger, epoch Merkle settlement, two-lane minting, API envelope, monitoring.

**A `WorkType` plugin supplies only what differs:**

    interface WorkType {
      id: string                        // "matmul", "inference.int8", "storage", "bandwidth", …
      requirements(job): Filter         // what hardware is eligible
      meter(job): Units                 // protocol-computed, never self-reported
      verify(submission): Verdict       // the proof for this resource
      plantedTask(): Task               // canary / known answer, indistinguishable from real work
      estimateFloor(node): Price        // from the node's benchmark + power
    }

| Resource | Unit | Proof | Status |
|---|---|---|---|
| GPU / CPU compute | verified multiply-adds | cuPOW transcript + Freivalds | first plugin |
| CPU verification | graded verdicts | planted tasks, commit–reveal | first plugin |
| Storage | GB-hours retained | random chunk challenges on content-addressed data (proof of retrievability) | later |
| Bandwidth | GB served | receipts signed by paying clients + probe canaries | later (hardest: fake clients) |
| RAM | — | not a standalone service; it's a capability that qualifies a node for bigger jobs | attribute |
| Confidential compute | attested hours | TEE remote attestation | later tier |

Ledger entries, certificate log and budget weights carry `workType`; the reward contract only sees amounts.
Node agent: per-resource modules with opt-in toggles and estimated earnings. **Build steps 2–7 of the issuance
plan generically around `WorkType` from day one, with matmul as the first plugin** — small extra cost now, no rework
later.

## 12. CLD — current state (verified on Base Sepolia, 2026-09-28)

- Total supply **2,000,000 CLD**: 1,000,000 genesis (80% treasury / 20% team, `CLDToken` constructor) +
  1,000,000 minted later; **RewardContract (v1) holds 1,000,000** as the mining pool.
- **Mining rewards are transfers from that pre-funded pool, not new issuance.**
- **EmissionController, RewardContract_v2_burn, ProviderMinter, CLDFaucet: not deployed.** No burn exists.
- The API faucet mints 100 CLD per claim via the orchestrator wallet's MINTER_ROLE (see §0).
- **User payments are off-chain credits** (D1 `balances`, bought via Stripe at `CLD_USD_RATE` or by
  depositing CLD to the treasury). Paid jobs debit these credits; **no on-chain CLD moves per job.**

### Mainnet design (whitepaper + contracts)

- **Issuance:** EmissionController mints a daily budget = supply × rate × (1 day / 1 year) into the reward
  pool; rate 8% → ×0.85 per year → 1.5% floor. Permissionless trigger; should be the **only** minter.
- **Distribution:** the reward pool pays providers for **verified, workload-backed** certificates.
- **Payments:** users pay CLD for work; RewardContract v2 splits **97.5% provider / 2% burned / 0.5% treasury**.
- So CLD is **created by the schedule, earned by verified work, and destroyed by usage** — not minted out of
  a workload. Net supply = emission − burn.

> **Superseded by `CLD_ISSUANCE_DESIGN.md`** — owner direction: CLD is minted per verified workload; the
> emission schedule becomes a ceiling, not a drip. The questions below are answered there.

### Open design questions

- **Self-dealing:** emission is time-based, split among whoever did backed work. A provider can pay for its
  own jobs (losing ~2.5% of the fee to burn + treasury) and collect a share of emission. Profitable whenever
  its emission share exceeds ~2.5% of what it pays — likely while real demand is small. Needs a bound (e.g.
  emission per certificate ≤ k × fee paid, or a cap per payer/provider pair).
- **Off-chain credits vs on-chain CLD:** credits never touch the chain, so the burn/treasury split can't run
  on them. Decide whether jobs settle on-chain (escrow in RewardContract v2) or credits are periodically
  netted on-chain.
- **What happens to the 1M CLD pre-funded pool** when emission starts.
