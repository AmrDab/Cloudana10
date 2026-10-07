# Cloudana Whitepaper

### Useful Compute, Honestly Decentralized

**Version 2.1 — October 2026**
*Supersedes v2.0 (June 2026) and v1.0 (March 2026). v2.0 corrected v1.0's architectural overstatements. This revision replaces v2.0's drip-emission tokenomics (§6) with the burn-and-mint-per-verified-job model that is actually implemented, publishes the mainnet genesis and vesting table, and marks the staking/challenger design as superseded. Decision record: [DECISIONS_CONSENSUS.md](DECISIONS_CONSENSUS.md).*

> **Disclaimer.** This document describes a protocol design and its mechanics. It is not investment advice, and nothing here is a representation about the future value of CLD. CLD is a utility token used to pay for and coordinate compute. Token classification varies by jurisdiction; Cloudana has not made and does not make any legal determination on your behalf. Consult your own counsel. Cloudana runs on a testnet today; testnet CLD has no monetary value.

---

## 1. What Cloudana Is

Cloudana is a decentralized datacenter: a decentralized physical infrastructure network (DePIN) for compute. Independent providers contribute heterogeneous hardware — CPUs, GPUs, storage nodes, from a home PC to a full rack — and users run real workloads on it: AI/ML inference and training, scientific computing, web hosting, and batch jobs. One orchestrator assigns every job and sets its price; payment settles through smart contracts on Base.

Cloudana's distinguishing bet is **Proof of Useful Work (PoUW)**: for matrix-heavy workloads, the cryptographic work that secures a provider's reward *is the user's computation itself*. The provider doesn't burn energy on a throwaway puzzle (Bitcoin) and isn't merely trusted to have run the job (most DePINs) — the proof and the product are the same matrix multiplication.

**What v1.0 overclaimed, and this version corrects.** v1.0 described the system as having "no backend" and being "trustless" at testnet. That is not accurate today and we will not market it that way. The current testnet uses a **trusted orchestrator** that verifies PoUW certificates by re-running the computation and posts settlement batches to a contract on Base Sepolia. This is a normal, defensible starting point — it is how comparable networks launch — but it is **trust-minimized, orchestrator-coordinated**, not "completely decentralized." Full trustlessness arrives when on-chain verification replaces the orchestrator in the critical path (Section 7). We would rather state our trust model plainly than have it discovered.

---

## 2. The Problems We Address

**Cloud centralization.** A handful of hyperscalers control most cloud capacity, with opaque pricing and 40–60% gross margins. Heterogeneous, independently-owned hardware can undercut this if it can be coordinated and verified.

**Wasted consensus energy.** Proof-of-Work chains spend enormous compute on puzzles with no use outside securing the chain. If the securing work were *also useful*, that energy produces value twice.

**The DePIN verification problem.** Decentralized compute networks must answer "did the provider actually do the work?" Re-execution is expensive; pure trust is weak. PoUW answers it with mathematics for the workload class where it applies.

---

## 3. Proof of Useful Work (PoUW)

### 3.1 Foundation

Cloudana's PoUW is a direct implementation of Komargodski & Weinstein, *"Proofs of Useful Work from Arbitrary Matrix Multiplication"* (IACR ePrint 2025/685). The key property: the hardness comes from the **transcript of intermediate computation blocks**, not from the final output. The output of a matrix multiply can be shortcut with low-rank tricks; the full block-by-block transcript cannot. That is what makes the work both useful (it computes a real product) and unfakeable (you must actually do it).

### 3.2 The cuPOW Protocol (as implemented)

For a real workload supplying matrices A and B:

1. **Encode.** Derive low-rank noise E = Eₗ·Eᵣ and F = Fₗ·Fᵣ deterministically from a seed σ (the latest Base block hash). Form A′ = A+E, B′ = B+F.
2. **Block multiply.** Compute A′·B′ in r×r blocks, hashing every intermediate block into a transcript. Block size r ≈ n^0.3.
3. **Proof.** z = SHA-256(σ ‖ H(transcript) ‖ H(A) ‖ H(B)). A certificate is valid when z has the required leading-zero bits (difficulty).
4. **Decode.** Recover the clean product C = A·B in O(n²·r) — far cheaper than the O(n³) multiply already performed. **C is the answer the user paid for.**

The provider submits the certificate *and* the decoded result. The orchestrator verifies the certificate (and Freivalds-checks the result) and returns C to the user. One operation, two outputs: a verifiable proof and a useful product.

### 3.3 CLD is minted only for real, paid work

