# Test evidence — 2026-10-19

Every number below was produced in this pass in a sandbox with Node 22.22 and npm 10.9, no Docker, no GPU, no
Cloudflare or chain credentials, and no outbound access to `cloudana.io`, `*.workers.dev` or
`binaries.soliditylang.org`. Where that limits what a test proves, it says so.

## 1. Package suites (after the changes in `PROGRESS.md`)

| Package | Command | Result | Notes |
|---|---|---|---|
| client/api | `npm run type-check` | clean | |
| client/api | `npm test` (vitest) | **40 files, 362 passed** | 330 at baseline; +4 in `deployments.test.ts` (sealed v2 refusal, agent gate for secrets, start timeout ×2), +5 `public-replay.test.ts` (draw replay, tampered record, signed epoch, signed network, 404s/no leakage), +1 `v1-submit.test.ts` (no reward without a captured fee), +2 `heartbeat-cost.test.ts` (statement budgets), +1 `v1-network-nodes.test.ts` (unbind), +7 `api-keys.test.ts`, +3 `auth.test.ts`, +1 `security.test.ts` (API keys, logout, rotation), +2 `node-state.test.ts`, +1 `node-security.test.ts` (node states; direct-mode host rule), +5 `deployment-logs.test.ts` (logs through the relay) |
| gateway | `npx tsc --noEmit && npx vitest run` | clean; **28 passed** | |
| relay | same | clean; **14 passed** | includes workerd e2e (`test/workerd.e2e.ts`) |
| keeper | same | clean; **28 passed** | tree vector fixture + run state machine |
| node-agent | `npm run type-check && npm run selftest` | clean; **9 selftests pass**: signing; sealed (26 checks); hosting; workstation (89); security (94); relay (69); relay e2e (27, real hub ↔ real agent ↔ real app, incl. logs via dep `agent`); ops (20); storage | 1.6.0 |
| contract | `npx hardhat test` | **224 passing** | compiled with solcjs 0.8.20 from npm through a Hardhat subtask override because the solc binary list is unreachable here; CI uses the normal download |
| repo root | `npm run check` (tsc) | clean | was 2 errors at baseline |
| repo root | `npm run test:client` | 3 passed | |
| repo root | `npm run build` (vite) | ok | `ConsoleApp` chunk 4.28 MB / 1.18 MB gzip (the legacy routes still ship) |

All of the above re-run after the dependency upgrade (hono 4.13.13, wrangler 4.151.1, ws 8.21, vite 7.3.7 —
`SECURITY_AUDIT.md` §3b) with the same results; the e2e below was re-run too (43 checks).

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

### 2b. Independent replay from public data

After the e2e, `client/api/scripts/verify/replay.ts --api http://127.0.0.1:7076 --job <id> --epoch <n>` against the
same runtime (started with an `INSTRUCTION_SIGNING_KEY`), using only `GET /v1/network`, `/v1/nodes/instruction-key`,
`/v1/draws/{id}`, `/v1/epochs/{n}` and `/v1/epochs/{n}/jobs`:

```
ok   network: signature verifies over the published body
ok   network: signed by the published instruction key 0x54cd…1916
ok   eligible set published
ok   drawSeed = sha256(seedSource ‖ jobId)
ok   eligibleHash = sha256 of the sorted "address:weight" list
ok   node = weighted draw of drawSeed over the eligible set
FAIL seedSource is the local fallback — the orchestrator could have chosen it   "local:1792382142955"
ok   record's own `replayable` flag agrees
ok   Merkle root recomputed from the leaves = 0x0a7f…047c
ok   lane totals equal the sum of the leaves
ok   treasury ≥ 3 % of fees · lane A + treasury ≤ 98 % of fees
ok   the public job list's fees (1001) add up to feesBurned
ok   per-provider lanes in the job list equal the leaves
ok   epoch: signature verifies over the published body · signed by the published instruction key
REPLAY FAILED (1 check)
```

The one failure is the honest one: this sandbox has no chain, so the seed is the flagged `local:` fallback and a third
party cannot check where it came from. In production `CHAIN_RPC_URL` (set in this pass) makes the seed a Base block
hash that anyone can confirm with `eth_getBlockByHash`; the script then passes fully.

## 3. Security regression tests added in this pass

