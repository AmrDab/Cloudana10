// The console shell (docs/V2_BRIEF.md §4): 7-item sidebar, wallet card at the bottom,
// top bar with breadcrumb + API status dot, mobile sheet. Mounts the waitlist host and toasts once.
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  BookOpen, ChevronRight, ExternalLink, LayoutDashboard, LayoutGrid, LogOut, Menu, Play, Server, ShieldCheck, Wallet,
  type LucideIcon,
} from "lucide-react";
import { Toaster } from "sonner";
import { useAppKit } from "@reown/appkit/react";
import { cn } from "@/lib/utils";
import { cld, signOut } from "@/lib/cld";
import { useNetwork } from "@/hooks/useNetwork";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { WaitlistHost, openWaitlist } from "@/components/waitlist";
import { LogoMark } from "@/components/cld/logo";
import { btn, Bone, Hash, Pill, useDelayed, useNow } from "./primitives";
import { useAccount, useSession } from "./data";
import { signInWithToast } from "./actions";

type NavItem = { label: string; href: string; icon: LucideIcon };
export const NAV: NavItem[] = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Run", href: "/run", icon: Play },
  { label: "Provide", href: "/provide", icon: Server },
  { label: "Verify", href: "/verify", icon: ShieldCheck },
  { label: "Services", href: "/services", icon: LayoutGrid },
  { label: "Earnings", href: "/earnings", icon: Wallet },
  { label: "Docs", href: "/docs", icon: BookOpen },
];
const EXTRA_TITLES: Record<string, string> = { "/litepaper": "Litepaper", "/faucet": "On-chain faucet", "/economics": "Economics" };

const isActive = (loc: string, href: string) => (href === "/" ? loc === "/" || loc === "" : loc === href || loc.startsWith(href + "/"));
const titleFor = (loc: string) => NAV.find((n) => isActive(loc, n.href))?.label ?? EXTRA_TITLES[loc] ?? "Not found";

/** Top-bar wallet control (the old console's appkit-button): connect + sign in, or the signed-in address. */
function WalletButton() {
  const session = useSession();
  const { open } = useAppKit();
  const [busy, setBusy] = useState(false);
  if (session) {
    return (
      <button
        type="button"
        className={cn(btn.ghost, btn.sm, "font-mono")}
        onClick={() => (session.burner ? undefined : void open({ view: "Account" }))}
        aria-label="Wallet"
      >
        <Wallet />
        {session.address.slice(0, 6)}…{session.address.slice(-4)}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={cn(btn.primary, btn.sm)}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await signInWithToast();
        setBusy(false);
      }}
    >
      <Wallet />
      {busy ? "Signing in…" : "Connect wallet"}
    </button>
  );
}

