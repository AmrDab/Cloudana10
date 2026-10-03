/**
 * Cloudana 10-Year CLD Economic Simulation
 *
 * Model:
 * - CLD minted ONLY through POUW (100 CLD/block, 1 block/60s)
 * - Job fees: 80% to provider, 15% burned, 5% treasury
 * - No halving, no registration mint, no staking
 * - Provider count and workload demand grow via logistic curves
 * - CLD price is driven by demand (fiat flowing in) vs circulating supply
 * - As CLD price rises, CLD-denominated job fees drop, reducing burn
 * - This creates a natural equilibrium: burn can never exceed supply
 *
 * Run: npx tsx client/src/scripts/simulate-10yr.ts
 */

const BASE_BLOCK_REWARD = 100;
const BLOCKS_PER_YEAR = 365.25 * 24 * 60; // ~525,960
const ANNUAL_CLD_MINTED = BASE_BLOCK_REWARD * BLOCKS_PER_YEAR;
const FEE_BURN = 0.15;
const FEE_PROVIDER = 0.80;
const FEE_TREASURY = 0.05;

interface YearSnapshot {
  year: number;
  providers: number;
  workloadsPerDay: number;
  annualFiatDemandUsd: number;
  cldMinted: number;
  cldBurned: number;
  netNewCld: number;
  circulatingSupply: number;
  cldPriceUsd: number;
  avgJobFeeCld: number;
  providerMonthlyCld: number;
  providerMonthlyUsd: number;
  burnPctOfMinted: number;
}

function logistic(t: number, midpoint = 0.4, steepness = 12): number {
  return 1 / (1 + Math.exp(-steepness * (t - midpoint)));
}

function runSimulation(): YearSnapshot[] {
  const results: YearSnapshot[] = [];

  // Growth parameters
  const providerStart = 50;
  const providerMax = 10_000;
  const workloadStart = 10;
  const workloadMax = 50_000;
  const avgJobFeeUsd = 5; // average job cost in fiat

  // Initial conditions
  let circulatingSupply = 0;
  let cldPriceUsd = 0.01;

  for (let year = 1; year <= 10; year++) {
    const t = year / 10;
    const growth = logistic(t);

    const providers = Math.round(
      providerStart + (providerMax - providerStart) * growth
    );
    const workloadsPerDay = Math.round(
      workloadStart + (workloadMax - workloadStart) * growth
    );

    // --- Supply side: POUW mining (constant) ---
    const cldMinted = ANNUAL_CLD_MINTED;
    circulatingSupply += cldMinted;

    // --- Demand side: fiat flowing into CLD purchases ---
    const annualFiatDemandUsd = workloadsPerDay * 365.25 * avgJobFeeUsd;

    // Price model: simple supply/demand
    // Price = total fiat demand / circulating supply (bounded)
    // This naturally rises as demand grows and supply is constrained by burn
    cldPriceUsd = Math.max(0.001, annualFiatDemandUsd / circulatingSupply);

    // --- Job fees in CLD (fiat-pegged) ---
    const avgJobFeeCld = avgJobFeeUsd / cldPriceUsd;
    const totalJobFeesCld = workloadsPerDay * 365.25 * avgJobFeeCld;

    // --- Burn: 15% of job fees ---
    const cldBurned = totalJobFeesCld * FEE_BURN;
    circulatingSupply -= cldBurned;

    // Ensure supply doesn't go negative (can't burn what doesn't exist)
    circulatingSupply = Math.max(0, circulatingSupply);

    // --- Provider economics ---
    const providerMonthlyCld = (cldMinted * FEE_PROVIDER) / providers / 12;
    const providerMonthlyUsd = providerMonthlyCld * cldPriceUsd;
    const burnPctOfMinted = (cldBurned / cldMinted) * 100;

    results.push({
      year,
      providers,
      workloadsPerDay,
      annualFiatDemandUsd: Math.round(annualFiatDemandUsd),
      cldMinted: Math.round(cldMinted),
      cldBurned: Math.round(cldBurned),
      netNewCld: Math.round(cldMinted - cldBurned),
      circulatingSupply: Math.round(circulatingSupply),
      cldPriceUsd: Math.round(cldPriceUsd * 10000) / 10000,
      avgJobFeeCld: Math.round(avgJobFeeCld * 100) / 100,
      providerMonthlyCld: Math.round(providerMonthlyCld * 100) / 100,
      providerMonthlyUsd: Math.round(providerMonthlyUsd * 100) / 100,
      burnPctOfMinted: Math.round(burnPctOfMinted * 10) / 10,
    });
  }

  return results;
}

// -- Output --

const results = runSimulation();

