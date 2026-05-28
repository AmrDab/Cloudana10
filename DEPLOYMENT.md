# Cloudana Deployment & Operations

How the backend is structured and how to get it fully operational. Honest about
what's automated vs. what needs you (wallet funding, DNS).

## Architecture (today)

Two backends, one frontend:

| Piece | Runtime | Hosts | Status |
|---|---|---|---|
| **Edge API** | Cloudflare Worker | `api.cloudana.io` | ✅ Live |
| **Node orchestrator** | Node 24 + embedded SQLite | (to deploy — Akash) | ⏳ Not yet deployed |
| **Console** | Cloudflare Pages | `cloudana.app` | ✅ Live |

The **edge API** (`client/api/src/worker.ts`) serves the light, Workers-safe routes:
`auth`, `templates`, `pouw`, `hardware-scan`, `payments`, `faucet`. Data in D1 + KV.

The **Node orchestrator** (`client/api/src/index.ts`) serves the heavy routes that
require Node (ssh2, child_process, Akash SDK, background loops):
`verify`, `build-provider`, `deploy`, `orchestration`, `provider-logs`, `workload-status`.
These currently **404 in production** because the Node server isn't deployed anywhere.
Getting it deployed is what "operational" means.

State: the orchestrator uses **embedded SQLite** (`node:sqlite`, Node 24) — no external
DB. Path via `CLOUDANA_DB_PATH` (default `./data/cloudana.sqlite`); mount a persistent
volume in production.

## Run locally

```bash
cd client/api
npm install
cp .env.example .env   # fill in secrets (see below)
npm run dev            # tsx watch src/index.ts → http://localhost:7002
curl localhost:7002/health
```

Disable the chain/poll loops for a quick boot:
`ORCHESTRATOR_EVENT_DRIVEN_ENABLED=false WORKLOAD_STATUS_POLLING_ENABLED=false`.

## Required env (orchestrator)

Non-secret: `PORT`, `CLOUDANA_DB_PATH`, `CHAIN_NETWORK`, `ORCHESTRATOR_CHAIN_RPC_URL`,
`ORCHESTRATOR_CHAIN_WSS_URL`, `ORCHESTRATOR_RPC_TRANSPORT`.
Secret: `ORCHESTRATOR_PRIVATE_KEY` (has `ORCHESTRATOR_ROLE` — keep it low-value on testnet),
`JWT_SECRET`, and (if payments on the Node side) `STRIPE_SECRET_KEY`.

## Deploy the orchestrator on Akash (decentralized, $0 owned hardware)

> Aligns with the [decentralization roadmap](./DECENTRALIZATION_ROADMAP.md) Phase 1:
> rent decentralized compute rather than deepening the Cloudflare dependency.

**What you provide:** a funded Akash wallet (Keplr + ~$50 in AKT/USDC) and DNS access
for `cloudana.io`. **What's automated:** image build, SDL, server.

1. **Build & push the image — automated.** `.github/workflows/build-orchestrator.yml`
   builds `client/api/Dockerfile` and pushes
   `ghcr.io/amrdab/cloudana-orchestrator:{latest,<sha>}` to GHCR on every push to
   `main` (or via manual **Run workflow**). No local Docker required. The SDL
   references the `:latest` tag, so it always tracks `main`.
   ```bash
   # trigger/verify manually:
   gh workflow run build-orchestrator.yml
   gh run watch "$(gh run list --workflow=build-orchestrator.yml -L1 --json databaseId -q '.[0].databaseId')"
   ```
   Only if you ever need a local build (the Dockerfile copies `client/api`, `shared`, `pouw`):
   ```bash
   docker build -f client/api/Dockerfile -t ghcr.io/amrdab/cloudana-orchestrator:latest .
   ```

2. **Deploy** with the provided SDL `client/api/deploy.akash.yaml`:
   ```bash
   provider-services tx deployment create client/api/deploy.akash.yaml --from <wallet>
   # accept a bid, create the lease, then send the manifest
   provider-services lease-status ...   # prints the provider URI
   ```

3. **DNS**: point `node-api.cloudana.io` (CNAME) at the Akash lease hostname.
   DNS via Cloudflare is fine — that's DNS, not compute.

4. **Point the frontend** at it: set `VITE_NODE_API_URL=https://node-api.cloudana.io`
   in `client/.env` and rebuild/redeploy the console. The heavy-endpoint hooks use this
   base URL (falling back to `VITE_API_URL` when unset, which is why they 404 today).

5. **Verify** end-to-end: provider onboarding (`/control/provider`) and a template deploy
   should now complete instead of 404.

⚠️ **Secrets on Akash**: the SDL is published on-chain and is public. Do not put real
secrets in it. For testnet bootstrap, use a throwaway orchestrator key. This constraint
disappears in roadmap Phase 2, where the orchestrator loses its privileged role.

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
      (`.github/workflows/build-orchestrator.yml`; pushes `:latest` from `main`)
- [ ] Fund Akash wallet; `provider-services` deploy via `deploy.akash.yaml`
- [ ] Add `node-api.cloudana.io` DNS → lease URI
- [ ] Set `VITE_NODE_API_URL`; redeploy console
- [ ] Smoke-test provider onboarding + a template deploy
- [ ] (Phase 2) on-chain `claimWorkload` + trustless POUW — see roadmap
