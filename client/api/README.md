# client/api — Cloudana API

One Hono app (`src/app.ts`), two runtimes:

- **Cloudflare Worker** (`src/worker.ts`) — `api.cloudana.io`. Storage: D1 (SQL), KV, R2 (job artifacts); a
  Durable Object binding to `cloudana-relay` for probes through node sockets; a one-minute cron for node duties,
  the price controller, artifacts, storage checks and the deposit watcher.
- **Node runtime** (`src/index.ts`) — the same app on plain Node with embedded SQLite (`node:sqlite`,
  `src/lib/sqlite-d1.ts`, same `schema.sql`) behind the same D1/KV-shaped interface, and the same cron duties on a
  60 s timer. For local development without Cloudflare, for the test suite, and for an independently operated
  orchestrator. Relay and R2 are Cloudflare-only: relayed deployments are not probed here and artifacts stay in SQLite.

`app.ts` wires middleware, security policy, every router and the OpenAPI document once, so the two runtimes cannot
drift. The Akash / k3s / ssh2 orchestration that used to be mounted only on Node was removed on 2026-10-19: it was
never deployed and nothing reached it (`ENGINEERING_BASELINE.md` §5; `git log` keeps it).

For deployment, secrets, migrations and rollback see [`../../DEPLOYMENT_RUNBOOK.md`](../../DEPLOYMENT_RUNBOOK.md);
for the architecture see [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md). This file is about running and developing
this package.

## Run locally

```bash
npm install
cp .env.example .env    # JWT_SECRET is required; see "Environment variables"
npm run dev             # tsx watch src/index.ts → http://localhost:7002
curl localhost:7002/health
```

`npm run dev` fails fast (before listening) if `JWT_SECRET` is not set — `src/config/env.ts` is the source of truth
for every environment variable and its default.

To run the Worker build locally instead (what `scripts/dev/up.sh` does):
```bash
echo 'JWT_SECRET=dev-secret-min-32-characters-long' > .dev.vars   # gitignored
npx wrangler d1 execute cloudana-db --local --file=./schema.sql
npx wrangler dev --port 8790 --local
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Node runtime, watch mode |
| `npm start` | Node runtime, no watch |
| `npm run build` | `tsc` compile to `dist/` |
| `npm run type-check` | `tsc --noEmit` |
| `npm test` | `vitest run` (`tests/**`, in-memory SQLite behind the D1 interface) |
| `npm run test:watch` | `vitest` watch mode |
| `npm run templates` | Fetch the template gallery sources and generate the D1 seed SQL |

End-to-end scripts (not run by CI): `scripts/dev/e2e-auth.mjs` (nonce → sign → login) and `scripts/dev/e2e-v1.ts`
(credits → job → assignment → signed submit → ledger → epoch close) against a local `wrangler dev --local`.

## API surface

- `GET /health` — `{ status: "ok"|"degraded", version, runtime, services }`. `services` reports the DB probe
  (`d1` on the Worker, `sqlite` on Node).
- `GET /v1/doc` — OpenAPI 3.0 JSON, generated from the route definitions. `GET /v1/swagger` — Swagger UI.
- `GET /metrics` — Prometheus text format (Node only).

Every JSON response uses one envelope:
- `{ "status": "success", ...data }`
- `{ "status": "error", "error": { "code", "message", "details?" } }`

Error codes and HTTP status (`src/lib/http.ts`): `bad_request` (400), `validation_failed` (400), `unauthorized`
(401), `forbidden` (403), `not_found` (404), `conflict` (409), `rate_limited` (429), `payload_too_large` (413),
`unprocessable` (422), `upstream_failed` (502), `not_configured` (503), `internal` (500).

Routers (all mounted on both runtimes): `auth`, `account`, `dev` (test credits), `jobs` + `work` (matrix jobs:
enqueue, assignment, node-signed submit), `nodes` (announce, bind, heartbeat with signed instructions, relay ticket),
`nodes-deployments` (status reports), `nodes-storage` (provider copies), `deployments` (static sites, containers,
workstations, GPU endpoints; gateway route; admin stop), `fleets`, `ledger`, `admin-epochs` (keeper), `network`
(public stats), `verify-feed` (browser verifiers), `templates` + `admin-templates`, `payments` (off unless
`STRIPE_ENABLED`), `ipfs`, `hardware-scan`, `pouw` (read-only legacy views), `waitlist`.

### Three identities

| Caller | Credential | Where checked |
|---|---|---|
| User (console, SDK) | JWT from `GET /v1/auth/nonce` → wallet signature → `POST /v1/auth/login`; `Authorization: Bearer` | `middleware/auth.ts`, `middleware/security.ts` |
| Node agent | `X-Node`, `X-Node-Timestamp` (±60 s), `X-Nonce` (single use, 120 s), `X-Node-Signature` over `"<METHOD> <path> <ts> <sha256(body)> <nonce>"` | `middleware/node-auth.ts` |
| Keeper / gateway / admin | `X-Internal-Key` = `INTERNAL_API_KEY` | `routes/v1/admin-epochs.ts` `requireInternalKey` |

Instructions the API sends to nodes (heartbeat `assignment`, `deployments`, `storage`) are signed with
`INSTRUCTION_SIGNING_KEY`; agents pin the signer (`GET /v1/nodes/instruction-key`) and ignore anything else.

### Rate limits (`src/middleware/security.ts`)

Per IP before authentication, per verified node address after it; KV-backed on the Worker (eventually consistent:
an abuse stop, not a precise quota), in-memory on Node. The buckets and limits are listed in that file.

## Environment variables

`src/config/env.ts` is the source of truth (zod schema, parsed lazily, cached). It throws a readable error listing
every invalid variable. `.env.example` lists every key with its default or a placeholder. Worker vars come from
`wrangler.toml`; Worker secrets are set with `wrangler secret put <NAME>` (`JWT_SECRET`, `INTERNAL_API_KEY`,
`INSTRUCTION_SIGNING_KEY`, `RELAY_TICKET_SECRET`, `STORAGE_KEK`, `PINATA_JWT`; `scripts/set-api-secrets.mjs` and
`scripts/set-relay-secrets.mjs` generate and upload them). The Worker holds **no chain key**.

## CI

`.github/workflows/ci.yml` runs `npm run type-check` and `npm test` for this package on every push and pull request.
