# Engineering backlog — ranked, with acceptance criteria

Ranking weighs blast radius, user impact, reliability, whether the item blocks paid or public workloads,
dependencies, effort and uncertainty. "Owner" items need keys, accounts or money that only the owner has; they are
listed because they gate everything below them, not because engineering can do them. Done items from this pass are
in `PROGRESS.md`.

## The ten most consequential gaps (2026-10-19)

| # | Gap | Blast radius / impact | Blocks | Effort | Certainty | Owner? |
|---|---|---|---|---|---|---|
| 1 | **No live settlement**: v2 token + settlement not deployed, keeper off, legacy token's minter is the leaked key | Every "minted"/"earned" number is an off-chain IOU; the one marketing claim that distinguishes Cloudana is unproven in production | Paid workloads, provider earnings, mainnet | S (script exists) | High | **Yes** (runbook 3–6) |
| 2 | ~~Nothing is publicly reachable~~ — **closed 2026-10-18**: relay secrets set, gateway on `cloudana.run`, first public node (Azure) online | Deploy flows end at a URL that does not resolve; hosting cannot be demonstrated or billed honestly | Public workloads, hosting, endpoints, storage copies | S | High | **Yes** (runbook 8–10) |
| 3 | **Control plane = one Worker + one D1 with ~12 statements per heartbeat** | Capacity ceiling in the low hundreds of nodes; cost grows linearly; one bad query locks everyone | Scale beyond a pilot | M | Medium (unmeasured) | No |
| 4 | **No independent verification of the orchestrator**: leaves, seeds and σ stored but not published/signed; roadmap phase 1 unmet | "Progressively decentralizing" is a claim nobody can check; litmus FAIL | Mainnet, partner datacenters | M | High | No |
| 5 | ~~**Verification cost = work cost** (full transcript re-execution per matmul job, in the Worker)~~ — **closed 2026-10-21** (B-6): Freivalds on every job, the transcript on a random 1 in 10, pay held 24 h | Orchestrator CPU scales with every paid job; large n is unaffordable; blocks raising `MATMUL_N_MAX` | Compute product growth | M | High | No |
| 6 | **Auth is a 24 h HS256 JWT with no revocation or scopes; console and SDK share it** | A leaked token is a full account for a day; no API keys for programs | Developer API, SDK/CLI | M | High | No |
| 7 | **Containers/GPU only on fleet nodes that pass xfs-pquota + iptables; no datacenter node exists** | The AI product (endpoints, workstations) has zero capacity; home nodes cannot run it by design | AI inference, workstations | Owner hardware + S | High | **Yes** (runbook 10) |
| 8 | ~~**Marketplace-era legacy UI still reachable under `/control/legacy`** (27 pages, 19 k lines) with vocabulary the owner rejected~~ — **closed 2026-10-21**: removed (B-3), old paths redirect to `/control` | Contradicts the product on a reachable route; maintenance drag; was the source of two tsc errors | Developer experience, honest claims | S–M (decision + delete) | High | Decision |
| 9 | **A compromised API can place a secret-bearing deployment on a node it controls** (secrets now bound to the deployment, not to a fleet) | Tenant secrets on an attacker's machine | Sensitive workloads | M | High | No |
| 10 | **Docs and claims drift** (verification wording aligned with code 2026-10-26, PROGRESS entry 28): SHIP_CHECKLIST still says `*.sites.cloudana.io`; DECISIONS header says "nothing implemented"; `MIN_AGENT_VERSION` 1.3.0 vs agent 1.5.0; services list vs reality | Every reader (owner, partner, auditor) gets a different system | Trust | S | High | No |

## Work items

Priority P0 = before any paid or public workload; P1 = before the incentivized testnet; P2 = before mainnet; P3 =
later. Each has acceptance criteria that a reviewer can check without talking to the author.

### P0

