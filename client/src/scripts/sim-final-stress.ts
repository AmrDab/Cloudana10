/**
 * Cloudana CLD Economic Model — FINAL Adversarial Stress Tests
 *
 * HALVING-WITH-FLOOR model vs previous constant-mint model.
 *
 * Model:
 * - Minting: 100 CLD/block Y1-4, 50 CLD/block Y5-8, 25 CLD/block Y9+ (permanent floor)
 * - Block time: 1 block/60s (~525,960 blocks/year)
 * - Fee split: 75% provider / 20% burned / 5% treasury
 * - No staking. Penalties: warning -> 3-month -> 1-year suspension
 * - Dual provider revenue: mining rewards + 75% of job execution fees
 * - Price model: annual fiat demand / circulating supply
 * - Avg job fee: $5 USD
 *
 * Run: npx tsx client/src/scripts/sim-final-stress.ts
 */

// ── Constants ──────────────────────────────────────────────────────────

const BLOCKS_PER_YEAR = 365.25 * 24 * 60; // 525,960

function blockReward(year: number): number {
  if (year <= 4) return 100;
  if (year <= 8) return 50;
  return 25; // permanent floor
}

function annualMint(year: number): number {
  return blockReward(year) * BLOCKS_PER_YEAR;
}

const FEE_PROVIDER = 0.75;
const FEE_BURN = 0.20;
const FEE_TREASURY = 0.05;
const MIN_PROVIDER_USD_MO = 100;
const AVG_JOB_USD = 5;

// ── Baseline growth curves ─────────────────────────────────────────────

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
  fiatDemandM: number;
  cldPrice: number;
  circulatingSupply: number;
  cldBurned: number;
  providerMonthlyUsd: number;
  viable: boolean;
}

interface ScenarioResult {
  name: string;
  rows: YearRow[];
  verdict: "SURVIVES" | "STRESSED" | "FAILS";
  reason: string;
}

