# Progress — hardening pass, 2026-10-19

Branch `claude/trusting-maxwell-cfhscy` on top of `main` `4bef305`. Each change below lists the problem, root cause,
files, justification, tests, actual results, remaining risk and deployment implications. Nothing was deployed; no
contract, fund or production secret was touched.

## Commits

### 1 · `6ceffa1` docs: engineering baseline
`ENGINEERING_BASELINE.md`: what runs where (verified from entry points and configs), the build/test baseline of
every package, environment limits, the reachability inventory (10,500 dead API lines, 8,400 dead console lines),
the open security findings and the documentation drift. No code change.

### 2 · `622f3c7` security: bind sealed secrets to their deployment; console verifies the node key
- **Problem / root cause.** `shared/sealed.ts` had no associated data, so a sealed blob could be moved between
  deployments on a node by whoever writes `deployments.sealed_env`; the console sealed to the public key the API
  returned without checking it belonged to the assigned node.
- **Files.** `shared/sealed.ts`, `node-agent/src/deployments.ts`, `node-agent/src/sealed.selftest.ts`,
  `node-agent/package.json` (1.5.0), `node-agent/README.md`, `client/src/pages/console/deploy/deployments.tsx`,
  `client/api/src/services/deployments.service.ts`, `client/api/src/services/deployment-duties.service.ts`,
  `client/api/tests/deployments.test.ts`, `client/api/tests/endpoints.test.ts`, `docs/V3_CONTRACT.md`.
- **Why this shape.** AEAD associated data is the standard way to bind ciphertext to context; a version byte keeps v1
  recognisable so the failure is explicit; the API gate (v2 only, agents ≥ 1.5.0 for secret-bearing deployments)
  turns a silent runtime failure into a placement rule, without cutting older agents off from compute and hosting.
- **Tests / results.** Agent sealed selftest 26 checks; API 334/334 (4 new); console tsc clean.
- **Remaining risk.** A rogue API can still choose the node (`SECURITY_AUDIT.md` O2); endpoint replicas are not yet
  sealed per replica from the console (B-12).
- **Deployment.** API deploy; agent 1.5.0 image (CI on merge); console deploy. Order does not matter: old consoles
  get a 400 with the reason; old agents simply are not given secret-bearing deployments.

### 3 · `f8e0d1d` reliability: take back deployments a live node never starts
- **Problem / root cause.** Only silent nodes triggered a re-queue; a heartbeating node that never reported
  `running`/`failed` held the deployment and the owner's hold indefinitely.
- **Files.** `client/api/src/config/env.ts` (`DEPLOY_START_TIMEOUT_SECONDS` 3600, `…_STATIC_SECONDS` 600,
  `DEPLOY_START_ATTEMPTS` 3), `client/api/src/lib/schema.ts` + `schema.sql` (`deployments.start_attempts`),
  `deployments.service.ts`, `deployment-duties.service.ts` (G4 `requeueStuckAssigned`), `tests/deployments.test.ts`.
- **Why this shape.** Reuses the existing re-queue path (node marked as refusing, stop owed, secrets cleared) and the
  existing `endDeployment` for the terminal case, so billing semantics stay the ones already tested.
- **Tests / results.** Two new cases; API 334/334. The e2e later confirmed holds and captures reconcile.
- **Remaining risk.** Timeouts are global, not per image size; a legitimately slow 40-minute pull on a static-timeout
  misconfiguration would be re-queued — defaults are generous for that reason.
- **Deployment.** Additive column via `ensureSchema()`; no data migration.

### 4 · `61daf87` chore: CI for every package, replayable draw seed, hygiene
`.github/workflows/ci.yml` (api, gateway, relay, keeper, contracts, console with a localhost-in-bundle guard);
`client/api/wrangler.toml` `CHAIN_RPC_URL` (draw seeds become block hashes); `relay/.wrangler` untracked and
ignored; login errors in the envelope; homepage counter labelled "CLD earned · awaiting on-chain settlement" until an
epoch has settled; the two legacy tsc errors fixed. Deployment: API var change takes effect on the next deploy; the
cron's assignment adds one 2 s-timeout RPC call per run when jobs are queued.

