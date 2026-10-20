# Security audit — 2026-10-19

Scope: the code at `main` (`4bef305`) and the fixes made in this pass (commit hashes below). Method: read every
trust boundary in the shipped paths (browser → API, API → node, node → API, gateway/relay → node, keeper → API →
chain), re-check each finding of the October review panel (`docs/REVIEW_PANEL_2026-10.md` C.5) against the code,
and prove each still-open finding with a test before patching it. The live system could not be reached from this
environment (`ENGINEERING_BASELINE.md` §3), so every "verified" below means verified in code and in the package's
own tests, not against production.

Threat model (unchanged from `docs/DECISIONS_CONSENSUS.md`): malicious tenants, malicious providers, Sybil providers,
a compromised API Worker or D1, a MITM on the API, and (for the contracts) a malicious or compromised poster.

Severity: **Critical** = fleet-wide code execution, unbounded mint or theft of another tenant's secrets; **High** =
money or data loss for one party, or a check that can be dodged for profit; **Medium** = bounded abuse, DoS,
information leak; **Low** = hygiene, defence in depth.

## 1. Findings fixed in this pass

### F1 — Sealed secrets were not bound to their deployment — High — FIXED (`622f3c7`)

**Where.** `shared/sealed.ts` (format v1), `node-agent/src/deployments.ts` `openSealed`.
**Problem.** The browser sealed a container's secrets to the node's public key with no associated data. The ciphertext
sat in `deployments.sealed_env` and was forwarded verbatim in heartbeat instructions. Anyone able to write that column
(a compromised Worker or D1, or the operator of a rogue orchestrator a node is pointed at) could copy deployment X's
blob onto deployment Y on the same node; the node opened it and injected X's secrets into Y's container. The heartbeat
signature does not help: the API is the signer.
**Proof.** `node-agent/src/sealed.selftest.ts` "payload sealed for deployment A opened under deployment B" fails on
the old format (the test was written against the new one and the old `open` has no aad to check).
**Fix.** Format v2: `0x02 ‖ ephPub ‖ nonce ‖ ct`, with `cloudana-deployment:<id>` as XChaCha20-Poly1305 associated
data and in the HKDF info. The agent (1.5.0) opens secrets only under the aad of the deployment it is starting and
refuses v1 payloads with a clear message. The API accepts only v2 payloads on `PATCH /deployments/{id}/secrets` and
places deployments that carry secrets only on agents ≥ 1.5.0 (`SEALED_V2_MIN_AGENT`, assignment and preemption).
**Tests.** Agent sealed selftest, 26 checks (cross-deployment, unbound, tampered byte in every region, wrong key, v1
refused, garbage refused). API: `deployments.test.ts` "refuses a legacy (v1) or malformed sealedEnv", "a container
with secrets waits for an agent that opens bound secrets". Suite 334/334.
**Residual.** A compromised API can still *withhold* or *delay* secrets, and still sees which deployment carries
secrets (not their content). Endpoint replicas: the console does not yet seal per replica (backlog B-12), so GPU
endpoints with secrets cannot start from the console today; the API path is correct.

### F2 — The console sealed to whatever key the API returned — High — FIXED (`622f3c7`)

**Where.** `client/src/pages/console/deploy/deployments.tsx` `sealNow`.
**Problem.** `GET /deployments/{id}` returns `nodePubkey`; the console sealed to it without checking that it derives
to the assigned node's address. A compromised or spoofed API could return its own key and read every tenant secret.
The API does check `pubkeyMatchesAddress` at announce, but that protects the API's own table, not the browser.
**Fix.** The console computes `publicKeyToAddress(nodePubkey)` and refuses to seal unless it equals the deployment's
`node`. The node address is what the owner can see and what the API would also have to lie about consistently; it is
the same identity that signs the node's requests.
**Residual.** The API still chooses the node. A rogue API can assign the deployment to a node it controls; the owner
sees the node address before secrets are sealed (the "Seal secrets now" path) but automatic sealing seals to whichever
node is assigned. Mitigation for sensitive workloads: fleet pinning (backlog B-9) or confidential compute (planned).

