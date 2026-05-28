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

## Review
(to be filled in)