### 5 · `491f5a1` cleanup: remove the undeployed Akash/k3s orchestrator and legacy infrastructure
- **Problem.** 41 files / 10,500 lines reachable only from a Node entry nothing deployed, pulling Akash, k3s, ssh2,
  js-yaml and multiformats into the dependency tree, plus a Kubernetes provider node, k8s manifests, game manifests
  and Docker/PM2 files for that stack.
- **Files.** See the commit; `client/api/src/index.ts` is now a minimal Node runtime (same app + same cron duties on
  a timer); `env.ts`, `contracts.ts`, `security.ts`, `package.json`, `.env.example`, `client/api/README.md`
  rewritten; superseded design docs moved to `docs/archive/` with a README.
- **Justification.** Measured reachability, not opinion (`ENGINEERING_BASELINE.md` §5); git history keeps the code;
  the Node runtime stays as the path for local development and for an independent operator.
- **Results.** client/api tsc clean, 334/334; Node runtime boots and answers `/health`, `/v1/network`, `/v1/doc`;
  234 npm packages fewer; root tsc clean; vite build ok.
- **Deployment.** None (the Worker never shipped this code). The `cloudana-orchestrator` GHCR image stops being built.

### 6 · `2830737` cleanup(console): remove unreachable pages and orphaned components; hosting is early access
68 files with no route or importer; `client/src/lib/services.ts` hosting status aligned with `CAPABILITY_MATRIX.md`
("early", content-hash probe through the relay). `/control/legacy` untouched pending the owner's decision (B-3).
Results: root tsc clean, build ok. Deployment: Pages deploy.

### 7 · `3d9864d` docs: README for the shipped system, security audit, working end-to-end script
`README.md` rewritten; `SECURITY_AUDIT.md`; `client/api/scripts/dev/e2e-v1.ts` repaired (it could not run against the
current API) and extended. Result: **E2E PASSED (43 checks)** on the Node runtime (`TEST_EVIDENCE.md` §2).

### 8 · (this commit) deliverables and drift fixes
`ENGINEERING_BACKLOG.md`, `CAPABILITY_MATRIX.md`, `ARCHITECTURE.md`, `TEST_EVIDENCE.md`, `DEPLOYMENT_RUNBOOK.md`,
this file; `docs/SHIP_CHECKLIST.md` domain, `docs/DECISIONS_CONSENSUS.md` header, the agent DaemonSet tag (1.5.0),
the `CURRENT_AGENT_VERSION` comment.

### 9 · publish and sign what the orchestrator decides; no reward without a captured fee (B-2, B-11)
- **Problem.** Draw seeds, eligible sets and epoch leaves were stored but not published; `/v1/network` was unsigned;
  a verified job whose fee capture failed still earned rewards (mint without burn).
- **Files.** `client/api/src/services/jobs.service.ts` (`eligible_json` stored at assignment, `getDrawRecord`,
  `replayDraw`, capture-then-reward), `services/public-signing.service.ts` (new: `cloudana-public-v1` domain,
  `signPublic`/`verifyPublic`), `services/ledger.service.ts` (`getEpochPayload`), `routes/v1/jobs.ts`
  (`GET /v1/draws/{id}`, public), `routes/v1/ledger.ts` (`GET /v1/epochs/{id}`, signed), `routes/v1/network.ts`
  (signed), `middleware/security.ts` (rate limit), `lib/schema.ts` + `schema.sql` (`work_jobs.eligible_json`),
  `scripts/verify/replay.ts` (new), `tests/public-replay.test.ts` (new, 5 cases), `tests/v1-submit.test.ts` (+1).
- **Why this shape.** Reuses the instruction key (already pinned by every agent and published at
  `/v1/nodes/instruction-key`) under a separate signing domain, so no new key or trust anchor; the draw record carries
  the eligible set itself, not only its hash, because a hash cannot be replayed; σ is published only once the job is
  done. The ledger change makes "no mint without a burned fee" an invariant of the code rather than of the call order.
