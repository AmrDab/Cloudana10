# CLD issuance — "minted per workload, by proof" (design, not implemented)

> **Superseded values (2026-10-05).** Fee split is now 95 % provider / 3 % treasury / 2 % net burn, price unit nCLD/TMAC + base fee, 1 h testnet epochs, per-operator cluster gate with N_MIN 3, 100M mainnet genesis — see [DECISIONS_CONSENSUS.md](DECISIONS_CONSENSUS.md) and [IMPL_SPEC_2026-10.md](IMPL_SPEC_2026-10.md). Figures below (0.975 / 0.005, 250M, 120 s epochs) are kept as the historical record of this analysis.

Status: **proposal for owner review** · 2026-09-28 · engineering ↔ Fable adversarial review, two rounds.
Companion to `STRATEGY_NOTES.md`. Nothing here is built. Owner decisions are in §9.

---

## 1. The principle

> **Every CLD a provider earns is minted by a verified certificate.** Users' fees are burned; providers are
> minted for verified work. The emission schedule caps the *extra* (subsidy) minting; budget no verified work
> claims is never minted.

This makes "CLD is minted per workload using PoUW" literally true. Today the opposite holds: rewards are transfers
from a pre-funded 1M pool, and the undeployed EmissionController would drip-mint whether or not work happened.

## 2. What is wrong today (every item verified in code or on-chain)

| # | Finding | Severity |
|---|---|---|
| 1 | Leaked orchestrator key holds MINTER + DEFAULT_ADMIN on CLDToken (0.25 ETH gas) | Critical |
| 2 | `/pouw/submit` doesn't bind the certificate's A,B to the claimed job; never checks C | Critical |
| 3 | `GET /pouw/job?provider=` and `POST /pouw/submit` are unauthenticated — anyone can claim jobs in a victim's name, or submit as them | High |
| 4 | `z = H(σ‖transcript‖H(A)‖H(B))` excludes provider/device → certificates stealable in transit | High |
| 5 | σ freshness never checked (only a self-reported timestamp) → precomputable, stockpilable | High |
| 6 | Paid jobs re-multiply the *same* matrices ~2^d times (d ≥ 8; 4,096× at d=12) — "useful" work is mostly lottery | High |
| 7 | `makePRNG` truncates the seed to 32 bits → noise space 2³² | Medium |
| 8 | `RewardContract_v2_burn.sol` is an abstract patch, not deployable → no burn can exist | High |
| 9 | `EmissionController.emit_()` mints to the pool as a raw transfer, but `rewardProvider` spends only `workloadDeposits[id]` → **emission would be unspendable** | High |
| 10 | `EmissionController.setRewardPool()` redirects all future emission instantly, no timelock | High |
| 11 | Balances, transactions and prices are SQLite `REAL` floats — not exact | High (accuracy) |
| 12 | Credits live off-chain; burn/treasury split can't execute on them | High |
| 13 | Stripe credits at fixed `CLD_USD_RATE=100` → card-buy, self-provide, extract CLD, charge back | Critical on mainnet |
| 14 | Verifying garbage certificates costs O(n³) each → cheap DoS | Medium |
| 15 | Certificate store keeps hashes only; A, B, C aren't retained → nobody can independently recompute rewards | Medium |
| 16 | Token supply 2M vs whitepaper's ~250M genesis → mainnet needs a redeploy | Decision |

## 3. Assigned work runs at difficulty 0

