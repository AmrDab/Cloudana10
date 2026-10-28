# Decisions consensus — October 2026

This is the consensus of a Fable review panel: token economics, payments and demand, operations and security, and a chair who cross-examined the three. The reviewers' condensed reports are in [REVIEW_PANEL_2026-10.md](REVIEW_PANEL_2026-10.md). Status: **approved by the owner ("do all") and implemented in October 2026** — see `PROGRESS.md` and
`CAPABILITY_MATRIX.md` for what is live, built or still waiting on an owner step (contract deploy and keeper:
`docs/OWNER_RUNBOOK.md`; the relay secret, gateway domain and first node are done since 2026-10-18). The text below is kept as the decision record.

> **Decided (2026-10-28, owner: "go with your recommendations on D1–D4"; the simulation behind them is
> `docs/POUW_SIMULATION_REPORT.md`):**
> - **D1 — protocol work for idle capacity: yes, within the existing lane-B budget.** When the queue is empty, the
>   orchestrator issues its own small matmul jobs to idle nodes (no user, no fee, nothing burned). They are verified
>   like any job (Freivalds, sampled transcript, claw and suspension). What is left of an epoch's lane-B budget after
>   paid jobs' subsidies is minted to them pro rata by verified units, no wallet above `CLUSTER_S_CAP` of it. This is
>   the Bitcoin-style lane: a bounded issuance split by verified work, nothing minted without work. Lane A stays
>   fee-backed; the contract's `LaneAExceedsFees` and `LaneBExceedsAllowance` checks are unchanged. Off by default
>   (`PROTOCOL_WORK=on`), to be switched on with the contract deploy.
> - **D2 — ρ stays 0.04 (bounded by `RHO_MAX`: self-dealing must lose money); the cluster gate counts live
>   operators, not idle ones.** The gate withheld the subsidy on 68–80 % of jobs with three operators only because a
>   busy node was invisible to it. `CLUSTER_N_MIN` = 3 and `CLUSTER_S_CAP` = 0.5 unchanged.
> - **D3 — the orchestrator verifies; the guardian veto is the safety net.** Verification costs 1.4–8 % of provider
>   compute, on every job; nothing moves on chain. A vetoed epoch is parked until an operator corrects it (the keeper
>   and the API no longer loop on the same root).
> - **D4 — the transcript is kept for matmul; new identities are sampled every job.** A node's first
>   `VERIFY_WARMUP_JOBS` (10) jobs have the transcript re-executed every time, then 1 in `VERIFY_SAMPLE_K`. A
>   throw-away identity is caught on its first lazy job; after warm-up the hold and the wallet-wide claw apply as before.
>   Dropping the transcript where Freivalds proves the output was rejected: the proof is of work done, not only of a
>   right answer.

> **Decided (2026-10-21, owner: "go with your recommendations"; options in `docs/OWNER_RUNBOOK.md` §A):**
> 1. **Subsidy (lane B) stays per settlement epoch (one hour)**, pro rata within the epoch, as built. No weekly pool,
>    no contract change: the v2 contracts deploy as they are.
> 2. **Verification sampling (B-6):** Freivalds on every job; the full transcript is re-executed on a random 1 in 10
>    jobs; every job's provider pay is held 24 h and clawed if its sampled check fails (the node is flagged). Built
>    (PROGRESS.md entry 25): the claw takes the held pay of the failing node's whole payout wallet, for every node
>    including fleet-token nodes, and only the failing node is suspended. A false positive or a leaked fleet token is
>    undone with `POST /v1/admin/claws/{jobId}/reverse` (held pay only; pay another failed check still covers stays
>    clawed).
> 3. **`/control/legacy` (B-3):** removed entirely; the pricing calculator and the decentralization page return later
>    as rewritten console pages.
> 4. **Fleet pinning (B-9):** a deployment may be pinned to the owner's own fleet or to a partner fleet chosen by its
>    fleet id shown in the console — never to a single node.
> 5. **Direct (public-IP) node mode (B-13):** the relay is the default for every node; direct mode stays only for GPU
>    workstations until the relay tunnels WebSockets, then it is retired.
> 6. **Node #1 on Azure for Students credit:** kept while CLD is test-only; moved to pay-as-you-go before CLD has any
>    value (that subscription restricts crypto mining).

## In one paragraph
Only one event creates CLD: a verified, paid job.
- The customer's CLD fee goes into escrow and is burned at settlement.
- The provider is minted 95% of the fee, the protocol treasury gets 3%, and 2% is destroyed for good.
- A small, capped, declining subsidy rewards providers in genuinely independent clusters.

