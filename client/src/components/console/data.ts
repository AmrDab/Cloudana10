// Console data hooks — thin react-query wrappers over the v1 API (@/lib/cld).
// Every hook passes its own queryFn: the app-wide QueryClient's default fetcher targets the legacy API.
import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, getSession, subscribeSession, type Session } from "@/lib/cld";

export function useSession(): Session | null {
  // getSession() parses sessionStorage each call; cache by raw string so the snapshot is stable.
  return useSyncExternalStore(subscribeSession, sessionSnapshot, () => null);
}
let lastRaw: string | null = null;
let lastSession: Session | null = null;
function sessionSnapshot() {
  const raw = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem("cld.session");
  if (raw !== lastRaw) {
    lastRaw = raw;
    lastSession = getSession();
  }
  return lastSession;
}

/** A route that isn't deployed yet (404) or an unreachable API — shown as the designed "unavailable" state. */
export const isUnavailable = (e: unknown) =>
  e instanceof ApiError && (e.code === "offline" || e.code === "not_found" || e.status === 404);

const poll = (ms: number) => ({ refetchInterval: ms, refetchIntervalInBackground: false, staleTime: 0, retry: false as const });

export type Account = { address: string; balanceUcld: number; heldUcld: number };
export function useAccount() {
  const s = useSession();
  return useQuery({
    queryKey: ["cld", "account", s?.address],
    queryFn: () => api<Account>("/account", { auth: true }),
    enabled: !!s,
    ...poll(10_000),
  });
}

export type JobSummary = {
  id: string;
  workType: string;
  n: number;
  priceUcld: number;
  public: boolean;
  status: "queued" | "assigned" | "done" | "failed";
  node: string | null;
  createdAt: number;
  assignedAt: number | null;
  completedAt: number | null;
};
export type Certificate = {
  z: string | null;
  sigma: string | null;
  node: string | null;
  seedSource: string | null;
  drawSeed: string | null;
  eligibleHash: string | null;
  clusterOk: boolean | null;
};
export type JobDetail = JobSummary & { result?: number[]; certificate: Certificate | null };

export function useJobs() {
  const s = useSession();
  return useQuery({
    queryKey: ["cld", "jobs", s?.address],
    queryFn: () => api<{ jobs: JobSummary[] }>("/jobs", { auth: true }).then((r) => r.jobs),
    enabled: !!s,
    ...poll(3_000),
  });
}

export function useJob(id: string | null, status?: string) {
  const s = useSession();
  return useQuery({
    queryKey: ["cld", "job", id, status],
    queryFn: () => api<{ job: JobDetail }>(`/jobs/${id}`, { auth: true }).then((r) => r.job),
    enabled: !!s && !!id,
    retry: false,
    staleTime: status === "done" ? Infinity : 0,
  });
}

export type RecentJob = { id: string; n: number; workType: string; node: string | null; z: string | null; priceUcld: number; finishedAt: number };
export function useRecent() {
  return useQuery({
    queryKey: ["cld", "recent"],
    queryFn: () => api<{ jobs: RecentJob[] }>("/network/recent").then((r) => r.jobs),
    ...poll(15_000),
  });
}

export type MyNode = {
  address: string;
  lastSeen: number | null;
  online: boolean;
  boundAt: number | null;
  manifest: { cpuThreads: number; ramGB: number; gpus: { name: string; vramGB: number }[]; os: string; benchmarkMmacPerSec?: number } | null;
  /** Verified weight (MMAC/s); manifest.benchmarkMmacPerSec is self-reported. */
  throughputMmacPerSec: number;
  workTypes: string[];
  fleetId: string | null;
  jobsDone: number;
  jobsFailed: number;
  earnedUcld: number;
};
export function useMyNodes() {
  const s = useSession();
  return useQuery({
    queryKey: ["cld", "nodes-mine", s?.address],
    queryFn: () => api<{ nodes: MyNode[] }>("/nodes/mine", { auth: true }).then((r) => r.nodes),
    enabled: !!s,
    ...poll(10_000),
  });
}