### F3 — No timeout on `assigned` deployments — High (reliability, billing) — FIXED (`f8e0d1d`)

**Where.** `client/api/src/services/deployment-duties.service.ts`.
**Problem.** A node that kept heartbeating but never reported `running`/`failed` held the deployment and the owner's
first-hour hold indefinitely. Only a *silent* node (G1) triggered a re-queue. A wedged agent or an endless image pull
stranded the workload and the money; the owner's only recourse was to stop it.
**Fix.** Cron duty G4 `requeueStuckAssigned`: after `DEPLOY_START_TIMEOUT_SECONDS` (3600; static sites 600) the
deployment goes back to the queue with the node marked as having refused it and owed a stop; after
`DEPLOY_START_ATTEMPTS` (3) timeouts it fails and the hold is released. Rows waiting for the owner's secrets are not
counted. New column `start_attempts`.
**Tests.** `deployments.test.ts` "start timeout" (two cases: three timeouts → failed, hold back; secrets-waiting rows
and the container timeout).

### F4 — Assignment seeds were not replayable in production — Medium (transparency) — FIXED (`61daf87`, commit 9)

The Worker had no `CHAIN_RPC_URL`, so `fetchSeedSource` fell back to `local:<ms>` and no third party could replay a
draw from `seed_source` + job id, contradicting roadmap phase 1. `wrangler.toml` now sets the public Base Sepolia RPC,
and commit 9 publishes the draw record with its eligible set (`GET /v1/draws/{id}`), the epoch payload with its
leaves (`GET /v1/epochs/{n}`, signed) and signs `/v1/network`; `scripts/verify/replay.ts` checks all of it from
public data. Residual: the orchestrator still *chooses when* to run the draw (and thus which block hash); replay
proves the draw was honest given the seed, not that the seed was not selected. Pull-based assignment (roadmap phase
2, B-17) closes that.

### F5 — Local Wrangler state committed — Low — FIXED (`61daf87`)

`relay/.wrangler/state/**` (Miniflare SQLite, including a Durable Object store) was tracked. Removed and ignored. No
secret was found in it, but local state must never be reviewable or deployable by accident.

### F6 — Login errors outside the envelope — Low — FIXED (`61daf87`)

`/v1/auth/login` returned `{ status:"error", message }` instead of `{ status:"error", error:{ code, message } }`.
Clients branching on `error.code` would treat an auth failure as a parse failure.

### F7 — Endpoint environment values were sent and stored in the clear — Medium — FIXED (commit 11)

The endpoint form (`client/src/pages/console/endpoints/form.tsx`) rendered every environment value as a password field
(the default row is `HF_TOKEN`) and then sent them in `spec.env`, in the clear, where they sat in D1 (`spec_json`),
in backups, and rode to the node inside the start instruction. The provider sees them either way (it runs the
container); the exposure fixed here is the control plane: anyone with D1 access (dashboard, `wrangler d1`, a backup)
read every tenant's tokens. Only plain containers had a seal path, and the console could not use it for endpoints
at all: the API requires sealing per replica (each to its own node's key) and the console only sealed parent rows,
so an endpoint with secrets could never start from the console.

Fix: the form sends `expectsSecrets` and keeps the values in `sessionStorage`; the API reports per replica
`awaitingSecrets` and, in the detail view once a node with a key holds the replica, `nodePubkey`; a sealer per
endpoint seals to each replica's node (after checking that the key derives to the assigned node's address), and the
plaintext is cleared when every replica is sealed. Re-queued replicas and containers show "needs secrets" from the
API's `awaitingSecrets`, never from the tab's memory, with a re-enter form. Tests: `endpoints.test.ts` "seals secrets
per replica, each to its own node's key" (two nodes, two keys, list vs detail exposure, cross-owner 404),
`deployments.test.ts` (flag through assignment, sealing and re-queue).

### F8 — Sessions could not be revoked; programs had no credential but the wallet's own token — High — FIXED (commit 12)

