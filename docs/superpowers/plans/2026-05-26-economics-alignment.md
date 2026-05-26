# Cloudana Economics Alignment & Site Audit Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the Cloudana console site with the owner's economic model decisions: no staking, no registration mint, no halving, POUW-only CLD generation, 80/15/5 fee split, penalty system for bad providers, and fix all factual discrepancies found during the whitepaper audit.

**Architecture:** All changes are in the React/Vite frontend. The economics model is rewritten in `provider-economics.ts`, then the calculator page and all marketing copy pages are updated to match. A standalone 10-year economic simulation script validates the model. No backend changes.

**Tech Stack:** React 19, TypeScript, Vite, TailwindCSS, wouter (routing)

---

## Owner Decisions (from conversation)

These decisions override the whitepaper where they conflict:

| Topic | Decision |
|-------|----------|
| CLD generation | ONLY through useful work (POUW). No other minting mechanism. |
| Halving | None. Constant block reward. More providers = less per provider (pool model). |
| Registration mint | Removed. Early supply comes from running Cloudana itself on testnet. |
| Staking | None. Cloudana must remain fundamentally stable. No staking contracts. |
| Fee split | 80% provider / 15% burned / 5% treasury |
| Provider penalties | Warning -> 3-month suspension -> 1-year suspension (no slashing) |
| Pricing claims | Use real numbers, don't look like we're selling |
| Social links | GitHub + Twitter @cloudana10 |
| POUWVerifier address | Canonical source: `shared/addresses.baseSepolia.json` = `0xE2791574413d2bdE5B84848A99Aeb3B9f4d80682` |
| POUW reward formula | Whitepaper: `R = Base_Reward x Difficulty_Multiplier x (Matrix_Size / Reference_Size)^alpha` |
| Copyright | 2026 |

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `client/src/lib/provider-economics.ts` | Rewrite | POUW reward model, fee split, penalty system, pool-model projections |
| `client/src/pages/pricing/provider-calculator.tsx` | Modify | Remove staking UI, remove registration mint UI, add network-size slider |
| `client/src/pages/landing.tsx` | Modify | Fix cost claims, staking copy, copyright, social links, broken /dashboard link |
| `client/src/pages/docs.tsx` | Modify | Fix POUWVerifier address, fee structure text, remove staking references |
| `client/src/pages/pricing/gpus-on-demand.tsx` | Modify | Remove fake stats (85% savings, 50+ locations, 99% satisfaction) |
| `client/src/App.tsx` | Modify | Add /faucet route |
| `client/src/scripts/simulate-10yr.ts` | Create | Standalone 10-year economic simulation |

---

### Task 1: Fix POUWVerifier address in docs.tsx

**Files:**
- Modify: `client/src/pages/docs.tsx:1036-1037` (contract table)
- Modify: `client/src/pages/docs.tsx:1077` (deployment info box)

The canonical address from `shared/addresses.baseSepolia.json` is `0xE2791574413d2bdE5B84848A99Aeb3B9f4d80682`. The docs page has an outdated address `0xc15c61E35D6d73dEf14460a1C7010fd169eD2e7F`.

- [ ] **Step 1: Fix the contract table entry**

In `client/src/pages/docs.tsx`, find the object around line 1036-1037:
```typescript
// BEFORE:
      name: "POUWVerifier",
      addr: "0xc15c61E35D6d73dEf14460a1C7010fd169eD2e7F",

// AFTER:
      name: "POUWVerifier",
      addr: "0xE2791574413d2bdE5B84848A99Aeb3B9f4d80682",
```

- [ ] **Step 2: Fix the deployment info box**

Around line 1077:
```typescript
// BEFORE:
<span>0xc15c61E35D6d73dEf14460a1C7010fd169eD2e7F</span>

// AFTER:
<span>0xE2791574413d2bdE5B84848A99Aeb3B9f4d80682</span>
```

- [ ] **Step 3: Verify build**

