// Console · Run (docs/V2_BRIEF.md §4). Ports client/public/app/run.html: same API calls, same payloads.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronsUpDown, Coins, Cpu, Download, FlaskConical, Inbox, Loader2, MonitorPlay, Play, Rocket, ShieldCheck, Wallet, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, ApiError, cld, int, jobPriceUcld } from "@/lib/cld";
import { useNetwork } from "@/hooks/useNetwork";
import { SERVICES, type Service } from "@/lib/services";
import { StatusChip } from "@/components/cld/status-chip";
import { openWaitlist } from "@/components/waitlist";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  btn, Bone, Empty, Hash, JobChip, MonoLabel, PageHeader, Panel, PanelHeader, RelTime, Updated, Unavailable,
  freshRow, useDelayed, useFreshIds,
} from "@/components/console/primitives";
import { isUnavailable, useAccount, useJob, useJobs, useSession, type JobSummary } from "@/components/console/data";
import { errText, signInWithToast } from "@/components/console/actions";
import { downloadJson, freivalds, loadInputs, randMatrix, saveInputs } from "@/components/console/matmul";
import DeployTab from "@/pages/console/deploy";
import WorkstationsTab from "@/pages/console/workstations";

const SIZES = [16, 32, 64, 128] as const;

type Tab = "compute" | "deploy" | "workstations";
const TABS: Tab[] = ["compute", "deploy", "workstations"];

