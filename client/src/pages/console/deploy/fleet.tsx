// Fleet pinning (B-9, owner decision 2026-10-21): run a container, workstation or endpoint only on one of your fleets
// or on a partner's fleet chosen by its id — never on a single node — and show each node's fleet beside its address.
import { useState } from "react";
import { cn } from "@/lib/utils";
import { short } from "@/lib/cld";
import { useFleets, type NodeFleet } from "@/components/console/data";

/** A fleet id as the API issues it (routes/v1/fleets.ts). */
export const FLEET_ID = /^flt_[0-9a-f]{16}$/;
const PARTNER = "partner";

/** The state behind FleetPin: choice "" = any node, a fleet id, or "partner" (its id is pasted). */
export function useFleetPin() {
  const [choice, setChoice] = useState("");
  const [partner, setPartner] = useState("");
  const fleetId = choice === PARTNER ? partner.trim() : choice;
  const error = choice === PARTNER && !FLEET_ID.test(fleetId) ? "A fleet id is flt_ followed by 16 characters 0–9 or a–f." : null;
  return { choice, setChoice, partner, setPartner, fleetId: fleetId || null, error };
}
export type FleetPinState = ReturnType<typeof useFleetPin>;

/** The spec's placement field for the pin, or nothing. */
export const placementOf = (p: FleetPinState) => (p.fleetId && !p.error ? { placement: { fleetId: p.fleetId } } : {});

const input = "h-10 w-full rounded-md border border-line-2 bg-bg-2 px-3 text-sm text-text placeholder:text-faint";

/** "Run only on a fleet": any node (the default), one of your fleets, or a partner's fleet by the id they gave you. */
export function FleetPin({ pin, id, showError }: { pin: FleetPinState; id: string; showError?: boolean }) {
  const fleets = useFleets();
  const mine = (fleets.data ?? []).filter((f) => !f.revokedAt);
  const chosen = mine.find((f) => f.id === pin.choice);
  const bad = !!showError && !!pin.error;
  return (
    <div className="space-y-2">
      <select id={id} aria-label="Run only on a fleet" value={pin.choice} onChange={(e) => pin.setChoice(e.target.value)} className={cn(input, "font-mono text-[13px]")}>
        <option value="">Any node that fits (not pinned)</option>
        {mine.map((f) => (
          <option key={f.id} value={f.id}>{`${f.name ?? "unnamed"} · ${f.id} · ${f.nodesOnline} online`}</option>
        ))}
        <option value={PARTNER}>A partner's fleet: paste its id…</option>
      </select>
      {pin.choice === PARTNER && (
        <input
          value={pin.partner}
          onChange={(e) => pin.setPartner(e.target.value)}
          placeholder="flt_0123456789abcdef"
          spellCheck={false}
          autoComplete="off"
          aria-label="Partner fleet id"
          aria-invalid={bad}
          className={cn(input, "font-mono text-[13px]", bad && "border-burn/70")}
        />
      )}
      <p className={cn("text-[12px] leading-4", bad ? "text-burn" : "text-faint")} aria-live="polite">
        {bad
          ? pin.error
          : chosen && chosen.nodesOnline === 0
            ? "No node of this fleet is online right now: it waits until one is."
            : "Only nodes of the chosen fleet run it, so secrets are sealed only to them. You choose a fleet, never a single node."}
      </p>
    </div>
  );
}

/** "fleet Acme (flt_0123…cdef)". */
export const fleetLabel = (f: NodeFleet) => `fleet ${f.name ? `${f.name} (${short(f.id, 8, 4)})` : short(f.id, 8, 4)}`;

/** " · fleet Acme (flt_0123…cdef)" beside a node address: the node's fleet, so you see where secrets go. */
export function FleetTag({ fleet, className }: { fleet?: NodeFleet | null; className?: string }) {
  if (!fleet) return null;
  return (
    <span className={cn("font-mono text-[12px] text-muted-foreground", className)} title={fleet.id}>
      {" · "}
      {fleetLabel(fleet)}
    </span>
  );
}