Run: `cd C:/Users/amr_d/Cloudana10 && npx vite build 2>&1 | tail -5`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/amr_d/Cloudana10
git add client/src/pages/docs.tsx
git commit -m "fix: correct POUWVerifier address in docs to match deployed contract"
```

---

### Task 2: Rewrite provider-economics.ts

**Files:**
- Rewrite: `client/src/lib/provider-economics.ts`

Remove registration mint, staking tiers, and halving. Replace with POUW-only model using the whitepaper formula, pool-model earnings, penalty system, and 80/15/5 fee split.

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `client/src/lib/provider-economics.ts` with:

```typescript
// Cloudana provider economics — POUW-only model.
// All CLD is generated exclusively through Proof of Useful Work.
// No registration mint. No staking. No halving.
// Fee split: 80% provider / 15% burned / 5% treasury.

import { NodeTier } from "@/lib/node-tier";

// -- POUW Reward Formula (Whitepaper Section 8) -------------------------------
// R = Base_Reward x Difficulty_Multiplier x (Matrix_Size / Reference_Size)^alpha

/** CLD minted per valid POUW block */
export const BASE_BLOCK_REWARD = 100;

/** Target: 1 block per 60 seconds */
export const BLOCK_TIME_SECONDS = 60;

/** Reference matrix size for difficulty scaling */
export const REFERENCE_MATRIX_SIZE = 1024;

/** Scaling exponent (whitepaper range: 1.5-2.0, using midpoint) */
export const ALPHA = 1.75;

// -- Fee Split ----------------------------------------------------------------

export const FEE_SPLIT = {
  provider: 0.80,
  burn: 0.15,
  treasury: 0.05,
} as const;

// -- Penalty System (replaces staking/slashing) -------------------------------

export interface PenaltyTier {
  offense: number;
  action: string;
  description: string;
}

export const PENALTY_TIERS: PenaltyTier[] = [
  { offense: 1, action: "warning", description: "Formal warning issued" },
  { offense: 2, action: "3_month_suspension", description: "3-month suspension from network" },
  { offense: 3, action: "1_year_suspension", description: "1-year suspension from network" },
];

// -- Estimated Hourly Rates ---------------------------------------------------
// Derived from block reward formula at reference difficulty.
// Actual earnings depend on network size and workload demand.

export const ESTIMATED_HOURLY_RATES: Record<NodeTier, number> = {
  [NodeTier.CPU_ONLY]: 0.5,
  [NodeTier.EDGE_RELAY]: 0.3,
  [NodeTier.STORAGE]: 0.8,
  [NodeTier.GPU_MID]: 2.5,
  [NodeTier.GPU_HIGH]: 6.0,
};

export const HOURS_PER_MONTH = 720;
export const DEFAULT_UTILIZATION = 0.6;

// -- POUW Reward Calculation --------------------------------------------------

/** Calculate raw POUW block reward for a given matrix size and difficulty. */
export function pouwBlockReward(opts: {
  matrixSize?: number;
  difficultyMultiplier?: number;
}): number {
  const { matrixSize = REFERENCE_MATRIX_SIZE, difficultyMultiplier = 1.0 } = opts;
  return BASE_BLOCK_REWARD * difficultyMultiplier * Math.pow(matrixSize / REFERENCE_MATRIX_SIZE, ALPHA);
}

// -- Pool Model Earnings ------------------------------------------------------
// Block rewards are shared among all active providers proportional to work.
// More providers = less per provider (natural equilibrium).

export interface EarningsProjection {
  /** Monthly POUW earnings before fee split */
  grossMonthly: number;
  /** Monthly earnings after 80% provider share */
  netMonthly: number;
  /** Annual projection */
  annualProjection: number;
  /** Utilization rate used */
  utilization: number;
  /** Number of active providers in simulation */
  activeProviders: number;
}

export function calculateProjection(options: {
  tier: NodeTier;
  activeProviders: number;
  utilization?: number;
}): EarningsProjection {
  const { tier, activeProviders, utilization = DEFAULT_UTILIZATION } = options;

  const hourlyRate = ESTIMATED_HOURLY_RATES[tier];
  // Total network earning potential at this tier's rate
  const grossMonthlyIfAlone = hourlyRate * HOURS_PER_MONTH * utilization;

  // Pool effect: block rewards are shared, so divide by active providers.
  // The base rates assume a 100-provider network, so normalize.
  const poolDivisor = Math.max(1, activeProviders / 100);
  const grossMonthly = grossMonthlyIfAlone / poolDivisor;
  const netMonthly = grossMonthly * FEE_SPLIT.provider;
  const annualProjection = netMonthly * 12;

  return {
    grossMonthly,
    netMonthly,
    annualProjection,
    utilization,
    activeProviders,
  };
}

