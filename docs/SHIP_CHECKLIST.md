# Ship checklist — one coordinated cutover

Why one cutover: the API now wraps every response in an envelope and the homepage, console and API live on one
origin. Shipping the Worker alone breaks the published app.cloudana.io; shipping the frontend alone points at
routes that don't exist yet. Nothing below is done until its box is ticked by a person.

## 0. Decisions (owner)
- [ ] **Origin**: one React build on `cloudana.io` (homepage `/`, console `/control`) and `app.cloudana.io/*` → 301
      `cloudana.io/control/*` (recommended), or keep two origins and rewrite links.
- [ ] **Token economics before publishing the token page**: price unit (µCLD per TMAC ≈ 14, not 1000 per MMAC),
      genesis supply (1M/2M minted vs 250M whitepaper), ρ and budget schedule, CLUSTER_N_MIN ≥ 3, lane-A timing.
      Until decided, the Economics page stays labelled "simulation" and the litepaper says "supply depends on usage".
- [ ] **Credits**: Stripe on or off at launch; faucet policy for testnet credits.
- [ ] **Node image**: publish `ghcr.io/amrdab/cloudana-node-agent` (or pick a registry) and update the two YAML snippets.
- [ ] **Public install path**: the homepage command clones `AmrDab/Cloudana10` — commit `node-agent/` first.
- [ ] **Contact**: privacy contact address; social URLs (X, Discord) or keep them off the page.

## 1. Repository
- [ ] Commit this worktree in reviewable pieces (suggested order): orchestrator v1 API → node-agent + shared/sealed →
      contracts (settlement + tests) → console v2/v3 → homepage → docs/sims. `.gitignore` now excludes nested
      `node_modules/` and `.playwright-mcp/`; `client/api/.env` is deleted (confirm it never reached GitHub with real values;
      rotate anything that did).
- [ ] Add `.gitattributes` (`* text=auto eol=lf`) so the LF→CRLF warnings stop polluting diffs.
- [ ] Delete dead legacy Akash routes shadowed by `/v1/deployments` (`client/api/src/routes/v1/deploy.ts` GET/DELETE).
- [ ] Decide which `/control/legacy/*` pages survive; remove the rest (their vocabulary is marketplace-era).

## 2. Secrets and environment
- [ ] Worker secrets: `JWT_SECRET` (≥ 32 chars), `INTERNAL_API_KEY`, `PINATA_JWT` (rotated), `STRIPE_*` if enabled,
      `TREASURY_ADDRESS`, `CHAIN_RPC_URL`, price env (`PRICE_UCLD_PER_MMAC` after decision 0), `DEV_MODE` unset.
- [ ] Frontend env: `VITE_API_URL=https://api.cloudana.io`, `VITE_WALLETCONNECT_PROJECT_ID` (the 403s), no `VITE_DEV_BURNER`.
- [ ] Revoke MINTER/ADMIN roles from the leaked wallet `0xF29283Dc81D7Ff69AE6B592d86682Bfb998Ac61A`; rotate the key.

## 3. Database (Cloudflare D1)
- [ ] Export/back up the production D1 before anything else.
- [ ] Run the new `schema.sql` against a copy; `ensureSchema()` adds 13 tables and `balances.balance_ucld/held_ucld`.
- [ ] Verify existing balances convert to µCLD (1 CLD = 1e6 µCLD) and that no old column is still read.
- [ ] Seed templates: `POST /v1/admin/templates/refresh` against the Node orchestrator (hundreds of GitHub fetches).

## 4. Contracts (Base Sepolia)
- [ ] Deploy CLDToken (or reuse) + `CloudanaSettlement` with `EPOCH_SECONDS` = the API's; record genesis epoch.
- [ ] Settlement is the only minter; treasury/team allocations per decision 0.
- [ ] Host the keeper (poster key, guardian key separate; ~1.7M gas/week); `KEEPER` env → public API + internal key.
- [ ] Update `shared/addresses.*`, the console's contract links, and the published address list.
- [ ] Known open contract items (not blockers for testnet, blockers for value): treasury share and lane split not
      enforced on-chain, no on-chain vesting/clawback, escrow not per-user, no timelock on roles.

## 5. Orchestrator runtime
- [ ] Confirm the whole job + hosting loop runs Worker-only (jobs, nodes, work, deployments mount on both runtimes), or
      host the Node orchestrator and point `VITE_NODE_API_URL` at it.
- [ ] Probe SSRF guard is on outside `DEV_MODE` (loopback/private endpoints refused) — real nodes need public hosts
      (`CLOUDANA_PUBLIC_HOST=auto`) or tunnels (planned).
- [ ] Rate limits reviewed for the console's poll cadence (deployments reads 300/min, writes 30/min).

## 6. Frontend build
- [ ] `vite build`; the React `/` replaces `landing.html` (keep it as `/journal.html` or delete); `/litepaper.html`,
      `/privacy.html`, `/terms.html` stay static; `_redirects /* /index.html 200`.
- [ ] Cloudflare Pages clean URLs: confirm `/litepaper` → `litepaper.html` in production (dev server differs).
- [ ] `sitemap.xml`, `robots.txt`, canonical URLs, `og:image` absolute (done).
- [ ] Lighthouse a11y ≥ 95 on `/` and `/control`; 0 console errors besides WalletConnect until the project id is set.

## 7. Node agents
- [ ] Publish the image; `kubernetes-daemonset.yaml` secret name `cloudana-fleet` / key `CLOUDANA_FLEET_TOKEN`.
- [ ] One public node online before launch so "Nodes online" isn't 0 and hosting can be demonstrated.
- [ ] Agent resilience verified: stale-timestamp retry, resume after restart (both done locally).

## 8. Cutover
- [ ] Freeze: no edits during the window.
- [ ] Deploy in order: D1 schema → Worker → Pages (one origin) → DNS 301 for app.cloudana.io → keeper start.
- [ ] Smoke: `/health`, `/v1/network`, sign in, run a 32×32 job to done, deploy a static site to running, waitlist signup,
      litepaper/privacy/terms load, old deep links redirect.
- [ ] Watch for 24 h: API error rate, probe failures, keeper posts/finalizes.

## 9. After launch
- [ ] Commit the restored trust signals (status gates, FAQ, difficulty bench) — they must stay accurate as gates close.
- [ ] Revisit `docs/LEGACY_REVIVAL.md` items 2–4 (node logs, hardware scan, decentralization page).