Open finding O3. A session token was a 24 h HS256 JWT with nothing to revoke it: a leaked token was the account for
a day, and rotating `JWT_SECRET` signed everyone out. Scripts, CI and SDKs had no credential but that same token.

Fix (`middleware/auth.ts`, `services/api-keys.service.ts`, `routes/v1/keys.ts`): session tokens carry a `jti`;
`POST /v1/auth/logout` puts it on a KV revocation list for the token's remaining life and every later use is refused
(the console calls it on sign-out; in memory when KV is unbound). Verification accepts `JWT_SECRET` and
`JWT_SECRET_PREVIOUS`, so a rotation no longer signs everyone out: set the old secret as previous, the new one as
current, drop the previous after `JWT_TTL_SECONDS`. Developer API keys `cld_sk_…` are minted by the wallet session
(`POST /v1/keys`), shown once, stored as sha256, scoped (`read`, `jobs`, `deployments`), optionally expiring, revoked
by `DELETE /v1/keys/{id}` (at once in the isolate that revoked, within `API_KEY_CACHE_SECONDS` = 30 s elsewhere). A
key never reaches key management, sessions, payments, credits, fleets or node routes (`scopeFor`, tested route by
route). Not built: a short-lived access token with refresh — with revocation in place the 24 h lifetime is a product
choice (`JWT_TTL_SECONDS`), not a hole; no `kid` header either, verification simply tries both secrets.

Tests: `api-keys.test.ts` (18 route→scope cases; mint/list/hash; per-scope allow and deny on real routes; revoke,
expiry, garbage, cross-owner 404; the 20-key cap; logout), `auth.test.ts` (jti, revocation, rotation, a key against
an app without storage → 401), `security.test.ts` (gates).

### F9 — Findings of the independent review of this branch — FIXED (commit 16)

Seven fresh reviewers read the whole diff before the pull request was handed over, each finding challenged by three
verifiers. The security-relevant ones, all fixed with tests (`PROGRESS.md` commit 16 has the full list):

