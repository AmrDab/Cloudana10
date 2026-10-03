// Console · Verify (docs/V2_BRIEF.md §4): the browser verifier at full width.
import { useNetwork } from "@/hooks/useNetwork";
import { int } from "@/lib/cld";
import { VerifierInstrument } from "@/components/cld/verifier-instrument";
import { PageHeader } from "@/components/console/primitives";

export default function VerifyPage() {
  const { data } = useNetwork();
  return (
    <>
      <PageHeader
        kicker="Verify"
        title="Check the network from this tab."
        lede="Your browser re-runs a Freivalds check on finished jobs. Some are planted wrong — a correct verdict earns credits."
        right={<span className="font-mono text-xs tabular-nums text-faint">{data ? `${int(data.verifiersToday)} verifier${data.verifiersToday === 1 ? "" : "s"} today` : "—"}</span>}
      />
      <VerifierInstrument variant="full" />
    </>
  );
}
