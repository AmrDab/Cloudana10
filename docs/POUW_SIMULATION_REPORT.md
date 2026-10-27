# PoUW simulation report

Companion to [POUW_SIMULATION_PLAN.md](POUW_SIMULATION_PLAN.md). Everything here ran on 127.0.0.1 with the real code:
the API's Node runtime (`client/api/src/index.ts`, SQLite), three real node agents (1.9.0, CPU: Intel Core Ultra 7
155H, 213 MMAC/s each by the agent's own benchmark), the production keeper's pass (`keeper/src/run.ts`) on a 10 s
timer, and the v2 contracts on a hardhat chain (120 s epochs, 30 s veto, 60 s lane-B vest). Reproduce with
`scripts/sim/testnet/` (README at the top of each file).

## Phase 0 — the loop closes (2026-10-27)

One job of each work type, submitted by a fake user whose credits came from an on-chain escrow deposit:

| step | what happened | time |
|---|---|---|
| user deposits 100 CLD into `CloudanaSettlementV2` | `Deposited` log → deposit watcher credits the account | 40 s (60 s cron) |
| matmul n=64, int8-mlp (b16 d64 h64), int8-model (L=2) queued | assigned at enqueue; each agent picked its job up on its next heartbeat | 8 s to verified |
| verification | matmul: Freivalds + binding checks, not sampled; int8: 2 of 4 and 3 of 8 segments opened and checked | API handler 11–18 ms |
| ledger | lane A 949 µCLD each (95 % of the 1,001 µCLD fee), treasury 31, lane B 40 on the matmul job only (see below) | booked into epoch +2 (the 120 s hold) |
| keeper | closed the epoch at its end, posted the root, finalized after the veto window, `claimFor` lane A, then lane B after the vest | one pass each |
| chain | provider balances rose by **exactly** 949 / 989 / 949 µCLD; `totalSupply` Δ = minted (A + B + treasury) − fees burned, to the µCLD | ✓ |

**Result: PASS.** The money path is real end to end: escrow → fee → verified job → minted lanes → Merkle root →
on-chain claim, with no manual step.

Observations:
- **Lane B needs three idle wallets at the draw.** The three jobs were queued back to back; the first took one node,
  so the second job's eligible set had two wallets and the third's one — below `CLUSTER_N_MIN` = 3 — and those two
  jobs earned no subsidy (`cluster_ok` = 0). The gate counts idle eligible operators at assignment, not bound
  operators. With a handful of providers the subsidy is mostly withheld under any concurrency. Decision input for D2.
- **Local-chain artefact, not a defect:** hardhat mines only on transactions, and the keeper judges epoch ends, the
  veto window and the vest by block time, so settlement stalled until `keeper-local.ts` was made to mine one empty
  block per pass. A live chain advances on its own.
- The per-job API handler time (11–18 ms, request log) includes parsing and SQLite; the verify-only timing lines
  were added for phase 1 (`[work] verify …`, DEV_MODE only, because `performance.now()` is frozen during CPU work
  on Workers).

## Phase 1 — honest work, measured (2026-10-27, 400 jobs, 3 CPU providers)

`user.ts --jobs 400 --rate 8`, eight shapes cycled (50 each), real agents, every job verified by the API's own code.
Full table: `.dev-run-sim/report-phase1.md` (regenerate with `report.ts --jobs jobs-phase1.jsonl`).

