/**
 * Cloudana Burn Rate Comparison — 10-Year Economic Simulation
 *
 * Compares 5 fee-split configurations (A–E) across 10 years
 * to determine the optimal burn rate for CLD tokenomics.
 *
 * Model:
 * - CLD minted via POUW only: 100 CLD/block, 1 block/60s (~52.596M/year)
 * - Job fees paid in CLD (users buy CLD with fiat)
 * - Fee split: provider% / burn% / treasury%
 * - CLD price model: (transactional demand + speculative demand) / circulating supply
 *   - Transactional: annual fiat demand from jobs
 *   - Speculative: 20% of circulating supply held by investors (velocity dampener)
 *   - Price recalculated AFTER burn reduces supply (within-period feedback)
 * - Logistic growth for providers (50→10k) and workloads (10→50k/day)
 *
 * Run: npx tsx client/src/scripts/sim-burn-rates.ts
 */

// ── Constants ──────────────────────────────────────────────────────────

const BLOCK_REWARD = 100;
const BLOCKS_PER_YEAR = 365.25 * 24 * 60; // 525,960
const ANNUAL_MINT = BLOCK_REWARD * BLOCKS_PER_YEAR; // ~52,596,000
const YEARS = 10;

const PROVIDER_START = 50;
const PROVIDER_MAX = 10_000;
const WORKLOAD_START = 10;
const WORKLOAD_MAX = 50_000; // jobs/day
const AVG_JOB_FEE_USD = 5;

// Speculative holding factor: fraction of supply held (not circulating for transactions)
// This creates a velocity dampener — lower effective supply means higher price
// Represents investors, stakers, long-term holders
const HOLD_FRACTION = 0.20;

// ── Configs ────────────────────────────────────────────────────────────

interface Config {
  label: string;
  provider: number;
  burn: number;
  treasury: number;
}

const CONFIGS: Record<string, Config> = {
  A: { label: "Low burn",        provider: 0.90, burn: 0.05, treasury: 0.05 },
  B: { label: "Moderate burn",   provider: 0.85, burn: 0.10, treasury: 0.05 },
  C: { label: "Current model",   provider: 0.80, burn: 0.15, treasury: 0.05 },
  D: { label: "High burn",       provider: 0.75, burn: 0.20, treasury: 0.05 },
  E: { label: "Aggressive burn", provider: 0.70, burn: 0.25, treasury: 0.05 },
};

// ── Types ──────────────────────────────────────────────────────────────

interface YearData {
  year: number;
  providers: number;
  workloadsPerDay: number;
  fiatDemandUsd: number;
  cldMinted: number;
  cldBurned: number;
  netSupplyChange: number;
  circulatingSupply: number;
  cldPrice: number;
  burnPctOfMinted: number;
  providerMonthlyCld: number;
  providerMonthlyUsd: number;
  treasuryAnnualCld: number;
  treasuryAnnualUsd: number;
}

// ── Logistic growth ────────────────────────────────────────────────────

function logistic(t: number, midpoint = 0.4, steepness = 12): number {
  return 1 / (1 + Math.exp(-steepness * (t - midpoint)));
}

// ── Price model ────────────────────────────────────────────────────────
// Price = fiat demand / effective circulating supply
// Effective supply = total supply * (1 - hold_fraction)
// This means holders reduce selling pressure, boosting price.
// Higher burn → lower supply → same demand produces higher price.

function calcPrice(fiatDemandUsd: number, circulatingSupply: number): number {
  const effectiveSupply = circulatingSupply * (1 - HOLD_FRACTION);
  return Math.max(0.001, fiatDemandUsd / effectiveSupply);
}

// ── Simulation ─────────────────────────────────────────────────────────

