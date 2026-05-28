/**
 * Source of truth for the public Decentralization Status page (/control/decentralization).
 * Mirrors DECENTRALIZATION_ROADMAP.md. Keep the two in sync — this page is a transparency
 * commitment, so it must reflect verifiable facts, not aspirations.
 */

export type DecentralizationLevel = "centralized" | "hybrid" | "decentralized";
export type LitmusStatus = "fail" | "partial" | "pass";

export const LITMUS_TEST =
  "If Cloudana Inc. vanished tonight, would the network keep matching jobs and paying providers?";

/** Where we are RIGHT NOW, per component. */
export interface ComponentStatus {
  name: string;
  level: DecentralizationLevel;
  detail: string;
}

export const COMPONENTS: ComponentStatus[] = [
  { name: "Provider & workload registration", level: "decentralized", detail: "On-chain via ProviderRegistry / WorkloadRegistry — permanently yours." },
  { name: "Provider withdrawals", level: "decentralized", detail: "withdrawEarnings() is permissionless; no one can block your payout." },
  { name: "Fraud & slashing", level: "decentralized", detail: "StakingManager + ChallengeManager run optimistic fraud proofs on-chain." },
  { name: "Storage (IPFS)", level: "hybrid", detail: "Content-addressed CIDs, but pinning currently defaults to one gateway." },
  { name: "API / control plane", level: "centralized", detail: "Cloudflare Worker + D1 + KV today. Scheduled to leave Cloudflare by Phase 3." },
  { name: "Matchmaking", level: "centralized", detail: "An off-chain orchestrator picks the provider (ORCHESTRATOR_ROLE). Becomes optional in Phase 2." },
  { name: "Reward routing", level: "centralized", detail: "rewardProvider() is orchestrator-only today. Opens to any staked party in Phase 2." },
  { name: "POUW verification", level: "centralized", detail: "Trust-based on testnet. Replaced by on-chain zkSNARK / challenge in Phase 2." },
  { name: "Templates & frontend hosting", level: "centralized", detail: "D1 + Cloudflare Pages. IPFS/ENS-hosted console lands in Phase 3." },
];

export interface Phase {
  id: string;
  name: string;
  tagline: string;
  current: boolean;
  litmus: LitmusStatus;
  changes: string[];
  exit: string;
}

export const PHASES: Phase[] = [
  {
    id: "today",
    name: "Today — Baseline",
    tagline: "Honest starting point",
    current: true,
    litmus: "fail",
    changes: [
      "Contracts live on Base Sepolia; your balance and registrations are already on-chain.",
      "Everything else — matching, rewards, POUW, hosting — still depends on us.",
    ],
    exit: "Stand up the testnet loop end-to-end.",
  },
  {
    id: "phase-1",
    name: "Phase 1 — Testnet Bootstrap",
    tagline: "Engine running, training wheels on",
    current: false,
    litmus: "fail",
    changes: [
      "Real providers earn testnet CLD with the full on-chain payment loop.",
      "Orchestrator runs off rented Akash / VPS — $0 owned hardware.",
      "Open-source the orchestrator + provider software; rotate the orchestrator key.",
    ],
    exit: "≥5 providers earning CLD they didn't supply; disaster-recovery test passed.",
  },
  {
    id: "phase-2",
    name: "Phase 2 — P2P + On-Chain First-Claim",
    tagline: "First steps to trustlessness",
    current: false,
    litmus: "partial",
    changes: [
      "libp2p network: DHT discovery + NAT traversal, no central coordinator.",
      "Any staked provider can claim a job directly on-chain — the orchestrator stops gating.",
      "Trustless POUW (zkSNARK on-chain or optimistic + ChallengeManager).",
      "API moves off Cloudflare-only (Cloudflare becomes an optional cache).",
    ],
    exit: "A workload matched & run with the orchestrator offline; ORCHESTRATOR_ROLE → multisig; 10+ community providers.",
  },
  {
    id: "phase-3",
    name: "Phase 3 — The Cloudflare Divorce",
    tagline: "Community providers, self-sovereign infra",
    current: false,
    litmus: "partial",
    changes: [
      "One-command provider agent — plug in with zero Cloudana involvement.",
      "IPFS/ENS-hosted console; templates move to an on-chain + IPFS registry.",
      "Staked orchestrator rotation replaces the single key; on-chain governance.",
      "Workload sandboxing (gVisor/Kata) enforced; hard Cloudflare dependency removed.",
    ],
    exit: "20+ independent providers onboarded with no team involvement; minting behind governance.",
  },
  {
    id: "phase-4",
    name: "Phase 4 — Trustless Execution",
    tagline: "Network runs without us",
    current: false,
    litmus: "pass",
    changes: [
      "On-chain disputes fully wired; permissionless fraud-proof finalization.",
      "Decentralized libp2p bootstrap (ENS/DHT) — no team-run nodes required.",
      "GPU-native POUW with on-chain difficulty adjustment.",
      "Team renounces unilateral roles; admin behind a timelocked Governor.",
    ],
    exit: "72-hour team-offline chaos test passes; community executes a governance proposal.",
  },
  {
    id: "phase-5",
    name: "Phase 5 — Open Protocol",
    tagline: "Protocol, not product",
    current: false,
    litmus: "pass",
    changes: [
      "Published spec; independent provider & frontend implementations.",
      "DAO treasury self-funds development; cross-chain CLD.",
    ],
    exit: "Multiple independent implementations live.",
  },
];

export const COMMITMENTS: string[] = [
  "This page reflects verifiable facts (contract addresses, role holders, hosting origin) — not aspirations.",
  'We won\'t market Cloudana as "decentralized" before Phase 3 — only "progressively decentralizing".',
  "Testnet POUW is trust-based until the zkSNARK ships, and is labeled as such.",
  "Orchestrator & provider software are open source before Phase 2.",
];
