# Proof of Useful Work — independent review

> **Status note, 2026-10-26.** This review is kept as written on 2026-10-12; parts of it are superseded. Since then:
> the C + p bug is fixed (C is bounded to ±n·bound², so Freivalds is exact over the integers) and the transcript is
> re-executed over the API's own A and B, so the 2³² binding bug no longer reaches a verdict. The orchestrator no
> longer re-executes every job: Freivalds runs on every matmul job and the full cuPOW transcript is re-executed on a
> random 1 in `VERIFY_SAMPLE_K` (10) and on every job for a new node's first `VERIFY_WARMUP_JOBS` (10), with every job's provider pay held `PAY_HOLD_SECONDS` (24 h) and clawed
> wallet-wide on a failed sample, and the node suspended (B-6; undo: `POST /v1/admin/claws/{jobId}/reverse`). So
> "detection is 100 %" below now holds for a wrong answer, not for skipped transcript work: that is caught on a
> sampled job, on average after 10 jobs, never as a guarantee. New work types `int8-mlp` and `int8-model` are
> checked by commit-then-challenge on drawn segments (B-26). Groth16 over the transcript is not being built (§7).
> Current tiers: `ARCHITECTURE.md` §6, `CAPABILITY_MATRIX.md`.

Cryptography and mechanism-design opinion, 2026-10-12. Verified against `pouw/src`, `work-types.ts`,
`jobs.service.ts`, `ledger.service.ts`, `pricing.service.ts`, `verify-feed.service.ts`, `node-agent`, `pouw-gpu`,
`POUWVerifier.sol`, `ChallengeManager.sol`, `CloudanaSettlementV2.sol`, the whitepaper, litepaper, UNIVERSAL_POUW,
BUILD_SPEC_V1, V4_VERIFIED_SERVICES and the site copy. Numbers: `npx tsx scripts/sim/pouw-attacks.ts` (runs the real
`pouw/src` and the real `matmul.verify` the API uses). `pouw/ npm test` passes. Nothing else was changed.

## Verdict

**Sound for what it gates today, but not for the reason the docs give.** No CLD mints unless the orchestrator
*re-executes the whole job* (`cupow.ts:296-300`, via `work-types.ts:98`) and Freivalds-checks the answer
(`work-types.ts:106`). Every work-skipping attack I ran — forged, partial, stale, copied, relabelled,
plain-C-without-proof — is rejected (§2). That is verification by full replication at a trusted verifier; the cuPOW
transcript adds nothing to it. The transcript's one real contribution is *freshness*: σ is issued at assignment
(`jobs.service.ts:251`) and the transcript depends on it, so a certificate cannot be precomputed, reused or copied.
That matters only for the subsidy lane and the assignment weight, both already bounded (`RHO_MAX = 0.04`,
`ledger.service.ts:42`; the weight moves only from verified work, `nodes.service.ts:55-56`).

What it costs: the node does ≈3 n³ instead of n³ — `decode()` forms E and then multiplies it by B and by F
(`cupow.ts:143-144`), O(n³) each, not the O(n²r) its comment claims — and the orchestrator does ≈n³ per job instead
of Freivalds' n². Measured at n = 256: plain C 62 ms, node with proof 5.1 s, orchestrator 2.1 s, Freivalds 28 ms.
Verification is 75× dearer than needed and scales as n³; at the n = 4096 the testnet plan promises for mainnet it is a
17 GB transcript and ≈2.4 hours of orchestrator CPU per job.

Two implementation bugs let a node that *did* the work be paid for a **wrong answer** or for a proof over the
**wrong matrix** (§2, rows g3–g5 and h). Both are one-line fixes. No path to minting without work was found.

**Keep "proven" as the label for matmul, defined as "orchestrator-replicated, answer-checked". Keep the σ-binding.
Drop the claim that the transcript makes work unfakeable to anyone but the orchestrator, and drop Groth16 over this
transcript (§7).** Confidence ≈90 % that nothing mints without a full orchestrator re-execution plus an answer check;
the residual is the trusted orchestrator and poster key, which the contract bounds in supply, not in correctness
(`CloudanaSettlementV2.sol:206-213`).

## 1. What it proves, and what it does not

