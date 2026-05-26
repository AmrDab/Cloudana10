/**
 * Cloudana CLD Economic Model — Adversarial Stress Tests
 *
 * 6 scenarios, 10 years each. Tracks price, supply, provider earnings, viability.
 *
 * Model:
 * - CLD minted ONLY through POUW: 100 CLD/block, 1 block/60s (~52.596M/yr)
 * - Job fees: 80% to provider, 15% burned, 5% treasury
 * - No halving, no staking
 * - CLD price = annual fiat demand / circulating supply
 * - Provider earnings = (block rewards * 80%) / provider count
 *
 * Run: npx tsx client/src/scripts/sim-stress.ts
 */

// ── Constants ──────────────────────────────────────────────────────────

const BLOCKS_PER_YEAR = 365.25 * 24 * 60; // 525,960
const BLOCK_REWARD = 100;
const ANNUAL_MINT = BLOCK_REWARD * BLOCKS_PER_YEAR; // ~52,596,000
const FEE_PROVIDER = 0.80;
const FEE_BURN = 0.15;
const FEE_TREASURY = 0.05;
const MIN_PROVIDER_USD_MO = 100; // hardware cost floor

// ── Baseline growth curves (from simulate-10yr.ts) ────────────────────

function logistic(t: number, midpoint = 0.4, steepness = 12): number {
  return 1 / (1 + Math.exp(-steepness * (t - midpoint)));
}

function baselineProviders(year: number): number {
  const t = year / 10;
  return Math.round(50 + (10_000 - 50) * logistic(t));
}

function baselineWorkloads(year: number): number {
  const t = year / 10;
  return Math.round(10 + (50_000 - 10) * logistic(t));
}

// ── Core simulation engine ─────────────────────────────────────────────

interface YearRow {
  year: number;
  providers: number;
  workloadsPerDay: number;
  fiatDemandM: number;      // annual fiat demand in $M
  cldPrice: number;
  circulatingSupply: number;
  cldBurned: number;
  providerMonthlyUsd: number;
  viable: boolean;           // provider earns >= $100/mo
}

interface ScenarioResult {
  name: string;
  rows: YearRow[];
  verdict: "SURVIVES" | "STRESSED" | "FAILS";
  reason: string;
}

const AVG_JOB_USD = 5; // constant fiat price per job

function simulate(
  getProviders: (year: number) => number,
  getWorkloads: (year: number) => number,
  hooks?: {
    // Optional: inject/remove CLD from supply at start of year
    supplyShock?: (year: number, supply: number) => number;
    // Optional: override price calculation
    priceOverride?: (year: number, basePriceUsd: number, supply: number) => number;
  }
): YearRow[] {
  const rows: YearRow[] = [];
  let supply = 0;

  for (let year = 1; year <= 10; year++) {
    // Mint
    supply += ANNUAL_MINT;

    // Apply supply shock (whale dump, etc.)
    if (hooks?.supplyShock) {
      supply = hooks.supplyShock(year, supply);
    }

    const providers = Math.max(1, getProviders(year));
    const workloadsPerDay = Math.max(0, getWorkloads(year));

    // Fiat demand
    const annualFiat = workloadsPerDay * 365.25 * AVG_JOB_USD;

    // Price
    let price = supply > 0 ? annualFiat / supply : 0.001;
    price = Math.max(0.0001, price);

    if (hooks?.priceOverride) {
      price = hooks.priceOverride(year, price, supply);
    }

    // Burn: 15% of job fees denominated in CLD
    const jobFeeCld = AVG_JOB_USD / price;
    const totalJobsCld = workloadsPerDay * 365.25 * jobFeeCld;
    const burned = totalJobsCld * FEE_BURN;
    supply = Math.max(0, supply - burned);

    // Provider economics: POUW rewards (80% of block rewards split among providers)
    const providerMonthlyCld = (ANNUAL_MINT * FEE_PROVIDER) / providers / 12;
    const providerMonthlyUsd = providerMonthlyCld * price;

    rows.push({
      year,
      providers,
      workloadsPerDay,
      fiatDemandM: annualFiat / 1e6,
      cldPrice: price,
      circulatingSupply: supply,
      cldBurned: burned,
      providerMonthlyUsd,
      viable: providerMonthlyUsd >= MIN_PROVIDER_USD_MO,
    });
  }
  return rows;
}

