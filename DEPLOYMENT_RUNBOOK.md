# Deployment runbook

Reproducible deployment, configuration, migration, backup and rollback for every component. Owner-only steps (keys,
Safe, contracts, domain, money) are in `docs/OWNER_RUNBOOK.md`; this file is the engineering half and assumes the
owner's secrets already exist where it says so. Everything here was derived from the Wrangler configs, the scripts and
the package manifests in this repository; none of it was executed against production from this environment.

## 0. Topology and order

Deploy order matters because of bindings and shared secrets:

1. **D1 schema** (idempotent) → 2. **relay** (the API and gateway bind its Durable Object class) → 3. **API Worker** →
4. **Pages** (homepage + console) → 5. **gateway** (needs the API's internal key and the user-content zone) →
6. **contracts** (owner) → 7. **keeper** (needs the settlement address and the poster key) → 8. **node agents**.

| Component | Name | Config | Deploy command (from its folder) |
|---|---|---|---|
| API | `cloudana-api` on `api.cloudana.io` | `client/api/wrangler.toml` | `npx wrangler deploy` |
| Relay | `cloudana-relay` on `relay.cloudana.io` | `relay/wrangler.toml` | `npx wrangler deploy` (drops every node socket; deploy rarely) |
| Gateway | `cloudana-gateway` on `*.cloudana.run/*` | `gateway/wrangler.toml` | `npx wrangler deploy` |
| Keeper | `cloudana-keeper` (workers.dev, cron `*/5`) | `keeper/wrangler.toml` | `npx wrangler deploy` |
| Pages | `cloudana` (cloudana.io), `cloudana-console` (app.cloudana.io) | `vite.config.ts`, `client/.env.production.local` | `npm run build` then `npx wrangler pages deploy dist/public --project-name <name>` |
| Node agent | `ghcr.io/amrdab/cloudana-node-agent:<semver>` | `node-agent/Dockerfile`, CI | bump `node-agent/package.json` version; merge to `main`; CI builds, signs (cosign keyless) and attaches an SBOM |
| Contracts | CLDTokenV2, CloudanaSettlementV2 | `contract/scripts/v2/deploy.ts` | owner: `npx hardhat run scripts/v2/deploy.ts --network baseSepolia` with `TREASURY_SAFE`, `GUARDIAN_SAFE`, `ADMIN_SAFE`, `POSTER_ADDRESS`, `GENESIS_TIMESTAMP` |

## 1. Secrets and variables

Never in git. **All five Worker secrets were set on 2026-10-18 and are not set again by hand**: a repeated
`wrangler secret put` replaces the value. `scripts/set-api-secrets.mjs` is not run without the owner: it skips a
secret that is already set, and replaces one only with `--rotate NAME` (owner-approved), with the consequences in the
last column.

| Secret | Where | State | Replacing it |
|---|---|---|---|
| `JWT_SECRET` (≥ 32 chars) | api | set 2026-10-18 | `node scripts/set-api-secrets.mjs --rotate JWT_SECRET` signs everyone out once. The Worker cannot give the old value back, so a rotation that signs nobody out needs the old value kept when it was set: put it as `JWT_SECRET_PREVIOUS` with `JWT_SECRET_PREVIOUS_UNTIL` (unix seconds, ≤ 24 h ahead) *before* the new one lands, remove both after the window |
| `INSTRUCTION_SIGNING_KEY` (secp256k1, not a chain key) | api | set 2026-10-18 — **do not replace** | agents pin its address (`node-agent/src/instructions.ts` `DEFAULT_INSTRUCTION_SIGNER`, shown at `GET /v1/nodes/instruction-key`): `--rotate` cuts every node off until a release pins the new address (OWNER_RUNBOOK step 2) |
| `STORAGE_KEK` (base64 32 bytes) | api | set 2026-10-18 — **do not replace** | `--rotate` makes every stored copy unverifiable; re-encrypt first, ask first |
| `INTERNAL_API_KEY` | api, keeper, gateway | set 2026-10-18 on api + gateway | `node scripts/set-relay-secrets.mjs` (owner only) generates fresh values for **both** relay secrets on every run and replaces them Worker by Worker: hosting through the relay drops for the minute that takes (longer if it stops halfway — run it again). Run it once the keeper is deployed, to give the keeper the key |
| `RELAY_TICKET_SECRET` (≥ 32 chars, same value) | api, relay | set 2026-10-18 | the same script, which always replaces this one too; nodes reconnect with fresh tickets within a minute |
| `POSTER_PRIVATE_KEY` | keeper | owner, `wrangler secret put` | — |
| `PINATA_JWT` | api | optional (IPFS pinning) | — |

Variables live in each `wrangler.toml` `[vars]`. The API's: `CHAIN_NETWORK`, `SITES_DOMAIN=cloudana.run`,
`USD_PER_CLD`, `TESTNET_CREDITS`, price and epoch parameters, `CHAIN_RPC_URL`. The keeper's: `API_URL`, `RPC_URL`,
`SETTLEMENT_ADDRESS` (zero until the owner deploys), `CHAIN_ID`, `CLAIM_CHUNK`. The gateway's: `API_URL`,
`SITES_DOMAIN`, the `KEY_LIMIT` rate-limit binding. `DEV_MODE` must never be set in production; `STRIPE_ENABLED`
stays unset.

Rotation, one line each: `JWT_SECRET` (old value kept → `JWT_SECRET_PREVIOUS` + `JWT_SECRET_PREVIOUS_UNTIL` → `--rotate
JWT_SECRET` → remove the previous after the window; without the old value everyone is signed out once),
`INTERNAL_API_KEY` and `RELAY_TICKET_SECRET` (`set-relay-secrets.mjs`, owner only: both replaced on every run, a
brief relay/hosting outage while it runs),
`INSTRUCTION_SIGNING_KEY` (**agents pin the address**: bump `DEFAULT_INSTRUCTION_SIGNER`, release an agent, then
`--rotate`; or operators set `CLOUDANA_INSTRUCTION_SIGNER`), `STORAGE_KEK` (never without re-encrypting copies; ask
first). Session revocation and sign-in nonces live in D1 (`revoked_tokens`, `login_nonces`), not KV. The KV
namespace carries the IP-keyed public rate limits (the polled and node ones count per isolate), the deposit watcher's
block cursor and hardware-scan records: running out of its quota degrades the limits to per-isolate memory and stops
the deposit cursor until 00:00 UTC.

## 2. Database (D1 `cloudana-db`)

- **Fresh database**: `npx wrangler d1 execute cloudana-db --remote --file=./schema.sql` from `client/api`.
- **Existing database**: nothing to run. `ensureSchema()` (`src/lib/schema.ts`) applies `CREATE … IF NOT EXISTS` and
  tolerant `ALTER TABLE … ADD COLUMN` on the first `/v1/*` request per isolate. This pass added
  `deployments.start_attempts`.
- **Data migrations** are guarded by `schema_meta`: `epoch_seconds` (changing `EPOCH_SECONDS` voids unsettled
  settlement entries — decide before changing it) and `price_unit`. Since B-6 every job's provider pay is booked
  `PAY_HOLD_SECONDS` (24 h) ahead, so a change of `EPOCH_SECONDS` (`migrateEpochs`) now voids at least the last 24 h
  of every provider's pending pay, besides anything not yet posted. Pick the mainnet value once, before value-bearing
  traffic.
- **Backup**: before a deploy that touches the schema, `npx wrangler d1 export cloudana-db --remote
  --output=backup-$(date +%F).sql`. D1 Time Travel restores any point in the last 30 days (7 on the free plan):
  `npx wrangler d1 time-travel restore cloudana-db --timestamp=<RFC3339>`.
- **Restore test**: export, import into a local database (`wrangler d1 execute cloudana-db --local --file=backup.sql`),
  run `scripts/dev/e2e-v1.ts` against `wrangler dev --local`. Do this at least once before the v2 cutover.

## 3. Deploying the API

```bash
cd client/api
npm ci --legacy-peer-deps && npm run type-check && npm test
npx wrangler versions upload            # preview version: smoke it against prod data (tasks/lessons.md 2026-10-03)
# curl the preview URL: /health, /v1/network, /v1/doc, a signed heartbeat from a test node key
npx wrangler versions deploy            # promote
```

Smoke after promote: `GET /health` (`d1: connected`), `GET /v1/network` (`priceNcldPerTmac`, `baseFeeUcld`,
`lastSettledEpochAt`), `GET /v1/nodes/instruction-key` (the pinned address), a console sign-in, one 32×32 job to
done on the owner's node, a static site to `running`.

**Rollback**: `npx wrangler rollback` (previous version) or `npx wrangler versions deploy <id>`. Schema changes are
additive, so rolling the code back is safe; data migrations are one-way (see §2).

## 4. Relay and gateway

Relay first (`relay/`): `npm ci && npx tsc --noEmit && npx vitest run && npx wrangler deploy`. Every connected node
reconnects with a fresh ticket within ~1 minute; in-flight visitor requests fail for that minute. Deploy during low
traffic and rarely.

Gateway (`gateway/`): requires the `cloudana.run` zone with one proxied wildcard record (`* AAAA 100::`, owner step
8), `INTERNAL_API_KEY` set, and the relay deployed (the Durable Object binding resolves at deploy). Smoke:
`https://<running deployment id>.cloudana.run/` serves the site; an unknown id gets the branded 404; a stopped one a
404 with the state.

Rollback for both: `npx wrangler rollback`.

## 5. Pages (homepage + console)

One build serves both hosts (`client/src/App.tsx` redirects console paths to `VITE_CONSOLE_ORIGIN`). Production
overrides live in `client/.env.production.local` (gitignored): `VITE_API_URL=https://api.cloudana.io`,
`VITE_CONSOLE_ORIGIN=https://app.cloudana.io`, `VITE_WALLETCONNECT_PROJECT_ID`. Then:

```bash
npm ci --legacy-peer-deps && npm run check && npm run test:client && npm run build
grep -rl "127.0.0.1:8790\|localhost:8790" dist/public/assets && echo "STOP: local API in the bundle"
npx wrangler pages deploy dist/public --project-name cloudana
npx wrangler pages deploy dist/public --project-name cloudana-console
```

No `404.html` in the build (Pages would stop the SPA fallback). Rollback: Pages → Deployments → "Rollback to this
deployment" for each project.

## 6. Keeper

After the owner's contract deploy: set `SETTLEMENT_ADDRESS` in `keeper/wrangler.toml` from
`shared/addresses.baseSepolia.json` (v2 section) and `npx wrangler deploy`; then the owner sets `POSTER_PRIVATE_KEY`
(`wrangler secret put` at the prompt) and runs `node scripts/set-relay-secrets.mjs`, which gives the keeper
`INTERNAL_API_KEY` together with every other Worker (never set that one by hand: OWNER_RUNBOOK step 5). Health: `GET /health` on the workers.dev URL shows the settlement address, poster balance and
the oldest unsettled epoch age. It is stateless: a failed run resumes from on-chain state and the API's `closed` /
`posted` lists. Expect the first hourly epoch finalized within 2 h (1 h epoch + 1 h veto window). Rollback: `wrangler
rollback`; nothing on-chain needs undoing because every write is idempotent against on-chain state.

**Sampled-check claws (B-6).** A node caught by a sampled transcript check is suspended and the held pay of its
payout wallet is clawed (log line `[jobs] … sampled transcript check failed`). A claw can be undone only for pay still
held (epochs after the open one), so act within the day:
- **False positive** (an honest node, e.g. a broken agent build): `POST /v1/admin/claws/{jobId}/reverse` with
  `X-Internal-Key` restores what that check alone clawed; lift the suspension with
  `DELETE /v1/admin/nodes/{address}/suspend` once the agent is fixed.
- **A fleet node the fleet owner doesn't recognise** (a leaked fleet token): the owner revokes the fleet's token in the
  console first (stops new rogue nodes), then reverse the claw as above.

## 7. Node agents

Home / single machine (Docker ≥ 28 for containers; compute + hosting need only Docker or Node 22):

```bash
docker run -d --name cloudana-node --restart unless-stopped --network host \
  -v cloudana-node-data:/app/dist/node-agent/.data \
  ghcr.io/amrdab/cloudana-node-agent:1.6.0
docker logs -f cloudana-node     # prints the bind link once; open it, connect the payout wallet, sign
```

Fleet (datacenter): `node-agent/deploy/kubernetes-daemonset.yaml` with secret `cloudana-fleet` /
`CLOUDANA_FLEET_TOKEN` from `POST /v1/fleets`; containers additionally need `CLOUDANA_ALLOW_CONTAINERS=1`, root +
`NET_ADMIN`, the docker socket, and Docker's data root on xfs with `pquota` (or btrfs/zfs). Verify an image before
running it: `cosign verify ghcr.io/amrdab/cloudana-node-agent:1.6.0 --certificate-identity
https://github.com/AmrDab/Cloudana10/.github/workflows/build-node-agent.yml@refs/heads/main
--certificate-oidc-issuer https://token.actions.githubusercontent.com`.

Upgrade: pull the new tag and recreate the container; the data volume keeps the identity, binding and running
deployments (`resume()` re-reports them). Agents below `MIN_AGENT_VERSION` get no new work but still receive stops.
Rollback: run the previous tag; a node that cannot open v2 secrets (< 1.5.0) will not be given deployments with secrets.

## 8. Contracts (owner)

`docs/OWNER_RUNBOOK.md` step 4. Engineering follow-up after the deploy: add the `v2` section to
`shared/addresses.baseSepolia.json`, set `SETTLEMENT_ADDRESS` (API var and keeper var), deploy API then keeper, run
one veto drill on testnet (guardian `veto` → API `POST /v1/admin/epochs/{id}/vetoed` → claw one entry → next close
re-posts). A contract bug has no rollback: pause the keeper (disable its cron), post nothing, redeploy fresh contracts
(no state is migrated; the D1 ledger re-closes under new genesis if epochs are voided via `EPOCH_SECONDS`/`schema_meta`).

## 9. Local stack

`bash scripts/dev/up.sh` (local Hardhat chain, contracts, `wrangler dev --local` on :8790, keeper, one agent); needs
`client/api/.dev.vars` with `JWT_SECRET`, `INTERNAL_API_KEY`, `DEV_MODE=true`, `CLUSTER_N_MIN=1`. Without Cloudflare
tooling: the Node runtime (`client/api/src/index.ts`) with the same variables, as in `TEST_EVIDENCE.md` §5.

## 10. Monitoring to have before public workloads (backlog B-20)

External uptime checks on `/health`, `/v1/network`, relay `/health`, keeper `/health`; alerts on
`lastSettledEpochAt` older than 3 h, keeper poster balance low, probe-failure rate, D1 errors. Workers Logs is on for
the keeper (`[observability]`); enable it for the API and gateway too.