CLD is minted **only** for a verified certificate backed by a funded user job (Section 6.2). A provider cannot run random throwaway matrices and collect rewards; filler work earns nothing. This is enforced at the orchestrator (`backedByWorkload` gating) and is the structural defense against self-dealing emission farms. *(This corrects the v1.0-era implementation, where the miner ran on random matrices — that is now wired to real workload inputs.)*

---

## 4. Multi-Tier Workloads

Not all compute is a matrix multiply, so PoUW is not the verification method for everything. Cloudana uses three tiers:

- **Tier 1 — Standard** (static hosting today; APIs, databases, CI later). Served through a Cloudana gateway and probed every minute for reachability and a content hash of the uploaded files; the orchestrator can stop a deployment. Paid by fees only — **no subsidy**.
- **Tier 2 — Optimistic** (containers, ETL, transcoding, batch). Attested by probes and reputation today; fraud-proof windows later. Paid by fees only until a proof exists.
- **Tier 3 — PoUW** (AI/ML, scientific simulation, matrix-heavy compute). Verified by PoUW certificates. This is the tier where proof and product coincide, and the only tier eligible for the subsidy lane.

A user does not choose a tier manually. They describe what they need to run; the platform classifies the workload and routes it. The complexity is ours, not theirs. *(v2.0 described a bonded "challenger network" for Tiers 1–2; that design is superseded — see §6.4.)*

---

## 5. Plug-and-Play Providers, Heterogeneous Hardware

Cloudana's onboarding promise is **flash-and-go**: a provider installs once, and the node detects what it is.

- **Auto-detection.** On startup the node fingerprints CPU, RAM, disk, and any NVIDIA GPUs (model + VRAM), classifies itself into a hardware tier (CPU-only, edge, storage, GPU-mid, GPU-high), and derives a stable device ID for one-claim-per-device anti-Sybil.
- **No bidding.** Providers do not haggle and users never pick a provider. Capacity is self-reported via detection; the price is protocol-set from utilization (Section 6.2); the orchestrator assigns each job by a weighted random draw among the nodes that fit. A provider may set a floor price below which it won't take work; the orchestrator still sets the price.
- **No stake.** A misbehaving node is unbound and banned; the subsidy lane vests and can be clawed back before it does (§6.4).

**On GPUs and clustering — honestly.** Cloudana does not tightly cluster GPUs across nodes (no NVLink-equivalent over the public internet; latency makes it impractical). Instead:

- **Single-node fit.** Most inference and small/medium training jobs run whole on one node selected to fit the model's memory and compute needs.
- **Request-level parallelism.** Large batch inference is sharded across independent nodes at the request level — embarrassingly parallel, no tight coupling required.
- **What we don't claim.** We do not claim to assemble a virtual H100 cluster from consumer cards. Workloads that genuinely require a tightly-coupled multi-GPU fabric are out of scope for now, and we say so.

From the user's side this is invisible: they select the model and scale they need, and the backend handles placement.

---

## 6. Tokenomics — CLD Is Minted Per Verified Job

### 6.1 What earlier versions got wrong

v1.0 specified a fixed 1B supply with Bitcoin-style emission halving to **zero**. For a useful-work network this is self-defeating: the work must keep happening, so the incentive to keep providers online must never reach zero.

v2.0 replaced that with an 8%-per-year drip of "mining rewards" decaying to a 1.5% tail, paid from an emission controller, and a genesis table whose allocations summed to 60%. The drip was never built. What shipped — and what this section now documents — is different: **new CLD exists only because someone paid for real, verified computation.** The subsidy that bootstraps the network is small, capped and declining, and governance can set its floor to zero.

### 6.2 The model: burn the fee, mint for the verified job

Only one event creates CLD: a verified, paid job.

1. The user pays a fee **F** in CLD. It is held in escrow until the job verifies.
2. At settlement the **whole fee is burned**.
3. For the verified job, the provider is **minted 95% of F**, the protocol treasury is **minted 3% of F**, and **2% of F is destroyed for good** (net burn).
4. If the orchestrator's random draw chose that provider *and* the cluster gate passed, a **capped subsidy** (lane B) is minted on top.

Burn-then-mint rather than a plain transfer gives the contract one invariant to enforce: `minted ≤ fees burned × 98% + subsidy allowance`. The split is enforced on-chain at mainnet (treasury ≥ 3% of fees burned, provider + treasury ≤ 98%); on testnet it is applied in the ledger and checked by the settlement contract on every posted batch. The treasury share is a one-way-down knob.

