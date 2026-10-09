// The homepage, "Paper" (concept A, approved 2026-10-09): a light editorial page with a dotted world map, the job
// loop, three ways in, the CLD split, security and the waitlist. Copy comes from the old homepage graph; the numbers
// are live from the orchestrator. Smooth scroll via Lenis (off with reduced motion). docs/HOMEPAGE.md.
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { useReducedMotion } from "motion/react";
import { openWaitlist } from "@/components/waitlist";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useNetwork } from "@/hooks/useNetwork";
import { cld, int } from "@/lib/cld";
import { useHideOnScroll } from "../nav";
import { Reveal } from "../parts";
import { sectionFor } from "./anchors";
import { WorldMap } from "./WorldMap";
import "./paper.css";

const PAPER = "#F3F1EC";

const NAV = [
  { label: "Run", href: "#run" },
  { label: "Provide", href: "#provide" },
  { label: "Verify", href: "#verify" },
  { label: "CLD", href: "#cld" },
  { label: "Litepaper", href: "/litepaper.html" },
];

const STEPS = [
  ["Submit", "Send a job or deploy a container."],
  ["Assign", "The orchestrator picks the hardware. No bidding."],
  ["Run", "A provider node does the work."],
  ["Prove", "The work returns its own transcript."],
  ["Verify", "Re-checked before anything mints."],
  ["Mint", "The fee is burned; 95% is minted to the provider."],
];

const DOORS = [
  { id: "run", title: "Run", text: "Submit work. The network picks the hardware and returns the result with its proof.", cta: "Run a job", href: "/control/run" },
  { id: "provide", title: "Provide", text: "One command. Your PC or your racks. Paid for every job you prove.", cta: "Start providing", href: "/control/provide" },
  { id: "verify", title: "Verify", text: "Your browser re-checks finished work. No install, no wallet.", cta: "Verify in your browser", href: "/control/verify" },
];

const FOOTER = [
  { label: "Litepaper", href: "/litepaper.html" },
  { label: "Lab", href: "/lab" },
  { label: "Docs", href: "/control/docs" },
  { label: "Terms", href: "/terms.html" },
  { label: "Privacy", href: "/privacy.html" },
];

