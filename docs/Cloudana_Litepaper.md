# Cloudana Litepaper

### Useful compute, honestly decentralized.

**Cloudana is a decentralized datacenter. For compute, the work that earns a provider's CLD *is* the user's computation.**

Independent providers contribute CPUs, GPUs, and servers. One orchestrator assigns all the work and sets the price from supply and demand — users never pick a node, and providers don't compete on price. Three roles keep it honest: **users** pay for work, **providers** do it, and **verifiers** check it. For matrix-heavy workloads, Cloudana's **Proof of Useful Work** makes the cryptographic proof and the useful result the same operation. No wasted puzzle energy. No "just trust the provider."

---

### How it works

**1. Flash and go.** A provider installs once. The node auto-detects its CPU, RAM, disk, and GPU, classifies its tier, and binds to the provider's wallet with a one-time code. No spec forms. No bidding. No stake.

**2. You say what to run; the orchestrator places it.** Submit a job or a site. The orchestrator picks a node that fits by a random draw, sets the price, and handles placement. You never choose a provider.

**3. Proof = product.** For matrix workloads, the provider proves the work by computing it. The proof's hardness comes from the full transcript of the computation — unfakeable — and the decoded result is the answer you paid for. Checked by a σ-bound transcript, a Freivalds re-check, and planted tasks.

---

### The token: minted per verified job

CLD is the unit of account for compute on Cloudana: every job is priced and settled in CLD. When a verified job is paid for, the customer's fee is burned and the provider who did the work is minted most of it, so new CLD exists only because someone paid for real, verified computation.

- **Burn the fee, mint for the verified job.** The whole fee is burned at settlement; the provider is minted **95%** of it, the protocol treasury **3%**, and **2%** is destroyed for good.
- **A small, capped, declining subsidy** rewards providers in genuinely independent clusters while the network bootstraps: at most min(chain allowance, 4% of genesis) per year, halving every four years, with a floor of 1% of supply per year that governance can set to zero. Only work the orchestrator's random draw assigned qualifies, so routing a job to yourself doesn't pay.
- **Priced from utilization.** Compute is priced in nano-CLD per tera-MAC plus a small per-job base fee; the price moves with utilization, with no oracle. USD is shown for display only.
- **Settled in batches.** Minted amounts are posted to Base as one Merkle root per epoch (hourly on testnet, daily at mainnet) with a veto window and a guardian before claims open.
- **No stake to lose.** A misbehaving node is unbound and banned. Verifier credits are points, not CLD.

**Paying.** If you hold another asset, your own wallet can swap it into CLD at the moment you pay; Cloudana never holds it. Card payments are off during testnet. One static site per verified identity is free, paid for by the ecosystem treasury at normal fees — not new emission.

**Genesis (mainnet).** 100M CLD: treasury 40%, ecosystem 25%, team 20%, liquidity 10%, testnet retro 5%, all vesting on-chain. Testnet uses a fresh 1M token with no monetary value; no points or airdrop formula — "founding provider" recognition only. Full tables in the whitepaper §6.

Nothing about CLD is a promise of price or return.

---

### Where we are — said plainly

Cloudana's testnet is **trust-minimized and orchestrator-coordinated**, not yet "completely decentralized." Verification is the orchestrator's check of each transcript plus re-checks by browser verifiers. Full trustlessness arrives when on-chain zkSNARK verification removes the orchestrator from the critical path — that's our mainnet milestone, and we'll claim "decentralized verification" when it's true, not before.

---

### Differentiators

- **Proof of Useful Work** for AI/ML and scientific compute — proof and product coincide.
- **One orchestrator, one price** — the price comes from utilization, and placement is a random draw.
- **Fee-first issuance** — every fee burned, CLD minted per verified job.
- **Plug-and-play onboarding** — hardware detection, not configuration.

*Read the full whitepaper for the complete architecture, security model, and tokenomics.*

*Utility token for compute coordination. Not investment advice. Testnet CLD has no monetary value.*
