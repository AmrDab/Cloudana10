// Console · Docs — how Cloudana works, in its own terms (docs/V2_BRIEF.md §6: orchestrator, not marketplace;
// minted per verified job, settled in batches; "proven" only where a proof exists).
import { Link } from "wouter";
import { ArrowRight, ExternalLink } from "lucide-react";
import { API_ROOT } from "@/lib/cld";
import { CATALOG, STATUS_LABEL } from "@/lib/services";
import { StatusChip } from "@/components/cld/status-chip";
import { CodeBlock, MonoLabel, PageHeader, Panel } from "@/components/console/primitives";

const TOC = [
  ["how", "How it works"],
  ["use", "Use"],
  ["provide", "Provide"],
  ["verify", "Verify"],
  ["cld", "How CLD is minted"],
  ["price", "Price"],
  ["security", "Security"],
  ["services", "Services and proofs"],
  ["api", "API"],
] as const;

function Doc({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-line py-10 first:border-0 first:pt-0">
      <h2 className="font-head text-xl font-medium text-text">{title}</h2>
      <div className="mt-4 grid max-w-[68ch] gap-4 text-[15px] leading-[1.65] text-muted-foreground [&_b]:font-medium [&_b]:text-text">{children}</div>
    </section>
  );
}

const linkCls = "inline-flex items-center gap-1 font-medium text-ok underline-offset-4 hover:underline";