| Claim | Backed by | Status |
|---|---|---|
| The full noisy block product was computed for this σ, after assignment | transcript re-executed (`cupow.ts:284-310`); σ = sha256(jobId‖node‖nonce‖seed) (`jobs.service.ts:251`), checked at `work-types.ts:90` | proven to the orchestrator only; nobody else can check it cheaper than n³ |
| C = A·B | Freivalds, 2 rounds, p = 1e9+7 (`freivalds.ts:46`) | proven **mod p**; C + p·K passes (`work-types.ts:103` bounds C only to safe integers) |
| The transcript is over the job's A, B | `fieldHash` binding (`work-types.ts:93`) | not injective over the submitted `number[]`: `matToBytes` writes `v \| 0` (`matrix.ts:109`) |
| The *assigned node* did it | node-signed submit (`work.ts:46`) | proves who submitted, not who computed |
| Difficulty | certificate field `d` | always 0 (`cupow.ts:265`); irrelevant |
| Private inputs | — | jobs are public by default (`jobs.ts:35`; hard-coded `true` in `run.tsx:181`); A, B, C served to anyone by `GET /v1/verify/task` |

## 2. Soundness — attacks run through the API verdict (n = 64)

| Attack | Verdict | Caught by | Orchestrator cost | Attacker compute |
|---|---|---|---|---|
| honest | accepted | — | 45 ms | 3 n³ + hash |
| skip work: plain C, invented transcript | rejected | re-execution | 52 ms | n³ |
| partial: transcript differing in one block, right C | rejected | re-execution | 50 ms | ≈ n³ |
| stale: same A, B, earlier σ, right C | rejected | σ mismatch | 0.1 ms | 0 |
| stale transcript relabelled with current σ | rejected | re-execution | 45 ms | 0 |
| copied: another node's certificate + C | rejected | σ mismatch | 0.0 ms | 0 |
| plain C, no transcript at all | rejected | re-execution | 46 ms | n³ |
| right transcript, C off by 1 (one entry / all) | rejected | Freivalds | 43–48 ms | 3 n³ |
| **right transcript, C + p in any entries** | **accepted** | — | 45 ms | 3 n³ |
| **transcript over A + 2³² (hash equal), true C** | **accepted** | — | 52 ms | 3 n³ on the wrong matrix |
| difficulty field 0 / 8 / 256 | accepted / rejected / rejected | `meetsDifficulty` | — | — |
| grind σ, precompute, exploit d | impossible: σ orchestrator-issued, d = 0 | | | |
| collude with the payer | §4: loses ≥1 % at ρ = 0.04 | | | |
| 3-attempt retry (`jobs.service.ts:210, 324-333`) | griefing only: no payment on failure; job killed and user refunded with probability s³ | | | |

Detection of any work deviation is 100 % because the verifier recomputes everything; the price is that rejecting
garbage costs the same as accepting (2.1 s at n = 256) because the transcript is checked before Freivalds
(`work-types.ts:96-106`). Freivalds first would reject a wrong C in 2 ms.

**Freivalds as implemented** (`freivalds.ts:15-40`): random vector from 64 random bytes per entry mod p (bias
< 2⁻³⁴), two rounds, BigInt — no overflow or precision issue. False-accept for C ≢ A·B (mod p) ≤ (1/p)² ≈ 10⁻¹⁸;
300/300 random corruptions caught. But equality is in F_p: 300/300 matrices with entries shifted by ±p were
accepted. Inputs are bounded so |C_ij| ≤ n·maxAbsEntry(n)² < p/2 (`workload-bridge.ts:30-35`); a magnitude check on
C makes the equality exact over the integers. The console's and browser verifier's re-checks are also mod p
(`console/matmul.ts:4-25`, `lib/verifier.ts:5-25`), so the user would not notice a wrapped answer.

**Hash binding.** `cert.matrixA` is any `number[]` (`work.ts:30`); `v + 2³²` hashes like `v`. The transcript is then
over `(A + 2³² mod p)`, which the orchestrator faithfully re-executes and accepts. I found no way to make the work
cheaper this way (zeroing or low-ranking A + E needs non-small multipliers), so today it is a binding bug, not theft.
It becomes dangerous the day any verifier trusts the hash instead of recomputing.

## 3. Overhead, scaling, usefulness

| n | r / nb | transcript | plain C (node) | node with proof | orchestrator verify | Freivalds | verify ÷ plain |
|---|---|---|---|---|---|---|---|
| 64 | 4 / 16 | 0.26 MB | 1.9 ms | 100 ms | 50 ms | 2.3 ms | 27× |
| 128 | 4 / 32 | 2.1 MB | 16 ms | 772 ms | 355 ms | 6.7 ms | 22× |
| 256 | 8 / 32 | 8.4 MB | 62 ms | 5.1 s | 2.07 s | 28 ms | 34× |
| 4096 (analytic) | 16 / 256 | 17 GB | — | — | ≈ 2.4 h at the measured 8 M mulmod/s | ≈ 7 s | — |

- Node overhead ≈80× wall time at n = 256 (BigInt field arithmetic plus the extra 2 n³ in `decode`); the protocol's
  minimum is ≈2 n³ (compute C plainly, compute the transcript, skip decode).