| Severity | Finding | Fix |
|---|---|---|
| High | A node that refused a container kept the payload sealed to its key on the re-queued row; the next node failed to open it and the deployment died | cleared and flagged like every other re-queue |
| High | An owner's drain/resume could overwrite a concurrent suspension | one conditional write guarded on state |
| High | Vetoed epochs were published and signed with stale leaves | published epochs only (closed, posted, settled) |
| High | The draw record was unsigned and its eligible set self-attested; it also listed every eligible node's payout wallet | signed over `{ draw }`; wallets replaced by an opaque operator id (a keyed hash since entry 20 — the epoch leaves name payout wallets, so an unkeyed hash was mappable); the limit (attested, not pre-committed) stated in the API and ARCHITECTURE — pull-based assignment (B-17) is the real fix |
| High | The runbook's secrets table had the operator regenerate the pinned instruction key and the storage KEK | rewritten; and again in entry 20 after the owner's script started skipping existing secrets (#50): all five are set, `--rotate NAME` is the only way to replace one, and what each replacement costs |
| Medium | `PATCH …/secrets` accepted a payload for whichever node now held the row | the console names the node it sealed to; refused once the row moved |
| Medium | A placement could race a suspension; a suspended node still got storage fetches and kept its relay socket | `claim()` checks node state in the same statement; suspended heartbeats carry no start/assignment/fetch; socket kicked |
| Medium | `submitWork` did done → capture → rewards in three round trips; a failure between them stranded a hold or captured a fee with no rewards | one transaction, each statement conditioned on the previous |
| Medium | `replay.ts` trusted the signer address the server being checked published | pinned signer (the agents' default); `--signer published` is explicit and labelled not a proof |
| Medium | Logs answer read unbounded before the cap | capped reader; over-cap is 502 |
| Low | API-key cache could outlive the key's expiry; session revocation failed open on KV errors; anyone could cancel a wallet's pending sign-in nonce | cache capped at expiry; a bound KV that cannot be read refuses the request (first as 401, since F10 as 503 "not refused, retry"); nonces keyed per nonce |

### F10 — Findings of the review's completeness round — FIXED (commit 18)

A critic read the seven reviewers' coverage and sent four finders after the cross-area interactions nobody had
traced; each finding again challenged by three verifiers. Fixed with tests (`workstations.test.ts`, `api-keys.test.ts`,
`deployments.test.ts`):

| Severity | Finding | Fix |
|---|---|---|
| High | `forCaller` hid a workstation's `connect`/`endpoint` from API keys, but the node's running report wrote the full web URL (Jupyter token included) and the SSH host:port into the event log, which `GET /v1/deployments/{id}` returns unfiltered: a `read`-scoped key recovered exactly what was hidden | workstation events name no address ("running (web ready · ssh ready)"); node-supplied text has credential-looking query values redacted; events written before the fix are filtered out of a key's view when they carry the row's endpoint, ssh host, token or a token URL |
| Medium | A bound KV whose read failed made `isRevoked` answer "revoked": one KV blip signed every console out at once (401), and the console's sign-out wiped the plaintext secrets the owner had typed but not sealed | an unreadable revocation list answers **503** with `Retry-After` and "the token was not refused"; the console wipes unsealed secrets only on a user sign-out or a wallet switch, never on a lost session |
| Medium | `PATCH …/secrets` accepted workstations (stored as kind `container`): a `deployments`-scoped key, forbidden to connect to the owner's workstation, could inject environment into it before it started (`HASHED_PASSWORD`, `NOTEBOOK_ARGS`) | workstations take no sealed env (400): the node issues the access token and nothing else is injected |
| Medium | A re-seal while `assigned` with a payload answered 200 and logged "sealed secrets updated" although the start had already gone out and an agent never re-reads `sealedEnv`: the container ran the old secrets while every view said the new ones applied | once a start may have gone out the payload cannot be replaced (409 "stop and redeploy"); replacement stays allowed while queued |
| Low | F9 said the fail-closed revocation change was "fixed with tests"; no test exercised a KV error | two tests: a KV that cannot be read → 503 for a session, 200 for an API key; a KV that cannot be written → logout says `revoked:false` |

The round's remaining seven findings were verified once the spend limit reset (commit 19; tests `billing-races.test.ts`,
`endpoints.test.ts`, `deployments.test.ts`):

| Severity | Finding | Fix |
|---|---|---|
| High | A probe pass that read its rows before a bill ran re-queued the replica from that stale snapshot and settled "the elapsed hour" again: the owner paid twice for one hour and the provider was paid twice (a node can time a slow probe answer around its own bill) | the statement that re-queues a row also claims the hold it settles, against the snapshot's amount **and** billing clock; a row whose hold or clock moved since is skipped and re-read next pass |
| Medium | `bill()` re-held the next hour with an unconditional `UPDATE`: a stop landing between its claim and its re-hold found nothing to settle, and a full hour stayed held on a stopped row for ever | the re-hold lands only on a live row with nothing held; otherwise the hour goes back to the owner |
| Medium | `settleHold` claimed on the amount only: after a bill re-held the same amount, a stop carrying the older snapshot charged a full hour for the seconds since the bill | the claim covers the billing clock too; on a miss the fresh amount and clock are read and the settle retried |
| Medium | An endpoint replica whose secrets were never sealed was failed for good by the 24 h timeout; nothing replaces a failed replica, so the endpoint ran short one replica while priced for all | a replica goes back to the queue instead (slot freed, hold kept); plain containers still fail |
| Medium | A re-seal after the start went out answered 200 (see above) | fixed in commit 18 |
| Low | Every accepted seal reset the start clock, so repeated seals could hold a node slot for ever | the clock resets on the first seal only: a payload lands once (commit 18) |
| Low | The node binding of `PATCH …/secrets` was optional, so a client not sending `node` kept the moved-row race; a seal while queued was stored for whichever node came next | `node` is required; a seal lands only while that node holds the row and only for a container created with `expectsSecrets` (its start otherwise goes out without a payload on the first heartbeat) |
| Low | `bill()` wrote "billed … for one hour" even when nothing was captured (hold missing) and no bill or reward existed | `chargeHour` reports the capture; every caller writes "hour … not charged … needs reconciliation" instead, and the test forces the state |

### F11 — The owner's review of PR #52 — FIXED (commit 20)

Four reviews from the owner's own session (`PROGRESS.md` entry 20 has every item). The security-relevant ones:

| Severity | Finding | Fix |
|---|---|---|
| High | Two submits in the same millisecond (Workers freeze `Date.now()` between I/O events) captured the fee twice and wrote the rewards twice: the capture and the reward inserts gated on `fee_captured_at = now` only | both also require `status = 'assigned' AND node = ?`; test with one `now` |
| High | Session revocation and sign-in nonces in KV: a day of console polls and heartbeats exhausted the free tier's reads (every session 503 until midnight) and writes (every sign-in 401) | both in D1 (`revoked_tokens`, `login_nonces`); node-route limits count per isolate; a failing key store is 503, not "revoked" |
| Medium | A row left running with nothing held was never billed again | the out-of-credits end follows the row; a due running row with nothing held is held again or ended |
| Medium | A workstation spec took `expectsSecrets: true`, which can never be sealed: the start waited a day and failed | refused at `checkSpec` |
| Low | A `read` key could fetch a workstation's failure log tail and its logs route; the events filter missed `access_token=`, custom token names and old addresses | no log tail or logs route for keys on workstations; the filter matches by shape |
| Low | The operator id was an unsalted hash of a wallet the epoch leaves publish | keyed hash (key derived from `INSTRUCTION_SIGNING_KEY`). Limit: it hides the wallet only of operators never drawn into a paid job — `/v1/epochs/{n}/jobs` names each job's payout wallet, so a join maps every operator that has won one |
| Medium (docs) | The runbook's secrets section contradicted `set-api-secrets.mjs` and could have had the owner cut off the live node | rewritten; checklist box ticked |
| Medium | (re-review of this round) the `bill()` backstop could strand an hour's hold on a stopped row when a concurrent heartbeat re-held it; the third secrets cycle abandoned an endpoint without the still-unsealed guard | both out-of-credits ends read the row afresh; the triggering replica is ended under the guard first (owner's `5782629`) |
| Medium | (re-review of this round) a row waiting for secrets on a draining or suspended node was unsealable for good: the seal refuses a non-active node and only the drain route's one-shot hand-back moved it | the cron hands back every unsealed `assigned` row whose node is not active, idempotently (entry 21) |

