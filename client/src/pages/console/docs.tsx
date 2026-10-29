// Console · Docs — how Cloudana works, in its own terms (docs/V2_BRIEF.md §6: orchestrator, not marketplace;
// minted per verified job, settled in batches; "proven" only where a proof exists).
import { Link } from "wouter";
import { ArrowRight, ExternalLink } from "lucide-react";
import { API_ROOT } from "@/lib/cld";
import { CATALOG, STATUS_LABEL } from "@/lib/services";
import { StatusChip } from "@/components/cld/status-chip";
import { CodeBlock, MonoLabel, PageHeader, Panel } from "@/components/console/primitives";
import { ApiKeys } from "./api-keys";

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

// Random weights for illustration only: a real job carries the user's own model.
const INT8_MLP_EXAMPLE = `node -e '
const r = (n, lo, hi) => Array.from({ length: n }, () => lo + Math.floor(Math.random() * (hi - lo + 1)));
const b = 4, d = 16, h = 32;
console.log(JSON.stringify({ workType: "int8-mlp", input: { b, d, h,
  X: r(b * d, -128, 127), W1: r(d * h, -128, 127), b1: r(h, -4096, 4096),
  W2: r(h * d, -128, 127), b2: r(d, -4096, 4096), m1: 1906, s1: 20, m2: 2528, s2: 20 } }));
' > job.json
curl -X POST ${API_ROOT}/v1/jobs -H "Authorization: Bearer $CLOUDANA_API_KEY" \\
  -H "Content-Type: application/json" -d @job.json`;

