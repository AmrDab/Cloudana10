// The Cloudana service surface — one list for the homepage and the console.
// Status is the truth today (docs/V3_CONTRACT.md §8, docs/UNIVERSAL_POUW.md §4). Change it here only.
import type { LucideIcon } from "lucide-react";
import {
  Bot, Brain, Cable, Container, Cpu, Database, Globe, HardDrive, KeyRound, Layers, LayoutTemplate, ListOrdered,
  Lock, MonitorPlay, Network, Radio, Route, Server, ShieldAlert, ShieldCheck, Waypoints, Zap,
} from "lucide-react";

export type ServiceStatus = "live" | "early" | "planned";

/** The core ids — the waitlist form's interest chips. */
export type CoreServiceId =
  | "compute" | "ai-inference" | "storage" | "containers" | "hosting" | "bandwidth" | "confidential-vm" | "databases" | "verify";

/** Every catalog id. The waitlist API accepts all of them as interests. */
export type CatalogId =
  | CoreServiceId
  | "cdn" | "dns" | "tls" | "ddos" | "waf" | "edge-functions" | "object-storage" | "kv-queues" | "tunnels"
  | "zero-trust" | "website-builder" | "ai-gateway" | "agent-desktops" | "workstations";
export type ServiceId = CatalogId;

export type ServiceGroup = "compute" | "hosting" | "storage" | "security" | "coming";

export type Service = {
  id: CatalogId;
  /** @deprecated every id is a valid waitlist interest now; kept so older call sites compile. */
  interest?: CatalogId;
  name: string;
  line: string;
  icon: LucideIcon;
  status: ServiceStatus;
  group: ServiceGroup;
  /** How it is checked — probed / measured / attested; "proven" only for compute. */
  proof: string;
  /** Whether verified units earn the capped subsidy (fees always pay). */
  subsidy: boolean;
};

export const GROUPS: { id: ServiceGroup; label: string }[] = [
  { id: "compute", label: "Compute" },
  { id: "hosting", label: "Hosting & delivery" },
  { id: "storage", label: "Storage & data" },
  { id: "security", label: "Security & access" },
  { id: "coming", label: "Coming up" },
];

