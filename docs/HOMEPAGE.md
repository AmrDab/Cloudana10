# Homepage — "Paper" (October 2026)

Owner-approved concept A (2026-10-09), replacing the globe/universe homepage (PRs #9–#11). The owner picked it from
four rendered concepts after rejecting the globe as "cheap". Visual changes start as rendered concepts the owner
approves before anything is built (tasks/lessons.md).

**Look:** light paper (`#F3F1EC`), ink (`#141414`), one accent (deep teal `#0E7C6E`).
- Headings use Instrument Serif, with italic teal for the second line.
- Body text is Inter; labels are IBM Plex Mono in uppercase.
- Hairline rules, no cards and no glow.
- The page is scoped under `.pp` (`client/src/pages/home/paper/paper.css`); the rest of the site stays dark.

**Sections:**
1. Hero (headline, two buttons, dotted world map) and live numbers `#network`.
2. How a job works `#how`.
3. Three ways in: `#run`, `#provide`, `#verify`.
4. CLD split `#cld`.
5. Security `#security`.
6. Waitlist `#waitlist`.

The old anchors still resolve: `#services` → run, `#pays` → cld, `#status` → network (`paper/anchors.ts`).

**Facts only:**
- Copy is taken from the previous homepage content.
- Numbers come from `useNetwork()`: nodes online, jobs verified and CLD minted. They show "—" until loaded, and the page
  says so when the orchestrator is offline.
- The map is decorative. Its dots are land and population texture, and its arcs link well-known cities. Neither
  is a claim about where nodes run (`scripts/home/build-map.py` regenerates `paper/map.json`).

**Motion:**
- Lenis smooth scroll runs on this page only. Section links scroll with it.
- Light travels along the map arcs and the city dots pulse.
- Sections fade in once.
- The header hides while scrolling down.
- With `prefers-reduced-motion`: native scroll and no animations.
