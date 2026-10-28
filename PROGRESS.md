# Progress — hardening pass, 2026-10-19

Branch `claude/trusting-maxwell-cfhscy`; entries 1–15 merged to `main` as PR #49 (`98de016`, 2026-10-19), entries 16–20
follow as a second PR on top of it (#52). Each change below lists the problem, root cause,
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

### 16 · independent review of the branch: 31 confirmed findings fixed
- **How.** Before the pull request was handed over, seven fresh reviewers (auth and keys; secrets and deployments;
  node states and logs; transparency and ledger; runtime and removals; docs versus code; console UI) read the whole
  diff; every finding was challenged by three separate verifiers (code trace, reproduction, blast radius) and kept
  only on a majority. 39 candidates, 31 confirmed; the 7 console-UI findings could not be verified (the org's spend
  limit stopped the verifiers) and were fixed on their merits.
- **High.** (1) A seal arriving after the start timeout was re-queued by the next cron before the node could start
  → the start clock now restarts at the seal. (2) A node that refused a container ("cannot serve", GPU) kept the
  payload sealed to its key on the re-queued row → cleared and flagged like every other re-queue. (3) An owner's
  drain/resume could overwrite a concurrent suspension → one conditional write. (4) `GET /v1/epochs/{n}` signed
  vetoed epochs with stale leaves → published epochs only. (5) The draw record was unsigned and its eligible set
  self-attested → signed over `{ draw }`, payout wallets replaced by an opaque operator id, the attestation limit
  stated in the route and in ARCHITECTURE (pull-based assignment, B-17, is the real fix). (6) The runbook told the
  operator to run the secrets script with no arguments, which then regenerated the pinned instruction key and the KEK →
  rewritten (and rewritten again in entry 20 once the owner's script skipped existing secrets: `--rotate NAME` is
  the only way to replace one). (7) A minted API key stayed on screen after sign-out → cleared on session change.
- **Medium.** `PATCH …/secrets` now names the node it was sealed to and is refused if the row moved; a container whose
  owner never seals is failed after `DEPLOY_SECRETS_TIMEOUT_SECONDS` (24 h) instead of pinning a slot for ever; a
  placement can no longer race a suspension (`claim()` checks node state in the same statement; a suspended node's
  heartbeat carries no start, no assignment, no storage fetch, and its relay socket is kicked); logs are read through
  the capped reader; `replay.ts` pins the signer (the agents' default, `--signer` to override) and checks the seed
  block with `--rpc`; `submitWork` is one transaction (fee authorised on the job row → captured → rewards → done,
  each statement conditioned on the previous, so a crash rolls everything back and the retry is clean); a job that
  failed for good keeps the drawn node on its public record; the relay-test row in TEST_EVIDENCE, the SHIP_CHECKLIST
  env names, ARCHITECTURE §6 were corrected.
- **Low.** API-key cache capped at the key's expiry; session revocation fails closed when a bound KV cannot be read
  and reports `revoked:false` when the shared list could not be written; sign-in nonces keyed per nonce (issuing one
  no longer cancels another); logs for workstations work when the node has a relay socket (the check is the socket,
  not the deployment's path); suspended nodes get no storage fetch ops and cannot download copies; `/v1/network`
  `burnedUcld` counts only fees that have reward entries (what the epochs burn); the public eligible set carries no
  payout wallets; `worker.ts` header, runbook image tag 1.6.0, CAPABILITY_MATRIX numbers, node-agent README signer
  note and the SECURITY_AUDIT ledger sentence corrected.
- **Also.** `storage.test.ts` "next day opens" depended on the wall clock (failed between 00:00 and 01:00 UTC);
  made clock-independent. `/control/legacy` hooks call API routes this branch deleted (they were Node-only and never
  deployed) — one more reason for decision 1.
- **Tests / results.** API 362 → **366** (late seal and secrets timeout, node-bound seal and refusal re-queue,
  signed draw without wallets, vetoed epoch 404, key cache expiry, per-nonce sign-in, logs over-cap 502); e2e 43
  checks on the transactional submit path; `replay.ts --signer published` passes on the local stack and the pinned
  mode refuses the local key as designed; console tsc, 3 tests, build; browser smoke re-run (§4b).
- **Residual.** The eligible set is still attested, not committed before the seed (B-17). Draining nodes finish
  what they hold; only suspension kicks the socket.
- **Addendum.** The six console findings left unverified here were verified once the spend limit reset: four upheld
  (already fixed in this commit), two refuted. With entries 18 and 19 the review's totals are 52 candidates, 47
  confirmed, 5 refuted.

### 17 · reconciliation with the owner's parallel review (PR #50)
The owner ran their own review in parallel, merged its fixes (`34b8af1`, `63037a4`) into this branch and then merged
the branch to `main` (PR #49) while entry 16 was being verified. The two sets overlapped on six files; the
reconciliation keeps, per overlap:
- `GET /v1/draws/{id}`: the signed record (16), and `replayable` stays true for a job that failed for good — this
  branch keeps the drawn node on failed rows (16), so the owner's "failed jobs lost their node" guard no longer applies.
- `setSealedEnv`: the node-bound seal (16) **and** the owner's start-clock restart (`assigned_at` reset on seal), with
  both comments.
- container logs: the 64 KiB cap with the "sent more than 65536 bytes" refusal (16) inside the owner's try/catch, so a
  node that breaks off mid-stream answers 502 "broke off" instead of throwing.
- `getEpochPayload`: closed/posted/settled only (16; a superset of the owner's vetoed exclusion).
- `/v1/network` `burnedUcld`: fees with a reward entry that is not clawed (16; the owner's version did not exclude
  clawed).
- `replay.ts`: pinned signer / `--signer published` (16) over the owner's "published key (could not be fetched)".
- `CAPABILITY_MATRIX`: this branch's assignment row, the owner's agent row (1.4.1 live at the time; 1.6.0 since 2026-10-20).
Everything else of the owner's landed as is: `JWT_SECRET_PREVIOUS_UNTIL` grace window, `/v1/network` rate limit,
`connect`/`endpoint` hidden from API-key callers, `capableWarning` on deployments, `chargeHour` stops when the capture
fails, cron `ensureSchema`, `set-api-secrets.mjs` never overwriting a secret without `--rotate`, the agent
re-announcing on `bound:false`, and the docs that record hosting, the gateway and the first public node as live since
2026-10-18.
- **Tests / results.** API tsc clean; vitest **368/368** (the owner's added cases included); console tsc, 3 tests,
  build; e2e 43 checks; `replay.ts --signer published` on a signed local stack passes every check but the expected
  "seedSource is the local fallback", the pinned mode refuses the local key; browser smoke 29/29 (§4b).

### 18 · the review's completeness round: five more findings fixed
The critic's four briefs (cross-area interactions nobody had traced) ran after the spend limit reset; 13 candidates,
5 confirmed by two or three verifiers each, 1 refuted, 7 still unverified (their verifiers hit the limit again; the
resumed run is verifying them). `SECURITY_AUDIT.md` F10 has the table.
- **High — workstation token leaked to API keys through `events`.** `forCaller` hid `connect`/`endpoint`, but the
  running report wrote `running at http://host:port/lab?token=…` and the ssh host:port into the event log, which the
  detail route returned unfiltered. Workstation events now name no address (`running (web ready · ssh ready)`),
  node-supplied text has credential-looking query values redacted, and a key's view drops any older event carrying
  the row's endpoint, ssh host, token or a token URL (`deployment-duties.service.ts`, `routes/v1/deployments.ts`).
- **Medium — a KV blip signed everyone out and wiped unsealed secrets.** Entry 16 made an unreadable revocation list
  mean "revoked" (401). The console treats any 401 as a lost session, and its sign-out cleared `cld.secrets.*`. Now
  an unreadable list answers **503** `service_unavailable` with `Retry-After: 5` ("the token was not refused"), and
  the console clears unsealed secrets only on a user sign-out or when another wallet signs in (`auth.ts`,
  `lib/http.ts`, `client/src/lib/cld.ts`).
- **Medium — `PATCH …/secrets` took workstations.** Guard was `kind !== 'container'`; workstations are stored as
  containers. A `deployments`-scoped key could inject env (`HASHED_PASSWORD`, `NOTEBOOK_ARGS`) into a workstation it
  may not connect to. Workstations now answer 400 (`deployments.service.ts`).
- **Medium — re-seal after the start went out answered 200.** An agent never re-reads `sealedEnv` for an id it is
  starting, so the "replacement" was announced and never applied. The UPDATE now requires `sealed_env IS NULL OR
  status = 'queued'`; otherwise 409 "stop and redeploy to change them".
- **Low — F9 claimed tests it did not have** for the KV-error branches: added (above).
- **Tests / results.** API tsc clean; vitest 368 → **372** (+2 `api-keys` KV read/write failures, +2 `workstations`
  events and workstation secrets; the `deployments` seal test now pins the 409); console tsc, 3 tests, build;
  browser smoke re-run (§4b).
- **Residual.** Seven critic-round findings (re-seal holding a node slot, unbound `PATCH` race, a failed endpoint
  replica never replaced, four billing races around `bill()`/`settleElapsed`/`settleHold`) await verification.

### 19 · the completeness round's last seven findings
Verified 3/3 each once the spend limit reset (52 candidates in all, 47 confirmed, 5 refuted). `SECURITY_AUDIT.md` F10
has the second table. Billing paths now claim exactly what they read:
- **High — stale probe snapshot settled the hour twice.** `requeueRows` guarded on status and node only, then
  `settleElapsed` captured from the caller's snapshot. A bill between the probe's read and its write charged the hour,
  and the re-queue charged it again (node-exploitable: fail your own probe around your bill). The re-queue statement
  now also claims the hold (`held_ucld → 0`) against the snapshot's amount and `last_billed_at`; a moved row is
  skipped. `settleElapsed` captures from the claimed amount and restores the hour only onto a live row.
- **Medium — `bill()` re-held onto a stopped row.** The re-hold lands only on a live row with nothing held; else the
  hour is released.
- **Medium — `settleHold` ignored the clock.** Its claim now covers `last_billed_at`; on a miss it re-reads and
  retries with the fresh amount and clock.
- **Medium — a replica failed by the secrets timeout was never replaced.** Replica rows are re-queued instead
  (`requeueRows`), keeping the hold; the endpoint keeps all its replicas.
- **Low — `node` optional on `PATCH …/secrets`; seals while queued.** `node` is required; a seal lands only while
  that node holds an `assigned` row with no payload, and only for containers created with `expectsSecrets`; while
  queued there is no key to seal to (409). The start clock therefore resets on the first seal only.
- **Low — "billed" written when nothing was captured.** `chargeHour` returns the capture; `bill()`,
  `settleElapsed` and `settleHold` write "hour … not charged … needs reconciliation" (warn) instead.
- **Tests / results.** `billing-races.test.ts` (3: stale-clock stop, stop mid-bill, uncharged hour; `hold` trapped
  to land a stop inside the bill), `endpoints.test.ts` (+2: nested heartbeat inside a probe answer, replica secrets
  timeout), `deployments.test.ts` seal test rewritten (queued → 409, `node` required, plain container → 400). Each
  new test was run against the pre-fix service code and failed there. API tsc clean; vitest 372 → **377**; e2e 43;
  replay; browser smoke 29/29.

### 20 · the owner's review of PR #52: five blockers and the rest
Four review comments from the owner's own session (secrets and placement, money, auth, draws and docs), 11:30 UTC.
Every item is either fixed here or answered on the thread. The blockers:
- **Money, high — two submits in the same millisecond captured the fee twice and wrote the rewards twice.** The
  capture and the reward inserts gated on `fee_captured_at = now` only; in Workers `Date.now()` is frozen between
  I/O events. Both now also require `status = 'assigned' AND node = ?` (`jobs.service.ts`, `ledger.service.ts`);
  test: two submits with one `now` → one capture, one set of rewards, 409.
- **Money, medium — a row could end up running with nothing held and never be billed again.** The out-of-credits
  ends in `settleElapsed` and `bill()` were conditional on a status another node's claim had already changed. They
  now re-read and end the fresh row; and `bill()` finding a due running row with nothing held holds the hour again
  or ends it (`billing-races.test.ts`, two cases).
- **Secrets, high — the deploy form never sent `expectsSecrets`.** It sends `Object.keys(secrets).length > 0`; the
  API honours an explicit `false` even for a template with `secretEnv`.
- **Auth, high — KV quota.** Session revocation and sign-in nonces moved from KV to D1 (`revoked_tokens`,
  `login_nonces`, one shared list read with the request's other D1 work); node-route rate limits count per isolate
  (`store: "memory"`), so heartbeats no longer spend KV writes; a key store that cannot be read is 503, not
  "revoked". The IP-keyed public limits stay in KV and degrade to memory when its quota is gone (follow-up B-25:
  the Workers rate-limiting binding the gateway already uses).
- **Docs, medium — the runbook's secrets section contradicted the script** (which skips existing secrets since #50):
  rewritten with the five secrets marked set, `--rotate NAME` and its cost, the real JWT rotation recipe, the table
  repaired; SHIP_CHECKLIST box ticked; PROGRESS blocker 2 and entry 16 (6) corrected.
The rest, also in this commit: workstations refuse `expectsSecrets`; the endpoint sealer forgets attempts for
replicas no longer sealable (a replica back on the same node is sealed again); a replica's secrets timeout re-queues
with the refusal prefix and the third cycle abandons the endpoint (holds back); the secrets-timeout end and re-queue
are guarded on `sealed_env IS NULL AND assigned_at = ?`; a drain hands back awaiting rows and the seal refuses a
non-active node; the Sealer stops polling and drops plaintext once sealing is over; `pendingSecretIds` removed; the
`schema.sql` comma; keys get neither a workstation's log tail nor its logs route; the events filter catches
`access_token=`, custom token names, URLs and ssh hosts by shape; `revoked:false` documented; failed rows without a
node are not replayable (and the verifier says so); `--signer` takes only an address or `published`; `--rpc` checks
the seed block's timestamp against `assignedAt` (`--seed-window`, 60 s); the operator id is a keyed hash; burned
hosting fees exclude clawed bills; stale facts in CAPABILITY_MATRIX, SECURITY_AUDIT O12 and PROGRESS corrected.
- **Not changed, by choice:** `MIN_AGENT_VERSION` stays 1.3.0 by default (raising it is the owner's config call now
  that the first node runs 1.6.0); the IP-keyed limits stay in KV until B-25.
- **Deploy note.** The revocation list starts empty in D1: a session logged out in the 24 h before this deploy (its
  jti sits in KV, which nothing reads any more) is accepted again until it expires. Tokens live 24 h, so the window
  closes by itself; deploy at a quiet hour if that matters. `ensureSchema` creates both tables on the first request
  and on the cron.
- **Tests / results.** 41 files, **387** passed (+10: same-millisecond submit, two billing races, replica timeout
  lifecycle, drain hand-back, explicit `expectsSecrets:false`, workstation flag refused, no workstation logs for
  keys, legacy failed draw, D1 revocation ×3 and nonces); each new test fails on the pre-fix code. Console tsc,
  3 tests, build; e2e 43; browser smoke 29/29.

### 21 · the review of entry 20's diff, after the owner's own re-review
An adversarial review of entry 20's diff (three area reviewers, three refuters per finding) confirmed five findings;
the owner's re-review of the same diff found and fixed three of them first (`5782629`: the `bill()` backstop could
strand an hour's hold on a stopped row when a concurrent heartbeat re-held it → both out-of-credits ends read the
row afresh; the third secrets cycle abandoned an endpoint without the "still unsealed" guard → the triggering
replica is ended under that guard first; the logout description promised a local refusal the D1 code no longer
performs → reworded) plus the unverified ones (secrets cycles counted apart from start timeouts in `seal_timeouts`,
10 s of seed-block skew in `replay.ts`, the KV namespace's real contents in the runbook). This entry adds the two
that remained:
- **Medium — a row waiting for its secrets on a draining or suspended node was unsealable for good.** The seal
  refuses a non-active node, but only the drain route's one-shot hand-back moved such rows; a hand-back that failed
  (D1 blip → the route answered 500 with the node already draining) or a drain from before it existed left the row
  parked until the secrets timeout failed it. `requeueStuckAssigned` (every cron tick) now hands back every
  `assigned` row with no payload whose node is not active — idempotent, same reason text as the route; a row whose
  start already went out stays (a draining node finishes what it holds). Test: state flipped without the route →
  queued on the next tick, sealed sibling untouched, second tick a no-op, suspended the same.
- **Low — the console's Sealer went dormant after a refused seal.** A 409 "moved to node X" stopped the polling
  while the tab still held the plaintext, so the next node was never sealed automatically. It now keeps polling
  after a refusal and tries once per node; it stops when the seal landed (here or in another tab:
  `awaitingSecrets` false while assigned) or the deployment left `queued`/`assigned`.
- The review's "PROGRESS totals do not add up" candidate was checked by hand: 39 + 13 candidates; 31 + 4 (console,
  upheld later) + 5 + 7 confirmed = 47; 2 + 2 + 1 refuted = 5. The addendum to entry 16 is where the four later-upheld
  console findings are counted.
- **Tests / results.** 43 files, **393** passed (the owner's three regression tests and the parked-row test; the
  latter fails on the pre-fix duties code). Console tsc, build; browser smoke 29/29.

### 22 · remove the legacy console `/control/legacy` (B-3, owner decision 2026-10-21: none survive)
- **Removed.** 92 files, 19,185 lines, every one reachable only through the legacy routes (import graph from
  `main.tsx` and the tests, before and after): 27 pages (10,660 lines; `pages/new-deployment/`, `pages/pricing/`, the
  provider, job, workload, user, docs, litepaper, decentralization and debug pages), 36 components (3,654;
  `components/layout/`, `providers/`, `payments/`, `onboarding/`, `LegacyShell`, 17 unused `ui/` primitives), 9 hooks
  and 17 lib helpers (several called API routes that no longer exist), 2 data files and `shared/contracts.ts` (the ABI
  and address JSON stay: contract scripts and the subgraph use them). `index.css` loses the legacy-only `.glass-card`
  and `appkit-button` styles.
- **Redirects.** `ConsoleApp.tsx`: `/legacy/*` and the older paths that led there land on their successor (mining →
  Earnings; provider, providers, register → Provide; pricing/gpus → Run) or the overview. `client/public/_redirects`:
  `/control/legacy/* /control 301`.
- **Results.** Repo-root `tsc` clean, client tests 3/3, build passes; the `ConsoleApp` chunk 4,296 → 1,765 kB
  (gzip 1,186 → 481 kB). The pricing calculator and the decentralization page return later as rewritten console pages.

### 23 · relay by default; direct nodes take workstations only (B-13, owner decision 2026-10-21)
- Agents already connect through the relay whenever the API runs one (`node-agent/src/relay.ts`: "legacy" mode only
  when the ticket route is not configured). What changed is placement: while the relay runs (the binding is
  installed and `RELAY_TICKET_SECRET` is set), a node that is not on it takes **GPU workstations only** — sites and
  containers are served through the relay (`deployment-duties.service.ts` `assign`). Workstations stay direct until
  the relay carries WebSockets. Without a relay (local stacks, the Node runtime) direct nodes serve everything, as
  before, so the e2e and browser runs are unchanged. Nothing already running moves.
- Tests: `relay-api` — with the relay, a direct node takes a queued workstation but not a site or a plain container
  (fails on the pre-change code); without it, the same node takes the site and the container. API 392 tests.

### 24 · fleet pinning (B-9, owner decision 2026-10-21)
- **Spec.** Containers, workstations and endpoints take `placement: { fleetId }`: only nodes of that fleet run them —
  the owner's own fleet or a partner's, chosen by the id the partner shares; never a single node. Create refuses an
  unknown or revoked fleet (400 `spec.placement.fleetId: no such fleet`, nothing held) and a pinned static site; the
  partner fleet's owner is never shown. Endpoint replicas inherit the pin from the endpoint's spec.
- **Placement.** One rule (`fleetAllows`) for heartbeat assignment and pre-emption (nothing outside the fleet is
  pre-empted for pinned work), and the claim statement checks the node's fleet again, so an eviction since the
  heartbeat's snapshot cannot be raced into a placement. While no online node of the fleet can run it, the create
  event reads `waiting for a node in fleet <name>`. Revoking a fleet fails what is pinned to it (no node can ever
  join it again) and releases the holds; the served part of the current hour is not charged, as for the unpinned
  deployments a revocation re-queues.
- **Shown.** Deployments carry `placement` and, once on a node, `nodeFleet: { id, name } | null` (replicas too). The
  console's deploy, workstation and endpoint forms have "Run only on a fleet" (your fleets, or a partner's id); the
  lists show `0x1234…abcd · fleet Acme (flt_…)` beside the node, in the sealing line and on every replica row.
- Tests: `fleet-pinning` (7; each fails on the pre-change code). API 400 tests; console tsc, client tests, build.
- **Review fixes (same PR).** A node that re-announces into another fleet of the same wallet hands back work pinned
  to its old fleet (it kept running there). A revoke that lands between a create's fleet check and its insert, or a
  revoke retried after dying half-way, no longer leaves pinned work queued with its hold: the create re-reads the
  fleet after the insert, and a repeated DELETE finishes failing pinned work. `nodeFleet.id` is shown only when the
  fleet is the caller's own or their pin (otherwise the name alone): a fleet's id is its owner's to share, and seen
  by every tenant whose work landed there it would let anyone pin to a one-node partner fleet — a single machine.
  Console: a chosen fleet that drops out of the list (revoked, wallet switched) is shown as unavailable and blocks
  submit instead of looking like "Any node" while still being sent; the sealing line takes the fleet from the seal
  itself (the list row lags); long fleet names are cut with the full label as tooltip. Tests 9 (the 3 new ones
  fail on the PR's first commit); API 402.

### 25 · sampled verification: Freivalds every job, transcript 1 in 10, pay held 24 h, claw on a failed check (B-6, owner decision 2026-10-21)
- **Sampling.** `submitWork` runs the cheap checks on every job (σ, n, r, A/B hashes, the C bound, Freivalds) and
  re-executes the transcript (`cupowVerify`) only when `sampledForCheck(jobId, σ)` draws it: the first 32 bits of
  HMAC-SHA256 over `jobId:σ`, keyed by `sha256("cloudana-sample:" + JWT_SECRET)`, are 0 mod `VERIFY_SAMPLE_K` (10;
  1 = every job). The node knows the job and σ but not the key; σ carries a fresh nonce, so a re-queued job is drawn
  again. Re-execution stays synchronous in the request (≈ 1.1 s CPU at n = 256, as every submit paid before). A passed
  sample is never disclosed to the node (`work_jobs.sample_check` = NULL | 'passed' | 'failed' | 'reversed' is internal).
- **Hold.** A job's A, treasury and B entries are booked into `b = epochOf(now + PAY_HOLD_SECONDS) + 1` (24 h), so the
  fee and the rewards stay in one epoch and `closeEpochs` needs no change. The claw reaches epochs after the open one,
  so the pay stays clawable until `b` opens (`heldUntil` = the start of `b`, always more than 24 h after submit) and
  closes at the end of `b` (25–26 h). Lane B vests from that epoch's end. `PAY_HOLD_SECONDS` = 0 restores the previous
  booking exactly; 0 < hold < `EPOCH_SECONDS` is refused at startup. Hosting bills are not held.
- **Claw.** A sampled job with a right answer (every cheap check passed) and a wrong transcript: the result is kept,
  the job marked done with `sample_check = 'failed'`, the fee captured, its treasury entry written pending and its A/B
  written clawed. In the same batch, before the "done" update and only while the job is still this node's assignment
  (a submit that lost a race changes nothing): the claw covers every A/B entry in an epoch after the open one that is
  paid to the node's payout wallet (any of its nodes, fleet-token nodes included) or was earned by the node's own jobs,
  plus the failing job's own A/B, recording the coverage in `reward_claws` (also for entries an earlier failed check
  already took), and claws the covered pending ones; `jobs_failed + 1` and the suspension ("sampled transcript check
  failed on job <id>") are written in the same batch, so no error afterwards can leave the node active and paid. Only
  the failing node is suspended; no `jobs_done` or throughput credit; the node gets 422. Afterwards, best effort: its
  deployments re-queued and its relay socket kicked; a fleet node's log line names the fleet and says "if this node is
  not yours, revoke the fleet's token and ask an admin to reverse the claw". Clawed jobs' fees still burn (treasury is
  never clawed). A wrong C or a bad header keeps the reject-and-requeue path.
- **Undo.** `POST /v1/admin/claws/{jobId}/reverse` (X-Internal-Key), one batch: entries the claw covers that no other
  claw covers and that are still in an epoch after the open one go back to pending; its claw rows are dropped; the job
  reads `sample_check = 'reversed'`. Pay another failed check still covers, pay of the open epoch or earlier, and pay
  clawed another way (an operator's claw after a veto has no claw row) stay clawed. Returns the count; a second call
  restores nothing. Lifting the suspension stays `DELETE /v1/admin/nodes/{address}/suspend`.
- **Keeper.** An epoch whose provider entries were all clawed closes with `leaves = []` and fees > 0; the keeper used to
  skip it ("no leaves"; `buildTree` throws on empty). It now posts it with the zero root the API computes
  (`epochRoot([])`), finalizes it (burn + treasury mint) and settles it with no claims. A vetoed all-clawed epoch would
  re-close identically forever, so it is skipped ("vetoed all-clawed epoch: the guardian's decision stands") instead of
  reported vetoed again each pass. The v2 contracts are unchanged. **Deploy the keeper before the API.**
- **Provider view.** `POST /v1/work/submit` returns `heldUntil`. `GET /v1/ledger/{address}` adds `held {A,B}` (pending
  A/B in an epoch after the open one: exactly what the claw can still take), `clawed {A,B}`, per-entry `releasesAt`
  and the settings `verifySampleK` and `payHoldSeconds`; `vesting.B` excludes held entries. Console Earnings: a "Held"
  tile (hidden with no hold), "In settlement" = pending − held − vesting, the caption worded from the two settings, the
  clawed amount when there is one, rows "held until …" in local time (said in the ledger header), tiles split 2 + 3
  with no orphan. Console docs, the services list, the FAQ, `ARCHITECTURE.md`, `SECURITY_AUDIT.md` §4, the litepaper
  (`docs/Cloudana_Litepaper.md`, `client/public/litepaper.html`) and the whitepaper no longer say every job is
  re-executed (minimal factual corrections only).
- **Schema.** `work_jobs.sample_check TEXT` (NULL | passed | failed | reversed); `idx_reward_entries_job`;
  `reward_claws (entry_id, job_id)` with `idx_reward_claws_job`. Env: `VERIFY_SAMPLE_K` (10), `PAY_HOLD_SECONDS`
  (86400). Ops: changing `EPOCH_SECONDS` now voids at least the last 24 h of every provider's pending pay
  (`DEPLOYMENT_RUNBOOK.md` §2).
- **Tests.** `sampled-verification.test.ts` (13): sampler 1/10 ± 0.3 % over 100k pairs, K = 1 samples all, the draw
  changes with σ and with the key; a planted wrong transcript (n = 8, K = 10) caught in each of 400 runs, mean jobs
  to detection in [8, 12] (≈ 10), ≥ 96 % within 44; K = 1 catches the first job; hold (booked into
  `epochOf(t + 24 h) + 1`, nothing closes before it ends, then it closes with its fee; a hosting bill is not held; a
  short hold is refused); a failed check 1 minute before the 24 h are over still claws; the ledger reports the
  settings; claw path (3 held + the failing job clawed, a released (posted) job and an open-epoch job untouched and
  not "held", treasury pending, node suspended, payloads within T·10⁴ ≥ F·300, (A+T)·10⁴ ≤ F·9800, B ≤ budget,
  `epochJobs` sums = payload, all-clawed epochs with the zero root, `/v1/network` deltas); wallet-wide claw (node 2
  on the same wallet loses its held A/B but stays active, node 3 on another wallet keeps everything).
  `sampled-claw.test.ts` (6): a D1 error after the batch still leaves the node suspended, counted and clawed; only the
  winning batch of two racing submits claws; a fleet node's claw is wallet-wide, its log line names the fleet, and the
  reverse restores it; the reverse route (internal key, held entries only, twice = no-op, `sample_check` 'reversed');
  two failed checks covering the same pay (reversing one restores nothing they share, reversing both restores all);
  pay clawed by an operator is never restored. `verify-cost.test.ts` measures CPU at n = 256: with the transcript
  ≈ 1.1 s, without ≈ 22 ms (≈ 50×), a whole unsampled `submitWork` ≈ 31 ms (≈ 35×); amortised at K = 10 ≈ 8.4×.
  Keeper (2): an all-clawed epoch is posted with the zero root, finalized and settled; a vetoed one is left alone.
  Existing ledger/replay tests that close a job's own epoch run with `PAY_HOLD_SECONDS = 0`. Every new test fails on
  the previous behaviour (checked by restoring it: 731fc63, or the single-`clawed_by` draft for the overlapping
  claws). API 423 tests, keeper 30.
- **Review of PR #58 (same PR).** Three reviewers, no contract-breaking defects; fixed: the hold window (pay used to
  stop being clawable when its epoch opened, as little as 0 s before the 24 h ended), "held" shown for open-epoch pay
  and hosting bills, the flag committed after the batch (a transient D1 error left the cheater active), a losing
  concurrent submit re-running the claw, no undo for false positives (and overlapping claws, hence `reward_claws`),
  the keeper's veto loop on an all-clawed epoch, hard-coded "1 in 10 / 24 h" in the console, clawed pay not shown,
  times not labelled, and the public pages that still said every job is re-executed. A fleet-only claw scope was
  tried and reverted: wallet-wide for every node is what stops an operator running a modified agent on many nodes,
  and the reverse route is the remedy for a leaked fleet token.

### 26 · the general verification interface, Phase 0: commit, challenge, answer; int8-mlp (B-26)
- **Interface.** `shared/verification.ts`, imported by the API and the agent: tensors (i8/i32, exact shape), a
  `tensorHash` that refuses malformed tensors (a wrapped encoding would let two tensors share a hash), `inputHash`, the
  chain root (`L0 = sha256("cldc1|"+σ+"|"+inHash)`, one link per segment over idx, kind, op, wiring and out-hash),
  `checkCommitment` (bind check) and the kind-generic `checkOpening`: every tensor must have the kernel's exact
  signature (from the job, never the node) and hash to the commitment; job inputs come from the job; gemm → rectangular
  Freivalds with every output entry within ±(p−1)/2 (so mod p is exact over ℤ) and operands of the plan's dimensions;
  elementwise → recompute and compare hashes; opaque → re-execution. `pouw` gains `freivaldsRect` in plain doubles
  (split multiply, no BigInt); the square `freivalds` is untouched.
- **matmul unchanged.** `WorkType` gains `mode` (inline | challenge), `minAgent` and the challenge hooks; matmul is
  inline. `submitWork` dispatches; the inline branch is the previous body with its settlement batch moved verbatim into
  `bookVerified`. A golden snapshot (`matmul-golden.test.ts`), recorded on unmodified main before the refactor and
  committed first, pins every response of `POST /v1/jobs` and `/v1/work/submit` (honest sampled and not, wrong C, C + p,
  bad σ with give-up at 3, A-hash mismatch, forged transcript unsampled and sampled) and the work_jobs, reward_entries,
  reward_claws, nodes and balances rows; it passes unchanged, as do the B-6 tests, unedited.
- **Commit, then challenge, then answer.** `POST /v1/work/submit` with `{ commitment, result }`: the bind check, else
  refused exactly like a matmul failure (422, re-queued, failed after 3, no claw). On pass one write stores the
  commitment, `cert_z` = chain root, the result, the draw, the deadline (`CHALLENGE_TTL_SECONDS`, 30) and the payout
  wallet (`commit_payout`), and only then is `{ challenge: { segments, deadline } }` returned. `segmentDraw` = partial
  Fisher–Yates over the HMAC (B-6's key, domain "seg:") of job, σ and chain root. Another commitment → 409: one commitment
  per assignment, so a node can neither see the draw before committing nor grind it. `POST /v1/work/answer` (≤ 1 MB):
  exactly the challenged openings before the deadline. Pass → `bookVerified` (`sample_check` 'passed', pay held 24 h, paid
  to the commit-time wallet). Wrong, mismatched, missing or late (`sweepChallenges` in both cron lists) → caught: B-6's
  `caughtStatements` (claw wallet-wide against the commit-time wallet, suspend — even if the node unbound or was unbound
  meanwhile) and the job failed last, then the owner's hold released; the result is dropped and the job not re-queued
  (owner decision for Phase 0). The job stays 'assigned' throughout, so every existing guard applies; assignment expiry
  and the heartbeat skip open challenges; the owner cannot unbind a node with an open challenge (409).
- **int8-mlp.** `shared/work-int8-mlp.ts`: one quantized MLP block with a residual on the user's weights, scales and
  optional activation table (b ≤ 64, d, h ∈ [8, 256]); 4 segments (xw1 gemm, rq1_lut, aw2 gemm, rq2_res), 2 opened per job
  (one wrong segment caught with p = ½), metered at 2·b·d·h MACs; inputs stay in D1 (`input_json`; moving them to the
  artifact store is a B-26 follow-up). `POST /v1/jobs` takes it as a discriminated-union variant (matmul's unchanged);
  the heartbeat assignment carries `input`; `GET /v1/jobs/{id}` returns Y. Drawn only among agents ≥ 1.7.0
  (`WorkType.minAgent`); `CURRENT_AGENT_VERSION` / `MIN_AGENT_VERSION` unchanged. Cost at the largest shape, best of 9:
  a gemm segment check ≈ 4–7 ms, the worst draw (both gemms) ≈ 8–15 ms, under the 50 ms budget, so the limits stay.
- **Agent 1.7.0.** `work.ts` (execute, commit, submit, answer from memory); `handleAssignment` hands int8-mlp to it,
  matmul lines untouched; advertises `int8-mlp` (an API that does not offer it drops it at announce, so 1.7.0 keeps
  working against the current production API). `int8-mlp.selftest.ts` pins the golden vector shared with the API test.
- **Security review (same PR).** Exact shapes on every segment check (a transposed or flattened gemm output passed the
  length check); the commit-time wallet snapshot and the unbind refusal (unbinding mid-challenge escaped the claw and
  the suspension); hono `bodyLimit` on submit (8 MB) and answer (1 MB) before the signature check and the parser, and
  tensor data capped at 64 × 256.
- **PR #60 review (same PR).** A lost response no longer gets an honest node clawed: the same commitment re-sent by
  the same node gets the stored challenge and deadline back (no new draw; any other commitment is still 409), and the
  agent re-sends a submit whose response was lost once and retries an answer on network errors and 5xx with backoff
  until the deadline. `sweepChallenges` reads only id, owner, price, node and commit-time wallet, isolates each job and
  waits a 10 s grace (the answer keeps the strict deadline). The commit write also requires the checked σ and an
  unexpired assignment (the same guard on matmul's batch is a backlog follow-up, so matmul stays byte-identical). A
  catch releases the owner's hold inside its batch. A body of the wrong kind is 400, not a failed check. The guard
  columns are read before the full row; `/v1/work/answer` is limited to 30 per node per minute. The int8-mlp input hash
  now covers `q` = [m1, s1, m2, s2] and the `lut`, and the agent deduplicates and caps the challenged indices. The docs
  say plainly that each job is checked on 2 of 4 segments: a node faking one is caught with probability ½ per job, held
  pay plus suspension is the deterrent, and a brand-new wallet risks only suspension (backlog: notify owners of jobs a
  later-caught node settled, or a minimum held stake).
- **Tests.** API 500 (new: `matmul-golden` 1, `verification-interface` 22, `int8-mlp` 8, `segment-verification` 30,
  `int8-mlp-gate` 6, `challenge-robustness` 9; each robustness test fails on the PR head before the review fixes): a lost
  submit response then a re-submit gets the same challenge and pays; answer POSTs failing with a network error and a 503
  are retried and pay; the sweep's grace and column list, a throwing job not stopping the batch; σ replaced or the
  assignment expired between check and write → 409, nothing stored; the hold released even when every write after the
  batch fails; wrong-kind bodies → 400 with no penalty; the 31st answer in a minute → 429; the input hash changes with
  each scale and the table. Rect Freivalds accepts A·B + bias and rejects one-entry flips (a +p shift is caught by the range
  bound); the chain root changes with σ, any out-hash, an op, a kind or the wiring; exact-shape refusals; the golden
  vector; intake bounds; honest job → done, paid, held 24 h, 'passed'; chain-link tamper (wrong root, swapped
  out-hashes, rewired plan, the node's own X, another σ, a result that is not the last segment) → refused, no claw;
  a planted wrong segment 0–3 → caught (claw wallet-wide, suspend, job failed, hold released); undrawn → passes; a
  given index opened at ½ ± 2 % over 10k draws; the 6 pairs uniform ± 0.5 % over 100k; opening mismatch and wrong
  indices → caught; late answer and sweep → caught; a different second commitment → 409; unbind mid-challenge → 409; payout cleared or
  moved mid-challenge → the commit-time wallet is clawed and the node suspended; 413 before parsing; the gate (1.6.0
  and unversioned never drawn; matmul unchanged). Keeper 30, agent selftests incl. int8-mlp, root check/test/build.
  `scripts/dev/e2e-v1.ts` passes against the local Node API (47 checks, and 43 on the re-run after the review fixes:
  the count varies with re-queued side jobs), and a real 1.7.0 agent ran an int8-mlp job end
  to end there (submit 200 → challenge, answer 200, result equal to a local execute, pay held).

### 27 · int8-model: L chained int8-mlp blocks through the general verifier (B-26 follow-up)
- **What.** `shared/work-int8-model.ts`: 1–16 int8-mlp blocks (block ℓ's Y is block ℓ+1's X), one b, d, h for all,
  each block with its own W1, b1, W2, b2, scales and optional table; the int8-mlp kernels unchanged. Plan 4·L segments
  (ops `xw1@ℓ` …, inputs `W1_ℓ` …), metered 2·b·d·h·L, `max(3, L)` segments opened (drawn uniformly over all 4·L, at most 16): one wrong
  segment is caught with p = max(3, L)/4L ≥ ¼ per job (¾ at L = 1); held pay plus suspension is the deterrent.
  `segmentDraw` allows up to 16 (draws over 8 read a second HMAC block; draws ≤ 8 are unchanged, int8-mlp stays at 2);
  the answer schema allows 16 openings and the answer cap is 1.5 MB (the largest answer, 16 rq2_res openings at their
  widest, is 1.23 MB). Worst answer check (16 gemm openings, b = 64, d = h = 64, best of 25): ~21 ms, under 50 ms.
- **Size.** d, h ≤ 64 for int8-model (not 256): at L = 16, d = h = 256 the weights are ~9 MB of JSON, over the 2 MB D1
  row; at 64 the worst-case input is 0.72 MB (test).
- **Agent 1.8.0.** `work.ts` takes the plan, inputs and executor from the work type (`CHALLENGE_TYPES`); advertises
  `int8-model`; the API draws int8-model only among agents ≥ 1.8.0. `CURRENT_AGENT_VERSION` / `MIN_AGENT_VERSION`
  unchanged; int8-mlp and matmul unchanged (golden snapshot passes).
- **Tests.** `int8-model.test.ts` 12 (incl. worst-case answer size and check time): L = 1 equals int8-mlp; chain wiring; registry, meter, samples; intake bounds;
  the largest-input size; honest L = 4 settles; a planted wrong segment in block 1 caught (claw of held pay, suspend,
  hold released); a middle index drawn at s/4L ± 1.5 % over 10k draws (L = 4, 16); a rewired chain refused, no claw;
  the 1.8.0 gate; `POST /v1/jobs` accepts it, 17 blocks → 400. Agent `int8-model.selftest.ts`.

### 28 · docs: verification tiers match the code (2026-10-26)
- **What.** Public and internal documents now use four tiers — proven · possession proven · probed · planned — and
  say what each checks, re-checked against `work-types.ts`, `env.ts`, `ledger.service.ts`, `storage.service.ts` and
  the v2 contract. Removed overclaims: "every job is proven/re-executed", "trust-minimized", a ban on failure (it is
  a claw and a suspension), settlement described as live (the v2 contract is not deployed), storage "not live yet",
  endpoints as if verified. Added int8-mlp / int8-model with their per-job detection rates. Copy strings only in
  the console and homepage; no logic change.

### 29 · Challenge-mode inputs in the artifact store; int8-model up to d, h = 256 (B-26 follow-up)
- **Storage.** At enqueue an int8-mlp / int8-model input is put to the artifact store (R2 `cloudana-artifacts`,
  key `jobs/<id>.input.json`); the row keeps `input_ref` and `input_hash` (sha256 of the JSON), `input_json` NULL.
  With no store (Node runtime, tests) the input stays in `input_json`, with its hash; rows from before keep working.
  Every read (heartbeat, commitment check, answer check, the fetch below) goes through `jobInputJson`, which checks the
  hash. A failed put or insert releases the hold. Inputs are not registered for provider copies (job data, not a
  finished artifact) and are kept after the job, like matmul's matrices.
- **Delivery.** Agents ≥ 1.9.0 get `inputHash` in the signed heartbeat assignment and no input; they fetch
  `GET /v1/work/jobs/{id}/input` (node-signed; only the node the job is assigned to, while assigned and unexpired,
  else 404; 30/min) and refuse a body that does not hash to `inputHash`. Older agents still get the input inline
  (read from the store). int8-model is drawn only among agents ≥ 1.9.0 (was 1.8.0): simpler than gating by size, which
  would need the job's h at draw time, and 1.8.0 shipped one PR ago. int8-mlp stays at ≥ 1.7.0, inline for 1.7/1.8.
  `CURRENT_AGENT_VERSION` / `MIN_AGENT_VERSION` unchanged; agent 1.9.0.
- **Limits, measured** (b = 64, worst draw = every opening a gemm, best of 25, this dev machine, run alone):

  | L·d·h | corner | input (widest JSON) | answer (widest) | check | with loading the input |
  |---|---|---|---|---|---|
  | 2¹⁶ (old max) | d = h = 64, L = 16 | 0.72 MB | 1.23 MB | ~11–16 ms | ~15–23 ms |
  | **2¹⁷ (new)** | 128, L = 8 / 256, L = 2 | 1.38 / 1.40 MB | 1.21 / 0.69 MB | ~12–15 ms | ~17–25 ms |
  | 3·2¹⁶ | 128, L = 12 / 256, L = 3 | 2.05 / 2.07 MB | 1.83 / 0.85 MB | — | ~21–37 ms |
  | 2¹⁸ | 128, L = 16 / 256, L = 4 | 2.72 / 2.73 MB | 2.45 / 1.16 MB | ~27–42 ms | ~28–51 ms |

  The binding limit is the 50 ms answer budget: its cost grows with s·d·h (s = max(3, L) openings) plus parsing the
  whole input, so it is capped as L·d·h ≤ 2¹⁷ with d, h ≤ 256 (int8-mlp's own bound, which also keeps every served
  tensor within the answer schema's 64 × 256 and the accumulator bound < 2²³) and L ≤ 16: d = h = 64 up to L = 16
  as before, 128 up to L = 8, 256 up to L = 2; at most 262,144 weights (2× before). 3·2¹⁶ fits run alone but leaves
  little margin for a Worker slower than this machine; 2¹⁸ does not. In a loaded suite (every core busy) the same
  check reads 2–3× higher; the test asserts the check alone, as before. Other limits are far off: the commitment check
  (hashing every input) ~12 ms at 2¹⁷; the answer cap stays 1.5 MB; the POST /v1/jobs body is ≤ ~1.4 MB for a valid
  job (zod's array caps bound an invalid one at ~10 MB; parsing 10.7 MB of JSON takes ~17 MB of heap and ~40 ms, well
  inside 128 MB and the Workers 100 MB request limit); node RAM is a few MB. At 2¹⁷ the input would still fit a D1 row
  (2 MB): the store matters for D1 size and reads (every `getWorkJob` is `SELECT *`) and keeps heartbeats small, and
  leaves room once the check gets cheaper (backlog B-26).
- **Tests.** `challenge-inputs.test.ts` 5: input in the store with only key + hash in D1 (int8-mlp and int8-model); no
  store → D1 with its hash; a failed put releases the hold; a 1.8.0 agent still gets int8-mlp inline (from the store);
  a d = h = 128, L = 8 job end to end over HTTP on the Node runtime (POST /v1/jobs, heartbeat carries only the hash,
  another node 404, unsigned 401, the assigned node's fetch hashes to it, submit → challenge, answer → done, result,
  404 after done). `int8-model.test.ts`: gate 1.9.0 (1.8.0 not drawn), bounds (d = 72 accepted, 264 and L·d·h > 2¹⁷
  refused), the two corners accepted, their worst answer under the answer cap and under 50 ms. All fail on origin/main.
  `segment-verification.test.ts`: the assignment's keys gain `inputHash`. Agent `int8-model.selftest.ts`: the fetched
  input is used, a tampered one refused, an inline one kept. matmul golden snapshot unchanged.

### 30 · PoUW simulation: testnet-in-a-box, honest load, adversary, two hours with faults (2026-10-27)
- **Why.** Owner: "the real edge was generating CLD from work, like Bitcoin mining for the internet … test if we are
  able to measure and verify." Plan `docs/POUW_SIMULATION_PLAN.md`, results `docs/POUW_SIMULATION_REPORT.md`.
- **What.** `scripts/sim/testnet/`: hardhat chain + the API's Node runtime + three real agents (1.9.0, CPU) + the
  production keeper's pass on a 10 s timer (`up.ts`/`down.ts`/`keeper-local.ts`), a fake user that deposits escrow and
  submits every work type (`user.ts`), an adversary node that speaks the real protocol and cheats one way per run
  (`adversary.ts`, 10 strategies), a guardian veto (`veto.ts`), phase runners, and `report.ts` (E1–E4 per shape,
  cluster gate, epoch rows API vs chain, supply invariant from token logs, provider wallets vs ledger). DEV_MODE-only
  `[work] verify …` timing lines in `jobs.service.ts`.
- **Results.** Phase 0 PASS (deposit → fee → verified job → minted lanes → root → claim, balances exact). Phase 1:
  400/400, verify 1.4–6.5 % of provider compute, 0 false rejects, every job pays 1,001 µCLD (metered part is 1 µCLD
  at the API's caps: work is verified, not priced by work), lane B on 20 % of jobs (cluster gate), draw weight is
  heartbeat noise. Phase 2: every wrong result refused at submit or clawed with the wallet's held pay, honest nodes
  never clawed, the persistent cheater netted 0; hit-and-run on the matmul transcript keeps pay with 0.9^N (43 % at
  N = 8). Phase 3: 840/840 over two hours, 62 epochs API = chain, supply Δ = minted − burned to the µCLD; guardian veto
  → re-close → corrected root → settled; keeper restart mid-epoch a no-op.
- **Open for the owner.** D1 protocol work for idle capacity, D2 ρ / cluster gate, D3 who verifies (keep it in the
  orchestrator), D4 matmul transcript sampling for new identities. Backlog: veto should park and alert, not loop;
  draw weight by compute time.
- **Not touched.** Production, Base Sepolia, the Azure node, secrets: everything ran on 127.0.0.1 with hardhat's test
  keys and seed-derived throwaways.

### 31 · PoUW decisions D1–D4 built and run (owner: "go with your recommendations", 2026-10-28)
- **D1 protocol work** (`PROTOCOL_WORK=on`, default off until the contract deploy): `issueProtocolWork` on the duties
  cron issues one matmul n = 64 per idle node while no user job is queued (owner `protocol`, price 0,
  `work_jobs.protocol = 1`; a job nobody took in 10 min is dropped). Verified, sampled and clawed like paid work. Its
  one lane-B entry carries the verified units (`reward_entries.units`, amount 0); at close `fitProtocolB` gives the
  epoch's protocol entries what is left of the budget after paid subsidies, pro rata by units, nothing unless
  `CLUSTER_N_MIN` wallets took part and no wallet above `CLUSTER_S_CAP`. No lane A, no treasury, nothing burned.
- **D2** the cluster gate counts every live node of the work type (busy ones too); the draw stays among idle ones.
- **D3** `epochs.vetoed_root`: a vetoed epoch is parked (one warning per pass) until a claw or reverse changes its root.
- **D4** `VERIFY_WARMUP_JOBS` (10): a node's first jobs have the transcript re-executed every time, then 1 in K.
- **Run** (`scripts/sim/testnet/phase4.sh`, report §Phase 4): 74 protocol jobs, 74 verified; zero-demand epochs minted
  exactly the budget to three wallets and settled on chain; the paid subsidy came first; a two-wallet epoch minted 0;
  the hit-and-run adversary was caught on job 1; chain = API, supply Δ = minted − burned. Also fixed: one bind code
  per fresh node when its first announces overlap (`announceNode`, found by the sim).
- **Docs** say what the code does (litepaper, whitepaper §6.2, README, POUW_REVIEW, V4_VERIFIED_SERVICES, console copy,
  runbook step 4). Tests: cluster-gate-live, protocol-work, warm-up in sampled-verification, parked close in
  epoch-veto; golden snapshot gains the two columns.
- **Backlog from the run:** startup check `EPOCH_SUBSIDY_BUDGET_UCLD` ≤ chain allowance; draw weight by compute time
  (the share cap on heartbeat-noise weights still withholds lane B on ~¼ of jobs); protocol issuance at heartbeat; the
  ledger summary should show protocol entries as a share, not 0.

### 32 · Draw weight by compute time; lane B capped at the chain allowance (2026-10-28)
- **Weight.** `work_jobs.delivered_at` (set by the heartbeat that hands the job over, cleared on re-assignment); the
  throughput sample is delivered → submit. On three identical agents the weights went from 0.09 / 0.25 / 0.66 to
  1.85 / 2.34 / 2.43 MMAC/s (`scripts/sim/testnet/weights.sh`). One sample is capped at `THROUGHPUT_SAMPLE_MAX_MMAC_S`
  (2e6): an operator queuing its own job knows the answer and could submit at once; the cap bounds that at a top
  machine's weight. Matrices are never served before delivery (owner-only, and only once done), so delivery is the
  first moment a node has the material.
- **Allowance.** `chain-allowance.service laneBBudget(epoch)` = min(env budget, contract `allowance(epoch)`) at close
  (chain read only with `SETTLEMENT_ADDRESS` + `CHAIN_RPC_URL`; a failed read logs the short error, not the URL, and
  keeps the env budget). Tests: throughput-weight (3), lane-b-allowance (2).
- **Ledger.** `GET /v1/ledger/{address}` gains `protocolPending` and `protocol` per entry; the earnings page says
  "N protocol jobs await the epoch close" and shows "share at close" instead of 0.00 for them.

### 33 · Public rate limits in the Workers rate-limiting binding (B-25, 2026-10-28)
- `rate-limit.ts`: a shared bucket whose (limit, window) has a binding named `RL_<limit>_<period>` (wrangler.toml
  `[[unsafe.bindings]]`, seven of them for the 60 s buckets; registered per request by `setRateLimiters`) counts
  there, keyed by bucket and IP, with no KV operation; the binding reports pass/fail only, so those responses carry
  X-RateLimit-Limit but no Remaining. A failing binding, an unmatched (limit, window) and the two hourly buckets
  (keys-create, fleets-create: the binding period is 10 or 60 s) keep the KV counter, which still degrades to memory.
  Node routes and polled reads were per isolate already. Tests: rate-limit (2 new).
- **Deployed** 2026-10-28: API version fa080615 at 100 % (preview smoke-tested: health, /v1/network with the binding's
  Limit header and no Remaining, cron trigger redeployed). The console is not republished (the earnings copy of entry 32
  waits for the owner's "publish").

### 34 · CLI, first cut: `cloudana deploy ./dist` (B-22, 2026-10-28)
- `cli/` (no runtime dependencies, node ≥ 20): `login --key` (stores the developer key in `~/.cloudana/config.json`,
  0600, or `CLOUDANA_API_KEY`), `deploy <dir> [--name] [--no-wait]` (every file of the folder as a StaticSpec, index.html
  required, 2 MB cap, waits for `running` and prints the `cloudana.run` URL), `list`, `get <id>` (with the last events
  and the failure log tail), `stop <id>`. Exit codes 0 / 1 (API or folder refused) / 2 (usage). Responses are
  hand-typed for these five calls; generating them from `GET /v1/doc` waits until the surface grows. Tests: the
  folder reader (3) and the commands against a stub API (3: what is sent, printed, exit codes). CI job `cli`.

## Evidence summary

| Suite | Baseline | Now |
|---|---|---|
| client/api vitest | 330 | **423** |
| gateway / relay / keeper | 28 / 14 / 28 | 28 / 14 / **30** |
| node-agent selftests | 8 pass | **9 pass** (sealed 26 checks; relay e2e 27; ops 20) |
| contracts | 224 (offline solc) | 224 |
| repo-root tsc | 2 errors | **clean** |
| e2e work pipeline | script did not run | **43 checks pass** |
| console in a browser (local stack) | not opened | **29 checks pass** (headless Chromium, two fake nodes) |

## The ten gaps, where they stand

| # | Gap | State |
|---|---|---|
| 1 | No live settlement | **Owner** (runbook 3–6). Engineering side ready: contracts tested, keeper tested, deposit watcher inactive until `SETTLEMENT_ADDRESS`. |
| 2 | Nothing publicly reachable | **Closed 2026-10-18.** Relay secrets set, gateway live at `https://<id>.cloudana.run`, first node (Azure, relay; agent 1.4.1 then, 1.6.0 since 2026-10-20) online; hosting is live. |
| 3 | D1 heartbeat cost | Measured and cut 13 → 5 statements per idle/steady beat (commit 10, pinned by a test); the architecture limit (one D1) remains. |
| 4 | Orchestrator not independently checkable | Largely closed for phase 1: draws published with their eligible set (`GET /v1/draws/{id}`), epochs published with leaves and a signature (`GET /v1/epochs/{n}`), `/v1/network` signed, `scripts/verify/replay.ts` checks all of it from public data; seeds are block hashes once `CHAIN_RPC_URL` deploys. Left: signing individual draws, pull-based assignment (B-17). |
| 5 | Verification cost = work cost | **Closed 2026-10-21** (entry 25, B-6): Freivalds on every job, the transcript re-executed on a random 1 in 10 (submit-path CPU ≈ 50× lower at n = 256), pay held 24 h and clawed on a failed check. |
| 6 | Auth without revocation/scopes | Closed for the API (commit 12): scoped API keys, logout revocation, secret rotation; a refresh-token flow is a product choice left open. |
| 7 | No fleet/GPU node | A first public node is live (Azure VM, compute + hosting + storage over the relay, no GPU). A container/GPU fleet node is still the owner's (runbook 10). |
| 8 | Legacy UI reachable | **Closed 2026-10-21** (entry 22): `/control/legacy` removed, old paths redirect to `/control`. |
| 9 | Rogue API can choose the node for secrets | Mitigated (secrets bound to deployment, key verified, now per replica from the console; endpoint env no longer sent in the clear); fleet pinning (B-9) done 2026-10-21 (entry 24). |
| 10 | Docs drift | README, API README, checklist domain, decisions header, archive README fixed; capability registry created; verification tiers aligned with code 2026-10-26 (entry 28). |

## Blockers that need the owner (exactly what is required)

1. **Contracts v2 on Base Sepolia** — Safe 2-of-3, Deployer and Poster wallets with test ETH, run
   `contract/scripts/v2/deploy.ts` (runbook step 4). Then engineering wires `SETTLEMENT_ADDRESS` into the API and
   keeper and runs the veto drill.
2. ~~Worker secrets~~ — **done 2026-10-18**: `INSTRUCTION_SIGNING_KEY`, `JWT_SECRET`, `STORAGE_KEK` on cloudana-api;
   `RELAY_TICKET_SECRET` on api + relay; `INTERNAL_API_KEY` on api + gateway. `scripts/set-api-secrets.mjs` skips a
   secret that is already set; `--rotate NAME` is the only way to replace one, and a new signing key cuts off every
   pinned node, a new JWT secret signs everyone out, a new KEK makes stored copies unverifiable (DEPLOYMENT_RUNBOOK
   §1). `scripts/set-relay-secrets.mjs` (owner only) replaces both relay secrets on every run, with a brief
   relay/hosting outage; run it once the keeper is deployed, to give the keeper `INTERNAL_API_KEY`.
3. ~~User-content domain~~ — **done 2026-10-18**: `cloudana.run`, proxied wildcard record, gateway deployed.
4. ~~First node~~ — **done 2026-10-18**: Azure VM (compute, hosting and storage over the relay). Still to come: a
   Docker ≥ 28 / xfs-pquota machine for containers and GPU work.
5. **Decisions** — `/control/legacy` survivors; fleet pinning semantics; retire direct-node mode; weekly vs per-epoch
   lane-B pool (before the contract deploy).

## Next priorities (engineering, no owner input needed)

B-15 custom domains (needs the owner's Cloudflare for SaaS setup) → B-5 follow-up (liveness off D1, 30 s beats) once
a real load test exists → wallet-stack and Hardhat-toolchain majors (SECURITY_AUDIT §3b).

## Not done, and why

- No production verification: the sandbox cannot reach `cloudana.io`, the Workers or the chain. Every "verified"
  in these documents is code + tests + the local runtime.
- No load test, no container escape test. The browser pass covers the console's main flows on the local stack
  (sites, containers with secrets, keys, nodes) but not endpoints, workstations or a wallet extension
  (`TEST_EVIDENCE.md` §4, §4b).
- No pull request opened: not requested.
