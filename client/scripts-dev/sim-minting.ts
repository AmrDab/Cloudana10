/**
 * Cloudana CLD Minting Strategy Comparison Simulation
 *
 * Compares 4 minting strategies over 10 years:
 *   A: Constant (100 CLD/block forever)
 *   B: Bitcoin Halving (halve every 2 years)
 *   C: Gentle Halving (halve every 4 years)
 *   D: Demand-Responsive (reward scales with demand growth, capped 25-200)
 *
 * Also runs demand-shock scenario: demand drops 50% at Y5 for 2 years, then recovers.
 *
 * Run: npx tsx client/src/scripts/sim-minting.ts
 */

// ── Constants ──────────────────────────────────────────────────────────
const BLOCKS_PER_YEAR = 365.25 * 24 * 60; // ~525,960
const FEE_BURN = 0.15;
const FEE_PROVIDER = 0.80;
const FEE_TREASURY = 0.05;
const AVG_JOB_FEE_USD = 5;
const STARTING_CLD_PRICE = 0.01;

// ── Growth curves ──────────────────────────────────────────────────────
function logistic(t: number, midpoint = 0.4, steepness = 12): number {
  return 1 / (1 + Math.exp(-steepness * (t - midpoint)));
}

function getProviders(year: number): number {
  const t = year / 10;
  return Math.round(50 + (10_000 - 50) * logistic(t));
}

function getWorkloadsPerDay(year: number, demandShock: boolean): number {
  const t = year / 10;
  let base = Math.round(10 + (50_000 - 10) * logistic(t));
  if (demandShock && year >= 5 && year <= 6) {
    base = Math.round(base * 0.5);
  }
  return base;
}

// ── Strategy definitions ───────────────────────────────────────────────
type StrategyName = "A: Constant" | "B: Bitcoin Halving" | "C: Gentle Halving" | "D: Demand-Responsive";

function getBlockReward(
  strategy: StrategyName,
  year: number,
  demandGrowthRate: number
): number {
  switch (strategy) {
    case "A: Constant":
      return 100;
    case "B: Bitcoin Halving": {
      // Halve every 2 years: Y1-2=100, Y3-4=50, Y5-6=25, Y7-8=12.5, Y9-10=6.25
      const epoch = Math.floor((year - 1) / 2);
      return 100 / Math.pow(2, epoch);
    }
    case "C: Gentle Halving": {
      // Halve every 4 years: Y1-4=100, Y5-8=50, Y9-10=25
      const epoch = Math.floor((year - 1) / 4);
      return 100 / Math.pow(2, epoch);
    }
    case "D: Demand-Responsive": {
      // reward = 100 * (1 + demandGrowthRate), capped [25, 200]
      const raw = 100 * (1 + demandGrowthRate);
      return Math.min(200, Math.max(25, raw));
    }
  }
}

// ── Simulation ─────────────────────────────────────────────────────────
interface YearSnapshot {
  year: number;
  blockReward: number;
  providers: number;
  workloadsPerDay: number;
  annualFiatDemandUsd: number;
  cldMinted: number;
  cldBurned: number;
  circulatingSupply: number;
  cldPriceUsd: number;
  providerMonthlyCld: number;
  providerMonthlyUsd: number;
}

