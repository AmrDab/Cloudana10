// Prices are quoted in US dollars and settled in CLD (docs/TOKENOMICS_USD_PRICING.md, docs/PRICES_USD.md).
// The live table and rate come from GET /v1/network; the defaults below are the approved table, used until it answers.
// The formula mirrors the API's priceUsdPerHour (client/api/src/services/deployment-spec.ts), so estimates match bills.
import { useNetwork } from "@/hooks/useNetwork";

export type GpuTier = "standard" | "large" | "h100";
export const GPU_TIERS: GpuTier[] = ["standard", "large", "h100"];
export const GPU_TIER_LABEL: Record<GpuTier, string> = { standard: "Standard", large: "Large", h100: "H100-class" };
export const GPU_TIER_HINT: Record<GpuTier, string> = {
  standard: "under 40 GB · RTX 30/40/50, T4, L4",
  large: "40–80 GB · A100, L40S, A6000",
  h100: "H100, H200, Blackwell",
};
/** Legacy request classes (before 2026-10-13) read as tiers, as the API maps them. */
export const tierOf = (cls?: string | null): GpuTier => (cls === "large" || cls === "h100" ? cls : cls === "datacenter" ? "large" : "standard");

export type PriceTable = {
  hostingUsdPerHour: number;
  cpuUsdPerHour: number;
  memUsdPerGbHour: number;
  storageUsdPerGbHour: number;
  volumeUsdPerGbHour: number;
  gpuUsdPerHour: Record<GpuTier, number>;
  interruptibleDiscount: number;
};

export const DEFAULT_PRICES: PriceTable = {
  hostingUsdPerHour: 0.0014,
  cpuUsdPerHour: 0.01,
  memUsdPerGbHour: 0.0012,
  storageUsdPerGbHour: 0.0001,
  volumeUsdPerGbHour: 0.0001,
  gpuUsdPerHour: { standard: 0.3, large: 1.2, h100: 2 },
  interruptibleDiscount: 0.5,
};
export const DEFAULT_USD_PER_CLD = 0.1;

/** The live price table and reference rate (defaults while the network API has not answered). */
export function usePrices(): { prices: PriceTable; usdPerCld: number; live: boolean } {
  const { data } = useNetwork();
  return { prices: data?.prices ?? DEFAULT_PRICES, usdPerCld: data?.usdPerCld ?? DEFAULT_USD_PER_CLD, live: !!data?.prices };
}

export type Resources = { cpu: number; memMb: number; storageMb: number };

/** US dollars per hour for a deployment, as the API computes it. */
export function hourlyUsd(
  p: PriceTable,
  kind: "static" | "container" | "workstation" | "endpoint",
  r?: Resources,
  o: { gpuCount?: number; tier?: GpuTier; volumeGb?: number; interruptible?: boolean } = {},
): number {
  if (kind === "static" || !r) return p.hostingUsdPerHour;
  let usd =
    (r.cpu / 1000) * p.cpuUsdPerHour +
    (r.memMb / 1024) * p.memUsdPerGbHour +
    (r.storageMb / 1024) * p.storageUsdPerGbHour +
    (o.gpuCount ?? 0) * p.gpuUsdPerHour[o.tier ?? "standard"];
  if (kind === "workstation") {
    usd += (o.volumeGb ?? 0) * p.volumeUsdPerGbHour;
    if (o.interruptible) usd *= 1 - p.interruptibleDiscount;
  }
  return Math.max(p.hostingUsdPerHour, usd);
}

/** "$0.36", "$0.0063", "$1,590" — enough digits that small hosting prices never read as $0.00. */
export function usd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const d = a === 0 ? 2 : a < 0.01 ? 4 : a < 1 ? 3 : a < 100 ? 2 : 0;
  const s = v.toLocaleString("en-US", { minimumFractionDigits: Math.min(d, 2), maximumFractionDigits: d });
  return `$${s}`;
}

/** CLD for a dollar amount at the rate, as a number. */
export const usdToCld = (v: number, usdPerCld: number) => v / usdPerCld;
/** Dollars for a µCLD amount at the rate. */
export const ucldToUsd = (ucld: number, usdPerCld: number) => (ucld / 1e6) * usdPerCld;

/** "3.64 CLD" with the same small-amount rules as cld(). */
export function cldAmount(v: number): string {
  const a = Math.abs(v);
  const d = a === 0 ? 2 : a < 0.001 ? 6 : a < 0.01 ? 4 : a < 1 ? 3 : 2;
  return `${v.toLocaleString("en-US", { minimumFractionDigits: Math.min(d, 2), maximumFractionDigits: d })} CLD`;
}

/** "$0.36/h ≈ 3.64 CLD" */
export const perHour = (usdPerHour: number, usdPerCld: number) => `${usd(usdPerHour)}/h ≈ ${cldAmount(usdToCld(usdPerHour, usdPerCld))}`;
