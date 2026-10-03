# Cloudana Deployment & Operations

How the backend is structured and how to get it fully operational. Honest about
what's automated vs. what needs you (secrets, wallet funding, DNS).

## Architecture (today)

One API (`client/api/src/app.ts`), two runtimes, one frontend:

| Piece | Runtime | Hosts | Status |
|---|---|---|---|
| **Edge API** | Cloudflare Worker (`src/worker.ts`) | `api.cloudana.io` | ✅ Live |
| **Node orchestrator** | Node 24 + embedded SQLite (`src/index.ts`) | (to deploy — Akash) | ⏳ Not yet deployed |
| **Console** | Cloudflare Pages (project `cloudana-console`) | `app.cloudana.io` | ✅ Live |
| **Landing site** | Cloudflare Pages, direct upload (project `cloudana`) | `cloudana.io` | ✅ Live |

Both entry points build the same app from `app.ts`, so middleware order, security
policy, routers and the OpenAPI document cannot drift between them. The
**edge Worker** binds Cloudflare D1 (SQL) + KV (key-value) and serves the routes safe to
run there: `auth`, `templates`, `pouw`, `hardware-scan`, `payments`, `faucet`, `ipfs`.

The **Node orchestrator** additionally mounts the routes that need Node (ssh2,
child_process, long-lived loops): `verify`, `build-provider`, `orchestration`,
`workload-status`, `provider-logs`, `deploy`, plus the background placement and
workload-status-polling loops. It uses the same D1/KV-shaped interface backed by
embedded SQLite (`node:sqlite`, `src/lib/sqlite-d1.ts`, same `schema.sql`) — no
external database. These routes **404 in production** because the orchestrator
isn't deployed anywhere yet; deploying it is what "operational" means.

State path via `CLOUDANA_DB_PATH` (default `./data/cloudana.sqlite`); mount a
persistent volume in production.

Both runtimes expose `GET /health`, `GET /v1/doc` (OpenAPI JSON) and
`GET /v1/swagger` (Swagger UI).

## API conventions

Every response is one envelope:
- Success: `{ "status": "success", ...data }`
- Error: `{ "status": "error", "error": { "code", "message", "details?" } }`

Error codes and their HTTP status (`client/api/src/lib/http.ts`):

| code | status |
|---|---|
| `bad_request` | 400 |
| `validation_failed` | 400 |
| `unauthorized` | 401 |
| `forbidden` | 403 |
| `not_found` | 404 |
| `conflict` | 409 |
| `rate_limited` | 429 |
| `payload_too_large` | 413 |
| `unprocessable` | 422 |
| `upstream_failed` | 502 |
| `not_configured` | 503 |
| `internal` | 500 |

### Auth

1. `GET /v1/auth/nonce?address=0x…` — issues a single-use sign-in message (valid 5 min).
2. Sign that exact message with the wallet.
3. `POST /v1/auth/login` `{ address, message, signature }` — verifies the signature
   and returns a JWT (`expiresIn: 86400`, 24h).
4. Send it as `Authorization: Bearer <token>` on protected routes.