export default function RunPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const q = new URLSearchParams(search).get("tab");
  const tab: Tab = q === "deploy" || q === "workstations" ? q : "compute";
  const setTab = (t: Tab) => navigate(t === "compute" ? "/run" : `/run?tab=${t}`, { replace: true });

  return (
    <>
      <PageHeader
        kicker="Use"
        title="Run on the network"
        lede={
          tab === "compute"
            ? "Multiply two matrices on the network. The orchestrator assigns the hardware and sets the price; you get the answer with its proof."
            : tab === "workstations"
            ? "Rent a workstation — Jupyter, VS Code or a desktop — by describing what it needs. The orchestrator assigns a node that fits and sets the price."
            : "Deploy a static site or a container. The orchestrator places it on a capable node, sets the price, and probes it every minute."
        }
      />
      <div role="tablist" aria-label="What to run" className="mb-6 grid grid-cols-3 rounded-lg border border-line-2 bg-bg-2 p-1 sm:inline-flex">
        {([
          ["compute", "Compute job", Cpu],
          ["deploy", "Deploy", Rocket],
          ["workstations", "Workstations", MonitorPlay],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            type="button"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            onClick={() => setTab(id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                const next = TABS[(TABS.indexOf(tab) + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
                setTab(next);
                document.getElementById(`tab-${next}`)?.focus();
              }
            }}
            tabIndex={tab === id ? 0 : -1}
            className={cn(
              "inline-flex h-9 items-center justify-center gap-2 rounded-md px-2 text-sm whitespace-nowrap transition-colors duration-150 sm:px-4",
              tab === id ? "bg-panel-2 text-text ring-1 ring-line-2" : "text-muted-foreground hover:text-text",
            )}
          >
            <Icon className={cn("hidden size-4 sm:block", tab === id ? "text-ok" : "text-faint")} aria-hidden />
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "compute" ? <ComputeTab /> : tab === "deploy" ? <DeployTab /> : <WorkstationsTab />}
      </div>
    </>
  );
}

function ComputeTab() {
  return (
    <>
      <div className="grid gap-6 lg:grid-cols-3">
        <NewJob className="lg:col-span-2" />
        <Balance />
      </div>
      <MyJobs />
    </>
  );
}

// ── New job ────────────────────────────────────────────────────────────────
function ServicePicker({ value }: { value: Service }) {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id="svc"
          className="flex h-11 w-full items-center gap-3 rounded-md border border-line-2 bg-bg-2 px-3 text-left text-sm transition-colors duration-150 hover:bg-panel-2"
        >
          <value.icon className="size-4 text-ok" aria-hidden />
          <span className="flex-1 text-text">{value.name}</span>
          <StatusChip status={value.status} />
          <ChevronsUpDown className="size-4 text-faint" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[300px] border-line-2 bg-panel-2 p-1.5">
        <ul role="listbox" aria-label="Service">
          {SERVICES.map((s) => {
            const live = s.status === "live";
            return (
              <li key={s.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={s.id === value.id}
                  aria-disabled={!live}
                  onClick={() => {
                    setOpen(false);
                    // Hosting is live, but it is a deployment, not a compute job — it lives on the Deploy tab.
                    if (s.id === "hosting") return navigate("/run?tab=deploy", { replace: true });
                    if (!live) openWaitlist({ role: "use", interests: [s.id] });
                  }}
                  className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm hover:bg-panel"
                >
                  <s.icon className={cn("size-4", live ? "text-ok" : "text-faint")} aria-hidden />
                  <span className={cn("flex-1", live ? "text-text" : "text-muted-foreground")}>{s.name}</span>
                  {s.id === "hosting" ? (
                    <span className="text-[11px] text-ok">Deploy tab →</span>
                  ) : live ? (
                    s.id === value.id && <Check className="size-4 text-ok" />
                  ) : (
                    <span className="flex items-center gap-2">
                      <StatusChip status={s.status} />
                      <span className="text-[11px] text-ok">Request early access</span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function NewJob({ className }: { className?: string }) {
  const session = useSession();
  const net = useNetwork();
  const qc = useQueryClient();
  const service = SERVICES.find((s) => s.id === "compute")!;
  const [n, setN] = useState<number>(32);
  const [max, setMax] = useState("");
  const [busy, setBusy] = useState(false);

  const est = net.data ? jobPriceUcld(n, net.data.priceNcldPerTmac, net.data.baseFeeUcld) : null;
  const maxUcld = max.trim() === "" ? null : Math.round(Number(max) * 1e6);
  const maxInvalid = maxUcld != null && (!Number.isFinite(maxUcld) || maxUcld <= 0);
  const overCeiling = maxUcld != null && est != null && !maxInvalid && est > maxUcld;

  async function submit() {
    if (!session) return void signInWithToast();
    setBusy(true);
    try {
      const matrixA = randMatrix(n), matrixB = randMatrix(n);
      const r = await api<{ jobId: string; priceUcld: number; balanceUcld: number }>("/jobs", {
        method: "POST",
        auth: true,
        body: { workType: "matmul", n, matrixA, matrixB, public: true, ...(maxUcld && !maxInvalid ? { maxPriceUcld: maxUcld } : {}) },
      });
      saveInputs(r.jobId, n, matrixA, matrixB);
      toast.success("Job queued", { description: `${n}×${n} · ${cld(r.priceUcld)} held until it verifies` });
      qc.invalidateQueries({ queryKey: ["cld", "jobs"] });
      qc.invalidateQueries({ queryKey: ["cld", "account"] });
    } catch (e) {
      toast.error("Couldn't submit the job", { description: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className={className}>
      <PanelHeader title="New job" kicker="Compute" right={<Updated at={net.updatedAt} offline={net.offline} />} />
      <div className="grid gap-6 p-5 md:grid-cols-2">
        <div className="space-y-5">
          <Field label="Service" htmlFor="svc">
            <ServicePicker value={service} />
          </Field>
          <Field label="Size">
            <div role="radiogroup" aria-label="Matrix size" className="grid grid-cols-4 gap-1 rounded-md border border-line-2 bg-bg-2 p-1">
              {SIZES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={n === s}
                  onClick={() => setN(s)}
                  className={cn(
                    "h-9 rounded-[5px] font-mono text-[13px] tabular-nums transition-colors duration-150",
                    n === s ? "bg-panel-2 text-text ring-1 ring-line-2" : "text-muted-foreground hover:text-text",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
            <p className="mt-1.5 font-mono text-[12px] text-faint">
              {n}×{n} · {int(n ** 3)} multiply-adds · inputs made in this browser
            </p>
          </Field>
        </div>

        <div className="flex flex-col gap-5">
          <div className="rounded-md border border-line bg-bg-2 p-4">
            <MonoLabel>Price estimate</MonoLabel>
            <div className="mt-2 h-8 font-mono text-[26px] leading-8 tabular-nums text-text">
              {est == null ? <span className="text-faint">—</span> : <>≈ {cld(est)}</>}
            </div>
            <p className="mt-1 font-mono text-[12px] text-faint">
              {!net.data
                ? net.offline
                  ? "api offline — price unknown"
                  : "reading price…"
                : `${int(net.data.baseFeeUcld)} µCLD base + ${int(net.data.priceNcldPerTmac)} nCLD per tera multiply-adds · set by the orchestrator`}
            </p>
          </div>
          <Field label="Max price (optional)" htmlFor="max" hint="The job is only queued at or below this price.">
            <div className="relative">
              <input
                id="max"
                inputMode="decimal"
                value={max}
                onChange={(e) => setMax(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder={est == null ? "—" : ((est * 1.2) / 1e6).toFixed(est * 1.2 < 1e3 ? 6 : est * 1.2 < 1e4 ? 4 : 2)}
                aria-invalid={maxInvalid || overCeiling}
                className={cn(
                  "h-10 w-full rounded-md border bg-bg-2 px-3 pr-14 font-mono text-sm tabular-nums text-text placeholder:text-faint",
                  maxInvalid || overCeiling ? "border-burn/70" : "border-line-2",
                )}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-[12px] text-faint">CLD</span>
            </div>
            {overCeiling && <p className="mt-1.5 text-[12px] text-burn" aria-live="polite">The current price is above your ceiling.</p>}
          </Field>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
        <p className="text-[12px] text-faint">The fee is held until the result verifies, then burned. The provider is minted CLD for this job.</p>
        <button type="button" className={cn(btn.primary, "min-w-[140px]")} disabled={busy || maxInvalid || overCeiling} onClick={submit}>
          {busy ? <Loader2 className="animate-spin" /> : session ? <Play /> : <Wallet />}
          {busy ? "Submitting…" : session ? "Submit job" : "Sign in to submit"}
        </button>
      </div>
    </Panel>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-2 block font-mono text-[11px] uppercase tracking-[.08em] text-faint">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-[12px] leading-4 text-faint">{hint}</p>}
    </div>
  );
}

// ── Balance ────────────────────────────────────────────────────────────────
function Balance() {
  const session = useSession();
  const acct = useAccount();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const bone = useDelayed(acct.isLoading);

  async function credits() {
    setBusy(true);
    try {
      const r = await api<{ balanceUcld: number }>("/dev/credits", { method: "POST", auth: true });
      toast.success("+10 CLD test credits", { description: `Balance ${cld(r.balanceUcld)}` });
      qc.invalidateQueries({ queryKey: ["cld", "account"] });
    } catch (e) {
      toast.error("No test credits", { description: e instanceof ApiError && e.status === 404 ? "Test credits exist only on the local testnet." : errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="flex flex-col">
      <PanelHeader title="Balance" kicker="Credits" right={session && <Updated at={acct.dataUpdatedAt || null} offline={acct.isError} />} />
      {!session ? (
        <Empty
          icon={Wallet}
          title="Sign in to see your balance and get test credits."
          action={
            <button className={btn.primary} onClick={() => signInWithToast()}>
              <Wallet /> Sign in
            </button>
          }
          className="flex-1"
        />
      ) : (
        <div className="flex flex-1 flex-col justify-between gap-5 p-5">
          <div>
            <MonoLabel>Spendable</MonoLabel>
            <div className="mt-2 h-9 font-mono text-[30px] leading-9 tabular-nums text-text">
              {acct.data ? cld(acct.data.balanceUcld) : bone ? <Bone className="h-8 w-36" /> : acct.isError ? <span className="text-faint">—</span> : null}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-sm">
              <span className="text-muted-foreground">Held for running jobs</span>
              <span className="font-mono tabular-nums text-work">{acct.data ? cld(acct.data.heldUcld) : "—"}</span>
            </div>
          </div>
          <button type="button" className={cn(btn.ghost, "w-full")} onClick={credits} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Coins />}
            Get test credits
          </button>
        </div>
      )}
    </Panel>
  );
}

// ── My jobs ────────────────────────────────────────────────────────────────
function MyJobs() {
  const session = useSession();
  const q = useJobs();
  const [open, setOpen] = useState<string | null>(null);
  const jobs = q.data ?? [];
  const fresh = useFreshIds(jobs.map((j) => j.id));
  const bone = useDelayed(q.isLoading);

  // Toast when one of your jobs verifies.
  const prev = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    for (const j of jobs) {
      const was = prev.current.get(j.id);
      if (was && was !== "done" && j.status === "done") toast.success("Job verified ✓", { description: `${j.n}×${j.n} · proof accepted` });
      if (was && was !== "failed" && j.status === "failed") toast.error("Job failed", { description: `${j.n}×${j.n} · the result did not verify` });
      prev.current.set(j.id, j.status);
    }
  }, [jobs]);

  return (
    <Panel className="mt-6 overflow-hidden">
      <PanelHeader title="My jobs" kicker="History" right={session && <Updated at={q.dataUpdatedAt || null} offline={q.isError} />} />
      {!session ? (
        <Empty icon={Inbox} title="Sign in to see your jobs." action={<button className={btn.ghost} onClick={() => signInWithToast()}>Sign in</button>} />
      ) : q.isError && !q.data ? (
        isUnavailable(q.error) ? <Unavailable what="Your jobs" /> : <Empty icon={X} title={errText(q.error)} />
      ) : q.isLoading ? (
        bone ? <JobBones /> : <div className="h-[230px]" />
      ) : jobs.length === 0 ? (
        <Empty icon={FlaskConical} title="No jobs yet. Submit a 32×32 job above — it costs a fraction of a test CLD." />
      ) : (
        <>
          <table className="hidden w-full text-sm md:table">
            <thead>
              <tr className="border-b border-line text-left">
                {["Job", "Size", "Status", "Ran on", "Fee", "Submitted", ""].map((h, i) => (
                  <th key={i} className={cn("px-5 py-2.5 font-mono text-[11px] font-normal uppercase tracking-[.08em] text-faint", i >= 4 && i <= 5 && "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <JobRow key={j.id} j={j} open={open === j.id} fresh={fresh.has(j.id)} onToggle={() => setOpen(open === j.id ? null : j.id)} />
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-line md:hidden">
            {jobs.map((j) => (
              <li key={j.id} className={freshRow(fresh.has(j.id))}>
                <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" onClick={() => setOpen(open === j.id ? null : j.id)} aria-expanded={open === j.id}>
                  <div>
                    <div className="font-mono text-[13px] text-text">{j.n}×{j.n} · {cld(j.priceUcld)}</div>
                    <div className="mt-0.5"><RelTime ms={j.createdAt} className="text-[12px]" /></div>
                  </div>
                  <JobChip status={j.status} />
                </button>
                {open === j.id && <ProofPanel job={j} />}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function JobRow({ j, open, fresh, onToggle }: { j: JobSummary; open: boolean; fresh: boolean; onToggle: () => void }) {
  return (
    <>
      <tr
        className={cn("cursor-pointer border-b border-line hover:bg-panel-2", freshRow(fresh), open && "bg-panel-2")}
        onClick={onToggle}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), onToggle())}
        tabIndex={0}
        aria-expanded={open}
      >
        <td className="px-5 py-2.5"><Hash value={j.id} head={8} tail={4} /></td>
        <td className="px-5 py-2.5 font-mono text-[13px] tabular-nums text-muted-foreground">{j.n}×{j.n}</td>
        <td className="px-5 py-2.5"><JobChip status={j.status} /></td>
        <td className="px-5 py-2.5"><Hash value={j.node} /></td>
        <td className="px-5 py-2.5 text-right font-mono text-[13px] tabular-nums text-muted-foreground">{cld(j.priceUcld)}</td>
        <td className="px-5 py-2.5 text-right"><RelTime ms={j.createdAt} /></td>
        <td className="w-10 pr-4 text-right"><ChevronDown className={cn("inline size-4 text-faint transition-transform duration-250", open && "rotate-180")} /></td>
      </tr>
      {open && (
        <tr className="border-b border-line">
          <td colSpan={7} className="p-0"><ProofPanel job={j} /></td>
        </tr>
      )}
    </>
  );
}

function ProofPanel({ job }: { job: JobSummary }) {
  const d = useJob(job.id, job.status);
  const bone = useDelayed(d.isLoading);
  const inputs = useMemo(() => loadInputs(job.id), [job.id]);
  const [check, setCheck] = useState<null | "running" | { ok: boolean; ms: number }>(null);
  const cert = d.data?.certificate;
  const C = d.data?.result;

  function runCheck() {
    if (!inputs || !C) return;
    setCheck("running");
    // Yield a frame so the "Checking…" state paints before the BigInt loop.
    setTimeout(() => {
      const t0 = performance.now();
      const ok = freivalds(inputs.A, inputs.B, C, job.n);
      setCheck({ ok, ms: performance.now() - t0 });
    }, 30);
  }

  const rows: [string, React.ReactNode][] = [
    ["Job", <span className="break-all">{job.id}</span>],
    ["Status", <JobChip status={job.status} />],
    ["Ran on", cert?.node ?? job.node ?? "—"],
    ["σ (challenge seed)", cert?.sigma ?? "—"],
    ["Proof z", <span className={cert?.z ? "text-ok" : undefined}>{cert?.z ?? "—"}</span>],
    ["Draw seed", cert?.drawSeed ? `${cert.drawSeed}${cert.seedSource ? ` · from ${cert.seedSource}` : ""}` : "—"],
    ["Eligible set", cert?.eligibleHash ?? "—"],
    ["Subsidy draw", cert?.clusterOk == null ? "—" : cert.clusterOk ? "passed" : "not eligible"],
  ];

  return (
    <div className="animate-in fade-in-0 bg-bg-2 px-5 py-5 duration-250">
      {d.isLoading ? (
        bone ? <div className="space-y-2">{rows.map((_, i) => <Bone key={i} className="h-4 w-full max-w-lg" />)}</div> : <div className="h-40" />
      ) : d.isError ? (
        <p className="text-sm text-muted-foreground">{errText(d.error)}</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          <dl className="grid gap-x-6 gap-y-2 font-mono text-[12px] sm:grid-cols-[160px_1fr]">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-faint">{k}</dt>
                <dd className="break-all text-text">{v}</dd>
              </div>
            ))}
            <dt className="text-faint">Transcript</dt>
            <dd className="text-muted-foreground">Checked by the orchestrator at submission; the proof z above commits to it.</dd>
          </dl>
          <div className="flex flex-col gap-2">
            <button type="button" className={btn.ghost} disabled={!C || !inputs || check === "running"} onClick={runCheck}>
              {check === "running" ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
              {check === "running" ? "Checking…" : "Verify in browser"}
            </button>
            <p className="text-[12px] leading-4 text-faint" aria-live="polite">
              {check && check !== "running" ? (
                check.ok ? (
                  <span className="text-ok">✓ A·B = C · Freivalds, 2 rounds · {check.ms.toFixed(1)} ms</span>
                ) : (
                  <span className="text-burn">✗ The answer does not match the inputs.</span>
                )
              ) : !C ? (
                "Available once the job is done."
              ) : !inputs ? (
                "The inputs were made in another browser, so this tab can't re-check them."
              ) : (
                "Re-checks A·B = C locally with random vectors."
              )}
            </p>
            <button
              type="button"
              className={btn.ghost}
              disabled={!C}
              onClick={() => C && downloadJson(`cloudana-job-${job.id}.json`, { jobId: job.id, n: job.n, C })}
            >
              <Download /> Download C (JSON)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function JobBones() {
  return (
    <div className="divide-y divide-line" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex h-[45px] items-center gap-6 px-5">
          <Bone className="h-4 w-32" />
          <Bone className="h-4 w-12" />
          <Bone className="h-5 w-16 rounded-full" />
          <Bone className="h-4 w-28" />
          <Bone className="ml-auto h-4 w-20" />
        </div>
      ))}
    </div>
  );
}