## 2. Findings from the October review re-checked and confirmed fixed before this pass

| Review item (C.5) | State in code | Where |
|---|---|---|
| Heartbeat instructions unsigned → fleet-wide RCE | **Fixed.** `personal_sign(keccak256(canonicalJSON({nodeAddress, ts, nonce, body})))`; agent pins the signer (`0x90ec…a247` baked in, overridable), ±60 s window, nonce LRU; unsigned/foreign instructions ignored; plain-http API refused | `instruction-signing.service.ts`, `node-agent/src/instructions.ts`, `index.ts` |
| No nonce on node requests (60 s replay) | **Fixed.** `X-Nonce` mandatory, atomic `INSERT … ON CONFLICT DO NOTHING` into `node_nonces` (120 s), signature covers the nonce; keying on the signature was rejected (ECDSA malleability) | `middleware/node-auth.ts` |
| Hosting billing fraud (any URL, 2xx probe) | **Fixed.** Content-hash probe of a stored file; relayed deployments are probed through the node's own socket (it can only answer for what it serves); direct endpoints must sit on the node's verified public host, which must equal the announcing IP outside DEV_MODE; `busy`/abort/over-cap all fail | `deployment-duties.service.ts` `probeRelayed`, `reportDeploymentStatus`, `routes/v1/nodes.ts` announce |
| docker.sock + any image | **Fixed on the agent.** `--cap-drop=ALL`, `no-new-privileges`, pids/memory/swap caps, `--storage-opt size` (xfs pquota / btrfs / zfs required), user-defined bridge with icc off, egress DROP to RFC1918/169.254/100.64 (DOCKER-USER + conntrack-aware INPUT), re-checked before every start, non-root default user, NVIDIA env stripped and devices allocated explicitly, image allowlist unless `any-image` opted in, Docker ≥ 28 for 127.0.0.1 publishing | `node-agent/src/container.ts`, `hardening.ts`; API only places containers on fleet nodes that announced `container` |
| Sealed env lacks AAD; pubkey unverified client-side | **Fixed in this pass** (F1, F2) | |
| Port collision on 2nd port | **Fixed.** `takenPorts()` covers every port of every record | `node-agent/src/deployments.ts` |
| No resource-fit check | **Fixed.** CPU/RAM/GPU fit against the manifest minus a host reserve; ≤ 5 containers / 20 sites per node | `deployment-duties.service.ts` `fits` |
| Stuck in `assigned` with publicHost 127.0.0.1 | **Fixed** (host must be public or the node has no hosting capability) and now bounded by F3 | |
| Heartbeat ran global duties (DoS by Sybil keys) | **Fixed.** Global duties on the cron; per-node duties only on the heartbeat; per-node limits key on the verified address | `security.ts`, `nodes.ts` |
| DNS SSRF in probes | **Fixed for direct probes** (`endpointAllowed`: literal IP ranges refused, `.local`/`.internal`/`localhost` refused). Hostnames are not resolved before the fetch, so a public name resolving to a private address is possible for *direct* nodes only; relayed deployments never fetch an operator-supplied URL. Direct nodes are legacy; backlog B-13 resolves and pins | `deployment-spec.ts` `endpointAllowed` |
| Bind code in printed URL, first-bind-wins, no unbind | **Partly.** Code is issued only to the node (announce is node-signed) and checked atomically; brute force limited to 10/min per IP on a 64-bit code. No unbind for home nodes (fleet evict exists) — backlog B-10 | `nodes.service.ts` |
| Revoked fleets keep nodes | **Fixed.** Revoke/evict clears payout and fleet; live deployments re-queued | `fleets.service.ts`, `requeueNodeDeployments` |
| Self-reported hardware (Sybil) | **Bounded.** Assignment weight moves only with verified work (EMA from 1); the manifest is used for container *fit* only; a lie leads to a failed start that is re-placed and never billed. Lane B is capped at ρ ≤ 0.04 so self-dealing always loses | `nodes.service.ts`, `ledger.service.ts` |
| Leaked EOA is admin+minter on the live CLDToken; faucet mints with it | **Code side fixed; owner step open.** No chain key in the Worker; faucet and legacy chain writes deleted; `shared/addresses.baseSepolia.json` marks every legacy address compromised. The fresh v2 deploy under a Safe is owner step 4 and has not happened | `docs/OWNER_RUNBOOK.md` |