- `node-agent/src/sealed.selftest.ts`: v2 bound round trip; payload for deployment A refused under deployment B,
  without an aad, with a mangled aad; one flipped byte in the tag, ephemeral key, nonce, ciphertext and auth tag each
  refused; wrong key refused; v1 recognised, opens unbound, refused for a deployment; garbage refused (26 checks).
- `client/api/tests/deployments.test.ts`: `PATCH …/secrets` refuses v1 and malformed payloads with the reason; a
  deployment with secrets is not placed on an agent < 1.5.0 and is placed on ≥ 1.5.0; start timeout re-queues after
  10 min (static) / 60 min (container), skips the node, owes it a stop, fails after three nodes and frees the hold;
  rows waiting for sealed secrets are not counted; `awaitingSecrets` is true through assignment, false once sealed,
  true again after a re-queue to another node.
- `client/api/tests/endpoints.test.ts` "seals secrets per replica, each to its own node's key": a 2-replica endpoint
  with `expectsSecrets` on two relay nodes; neither node is told to start until its replica is sealed; the detail
  carries each replica's own node key (two distinct keys) and the list carries none; sealing one replica starts only
  its node; another owner gets 404; the endpoint stops waiting once both are sealed (SECURITY_AUDIT F7).
- `client/api/tests/api-keys.test.ts`, `auth.test.ts`, `security.test.ts` (SECURITY_AUDIT F8): 18 route→scope
  cases; a `read` key reads jobs and the account but is refused on a job write with the missing scope named, and on
  keys, logout, payments, fleets and node routes with "wallet session"; a `jobs` key queues work for its owner and
  cannot read; revocation refuses the next request; expiry through the cache; garbage and flipped tokens; another
  account's revoke is 404; the 21st key is 409; logout ends a session and leaves the wallet's other sessions alone;
  tokens signed with `JWT_SECRET_PREVIOUS` verify, others do not.
- `client/api/tests/node-state.test.ts` (B-8): a drained node starts no new site and is skipped by the matmul draw
  while its running site stays; resume starts the waiting site and the draw finds it; strangers get 404, no session
  401; a suspended node's running site is re-queued with the reason, the node is told to stop it, its relay ticket is
  403, it leaves `nodesOnline`, its owner's drain/resume are 409; the admin lifts it and the ticket works again.
- `client/api/tests/node-security.test.ts` (O8 / B-13): outside DEV_MODE a hostname `publicHost` stores no host and
  strips hosting; a direct node reporting an endpoint on any host but its announced one is refused (three hosts).
- `client/api/tests/deployment-logs.test.ts` (B-14): the relay is asked as dep `agent` with the exact path and probe
  flag and the text comes back; tail bounds never reach the node; truncation flagged; owner-only, containers and
  replicas only (site 400, endpoint 400 pointing at replicas); failure tail after the node is gone, 409 when none;
  direct node 409, no relay 503, socket down / old agent / 404 / 502 / timeout each named; 21st request in a minute
  on one deployment → 429.

## 3b. Heartbeat D1 cost (backlog B-5), measured

`client/api/tests/heartbeat-cost.test.ts` wraps the test database in a counting proxy and pins the number of
statements one `POST /v1/nodes/heartbeat` executes. Measured in this pass, same test, before and after the change:

| Heartbeat | Before | After |
|---|---|---|
| idle bound node (nothing live, nothing queued) | 13 statements / 12 round trips | **5 / 4** |
| node with one running site, probe due | 15 / 14 | 10 / 9 |
| node with one running site, steady (probe not due) | 13 / 12 | **5 / 4** |

The remaining five: one node update (liveness + relay flag + version in one statement), one node read, one
"activity" statement that counts what there is to do, and the two-statement nonce batch (sweep + insert, one round
trip). At 1,000 nodes on 15 s beats that is ≈ 270 round trips/s instead of ≈ 800; the write path is still one D1.

## 4. Load, fault injection, container isolation, browser

Not run. No load test exists in the repository; the D1 cost model in `ENGINEERING_BASELINE.md` §8 is from code
reading, and the per-heartbeat count above is a unit measurement, not a load measurement. Fault injection is limited to the unit tests above (dead node, stuck start, probe failures, relay socket loss
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