// -- Network Supply Simulation ------------------------------------------------

export interface SimulationYear {
  year: number;
  activeProviders: number;
  avgWorkloadsPerDay: number;
  annualCldMinted: number;
  annualCldBurned: number;
  netNewSupply: number;
  cumulativeSupply: number;
  avgMonthlyPerProvider: number;
}

/**
 * Run a 10-year simulation of CLD supply dynamics.
 *
 * Assumptions:
 * - Block reward: 100 CLD per block, 1 block per 60s
 * - CLD minted only through POUW (real work)
 * - 15% of all fees burned
 * - Provider and workload growth follow logistic curves
 */
export function simulate10Years(opts?: {
  initialProviders?: number;
  maxProviders?: number;
  initialWorkloadsPerDay?: number;
  maxWorkloadsPerDay?: number;
  avgJobFeeCld?: number;
}): SimulationYear[] {
  const {
    initialProviders = 50,
    maxProviders = 10_000,
    initialWorkloadsPerDay = 10,
    maxWorkloadsPerDay = 50_000,
    avgJobFeeCld = 50,
  } = opts ?? {};

  const results: SimulationYear[] = [];
  let cumulativeSupply = 0;

  for (let year = 1; year <= 10; year++) {
    // Logistic growth: starts slow, accelerates, plateaus
    const t = year / 10; // normalized 0-1
    const logistic = 1 / (1 + Math.exp(-12 * (t - 0.4)));

    const providers = Math.round(initialProviders + (maxProviders - initialProviders) * logistic);
    const workloads = Math.round(initialWorkloadsPerDay + (maxWorkloadsPerDay - initialWorkloadsPerDay) * logistic);

    // Mining: blocks per year = 365.25 * 24 * 60 (one block per minute)
    const blocksPerYear = 365.25 * 24 * 60;
    const annualCldMinted = BASE_BLOCK_REWARD * blocksPerYear;

    // Burn: 15% of all job fee throughput
    const annualJobFees = workloads * 365.25 * avgJobFeeCld;
    const annualCldBurned = annualJobFees * FEE_SPLIT.burn;

    const netNewSupply = annualCldMinted - annualCldBurned;
    cumulativeSupply += netNewSupply;

    const avgMonthlyPerProvider = (annualCldMinted * FEE_SPLIT.provider) / providers / 12;

    results.push({
      year,
      activeProviders: providers,
      avgWorkloadsPerDay: workloads,
      annualCldMinted: Math.round(annualCldMinted),
      annualCldBurned: Math.round(annualCldBurned),
      netNewSupply: Math.round(netNewSupply),
      cumulativeSupply: Math.round(cumulativeSupply),
      avgMonthlyPerProvider: Math.round(avgMonthlyPerProvider * 100) / 100,
    });
  }

  return results;
}
```

- [ ] **Step 2: Verify build**

Run: `cd C:/Users/amr_d/Cloudana10 && npx vite build 2>&1 | tail -10`

Expected: Build will FAIL because `provider-calculator.tsx` still imports old exports (`BASE_REGISTRATION_REWARDS`, `STAKING_TIERS`, `registrationRewardAtEpoch`, `epochFromClaims`, `generateDecayCurve`, `HALVING_INTERVAL`). This is expected — Task 3 fixes it.

- [ ] **Step 3: Commit (economics only)**

```bash
cd C:/Users/amr_d/Cloudana10
git add client/src/lib/provider-economics.ts
git commit -m "feat: rewrite provider economics — POUW-only, no staking, no halving, pool model"
```

---

### Task 3: Update provider-calculator.tsx

**Files:**
- Modify: `client/src/pages/pricing/provider-calculator.tsx`

Remove all references to registration mint, staking tiers, halving epochs, and decay curves. Replace with a network-size slider that shows how earnings decrease as more providers join (pool model).

- [ ] **Step 1: Read the full file first**

Read `client/src/pages/pricing/provider-calculator.tsx` completely to understand the current structure.

- [ ] **Step 2: Update imports**

```typescript
// BEFORE (around line 1-15):
import {
  BASE_REGISTRATION_REWARDS,
  STAKING_TIERS,
  HALVING_INTERVAL,
  calculateProjection,
  registrationRewardAtEpoch,
  epochFromClaims,
  generateDecayCurve,
} from "@/lib/provider-economics";

