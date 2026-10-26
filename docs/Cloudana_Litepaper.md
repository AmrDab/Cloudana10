# Cloudana Litepaper

### Useful compute, honestly decentralized.

**Cloudana is a decentralized datacenter. For matrix jobs, the work that earns a provider's CLD *is* the user's computation.**

Independent providers contribute CPUs, GPUs, and servers. One orchestrator assigns all the work and sets the price — users never pick a node, and providers don't compete on price. Three roles: **users** pay for work, **providers** do it, and **verifiers** re-check it in public. For matrix-multiplication jobs, Cloudana's **Proof of Useful Work** makes the cryptographic proof and the useful result the same operation. No wasted puzzle energy. No "just trust the provider."

---

### How it works

**1. Flash and go.** A provider installs once. The node auto-detects its CPU, RAM, disk, and GPU, classifies its tier, and binds to the provider's wallet with a one-time code. No spec forms. No bidding. No stake.

**2. You say what to run; the orchestrator places it.** Submit a job or a site. The orchestrator picks a node that fits by a random draw, sets the price, and handles placement. You never choose a provider.

**3. Proof = product.** For matrix jobs, the provider proves the work by computing it. The proof is the full transcript of the computation, bound to its assignment by a seed σ, and the decoded result is the answer you paid for. The orchestrator checks every answer with Freivalds and re-executes the transcript of a random sample of jobs (1 in 10); a provider's pay is held 24 h and clawed if a sampled check fails. Hosting, containers, workstations and GPU endpoints are probed, not proven.

### How each service is checked

- **Proven** — the answer is checked exactly. Matrix jobs: Freivalds on every answer, the full transcript re-executed on a random 1 in 10. int8 MLP blocks and chained int8 models on your own weights: the node commits to every step, then 2 of 4 steps (a block) or max(3, L) of 4·L (a model of L ≤ 16 blocks) are drawn and checked exactly within 30 s; one faked step is caught with probability ½ per job for a block, at least ¼ per job for a model. Any failed check claws the node's held pay and suspends it; a failed int8 check also refunds the user.
- **Possession proven** — storage: nodes hold AES-GCM encrypted copies of job results and answer Merkle challenges on random 64 KiB pieces. This shows a copy can be retrieved, not that it is replicated.
- **Probed** — static sites (content hash every minute through the relay), containers, workstations, and AI endpoints running your own model server. You pay only for time a probe saw it working.
- **Planned** — spot-checked inference for AI endpoints (needs a GPU node). Cloudana never picks or brands a model, and a model you run on your own endpoint is not verified today.

---

### The token: minted per verified job

Prices are in US dollars. You pay in CLD at the rate on your quote. When a verified job is paid for, the customer's fee is burned and the provider who did the work is minted most of it, so new CLD exists only because someone paid for real, verified computation.

- **Burn the fee, mint for the verified job.** The whole fee is burned at settlement; the provider is minted **95%** of it, the protocol treasury **3%**, and **2%** is destroyed for good.
- **A small, capped, declining subsidy** rewards proven work by providers in genuinely independent clusters while the network bootstraps: up to 4% of the job's fee, within a yearly budget of at most min(chain allowance, 4% of genesis), halving every four years, with a floor of 1% of supply per year that governance can set to zero. If a settlement period's budget runs short, it is shared pro rata. Only work the orchestrator's random draw assigned qualifies, so routing a job to yourself doesn't pay.
- **Priced in US dollars, settled in CLD.** The rate is a fixed $0.10 per CLD on testnet and, after listing, a one-hour average of the public CLD/USDC pool. Compute jobs are priced per tera-multiply-add plus a small base fee, moving with utilization; hosting, containers, workstations and GPUs have hourly prices. There is no oracle in settlement. Testnet prices are shown in dollars for reference; test CLD has no value.
- **Settled in batches.** Minted amounts are posted to Base as one Merkle root per epoch (hourly on testnet, daily at mainnet) with a veto window and a guardian before claims open. The testnet settlement contract is not deployed yet; until it is, pay is recorded off-chain.
- **No stake to lose.** A node caught faking work loses its held pay and is suspended. Verifier credits are points, not CLD.

**Paying.** If you hold another asset, your own wallet can swap it into CLD at the moment you pay; Cloudana never holds it. Card payments are off during testnet. One static site per verified identity is free, paid for by the ecosystem treasury at normal fees — not new emission.

**Genesis (mainnet).** 100M CLD: treasury 40%, ecosystem 25%, team 20%, liquidity 10%, testnet retro 5%, all vesting on-chain. Testnet uses a fresh 1M token with no monetary value; no points or airdrop formula — "founding provider" recognition only. Full tables in the whitepaper §6.

Nothing about CLD is a promise of price or return.

---

### Where we are — said plainly

Cloudana's testnet is **orchestrator-coordinated**, not yet "completely decentralized." Verification is a Freivalds check of every matrix job's answer plus the orchestrator's re-execution of the transcript on a random sample (1 in 10), with provider pay held 24 h and clawed on a failed sample; int8 jobs are checked on drawn steps; storage answers Merkle challenges; other services are probed. Browser verifiers can re-check public jobs, but their verdicts don't change outcomes. The planned next step, after mainnet, is an on-chain Freivalds challenge against a bonded poster — and we'll claim "decentralized verification" when it's true, not before.

---

### Differentiators

- **Proof of Useful Work** for matrix-multiplication jobs — proof and product coincide.
- **One orchestrator, one price** — prices in US dollars, paid in CLD, and placement is a random draw.
- **Fee-first issuance** — every fee burned, CLD minted per verified job.
- **Plug-and-play onboarding** — hardware detection, not configuration.

*Read the full whitepaper for the complete architecture, security model, and tokenomics.*

*Utility token for compute coordination. Not investment advice. Testnet CLD has no monetary value.*
