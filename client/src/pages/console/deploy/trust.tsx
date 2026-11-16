// Trust tiers (docs/TRUST_TIERS.md §3, §6): the lowest tier of host a container, workstation or endpoint runs on, chosen
// on its form with the §6 disclosure for that tier, and shown beside it in the lists. Community hosting opens only once
// the sandbox, the egress policy and relay-only access are live (§3 rule 5): until then it is shown but not selectable.
import { cn } from "@/lib/utils";
import type { TrustTier } from "@/components/console/data";

/** docs/TRUST_TIERS.md §6, verbatim (after the tier's name). */
export const TRUST_DISCLOSURE: Record<TrustTier, string> = {
  community:
    "runs on a stranger's computer. Your traffic is encrypted, and your disk is encrypted at rest and wiped when you're done, but the person who owns the machine could read what it's doing while it runs. Use it for code and data you'd put on a public server.",
  verified:
    "runs only on providers Cloudana has identity-checked who signed our provider agreement. Fit for business data that is not regulated. It is a contractual guarantee, not a technical one.",
};

const TIERS: { tier: TrustTier; label: string; note: string; open: boolean }[] = [
  { tier: "verified", label: "Verified", note: "identity-checked providers", open: true },
  { tier: "community", label: "Community", note: "opens later", open: false },
];

/** The tier choice (Verified by default) and the disclosure for the chosen tier. */
export function TrustPicker({ value, onChange }: { value: TrustTier; onChange: (t: TrustTier) => void }) {
  const chosen = TIERS.find((t) => t.tier === value)!;
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="Trust" className="grid grid-cols-2 gap-1 rounded-md border border-line-2 bg-bg-2 p-1">
        {TIERS.map((t) => (
          <button
            key={t.tier}
            type="button"
            role="radio"
            aria-checked={value === t.tier}
            disabled={!t.open}
            onClick={() => onChange(t.tier)}
            className={cn(
              "rounded-[5px] px-2 py-2 text-left transition-colors duration-150",
              value === t.tier ? "bg-panel-2 ring-1 ring-line-2" : t.open ? "hover:bg-panel" : "cursor-not-allowed opacity-50",
            )}
          >
            <span className={cn("block font-mono text-[13px]", value === t.tier ? "text-text" : "text-muted-foreground")}>{t.label}</span>
            <span className="block font-mono text-[11px] text-faint">{t.note}</span>
          </button>
        ))}
      </div>
      <p className="text-[12px] leading-4 text-faint" aria-live="polite">
        <b className="font-medium text-muted-foreground">{chosen.label}:</b> {TRUST_DISCLOSURE[value]}
      </p>
    </div>
  );
}

/** The tier beside a deployment in a list (the disclosure is its tooltip). */
export function TrustTag({ trust, className }: { trust?: TrustTier; className?: string }) {
  if (!trust) return null;
  return (
    <span className={cn("font-mono text-[11px] text-faint", className)} title={`${trust === "verified" ? "Verified" : "Community"}: ${TRUST_DISCLOSURE[trust]}`}>
      {trust}
    </span>
  );
}