CLD is the unit of account and the only settlement asset, and USD is shown for display only. If someone pays with another asset, it's swapped inside their own wallet when they pay; Cloudana never holds customer assets other than escrowed CLD. Nothing that carries real value ships until:
- a fresh token and settlement contract sit under a Safe;
- the fee split is enforced on-chain;
- instructions sent to nodes are signed;
- containers are hardened;
- the keeper runs isolated.

The free tier is a customer the treasury pays for, not new emission.

## Decisions
> **Decided (2026-10-15, owner: "go with what you recommend"):** storage follows
> [V4_STORAGE_SPEC.md](V4_STORAGE_SPEC.md) v2 — the **phased plan with an R2 copy** until ≥ 14 independent operators
> can hold data themselves; phase-2 prices **$0.02 per GB-month and $0.01 per GB downloaded**; **Cloudana holds the
> object keys** (providers see ciphertext; S3 clients work unchanged; users who want zero-knowledge encrypt before
> upload, e.g. rclone crypt); a **DMCA designated agent and an abuse contact** exist before phase 2 opens.
>
> **Changed (2026-10-15):** hosting bills only time a probe saw working. Recovery from `unreachable` and a failed
> "Report a problem" probe forgive the time since the last passing probe — no longer the whole partial hour, which let
> an app that failed three probes before each hour run free.
>
> **Changed (2026-10-13, owner approved):** the subsidy (lane B) is split **pro rata** within each settlement
> epoch: every verified job records ρF (ρ ≤ 0.04), and if the epoch's total exceeds its budget all entries are
> scaled by the same factor when the epoch closes (it was first come, first served). The provider's 95 % stays paid
> per job. A weekly pool would need a settlement-contract change (its lane-B cap is per epoch); not adopted yet.
>
> **Superseded (2026-10-12, owner approved):** prices are **quoted in US dollars and settled in CLD**
> ([TOKENOMICS_USD_PRICING.md](TOKENOMICS_USD_PRICING.md)). The rate enters in one place only: how many CLD a quote
> asks for. The ledger, the 95/3/2 split, the subsidy budget (stays in CLD) and the settlement contract are unchanged;
> no oracle in settlement. Testnet uses a fixed reference rate of **$0.10 per CLD**; after listing, a one-hour TWAP of
> the CLD/USDC pool with pauses, behind a flag. This replaces the "Denomination" row below. The dollar price table is
> proposed in [PRICES_USD.md](PRICES_USD.md).
>
> **Superseded (2026-10-11, V4):** ρ is capped at **0.04** in code (`RHO_MAX`, ledger.service.ts) so that
> 0.95 + ρ < 1: paying yourself can never return more than you paid, even owning every node. "Cluster" = payout
> wallet, so the gate alone could be passed with three wallets. See [V4_VERIFIED_SERVICES.md](V4_VERIFIED_SERVICES.md) rule 4.

| Decision | Testnet | Before mainnet | Confidence |
|---|---|---|---|
| Price unit | nCLD/TMAC, 14,000 + base fee 1,000 µCLD/job | Same unit; launch price from testnet median | High |
| Denomination | CLD-native utilization controller (±2%/h, holds when idle); USD display only | Same; no oracle in settlement | High |
| Genesis | Keep 1M Sepolia token (fresh deploy) | Fresh 100M: Treasury 40 (6-month cliff, 48-month vest), Ecosystem 25 (≤10%/yr), Team 20 (12-month cliff + 36-month vest), Liquidity 10, Testnet retro 5; on-chain vesting | Medium |
| Subsidy | ρ 0.25; budget 80% of chain allowance | ρ 0.25 (0.5 only at ≥10 clusters, largest ≤30%); min(chain, 4% of genesis/yr), halving every 4 yr, floor 1% of supply/yr | Medium |
| Cluster gate | N_MIN 3, S_CAP 0.5, per operator | N_MIN 5, S_CAP 0.34 | High |
| Fee split | 95 / 3 / 2 in the ledger | Enforced on-chain (treasury ≥3%, net burn ≥2%) | High |
| Pay with crypto | Simulated | Swap in the user's wallet → `deposit()`; 1% max slippage; pause on >10% price deviation | High |
| Cards / Stripe | Off | Off; Coinbase Onramp into the user's wallet | High |
| Free tier | One static site (≤2 MB) per verified identity | Plus caps: 1,000 CLD/day, ≤30% of hosting capacity; abuse process | High |
| Testnet credits | 10 CLD/day keyed to Reown identity + wallet, IP/ASN cap; on-chain faucet deleted | Removed; carry over only reliability history and "founding" status | High |
| Epochs | 1 h epochs, 1 h veto | 24 h epochs and veto; lane A at T+24 h; lane B 7-day vest | High |
| Contracts and keys | Fresh CLDToken + Settlement, Safe 2-of-3, fresh poster key | Plus 48 h timelock, audits | High |
| Keeper | Separate Worker, cron every 5 min, stateless | Plus guardian alerts; multiple posters (k-of-n) later | Medium |
| Home hardware | Compute (matmul) + static hosting only | Containers/GPU after the hardening checklist | High |
| Hosting | Served through a `*.sites.cloudana.io` proxy; probe checks a content hash | Plus admin stop, abuse/DMCA contact | High |
| Heartbeat | 15 s | 30 s; duties moved off the heartbeat | High |

