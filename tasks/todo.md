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

## Progressive Decentralization (direction: no central control plane; plug-and-play, any hardware)

Synthesized from 3 subagents (Opus=architecture, Sonnet=roadmap, Haiku=UX). Key insight:
decentralization is mostly **flipping 3 `onlyRole(ORCHESTRATOR_ROLE)` contract fns into
permissionless, condition-gated ones** + inverting placement push→pull + adding libp2p.
StakingManager + ChallengeManager already provide the fraud-proof trust layer.

### Done this session
- [x] `DECENTRALIZATION_ROADMAP.md` — public 5-phase roadmap w/ litmus test per phase
- [x] `client/src/data/decentralization.ts` + `pages/decentralization.tsx` — transparency
      status page (route `/control/decentralization`, footer link). Type-clean.

### Done (2026-05-28) — backend now boots & is deploy-ready
- [x] **De-Mongo → SQLite** (node:sqlite; server boots, /health 200 verified)
- [x] **Stripe Workers fix** (createFetchHttpClient + constructEventAsync)
- [x] **Deploy-ready**: Dockerfile node:24, deploy.akash.yaml SDL, DEPLOYMENT.md runbook
- [x] **Frontend routing**: VITE_NODE_API_URL for heavy endpoints (api-base.ts; 6 call sites)
- [x] `/v1/gpu-prices` was a FALSE alarm (frontend uses Akash external API, not ours)

### Go-live actions
- [x] Build + push `ghcr.io/amrdab/cloudana-orchestrator` image — AUTOMATED via
      `.github/workflows/build-orchestrator.yml` (CI run 26571586817 green, 52s).
      Builds+pushes on every push to main; no local Docker needed.
- [ ] (you) Fund Akash wallet; deploy via deploy.akash.yaml; add DNS; set VITE_NODE_API_URL

### Build backlog (progressive — Phase 2+)
- [ ] **Confirm Akash deploy path** (akashjs vs k3s-provider) wired to the frontend deploy button
- [ ] **Provider agent pull-loop**: watch WorkloadRegistry → self-select → claim → run → POUW → reward
- [ ] **Contracts**: permissionless `claimWorkload` + condition-gated `claimReward`; trustless POUW
- [ ] **libp2p layer**: DHT discovery + relay/DCUtR NAT traversal + gossipsub; ingress mesh
- [ ] **`/hardware-scan` endpoint** in provider agent (real GPU detection); add arch to reqs
- [ ] One-command provider installer (plug-and-play); IPFS/ENS console (Phase 3)

Subagent design docs: `UX_PROPOSAL.md` (root). Architecture notes captured in this file.

## Review
- Templates restored (504 live). Schema + D1 migration completed.
- Decentralization: roadmap + transparency page shipped; build backlog queued above.
- Pending push: local `main` is many commits ahead of origin/main (unpushed).

## Homepage redesign — "high tech" (2026-09-27, branch site/hightech-homepage)

Goal: replace the paper/newspaper landing with a dark, high-tech page whose animated
background depicts the system (nodes → jobs → hashed transcript → proof → settle), keep
every live instrument (hero miner, replication bench, hardware scan, API check) working.

