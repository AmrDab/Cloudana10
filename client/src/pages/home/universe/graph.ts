// The homepage universe: content only (docs/UNIVERSE_SPEC.md "Map"). Engine and shell live next door.
// Every line here must be checkable against lib/services.ts, lib/security.ts, lib/roadmap.ts, the console docs,
// the status gates and the litepaper. Nothing is a promise; the network is at zero and dim nodes are correct.
import { CATALOG, GROUPS, type Service } from "@/lib/services";
import { ROADMAP } from "@/lib/roadmap";
import { SECURITY, type SecurityItem } from "@/lib/security";
import type { NodeId, Tone, UEdge, UGraph, UNode } from "./types";

const GH = "https://github.com/AmrDab/Cloudana10";
const API_NETWORK = "https://api.cloudana.io/v1/network";

type Partial_ = Omit<UNode, "id" | "label" | "kind" | "parent">;
const region = (id: NodeId, label: string, angle: number, rest: Partial_): UNode => ({ id, label, kind: "region", parent: "proof", angle, ...rest });
const topic = (parent: NodeId, id: NodeId, label: string, rest: Partial_ = {}): UNode => ({ id, label, kind: "topic", parent, ...rest });
const leaf = (parent: NodeId, id: NodeId, label: string, rest: Partial_ = {}): UNode => ({ id, label, kind: "leaf", parent, ...rest });

// ── Core ────────────────────────────────────────────────────────────────────────────────────────
const core: UNode = {
  id: "proof",
  label: "Proof",
  kind: "core",
  tone: "ok",
  size: 1.4,
  summary: "The proof is the work.",
  body: [
    "Cloudana is a decentralized datacenter on Base (Sepolia testnet today).",
    "One orchestrator assigns every job and sets its price. Providers do not bid; users do not pick machines.",
    "Each job returns a proof. A verified job mints CLD. No work, no CLD.",
    "The network is at zero right now. Dim nodes are honest, not broken.",
  ],
  href: "/control",
  hrefLabel: "Open console",
};

// ── Run: the service catalog, straight from lib/services.ts ─────────────────────────────────────
const SERVICE_TONE: Record<Service["status"], Tone> = { live: "ok", early: "work", planned: "neutral" };

function serviceLeaf(s: Service): UNode {
  return leaf(`run-${s.group}`, `svc-${s.id}`, s.name, {
    tone: SERVICE_TONE[s.status],
    status: s.status,
    interest: s.id,
    summary: s.line,
    body: [s.proof, s.subsidy ? "Verified units earn the capped subsidy. Fees always pay." : "Paid by fees. No subsidy."],
    href: s.status === "live" ? "/control/run" : "/control/services",
    hrefLabel: s.status === "live" ? "Run it" : "Full catalog",
    size: s.status === "live" ? 1.1 : s.status === "early" ? 0.9 : 0.7,
  });
}