- **Tests / results.** API 340/340 (36 files). Replay script against the Node runtime: every check passes except
  the one that must fail without a chain — the seed is the flagged `local:` fallback, which the script reports as
  "the orchestrator could have chosen it". With `CHAIN_RPC_URL` deployed (commit 4) the seed is a Base block hash.
- **Remaining risk.** The orchestrator still chooses *when* to draw (which block hash); individual draw records are
  not signed (the epoch and network payloads are); the keeper's rebuilt root, not the published one, is what reaches
  the chain — they are the same leaves, and the keeper refuses a mismatch.
- **Deployment.** Additive column via `ensureSchema()`; two new public routes rate-limited at 60/min per IP; API deploy.

### 10 · heartbeat cost measured and cut (B-5); home-node unbind (B-10)
- **Measured first.** `tests/heartbeat-cost.test.ts` counts D1 statements per heartbeat through a proxy: idle 13 / 12
  round trips, busy 15 / 14 (TEST_EVIDENCE.md §3b).
- **Change.** `touchNode` writes liveness, the relay flag and the agent version in one statement; the heartbeat
  passes its node row into the duties instead of re-reading it; a single `nodeActivity` statement counts what there is
  to do (live rows, workstations, billable hours, due probes, queued sites/containers, owed stops, stale stops, unexpired
  matmul assignments) and the auto-stop / assign / probe / bill scans and the instruction and assignment reads run
  only when it says so. After: idle **5 / 4**, steady busy **5 / 4**, probing beat 10 / 9. The budgets are pinned in
  the test; raising them is a deliberate act.
- **Unbind.** `DELETE /v1/nodes/mine/{address}` (JWT): clears payout/fleet/binding, re-queues the node's live
  deployments, 404 for anyone else's node; earnings stay with the wallet; the next announce issues a fresh bind code.
- **Tests / results.** API 343/343 (+1 unbind, +2 cost); behaviour suites unchanged.
- **Residual.** Still one D1 for everything; the nonce batch is two statements by design (sweep + atomic insert).
  Next step for scale is a KV/DO-backed liveness store and 30 s beats (owner decision on the agent cadence).

### 11 · endpoint secrets sealed per replica from the console (B-12); dependency upgrade
- **Finding (SECURITY_AUDIT F7).** The endpoint form showed environment values as password fields and sent them in
  the clear (`spec.env`): stored in D1, carried in the start instruction. Only plain containers had a seal path, and
  the console could not seal endpoints at all (the API requires per-replica sealing; the console only sealed parent
  rows), so an endpoint with secrets could never start from the console.
- **API.** Every deployment carries `awaitingSecrets` (endpoints: while any replica waits); each replica carries
  `awaitingSecrets` and, in `GET /deployments/{id}` once a node with a key holds it, `nodePubkey`. One extra column
  on an existing statement; the heartbeat budgets are unchanged.
- **Console.** Endpoint environment values are secrets: the form sends `expectsSecrets` and keeps the values in
  `sessionStorage`; a sealer per endpoint polls the detail and seals each replica to its own node's key (the key must
  derive to the assigned node's address), clears the plaintext once every replica is sealed, shows per-replica state.
  Deploy and Endpoints tabs show "needs secrets" from the API's flag, never from tab memory, with a re-enter form
  (new tab, or a container/replica re-queued to another node — the API clears the old payload). Shared code:
  `client/src/pages/console/deploy/secrets.tsx`.
- **Dependencies.** `npm audit fix` (semver-compatible only) in client/api, gateway, keeper, console root: hono
  4.11.5 → 4.13.13, @hono/node-server 1.19.17, ws 8.21, wrangler 4.151.1, vite 7.3.7. Before/after per package and
  what remains: SECURITY_AUDIT §3b. hono 4.13's stricter types surfaced an untyped `requireAuth` (fixed).
