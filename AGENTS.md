# Working on Cloudana (for coding agents)

Cloudana is a compute network: users submit verified jobs and host sites and containers; independent providers run
the hardware; pay is minted in CLD per verified job and settled on-chain (Base Sepolia, testnet). Users bring their
own models: **Cloudana never runs, picks or brands an AI model.** Read `ARCHITECTURE.md` for the shape and
`ENGINEERING_BACKLOG.md` for what is open; each GitHub issue names its files.

## Layout

| path | what | check before a PR |
|---|---|---|
| `client/api` | the API (Hono): runs on Cloudflare Workers (D1, KV, R2) and on Node (`src/index.ts`, SQLite) | `npm ci --legacy-peer-deps && npm run type-check && npm test` |
| `client/src` | console (`/control`) and homepage, React + Vite | repo root: `npm ci --legacy-peer-deps && npm run check && npm run test:client && npm run build` (needs `client/api` installed) |
| `gateway`, `relay`, `keeper` | Workers: sites gateway (`*.cloudana.run`), node relay, settlement keeper | `npm ci && npx tsc --noEmit && npx vitest run` |
| `node-agent` | the provider agent | `npm run type-check && npm run selftest` |
| `contract` | Solidity, hardhat (`contracts/v2` is current) | `npx hardhat compile && npx hardhat test` |
| `cli` | `cloudana` command line | `npm ci && npm run type-check && npm test` |
| `shared`, `pouw` | code shared by API, agent and keeper (verification, relay protocol, matmul proof) | covered by the API and agent checks |
| `scripts/sim/testnet` | local testnet-in-a-box (hardhat + API + 3 agents + keeper) | see `docs/POUW_SIMULATION_REPORT.md` |

CI (`.github/workflows/ci.yml`) runs all of the above on every PR. A PR is mergeable only when it is green.

## Rules

1. **Tests with every change.** A bug fix starts with a test that fails on `main`. New logic (a branch, money,
   security, a parser) gets a test. Keep tests deterministic: no wall-clock timing assertions that depend on machine
   load.
2. **Schema changes go in two places:** the column in `client/api/schema.sql` (fresh databases) and an idempotent
   `ALTER TABLE … ADD COLUMN` appended to the list in `client/api/src/lib/schema.ts` (existing databases). Never
   rewrite or reorder existing entries; never drop columns.
3. **Agent versions.** Never change `CURRENT_AGENT_VERSION` or the `MIN_AGENT_VERSION` default in
   `client/api/src/services/instruction-signing.service.ts`: older agents would lose all work. Gate a new agent
   feature with its own minimum (see `INPUT_FETCH_AGENT`, `wt.minAgent`). Any change under `node-agent/` must bump
   `node-agent/package.json` `version` (the image workflow publishes by version and fails otherwise).
4. **Money paths** (`ledger.service.ts`, `jobs.service.ts` submit/claw, `balance.service.ts`, the v2 contract, the
   keeper) keep their invariants: nothing minted without a verified job or a captured fee; lane A + treasury ≤ fees
   burned; lane B ≤ the epoch budget and the chain allowance; claws are wallet-wide within the hold. Add a test for any
   change here.
5. **No secrets** in code, tests, fixtures, logs or PR text. Secrets are set by the owner with
   `wrangler secret put`; code reads them from the environment and must work (degrade) without them. Never log an RPC
   URL or a token.
6. **Do not commit** `.claude/`, `client/api/.dev-sim-nodes.ts`, `.dev-run-sim/`, `.dev-run-sim-chain.log`,
   `shared/addresses.localhost.json`, or any `.env`.
7. **No new runtime dependency** for something a few lines or the platform can do. Workers code must run on Workers
   (no `fs`, `child_process`, long-lived timers).
8. **Public copy must stay true.** If a change makes a sentence on the homepage (`client/src/pages/home`), the
   console, `README.md`, `docs/Cloudana_Litepaper.md` or `docs/Cloudana_Whitepaper_v2.md` untrue, fix it in the same
   PR. Verification tiers are named exactly: proven · possession proven · probed · planned.
9. **Do not deploy.** No `wrangler deploy`, no `versions deploy`, no contract deployment, no `npm publish`. The owner
   or the lead engineer deploys after review.
10. **Record the work.** Add a numbered entry to `PROGRESS.md` (what, why, tests), update the item's status in
    `ENGINEERING_BACKLOG.md`, and tick it in `tasks/todo.md` when it has a line there.

## Pull requests

- One issue per PR, branch `feat/<short-name>` or `fix/<short-name>`, title in plain words, body: **What**, **Tests**,
  **Not touched**, and "Closes #<issue>".
- Keep the diff to what the issue needs; do not reformat or refactor neighbouring code.
- If the issue is ambiguous or a rule above blocks it, say so in the PR description instead of guessing silently.
