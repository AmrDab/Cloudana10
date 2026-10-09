import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { Logo } from "@/components/cld/logo";
import { btn } from "@/components/cld/cta";
import { openWaitlist } from "@/components/waitlist";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { wrap } from "./parts";

const LINKS = [
  { label: "Services", href: "/#services" },
  { label: "How it pays", href: "/#pays" },
  { label: "Provide", href: "/#provide" },
  { label: "Lab", href: "/lab" },
  { label: "Docs", href: "/control/docs" },
];

/** True while the page is scrolling down past the nav; false on any scroll up or near the top. */
export function useHideOnScroll() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - last) < 6) return;
      setHidden(y > last && y > 80);
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return hidden;
}

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const hidden = useHideOnScroll() && !open;
  return (
    <header
      className={`sticky top-0 z-40 border-b border-line bg-[rgba(7,9,13,.72)] backdrop-blur-[14px] transition-transform duration-300 ease-out focus-within:translate-y-0 ${hidden ? "-translate-y-full" : "translate-y-0"}`}
    >
      <nav aria-label="Primary" className={`${wrap} flex h-16 items-center gap-3 md:gap-6`}>
        <div className="flex items-center gap-3">
          <Logo />
          <span className="rounded-full border border-work/60 px-2 py-0.5 font-mono text-[11px] leading-4 text-work max-sm:hidden">Testnet</span>
        </div>
        <ul className="mx-auto hidden items-center gap-7 md:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} className="text-sm text-muted-foreground transition-colors duration-150 hover:text-text">
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <a href="/control" className={btn.ghost("sm", "max-sm:hidden")}>Open console</a>
          <button type="button" onClick={() => openWaitlist()} className={btn.primary("sm")}>Join the waitlist</button>
          <button type="button" onClick={() => setOpen(true)} className="grid size-9 place-items-center rounded-lg border border-line-2 text-muted-foreground md:hidden" aria-label="Open menu">
            <Menu className="size-4" />
          </button>
        </div>
      </nav>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-72 border-line-2 bg-bg-2">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Site sections</SheetDescription>
          <ul className="mt-10 grid gap-1 px-2">
            {[...LINKS, { label: "Open console", href: "/control" }].map((l) => (
              <li key={l.href}>
                <a href={l.href} onClick={() => setOpen(false)} className="block rounded-md px-3 py-2.5 font-head text-base text-text hover:bg-panel">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </header>
  );
}
