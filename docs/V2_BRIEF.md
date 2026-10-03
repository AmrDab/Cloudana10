# Cloudana V2 — Creative brief & information architecture

Status: **implement verbatim** · 2026-09-29 · design + product lead
Scope: homepage becomes the React route `/`; console at `/control` adopts the same tokens. One Vite/React app, one design system (shadcn/ui + Magic UI + framer-motion + lucide).
Source of truth for claims: `docs/UNIVERSAL_POUW.md`, `docs/CLD_ISSUANCE_DESIGN.md`, `tasks/lessons.md`. If this brief and those disagree on a fact, those win; on design, this brief wins.

---

## 1. Design principles

1. **Colour means something, always.** Amber = work in progress, teal = verified, blue = on-chain settlement, red = burn. Never decorative.
2. **Show the machine, don't describe it.** Every section has one live or real thing (a real hash, a real number, a real proof). Prose is the caption, not the content.
3. **Instrument, not brochure.** Panels, mono readouts, hairline borders, dense but calm. Nothing bounces; things *settle*.
4. **Honest by construction.** Zero is shown as zero. Status chips are data, not marketing. "Measured", never "proven", for anything without a proof.
5. **One vocabulary.** Orchestrator (not marketplace). Assigned (not bid). Minted per verified job, settled in batches (never "per epoch"). Provider / User / Verifier.

### Token table (single `tokens.css`, consumed by Tailwind v4 `@theme` and shadcn CSS vars)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#07090D` | page |
| `--bg-2` | `#0C1017` | status strips, footer, sidebar |
| `--panel` | `#111722` | cards, instruments |
| `--panel-2` | `#161D2A` | nested surfaces, hover lift, diagram boxes |
| `--line` | `rgba(148,163,184,.12)` | default hairline |
| `--line-2` | `rgba(148,163,184,.22)` | card borders, focused hairline |
| `--text` | `#E6EAF0` | primary text |
| `--muted` | `#8B95A7` | secondary text |
| `--faint` | `#7A8699` | labels, captions |
| `--work` | `#F2A93B` | computing, early-access chip |
| `--ok` | `#3FD6C2` | verified, live chip, primary CTA fill, focus ring |
| `--chain` | `#5B8DEF` | settlement, Base, tx links |
| `--burn` | `#E5484D` | burn, destructive, errors |
| `--font-head` | Space Grotesk 400/500/600 | display + UI |
| `--font-body` | Inter 400/500 | paragraphs > 20 words, form help |
| `--font-mono` | IBM Plex Mono 400/500 | numbers, hashes, labels, chips |

**shadcn mapping:** `--background=--bg`, `--card=--panel`, `--popover=--panel-2`, `--border=--line-2`, `--primary=--ok` (fg `#04201C`), `--secondary=--panel-2`, `--muted-foreground=--muted`, `--destructive=--burn`, `--ring=--ok`, `--accent=--work` (fg `#1B1204`). Sidebar uses `--bg-2`.

**Radius:** 6px chips/inputs · 8px buttons/cards · 12px hero instrument and modals. Nothing rounder. Pills only for status chips (`rounded-full` allowed there only).
**Borders:** 1px everywhere. Cards `--line-2`, dividers `--line`. No 2px borders, no drop shadows on cards.
**Surfaces:** at most three stacked levels visible at once (`--bg` → `--panel` → `--panel-2`). Glass (`backdrop-blur 14px`, `rgba(7,9,13,.72)`) only on the sticky nav and sidebar.
**Glow:** two permitted uses. (a) verified state: `box-shadow 0 0 0 3px rgba(63,214,194,.18)` on the LED / border, 400ms in, held. (b) `BorderBeam` on the hero instrument and the waitlist card, `size=120 duration=12 colorFrom=--work colorTo=--ok`, one beam. No text glow, no gradient text.
**Type scale:** 12 / 14 / 16 / 20 / 28 / 40 / 64. Line height 1.05 (display), 1.15 (h2), 1.55 (body). Letter-spacing −.03em display, −.02em h2, +.08em uppercase mono labels. Numbers use `font-variant-numeric: tabular-nums`.
**Spacing:** 8px rhythm. Section padding 128px desktop / 80px mobile. Max content width 1120px, gutter 24px (16px < 480px).
**Motion rules:** durations 150ms (hover), 250ms (state), 400ms (reveal). Easing `cubic-bezier(.2,.8,.2,1)`. Reveals: opacity + 8px translate, once, on 20% intersection, stagger 40ms, cap 6 children. `NumberTicker` 800ms only on first paint; later updates cross-fade the digits in 250ms. No parallax, no scroll-jacking, no infinite decorative loops except the hero miner (which is real work) and the marquee (which pauses on hover). `prefers-reduced-motion: reduce` → all framer/Magic animations set to `duration:0`, tickers render final value, BorderBeam hidden, marquee static, hero miner still runs but cells snap without the 300ms pause, background canvas off by default.

