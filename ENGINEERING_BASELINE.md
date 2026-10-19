# Engineering baseline — 2026-10-19

What Cloudana actually is today, measured from the source tree at `main` (`4bef305`, merge of PR #48), not from the
docs. Written before any change in this engineering pass; later changes are in `PROGRESS.md`.

## 1. What runs where (verified from entry points and configs)

| Component | Entry | Runtime | Deployed? | Evidence |
|---|---|---|---|---|
| API / orchestrator | `client/api/src/worker.ts` → `app.ts` | Cloudflare Worker `cloudana-api`, D1 `cloudana-db`, KV, R2 `cloudana-artifacts`, cron `* * * * *` | Yes (api.cloudana.io, per `tasks/todo.md` and wrangler.toml) | `client/api/wrangler.toml` |
| Node orchestrator (Akash/k3s/ssh2 era) | `client/api/src/index.ts` | Node + embedded SQLite | **No.** Nothing hosts it; the local stack (`scripts/dev/up.sh`) runs `wrangler dev`, not this | `tasks/todo.md` 2026-05-27: "No live Node backend exists"; reachability inventory below |
| Hosting gateway | `gateway/src/index.ts` | Worker on `*.cloudana.run/*` | Built; deploy blocked on owner secrets/domain (runbook step 8) | `gateway/wrangler.toml` |
| Relay | `relay/src/index.ts`, Durable Object `RelayNode` per node | Worker `relay.cloudana.io` | Deployed 2026-10-12; **inactive until `RELAY_TICKET_SECRET` is set** on api + relay | `tasks/todo.md` V4 step 2 |
| Keeper | `keeper/src/index.ts` | Worker, cron `*/5` | **Not deployed**; `SETTLEMENT_ADDRESS` is the zero address | `keeper/wrangler.toml` |
| Contracts v2 | `contract/contracts/v2/*` | Base Sepolia | **Not deployed.** `shared/addresses.baseSepolia.json` has no v2 section; every listed address is marked "compromised key — do not use" | `shared/addresses.baseSepolia.json` |
| Node agent | `node-agent/src/index.ts` 1.4.1 | Docker image `ghcr.io/amrdab/cloudana-node-agent` (CI, cosign) | Image published; **no public node online** (runbook step 10 pending) | `.github/workflows/build-node-agent.yml`, `docs/OWNER_RUNBOOK.md` |
| Console + homepage | `client/src/App.tsx` | Cloudflare Pages (two projects: cloudana.io, app.cloudana.io) | Yes | `tasks/todo.md` |

Consequences that matter for every claim the product makes:

- **No on-chain settlement is happening.** Epochs close in D1 and `reward_entries` accumulate, but no keeper posts them
  and no contract exists to mint. The homepage counter "CLD minted · testnet" is the sum of off-chain ledger entries.
- **No hosting is publicly reachable.** Until the relay secret and the gateway are live, a deployed site has no public
  URL that resolves. "Static hosting — Live · testnet" in `client/src/lib/services.ts` describes a path that works on
  the local stack, not a public one.
- **The orchestrator is one Worker + one D1.** Assignment, verification, pricing, billing and epoch closing are all in
  it. The litmus test in `DECENTRALIZATION_ROADMAP.md` ("if Cloudana vanished tonight") is FAIL, as that document says.

## 2. Build and test baseline (this environment, Node 22.22, npm 10.9)

| Package | Command | Result |
|---|---|---|
| client/api | `tsc --noEmit` | clean |
| client/api | `vitest run` | 35 files, **330 passed** |
| gateway | `tsc`, `vitest run` | clean, **28 passed** |
| relay | `tsc`, `vitest run` | clean, **14 passed** |
| keeper | `tsc`, `vitest run` | clean, **28 passed** |
| node-agent | `npm run type-check`, `npm run selftest` | clean; 8 selftests pass (security 94 checks, relay 69 + e2e 24, workstation 89) |
| contract | `hardhat test` | **224 passing** (compiled offline with solcjs 0.8.20; the sandbox cannot reach binaries.soliditylang.org) |
| repo root (console) | `tsc` | **2 errors**, both in `/control/legacy` pages (`client/src/pages/litepaper.tsx:449`, `client/src/pages/providers-explorer.tsx:66`) |
| repo root | `vite build` | succeeds; `ConsoleApp` chunk is 4.4 MB (1.23 MB gzip) |
| repo root | `test:client` | 3 passed |

CI (`.github/workflows`) covers only `node-agent` (type-check, selftest, build, image) and `client/api` (type-check,
test, and an orchestrator image for the dead Akash path). **Gateway, relay, keeper, contracts and the console have no
CI.**

## 3. Environment limitations of this pass

- Outbound HTTPS to `cloudana.io`, `api.cloudana.io`, `relay.cloudana.io` and `*.workers.dev` is refused by the
  sandbox's network policy (DNS `ENOTFOUND` / proxy 403). **No live endpoint was probed.** Production state above is
  inferred from configs, the owner runbook and the dated notes in `tasks/todo.md`.
- No Docker daemon, no GPU, no Cloudflare credentials, no chain key. Container hardening, relay-through-Cloudflare and
  settlement were exercised only through the packages' own unit/selftests and the local SQLite-backed API.
- The owner-only steps in `docs/OWNER_RUNBOOK.md` that gate production (contract deploy, keeper, relay secret, user
  content domain, first node) cannot be done from here and are tracked as blockers, not as work.

## 4. Architecture as found

```
browser (console, cloudana.io / app.cloudana.io)
   │ JWT (wallet sign-in, HS256, 24 h)
   ▼
cloudana-api Worker ── D1 (nodes, work_jobs, reward_entries, epochs, deployments, bills, storage_*) ── KV (rate limits, nonces fallback) ── R2 (job artifacts)
   │ signed heartbeat instructions (secp256k1 key, pinned in the agent)          │ x-internal-key
   ▼                                                                             ▼
node agent (home PC / fleet) ──outbound wss──▶ relay Worker (RelayNode DO per node) ◀── gateway Worker (*.cloudana.run)
   │ docker (hardened) / static http on 127.0.0.1 / matmul in-process
   ▼
tenant containers · static sites · GPU endpoints · storage copies

keeper Worker (cron) ── x-internal-key ──▶ api /v1/admin/epochs ── postEpoch/finalize/claimFor ──▶ CloudanaSettlementV2 (not yet deployed) ── CLDTokenV2
```

State machines in code:

- Work jobs: `queued → assigned (TTL 60 s) → done | failed (after 3 failed verifications; hold released)`.
- Deployments: `queued → assigned → running ⇄ unreachable → stopped | failed`. There is **no timeout on `assigned`**:
  a node that keeps heartbeating but never reports `running` holds the deployment and the owner's first-hour hold
  indefinitely (`deployment-duties.service.ts` re-sends "start" every beat; only a dead node triggers a re-queue).
- Epochs: `closed → posted → settled`, with `vetoed → closed` re-post; entries `pending → posted → settled | clawed`.

## 5. Reachability inventory (what is live code)

Computed by a transitive import walk from each production entry (static, side-effect and dynamic imports).

**API (`client/api/src`)**: 74 of 115 files (11,969 lines) are reachable from `worker.ts`. **41 files, 10,503 lines
are reachable only from `index.ts`** (the undeployed Node orchestrator): Akash (`akash.service.ts` 533,
`akash-bridge.service.ts` 532), k3s/ssh2 (`k3s.service.ts` 1,586, `ssh2-k3s-adapter.ts`, `build-provider.service.ts`
854), legacy chain writes (`chain-client.ts` 461), the event-driven orchestrator loops, placement, provider logs,
workload status and their routers/schemas. No Worker-reachable file imports Akash, k3s, ssh2, child_process or Mongo.

**Console (`client/src`)**: 187 files (31,370 lines) are reachable. Unreachable pages: 10 files, 1,253 lines
(`mining-dashboard.tsx`, `pricing/index.tsx`, `status.tsx`, `landing.tsx`, old `home/*` bands) plus 681 lines of
libs only they use; 29 unused shadcn `components/ui` files (4,292 lines) and 23 other orphans (2,185 lines) have no
importer at all. The `/control/legacy/*` shell keeps 27 pages + 63 support files (≈19,000 lines) of marketplace-era
UI alive (`user-dashboard`, `workload-register`, `new-deployment/*`, `providers-explorer`), which still use the
vocabulary the owner rejected on 2026-09-28.

## 6. Security posture as found (details and patches in `SECURITY_AUDIT.md`)

Verified fixed since the October review: heartbeat instructions are signed and nonce/timestamp bound
(`instruction-signing.service.ts`, agent `instructions.ts`, pinned signer `0x90ec…a247`); node requests carry a
mandatory single-use nonce checked atomically in D1; the agent refuses plain-http APIs; containers run with
`--cap-drop=ALL`, `no-new-privileges`, pids/memory/storage caps, a tenant bridge with egress DROP to RFC1918 /
link-local / CGNAT, non-root default user, NVIDIA env stripped; hosting is content-hash probed; relayed deployments
publish on 127.0.0.1 only; the gateway no longer leaks node IPs; legacy chain writes are off the Worker.

Still open in code at the start of this pass:

1. **Sealed secrets are not bound to their deployment** (`shared/sealed.ts` has no associated data). The API can
   move a sealed blob from deployment X to deployment Y on the same node, and the node will inject X's secrets into Y.
2. **The console seals to whatever public key the API returns** (`deployments.tsx` `sealNow`) without checking that
   it derives to the assigned node's address. A compromised API can read every tenant secret.
3. **No `assigned` timeout** for deployments (above): stranded holds, unbounded "starting".
4. The draw seed falls back to `local:<ms>` because the production Worker sets no `CHAIN_RPC_URL`; assignments are
   then not replayable by third parties (contradicts `DECENTRALIZATION_ROADMAP.md` phase 1).
5. `relay/.wrangler/state/**` (local Miniflare SQLite files) is committed.
6. Login error responses do not use the API envelope.

## 7. Documentation drift found

- `README.md` describes provider bonds (1000 CLD), a 10-nodes-per-wallet cap, Kubernetes provider nodes, Akash
  architecture, an on-chain WorkloadRegistry/JobEscrow flow and links to four documents that do not exist. None of
  that is the shipped system.
- `docs/SHIP_CHECKLIST.md` still lists `*.sites.cloudana.io`; the gateway moved to `cloudana.run`.
- `instruction-signing.service.ts` `CURRENT_AGENT_VERSION = "1.3.0"` while the agent is 1.4.1.
- `docs/DECISIONS_CONSENSUS.md` header says "Nothing here has been implemented yet"; most of it is.

## 8. Cost/scale observations (not measured under load; from code)

Each heartbeat (every 15 s per node) runs ~12 D1 statements (touch, relay_at, network prefix, nonce insert + sweep,
node row, auto-stop, assign scans, probe scan, bill scan, instruction scans, storage instructions). At 1,000 nodes
that is ~800 statements/s against a single D1 database before any user traffic. The review panel's estimate
(10 nodes ≈ $20/mo, 1,000 ≈ $2,000/mo, 100,000 not feasible as built) stands; no change in this pass alters it.