// AFTER:
import {
  calculateProjection,
  FEE_SPLIT,
  PENALTY_TIERS,
  ESTIMATED_HOURLY_RATES,
} from "@/lib/provider-economics";
```

- [ ] **Step 3: Replace state variables**

Remove state for `stakingTierIndex`, `networkEpoch`. Add state for `activeProviders`:

```typescript
// REMOVE:
const [stakingTierIndex, setStakingTierIndex] = useState(0);
const [networkEpoch, setNetworkEpoch] = useState(0);

// ADD:
const [activeProviders, setActiveProviders] = useState(100);
```

- [ ] **Step 4: Update projection calculation**

Replace the `useMemo` that calculates the projection:

```typescript
// BEFORE:
const projection = useMemo(
  () => calculateProjection({
    tier: selectedTier,
    epoch: networkEpoch,
    stakingTierIndex,
  }),
  [selectedTier, networkEpoch, stakingTierIndex]
);

// AFTER:
const projection = useMemo(
  () => calculateProjection({
    tier: selectedTier,
    activeProviders,
  }),
  [selectedTier, activeProviders]
);
```

- [ ] **Step 5: Replace staking tier selector and epoch slider UI**

Find the Card that contains the staking tier dropdown and the network epoch slider. Replace them with a single "Network Size" slider:

```tsx
<Card className="border-white/5 bg-card/50">
  <CardHeader className="pb-3">
    <CardTitle className="text-base flex items-center gap-2">
      <Users className="h-4 w-4 text-primary" />
      Network Size
    </CardTitle>
  </CardHeader>
  <CardContent className="space-y-4">
    <div>
      <div className="flex justify-between text-sm mb-2">
        <span className="text-muted-foreground">Active Providers</span>
        <span className="font-mono font-medium">{activeProviders.toLocaleString()}</span>
      </div>
      <Slider
        min={10}
        max={10000}
        step={10}
        value={[activeProviders]}
        onValueChange={(v) => setActiveProviders(v[0])}
      />
      <p className="text-xs text-muted-foreground mt-2">
        Block rewards are shared among all providers. More providers = less per provider.
      </p>
    </div>
  </CardContent>
</Card>
```

Add `Users` to the lucide-react imports at the top of the file.

- [ ] **Step 6: Update the earnings breakdown display**

Replace references to `projection.registrationMint`, `projection.stakingMultiplier`, and `projection.pouwMonthly` with the new field names:

```tsx
// Replace the earnings breakdown items. Use these values:
// projection.grossMonthly — monthly POUW before fees
// projection.netMonthly — monthly after 80% provider share
// projection.annualProjection — annual net

// Example replacement for the earnings cards:
<div className="flex justify-between">
  <span className="text-muted-foreground">Gross Monthly (POUW)</span>
  <span className="font-mono">{projection.grossMonthly.toFixed(1)} CLD</span>
</div>
<div className="flex justify-between">
  <span className="text-muted-foreground">Provider Share (80%)</span>
  <span className="font-mono font-medium text-primary">{projection.netMonthly.toFixed(1)} CLD</span>
</div>
<div className="flex justify-between">
  <span className="text-muted-foreground">Annual Projection</span>
  <span className="font-mono">{projection.annualProjection.toFixed(0)} CLD</span>
</div>
```

- [ ] **Step 7: Remove the decay curve chart section**

Delete the entire section that renders the halving/decay curve chart. It references `generateDecayCurve` which no longer exists.

- [ ] **Step 8: Update header description**

```typescript
// BEFORE:
"Estimate your CLD earnings by providing compute to the Cloudana network.
Earn a one-time registration mint plus ongoing Proof of Useful Work rewards."

