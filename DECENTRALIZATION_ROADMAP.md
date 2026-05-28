# Cloudana Progressive Decentralization Roadmap

**Status: v0.1 — public. Last updated: May 2026.**

Cloudana is building a decentralized compute network where anyone can plug in **any
hardware** and start earning, and where — over time — **no single party (including
Cloudana Inc.) controls the network.** We are not fully there yet, and we will not
pretend to be. This document is the honest map from where we are to where we're going.

## The litmus test

Every phase is judged by one question:

> **"If Cloudana Inc. vanished tonight, would the network keep matching jobs and paying providers?"**

We only advance a phase when the answer improves. The states are **FAIL** (the network
stops), **PARTIAL** (it degrades but the economic loop survives), and **PASS** (it keeps
running).

## The honest baseline (today)

| Component | State | Reality |
|---|---|---|
| API / control plane | 🔴 Centralized | Cloudflare Worker + D1 + KV |
| Matchmaking | 🔴 Centralized | Off-chain orchestrator picks one provider (`ORCHESTRATOR_ROLE`) |
| Reward routing | 🔴 Centralized | `RewardContract.rewardProvider()` is `onlyRole(ORCHESTRATOR_ROLE)` |
| POUW verification | 🔴 Centralized | Orchestrator is trusted; no on-chain re-verification yet |
| Templates / frontend | 🔴 Centralized | D1 + Cloudflare Pages |
| Provider & workload registration | 🟢 Decentralized | On-chain (`ProviderRegistry`, `WorkloadRegistry`) |
| Provider withdrawals | 🟢 Decentralized | `withdrawEarnings()` is permissionless |
| Fraud / slashing layer | 🟢 Decentralized | `StakingManager` + `ChallengeManager` (optimistic fraud proofs) |

**Litmus test today: FAIL.** The contracts and your earned balance survive on-chain, but
new jobs and reward issuance depend on us. We're saying so plainly.

**The tension we own:** Cloudana competes with Cloudflare, yet our live API runs on
Cloudflare. That's pragmatic for bootstrapping and is scheduled to end by Phase 3.

---

## Phase 1 — Testnet Bootstrap *("engine running, training wheels on")*

**Goal:** real providers earning testnet CLD with the full on-chain payment loop working.

- Deploy the orchestrator off the laptop (rented Akash / VPS — $0 owned hardware).
- Onboard 3–5 providers; full POUW certificate flow recorded on-chain.
- Public status page (this page) + open-source the orchestrator & provider software.
- Rotate `ORCHESTRATOR_ROLE` off a personal wallet.

**Litmus: FAIL** (matching + rewards still need us; withdrawals already don't).
**Exit:** ≥5 providers earning CLD they didn't supply; disaster-recovery test passed.

## Phase 2 — P2P + On-Chain First-Claim *("first steps to trustlessness")*

**Goal:** the orchestrator becomes *optional* for routing.

- **libp2p** provider network (DHT discovery + NAT traversal — no central coordinator).
- **Permissionless claim**: any staked provider can claim an unmatched workload directly
  on-chain (`claimWorkload`). The orchestrator only accelerates; it no longer gates.
- **Stake-gated** claims via `StakingManager`; slashing for failed jobs.
- **Trustless POUW**: Groth16 zkSNARK verified on-chain, *or* optimistic accept + the
  existing `ChallengeManager` window — orchestrator leaves the trust path.
- Move the API off Cloudflare-only (Cloudflare becomes an optional cache).

**Litmus: PARTIAL** — providers self-claim new jobs; rewards open to any staked party.
**Exit:** a workload matched & run with the orchestrator offline; on-chain POUW verified;
10+ community providers; `ORCHESTRATOR_ROLE` → multisig.

## Phase 3 — The Cloudflare Divorce *("community providers")*

**Goal:** anyone with a machine + wallet plugs in with zero Cloudana involvement.

- One-command provider agent (`docker run cloudana-provider …`) — no SSH from us.
- IPFS/ENS-hosted console; templates move to an on-chain + IPFS registry.
- Staked **orchestrator rotation** (epoch-based) replaces the single key.
- On-chain **governance** (Governor) over minting, fees, curation.
- **Workload sandboxing** (gVisor/Kata) enforced — non-negotiable before open providers.
- Remove the hard Cloudflare dependency entirely.

**Litmus: PARTIAL → PASS.** Running providers keep executing; new ones self-install.
**Exit:** 20+ independent providers onboarded with no team involvement; minting behind
governance; API confirmed working off Cloudflare; sandbox enforced.

## Phase 4 — Trustless Execution *("network runs without us")*

**Goal:** Cloudana Inc. can step back from operations.

- `ChallengeManager` disputes fully wired; permissionless fraud-proof finalization.
- Decentralized libp2p bootstrap (ENS/DHT, no team-run nodes required).
- GPU-native POUW (CUDA) + on-chain difficulty adjustment.
- Team wallet renounces unilateral roles; admin behind a timelocked Governor.

**Litmus: PASS.** New providers join, jobs route via first-claim + staked rotation,
rewards flow from the on-chain pool, the console resolves via ENS/IPFS.
**Exit:** 72-hour team-offline chaos test passes; community executes a governance
proposal; team providers < 20% of capacity.

## Phase 5 — Open Protocol *("protocol, not product")*

**Goal:** Cloudana is a spec multiple teams implement; we're a contributor, not a controller.

- Published protocol spec; independent provider/frontend implementations.
- DAO treasury self-funds development; cross-chain CLD.

**Litmus: FULL PASS.**

---

## Summary

| Phase | Name | Litmus | Cloudflare | Matchmaking | POUW |
|---|---|---|---|---|---|
| Today | Baseline | FAIL | Hard dep | Orchestrator | Trusted |
| 1 | Testnet Bootstrap | FAIL | Hard dep | Orchestrator | Trusted (labeled) |
| 2 | P2P + First-Claim | PARTIAL | Optional | On-chain + helper | zkSNARK / challenge |
| 3 | Cloudflare Divorce | PARTIAL→PASS | Removed | Staked rotation | zkSNARK |
| 4 | Trustless Execution | PASS | Removed | Decentralized | On-chain + challenge |
| 5 | Open Protocol | FULL PASS | n/a | Protocol-defined | Protocol-defined |

## Honest tradeoffs (we won't hide these)

- **Decentralization is slower & costlier.** On-chain first-claim adds block-confirmation
  latency (workload-to-running may go from ~90s to ~150s) and per-event gas. That's the
  price of trustlessness.
- **First-claim can be gamed** by low-latency providers until an auction lands (Phase 3+).
- **Untrusted workloads need real sandboxing** before open providers (Phase 3 gate).
- **DNS/ingress resists full decentralization** — mitigated with multiple independent
  gateway operators + ENS, not a single authority.

## Transparency commitments (from Phase 1 onward)

1. This status page reflects **verifiable facts** (contract addresses, role holders,
   hosting origin), not aspirations.
2. We won't market Cloudana as "decentralized" before Phase 3 exit — only
   "progressively decentralizing."
3. Testnet POUW is **trust-based until the zkSNARK ships**, and is labeled as such.
4. Orchestrator & provider software are **open source** before Phase 2.

## What this is not

This roadmap does **not** promise fixed dates (phases are technical gates), equal
speed/cost to the centralized version, the elimination of all trust, or bug-free
contracts (audits precede mainnet but don't guarantee safety).