---

## 2. Homepage — `/`

Total visible copy target: ≤ 350 words (counted below at 331, excluding nav, footer link labels, chip labels and live numbers).
Live data: one hook `useNetwork()` polling `GET /v1/network` every 15s (fields: `nodesOnline, nodesBound, jobsQueued, jobsDone, certificates, mintedUcld, burnedUcld, verifiersToday, epoch, priceUcldPerMmac`). Unavailable → show `—` with a faint "api offline" caption; never fake, never hide.

### 0. Nav (sticky, glass)
Left: logo mark + `CLOUDANA`, `Testnet` pill (`--work` outline).
Center links: `Services` · `How it pays` · `Provide` · `Docs`.
Right: ghost `Open console` → `/control`; primary `Join the waitlist` → scrolls to §8.
Mobile: links collapse into a sheet (shadcn `Sheet`); the two buttons stay.

### 1. Hero — the proof is the work
Purpose: state the thesis in one line and prove it in the same viewport.
Copy:
- H1: **The proof is the work.**
- Sub: One decentralized datacenter — home PCs to full racks — where every job is assigned, proven, and pays CLD.
- CTA primary: `Join the waitlist` · CTA ghost: `Open console →`
Visual: left column copy; right column the **live cuPOW instrument** (custom, port of the existing miner: real matrices, real SHA-256, σ from the latest Base Sepolia block; n=32 r=8 d=8). Wrap in `BorderBeam`. Behind the whole hero: Magic UI `DotPattern` (`cr=1`, fill `--line-2`, radial mask fading to transparent at 60%). The existing network canvas is removed on `/`; it made the hero read as a demo.
Data: the instrument's transcript and proof hash are real; caption under it: `Live · n=32 r=8 d=8 · WebCrypto`.

### 2. Live strip
Purpose: the network exists; numbers are honest.
Copy: none beyond labels.
Visual: full-width `--bg-2` strip, 5 tiles, mono labels, values via Magic UI `NumberTicker`. Tiles and stats: `Nodes online` → `nodesOnline` · `Verified jobs` → `certificates` · `CLD minted` → `mintedUcld` · `CLD burned` → `burnedUcld` · `Verifiers today` → `verifiersToday`. A sixth tile `Base Sepolia · block N` from the RPC used by the miner (link `--chain` to Basescan). Caption right-aligned: `Read every 15 s. Zero is shown as zero.`

### 3. Three branches
Purpose: everyone lands here as one of three roles; make the choice in 5 seconds.
Copy (kicker `Three ways in` · H2 **Use it. Power it. Check it.**):
- **Use** — Submit a job. The network picks the hardware, sets the price, returns the result with its proof. `Run a job →` (`/control/run`)
- **Provide** — One command. Your PC or your racks. CLD is minted to you for every job you prove. `Start providing →` (`/control/provide`)
- **Verify** — Your browser re-checks finished work. No install, no wallet. `Verify in browser →` (`/control/verify`)
Visual: Magic UI `BentoGrid` with three equal `BentoCard`s; each card's background is a live micro-visual, not an illustration: Use = a 4×4 matrix cell grid filling teal (reuses miner cells at 16px); Provide = a hardware readout (`GPU · CPU threads · Memory` from `navigator` / WebGPU, as the current "what a node sees" panel); Verify = a Freivalds check ticking `n=64 · ✓ 3.1 ms` from `GET /v1/verify/task` (read-only, no verdict posted). Icons (lucide): `Play`, `Server`, `ShieldCheck`.

