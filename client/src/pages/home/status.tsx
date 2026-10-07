// Status, stated plainly: the gates still open before CLD carries value (restored from the v1 homepage).
import { Reveal, Section } from "./parts";

type Gate = { name: string; state: "done" | "testnet" | "open"; note: string };

// Keep this list honest; it is the most-read thing on the page.
const GATES: Gate[] = [
  { name: "End to end: job → proof → mint → result", state: "testnet", note: "Runs on the local stack. Public testnet next." },
  { name: "Settlement contract on Base Sepolia", state: "open", note: "Fresh token + settlement v2 under a Safe, hourly epochs, fee split checked on every post. Owner deploys." },
  { name: "zkSNARK transcript verification on-chain", state: "open", note: "Groth16 verifier in development." },
  { name: "Audit of settlement and token contracts", state: "open", note: "Not started." },
  { name: "Legal review of CLD", state: "open", note: "Not started." },
];

const CHIP: Record<Gate["state"], [string, string]> = {
  done: ["Done", "bg-ok text-[#04201C]"],
  testnet: ["Local testnet", "border border-work/60 text-work"],
  open: ["Open", "border border-line-2 text-muted-foreground"],
};

export function StatusGates() {
  return (
    <Section id="status" kicker="Status" title="What is still open." lede="Five gates before CLD carries value. Zero are closed.">
      <Reveal>
        <ol className="divide-y divide-line rounded-lg border border-line-2 bg-panel">
          {GATES.map((g, i) => {
            const [label, cls] = CHIP[g.state];
            return (
              <li key={g.name} className="grid gap-2 px-5 py-4 sm:grid-cols-[2rem_1fr_auto] sm:items-center sm:gap-4">
                <span className="font-mono text-xs text-faint">0{i + 1}</span>
                <div>
                  <div className="font-head text-base text-text">{g.name}</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">{g.note}</div>
                </div>
                <span className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 font-mono text-[11px] leading-5 ${cls}`}>{label}</span>
              </li>
            );
          })}
        </ol>
        <p className="mt-4 max-w-[70ch] text-sm leading-[1.55] text-muted-foreground">
          Testnet is orchestrator-coordinated: the orchestrator checks every proof and your browser can re-check it. We will
          call verification decentralized when it is, not before.
        </p>
      </Reveal>
    </Section>
  );
}
