// Console · Overview (docs/V2_BRIEF.md §4): live tiles, recent proofs, your position, the full service surface.
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Boxes, CheckCircle2, ChevronDown, Flame, Play, Server, ShieldCheck, Sparkles, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { cld, int } from "@/lib/cld";
import { useNetwork } from "@/hooks/useNetwork";
import { CATALOG, interestOf } from "@/lib/services";
import { StatusChip } from "@/components/cld/status-chip";
import { openWaitlist } from "@/components/waitlist";
import {
  btn, Bone, Empty, Hash, MonoLabel, PageHeader, Panel, PanelHeader, RelTime, Tile, Unavailable, Updated, absTime,
  freshRow, useDelayed, useFreshIds,
} from "@/components/console/primitives";
import { isUnavailable, useJobs, useLedger, useMyNodes, useRecent, useSession, type RecentJob } from "@/components/console/data";
import { signInWithToast } from "@/components/console/actions";

export default function OverviewPage() {
  const net = useNetwork();
  const d = net.data;
  const loading = !d && !net.offline;
  return (
    <>
      <PageHeader
        kicker="Console"
        title="Overview"
        lede="Read from the orchestrator every 15 s. Zero is shown as zero."
        right={<Updated at={net.updatedAt} offline={net.offline} />}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,.85fr)]">
        <Tile label="Nodes online" value={d?.nodesOnline} loading={loading} icon={Server} caption={d ? `${int(d.nodesBound)} bound` : net.offline ? "api offline" : " "} />
        <Tile label="Verified jobs" value={d?.certificates} loading={loading} icon={CheckCircle2} tone="ok" caption={d ? `${int(d.jobsQueued)} in queue` : net.offline ? "api offline" : " "} />
        <Tile label="CLD minted" value={d?.mintedUcld} unit="cld" loading={loading} icon={Sparkles} tone="chain" caption="Per verified job" />
        <Tile label="CLD burned" value={d?.burnedUcld} unit="cld" loading={loading} icon={Flame} tone="burn" caption="Every fee" />
        <div className="col-span-2 grid grid-cols-2 gap-3 md:col-span-4 xl:col-span-1 xl:grid-cols-1">
          <MiniStat label="Settlement epoch · hourly" value={d ? `#${int(d.epoch)}` : null} loading={loading} />
          <MiniStat label="Price" value={d ? `${int(d.priceNcldPerTmac)} nCLD/TMAC` : null} loading={loading} />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <RecentProofs className="lg:col-span-2" />
        <YourPosition />
      </div>

      <ServicesStrip />
    </>
  );
}

function MiniStat({ label, value, loading }: { label: string; value: string | null; loading: boolean }) {
  const bone = useDelayed(loading && !value);
  return (
    <div className="flex flex-col justify-center rounded-lg border border-line bg-bg-2 px-4 py-3">
      <MonoLabel>{label}</MonoLabel>
      <div className="mt-1.5 h-5 font-mono text-[14px] tabular-nums text-text">{value ?? (bone ? <Bone className="h-4 w-24" /> : loading ? null : <span className="text-faint">—</span>)}</div>
    </div>
  );
}