const roadmapLines = (): string[] => {
  const lines: string[] = [];
  let cur = "";
  for (const r of ROADMAP) {
    const next = cur ? `${cur} · ${r.name}` : r.name;
    if (next.length > 110) { lines.push(cur); cur = r.name; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
};

const runNodes: UNode[] = [
  region("run", "Run", 90, {
    tone: "work",
    summary: "Submit work. The network picks the hardware and returns the result with its proof.",
    body: [
      "Two services live on testnet: verified compute and static hosting. The rest is labelled honestly.",
      "You never choose the machine. You may set a max price; a job above it is not queued.",
    ],
    href: "/control/run",
    hrefLabel: "Run a job",
  }),
  ...GROUPS.map((g) =>
    topic("run", `run-${g.id}`, g.label, {
      tone: "work",
      summary: `${CATALOG.filter((s) => s.group === g.id).length} services. Status is the truth today.`,
      href: "/control/services",
      hrefLabel: "Full catalog",
    }),
  ),
  ...CATALOG.map(serviceLeaf),
  topic("run", "run-console", "Open console", {
    tone: "work",
    summary: "Sign in with a wallet. Submit a job, deploy a site, bind a node.",
    body: ["Everything in the console is a public, documented API."],
    href: "/control",
    hrefLabel: "Open console",
  }),
  topic("run", "run-roadmap", "Roadmap", {
    tone: "neutral",
    hidden: true,
    summary: "Coming up, in no particular order and with no dates.",
    body: roadmapLines(),
    href: "/control/services",
    hrefLabel: "Full catalog",
  }),
];

// ── Provide ─────────────────────────────────────────────────────────────────────────────────────
const provideNodes: UNode[] = [
  region("provide", "Provide", 270, {
    tone: "ok",
    summary: "One command. Your PC or your racks. Paid for every job you prove.",
    body: [
      "Home nodes join with one command. Datacenters join with one fleet token.",
      "No stake, no forms. Providers do not bid; the orchestrator assigns work and sets the price.",
    ],
    href: "/control/provide",
    hrefLabel: "Start providing",
  }),
  topic("provide", "provide-home", "Home node", {
    tone: "ok",
    summary: "Verified compute and static hosting today. Containers and GPU after hardening.",
    body: [
      "Run the agent once. It detects your hardware, benchmarks it and prints a one-time link to your wallet.",
      "Home hardware runs matrix compute and static hosting on testnet.",
      "Containers and GPU work on home nodes open after the hardening checklist.",
    ],
    href: "/control/provide",
    hrefLabel: "Bind a node",
  }),
  leaf("provide-home", "provide-bind", "Bind once", {
    tone: "ok",
    summary: "A node binds to a wallet once, with a code only its agent prints.",
    href: "/control/provide",
  }),
  leaf("provide-home", "provide-floor", "Floor price", {
    tone: "neutral",
    summary: "An optional minimum below which you take no work. The orchestrator still sets the price.",
    body: ["Not enforced yet on testnet."],
    href: "/lab",
  }),
  topic("provide", "provide-fleet", "Datacenter fleet", {
    tone: "ok",
    summary: "One fleet token, deployed with Docker or a Kubernetes DaemonSet.",
    body: [
      "Every machine that starts with the token joins your fleet and pays out to one wallet.",
      "Fleet tokens are stored as SHA-256 hashes and shown once.",
      "Fees are uncapped. The subsidy is capped per operator so no single operator dominates new issuance.",
    ],
    href: "/control/provide",
    hrefLabel: "Create a fleet token",
  }),
  leaf("provide-fleet", "provide-daemonset", "Kubernetes DaemonSet", {
    tone: "ok",
    summary: "One agent per machine. The manifest is in the repo.",
    href: `${GH}/blob/main/node-agent/deploy/kubernetes-daemonset.yaml`,
    hrefLabel: "View manifest",
  }),
  leaf("provide-fleet", "provide-containers", "Containers & GPU", {
    tone: "work",
    status: "early",
    interest: "containers",
    summary: "Docker images on hardened fleet nodes. Early access.",
    body: ["Reachability probed by the orchestrator; correctness attested where hardware allows."],
    href: "/control/services",
  }),
  topic("provide", "provide-earnings", "Earnings", {
    tone: "ok",
    summary: "95% of every fee, minted per verified job, settled in hourly testnet batches.",
    body: [
      "Each verified job mints its own CLD; the amount is fixed when the job verifies.",
      "Entries are posted to Base in batches: one Merkle root per epoch, hourly on testnet.",
      "Testnet CLD has no monetary value. No points or airdrop formula.",
    ],
    href: "/control/earnings",
    hrefLabel: "See your earnings",
  }),
  leaf("provide-earnings", "provide-per-job", "Per verified job", {
    tone: "ok",
    summary: "Minted when the proof checks out, like a block reward for useful work.",
    href: "/control/docs#cld",
  }),
  leaf("provide-earnings", "provide-founding", "Founding provider", {
    tone: "neutral",
    summary: "Reliable testnet providers carry founding-provider status to mainnet. Nothing else.",
    href: "/lab#faq",
  }),
  topic("provide", "provide-agent", "Node agent", {
    tone: "ok",
    summary: "Open source (MIT). Every message it sends is signed with the node's secp256k1 key.",
    body: [
      "Work and deployment instructions signed by a key that holds no funds: building.",
      "Nodes will ignore anything unsigned or stale.",
    ],
    href: `${GH}/tree/main/node-agent`,
    hrefLabel: "Source on GitHub",
  }),
  leaf("provide-agent", "provide-signed-messages", "Signed messages", {
    tone: "ok",
    summary: "Live: every node message carries a secp256k1 signature.",
    href: "/control/docs#security",
  }),
  leaf("provide-agent", "provide-signed-instructions", "Signed instructions", {
    tone: "work",
    summary: "Building: instructions to nodes signed by a pinned key that holds no funds.",
    href: "/control/docs#security",
  }),
];

// ── Verify ──────────────────────────────────────────────────────────────────────────────────────
const verifyNodes: UNode[] = [
  region("verify", "Verify", 0, {
    tone: "ok",
    summary: "Your browser re-checks finished work. No install, no wallet.",
    body: [
      "The orchestrator checks every σ-bound transcript; Freivalds re-checks the answer.",
      "Browsers re-check finished jobs with planted wrong ones mixed in.",
      "Testnet verification is orchestrator-coordinated. We will call it decentralized when it is.",
    ],
    href: "/control/verify",
    hrefLabel: "Verify in browser",
  }),
  topic("verify", "verify-browser", "Browser verifier", {
    tone: "ok",
    summary: "A Freivalds check (A·B = C with random vectors) in a few milliseconds.",
    body: [
      "About one task in six is planted wrong, so careless verifiers are caught.",
      "A correct verdict earns credits: points, not CLD, kept in the browser until wallet binding opens.",
    ],
    href: "/control/verify",
    hrefLabel: "Verify in browser",
  }),
  leaf("verify-browser", "verify-freivalds", "Freivalds re-check", {
    tone: "ok",
    summary: "Random vectors prove A·B = C without redoing the multiplication.",
    href: "/control/verify",
  }),
  leaf("verify-browser", "verify-planted", "Planted tasks", {
    tone: "ok",
    summary: "About one in six tasks is wrong on purpose. Rubber-stamping is caught.",
    href: "/control/verify",
  }),
  leaf("verify-browser", "verify-credits", "Credits, not CLD", {
    tone: "neutral",
    summary: "Verifiers earn points kept in the browser. They are not CLD.",
    href: "/control/verify",
  }),
  topic("verify", "verify-cupow", "cuPOW", {
    tone: "ok",
    summary: "The full matrix-multiplication transcript is the proof. The decoded result is your answer.",
    body: [
      "The transcript is σ-bound to the job, so it cannot be reused or faked for another one.",
      "Checked by the σ-bound transcript, a Freivalds re-check and planted tasks.",
    ],
    href: `${GH}/tree/main/pouw`,
    hrefLabel: "Source on GitHub",
  }),
  leaf("verify-cupow", "verify-sigma", "σ-assignment", {
    tone: "ok",
    summary: "Each transcript is bound to its job by σ. One job, one proof.",
    href: `${GH}/tree/main/pouw`,
  }),
  leaf("verify-cupow", "verify-transcript", "Transcript = proof", {
    tone: "ok",
    summary: "Proving the work is computing the work. No separate puzzle is solved.",
    href: "/lab#faq",
  }),
  topic("verify", "verify-orchestrator", "Orchestrator check", {
    tone: "neutral",
    summary: "The orchestrator checks every proof before a job mints. Your browser can re-check it.",
    href: "/control/docs#verify",
    hrefLabel: "How it works",
  }),
  topic("verify", "verify-onchain", "On-chain verifier", {
    tone: "neutral",
    summary: "Groth16 zkSNARK verification of transcripts on-chain. In development.",
    body: ["Circuit source is public. Not deployed."],
    href: `${GH}/tree/main/circuits`,
    hrefLabel: "Circuits on GitHub",
  }),
  topic("verify", "verify-lab", "Lab", {
    tone: "ok",
    hidden: true,
    summary: "The live instruments: a real miner, live numbers, the verifier, a payment.",
    href: "/lab",
    hrefLabel: "Open the lab",
  }),
];

// ── Settle (CLD) ────────────────────────────────────────────────────────────────────────────────
const settleNodes: UNode[] = [
  region("settle", "Settle (CLD)", 180, {
    tone: "chain",
    summary: "The fee is burned; CLD is minted for the verified job and settled on Base in batches.",
    body: [
      "Only one event creates CLD: a verified, paid job.",
      "CLD is the unit of account. USD is display only. Nothing about CLD is a promise of price or return.",
    ],
    href: "/litepaper.html",
    hrefLabel: "Read the litepaper",
  }),
  topic("settle", "settle-split", "Fee split 95 / 3 / 2", {
    tone: "chain",
    summary: "The fee is burned. Provider minted 95%, treasury 3%, 2% destroyed for good.",
    body: ["Enforced in the ledger on testnet; enforced on-chain before mainnet."],
    href: "/control/docs#cld",
    hrefLabel: "How CLD is minted",
  }),
  leaf("settle-split", "settle-provider", "95% to the provider", { tone: "ok", summary: "Minted to whoever did the verified work.", href: "/control/docs#cld" }),
  leaf("settle-split", "settle-treasury", "3% to the treasury", { tone: "chain", summary: "Funds the free tier and operations. A one-way-down knob.", href: "/control/docs#cld" }),
  leaf("settle-split", "settle-burn", "2% burned", { tone: "burn", summary: "Destroyed for good on every verified job.", href: "/control/docs#cld" }),
  leaf("settle-split", "settle-fee-burn", "The fee is burned", { tone: "burn", summary: "Held in escrow until the result verifies, then burned at settlement.", href: "/control/docs#use" }),
  topic("settle", "settle-epochs", "Epochs", {
    tone: "chain",
    summary: "Hourly on testnet: one Merkle root per epoch on Base, then a veto window as long.",
    body: [
      "Batching is delivery, not the reward unit. Each job's CLD is fixed when it verifies.",
      "Daily epochs and veto at mainnet. A guardian can veto a bad root.",
    ],
    href: "/control/docs#cld",
    hrefLabel: "How CLD is minted",
  }),
  leaf("settle-epochs", "settle-merkle", "Merkle root", { tone: "chain", summary: "One root per epoch carries every minted entry.", href: "/control/docs#cld" }),
  leaf("settle-epochs", "settle-veto", "Veto window", { tone: "chain", summary: "Claims open only after the window passes without a veto.", href: "/control/docs#cld" }),
  leaf("settle-epochs", "settle-keeper", "Settlement keeper", {
    tone: "work",
    summary: "Building: the epoch poster runs apart from the API; the API holds no chain key.",
    href: `${GH}/tree/main/keeper`,
    hrefLabel: "Keeper on GitHub",
  }),
  topic("settle", "settle-subsidy", "Subsidy lane", {
    tone: "chain",
    summary: "Small, capped, declining. Only for providers in genuinely independent clusters.",
    body: [
      "Paid only when the orchestrator's random draw picked the provider, so routing jobs to yourself does not pay.",
      "Withheld from any operator above the cluster share cap, and from everyone below three independent clusters.",
      "Vests before it can be claimed.",
    ],
    href: "/control/docs#cld",
    hrefLabel: "How CLD is minted",
  }),
  leaf("settle-subsidy", "settle-capped", "Capped & declining", { tone: "chain", summary: "At most a fixed share of genesis per year, halving every four years.", href: "/litepaper.html" }),
  leaf("settle-subsidy", "settle-cluster", "Cluster gate", { tone: "chain", summary: "Testnet: three clusters minimum, per-operator share cap 50%.", href: "/control/docs#cld" }),
  leaf("settle-subsidy", "settle-draw", "Random draw", { tone: "chain", summary: "Placement is a weighted random draw by the orchestrator, not a choice.", href: "/control/docs#how" }),
  topic("settle", "settle-contracts", "Base Sepolia contracts", {
    tone: "chain",
    summary: "Fresh token and settlement v2 under a Safe. Deploying now.",
    body: [
      "Fee split checked on every epoch post. Hourly epochs.",
      "Nothing that carries real value ships before this, signed instructions and an audit.",
    ],
    href: `${GH}/tree/main/contract/contracts/v2`,
    hrefLabel: "Contracts on GitHub",
  }),
  leaf("settle-contracts", "settle-token", "CLDTokenV2", { tone: "chain", summary: "The token contract. Source is public.", href: `${GH}/tree/main/contract/contracts/v2` }),
  leaf("settle-contracts", "settle-settlement", "CloudanaSettlementV2", { tone: "chain", summary: "Takes the epoch root, enforces the split, runs the veto window.", href: `${GH}/tree/main/contract/contracts/v2` }),
  leaf("settle-contracts", "settle-safe", "Safe 2-of-3", { tone: "chain", summary: "Planned for v2: admin and minter roles under a 2-of-3 Safe, with a fresh poster key.", href: "/control/docs#security" }),
  topic("settle", "settle-price", "Price", {
    tone: "chain",
    summary: "nCLD per tera-MAC plus a small per-job base fee, set from utilization. No oracle.",
    body: [
      "Moves at most 2% per hour toward a 70% utilization target and holds when the network is idle.",
      "A quote is locked for five minutes. Users may add a ceiling; providers may add a floor.",
    ],
    href: "/control/docs#price",
    hrefLabel: "How price is set",
    live: { stat: "priceNcldPerTmac", format: "price", full: 1 },
  }),
  leaf("settle-price", "settle-controller", "Utilization controller", { tone: "chain", summary: "±2% per hour toward 70% utilization. Holds when idle.", href: "/control/docs#price" }),
  leaf("settle-price", "settle-base-fee", "Base fee", { tone: "chain", summary: "A flat part of every job fee, in µCLD.", href: "/control/docs#price" }),
  leaf("settle-price", "settle-ceiling", "Ceiling & floor", { tone: "neutral", summary: "Both optional. Neither changes the orchestrator's price.", href: "/control/docs#price" }),
  topic("settle", "settle-sim", "20-year simulation", {
    tone: "chain",
    hidden: true,
    summary: "Simulation, not a forecast. CLD/USD is an input, not an output.",
    href: "/control/economics",
    hrefLabel: "Open the simulation",
  }),
];

// ── Security: exactly lib/security.ts, nothing more ─────────────────────────────────────────────
const securityLeaf = (parent: NodeId, tone: Tone, s: SecurityItem): UNode =>
  leaf(parent, `sec-${s.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, s.label, {
    tone,
    summary: s.detail.length <= 90 ? s.detail : `${s.tag}.`,
    body: s.detail.length <= 90 ? undefined : [s.detail],
    href: "/control/docs#security",
  });

const LIVE_KEYS = SECURITY.live.slice(0, 4);
const LIVE_CHECKS = SECURITY.live.slice(4);

const securityNodes: UNode[] = [
  region("security", "Security", 225, {
    tone: "neutral",
    summary: "Every message signed. Every proof re-checked. Secrets sealed to the node that runs them.",
    body: ["What is live, building and planned, stated plainly. Never more than that."],
    href: "/control/docs#security",
    hrefLabel: "What is live, building, planned",
  }),
  topic("security", "security-keys", "Identity & keys", {
    tone: "ok",
    summary: "Live: wallet sign-in, signed node messages, one-time bind codes, hashed fleet tokens.",
    href: "/control/docs#security",
  }),
  ...LIVE_KEYS.map((s) => securityLeaf("security-keys", "ok", s)),
  topic("security", "security-checks", "Checks & limits", {
    tone: "ok",
    summary: "Live: re-checked proofs, rate limits and CORS, guarded settlement, TLS in transit.",
    href: "/control/docs#security",
  }),
  ...LIVE_CHECKS.map((s) => securityLeaf("security-checks", "ok", s)),
  topic("security", "security-building", "Building", {
    tone: "work",
    summary: "Signed node instructions, hash-checked hosting probes, an isolated keeper, sealed secrets.",
    href: "/control/docs#security",
  }),
  ...SECURITY.building.map((s) => securityLeaf("security-building", "work", s)),
  topic("security", "security-planned", "Planned", {
    tone: "neutral",
    summary: "Encrypted jobs at rest, confidential VMs, browser witness probes.",
    href: "/control/docs#security",
  }),
  ...SECURITY.planned.map((s) => securityLeaf("security-planned", "neutral", s)),
  topic("security", "security-custody", "Key custody", {
    tone: "chain",
    summary: "Token and settlement under a Safe; the API Worker holds no hot chain key.",
    body: ["Every legacy contract and its keys are abandoned with the v2 deploy."],
    href: "/control/docs#security",
  }),
];

// ── Network: the living nodes, bound to useNetwork() ────────────────────────────────────────────
const GATES: { id: string; name: string; state: "testnet" | "open"; note: string }[] = [
  { id: "e2e", name: "End to end: job → proof → mint → result", state: "testnet", note: "Works end to end in tests. First public nodes coming online." },
  { id: "contract", name: "Settlement contract on Base Sepolia", state: "open", note: "Fresh token + settlement v2 under a Safe, hourly epochs, fee split checked on every post. Deploying now." },
  { id: "zk", name: "zkSNARK transcript verification on-chain", state: "open", note: "Groth16 verifier in development." },
  { id: "audit", name: "Audit of settlement and token contracts", state: "open", note: "Not started." },
  { id: "legal", name: "Legal review of CLD", state: "open", note: "Not started." },
];

const networkNodes: UNode[] = [
  region("network", "Network", 135, {
    tone: "ok",
    summary: "Live numbers from the orchestrator. Zero is zero; nothing here is decorative.",
    body: ["Polled every 15 seconds from GET /v1/network. Dim when the API is offline."],
    href: "/lab",
    hrefLabel: "Open the lab",
    live: { stat: "nodesOnline", format: "int", full: 25 },
  }),
  topic("network", "net-nodes", "Nodes online", {
    tone: "ok",
    summary: "Machines heartbeating right now.",
    href: "/control/provide",
    hrefLabel: "Add yours",
    live: { stat: "nodesOnline", format: "int", full: 25 },
  }),
  leaf("net-nodes", "net-bound", "Nodes bound", { tone: "ok", summary: "Nodes bound to a wallet, online or not.", live: { stat: "nodesBound", format: "int", full: 25 } }),
  leaf("net-nodes", "net-gpus", "GPUs online", { tone: "ok", summary: "GPUs reported by online nodes.", live: { stat: "gpusOnline", format: "int", full: 10 } }),
  leaf("net-nodes", "net-deployments", "Deployments running", { tone: "ok", summary: "Sites and containers served right now.", live: { stat: "deploymentsRunning", format: "int", full: 10 } }),
  leaf("net-nodes", "net-workstations", "Workstations running", { tone: "work", summary: "Rented GPU desktops and notebooks in use.", live: { stat: "workstationsRunning", format: "int", full: 5 } }),
  topic("network", "net-work", "Jobs done", {
    tone: "ok",
    summary: "Jobs verified and minted since genesis.",
    href: "/control/run",
    hrefLabel: "Run a job",
    live: { stat: "jobsDone", format: "int", full: 1000 },
  }),
  leaf("net-work", "net-queued", "Jobs queued", { tone: "work", summary: "Waiting for an assignment.", live: { stat: "jobsQueued", format: "int", full: 20 } }),
  leaf("net-work", "net-certificates", "Certificates", { tone: "ok", summary: "Proofs that checked out.", live: { stat: "certificates", format: "int", full: 1000 } }),
  leaf("net-work", "net-verifiers", "Verifiers today", { tone: "ok", summary: "Browsers that re-checked work today.", href: "/control/verify", live: { stat: "verifiersToday", format: "int", full: 50 } }),
  topic("network", "net-cld", "CLD minted", {
    tone: "chain",
    summary: "Testnet CLD minted for verified jobs. No monetary value.",
    href: "/control/economics",
    hrefLabel: "Economics",
    live: { stat: "mintedUcld", format: "cld", full: 1e9 },
  }),
  leaf("net-cld", "net-burned", "CLD burned", { tone: "burn", summary: "Fees burned at settlement.", live: { stat: "burnedUcld", format: "cld", full: 1e9 } }),
  leaf("net-cld", "net-epoch", "Epoch", { tone: "chain", summary: "Current settlement epoch. Hourly on testnet.", live: { stat: "epoch", format: "epoch", full: 1 } }),
  leaf("net-cld", "net-price", "Price", { tone: "chain", summary: "Current quote, nCLD per tera-MAC.", href: "/control/docs#price", live: { stat: "priceNcldPerTmac", format: "price", full: 1 } }),
  topic("network", "net-status", "Status", {
    tone: "neutral",
    summary: "Five gates before CLD carries value. Zero are closed.",
    href: "/lab#faq",
    hrefLabel: "Questions",
  }),
  ...GATES.map((g) =>
    leaf("net-status", `gate-${g.id}`, g.name, {
      tone: g.state === "testnet" ? "work" : "neutral",
      summary: g.state === "testnet" ? "Testnet." : "Open.",
      body: [g.note],
      href: "/control/docs",
    }),
  ),
  topic("network", "net-api", "API", {
    tone: "neutral",
    summary: "Everything in the console is a public, documented API.",
    body: ["GET /v1/network returns the numbers on this map."],
    href: API_NETWORK,
    hrefLabel: "GET /v1/network",
  }),
];

// ── Assemble ────────────────────────────────────────────────────────────────────────────────────
const nodes: UNode[] = [core, ...runNodes, ...provideNodes, ...verifyNodes, ...settleNodes, ...securityNodes, ...networkNodes];

const CROSS: [NodeId, NodeId][] = [
  ["run", "settle"], // every paid job settles
  ["provide", "verify"], // every job is re-checked
  ["verify", "settle"], // no proof, no mint
  ["security", "provide"], // signed messages, sealed secrets
  ["network", "run"],
  ["network", "provide"],
  ["network", "verify"],
  ["network", "settle"],
];

const edges: UEdge[] = [
  ...nodes.filter((n) => n.parent).map((n): UEdge => ({ from: n.parent as NodeId, to: n.id, kind: "primary" })),
  ...CROSS.map(([from, to]): UEdge => ({ from, to, kind: "cross" })),
];

export const GRAPH: UGraph = { root: "proof", nodes, edges };

export const NODE_INDEX: Record<NodeId, UNode> = Object.fromEntries(nodes.map((n) => [n.id, n]));

const CHILDREN: Record<NodeId, UNode[]> = {};
for (const n of nodes) if (n.parent) (CHILDREN[n.parent] ??= []).push(n);

/** Direct children (primary edges) in declaration order. */
export function childrenOf(id: NodeId): UNode[] {
  return CHILDREN[id] ?? [];
}

/** core → … → node. Empty when the id is unknown. */
export function pathTo(id: NodeId): UNode[] {
  const path: UNode[] = [];
  for (let cur: UNode | undefined = NODE_INDEX[id]; cur; cur = cur.parent ? NODE_INDEX[cur.parent] : undefined) path.unshift(cur);
  return path;
}