**Price.** Compute is priced in **nano-CLD per tera-MAC** (nCLD/TMAC) plus a small per-job base fee; hosting, containers and workstations are priced per hour. The price is set by a utilization controller — it moves at most ±2% per hour toward a 70% utilization target and holds when the network is idle. There is no price oracle: CLD is the unit of account and the only settlement asset, and USD is shown for display only. Users may add a ceiling, providers a floor; both are optional. The mainnet launch price is taken from the testnet median.

**Subsidy (lane B).** While the network bootstraps, a provider chosen by the random draw also receives `S = ρ·F` with ρ = 0.25 (0.5 only once ≥10 independent clusters exist and the largest holds ≤30% of capacity). Lane B is withheld when fewer than N_MIN independent clusters are online, and withheld from any single operator whose share of the epoch's eligible work exceeds S_CAP (testnet N_MIN 3 / S_CAP 0.5; mainnet 5 / 0.34). Hosting and other unproven services earn no subsidy. The total lane B minted in a year is capped by the **subsidy allowance**:

| Period | Annual allowance (illustrative on a 100M genesis) |
|---|---|
| Years 1–4 | min(chain allowance, 4% of genesis) ≤ 4.0M CLD/yr |
| Years 5–8 | ≤ 2.0M CLD/yr (halved) |
| Years 9–12 | ≤ 1.0M CLD/yr (halved) |
| Thereafter | floor of 1% of live supply per year; governance may set it to 0 |

Unused allowance is never minted. Lane B vests before it can be claimed (1 hour on testnet, 7 days at mainnet); a guardian can void it before vesting.

**Annual mint ceiling.** Independently of the schedule, the token contract refuses to let net new supply (mints minus burns) grow by more than 10% of the supply at the start of each year, across all lanes and the treasury. It is net because every settled fee is burned and mostly re-minted; a gross cap would stop payouts on a busy network. No role can mint outside this ceiling.

**Supply dynamics.** Net supply change per year ≈ subsidy minted − 2% of fees. Supply grows mildly while the subsidy exceeds the net burn and shrinks once annual fees exceed 50× the subsidy actually minted. Where that crossover falls depends entirely on paid usage; the 20-year simulation at `/control/economics` shows scenarios, not a forecast.

**Settlement.** Mint amounts are fixed when the job verifies. The orchestrator batches them into epochs (1 hour on testnet, 24 hours at mainnet) and posts one Merkle root per epoch; a guardian may veto within the window (1 h testnet, 24 h mainnet); after it, the fees are burned, the treasury is minted, and lane A becomes claimable. Batching is delivery, not the reward unit — nothing is "earned per epoch."

### 6.3 Genesis and allocation

**Testnet.** A fresh 1,000,000 CLD token on Base Sepolia, minted to the testnet treasury, with the settlement contract as its only minter. It has no monetary value and is abandoned at mainnet; only provider reliability history and "founding provider" status carry over. There is no points or airdrop formula.

**Mainnet genesis: 100,000,000 CLD**, all vesting enforced on-chain:

| Allocation | Share | Amount | Vesting |
|---|---:|---:|---|
| Protocol treasury | 40% | 40M | 6-month cliff, then 48-month linear |
| Ecosystem (datacenter-partner bootstrap, free tier, grants) | 25% | 25M | released at most 10% of the allocation per year |
| Team and advisors | 20% | 20M | 12-month cliff, then 36-month linear |
| Liquidity | 10% | 10M | at genesis; pool sized to ≥30× daily fees |
| Testnet retro (founding providers) | 5% | 5M | by verified reliability history; terms set with counsel before mainnet |
| **Total** | **100%** | **100M** | |

Provider rewards are **not** an allocation: they are minted per verified job under §6.2, on top of genesis. The free tier (one static site per verified identity) is a customer the Ecosystem allocation pays for at normal fees — it is not new emission. The datacenter-partner bootstrap is paid from the Ecosystem allocation, not from the subsidy lane.

### 6.4 Superseded: staking, slashing and challengers

v2.0 §6.4 and §7.1 described provider bonds, 50% slashing and a bonded challenger network. **That design is superseded and not built.** Providers post no stake. Honesty is enforced by: the orchestrator's re-execution of every transcript, Freivalds checks on every result, **planted tasks** with known answers mixed into verifier work, hash-checked hosting probes, and unbinding and banning of a misbehaving node. The **lane-B vesting period acts as the bond**: subsidy for a job later found fraudulent is voided by the guardian before it vests. After mainnet, an on-chain Freivalds challenge against a poster bond replaces the guardian for this role (see `DECENTRALIZATION_ROADMAP.md`). The legacy `StakingManager` and `ChallengeManager` contracts are abandoned.