function WalletCard() {
  const session = useSession();
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  const showBone = useDelayed(account.isLoading);

  if (!session) {
    return (
      <div className="rounded-lg border border-line-2 bg-panel p-3">
        <p className="text-xs leading-[1.5] text-muted-foreground">Sign in to run jobs, bind nodes and see earnings.</p>
        <button
          type="button"
          className={cn(btn.primary, "mt-3 w-full")}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await signInWithToast();
            setBusy(false);
          }}
        >
          <Wallet />
          {busy ? "Signing in…" : "Connect wallet"}
        </button>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-line-2 bg-panel p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[.08em] text-faint">{session.burner ? "Test wallet" : "Wallet"}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => signOut()} className="rounded-md p-1 text-faint hover:text-text" aria-label="Sign out">
              <LogOut className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="border border-line-2 bg-panel-2 text-text">Sign out</TooltipContent>
        </Tooltip>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <Hash value={session.address} />
        <a
          href={`https://sepolia.basescan.org/address/${session.address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-chain hover:brightness-110"
          aria-label="Open on Basescan"
        >
          <ExternalLink className="size-3.5" />
        </a>
      </div>
      <div className="mt-2 h-6 font-mono text-[15px] tabular-nums text-text">
        {account.data ? cld(account.data.balanceUcld) : showBone ? <Bone className="h-5 w-24" /> : account.isError ? "—" : ""}
      </div>
      {session.burner && <p className="mt-1 text-[11px] leading-[1.4] text-faint">Kept in this browser only.</p>}
    </div>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const [loc] = useLocation();
  return (
    <div className="flex h-full flex-col">
      <a href="/" className="flex h-14 shrink-0 items-center gap-2.5 px-5 font-head text-[15px] font-semibold tracking-[.06em] text-text">
        <LogoMark size={22} />
        CLOUDANA
      </a>
      <nav aria-label="Console" className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const active = isActive(loc, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors duration-150",
                    active ? "bg-panel-2 text-text" : "text-muted-foreground hover:bg-panel hover:text-text",
                  )}
                >
                  {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-ok" aria-hidden />}
                  <item.icon className={cn("size-4", active ? "text-ok" : "text-faint group-hover:text-muted-foreground")} aria-hidden />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="shrink-0 space-y-3 border-t border-line p-3">
        <WalletCard />
        <div className="flex items-center justify-between px-1">
          <Pill tone="work">Testnet</Pill>
          <Link href="/faucet" onClick={onNavigate} className="text-xs text-muted-foreground hover:text-text hover:underline underline-offset-4">
            On-chain faucet
          </Link>
        </div>
      </div>
    </div>
  );
}

function ApiDot() {
  const { data, offline, updatedAt } = useNetwork();
  const now = useNow(1000);
  const s = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;
  const state = offline ? "down" : data ? "up" : "wait";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="flex items-center gap-2 rounded-md px-2 py-1 font-mono text-[12px] text-muted-foreground hover:text-text" aria-label={`Network API ${state === "up" ? "online" : state === "down" ? "offline" : "connecting"}`}>
          <span
            className={cn(
              "size-2 rounded-full transition-[background-color,box-shadow] duration-400",
              state === "up" && "bg-ok shadow-[0_0_0_3px_rgba(63,214,194,.18)]",
              state === "down" && "bg-burn",
              state === "wait" && "bg-faint",
            )}
          />
          <span className="hidden sm:inline">{state === "up" ? "API" : state === "down" ? "API offline" : "API"}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="border border-line-2 bg-panel-2 font-mono text-[11px] text-text">
        {state === "down" ? "Network API unreachable" : state === "up" ? "Network API online" : "Connecting…"}
        {s != null && ` · updated ${s} s ago`}
      </TooltipContent>
    </Tooltip>
  );
}

export function ConsoleLayout({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const [open, setOpen] = useState(false);
  const title = titleFor(loc);
  const waitlistSurface = loc.startsWith("/services") || loc.startsWith("/provide") || loc.startsWith("/verify");

  useEffect(() => {
    document.title = `${title} · Cloudana console`;
  }, [title]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc]);

  return (
    <TooltipProvider delayDuration={250}>
      <div className="min-h-screen bg-bg text-text">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-panel-2 focus:px-3 focus:py-2">
          Skip to content
        </a>
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 border-r border-line bg-bg-2/[.92] backdrop-blur-[14px] lg:block">
          <SidebarBody />
        </aside>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="left" className="w-64 border-line bg-[rgba(12,16,23,.92)] p-0 backdrop-blur-[14px] [&>button]:text-faint">
            <SheetTitle className="sr-only">Console navigation</SheetTitle>
            <SheetDescription className="sr-only">Sections of the Cloudana console</SheetDescription>
            <SidebarBody onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>

        <div className="lg:pl-56">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-[rgba(7,9,13,.72)] px-4 backdrop-blur-[14px] sm:px-6">
            <button type="button" className={cn(btn.quiet, "-ml-1 px-2 lg:hidden")} onClick={() => setOpen(true)} aria-label="Open navigation">
              <Menu className="!size-5" />
            </button>
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
              <Link href="/" className="text-faint hover:text-text">
                Console
              </Link>
              {title !== "Overview" && (
                <>
                  <ChevronRight className="size-3.5 text-faint" aria-hidden />
                  <span className="truncate text-text" aria-current="page">
                    {title}
                  </span>
                </>
              )}
            </nav>
            <div className="ml-auto flex items-center gap-2">
              {waitlistSurface && (
                <button type="button" className={cn(btn.ghost, btn.sm, "hidden sm:inline-flex")} onClick={() => openWaitlist({})}>
                  Join the waitlist
                </button>
              )}
              <ApiDot />
              <WalletButton />
            </div>
          </header>
          <main id="main" className="mx-auto w-full max-w-[1120px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            {children}
          </main>
        </div>
      </div>
      <WaitlistHost />
      <Toaster theme="dark" position="bottom-right" duration={4000} visibleToasts={2} toastOptions={{ className: "!bg-panel-2 !border-line-2 !text-text !font-sans" }} />
    </TooltipProvider>
  );
}