**B-1 · Deploy v2 contracts and the keeper (owner; gap 1).** The relay secret, gateway domain and first node are done
(2026-10-18); a container/GPU fleet node remains (gap 7).
Acceptance: `shared/addresses.baseSepolia.json` has a `v2` section; `GET /v1/network.lastSettledEpochAt` is non-null
within 2 h of the first job; `https://<id>.cloudana.run` serves a site deployed from the console through a node with
no open ports; the keeper `/health` shows the settlement address and a funded poster; one veto drill (`veto` then a
corrected re-post) completed. Engineering's half: `DEPLOYMENT_RUNBOOK.md` steps are followed in order.

**B-2 · Publish and sign what the orchestrator decides (gap 4).** **Done in this pass** (PROGRESS.md commit 9):
public `GET /v1/epochs/{n}` (leaves, totals, root, signed), public `GET /v1/draws/{id}` (seed, eligible set, draw,
σ once done), signed `/v1/network`, and `client/api/scripts/verify/replay.ts`, which recomputes the root and replays
the draw from public data (`TEST_EVIDENCE.md` §2b). Left open: signing individual draw records, and the seed's
origin is checkable only where `CHAIN_RPC_URL` is set (it is, in `wrangler.toml`, pending deploy).

**B-3 · Delete or rewrite `/control/legacy` (gap 8; owner decision on what survives).** **Done 2026-10-21**
(PROGRESS.md entry 22): owner decision "none survive"; every legacy page, hook, helper and component removed,
`/control/legacy/*` redirects to `/control`; `ConsoleApp` chunk 4,296 → 1,765 kB; `tsc` and build clean. The pricing
calculator and the decentralization page return later as rewritten console pages. Acceptance: no reachable route
uses "marketplace", "bid", "pick a provider", "per epoch" vocabulary (`tasks/lessons.md` 2026-10-01); `ConsoleApp`
chunk shrinks measurably; repo-root `tsc` and build stay clean.

**B-4 · Fix the documentation drift (gap 10).** `docs/SHIP_CHECKLIST.md` → `cloudana.run`, mark done items;
`docs/DECISIONS_CONSENSUS.md` header → "implemented 2026-10; owner steps open"; `instruction-signing.service.ts`
comment and `MIN_AGENT_VERSION` policy; `client/src/lib/services.ts` must agree with `CAPABILITY_MATRIX.md` (add a
unit test that fails when a service is "live" in the list but not in the matrix).

### P1

**B-5 · Measure and cut the heartbeat's D1 cost (gap 3).** **First half done** (PROGRESS.md commit 10): measured
with a counting D1 wrapper (idle 13 → 5 statements, steady busy 13 → 5, probing beat 15 → 10; pinned by
`tests/heartbeat-cost.test.ts`). Left: a multi-node load run against `wrangler dev --local` recorded in
`TEST_EVIDENCE.md`; liveness/relay flags off D1 (KV or a Durable Object) and 30 s beats if the owner accepts the
slower dead-node detection. Acceptance for the rest: 50 simulated nodes for 10 minutes without D1 errors, statements
per minute recorded.

**B-6 · Verification cost (gap 5).** **Done** (PROGRESS.md entry 25; owner decision 2026-10-21): Freivalds and the
binding checks on every job (n²); the full transcript re-executed, inside `submitWork`, on a random 1 in
`VERIFY_SAMPLE_K` = 10 (HMAC keyed from `JWT_SECRET` over job id and σ: the node cannot tell before it submits); every
job's provider pay held — clawable for at least `PAY_HOLD_SECONDS` = 24 h — and, on a failed sampled check, clawed
wallet-wide (every held A/B entry of the node's payout wallet, whichever of its nodes earned it, fleet-token nodes
included) while the fees still burn; the claw and the failing node's suspension commit with the result, in one batch;
`POST /v1/admin/claws/{jobId}/reverse` undoes a false positive or a leaked fleet token's damage (held pay only; pay
another failed check still covers stays clawed). Acceptance (restated with that decision):
submit-path CPU ≥ 10× lower at n = 256 in a benchmark — measured ≈ 50× (≈ 1.1 s → ≈ 22 ms; the amortised figure
(a)/((b) + (a)/K) is ≈ 8.4× at K = 10 and can never exceed K); a planted wrong transcript is always caught, after a
mean of ≤ k jobs and 99 % within 44 at k = 10 — probabilistic by design (a hard bound needs a predictable draw), in a
property test over 400 runs; claw path covered, including the keeper posting an all-clawed epoch with the zero root
(`tests/sampled-verification.test.ts`, `tests/sampled-claw.test.ts`, `tests/verify-cost.test.ts`,
`keeper/test/run.test.ts`).

