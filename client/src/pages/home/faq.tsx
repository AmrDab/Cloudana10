// Six questions, answered for the model that exists today.
import { Reveal, Section } from "./parts";

const QA: [string, string][] = [
  ["What is Proof of Useful Work?", "The computation that proves a provider worked is the computation a user paid for. cuPOW makes the full matrix-multiplication transcript the proof. Today matrix-multiplication and int8 MLP jobs are proven (their answers are checked exactly); storage proves possession with Merkle challenges; hosting, containers, workstations and GPU endpoints running your own model are probed."],
  ["How is work verified?", "For matrix jobs, the orchestrator checks every answer with Freivalds and re-executes 1 job in 10, drawn at random after the provider submits (every job, for a new node's first 10); a provider's pay is held 24 h and clawed if a re-executed job of any of its nodes fails. A seed issued at assignment binds each transcript to its job and node, so it can't be precomputed or copied. int8 MLP jobs commit to every step, then 2 of 4 steps (a block) or max(3, L) of 4·L (a model) are drawn and checked exactly; one faked step is caught with probability ½ per job for a block, at least ¼ for a model. Services are probed for health and content; you pay only for time a probe saw working. Browsers can re-check public jobs; that is a public re-check and doesn't change outcomes. The planned next step is an on-chain Freivalds challenge against a bonded poster."],
  ["How is CLD minted?", "Per verified job. The fee is burned; the provider is minted 95 % of it, the treasury 3 %, and 2 % is destroyed for good. Proven work can add a small, capped subsidy of up to 4 % of the fee when the orchestrator's random draw picked a provider in an independent cluster; if a settlement period's budget runs short, it is shared pro rata. No work, no CLD."],
  ["How do I pay?", "Prices are in US dollars. You pay in CLD at the rate on your quote. Compute jobs are priced per tera-multiply-add plus a small base fee, moving with utilization; hosting, containers, workstations and GPUs have hourly prices. Testnet prices are shown in dollars for reference; test CLD has no value. If you hold another asset, your wallet swaps it into CLD when you pay — Cloudana never holds it. Cards are off during testnet."],
  ["Can I earn on testnet?", "Yes, in testnet CLD, which has no monetary value. Each verified job and each hosted hour is recorded to your wallet. A hosted hour settles in the next hourly batch; a job's pay settles in the hourly batch after its 24 h hold. There is no points or airdrop formula; reliable testnet providers carry 'founding provider' status to mainnet. Before CLD carries value, the gates above must close."],
  ["Is Cloudana fully decentralized?", "No. The orchestrator assigns work, sets the price and checks proofs. Settlement will be a Merkle root on Base with a veto window; the testnet contract is not deployed yet. We say exactly where we stand."],
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
