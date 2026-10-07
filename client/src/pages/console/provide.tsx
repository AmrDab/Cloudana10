// Console · Provide (docs/V2_BRIEF.md §4). Home node ports client/public/app/provide.html (same bind
// message + POST /v1/nodes/bind); Datacenter fleet uses /v1/fleets (token shown once).
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle, Building2, Check, Container, Cpu, Globe, HardDrive, KeyRound, Link2, Loader2, Server, ShieldCheck, Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, cld, int, short, signWithSessionWallet, throughputEarningsUcld } from "@/lib/cld";
import { useNetwork } from "@/hooks/useNetwork";
import { StatusChip } from "@/components/cld/status-chip";
import { openWaitlist } from "@/components/waitlist";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  btn, Bone, CodeBlock, CopyButton, Empty, Hash, MonoLabel, PageHeader, Panel, PanelHeader, Pill, RelTime, Tile, Unavailable,
  Updated, freshRow, useDelayed, useFreshIds,
} from "@/components/console/primitives";
import { isUnavailable, useFleets, useMyNodes, useSession, type Fleet, type MyNode } from "@/components/console/data";
import { errText, signInWithToast } from "@/components/console/actions";

// TODO(owner): the node image is not published yet — confirm the registry name before launch.
const NODE_IMAGE = "ghcr.io/amrdab/cloudana-node-agent"; // TODO(owner): publish the image
// Per node-agent/README.md; the manifest's image must be edited to NODE_IMAGE until it is published.
const K8S_MANIFEST = "node-agent/deploy/kubernetes-daemonset.yaml";

type Tab = "home" | "fleet";

export default function ProvidePage() {
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const fromAgent = !!params.get("node");
  const [tab, setTab] = useState<Tab>(params.get("tab") === "fleet" && !fromAgent ? "fleet" : "home");

  return (
    <>
      <PageHeader
        kicker="Provide"
        title="Power the network"
        lede="Your hardware runs assigned jobs and proves them. Each proven job mints CLD to your wallet. No stake."
      />
      <div role="tablist" aria-label="Provider type" className="mb-6 inline-flex rounded-lg border border-line-2 bg-bg-2 p-1">
        {([
          ["home", "Home node", Server],
          ["fleet", "Datacenter fleet", Building2],
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
                const next = tab === "home" ? "fleet" : "home";
                setTab(next);
                document.getElementById(`tab-${next}`)?.focus();
              }
            }}
            tabIndex={tab === id ? 0 : -1}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm transition-colors duration-150",
              tab === id ? "bg-panel-2 text-text ring-1 ring-line-2" : "text-muted-foreground hover:text-text",
            )}
          >
            <Icon className={cn("size-4", tab === id ? "text-ok" : "text-faint")} aria-hidden />
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "home" ? <HomeNode params={params} /> : <DatacenterFleet />}
      </div>
    </>
  );
}

// ── Home node ──────────────────────────────────────────────────────────────
function StepCard({ n, title, active, children, className }: { n: number; title: string; active?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <Panel
      className={cn(
        "flex flex-col p-5 transition-[border-color,box-shadow] duration-400",
        active && "border-ok/60 shadow-[0_0_0_3px_rgba(63,214,194,.18)]",
        className,
      )}
    >
      <div className="mb-4 flex items-center gap-3">
        <span className={cn("grid size-7 place-items-center rounded-md border font-mono text-[12px]", active ? "border-ok/60 text-ok" : "border-work/50 text-work")}>{n}</span>
        <h2 className="font-head text-base font-medium">{title}</h2>
      </div>
      {children}
    </Panel>
  );
}

const ADDR = /^0x[0-9a-f]{40}$/;

