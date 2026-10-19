# Engineering backlog — ranked, with acceptance criteria

Ranking weighs blast radius, user impact, reliability, whether the item blocks paid or public workloads,
dependencies, effort and uncertainty. "Owner" items need keys, accounts or money that only the owner has; they are
listed because they gate everything below them, not because engineering can do them. Done items from this pass are
in `PROGRESS.md`.

## The ten most consequential gaps (2026-10-19)

| # | Gap | Blast radius / impact | Blocks | Effort | Certainty | Owner? |
|---|---|---|---|---|---|---|
| 1 | **No live settlement**: v2 token + settlement not deployed, keeper off, legacy token's minter is the leaked key | Every "minted"/"earned" number is an off-chain IOU; the one marketing claim that distinguishes Cloudana is unproven in production | Paid workloads, provider earnings, mainnet | S (script exists) | High | **Yes** (runbook 3–6) |
| 2 | **Nothing is publicly reachable**: relay secret unset, gateway not on `cloudana.run`, no public node | Deploy flows end at a URL that does not resolve; hosting cannot be demonstrated or billed honestly | Public workloads, hosting, endpoints, storage copies | S | High | **Yes** (runbook 8–10) |
| 3 | **Control plane = one Worker + one D1 with ~12 statements per heartbeat** | Capacity ceiling in the low hundreds of nodes; cost grows linearly; one bad query locks everyone | Scale beyond a pilot | M | Medium (unmeasured) | No |
| 4 | **No independent verification of the orchestrator**: leaves, seeds and σ stored but not published/signed; roadmap phase 1 unmet | "Progressively decentralizing" is a claim nobody can check; litmus FAIL | Mainnet, partner datacenters | M | High | No |
| 5 | **Verification cost = work cost** (full transcript re-execution per matmul job, in the Worker) | Orchestrator CPU scales with every paid job; large n is unaffordable; blocks raising `MATMUL_N_MAX` | Compute product growth | M | High | No |
| 6 | **Auth is a 24 h HS256 JWT with no revocation or scopes; console and SDK share it** | A leaked token is a full account for a day; no API keys for programs | Developer API, SDK/CLI | M | High | No |
| 7 | **Containers/GPU only on fleet nodes that pass xfs-pquota + iptables; no datacenter node exists** | The AI product (endpoints, workstations) has zero capacity; home nodes cannot run it by design | AI inference, workstations | Owner hardware + S | High | **Yes** (runbook 10) |
| 8 | **Marketplace-era legacy UI still reachable under `/control/legacy`** (27 pages, 19 k lines) with vocabulary the owner rejected | Contradicts the product on a reachable route; maintenance drag; was the source of two tsc errors | Developer experience, honest claims | S–M (decision + delete) | High | Decision |
| 9 | **A compromised API can place a secret-bearing deployment on a node it controls** (secrets now bound to the deployment, not to a fleet) | Tenant secrets on an attacker's machine | Sensitive workloads | M | High | No |
| 10 | **Docs and claims drift**: SHIP_CHECKLIST still says `*.sites.cloudana.io`; DECISIONS header says "nothing implemented"; `MIN_AGENT_VERSION` 1.3.0 vs agent 1.5.0; services list vs reality | Every reader (owner, partner, auditor) gets a different system | Trust | S | High | No |

## Work items

Priority P0 = before any paid or public workload; P1 = before the incentivized testnet; P2 = before mainnet; P3 =
later. Each has acceptance criteria that a reviewer can check without talking to the author.

### P0

**B-1 · Deploy v2 contracts, keeper, relay secret, gateway domain, first node (owner; gaps 1, 2, 7).**
Acceptance: `shared/addresses.baseSepolia.json` has a `v2` section; `GET /v1/network.lastSettledEpochAt` is non-null
within 2 h of the first job; `https://<id>.cloudana.run` serves a site deployed from the console through a node with
no open ports; the keeper `/health` shows the settlement address and a funded poster; one veto drill (`veto` then a
corrected re-post) completed. Engineering's half: `DEPLOYMENT_RUNBOOK.md` steps are followed in order.