| shape | MACs/job | provider compute ms (median) | API verify ms (median) | verify ÷ compute | what the verifier did |
|---|---|---|---|---|---|
| matmul n=64 | 2.6e5 | 20 | 1.3 | 0.065 | Freivalds + binding; 3 of 50 sampled → full re-run 10.8 ms |
| matmul n=128 | 2.1e6 | 150 | 5.6 | 0.037 | 4 of 50 sampled → 87 ms |
| matmul n=256 | 1.7e7 | 1,010 | 18.2 | 0.018 | 4 of 50 sampled → 375 ms |
| int8-mlp d=h=64 | 1.3e5 | 50 | 0.7 | 0.014 | 2 of 4 segments opened |
| int8-mlp d=h=256 | 2.1e6 | 100 | 3.1 | 0.031 | 2 of 4 |
| int8-model L=2, 64 | 2.6e5 | 50 | 1.1 | 0.022 | 3 of 8 |
| int8-model L=8, 128 | 4.2e6 | 160 | 4.3 | 0.027 | 8 of 32 |
| int8-model L=2, 256 | 4.2e6 | 150 | 5.1 | 0.034 | 3 of 8 |

**E1 — verifier cost.** The orchestrator spends **1.4–6.5 % of the provider's compute time** to verify, and the share
falls as jobs grow (matmul: 6.5 % → 1.8 % from n = 64 to 256, as O(n²)/O(n³) predicts; a sampled full re-run costs
about 37 % of the provider's time but lands on 1 job in 10). Challenge types cost 2 of 4 / 3 of 8 / 8 of 32 segments
re-checked, 1–3 %. At Workers CPU pricing this is a fraction of a cent per thousand jobs. **Verification is cheap enough
to run on every job; the chain does not need to carry it.**

**E2 — honest false rejects: 0 of 400.** No refusals, no sampled-check failures, no claws, no agent-side errors.

**E3 — CLD per unit of work: at today's job caps there is no "per unit".** Every job, from 1.3e5 to 1.7e7 MACs, paid
exactly 1,001 µCLD: the metered part, `ceil(units × 14,000 nCLD/TMAC / 1e15)`, is **1 µCLD** (the ceiling of 0.0002)
at every size the API accepts, so the fee is the `$0.0001` base fee, and the provider's 949 µCLD (95 %) is a flat
per-job amount. Earnings therefore scale with
*jobs per hour*, which the protocol caps at ~4 per node (one assignment per 15 s heartbeat), i.e. ≈ 0.23 CLD/h ≈
$0.023/h per node whatever its hardware. Metering only starts to matter at jobs ~10⁶× larger than the API's caps
(n ≤ 256, L·d·h ≤ 2¹⁷, set by the 50 ms Workers verify budget). This is the single most important number of the
simulation: **work is verified, but it is not yet priced by work.**

**E3 — the zero-demand hour.** Not run separately: it is implied by the ledger — every µCLD minted in 400 jobs (lane
A and lane B alike) is a percentage of a user fee. No fee, no mint. Owner decision D1.

**Lane B (the subsidy) reached 79 of 400 jobs (20 %).** The cluster gate (`CLUSTER_N_MIN` = 3 idle wallets at the
draw) failed whenever two of the three nodes were busy. With three operators and any concurrency the "block reward"
lane is mostly withheld. Decision D2.

**E4 — throughput and latency.** 6.8 jobs/min across 3 nodes (111 / 151 / 138); queue wait 0 s (assignment at
enqueue), assigned → verified median 9.0 s, of which compute is 20–1,000 ms: the rest is the heartbeat. Small jobs are
bounded by the protocol cadence, not by hardware.

**The draw weight is noise at this size.** A node's weight is `units ÷ (assigned → verified seconds)`, EMA-smoothed,
and that time is dominated by the heartbeat wait, not compute: identical laptops ended at weights 0.09 / 0.25 / 0.66
MMAC/s and received 111 / 151 / 138 jobs. The Sybil and self-dealing bounds assume weight = verified capacity; today
it is closer to "whose heartbeat landed first". Fix: weigh by compute time reported in the certificate (or units per
*compute* second, which the API can bound from its own verify), not by wall-clock latency.

**Environment note.** Two gaps in the run (8.5 min at 01:26, and between phases) were the laptop sleeping; the stack
resumed on its own with no lost or failed jobs, which is itself a useful robustness result. Keep-awake is on for the
remaining phases.
