# Homepage universe — spec (October 2026)

Owner's brief, distilled: the homepage is not a scrolling site. It is a **map you fly through**, centred on **Proof**.
First view: dark space, slow stars, `CLOUDANA / The proof is the work` floating in the middle, no menu. Zooming out
reveals connected worlds; clicking a node flies the camera there; more detail appears the deeper you go; nothing ever
loads a new page. Nodes glow from **real** network activity, so the site is evidence, not marketing. One hidden
`?????` node per region rewards explorers. It must feel physical: drag to move, scroll to zoom, double-click to fly,
smooth camera, no obvious sections.

What must stay true: Cloudana is a decentralized datacenter on Base (Sepolia testnet today). An orchestrator assigns
work; there is no marketplace or bidding. CLD is minted per verified job: the fee is burned, the provider is minted
95%, the treasury 3%, 2% is destroyed; a small capped subsidy rewards independent clusters. No value/price promises.
Network is at zero right now — dim nodes are correct, not a bug.

Types: `client/src/pages/home/universe/types.ts` (binding).

## Map (content owned by graph.ts)

```
                       Verify
                         ○
                         │
   Provide ○────────── PROOF ──────────○ Run
                         │
            Security ○   │   ○ Network (live)
                         │
                       Settle (CLD)
```

Six regions around the core. Each region has 3–7 topics; topics have 0–6 leaves. Suggested content
(graph.ts decides final wording; everything must be checkable against the repo/docs):

- **Run** (tone work): the services catalog from `lib/services.ts` grouped as compute / hosting / storage / security /
  coming, each service a leaf with its status chip, summary and `interest` for the waitlist; "Open console" leaf.
- **Provide** (tone ok): Home node (matmul + static hosting today), Datacenter fleet (fleet tokens, DaemonSet,
  containers/GPU after hardening), Earnings (95% of every fee, hourly testnet epochs), Node agent (signed
  instructions, open source). Links: /control/provide, GitHub node-agent.
- **Verify** (tone ok): Browser verifier (Freivalds re-check, planted tasks 1 in 6, credits not CLD), cuPOW
  σ-assignment, the verify feed. Links: /control/verify, /lab.
- **Settle (CLD)** (tone chain): Fee split 95/3/2, Epochs (hourly testnet, Merkle root, veto window), Subsidy lane
  (capped, declining, per-operator cluster gate), Base Sepolia contracts (v2 token + settlement under a Safe —
  "deploying now", never "live" until it is), Price (nCLD/TMAC, utilization controller). Links: /control/economics,
  /litepaper.html, contracts on GitHub.
- **Security** (tone neutral): from `lib/security.ts` live / building / planned; sealed secrets, signed node
  instructions, hardened containers, hosting gateway, key custody (Safe).
- **Network** (tone ok, live): leaves bound to `useNetwork()` stats — nodes online, jobs done, certificates, CLD
  minted, CLD burned, epoch, price, deployments running, GPUs online. These are the "living nodes". Also the status
  gates from `pages/home/status.tsx` (GATES) as a "Status" topic. Link: API health.
- **Cross edges** ("everything connected"): Run→Settle (every paid job settles), Provide→Verify (every job is
  re-checked), Verify→Settle (no proof, no mint), Security→Provide, Network→everything it measures.
- **Hidden nodes** (`hidden: true`, label `?????` until revealed): e.g. Run → "Coming up" (lib/roadmap.ts items),
  Verify → "Lab" (/lab live instruments), Settle → "20-year simulation" (/control/economics).

## Camera & levels (engine)
- World units; core at (0,0); regions on a ring r≈420; topics on a ring r≈150 around their region; leaves r≈60
  around their topic. Deterministic radial layout from the graph (angle hints respected, otherwise evenly spaced,
  region angles chosen so Run is right, Provide left, Verify top, Settle bottom).
- Levels by zoom: galaxy z<1.6 (core + regions + faint topic dots), system 1.6–3.6 (+topics with labels, leaves as
  dots), planet ≥3.6 (+leaves with labels; the React panel opens for the selected node).
- Fly-to: ease-in-out 900 ms (instant when reduced motion), zoom to the node's natural level, camera inertia on drag
  release, wheel zoom around the cursor, pinch on touch, double-click fly, Esc / "Zoom out" back to galaxy.
- Stars: three parallax layers, drift ≈2 px/s, none when reduced motion. Render at devicePixelRatio ≤ 2, 60 fps on
  a 2019 laptop; nothing allocates per frame.
- Living nodes: glow radius and a slow pulse scale with `intensity`; intensity 0 = dim ring, no pulse, label shows
  the number ("0 online").

## Shell (React)
- `/` renders `<Universe/>` full-viewport. Minimal HUD: top-left logo (click = zoom out), breadcrumb
  `Proof › Region › Node`, top-right `Open console` + `Join the waitlist` (opens the WaitlistHost dialog), bottom-left
  hint `Drag to move · Scroll to zoom · Double-click to fly` (fades after first interaction), bottom-right tiny
  `Litepaper · Lab · Terms · Privacy`.
- Node panel at planet level: label, status chip, summary, body lines, live value, buttons `Open →` (href) and, for
  early/planned services, `Join the waitlist` with the node's interest prefilled. Anchored next to the node via
  `engine.project()`, clamped inside the viewport; on phones it docks to the bottom.