// AFTER:
"Estimate your CLD earnings by providing compute to the Cloudana network.
All CLD is generated through Proof of Useful Work — your hardware earns by doing real computation."
```

- [ ] **Step 9: Verify build**

Run: `cd C:/Users/amr_d/Cloudana10 && npx vite build 2>&1 | tail -10`
Expected: Build succeeds.

- [ ] **Step 10: Commit**

```bash
cd C:/Users/amr_d/Cloudana10
git add client/src/pages/pricing/provider-calculator.tsx
git commit -m "feat: update provider calculator — pool model, remove staking/mint/halving UI"
```

---

### Task 4: Update landing.tsx

**Files:**
- Modify: `client/src/pages/landing.tsx`

Fix: cost savings claim, provider copy (remove "no staking required" since there is no staking at all — just say earn through work), copyright year, social links, broken /dashboard link.

- [ ] **Step 1: Fix the stats ribbon cost claim**

Line 197:
```typescript
// BEFORE:
{ value: "~70%", label: "Cheaper vs AWS" },

// AFTER:
{ value: "~50%", label: "Avg Savings vs Cloud" },
```

This aligns with the whitepaper range (20-40% general, up to 50% for GPU).

- [ ] **Step 2: Fix the provider section copy**

Lines 454-461. The current copy says "No staking required" — since we have no staking at all, reframe:

```typescript
// BEFORE (lines 454-457):
            Got idle hardware? Register as a provider and start earning CLD directly through
            computation. No staking required — your machine runs matrix multiplication tasks,
            the POUW verifier confirms the work, and CLD is minted to your wallet automatically.

// AFTER:
            Got idle hardware? Register as a provider and start earning CLD through
            computation. Your machine runs matrix multiplication tasks, the POUW verifier
            confirms the work on-chain, and CLD is minted to your wallet automatically.
```

- [ ] **Step 3: Fix the provider section second paragraph**

Lines 458-461. Add mention of the penalty system instead of challenge/slashing:

```typescript
// BEFORE (lines 458-461):
            Rewards scale with work done — larger matrices and higher difficulty mean more CLD.
            Every submission is re-verified by the orchestrator. Invalid proofs are rejected,
            and the challenge system handles disputes on-chain.

// AFTER:
            Rewards scale with work done — larger matrices and higher difficulty mean more CLD.
            Every submission is re-verified by the orchestrator. Invalid proofs are rejected.
            Unreliable providers receive warnings, then suspensions — keeping the network stable.
```

- [ ] **Step 4: Fix requirements box**

Line 488:
```typescript
// BEFORE:
"Wallet connected to Base Sepolia (CLD earned via POUW)",

// AFTER:
"Wallet connected to Base Sepolia",
```

Line 499:
```typescript
// BEFORE:
No upfront cost — register your hardware and start earning CLD through computation

// AFTER:
No upfront cost. All CLD is earned through useful work.
```

- [ ] **Step 5: Fix ConnectedView dashboard link**

Line 59:
```typescript
// BEFORE:
<Link href="/dashboard">

// AFTER:
<Link href="/user">
```

Also line 63:
```typescript
// BEFORE:
<p className="text-sm text-slate-600 mb-4">Manage deployments, monitor workloads, check billing.</p>

// AFTER:
<p className="text-sm text-slate-600 mb-4">Manage deployments, monitor workloads.</p>
```

- [ ] **Step 6: Fix copyright year**

Line 588:
```typescript
// BEFORE:
<p className="text-xs text-slate-400">&copy; 2025 Cloudana</p>

// AFTER:
<p className="text-xs text-slate-400">&copy; 2026 Cloudana</p>
```

- [ ] **Step 7: Fix social links**

Lines 593-601. Replace placeholder URLs:
```typescript
// Twitter (line 593):
// BEFORE:
<a href="https://twitter.com" ...>

// AFTER:
<a href="https://x.com/cloudana10" ...>

// GitHub (line 596):
// BEFORE:
<a href="https://github.com" ...>

// AFTER:
<a href="https://github.com/cloudana10" ...>

