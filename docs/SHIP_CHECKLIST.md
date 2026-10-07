# Ship checklist — one coordinated cutover

Why one cutover: the API now wraps every response in an envelope and the homepage, console and API live on one
origin. Shipping the Worker alone breaks the published app.cloudana.io; shipping the frontend alone points at
routes that don't exist yet. Nothing below is done until its box is ticked by a person.

## 0. Decisions (owner)
Decided 2026-10 in [DECISIONS_CONSENSUS.md](DECISIONS_CONSENSUS.md) (owner: "do all"); build contract in [IMPL_SPEC_2026-10.md](IMPL_SPEC_2026-10.md).
- [ ] **Origin**: one React build on `cloudana.io` (homepage `/`, console `/control`) and `app.cloudana.io/*` → 301
      `cloudana.io/control/*` (recommended), or keep two origins and rewrite links.
- [x] **Token economics** — decided: price `PRICE_NCLD_PER_TMAC=14000` + `BASE_FEE_UCLD=1000`, utilization controller;
      fee split 95 / 3 / 2; testnet genesis fresh 1M, mainnet 100M with vesting; ρ 0.25, budget 80 % of chain allowance
      on testnet, min(chain, 4 % of genesis)/yr halving every 4 yr at mainnet; `CLUSTER_N_MIN=3` per operator; lane A
      closes when the epoch ends; 1 h epochs. The Economics page stays labelled "simulation" until the sim is re-run on
      these parameters (`scripts/sim/tokenomics-20y.ts` still uses 0.975 / 0.005 / 250M).
- [x] **Credits** — decided: Stripe off (`STRIPE_ENABLED` default false); on-chain faucet deleted; `/v1/dev/credits`
      10 CLD/day keyed to identity + wallet with IP/ASN caps; testnet credits have no monetary value; no points/airdrop.
- [x] **Payments** — decided: CLD is the only settlement asset; other assets swap in the user's wallet; cards off.
- [x] **Free tier** — decided: one static site (≤ 2 MB) per verified identity, treasury pays normal fees.
- [x] **Contracts** — decided: fresh CLDToken v2 + CloudanaSettlement v2 under a Safe 2-of-3, fresh poster key;
      abandon 0xF292… and every legacy contract. Deploy script `contract/scripts/v2/deploy.ts`; the owner runs it.
- [ ] **Node image**: publish `ghcr.io/amrdab/cloudana-node-agent` (or pick a registry) and update the two YAML snippets.
- [ ] **Public install path**: the homepage command clones `AmrDab/Cloudana10` — commit `node-agent/` first.
- [x] **Contact** — decided: `privacy@cloudana.io` and `abuse@cloudana.io` are now in terms/privacy.
- [ ] **Mailboxes**: create `privacy@` and `abuse@` (e.g. Cloudflare Email Routing) before the pages go live.
- [ ] **Social URLs** (X, Discord) or keep them off the page.
- [ ] **Counsel**: engage on token classification, payment facilitation and the free tier before CLD carries value.

## 1. Repository
- [ ] Commit this worktree in reviewable pieces (suggested order): orchestrator v1 API → node-agent + shared/sealed →
      contracts (settlement + tests) → console v2/v3 → homepage → docs/sims. `.gitignore` now excludes nested
      `node_modules/` and `.playwright-mcp/`; `client/api/.env` is deleted (confirm it never reached GitHub with real values;
      rotate anything that did).
- [ ] Add `.gitattributes` (`* text=auto eol=lf`) so the LF→CRLF warnings stop polluting diffs.
- [ ] Delete dead legacy Akash routes shadowed by `/v1/deployments` (`client/api/src/routes/v1/deploy.ts` GET/DELETE).
- [ ] Decide which `/control/legacy/*` pages survive; remove the rest (their vocabulary is marketplace-era).

## 2. Secrets and environment
- [ ] Worker secrets: `JWT_SECRET` (≥ 32 chars), `INTERNAL_API_KEY`, `INSTRUCTION_SIGNING_KEY` (not a chain key),
      `PINATA_JWT` (rotated), `TREASURY_ADDRESS`, `CHAIN_RPC_URL`, `SETTLEMENT_ADDRESS`, price env
      (`PRICE_NCLD_PER_TMAC=14000`, `BASE_FEE_UCLD=1000`, `PRICE_CONTROLLER=on`), `EPOCH_SECONDS=3600`,
      `VEST_B_SECONDS=3600`, `LANE_A_PER_MILLE=950`, `TREASURY_PER_MILLE=30`, `DEV_MODE` unset, `STRIPE_ENABLED` unset.
      The API Worker holds **no chain key**.
- [ ] Keeper Worker secrets: `POSTER_PRIVATE_KEY`, `INTERNAL_API_KEY`; vars `API_URL`, `RPC_URL`, `SETTLEMENT_ADDRESS`, `CHAIN_ID`.
- [ ] Frontend env: `VITE_API_URL=https://api.cloudana.io`, `VITE_WALLETCONNECT_PROJECT_ID` (the 403s), no `VITE_DEV_BURNER`.
- [ ] The leaked wallet `0xF29283Dc81D7Ff69AE6B592d86682Bfb998Ac61A` is abandoned with the legacy contracts (decision 0);
      confirm no live code or env references it.

## 3. Database (Cloudflare D1)
- [ ] Export/back up the production D1 before anything else.
- [ ] Run the new `schema.sql` against a copy; `ensureSchema()` adds 13 tables and `balances.balance_ucld/held_ucld`.
- [ ] Verify existing balances convert to µCLD (1 CLD = 1e6 µCLD) and that no old column is still read.
- [ ] Seed templates: `POST /v1/admin/templates/refresh` against the Node orchestrator (hundreds of GitHub fetches).

## 4. Contracts (Base Sepolia)
- [ ] Owner runs `contract/scripts/v2/deploy.ts` (fresh CLDToken v2 + CloudanaSettlement v2, `EPOCH_SECONDS=3600`,
      veto 3600, vest 3600, initial supply 1,000,000 to the treasury Safe); deployer holds no role afterwards.
- [ ] Settlement is the only minter; `MAX_MINT_BPS_PER_YEAR=1000` on the token; treasury address immutable.
- [ ] Deploy the keeper Worker (poster key separate from guardian Safe; cron every 5 min); check `/health`.
- [ ] Update `shared/addresses.baseSepolia.json` (v2 section), the console's contract links, and the published address list.
- [ ] Known open contract items (not blockers for testnet, blockers for value): per-user escrow withdrawal, on-chain
      vesting for the 100M genesis, 48 h timelock on roles, audits, k-of-n posters (see `DECENTRALIZATION_ROADMAP.md`).

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
- [ ] Smoke: `/health`, `/v1/network` (shows `priceNcldPerTmac`, `baseFeeUcld`, `lastSettledEpochAt`), sign in, run a
      32×32 job to done, deploy a static site to running through `*.sites.cloudana.io`, `/control/faucet` redirects to
      earnings, Stripe routes return 503, waitlist signup, litepaper/privacy/terms load, old deep links redirect.
- [ ] Watch for 24 h: API error rate, probe failures, keeper posts/finalizes (first hourly epoch finalized within 2 h).

## 9. After launch
- [ ] Commit the restored trust signals (status gates, FAQ, difficulty bench) — they must stay accurate as gates close.
- [ ] Revisit `docs/LEGACY_REVIVAL.md` items 2–4 (node logs, hardware scan, decentralization page).
