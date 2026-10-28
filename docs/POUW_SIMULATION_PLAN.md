# PoUW simulation plan — "can Cloudana measure, verify and mint CLD for work?"

Status: **plan for owner approval** · 2026-10-26 · nothing below is built or run yet.

## 0. Why this plan exists

The owner's thesis: Cloudana's edge is that **CLD is generated from verified work**, the way Bitcoin generates BTC
from hashing, but for useful work on any hardware anywhere. My last answers drifted toward prices and service
catalogues. This plan goes back to the thesis and tests it with the real code, end to end, on real hardware, with a
fake user and a fake provider. The output is numbers, not opinions.

## 1. What the code does today (verified in code, 2026-10-26)

How a CLD gets minted (`client/api/src/services/ledger.service.ts`, `contract/contracts/v2/*`):

| Bitcoin | Cloudana today |
|---|---|
| Hash puzzle | Useful job: matmul (cuPOW transcript), int8-mlp, int8-model (commit-then-challenge) |
| Every node verifies every block | **The orchestrator (API) verifies**: Freivalds on every matmul, transcript re-run on 1 in `VERIFY_SAMPLE_K`=10, segment challenges for int8 types. The chain only receives a Merkle root |
| Transaction fees → miner | **Lane A**: the user's fee is burned, 95 % is minted to the provider, 3 % treasury, 2 % net burn |
| Block subsidy → miner | **Lane B**: subsidy ρ·F, ρ = `SUBSIDY_RHO` = 0.04, hard cap `RHO_MAX` = 0.04, per-epoch budget `EPOCH_SUBSIDY_BUDGET_UCLD` = 7.3 CLD/h (scaled pro rata if over), paid only when the cluster gate passes (≥ `CLUSTER_N_MIN`=3 wallets eligible, no wallet > `CLUSTER_S_CAP`=0.5 of throughput) |
| Difficulty | Protocol-metered units (MACs) × protocol price; never self-reported |
| Miner picks the block | **Orchestrator assigns** by a replayable weighted draw (`draw_seed`, `eligible_json`, `GET /v1/draws/{id}`) |
| Reward final after confirmations | Pay held `PAY_HOLD_SECONDS` (24 h), booked into a later epoch, clawable wallet-wide + node suspended on a failed sampled check; lane B vests |
| Nothing | Epoch: keeper closes, posts root to `CloudanaSettlementV2` (the only minter), veto window, finalize, `claimFor` |

**The one real gap against the Bitcoin analogy:** with **zero user demand, a provider mints zero CLD.** Lane B is a
percentage of a *fee*; there is no "protocol work" issued to idle capacity (CLD_ISSUANCE_DESIGN §5 designed it; it is
not implemented). Bitcoin pays miners whether or not anyone transacts. This plan measures the gap (§4, experiment E3)
and puts the decision in front of the owner (§7); it does not decide it.

What already exists to build on (no new frameworks needed):
- `scripts/dev/up.sh` — local chain + contracts + API + keeper + one agent, all on 127.0.0.1.
- `contract/scripts/v2/local-e2e.ts` and `contract/scripts/local/keeper.ts` — local v2 settlement loop.
- `scripts/sim/pouw-attacks.ts` — matmul attacks against the real verdict function (in-process, no API).
- `node-agent/src/work.ts` — the real challenge-mode worker (the adversary is built from this).
- `client/api/.dev-sim-nodes.ts` (untracked) — fake GPU nodes for placement.
- `client/api/tests/*` — 46 vitest files (sampled-claw, challenge-robustness, fee-split-bounds, epoch-veto…).

## 2. Hardware for the fake provider

| Machine | Role | Notes |
|---|---|---|
| This laptop: Intel Core Ultra 7 155H, 16 cores / 22 threads, 32 GB, Intel Arc iGPU | **Honest provider(s)** and **adversary** running the real `node-agent` against the local API | CPU only (no CUDA; the work types are CPU-executable integer kernels, so this is a valid provider). Node 24. No Docker → no container work (not needed). |
| Azure VM `cloudana-node-1` (prod node) | **Not used.** Stays on the production API | Repurposing it needs the owner; prod must stay clean. |
| Rented 4090 / H100 | **Not in this plan.** Needed later for GPU cost calibration (V4 step 5) | Owner purchase. The CPU numbers give the verify/compute ratios; GPU changes the absolute provider cost, not the verifier's. |

Three honest agents run on the laptop with three keys and three payout wallets (so the cluster gate `N_MIN`=3 can
pass and lane B is actually minted); the adversary is a fourth. All on `http://127.0.0.1` (the agent allows plain http
only there), API in `DEV_MODE`.

## 3. The testnet-in-a-box (phase 0)