**B-7 · Developer auth and API keys (gap 6).** **Done in this pass** (PROGRESS.md commit 12; SECURITY_AUDIT F8):
`POST`/`GET /v1/keys`, `DELETE /v1/keys/{id}` (`cld_sk_…`, sha256 stored, scopes `read`/`jobs`/`deployments`, optional
expiry, ≤ 20 live), `POST /v1/auth/logout` with a KV revocation list, `JWT_SECRET_PREVIOUS` rotation, the OpenAPI
security scheme describes both credentials, the console mints keys under Docs → API and revokes its session on
sign-out. A revoked key is refused at once in the revoking isolate and within 30 s elsewhere, on both runtimes.
Deviations from the sketch: no `kid` header (verification tries both secrets) and no refresh token (24 h session,
`JWT_TTL_SECONDS`, now revocable). Left: per-key rate limits; an audit trail of key use beyond `lastUsedAt`.

**B-8 · Node state model and draining.** **Done in this pass** (PROGRESS.md commit 13): `nodes.state` = active |
draining | suspended; `POST`/`DELETE /v1/nodes/mine/{address}/drain` (owner), `POST`/`DELETE
/v1/admin/nodes/{address}/suspend` (internal key; re-queues live deployments, refuses relay tickets); the matmul
draw, heartbeat assignment, pre-emption candidates and storage placement skip anything not active;
`/v1/network.nodesOnline` excludes suspended nodes; console Provide shows the state with Drain / Resume / Unbind.
Acceptance met in `node-state.test.ts`. Not built: `degraded`/`unreachable` as stored states (they stay derived from
probes and `last_seen`); a ban that also refuses announce (a suspension survives unbind and rebind, which has the
same effect).

**B-9 · Fleet pinning for sensitive deployments (gap 9).** `spec.placement.fleetId` (owner's own fleet or a partner
fleet the owner selected by id, never a node); assignment honours it; the console shows it before secrets are
sealed. Acceptance: a pinned deployment is never assigned outside the fleet (test), and the sealing UI shows the
fleet name next to the node address. **Done** (owner decision 2026-10-21, PROGRESS.md entry 24): containers,
workstations and endpoints take `placement`; create refuses an unknown or revoked fleet; heartbeat assignment,
pre-emption and the claim itself honour it; deployments show `placement` and the node's fleet (`nodeFleet`); the
console pins from the deploy, workstation and endpoint forms and shows the fleet beside the node wherever secrets are
sealed. Tests in `fleet-pinning.test.ts`.

**B-10 · Home-node unbind and re-bind.** **Done in this pass** (PROGRESS.md commit 10): `DELETE /v1/nodes/mine/{address}`;
test in `v1-network-nodes.test.ts`. The agent already prints a fresh bind link when its announce comes back unbound.

**B-11 · Ledger invariant: no reward without a captured fee.** **Done in this pass** (PROGRESS.md commit 9): capture
first, rewards only when it succeeded; test "no reward without a captured fee" in `v1-submit.test.ts`.

**B-12 · Endpoint replicas: seal secrets per replica in the console.** **Done in this pass** (PROGRESS.md commit 11;
SECURITY_AUDIT F7): per-replica `awaitingSecrets` + `nodePubkey` in the API, a sealer per endpoint in the console,
environment values no longer sent in the clear, re-enter form after a re-queue. Acceptance met in `endpoints.test.ts`
(two nodes, two keys); not yet exercised in a browser.

**B-13 · Retire direct (public-IP) nodes once the relay is live, or resolve-and-pin before probing them.**
**Engineering half closed** (PROGRESS.md commit 13): verified by reading and pinned by tests that, outside DEV_MODE,
no hostname is ever stored or probed for a direct node (the public host must equal the announcing IP; reported
endpoints must use it), so there is no DNS to rebind — the first acceptance branch holds as "no code path fetches an
operator-chosen host". SECURITY_AUDIT O8 updated. **Product half done** (owner decision 2026-10-21, PROGRESS entry 23): while the relay
runs, direct nodes take GPU workstations only; direct mode retires fully once the relay tunnels WebSockets.

