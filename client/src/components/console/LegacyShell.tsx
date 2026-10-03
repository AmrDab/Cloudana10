// Legacy v0 pages keep working under /control/legacy/... inside the old AppLayout,
// with a permanent banner pointing to their successor in the new console (docs/V2_BRIEF.md §4).
import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, History } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";

const SUCCESSOR: [prefix: string, href: string, label: string][] = [
  ["/user", "/run", "Run"],
  ["/job", "/run", "Run"],
  ["/workload", "/run", "Run"],
  ["/deployment-completion", "/run", "Run"],
  ["/pricing", "/run", "Run"],
  ["/mining", "/earnings", "Earnings"],
  ["/provider", "/provide", "Provide"],
  ["/register", "/provide", "Provide"],
  ["/decentralization", "/", "Overview"],
  ["/docs", "/docs", "Docs"],
];

// Rendered inside <Route path="/legacy" nest>: locations here are relative to /control/legacy,
// so links out to the new console use wouter's "~" (absolute) prefix.
export function LegacyShell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const [, href, label] = SUCCESSOR.find(([p]) => loc.startsWith(p)) ?? ["", "/", "Overview"];
  return (
    <AppLayout>
      <div role="note" className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-work/40 bg-work/[.06] px-4 py-2.5 text-sm">
        <History className="size-4 text-work" aria-hidden />
        <span className="text-text">Legacy page — the new console is at</span>
        <Link href={`~/control${href === "/" ? "" : href}`} className="inline-flex items-center gap-1 font-medium text-ok hover:underline underline-offset-4">
          {label} <ArrowRight className="size-3.5" />
        </Link>
      </div>
      {children}
    </AppLayout>
  );
}
