// "Coming up" — docs/V3_CONTRACT.md §10. No dates. Each item's CTA opens the waitlist with `interest`.
import type { ServiceId } from "@/lib/services";

export type RoadmapItem = { id: string; name: string; line: string; interest: ServiceId };

export const ROADMAP: RoadmapItem[] = [
  { id: "website-builder", name: "Website builder", line: "No terminal needed.", interest: "hosting" },
  { id: "tunnels", name: "Tunnels for home nodes", line: "Serve behind NAT.", interest: "hosting" },
  { id: "postgres", name: "Databases & apps", line: "Managed databases, run for you.", interest: "databases" },
  { id: "confidential", name: "Confidential VMs & agent desktops", line: "Attested private machines.", interest: "confidential-vm" },
  { id: "witness", name: "Browser witness network", line: "Browsers probe uptime.", interest: "verify" },
  { id: "object-storage", name: "Object storage", line: "Sealed-replica buckets.", interest: "storage" },
  { id: "edge-functions", name: "Edge functions", line: "Code near users.", interest: "compute" },
  { id: "fiat", name: "Fiat on-ramp", line: "Buy CLD into your own wallet.", interest: "compute" },
  { id: "base-settlement", name: "Mainnet on Base", line: "Fee split enforced on-chain.", interest: "compute" },
  { id: "cli", name: "CLI", line: "Rent and deploy from a terminal.", interest: "compute" },
  { id: "autoscaling", name: "Autoscaling", line: "More replicas when load rises.", interest: "compute" },
  { id: "team-accounts", name: "Team accounts", line: "Shared credits and access.", interest: "compute" },
  { id: "cloud-sync", name: "Cloud sync", line: "Sync workstation volumes to storage.", interest: "compute" },
];
