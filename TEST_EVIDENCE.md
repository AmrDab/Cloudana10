# Test evidence — 2026-10-19

Every number below was produced in this pass in a sandbox with Node 22.22 and npm 10.9, no Docker, no GPU, no
Cloudflare or chain credentials, and no outbound access to `cloudana.io`, `*.workers.dev` or
`binaries.soliditylang.org`. Where that limits what a test proves, it says so.

## 1. Package suites (after the changes in `PROGRESS.md`)

| Package | Command | Result | Notes |
|---|---|---|---|
| client/api | `npm run type-check` | clean | |
| client/api | `npm test` (vitest) | **35 files, 334 passed** | 330 at baseline; +4 in `deployments.test.ts` (sealed v2 refusal, agent gate for secrets, start timeout ×2) |
| gateway | `npx tsc --noEmit && npx vitest run` | clean; **28 passed** | |
| relay | same | clean; **14 passed** | includes workerd e2e (`test/workerd.e2e.ts`) |
| keeper | same | clean; **28 passed** | tree vector fixture + run state machine |
| node-agent | `npm run type-check && npm run selftest` | clean; **8 selftests pass**: signing; sealed (26 checks); hosting; workstation (89); security (94); relay (69); relay e2e (24, real hub ↔ real agent ↔ real app); storage | 1.5.0 |
| contract | `npx hardhat test` | **224 passing** | compiled with solcjs 0.8.20 from npm through a Hardhat subtask override because the solc binary list is unreachable here; CI uses the normal download |
| repo root | `npm run check` (tsc) | clean | was 2 errors at baseline |
| repo root | `npm run test:client` | 3 passed | |
| repo root | `npm run build` (vite) | ok | `ConsoleApp` chunk 4.40 MB / 1.23 MB gzip (unchanged: the legacy routes still ship) |

## 2. End-to-end: the work pipeline on the Node runtime

`client/api/scripts/dev/e2e-v1.ts` against `node --import tsx src/index.ts` with
`DEV_MODE=true CLUSTER_N_MIN=1 EPOCH_SECONDS=10 VEST_B_SECONDS=5 INTERNAL_API_KEY=…` and a fresh SQLite file.
Result: **E2E PASSED (43 checks)**. What it demonstrates, mapped to the directive's required scenarios:

| Scenario | Covered | How |
|---|---|---|
| 2. User authenticates and submits a compute job | yes | nonce → wallet signature → JWT; `POST /v1/jobs` priced 1001 µCLD (base fee 1000 + ceil(n³·price)) and held |
| 3. Scheduler places it on an appropriate node | yes (one node) | heartbeat returns the σ-bound assignment after the draw |
| 4. Node executes and returns a result | yes | `solveAssignedJob` → `POST /v1/work/submit` |
| 5. Verifier rejects an invalid proof | yes | a tampered answer → 422 "Freivalds check failed"; job back in the queue; the node is charged a failure |
| 6. Ledger records charge and reward exactly once | yes | three fees captured once (`balanceUcld` 10,000,000 − 3,003; `heldUcld` 0); re-submit → 409; payout ledger pending A = sum of earnings |
| 7. Settlement completes and reconciles | off-chain part | epochs closed with the payout leaf and a treasury amount within the contract's bounds (A 2,847 + treasury 93 ≤ 98 % of 3,003; treasury ≥ 3 %); a wrong root → 409; posted + settled; public `GET /v1/epochs/{n}/jobs` fees add up to `feesBurned`. **No chain**: the keeper and contract were not exercised here (no RPC); their own suites were |
| 11. Unauthorized user cannot access another tenant's resources | yes | non-owner sees no result and an empty job list |
| 12. Malicious or stale node instruction rejected | partly | a replayed node request (same nonce) → 401; wrong bind code → 401. Instruction *signature* checks are in the agent selftest and `node-security.test.ts` (the e2e API had no signing key, which it reports) |
| 1. New provider installs, binds, becomes eligible | API half | announce (unbound) → bind with the printed code → eligible for the draw. The install/benchmark/hardening half is the agent's selftests; no real machine here |

Not exercised end to end here (infrastructure missing): 8 (real HTTPS address — needs the gateway domain and a node),
9 (provider disconnect during work — covered by unit tests `dead-node requeue`, `start timeout`), 10 (service restart
to durable state — agent `resume()` covered by the hosting selftest), 13 (healthy vs unhealthy — `probes: 3 failures →
unreachable` unit test), 14 (storage object survives node failure — phase 1 unit tests only; R2 is the durable copy),
15 (relay reconnect — relay selftests cover reconnect semantics without billing).

The Node runtime also answered `/health` (`sqlite: connected`), `/v1/network` and `/v1/doc` (200) after the legacy
removal, and its cron tick ran duties, the price controller (hold when idle) and the deposit watcher (inactive).

## 3. Security regression tests added in this pass

- `node-agent/src/sealed.selftest.ts`: v2 bound round trip; payload for deployment A refused under deployment B,
  without an aad, with a mangled aad; one flipped byte in the tag, ephemeral key, nonce, ciphertext and auth tag each
  refused; wrong key refused; v1 recognised, opens unbound, refused for a deployment; garbage refused (26 checks).
- `client/api/tests/deployments.test.ts`: `PATCH …/secrets` refuses v1 and malformed payloads with the reason; a
  deployment with secrets is not placed on an agent < 1.5.0 and is placed on ≥ 1.5.0; start timeout re-queues after
  10 min (static) / 60 min (container), skips the node, owes it a stop, fails after three nodes and frees the hold;
  rows waiting for sealed secrets are not counted.

## 4. Load, fault injection, container isolation, browser

Not run. No load test exists in the repository; the D1 cost model in `ENGINEERING_BASELINE.md` §8 is from code
reading. Fault injection is limited to the unit tests above (dead node, stuck start, probe failures, relay socket loss
in the relay selftests). Container isolation is asserted by the agent's security selftest against a fake Docker
(argument-level), not by running a container. The console was built but not opened in a browser in this pass.

## 5. How to reproduce

```bash
# suites
(cd client/api && npm ci --legacy-peer-deps && npm run type-check && npm test)
for p in gateway relay keeper; do (cd $p && npm ci && npx tsc --noEmit && npx vitest run); done
(cd node-agent && npm ci && npm run type-check && npm run selftest)
(cd contract && npm ci && npx hardhat test)
npm ci --legacy-peer-deps && npm run check && npm run test:client && npm run build

# end to end on the Node runtime
cd client/api
JWT_SECRET=$(head -c 48 /dev/urandom | base64) DEV_MODE=true CLUSTER_N_MIN=1 EPOCH_SECONDS=10 VEST_B_SECONDS=5 \
  INTERNAL_API_KEY=local-internal-key-0123456789 PORT=8790 CLOUDANA_DB_PATH=/tmp/cloudana-e2e.sqlite \
  node --import tsx src/index.ts &
sleep 8
API=http://127.0.0.1:8790 INTERNAL_API_KEY=local-internal-key-0123456789 EPOCH_SECONDS=10 npx tsx scripts/dev/e2e-v1.ts
```