### 4. How it pays
Purpose: the orchestrator + per-job minting, in one diagram and 40 words.
Copy (kicker `How it pays` · H2 **No bidding. No idle emission.**):
- Line: You pay a fee. The orchestrator assigns the job, the provider computes and proves it, and CLD is minted for that job alone — 97.5 % of your fee to the provider, the fee burned, plus a capped subsidy when the orchestrator's random draw chose them. Settlement posts to Base in batches.
- Micro-caption under diagram: `Minted per verified job. Settled on-chain in batches.`
Visual: Magic UI `AnimatedBeam` across five nodes laid horizontally: `User` → `Orchestrator` → `Provider` → `Proof ✓` → `Base`. Beam colours: user→orchestrator `--muted`; orchestrator→provider `--work`; provider→proof `--work`→`--ok` gradient; proof→Base `--chain`. A sixth small node below Orchestrator labelled `fee burned` with a `--burn` beam that ends in nothing (the burn). Under the diagram, two mono `param` tiles: `97.5 %` fee → provider · `2 %` burn (0.5 % treasury implied in tooltip). Data: `priceUcldPerMmac` shown as `Current price · N µCLD per M multiply-adds` in the caption.

### 5. Services
Purpose: the full surface with honest status. This is the section the v1 pages lacked.
Copy (kicker `Services` · H2 **Everything a datacenter does.** · lede: Same orchestrator, same proof rule. Status is the truth today.):

| Service | One line | lucide | Status chip |
|---|---|---|---|
| GPU / CPU compute | Verified matrix jobs on assigned hardware. | `Cpu` | **Live · testnet** |
| AI inference | Int8 models, proven the same way. | `Brain` | Early access |
| Storage | Sealed replicas, challenged at random. | `HardDrive` | Early access |
| Containers | Docker and Kubernetes workloads. | `Container` | Early access |
| Static hosting & CDN | Served from many homes, probed by verifiers. | `Globe` | Planned |
| Bandwidth | Paid by signed receipts. | `Radio` | Planned |
| Confidential VMs | Attested desktops for agents and private data. | `Lock` | Planned |
| Databases & apps | Stateful services, uptime-probed. | `Database` | Planned |

Visual: 4×2 grid of shadcn `Card`s, hover lifts to `--panel-2`, `ShineBorder` on hover only. Chip colours: Live = `--ok` fill/`#04201C` text; Early access = `--work` outline; Planned = `--line-2` outline, `--muted` text. Card CTA (ghost, bottom-right): Live → `Run →`; Early access / Planned → `Request early access` (opens the waitlist with role=Use and `interest` preselected to that service).
Data: none live; statuses are constants in `services.ts` and shared with the console catalog (§4).

### 6. Providers — home and datacenter
Purpose: both scales, one rule, zero stake.
Copy (kicker `Provide` · H2 **From one PC to a whole hall.**):
- **Home node** — `curl -sL cloudana.io/node | sh` (copy button). Auto-detects GPU, CPU, RAM, disk. Toggle what you share. Set a floor price or take the estimate. No stake. `Start providing →`
- **Datacenter fleet** — One fleet token, deployed with Docker or Kubernetes. One payout wallet, one fleet-wide floor. Fees uncapped; subsidy capped per operator. `Talk to us →` (waitlist, role=Datacenter)
Visual: two cards side by side. Left card shows a terminal block (mono, `--panel-2`) with the command and three toggle rows `Compute · Storage · Bandwidth` (compute on, others `Early access` disabled). Right card shows a `Kubernetes` YAML fragment (`image: cloudana/fleet` / `CLOUDANA_FLEET_TOKEN`) and a mono line `payout: 0x… · floor: $0.11/kWh`. Behind the pair, Magic UI `Globe` (cobe) at 40% opacity, markers only where `nodesBound > 0` (engineers: hard-code the two testnet regions until node geo exists; mark TODO).
Data: `nodesBound` in the right card's header as `N nodes bound`.

### 7. Verify — try it now
Purpose: the third branch is real today and costs nothing; let visitors do it.
Copy (kicker `Verify` · H2 **Check the network from this tab.** · line: Your browser re-runs a Freivalds check on finished jobs. Some are planted wrong — watch them get caught.): CTA `Start verifying` / `Stop`. Caption: `Credits, not CLD. No monetary value.`
Visual: single instrument card: LED, `Checks · Correct · Credits` counters (`NumberTicker`), 6-line event log. Uses `GET /v1/verify/task` + `POST /v1/verify/verdict` (existing). Intensity control is a three-segment `Low · Med · High`.
Data: `verifiersToday` shown in the header as `N verifiers today`.