function judge(rows: YearRow[]): { verdict: "SURVIVES" | "STRESSED" | "FAILS"; reason: string } {
  const failYears = rows.filter(r => !r.viable);
  const priceCollapse = rows.some(r => r.cldPrice < 0.001);
  const zeroWorkload = rows.slice(3).some(r => r.workloadsPerDay === 0);
  const lowPriceYears = rows.filter(r => r.cldPrice < 0.01);

  if (failYears.length >= 5 || priceCollapse) {
    const reason = priceCollapse
      ? `Price collapses below $0.001`
      : `Providers unviable (<$100/mo) for ${failYears.length}/10 years`;
    return { verdict: "FAILS", reason };
  }

  if (failYears.length >= 2 || lowPriceYears.length >= 3) {
    const issues: string[] = [];
    if (failYears.length > 0) issues.push(`unviable ${failYears.length} years`);
    if (lowPriceYears.length > 0) issues.push(`price <$0.01 for ${lowPriceYears.length} years`);
    return { verdict: "STRESSED", reason: issues.join("; ") };
  }

  return { verdict: "SURVIVES", reason: "All metrics within acceptable range" };
}

// ── Scenarios ──────────────────────────────────────────────────────────

function scenario1_demandCrash(): ScenarioResult {
  // Normal Y1-Y3, demand drops 80% at Y4, slowly recovers to 50% of peak by Y10
  const peakWorkloads = baselineWorkloads(3);

  function getWorkloads(year: number): number {
    if (year <= 3) return baselineWorkloads(year);
    if (year === 4) return Math.round(peakWorkloads * 0.20);
    // Linear recovery from 20% to 50% over Y5-Y10
    const recoveryFrac = 0.20 + (0.50 - 0.20) * ((year - 4) / 6);
    return Math.round(peakWorkloads * recoveryFrac);
  }

  const rows = simulate(baselineProviders, getWorkloads);
  const { verdict, reason } = judge(rows);
  return { name: "Scenario 1: Demand Crash", rows, verdict, reason };
}

function scenario2_providerExodus(): ScenarioResult {
  // Normal Y1-Y3, then 70% providers leave at Y4, demand stays
  function getProviders(year: number): number {
    if (year <= 3) return baselineProviders(year);
    // 70% leave, slow recovery
    const baseAtY3 = baselineProviders(3);
    const remaining = Math.round(baseAtY3 * 0.30);
    if (year === 4) return remaining;
    // Slow recovery as remaining providers are very profitable
    const recoveryFrac = 0.30 + (0.70 * ((year - 4) / 6));
    return Math.round(baseAtY3 * Math.min(1, recoveryFrac));
  }

  const rows = simulate(getProviders, baselineWorkloads);
  const { verdict, reason } = judge(rows);
  return { name: "Scenario 2: Provider Exodus", rows, verdict, reason };
}

function scenario3_whaleDump(): ScenarioResult {
  // One entity accumulates 30% of CLD Y1-Y3, dumps all at Y5
  let whaleHolding = 0;

  function getWorkloads(year: number): number {
    return baselineWorkloads(year);
  }

  const rows = simulate(baselineProviders, getWorkloads, {
    supplyShock: (year, supply) => {
      if (year <= 3) {
        // Whale buys 10% of circulating supply each year (accumulates ~30% by Y3)
        const bought = supply * 0.10;
        whaleHolding += bought;
        // Buying removes from circulation (whale holds)
        return supply - bought;
      }
      if (year === 5) {
        // Whale dumps everything back into circulation
        const dumped = whaleHolding;
        whaleHolding = 0;
        return supply + dumped;
      }
      return supply;
    },
    priceOverride: (year, basePrice, supply) => {
      if (year === 5) {
        // Dump causes 60% price crash (market impact of large sell)
        return basePrice * 0.40;
      }
      return basePrice;
    },
  });

  const { verdict, reason } = judge(rows);
  return { name: "Scenario 3: Whale Accumulation + Dump", rows, verdict, reason };
}

function scenario4_competitor(): ScenarioResult {
  // At Y3, competitor launches. 50% providers leave. Demand splits 60/40.
  function getProviders(year: number): number {
    if (year <= 2) return baselineProviders(year);
    // 50% leave at Y3, slowly lose more to 40% retained by Y10
    const base = baselineProviders(year);
    const retainedFrac = year === 3 ? 0.50 : Math.max(0.40, 0.50 - (year - 3) * 0.02);
    return Math.round(base * retainedFrac);
  }

  function getWorkloads(year: number): number {
    if (year <= 2) return baselineWorkloads(year);
    // Cloudana keeps 60% of demand
    return Math.round(baselineWorkloads(year) * 0.60);
  }

  const rows = simulate(getProviders, getWorkloads);
  const { verdict, reason } = judge(rows);
  return { name: "Scenario 4: Competitor Launch", rows, verdict, reason };
}

