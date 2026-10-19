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

## Evidence summary

| Suite | Baseline | Now |
|---|---|---|
| client/api vitest | 330 | **334** |
| gateway / relay / keeper | 28 / 14 / 28 | 28 / 14 / 28 |
| node-agent selftests | 8 pass | 8 pass (sealed now 26 checks) |
| contracts | 224 (offline solc) | 224 |
| repo-root tsc | 2 errors | **clean** |
| e2e work pipeline | script did not run | **43 checks pass** |

## The ten gaps, where they stand

| # | Gap | State |
|---|---|---|
| 1 | No live settlement | **Owner** (runbook 3–6). Engineering side ready: contracts tested, keeper tested, deposit watcher inactive until `SETTLEMENT_ADDRESS`. |
| 2 | Nothing publicly reachable | **Owner** (runbook 8–10). Gateway/relay tested; hosting labelled early access until then. |
| 3 | D1 heartbeat cost | Open (B-5), documented with the statement count. |
| 4 | Orchestrator not independently checkable | Partly: seeds now replayable (`CHAIN_RPC_URL`); public epoch job lists verified by the e2e; publishing leaves/draws signed is B-2. |
| 5 | Verification cost = work cost | Open (B-6). |
| 6 | Auth without revocation/scopes | Open (B-7). |
| 7 | No fleet/GPU node | **Owner** (runbook 10). |
| 8 | Legacy UI reachable | Reduced (68 orphan files gone); `/control/legacy` needs the owner's call (B-3). |
| 9 | Rogue API can choose the node for secrets | Mitigated (secrets bound to deployment, key verified); fleet pinning is B-9. |
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

B-2 publish and sign epochs and draws → B-5 measure and cut heartbeat cost → B-11 ledger invariant → B-12 per-replica
sealing in the console → B-7 API keys and token lifecycle → B-13 retire direct mode / resolve-and-pin → B-14 container
logs through the relay → B-15 custom domains.

## Not done, and why

- No production verification: the sandbox cannot reach `cloudana.io`, the Workers or the chain. Every "verified"
  in these documents is code + tests + the local runtime.
- No load test, no container escape test, no browser pass of the console (`TEST_EVIDENCE.md` §4).
- `/control/legacy` (19 k lines) left in place: removing it changes what users can reach, which the owner asked to
  decide (`tasks/lessons.md` 2026-09-28).
- No pull request opened: not requested.