console.log("\n=== CLOUDANA 10-YEAR CLD SIMULATION ===\n");
console.log("Model: POUW-only minting | 80/15/5 split | no halving | no staking");
console.log(`Constant block reward: ${BASE_BLOCK_REWARD} CLD/block, 1 block/min`);
console.log(`Annual mint: ${Math.round(ANNUAL_CLD_MINTED).toLocaleString()} CLD\n`);

// Table 1: Supply dynamics
console.log("--- SUPPLY DYNAMICS ---\n");
console.log(
  "Year".padEnd(6) +
    "Providers".padEnd(11) +
    "Jobs/Day".padEnd(11) +
    "Fiat In".padEnd(14) +
    "CLD Minted".padEnd(14) +
    "CLD Burned".padEnd(14) +
    "Net New".padEnd(14) +
    "Supply".padEnd(16) +
    "Burn%"
);
console.log("-".repeat(112));

for (const r of results) {
  console.log(
    String(r.year).padEnd(6) +
      r.providers.toLocaleString().padEnd(11) +
      r.workloadsPerDay.toLocaleString().padEnd(11) +
      `$${(r.annualFiatDemandUsd / 1e6).toFixed(1)}M`.padEnd(14) +
      r.cldMinted.toLocaleString().padEnd(14) +
      r.cldBurned.toLocaleString().padEnd(14) +
      (r.netNewCld >= 0 ? `+${r.netNewCld.toLocaleString()}` : r.netNewCld.toLocaleString()).padEnd(14) +
      r.circulatingSupply.toLocaleString().padEnd(16) +
      `${r.burnPctOfMinted}%`
  );
}

// Table 2: Provider economics
console.log("\n--- PROVIDER ECONOMICS ---\n");
console.log(
  "Year".padEnd(6) +
    "$/CLD".padEnd(10) +
    "CLD/job".padEnd(12) +
    "CLD/mo/prov".padEnd(16) +
    "$/mo/prov".padEnd(14) +
    "$/yr/prov"
);
console.log("-".repeat(72));

for (const r of results) {
  console.log(
    String(r.year).padEnd(6) +
      `$${r.cldPriceUsd}`.padEnd(10) +
      r.avgJobFeeCld.toFixed(2).padEnd(12) +
      r.providerMonthlyCld.toLocaleString().padEnd(16) +
      `$${r.providerMonthlyUsd.toFixed(2)}`.padEnd(14) +
      `$${(r.providerMonthlyUsd * 12).toFixed(0)}`
  );
}

// Insights
console.log("\n=== KEY INSIGHTS ===\n");
const first = results[0];
const last = results[results.length - 1];
const mid = results[4];

console.log(`1. SUPPLY: ${first.circulatingSupply.toLocaleString()} CLD (Y1) -> ${last.circulatingSupply.toLocaleString()} CLD (Y10)`);
console.log(`2. PRICE: $${first.cldPriceUsd} (Y1) -> $${last.cldPriceUsd} (Y10) — ${((last.cldPriceUsd / first.cldPriceUsd - 1) * 100).toFixed(0)}x appreciation`);
console.log(`3. BURN: ${first.burnPctOfMinted}% of minted (Y1) -> ${last.burnPctOfMinted}% (Y10)`);
console.log(`4. PROVIDER USD: $${first.providerMonthlyUsd}/mo (Y1) -> $${last.providerMonthlyUsd}/mo (Y10)`);
console.log(`5. PROVIDER CLD: ${first.providerMonthlyCld}/mo (Y1) -> ${last.providerMonthlyCld}/mo (Y10) — pool dilution`);

if (last.burnPctOfMinted > 100) {
  console.log(`\n** DEFLATIONARY: burn exceeds mint from ~Y${results.findIndex(r => r.burnPctOfMinted > 100) + 1}. Supply peaks then shrinks.`);
  const peakYear = results.reduce((a, b) => a.circulatingSupply > b.circulatingSupply ? a : b);
  console.log(`   Peak supply: ${peakYear.circulatingSupply.toLocaleString()} CLD at Y${peakYear.year}`);
} else {
  console.log(`\n** INFLATIONARY: burn < mint. Supply grows continuously but slows.`);
}

console.log(`\n6. EQUILIBRIUM: As CLD price rises, CLD-denominated fees drop,`);
console.log(`   reducing burn. The 15% burn acts as an automatic stabilizer.`);
console.log(`7. FIAT INPUT: Users pay ~$${avgJobFeeUsdStr(first)} -> $${avgJobFeeUsdStr(last)}/job (constant fiat, variable CLD).`);
console.log(`   Work input is fiat. CLD appreciation makes workloads cost more fiat`);
console.log(`   only if we peg to CLD — but we peg to fiat, so users are insulated.`);

function avgJobFeeUsdStr(r: YearSnapshot): string {
  return (r.avgJobFeeCld * r.cldPriceUsd).toFixed(2);
}