- Block size follows the user's n (`cupow.ts:49-54`): n = 255 → 132,651 blocks of 5×5; n = 251 → one block (the
  transcript is just H(C′)). Harmless only because the verifier recomputes anyway.
- GPU: exact arithmetic mod a 30-bit prime on integers within ±maxAbsEntry(n) (±1,397 at n = 256) plus a *serial*
  rolling SHA-256 over every block in order (`matmul.ts:34-50`). No fp16/tensor-core path; an integer kernel
  multiplies n = 256 in tens of µs while the 8.4 MB serial hash takes 5–15 ms, so on a GPU the proof is ≥100× the
  useful work. `pouw-gpu` is unusable regardless: it hashes u64 (`matrix.rs:46`, `transcript.rs:47`) and seeds noise
  differently (`cupow.rs:55-67`), so its certificates fail the TypeScript verifier, and the `cuda` feature has no
  kernel.
- The orchestrator is the capacity ceiling: every job is redone in JavaScript on a Worker.
- Useful? It is a real integer matmul of what the user sent, so "useful" is literally true. But n ≤ 256
  (`work-types.ts:46-47`), integer-only inputs and one job per 15 s heartbeat per node (≈1 MMAC/s) describe no real
  demand. "A, B private under the proof" does not exist today.

## 4. Economics

**Fee** (`pricing.service.ts:25-29`; 14,000 nCLD/TMAC + 1,000 µCLD base): at every allowed n the fee is 1,001 µCLD;
the metered part is ≤ 1 µCLD. The n³ meter and the price controller carry no signal; a node earns 950 µCLD for n = 8
or n = 256, at most 0.23 CLD/h (≈ $0.02 at $0.10). Orchestrator CPU to verify (Workers $0.02 per M CPU-ms) is
1 % of the provider's pay at n = 64, 7.5 % at 128, **44 % at 256**.

**Self-dealing** (`splitFee`, `ledger.service.ts:45-56`): expected return per CLD paid = s·(0.95 + ρ) − 1.

| capacity share s | ρ = 0.04 (code) | ρ = 0.25 (whitepaper §6.2) |
|---|---|---|
| 0.5 | −50.5 % | −40.0 % |
| 0.9 | −10.9 % | **+8.0 %** |
| 1.0 | −1.0 % | **+20.0 %** |

`0.95 + ρ < 1` closes wash trading in CLD *whether or not the work is proven*: the self-dealer loses ≥1 % and still
has to compute a fresh transcript. The residual incentives are not in CLD: testnet "founding provider" / 5 % retro
status (whitepaper §6.3) is bought with free faucet credits — 10 CLD/day funds ≈10,000 jobs of `jobs_done` history;
and the assignment weight, which the σ-bound transcript does protect. The subsidy budget (7.3 CLD per hourly epoch)
binds only above ≈180,000 jobs/h.

**Minting risk from false accepts.** Transcript collision 2⁻²⁵⁶; Freivalds 10⁻¹⁸ for a wrong residue, 1.0 for a
wrong integer with the right residue — which still needs the true C, so no unbacked mint, only a wrong deliverable.
The real risk is the trusted orchestrator and poster key; the chain caps minting at 98 % of burned fees plus the
lane-B allowance, so supply is bounded, provenance is not.

## 5. Verifier layer and contracts

**Browser verifiers** (`verify-feed.service.ts`): 1 in 6 tasks is planted (`:10`); a real job's expected verdict is
hard-coded `"valid"` (`:42-43`) and grading only compares to it (`:75`). Verdicts never feed back into any job,
provider or claw; wrong answers cost nothing (`:88`). Answering "valid" blindly scores 83 %. Planted tasks measure
the verifier, not the provider. It is an onboarding funnel and a public re-check, not a security layer — and it
publishes every public job's A, B, C without login.

**Contracts.** `POUWVerifier` records what the orchestrator says (`:12-14`) and rejects difficulty 0 (`:111`), so
the live certificates could never be recorded; the recorder is a no-op anyway (`pouw-chain-recorder.service.ts:25-26`).
`ChallengeManager.submitFraudProof` is `onlyRole(RESOLVER_ROLE)` and never checks `fraudBlockIndex` or
`expectedHash` on-chain (`:258-281`): a role-gated slashing switch, not a fraud proof; whitepaper §6.4 abandons it.
`CloudanaSettlementV2` enforces treasury ≥ 3 %, A + treasury ≤ 98 %, B ≤ allowance, fees ≤ escrow — nothing about
PoUW. On-chain, "verified" means "the poster said so". The Groth16 circuit is a stub with a TODO where the transcript
proof goes (`circuits/pouw_verification.circom:33, 66-71`).