function simulate(
  getProviders: (year: number) => number,
  getWorkloads: (year: number) => number,
  hooks?: {
    supplyShock?: (year: number, supply: number) => number;
    priceOverride?: (year: number, basePriceUsd: number, supply: number) => number;
  }
): YearRow[] {
  const rows: YearRow[] = [];
  let supply = 0;

  for (let year = 1; year <= 10; year++) {
    const mint = annualMint(year);
    supply += mint;

    if (hooks?.supplyShock) {
      supply = hooks.supplyShock(year, supply);
    }

    const providers = Math.max(1, getProviders(year));
    const workloadsPerDay = Math.max(0, getWorkloads(year));

    // Annual fiat demand from job fees
    const annualFiat = workloadsPerDay * 365.25 * AVG_JOB_USD;

    // CLD price = annual fiat demand / circulating supply
    let price = supply > 0 ? annualFiat / supply : 0.001;
    price = Math.max(0.0001, price);

    if (hooks?.priceOverride) {
      price = hooks.priceOverride(year, price, supply);
    }

    // Burn: 20% of all job fees denominated in CLD
    const jobFeeCld = AVG_JOB_USD / price;
    const totalJobsCld = workloadsPerDay * 365.25 * jobFeeCld;
    const burned = totalJobsCld * FEE_BURN;
    supply = Math.max(0, supply - burned);

    // Provider monthly USD = mining rewards share + job fee share
    // Mining: provider gets proportional share of annual mint
    const miningMonthlyCld = mint / providers / 12;
    // Job fees: 75% of job fees in CLD, split across providers
    const jobFeeProviderCld = (totalJobsCld * FEE_PROVIDER) / providers / 12;
    const totalMonthlyCld = miningMonthlyCld + jobFeeProviderCld;
    const providerMonthlyUsd = totalMonthlyCld * price;

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
  // Count consecutive years below viability
  let maxConsecFail = 0;
  let currentConsec = 0;
  for (const r of rows) {
    if (!r.viable) {
      currentConsec++;
      maxConsecFail = Math.max(maxConsecFail, currentConsec);
    } else {
      currentConsec = 0;
    }
  }

  const failYears = rows.filter(r => !r.viable);
  const priceCollapse = rows.some(r => r.cldPrice < 0.001);

  // FAILS: 3+ consecutive years below $100/mo OR price death spiral
  if (maxConsecFail >= 3 || priceCollapse) {
    const reason = priceCollapse
      ? `Price collapses below $0.001`
      : `Providers unviable (<$100/mo) for ${maxConsecFail} consecutive years`;
    return { verdict: "FAILS", reason };
  }

  // STRESSED: any years below $100/mo but recovers
  if (failYears.length > 0) {
    return {
      verdict: "STRESSED",
      reason: `Providers dip below $100/mo for ${failYears.length} year(s) (Y${failYears.map(r => r.year).join(",")}) but recover`,
    };
  }

  return { verdict: "SURVIVES", reason: "Providers stay above $100/mo, price stable" };
}

// ── Scenarios ──────────────────────────────────────────────────────────

function scenario1_demandCrash(): ScenarioResult {
  // Normal Y1-3, demand drops 80% at Y4, slowly recovers to 50% of peak by Y10
  const peakWorkloads = baselineWorkloads(3);

  function getWorkloads(year: number): number {
    if (year <= 3) return baselineWorkloads(year);
    if (year === 4) return Math.round(peakWorkloads * 0.20);
    // Linear recovery from 20% at Y4 to 50% at Y10
    const recoveryFrac = 0.20 + (0.50 - 0.20) * ((year - 4) / 6);
    return Math.round(peakWorkloads * recoveryFrac);
  }

  const rows = simulate(baselineProviders, getWorkloads);
  const { verdict, reason } = judge(rows);
  return { name: "Scenario 1: Demand Crash", rows, verdict, reason };
}

function scenario2_providerExodus(): ScenarioResult {
  // Normal Y1-3, 70% providers leave at Y4. Workload demand stays.
  function getProviders(year: number): number {
    if (year <= 3) return baselineProviders(year);
    const baseAtY3 = baselineProviders(3);
    const remaining = Math.round(baseAtY3 * 0.30);
    if (year === 4) return remaining;
    // Slow recovery: 30% -> 100% over Y5-Y10
    const recoveryFrac = 0.30 + 0.70 * ((year - 4) / 6);
    return Math.round(baseAtY3 * Math.min(1, recoveryFrac));
  }

  const rows = simulate(getProviders, baselineWorkloads);
  const { verdict, reason } = judge(rows);
  return { name: "Scenario 2: Provider Exodus", rows, verdict, reason };
}

function scenario3_whaleDump(): ScenarioResult {
  // One entity accumulates 30% of CLD Y1-3, dumps everything at Y5
  let whaleHolding = 0;

  const rows = simulate(baselineProviders, baselineWorkloads, {
    supplyShock: (year, supply) => {
      if (year <= 3) {
        // Whale buys ~10% of supply each year (removed from circulation)
        const bought = supply * 0.10;
        whaleHolding += bought;
        return supply - bought;
      }
      if (year === 5) {
        // Dump all holdings back into circulation
        const dumped = whaleHolding;
        whaleHolding = 0;
        return supply + dumped;
      }
      return supply;
    },
    priceOverride: (year, basePrice) => {
      if (year === 5) {
        // Market impact: 60% price crash on dump
        return basePrice * 0.40;
      }
      return basePrice;
    },
  });

  const { verdict, reason } = judge(rows);
  return { name: "Scenario 3: Whale Dump", rows, verdict, reason };
}

function scenario4_competitor(): ScenarioResult {
  // At Y3, competitor takes 50% of providers and 40% of demand
  function getProviders(year: number): number {
    if (year <= 2) return baselineProviders(year);
    return Math.round(baselineProviders(year) * 0.50);
  }

  function getWorkloads(year: number): number {
    if (year <= 2) return baselineWorkloads(year);
    return Math.round(baselineWorkloads(year) * 0.60);
  }

  const rows = simulate(getProviders, getWorkloads);
  const { verdict, reason } = judge(rows);
  return { name: "Scenario 4: Competitor Launch", rows, verdict, reason };
}

function scenario5_hyperadoption(): ScenarioResult {
  // Demand grows 10x faster: 500K jobs/day by Y5
  function getWorkloads(year: number): number {
    // Exponential: 100 -> 500,000 by Y5, then plateau
    if (year <= 5) {
      const base = 100 * Math.pow(10, (year - 1) * (Math.log10(5000)) / 4);
      return Math.round(Math.min(base, 500_000));
    }
    return 500_000;
  }

  function getProviders(year: number): number {
    // Providers grow fast but lag demand
    const base = 50 * Math.pow(5, (year - 1) / 3);
    return Math.round(Math.min(base, 100_000));
  }

  const rows = simulate(getProviders, getWorkloads);
  const { verdict, reason } = judge(rows);
  return { name: "Scenario 5: Hyperadoption", rows, verdict, reason };
}

function scenario6_stagnation(): ScenarioResult {
  // 50 providers, 10 jobs/day, all 10 years
  const rows = simulate(
    () => 50,
    () => 10
  );
  const { verdict, reason } = judge(rows);
  return { name: "Scenario 6: Stagnation", rows, verdict, reason };
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

  console.log(`\n${"=".repeat(96)}`);
  console.log(`  ${name}`);
  console.log(`${"=".repeat(96)}`);

  console.log(
    "Yr".padEnd(4) +
    "Reward".padStart(8) +
    "Provs".padStart(8) +
    "Jobs/d".padStart(9) +
    "Fiat/yr".padStart(10) +
    "CLD Price".padStart(11) +
    "Supply".padStart(12) +
    "Burned".padStart(10) +
    "$/mo/prov".padStart(11) +
    "Viable?".padStart(9)
  );
  console.log("-".repeat(92));

  for (const r of rows) {
    const viableStr = r.viable ? "  YES" : "  NO";
    const reward = blockReward(r.year);
    console.log(
      String(r.year).padEnd(4) +
      (reward + "/blk").padStart(8) +
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

const totalMintY1_4 = 100 * BLOCKS_PER_YEAR * 4;
const totalMintY5_8 = 50 * BLOCKS_PER_YEAR * 4;
const totalMintY9_10 = 25 * BLOCKS_PER_YEAR * 2;
const totalMint10yr = totalMintY1_4 + totalMintY5_8 + totalMintY9_10;

console.log("##########################################################################");
console.log("#                                                                        #");
console.log("#   CLOUDANA CLD ECONOMIC MODEL -- FINAL STRESS TESTS                    #");
console.log("#                                                                        #");
console.log("#   HALVING-WITH-FLOOR MODEL                                             #");
console.log(`#   Y1-4: 100 CLD/blk  Y5-8: 50 CLD/blk  Y9+: 25 CLD/blk (floor)      #`);
console.log(`#   Fee split: 75% provider / 20% burned / 5% treasury                   #`);
console.log(`#   Dual revenue: mining rewards + 75% job fees                           #`);
console.log("#   Provider viability threshold: $100/mo hardware cost                   #");
console.log("#                                                                        #");
console.log(`#   10yr max supply (pre-burn): ${fmt(totalMint10yr, 0).padEnd(10)}                            #`);
console.log(`#   vs constant-mint 10yr: ${fmt(100 * BLOCKS_PER_YEAR * 10, 0).padEnd(10)}                                 #`);
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

console.log(`\n${"#".repeat(96)}`);
console.log(`#  OVERALL ASSESSMENT: Halving-with-Floor vs Constant-Mint`);
console.log(`${"#".repeat(96)}\n`);

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

// Compare with previous constant-mint model
console.log(`\n${"=".repeat(96)}`);
console.log(`  COMPARISON: Halving-with-Floor vs Constant-Mint (previous model)`);
console.log(`${"=".repeat(96)}`);
console.log(`
  Previous model (constant 100 CLD/blk, 80/15/5 split):
    - 10yr total mint: ~525.96M CLD (always)
    - Demand Crash:     FAILS  (endless dilution during downturn)
    - Stagnation:       FAILS  (ever-growing supply vs zero demand growth)
    - Provider Exodus:  SURVIVES
    - Whale Dump:       STRESSED
    - Competitor:       STRESSED
    - Hyperadoption:    SURVIVES

  New model (halving 100->50->25, 75/20/5 split):
    - 10yr total mint: ~${fmt(totalMint10yr, 0)} CLD (${((1 - totalMint10yr / (100 * BLOCKS_PER_YEAR * 10)) * 100).toFixed(0)}% less supply)
    - Demand Crash:     ${verdicts[0].verdict}
    - Stagnation:       ${verdicts[5].verdict}
    - Provider Exodus:  ${verdicts[1].verdict}
    - Whale Dump:       ${verdicts[2].verdict}
    - Competitor:       ${verdicts[3].verdict}
    - Hyperadoption:    ${verdicts[4].verdict}
`);

console.log(`--- KEY IMPROVEMENTS ---\n`);
console.log(`1. SUPPLY REDUCTION: ${((1 - totalMint10yr / (100 * BLOCKS_PER_YEAR * 10)) * 100).toFixed(0)}% less CLD minted over 10 years.`);
console.log(`   Y5-8 at 50/blk and Y9+ at 25/blk dramatically reduce dilution pressure.`);
console.log(`   This is the single biggest lever against demand-crash scenarios.\n`);
console.log(`2. HIGHER BURN RATE: 20% burn (up from 15%) removes more CLD per job.`);
console.log(`   During high-demand periods, burn can offset a significant fraction of new mint.\n`);
console.log(`3. DUAL REVENUE: Providers earn mining + 75% job fees.`);
console.log(`   As network matures, job fee revenue increasingly replaces declining block rewards.\n`);
console.log(`4. PERMANENT FLOOR: 25 CLD/blk ensures new providers always have baseline earnings.`);
console.log(`   Unlike pure halving (BTC-style), this prevents mining rewards from going to zero.\n`);

console.log(`--- REMAINING VULNERABILITIES ---\n`);

const worstEarnings = scenarios
  .map(s => ({
    name: s.name,
    minUsd: Math.min(...s.rows.map(r => r.providerMonthlyUsd)),
    yearOfMin: s.rows.reduce((a, b) => a.providerMonthlyUsd < b.providerMonthlyUsd ? a : b).year,
  }))
  .sort((a, b) => a.minUsd - b.minUsd);

console.log(`Worst provider earnings across all scenarios:`);
for (const w of worstEarnings) {
  const marker = w.minUsd < 100 ? " << BELOW VIABILITY" : "";
  console.log(`  ${w.name}: $${w.minUsd.toFixed(2)}/mo at Y${w.yearOfMin}${marker}`);
}

console.log(`\n--- MAINNET READINESS ---\n`);

if (fails.length === 0 && stressed.length <= 2) {
  console.log(`VERDICT: YES -- Model is mainnet-ready with caveats.`);
  console.log(`The halving-with-floor model significantly improves resilience over constant-mint.`);
  if (stressed.length > 0) {
    console.log(`\nStressed scenarios to monitor:`);
    for (const s of stressed) console.log(`  - ${s.name}: ${s.reason}`);
  }
  console.log(`\nRecommended safeguards for production:`);
  console.log(`  1. Treasury buyback during sustained price drops (use 5% treasury fund)`);
  console.log(`  2. Emergency governance to adjust fee split if burn rate insufficient`);
  console.log(`  3. Provider minimum stake (even small, e.g. 1000 CLD) to lock supply`);
} else if (fails.length <= 1) {
  console.log(`VERDICT: CONDITIONAL -- Model passes most scenarios but has a critical gap.`);
  console.log(`Failed: ${fails.map(f => f.name).join(", ")}`);
  console.log(`Consider adding demand-linked mint adjustment for the failing scenario.`);
} else {
  console.log(`VERDICT: NOT READY -- Model fails ${fails.length} of 6 scenarios.`);
  console.log(`The halving helps but is insufficient. Additional mechanisms needed.`);
}

console.log(`\n${"#".repeat(96)}\n`);