Everything local, nothing touches api.cloudana.io, Base Sepolia, R2 or any secret. One driver under
`scripts/sim/testnet/` (TypeScript, `tsx`, no new dependencies):

| Piece | What | Settings |
|---|---|---|
| Chain | `npx hardhat node` + `contract/scripts/v2/deploy` (local) | `EPOCH_SECONDS=120`, `VETO_DELAY=30`, `VEST_B=60`, 1M CLD genesis |
| API | `wrangler dev --local` on **:8791** (8790 is another session's) | `DEV_MODE=1 EPOCH_SECONDS=120 PAY_HOLD_SECONDS=120 VERIFY_SAMPLE_K=10 SUBSIDY_RHO=0.04 CHALLENGE_TTL_SECONDS=30` |
| Keeper | `contract/scripts/local/keeper.ts` every 10 s (confirm it speaks v2; else `local-e2e`'s calls) | `INTERNAL_API_KEY` from `client/api/.dev.vars` (local-only value) |
| Providers | 3 × real `node-agent` (`npm start -- --name sim-a|b|c`), work types matmul, int8-mlp, int8-model | bound to 3 burner payout wallets by the fake user script |
| Fake user | `user.ts`: burner sign-in (`VITE_DEV_BURNER` path / `POST /v1/dev/credits`), submits a scripted job mix, polls to `done`, records every timestamp | job mix in §4 |
| Adversary | `adversary.ts`: a node built from `node-agent/src/work.ts` + the matmul solver, with a `--cheat <name>` switch | §5 |
| Report | `report.ts`: reads D1 (`wrangler d1 execute --local`), the chain (ethers) and the per-job logs → `docs/POUW_SIMULATION_REPORT.md` | tables in §6 |

**Phase 0 exit criterion (the smoke test):** one matmul, one int8-mlp and one int8-model job each go
`queued → assigned → verified → reward_entries (A, B, treasury) → epoch closed → root posted → finalized → claimFor`
and the provider wallet's ERC-20 balance on the local chain rises by **exactly** the µCLD the API booked (×1e12).
If this fails, the plan stops and the defect is fixed first (it is the product).

## 4. Phase 1 — measure honest work

Job mix (sizes within the live caps): matmul n ∈ {64, 128, 256, 512}; int8-mlp at its fixed shape; int8-model
L ∈ {1, 4, 16}, d = h = 256 (the cap L·d·h ≤ 2¹⁷ allows L ≤ 2 at 256² — the mix uses the largest legal shape per L).
≥ 500 jobs per type, submitted at a steady rate from the fake user, 3 honest providers.

Per job, recorded: metered units (MAC) · fee µCLD · lane A/B/treasury µCLD · provider compute ms (agent log) ·
API verify CPU ms (wrangler `cpu_ms` / `performance.now()` around the verdict) · whether the transcript was sampled ·
segments drawn / total · bytes up/down · t(submit→assigned), t(assigned→verified), t(verified→claimable on-chain).

Experiments:
- **E1 Verifier cost ratio** per type and size: `API verify ms ÷ provider compute ms`. Expected: matmul falls as
  O(n²)/O(n³) plus 1/K of a full re-run; challenge types ≈ (segments opened ÷ total). This is the number that says
  whether the orchestrator can afford to verify at scale (and what it costs in $ at Workers CPU pricing).
- **E2 Honest false rejects** over all jobs: must be 0. Any reject of an honest provider is a defect.
- **E3 CLD per unit of work** ("hashrate → coins"): µCLD minted per TMAC, by lane, per provider, per epoch; and the
  **zero-demand hour**: stop the user for 5 epochs and record what providers mint (expected today: 0 — the gap in §1).
- **E4 Throughput**: jobs/min the API verifies per isolate before latency climbs; jobs/min one CPU provider completes.

## 5. Phase 2 — the cheating provider

`adversary.ts` runs one strategy at a time for ≥ 200 jobs (sampling at K=10 needs volume), alongside the 3 honest
nodes so the draw and cluster gate behave normally. Every strategy records: rejected at submit / caught by sampling /
caught by challenge / **not caught**, time-to-detection, and the realised P&L in CLD after claws.

| # | Strategy | Expected mechanism |
|---|---|---|
| A1 | Random C, honest-looking certificate | Freivalds rejects every job |
| A2 | Correct C, no / lazy transcript | Accepted 9/10, transcript re-run catches 1/10 → wallet-wide claw + suspension; E[profit] < 0 |
| A3 | Replay another job's certificate / σ | Binding check rejects |
| A4 | Submit for a job assigned to another node | Node-auth / assignment check rejects |
| A5 | Partial transcript (first half honest) | Sampled re-run catches |
| A6 | Challenge type: commit, then answer with a wrong opening for 1 of 4L segments | Caught with probability drawn/total; measured vs theory |
| A7 | Challenge type: commit without computing, compute only drawn segments after seeing them | Openings must hash into the stored commitment → rejected; also answer TTL (30 s) measured |
| A8 | Answer after the TTL; resubmit a different commitment for the same job | Refused; idempotency holds |
| A9 | Honest 9/10, cheat 1/10 (the rational cheater) | Pay hold + wallet-wide claw: P&L over 1,000 jobs must be negative |
| A10 | Sybil: one operator, 10 wallets | Cluster gate: no subsidy beyond `S_CAP`; lane A unaffected (it's paid work) |
| A11 | Self-dealing: fake user = adversary's operator, ρ = 0.04 | Loses 1 − s·(0.95+0.04) per job for every share s; measured net CLD |
| A12 | Draw replay: recompute every assignment from `GET /v1/draws/{id}` | 100 % reproducible; otherwise the orchestrator could self-deal |

Also run `scripts/sim/pouw-attacks.ts` (in-process) at larger sizes for the cost tables it already produces.

**Exit criterion:** every strategy is rejected or caught with E[profit] < 0 and honest nodes are never clawed. Any
strategy that pays is a defect → fixed as a PR before the report is final.

## 6. Phase 3 — the money, on-chain

Run the honest mix for 2 h (60 epochs of 120 s) with the keeper live, then check:
- `totalSupply(after) − totalSupply(before) = Σ mintA + Σ mintB − Σ feesBurned` (the v2 invariant), per epoch and overall.
- Lane B vs budget: does `fitLaneB` bind at this demand; the pro-rata factor per epoch.
- The 24 h-hold analogue (120 s here): a claw after pay was booked is reflected in the next root (zero root path when
  everything is clawed), and the keeper survives a restart mid-epoch (known weakness: trees live in memory).
- One guardian veto → API re-close → re-post with a corrected root.
- Provider P&L per hour at this demand, in CLD and in USD at the $0.10 testnet rate; and the same at zero demand (E3).

## 7. Deliverables and the decisions they feed

1. `docs/POUW_SIMULATION_REPORT.md` — every table above, with the exact commands to reproduce.
2. `scripts/sim/testnet/` — the driver, user, adversary and report scripts (committed; the local stack stays local).
3. Defects found → separate PRs, each with a test, for the owner's review.
4. `PROGRESS.md` entry and a one-page summary in chat.

Decisions the numbers will put in front of the owner (not pre-decided):
- **D1 — Protocol work for idle capacity.** If E3 shows providers earn 0 with no demand, do we mint lane B for
  protocol-issued jobs (canaries / public jobs) to idle nodes, Bitcoin-style, within the existing emission envelope?
  (Design exists in CLD_ISSUANCE_DESIGN §5; cost: a new job source + a Sybil-safe allocation rule.)
- **D2 — ρ and the epoch budget.** With the measured demand and cluster behaviour, is ρ = 0.04 the right bootstrap?
- **D3 — Who verifies.** Today the API verifies and the chain records. If E1 shows verification is cheap, the path to
  independent verifiers (CPU quorum on sampled jobs, already sketched in docs) becomes a cost question, not a research one.
- **USDC vs CLD payouts** (open from last week) is unaffected by this plan and stays open.

## 8. Scope, cost, risks

- **Not touched:** production, Base Sepolia, the Azure node, any secret, agent version numbers, the R2 buckets.
- **Agents:** I run phases 0–1 myself. One `general-purpose` agent builds the adversary (file-scoped:
  `scripts/sim/testnet/adversary.ts` only) while I run phase 1; one builds the report script. No Fable subagents.
- **Wall clock:** phase 0 ≈ half a day (local stack on Windows: port and wrangler quirks are known from the smoke test);
  phase 1–2 ≈ one day of building + ~3 h of runs; phase 3 = a 2 h run + checks; report ≈ 2 h.
- **Risks:** `scripts/local/keeper.ts` may target the v1 settlement (checked first in phase 0); CPU-only providers mean
  absolute compute times are laptop numbers (ratios still hold); wrangler's local D1 is slower than prod D1 (API verify
  CPU ms are measured in-process, so unaffected); `cpu_ms` may need `performance.now()` instrumentation behind `DEV_MODE`.
- **Stop conditions:** phase 0 smoke fails → fix first; any strategy in §5 pays → fix first; both reported as they happen.

## 9. What I need from the owner

Only approval. No secrets, purchases or wallet actions are involved. If you want GPU-calibrated numbers in the
same report, that needs a rented GPU box (your purchase) and adds a day; otherwise the CPU laptop is enough for every
question in §4–§6.