## Owner-only decisions (panel default: yes)
1. Raise the treasury share from 0.5% to 3% (one-way-down knob).
2. Deploy a fresh token and settlement contract under a Safe; abandon 0xF292… and every legacy contract.
3. 100M genesis with the allocation and vesting above; rewrite whitepaper §6.2–6.3.
4. Payments in other assets are swapped in the user's wallet only; Stripe stays off.
5. Free tier: one static site per verified identity, funded by the treasury.
6. No points or airdrop formula for the testnet; "founding provider" status only.
7. The mainnet datacenter-partner bootstrap is paid from the Ecosystem allocation, not the subsidy lane.
8. Engage counsel on token classification, payment facilitation and the free tier before CLD carries any value.

## Blocking issues before real users
1. **Critical:** the leaked EOA is admin and minter on the live CLDToken (uncapped), and the faucet still mints with it.
2. **Critical:** unsigned heartbeat instructions + docker.sock + a default http API URL = fleet-wide root RCE.
3. **High:** the price unit is ~7e7× the market; CLD_USD_RATE is fixed at 100; two pricing systems coexist.
4. **High:** the fee split and lanes aren't enforced on-chain; lane A is blocked by the lane-B vest; users can't withdraw escrow.
5. **High:** hosting billing fraud (a node can report any URL; the probe only checks reachability).
6. **High:** the deposit path credits transfers to RewardContract and there is no `Deposited` watcher.
7. **Medium:** testnet credits are keyed per wallet only, and the faucet is still routed.
8. **Medium:** 3 s heartbeat, duties run inside it, and there is no production keeper.
9. **Medium:** the docs contradict the code (allocations sum to 60%, 8% drip, "100% burned", 120 s vs 24 h epochs).

## Phases
- **Now (testnet operational).** Deliver everything in the Testnet column above.
  - Exit: 30 days of hourly epochs finalized, including one veto drill; tests green; no hot chain key in the API Worker.
- **Incentivized testnet.** 2 datacenter partners plus ≥15 home nodes; public job #1; free static tier behind the gateway; epoch leaves and draw seeds published.
  - Exit: ≥3 independent clusters with the largest ≤30% for 60 days; utilization held at 0.6–0.8 for 30 days; counsel engaged.
- **Mainnet.** 100M genesis with vesting; 24 h epochs; on-chain fee split; timelock; audits; liquidity pool ≥30× daily fees; capped free tier.

## Public messaging
CLD is the unit of account for compute on Cloudana: every job is priced and settled in CLD. When a verified job is paid for, the customer's fee is burned and the provider who did the work is minted most of it, so new CLD exists only because someone paid for real, verified computation. A small, capped, declining subsidy rewards providers in genuinely independent clusters while the network bootstraps. If you hold another asset, your own wallet can swap it into CLD at the moment you pay; Cloudana never holds it. Nothing about CLD is a promise of price or return.

## Dissent (where the chair overruled and could be wrong)
- The protocol-run USDC buy-and-burn (Akash-style) was rejected for custody reasons. If wallet-side swaps prove too clunky for non-crypto buyers, revisit it with counsel.
- The 1%-of-supply subsidy floor counters long-run deflation. If demand never reaches high velocity, it's unnecessary emission; governance can set it to 0.
- 3% treasury over the owner's 0.5%: if CLD prices well above $0.10, it overfunds the treasury. The one-way-down knob is the hedge.
- Burn-then-remint was kept over a plain fee because it gives the on-chain `mint ≤ fees` invariant.