/** The Cloudana mark in one ink colour (the gradient mark is drawn for dark backgrounds). */
function Mark() {
  return (
    <svg viewBox="4 3 24 24" className="pp-mark" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 14.5H10a4.75 4.75 0 0 0 0 9.5h7" />
        <path d="M13.5 19.5H22a4.5 4.5 0 0 0 .6-8.96A6.5 6.5 0 0 0 10.2 12" />
      </g>
      <circle cx="19" cy="14.5" r="2" fill={PAPER} stroke="currentColor" strokeWidth="1.6" />
      <circle cx="13.5" cy="19.5" r="2" fill={PAPER} stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function Brand() {
  return (
    <a href="/" className="pp-brand" aria-label="Cloudana home">
      <Mark />
      Cloudana
    </a>
  );
}

/** Smooth scrolling for the homepage only; returns a scroll-to-section function (instant with reduced motion). */
function useSectionScroll() {
  const reduced = useReducedMotion();
  const lenis = useRef<Lenis | null>(null);
  useEffect(() => {
    if (reduced) return;
    const l = new Lenis({ autoRaf: true });
    lenis.current = l;
    return () => {
      l.destroy();
      lenis.current = null;
    };
  }, [reduced]);
  return useCallback((id: string, immediate = false) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (lenis.current) lenis.current.scrollTo(el, { offset: -16, immediate });
    else el.scrollIntoView();
    history.replaceState(null, "", `${location.pathname}${location.search}#${id}`);
  }, []);
}

export function Paper() {
  const go = useSectionScroll();
  const [menu, setMenu] = useState(false);
  const hidden = useHideOnScroll() && !menu;
  const { data, offline } = useNetwork();

  // Paper behind the page too (overscroll, the strip under the sheet on phones); restored on leave.
  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.backgroundColor;
    html.style.backgroundColor = PAPER;
    return () => {
      html.style.backgroundColor = prev;
    };
  }, []);

  // Deep links (/#cld, and the old /#services /#pays /#status the lab still uses) land on their section.
  useEffect(() => {
    const id = sectionFor(location.hash);
    if (!id) return;
    const t = window.setTimeout(() => go(id, true), 50);
    return () => window.clearTimeout(t);
  }, [go]);

  const jump = (e: MouseEvent<HTMLAnchorElement>) => {
    const id = sectionFor(e.currentTarget.getAttribute("href") ?? "");
    if (!id) return;
    e.preventDefault();
    setMenu(false);
    go(id);
  };
  const link = (l: { label: string; href: string }) => (
    <a key={l.href} href={l.href} onClick={l.href.startsWith("#") ? jump : undefined}>
      {l.label}
    </a>
  );

  const value = (v: number | undefined) => (data ? int(v) : "—");
  const minted = data ? cld(data.mintedUcld).replace(/ CLD$/, "") : "—";

  return (
    <div className="pp">
      <header className={`pp-header${hidden ? " is-hidden" : ""}`}>
        <Brand />
        <nav aria-label="Primary" className="pp-nav">
          {NAV.map(link)}
        </nav>
        <div className="pp-cta">
          <a href="/control" className="pp-btn ghost">Open console</a>
          <button type="button" onClick={() => openWaitlist()} className="pp-btn solid">Join the waitlist</button>
        </div>
        <button type="button" className="pp-menu" onClick={() => setMenu(true)}>Menu</button>
      </header>
      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent side="right" className="pp-sheet w-72">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Site sections</SheetDescription>
          <nav className="pp-sheet-links">
            {NAV.map(link)}
            <a href="/control">Open console</a>
          </nav>
        </SheetContent>
      </Sheet>

      <main>
        <section className="pp-hero">
          <div className="pp-copy">
            <p className="pp-eyebrow">Decentralized datacenter · Base Sepolia testnet</p>
            <h1>
              The proof
              <br />
              <em>is the work.</em>
            </h1>
            <p className="pp-lede">
              Send a job; the network picks the hardware and returns the result with its proof. Only verified work mints CLD.
            </p>
            <div className="pp-btns">
              <button type="button" onClick={() => openWaitlist()} className="pp-btn solid">Join the waitlist</button>
              <a href="/litepaper.html" className="pp-btn ghost">Read the litepaper</a>
            </div>
          </div>
          <div className="pp-map">
            <WorldMap />
          </div>
          <div id="network" className="pp-stats">
            <div><b>{value(data?.nodesOnline)}</b><span>nodes online</span></div>
            <div><b>{value(data?.jobsDone)}</b><span>jobs verified</span></div>
            <div><b>{minted}</b><span>CLD minted · testnet</span></div>
            <p>{offline ? "Orchestrator offline. Numbers return when it does." : "Live from the orchestrator. Zero is zero."}</p>
          </div>
        </section>

        <section id="how" className="pp-loop">
          <Reveal>
            <p className="pp-eyebrow">How a job works</p>
            <h2>
              Assigned, not auctioned.
              <br />
              <em>Proven, then paid.</em>
            </h2>
          </Reveal>
          <ol>
            {STEPS.map(([title, text], i) => (
              <li key={title}>
                <Reveal delay={i * 0.04}>
                  <span className="pp-num">{String(i + 1).padStart(2, "0")}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </Reveal>
              </li>
            ))}
          </ol>
        </section>

        <section className="pp-doors">
          <p className="pp-eyebrow">Three ways in</p>
          <div className="pp-grid">
            {DOORS.map((d, i) => (
              <article key={d.id} id={d.id}>
                <Reveal delay={i * 0.06}>
                  <span className="pp-eyebrow">{String(i + 1).padStart(2, "0")}</span>
                  <h3>{d.title}</h3>
                  <p>{d.text}</p>
                  <a href={d.href}>{d.cta} →</a>
                </Reveal>
              </article>
            ))}
          </div>
        </section>

        <section id="cld" className="pp-cld">
          <Reveal>
            <p className="pp-eyebrow">CLD</p>
            <h2>
              Only verified work
              <br />
              <em>mints CLD.</em>
            </h2>
            <p className="pp-body">
              The fee is burned; CLD is minted for the verified job and settled on Base in batches. Nothing about CLD is a
              promise of price or return.
            </p>
          </Reveal>
          <Reveal delay={0.08} className="pp-split">
            <div className="pp-bar" role="img" aria-label="Of the CLD minted per verified job: 95% to the provider, 3% to the treasury, 2% destroyed">
              <i style={{ flex: 95 }} />
              <i style={{ flex: 3 }} />
              <i style={{ flex: 2 }} />
            </div>
            <dl>
              <div><dt>95%</dt><dd>to the provider</dd></div>
              <div><dt>3%</dt><dd>to the treasury</dd></div>
              <div><dt>2%</dt><dd>destroyed</dd></div>
            </dl>
            <p className="pp-eyebrow pp-note">Hourly epochs on testnet · Merkle root on Base · veto window</p>
          </Reveal>
        </section>

        <section id="security" className="pp-quote">
          <Reveal>
            <p>Every message signed. Every proof re-checked. Secrets sealed to the node that runs them.</p>
            <a href="/control/docs#security">What is live, building, planned →</a>
          </Reveal>
        </section>

        <section id="waitlist" className="pp-close">
          <h2>
            Start with
            <br />
            <em>the waitlist.</em>
          </h2>
          <div className="pp-btns">
            <button type="button" onClick={() => openWaitlist()} className="pp-btn solid">Join the waitlist</button>
            <a href="/control" className="pp-btn ghost">Open console</a>
          </div>
        </section>
      </main>

      <footer className="pp-footer">
        <Brand />
        <nav aria-label="Footer">{FOOTER.map(link)}</nav>
        <p className="pp-eyebrow">Base Sepolia testnet</p>
      </footer>
    </div>
  );
}