// Random weights for illustration only: Cloudana never picks a model.
const INT8_MODEL_EXAMPLE = `node -e '
const r = (n, lo, hi) => Array.from({ length: n }, () => lo + Math.floor(Math.random() * (hi - lo + 1)));
const b = 4, d = 16, h = 32, L = 4;
const block = () => ({ W1: r(d * h, -128, 127), b1: r(h, -4096, 4096),
  W2: r(h * d, -128, 127), b2: r(d, -4096, 4096), m1: 1906, s1: 20, m2: 2528, s2: 20 });
console.log(JSON.stringify({ workType: "int8-model", input: { b, d, h,
  X: r(b * d, -128, 127), blocks: Array.from({ length: L }, block) } }));
' > job.json
curl -X POST ${API_ROOT}/v1/jobs -H "Authorization: Bearer $CLOUDANA_API_KEY" \\
  -H "Content-Type: application/json" -d @job.json`;

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
              not a marketplace. Users don't pick providers and providers don't bid — the orchestrator assigns the work
              and sets the price.
            </p>
            <p>
              A compute job comes back with a proof; hosting and containers are probed. When the work checks out, CLD is
              minted for it — like a block reward, but for useful work. No work, no CLD. Minted amounts settle on Base in
              batches once the testnet settlement contract is deployed; until then they are recorded off-chain.
            </p>
            <p>Three roles: <b>users</b> pay for work, <b>providers</b> run it, <b>verifiers</b> re-check it in public.</p>
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
              and you pay by the hour. Repeat visits to a page are usually served from the edge cache for five minutes.
              Containers run on hardened fleet nodes (early access).
            </p>
            <p>
              <b>From a terminal.</b> The <code className="font-mono text-[13px]">cloudana</code> command line deploys a folder with an
              API key. It is not on npm yet: build it from the repository's <code className="font-mono text-[13px]">cli/</code>{" "}
              folder (see its README). Then: <code className="font-mono text-[13px]">cloudana login --key cld_sk_…</code>, then{" "}
              <code className="font-mono text-[13px]">cloudana deploy ./dist</code>. Files starting with a dot and{" "}
              <code className="font-mono text-[13px]">node_modules</code> are never uploaded.
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
              milliseconds. It is a public re-check: verdicts don't change any job's outcome. About one task in six is
              planted wrong, so careless verifiers are caught. Verifiers earn credits — points, not CLD — kept in the
              browser until wallet binding opens.
            </p>
            <Link href="/verify" className={linkCls}>Verify in browser <ArrowRight className="size-3.5" /></Link>
          </Doc>

          <Doc id="cld" title="How CLD is minted">
            <p>
              Prices are in US dollars. You pay in CLD at the rate on your quote, and every fee settles in CLD. New CLD
              exists only for verified work. For each verified, paid job with fee F:
            </p>
            <ul className="grid gap-2 pl-5 [list-style:disc]">
              <li>F is burned at settlement.</li>
              <li><b>0.95 F</b> is minted to the provider and <b>0.03 F</b> to the treasury; <b>0.02 F</b> is destroyed for good.</li>
              <li>
                A <b>small, capped, declining subsidy</b> — for proven work only, at most 4 % of F — is added only when the
                orchestrator's random draw chose a provider in a genuinely independent cluster, so routing jobs to yourself
                doesn't pay. It is withheld from any operator above the cluster share cap, and from everyone while fewer
                than three independent clusters are online. If an epoch's subsidy adds up to more than its budget, every
                entry in it is scaled down by the same factor.
              </li>
            </ul>
            <p>
              <b>Protocol work.</b> When no paid job is waiting, the orchestrator gives idle nodes its own small matrix jobs,
              checked exactly like paid ones. What is left of the subsidy pool after paid jobs is shared among them by verified
              work, only among independent operators; no fee is burned and nothing goes to the treasury. It is built and
              switches on with the testnet contract.
            </p>
            <p>
              The provider's and treasury's amounts are fixed when the job verifies; the subsidy is fixed when its epoch
              closes. A compute job's entries are first held 24 h, and the provider's are clawed if a sampled check fails on
              any node paying the same wallet (the fee is still burned). Entries are then posted to Base in
              batches (one Merkle root per epoch — hourly on testnet, daily at mainnet), with a veto window of the same
              length; the subsidy part vests before it can be claimed. Batching is delivery, not the reward unit. The testnet
              settlement contract is not deployed yet, so no epoch has been posted.
            </p>
            <p>
              <b>Paying.</b> If you hold another asset, your own wallet swaps it into CLD at the moment you pay; Cloudana
              never holds customer assets other than escrowed CLD. Card payments are off during testnet. One static site
              per verified identity is free, paid for by the ecosystem treasury at normal fees.
            </p>
            <p>
              <b>Testnet CLD has no monetary value.</b> Testnet credits are 10 CLD per day per verified identity. There is no
              points or airdrop formula; reliable testnet providers carry "founding provider" status to mainnet.
            </p>
            <div className="flex flex-wrap gap-5"><Link href="/earnings" className={linkCls}>See your earnings <ArrowRight className="size-3.5" /></Link><Link href="/economics" className={linkCls}>20-year simulation <ArrowRight className="size-3.5" /></Link></div>
          </Doc>

          <Doc id="price" title="Price">
            <p>
              Prices are in US dollars. You pay in CLD at the rate on your quote: a fixed reference rate of $0.10 per CLD
              on testnet; after listing, a one-hour average of the public CLD/USDC pool. Compute jobs are priced in
              nano-dollars per tera-multiply-add (about $2.02 per H100-hour of matrix work) plus a $0.0001 base fee; that
              price moves at most ±2 % per hour toward a 70 % utilization target and holds when the network is idle.
              Hosting, containers, workstations and GPU endpoints are priced per hour: a static site $0.0014 (about $1 a
              month), vCPU $0.010, RAM $0.0012 per GB, disk and volumes $0.0001 per GB, and GPUs by tier — standard
              (under 40 GB) $0.30, large (40–80 GB, A100-class) $1.20, H100-class $2.00. Interruptible runs are half
              price. A quote is locked for five minutes. Settlement is in CLD and uses no oracle. Testnet prices
              are shown in dollars for reference; test CLD has no value. Users may add a ceiling; providers may add a
              floor. Both are optional.
            </p>
          </Doc>

          <Doc id="security" title="Security">
            <p>
              <b>Live today:</b> wallet sign-in by server nonce and EIP-191 signature; a short-lived token stays in the
              tab. Node messages are signed with each node's secp256k1 key; bind codes work once; fleet tokens are
              stored hashed and shown once. Every matrix job is answer-checked (Freivalds) and 1 in 10, drawn at random
              after submit (every job for a new node's first 10), is re-executed by the orchestrator, each transcript bound to its assignment by σ; a
              provider's pay is held 24 h and clawed if a sampled check of any of its nodes fails. int8 MLP jobs are
              checked on drawn steps. Services are probed. Signed node instructions (nodes ignore anything unsigned or
              stale); hash-checked hosting probes through the relay; sealed secrets — container env encrypted in your
              browser to the assigned node's key (that node can read it; Cloudana can't). Rate limits, CORS allow-list,
              TLS in transit.
            </p>
            <p>
              <b>Building:</b> settlement on Base with a veto window and guardian, posted by a keeper that runs isolated
              from the API (the testnet contract is not deployed yet).{" "}
              <b>Planned:</b> encrypted job data at rest, confidential VMs, browser witness probes.
            </p>
          </Doc>

          <Doc id="services" title="Services and proofs">
            <p>Status is the truth today. Four labels, never more than what is checked. <b>Proven</b>: matrix jobs — every answer checked (Freivalds), the full transcript re-executed on a random 1 job in 10 (every job for a new node's first 10); int8 MLP blocks — on every job 2 of their 4 steps, drawn after the node committed to all of them, are checked exactly (one faked step caught with probability ½ per job); int8 models of L ≤ 16 blocks — max(3, L) of their 4·L steps drawn the same way (at least ¼ per job). <b>Possession proven</b>: storage copies answer Merkle challenges. <b>Probed</b>: static hosting, containers, workstations and AI endpoints running your own model server — you pay only for time a probe saw working. <b>Planned</b>: spot-checked inference. Cloudana never picks or brands a model, and a model on your own endpoint is not verified today.</p>
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
            <p>
              Two credentials, both sent as <code className="font-mono text-[13px]">Authorization: Bearer</code>: the console's
              wallet session (24 hours, ended when you sign out) and <b>API keys</b> for scripts, CI and SDKs — scoped to
              <code className="font-mono text-[13px]"> read</code>, <code className="font-mono text-[13px]">jobs</code> and{" "}
              <code className="font-mono text-[13px]">deployments</code>, revocable here, never able to mint keys, buy credits or change provider settings.
            </p>
            <ApiKeys />
            <ul className="grid gap-1.5 font-mono text-[13px]">
              {[
                ["GET", "/v1/network", "live network numbers"],
                ["POST", "/v1/keys", "create an API key (wallet session)"],
                ["POST", "/v1/jobs", "queue a job (auth)"],
                ["GET", "/v1/jobs/{id}", "result and proof (auth)"],
                ["GET", "/v1/verify/task", "a task to check"],
                ["GET", "/v1/ledger/{address}", "CLD earned by an address"],
                ["GET", "/v1/draws/{id}", "replay how a job's node was drawn"],
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
            <p>
              <b>int8 MLP block</b> (<code className="font-mono text-[13px]">workType: "int8-mlp"</code>): one quantized
              MLP layer with a residual, on your own int8 weights, int32 biases and requantization scales — Cloudana
              picks no model. The node commits to every intermediate result, then opens two of the four steps chosen
              after it committed; each is checked exactly. So a node faking one step is caught with probability ½ on each job; what deters it is
              its held pay (clawed) and suspension. The example below uses random weights.
            </p>
            <CodeBlock code={INT8_MLP_EXAMPLE} copyText={INT8_MLP_EXAMPLE} />
            <p>
              <b>int8 model</b> (<code className="font-mono text-[13px]">workType: "int8-model"</code>): 1 to 16 of those
              blocks chained, each block's output the next one's input, with d and h up to 64. The node opens
              max(3, L) of the 4·L steps, drawn at random across all of them, so one faked step is caught with probability at least ¼ on each job; the
              held pay and suspension still apply. Again random weights below — bring your own model.
            </p>
            <CodeBlock code={INT8_MODEL_EXAMPLE} copyText={INT8_MODEL_EXAMPLE} />
            <a href={`${API_ROOT}/v1/swagger`} target="_blank" rel="noopener noreferrer" className={linkCls}>
              Full reference <ExternalLink className="size-3.5" />
            </a>
          </Doc>
        </article>
      </div>
    </>
  );
}
