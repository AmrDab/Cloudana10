# Cloudana

A decentralized datacenter: home PCs and racks joined under one orchestrator that assigns every job by a weighted
random draw, prices work from utilization, checks the result and settles in CLD on Base. Users never pick a provider;
providers never bid. Only verified, paid work mints CLD.

**Status: Base Sepolia testnet, orchestrator-coordinated.** What works, what is early access and what is only planned
is in [`CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md); the trust model and how it shrinks is in
[`DECENTRALIZATION_ROADMAP.md`](DECENTRALIZATION_ROADMAP.md). Nothing about CLD is a promise of price or return.

## What a developer can do

| Product | How | Checked by |
|---|---|---|
| Matrix compute (PoUW) | `POST /v1/jobs` — priced in USD, settled in CLD, assigned to a node by the draw | Freivalds answer check on every job + transcript re-executed on a random 1 in 10 (every job for a node's first 10), pay held 24 h (**proven**) |
| int8 MLP blocks and int8 models on your own weights | `POST /v1/jobs` with `workType: "int8-mlp"` (agent ≥ 1.7.0) or `"int8-model"` (L ≤ 16 blocks, agent ≥ 1.8.0) | Commit, then drawn segments checked exactly: 2 of 4 per block job (a faked segment caught with p = ½ per job), max(3, L) of 4·L per model job (p ≥ ¼) (**proven**) |
| Static hosting | `POST /v1/deployments` kind `static`, or `cloudana deploy ./dist` → `https://<id>.cloudana.run` (gateway live since 2026-10-18; pages cached at the edge for 5 min) | Content-hash probe every minute (**probed**) |
| Containers, GPU workstations, GPU endpoints | kind `container` / `workstation` / `endpoint` on fleet nodes; secrets sealed in the browser to the node, bound to the deployment | Health probe through the relay (**probed**); a model on your own endpoint is not verified — spot-checked inference is **planned** (B-19) |
| Storage copies (phase 1, job artifacts) | placed on storage-capable nodes by the orchestrator | AES-GCM encrypted copies, Merkle challenges on random 64 KiB leaves (**possession proven**) |
| Provide | one command installs the node agent; bind a wallet; earn per verified job and per probed hour | Signed heartbeat instructions; hardened containers on opted-in nodes |

Tiers: **proven** · **possession proven** · **probed** · **planned** (`ARCHITECTURE.md` §6). Not every job is
re-executed, and settlement is not yet on-chain: the v2 contract awaits the owner's deploy (runbook steps 3–6).

OpenAPI: `GET /v1/doc` on the API; Swagger UI at `/v1/swagger`. Every response uses one envelope
(`{ status: "success", … }` / `{ status: "error", error: { code, message } }`).

## Repository

```
client/api/     API — one Hono app on two runtimes: Cloudflare Worker (api.cloudana.io; D1, KV, R2, relay binding,
                cron) and a Node runtime with embedded SQLite (local dev, tests, independent operators)
client/src/     Homepage (/) and console (/control) — React + Vite, one build, Cloudflare Pages
node-agent/     Provider agent: signed instructions, matmul solver, static hosting, hardened Docker containers,
                GPU workstations/endpoints, relay client, storage copies. Image: ghcr.io/amrdab/cloudana-node-agent
gateway/        Worker serving user content at *.cloudana.run through each node's relay socket
relay/          Worker + one Durable Object per node: nodes connect outbound; no open ports at home
keeper/         Worker (cron) that posts hourly epochs to the settlement contract and pays claims
cli/            `cloudana` command line: deploy a folder as a static site, list, inspect, stop (not on npm yet)
scripts/sim/    Testnet-in-a-box: local chain + API + agents + keeper, honest load, adversary, report
contract/       CLDTokenV2 + CloudanaSettlementV2 (Hardhat, OpenZeppelin); legacy contracts kept for history
pouw/           cuPOW transcript solver/verifier and Freivalds check (Komargodski–Weinstein matmul PoUW)
shared/         Types shared by browser, API and agent: sealed secrets, relay protocol, tickets, storage proofs
docs/           Decisions, specs, reviews, owner runbook (docs/archive: superseded designs)
```

## Engineering documents

| Document | What it answers |
|---|---|
| [`ENGINEERING_BASELINE.md`](ENGINEERING_BASELINE.md) | What was verified to run, test baseline, reachability inventory, drift (2026-10-19) |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Control plane, data plane, edge, provider, trust and settlement |
| [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) | Findings with proof, patch, test and residual risk |
| [`CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md) | Every capability and its verified maturity — the registry the site and console follow |
| [`ENGINEERING_BACKLOG.md`](ENGINEERING_BACKLOG.md) | Ranked gaps with acceptance criteria |
| [`TEST_EVIDENCE.md`](TEST_EVIDENCE.md) | Commands, results, scenarios and environment limits |
| [`DEPLOYMENT_RUNBOOK.md`](DEPLOYMENT_RUNBOOK.md) | Deploy, configure, migrate, back up, roll back |
| [`PROGRESS.md`](PROGRESS.md) | What changed, evidence, blockers, next priorities |
| [`docs/OWNER_RUNBOOK.md`](docs/OWNER_RUNBOOK.md) | The owner-only steps (keys, Safe, contracts, secrets, domain, first node) |
| [`docs/POUW_SIMULATION_REPORT.md`](docs/POUW_SIMULATION_REPORT.md) | The testnet-in-a-box runs: verification cost, cheating strategies, settlement, protocol work |
| [`AGENTS.md`](AGENTS.md) | Rules and checks for coding agents; open work is GitHub issue #95 |

## Run it locally

```bash
npm install                      # console + homepage
cd client/api && npm install     # API
npm run dev                      # Node runtime on :7002 (needs JWT_SECRET; see client/api/.env.example)
cd ../.. && npm run dev          # Vite on :7003 — console at /control
```

The whole stack (local chain, contracts, Worker API, keeper, one node agent) comes up with `bash scripts/dev/up.sh`
(needs a `client/api/.dev.vars`; see `DEPLOYMENT_RUNBOOK.md`). End to end:
`API=http://127.0.0.1:8790 INTERNAL_API_KEY=… npx tsx client/api/scripts/dev/e2e-v1.ts`.

## Tests

```bash
cd client/api && npm run type-check && npm test       # API (vitest, in-memory SQLite behind the D1 interface)
cd gateway && npx tsc --noEmit && npx vitest run      # same for relay/ and keeper/
cd node-agent && npm run type-check && npm run selftest
cd contract && npx hardhat test
npm run check && npm run test:client && npm run build # console
cd cli && npm run type-check && npm test              # command line
```

CI runs all of these (`.github/workflows/ci.yml`, `build-node-agent.yml`).

## Economics in one paragraph

Prices are quoted in US dollars and settled in CLD (testnet reference $0.10/CLD). A job's fee is held when queued and
captured when the result verifies. At settlement the fee is burned and 95 % is minted to the provider, 3 % to the
treasury, 2 % is destroyed; a small capped subsidy (ρ ≤ 0.04) goes to providers in genuinely independent clusters.
Hourly epochs post one Merkle root to `CloudanaSettlementV2`, which enforces the split on every post. No staking, no
bonds, no bidding. Details: `docs/DECISIONS_CONSENSUS.md`, `docs/TOKENOMICS_USD_PRICING.md`.

## Security

Report to `abuse@cloudana.io`. Model, findings and residual risks: [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md). The API
Worker holds no chain key; node instructions are signed by a funds-less key the agent pins; tenant secrets are sealed
in the browser to the node and bound to their deployment; containers run capability-dropped on an egress-filtered
bridge. Testnet contracts are unaudited and testnet CLD has no value.

## License

Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). Versions published before 2026-10-17 were released
under the MIT License.