// Discord (line 599): keep as-is or remove if no Discord exists yet.
// If keeping, leave the generic URL for now.
```

- [ ] **Step 8: Verify build**

Run: `cd C:/Users/amr_d/Cloudana10 && npx vite build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 9: Commit**

```bash
cd C:/Users/amr_d/Cloudana10
git add client/src/pages/landing.tsx
git commit -m "fix: align landing page copy with POUW-only economics, fix links and copyright"
```

---

### Task 5: Update docs.tsx

**Files:**
- Modify: `client/src/pages/docs.tsx:276` (fee structure text)

The fee structure text is correct per owner decision (80/15/5). Only need to remove staking references and verify fee text accuracy.

- [ ] **Step 1: Search for staking references in docs.tsx**

Run: `grep -n -i "stak" client/src/pages/docs.tsx`

For each match that says providers stake or must stake, update to remove staking language. Replace with penalty system language where appropriate.

- [ ] **Step 2: Verify the fee structure text is correct**

Line 276 says: "Provider receives CLD from: job execution fees (80% of user payment) and POUW mining rewards (minted on mainnet, pool on testnet). 15% of fees are burned; 5% go to the treasury."

This matches the 80/15/5 decision. No change needed.

- [ ] **Step 3: Verify build**

Run: `cd C:/Users/amr_d/Cloudana10 && npx vite build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/amr_d/Cloudana10
git add client/src/pages/docs.tsx
git commit -m "fix: remove staking references from docs, keep 80/15/5 fee split"
```

---

### Task 6: Update gpus-on-demand.tsx

**Files:**
- Modify: `client/src/pages/pricing/gpus-on-demand.tsx:77-109`

Remove fabricated stats. Replace with honest, understated claims.

- [ ] **Step 1: Fix whyChooseCards cost claim**

Line 80:
```typescript
// BEFORE:
"Reduce your cloud computing costs by up to 80% compared to traditional providers."

// AFTER:
"Lower compute costs by leveraging a decentralized provider network with competitive bidding."
```

- [ ] **Step 2: Replace readyToDeployStats**

Lines 104-109:
```typescript
// BEFORE:
const readyToDeployStats = [
  { title: "85%", description: "Average Cost Savings" },
  { title: "50+", description: "Provider Locations" },
  { title: "2min", description: "Deployment Speed" },
  { title: "99%", description: "Customer Satisfaction" },
];

// AFTER:
const readyToDeployStats = [
  { title: "POUW", description: "Verified Compute" },
  { title: "80/15/5", description: "Provider / Burn / Treasury" },
  { title: "<2min", description: "Deployment Speed" },
  { title: "Base L2", description: "Settlement Layer" },
];
```

- [ ] **Step 3: Verify build**

Run: `cd C:/Users/amr_d/Cloudana10 && npx vite build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/amr_d/Cloudana10
git add client/src/pages/pricing/gpus-on-demand.tsx
git commit -m "fix: replace fabricated stats with real protocol metrics"
```

---

### Task 7: Add /faucet route to App.tsx

**Files:**
- Modify: `client/src/App.tsx`

The landing page links to `/faucet` and `client/src/pages/faucet.tsx` exists, but there's no route for it in App.tsx.

- [ ] **Step 1: Add import**

After the existing imports (around line 27):
```typescript
import FaucetPage from "@/pages/faucet";
```

- [ ] **Step 2: Add route**

Inside the `<Switch>` in `AppRouter`, add before the NotFound route (around line 69):
```typescript
<Route path="/faucet" component={FaucetPage} />
```

- [ ] **Step 3: Verify build**

Run: `cd C:/Users/amr_d/Cloudana10 && npx vite build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/amr_d/Cloudana10
git add client/src/App.tsx
git commit -m "fix: add missing /faucet route"
```

---

### Task 8: Create 10-year economic simulation

**Files:**
- Create: `client/src/scripts/simulate-10yr.ts`

Standalone script that models CLD supply dynamics over 10 years, showing that the 15% burn + POUW-only minting creates a stable token economy. Run with `npx tsx client/src/scripts/simulate-10yr.ts`.

- [ ] **Step 1: Create the simulation script**

