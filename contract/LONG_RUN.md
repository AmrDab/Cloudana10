# CloudanaSettlement — 20-year long run

`npx hardhat test test/long-run-settlement.test.ts` (shorter: `LONG_RUN_EPOCHS=520 …`). Seeded PRNG, so it is reproducible.

## Scenario

- **1040 weekly epochs (20.0 years), not extrapolated.** Epoch = 7 d, veto window = 24 h. 60 providers plus the treasury.
- **Fees F** are log-normal (median 50 CLD/week, σ = 0.6), growing 15%/yr. A user escrows F each epoch.
- **Lane A** = 0.975F, split across a random subset of 5–60 providers by random weights. The treasury gets 0.005F.
- **Lane B** = min(ρF, `allowance(epoch)`), with ρ = 0.25 + 0.05/yr, capped at 1. It goes to a random subset of the lane-A recipients.
- **Leaves** are aggregated per address. They are `(uint256 epoch, address, uint256 amountWei)` in an OZ `StandardMerkleTree`, the same as `scripts/local/keeper.ts`.
- **Per epoch:** deposit → `postEpoch` → wait for the veto window → `finalize` (burns F).
- **Every 50th epoch:** the poster posts a bad root (one attacker leaf takes the whole mint). The guardian vetoes it, and the poster re-posts the corrected root.
- **Claims:** run every 4 epochs. Each finished epoch is claimed with one `claimFor` tx for all its leaves. Every 20th epoch is instead claimed leaf-by-leaf with `claim()` to measure single-claim gas. The contract has no multi-epoch claim, so a provider who claims every 4 epochs needs 4 leaves (one per epoch).

## Result: 1040 epochs, all invariants green, 152 s wall time (≈190 s inside the full suite)

20 vetoes and re-posts. 35,397 leaves claimed (34.0 per epoch on average). 1,040 global invariant checks.
Fees burned: 345,834 CLD. Lane B minted: 171,968 CLD (the allowance capped it in 297 epochs, once the rate hit the 1.5% floor).
Supply went from 1,000,000 to 1,165,051 CLD.

| op | samples | median gas | min | max |
|---|---:|---:|---:|---:|
| `deposit` (user) | 1040 | 88,818 | 88,806 | 105,918 |
| `postEpoch` | 1040 | 171,649 | 168,952 | 172,127 |
| `postEpoch` re-post after veto | 20 | 78,187 | 75,257 | 78,396 |
| `veto` | 20 | 33,213 | 33,213 | 33,213 |
| `finalize` | 1040 | 49,107 | 49,097 | 49,107 |
| `claim` (single leaf, own tx) | 1795 | 85,977 | 83,436 | 118,475 |
| `claimFor` (per tx, ~34 leaves) | 988 | 1,475,277 | 294,303 | 2,784,213 |
| `claimFor` (per leaf, amortized) | 988 | 42,154 | 41,983 | 56,881 |

**After the finding-#1 fix (genesis/elapsed checks and the lane-B year tracker), re-measured at 260 epochs (5 y):**

| op | before fix | after fix |
|---|---:|---:|
| `postEpoch` | 171,649 | 181,076 (max 214,678 on the first post of a schedule year, which writes a fresh `subsidyByYear` slot) |
| re-post after veto | 78,187 | 87,345 |
| `veto` | 33,213 | 46,005 |

`finalize` and the claim functions are unchanged. The weekly keeper cost moves by about 10k gas, which is negligible.
Storage adds 1 slot per schedule year (`subsidyByYear`) plus 1 global slot (`totalSubsidyMinted`).

Gas does not drift over 20 years. `postEpoch` grows by about 3k because the `rateBpsAt` loop runs more years before it hits the floor, and the loop stops at 11 iterations.