## 3. Open findings (not fixed here), with severity and proposed correction

| # | Severity | Finding | Why it is open | Correction |
|---|---|---|---|---|
| O1 | Critical (launch-blocking, owner) | Legacy CLDToken minter/admin is the leaked key; v2 contracts not deployed; keeper not running | Needs the owner's Safe, poster key and deploy (runbook steps 3–6) | Run `contract/scripts/v2/deploy.ts`; keep legacy addresses listed as compromised; never reuse 0xF292… |
| O2 | High | A compromised API can route a deployment with secrets to a node it controls | Inherent to orchestrator-chosen placement | Fleet pinning for sensitive deployments (owner chooses a fleet, not a node); TEE tier later |
| O3 | ~~High~~ fixed | JWT: HS256, 24 h, no revocation, one secret for both runtimes | **Fixed in commit 12 (F8)**: logout revocation list, `JWT_SECRET_PREVIOUS` rotation, scoped API keys | Left as a product choice: a shorter `JWT_TTL_SECONDS` with a refresh flow |
| O4 | High (scale) | ~12 D1 statements per heartbeat per node; single-writer D1 | Architecture | Batch the per-node duties into one `db.batch`, skip duties for nodes with nothing live, move `relay_at`/`last_seen` to KV with a 15 s write coalescing; measure before and after (B-5) |
| O5 | Medium | Agent nonce LRU is in-memory: an instruction captured and replayed within 60 s of an agent restart is accepted | Window is 60 s and requires a captured signed instruction | Persist the last nonces to `.data`, or include the agent's boot id in the signed body (API echoes it) |
| ~~O6~~ | Medium | `submitWork` recorded provider rewards even if the fee capture failed (hold missing) | **Fixed** (PROGRESS.md commit 9): capture first; on failure the verified result is still delivered but no reward entries are written, so the epoch close neither mints for the job nor burns its fee. Test: `v1-submit.test.ts` "no reward without a captured fee" | — |
| O7 | Medium | Rate limits are KV-backed and eventually consistent (an abuse stop, not a quota) | Documented | Durable Object or the Workers rate-limit binding (already used by the gateway) for the write buckets |
| O8 | ~~Medium~~ closed by construction (commit 13) | Direct (legacy) nodes: hostnames not resolved before probing | Verified in code and pinned by tests (`node-security.test.ts`): outside DEV_MODE a public host is stored only when it equals the IP the announce came from (an IP literal the API observed; private ranges refused by `endpointAllowed`), and a node may report endpoints only on that host — nothing the API probes for a direct node is ever resolved through DNS. DEV_MODE keeps the loose rules for local stacks | Product decision still open: retire direct mode once the relay is live (backlog decision 3) |
| O9 | Medium | Testnet credits keyed per wallet/IP/ASN — cheap Sybil for free credits | Testnet only, no value | Remove before value (decided) |
| O10 | Medium | Relay DO `/kick` and `/status` are reachable to anyone with the binding; the gateway binding could kick nodes | Bindings are trusted scripts | Restrict `/kick` to the API via a shared header, or split the stub interface |
| O11 | Low | Workstation SSH is published on the node's public IP (direct mode only) | WebSockets over the relay not built | Relay WebSocket tunnelling (planned) |
| O12 | Low | `MIN_AGENT_VERSION` defaults to 1.3.0 while the agent is 1.6.0; sealed-v2 (≥ 1.5.0) and logs (≥ 1.6.0) gating is per-feature, not a hard minimum | Deliberate: do not cut off compute/hosting nodes | The owner's node runs 1.6.0 since 2026-10-20 (per the owner): raising `MIN_AGENT_VERSION` is now a config choice for the owner; the default stays 1.3.0 |
| O13 | Low (dev-time) | Advisories left after `npm audit fix` that need major upgrades: the console's wallet stack (`@wagmi/connectors` pins old `ws`, `preact`, `d3-color`) and the Hardhat 2 toolchain (§3b) | No runtime path: build/test tooling and the browser wallet connector bundle | Bump `@wagmi/*` with the next console dependency pass; move to Hardhat 3 with the v2 contract work |