function HomeNode({ params }: { params: URLSearchParams }) {
  const session = useSession();
  const qc = useQueryClient();
  const qNode = (params.get("node") ?? "").toLowerCase();
  const qCode = params.get("code") ?? "";
  const code = /^[0-9a-f]{16}$/.test(qCode) ? qCode : "";
  const [node, setNode] = useState(ADDR.test(qNode) ? qNode : "");
  const [busy, setBusy] = useState(false);
  const [bound, setBound] = useState<string | null>(null);
  const step2 = useRef<HTMLDivElement>(null);
  const fromAgent = !!qNode;

  useEffect(() => {
    if (fromAgent) step2.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [fromAgent]);

  async function bind() {
    if (!ADDR.test(node)) return toast.error("Paste the node address the agent printed.");
    if (!code) return toast.error("Open the exact link your node agent printed", { description: "It carries a one-time bind code." });
    setBusy(true);
    try {
      let s = session;
      if (!s) s = (await signInWithToast()) as typeof session;
      if (!s) return;
      const payout = s.address;
      // Exact message the API verifies (client/api/src/routes/v1/nodes.ts).
      const message = `Cloudana node binding\nNode: ${node}\nPayout: ${payout}\nIssued: ${new Date().toISOString()}`;
      const signature = await signWithSessionWallet(message);
      await api("/nodes/bind", { method: "POST", body: { node, payout, message, signature, code } });
      setBound(node);
      toast.success("Node bound", { description: `Verified work from this node mints CLD to your wallet.` });
      qc.invalidateQueries({ queryKey: ["cld", "nodes-mine"] });
    } catch (e) {
      toast.error("Couldn't bind the node", { description: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <StepCard n={1} title="Run one command">
          <p className="mb-3 text-sm text-muted-foreground">In the Cloudana repository folder. It detects your hardware, benchmarks it and prints a bind link.</p>
          <CodeBlock code={"cd node-agent\nnpm install && npm start"} copyText="cd node-agent && npm install && npm start" />
          <p className="mt-auto pt-3 text-[12px] text-faint">Node 22+. Windows, macOS, Linux.</p>
        </StepCard>

        <div ref={step2} className="contents">
          <StepCard n={2} title="Bind your wallet" active={fromAgent && !bound}>
            {bound ? (
              <div className="flex flex-1 flex-col items-start gap-3">
                <span className="grid size-9 place-items-center rounded-full border border-ok/50 bg-ok/10 shadow-[0_0_0_3px_rgba(63,214,194,.18)]">
                  <Check className="size-4 text-ok" />
                </span>
                <p className="text-sm text-text">
                  <Hash value={bound} /> pays out to <Hash value={session?.address} />.
                </p>
                <p className="text-[12px] text-faint">The node starts taking assigned work on its next heartbeat.</p>
              </div>
            ) : (
              <>
                <p className="mb-3 text-sm text-muted-foreground">{fromAgent ? "Filled in from your agent's link. Sign to bind it." : "Open the link your agent printed — it fills this in."}</p>
                <label htmlFor="node" className="mb-1.5 block font-mono text-[11px] uppercase tracking-[.08em] text-faint">Node address</label>
                <input
                  id="node"
                  value={node}
                  onChange={(e) => setNode(e.target.value.trim().toLowerCase())}
                  placeholder="0x…"
                  spellCheck={false}
                  autoComplete="off"
                  className="h-10 w-full rounded-md border border-line-2 bg-bg-2 px-3 font-mono text-[13px] text-text placeholder:text-faint"
                />
                <div className="mt-2 flex items-center gap-2 font-mono text-[12px] text-faint">
                  <KeyRound className="size-3.5" aria-hidden />
                  {code ? <span className="text-ok">bind code present</span> : <span>no bind code — use the agent's link</span>}
                </div>
                <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                  <span className="min-w-0 truncate font-mono text-[12px] text-muted-foreground">
                    {session ? <>Payout <Hash value={session.address} /></> : "Payout: your wallet"}
                  </span>
                  <button type="button" className={btn.primary} disabled={busy || !code || !ADDR.test(node)} onClick={bind}>
                    {busy ? <Loader2 className="animate-spin" /> : <Link2 />}
                    {busy ? "Signing…" : "Bind node"}
                  </button>
                </div>
              </>
            )}
          </StepCard>
        </div>

        <StepCard n={3} title="Share what you want">
          <ul className="divide-y divide-line rounded-md border border-line">
            <ShareRow icon={Cpu} name="Compute" desc="Verified matrix jobs" on />
            <ShareRow icon={Globe} name="Hosting" desc="Static sites, probed every minute" on />
            <ShareRow icon={HardDrive} name="Storage" desc="Sealed replicas" interest="storage" />
          </ul>
          <p className="mt-auto pt-3 text-[12px] text-faint">Compute is on whenever the agent runs.</p>
        </StepCard>
      </div>

      <NodeStatus />

      <div className="grid gap-6 lg:grid-cols-3">
        <EarningsEstimate className="lg:col-span-2" />
        <FloorPrice />
      </div>
    </div>
  );
}

function ShareRow({ icon: Icon, name, desc, on, interest }: { icon: typeof Cpu; name: string; desc: string; on?: boolean; interest?: "storage" | "bandwidth" }) {
  return (
    <li className="flex items-center gap-3 px-3 py-3">
      <Icon className={cn("size-4", on ? "text-ok" : "text-faint")} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-text">{name}</div>
        <div className="text-[12px] text-faint">{desc}</div>
      </div>
      {interest ? (
        <button type="button" title="Request early access" onClick={() => openWaitlist({ role: "provide", interests: [interest] })}>
          <StatusChip status="early" className="transition-colors hover:border-work" />
        </button>
      ) : (
        <Switch checked={!!on} disabled aria-label={`Share ${name}`} className="data-[state=checked]:bg-ok data-[state=unchecked]:bg-panel-2" />
      )}
    </li>
  );
}

const FLOOR_KEY = "cld.homeFloor";
function FloorPrice() {
  const net = useNetwork();
  const [v, setV] = useState(() => {
    try {
      return localStorage.getItem(FLOOR_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [saved, setSaved] = useState(false);
  return (
    <Panel className="flex flex-col">
      <PanelHeader title="Floor price" kicker="Your minimum" right={<Pill tone="work">Not enforced yet</Pill>} />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <label htmlFor="floor" className="font-mono text-[11px] tracking-[.04em] text-faint">nCLD per tera multiply-adds</label>
        <div className="flex gap-2">
          <input
            id="floor"
            inputMode="numeric"
            value={v}
            onChange={(e) => {
              setV(e.target.value.replace(/[^0-9]/g, ""));
              setSaved(false);
            }}
            placeholder={net.data ? String(net.data.priceNcldPerTmac) : "—"}
            className="h-10 min-w-0 flex-1 rounded-md border border-line-2 bg-bg-2 px-3 font-mono text-sm tabular-nums text-text placeholder:text-faint"
          />
          <button
            type="button"
            className={btn.ghost}
            onClick={() => {
              try {
                if (v) localStorage.setItem(FLOOR_KEY, v);
                else localStorage.removeItem(FLOOR_KEY);
              } catch {
                /* storage blocked */
              }
              setSaved(true);
              setTimeout(() => setSaved(false), 1500);
            }}
          >
            {saved ? <Check className="text-ok" /> : null}
            {saved ? "Saved" : "Save"}
          </button>
        </div>
        <p className="text-[12px] leading-4 text-faint">
          Below this you won't take work. Leave empty to take the network price. Saved in this browser for now.
        </p>
      </div>
    </Panel>
  );
}

const START_CMD = "cd node-agent && npm install && npm start";

function NodeStatus({ className }: { className?: string }) {
  const session = useSession();
  const q = useMyNodes();
  const bone = useDelayed(q.isLoading);
  const nodes = q.data ?? [];
  const fresh = useFreshIds(nodes.map((n) => n.address));
  return (
    <Panel className={cn("overflow-hidden", className)}>
      <PanelHeader
        title="Node status"
        kicker="Your nodes"
        right={session && <><span className="font-mono text-[12px] tabular-nums text-faint">{q.data ? `${nodes.filter((n) => n.online).length} / ${nodes.length} online` : null}</span><Updated at={q.dataUpdatedAt || null} offline={q.isError} /></>}
      />
      {!session ? (
        <Empty icon={Wallet} title="Sign in to see the nodes bound to your wallet." action={<button className={btn.ghost} onClick={() => signInWithToast()}>Sign in</button>} />
      ) : q.isError ? (
        isUnavailable(q.error) ? <Unavailable what="Your nodes" /> : <Empty icon={AlertTriangle} title={errText(q.error)} />
      ) : q.isLoading ? (
        bone ? <NodeBones /> : <div className="h-[236px]" />
      ) : nodes.length === 0 ? (
        <Empty
          icon={Server}
          title="No nodes bound to this wallet yet. Run the agent, then open the link it prints."
          action={<CopyButton text={START_CMD} label="Copy command" />}
        />
      ) : (
        <div className="grid gap-4 p-5 xl:grid-cols-2">
          {nodes.map((n) => (
            <NodeCard key={n.address} n={n} fresh={fresh.has(n.address)} />
          ))}
        </div>
      )}
    </Panel>
  );
}

/** workTypes → the capability the node offers (V3 contract §7). */
const CAPABILITIES = [
  { workType: "matmul", label: "Compute", icon: Cpu },
  { workType: "hosting", label: "Hosting", icon: Globe },
  { workType: "container", label: "Containers", icon: Container },
] as const;

function NodeCard({ n, fresh }: { n: MyNode; fresh: boolean }) {
  const m = n.manifest;
  const gpu = m?.gpus?.length ? m.gpus.map((g) => `${g.name}${g.vramGB ? ` · ${g.vramGB} GB` : ""}`).join(", ") : "No GPU";
  const known = new Set<string>(CAPABILITIES.map((c) => c.workType));
  const other = n.workTypes.filter((w) => !known.has(w));
  return (
    <article className={cn("rounded-lg border border-line-2 bg-panel-2/40 p-4", freshRow(fresh))}>
      <div className="flex flex-wrap items-center gap-2.5">
        <span
          className={cn("size-2 rounded-full", n.online ? "bg-ok shadow-[0_0_0_3px_rgba(63,214,194,.18)]" : "bg-faint")}
          role="img"
          aria-label={n.online ? "online" : "offline"}
        />
        <Hash value={n.address} />
        {n.fleetId && <Pill tone="chain">fleet</Pill>}
        <span className="ml-auto text-[12px] text-faint">
          {n.online ? "seen" : "last seen"} <RelTime ms={n.lastSeen} className="text-[12px]" />
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Capabilities">
        {CAPABILITIES.map((c) => {
          const on = n.workTypes.includes(c.workType);
          return (
            <Pill key={c.workType} tone={on ? "ok" : "muted"} className={cn(!on && "opacity-50")}>
              <c.icon className="size-3" aria-hidden />
              {c.label}
              <span className="sr-only">{on ? " on" : " off"}</span>
            </Pill>
          );
        })}
        {other.map((w) => (
          <Pill key={w}>{w}</Pill>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px] text-muted-foreground">
        {m ? (
          <>
            <span>{int(m.cpuThreads)} threads</span>
            <span>{int(m.ramGB)} GB RAM</span>
            <span className="min-w-0 truncate">{gpu}</span>
            <span className="text-faint">{m.os}</span>
          </>
        ) : (
          <span className="text-faint">hardware not announced yet</span>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 font-mono text-[12px] sm:grid-cols-4">
        <div>
          <dt className="text-faint">Throughput</dt>
          <dd className="mt-0.5 tabular-nums text-text">
            {n.throughputMmacPerSec ? int(Math.round(n.throughputMmacPerSec)) : "—"} <span className="text-faint">MMAC/s</span>
          </dd>
        </div>
        <div>
          <dt className="text-faint">Jobs verified</dt>
          <dd className="mt-0.5 tabular-nums text-text">{int(n.jobsDone)}</dd>
        </div>
        <div>
          <dt className="text-faint">Failed</dt>
          <dd className={cn("mt-0.5 tabular-nums", n.jobsFailed ? "text-burn" : "text-text")}>{int(n.jobsFailed)}</dd>
        </div>
        <div>
          <dt className="text-faint">Minted</dt>
          <dd className="mt-0.5 tabular-nums text-ok">{cld(n.earnedUcld)}</dd>
        </div>
      </dl>
    </article>
  );
}

function NodeBones() {
  return (
    <div className="grid gap-4 p-5 xl:grid-cols-2" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="space-y-3 rounded-lg border border-line-2 p-4">
          <Bone className="h-4 w-48" />
          <Bone className="h-5 w-64" />
          <Bone className="h-3.5 w-72" />
          <Bone className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

// ── Earnings estimate ──────────────────────────────────────────────────────
/** Share of each verified job's fee minted to the provider (the rest: 3 % treasury, 2 % net burn). */
const PROVIDER_SHARE = 0.95;

function EarningsEstimate({ className }: { className?: string }) {
  const net = useNetwork();
  const nodes = useMyNodes();
  const measured = (nodes.data ?? [])
    .map((n) => ({ address: n.address, mmac: Math.round(n.throughputMmacPerSec || n.manifest?.benchmarkMmacPerSec || 0) }))
    .filter((n) => n.mmac > 0);
  const [mmac, setMmac] = useState(500);
  const [from, setFrom] = useState<string | null>(null);
  const [util, setUtil] = useState(25);
  const max = Math.max(5000, ...measured.map((n) => n.mmac));

  // Default to the first measured node once it arrives, unless the user already moved the slider.
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current || !measured.length || from) return;
    setMmac(measured[0].mmac);
    setFrom(measured[0].address);
  }, [measured, from]);

  const price = net.data?.priceNcldPerTmac ?? null;
  const hasNode = measured.length > 0;
  const perDay = price == null || !hasNode ? null : Math.round(throughputEarningsUcld(mmac, price, 86_400) * (util / 100) * PROVIDER_SHARE);

  return (
    <Panel className={cn("flex flex-col", className)}>
      <PanelHeader title="Earnings estimate" kicker="Per day" right={<Updated at={net.updatedAt} offline={net.offline} />} />
      <div className="grid flex-1 gap-6 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,220px)]">
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <label id="est-mmac" className="font-mono text-[11px] uppercase tracking-[.08em] text-faint">Benchmark</label>
              <span className="font-mono text-sm tabular-nums text-text">{int(mmac)} <span className="text-faint">MMAC/s</span></span>
            </div>
            <Slider
              aria-labelledby="est-mmac"
              min={50}
              max={max}
              step={10}
              value={[mmac]}
              onValueChange={([v]) => {
                touched.current = true;
                setMmac(v);
                setFrom(null);
              }}
            />
            {measured.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {measured.map((n) => (
                  <button
                    key={n.address}
                    type="button"
                    onClick={() => {
                      setMmac(n.mmac);
                      setFrom(n.address);
                    }}
                    aria-pressed={from === n.address}
                    className={cn(
                      "h-7 rounded-md border px-2 font-mono text-[11px] tabular-nums transition-colors duration-150",
                      from === n.address ? "border-ok/50 bg-ok/10 text-ok" : "border-line-2 text-muted-foreground hover:text-text",
                    )}
                  >
                    {short(n.address, 6, 4)} · {int(n.mmac)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <label id="est-util" className="font-mono text-[11px] uppercase tracking-[.08em] text-faint">Utilization</label>
              <span className="font-mono text-sm tabular-nums text-text">{util} %</span>
            </div>
            <Slider aria-labelledby="est-util" min={0} max={100} step={1} value={[util]} onValueChange={([v]) => setUtil(v)} />
            <p className="mt-2 text-[12px] leading-4 text-faint">Share of the day your node runs assigned work.</p>
          </div>
        </div>

        <div className="flex flex-col justify-between gap-4 rounded-md border border-line bg-bg-2 p-4">
          <div>
            <MonoLabel>Estimate</MonoLabel>
            <div className="mt-2 font-mono text-[24px] leading-none tabular-nums text-text">
              {perDay == null ? <span className="text-faint">—</span> : cld(perDay)}
            </div>
            <div className="mt-1 font-mono text-[12px] text-faint">{hasNode ? "per day" : "bind a node to see an estimate"}</div>
          </div>
          <dl className="grid gap-1 font-mono text-[12px]">
            <div className="flex justify-between gap-3">
              <dt className="text-faint">Price</dt>
              <dd className="tabular-nums text-muted-foreground">{price == null ? "—" : `${int(price)} nCLD/TMAC`}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-faint">Your share</dt>
              <dd className="tabular-nums text-muted-foreground">95 %</dd>
            </div>
          </dl>
        </div>
      </div>
      <p className="border-t border-line px-5 py-3 text-[12px] leading-4 text-faint">
        If the network kept your node {util} % busy at today's testnet price — not a forecast. Testnet CLD has no value; actual pay is per verified job.
        {net.offline && " Price unavailable while the API is offline."}
      </p>
    </Panel>
  );
}

// ── Datacenter fleet ───────────────────────────────────────────────────────
const dockerCmd = (token: string) =>
  `docker run -d --name cloudana-node --restart unless-stopped \\\n  -e CLOUDANA_FLEET_TOKEN=${token} \\\n  -v cloudana-node:/app/node-agent/.data \\\n  ${NODE_IMAGE}`;
const k8sCmd = (token: string) =>
  `kubectl create namespace cloudana\nkubectl -n cloudana create secret generic cloudana-fleet \\\n  --from-literal=CLOUDANA_FLEET_TOKEN=${token}\nkubectl apply -f ${K8S_MANIFEST}   # DaemonSet: one agent per machine`;

function DatacenterFleet() {
  const session = useSession();
  const fleets = useFleets();
  const nodes = useMyNodes();
  if (!session) {
    return (
      <Panel>
        <Empty
          icon={Building2}
          title="Sign in with the wallet that should receive payouts. One fleet token deploys to every server."
          action={
            <>
              <button className={btn.primary} onClick={() => signInWithToast()}>
                <Wallet /> Sign in
              </button>
              <button className={btn.ghost} onClick={() => openWaitlist({ role: "datacenter" })}>
                Talk to us
              </button>
            </>
          }
        />
      </Panel>
    );
  }
  const active = (fleets.data ?? []).filter((f) => !f.revokedAt);
  const fleetNodes = (nodes.data ?? []).filter((n) => n.fleetId);
  const loading = fleets.isLoading;
  const sum = (k: "nodes" | "nodesOnline" | "jobsDone") => (fleets.data ? active.reduce((a, f) => a + (f[k] ?? 0), 0) : null);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Nodes" value={sum("nodes")} loading={loading} icon={Server} caption={fleets.data ? `${int(sum("nodesOnline"))} online now` : " "} />
        <Tile label="Verified jobs" value={sum("jobsDone")} loading={loading} icon={ShieldCheck} tone="ok" caption="Across active fleets" />
        <Tile label="CLD minted" value={nodes.data ? fleetNodes.reduce((a, n) => a + n.earnedUcld, 0) : null} unit="cld" loading={nodes.isLoading} tone="chain" caption="Fees + subsidy, fleet nodes" />
        <Tile label="Active fleets" value={fleets.data ? active.length : null} loading={loading} icon={KeyRound} caption="One payout wallet" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <FleetToken />
        <FleetsTable />
      </div>
    </div>
  );
}

function FleetToken() {
  const session = useSession();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; token: string } | null>(null);
  const [kind, setKind] = useState<"docker" | "k8s">("docker");
  const token = created?.token ?? "<token>";

  async function create() {
    setBusy(true);
    try {
      const r = await api<{ id: string; token: string }>("/fleets", { method: "POST", auth: true, body: name.trim() ? { name: name.trim() } : {} });
      setCreated(r);
      toast.success("Fleet token created", { description: "Copy it now — it is shown once." });
      qc.invalidateQueries({ queryKey: ["cld", "fleets"] });
    } catch (e) {
      toast.error("Couldn't create a fleet token", { description: isUnavailable(e) ? "Fleets aren't available on this API yet." : errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="flex flex-col">
      <PanelHeader title="Fleet token" kicker="Deploy" />
      <div className="space-y-5 p-5">
        {created ? (
          <div className="rounded-md border border-work/50 bg-work/[.06] p-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-work" aria-hidden />
              <p className="text-sm text-text">
                Shown once. Store it as a secret — Cloudana keeps only its hash. Anyone with it can add nodes that pay out to you.
              </p>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-bg-2 px-3 py-2 font-mono text-[12.5px] text-text">{created.token}</code>
              <CopyButton text={created.token} />
            </div>
            <button type="button" className="mt-3 text-[12px] text-muted-foreground hover:text-text hover:underline underline-offset-4" onClick={() => setCreated(null)}>
              I've stored it — hide
            </button>
          </div>
        ) : (
          <div>
            <label htmlFor="fleet-name" className="mb-1.5 block font-mono text-[11px] uppercase tracking-[.08em] text-faint">Fleet name (optional)</label>
            <div className="flex gap-2">
              <input
                id="fleet-name"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && create()}
                placeholder="rack-a · frankfurt"
                className="h-10 min-w-0 flex-1 rounded-md border border-line-2 bg-bg-2 px-3 text-sm text-text placeholder:text-faint"
              />
              <button type="button" className={btn.primary} onClick={create} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
                Generate token
              </button>
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div role="tablist" aria-label="Deploy with" className="inline-flex rounded-md border border-line bg-bg-2 p-0.5">
              {(["docker", "k8s"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={kind === k}
                  onClick={() => setKind(k)}
                  className={cn("h-7 rounded-[5px] px-3 font-mono text-[12px]", kind === k ? "bg-panel-2 text-text" : "text-faint hover:text-text")}
                >
                  {k === "docker" ? "Docker" : "Kubernetes"}
                </button>
              ))}
            </div>
            {!created && <span className="font-mono text-[11px] text-faint">token injected after you generate it</span>}
          </div>
          <CodeBlock code={kind === "docker" ? dockerCmd(token) : k8sCmd(token)} />
        </div>

        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 border-t border-line pt-4 text-sm">
          <dt className="font-mono text-[11px] uppercase tracking-[.08em] text-faint">Payout</dt>
          <dd className="text-right"><Hash value={session?.address} /></dd>
          <dt className="font-mono text-[11px] uppercase tracking-[.08em] text-faint">Terms</dt>
          <dd className="text-right text-[12px] text-muted-foreground">Fees uncapped · subsidy capped per operator · no stake</dd>
        </dl>
      </div>
    </Panel>
  );
}

function FleetsTable() {
  const q = useFleets();
  const bone = useDelayed(q.isLoading);
  const fleets = q.data ?? [];
  const fresh = useFreshIds(fleets.map((f) => f.id));
  return (
    <Panel className="overflow-hidden">
      <PanelHeader title="Fleets" kicker="Your fleets" right={<Updated at={q.dataUpdatedAt || null} offline={q.isError} />} />
      {q.isError ? (
        isUnavailable(q.error) ? <Unavailable what="Your fleets" /> : <Empty icon={AlertTriangle} title={errText(q.error)} />
      ) : q.isLoading ? (
        bone ? <NodeBones /> : <div className="h-[180px]" />
      ) : fleets.length === 0 ? (
        <Empty icon={Building2} title="No fleet yet. Deploy the token to your first node." />
      ) : (
        <ul className="divide-y divide-line">
          {fleets.map((f) => (
            <FleetItem key={f.id} f={f} fresh={fresh.has(f.id)} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function FleetItem({ f, fresh }: { f: Fleet; fresh: boolean }) {
  const qc = useQueryClient();
  const [floor, setFloor] = useState(f.floorUcldPerMmac == null ? "" : String(f.floorUcldPerMmac));
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState<null | "floor" | "revoke">(null);
  const dirty = floor !== (f.floorUcldPerMmac == null ? "" : String(f.floorUcldPerMmac));
  const revoked = !!f.revokedAt;

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  async function saveFloor() {
    setBusy("floor");
    try {
      await api(`/fleets/${f.id}`, { method: "PATCH", auth: true, body: { floorUcldPerMmac: floor === "" ? null : Number(floor) } });
      toast.success("Fleet floor saved", { description: "Stored now; placement starts reading floors in a later release." });
      qc.invalidateQueries({ queryKey: ["cld", "fleets"] });
    } catch (e) {
      toast.error("Couldn't save the floor", { description: errText(e) });
    } finally {
      setBusy(null);
    }
  }
  async function revoke() {
    if (!armed) return setArmed(true);
    setBusy("revoke");
    try {
      await api(`/fleets/${f.id}`, { method: "DELETE", auth: true });
      toast.success("Token revoked", { description: "New nodes can't join with it. Bound nodes stay bound." });
      qc.invalidateQueries({ queryKey: ["cld", "fleets"] });
    } catch (e) {
      toast.error("Couldn't revoke", { description: errText(e) });
    } finally {
      setBusy(null);
      setArmed(false);
    }
  }

  return (
    <li className={cn("px-5 py-4", freshRow(fresh), revoked && "opacity-60")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-text">{f.name ?? "Unnamed fleet"}</span>
            {revoked ? <Pill tone="burn">revoked</Pill> : <Pill tone="ok">active</Pill>}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[12px] text-faint">
            <Hash value={f.id} head={8} tail={4} className="text-[12px]" /> · created <RelTime ms={f.createdAt} className="text-[12px]" />
          </div>
        </div>
        <dl className="flex gap-6 font-mono text-[12px]">
          <div><dt className="text-faint">Nodes</dt><dd className="tabular-nums text-text">{int(f.nodesOnline)} / {int(f.nodes)}</dd></div>
          <div><dt className="text-faint">Jobs</dt><dd className="tabular-nums text-text">{int(f.jobsDone)}</dd></div>
        </dl>
      </div>
      {!revoked && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor={`floor-${f.id}`} className="font-mono text-[11px] tracking-[.04em] text-faint">Floor · µCLD/MMAC</label>
          <input
            id={`floor-${f.id}`}
            inputMode="numeric"
            value={floor}
            onChange={(e) => setFloor(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="network"
            className="h-8 w-28 rounded-md border border-line-2 bg-bg-2 px-2 font-mono text-[12px] tabular-nums text-text placeholder:text-faint"
          />
          <button type="button" className={cn(btn.ghost, btn.sm)} disabled={!dirty || busy === "floor"} onClick={saveFloor}>
            {busy === "floor" && <Loader2 className="animate-spin" />}Save
          </button>
          <button
            type="button"
            className={cn(btn.quiet, btn.sm, "ml-auto", armed && "text-burn hover:text-burn")}
            disabled={busy === "revoke"}
            onClick={revoke}
          >
            {busy === "revoke" && <Loader2 className="animate-spin" />}
            {armed ? "Click again to revoke" : "Revoke token"}
          </button>
        </div>
      )}
    </li>
  );
}