function scenario5_hyperadoption(): ScenarioResult {
  // Demand grows 10x faster than logistic baseline
  function getWorkloads(year: number): number {
    // Aggressive exponential: starts at 100/day, hits 500K/day by Y10
    const base = 100 * Math.pow(10, (year - 1) / 3);
    return Math.round(Math.min(base, 500_000));
  }

  function getProviders(year: number): number {
    // Providers lag demand but grow fast too
    const base = 50 * Math.pow(5, (year - 1) / 3);
    return Math.round(Math.min(base, 100_000));
  }

  const rows = simulate(getProviders, getWorkloads);
  const { verdict, reason } = judge(rows);
  return { name: "Scenario 5: Hyperadoption", rows, verdict, reason };
}

function scenario6_stagnation(): ScenarioResult {
  // 50 providers, 10 jobs/day, forever
  const rows = simulate(
    () => 50,
    () => 10
  );
  const { verdict, reason } = judge(rows);
  return { name: "Scenario 6: Zero Growth (Stagnation)", rows, verdict, reason };
}

// ── Output formatting ──────────────────────────────────────────────────

function fmt(n: number, decimals = 2): string {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(decimals);
}

function fmtPrice(p: number): string {
  if (p < 0.01) return "$" + p.toFixed(4);
  if (p < 1) return "$" + p.toFixed(3);
  if (p < 100) return "$" + p.toFixed(2);
  return "$" + Math.round(p).toLocaleString();
}

function printScenario(result: ScenarioResult): void {
  const { name, rows, verdict, reason } = result;
  const tag = verdict === "SURVIVES" ? "[OK]" : verdict === "STRESSED" ? "[!!]" : "[XX]";

  console.log(`\n${"=".repeat(90)}`);
  console.log(`  ${name}`);
  console.log(`${"=".repeat(90)}`);

  // Header
  console.log(
    "Yr".padEnd(4) +
    "Provs".padStart(8) +
    "Jobs/d".padStart(9) +
    "Fiat/yr".padStart(10) +
    "CLD Price".padStart(11) +
    "Supply".padStart(12) +
    "Burned".padStart(10) +
    "$/mo/prov".padStart(11) +
    "Viable?".padStart(9)
  );
  console.log("-".repeat(84));

  for (const r of rows) {
    const viableStr = r.viable ? "  YES" : "  NO";
    console.log(
      String(r.year).padEnd(4) +
      fmt(r.providers, 0).padStart(8) +
      fmt(r.workloadsPerDay, 0).padStart(9) +
      ("$" + fmt(r.fiatDemandM * 1e6, 0)).padStart(10) +
      fmtPrice(r.cldPrice).padStart(11) +
      fmt(r.circulatingSupply, 0).padStart(12) +
      fmt(r.cldBurned, 0).padStart(10) +
      ("$" + fmt(r.providerMonthlyUsd, 0)).padStart(11) +
      viableStr.padStart(9)
    );
  }

  console.log(`\n  VERDICT: ${tag} ${verdict} -- ${reason}`);
}

// ── Main ───────────────────────────────────────────────────────────────

console.log("##########################################################################");
console.log("#                                                                        #");
console.log("#   CLOUDANA CLD ECONOMIC MODEL -- ADVERSARIAL STRESS TESTS              #");
console.log("#                                                                        #");
console.log("#   Model: 100 CLD/block, 1 block/min, 80/15/5 split, no halving        #");
console.log("#   Annual mint: ~52.6M CLD (constant)                                   #");
console.log("#   Provider viability threshold: $100/mo hardware cost                   #");
console.log("#                                                                        #");
console.log("##########################################################################");

const scenarios = [
  scenario1_demandCrash(),
  scenario2_providerExodus(),
  scenario3_whaleDump(),
  scenario4_competitor(),
  scenario5_hyperadoption(),
  scenario6_stagnation(),
];

for (const s of scenarios) {
  printScenario(s);
}

// ── Overall Assessment ─────────────────────────────────────────────────

console.log(`\n${"#".repeat(90)}`);
console.log(`#  OVERALL ASSESSMENT`);
console.log(`${"#".repeat(90)}\n`);

const verdicts = scenarios.map(s => ({ name: s.name, verdict: s.verdict, reason: s.reason }));
const fails = verdicts.filter(v => v.verdict === "FAILS");
const stressed = verdicts.filter(v => v.verdict === "STRESSED");
const survives = verdicts.filter(v => v.verdict === "SURVIVES");