Difficulty is a lottery that makes *self-generated* work scarce. Once the orchestrator assigns every job, the
lottery is pure waste (#6).

- **Assigned jobs: d = 0** — one multiply, one certificate, one answer.
- **σ issued at assignment:** `σ = H(jobId ‖ nodeKey ‖ assignmentNonce ‖ baseBlockHash)`. The transcript depends on
  σ, so the certificate is bound to that node and that assignment (#4), can't exist before assignment (#5), and
  expires with the claim. 256-bit PRNG seed (#7).
- **PoUW is still the proof:** the transcript can't be shortcut; verification re-executes (orchestrator → CPU
  quorum → zk). Rewards become **per unit of verified work**, not per lottery win.
- **Node identity:** each node has its own keypair; it signs claims and submits; its payout wallet is bound once by
  an EIP-712 signature (#3).

## 4. Wash trading — why placement plus one bound is enough

A self-dealer pays fee F; the provider who runs it receives 0.975F (lane A) plus subsidy S = ρ·F (lane B). The
**orchestrator assigns jobs** in a draw weighted by verified capacity, so the attacker's own job returns to them only
with probability s (their capacity share):

    expected profit = s · (0.975 + ρ) · F − F        → profitable only if  s > 1 / (0.975 + ρ)

| Subsidy ρ (S ÷ F) | Attacker needs more than… |
|---|---|
| 0.25 | 81.6% of eligible capacity |
| 0.5 | 67.8% |
| 1.0 | 50.6% — a majority-capacity attack, the same threat class as any proof-of-work chain |

**Rule: ρ ≤ 1 for paid work, always.** Start at 0.25 and step up as verified capacity grows. No need to estimate
anyone's share — the bound holds for every attacker below a majority.

Keeping the attacker's share honest:
- **The draw is weighted strictly by certificate-verified throughput** (trailing window) — never uniform among the
  "top few". Then splitting one GPU across ten identities gains nothing (share is capacity, not headcount).
- **Cluster test at assignment:** a job earns subsidy only if the eligible set's largest *cluster* holds ≤ s_cap of
  capacity and there are ≥ N_min clusters. Cluster = same payout wallet ∪ same ASN ∪ device fingerprint ∪ correlated
  uptime. Defeats eligibility shaping (filters, 3 a.m. submissions, hardware only you have, ceilings just above your
  floor). Jobs that fail still run and pay lane A — they just get no subsidy.
- **Verifiable assignment:** snapshot root of the eligible set committed the cycle before; seed =
  `H(blockhash(arrivalBlock + 1) ‖ jobId)`. Anyone can replay who should have won — stops the orchestrator
  self-dealing.

## 5. Two-lane minting (burn-and-mint accounting)

**Units:** u = verified multiply-adds (n³ for a multiply; layer sums for inference), computed from the job — never
self-reported. **Fee:** F = p·u at the orchestrator's price p (STRATEGY_NOTES §6).

| Lane | Rule | Supply effect |
|---|---|---|
| **A — neutral, uncapped** | Burn the user's F; mint 0.975F to the provider, 0.005F to treasury | **−2% of F** (deflationary with usage) |
| **B — subsidy, scheduled** | S = min(ρ·F, r·u), zero if the cluster test failed | + up to the epoch budget |
| **Protocol work** (canaries, planted-answer verification, public job #1) | paid ∝ verified units from what's left of budget B; per-cluster cap 10% | + within budget |
| **Verifiers** | 15% slice of budget B, ∝ *correct* graded verdicts | + within budget |

- **Budget B per epoch** = supply × rate(t) ÷ 365 (8% → ×0.85 per year → 1.5% floor). Unused budget carries at most
  7 epochs, then lapses — never minted.
- **Canaries pay exactly like paid work**, or they'd be distinguishable. Protocol work is issued only to idle
  capacity so it never starves paid queues.
- **On-chain invariant:** lane-A mint ≤ cumulative fees burned. Lane-B mint ≤ schedule. The contract enforces both.
- **Sustainability:** providers are paid mostly by lane A, which scales with demand; lane B is a bootstrap subsidy
  that shrinks relative to fees as usage grows. At scale burn exceeds subsidy → the whitepaper's soft cap.

## 6. Settlement — exact, secure, scalable

**Ledger:** integer wei everywhere (replaces `REAL`, #11). One entry per certificate
`(cert_id, address, lane, amount, epoch, vests_at, status)`, idempotent on cert_id / z. The node shows
*"earned 3.2 CLD"* the moment its certificate verifies.

**Storage:** A, B, C in content-addressed object storage (R2); certificate rows keep the hashes (#15), so rewards can
be recomputed by anyone for public jobs.

**Per 24 h epoch, on Base:**
1. Anchor the **epoch log root** (certificate hashes, assignments, verdicts) on-chain first.
2. The settlement key posts the **reward root** `{address, laneA, laneB}` second.
3. **24 h guardian veto window** (2-of-3 multisig, one external signer).
4. **Lane A claimable at T+24 h. Lane B vests linearly to T+7 d**, clawable by a fraud proof (failed planted task,
   quorum ✗) until vested. The vesting is the bond — no upfront stake, so it stays plug-and-play.
5. A keeper calls `claimFor(addresses[])` weekly for everyone above a dust threshold → CLD lands in wallets with no
   action. Idempotency: per-(epoch, address) claimed bitmap.

**Verifier honesty:** CPU-quorum verdicts use commit–reveal (no copying the first answer); ~13% planted bad results;
a wrong verdict claws back that verifier's unvested rewards.

**Blast radius:** a stolen settlement key can misdirect at most one epoch, is visible against the anchored log root,
and is vetoable for 24 h. The key lives in a KMS/HSM. The orchestrator key holds **no** role on CLDToken.

**Scale:** two transactions per epoch regardless of certificate count; claims are O(log n) Merkle proofs.

## 7. End to end, zero manual steps

- **Provider:** install → node key generated → benchmark + power reading → estimated floor → sign payout binding once
  → assigned work arrives with σ → compute (d = 0) → signed submit → verification (A/B binding, Freivalds on C,
  transcript) → ledger → epoch root → auto-claimed weekly.
- **User:** sign in → deposit CLD (escrowed 1:1) or buy credits → submit with optional ceiling → hold → assigned,
  verified → charged actual price, difference refunded → download C with its certificate.
- **CPU verifier:** re-execution / Freivalds tasks graded against plants → same ledger → same root.
- **Browser verifier:** same ledger; wallet binding optional — accrues to a claim code until bound.

**Failure modes:** orchestrator down → no assignments, budget carries ≤ 7 epochs, posted epochs still claimable ·
RPC down → ledger is the off-chain source of truth, roots post late, nothing lost · zero demand → budget goes to
protocol work on idle capacity; if no providers either, it lapses · CLD price crash → fees are CLD per unit, USD-based
floors shrink the eligible set and the price rises; subsidy value falls, as intended.

## 8. Build order (dependencies)

1. **Owner, now:** revoke the leaked key's roles; multisig + timelock as admin (#1).
2. `/pouw/submit` + `/pouw/job`: node-key auth, assigned-provider-only, A/B binding, Freivalds on C, rate limit +
   penalty (#2, #3, #14).
3. cuPOW: σ at assignment bound to node key; d = 0 for assigned jobs; 256-bit PRNG (#4–7).
4. Object storage for A, B, C; certificate rows keep hashes (#15).
5. Integer-wei ledger; credits = CLD escrowed 1:1 in a `FeeEscrow` contract (#11, #12).
6. Contracts: **EmissionController v2** (two lanes, burn-backed invariant, timelocked pool, #9 #10); **RewardVault**
   (Merkle roots, vesting, clawback, veto, `claimFor`); **FeeEscrow**; retire RewardContract v1 (migrate its 1M
   pool); delete the abstract v2_burn patch (#8) and ChallengeManager.
7. Backend: assignment engine (capacity-weighted draw, snapshot root, VRF seed), cluster heuristic, canary / planted
   task generator, commit–reveal verifier quorum, epoch settlement job, keeper.
8. Node agent: key generation, payout binding, heartbeats, signed submits, auto-claim opt-in.
9. Monitoring: budget spent vs schedule, largest-cluster share, canary catch rate, veto alerts, clawback log, root
   recompute.
10. Payments: fiat through an oracle (Chainlink or TWAP, 5-minute quote lock); no CLD withdrawal of card-funded
    value before the chargeback window (#13).
11. Audits (contracts; cuPOW field/exactness bounds; cluster heuristic red-team) → mainnet token redeploy (#16).

## 9. Owner decisions

1. **ρ schedule** — start 0.25, step toward 1 at verified-capacity milestones? (Never above 1 for paid work.)
2. **Cluster test** thresholds (s_cap, N_min).
3. **Vesting** length (7 d proposed) and **clawback authority** (settlement key vs guardian).
4. **Verifier slice** (15% proposed) and whether browser verifiers earn CLD or only credits ("a ledger, not a wage").
   *Precondition if credits ever become redeemable:* bind verifier sessions to a signed wallet nonce and throttle
   per identity, not only per IP — today sessions are self-issued UUIDs, so credits can be farmed by a script
   (found in the v1 code review; harmless while credits are points only).
5. **Guardian** membership — who is the external signer.
6. **The 1M pre-funded pool** — seed lane B, send to treasury, or burn. **Mainnet token** — redeploy at the
   whitepaper's genesis?
7. **Fiat** — keep Stripe pre-mainnet? Allow ρ > 1 for fiat-funded jobs after a 30-day chargeback window?
8. **Public wording** — whether to say "minted per workload" publicly before legal review of CLD.
