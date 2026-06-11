# Cloudana Whitepaper

### Useful Compute, Honestly Decentralized

**Version 2.0 — June 2026**
*Supersedes v1.0 (March 2026). This revision corrects architectural overstatements in v1.0, documents what is actually implemented, and replaces the fixed-cap tokenomics with a sustainable disinflationary model.*

> **Disclaimer.** This document describes a protocol design and its mechanics. It is not investment advice, and nothing here is a representation about the future value of CLD. CLD is a utility token used to pay for and coordinate compute. Token classification varies by jurisdiction; Cloudana has not made and does not make any legal determination on your behalf. Consult your own counsel.

---

## 1. What Cloudana Is

Cloudana is a decentralized physical infrastructure network (DePIN) for compute. Independent providers contribute heterogeneous hardware — CPUs, GPUs, storage nodes — and users run real workloads on it: AI/ML inference and training, scientific computing, web hosting, and batch jobs. Payment and coordination flow through smart contracts on Base.

Cloudana's distinguishing bet is **Proof of Useful Work (PoUW)**: for matrix-heavy workloads, the cryptographic work that secures a provider's reward *is the user's computation itself*. The provider doesn't burn energy on a throwaway puzzle (Bitcoin) and isn't merely trusted to have run the job (most DePINs) — the proof and the product are the same matrix multiplication.

**What v1.0 overclaimed, and this version corrects.** v1.0 described the system as having "no backend" and being "trustless" at testnet. That is not accurate today and we will not market it that way. The current testnet uses a **trusted orchestrator** that verifies PoUW certificates by re-running the computation and a coordinator that records results on-chain. This is a normal, defensible starting point — it is how comparable networks launch — but it is **trust-minimized, orchestrator-coordinated**, not "completely decentralized." Full trustlessness arrives when on-chain verification replaces the orchestrator in the critical path (Section 7). We would rather state our trust model plainly than have it discovered.

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

The provider submits the certificate *and* the decoded result. The orchestrator verifies the certificate and returns C to the user. One operation, two outputs: a verifiable proof and a useful product.

### 3.3 Reward is gated on real work

CLD mining emission is paid **only** for certificates backed by a funded user workload. A provider cannot mine on random throwaway matrices and collect rewards; filler work earns nothing. This is enforced at the orchestrator (`backedByWorkload` gating) and is the structural defense against self-dealing emission farms. *(This corrects the v1.0-era implementation, where the miner ran on random matrices — that is now wired to real workload inputs.)*

---

## 4. Multi-Tier Workloads

Not all compute is a matrix multiply, so PoUW is not the verification method for everything. Cloudana uses three tiers:

- **Tier 1 — Standard** (web hosting, APIs, databases, CI). Verified by the challenger network with economic bonds. No PoUW.
- **Tier 2 — Optimistic** (ETL, transcoding, batch). Optimistic execution with fraud-proof windows.
- **Tier 3 — PoUW** (AI/ML, scientific simulation, matrix-heavy compute). Verified by PoUW certificates. This is the tier where proof and product coincide.

A user does not choose a tier manually. They describe what they need to run; the platform classifies the workload and routes it. The complexity is ours, not theirs.

---

## 5. Plug-and-Play Providers, Heterogeneous Hardware

Cloudana's onboarding promise is **flash-and-go**: a provider installs once, and the node detects what it is.

- **Auto-detection.** On startup the node fingerprints CPU, RAM, disk, and any NVIDIA GPUs (model + VRAM), classifies itself into a hardware tier (CPU-only, edge, storage, GPU-mid, GPU-high), and derives a stable device ID for one-claim-per-device anti-Sybil.
- **No bidding marketplace.** Providers do not haggle. Capacity is self-reported via detection; pricing is protocol-set per tier; the orchestrator matches workloads to nodes that fit.

**On GPUs and clustering — honestly.** Cloudana does not tightly cluster GPUs across nodes (no NVLink-equivalent over the public internet; latency makes it impractical). Instead:

- **Single-node fit.** Most inference and small/medium training jobs run whole on one node selected to fit the model's memory and compute needs.
- **Request-level parallelism.** Large batch inference is sharded across independent nodes at the request level — embarrassingly parallel, no tight coupling required.
- **What we don't claim.** We do not claim to assemble a virtual H100 cluster from consumer cards. Workloads that genuinely require a tightly-coupled multi-GPU fabric are out of scope for now, and we say so.

From the user's side this is invisible: they select the model and scale they need, and the backend handles placement.

---

## 6. Tokenomics v2 — Why We Removed the Hard Cap

### 6.1 The flaw we fixed

v1.0 specified a fixed 1B supply with Bitcoin-style emission halving to **zero**. For a useful-work network this is self-defeating: the useful work must keep happening, so the incentive to keep providers online must never reach zero. A chain whose emission stops is a chain whose providers go home.

### 6.2 The model: disinflationary tail emission + usage burn

Cloudana CLD has **no hard cap**. Instead, two opposing forces set a *dynamic* equilibrium supply — a "soft cap" determined by real usage, not a hardcoded number. This is closer to Solana's design than Bitcoin's.

**Emission (the floor that keeps providers paid).** Annual emission follows a disinflationary curve with a permanent tail:

- Starts at **8.0%** of supply per year.
- Decays **15% per year**.
- Never falls below a **1.5%** terminal rate — forever.

All emission is paid as PoUW mining rewards for *real* work. This is useful-work-backed emission, not idle staking inflation.

**Burn (the scarcity that grows with demand).** **2% of every workload payment is burned.** Because users pay for real compute — and because that payment already represents fiat value entering the system, CLD has a demand floor independent of speculation. Burn ties token scarcity directly to network usage.

