# Universal PoUW — one mechanism for every resource (design, not implemented)

> **Superseded values (2026-10-05).** Fee split is now 95 % provider / 3 % treasury / 2 % net burn, price unit nCLD/TMAC + base fee, 1 h testnet epochs, per-operator cluster gate with N_MIN 3, 100M mainnet genesis — see [DECISIONS_CONSENSUS.md](DECISIONS_CONSENSUS.md) and [IMPL_SPEC_2026-10.md](IMPL_SPEC_2026-10.md). Figures below (0.975 / 0.005, 250M, 120 s epochs) are kept as the historical record of this analysis.

Status: proposal for owner review · 2026-09-28 · Fable (first principles) + research agent (state of the art, cited).
Owner requirement: *"Like PoW, our PoUW mechanism should apply to all resources, not just GPUs."*
Cloudana = a decentralized datacenter on heterogeneous home + datacenter hardware, backed by the chain.

---

## 1. Why PoW is universal — and what useful work must change

PoW works for everyone because its challenge is bound to **nothing**: hash the chain seed, anyone can check.
Useful work can keep most of PoW's properties, but must **bind the chain seed σ to a committed real object** —
the job's matrices, the stored data's Merkle root, the served content's hash:

    Response = f(σ, resource spent after σ, commitment)          checkable given the commitment

| PoW property | Useful work |
|---|---|
| Unpredictable challenge from the chain (σ) | kept — σ issued at assignment |
| Only producible by spending the resource now | kept — bound to a commitment |
| O(1) check by anyone | weakens to "cheap for someone" (Freivalds, Merkle, witnesses) |
| One self-metering unit (hashes) | replaced by **price** (see §3) |
| Reward ∝ resource | kept — assignment replaces the lottery |
| No witnesses, no counterparty | lost for bandwidth/latency/uptime → witnesses |