export type Fleet = {
  id: string;
  name: string | null;
  floorUcldPerMmac: number | null;
  nodes: number;
  nodesOnline: number;
  jobsDone: number;
  createdAt: number;
  revokedAt: number | null;
};
export function useFleets() {
  const s = useSession();
  return useQuery({
    queryKey: ["cld", "fleets", s?.address],
    queryFn: () => api<{ fleets: Fleet[] }>("/fleets", { auth: true }).then((r) => r.fleets),
    enabled: !!s,
    ...poll(15_000),
  });
}

export type LedgerEntry = {
  id: string;
  jobId: string;
  epoch: number;
  lane: "A" | "B" | "treasury" | "verify";
  workType: string;
  amountUcld: number;
  vestsAt: number;
  status: string; // pending → posted → settled (or clawed)
  createdAt: number;
};
export type Ledger = {
  address: string;
  pending: { A: number; B: number; treasury: number };
  vesting: { B: number };
  settled: { A: number; B: number };
  credits: number;
  entries: LedgerEntry[];
};
export function useLedger(address?: string | null) {
  return useQuery({
    queryKey: ["cld", "ledger", address],
    queryFn: () => api<Ledger>(`/ledger/${address}`),
    enabled: !!address,
    ...poll(10_000),
  });
}

// ── Templates & deployments (docs/V3_CONTRACT.md §3–§4) ─────────────────────

export type Template = {
  id: string;
  name: string;
  summary: string;
  readme: string;
  logoUrl: string | null;
  /** Akash-style SDL; container defaults (image, resources, ports) are read from it. */
  deploy: string;
  githubUrl?: string;
  config?: { logoUrl?: string; [k: string]: unknown };
  /** Set by the API for curated Cloudana starters; inferred client-side when absent. */
  kind?: "static" | "container";
  curated?: boolean;
  category?: string;
  // Structured defaults (curated templates); imported ones only have the SDL above.
  image?: string | null;
  command?: string[];
  ports?: number[];
  cpu?: number;
  memMb?: number;
  storageMb?: number;
  env?: Record<string, string>;
  /** Variable names the template expects as secrets (values entered by the user, sealed to the node). */
  secretEnv?: string[];
  files?: { path: string; contentBase64: string }[];
};
export type TemplateCategory = { title: string; description?: string; templates: Template[] };