**The equilibrium ("soft cap").** Net supply change = emission − burn. The network self-regulates:

| Year | Inflation | Emission | Burn (2%) | Net | Supply |
|-----:|:---------:|:--------:|:---------:|:---:|:------:|
| 1 | 8.00% | 20.0M | 0.1M | +19.9M | 269.9M |
| 2 | 6.80% | 18.4M | 0.6M | +17.8M | 287.7M |
| 3 | 5.78% | 16.6M | 2.4M | +14.2M | 301.9M |
| 4 | 4.91% | 14.8M | 6.0M | +8.8M | 310.7M |
| 5 | 4.18% | 13.0M | 12.0M | +1.0M | 311.7M |
| 6 | 3.55% | 11.1M | 13.2M | **−2.1M** | 309.6M |
| 7 | 3.02% | 9.3M | 14.5M | **−5.2M** | 304.4M |
| 8 | 2.56% | 7.8M | 16.0M | **−8.2M** | 296.2M |

*(Illustrative, assuming paid volume grows 5M→600M CLD/yr. Not a forecast.)*

While bootstrapping, the network is mildly inflationary — providers are paid to show up. As real usage grows, burn overtakes emission and supply turns **deflationary**, without ever risking the "emission stops, providers leave" failure. At steady state, equilibrium supply ≈ (annual burn) ÷ (tail rate). At 600M CLD/yr volume and a 1.5% tail, that's ≈ **800M CLD** — a soft cap *set by usage*, not decree.

### 6.3 Distribution (genesis allocations)

| Allocation | Share | Vesting |
|---|---:|---|
| Mining rewards (emitted over time) | — | Per emission schedule, no fixed total |
| Treasury / Development | 30% | 4-year linear |
| Team / Advisors | 15% | 1-year cliff + 3-year linear |
| Community / Ecosystem | 10% | Immediate + incentives |
| Initial liquidity | 5% | Immediate |
| Genesis circulating (sum of vested + liquidity) | ~250M | — |

Unlike v1.0, mining rewards are **not** a fixed 40% bucket that drains to zero — they are emitted continuously under the schedule in Section 6.2.

### 6.4 Staking and slashing

Providers bond CLD to serve workloads. Higher tiers require larger bonds. Fraud is slashed 50%, with 25% of the slash paid to the challenger who proved it; missed mandatory challenges cost 10%. This makes the cost of cheating exceed its profit.

---

## 7. Security and the Path to Trustlessness

### 7.1 Testnet (today): trust-minimized, orchestrator-coordinated

- The orchestrator verifies each PoUW certificate by re-running the block multiply and checking the transcript hash and difficulty.
- Replay is blocked by recording used `z` values (on-chain in `POUWVerifier` and in persistent orchestrator storage).
- A challenger network with bonded participants provides fraud proofs for Tier 1/2.
- **Honest limitation:** the orchestrator is trusted to verify correctly and a coordinator key records results. If that key is compromised, emission can be abused. We mitigate with role separation and an emission *envelope* (Section 7.3), but we do not call this trustless.

### 7.2 Mainnet (target): zkSNARK verification

Trustlessness arrives when certificate verification moves on-chain via a Groth16 zkSNARK (Circom + snarkjs): the provider submits a succinct proof, the contract verifies it in O(1), and the orchestrator leaves the critical path entirely. A, B remain private under the proof. This is the milestone — not the testnet — at which "decentralized verification" is an honest claim.

### 7.3 Bounded emission authority

Total minting is capped to the disinflationary schedule by an on-chain **EmissionController** that holds the only active minter role. No party can mint outside the schedule, which closes the unbounded-mint risk even while the orchestrator coordinates distribution.

---

## 8. Roadmap

- **Now — Testnet (Base Sepolia).** Real-workload PoUW, plug-and-play provider onboarding, tokenomics v2 contracts (EmissionController + fee burn), challenger network, multi-tier routing. Labeled trust-minimized.
- **Next — Hardening.** Persistent replay store, orchestrator key separation / multisig, end-to-end run proving the real-work → CLD loop closes, third-party contract audit.
- **Then — Trustless verification.** Groth16 circuits for PoUW, on-chain verifier, orchestrator removed from the critical path.
- **Mainnet.** Genesis with the v2 emission schedule; staged provider onboarding.

---

## 9. Honest Competitive Position

| | Akash | Render | io.net | Cloudana |
|---|---|---|---|---|
| Model | Marketplace | GPU render | GPU aggregation | Multi-tier DePIN |
| Verification | Reputation | Proof-of-render | Monitoring | **PoUW (Tier 3) + challengers** |
| Emission | Fixed utility | Work token | Dynamic | **Disinflationary tail + burn** |
| Useful work as proof | No | No | No | **Yes (matrix tiers)** |

Cloudana's edge is real for matrix-heavy compute, where proof and product coincide and emission is backed by paid demand. We do not claim advantage where we don't have one: for tightly-coupled large-cluster training, dedicated GPU clouds remain better suited today.

---

## 10. Conclusion

Cloudana turns the energy a chain would waste into computation a user actually wants, pays providers in a token whose scarcity grows with real usage rather than speculation, and onboards hardware by detection rather than configuration. We are shipping this as an honestly-labeled testnet — trust-minimized today, trustless when the math is on-chain — because the difference between those two claims is exactly the difference we intend to earn.

---

*Appendix references: Komargodski & Weinstein (2025), IACR ePrint 2025/685; Cloudana contract suite (EmissionController, CLDToken, RewardContract, POUWVerifier, StakingManager, ChallengeManager, ProviderMinter, ProviderRegistry, WorkloadRegistry).*