console.log(`Results: ${survives.length} SURVIVES, ${stressed.length} STRESSED, ${fails.length} FAILS\n`);

for (const v of verdicts) {
  const tag = v.verdict === "SURVIVES" ? "[OK]" : v.verdict === "STRESSED" ? "[!!]" : "[XX]";
  console.log(`  ${tag} ${v.name}`);
  console.log(`      ${v.reason}`);
}

console.log(`\n--- 1. BIGGEST VULNERABILITY ---\n`);

if (fails.length > 0) {
  console.log(`CRITICAL: ${fails.length} scenario(s) FAIL outright:`);
  for (const f of fails) console.log(`  - ${f.name}: ${f.reason}`);
} else if (stressed.length > 0) {
  console.log(`MODERATE: ${stressed.length} scenario(s) show stress:`);
  for (const s of stressed) console.log(`  - ${s.name}: ${s.reason}`);
}

// Identify the worst scenario by provider earnings
const worstEarnings = scenarios
  .map(s => ({
    name: s.name,
    minUsd: Math.min(...s.rows.map(r => r.providerMonthlyUsd)),
    yearOfMin: s.rows.reduce((a, b) => a.providerMonthlyUsd < b.providerMonthlyUsd ? a : b).year,
  }))
  .sort((a, b) => a.minUsd - b.minUsd);

console.log(`\nWorst provider earnings across all scenarios:`);
for (const w of worstEarnings.slice(0, 3)) {
  console.log(`  ${w.name}: $${w.minUsd.toFixed(2)}/mo at Y${w.yearOfMin}`);
}

console.log(`\nThe constant-mint model's biggest vulnerability is LOW/NO DEMAND scenarios.`);
console.log(`With 52.6M CLD minted annually regardless of demand, CLD price is entirely`);
console.log(`dependent on fiat inflow. If demand stagnates or crashes, the ever-growing`);
console.log(`supply dilutes price to near-zero, making provider earnings unviable.`);

console.log(`\n--- 2. PARAMETER CHANGE FOR RESILIENCE ---\n`);
console.log(`Option A: DEMAND-LINKED MINT RATE`);
console.log(`  Reduce block reward when utilization < 50% (e.g., halve reward if <25%`);
console.log(`  network utilization). This prevents supply flood during low-demand periods.`);
console.log(`  Tradeoff: reduces provider CLD earnings, but preserves CLD value.`);
console.log(``);
console.log(`Option B: MINIMUM BURN FLOOR`);
console.log(`  Set a minimum annual burn (e.g., 5% of circulating supply) regardless of`);
console.log(`  job volume. Acts as a deflation anchor during demand downturns.`);
console.log(`  Tradeoff: reduces circulating supply even when network is quiet.`);
console.log(``);
console.log(`Option C: PROVIDER STAKING REQUIREMENT`);
console.log(`  Require providers to stake CLD (e.g., 10,000 CLD). Locks supply, creates`);
console.log(`  skin-in-the-game, and reduces circulating supply by ~100M if 10K providers.`);
console.log(`  Tradeoff: barrier to entry, but aligns incentives.`);
console.log(``);
console.log(`RECOMMENDATION: Option A (demand-linked mint) is the highest-impact change.`);
console.log(`It directly addresses the root cause: constant mint + low demand = value death spiral.`);

console.log(`\n--- 3. IS THE CURRENT MODEL ROBUST ENOUGH FOR MAINNET? ---\n`);

if (fails.length === 0) {
  console.log(`CONDITIONAL YES. The model survives all adversarial scenarios, though some`);
  console.log(`show stress. The 80/15/5 split and constant mint work well under growth`);
  console.log(`conditions. The burn mechanism provides automatic stabilization at scale.`);
} else if (fails.length <= 2) {
  console.log(`NOT YET. The model fails ${fails.length} of 6 adversarial scenarios.`);
  console.log(`The constant-mint design is fragile against sustained low demand.`);
  console.log(`Before mainnet, implement at least one of:`);
  console.log(`  1. Demand-linked mint adjustment (Option A above)`);
  console.log(`  2. Provider staking to absorb excess supply (Option C above)`);
  console.log(`  3. A treasury buyback mechanism during price crashes`);
  console.log(`Without these safeguards, a demand downturn could create an irreversible`);
  console.log(`death spiral: low price -> providers leave -> less compute -> less demand.`);
} else {
  console.log(`NO. The model fails ${fails.length} of 6 adversarial scenarios.`);
  console.log(`The constant-mint model is fundamentally fragile. Major redesign needed.`);
}

console.log(`\n${"#".repeat(90)}\n`);