Routes requiring a valid JWT (`client/api/src/middleware/security.ts` +
per-route middleware): `/v1/providers/scan`, `/v1/ipfs/*`, all of `/v1/payments/*`,
`/v1/pouw/jobs`, `/v1/pouw/job/{id}` (read result only if you're the payer),
`POST /v1/pouw/job` (or `X-Internal-Key` — see PoUW below), and the Node-only
surfaces `build-provider`, `build-provider-status`, `update-provider-attributes`,
`orchestration`, `deploy`, `deployments`, `verify`.

**The Worker and the Node orchestrator must share the same `JWT_SECRET`** — a
token minted by one must be accepted by the other.

### Rate limits

Fixed-window, keyed by client IP (`client/api/src/middleware/security.ts`,
backed by KV on the Worker, in-memory on Node):

| bucket | limit | window |
|---|---|---|
| `auth` (`/v1/auth/*`) | 20 | 60s |
| `payments` (`/v1/payments/*`) | 60 | 60s |
| `faucet` (`/v1/faucet/claim`) | 10 | 3600s |
| `pouw-submit` (`/v1/pouw/submit`) | 60 | 60s |
| `scan` (`/v1/providers/scan`) | 10 | 60s |
| `ipfs` (`/v1/ipfs/*`) | 30 | 60s |

### PoUW paid-job loop

- `POST /v1/pouw/job` (JWT, or `X-Internal-Key: <INTERNAL_API_KEY>` to seed work
  without charge) — queues a real matrix multiplication. A signed-in wallet is
  charged `POUW_JOB_PRICE_CLD × (n/64)^1.5` CLD credits; `difficulty` is clamped
  up to `POUW_MIN_DIFFICULTY`.
- `GET /v1/pouw/job?provider=0x…` — a miner claims the next queued job.
- `POST /v1/pouw/submit` — a miner submits its certificate (+ result if backed by
  a job). Verified by **full re-execution** of the matrix multiply, not just
  hash-checking. The response includes a `settlement` object:
  - `settlement.reward.status`: `paid` | `skipped` | `failed` | `disabled` | `not_configured`
  - `settlement.chain.status`: `recorded` | `pending` | `failed` | `not_configured`
- `GET /v1/pouw/job/{id}` (JWT) — status always; `result` only to the wallet that paid.
- `GET /v1/pouw/jobs` (JWT) — the caller's own jobs.
- `GET /v1/pouw/queue` — queue depth and current price at n=64.

Settlement columns (`backed_by_workload`, `workload_id`, `reward_status`,
`reward_wei`, `reward_tx`, `chain_status`, `chain_tx`, `chain_attempts`) are added
to `pouw_certificates` at runtime via `ALTER TABLE`
(`client/api/src/services/certificate-store.service.ts`) so older databases pick
them up automatically; `schema.sql` documents them in a comment rather than the
`CREATE TABLE` itself.

## Secrets

**Rotate immediately if you haven't**: `client/api/.env` was previously committed
to git with a real `ORCHESTRATOR_PRIVATE_KEY`, and a Pinata JWT was shipped in the
console bundle. Both are compromised. The file is now untracked and gitignored,
but the old key material must be rotated regardless of history rewriting.

Set on the Cloudflare Worker with `wrangler secret put <NAME>`:

| Secret | Required when |
|---|---|
| `JWT_SECRET` | Always — must match the Node orchestrator's |
| `PINATA_JWT` | IPFS pinning is used |
| `STRIPE_SECRET_KEY` | Payments are enabled |
| `STRIPE_WEBHOOK_SECRET` | Payments are enabled |
| `ORCHESTRATOR_PRIVATE_KEY` | Only if the Worker itself should pay rewards / record certificates on-chain |
| `INTERNAL_API_KEY` | Optional — lets a trusted internal caller seed PoUW jobs without a wallet |

The Node orchestrator reads the equivalent values from its environment (see
`client/api/.env.example` and `client/api/README.md`).

## Local dev

**Worker** (`client/api/wrangler.toml`):
```bash
cd client/api
echo 'JWT_SECRET=dev-secret-min-32-characters-long' > .dev.vars   # gitignored
npx wrangler d1 execute cloudana-db --local --file=./schema.sql
npx wrangler dev --port 8790 --local
```
`.dev.vars` is gitignored; it must at least set `JWT_SECRET`.

**Node orchestrator**:
```bash
cd client/api
npm install
cp .env.example .env   # fill in secrets — see README.md for the full variable list
npm run dev            # tsx watch src/index.ts → http://localhost:7002; fails fast if JWT_SECRET is missing
curl localhost:7002/health
```

Checks: `npm run type-check` (tsc), `npm test` (vitest). End-to-end scripts:
`scripts/dev/e2e-auth.mjs`, `scripts/dev/e2e-loop.sh`.

## CI

`.github/workflows/build-orchestrator.yml`: the `check` job (`npm run type-check`
+ `npm test`) gates the `build` job, which builds `client/api/Dockerfile` and
pushes `ghcr.io/<owner>/cloudana-orchestrator:{latest,<sha>}` — only from pushes
to `main`.

## Deploy the orchestrator on Akash (decentralized, $0 owned hardware)

> Aligns with the [decentralization roadmap](./DECENTRALIZATION_ROADMAP.md) Phase 1:
> rent decentralized compute rather than deepening the Cloudflare dependency.

**What you provide:** a funded Akash wallet (Keplr + ~$50 in AKT/USDC), DNS access
for `cloudana.io`, and the secrets above set as environment variables in the SDL
or lease config. **What's automated:** image build.

1. **Build & push the image — automated.** CI pushes `:latest` from `main` (see
   above), so the SDL (`client/api/deploy.akash.yaml`) always tracks `main`.
   ```bash
   gh workflow run build-orchestrator.yml
   gh run watch "$(gh run list --workflow=build-orchestrator.yml -L1 --json databaseId -q '.[0].databaseId')"
   ```
   Local build only if needed (the Dockerfile copies `client/api`, `shared`, `pouw`):
   ```bash
   docker build -f client/api/Dockerfile -t ghcr.io/amrdab/cloudana-orchestrator:latest .
   ```

2. **Deploy** with `client/api/deploy.akash.yaml`:
   ```bash
   provider-services tx deployment create client/api/deploy.akash.yaml --from <wallet>
   # accept a bid, create the lease, then send the manifest
   provider-services lease-status ...   # prints the provider URI
   ```

3. **DNS**: point `node-api.cloudana.io` (CNAME) at the Akash lease hostname.

4. **Point the frontend** at it: set `VITE_NODE_API_URL=https://node-api.cloudana.io`
   in `client/.env` and rebuild/redeploy the console.

5. **Verify**: provider onboarding (`/control/provider`) and a template deploy
   should complete instead of 404.

⚠️ **Secrets on Akash**: the SDL is published on-chain and public. Do not put real
secrets in it directly; use a throwaway orchestrator key for testnet bootstrap.
This constraint goes away in roadmap Phase 2, where the orchestrator loses its
privileged role.

## Templates

D1 is seeded with the curated set + the full Akash gallery (504 templates). To refresh:
```bash
cd client/api
npm run templates            # fetch + generate akash-templates-seed.sql (cached to akash-gallery.json)
node scripts/chunk-sql.cjs   # split into <700KB chunks (D1 caps statements at 100KB)
for f in seed-chunks/chunk-*.sql; do npx wrangler d1 execute cloudana-db --remote --file="$f"; done
```

## Go-live checklist

- [x] Build & push `cloudana-orchestrator` image — **automated via CI**
- [ ] Rotate `ORCHESTRATOR_PRIVATE_KEY` and the leaked Pinata JWT
- [ ] Set Worker secrets (`JWT_SECRET`, `PINATA_JWT`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, optionally `ORCHESTRATOR_PRIVATE_KEY`/`INTERNAL_API_KEY`)
- [ ] Fund Akash wallet; `provider-services` deploy via `deploy.akash.yaml` — use the **same `JWT_SECRET`** as the Worker
- [ ] Add `node-api.cloudana.io` DNS → lease URI
- [ ] Set `VITE_NODE_API_URL`; redeploy console
- [ ] Smoke-test provider onboarding + a template deploy + `/v1/pouw/job` → `/v1/pouw/submit` loop
- [ ] (Phase 2) on-chain `claimWorkload` + trustless POUW — see roadmap