### 3b. Dependency audit (`npm audit`, 2026-10-19)

GitHub reports 737 Dependabot alerts on the default branch. That branch still carries the packages removed in this
pass (`provider-node-server`, the orchestrator image, legacy scripts and 41 API files), so the figure is not
comparable with this branch; re-check after merge. Per package here, before and after `npm audit fix`
(semver-compatible changes only; nothing forced):

| Package | Before | After | What changed / what remains |
|---|---|---|---|
| client/api | 5 (3 high) | **0** | hono 4.11.5 → 4.13.13 (38 advisories, among them JWT NumericDate validation in `hono/jwt` and CORS / `bodyLimit` issues — middleware this API uses), @hono/node-server 1.19.17 (serveStatic traversal; not used), ws 8.21 |
| gateway | 3 (3 high) | **0** | wrangler 4.147 → 4.151.1 (miniflare, sharp: dev-only) |
| keeper | 7 (3 high) | 4 moderate | same wrangler bump; `uuid` < 11.1.1 via wrangler needs a major — dev-only |
| relay, node-agent | 0 | 0 | |
| console root | 54 (21 high) | 25 (3 high) | vite 7.3.7, rollup, postcss, js-yaml, hono fixed; left: `d3-color`, `preact`, `ws` pinned under an old `@wagmi/connectors` (major bump of the wallet stack) and 22 moderate |
| contract | 60 (1 critical) | 60 | Hardhat 2 toolchain (`handlebars` via solidity-coverage, `undici`/`adm-zip` via hardhat-network-helpers 1.x); all dev-only, all need majors — decide with the Hardhat 3 migration |