- [x] Audit live cloudana.io for missing/broken links & loose ends (subagent)
- [x] Creative brief + "what else to add" (Fable subagent)
- [x] Rewrite client/public/landing.html (dark system, canvas network bg, visuals)
- [x] Restyle litepaper/privacy/terms/404 to match (so site isn't half paper)
- [x] Fix audit findings
- [x] Verify: local serve, zero console errors, miner + lab verify, mobile 375px, reduced-motion
- [x] Review pass with subagents (code + design), fix findings
- [ ] Ask before deploy (Cloudflare Pages direct upload, project `cloudana`)

### Review (2026-09-27)
- landing.html rewritten: dark system (Space Grotesk/Inter/Plex Mono), fixed canvas that draws the
  protocol loop (user → job → node → 8×8 transcript → proof → Base settlement, mint / 2% burn /
  result back); real verified certs from the in-page miner fire brighter pulses. Pause button;
  reduced-motion = one still frame. New sections: architecture diagram, live network numbers
  (/v1/pouw/stats + /certificates, honest zero state), Base block tile, hash-rate sparkline, tier meter.
- Subpages (litepaper/privacy/terms/404) restyled to match; privacy lists every 3rd-party call.
- Fixes: console fee split 97.5/2/0.5 (was 75/20/5 and 80/15/5), litepaper "already has value"
  claim removed, 64-hex specimen z, FAQ "will verify", CTAs deep-link to /workload/register and
  /provider/register, σ refreshes after 5 min, WCAG-AA faint text, og.png 1 MB paper → 101 KB dark
  (source: scripts/og/og-card.html), browser-contribute says "prototype" + no 375px overflow, sitemap lastmod.
- Verified (Playwright + Edge headless): 0 console errors; hero + lab mine and independently verify
  (16-bit cert, ~9.8k H/s); no horizontal scroll at 375/1000/1440; nav fits; reduced motion static.
- Needs owner: private contact email (TODO comments in privacy/terms), www.cloudana.io DNS,
  node installer/quickstart, contract addresses for a Basescan panel, testnet launch date.
- Not deployed. Landing deploy = Cloudflare Pages direct upload, project `cloudana`.

## Backend formalisation + homepage v2 (2026-09-28, branch site/hightech-homepage)

### Phase 0 — stop the bleeding  [DONE, verified locally with wrangler dev + signed e2e script]
- [x] client/api/.env untracked (real ORCHESTRATOR_PRIVATE_KEY was committed in 86fa598) — OWNER MUST ROTATE
- [x] payments: JWT only (`jwtPayload.sub`); fake bearer / ?address → 401; new GET /payments/session/:id
- [x] login: server-issued single-use nonce (GET /auth/nonce), replay → 401
- [x] hardware-scan: SSRF guard (public http(s) only, no redirects), JWT required
- [x] rate limits (KV, memory fallback on Node): auth, payments, faucet, pouw/submit, scan, ipfs
- [x] console: wallet sign-in (lib/auth.ts, useWalletAuth), correct payment paths, JWT header
- [x] Pinata pinning moved server-side (POST /v1/ipfs/pin, auth) — VITE_PINATA_JWT removed — OWNER MUST ROTATE the leaked Pinata JWT and set PINATA_JWT as a Worker secret
### Phase 1 — unify
- [x] config/env.ts (zod, lazy, fail-fast) · lib/http.ts envelope · lib/eth.ts
- [x] app.ts shared by worker.ts + index.ts (cors, request-id JSON logs, security policy, /health, /v1/doc, /v1/swagger)
- [x] Node storage: lib/sqlite-d1.ts D1/KV adapters — orchestrator no longer crashes on getD1()
- [x] vitest (62 tests) + CI check job gating the image build
- [x] routes → createRoute/.openapi + envelope (agent running)
- [x] services → getEnv() (agent running)
- [x] console adapts to new envelope; "unavailable" states for Node-only features
### Phase 2 — close the loop
- [x] paid matrix jobs: POST /v1/pouw/job (JWT, debits CLD credits) → claimed → mined → verified → result to owner
- [x] /pouw/submit reports reward + chain-record status honestly; chain_recorded column + opportunistic retry
### Phase 3 — homepage v2 (Fable brief: ≤500 words, 8 screens)  [agents running]
- [x] landing.html + litepaper.html · [x] console `/` → sign-in gateway · [x] OG regenerated
### Phase 4 — owner
- rotate ORCHESTRATOR_PRIVATE_KEY + Pinata JWT; set PINATA_JWT/STRIPE_* Worker secrets
- deploy RewardContract_v2_burn + EmissionController; fund mining pool; host orchestrator (same JWT_SECRET as Worker)
- www DNS; contact email; approve H1 "The proof is the work."

### Review (2026-09-28)
- Verified end to end on a local Worker (wrangler dev, plain — no compat flags): signed-nonce login, JWT-only
  payments, SSRF guard, rate limits, and the FULL PoUW loop (scripts/dev/e2e-loop.sh): wallet pays 0.04 CLD →
  miner claims → mines a real backed cert → API re-executes & verifies → settlement reported
  (reward/chain = not_configured locally) → replay rejected → owner alone reads C = A·B.
- Node orchestrator boots on the shared app with SQLite-backed D1/KV adapters; fails fast without JWT_SECRET.
- Bugs found by running (not by reading): env-migration left `chain-client.ts` reading config at import →
  Worker crashed at startup (fixed: lazy clients); paid jobs accepted difficulty < POUW_MIN_DIFFICULTY and could
  never settle (fixed: clamp at intake); requireAuth/rate-limit still used the old error shape (fixed).
- Tests: 62 → (+ settlement/queue/reward tests, agent) ; CI check job gates the image build.
- Frontend tsc: 121 → 8 pre-existing errors (landing.tsx rewrite + dev sims moved out of the shipped tree).
- Homepage: ~1,580 → ~510 words of copy (607 incl. live hex glyphs), 8 screens, flat system; tokenomics stated
  as designed/not-yet-deployed; console `/` is a sign-in gateway; OG regenerated.
- NOT committed / NOT deployed — awaiting go. Owner items unchanged (Phase 4).

## v1 local build — "simple" (2026-09-28) · spec: docs/BUILD_SPEC_V1.md · LOCAL ONLY, no commits/deploys
- [x] PoUW core: 256-bit PRNG, solveAssigned (d=0, issued σ), fieldHash binding, Freivalds — tests pass
- [x] Contracts: CloudanaSettlement (only minter, lanes A/B invariants, veto, finalize, lazy-mint claims) + local deploy + keeper
- [x] API: nodes/bind/heartbeat/assignment, jobs, submit (binding+verify+Freivalds), µCLD ledger, epochs, verify feed, network
- [x] Node agent: key, detect, benchmark, announce, bind link, heartbeat, solve, submit
- [x] Website: app/ home · run · provide · verify (Fable)
- [x] Integration: scripts/dev/up.sh; e2e user→provider→verifier→epoch→CLD in wallet
- [x] Review pass (Fable + code reviewer), fix, owner evaluates locally

### Review (v1 local build)
- Full loop verified through the website on a clean local stack: bind node (one-time code) → user pays → orchestrator
  assigns (seeded weighted draw) → node computes (d=0, issued σ) → API binds cert to job inputs, re-runs transcript,
  Freivalds on C → ledger (µCLD) → browser verifier (planted tasks caught) → keeper posts epoch on-chain → veto window
  → fees burned → CLD minted to the provider wallet. Every amount reconciled exactly on-chain.
- Tests: pouw 3 suites · API 105 (incl. subsidy race) · contracts 194.
- Found & fixed during integration: nested vs flat matrices (site), job-detail envelope (site), keeper missing internal
  key, noisy bind link, verifier rate limit/backoff, stop script leaving child processes (DB locks), node binding
  hijack (bind code), lane-B budget race (atomic reserve), SQLite adapter batch interleaving (sync transaction).
- Open (owner): all §9 decisions in CLD_ISSUANCE_DESIGN.md; verifier credit identity before credits are redeemable;
  vetoed epochs can't be re-posted (entries stay 'posted'); off-chain credits are dev-backed by the treasury locally.
- Nothing committed, pushed or deployed.

## v2 build — one product, one design system, waitlist (2026-09-29, branch site/hightech-homepage)

Owner ask: "genius level — perfect yet simple", no MVP look, use open-source UI, homepage theme = app theme,
join-the-waitlist + other ways to capture users. Local only; nothing published until owner evaluates.

Decisions (mine, flagged for owner):
- ONE Vite app, ONE token set. Homepage moves into React at `/` (lazy, no wallet stack on first paint); console stays
  at `/control/*` and adopts the homepage tokens (#07090D, Space Grotesk / Inter / IBM Plex Mono, amber=work,
  teal=verified, blue=chain, red=burn). Static landing.html kept as fallback until owner approves the switch.
- Open-source UI: shadcn/ui (already) + Magic UI (MIT, via shadcn registry) + cobe globe (MIT). Attribution in
  THIRD_PARTY_NOTICES.md.
- Waitlist = early access. Every service not yet live shows "Request access" feeding the same waitlist.
- Service catalog with honest status (Live on testnet / Early access / Planned). Nothing claims more than is built.

Phases:
- [x] 0 Fable: creative brief + IA → docs/V2_BRIEF.md (homepage sections, console nav, service catalog, waitlist fields, copy ≤ 400 words)
- [x] 1 Backend: POST /v1/waitlist (zod, honeypot, rate limit, dedupe, referral code + position), GET /v1/waitlist/:code,
      GET /v1/admin/waitlist (internal key, CSV); tests; privacy.html lists what we store
- [x] 2 Design system (index.css tokens, fonts, lib/cld.ts, lib/services.ts, useNetwork, StatusChip, Magic UI vendored): console tokens/fonts = homepage; shared primitives (Status chip, Section, Stat)
- [x] 3 Homepage (React): hero, live network globe, animated protocol beam (users → orchestrator → providers →
      verifiers → chain), service bento, CLD per-job mint, provide (home + datacenter), waitlist, footer
- [x] 4 Console: new shell + Overview + Services catalog; Run / Provide (incl. datacenter fleet) / Verify / Earnings
      ported from /app/*.html; legacy pages kept reachable, not in main nav
- [x] 5 Verify: tsc, api tests, Playwright pass (desktop + 375px, 0 console errors), e2e job loop still green
- [ ] 6 Fable + code review pass; fix; show owner on localhost

### Review (2026-09-30)
- Homepage is React at `/` (pages/home/*, own bundle, no wallet stack, 0 console errors); console at /control
  (ConsoleApp bundle) with 7-item nav; old pages under /control/legacy/* with a banner. One token set for both.
- Waitlist: POST /v1/waitlist (+ stats, referral lookup, admin CSV) — inline form + dialog from every early-access CTA,
  referral link (+5 places/referral), honeypot, rate limit. Verified end to end in the browser (#1, referral link).
- Fleets: POST/GET/PATCH/DELETE /v1/fleets, agent CLOUDANA_FLEET_TOKEN auto-binds; Docker + K8s DaemonSet in node-agent.
- Also: /v1/network/recent, /v1/nodes/mine, optional user price ceiling (maxPriceUcld → 422 above it).
- Verified in a real browser against the local stack: sign in (test wallet) → credits → 64×64 job → assigned →
  proven → done in ~10 s → in-browser Freivalds ✓ → download C; verifier caught a planted wrong answer; fleet token
  issued once; Services/Earnings/legacy render; 375px has no horizontal scroll. API 144/144 tests, tsc clean on new code.
- Reviews: code review (2 bugs fixed: ticker replay, keyboard copy in rows); Fable review (fee copy, "proven" only for
  compute, one real install command, no invented $/kWh, plain H1, tidy early-access rows). Kept ceiling/floor and the
  optional country field because the owner asked for them; Fable's "2.5 % net burn" was wrong (net burn is 2 %).
- Owner: VITE_WALLETCONNECT_PROJECT_ID (403s in console), privacy contact email, social URLs, node image name,
  one-line installer, deploy topology (React `/` replaces static landing.html), legacy pages to retire.

## v3 — globe hero (2026-10-01)
- [x] Wireframe Earth in Three.js (coastline sketch from Natural Earth 50m via world-atlas, precomputed by
      scripts/dev/build-land.mjs → 127 KB), graticule, teal rim, glitch bursts (slice jitter + colour split), 14
      illustrative datacenter hubs, 110 home nodes sampled on land, great-circle data strings with amber (work out) /
      teal (proof back) pulses. Lazy chunk; renders only on screen; still frame under reduced motion.
- [x] Hero: copy left, globe bleeding right, HUD legend with live "N online now · positions illustrative".
- [x] Miner instrument moved to its own "Live" band under the strip.
- Verified: 0 console errors at 1440 and 375, no horizontal scroll; headless (software GL) ~31 fps.
- Owner: replace illustrative hub/home positions once nodes report regions.

## v3 — functional end to end (2026-10-01) · contract: docs/V3_CONTRACT.md
- [x] A Backend: deployments API, hosting/container work types, assignment + probe + hourly billing, templates
      refresh (awesome-akash + curated), node pubkey, sealed-env store, tests
- [x] B Node agent: static hosting runtime, docker runtime (when present), capabilities, sealed-env decrypt, resume
- [x] C shared/sealed.ts ECIES + tests (owned by B)
- [x] D Frontend Run → Deploy tab: templates browser, deploy form, deployments table/detail, seal step
- [x] E Frontend Provide depth + Services catalog (Cloudflare-style, honest) + Security + Coming up sections
- [x] F Tokenomics 20-year simulation (current model) → docs + json + Economics page component
- [x] G Chain: long-run settlement stress test (1040 weekly epochs × 60 providers), gas + invariants, fix findings
- [x] H Me: route pages (Economics routed), flip Static hosting (DONE — real deploy served on :42000, probe ok), site read-through audit running, chain redeploy pending; flip Static hosting to Live only after a real deploy is probed on the local stack,
      run the whole flow in the browser, review pass, lessons

### v3 findings to carry to the owner (from the 20-year sim + chain stress test, 2026-10-01)
- PRICE_UCLD_PER_MMAC=1000 is ~10^7–10^8 above a real clearing price at $0.10/CLD; the unit should be µCLD per TMAC
  (≈14) and the controller needs a floor. Genesis supply (1M/2M minted today vs 250M in the whitepaper) is undecided.
- Cluster test is all-or-nothing (one 60 % operator switches subsidy off for everyone) and CLUSTER_N_MIN=1 lets a lone
  wallet pass → set N_MIN ≥ 3 and block only the dominant operator's own jobs.
- Lane A waits for lane B's vesting before an epoch closes → post fee share + burn at T+24 h, vest subsidy 7 d.
- "No work, no mint" holds today; the idle-capacity protocol work from UNIVERSAL_POUW §5 would break it unless budgeted.
- Contract: vetoed epochs can now be re-posted (one-line fix + test). Being fixed: postEpoch accepted ANY epoch number
  (unbounded subsidy if the poster key leaks). Open: treasury share and lane A/B split not enforced on-chain; no on-chain
  vesting/clawback; escrow has no withdraw and isn't per-user; roles have no timelock; unclaimed rewards never expire.
- Keeper cost ≈ 1.7M gas/week (~$0.05/week at 0.01 gwei on Base); claimFor must be chunked past ~600 leaves.
- Node agent: a stale-timestamp 401 after machine sleep killed the agent → now re-signs and retries once.
- [x] Site read-through audit (31 findings) applied: hosting + storage fees-only (no subsidy), "probed by the
      orchestrator" (not verifiers), hosting CTAs → Deploy tab, earnings estimate hidden until a node is bound + honest
      caption, waitlist accepts every catalog id, Overview strip from the catalog, legacy /mining → Earnings, Faucet
      relabelled "On-chain faucet", "mainnet" removed everywhere, plurals, σ casing, aria-hidden marquee, privacy + terms
      hosting clauses; litepaper/privacy/terms rewritten to current truth; og.png regenerated ("makes a real proof").
- [x] Local stack restarted with the hardened settlement contract; node agent resumed the hosted site from .data on boot (re-queued → re-assigned → running), keeper on the new address.
- [x] Trust signals restored on the homepage: Status band (5 gates, 0 closed, orchestrator-attested disclosure),
      FAQ (6, rewritten for the fee-burn model incl. "Can I earn on testnet?"), difficulty toggle 8/12/16 bits on the
      Live band; footer links Status · FAQ · API health. 0 console errors.
- [x] docs/SHIP_CHECKLIST.md — single-cutover plan (owner decisions, repo, secrets, D1, contracts, runtime, build, agents,
      cutover, after-launch).

## v4 — cloud workstations & GPU rentals (2026-10-02) · contract: docs/WORKSTATIONS.md
vast.ai features mapped onto the orchestrator: spec instead of host list; protocol price per GPU class; on-demand vs
interruptible (preemptible) tiers; templates (Jupyter, VS Code, desktop, PyTorch SSH, ComfyUI, SD WebUI, Ollama, Blender);
SSH + web access; persistent volumes with keep-days; max hours + extend; capacity hint. Fees only, no subsidy.
- [x] Backend: kind "workstation", GPU capability + classifier, assignment filter, preemption, auto-stop, PATCH extend, connect/hours fields, 8 templates, tests
- [x] Node agent: gpu capability (+ device-index allocation, never count=N) (nvidia-smi), --gpus, SSH key env, web token, volumes + housekeeping, selftests
- [x] Console: Workstations tab (spec picker, templates, list/detail with Connect/Extend/Stop), catalog + roadmap entries
- [x] Me: waitlist interest, Deploy tab excludes workstations; verified in the console: CPU-only VS Code workstation created → queued "waiting for a node that fits" (no container node here) → purged. API 192/192, agent selftests 4/4, tsc clean. Status: Early access.
- Owner/follow-ups: price `class:any` at consumer rate but prefer consumer GPUs in assignment (or re-price at assignment); kept volumes are not billed after stop; three templates (ComfyUI, SD WebUI, Ollama) have no login — fine for early access, document; unverified images marked in template-workstations.ts.

## v5 — final homepage before publishing (2026-10-02)
- [x] Font: Bricolage Grotesque (display, 500–800) site-wide via --font-head; Inter body; Plex Mono numbers; static pages too.
- [x] Homepage rebuilt as bold bands: hero globe → Thesis → Roles → How it pays → Services (grouped chips) → Security →
      Provide → Status gates → Waitlist → Footer. Nothing interactive except CTAs and the waitlist.
- [x] Scroll backdrop: six licensed photos (client/public/bg, ≤ 450 KB each, ATTRIBUTION.md) cross-faded per band with
      animated "data strings" (2 animated paths, no SVG filters — a full-viewport blur filter killed rasterization).
- [x] All live instruments moved to /lab (miner with 8/12/16-bit difficulty, live strip, bento, payment diagram, verifier,
      FAQ); linked from nav, footer, litepaper. Lab is the home for "simulations" per the owner.
- [x] Verified at 1440: six bands, crossfade indices advance 0→5 and clear on status/waitlist; 0 console errors; no
      horizontal overflow. 375: no overflow (JS-measured; headless captures of the photo bands time out in software GL).
- [x] Link crawl: 23 pages, 137 URLs. Fixed: /lab nav anchors (now absolute /#…), public 404 page for unknown paths
      (was blank), legacy footer GitHub org link. Retired landing.html / browser-contribute / prototype-verify / app/*
      behind 301s; sitemap has /lab (404 in production until deployed — expected). Remaining noise is legacy-only
      (Akash CORS, ipfs.io, unauthenticated provider-stats) and fonts preconnect hrefs.
- [x] 375/390: no horizontal overflow; hero, thesis, services bands checked visually; 0 console errors.

## Shipped (2026-10-03)
- [x] Committed in 10 reviewable commits on site/hightech-homepage; PR https://github.com/AmrDab/Cloudana10/pull/2
- [x] Production D1 backed up (.backups/, 4.8 MB) before the additive schema migration
- [x] API Worker: uploaded as preview, smoke-tested, promoted (version c17cc85d); TESTNET_CREDITS on
- [x] Two sites, one build: cloudana.io (site) and app.cloudana.io (console); console paths on cloudana.io move to app.
- [x] Live fixes found only in production: legacy 504-template store (mining categories, no curated) → curated-first
      gallery 0.97 MB; static 404.html blocked SPA routing (/lab, /control/*) → removed; CI lacked vite → declared.
- [ ] Merge PR #2 once CI is green
- [ ] Owner: rotate keys from the client/api/.env in public history (86fa598) incl. ORCHESTRATOR_PRIVATE_KEY Worker
      secret; revoke MINTER/ADMIN from 0xF29283Dc81D7Ff69AE6B592d86682Bfb998Ac61A; VITE_WALLETCONNECT_PROJECT_ID;
      INTERNAL_API_KEY Worker secret; deploy settlement contract + keeper on Base Sepolia; publish node image;
      bring one public node online.

## 2026-10-03 — logo + hide-on-scroll nav
- [x] New mark (cloud of two interlocking traces + nodes, after the @Cloudana10 avatar) in LogoMark, favicon set, static pages
- [x] Site nav hides on scroll down, returns on scroll up / focus / open menu
- [x] Built + deployed to cloudana and cloudana-console Pages; smoke tested live (200s, nav hides, no console errors)

## 2026-10-03 — wallet connect restored (regression)
- [x] Console header + sidebar "Connect wallet" opens the Reown modal (wallets, email, socials), then signs in; every in-page Sign in goes through the same flow
- [x] Production build uses the real Reown project ID (was demo-project-id → 403s)
- [x] Verified live on app.cloudana.io: modal lists WalletConnect/Trust/MetaMask/110+, no console errors

## 2026-10-05 — Consensus build (owner approved "do all")
Spec: docs/IMPL_SPEC_2026-10.md. Six parallel workstreams with disjoint file ownership; integration by main session.
- [ ] A Economics (API): nCLD/TMAC + base fee, price controller, 95/3/2, per-operator gate N_MIN 3, 1 h epochs + migration, lane-aware epoch payloads
- [ ] B Payments/legacy: delete faucet + legacy chain writes, IP/ASN credit caps, Stripe off by default, Deposited watcher, retire legacy pages
- [ ] C Contracts + keeper: Settlement v2 (lanes, treasury min, claw), CLDToken v2 (annual mint ceiling), v2 deploy script, keeper Worker
- [ ] D Node security: signed instructions, nonces, hardening + capability gating, 15 s heartbeat, duties off heartbeat, agent fixes, GHCR + cosign workflow
- [ ] E Hosting gateway: *.sites.cloudana.io proxy Worker, probe hash at upload, public route + admin stop
- [ ] F Docs/copy: whitepaper §6, litepaper, roadmap, site copy (95/3/2, wallet-swap messaging), contacts, discord link
- [ ] Integrate: wire crons + migrations, full tests, build, code review, D1 backup, deploy API + Pages; keeper/gateway deploy after owner contract deploy
Owner-only after build: Safe 2-of-3, poster key + funding, run v2 deploy script, Worker secrets (INTERNAL_API_KEY, INSTRUCTION_SIGNING_KEY, POSTER_PRIVATE_KEY), delete ORCHESTRATOR_PRIVATE_KEY, mailboxes, counsel.
- [x] Workstreams A–F complete (see agent reports summarized in session); integration: migrations wired, env vars, public gateway route, Worker + Node cron, fee-split rounding fix (treasury ceil, A trimmed to 98% cap) + bounds test — API vitest 238/238 green, api tsc clean
- [ ] REMAINING: repo-root tsc + vite build, mirror probe/public_host columns in schema.sql, "Test credits" link → /control/run, README staking lines, rerun 20y sim on decided params, code review, commit/PR, D1 backup, deploy Worker + Pages; keeper/gateway after owner contract deploy + secrets

## 2026-10-06 — review fixes (gateway, test credits, deposits, node security)
- [x] Gateway: host-preserving target URL, CSP on every response, null-body statuses, drop content-length with content-encoding, cf cacheTtl 0, timeout bounds headers only
- [x] Test credits: atomic D1 testnet_claims (wallet/IP/ASN), IPv6 /64, unknown IP refused, TRUST_PROXY on Node
- [x] Deposit watcher: batch credit (all-or-nothing), DEPOSIT_CONFIRMATIONS
- [x] Stripe flag via getEnv; public route gets its own rate bucket
- [x] Nodes: publicHost must equal client IP outside DEV_MODE, no host change with live deployments, IPv6 stored without brackets
- [x] Node auth: per-address limits after signature check, per-IP 2000/min, X-Nonce mandatory + atomic D1 nonce table
- [x] Agent: serverNow() for instruction ts, uid 0 refused (both sides), storage quota + driver check, containersReady gate, pre-start hardening re-check, zero-address signer refused
- [x] Workflow: login before overwrite guard, permissions, exact cosign identity
- [x] All suites green: client/api vitest + tsc, gateway vitest + tsc, node-agent tsc + selftest
Review: client/api 251/251 + tsc clean; gateway 14/14 + tsc clean; node-agent tsc clean + 5 selftests (security 84 checks).
Not done (needs a real host, not unit-testable here): zero-address signer refusal and serverNow() wiring are in index.ts top level/loop; covered by the instructions selftest for the verify side only.

## 2026-10-08 — Homepage universe (owner: "lock in", cosmetic, accurate)
Spec: docs/UNIVERSE_SPEC.md + client/src/pages/home/universe/types.ts (binding).
- [ ] A graph.ts (content, accuracy) + ListView/outline
- [ ] B engine/ (canvas, camera, layout, stars, input, LOD, live glow) + unit tests
- [ ] C Universe.tsx shell (HUD, panel, deep links, live data, waitlist, globe reuse) + index.tsx swap
- [ ] Integrate, QA in browser (desktop + mobile, perf, links, a11y), build, PR, deploy

## 2026-10-09 — Universe v2: the globe (owner approved world mocks)
Spec: docs/UNIVERSE_SPEC.md "v2". Data: universe/world (build-world.py).
- [x] World data: 6 regions on 6 continents, 32 real roads (OSRM), 11 cables
- [ ] Globe engine (three.js) implementing UniverseEngine
- [ ] Shell: region dock, search palette, panel tree, landing copy, OSM attribution
- [ ] Integrate, browser QA (desktop + phone + reduced motion), build, PR, deploy

## Homepage "Paper" (2026-10-09)
Owner rejected the globe homepage ("cheap"); picked concept A of four rendered concepts, approved the full-page mock.
- [x] Paper page (`pages/home/paper/`): hero + live numbers, job loop, three ways in, CLD split, security, waitlist
- [x] Dotted world map from repo land data (`scripts/home/build-map.py`), animated arcs, reduced-motion safe
- [x] Lenis on the homepage only; old anchors `#services #pays #status` resolve; universe/globe code removed
- [x] Verified: tsc (4 legacy), tests, build; desktop + phone screenshots; deep link, nav, waitlist, menu probed
- [x] Owner sign-off on the built page ("ship it"), merged + deployed

## V4 step 2 — relay (2026-10-12)
Spec: docs/V4_VERIFIED_SERVICES.md §2 · contract: docs/V4_RELAY_CONTRACT.md · reviews: V4_REVIEW_CLOUD.md, V4_REVIEW_RELAY.md
- [x] shared protocol + HMAC tickets (tests)
- [x] relay Worker: RelayNode Durable Object per node, StreamHub (window, cancel, errors) — unit + workerd e2e with the real agent
- [x] API: ticket route, `relay` capability, fresh-socket placement, relayed status/probes, internal route, webPath
- [x] gateway: relayed proxy with next-node retry, containers full-method only on a separate user-content domain
- [x] agent (builder): relay client, 127.0.0.1 listeners/publishes, B1 conntrack fix, Docker ≥ 28, relay e2e selftest
- [x] workstations stay direct (relay has no WebSocket tunnelling yet); placed on public-host nodes only
- [x] independent code review of the step-2 diff (11 findings; all fixed except deploy-order note, now in the runbook)
- [x] deployed relay (relay.cloudana.io) + API (2026-10-12) — inactive until the owner sets RELAY_TICKET_SECRET
- [ ] owner: RELAY_TICKET_SECRET on api + relay; INTERNAL_API_KEY on api + keeper + gateway (runbook step 8)
- [ ] owner: user-content domain; then gateway on it
- [ ] later: WebSocket tunnelling over the relay (workstations, ComfyUI, Open WebUI)

## V4 step 3 — GPU endpoints (2026-10-12)
Spec: docs/V4_VERIFIED_SERVICES.md §3 · contract: docs/V4_ENDPOINTS_CONTRACT.md
- [x] API: kind `endpoint` = parent + replica child rows; EndpointSpec (port, health, gpu, replicas, auth); per-replica price + hold
- [x] API: placement (relay node, gpu, any-image, anti-affinity), health-path probes, replica re-queue on failed probes, GPU refusal for containers, failure logs
- [x] API: endpoint keys (create/list/revoke, sha256), route with targets + auth + key hashes; `any-image` capability
- [x] gateway: key auth, per-key rate limit binding, random replica + retry with buffered body, JSON errors
- [x] agent: GPUs for containers, health wait + logs on failure, CLOUDANA_ANY_IMAGE, selftests
- [x] tests green: API 285 (+11 endpoints), gateway 28, agent selftests (workstation 82, security 94, relay 69 + e2e 24), relay 12; docs + runbook + README
- [x] independent review: 7 findings fixed (unbounded health wait + stop during wait, admin stop cascade, busy/relay-error probes inconclusive, pro-rata billing + node refusal on probe re-queue, agent ≥ 1.2.0 gate, VRAM-aware GPU pick, logs under the endpoint); API 287, agent 86
- [x] PR #22 merged; API version e5edd7b7 live on api.cloudana.io (2026-10-12); node-agent 1.2.0 image built by CI on main
- [ ] gateway deploy (new KEY_LIMIT binding) still waits for the user-content domain + INTERNAL_API_KEY (runbook step 8)
- [ ] step 7 (console Endpoints tab) next; gateway deploy still waits for the user-content domain + INTERNAL_API_KEY

## Dollar pricing (owner approved 2026-10-12) · docs/TOKENOMICS_USD_PRICING.md · table: docs/PRICES_USD.md
Quote in USD, settle in CLD; testnet reference $0.10/CLD; ledger, split, subsidy and contracts unchanged.
- [x] Economist study + simulation (scripts/sim/usd-pricing.ts); decision recorded in DECISIONS_CONSENSUS
- [x] Owner yes on the price table (three GPU tiers: standard / large / H100-class) — 2026-10-13
- [x] API: USD price env (hourly table, nano-USD/TMAC controller, base fee) × one reference rate; quotes carry {usd, rate, cld, expiresAt}; GPU tiers (shared/gpu-tier.ts) in classification, specs, placement and the agent; legacy class names mapped; agent 1.3.0 minimum
- [x] Console: prices as "$X/h ≈ Y CLD" (Run, Deploy, Workstations, Endpoints, Overview, lab); live table from GET /network (lib/prices.ts). Provide floor stays in CLD (not used by placement yet)
- [x] Homepage + litepaper + whitepaper §5–6 + console docs + catalog copy per the report's §5 and docs/POUW_REVIEW.md §6
- [x] Owner review on localhost, then publish both Pages projects — published 2026-10-14 (PR #30)

## V4 step 7 — console Endpoints tab (owner picked concept A via "go with what you recommend", 2026-10-13)
- [x] Run → Endpoints: list (replicas, failure log tail, call-it, keys create/revoke, events, stop) + create form with live dollar price
- [x] Verified on the local stack with three simulated GPU nodes (running, starting, failed with logs); desktop + 390 px
- [ ] Before listing: TWAP rate module behind a flag; nCLD ledger; subsidy budget as a fraction of supply

## Subsidy pro rata (owner approved 2026-10-13)
- [x] Lane B recorded as ρF per job; closeEpochs scales an over-budget epoch pro rata (fitLaneB); tests (API 288)
- [x] Owner decided 2026-10-21: lane B stays per epoch (no contract change); the v2 contracts deploy as they are

## PoUW fixes (owner go 2026-10-13) · docs/POUW_REVIEW.md §7 "Now"
- [x] Bound C to ±n·maxAbsEntry(n)² so mod-p Freivalds is exact (C + p·K refused)
- [x] Re-execute the transcript over the job's stored A, B (int32 hash wrap no longer binds a different matrix)
- [x] Freivalds before the transcript (garbage costs n², not n³)
- [x] Legacy write routes removed (/pouw/job, /jobs, /job/{id}, /queue, /submit); read-only views kept
- [x] Node decode O(n²r) via the thin factors (n=256 solve 3.1 s → 1.0 s); agent 1.2.1
- [ ] Copy (ρ 0.04, "matrix jobs proven, services probed", Groth16 not started) — with the dollar-pricing copy batch
- [ ] Before mainnet: Freivalds every job + transcript 1-in-k with delayed earnings and claw; on-chain Freivalds challenge

## Storage (step 8) — spec v2 for owner decision (2026-10-13)
- [x] Spec v1 + independent review (17 findings); finding 5 (busy dodged hosting probes) fixed and deployed (PR #31: relay 3e6666fd, API 08e78ae3)
- [x] Spec v2: three phases (network artifacts → buckets with an R2 copy → provider durability at ≥ 14 independent operators)
- [x] Owner decisions (2026-10-15, "go with what you recommend"): phased plan with R2 copy; $0.02/GB-month + $0.01/GB down; Cloudana holds keys; DMCA agent + abuse contact before phase 2 (runbook step 11) — PR #37

## V4 step 6 — report a problem + epoch job list (2026-10-15)
- [x] API (PR #34, live as API b0587e56): POST /v1/deployments/{id}/report (immediate probe through the relay; ≤ 5/account/day, claimed atomically); GET /v1/epochs/{n}/jobs (public; counts what the close posted)
- [x] Billing rule after review: pay for time a probe saw working (deployments.last_ok_at). A failed report probe and recovery from unreachable forgive only the time since the last passing probe; closes "flap 3 probes before each hour = pay nothing" and "fail one check + report = ~59 min free"
- [x] Console button (PR #35): published 2026-10-15
- [ ] Network check counters come with verified mode (step 4)

## Storage phase 1 (2026-10-15) · docs/V4_STORAGE_PHASE1_CONTRACT.md
- [x] Part A: finished jobs' matrices move from D1 to R2 (cloudana-artifacts); verify tasks stop copying matrices (PR #38)
- [x] Contract reviewed (7 findings folded in); review finding #2 was a live hosting-probe hole: a node answering 200 then aborting was never failed — fixed (PR #39)
- [x] Proof library + relay storage class + PROBE_SLOTS 4 (PR #40, relay 8b664f6f)
- [x] API: encrypted copies, placement (network diversity, growing quota, 50% caps), signed storage ops, downloads only while pending, cron checks with re-challenge, suspect audits, cooldowns, expiry; code review's 10 findings fixed (PR #41, API 8e5d2c27)
- [x] Agent 1.4.0 storage role (PR #42); the agent image build had failed on main since #29 (shared/gpu-tier.ts missing from the Docker context) — fixed, PRs now build the image; 1.4.0 published
- [ ] Owner: STORAGE_KEK with the step-2 secrets; then storage nodes (CLOUDANA_STORAGE_GB) start holding copies
- [ ] Phase 2 (buckets): after the content domain (step 8) and the DMCA agent (step 11)

## Owner decisions 2026-10-21 ("go with your recommendations") · docs/DECISIONS_CONSENSUS.md top note
- [x] B-3: remove /control/legacy (routes, pages, hooks, links); calculator + decentralization page rewritten later
- [ ] B-6: Freivalds every job; full re-execution on a random 1 in 10; provider pay held 24 h, clawed on a failed sample, node flagged
- [x] B-9: spec.placement.fleetId (own fleet or partner fleet by id); assignment honours it; console shows the fleet before sealing (PROGRESS 24)
- [x] B-13: relay is the default for every node; direct mode only for GPU workstations until relay WebSocket tunnelling (PROGRESS 23)
- [ ] Owner side: runbook steps 1, 3–7, 11–13 (contracts v2, keeper, escrow, aliases, DMCA, plan, Pinata/Stripe leftovers)