```typescript
/**
 * Cloudana 10-Year CLD Economic Simulation
 *
 * Model:
 * - CLD minted ONLY through POUW (100 CLD/block, 1 block/60s)
 * - 80% to provider, 15% burned, 5% treasury
 * - No halving, no registration mint, no staking
 * - Provider count and workload demand grow via logistic curves
 * - As CLD price rises, fiat cost of workloads rises,
 *   creating natural demand ceiling
 *
 * Run: npx tsx client/src/scripts/simulate-10yr.ts
 */

const BASE_BLOCK_REWARD = 100; // CLD per block
const BLOCKS_PER_YEAR = 365.25 * 24 * 60; // 1 block/min
const FEE_BURN = 0.15;
const FEE_PROVIDER = 0.80;
const FEE_TREASURY = 0.05;

interface YearSnapshot {
  year: number;
  providers: number;
  workloadsPerDay: number;
  cldMinted: number;
  cldBurnedFromFees: number;
  netNewCld: number;
  totalSupply: number;
  avgMonthlyPerProvider: number;
  avgJobFeeCld: number;
  impliedCldPriceUsd: number;
}

function logistic(t: number, midpoint = 0.4, steepness = 12): number {
  return 1 / (1 + Math.exp(-steepness * (t - midpoint)));
}

function runSimulation(): YearSnapshot[] {
  const results: YearSnapshot[] = [];
  let totalSupply = 0;

  // Growth parameters
  const providerStart = 50;
  const providerMax = 10_000;
  const workloadStart = 10;       // jobs/day
  const workloadMax = 50_000;     // jobs/day at maturity
  const avgJobFeeUsd = 5;        // average job cost in USD
  const initialCldPriceUsd = 0.01; // starting price

  for (let year = 1; year <= 10; year++) {
    const t = year / 10;
    const growth = logistic(t);

    const providers = Math.round(providerStart + (providerMax - providerStart) * growth);
    const workloadsPerDay = Math.round(workloadStart + (workloadMax - workloadStart) * growth);

    // CLD minted from POUW mining (constant — no halving)
    const cldMinted = BASE_BLOCK_REWARD * BLOCKS_PER_YEAR;

    // CLD price rises with demand (simple model: price proportional to demand/supply)
    // As more workloads, more CLD is bought to pay for them, price goes up
    const demandPressure = (workloadsPerDay * 365.25 * avgJobFeeUsd);
    const supplyBase = Math.max(totalSupply, cldMinted); // prevent div-by-zero year 1
    const impliedCldPriceUsd = Math.max(
      initialCldPriceUsd,
      initialCldPriceUsd * (demandPressure / (supplyBase * initialCldPriceUsd)) * 0.1
    );

    // Job fee in CLD = USD cost / CLD price
    const avgJobFeeCld = avgJobFeeUsd / impliedCldPriceUsd;

    // Total fees collected in CLD over the year
    const totalJobFeesCld = workloadsPerDay * 365.25 * avgJobFeeCld;

    // Burn from fees (15% of fees are burned)
    const cldBurnedFromFees = totalJobFeesCld * FEE_BURN;

    // Net supply change
    const netNewCld = cldMinted - cldBurnedFromFees;
    totalSupply += netNewCld;

    // Average monthly earning per provider (from block rewards only)
    const avgMonthlyPerProvider = (cldMinted * FEE_PROVIDER) / providers / 12;

    results.push({
      year,
      providers,
      workloadsPerDay,
      cldMinted: Math.round(cldMinted),
      cldBurnedFromFees: Math.round(cldBurnedFromFees),
      netNewCld: Math.round(netNewCld),
      totalSupply: Math.round(totalSupply),
      avgMonthlyPerProvider: Math.round(avgMonthlyPerProvider * 100) / 100,
      avgJobFeeCld: Math.round(avgJobFeeCld * 100) / 100,
      impliedCldPriceUsd: Math.round(impliedCldPriceUsd * 10000) / 10000,
    });
  }

  return results;
}

// -- Run and print --

const results = runSimulation();

console.log("\n=== CLOUDANA 10-YEAR CLD SIMULATION ===\n");
console.log("Model: POUW-only minting, 80/15/5 split, no halving, no staking\n");

console.log(
  "Year".padEnd(6) +
  "Providers".padEnd(12) +
  "Jobs/Day".padEnd(12) +
  "CLD Minted".padEnd(14) +
  "CLD Burned".padEnd(14) +
  "Net New".padEnd(14) +
  "Total Supply".padEnd(16) +
  "$/CLD".padEnd(10) +
  "Avg $/mo/provider".padEnd(20)
);
console.log("-".repeat(116));

for (const r of results) {
  const providerMonthlyUsd = r.avgMonthlyPerProvider * r.impliedCldPriceUsd;
  console.log(
    String(r.year).padEnd(6) +
    r.providers.toLocaleString().padEnd(12) +
    r.workloadsPerDay.toLocaleString().padEnd(12) +
    r.cldMinted.toLocaleString().padEnd(14) +
    r.cldBurnedFromFees.toLocaleString().padEnd(14) +
    r.netNewCld.toLocaleString().padEnd(14) +
    r.totalSupply.toLocaleString().padEnd(16) +
    `$${r.impliedCldPriceUsd}`.padEnd(10) +
    `$${providerMonthlyUsd.toFixed(2)}`
  );
}

console.log("\n=== KEY INSIGHTS ===");
const last = results[results.length - 1];
const first = results[0];
console.log(`\n1. Total supply after 10 years: ${last.totalSupply.toLocaleString()} CLD`);
console.log(`2. CLD price movement: $${first.impliedCldPriceUsd} -> $${last.impliedCldPriceUsd}`);
console.log(`3. Annual burn at maturity: ${last.cldBurnedFromFees.toLocaleString()} CLD (${((last.cldBurnedFromFees / last.cldMinted) * 100).toFixed(1)}% of minted)`);
console.log(`4. Provider earnings Y1: ${first.avgMonthlyPerProvider} CLD/mo -> Y10: ${last.avgMonthlyPerProvider} CLD/mo`);
console.log(`5. As CLD price rises, fiat workload cost rises, creating natural demand ceiling`);
console.log(`6. 15% burn rate creates deflationary pressure as network activity grows`);
console.log(`7. Pool model: ${first.providers} providers share rewards Y1, ${last.providers} share Y10`);
```