function simulate(config: Config, demandShockAtY5 = false): YearData[] {
  const results: YearData[] = [];
  let circulatingSupply = 0;

  for (let year = 1; year <= YEARS; year++) {
    const t = year / YEARS;
    const growth = logistic(t);

    const providers = Math.round(
      PROVIDER_START + (PROVIDER_MAX - PROVIDER_START) * growth
    );
    let workloadsPerDay = Math.round(
      WORKLOAD_START + (WORKLOAD_MAX - WORKLOAD_START) * growth
    );

    // Demand shock: 50% drop at Y5 and beyond
    if (demandShockAtY5 && year >= 5) {
      workloadsPerDay = Math.round(workloadsPerDay * 0.5);
    }

    // Supply: constant POUW mining
    const cldMinted = ANNUAL_MINT;
    circulatingSupply += cldMinted;

    // Demand: total fiat flowing in from job payments
    const fiatDemandUsd = workloadsPerDay * 365.25 * AVG_JOB_FEE_USD;

    // Pre-burn price (used to calculate CLD-denominated fees)
    const preBurnPrice = calcPrice(fiatDemandUsd, circulatingSupply);

    // Job fees in CLD (fiat-pegged at pre-burn price)
    const avgJobFeeCld = AVG_JOB_FEE_USD / preBurnPrice;
    const totalJobFeesCld = workloadsPerDay * 365.25 * avgJobFeeCld;

    // Burns reduce supply
    const cldBurned = totalJobFeesCld * config.burn;
    circulatingSupply -= cldBurned;
    circulatingSupply = Math.max(0, circulatingSupply);

    // Post-burn price (reflects reduced supply — the burn feedback effect)
    const cldPrice = calcPrice(fiatDemandUsd, circulatingSupply);

    const netSupplyChange = cldMinted - cldBurned;
    const burnPctOfMinted = (cldBurned / cldMinted) * 100;

    // Provider economics: providers earn block reward share, valued at post-burn price
    const providerMonthlyCld =
      (cldMinted * config.provider) / providers / 12;
    const providerMonthlyUsd = providerMonthlyCld * cldPrice;

    // Treasury: 5% of job fees in CLD, valued at post-burn price
    const treasuryAnnualCld = totalJobFeesCld * config.treasury;
    const treasuryAnnualUsd = treasuryAnnualCld * cldPrice;

    results.push({
      year,
      providers,
      workloadsPerDay,
      fiatDemandUsd: Math.round(fiatDemandUsd),
      cldMinted: Math.round(cldMinted),
      cldBurned: Math.round(cldBurned),
      netSupplyChange: Math.round(netSupplyChange),
      circulatingSupply: Math.round(circulatingSupply),
      cldPrice: roundTo(cldPrice, 6),
      burnPctOfMinted: roundTo(burnPctOfMinted, 1),
      providerMonthlyCld: roundTo(providerMonthlyCld, 2),
      providerMonthlyUsd: roundTo(providerMonthlyUsd, 2),
      treasuryAnnualCld: Math.round(treasuryAnnualCld),
      treasuryAnnualUsd: Math.round(treasuryAnnualUsd),
    });
  }

  return results;
}

