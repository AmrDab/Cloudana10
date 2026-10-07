# Cloudana Progressive Decentralization Roadmap

**Status: v1.0 — public. Last updated: October 2026.** Supersedes v0.1 (May 2026), which described a libp2p / first-claim / staked-rotation design that was never built. Decision record: [docs/DECISIONS_CONSENSUS.md](docs/DECISIONS_CONSENSUS.md).

Cloudana is a decentralized datacenter: home PCs and full racks joined under **one orchestrator** that assigns every job by a weighted random draw and sets its price from utilization. Nobody bids and users never pick a provider. The orchestrator is the trusted part today. This document is the honest map of how that trust shrinks, phase by phase, without pretending it is gone.

## The litmus test

Every phase is judged by one question:

> **"If Cloudana vanished tonight, would the network keep assigning jobs and paying providers?"**

The states are **FAIL** (the network stops), **PARTIAL** (new work stops but everything already earned is claimable and every past settlement is checkable by anyone), and **PASS** (it keeps running). We only advance a phase when the answer improves.

## The honest baseline (today)

| Component | State | Reality |
|---|---|---|
| API / orchestrator | Centralized | Cloudflare Worker + D1 + KV assigns work and sets the price |
| Assignment | Centralized, replayable | Weighted random draw seeded from a Base block hash; `eligible_hash` and `draw_seed` are stored per job but not yet published |
| PoUW verification | Centralized | Orchestrator re-runs each transcript and Freivalds-checks the result; browsers re-check public jobs with planted tasks |
| Settlement | Guarded | One Merkle root per hourly epoch on Base Sepolia, posted by a keeper; guardian veto window; fee split checked by the contract on every post |
| Mint authority | Bounded | Settlement contract is the token's only minter; `mint ≤ 98 % of fees burned + subsidy allowance`; annual ceiling on the token |
| Claims | Permissionless | `claim` / `claimFor` with a Merkle proof once an epoch is finalized |
| Node instructions | Signed (building) | Work and deployment instructions signed by a funds-less key the agent pins |
| Keys | Safe 2-of-3 | Fresh token and settlement under a Safe; poster key separate from the API; no hot chain key in the Worker |
| Hosting | Gatewayed | `*.sites.cloudana.io` proxy; content-hash probe; admin stop |
| Frontend / templates | Centralized | Cloudflare Pages + D1 |

**Litmus test today: FAIL.** Earned CLD is claimable from the contract without us, and the guardian can stop a bad batch, but new assignments and proofs depend on the orchestrator. We say so plainly.

---

## Phase 1 — Before mainnet *("everything checkable")*

**Goal:** anyone can recompute every settlement and replay every draw; no single person can mint, veto or instruct nodes alone.

- **Publish the leaves.** For each epoch, publish the leaf list (account, lane A, lane B), the fees burned and the treasury amount so anyone can rebuild the Merkle root and compare it with the one posted on Base.
- **Publish the draw.** For each job, publish `eligible_hash`, `draw_seed` and σ so anyone can replay the weighted draw and confirm the orchestrator assigned the job to the node the seed selected.
- **Signed network data.** `/v1/network` and the epoch leaves are signed by a published key, so mirrors and third-party dashboards can prove what the orchestrator claimed.
- **Guardian multisig with a non-owner signer.** The veto / claw role moves to a multisig that includes at least one signer outside the team, with a 24-hour window at mainnet.
- **Safe + timelock.** Admin, poster-rotation and treasury roles sit under a Safe behind a 48-hour timelock; audits before mainnet.
- **Signed node instructions** finished; **isolated keeper** finished; the API Worker holds no chain key.

**Litmus: FAIL → PARTIAL.** New work still needs the orchestrator, but every past payment is independently checkable and no single key can mint, veto or instruct the fleet.
**Exit:** 30 days of epochs finalized with published leaves and draw seeds, one veto drill passed, a non-owner guardian signer live, timelock live.

## Phase 2 — After mainnet *("the orchestrator becomes replaceable")*

**Goal:** the orchestrator's remaining powers — posting, verifying, assigning — each get an on-chain or multi-party check.

- **k-of-n posters.** An epoch root must be signed by k of n independent posters before the contract accepts it; one poster can neither fabricate nor censor an epoch.
- **On-chain Freivalds challenge with a poster bond.** Anyone can challenge a posted result; the contract runs a Freivalds check on the disputed job and slashes the poster bond if the result was wrong. This replaces the guardian's manual claw for fraud.
- **Verifier quorum.** Browser and node verifiers sign attestations; an epoch needs a quorum of independent attestations before finalize, moving verification out of the orchestrator alone.
- **Pull-based assignment.** Nodes pull from a published, seeded queue instead of being told what to run; the draw is verifiable by the node before it starts, so the orchestrator can no longer steer work.
- **Groth16 verifier on-chain** for PoUW certificates; the orchestrator leaves the verification path.

**Litmus: PARTIAL → PASS.** Posting, verification and assignment each survive the loss of any single party.
**Exit:** an epoch posted and finalized with the team's poster offline; a challenge slashes a wrong poster on mainnet; team-operated nodes under 20 % of capacity.

## Phase 3 — Open protocol

**Goal:** Cloudana is a spec multiple teams implement; we are a contributor, not a controller.

- Published protocol spec; independent orchestrator and node implementations.
- Governance over the subsidy floor, the treasury share (one-way-down) and the mint ceiling.

**Litmus: PASS.**

---

## Summary

| Phase | Litmus | Posting | Verification | Assignment |
|---|---|---|---|---|
| Today | FAIL | One keeper, guardian veto | Orchestrator + browser re-checks | Orchestrator draw (stored, unpublished) |
| 1 — Before mainnet | PARTIAL | Published leaves, multisig guardian, timelock | Published, replayable | Published draw seeds |
| 2 — After mainnet | PASS | k-of-n posters, bonded challenge | On-chain Freivalds + verifier quorum, Groth16 | Pull-based from a seeded queue |
| 3 — Open protocol | PASS | Protocol-defined | Protocol-defined | Protocol-defined |

## Honest tradeoffs

- **Decentralization is slower and costlier.** k-of-n posting and on-chain challenges add latency and gas to settlement. That is the price of trustlessness, and it is why epochs are daily at mainnet.
- **Containers and GPUs on home hardware wait for hardening.** Until the sandbox checklist is met, only compute (matrix jobs) and static hosting run on home nodes.
- **DNS and ingress resist full decentralization.** The hosting gateway is a Cloudana-run proxy today; the mitigation is multiple independent gateway operators, not a single authority.
- **The subsidy floor is a governance choice.** The 1 %-of-supply floor exists to counter long-run deflation; governance can set it to 0.

## Transparency commitments

1. This page reflects **verifiable facts** (contract addresses, role holders, hosting origin), not aspirations.
2. We will not market Cloudana as "decentralized" before Phase 2 exit — only "progressively decentralizing."
3. Testnet PoUW is **orchestrator-verified until the on-chain verifier ships**, and is labeled as such.
4. Orchestrator, keeper and node software are open source.

## What this is not

This roadmap does **not** promise fixed dates (phases are technical gates), equal speed or cost to the centralized version, the elimination of all trust, or bug-free contracts (audits precede mainnet but don't guarantee safety). Nothing here is a statement about the value of CLD.
