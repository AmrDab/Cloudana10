import { Logo } from "@/components/cld/logo";
import { API_ROOT } from "@/lib/cld";
import { openWaitlist } from "@/components/waitlist";
import { wrap } from "./parts";

const GH = "https://github.com/AmrDab/Cloudana10";
type L = { label: string; href?: string; onClick?: () => void; ext?: boolean };

// TODO(owner): add X and Discord links once the accounts exist (brief §2.9) — no dead links until then.
const COLS: { title: string; links: L[] }[] = [
  {
    title: "Protocol",
    links: [
      { label: "Console", href: "/control" },
      { label: "Litepaper", href: "/litepaper.html" },
      { label: "Whitepaper v2", href: `${GH}/blob/main/docs/Cloudana_Whitepaper_v2.md`, ext: true },
      { label: "Docs", href: "/control/docs" },
      { label: "Status", href: "/#status" },
      { label: "Lab", href: "/lab" },
      { label: "FAQ", href: "/lab#faq" },
    ],
  },
  {
    title: "Source",
    links: [
      { label: "GitHub", href: GH, ext: true },
      { label: "Contracts", href: `${GH}/tree/main/contract/contracts`, ext: true },
      { label: "PoUW engine", href: `${GH}/tree/main/pouw/src`, ext: true },
      { label: "zk circuits", href: `${GH}/tree/main/circuits`, ext: true },
      { label: "API health", href: `${API_ROOT}/health`, ext: true },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Datacenters & partners", onClick: () => openWaitlist({ role: "datacenter" }) },
      { label: "Newsletter", onClick: () => openWaitlist() },
      { label: "Privacy", href: "/privacy.html" },
      { label: "Terms", href: "/terms.html" },
    ],
  },
];

export function SiteFooter() {
  const item = "text-sm text-muted-foreground transition-colors duration-150 hover:text-text";
  return (
    <footer className="border-t border-line bg-bg-2">
      <div className={`${wrap} grid gap-10 py-16 md:grid-cols-[1.4fr_1fr_1fr_1fr]`}>
        <div>
          <Logo />
          <p className="mt-4 max-w-[34ch] text-sm leading-[1.55] text-faint">A decentralized datacenter where the proof is the work.</p>
        </div>
        {COLS.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <p className="font-mono text-[11px] uppercase tracking-[.08em] text-faint">{c.title}</p>
            <ul className="mt-4 grid gap-2.5">
              {c.links.map((l) => (
                <li key={l.label}>
                  {l.href ? (
                    <a href={l.href} className={item} {...(l.ext ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{l.label}</a>
                  ) : (
                    <button type="button" onClick={l.onClick} className={item}>{l.label}</button>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <p className={`${wrap} py-6 font-mono text-[11px] leading-[1.7] text-faint`}>
          CLD is a utility token for compute coordination. Nothing here is investment advice. Testnet is orchestrator-coordinated.
        </p>
      </div>
    </footer>
  );
}