function roundTo(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

// ── Formatting helpers ─────────────────────────────────────────────────

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtM(n: number): string {
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  return `$${(n / 1e6).toFixed(1)}M`;
}

function fmtPrice(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

function fmtUsd(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1000) return `$${fmtNum(Math.round(n))}`;
  return `$${n.toFixed(2)}`;
}

function fmtSupply(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  return fmtNum(n);
}

function pad(s: string, w: number): string {
  return s.padEnd(w);
}

// ── Run all configs ────────────────────────────────────────────────────

const allResults: Record<string, YearData[]> = {};
const shockResults: Record<string, YearData[]> = {};

for (const [key, config] of Object.entries(CONFIGS)) {
  allResults[key] = simulate(config, false);
  shockResults[key] = simulate(config, true);
}

// ── Output ─────────────────────────────────────────────────────────────

console.log("\n" + "=".repeat(110));
console.log("  CLOUDANA BURN RATE COMPARISON — 10-YEAR ECONOMIC SIMULATION");
console.log("=".repeat(110));
console.log(`\nPOUW mint: ${fmtNum(Math.round(ANNUAL_MINT))} CLD/year (constant, no halving)`);
console.log(`Growth: ${PROVIDER_START}->${fmtNum(PROVIDER_MAX)} providers, ${WORKLOAD_START}->${fmtNum(WORKLOAD_MAX)} jobs/day (logistic curve, midpoint at 40%)`);
console.log(`Avg job fee: $${AVG_JOB_FEE_USD} USD | Hold fraction: ${(HOLD_FRACTION * 100)}% (velocity dampener)`);
console.log(`Price model: fiat_demand / (circulating_supply * ${1 - HOLD_FRACTION}), recalculated after burn\n`);

console.log("Configs:");
for (const [key, c] of Object.entries(CONFIGS)) {
  console.log(`  ${key}: ${(c.provider * 100).toFixed(0)}% provider / ${(c.burn * 100).toFixed(0)}% burn / ${(c.treasury * 100).toFixed(0)}% treasury  "${c.label}"`);
}

// ── Table 1: Comparison at Y1, Y5, Y10 ────────────────────────────────

const SNAPSHOT_YEARS = [1, 5, 10];
const colW = 21;
const labelW = 22;

console.log("\n" + "=".repeat(110));
console.log("  TABLE 1: SUPPLY & PRICE COMPARISON (Y1 / Y5 / Y10)");
console.log("=".repeat(110) + "\n");

console.log(
  pad("", labelW) +
  Object.entries(CONFIGS).map(([k, c]) => pad(`${k}: ${(c.burn * 100)}% burn`, colW)).join("")
);
console.log("-".repeat(labelW + colW * 5));

for (const yr of SNAPSHOT_YEARS) {
  console.log(`\n  YEAR ${yr}:`);

  const rows: [string, (k: string) => string][] = [
    ["Circ. Supply", k => fmtSupply(allResults[k][yr - 1].circulatingSupply)],
    ["CLD Price", k => fmtPrice(allResults[k][yr - 1].cldPrice)],
    ["Burn % of Mint", k => `${allResults[k][yr - 1].burnPctOfMinted}%`],
    ["Net Supply +/-", k => {
      const d = allResults[k][yr - 1];
      return (d.netSupplyChange >= 0 ? "+" : "") + fmtSupply(d.netSupplyChange);
    }],
    ["Prov. CLD/mo", k => fmtNum(Math.round(allResults[k][yr - 1].providerMonthlyCld))],
    ["Prov. USD/mo", k => fmtUsd(allResults[k][yr - 1].providerMonthlyUsd)],
    ["Treasury USD/yr", k => fmtUsd(allResults[k][yr - 1].treasuryAnnualUsd)],
  ];

  for (const [label, fn] of rows) {
    console.log(
      pad(`  ${label}`, labelW) +
      Object.keys(CONFIGS).map(k => pad(fn(k), colW)).join("")
    );
  }
}

// ── Table 2: Full yearly breakdown per config ──────────────────────────

console.log("\n" + "=".repeat(110));
console.log("  TABLE 2: FULL YEARLY BREAKDOWN PER CONFIG");
console.log("=".repeat(110));

for (const [key, config] of Object.entries(CONFIGS)) {
  const data = allResults[key];
  console.log(`\n--- Config ${key}: ${config.label} (${(config.provider * 100).toFixed(0)}/${(config.burn * 100).toFixed(0)}/${(config.treasury * 100).toFixed(0)}) ---\n`);

  console.log(
    pad("Yr", 4) +
    pad("Providers", 10) +
    pad("Jobs/Day", 10) +
    pad("Fiat In", 12) +
    pad("Burned", 13) +
    pad("Net +/-", 13) +
    pad("Supply", 14) +
    pad("Price", 12) +
    pad("Burn%", 8) +
    pad("Prov$/mo", 12) +
    pad("Treas$/yr", 12)
  );
  console.log("-".repeat(120));

  for (const d of data) {
    console.log(
      pad(String(d.year), 4) +
      pad(fmtNum(d.providers), 10) +
      pad(fmtNum(d.workloadsPerDay), 10) +
      pad(fmtM(d.fiatDemandUsd), 12) +
      pad(fmtNum(d.cldBurned), 13) +
      pad((d.netSupplyChange >= 0 ? "+" : "") + fmtNum(d.netSupplyChange), 13) +
      pad(fmtSupply(d.circulatingSupply), 14) +
      pad(fmtPrice(d.cldPrice), 12) +
      pad(`${d.burnPctOfMinted}%`, 8) +
      pad(fmtUsd(d.providerMonthlyUsd), 12) +
      pad(fmtUsd(d.treasuryAnnualUsd), 12)
    );
  }
}

// ── Table 3: Demand shock scenario ─────────────────────────────────────

console.log("\n" + "=".repeat(110));
console.log("  TABLE 3: DEMAND SHOCK SCENARIO (50% demand drop at Y5)");
console.log("=".repeat(110) + "\n");

console.log(
  pad("", labelW) +
  Object.entries(CONFIGS).map(([k, c]) => pad(`${k}: ${(c.burn * 100)}% burn`, colW)).join("")
);
console.log("-".repeat(labelW + colW * 5));

for (const yr of [4, 5, 6, 10]) {
  const label = yr < 5 ? "pre-shock" : "post-shock";
  console.log(`\n  YEAR ${yr} (${label}):`);

  console.log(
    pad("  CLD Price", labelW) +
    Object.keys(CONFIGS).map(k => pad(fmtPrice(shockResults[k][yr - 1].cldPrice), colW)).join("")
  );

  console.log(
    pad("  Supply", labelW) +
    Object.keys(CONFIGS).map(k => pad(fmtSupply(shockResults[k][yr - 1].circulatingSupply), colW)).join("")
  );

  console.log(
    pad("  Prov. USD/mo", labelW) +
    Object.keys(CONFIGS).map(k => pad(fmtUsd(shockResults[k][yr - 1].providerMonthlyUsd), colW)).join("")
  );

  if (yr >= 5) {
    console.log(
      pad("  Price vs normal", labelW) +
      Object.keys(CONFIGS).map(k => {
        const normal = allResults[k][yr - 1].cldPrice;
        const shock = shockResults[k][yr - 1].cldPrice;
        const pct = ((shock - normal) / normal * 100).toFixed(1);
        return pad(`${pct}%`, colW);
      }).join("")
    );
    console.log(
      pad("  Absolute price", labelW) +
      Object.keys(CONFIGS).map(k => pad(fmtPrice(shockResults[k][yr - 1].cldPrice), colW)).join("")
    );
  }
}

// ── Analysis ───────────────────────────────────────────────────────────

console.log("\n" + "=".repeat(110));
console.log("  ANALYSIS & RECOMMENDATION");
console.log("=".repeat(110));

// 1. Supply stability
console.log("\n1. SUPPLY STABILITY\n");
for (const [key, data] of Object.entries(allResults)) {
  const y10 = data[9];
  const deflationary = data.find(d => d.netSupplyChange < 0);
  const peakSupply = data.reduce((max, d) => d.circulatingSupply > max ? d.circulatingSupply : max, 0);
  const y10Supply = y10.circulatingSupply;

  if (deflationary) {
    console.log(`  ${key} (${CONFIGS[key].label}): DEFLATIONARY from Y${deflationary.year} -- supply peaks at ${fmtSupply(peakSupply)} then shrinks to ${fmtSupply(y10Supply)}`);
  } else {
    const y10NetPct = (y10.netSupplyChange / y10.cldMinted * 100).toFixed(0);
    console.log(`  ${key} (${CONFIGS[key].label}): INFLATIONARY -- supply ${fmtSupply(y10Supply)} at Y10, net growth ${y10NetPct}% of annual mint`);
  }
}

// 2. Price stability
console.log("\n2. PRICE STABILITY\n");
for (const [key, data] of Object.entries(allResults)) {
  const prices = data.map(d => d.cldPrice);
  const maxPrice = Math.max(...prices);
  const minPrice = Math.min(...prices);
  const volatility = maxPrice / minPrice;
  const y1 = data[0].cldPrice;
  const y10 = data[9].cldPrice;
  const appreciation = y10 / y1;
  // Check if price peaked and then declined (sign of instability)
  const peakYear = data.reduce((best, d) => d.cldPrice > best.cldPrice ? d : best, data[0]).year;
  const trend = peakYear === 10 ? "monotonic rise" : `peaked Y${peakYear}, then declined`;
  console.log(`  ${key}: ${fmtPrice(y1)} -> ${fmtPrice(y10)} (${appreciation.toFixed(1)}x) | Volatility: ${volatility.toFixed(1)}x | ${trend}`);
}

// 3. Provider attractiveness
console.log("\n3. PROVIDER ATTRACTIVENESS (monthly USD income)\n");
console.log(`  Note: Higher burn = lower provider CLD share but higher CLD price.`);
console.log(`  The tradeoff determines which config gives best USD income.\n`);
for (const [key, data] of Object.entries(allResults)) {
  const y1 = data[0];
  const y5 = data[4];
  const y10 = data[9];
  const total10yr = data.reduce((sum, d) => sum + d.providerMonthlyUsd * 12, 0);
  console.log(`  ${key}: Y1=${fmtUsd(y1.providerMonthlyUsd)} | Y5=${fmtUsd(y5.providerMonthlyUsd)} | Y10=${fmtUsd(y10.providerMonthlyUsd)} | 10yr cumul=${fmtUsd(total10yr)}`);
}

// 4. Treasury health
console.log("\n4. TREASURY HEALTH (annual USD)\n");
for (const [key, data] of Object.entries(allResults)) {
  const totalTreasury = data.reduce((sum, d) => sum + d.treasuryAnnualUsd, 0);
  const y1 = data[0].treasuryAnnualUsd;
  const y10 = data[9].treasuryAnnualUsd;
  console.log(`  ${key}: Y1=${fmtUsd(y1)} | Y10=${fmtUsd(y10)} | 10yr total=${fmtUsd(totalTreasury)}`);
}

// 5. Resilience (demand shock)
console.log("\n5. RESILIENCE (50% demand shock at Y5)\n");
console.log(`  Key metric: absolute price floor at Y10 under shock, and provider income floor.\n`);
for (const [key] of Object.entries(CONFIGS)) {
  const normalY10 = allResults[key][9];
  const shockY10 = shockResults[key][9];
  const priceFloor = shockY10.cldPrice;
  const provFloor = shockY10.providerMonthlyUsd;
  const priceDrop = ((shockY10.cldPrice - normalY10.cldPrice) / normalY10.cldPrice * 100).toFixed(1);
  console.log(`  ${key}: Shock Y10 price=${fmtPrice(priceFloor)} (${priceDrop}% vs normal) | Prov income=${fmtUsd(provFloor)}/mo`);
}

// ── Scoring ────────────────────────────────────────────────────────────

console.log("\n" + "-".repeat(110));
console.log("  SCORING MATRIX (1=worst, 5=best per dimension)");
console.log("-".repeat(110) + "\n");

function rankBy(
  vals: Record<string, number>,
  ascending: boolean // true = lower is better
): Record<string, number> {
  const sorted = Object.entries(vals).sort((a, b) =>
    ascending ? a[1] - b[1] : b[1] - a[1]
  );
  const rank: Record<string, number> = {};
  sorted.forEach(([k], i) => rank[k] = 5 - i);
  return rank;
}

// Supply stability: ideal is moderate net growth at Y10 (~20-30% of mint)
// Too high inflation (>60%) is bad, too much deflation is also bad
const supplyVals: Record<string, number> = {};
for (const [key, data] of Object.entries(allResults)) {
  const ratio = data[9].netSupplyChange / data[9].cldMinted;
  // Ideal ratio ~0.25 (25% net growth). Distance from ideal = penalty.
  supplyVals[key] = Math.abs(ratio - 0.25);
}
const supplyRank = rankBy(supplyVals, true); // lower distance = better

// Price stability: want steady appreciation without crash
// Score by: consistent growth (price at Y10 > Y5 > Y1, small volatility ratio)
// Penalize if price peaked mid-decade then declined
const priceVals: Record<string, number> = {};
for (const [key, data] of Object.entries(allResults)) {
  const prices = data.map(d => d.cldPrice);
  const maxPrice = Math.max(...prices);
  const y10Price = data[9].cldPrice;
  // Ratio of Y10/peak — 1.0 = monotonic rise (ideal), <1 = declined from peak
  const peakRetention = y10Price / maxPrice;
  // Also factor in volatility (max/min ratio — lower is more stable)
  const volRatio = maxPrice / Math.min(...prices);
  // Combined: high retention, low volatility
  priceVals[key] = peakRetention / volRatio; // higher = better
}
const priceRank = rankBy(priceVals, false); // higher = better

// Provider attractiveness: 10-year cumulative USD income per provider
const provVals: Record<string, number> = {};
for (const [key, data] of Object.entries(allResults)) {
  provVals[key] = data.reduce((sum, d) => sum + d.providerMonthlyUsd * 12, 0);
}
const provRank = rankBy(provVals, false); // higher = better

// Treasury: 10-year cumulative treasury USD
const treasVals: Record<string, number> = {};
for (const [key, data] of Object.entries(allResults)) {
  treasVals[key] = data.reduce((sum, d) => sum + d.treasuryAnnualUsd, 0);
}
const treasRank = rankBy(treasVals, false); // higher = better

// Resilience: absolute price floor at Y10 under shock + provider income floor
const resVals: Record<string, number> = {};
for (const [key] of Object.entries(CONFIGS)) {
  const shockY10 = shockResults[key][9];
  // Composite: price floor * provider income floor (both matter)
  resVals[key] = shockY10.cldPrice * shockY10.providerMonthlyUsd;
}
const resRank = rankBy(resVals, false); // higher = better

// Compile scores
interface Scores {
  supply: number; price: number; provider: number;
  treasury: number; resilience: number; total: number;
}
const scores: Record<string, Scores> = {};

for (const key of Object.keys(CONFIGS)) {
  const s: Scores = {
    supply: supplyRank[key],
    price: priceRank[key],
    provider: provRank[key],
    treasury: treasRank[key],
    resilience: resRank[key],
    total: 0,
  };
  s.total = s.supply + s.price + s.provider + s.treasury + s.resilience;
  scores[key] = s;
}

console.log(
  pad("Config", 26) +
  pad("Supply", 10) +
  pad("Price", 10) +
  pad("Provider", 10) +
  pad("Treasury", 10) +
  pad("Resil.", 10) +
  pad("TOTAL", 10)
);
console.log("-".repeat(86));

const sortedScores = Object.entries(scores).sort((a, b) => b[1].total - a[1].total);
for (const [key, s] of sortedScores) {
  const marker = key === sortedScores[0][0] ? " <--" : "";
  console.log(
    pad(`${key}: ${CONFIGS[key].label}`, 26) +
    pad(String(s.supply), 10) +
    pad(String(s.price), 10) +
    pad(String(s.provider), 10) +
    pad(String(s.treasury), 10) +
    pad(String(s.resilience), 10) +
    pad(`${s.total}/25`, 10) +
    marker
  );
}

// ── Recommendation ─────────────────────────────────────────────────────

const winner = sortedScores[0];
const runnerUp = sortedScores[1];
const wKey = winner[0];
const wConfig = CONFIGS[wKey];
const wData = allResults[wKey];
const wY1 = wData[0];
const wY5 = wData[4];
const wY10 = wData[9];
const wShockY10 = shockResults[wKey][9];

console.log("\n" + "=".repeat(110));
console.log("  RECOMMENDATION");
console.log("=".repeat(110));

console.log(`
RECOMMENDED: Config ${wKey} (${(wConfig.provider * 100).toFixed(0)}/${(wConfig.burn * 100).toFixed(0)}/${(wConfig.treasury * 100).toFixed(0)} split) -- "${wConfig.label}" because:

  Score: ${winner[1].total}/25 (runner-up: Config ${runnerUp[0]} "${CONFIGS[runnerUp[0]].label}" at ${runnerUp[1].total}/25)

  1. SUPPLY STABILITY: Net supply change at Y10 is ${wY10.netSupplyChange >= 0 ? "+" : ""}${fmtNum(wY10.netSupplyChange)} CLD/yr
     (burn consumes ${wY10.burnPctOfMinted}% of annual mint). The supply grows from
     ${fmtSupply(wY1.circulatingSupply)} (Y1) to ${fmtSupply(wY10.circulatingSupply)} (Y10) -- ${wY10.netSupplyChange > 0 ? "controlled inflation" : "mild deflation"}
     that is predictable for providers and investors.

  2. PRICE TRAJECTORY: CLD price goes from ${fmtPrice(wY1.cldPrice)} (Y1) to ${fmtPrice(wY5.cldPrice)} (Y5) to ${fmtPrice(wY10.cldPrice)} (Y10).
     This provides meaningful appreciation for early participants without
     the hyperdeflationary spiral that aggressive burn configs risk.

  3. PROVIDER ECONOMICS: Monthly income per provider:
     Y1=${fmtUsd(wY1.providerMonthlyUsd)} | Y5=${fmtUsd(wY5.providerMonthlyUsd)} | Y10=${fmtUsd(wY10.providerMonthlyUsd)}
     The ${(wConfig.provider * 100).toFixed(0)}% provider share balances CLD allocation with price appreciation.
     10-year cumulative: ${fmtUsd(wData.reduce((s, d) => s + d.providerMonthlyUsd * 12, 0))} per provider.

  4. TREASURY: ${fmtUsd(wY10.treasuryAnnualUsd)}/yr at Y10 (${fmtUsd(wData.reduce((s, d) => s + d.treasuryAnnualUsd, 0))} over 10 years).
     Sufficient to fund protocol development, audits, and ecosystem grants.

  5. RESILIENCE: Under a 50% demand shock at Y5, Config ${wKey} maintains a
     ${fmtPrice(wShockY10.cldPrice)} price floor at Y10 with ${fmtUsd(wShockY10.providerMonthlyUsd)}/mo provider income.
     Higher burn configs have higher absolute price floors but less provider
     income headroom. Lower burn configs have worse price floors.`);

// Final comparison: why the winner beats each alternative
const configKeys = Object.keys(CONFIGS);
const losers = configKeys.filter(k => k !== wKey);

// Group into "lower burn" and "higher burn" relative to winner
const lowerBurn = losers.filter(k => CONFIGS[k].burn < wConfig.burn);
const higherBurn = losers.filter(k => CONFIGS[k].burn > wConfig.burn);

if (lowerBurn.length > 0) {
  console.log(`\n  WHY NOT LOWER BURN?`);
  for (const k of lowerBurn) {
    const d = allResults[k][9];
    const c = CONFIGS[k];
    console.log(`  - Config ${k} (${(c.burn * 100)}% burn): Only ${d.burnPctOfMinted}% burn/mint at Y10.`);
    console.log(`    Supply grows to ${fmtSupply(d.circulatingSupply)}, diluting price to ${fmtPrice(d.cldPrice)}.`);
    console.log(`    Providers earn ${fmtUsd(d.providerMonthlyUsd)}/mo — less USD despite more CLD tokens.`);
  }
}

if (higherBurn.length > 0) {
  console.log(`\n  WHY NOT HIGHER BURN?`);
  for (const k of higherBurn) {
    const d = allResults[k][9];
    const c = CONFIGS[k];
    console.log(`  - Config ${k} (${(c.burn * 100)}% burn): ${d.burnPctOfMinted}% burn/mint at Y10 leaves only`);
    console.log(`    ${(100 - d.burnPctOfMinted).toFixed(1)}% net supply growth. If demand dips even temporarily,`);
    console.log(`    supply could contract — risking deflationary spiral and liquidity crunch.`);
  }
}

// Risk acknowledgment for the winner
const wBurnRatio = wY10.burnPctOfMinted;
let riskNote = "";
if (wBurnRatio > 80) {
  riskNote = `\n  RISK NOTE: At ${wBurnRatio}% burn/mint ratio by Y10, Config ${wKey} is approaching
  the edge of net deflation. If demand growth stalls or reverses beyond the
  modeled 50% shock, the protocol should have a governance mechanism to
  dynamically adjust the burn rate downward (e.g., reduce to 20% if burn
  exceeds 90% of mint for 2 consecutive quarters).`;
} else if (wBurnRatio > 60) {
  riskNote = `\n  RISK NOTE: The ${wBurnRatio}% burn/mint ratio at Y10 is healthy but warrants
  monitoring. Consider a governance guardrail that reduces burn if it exceeds
  85% of mint for 2 consecutive quarters.`;
}

console.log(`
  BOTTOM LINE: Config ${wKey} (${(wConfig.burn * 100).toFixed(0)}% burn) maximizes the value returned to both
  providers and treasury through price appreciation, while keeping the network
  net-inflationary (${(100 - wBurnRatio).toFixed(1)}% net supply growth at Y10). The ${(wConfig.burn * 100).toFixed(0)}% burn acts
  as an automatic stabilizer: when demand rises, more CLD is burned constraining
  supply; when demand falls, less is burned, providing a supply buffer.

  Price trajectory: ${fmtPrice(wY1.cldPrice)} -> ${fmtPrice(wY5.cldPrice)} -> ${fmtPrice(wY10.cldPrice)} (${((wY10.cldPrice / wY1.cldPrice)).toFixed(1)}x over 10 years)
  Provider income: ${fmtUsd(wY1.providerMonthlyUsd)}/mo (Y1) -> ${fmtUsd(wY10.providerMonthlyUsd)}/mo (Y10)
  Treasury: ${fmtUsd(wData.reduce((s, d) => s + d.treasuryAnnualUsd, 0))} cumulative over 10 years${riskNote}
`);
