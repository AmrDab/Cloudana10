# Lessons

## 2026-09-28 — multi-agent backend refactor
- A mechanical refactor agent reporting "tsc passes" is not done: the env-migration pass moved a `process.env`
  read into `getEnv()` at module top level, which type-checks fine and crashes the Worker at startup. After any
  agent pass over services, BOOT both runtimes (wrangler dev + tsx index.ts) before accepting the work.
- Give every agent an explicit file-ownership list and forbid the rest; the one time two agents needed the same
  file (contracts.ts exports), the second agent had to adapt mid-task. Sequence edits to shared files through me.
- Test the product loop, not just the endpoints: the e2e that paid → mined → submitted found the
  difficulty-clamp bug that unit tests and curl probes never would have.
- Reproduce a suspected security bug against the LIVE system before planning around it (the payments bypass
  and the leaked Pinata JWT were both confirmed with one request each).

## 2026-09-28 — describe Cloudana in its own terms
- Correction from owner: Cloudana is NOT a marketplace. It is an orchestrator that sets price from supply and
  demand (whitepaper §5: "No bidding marketplace… pricing is protocol-set"). Providers do not bid; they may set a
  floor (e.g. energy cost) below which they won't take work. Don't import generic DePIN vocabulary
  ("two-sided marketplace", "bids") — check the whitepaper's own model before framing strategy.