- **Tests / results.** API 343/343 (the endpoint secrets test now runs two replicas on two nodes with distinct
  keys, checks list vs detail exposure and a cross-owner 404; container tests assert the flag through assignment,
  sealing and re-queue); gateway 28, keeper 28; console tsc, 3 tests, build clean; e2e re-run on the new hono: 43
  checks.
- **Residual.** Container sealing was later exercised in a browser (commit 15); the endpoint replica panel was
  not. Re-entry needs a human: an endpoint whose replica moves while no tab is open
  waits, visibly, until the owner returns; a server-side re-encryption would defeat the design (B-9 fleet pinning
  and B-24 confidential tier are the real answers).

### 12 · developer API keys, session logout, secret rotation (B-7)
- **Gap 6.** A session token was the whole account for 24 h with nothing to revoke it, and programs had no credential
  of their own.
- **API.** `cld_sk_…` keys: `POST /v1/keys` (name, scopes `read`/`jobs`/`deployments`, optional expiry; ≤ 20 live;
  token shown once, sha256 stored), `GET /v1/keys`, `DELETE /v1/keys/{id}`. `requireAuth` accepts a key wherever it
  accepts a session and maps the request to the scope it needs (`scopeFor`: GET → read, `/v1/jobs` writes → jobs,
  `/v1/deployments` and `/v1/ipfs` writes → deployments); keys, sessions, payments, credits, fleets and node routes
  are wallet-only (403 with the reason). Lookups are cached 30 s per isolate (`API_KEY_CACHE_SECONDS`), `lastUsedAt`
  written at most once a minute. Session tokens carry a `jti`; `POST /v1/auth/logout` revokes (KV list for the
  remaining life; memory when KV is unbound). `JWT_SECRET_PREVIOUS` rotates the secret without signing anyone out;
  `JWT_TTL_SECONDS` sets the lifetime. The OpenAPI security scheme describes both credentials.
- **Console.** Docs → API: keys panel (create with scopes, copy once, list with last use, revoke); sign-out calls
  logout.
- **Tests / results.** API 343 → **354** (`api-keys.test.ts`: 18 route→scope cases, mint/list/hash/limit, per-scope
  allow and deny route by route, revoke/expire/garbage, 20-key cap, logout; `auth.test.ts`: jti, revocation,
  rotation, key without storage → 401; `security.test.ts`: gates). Console tsc, 3 tests and build clean.
- **Residual.** No refresh token: the session is 24 h by configuration, now revocable. No per-key rate limit or
  audit trail beyond `lastUsedAt`. Browser-tested in commit 15 (mint, use within scope, refuse, revoke).

### 13 · node state model and draining (B-8); direct-mode host rule verified and pinned (B-13)
- **States.** `nodes.state` = `active` (default) · `draining` (owner: no new jobs, deployments or storage copies;
  what runs keeps running and billing) · `suspended` (Cloudana: live deployments re-queued now with the reason, the
  node is owed a stop for each, no relay ticket, no work; heartbeats still answer so it learns to stop; the owner
  cannot lift it). `degraded`/`unreachable` stay derived from probes and `last_seen`, not stored.
