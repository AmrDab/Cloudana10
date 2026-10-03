import { useNetwork } from "@/hooks/useNetwork";
import { VerifierInstrument } from "@/components/cld/verifier-instrument";
import { Reveal, Section } from "./parts";

export function VerifyNow() {
  const { data } = useNetwork();
  return (
    <Section
      id="verify"
      kicker="Verify"
      title="Check the network from this tab."
      lede="Your browser re-runs a Freivalds check on finished jobs. Some are planted wrong — watch them get caught."
    >
      <Reveal>
        <VerifierInstrument
          header={<span className="font-mono text-xs tabular-nums text-faint">{data ? `${data.verifiersToday} verifier${data.verifiersToday === 1 ? "" : "s"} today` : "—"}</span>}
        />
      </Reveal>
    </Section>
  );
}