**B-14 · Deployment logs and events for running containers.** **Done in this pass** (PROGRESS.md commit 14):
`GET /v1/deployments/{id}/logs?tail=N` reads the tail live from the node through the relay (reserved dep `agent`,
agent ≥ 1.6.0 `ops.ts`), answers the kept failure tail once a deployment left its node, names every failure mode
(direct node, no relay, socket down, old agent, node answer), and is rate-limited per deployment (20/min) on top of
the per-IP bucket; the console has a Logs panel on containers and endpoint replicas. Acceptance met in
`deployment-logs.test.ts` + the agent's ops selftest and relay e2e case; the console panel is not browser-tested.
Not built: streaming/follow and an events feed beyond `deployment_events`.

**B-15 · Custom domains for static sites (Cloudflare for SaaS or CNAME + DCV).** Ownership verification by TXT,
certificate issuance through the gateway zone, `Host` → deployment mapping in D1 cached at the gateway. Acceptance: a
site deployed from the console answers on an owner's domain over HTTPS; takeover of a released hostname is refused by
re-verification.

### P2

**B-16 · Settlement transparency and multi-party posting.** k-of-n posters in `CloudanaSettlementV2` (or a successor),
24 h epochs and veto, lane-B 7-day vest, per-user escrow withdrawal, 48 h timelock on roles, audit. Acceptance: an
epoch is finalized with the team's poster offline (testnet drill).

**B-17 · Pull-based assignment.** Nodes pull from a published seeded queue and can verify the draw before starting.
Until then two gaps stay: the eligible set is attested, not committed before the seed, and an assignment that expires
is re-drawn with the earlier draw not kept (`CLEAR_ASSIGNMENT`), so the verifier (which now checks the seed block's
timestamp against `assignedAt`) cannot see a re-roll.

Acceptance: the agent refuses an assignment whose σ does not match the published seed/eligible set. Why it matters
(review finding, commit 16): today's draw record is signed, but its eligible set is the orchestrator's attestation —
nothing commits the set before the seed is known, so a replay proves the draw was computed as published, not that
the set was complete. Committing the eligible hash before the seed (or publishing the set at enqueue) is the fix.

**B-18 · Object storage phase 2 (buckets, signed URLs, lifecycle)** per `docs/V4_STORAGE_SPEC.md`, gated on the DMCA
agent and abuse contact (runbook step 11). Acceptance: S3-compatible PUT/GET/DELETE with content hashes, metering per
GB-month and GB downloaded reconciled in the ledger, a recovery test after a provider copy is lost.

**B-19 · Spot-checked inference mode** (`docs/V4_VERIFIED_SERVICES.md` §4; not built — endpoints are probed only
today, and this needs a GPU node first): reference node, teacher-forced checks, flag-only until calibrated. Acceptance: < 0.1 % false positives on 1,000 honest requests; a substituted model is
flagged.

**B-26 · General verification interface.** **Phase 0 done** (PROGRESS.md entry 26): one interface for deterministic
work (`shared/verification.ts`) — a work-type-fixed plan of gemm / elementwise / opaque segments, a hash-chained
commitment bound to σ and the job's own inputs, a segment draw made only after the commitment is stored (same key as
B-6, new domain; one commitment per assignment), and a kind-generic opening check (Freivalds per GEMM with exact
shapes and a ±(p−1)/2 bound, recompute per elementwise step). matmul (B-6) is the degenerate case, byte-identical
(golden snapshot). First new work type: `int8-mlp` (one quantized MLP block on the user's weights; 2 of 4 segments
opened per job; agent ≥ 1.7.0). Settlement, hold and claw are B-6's statements; a caught job fails (not re-queued),
the owner is not charged and the wallet bound at commit time is clawed. Toward a proven tier for integer inference on the user's own weights (B-19 stays spot-checked, for float engines).
Follow-ups:
- **Done:** `int8-model` (`shared/work-int8-model.ts`): 1–16 int8-mlp blocks chained, 4·L segments, max(3, L) opened
  per job (p ≥ ¼; segmentDraw up to 16, answer cap 1.5 MB), d, h ≤ 64 so the largest input stays < 1 MB of D1; agent ≥ 1.8.0. Larger d·h·L needs the artifact store.