- Evaluate attacks against Cloudana's real architecture, not a generic one. I modelled wash trading as
  "payer routes the job to itself"; the owner pointed out the orchestrator assigns jobs by weighted random draw,
  so self-routing succeeds only with probability s (attacker's capacity share) — the safe mint bound is
  M < F·(1/s − 0.975), orders of magnitude looser than my 2.5% bound. Always ask "who decides X here?" first.

## 2026-09-28 — don't let "focus" shrink the owner's vision
- Owner's vision: Cloudana is a decentralized datacenter (a decentralized Cloudflare) on heterogeneous home + datacenter
  servers, fulfilling all digital needs, settled on-chain. I narrowed it to "verifiable batch AI" and then built a v1 UI
  that exposed only that one capability — the owner read it (correctly) as a regression.
- Rule: a strategy narrowing (what to *verify/subsidize first*) must never silently become a product narrowing (what
  users can *see and use*). Keep the full service surface visible with honest status; sequence verification behind it.
- "Simple" means simple to use and understand, not fewer capabilities. Ask before removing anything from the UI.
- I conflated "offer a service" with "mint subsidy for it". Unverifiable services can be offered and paid by fees
  (with probes/attestation/reputation); only the minting subsidy needs a proof.

## 2026-09-29 — CLD is minted per verified job; "epoch" is only settlement
- I told the owner a datacenter "earns each epoch", which read as epoch-based rewards. The model is: each verified
  job mints its own CLD (amount fixed at verification: 0.975F fee-backed + subsidy share), like a PoW block reward.
  The epoch only batches those already-earned per-job amounts into one on-chain Merkle post (gas + veto window).
- Rule: always say "minted per verified job, settled on-chain in batches" — never "earn per epoch".

## 2026-09-30 — delegating big UI builds
- Two builder agents stalled repeatedly (stream watchdog / output filter) while emitting very large files and rewriting
  vendored third-party code wholesale. What worked: I built the shared foundation first (tokens, API client, service
  list, shared components with a written contract), then finished the pages myself in small files.
- Rule: give UI agents narrow, file-scoped tasks with small files; never ask them to regenerate vendored code — wrap it.
- Rule: verify in a real browser, not just tsc. Real bugs found only by looking: homepage pulled the whole wallet stack
  (static imports in App.tsx), NumberTicker froze mid-count on effect re-run, "µ" uppercased to "M", 33 µCLD shown as
  "0.0000 CLD", Tailwind arbitrary max-[480px] variant losing to max-lg.

## 2026-10-01 — never mount old content in a new surface without reading it
- Owner found "Cloudana is an open cloud marketplace — providers list their hardware at a price, users pick the best
  deal" on the new console's Docs page. I had reused the v0 docs.tsx / litepaper.tsx inside the new shell without
  auditing the copy, so the console contradicted the orchestrator model (lesson of 2026-09-28) on a primary nav item.
- Rule: any page reachable from new navigation gets a vocabulary sweep first (marketplace, bid, pick/choose provider,
  per epoch, mining rewards, "proven" for unproven services). Old pages go behind /legacy until rewritten.

## 2026-10-01 — found only by running the real stack
- A shared 30/min rate limit on /v1/deployments* was tripped by the console's own polling within a minute of the
  first real deploy ("Too many attempts" inside the events box). Rule: size read limits from the UI's poll cadence
  (list 5 s + open rows) and keep writes tight; never one bucket for both.
- The long-running node agent died overnight on a stale-timestamp 401 after the machine slept. Rule: agents treat
  auth failures that time can explain as retry-once, and only signature failures as fatal.
- Separate SERVICES (API enum subset) from CATALOG (everything shown) — when the catalog grew to 21, four screens
  silently kept showing 8. Grep every consumer when a shared list changes shape.

## 2026-10-02 — heavy decoration is a performance bug, not a style choice
- A full-viewport SVG with `feGaussianBlur` plus 15 dash-animated paths made the homepage un-rasterizable in software
  GL (every screenshot timed out) and would hurt low-end laptops. Layered low-opacity strokes gave the same glow for
  free; animating two paths instead of fifteen kept the motion. Rule: no SVG filters on full-viewport layers; animate
  the minimum; render decoration only while its band is active.
- Vite re-optimizes deps and force-reloads the page on first import of a new library (three, cobe): a blank capture
  right after adding a dependency is a reload, not a bug — wait and re-check before debugging.
- A hidden browser pane throttles timers: polling loops never finish there. Use the pane only for pages already mounted.

## 2026-10-03 — production surprises the local stack can't show
- Vite loads `.env.local` in production builds: the prod build would have pointed at 127.0.0.1 with the dev wallet on.
  Rule: production overrides live in `.env.production.local`, and grep the built bundle for localhost before deploying.
- Cloudflare Pages ignores SPA fallback when a top-level 404.html exists → every client route 404'd. Rule: SPA builds
  ship no 404.html; the app renders its own.
- Production data differs from fixtures (504 legacy templates incl. mining). Rule: smoke-test the preview Worker
  version (`wrangler versions upload`) against prod data before `versions deploy`.
- CI installs per package: a dep that resolves only via the repo root (vite for vitest) passes locally and fails in CI.

## Rebuilt shells must keep every entry point of the old one
- Pattern: the v2 console layout replaced the legacy AppLayout and silently dropped its `<appkit-button />`; with the test wallet off in production, sign-in had no way to connect a wallet. Also the production build fell back to `demo-project-id`, so the Reown modal 403d.
- Rule: before replacing a layout/shell, grep the old one for user entry points (connect, sign in, nav, CTAs) and list where each lives in the new one. Test production-only paths with the production flags (`VITE_DEV_BURNER=false`), not the dev burner.

## 2026-10-06 — multi-file edits via inline heredocs stall
- Twice an inline `python - <<'EOF'` with TS/Go template strings (`'{{index . 0}}'`, nested quotes) broke bash parsing
  and nothing was applied; the coordinator had to nudge. Rule: any edit script longer than a few lines goes to a
  scratchpad file (Write tool) and is run by path; single-site edits use the Edit tool. Never rely on heredoc quoting
  for content that itself contains quotes.
- A default parameter (`nonce = random()`) is NOT bypassed by passing `undefined` explicitly — a "legacy nonce-less"
  test had been sending a nonce all along. Use `null` for "absent" when a default exists.

## 2026-10-11 — Cloudana is infrastructure, not an AI model provider
- I planned a Cloudana-run inference API with a "launch model" (OpenAI-style). Owner: "Cloudana shouldn't run AI
  models; we should only provide the infrastructure to power AI."
- Rule: Cloudana supplies GPUs, scheduling, routing, endpoints, verification and billing. Users bring their own model,
  engine and image. Never pick, host-as-a-product or brand a model; never sell "Cloudana's model".

## 2026-10-12 — parent/child rows and probe semantics (found by the independent review of V4 step 3)
- When a resource gets children (endpoint → replicas), grep every path that ENDS or ACTS on the parent (owner stop,
  admin stop, purge, preempt, route lookup) and decide what happens to the children in each; I did the owner stop and
  missed the admin stop, and a replica id was routable on its own (around the key). Rule: list the parent's verbs
  first, then write the child behaviour for each, then the tests.
- A probe that fails because the INFRASTRUCTURE refused it (relay `busy`, a binding error) must not count as the app
  being down: counting it turned a load spike into a restart cascade. Rule: probes return pass / fail / inconclusive.
- Any wait the agent does on tenant-controlled I/O needs a hard deadline (not a socket-idle timeout) and must be
  cancellable by a stop; otherwise a tenant can pin a GPU the platform cannot release.

## 2026-10-26 — the thesis is "CLD minted from verified work", not "cheaper hosting"
- Asked about competitors and prices, I steered toward "drop the chain, compete on price, don't chase Cloudflare".
  The owner's thesis is PoUW: CLD is generated by verified work on any hardware (Bitcoin-style, but useful). Price
  comparisons and service catalogues are side questions; a strategy answer that doesn't test the thesis is off-topic.
- Rule: before recommending a pivot, test the thesis with the real code (simulate user + provider + adversary, measure
  verify cost, false rejects, cheat P&L, mint per unit of work) and bring numbers, not opinions. Name the real gaps
  against the analogy (today: zero demand → zero mint; the API, not the network, verifies) as owner decisions.