- Deep links: `/#<nodeId>` flies to the node on load and updates as you fly (history.replaceState); the
  `LEGACY_ANCHORS` in types.ts map the old `#services #pays #provide #status` anchors.
- Live data: `useNetwork()` → `engine.setLive()` every refresh; dim when the API is offline.
- Fallback "List" view (toggle in the HUD, automatic when `prefers-reduced-motion` or canvas unsupported, and the
  sr-only outline for screen readers / crawlers): the same graph rendered as a semantic nested list with the same
  links and chips. Search engines and screen readers get the full content this way.
- Keep: `captureReferral()`, document title, `<WaitlistHost/>`, the public 404 page, every link in the old nav and
  footer must still resolve (the lab's SiteNav links to `/#services` etc.).
- The globe (`components/cld/globe/NetworkGlobe`) is reused inside the Network region's panel at planet level
  (lazy, only mounted while that panel is open).

## Non-goals
No change to API, console, lab, litepaper or docs content. No new dependencies beyond what the repo has (three,
motion, lucide). No analytics. No autoplay sound.

---

# v2 — the universe on a globe (owner, October 2026)

Owner feedback on v1: overlay the whole homepage on a **sphere showing the whole world**; links are not straight lines
but **real roads**; **smart navigation** between nodes. Approved mocks: a dark sphere with the existing glitch-sketch
coastlines, glowing road networks around six cities, dashed cable arcs between continents, a region dock and search.

## Geography (binding: `universe/world/index.ts`, generated by `scripts/universe/build-world.py`)
- Regions: Run = New York, Settle = London, Provide = Nairobi, Verify = Singapore, Security = Tokyo, Network = São Paulo.
- Topics sit in nearby cities, each joined to its region by a real driving route (`ROADS`).
- Continents are joined by `CABLES` (great-circle arcs drawn dashed, lifted slightly off the surface).
- The core (Proof) has no place: it is the wordmark and the sphere itself.
- Leaves are **not drawn on the globe**; they live in the panel tree under their topic (`placeOf` resolves a leaf to
  its topic's city when flying to it).

## Globe engine (replaces engine/ for the homepage; keeps the `UniverseEngine` interface in types.ts)
- three.js (already a dependency; reuse ideas/shaders from `components/cld/globe/scene.ts`): sphere body, faint
  graticule, coastline line segments (`land.json`), roads as glowing polylines on the surface (tone colour of their
  region, thicker/brighter for the selected region), cables as dashed arcs, region markers (ring + soft glow, live
  pulse), topic markers (small rings), `?????` for hidden topics until revealed. Labels drawn on a 2D overlay canvas
  (crisp text, Bricolage/Plex), occluded when on the far side, with LOD: galaxy shows region labels + cities; system
  (region focused) adds topic labels; planet (topic focused) emphasises that topic.
- Camera: orbit around the globe. `flyTo(id)` slerps the globe rotation so the node's place faces the camera and
  eases the distance: region → system distance (continent fills ~70% of view), topic → planet distance. `zoomOut` →
  whole sphere. Drag spins (inertia), wheel/pinch zoom, double-click flies. Idle on the landing view → slow
  auto-rotation (stops on any interaction, resumes after 20 s idle at galaxy level; never with reduced motion).
- Live glow from `setLive` exactly as before. `project(id)` returns screen coords of the node's place (null when on
  the far side). `currentRegion()` = the region whose place is nearest the view centre when zoomed in.

## Smart navigation (shell)
- **Region dock** (bottom centre): six chips (colour dot, name, `n · City`), `‹ ›` to travel to the previous/next
  region in ring order Run → Settle → Provide → Verify → Security → Network, keys `1`–`6`, `[`/`]` or arrows for
  prev/next. Active chip highlighted. On phones the dock scrolls horizontally.
- **Search** (`⌘K` / `Ctrl+K` / `/`, and a search field in the top bar): fuzzy search over every node incl. leaves
  (label, summary, city); Enter flies there and opens the panel with the match expanded; arrow keys move.
- **Panel** (right side; bottom sheet on phones) for the focused region: city, title, summary, then an expandable
  tree of topics → leaves; clicking a topic flies the globe to its city; clicking a leaf expands its facts, links and
  waitlist button. Hidden topics show `?????` until revealed (click reveals).
- Breadcrumb, deep links (`#nodeId`, legacy anchors), live data, waitlist/console buttons, List fallback, sr-only list
  — all kept from v1.
- Landing copy (top-left, landing only): `CLOUDANA` / "The proof is the work. A decentralized datacenter, on every
  continent." — the continents are where the map's ideas sit, not claims about where nodes run today (no overclaim:
  the network is at zero; the Network region says so).
- Attribution: a tiny "Roads © OpenStreetMap" link in the bottom-right links row (ODbL requirement).

### v2 amendments (owner, same day)
- **Smaller globe:** at galaxy level the sphere's diameter is ~55% of the viewport's short side (more space around it).
- **Everything interconnects:** `CABLES` is the full mesh between the six regions (15 arcs). `ROADS` joins every
  place inside a region to every other place in it (hub↔topic and topic↔topic; 104 real routes). A road's `from`/`to`
  can be any two places in the same region. Draw all of them; when a region is focused, its roads brighten and the
  rest dim.