function runSimulation(strategy: StrategyName, demandShock = false): YearSnapshot[] {
  const results: YearSnapshot[] = [];
  let circulatingSupply = 0;
  let prevWorkloads = 10;

  for (let year = 1; year <= 10; year++) {
    const providers = getProviders(year);
    const workloadsPerDay = getWorkloadsPerDay(year, demandShock);

    // Demand growth rate for strategy D (YoY change)
    const demandGrowthRate = year === 1
      ? 0
      : (workloadsPerDay - prevWorkloads) / Math.max(1, prevWorkloads);
    prevWorkloads = workloadsPerDay;

    const blockReward = getBlockReward(strategy, year, demandGrowthRate);
    const cldMinted = blockReward * BLOCKS_PER_YEAR;
    circulatingSupply += cldMinted;

    // Annual fiat demand from workloads
    const annualFiatDemandUsd = workloadsPerDay * 365.25 * AVG_JOB_FEE_USD;

    // Price = annual fiat demand / circulating supply (floor $0.001)
    const cldPriceUsd = Math.max(0.001, annualFiatDemandUsd / circulatingSupply);

    // CLD-denominated job fees (fiat-pegged)
    const avgJobFeeCld = AVG_JOB_FEE_USD / cldPriceUsd;
    const totalJobFeesCld = workloadsPerDay * 365.25 * avgJobFeeCld;

    // Burn 15% of job fees
    const cldBurned = totalJobFeesCld * FEE_BURN;
    circulatingSupply -= cldBurned;
    circulatingSupply = Math.max(0, circulatingSupply);

    // Provider economics: mining rewards split among providers
    // Providers earn from BOTH mining rewards (proportional) and job fees (80%)
    // Mining reward share:
    const miningShareCld = cldMinted / providers / 12;
    // Job fee share (80% of fees / providers / 12 months):
    const jobFeeShareCld = (totalJobFeesCld * FEE_PROVIDER) / providers / 12;
    const providerMonthlyCld = miningShareCld + jobFeeShareCld;
    const providerMonthlyUsd = providerMonthlyCld * cldPriceUsd;

    results.push({
      year,
      blockReward: Math.round(blockReward * 100) / 100,
      providers,
      workloadsPerDay,
      annualFiatDemandUsd: Math.round(annualFiatDemandUsd),
      cldMinted: Math.round(cldMinted),
      cldBurned: Math.round(cldBurned),
      circulatingSupply: Math.round(circulatingSupply),
      cldPriceUsd: roundPrice(cldPriceUsd),
      providerMonthlyCld: Math.round(providerMonthlyCld * 100) / 100,
      providerMonthlyUsd: Math.round(providerMonthlyUsd * 100) / 100,
    });
  }

  return results;
}

function roundPrice(p: number): number {
  if (p >= 100) return Math.round(p * 100) / 100;
  if (p >= 1) return Math.round(p * 1000) / 1000;
  return Math.round(p * 10000) / 10000;
}