Invariants asserted continuously. **All held.**
- `totalSupply == initial + Σminted − Σburned`, after every epoch.
- `balanceOf(settlement) == totalEscrow` and `totalEscrow ≥ pendingBurn`, after every epoch, so escrow never underflows. `pendingBurn == 0` after every finalize.
- A claim before finalize reverts with `NotFinalized`, both for a fresh post and for a vetoed epoch. Finalize inside the window reverts with `VetoWindowOpen`.
- A second claim of the same leaf reverts with `AlreadyClaimed`.
- A leaf and its proof from epoch j, replayed against another finalized epoch, reverts with `InvalidProof`. The vetoed root's leaf reverts with `InvalidProof` after the corrected root finalizes.
- On-chain `epochs(e).minted` equals the sum of the leaves, which equals `mintA + mintB`, which is at most the cap.
- The treasury balance delta equals exactly 0.005F per epoch, and the cumulative treasury balance equals Σ0.005F.

## Limits and cost

- **Hardhat limits:** 1040 epochs run without trouble. The largest tx was 2.78M gas: `claimFor` with about 60 leaves at about 42–46k per leaf.
  - Under a 30M block limit, one `claimFor` fits about 650 leaves.
  - Under a 2^24 (16.7M) per-tx cap (EIP-7825), it fits about 390 leaves.
  - Past a few hundred providers per epoch, the keeper must chunk `claimFor`. It already can, because claims are per leaf.
- **Cumulative gas:** 1.90B over 20 years, about 1.83M per epoch. That includes user deposits and the deliberately expensive single-claim epochs.
- **Weekly keeper cost:** postEpoch + finalize + one claimFor of 34 leaves ≈ 0.17M + 0.05M + 1.48M ≈ **1.7M gas per week**.
  - Assumed Base L2 gas price is **0.01 gwei** with ETH at **$3,000**. That gives 1.7e-5 ETH ≈ **$0.05 per week** of execution, or about $53 over 20 years.
  - The L1 data fee for about 11 KB of `claimFor` calldata (proofs) adds a few cents at typical blob prices.
  - At a 0.1 gwei spike, execution is about $0.51 per week.
  - Batching saves about 2×: 42k per leaf with `claimFor` versus 86k with `claim`.
- **Storage growth per epoch:**
  - The `Epoch` struct takes 6 new slots: root, mintA, mintB, feesBurned, minted, and postedAt+status packed together.
  - Each claimed leaf adds 1 `claimed[leaf]` slot.
  - At 34 leaves, that is about 40 slots (1.28 KB) per epoch, or about 1.3 MB of contract state over 20 years.
  - Storage is never pruned, but it never needs iterating either. No loop runs over epochs or claims.

## Veto finding and the change made

**Before:** `postEpoch` reverted with `AlreadyPosted` unless the status was `None`, and `veto` set the status to `Vetoed` permanently.
A vetoed epoch could never be re-posted. All of that epoch's provider earnings (lane A and lane B) became permanently unmintable on-chain. The user fees were only un-reserved and stayed in escrow, unburned.

**Fix:** one condition in `CloudanaSettlement.postEpoch`.
```solidity
if (e.status != Status.None && e.status != Status.Vetoed) revert AlreadyPosted(epoch);
```
- Re-posting is still `POSTER_ROLE`-only and still passes every lane-A, lane-B and escrow check.
- It gets a fresh `postedAt`, so a full new veto window applies, and the guardian can veto it again.
- `Posted` and `Finalized` epochs still cannot be overwritten.
- A vetoed epoch was never finalized, so nothing was burned or claimed: `minted` is 0 and no `claimed[]` entries exist.

The new unit test is in `test/cloudana-settlement.test.ts`: "a vetoed epoch can be re-posted with a corrected root…". The **ABI is unchanged**, so `shared/abi/CloudanaSettlement.json` was not re-exported.

The off-chain side is still open. The keeper drops vetoed epochs, and `ledger.service.ts` has no path to re-close a `posted` epoch. To use the fix, the API needs a "re-open vetoed epoch" step and the keeper needs to re-post.

## Other findings (not changed)

