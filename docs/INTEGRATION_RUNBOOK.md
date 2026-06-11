# Cloudana — Integration Runbook (apply via Claude Code in the Cloudana10 repo)

Work top to bottom. Each step is independently testable; commit after each.

## A. Tokenomics v2 — contracts
1. Add `contract/contracts/EmissionController.sol` (provided). It needs `MINTER_ROLE` on `CLDToken`.
2. In your deploy script: after deploying `CLDToken`, grant `MINTER_ROLE` to the `EmissionController` address and **revoke `MINTER_ROLE` from every EOA / the deployer wallet**. The controller must hold the *only* active minter role — that is what bounds emission to the schedule.
3. Apply the burn additions from `RewardContract_v2_burn.sol` into `RewardContract.sol`:
   - add `BURN_BPS`, `TREASURY_BPS`, `treasury`, `totalBurned`, `totalToTreasury`, `cldSettlement`;
   - replace the body of `fundWorkload()` with the `_fundWorkloadV2` split (burn / treasury / escrow);
   - set `cldSettlement = ICLDBurnable(address(settlementToken))` in the constructor (settle in CLD for the cleanest burn).
4. Remove `ProviderMinter.sol`'s halve-to-zero from the *mainnet* path (keep it only if you still want a one-time registration bonus — but ongoing emission now comes from `EmissionController`, not from `ProviderMinter`).
5. `npx hardhat compile` → fix any import paths → `npx hardhat test`.

## B. True PoUW — wire real workloads
1. Add `pouw/src/workload-bridge.ts` (provided).
2. In `pouw/src/cupow.ts`, change `const _ = decode(...)` to `const result = decode(...)` and add `result: result.data` to the returned `SolveResult` (so the useful output isn't discarded).
3. In `provider-node-server/src/pouw-miner.ts`, replace the random-matrix loop: before mining, `GET ${ORCHESTRATOR_URL}/v1/pouw/job` for a pending `WorkloadMatrixJob`; if one exists call `solveBacked(...)` and submit the cert **with** `workloadId` + decoded result; if none exists, idle (do **not** mine random filler for reward).
4. Add orchestrator endpoint `GET /v1/pouw/job` in `client/api/src/routes/v1/pouw.ts` that pops a matmul job from the workload queue (Tier-3 workloads only).
5. In `client/api/src/services/mining-reward.service.ts`, gate the reward: `if (!cert.backedByWorkload) return null;`.
6. End-to-end test: submit a real Tier-3 workload → confirm a provider mines it → confirm the user receives the decoded result → confirm CLD is paid **only** for the backed cert.

## C. Plug-and-play onboarding
1. Add `provider-node-server/src/hardware-detect.ts` (provided).
2. In `install-provider.sh`, after install run `node dist/hardware-detect.js`, take the JSON, and POST it to the orchestrator's provider-register endpoint signed by the provider wallet.
3. In `provider-node-server/src/index.ts`, call `detectHardware()` at startup and use `profile.tier` + `profile.deviceId` for registration and the `ProviderMinter` tier.
4. Verify on a CPU-only box (tier 0) and a GPU box (`nvidia-smi` present → tier 3/4).

## D. Honesty pass (do this before any public launch)
1. Replace every "trustless" / "no backend" claim in `README.md`, the site, and docs with "trust-minimized, orchestrator-coordinated (testnet)". The zkSNARK milestone is when "trustless verification" becomes true.
2. Make the replay store persistent (D1/SQLite), not in-memory, so an orchestrator restart can't reopen the replay window.
3. Move `ORCHESTRATOR_PRIVATE_KEY` off a plain hot wallet → at minimum a separate signer with a spend cap; document the multisig plan.

## E. Decisions only you can make (don't let me guess these)
- Final emission/burn/distribution numbers (the v2 defaults are sound starting points, not gospel — tune to runway).
- **Legal review of CLD classification before any token event.** Not optional, not something the code settles.