- **API.** `POST`/`DELETE /v1/nodes/mine/{address}/drain` (session; 404 for others' nodes, 409 while suspended);
  `POST`/`DELETE /v1/admin/nodes/{address}/suspend` (internal key, reason required); `GET /v1/nodes/mine` carries
  `state` and `stateReason`; the matmul draw, heartbeat assignment, pre-emption candidates and storage copy
  placement require `state = 'active'`; `/v1/network.nodesOnline` excludes suspended nodes.
- **Console.** Provide → node card: state pill, Drain / Resume, Unbind (confirm dialog).
- **B-13.** Read the direct-mode path end to end: outside DEV_MODE a public host is stored only when it equals the
  IP the announce came from (an IP literal the API observed; private ranges refused by `endpointAllowed`), and a
  status report may name endpoints only on that host. The API therefore never resolves a hostname for a direct node
  and there is nothing to rebind. Pinned by two tests in `node-security.test.ts` (a hostname announce stores no
  host and no hosting capability; endpoints on any other host → 400). SECURITY_AUDIT O8 closed by construction;
  retiring direct mode remains the owner's decision.
- **Tests / results.** API 354 → **357** (`node-state.test.ts` ×2, `node-security.test.ts` +1); console tsc, 3
  tests, build clean.
- **Residual.** Matmul assignments on a node being suspended expire by `ASSIGNMENT_TTL_SECONDS` rather than being
  clawed at once. No audit log of state changes beyond `state_at`/`state_reason`. Drain/resume browser-tested in
  commit 15.

### 14 · container logs through the relay (B-14); agent 1.6.0
- **Why.** Images users bring cannot be debugged without their output; until now a container's logs existed only in a
  `failed` report.
- **Agent 1.6.0.** `src/ops.ts`: a loopback-only server the relay client forwards the reserved dep `agent` to (the
  way `storage` already works); `GET /logs/<id>?tail=N` answers from `docker logs` for deployments this agent runs
  (or is starting), 404 otherwise, ≤ 64 KiB, nothing stored. `dockerLogs` takes a tail and a cap. 20-check ops
  selftest; the relay e2e selftest now carries a logs case (27 checks).
- **API.** `GET /v1/deployments/{id}/logs?tail=1…1000` (owner; containers, workstations, replicas by id; endpoints
  point at their replicas): live through the relay with `x-relay-probe: 1`; a deployment no longer on a node answers
  the failure tail it kept or 409; direct nodes 409; no relay 503; socket down / old agent / node errors 502 with
  the reason; 20/min per deployment on top of the per-IP read bucket.
- **Console.** Logs panel in the container detail and under each endpoint replica (fetch on demand, refresh, source
  and truncation shown).
- **Tests / results.** API 357 → **362** (`deployment-logs.test.ts` ×5); agent type-check clean, ops selftest
  20/20, relay e2e 27 checks; console tsc, 3 tests, build clean.
- **Residual.** No streaming (`follow`); the agent must be upgraded to 1.6.0 on the node for live logs (older agents
  answer `not_serving`, which the API names). The panel's direct-node message is browser-tested (commit 15); the
  live path needs a relay node.

### 15 · the console in a real browser against the local stack
- **Why.** Every console change in this pass carried "not browser-tested". Chromium and a burner-signer build exist
  here, so the claim could be replaced by evidence.
- **What.** `client/api/scripts/dev/fake-node.ts` (a node without Docker: announces, binds by link or fleet token,
  heartbeats, serves static files, stubs containers, opens sealed secrets with its key and checks they are bound to
  the deployment) and `scripts/dev/browser-smoke.ts` (starts the API and the console preview, two fake nodes, then
  drives headless Chromium: sign in, credits, bind by the printed link, fleet join by token, static site from pasted
  HTML served and content-probed, PostgreSQL container with a secret sealed in the browser and opened by the node
  for that deployment only, the logs panel's direct-node message, API key mint/use/revoke from Docs, drain/resume
  from Provide, sign-out revoking the token at the API).
- **Result.** **29/29 checks** (`TEST_EVIDENCE.md` §4b), zero uncaught page errors. Nothing in the product needed
  fixing to pass; two script assumptions did.
- **Residual.** Endpoints, workstations, the relay logs path and a real wallet extension are not covered. The run is
  not in CI (it needs a browser and ~3 minutes); the command is in `TEST_EVIDENCE.md` §5.

## Evidence summary

| Suite | Baseline | Now |
|---|---|---|
| client/api vitest | 330 | **362** |
| gateway / relay / keeper | 28 / 14 / 28 | 28 / 14 / 28 |
| node-agent selftests | 8 pass | **9 pass** (sealed 26 checks; relay e2e 27; ops 20) |
| contracts | 224 (offline solc) | 224 |
| repo-root tsc | 2 errors | **clean** |
| e2e work pipeline | script did not run | **43 checks pass** |
| console in a browser (local stack) | not opened | **29 checks pass** (headless Chromium, two fake nodes) |

## The ten gaps, where they stand

| # | Gap | State |
|---|---|---|
| 1 | No live settlement | **Owner** (runbook 3–6). Engineering side ready: contracts tested, keeper tested, deposit watcher inactive until `SETTLEMENT_ADDRESS`. |
| 2 | Nothing publicly reachable | **Owner** (runbook 8–10). Gateway/relay tested; hosting labelled early access until then. |
| 3 | D1 heartbeat cost | Measured and cut 13 → 5 statements per idle/steady beat (commit 10, pinned by a test); the architecture limit (one D1) remains. |
| 4 | Orchestrator not independently checkable | Largely closed for phase 1: draws published with their eligible set (`GET /v1/draws/{id}`), epochs published with leaves and a signature (`GET /v1/epochs/{n}`), `/v1/network` signed, `scripts/verify/replay.ts` checks all of it from public data; seeds are block hashes once `CHAIN_RPC_URL` deploys. Left: signing individual draws, pull-based assignment (B-17). |
| 5 | Verification cost = work cost | Open (B-6). |
| 6 | Auth without revocation/scopes | Closed for the API (commit 12): scoped API keys, logout revocation, secret rotation; a refresh-token flow is a product choice left open. |
| 7 | No fleet/GPU node | **Owner** (runbook 10). |
| 8 | Legacy UI reachable | Reduced (68 orphan files gone); `/control/legacy` needs the owner's call (B-3). |
| 9 | Rogue API can choose the node for secrets | Mitigated (secrets bound to deployment, key verified, now per replica from the console; endpoint env no longer sent in the clear); fleet pinning is B-9. |
| 10 | Docs drift | README, API README, checklist domain, decisions header, archive README fixed; capability registry created. |

## Blockers that need the owner (exactly what is required)

1. **Contracts v2 on Base Sepolia** — Safe 2-of-3, Deployer and Poster wallets with test ETH, run
   `contract/scripts/v2/deploy.ts` (runbook step 4). Then engineering wires `SETTLEMENT_ADDRESS` into the API and
   keeper and runs the veto drill.
2. **Worker secrets** — `node scripts/set-api-secrets.mjs` (done for the instruction key per the agent's pinned
   address; `STORAGE_KEK` status unknown from here) and `node scripts/set-relay-secrets.mjs` (`RELAY_TICKET_SECRET`,
   `INTERNAL_API_KEY` on api/relay/gateway). Without the relay secret no node is reachable.
3. **User-content domain** — `cloudana.run` with the proxied wildcard record, then the gateway deploy.
4. **First node** — the owner's workstation (compute + hosting), later a Docker ≥ 28 / xfs-pquota machine for
   containers and GPU work.
5. **Decisions** — `/control/legacy` survivors; fleet pinning semantics; retire direct-node mode; weekly vs per-epoch
   lane-B pool (before the contract deploy).

## Next priorities (engineering, no owner input needed)

B-15 custom domains (needs the owner's Cloudflare for SaaS setup) → B-6 verification cost (Freivalds-only with
sampled re-execution) → B-5 follow-up (liveness off D1, 30 s beats) once a real load test exists → wallet-stack and
Hardhat-toolchain majors (SECURITY_AUDIT §3b).

## Not done, and why

- No production verification: the sandbox cannot reach `cloudana.io`, the Workers or the chain. Every "verified"
  in these documents is code + tests + the local runtime.
- No load test, no container escape test. The browser pass covers the console's main flows on the local stack
  (sites, containers with secrets, keys, nodes) but not endpoints, workstations or a wallet extension
  (`TEST_EVIDENCE.md` §4, §4b).
- `/control/legacy` (19 k lines) left in place: removing it changes what users can reach, which the owner asked to
  decide (`tasks/lessons.md` 2026-09-28).
- No pull request opened: not requested.