1. **FIXED — epoch id was unbounded, so lane B had no cumulative cap.** Previously `postEpoch` accepted any epoch number (pre-genesis, future, arbitrary), and every unused id carried a full `allowance`. A poster key could mint without limit. Now:
   - **Genesis bound:** `genesisEpoch = genesisTimestamp / epochSeconds` is an immutable set in the constructor. It defaults to the epoch of deployment, because deploy.ts passes the deploy block's timestamp. Posting earlier reverts with `EpochBeforeGenesis`.
   - **Elapsed bound:** `(epoch + 1)·epochSeconds ≤ block.timestamp` is required. A post that is too early reverts with `EpochNotElapsed`.
   - **Status:** `Posted` and `Finalized` still revert with `AlreadyPosted`. A `Vetoed` epoch can still be re-posted.
   - **Cumulative lane-B tracker:** `totalSubsidyMinted` (all years) and `subsidyByYear[yearOf(epoch)]` record the lane B committed at post time. Veto releases both.
   - **Allowance:** `allowance(epoch)` is now `min(per-epoch share, annualSubsidyCap(epoch) − subsidyByYear[year])`, where `annualSubsidyCap = supply × rateBpsAt(year) / 10⁴`. However many valid epochs are posted, a schedule year cannot exceed its annual total.
   - With weekly epochs, a year that has 53 epoch starts gets its last epoch truncated. That is covered by a unit test with 30-day epochs.
   - **Residual risk:** the annual cap is evaluated at current supply, so it rises slightly as supply grows within the year. That is bounded and minor.
   - The design's "unused budget carries ≤ 7 epochs" is not implemented. Unused budget is simply never minted, which is stricter.
2. **Not fixed — treasury 0.005F is not enforced on-chain.** The treasury is just a leaf, and the contract only checks `mintA ≤ 98%·F`. The invariant held in this run because the keeper built it that way. A root could pay the treasury's share to anyone.
   - Enforcing it needs the contract to see the treasury leaf at post time: a treasury address, plus a treasury amount and proof passed to `postEpoch`, or a separate treasury field/lane in the root. That changes the `postEpoch` signature or the tree format, so it was skipped.
   - The cheapest follow-up is an overload `postEpoch(epoch, root, mintA, mintB, fees, treasuryAmount, treasuryProof)` that verifies `leafOf(epoch, treasury, treasuryAmount)` against the root with `treasuryAmount ≥ fees·5/1000`, keeping the old overload until the keeper migrates.
3. **Lane split is not enforced at claim time.** Claims check only the combined `mintA + mintB`. The root does not tag lanes, so lane-A headroom can pay lane-B recipients and the reverse.
4. **No on-chain vesting or clawback of lane B.** The design (§6.4) calls for both. Today the only protection is the API delaying epoch close until `vests_at`. Once posted and finalized, lane B is claimable immediately and is final.
5. **Escrow is a pooled, one-way honeypot.**
   - There is no withdraw or refund.
   - `escrowOf` is informational and never decremented.
   - `feesBurned` is not attributed to any user, so the poster can burn any depositor's escrow up to `totalEscrow − pendingBurn`.
   - Over 20 years this pool only grows unless every deposit is consumed.
6. **`allowance` uses `totalSupply()` at post time, not at the epoch.** A late post sees a different cap. This is minor, but the cap depends on posting timing.
7. **Governance.**
   - `DEFAULT_ADMIN_ROLE` can grant POSTER or GUARDIAN instantly, with no timelock.
   - `vetoDelaySeconds` is immutable.
   - Safety depends on guardian liveness: a missed 24 h window finalizes a bad root irreversibly.
   - `finalize` is permissionless, so nobody can delay it.
8. **Unclaimed leaves never expire.** That is a perpetual, unbounded mint overhang (Σ posted − Σ minted). It is fine, but it should be monitored.
9. **Unbounded loops: none.**
   - `rateBpsAt` stops at 11 iterations once it hits the floor.
   - `claimFor` is bounded by the caller's calldata.
   - `postedAt` is `uint64`, so it is safe for many millennia.