### 8. Waitlist (acquisition core)
Purpose: one list, every non-live intent.
Copy (H2 **Get in before mainnet.** · line: One list for users, providers, verifiers and datacenters. We email when your branch opens.). Full spec in §3.
Visual: centred card 560px, `BorderBeam`, form inline (not a modal). Below the card: Magic UI `Marquee` (pause on hover, 40s) of the eight service names with their status chips — the marquee is the only decorative loop on the page. Then three ghost links: `GitHub` · `Docs` · `X` (TODO real URLs).

### 9. Footer
Columns: `Protocol` (Console, Litepaper, Whitepaper v2, Universal PoUW) · `Source` (GitHub, Contracts, zk circuits) · `Company` (Datacenters & partners → waitlist role=Datacenter, Newsletter, Privacy, Terms). Meta line: `CLD is a utility token for compute coordination. Nothing here is investment advice. Testnet is orchestrator-coordinated.` Social row: X · GitHub · Discord (TODO URLs, lucide `Github`, custom X glyph, `MessageCircle`).

### Copy count
Hero 30 · strip caption 8 · branches 58 · how it pays 62 · services 60 · providers 66 · verify 35 · waitlist 20 = **339 words** (chip labels, CTAs and numbers excluded). Engineers: any wording change goes through this file first.

---

## 3. Waitlist spec

**Endpoint:** `POST /v1/waitlist` (new; D1 table `waitlist(id, email UNIQUE, role, interest, hardware, fleet_size, use_case, country, consent_at, referred_by, ref_code UNIQUE, position, created_at)`). Position = `COUNT(*)` at insert. Duplicate email → 200 with the existing record (idempotent; UI treats as success and says "You're already on the list").
**Also:** `GET /v1/waitlist/count` (public, cached 60s) for the "N people ahead of you" line.

**Fields (in order):**
1. `email` — required. Placeholder `you@domain.com`. Autofocus on scroll-into-view, never on page load.
2. `role` — required, segmented control, default none selected: `Use` · `Provide` · `Datacenter` · `Verify` · `Partner`.
3. Role follow-ups (render below the segments, 250ms height animation, all optional):
   - Use → `interest` multiselect chips from the eight services (preselected when arriving from a service card).
   - Provide → `hardware` single select: `Gaming PC (GPU)` · `Workstation` · `Home server / NAS` · `Mac` · `Other`.
   - Datacenter → `fleet_size` select: `< 50 servers` · `50–500` · `500+`; plus `interest` chips.
   - Verify → nothing.
   - Partner → `use_case` single-line text, placeholder `What would you build or fund?`
4. `country` — optional, shadcn `Combobox`, ISO list, label `Country (optional)`.
5. `consent` — required checkbox: `Email me about Cloudana. No third parties. Unsubscribe in one click.`
6. Hidden: `referred_by` from `?r=` in the URL (stored in `localStorage` on landing).
Submit button: `Join the waitlist` (primary, full width). While pending: label `Joining…`, spinner replaces the arrow, button disabled.

**Validation (inline, on blur then on change):**
- Email invalid → `Enter a valid email address.`
- Role missing → `Pick how you'll join.` (segments get a `--burn` hairline for 250ms then settle to `--line-2`)
- Consent missing → `We need your OK to email you.`
- Server 429 → `Too many attempts. Try again in a minute.`
- Server 5xx / offline → `We couldn't save that. Your entry is kept in this tab — try again.` (retain form state)
Errors use `--burn` text 14px under the field, `aria-live="polite"`, field gets `aria-invalid`.

**Success state (replaces the form, same card, 400ms cross-fade):**
- Headline: **You're #{position}.** (NumberTicker from 0)
- Line: `{role} branch · we email when it opens.`
- Referral block: read-only input with `https://cloudana.io/?r={ref_code}` + `Copy` (`Copy` → `Copied` 1.5s). Line: `Each signup from your link moves you up 5 places.` (server: `position = position − 5·referrals`, floor 1.)
- Share row: `Share on X` (prefilled: `I joined the Cloudana waitlist — a decentralized datacenter where the proof is the work. {link}`), `Copy link`.
- Secondary: `Open the console →` (Use/Provide/Verify) or `We'll reach out within 3 days.` (Datacenter/Partner — also creates an admin flag `needs_contact=1`).
**Privacy line (below the button, 12px `--faint`):** `Email and role only. No tracking pixels, no resale. Delete anytime: privacy@cloudana.io` (TODO confirm address).

