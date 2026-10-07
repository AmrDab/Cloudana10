// Six questions, answered for the model that exists today.
import { Reveal, Section } from "./parts";

const QA: [string, string][] = [
  ["What is Proof of Useful Work?", "The computation that proves a provider worked is the computation a user paid for. cuPOW makes the full matrix-multiplication transcript the proof."],
  ["How is work verified?", "The orchestrator checks each σ-bound transcript, Freivalds re-checks the answer, and browsers re-check finished jobs with planted wrong ones mixed in. An on-chain Groth16 verifier is in development."],
  ["How is CLD minted?", "Per verified job. The fee is burned; the provider is minted 95 % of it, the treasury 3 %, and 2 % is destroyed for good — plus a small, capped, declining subsidy when the orchestrator's random draw picked a provider in an independent cluster. No work, no CLD."],
  ["How do I pay?", "In CLD. Compute is priced in nano-CLD per tera-MAC plus a small per-job base fee, moving with utilization; USD is display only. If you hold another asset, your wallet swaps it into CLD when you pay — Cloudana never holds it. Cards are off during testnet."],
  ["Can I earn on testnet?", "Yes, in testnet CLD, which has no monetary value. Each verified job and each hosted hour is recorded to your wallet and settled in hourly batches. There is no points or airdrop formula; reliable testnet providers carry 'founding provider' status to mainnet. Before CLD carries value, the gates above must close."],
  ["Is Cloudana fully decentralized?", "No. The orchestrator assigns work, sets the price and checks proofs. Settlement is a Merkle root on Base with a veto window. We say exactly where we stand."],
  ["How do I provide?", "Run the agent once. It detects your hardware, benchmarks it and prints a one-time link that binds it to your wallet. Datacenters deploy one fleet token with Docker or Kubernetes. No stake, no bidding."],
];

export function Faq() {
  return (
    <Section id="faq" kicker="FAQ" title="Questions.">
      <Reveal>
        <div className="divide-y divide-line rounded-lg border border-line-2 bg-panel">
          {QA.map(([q, a]) => (
            <details key={q} className="group px-5 py-4 open:bg-panel-2">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-head text-base text-text [&::-webkit-details-marker]:hidden">
                {q}
                <span aria-hidden className="font-mono text-faint transition-transform duration-250 group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 max-w-[70ch] text-sm leading-[1.6] text-muted-foreground">{a}</p>
            </details>
          ))}
        </div>
      </Reveal>
    </Section>
  );
}