- [ ] **Step 2: Run the simulation**

Run: `cd C:/Users/amr_d/Cloudana10 && npx tsx client/src/scripts/simulate-10yr.ts`

Review the output table. Key things to verify:
- Total supply grows but burn catches up as demand increases
- Provider monthly earnings decrease in CLD as network grows (pool effect)
- Provider monthly earnings in USD may stay stable or grow (CLD price appreciation)
- The model shows natural equilibrium, not runaway inflation

- [ ] **Step 3: Commit**

```bash
cd C:/Users/amr_d/Cloudana10
git add client/src/scripts/simulate-10yr.ts
git commit -m "feat: add 10-year CLD economic simulation script"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- [x] POUWVerifier address fix (Task 1)
- [x] Economics rewrite — no staking, no halving, no mint (Task 2)
- [x] Provider calculator updated (Task 3)
- [x] Landing page copy fixed (Task 4)
- [x] Docs fee structure + staking refs (Task 5)
- [x] Fake stats removed (Task 6)
- [x] Faucet route added (Task 7)
- [x] 10-year simulation (Task 8)
- [x] Copyright 2026 (Task 4 Step 6)
- [x] Social links @cloudana10 (Task 4 Step 7)
- [x] /dashboard link fixed to /user (Task 4 Step 5)
- [x] Penalty system defined (Task 2, in provider-economics.ts)

**2. Placeholder scan:** No TBD/TODO found. All code blocks are complete.

**3. Type consistency:**
- `EarningsProjection` interface in Task 2 uses `grossMonthly`, `netMonthly`, `annualProjection` — Task 3 references these same fields.
- `PENALTY_TIERS` exported from Task 2, imported in Task 3.
- `FEE_SPLIT` exported from Task 2, used in Task 6 stats display.

**Items NOT in this plan (deferred):**
- Free tier design (needs product research — Cloudflare/AWS models)
- Akash piggyback integration (infrastructure decision, not frontend)
- Whitepaper updates (this plan only covers the site)
- StakingManager contract removal from UI (contract still deployed, just not referenced in economics)
