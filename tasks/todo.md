# Cloudana — Operational Audit & Fixes

## Findings (verified against live prod 2026-05-27)

1. **Core flows are 404 in production.** Worker (`api.cloudana.io`) mounts only 6 routers
   (auth, templates, pouw, hardware-scan, payments, faucet). The Node-only routers
   (verify, build-provider, deploy, orchestration, provider-logs, workload-status) are
   not deployed anywhere. They can't run on Workers (ssh2, child_process, akash SDK,
   mongo, setInterval).
2. **No live Node backend exists.** ghcr image never published; k8s never deployed;
   no host resolves; Node server can't boot (no MONGODB_URI, exits on connectMongo).
3. **`/v1/gpu-prices`** is called by the frontend but defined in no backend → 404 everywhere.
4. **Akash templates missing from prod.** D1 has ~20 curated templates; the ~309 Akash
   templates were never migrated to D1. The only populate script is Mongo-based + imports
   a non-existent function (broken).
5. **Stripe webhook bug** (deployed Worker): `constructEvent` (sync) throws on Workers →
   needs `constructEventAsync` + fetch HTTP client. Stripe retries forever otherwise.

## Plan

- [x] Fix incomplete D1 migration: add `pouw_certificates` table (commit 2d556ac)
- [x] Investigate infra (no live Node host; Cloudflare-only is what's real)
- [x] **Templates restore** (augment, kept curated 20) — DONE, verified live: 504 templates / 36 categories
  - [x] Write working D1 seeder `scripts/seed-akash-templates-to-d1.ts` (fetch+cache, 60KB readme cap)
  - [x] `scripts/chunk-sql.cjs` — split into <700KB chunks (D1 caps statements at 100KB)
  - [x] Applied to local + remote D1; live /v1/templates-list returns 504 templates
- [ ] **Hosting decision** (user choosing) → then make core flows reachable
- [ ] Fix `/v1/gpu-prices` (decide: implement route or remove frontend calls)
- [ ] Fix Stripe webhook (`constructEventAsync`) in payments router
- [ ] Clean up broken `fetch-templates-to-db.ts` (Mongo, dead import)

## Progressive Decentralization (direction: no central control plane; plug-and-play, any hardware)

Synthesized from 3 subagents (Opus=architecture, Sonnet=roadmap, Haiku=UX). Key insight:
decentralization is mostly **flipping 3 `onlyRole(ORCHESTRATOR_ROLE)` contract fns into
permissionless, condition-gated ones** + inverting placement push→pull + adding libp2p.
StakingManager + ChallengeManager already provide the fraud-proof trust layer.

### Done this session
- [x] `DECENTRALIZATION_ROADMAP.md` — public 5-phase roadmap w/ litmus test per phase
- [x] `client/src/data/decentralization.ts` + `pages/decentralization.tsx` — transparency
      status page (route `/control/decentralization`, footer link). Type-clean.

### Done (2026-05-28) — backend now boots & is deploy-ready
- [x] **De-Mongo → SQLite** (node:sqlite; server boots, /health 200 verified)
- [x] **Stripe Workers fix** (createFetchHttpClient + constructEventAsync)
- [x] **Deploy-ready**: Dockerfile node:24, deploy.akash.yaml SDL, DEPLOYMENT.md runbook
- [x] **Frontend routing**: VITE_NODE_API_URL for heavy endpoints (api-base.ts; 6 call sites)
- [x] `/v1/gpu-prices` was a FALSE alarm (frontend uses Akash external API, not ours)

### Blocked on you (go-live actions — see DEPLOYMENT.md)
- [ ] Build + push `ghcr.io/amrdab/cloudana-orchestrator` image (no Docker on this machine)
- [ ] Fund Akash wallet; deploy via deploy.akash.yaml; add DNS; set VITE_NODE_API_URL

### Build backlog (progressive — Phase 2+)
- [ ] **Confirm Akash deploy path** (akashjs vs k3s-provider) wired to the frontend deploy button
- [ ] **Provider agent pull-loop**: watch WorkloadRegistry → self-select → claim → run → POUW → reward
- [ ] **Contracts**: permissionless `claimWorkload` + condition-gated `claimReward`; trustless POUW
- [ ] **libp2p layer**: DHT discovery + relay/DCUtR NAT traversal + gossipsub; ingress mesh
- [ ] **`/hardware-scan` endpoint** in provider agent (real GPU detection); add arch to reqs
- [ ] One-command provider installer (plug-and-play); IPFS/ENS console (Phase 3)

Subagent design docs: `UX_PROPOSAL.md` (root). Architecture notes captured in this file.

## Review
- Templates restored (504 live). Schema + D1 migration completed.
- Decentralization: roadmap + transparency page shipped; build backlog queued above.
- Pending push: local `main` is many commits ahead of origin/main (unpushed).
