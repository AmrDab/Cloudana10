// The live cuPOW instrument, in its own band now that the hero belongs to the globe.
import { useState } from "react";
import { MinerInstrument } from "@/components/cld/miner-instrument";
import { Segmented } from "@/components/cld/segmented";
import { monoLabel } from "@/components/cld/cta";
import { Reveal, Section } from "./parts";

const ROWS: [string, string][] = [
  ["σ", "seed from the latest Base block"],
  ["transcript", "SHA-256 chain over every block multiply"],
  ["z", "the proof — anyone can re-check it"],
];

const BITS = [
  { value: "8", label: "8 bits" },
  { value: "12", label: "12 bits" },
  { value: "16", label: "16 bits" },
];

export function ProofBand() {
  const [bits, setBits] = useState("8");
  return (
    <Section id="proof" kicker="Live" title="A proof, made in your tab.">
      <div className="grid items-start gap-8 lg:grid-cols-[7fr_5fr]">
        <Reveal>
          <MinerInstrument key={bits} d={Number(bits)} />
        </Reveal>
        <Reveal delay={0.04}>
          <div className="mb-6 border-l border-line pl-6">
            <span id="bits-label" className={monoLabel}>Difficulty · leading zero bits</span>
            <Segmented options={BITS} value={bits} onChange={setBits} labelledBy="bits-label" size="sm" className="mt-2" />
            <p className="mt-2 text-xs text-faint">Higher = more hashing before a proof lands. Each proof is re-checked here before it counts.</p>
          </div>
          <dl className="grid gap-4 border-l border-line pl-6 font-mono text-sm">
            {ROWS.map(([k, v]) => (
              <div key={k}>
                <dt className="text-work">{k}</dt>
                <dd className="mt-1 text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </Section>
  );
}
