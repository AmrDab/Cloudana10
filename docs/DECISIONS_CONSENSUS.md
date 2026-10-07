# Decisions consensus — October 2026

This is the consensus of a Fable review panel: token economics, payments and demand, operations and security, and a chair who cross-examined the three. The reviewers' condensed reports are in [REVIEW_PANEL_2026-10.md](REVIEW_PANEL_2026-10.md). Status: **recommendations awaiting the owner's yes**. Nothing here has been implemented yet.

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