export function useTemplates() {
  return useQuery({
    queryKey: ["cld", "templates"],
    queryFn: () => api<{ data: TemplateCategory[] }>("/templates").then((r) => r.data ?? []),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useTemplate(id: string | null) {
  return useQuery({
    queryKey: ["cld", "template", id],
    queryFn: () => api<{ data: Template }>(`/templates/${encodeURIComponent(id!)}`).then((r) => r.data),
    enabled: !!id,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export type DeploymentStatus = "queued" | "assigned" | "running" | "unreachable" | "stopped" | "failed";
export type Deployment = {
  id: string;
  templateId: string | null;
  name: string;
  kind: "static" | "container";
  status: DeploymentStatus;
  statusReason: string | null;
  node: string | null;
  endpoint: string | null;
  priceUcldPerHour: number;
  createdAt: number;
  assignedAt: number | null;
  startedAt: number | null;
  stoppedAt: number | null;
  lastProbeAt: number | null;
  probeOk: boolean | null;
  spec: unknown;
};
export type DeploymentEvent = { id?: string; at: number; level: string; message: string };
export type DeploymentDetail = { deployment: Deployment; events: DeploymentEvent[]; nodePubkey?: string };

export const isTerminal = (s: DeploymentStatus) => s === "stopped" || s === "failed";

export function useDeployments() {
  const s = useSession();
  return useQuery({
    queryKey: ["cld", "deployments", s?.address],
    queryFn: () => api<{ deployments: Deployment[] }>("/deployments", { auth: true }).then((r) => r.deployments ?? []),
    enabled: !!s,
    ...poll(15_000),
    // 5 s while anything is still moving, 15 s once everything is stopped or failed.
    refetchInterval: (q) => (q.state.data?.some((d) => !isTerminal(d.status)) ? 5_000 : 15_000),
  });
}

export function useDeployment(id: string | null, ms: number | false = 5_000) {
  const s = useSession();
  return useQuery({
    queryKey: ["cld", "deployment", id],
    queryFn: () => api<DeploymentDetail>(`/deployments/${id}`, { auth: true }),
    enabled: !!s && !!id,
    staleTime: 0,
    retry: false,
    refetchInterval: ms,
    refetchIntervalInBackground: false,
  });
}

// ── Workstations (docs/WORKSTATIONS.md §1, §4) ──────────────────────────────

export type GpuClass = "any" | "consumer" | "datacenter";
export type WorkstationTier = "on-demand" | "interruptible";
export type WorkstationSpec = {
  image: string;
  command?: string[];
  env?: Record<string, string>;
  ports: { container: number; protocol?: "tcp" }[];
  cpu: number;
  memMb: number;
  storageMb: number;
  gpu?: { count: number; minVramGb?: number; class?: GpuClass };
  tier: WorkstationTier;
  maxHours: number;
  access: { web?: { port: number; path?: string }; ssh?: { publicKey: string } };
  volume?: { sizeGb: number; keepDays: number };
};

/** A curated environment template (`kind: "workstation"`, §6). */
export type WorkstationTemplate = Omit<Template, "kind"> & {
  kind: "workstation";
  gpu?: { count: number; minVramGb?: number; class?: GpuClass };
  access?: { web?: { port: number; path?: string }; ssh?: boolean | { port?: number } };
  workdir?: string;
  sshPort?: number;
  tokenEnv?: string;
};
export const isWorkstationTemplate = (t: { kind?: string }) => t.kind === "workstation";

export type Workstation = Omit<Deployment, "kind" | "spec"> & { kind: "workstation"; spec: WorkstationSpec };
export type WorkstationDetail = {
  deployment: Workstation;
  events: DeploymentEvent[];
  nodePubkey?: string;
  connect?: { web?: string; ssh?: string };
  hoursUsed?: number;
  hoursLeft?: number;
  gpu?: { count: number; names: string[] };
};

/** `GET /network` additions; absent until the API reports them. */
export type WorkstationCapacity = { gpusOnline?: number; workstationsRunning?: number };

/** Your workstations — the same request and cache entry as useDeployments, filtered to kind "workstation". */
export function useWorkstations() {
  const s = useSession();
  return useQuery({
    queryKey: ["cld", "deployments", s?.address],
    queryFn: () => api<{ deployments: Deployment[] }>("/deployments", { auth: true }).then((r) => r.deployments ?? []),
    select: (all) => (all as unknown as (Deployment | Workstation)[]).filter((d): d is Workstation => d.kind === "workstation"),
    enabled: !!s,
    ...poll(15_000),
    refetchInterval: (q) => (q.state.data?.some((d) => !isTerminal(d.status)) ? 5_000 : 15_000),
  });
}

export function useWorkstation(id: string | null, ms: number | false = 5_000) {
  const s = useSession();
  return useQuery({
    queryKey: ["cld", "deployment", id],
    queryFn: () => api<WorkstationDetail>(`/deployments/${id}`, { auth: true }),
    enabled: !!s && !!id,
    staleTime: 0,
    retry: false,
    refetchInterval: ms,
    refetchIntervalInBackground: false,
  });
}

/** `PATCH /deployments/{id} { maxHours }` — extend a running or assigned workstation (1–720 h). */
export const extendWorkstation = (id: string, maxHours: number) =>
  api(`/deployments/${id}`, { method: "PATCH", auth: true, body: { maxHours } });