**Field evidence that the binding matters:** Pearl, the only production cuPOW chain (mainnet Apr 2026, ~112 MW),
was shown to do **no AI work** — miners choose their own inputs, so random matrices earn the same.
([Usefulness Gap, arXiv 2606.04819](https://arxiv.org/html/2606.04819v2)). Cloudana's orchestrator-assigned, paid
inputs are exactly the missing piece: **usefulness is enforced by demand, not assumed.**

## 2. Definition

A **resource proof** for resource R is `(Commit, Challenge(σ), Respond, Verify, Meter, Witnesses, Δ)` such that producing
a valid response within Δ of the challenge, without spending `Meter` units of R, costs at least as much as spending them.
Meter is computed by the protocol from the job — never self-reported. **No proof, no mint.** Anything without a proof
can still be *offered and paid by fees*; it just earns no subsidy.

Four proof classes, by where the resource shows up:

| Class | Resources | How it's proven |
|---|---|---|
| **Self-proving** | CPU, GPU compute | cuPOW transcript bound to σ + the job; answer checked by Freivalds |
| **Possession** | storage, RAM | σ-random challenges on committed data, answered within a latency bound Δ |
| **Interaction** | bandwidth, latency, uptime, static hosting | **witnesses** — σ-chosen probes from the verifier network |
| **Attestation** | confidential compute, dynamic hosting | TEE quote — customer-facing assurance, not a mint root on its own |

## 3. One mint rule: price, not multipliers

Heterogeneous units become comparable the way PoW does it — **difficulty is a price.** Each work type has a protocol
price p_R (supply/demand, STRATEGY_NOTES §6); a verified proof is worth its **fee value F = p_R · u_R**.
Quality (latency tier, redundancy) is a price tier, never a mint multiplier.

*Evidence:* Filecoin's 10× "verified deal" multiplier was gamed through self-dealing and FIP Daybreak proposes removing
it ([spec](https://spec.filecoin.io/systems/filecoin_mining/sector/sector-quality/),
[FIP discussion](https://github.com/filecoin-project/FIPs/discussions/1238)). F is linear (degree-1 homogeneous) in each
resource, consistent with the only formal result on combining resources (Baig–Günther–Pietrzak, AFT'25,
[arXiv 2508.01448](https://arxiv.org/abs/2508.01448)).

The existing two-lane mint generalizes per work type:
- **Lane A (fee-backed):** burn F, mint 0.975F to the provider (+0.5% treasury). Any work type with a proof or payer receipt.
- **Lane B (subsidy):** min(ρF, r·u) — **only for units whose server or measurer was σ-selected.**
  The wash-trade bound s < 1/(0.975+ρ) needs the orchestrator to choose who serves. When the *user* chooses
  (e.g. a specific CDN edge), an attacker has s = 1, so those units get lane A only.

## 4. Per-resource design and how mature each proof is

| Resource | Useful work | Proof | Verifier & cost | Main attack → counter | Field maturity | Subsidy |
|---|---|---|---|---|---|---|
| **CPU/GPU compute** | assigned jobs (matmul → int8 inference) | cuPOW + Freivalds (built) | work: quorum → zk; answer: anyone, O(n²) | stolen/stockpiled certs → σ binding (built) | Pearl in production (cuPOW); PoSP-style spot re-exec in production (Hyperbolic, Theta) | yes |
| **Storage** | hold user + network data, **sealed per replica**, erasure-coded | σ-random chunk challenges + Merkle path within Δ; **plus retrieval probes** | anyone with the root, O(k log N) | outsourcing → Δ; sybil copies → sealing; *stored but not served* → reward retrievals | Sia/Storj audits in production; Filecoin PoSt proved storage while retrieval success was **1.2%** (Apr 2024) | yes (assigned replicas, retrieval-weighted) |
| **RAM** | working set for large jobs | timed σ-random reads over the job's own data | orchestrator, O(k) | swap/emulate → Δ below disk latency | memory-hard functions prove memory *used*, not *rentable* | via job size, not standalone |
| **Bandwidth / serving / CDN** | serve bytes | **payer-signed receipts** (lane A) + σ-chosen witness probes indistinguishable from real traffic | witness network, cost = bytes | fake clients → subsidy only on witness-probed units; probe detection → canary traffic | **every project has struggled**: Filecoin Saturn shut down (fake requests); Helium spoofing years-long; Tor measurement inflated | last to enable, small |
| **Uptime / latency / static hosting** | serve content with known hash | σ-random probes from many residential IPs; body hash + RTT | witnesses, O(1) per probe | serving probes only → indistinguishable probes, planted targets | Nym, Pocket (payer-signed relays) in production | yes, probed portion |
| **Dynamic hosting (DBs, apps)** | run stateful services | availability/durability probes only | witnesses | behaviour correctness unprovable without TEE | Akash proves nothing (manual audits) | no — fees only |
| **Confidential compute** | attested VMs (agent desktops, private data) | TEE quote | quote verification | **TEE.fail** extracted attestation keys with a <$1k interposer; attestation doesn't prove location | server-only (EPYC/Xeon); none on home PCs | fees; subsidy only with extra evidence |

## 5. Idle capacity — the "every machine earns" layer, done carefully

Fable: reward idle capacity by giving it the network's **own useful back-office work** — computing the public job
queue, storing certificates/A,B,C/public datasets, serving them to verifiers, running canaries. That keeps
"like PoW, every machine earns" while staying useful.

Research warning: **capacity proofs attract fake capacity.** Filecoin paid for proven storage that was almost never
retrieved; Fluence limits this by switching capacity to real work once rented. So:
- Pay idle capacity for **delivered protocol work**, not for merely holding a resource.
- Price protocol work at a **discount** (e.g. 0.5·p_R) and cap it at **≤ 50% of the subsidy budget**; the rest lapses.
- Most emission stays tied to **paid** work.

## 6. The three branches in the universal design

- **Users** pay fees (lane A) — and for bandwidth, their **signed receipts** are the strongest proof of delivery.
- **Providers** prove self-proving and possession work.
- **Verifiers become the witness network** for interaction proofs. Browsers are good witnesses because they are
  residential, numerous and scattered — what a probe needs and a datacenter can't fake. Kept honest by σ-selection,
  indistinguishable probes, ~13% planted targets, commit–reveal, k-of-m agreement, down-weighting same-ASN verdicts;
  credits until wallet-bound (open item from the v1 review).

## 7. Honest limits — say "measured", never "proven"

Unprovable to an outsider without trusted hardware or trusted witnesses: no-logging, data confidentiality, correct
execution of arbitrary nondeterministic code, real-human vs bot traffic, exact location (latency only bounds it),
energy source. Cloudana can **offer** these by fee and label them *measured* or *audited*, with no subsidy.

## 8. Build order

1. **Compute** — built (v1). Add PoSP-style random re-execution for scale.
2. **Storage** — start with Cloudana's own artifacts (needed anyway to move job data out of the database).
3. **Witness protocol** — probes become another task type on the existing browser verifier feed.
4. **Static hosting + uptime** via witnesses.
5. **Bandwidth** — payer receipts first (fees), witness-probed subsidy last and small.
6. **RAM** as a metered capability.
7. **Confidential tier** (TEE) — customer assurance; also where the parked container path returns.

`WorkType` interface additions: `witnesses?: WitnessSpec`, `selection: "assigned" | "probed" | "user"` (the last gates lane B),
`proofClass: "self" | "possession" | "interaction" | "attestation"`.

## Sources (primary where available)

Komargodski–Weinstein [ePrint 2025/685](https://eprint.iacr.org/2025/685) · Pearl usefulness gap
[arXiv 2606.04819](https://arxiv.org/html/2606.04819v2) · Proof of Sampling [arXiv 2405.00295](https://arxiv.org/abs/2405.00295) ·
Gensyn Verde [arXiv 2502.19405](https://arxiv.org/abs/2502.19405) · zkVM overheads
[a16z](https://a16zcrypto.com/posts/article/secure-efficient-zkvms-progress/) · Filecoin sealing
[spec](https://spec.filecoin.io/systems/filecoin_mining/sector/sealing/) · Filecoin retrievability
[Spark](https://www.geomatrick.io/blog/spark-sees-10x-improvement-in-filecoin-retrievability) · Storj audits
[wiki](https://github.com/storj/storj/wiki/audit-service) · Sia [whitepaper](https://sia.tech/whitepaper.pdf) ·
Saturn [docs](https://docs.filecoin.io/basics/how-retrieval-works/saturn) · Helium [HIP 83](https://github.com/helium/HIP/issues/632) ·
Tor measurement attacks [MirageFlow](https://www.ndss-symposium.org/wp-content/uploads/2024-1133-paper.pdf) ·
Pocket relay mining [arXiv 2305.10672](https://arxiv.org/pdf/2305.10672) · Nym rewards
[docs](https://nym.com/docs/operators/tokenomics/mixnet-rewards) · Fluence capacity [docs](https://fluence.dev/docs/stake/overview) ·
TEE.fail [report](https://www.bleepingcomputer.com/news/security/teefail-attack-breaks-confidential-computing-on-intel-amd-nvidia-cpus/) ·
Proof of Cloud [arXiv 2510.12469](https://arxiv.org/abs/2510.12469) · Akash audits
[docs](https://akash.network/docs/providers/operations/provider-audit/) · multi-resource weights
[arXiv 2508.01448](https://arxiv.org/abs/2508.01448) · PoUW economics [arXiv 2606.06700](https://arxiv.org/html/2606.06700).
Unverified by the research agent: Fluence's exact capacity algorithm, Pearl's ZK wrapper, attack histories of Mysterium/Theta/Nym.
