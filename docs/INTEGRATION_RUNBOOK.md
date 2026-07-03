# Cloudana — Integration Runbook (apply via Claude Code in the Cloudana10 repo)

Work top to bottom. Each step is independently testable; commit after each.

> **Status (2026-07-03):** Sections **B** (true PoUW wiring) and most of **A** are
> now APPLIED and tested in the repo (`pouw` suite green incl. `test-backed.ts`;
> `contract` suite 178 passing incl. `emission-migration.test.ts`; `client/api`
> tsc clean). What remains is *running* the deploys against a live network:
> the EmissionController migration script (A) + the orchestrator on Akash, both
> gated on funding. Items still genuinely open are marked **TODO** below.

## A. Tokenomics v2 — contracts
1. ✅ `EmissionController.sol` is in the repo and it needs `MINTER_ROLE` on `CLDToken`.
2. ✅ `scripts/deploy-emission-controller.ts` deploys it, grants it `MINTER_ROLE`,
   **revokes `MINTER_ROLE` from the deployer EOA**, and verifies the sole-minter
   end state. `test/emission-migration.test.ts` proves it on a fresh chain.
   **TODO (needs testnet ETH):** run it — `npx hardhat run scripts/deploy-emission-controller.ts --network baseSepolia`.
3. **TODO (reviewed contract change):** apply the burn additions from `RewardContract_v2_burn.sol` into `RewardContract.sol`:
   - add `BURN_BPS`, `TREASURY_BPS`, `treasury`, `totalBurned`, `totalToTreasury`, `cldSettlement`;
   - replace the body of `fundWorkload()` with the `_fundWorkloadV2` split (burn / treasury / escrow);
   - set `cldSettlement = ICLDBurnable(address(settlementToken))` in the constructor (settle in CLD for the cleanest burn).
4. Remove `ProviderMinter.sol`'s halve-to-zero from the *mainnet* path (keep it only if you still want a one-time registration bonus — but ongoing emission now comes from `EmissionController`, not from `ProviderMinter`).
5. `npx hardhat compile` → fix any import paths → `npx hardhat test`.

## B. True PoUW — wire real workloads  ✅ APPLIED
1. ✅ `pouw/src/workload-bridge.ts` maps signed workload matrices into F_p, mines
   on them, and lifts the decoded result back to signed (with exact-recovery
   bound checks).
2. ✅ `cupow.ts` solve() returns the decoded `result`; `matToBytes` now uses
   signed int32 (real workloads have negatives — the old uint32 threw on them).
3. ✅ `pouw-miner.ts` is job-first: `GET /v1/pouw/job` → `solveBacked()` → submit
   cert **with** `workloadId` + result; filler only when the queue is empty, and
   filler earns a capped fraction (not zero — keeps the network warm pre-demand).
4. ✅ `matrix-job-queue.service.ts` + `GET/POST /v1/pouw/job`, `GET /v1/pouw/job/:id`.
5. ✅ Reward gate lives server-side: `/pouw/submit` calls `completeJob()` to decide
   `backedByWorkload` (never trusts the payload); `mining-reward.service` pays full
   for backed, `FILLER_REWARD_FRACTION` under a daily cap for filler.
6. **TODO (needs orchestrator + contracts live):** the real end-to-end run — submit
   a Tier-3 workload → provider mines it → user receives the decoded result →
   CLD paid. This is mainnet gate #4 and flips `totalCertificates` off zero.

## C. Plug-and-play onboarding
1. Add `provider-node-server/src/hardware-detect.ts` (provided).
2. In `install-provider.sh`, after install run `node dist/hardware-detect.js`, take the JSON, and POST it to the orchestrator's provider-register endpoint signed by the provider wallet.
3. In `provider-node-server/src/index.ts`, call `detectHardware()` at startup and use `profile.tier` + `profile.deviceId` for registration and the `ProviderMinter` tier.
4. Verify on a CPU-only box (tier 0) and a GPU box (`nvidia-smi` present → tier 3/4).

## D. Honesty pass (do this before any public launch)
1. ✅ README + site corrected to "trust-minimized, orchestrator-coordinated (testnet)".
2. ✅ Replay store is persistent: `certificate-store.service.ts` enforces `z`
   uniqueness via a D1 UNIQUE constraint (not in-memory). The matrix job queue is
   D1-backed too, with a loud (never silent) in-memory fallback.
3. **TODO:** move `ORCHESTRATOR_PRIVATE_KEY` off a plain hot wallet → a separate
   signer with a spend cap; document the multisig plan. (Injected at Akash deploy.)

## E. Decisions only you can make (don't let me guess these)
- Final emission/burn/distribution numbers (the v2 defaults are sound starting points, not gospel — tune to runway).
- **Legal review of CLD classification before any token event.** Not optional, not something the code settles.
