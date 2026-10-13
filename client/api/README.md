# client/api — Cloudana API

One app (`src/app.ts`), two runtimes:

- **Cloudflare Worker** (`src/worker.ts`) — `api.cloudana.io`. Storage: D1 (SQL) +
  KV (key-value), bound per request.
- **Node orchestrator** (`src/index.ts`) — not yet deployed. Storage: embedded
  SQLite (`node:sqlite`, `src/lib/sqlite-d1.ts`) against the same `schema.sql`,
  wrapped in the same D1/KV-shaped interface the Worker uses.

`app.ts` wires shared middleware, security policy, routers and the OpenAPI
document once so the two runtimes cannot drift. The Node orchestrator mounts
everything the Worker does, **plus** the routes that need Node (ssh2,
child_process, long-lived loops): `verify`, `build-provider`, `orchestration`,
`workload-status`, `provider-logs`, `deploy` — and runs the background
placement (`orchestrator-loop`/`orchestrator-event`) and workload-status-polling
loops.

For the wider deployment picture (Akash, DNS, Worker secrets, CI) see
[`../../DEPLOYMENT.md`](../../DEPLOYMENT.md). This file is about running and
developing this package.

## Run locally

```bash
npm install
cp .env.example .env   # fill in real values — see "Environment variables" below
npm run dev             # tsx watch src/index.ts → http://localhost:7002
curl localhost:7002/health
```

`npm run dev` fails fast (before listening) if `JWT_SECRET` is not set — see
`src/config/env.ts`, the source of truth for every environment variable and its
default.

To run the Worker build locally instead:
```bash
echo 'JWT_SECRET=dev-secret-min-32-characters-long' > .dev.vars   # gitignored
npx wrangler d1 execute cloudana-db --local --file=./schema.sql
npx wrangler dev --port 8790 --local
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Node orchestrator, watch mode |
| `npm start` | Node orchestrator, no watch |
| `npm run build` | `tsc` compile to `dist/` |
| `npm run type-check` | `tsc --noEmit` |
| `npm test` | `vitest run` |
| `npm run test:watch` | `vitest` watch mode |
| `npm run templates` | Fetch + generate the Akash template gallery seed SQL |
| `npm run rpc` | Ad-hoc RPC transport check (`scripts/test-rpc-transport.ts`) |
| `npm run sdl-parse` | Ad-hoc Akash SDL parse check |
| `npm run build-manifest` | Ad-hoc manifest build check |

End-to-end scripts (not run by CI): `scripts/dev/e2e-auth.mjs` (nonce → sign →
login).

## API surface

- `GET /health` — `{ status: "ok"|"degraded", version, runtime, services }`.
  `runtime` is `"cloudflare-workers"` or `"node"`; `services` reports the DB probe
  (`d1` on the Worker, `sqlite` on Node).
- `GET /v1/doc` — OpenAPI 3.0 JSON.
- `GET /v1/swagger` — Swagger UI.
- `GET /metrics` — Prometheus text format (Node only).

Every JSON response uses one envelope:
- `{ "status": "success", ...data }`
- `{ "status": "error", "error": { "code", "message", "details?" } }`

Error codes and HTTP status (`src/lib/http.ts`): `bad_request` (400),
`validation_failed` (400), `unauthorized` (401), `forbidden` (403), `not_found`
(404), `conflict` (409), `rate_limited` (429), `payload_too_large` (413),
`unprocessable` (422), `upstream_failed` (502), `not_configured` (503),
`internal` (500).

### Auth

```
GET  /v1/auth/nonce?address=0x…   → { nonce, message, expiresAt }   (message valid 5 min, single use)
POST /v1/auth/login { address, message, signature }   → { token, expiresIn: 86400, address }
```
Sign `message` with the wallet, then send `Authorization: Bearer <token>` on
protected routes. **The Worker and the Node orchestrator must share the same
`JWT_SECRET`** or tokens minted by one will be rejected by the other.

Routes requiring a valid JWT (`src/middleware/security.ts` plus per-route
middleware in `payments.ts` / `ipfs.ts`): `/v1/providers/scan`,
`/v1/ipfs/*`, `/v1/payments/*`, and the Node-only
`build-provider`, `build-provider-status`, `update-provider-attributes`,
`orchestration`, `deploy`, `deployments`, `verify` routes.

### Rate limits (`src/middleware/security.ts`, IP-keyed, fixed window)

| bucket | limit | window |
|---|---|---|
| `auth` | 20 | 60s |
| `payments` | 60 | 60s |
| `faucet` | 10 | 3600s |
| `scan` | 10 | 60s |
| `ipfs` | 30 | 60s |

Backed by Cloudflare KV on the Worker, an in-memory map on Node.

### PoUW legacy views (`src/routes/v1/pouw.ts`)

Read-only: `GET /v1/pouw/seed`, `/v1/pouw/stats`, `/v1/pouw/leaderboard`,
`/v1/pouw/certificates`. The legacy write path (`/v1/pouw/job`, `/jobs`, `/queue`,
`/submit`) was removed on 2026-10-13 (docs/POUW_REVIEW.md §7); paid matrix work
goes through `/v1/jobs` and `/v1/work`.

## Environment variables

`src/config/env.ts` is the source of truth (zod schema, parsed lazily, cached).
It throws a readable error listing every invalid variable if validation fails.
`.env.example` lists every key with a placeholder value — copy it to `.env` and
fill in real values for local Node development. Cloudflare Worker bindings/vars
come from `wrangler.toml` + Worker secrets instead of `.env`.

Secrets to set on the Worker with `wrangler secret put <NAME>` (see
`../../DEPLOYMENT.md` for the full list and required/optional conditions):
`JWT_SECRET`, `PINATA_JWT`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`ORCHESTRATOR_PRIVATE_KEY` (only if the Worker itself should pay rewards /
record on-chain), `INTERNAL_API_KEY` (optional).

**Rotate immediately if you haven't**: `client/api/.env` was previously
committed to git with a real `ORCHESTRATOR_PRIVATE_KEY`, and a Pinata JWT was
shipped in the console bundle. Both must be treated as compromised. The file is
now untracked and gitignored, but that doesn't undo the earlier exposure.

## CI

`.github/workflows/build-orchestrator.yml`: the `check` job (`npm run
type-check` + `npm test`) must pass before the `build` job builds and pushes the
orchestrator's Docker image (only on `main`).