**Other acquisition (all feed the same table or link out):**
- Referral link with position (above).
- `Datacenters & partners` footer link → same form, role preselected.
- Newsletter opt-in = the consent checkbox; no separate list.
- Social links (TODO: X, Discord, GitHub URLs from owner).
- Console: any Early access / Planned service CTA opens the same form in a shadcn `Dialog` with role and `interest` prefilled.

---

## 4. Console IA — `/control`

Sidebar (7 items, lucide icons), width 14rem, `--bg-2`, glass on mobile sheet:
1. `Overview` — `LayoutDashboard` — `/control`
2. `Run` — `Play` — `/control/run`
3. `Provide` — `Server` — `/control/provide`
4. `Verify` — `ShieldCheck` — `/control/verify`
5. `Services` — `LayoutGrid` — `/control/services`
6. `Earnings` — `Wallet` — `/control/earnings`
7. `Docs` — `BookOpen` — `/control/docs`
Bottom of sidebar: wallet card (address short, CLD balance, `Copy`, Basescan link) or `Connect wallet`; `Testnet` pill; `Faucet` as a text link under the wallet (not a nav item).
Top bar: breadcrumb, network status dot (`--ok` API up / `--burn` down, tooltip with last poll time), `Join the waitlist` ghost button when the user is on any Early access / Planned surface.

**Legacy routes** (`/user`, `/mining`, `/providers/*`, `/pricing/*`, `/workload/register`, `/deployment-completion`, `/decentralization`, `/debug`, `/status`) stay mounted under `/control/legacy/...` with a permanent redirect from the old paths; not in nav; each shows a top banner `Legacy page — the new console is at …` linking to its successor.

### Overview (first screen)
- Row 1: four `NumberTicker` tiles from `/v1/network`: `Nodes online` · `Verified jobs` · `CLD minted` · `CLD burned`. Sixth-column mini: `Epoch N` + `Price N µCLD/MMAC`.
- Row 2 (two-thirds / one-third): **Recent proofs** table (last 10 from `GET /v1/pouw/certificates`: proof z short, provider short, n, when; row click → job) · **Your position** card: if signed in, your jobs today / your node status / your verifier credits; if not, the waitlist card compact.
- Row 3: **Services** strip (the eight cards from §2.5 in compact form) — the whole surface is visible on the first screen, per lessons.
Empty state (fresh testnet): tiles show `0`, table shows `No proofs yet. Run a job or start verifying.` with the two buttons.

### Run
First screen: left **New job** card — service select (only Live services enabled; others show chip + `Request early access`), size (`16 · 32 · 64 · 128`), price estimate live from `priceUcldPerMmac` (`≈ 0.26 CLD`), optional `Max price` (ceiling, placeholder = estimate ×1.2), `Submit`. Right **Balance** card: CLD balance, `Get test credits` (`POST /v1/dev/credits`), held amount. Below: **My jobs** table (`GET /v1/jobs`): status chip (`queued` muted · `assigned` amber · `done ✓` teal · `failed` red), ran on, proof z, `Download C`. Job row expands inline to the proof panel (σ, transcript, z, verify-in-browser button that runs Freivalds locally).

### Provide
Tabs: **Home node** · **Datacenter fleet**.
Home node: three numbered steps as cards in one row — `1 Run one command` (terminal block + Copy), `2 Bind your wallet` (auto-filled from the agent link `?node=&code=`; `Bind node` signs EIP-712), `3 Share what you want` (toggles Compute / Storage / Bandwidth; only Compute enabled; others chip `Early access` + `Request early access`). Below: **Floor price** input (`$/kWh`, placeholder = regional estimate, help: `Leave empty to accept the network estimate.`) and **Node status** card (last seen, benchmark MMAC/s, tier bar edge/worker/heavy, work types).
Datacenter fleet: `Fleet token` card (generate → shows Docker `run` and Kubernetes `DaemonSet` snippets with the token), `Payout wallet` (one), `Fleet floor` input, `Nodes` table (bound nodes for this wallet, last seen, benchmark), summary tiles `Nodes · Verified jobs · CLD minted (fees) · Subsidy used / cap`. Empty: `No fleet yet. Deploy the token to your first node.`

### Verify
Same instrument as §2.7 at full width plus a right column: **Session** (credits, correct rate, planted-wrong caught), **How grading works** (three lines: σ-selected tasks · ~13 % planted wrong · credits until wallet-bound), and `Bind credits to wallet` disabled with chip `Early access`.

