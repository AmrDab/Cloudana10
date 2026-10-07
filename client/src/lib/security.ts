// What Cloudana secures today, this sprint, and later — exactly docs/V3_CONTRACT.md §9, no more.
// Never: "military-grade", "unhackable", "zero-knowledge", "audited".
import type { LucideIcon } from "lucide-react";
import {
  Binary, Fingerprint, Gauge, KeyRound, Landmark, Lock, PenLine, Radar, ScanEye, ShieldCheck, Ticket, Hash,
} from "lucide-react";

/** `tag` is the mechanism in one mono token, shown on the homepage; `detail` is the one-line explanation. */
export type SecurityItem = { label: string; tag: string; detail: string; icon: LucideIcon };

export const SECURITY: { live: SecurityItem[]; building: SecurityItem[]; planned: SecurityItem[] } = {
  live: [
    { label: "Wallet sign-in", tag: "EIP-191", icon: Fingerprint, detail: "Server nonce + EIP-191 signature; short-lived JWT kept in the tab only." },
    { label: "Signed node messages", tag: "secp256k1", icon: PenLine, detail: "Every node message is signed with the node's secp256k1 key." },
    { label: "One-time bind codes", tag: "single use", icon: Ticket, detail: "A node binds to a wallet once, with a code only its agent prints." },
    { label: "Hashed fleet tokens", tag: "SHA-256", icon: Hash, detail: "Stored as SHA-256 hashes and shown once." },
    { label: "Re-checked proofs", tag: "Freivalds", icon: Binary, detail: "σ-bound cuPOW transcripts, Freivalds re-check, planted verifier tasks." },
    { label: "Rate limits & CORS", tag: "allow-list", icon: Gauge, detail: "Per-route rate limits and a CORS allow-list." },
    { label: "Guarded settlement", tag: "veto window", icon: Landmark, detail: "One Merkle root per epoch on Base with a veto window and a guardian." },
    { label: "TLS in transit", tag: "production", icon: Lock, detail: "Every production connection is TLS." },
  ],
  building: [
    { label: "Signed node instructions", tag: "pinned signer", icon: PenLine, detail: "Work and deployment instructions are signed by a key that holds no funds; nodes ignore anything unsigned or stale." },
    { label: "Hash-checked hosting probes", tag: "SHA-256", icon: Hash, detail: "Sites are served through a Cloudana gateway and probed against the hash of the files you uploaded." },
    { label: "Isolated settlement keeper", tag: "separate Worker", icon: Landmark, detail: "The epoch poster runs apart from the API; the API holds no chain key." },
    { label: "Sealed secrets", tag: "browser → node", icon: KeyRound, detail: "Container env encrypted in your browser to the assigned node's key; the orchestrator never sees plaintext." },
  ],
  planned: [
    { label: "Encrypted jobs at rest", tag: "your keys", icon: ShieldCheck, detail: "Job inputs and results encrypted at rest with your keys." },
    { label: "Confidential VMs", tag: "TEE", icon: ScanEye, detail: "Workloads inside attested TEEs." },
    { label: "Browser witness probes", tag: "uptime", icon: Radar, detail: "Browsers probe endpoints for uptime and content." },
  ],
};