function RecentProofs({ className }: { className?: string }) {
  const q = useRecent();
  const [, go] = useLocation();
  const [open, setOpen] = useState<string | null>(null);
  const jobs = (q.data ?? []).slice(0, 10);
  const fresh = useFreshIds(jobs.map((j) => j.id));
  const bone = useDelayed(q.isLoading);

  return (
    <Panel className={cn("overflow-hidden", className)}>
      <PanelHeader title="Recent proofs" kicker="Network" right={<Updated at={q.dataUpdatedAt || null} offline={q.isError && isUnavailable(q.error)} />} />
      {q.isError ? (
        <Unavailable what="Verified jobs" />
      ) : q.isLoading ? (
        bone ? <TableBones /> : <div className="h-[364px]" />
      ) : jobs.length === 0 ? (
        <Empty
          icon={ShieldCheck}
          title="No proofs yet. Run a job or start verifying."
          action={
            <>
              <button className={btn.primary} onClick={() => go("/run")}>
                <Play /> Run a job
              </button>
              <button className={btn.ghost} onClick={() => go("/verify")}>
                <ShieldCheck /> Start verifying
              </button>
            </>
          }
        />
      ) : (
        <>
          <table className="hidden w-full text-sm sm:table">
            <thead>
              <tr className="border-b border-line text-left">
                {["Proof z", "Provider", "Size", "Fee", "When", ""].map((h, i) => (
                  <th key={i} className={cn("px-5 py-2.5 font-mono text-[11px] font-normal uppercase tracking-[.08em] text-faint", (i === 3 || i === 4) && "text-right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <ProofRow key={j.id} j={j} open={open === j.id} fresh={fresh.has(j.id)} onToggle={() => setOpen(open === j.id ? null : j.id)} />
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-line sm:hidden">
            {jobs.map((j) => (
              <li key={j.id} className={cn("flex items-center justify-between gap-3 px-4 py-3", freshRow(fresh.has(j.id)))}>
                <div className="min-w-0">
                  <Hash value={j.z} />
                  <div className="mt-0.5 font-mono text-[12px] text-faint">
                    {j.n}×{j.n} · {cld(j.priceUcld)}
                  </div>
                </div>
                <RelTime ms={j.finishedAt} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function ProofRow({ j, open, fresh, onToggle }: { j: RecentJob; open: boolean; fresh: boolean; onToggle: () => void }) {
  return (
    <>
      <tr
        className={cn("cursor-pointer border-b border-line last:border-0 hover:bg-panel-2", freshRow(fresh), open && "bg-panel-2")}
        onClick={onToggle}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), onToggle())}
        tabIndex={0}
        aria-expanded={open}
      >
        <td className="px-5 py-2.5"><Hash value={j.z} /></td>
        <td className="px-5 py-2.5"><Hash value={j.node} /></td>
        <td className="px-5 py-2.5 font-mono text-[13px] tabular-nums text-muted-foreground">{j.n}×{j.n}</td>
        <td className="px-5 py-2.5 text-right font-mono text-[13px] tabular-nums text-muted-foreground">{cld(j.priceUcld)}</td>
        <td className="px-5 py-2.5 text-right"><RelTime ms={j.finishedAt} /></td>
        <td className="w-10 pr-4 text-right"><ChevronDown className={cn("inline size-4 text-faint transition-transform duration-250", open && "rotate-180")} /></td>
      </tr>
      {open && (
        <tr className="border-b border-line bg-bg-2">
          <td colSpan={6} className="px-5 py-4">
            <dl className="grid gap-x-8 gap-y-2 font-mono text-[12px] sm:grid-cols-[auto_1fr]">
              <dt className="text-faint">Job</dt><dd className="break-all text-text">{j.id}</dd>
              <dt className="text-faint">Proof z</dt><dd className="break-all text-ok">{j.z ?? "—"}</dd>
              <dt className="text-faint">Ran on</dt><dd className="break-all text-text">{j.node ?? "—"}</dd>
              <dt className="text-faint">Work</dt><dd className="text-text">{j.workType} · {j.n}×{j.n} · fee {cld(j.priceUcld)} burned</dd>
              <dt className="text-faint">Verified</dt><dd className="text-text">{absTime(j.finishedAt)}</dd>
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}

function TableBones() {
  return (
    <div className="divide-y divide-line" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex h-[45px] items-center gap-6 px-5">
          <Bone className="h-4 w-28" />
          <Bone className="h-4 w-28" />
          <Bone className="h-4 w-12" />
          <Bone className="ml-auto h-4 w-16" />
          <Bone className="h-4 w-14" />
        </div>
      ))}
    </div>
  );
}

function YourPosition() {
  const session = useSession();
  if (!session) {
    return (
      <Panel className="flex flex-col">
        <PanelHeader title="Your position" kicker="You" />
        <div className="flex flex-col gap-5 p-5">
          <div>
            <h3 className="font-head text-xl font-medium leading-[1.15] tracking-[-.02em]">Get in early.</h3>
            <p className="mt-2 text-sm leading-[1.55] text-muted-foreground">One list for users, providers, verifiers and datacenters. We email when your branch opens.</p>
          </div>
          <div className="flex flex-col gap-2">
            <button className={btn.primary} onClick={() => openWaitlist({})}>
              Join the waitlist <ArrowRight />
            </button>
            <button className={btn.ghost} onClick={() => signInWithToast()}>
              Sign in to see your jobs and nodes
            </button>
          </div>
        </div>
      </Panel>
    );
  }
  return <SignedInPosition address={session.address} />;
}

function SignedInPosition({ address }: { address: string }) {
  const jobs = useJobs();
  const nodes = useMyNodes();
  const ledger = useLedger(address);
  const dayAgo = Date.now() - 86_400_000;
  const today = jobs.data?.filter((j) => j.createdAt >= dayAgo) ?? null;
  const doneToday = today?.filter((j) => j.status === "done").length ?? 0;
  const online = nodes.data?.filter((n) => n.online).length ?? 0;

  return (
    <Panel className="flex flex-col">
      <PanelHeader title="Your position" kicker="You" right={<Hash value={address} />} />
      <ul className="flex-1 divide-y divide-line">
        <PosRow
          icon={Play}
          label="Jobs, 24 h"
          value={today ? `${int(today.length)}` : null}
          loading={jobs.isLoading}
          sub={today ? `${doneToday} verified` : jobs.isError ? "unavailable" : ""}
          href="/run"
        />
        <PosRow
          icon={Server}
          label="Your nodes"
          value={nodes.data ? `${online} / ${nodes.data.length}` : null}
          loading={nodes.isLoading}
          sub={nodes.data ? (nodes.data.length ? "online / bound" : "none bound yet") : nodes.isError ? "unavailable" : ""}
          href="/provide"
          tone={online > 0 ? "ok" : undefined}
        />
        <PosRow
          icon={ShieldCheck}
          label="Verifier credits"
          value={ledger.data ? int(ledger.data.credits) : null}
          loading={ledger.isLoading}
          sub="Credits, not CLD"
          href="/verify"
        />
        <PosRow
          icon={Timer}
          label="Earned, not yet settled"
          value={ledger.data ? cld(ledger.data.pending.A + ledger.data.pending.B) : null}
          loading={ledger.isLoading}
          sub="Minted per verified job"
          href="/earnings"
        />
      </ul>
    </Panel>
  );
}

function PosRow({ icon: Icon, label, value, sub, loading, href, tone }: { icon: typeof Play; label: string; value: string | null; sub?: string; loading: boolean; href: string; tone?: "ok" }) {
  const bone = useDelayed(loading && value == null);
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 px-5 py-3.5 transition-colors duration-150 hover:bg-panel-2">
        <span className="grid size-8 place-items-center rounded-md border border-line bg-bg-2">
          <Icon className={cn("size-4", tone === "ok" ? "text-ok" : "text-faint")} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-text">{label}</span>
          <span className="block text-[12px] text-faint">{sub}</span>
        </span>
        <span className="font-mono text-[15px] tabular-nums text-text">{value ?? (bone ? <Bone className="h-4 w-12" /> : "—")}</span>
      </Link>
    </li>
  );
}

function ServicesStrip() {
  const [, go] = useLocation();
  return (
    <section className="mt-10" aria-labelledby="svc-h">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <MonoLabel>Services</MonoLabel>
          <h2 id="svc-h" className="mt-1 font-head text-xl font-medium tracking-[-.02em]">Everything a datacenter does.</h2>
        </div>
        <Link href="/services" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-text hover:underline underline-offset-4">
          Catalog <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {CATALOG.filter((s) => s.status !== "planned").map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => (s.status !== "live" ? openWaitlist({ role: "use", interests: [interestOf(s)] }) : go(s.id === "hosting" ? "/run?tab=deploy" : "/run"))}
            className="group flex min-h-[112px] flex-col justify-between gap-3 rounded-lg border border-line-2 bg-panel p-4 text-left transition-colors duration-150 hover:bg-panel-2"
          >
            <div className="flex items-start justify-between gap-2">
              <s.icon className={cn("size-[18px]", s.status === "live" ? "text-ok" : "text-faint")} aria-hidden />
              <StatusChip status={s.status} className="hidden sm:inline-flex" />
            </div>
            <div>
              <div className="text-sm font-medium text-text">{s.name}</div>
              <div className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-faint">{s.line}</div>
              <StatusChip status={s.status} className="mt-2 sm:hidden" />
            </div>
            <span className="sr-only">{s.status === "live" ? "Open" : "Request early access"}</span>
          </button>
        ))}
        <Link
          href="/services"
          className="flex min-h-[112px] flex-col justify-between rounded-lg border border-dashed border-line-2 p-4 text-left transition-colors duration-150 hover:bg-panel-2"
        >
          <ArrowRight className="size-[18px] text-faint" aria-hidden />
          <div>
            <div className="text-sm font-medium text-text">{CATALOG.filter((s) => s.status === "planned").length} more planned</div>
            <div className="mt-0.5 text-[12px] leading-4 text-faint">CDN, DNS, TLS, tunnels, confidential VMs…</div>
          </div>
        </Link>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[12px] text-faint">
        <Boxes className="size-3.5" aria-hidden /> Same orchestrator, same proof rule. Status is the truth today.
      </p>
    </section>
  );
}