**B-2 · Publish and sign what the orchestrator decides (gap 4).** Public `GET /v1/epochs/{n}` with leaves,
`fees_burned`, treasury and root (the keeper's payload, read-only); public `GET /v1/jobs/{id}/draw` with
`seed_source`, `draw_seed`, `eligible_hash`, σ and the eligible list hash; sign `/v1/network`, epoch payloads and draw
records with a published key (reuse the instruction key or a second funds-less key, address in `/v1/network`).
Acceptance: a script in `scripts/verify/` recomputes an epoch root and replays a draw from public data only and
matches; the keeper refuses a root that differs from the published leaves (it already does for its own rebuild).

**B-3 · Delete or rewrite `/control/legacy` (gap 8; owner decision on what survives).** Acceptance: no reachable route
uses "marketplace", "bid", "pick a provider", "per epoch" vocabulary (`tasks/lessons.md` 2026-10-01); `ConsoleApp`
chunk shrinks measurably; repo-root `tsc` and build stay clean.

**B-4 · Fix the documentation drift (gap 10).** `docs/SHIP_CHECKLIST.md` → `cloudana.run`, mark done items;
`docs/DECISIONS_CONSENSUS.md` header → "implemented 2026-10; owner steps open"; `instruction-signing.service.ts`
comment and `MIN_AGENT_VERSION` policy; `client/src/lib/services.ts` must agree with `CAPABILITY_MATRIX.md` (add a
unit test that fails when a service is "live" in the list but not in the matrix).

### P1

**B-5 · Measure and cut the heartbeat's D1 cost (gap 3).** Baseline a 50-node simulation against `wrangler dev
--local` (statements per minute via a counting D1 wrapper); batch per-node duties into one `db.batch`; skip the
assign/probe/bill scans for nodes with no live deployments (cheap `EXISTS` first); coalesce `last_seen`/`relay_at`
into one write; consider 30 s heartbeats. Acceptance: ≤ 4 statements per idle heartbeat, ≤ 8 with live deployments,
measured and recorded in `TEST_EVIDENCE.md`; no behaviour change in the 334 tests.

**B-6 · Verification cost (gap 5).** Freivalds on every job (n²), full transcript re-execution on a random 1-in-k
with the job's earnings delayed until the check and clawed on failure (`docs/POUW_REVIEW.md` §7). Acceptance:
orchestrator CPU per job drops ≥ 10× at n = 256 in a benchmark; a planted wrong transcript is caught within k jobs in
a property test; claw path covered.

**B-7 · Developer auth and API keys (gap 6).** `POST /v1/keys` for user API keys (`cld_sk_…`, sha256 stored,
scopes `jobs`, `deployments`, `read`), short-lived JWT for the console with refresh, revocation list, `kid` in the
JWT header for secret rotation. Acceptance: a revoked key is refused within 30 s on both runtimes; OpenAPI documents
the scheme; the console uses the same endpoints.

**B-8 · Node state model and draining.** States `online | degraded | draining | unreachable | suspended | banned`
on `nodes`; `POST /v1/nodes/mine/{address}/drain` (no new work, finish or hand off live deployments); admin ban/unban
(`docs/V4_REVIEW_CLOUD.md` (a)). Acceptance: a draining node receives no new assignments in tests; a banned node's
tickets are refused and its live deployments re-queued.

**B-9 · Fleet pinning for sensitive deployments (gap 9).** `spec.placement.fleetId` (owner's own fleet or a partner
fleet the owner selected by id, never a node); assignment honours it; the console shows it before secrets are
sealed. Acceptance: a pinned deployment is never assigned outside the fleet (test), and the sealing UI shows the
fleet name next to the node address.

**B-10 · Home-node unbind and re-bind.** `DELETE /v1/nodes/mine/{address}` clears payout (live work re-queued, pending
earnings stay with the old payout). Acceptance: tested; the agent prints a fresh bind link after.

**B-11 · Ledger invariant: no reward without a captured fee.** In `submitWork`, make capture and reward one step;
when capture fails, complete the job, record no rewards, log and count. Acceptance: a test that empties the hold
before submit shows no `reward_entries` row and `fees_burned` unchanged.

**B-12 · Endpoint replicas: seal secrets per replica in the console.** The API requires per-replica sealing; the
console only seals parent deployments. Acceptance: an endpoint created with `expectsSecrets` starts from the console
on two relay nodes with different keys.

**B-13 · Retire direct (public-IP) nodes once the relay is live, or resolve-and-pin before probing them.**
Acceptance: either no code path fetches an operator-supplied URL, or every such fetch resolves the host, refuses
private answers and connects to the resolved address.

**B-14 · Deployment logs and events for running containers.** `GET /v1/deployments/{id}/logs?tail=200` served through
the relay (`docs/V4_REVIEW_RELAY.md` §6). Acceptance: the console shows live logs for a running container; the
endpoint is rate-limited per deployment.

**B-15 · Custom domains for static sites (Cloudflare for SaaS or CNAME + DCV).** Ownership verification by TXT,
certificate issuance through the gateway zone, `Host` → deployment mapping in D1 cached at the gateway. Acceptance: a
site deployed from the console answers on an owner's domain over HTTPS; takeover of a released hostname is refused by
re-verification.

### P2

**B-16 · Settlement transparency and multi-party posting.** k-of-n posters in `CloudanaSettlementV2` (or a successor),
24 h epochs and veto, lane-B 7-day vest, per-user escrow withdrawal, 48 h timelock on roles, audit. Acceptance: an
epoch is finalized with the team's poster offline (testnet drill).

**B-17 · Pull-based assignment.** Nodes pull from a published seeded queue and can verify the draw before starting.
Acceptance: the agent refuses an assignment whose σ does not match the published seed/eligible set.

**B-18 · Object storage phase 2 (buckets, signed URLs, lifecycle)** per `docs/V4_STORAGE_SPEC.md`, gated on the DMCA
agent and abuse contact (runbook step 11). Acceptance: S3-compatible PUT/GET/DELETE with content hashes, metering per
GB-month and GB downloaded reconciled in the ledger, a recovery test after a provider copy is lost.

**B-19 · Verified inference mode** (`docs/V4_VERIFIED_SERVICES.md` §4): reference node, teacher-forced checks,
flag-only until calibrated. Acceptance: < 0.1 % false positives on 1,000 honest requests; a substituted model is
flagged.

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

## Decisions needed from the owner

1. Which `/control/legacy` pages survive (B-3). Recommendation: none; the pricing calculators and decentralization page
   move to the main console as rewritten pages.
2. Fleet pinning semantics (B-9): can a customer pin to a partner fleet they do not own? Recommendation: yes, by fleet
   id shown in the console, never by node.
3. Whether to keep direct (public-IP) node mode at all once the relay is live (B-13). Recommendation: retire it.
4. Weekly lane-B pool vs per-epoch (contract change) — before the v2 deploy (open in `tasks/todo.md`).