**Legacy route still mounted** (`app.ts:110`): `POST /v1/pouw/job` debits credits (`pouw.ts:203`) and
`POST /v1/pouw/submit` → `completeJob` stores C after a length check only (`matrix-job-queue.service.ts:252`), with
no A/B binding and no Freivalds (CLD_ISSUANCE_DESIGN finding #2, still open). It mints nothing
(`mining-reward.service.ts:26-33`), but a user can pay and receive an unchecked answer.

## 6. Docs vs code, ranked

| # | Claim | Where | Reality | Severity |
|---|---|---|---|---|
| 1 | Transcript "cannot be shortcut… unfakeable" | whitepaper §3.1, litepaper :17, `faq.tsx:5` | True only because the orchestrator recomputes it; a rolling hash nobody else can sample | High |
| 2 | ρ = 0.25 (0.5 at scale) | whitepaper §6.2 (:106), IMPL_SPEC :26 | `RHO_MAX = 0.04`; at 0.25 self-dealing pays above s ≈ 0.84 | High |
| 3 | "Every job assigned, proven, and paid" | `hero.tsx:46`, `bands.tsx:15` | Only matmul is proven; everything else is probed (`services.ts:33`) | High |
| 4 | Mainnet zkSNARK, "A, B remain private", n = 512–4096 | whitepaper §7.2, POUW_TESTNET_PLAN, `faq.tsx:6` "in development" | Stub circuit; SHA-256 over 8 MB–17 GB inside Groth16 is infeasible; inputs public by default | High |
| 5 | Decode is O(n²r) | `cupow.ts:129`, whitepaper §3.2 | two O(n³) products (`cupow.ts:143-144`) | Medium |
| 6 | Freivalds "confirms C = A·B" | `freivalds.ts:2`, `faq.tsx:6` | mod p only | Medium |
| 7 | Browser verifiers are part of "how work is verified" | `faq.tsx:6`, whitepaper §6.4 | verdicts have no effect | Medium |
| 8 | `pouw-gpu` is the mainnet provider build | `cupow.rs:3` | incompatible with the verifier; no CUDA | Medium |
| 9 | Mining, 10 CLD/proof halving, "trustless peer verification" | `/legacy/docs` (`ConsoleApp.tsx:73`; `pages/docs.tsx:864, 1292`) | none exists | Low (labelled legacy) |

## 7. Recommendations

**Now (testnet), all small:**
1. Bound C: reject `|result[i]| > n·maxAbsEntry(n)²` before Freivalds (`work-types.ts:103`). The answer check becomes
   exact over the integers.
2. Verify from the job's stored A, B; ignore `cert.matrixA/B` (or require integers in [0, p)). Removes the `| 0`
   second preimage and 2 × 65k numbers per submit.
3. Freivalds before the transcript (`work-types.ts:96-106`): garbage costs 2 ms, not 2 s.
4. Unmount `pouwRouter` (`app.ts:110`), or at least `/pouw/job` and `/pouw/submit`.
5. Node: compute C plainly, compute the transcript, skip `decode` (or form `EL·(ER·B)`). n = 256 falls from 5.1 s
   to ≈2 s and the 60 s assignment TTL gets margin on slow home PCs.
6. Copy: ρ = 0.04 everywhere; hero/bands → "matrix jobs proven, services probed"; FAQ → Groth16 not started;
   "unfakeable" → "re-executed by the orchestrator"; make `public` opt-in if privacy is a goal.

**Before mainnet — decide what "proven" means:**
7. Make V4 F3 the design, not a low-priority fix: Freivalds on every job (n²), transcript re-execution on a 1-in-k
   sample, earnings booked after the existing 2 h delay and clawed on a failed sample. Skipping the transcript gains a
   cheater nothing (C must still be right), so k = 20 loses no security and cuts orchestrator cost ≈20×. It is the
   only version that scales past n = 256.
8. Drop Groth16 over this transcript. The credible trustless path is the on-chain Freivalds challenge against a poster
   bond already in DECENTRALIZATION_ROADMAP (:53): it checks the answer users pay for, in n² steps, only on disputed
   jobs. If a *work* proof is still wanted, the transcript must become a Merkle commitment outsiders can sample — a
   different construction from today's rolling hash.
9. Price what is used: raise `MATMUL_N_MAX` until the metered fee is visible (n ≈ 2,000 to match the base fee at
   today's price), or drop the n³ meter and charge per job honestly. The controller cannot see demand through a 0.1 %
   signal.

**Drop:** `pouw-gpu` (rewrite against the TS byte spec or delete); `POUWVerifier` and `ChallengeManager` (already
abandoned — delete them so the docs stop describing them); the `difficulty` field on assigned certificates;
"verifier layer" language for the browser feed (keep the feed, call it a public re-check).