- Move `work_jobs.input_json` of finished int8-mlp jobs to the artifact store (`moveJobArtifacts` skips them today; up
  to ~0.6 MB of D1 per job at the largest shape).
- Re-queue a caught job for another node instead of failing it (needs claw ids distinct from job ids: `reward_claws`
  and `reverseSampleClaw` are keyed by job id).
- A per-work-type rate (`WorkType.fee?`) once a type's cost per MAC differs from matmul's; today `meter` in MAC
  equivalents is the only hook.
- Phase 1–2: per-layer plans for real models (many segments, activations of tens of MB kept on the node and opened on
  demand — the commit-then-challenge transport already fits), int4, attention; a deterministic engine on GPU.
- **Done 2026-10-26** (PROGRESS entry 28): the detection rate per job (½ for int8-mlp, ≥ ¼ for int8-model) is
  stated wherever the label is shown (console Docs, services list, litepaper, whitepaper §4.1).
- Wrong results a cheater got through: each int8-mlp job is checked on 2 of 4 segments, so a node faking one segment
  passes half the time, and a brand-new wallet with no held pay risks only suspension. Notify the owners of jobs
  settled by a node that is later caught (their results may be wrong), and/or require a minimum held stake (pay or a
  bond) before a node is drawn for int8-mlp. Acceptance: a caught node's earlier jobs are listed to their owners; a
  node below the stake is never drawn.
- matmul's settlement batch (`bookVerified`) does not re-check σ in its writes; the int8-mlp commit write does
  (`AND sigma = ? AND expires_at >= ?`). Add the same guard to matmul once a test shows it changes nothing on the
  golden snapshot path (left alone in PR #60 so matmul stays byte-identical).
- An answer whose response was lost and is retried after the first one settled gets 409 (the job is done): the node is
  paid, but its log says the job failed. Return the settled result for a repeat of the same answer.

**B-20 · Observability.** Correlation ids end to end (request id → node report → relay stream id), error-rate and
probe-failure metrics exported (Workers Analytics Engine or Logpush), keeper and relay alerts, a status page fed by
`/v1/network` and keeper `/health`. Acceptance: an induced relay outage shows on the status page within 2 minutes.

### P3

**B-21 · CDN caching for static sites** (cache keyed by content hash at the gateway, invalidated by redeploy), basic
WAF rules and per-site rate limits at the gateway, request logs per deployment.
**B-22 · SDK/CLI** generated from `GET /v1/doc` (TypeScript first), with `cloudana deploy ./dist` and `cloudana jobs
run`.
**B-23 · Multiple independent gateway operators** (the hosting single point) and authoritative DNS, after B-15.
**B-24 · Confidential compute tier** (TEE attestation) for secrets the provider must not see.

**B-25 · Public rate limits off KV.** The IP-keyed security limiters (sign-in, bind, key and fleet creation, waitlist,
public reads) still count in KV (two operations per request); when the quota is gone they degrade to per-isolate
memory. Move them to the Workers rate-limiting binding the gateway already uses (`KEY_LIMIT`), one binding per bucket.
Node routes and the polled read buckets already count per isolate.

## Owner decisions (decided 2026-10-21: "go with your recommendations"; `docs/DECISIONS_CONSENSUS.md` top note)

1. `/control/legacy` (B-3): **none survive**; the pricing calculator and the decentralization page come back as
   rewritten console pages.
2. Fleet pinning (B-9): **yes**, to the owner's own fleet or a partner fleet by its fleet id, never to a node.
3. Direct node mode (B-13): **relay by default; direct only for GPU workstations** until the relay tunnels WebSockets.
4. Lane-B pool: **per epoch (one hour), as built**; no contract change before the v2 deploy.
5. Verification (B-6): **1-in-10 sampled re-execution, 24 h pay hold, claw on a failed check.**