/** The full catalog, in group order. */
export const CATALOG: Service[] = [
  // Compute
  { id: "compute", group: "compute", name: "GPU / CPU compute", line: "Verified matrix jobs on assigned hardware.", icon: Cpu, status: "live",
    proof: "cuPOW transcript bound to the job, answer checked by Freivalds.", subsidy: true },
  { id: "ai-inference", group: "compute", name: "AI inference", line: "Int8 models, same proof rule.", icon: Brain, status: "early",
    proof: "Matrix-heavy layers will carry the same cuPOW proof.", subsidy: true },
  { id: "containers", group: "compute", name: "Containers", line: "Docker images on assigned nodes.", icon: Container, status: "early",
    proof: "Reachability probed by the orchestrator; correctness attested where hardware allows.", subsidy: false },
  // Built (docs/WORKSTATIONS.md); stays early until a Docker + GPU node runs one end to end.
  { id: "workstations", interest: "compute", group: "compute", name: "GPU workstations & rentals", line: "Jupyter, VS Code or a desktop on an assigned GPU.", icon: MonitorPlay, status: "early",
    proof: "Rented time, uptime probed; no subsidy.", subsidy: false },
  { id: "edge-functions", interest: "compute", group: "compute", name: "Edge functions", line: "Small handlers run near your users.", icon: Zap, status: "planned",
    proof: "Responses probed for content hash and latency.", subsidy: false },

  // Hosting & delivery
  // Live since 2026-10-01: a site deployed from the console was served by a node and probed ok on the local stack.
  { id: "hosting", group: "hosting", name: "Static hosting", line: "Sites served by nodes, probed every minute.", icon: Globe, status: "live",
    proof: "Reachability probed by the orchestrator every minute; browser witnesses planned.", subsidy: false },
  { id: "cdn", interest: "hosting", group: "hosting", name: "CDN & edge cache", line: "Cached copies close to every reader.", icon: Network, status: "planned",
    proof: "Random probes from many residential verifiers check hash and latency.", subsidy: true },
  { id: "dns", interest: "hosting", group: "hosting", name: "DNS", line: "Authoritative answers from many nodes.", icon: Waypoints, status: "planned",
    proof: "Answers probed from many vantage points.", subsidy: false },
  { id: "tls", interest: "hosting", group: "hosting", name: "TLS certificates", line: "Issued and renewed for every endpoint.", icon: KeyRound, status: "planned",
    proof: "Certificate validity probed on each endpoint.", subsidy: false },
  { id: "tunnels", interest: "hosting", group: "hosting", name: "Tunnels", line: "Reach home nodes behind NAT.", icon: Cable, status: "planned",
    proof: "Reachability probed through the tunnel.", subsidy: false },
  { id: "bandwidth", group: "hosting", name: "Bandwidth", line: "Paid by signed receipts.", icon: Radio, status: "planned",
    proof: "Payer-signed receipts; subsidy only on witness-probed traffic.", subsidy: true },

  // Storage & data
  { id: "storage", group: "storage", name: "Storage", line: "Sealed replicas, challenged at random.", icon: HardDrive, status: "early",
    proof: "Random chunk challenges within a latency bound, plus retrieval probes (early access).", subsidy: false },
  { id: "object-storage", interest: "storage", group: "storage", name: "Object storage", line: "Buckets over sealed replicas.", icon: Layers, status: "planned",
    proof: "Same chunk challenges as storage, plus retrieval probes.", subsidy: true },
  { id: "kv-queues", interest: "storage", group: "storage", name: "KV & queues", line: "Small state and messages for apps.", icon: ListOrdered, status: "planned",
    proof: "Availability probes only — fees, no subsidy.", subsidy: false },
  { id: "databases", group: "storage", name: "Databases & apps", line: "Stateful services, uptime-probed.", icon: Database, status: "planned",
    proof: "Availability probes only — fees, no subsidy.", subsidy: false },

  // Security & access
  { id: "ddos", interest: "hosting", group: "security", name: "DDoS shielding", line: "Absorb floods across many edges.", icon: ShieldAlert, status: "planned",
    proof: "Measured by probes during load; fees only.", subsidy: false },
  { id: "waf", interest: "hosting", group: "security", name: "WAF", line: "Filter bad requests before your app.", icon: ShieldCheck, status: "planned",
    proof: "Rule hits measured and logged; fees only.", subsidy: false },
  { id: "zero-trust", interest: "confidential-vm", group: "security", name: "Zero-trust access", line: "Wallet-signed access to private apps.", icon: Route, status: "planned",
    proof: "Access decisions signed and logged; fees only.", subsidy: false },
  { id: "confidential-vm", group: "security", name: "Confidential VMs", line: "Attested machines for private data.", icon: Lock, status: "planned",
    proof: "TEE attestation — customer assurance, attested not proven.", subsidy: false },

  // Coming up
  { id: "website-builder", interest: "hosting", group: "coming", name: "Website builder", line: "Build and publish without a terminal.", icon: LayoutTemplate, status: "planned",
    proof: "Publishes to static hosting; probed the same way.", subsidy: false },
  { id: "ai-gateway", interest: "ai-inference", group: "coming", name: "AI gateway", line: "One endpoint in front of many models.", icon: Server, status: "planned",
    proof: "Routes to inference; checked as inference is.", subsidy: false },
  { id: "agent-desktops", interest: "confidential-vm", group: "coming", name: "Remote desktops for agents", line: "Attested desktops your agents can drive.", icon: Bot, status: "planned",
    proof: "TEE attestation where hardware allows.", subsidy: false },
];

const isWaitlistId = (s: Service): s is Service & { id: ServiceId } => !s.interest;

/**
 * The services whose id is itself a waitlist interest (one per interest). Used by the waitlist form,
 * marquee, console overview and Run picker — the full list is CATALOG.
 */
export const SERVICES = CATALOG.filter(isWaitlistId);

/** The waitlist interest a service's "Request early access" sends. */
export const interestOf = (s: Service): ServiceId => s.id;

export const STATUS_LABEL: Record<ServiceStatus, string> = {
  live: "Live · testnet",
  early: "Early access",
  planned: "Planned",
};