---

## 7. Security and the Path to Trustlessness

### 7.1 Testnet (today): trust-minimized, orchestrator-coordinated

- The orchestrator verifies each PoUW certificate by re-running the block multiply and checking the transcript hash and difficulty, then Freivalds-checks the decoded result.
- Replay is blocked by recording used `z` values in persistent orchestrator storage; a certificate spends once.
- Browser verifiers re-check finished public jobs, with planted wrong answers to catch careless verifiers. Verifier credits are points, not CLD.
- Settlement is a Merkle root per epoch on Base Sepolia, posted by a keeper that runs isolated from the API, with a veto window and a guardian multisig.
- Instructions sent to nodes are signed with a key that holds no funds; nodes ignore anything unsigned or stale.
- **Honest limitation:** the orchestrator is trusted to verify correctly and a poster key submits batches. If that key is compromised, the guardian's veto and the on-chain mint invariants (§6.2, §7.3) bound the damage, but we do not call this trustless.

### 7.2 Mainnet (target): zkSNARK verification

Trustlessness arrives when certificate verification moves on-chain via a Groth16 zkSNARK (Circom + snarkjs): the provider submits a succinct proof, the contract verifies it in O(1), and the orchestrator leaves the critical path entirely. A, B remain private under the proof. This is the milestone — not the testnet — at which "decentralized verification" is an honest claim.

### 7.3 Bounded mint authority

The settlement contract is the token's **only minter**. It can mint only against a posted, un-vetoed epoch, never more than 98% of the fees burned in that epoch plus the subsidy allowance, and the token itself refuses to exceed the annual ceiling (§6.2). No party can mint outside these bounds even while the orchestrator coordinates distribution. Admin, poster and guardian roles sit under a Safe; a 48-hour timelock is added before mainnet.

---

## 8. Roadmap

- **Now — Testnet (Base Sepolia).** Verified matrix jobs and static hosting on home and datacenter nodes; per-job burn-and-mint with the 95/3/2 split; hourly epochs with veto; fresh token and settlement contract under a Safe; signed node instructions. Exit: 30 days of hourly epochs finalized, including a veto drill.
- **Next — Incentivized testnet.** Two datacenter partners and at least 15 home nodes; the first public job; the free static tier behind the gateway; epoch leaves and draw seeds published so anyone can recompute roots and replay draws. Exit: ≥3 independent clusters with the largest ≤30% for 60 days; utilization held at 0.6–0.8 for 30 days; counsel engaged.
- **Then — Trustless verification.** Groth16 circuits for PoUW, on-chain verifier, orchestrator removed from the critical path.
- **Mainnet.** 100M genesis with on-chain vesting (§6.3); 24-hour epochs; fee split enforced on-chain; timelock; audits; liquidity pool ≥30× daily fees; capped free tier.

---

## 9. Honest Competitive Position

| | Akash | Render | io.net | Cloudana |
|---|---|---|---|---|
| Model | Reverse auction | GPU render | GPU aggregation | Orchestrator-assigned datacenter |
| Verification | Reputation | Proof-of-render | Monitoring | **PoUW (Tier 3) + probes** |
| Issuance | Fixed utility | Work token | Dynamic | **Minted per verified job + capped subsidy** |
| Useful work as proof | No | No | No | **Yes (matrix tiers)** |

Cloudana's edge is real for matrix-heavy compute, where proof and product coincide and issuance is backed by paid demand. We do not claim advantage where we don't have one: for tightly-coupled large-cluster training, dedicated GPU clouds remain better suited today.

---

## 10. Conclusion

Cloudana turns the energy a chain would waste into computation a user actually wants, mints CLD only for work someone paid for and a proof confirmed, and onboards hardware by detection rather than configuration. We are shipping this as an honestly-labeled testnet — trust-minimized today, trustless when the math is on-chain — because the difference between those two claims is exactly the difference we intend to earn. Nothing about CLD is a promise of price or return.

---

*Appendix references: Komargodski & Weinstein (2025), IACR ePrint 2025/685; Cloudana contract suite v2 (CLDToken, CloudanaSettlement). The legacy suite (EmissionController, RewardContract, POUWVerifier, StakingManager, ChallengeManager, ProviderMinter, ProviderRegistry, WorkloadRegistry) is abandoned and will not be deployed at mainnet.*