export default function DocsPage() {
  return (
    <>
      <PageHeader kicker="Docs" title="How Cloudana works." lede="One orchestrator, many machines, one proof rule." />
      <div className="grid gap-10 lg:grid-cols-[180px_1fr]">
        <nav aria-label="On this page" className="hidden lg:block">
          <ul className="sticky top-24 grid gap-1.5">
            {TOC.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="text-sm text-muted-foreground hover:text-text">{label}</a>
              </li>
            ))}
          </ul>
        </nav>

        <article>
          <Doc id="how" title="How it works">
            <p>
              Cloudana is a decentralized datacenter: home PCs and full racks joined under <b>one orchestrator</b>. It is
              not a marketplace. Users don't pick providers and providers don't bid — the orchestrator assigns every job
              and sets its price from supply and demand.
            </p>
            <p>
              Each job comes back with a proof. When the proof checks out, CLD is minted for that job — like a block
              reward, but for useful work. No work, no CLD. Minted amounts settle on Base in batches.
            </p>
            <p>Three roles: <b>users</b> pay for work, <b>providers</b> run it, <b>verifiers</b> check it.</p>
          </Doc>

          <Doc id="use" title="Use">
            <p>
              Sign in with a wallet, submit a job, and the orchestrator places it on available hardware. The fee is held
              until the result verifies, then burned. You get the answer and its proof, and can re-check it in your
              browser.
            </p>
            <p>
              You never choose the machine. You can set an optional <b>max price</b>; a job priced above it isn't queued.
            </p>
            <p>
              Or deploy a <b>static site</b> from Run → Deploy: a node serves it, the orchestrator probes it every minute,
              and you pay by the hour. Containers run on Docker-capable nodes (early access).
            </p>
            <Link href="/run" className={linkCls}>Run a job <ArrowRight className="size-3.5" /></Link>
          </Doc>

          <Doc id="provide" title="Provide">
            <p>
              <b>Home node.</b> Run the agent once. It detects your hardware, benchmarks it and prints a one-time link that
              binds the node to your wallet. No stake, no forms.
            </p>
            <CodeBlock code={"cd node-agent\nnpm install && npm start"} copyText="cd node-agent && npm install && npm start" />
            <p>
              <b>Datacenter fleet.</b> Create a fleet token in the console and deploy the agent with Docker or Kubernetes.
              Every machine that starts with the token joins your fleet and pays out to one wallet. Fees are uncapped;
              the subsidy is capped per operator so no single operator dominates new issuance.
            </p>
            <p>
              Either way you may set a <b>floor price</b> — a minimum below which you won't take work. The orchestrator
              still sets the price.
            </p>
            <Link href="/provide" className={linkCls}>Start providing <ArrowRight className="size-3.5" /></Link>
          </Doc>

          <Doc id="verify" title="Verify">
            <p>
              Any browser can check finished work: it re-runs a Freivalds check (A·B = C, using random vectors) in a few
              milliseconds. About one task in six is planted wrong, so careless verifiers are caught. Verifiers earn
              credits — points, not CLD — kept in the browser until wallet binding opens.
            </p>
            <Link href="/verify" className={linkCls}>Verify in browser <ArrowRight className="size-3.5" /></Link>
          </Doc>

          <Doc id="cld" title="How CLD is minted">
            <p>For each verified job with fee F:</p>
            <ul className="grid gap-2 pl-5 [list-style:disc]">
              <li>F is burned.</li>
              <li><b>0.975 F</b> is minted to the provider and 0.005 F to the treasury — a net burn of 2 %.</li>
              <li>
                A <b>capped subsidy</b> is added only when the orchestrator's random draw chose that provider, so routing
                jobs to yourself doesn't pay.
              </li>
            </ul>
            <p>
              The amount is fixed when the job verifies. Entries are then posted to Base in batches (one Merkle root per
              window), with a challenge window of days; the subsidy part vests before it settles. Batching is delivery, not
              the reward unit.
            </p>
            <div className="flex flex-wrap gap-5"><Link href="/earnings" className={linkCls}>See your earnings <ArrowRight className="size-3.5" /></Link><Link href="/economics" className={linkCls}>20-year simulation <ArrowRight className="size-3.5" /></Link></div>
          </Doc>

          <Doc id="price" title="Price">
            <p>
              The protocol sets the price per unit of work from supply and demand — today, for compute, a fixed price per
              million multiply-adds shown live in the console. Users may add a ceiling; providers may add a floor. Both
              are optional.
            </p>
          </Doc>

          <Doc id="security" title="Security">
            <p>
              <b>Live today:</b> wallet sign-in by server nonce and EIP-191 signature; a short-lived token stays in the
              tab. Node messages are signed with each node's secp256k1 key; bind codes work once; fleet tokens are
              stored hashed and shown once. Work is checked by σ-bound cuPOW transcripts, Freivalds and planted tasks.
              Rate limits, CORS allow-list, TLS in transit; settlement on Base has a veto window and guardian.
            </p>
            <p>
              <b>Building:</b> sealed secrets — container env encrypted in your browser to the assigned node's key.{" "}
              <b>Planned:</b> encrypted job data at rest, confidential VMs, browser witness probes.
            </p>
          </Doc>

          <Doc id="services" title="Services and proofs">
            <p>Status is the truth today. Compute is proven end to end; static hosting is live and probed for reachability.</p>
            <Panel className="divide-y divide-line">
              {CATALOG.map((s) => (
                <div key={s.id} className="grid gap-1 p-4 sm:grid-cols-[180px_1fr_auto] sm:items-center sm:gap-4">
                  <span className="font-head text-sm text-text">{s.name}</span>
                  <span className="text-sm">{s.proof}</span>
                  <StatusChip status={s.status} className="w-fit" />
                </div>
              ))}
            </Panel>
            <p className="text-xs text-faint">
              Statuses: {Object.values(STATUS_LABEL).join(" · ")}. Unproven services can still be offered and paid by fees;
              only proven work earns the subsidy.
            </p>
          </Doc>

          <Doc id="api" title="API">
            <p>Everything in the console is a public, documented API.</p>
            <ul className="grid gap-1.5 font-mono text-[13px]">
              {[
                ["GET", "/v1/network", "live network numbers"],
                ["POST", "/v1/jobs", "queue a job (auth)"],
                ["GET", "/v1/jobs/{id}", "result and proof (auth)"],
                ["GET", "/v1/verify/task", "a task to check"],
                ["GET", "/v1/ledger/{address}", "CLD minted to an address"],
                ["POST", "/v1/fleets", "create a fleet token (auth)"],
                ["POST", "/v1/waitlist", "join the waitlist"],
              ].map(([m, p, d]) => (
                <li key={p} className="flex flex-wrap gap-x-3">
                  <MonoLabel className="w-10 text-work">{m}</MonoLabel>
                  <span className="text-text">{p}</span>
                  <span className="text-faint">— {d}</span>
                </li>
              ))}
            </ul>
            <a href={`${API_ROOT}/v1/swagger`} target="_blank" rel="noopener noreferrer" className={linkCls}>
              Full reference <ExternalLink className="size-3.5" />
            </a>
          </Doc>
        </article>
      </div>
    </>
  );
}
