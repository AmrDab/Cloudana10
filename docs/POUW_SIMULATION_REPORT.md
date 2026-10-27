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