### Earnings / Wallet
Header: address, CLD balance, Basescan link. Tiles: `Pending` (verified, not yet posted) · `Vesting` (lane B, unlock date) · `Claimable` · `Paid`. Caption under tiles: `Minted per verified job. Posted to Base in batches; lane B vests 7 days.` Table from `GET /v1/ledger/{address}`: certificate short, lane (`A fee` / `B subsidy`), amount, epoch, status. Row click → job. `Claim` button disabled until keeper/claim exists (chip `Automatic`, tooltip: `A keeper claims for you weekly.`). Empty: `Nothing earned yet. Bind a node or run the verifier.`

### Services catalog (`/control/services`)
The eight cards from §2.5, full width, each expandable to: what's proven and how (one line from `UNIVERSAL_POUW.md` §4), subsidy yes/no, and the CTA. Filter chips: `All · Live · Early access · Planned`.

---

## 5. Anti-MVP checklist (all ten are acceptance criteria)

1. **Empty states are designed**, not blank: icon, one sentence, one action. Every table, list and tile.
2. **Skeletons match final geometry** (same height, same column widths) and appear only after 300ms; never a spinner in a card.
3. **Numbers are formatted**: tabular mono, thousands separators, µCLD → CLD with 2 decimals (`1,204.36 CLD`), hashes `0x3fa2…9c1e` with copy-on-click and full value in tooltip, relative times (`14 s ago`) with absolute in tooltip.
4. **Focus is visible everywhere**: 2px `--ok` ring, 3px offset; Tab order matches visual order; Escape closes every sheet/dialog; `Enter` submits the waitlist.
5. **Hover has a cost**: cards lift to `--panel-2` in 150ms, buttons brighten 8 %, links underline on hover only. No scale transforms.
6. **State changes settle**: verified → LED glow 400ms then hold; new table row fades in and highlights `--ok` at 8 % for 1.2s; a chip switching status cross-fades.
7. **Copy buttons confirm** (`Copied`, 1.5s) and never move layout; toasts (shadcn `Sonner`) bottom-right, 4s, max 2 stacked.
8. **Live and offline are distinguishable**: every polled block has a 12px mono `updated 4 s ago`; offline shows `—` plus caption, never stale numbers pretending to be live.
9. **Mobile is a first-class layout**, not a collapse: hero instrument stacks under the headline at 100 % width; bento becomes a vertical list; services grid 2×4; tables become row cards with the two most important fields.
10. **Zero orphan states**: every CTA leads somewhere real. Early access / Planned always resolve to the waitlist with context prefilled. No `#` links, no `Coming soon` dead ends.

Plus: favicon/og image regenerated from the token colours; `<title>` per route; `theme-color #07090D`; Lighthouse a11y ≥ 95 on `/` and `/control`.

---

## 6. What NOT to do

**Claims we cannot make**
- "Proven" for storage, hosting, bandwidth, confidential compute, databases — only compute is proven today. Use `measured`, `probed`, `attested`, or the status chip.
- "Fully decentralized", "trustless", "on mainnet", "audited" — none is true yet.
- "Earn per epoch", "epoch rewards", "staking rewards", "passive income", "mine CLD by idling". CLD is minted per verified job; batching is delivery.
- "Marketplace", "bid", "browse providers", "choose your GPU". Users never pick a provider; the orchestrator assigns and prices.
- Any price, ROI, APY, token value or "X × cheaper than AWS" figure. Show the live protocol price and nothing else.
- "Zero-knowledge verified" — Groth16 is in development; say `zk verifier in development` where relevant.
- Node counts, TPS, or "hundreds of providers" that the API does not return. Zero is zero.

**Clichés to avoid**
- Gradient text, neon glows on headlines, glassmorphism cards, floating 3D blobs, purple-to-cyan anything.
- Stock "AI network" globe hero. The globe is a background in §6 only, at 40 %, with real markers.
- Testimonials, logo walls, "trusted by", fake activity feeds, countdown timers.
- Vocabulary: "supercharge", "unleash", "seamless", "revolutionary", "web3", "DePIN" (owner's product is a datacenter, not a category).
- Three-paragraph explanations. If a section needs more than one sentence, the visual is wrong.
- Modal waitlist popups on load, exit-intent, sticky bottom bars. The form is inline, once, at the end.
- Rounded-2xl everything. Radius is 6/8/12.
- Re-adding the v1 network canvas to `/`; it is kept only as an opt-in easter egg on `/lab` if that route survives.