hono 4.13's stricter types also surfaced an untyped `requireAuth` (fixed: `createMiddleware<{ Variables: AuthVariables }>`).
Open: the wallet-stack majors at the console root and the Hardhat toolchain (O13, dev-time only; no runtime path).

## 4. Verification and settlement (what the proofs do and do not establish)

- **Matmul (cuPOW).** The orchestrator issues σ bound to (job, node, nonce, seed). The node computes the noisy block
  product with transcript hash; the API re-executes the transcript over *its own* copy of A and B (not the node's,
  so int32 wrap cannot bind a different matrix), checks `z`, and Freivalds-checks the answer (2 rounds, exact over the
  integers because results are bounded to ±n·bound²). The transcript proves **the node did the n³ work for this σ**;
  Freivalds proves **the answer is A·B**. Neither proves who ran it, on what hardware, or that anything was kept
  confidential. Verification costs the orchestrator the same n³ as the work (full re-execution) — the planned
  "Freivalds every job, transcript 1-in-k with delayed earnings" (`docs/POUW_REVIEW.md` §7) is the cost fix and is not
  built. Replay: σ is single-use per assignment and `cert_z` is stored; a certificate for another σ fails.
- **Hosting / containers / endpoints.** *Probed*, not proven: a content hash (sites) or a health path (endpoints)
  fetched through the node's own relay socket every 60 s. Billing is for time a probe saw working. A node can serve
  the probe path correctly and other paths badly; nothing checks that, by design (fees only, no subsidy).
- **Storage phase 1.** Merkle leaf challenges prove a copy is *retrievable now*, never that it is replicated; R2 is the
  durable copy. Correct labelling: `challenged`, not `replicated`.
- **Contracts (v2, not deployed).** 224 Hardhat tests pass offline. Invariants enforced on post: treasury ≥ 3 % of
  fees, lane A + treasury ≤ 98 % of fees, lane B ≤ epoch allowance (8 % → ×0.85/yr → 1.5 % floor), fees ≤ free
  escrow; per-(epoch, account, lane) claim flags; `mintedA ≤ totalLaneA`, `mintedB ≤ totalLaneB`; token-level annual
  net mint ceiling; veto window; lane-B claw before vest. What is *not* enforced: that the leaves are correct (the
  poster chooses the root; the guardian veto and the published leaves are the check), per-user escrow withdrawal
  (mainnet item), k-of-n posters. Reorgs: the keeper waits one confirmation and re-reads on-chain state each pass; the
  deposit watcher trails the head by `DEPOSIT_CONFIRMATIONS` (10).
- **Ledger.** Integer µCLD; holds moved with conditional updates (`WHERE balance_ucld >= ?`, `WHERE held_ucld = ?`);
  the hour is claimed (`held_ucld → 0` conditional) before it is charged, so concurrent heartbeats cannot bill twice;
  epochs close once (vetoed ones re-close under the same id); clawed entries drop out of the next close and of
  `fees_burned`. The e2e run in `TEST_EVIDENCE.md` shows three fees captured once each (balance 10,000,000 − 3,003,
  held 0), a refused answer re-queued with its fee still held until the job was later verified, and
  the posted treasury within the contract's bounds.

## 5. What the audit did not cover

Container escapes beyond the Docker flags (no kernel-level testing; gVisor is a listed option), GPU isolation under a
real NVIDIA runtime, the relay under load, Cloudflare account/DNS security, the console's supply chain
(the `ConsoleApp` bundle is 4.4 MB with wallet SDKs), and anything in production configuration (secrets, bindings,
D1 contents), which this environment could not reach.