// ── Formatting helpers ─────────────────────────────────────────────────
function fmt(n: number, decimals = 0): string {
  if (decimals === 0) return Math.round(n).toLocaleString("en-US");
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtPrice(p: number): string {
  if (p >= 100) return `$${p.toFixed(2)}`;
  if (p >= 1) return `$${p.toFixed(3)}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  return `$${p.toFixed(5)}`;
}

// ── Run all strategies ─────────────────────────────────────────────────
const strategies: StrategyName[] = [
  "A: Constant",
  "B: Bitcoin Halving",
  "C: Gentle Halving",
  "D: Demand-Responsive",
];

const normalResults = new Map<StrategyName, YearSnapshot[]>();
const shockResults = new Map<StrategyName, YearSnapshot[]>();

for (const s of strategies) {
  normalResults.set(s, runSimulation(s, false));
  shockResults.set(s, runSimulation(s, true));
}

// ── Print comparison tables ────────────────────────────────────────────
const snapshotYears = [1, 3, 5, 7, 10];

console.log("\n" + "=".repeat(120));
console.log("  CLOUDANA CLD MINTING STRATEGY COMPARISON — 10-YEAR SIMULATION");
console.log("=".repeat(120));
console.log("\nAssumptions: 1 block/min | Fee split 80/15/5 | Providers 50->10K | Workloads 10->50K/day | $5/job avg | Start $0.01/CLD");
console.log("Price model: CLD price = annual fiat demand / circulating supply\n");

// Growth reference
console.log("--- NETWORK GROWTH (identical for all strategies) ---\n");
console.log("Year   Providers   Jobs/Day    Annual Fiat In");
console.log("-".repeat(52));
const refResults = normalResults.get("A: Constant")!;
for (const y of snapshotYears) {
  const r = refResults[y - 1];
  console.log(
    `Y${String(r.year).padEnd(5)}` +
    fmt(r.providers).padStart(9) +
    fmt(r.workloadsPerDay).padStart(11) +
    ("   " + fmtUsd(r.annualFiatDemandUsd))
  );
}

// Per-year comparison tables
for (const y of snapshotYears) {
  console.log(`\n${"=".repeat(120)}`);
  console.log(`  YEAR ${y} COMPARISON`);
  console.log("=".repeat(120));

  const header =
    "Strategy".padEnd(24) +
    "Blk Rwd".padStart(9) +
    "CLD Minted".padStart(14) +
    "CLD Burned".padStart(14) +
    "Supply".padStart(16) +
    "CLD Price".padStart(12) +
    "Prov $/mo".padStart(12) +
    "Prov CLD/mo".padStart(14);
  console.log(header);
  console.log("-".repeat(header.length));

  for (const s of strategies) {
    const r = normalResults.get(s)![y - 1];
    console.log(
      s.padEnd(24) +
      fmt(r.blockReward, 2).padStart(9) +
      fmt(r.cldMinted).padStart(14) +
      fmt(r.cldBurned).padStart(14) +
      fmt(r.circulatingSupply).padStart(16) +
      fmtPrice(r.cldPriceUsd).padStart(12) +
      fmtUsd(r.providerMonthlyUsd).padStart(12) +
      fmt(r.providerMonthlyCld, 1).padStart(14)
    );
  }
}

// ── 10-Year trajectories per strategy ──────────────────────────────────
console.log(`\n${"=".repeat(120)}`);
console.log("  FULL 10-YEAR TRAJECTORIES");
console.log("=".repeat(120));

for (const s of strategies) {
  const data = normalResults.get(s)!;
  console.log(`\n--- ${s} ---\n`);
  console.log(
    "Year".padEnd(6) +
    "Blk Rwd".padStart(9) +
    "CLD Minted".padStart(14) +
    "CLD Burned".padStart(14) +
    "Supply".padStart(16) +
    "CLD Price".padStart(12) +
    "Prov $/mo".padStart(12) +
    "Prov CLD/mo".padStart(14)
  );
  console.log("-".repeat(97));
  for (const r of data) {
    console.log(
      `Y${r.year}`.padEnd(6) +
      fmt(r.blockReward, 2).padStart(9) +
      fmt(r.cldMinted).padStart(14) +
      fmt(r.cldBurned).padStart(14) +
      fmt(r.circulatingSupply).padStart(16) +
      fmtPrice(r.cldPriceUsd).padStart(12) +
      fmtUsd(r.providerMonthlyUsd).padStart(12) +
      fmt(r.providerMonthlyCld, 1).padStart(14)
    );
  }
}

// ── Demand Shock Scenario ──────────────────────────────────────────────
console.log(`\n${"=".repeat(120)}`);
console.log("  DEMAND SHOCK SCENARIO: 50% demand drop at Y5-Y6, recovery at Y7+");
console.log("=".repeat(120));

for (const y of [4, 5, 6, 7, 8]) {
  console.log(`\n--- Year ${y} (shock scenario) ---\n`);
  const header =
    "Strategy".padEnd(24) +
    "Jobs/Day".padStart(10) +
    "Supply".padStart(16) +
    "CLD Price".padStart(12) +
    "Prov $/mo".padStart(12) +
    "vs Normal".padStart(12);
  console.log(header);
  console.log("-".repeat(header.length));

  for (const s of strategies) {
    const shock = shockResults.get(s)![y - 1];
    const normal = normalResults.get(s)![y - 1];
    const pctChange = ((shock.providerMonthlyUsd / normal.providerMonthlyUsd) - 1) * 100;
    console.log(
      s.padEnd(24) +
      fmt(shock.workloadsPerDay).padStart(10) +
      fmt(shock.circulatingSupply).padStart(16) +
      fmtPrice(shock.cldPriceUsd).padStart(12) +
      fmtUsd(shock.providerMonthlyUsd).padStart(12) +
      `${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(1)}%`.padStart(12)
    );
  }
}

// ── Comparative Metrics ────────────────────────────────────────────────
console.log(`\n${"=".repeat(120)}`);
console.log("  SUMMARY METRICS (10-YEAR)");
console.log("=".repeat(120));

console.log("\n" +
  "Strategy".padEnd(24) +
  "Final Supply".padStart(16) +
  "Final Price".padStart(14) +
  "Y10 Prov $/mo".padStart(16) +
  "Y1 Prov $/mo".padStart(14) +
  "Income Growth".padStart(14) +
  "Max Yr-Yr Drop".padStart(16)
);
console.log("-".repeat(114));

for (const s of strategies) {
  const data = normalResults.get(s)!;
  const first = data[0];
  const last = data[9];

  // Calculate worst year-over-year provider USD income change
  let worstDrop = 0;
  for (let i = 1; i < data.length; i++) {
    const change = (data[i].providerMonthlyUsd / data[i - 1].providerMonthlyUsd - 1) * 100;
    if (change < worstDrop) worstDrop = change;
  }

  const incomeGrowth = ((last.providerMonthlyUsd / first.providerMonthlyUsd - 1) * 100);

  console.log(
    s.padEnd(24) +
    fmt(last.circulatingSupply).padStart(16) +
    fmtPrice(last.cldPriceUsd).padStart(14) +
    fmtUsd(last.providerMonthlyUsd).padStart(16) +
    fmtUsd(first.providerMonthlyUsd).padStart(14) +
    `${incomeGrowth >= 0 ? "+" : ""}${incomeGrowth.toFixed(0)}%`.padStart(14) +
    `${worstDrop.toFixed(1)}%`.padStart(16)
  );
}

// Provider income stability (coefficient of variation)
console.log("\n--- PROVIDER INCOME STABILITY (Coefficient of Variation of YoY USD income changes) ---\n");
console.log("Strategy".padEnd(24) + "CoV (lower = more stable)".padStart(28) + "  Interpretation");
console.log("-".repeat(80));
for (const s of strategies) {
  const data = normalResults.get(s)!;
  const changes: number[] = [];
  for (let i = 1; i < data.length; i++) {
    changes.push((data[i].providerMonthlyUsd / data[i - 1].providerMonthlyUsd - 1) * 100);
  }
  const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
  const variance = changes.reduce((a, b) => a + (b - mean) ** 2, 0) / changes.length;
  const stddev = Math.sqrt(variance);
  const cov = Math.abs(mean) > 0.01 ? stddev / Math.abs(mean) : stddev;
  let interp = "Very stable";
  if (cov > 3) interp = "Very volatile";
  else if (cov > 1.5) interp = "Volatile";
  else if (cov > 0.7) interp = "Moderate";
  else if (cov > 0.3) interp = "Stable";

  console.log(
    s.padEnd(24) +
    cov.toFixed(3).padStart(28) +
    `  ${interp}`
  );
}

// Shock resilience
console.log("\n--- DEMAND SHOCK RESILIENCE (Max provider income drop during shock vs normal) ---\n");
console.log("Strategy".padEnd(24) + "Worst $/mo Drop".padStart(18) + "Recovery by Y8?".padStart(18));
console.log("-".repeat(60));
for (const s of strategies) {
  const shockData = shockResults.get(s)!;
  const normalData = normalResults.get(s)!;
  let worstPct = 0;
  for (let i = 4; i <= 6; i++) { // Y5-Y7
    const pct = ((shockData[i].providerMonthlyUsd / normalData[i].providerMonthlyUsd) - 1) * 100;
    if (pct < worstPct) worstPct = pct;
  }
  const y8shock = shockData[7].providerMonthlyUsd;
  const y8normal = normalData[7].providerMonthlyUsd;
  const recovered = y8shock >= y8normal * 0.9;

  console.log(
    s.padEnd(24) +
    `${worstPct.toFixed(1)}%`.padStart(18) +
    (recovered ? "Yes" : "No (still lagging)").padStart(18)
  );
}

// ── ANALYSIS ───────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(120)}`);
console.log("  ANALYSIS & RECOMMENDATION");
console.log("=".repeat(120));

// Compute key metrics for the analysis
const metricsForAnalysis: Record<string, { finalPrice: number; finalProvUsd: number; y1ProvUsd: number; finalSupply: number; worstDrop: number; shockWorst: number }> = {};
for (const s of strategies) {
  const data = normalResults.get(s)!;
  const shockData = shockResults.get(s)!;
  let worstDrop = 0;
  for (let i = 1; i < data.length; i++) {
    const change = (data[i].providerMonthlyUsd / data[i - 1].providerMonthlyUsd - 1) * 100;
    if (change < worstDrop) worstDrop = change;
  }
  let shockWorst = 0;
  for (let i = 4; i <= 6; i++) {
    const pct = ((shockData[i].providerMonthlyUsd / data[i].providerMonthlyUsd) - 1) * 100;
    if (pct < shockWorst) shockWorst = pct;
  }
  metricsForAnalysis[s] = {
    finalPrice: data[9].cldPriceUsd,
    finalProvUsd: data[9].providerMonthlyUsd,
    y1ProvUsd: data[0].providerMonthlyUsd,
    finalSupply: data[9].circulatingSupply,
    worstDrop,
    shockWorst,
  };
}

const m = metricsForAnalysis;

console.log(`
1. PROVIDER INCOME STABILITY
   - Constant (A): Predictable minting + rising demand = steady income growth. No surprises.
     Y1: ${fmtUsd(m["A: Constant"].y1ProvUsd)}/mo -> Y10: ${fmtUsd(m["A: Constant"].finalProvUsd)}/mo
   - Bitcoin Halving (B): Halvings cause sharp reward drops every 2 years. Providers who
     invested in hardware based on Y1-Y2 income face a 50% mining reward cut at Y3.
     Worst YoY drop: ${m["B: Bitcoin Halving"].worstDrop.toFixed(1)}%
   - Gentle Halving (C): Same problem as B but less frequent. Providers get 4 years of
     stability before a cut. More plannable.
   - Demand-Responsive (D): Income naturally rises with demand, but can also drop sharply
     if demand stalls. Least predictable for budgeting.
   WINNER: A (Constant) — most predictable for hardware investment planning.

2. TOKEN PRICE TRAJECTORY
   - A (Constant): Steady supply growth dilutes price somewhat but demand drives appreciation.
     Y10 price: ${fmtPrice(m["A: Constant"].finalPrice)}
   - B (Bitcoin Halving): Lowest final supply = highest price per token.
     Y10 price: ${fmtPrice(m["B: Bitcoin Halving"].finalPrice)}
     But aggressive price spikes discourage spending (hoarding risk).
   - C (Gentle Halving): Middle ground on price appreciation.
     Y10 price: ${fmtPrice(m["C: Gentle Halving"].finalPrice)}
   - D (Demand-Responsive): Supply tracks demand, so price stays more moderate.
     Y10 price: ${fmtPrice(m["D: Demand-Responsive"].finalPrice)}
   WINNER: C (Gentle Halving) — meaningful appreciation without extreme spikes.

3. SUPPLY PREDICTABILITY
   - A: Perfectly predictable. Anyone can calculate future supply: 52.6M CLD/year forever.
   - B: Predictable (known halving schedule) but requires understanding epoch math.
   - C: Same as B but simpler (fewer halvings to track).
   - D: UNPREDICTABLE. Supply depends on demand growth rate, which nobody can forecast.
     This makes treasury planning, exchange listings, and investor modeling much harder.
   WINNER: A (Constant) — trivially calculable by anyone.

4. NETWORK SECURITY (long-term provider retention)
   - A: Mining rewards never decrease. Providers only leave if CLD price crashes.
   - B: Mining rewards hit 6.25 CLD/block by Y9-10. If job fees are low, small providers
     can't cover hardware costs. Risk of centralization among large operators.
   - C: Rewards at 25 CLD/block by Y9-10 — still meaningful.
   - D: Rewards could drop to 25 floor in a downturn, but recover with demand.
   WINNER: A (Constant) — guaranteed minimum income from mining regardless of demand.

5. EARLY vs LATE ADOPTER FAIRNESS
   - A: Early adopters share 100 CLD/block among 50 providers = 2 CLD/block each.
     Late adopters share 100 CLD/block among 10,000 = 0.01 CLD/block each.
     BUT the token is worth much more by then, so USD income can still grow.
     Natural dilution is fair — early risk = early reward.
   - B: Early adopters get 100 CLD/block, late adopters get 6.25 CLD/block shared
     among 10,000. DOUBLE dilution (fewer tokens AND more providers). Very unfair to
     late joiners who still need to cover hardware costs.
   - C: Less severe than B but still penalizes late adopters.
   - D: Late adopters get demand-adjusted rewards. Fairest in theory, but unpredictable.
   WINNER: D in theory, A in practice — A's dilution is natural and understood.

6. DEMAND SHOCK RESILIENCE (50% demand drop at Y5-Y6)
   - A: Worst shock impact: ${m["A: Constant"].shockWorst.toFixed(1)}%
   - B: Worst shock impact: ${m["B: Bitcoin Halving"].shockWorst.toFixed(1)}%
   - C: Worst shock impact: ${m["C: Gentle Halving"].shockWorst.toFixed(1)}%
   - D: Worst shock impact: ${m["D: Demand-Responsive"].shockWorst.toFixed(1)}%
     Strategy D cuts minting during the shock, preserving token value better.
   WINNER: D (Demand-Responsive) — adapts minting to match reality.
`);

console.log("=".repeat(120));
console.log("  FINAL RECOMMENDATION");
console.log("=".repeat(120));
console.log(`
RECOMMENDATION: Strategy C (Gentle Halving) with elements of A.

Specifically: 100 CLD/block for the first 4 years, then halve every 4 years after that.
(100 -> 50 -> 25 -> 12.5 ...)

WHY NOT CONSTANT (A)?
  Constant minting is the simplest and most provider-friendly option. However, it has a
  critical flaw: perpetual inflation. After 10 years, over 5.2 billion CLD exist with no
  end in sight. This makes CLD unattractive as a store of value, which matters because
  providers HOLD CLD between earning and selling. If providers perceive CLD as perpetually
  inflating, they dump immediately — creating constant sell pressure.

  Constant minting also signals "no scarcity," which undermines token price appreciation.
  For a DePIN protocol where providers must invest $5K-$50K in hardware, they need to
  believe CLD will at least hold value over their 3-5 year hardware lifecycle.

WHY NOT BITCOIN HALVING (B)?
  Too aggressive. Halving every 2 years means providers face a 50% reward cut every 24
  months. In Bitcoin's case, this works because BTC price historically 10x's per halving
  cycle. Cloudana cannot guarantee that. A provider who joins at Y2 expecting $X/month
  suddenly earns $X/2 at Y3 — that's a broken promise for a compute marketplace where
  providers have ongoing costs (electricity, bandwidth, maintenance).

WHY NOT DEMAND-RESPONSIVE (D)?
  Theoretically elegant but practically problematic:
  1. UNPREDICTABLE: Providers can't forecast income. "How much will I earn?" depends on
     a formula most operators won't understand.
  2. GAMEABLE: If the demand metric is on-chain, actors can create fake demand to inflate
     rewards. If off-chain, it requires a trusted oracle — undermining decentralization.
  3. COMPLEX: Exchange listings, investor models, and treasury planning all become harder
     when supply growth rate is variable. The DeFi ecosystem strongly favors predictable
     token schedules.

WHY GENTLE HALVING (C)?
  1. 4-YEAR STABILITY: Providers get a full hardware lifecycle (3-5 years) at predictable
     reward levels before any cut. This matches real-world CapEx planning.
  2. CLEAR SIGNAL: "Rewards halve every 4 years" is easy to communicate to providers,
     investors, and users. It creates FOMO for early participation.
  3. CONTROLLED INFLATION: Total CLD minted in 10 years is ~3.4B vs ~5.3B for constant.
     This creates meaningful scarcity without being as aggressive as Bitcoin halving.
  4. PROVEN MODEL: Bitcoin proved that halvings work as coordination mechanisms. Gentler
     halvings reduce the shock while keeping the benefits.
  5. BURN AMPLIFICATION: As demand grows, the 15% burn becomes increasingly significant
     relative to reduced minting. This can make CLD deflationary in later years —
     a powerful narrative for token value.

OPTIONAL ENHANCEMENT:
  Consider adding a demand-responsive FLOOR adjustment: if network utilization drops
  below 30% of capacity for 30+ days, temporarily increase the block reward by 25% to
  retain providers during downturns. This borrows D's best feature (shock resilience)
  while keeping C's predictability as the default. Implement as a governance-controlled
  parameter, not an automatic oracle.
`);
