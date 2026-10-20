# Capability matrix — the one registry

Every product capability with its **verified** maturity. The homepage, the console (`client/src/lib/services.ts`),
the docs and the waitlist must agree with this table; when they disagree, this table wins and the other is a bug.
Updated 2026-10-19 from code, tests and the owner runbook, not from the site.

Maturity classes (the directive's six, in order of trust):

1. **Operational and verified** — runs in production for real users and was observed working there. *Nothing is
   in this class today*: the v2 settlement is not deployed. Since 2026-10-18 the relay secrets are set, the gateway
   serves `https://<id>.cloudana.run` and a first public node (Azure, relay) is online, so hosting and storage can be
   observed in production as soon as real users arrive.
2. **Implemented, not deployed** — complete in code with passing tests; blocked on an owner step or a deploy.
3. **Partially implemented** — some of the path exists; honest label "early access".
4. **Broken or insecure** — exists but must not be used as is.
5. **Designed, not implemented** — a spec exists; nothing runs.
6. **Deprecated, remove** — dead or contradicting the product.

How it is checked ("proof"): **proven** (transcript + answer check) · **probed** (reachability/content/health) ·
**challenged** (retrievability) · **none**.

## Compute

| Capability | Class | Proof | Evidence | What blocks class 1 |
|---|---|---|---|---|
| Matrix compute jobs (`POST /v1/jobs`, n 8–256), USD quote settled in CLD, hold → capture | 2 | proven | e2e 43 checks; API tests `v1-submit`, `v1-assignment`, `pouw-verify`, `job-ceiling`, `pricing` | a public node (owner step 10); settlement (B-1) |
| Assignment by weighted random draw, replayable from the signed draw record | 2 | — | `jobs.service.ts`; `public-replay` tests; `scripts/verify/replay.ts` | the eligible set is attested, not pre-committed, and an expired-and-redrawn assignment leaves no trace (B-17) |
| Provider agent: install, identify, benchmark, bind, heartbeat, signed instructions | 2 | — | agent selftests; image built and signed by CI (1.6.0 live on the first public node since 2026-10-20) | — |
| Browser verifier (planted tasks, points) | 2 | — | e2e; `verify-feed` tests | — |
| Containers (curated images) on fleet nodes, hardened | 3 | probed | API tests `deployments`, `workstations`; agent security selftest 94 checks; no container-capable node exists yet (the first public node serves compute, hosting and storage) | a container-capable node (xfs pquota + Docker ≥ 28) |
| GPU workstations (Jupyter / code-server / desktop), direct mode | 3 | probed · GPU reported by node | `workstations` tests; needs public-IP node (relay has no WebSockets) | a GPU node; relay WebSocket tunnelling |
| GPU endpoints (bring your own model server), replicas, keys, per-replica sealed secrets from the console | 3 | probed (health) | `endpoints` tests; gateway tests | a GPU fleet node |
| Container logs on demand (`GET /deployments/{id}/logs`: live through the relay, failure tail otherwise, per-deployment limit) | 2 | — | `deployment-logs` tests; agent ops selftest (20 checks) and relay e2e logs case; console panel browser-tested on the direct-node error path (TEST_EVIDENCE §4b) | a container-capable node (relay live since 2026-10-18, a 1.6.0 node since 2026-10-20) |
| Verified inference (teacher-forced checks) | 5 | — | `docs/V4_VERIFIED_SERVICES.md` §4 | reference node, calibration |
| Edge functions | 5 | — | catalog entry only | — |

## Hosting and delivery

| Capability | Class | Proof | Evidence | What blocks class 1 |
|---|---|---|---|---|
| Static sites: upload ≤ 2 MB, served by a node through the relay, content-hash probed, billed per probed hour | 2 | probed | `deployments`, `hosting-gateway` tests; gateway 28 tests; relay e2e selftest | settlement (B-1); relay, gateway and a node are live since 2026-10-18 |
| Public URL `https://<id>.cloudana.run` with tenant isolation (sandbox CSP for sites, own origin for apps) | 2 | — | gateway tests | — (live on `cloudana.run` since 2026-10-18) |
| Outbound tunnels for nodes behind NAT (relay) | 2 | — | relay 14 tests + agent relay selftests 69 + e2e 27 | — (set 2026-10-18) |
| Report a problem → immediate probe → forgiven time | 2 | probed | `deployments` tests | — |
| Custom domains, TLS for them | 5 | — | — | B-15 |
| CDN / edge cache, cache invalidation, ETag beyond origin headers | 5 | — | gateway passes origin cache headers only | B-21 |
| WAF, DDoS beyond Cloudflare defaults, per-site rate limits, request logs | 5 | — | — | B-21 |
| Authoritative DNS | 5 | — | — | B-23 |
| Bandwidth billing | 5 | — | — | — |

## Storage and data

| Capability | Class | Proof | Evidence | What blocks class 1 |
|---|---|---|---|---|
| Job artifacts to R2 (finished matrices leave D1) | 2 | — | `artifacts` tests; cron wired | R2 bucket exists (it does per wrangler.toml) |
| Encrypted provider copies with Merkle challenges (storage phase 1) | 2 | challenged | `storage`, `storage-proof` tests; agent storage selftest | `STORAGE_KEK` (owner step 2) + storage nodes |
| Object storage (buckets, S3 API, signed URLs, lifecycle) | 5 | — | `docs/V4_STORAGE_SPEC.md` | DMCA agent (step 11), B-18 |
| KV, queues, databases | 5 | — | catalog entry only | — |

## Security and access

| Capability | Class | Proof | Evidence |
|---|---|---|---|
| Wallet sign-in (EIP-191 over a single-use nonce), session JWT 24 h with logout revocation and secret rotation | 2 | — | `auth`, `api-keys` tests, e2e |
| Tenant isolation at the API (owner-scoped rows, 404 for others) | 2 | — | `deployments` "another owner's deployment is 404", e2e |
| Node request authentication (signature + nonce + window) | 2 | — | `node-auth`, `node-security` tests, e2e replay refused |
| Node state model: owner drain/resume, admin suspend (live deployments re-queued, no relay ticket), every placement path skips non-active nodes | 2 | — | `node-state` tests; console Provide drain/resume browser-tested (TEST_EVIDENCE §4b) |
| Signed node instructions with pinned signer | 2 | — | `node-security` tests, agent selftest |
| Sealed secrets bound to deployment, node key verified in the browser | 2 | — | agent sealed selftest 26 checks; API tests; browser pass: sealed in Chromium, opened by the node for that deployment only (TEST_EVIDENCE §4b) |
| Container hardening (cap-drop, no-new-privileges, pids/mem/disk caps, egress DROP, non-root, NVIDIA env) | 2 | — | agent security selftest; **no kernel-level test** |
| Endpoint keys (`cld_ek_`), per-key rate limit at the gateway | 2 | — | gateway tests |
| User API keys (`cld_sk_`: scopes read/jobs/deployments, hashed, expiring, revocable; console Docs → API) | 2 | — | `api-keys` tests (18 route→scope cases, allow/deny on real routes); panel browser-tested: mint, use, revoke (TEST_EVIDENCE §4b) |
| Zero-trust access, confidential VMs, TEE | 5 | — | — |

## Economics and settlement

| Capability | Class | Proof | Evidence | What blocks class 1 |
|---|---|---|---|---|
| Off-chain ledger: 95/3/2 split, lane B ρ ≤ 0.04 pro rata, per-operator cluster gate, hourly epochs, Merkle roots | 2 | — | `v1-ledger`, `fee-split-bounds`, `epoch-merkle`, `epoch-veto`, `epoch-migration` tests; e2e | — |
| Price controller (utilization, ±2 %/h, 5-min quote lock) | 2 | — | `pricing` tests | — |
| Testnet credits (10 CLD/day per wallet and IP, ASN cap) | 2 | — | `dev-credits` tests | remove before value |
| CLDTokenV2 + CloudanaSettlementV2 (post/veto/finalize/claim/claw, invariants, mint ceiling) | 2 | — | 224 Hardhat tests (offline solc) | **owner deploy (B-1)** |
| Keeper (close → post → finalize → claim, stateless, root re-verified) | 2 | — | keeper 28 tests | settlement address + poster key |
| Deposit watcher (`Deposited` events → credits, 10 confirmations) | 2 | — | `deposit-watcher` tests | settlement address |
| Public settlement data: epochs with leaves + root (signed), draw records with the eligible set, signed network stats, replay script | 2 | — | `public-replay` tests; `scripts/verify/replay.ts` run in `TEST_EVIDENCE.md` §2b | `CHAIN_RPC_URL` deployed so seeds are block hashes; individual draws unsigned (B-17 makes them pull-based) |
| Card payments | 6 (off by decision) | — | 503 unless `STRIPE_ENABLED` | — |

## Developer experience

| Capability | Class | Evidence |
|---|---|---|
| OpenAPI generated from the routes (`/v1/doc`, `/v1/swagger`), one response envelope, stable error codes | 2 | Node runtime probe in this pass |
| Console: Run (jobs), Deploy (sites, containers), Workstations, Endpoints, Provide, Verify, Earnings, Economics, Docs | 3 | builds; re-verified in headless Chromium on the local stack in this pass: 29 checks across Run, Deploy, Provide and Docs (TEST_EVIDENCE §4b); Workstations and Endpoints tabs not exercised |
| `/control/legacy/*` marketplace-era pages | 6 | B-3 |
| SDK / CLI | 5 | B-22 |
| Pagination and filtering on list endpoints | 3 | `epochs/{n}/jobs` paginates; `GET /jobs`, `GET /deployments` take a limit only |
| Idempotency keys on writes | 5 | create endpoints are not idempotent; holds make double-submits cost money |

## Decentralization (litmus test: "if Cloudana vanished tonight")

| Component | Today | Note |
|---|---|---|
| Orchestration, pricing, verification, billing | Cloudana-operated Worker | FAIL — nothing continues |
| Settlement | Not deployed; when deployed: one poster, guardian Safe, permissionless `finalize`/`claim` | PARTIAL once live and leaves are published |
| Hosting ingress | Cloudana-operated gateway + relay on Cloudflare | centralized by design until B-23 |
| Node software, orchestrator software | Open source; the Node runtime can be run by anyone | an independent operator could run the API, but no node would trust its instruction key without re-pinning |

A capability moves up one class only with evidence recorded in `TEST_EVIDENCE.md` or `PROGRESS.md`.
