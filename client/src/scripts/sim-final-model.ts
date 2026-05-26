/**
 * Cloudana CLD Token -- 10-Year Economic Simulation (Final Model)
 *
 * Minting:  100 CLD/block Y1-4, 50 CLD/block Y5-8, 25 CLD/block Y9+ (permanent floor)
 * Block time: 60s (~525,960 blocks/year)
 * Fee split: 75% provider / 20% burned / 5% treasury
 * Providers earn: POUW mining rewards + 75% of job fees (post-burn)
 * Growth: logistic curves for providers (50->10,000) and workloads (10->50,000 jobs/day)
 *
 * Price model:
 *   Equation of exchange: Price = (Fee Demand * demand multiplier) / (Supply * Velocity)
 *   Velocity starts at 10 (high churn) and declines to 4 (more holding).
 *   Demand multiplier grows from 1.5x to 2.5x reflecting speculative + ecosystem demand.
 *
 * Burn constraint:
 *   Users pay fees from tokens they already hold or purchase. The 20% burn comes from
 *   fee payments, which are limited by actual economic throughput. We model burn as
 *   20% of fee-volume-in-CLD, but cap it so supply never goes below 10M CLD
 *   (minimum viable liquidity).
 */

// -- Constants -----------------------------------------------------------------
const BLOCKS_PER_YEAR = 525_960;
const YEARS = 10;
const AVG_JOB_FEE_USD = 5;
const STARTING_PRICE = 0.01;
const MIN_SUPPLY = 10_000_000; // 10M CLD minimum viable liquidity

// -- Reward schedule -----------------------------------------------------------
function rewardPerBlock(year: number): number {
  if (year <= 4) return 100;
  if (year <= 8) return 50;
  return 25;
}

// -- Logistic growth -----------------------------------------------------------
function logistic(t: number, floor: number, cap: number, midpoint: number, k: number): number {
  const L = cap - floor;
  return floor + L / (1 + Math.exp(-k * (t - midpoint)));
}

function providers(year: number): number {
  return Math.round(logistic(year, 50, 10_000, 4, 1.0));
}

function jobsPerDay(year: number): number {
  return Math.round(logistic(year, 10, 50_000, 4, 1.0));
}

// Velocity declines as ecosystem matures
function velocity(year: number): number {
  return 10 - (year - 1) * (6 / 9); // 10 -> 4 over 10 years
}

// Demand multiplier: fee volume is base demand, but total market demand is higher
// due to speculative interest, treasury buys, LP incentives, exchange listings, etc.
function demandMultiplier(year: number): number {
  return 1.5 + Math.min(1.0, (year - 1) * 0.12); // 1.5x -> 2.58x
}

// -- Simulation ----------------------------------------------------------------
interface YearData {
  year: number;
  blockReward: number;
  annualMinted: number;
  annualBurned: number;
  netNewCLD: number;
  circulatingSupply: number;
  cldPrice: number;
  providerCount: number;
  dailyJobs: number;
  providerMonthlyMining: number;
  providerMonthlyJobFees: number;
  providerTotalMonthlyCLD: number;
  providerTotalMonthlyUSD: number;
  burnPctOfMinted: number;
  annualFeeVolumeUSD: number;
  annualFeeBurnedUSD: number;
  treasuryUSD: number;
  velocityUsed: number;
}

function run(): YearData[] {
  let circulatingSupply = 0;
  let cldPrice = STARTING_PRICE;
  const results: YearData[] = [];

  for (let y = 1; y <= YEARS; y++) {
    const reward = rewardPerBlock(y);
    const annualMinted = reward * BLOCKS_PER_YEAR;
    const numProviders = providers(y);
    const dailyJobs = jobsPerDay(y);
    const annualJobs = dailyJobs * 365;
    const annualFeeVolumeUSD = annualJobs * AVG_JOB_FEE_USD;

    // Add newly minted tokens first (they enter supply over the year)
    circulatingSupply += annualMinted;

    // Convert fee volume to CLD at current price
    const annualFeeVolumeCLD = annualFeeVolumeUSD / cldPrice;

    // Fee splits in CLD
    const desiredBurn = annualFeeVolumeCLD * 0.20;
    const providerFeeShare = 0.75; // 75% to providers
    const treasuryShare = 0.05;    // 5% to treasury

    // Burn cap: cannot reduce supply below MIN_SUPPLY
    const maxBurnable = Math.max(0, circulatingSupply - MIN_SUPPLY);
    const annualBurned = Math.min(desiredBurn, maxBurnable);

    // The actual burn ratio determines the effective fee split
    const burnRatio = desiredBurn > 0 ? annualBurned / desiredBurn : 0;
    const annualProviderFees = annualFeeVolumeCLD * providerFeeShare;
    const annualTreasury = annualFeeVolumeCLD * treasuryShare;

    // Remove burned tokens from supply
    circulatingSupply -= annualBurned;

    const netNewCLD = annualMinted - annualBurned;

    // Price via equation of exchange: Price = Demand / (M * V)
    const v = velocity(y);
    const dm = demandMultiplier(y);
    const totalDemandUSD = annualFeeVolumeUSD * dm;
    cldPrice = totalDemandUSD / (circulatingSupply * v);
    cldPrice = Math.max(0.001, cldPrice);

    // Provider income per month
    const providerMonthlyMining = (annualMinted / 12) / numProviders;
    const providerMonthlyJobFees = (annualProviderFees / 12) / numProviders;
    const providerTotalMonthlyCLD = providerMonthlyMining + providerMonthlyJobFees;
    const providerTotalMonthlyUSD = providerTotalMonthlyCLD * cldPrice;

    const burnPctOfMinted = (annualBurned / annualMinted) * 100;
    const treasuryUSD = annualTreasury * cldPrice;

    results.push({
      year: y,
      blockReward: reward,
      annualMinted,
      annualBurned,
      netNewCLD,
      circulatingSupply,
      cldPrice,
      providerCount: numProviders,
      dailyJobs,
      providerMonthlyMining,
      providerMonthlyJobFees,
      providerTotalMonthlyCLD,
      providerTotalMonthlyUSD,
      burnPctOfMinted,
      annualFeeVolumeUSD,
      annualFeeBurnedUSD: annualBurned * cldPrice,
      treasuryUSD,
      velocityUsed: v,
    });
  }

  return results;
}

// -- Formatting ----------------------------------------------------------------
function fmtNum(n: number, dec = 0): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: dec, minimumFractionDigits: dec });
}

function fmtUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtCLD(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(1);
}

function pad(s: string, w: number): string {
  return s.padStart(w);
}

// -- Output --------------------------------------------------------------------
function printResults(data: YearData[]) {
  console.log('');
  console.log('='.repeat(185));
  console.log('  CLOUDANA CLD TOKEN -- 10-YEAR ECONOMIC SIMULATION (FINAL MODEL)');
  console.log('='.repeat(185));
  console.log('');
  console.log('  Parameters:');
  console.log('    Minting:     100 CLD/block (Y1-4) -> 50 CLD/block (Y5-8) -> 25 CLD/block (Y9+, permanent floor)');
  console.log('    Block time:  60s (~525,960 blocks/year)');
  console.log('    Fee split:   75% provider / 20% burned / 5% treasury');
  console.log('    Avg job fee: $5 USD (constant fiat)');
  console.log('    Start price: $0.01 per CLD');
  console.log('    Price model: Equation of exchange -- Price = (FeeVol * DemandMultiplier) / (Supply * Velocity)');
  console.log('    Velocity:    10 (Y1) declining to 4 (Y10)');
  console.log('    Min supply:  10M CLD floor (burn cap)');
  console.log('');

  // -- Table 1: Supply & Burn --
  console.log('-'.repeat(185));
  console.log('  TABLE 1: SUPPLY, BURN & PRICE DYNAMICS');
  console.log('-'.repeat(185));
  const h1 = [
    pad('Year', 5),
    pad('CLD/Blk', 8),
    pad('Annual Minted', 14),
    pad('Annual Burned', 14),
    pad('Net New CLD', 14),
    pad('Circulating', 14),
    pad('CLD Price', 11),
    pad('Burn/Mint', 10),
    pad('Vel', 5),
    pad('Providers', 10),
    pad('Jobs/Day', 10),
    pad('Fee Vol(USD)', 14),
    pad('Burned(USD)', 13),
    pad('Treasury(USD)', 14),
  ].join(' | ');
  console.log(h1);
  console.log('-'.repeat(185));

  for (const d of data) {
    const row = [
      pad(`Y${d.year}`, 5),
      pad(`${d.blockReward}`, 8),
      pad(fmtCLD(d.annualMinted), 14),
      pad(fmtCLD(d.annualBurned), 14),
      pad(fmtCLD(d.netNewCLD), 14),
      pad(fmtCLD(d.circulatingSupply), 14),
      pad(`$${d.cldPrice.toFixed(4)}`, 11),
      pad(`${d.burnPctOfMinted.toFixed(1)}%`, 10),
      pad(d.velocityUsed.toFixed(1), 5),
      pad(fmtNum(d.providerCount), 10),
      pad(fmtNum(d.dailyJobs), 10),
      pad(fmtUSD(d.annualFeeVolumeUSD), 14),
      pad(fmtUSD(d.annualFeeBurnedUSD), 13),
      pad(fmtUSD(d.treasuryUSD), 14),
    ].join(' | ');
    console.log(row);
  }
  console.log('-'.repeat(185));
  console.log('');

  // -- Table 2: Provider Income --
  console.log('-'.repeat(130));
  console.log('  TABLE 2: PROVIDER MONTHLY INCOME BREAKDOWN');
  console.log('-'.repeat(130));
  const h2 = [
    pad('Year', 5),
    pad('Providers', 10),
    pad('Mining(CLD)', 14),
    pad('Jobs(CLD)', 14),
    pad('Total(CLD)', 14),
    pad('Total(USD)', 14),
    pad('Mining%', 8),
    pad('Jobs%', 8),
    pad('>$100?', 7),
  ].join(' | ');
  console.log(h2);
  console.log('-'.repeat(130));

  for (const d of data) {
    const mPct = (d.providerMonthlyMining / d.providerTotalMonthlyCLD * 100).toFixed(0);
    const jPct = (d.providerMonthlyJobFees / d.providerTotalMonthlyCLD * 100).toFixed(0);
    const ok = d.providerTotalMonthlyUSD >= 100 ? 'YES' : 'NO';
    const row = [
      pad(`Y${d.year}`, 5),
      pad(fmtNum(d.providerCount), 10),
      pad(fmtCLD(d.providerMonthlyMining), 14),
      pad(fmtCLD(d.providerMonthlyJobFees), 14),
      pad(fmtCLD(d.providerTotalMonthlyCLD), 14),
      pad(fmtUSD(d.providerTotalMonthlyUSD), 14),
      pad(`${mPct}%`, 8),
      pad(`${jPct}%`, 8),
      pad(ok, 7),
    ].join(' | ');
    console.log(row);
  }
  console.log('-'.repeat(130));
  console.log('');

  // -- Summary --
  console.log('='.repeat(100));
  console.log('  SUMMARY & ANALYSIS');
  console.log('='.repeat(100));
  console.log('');

  // 1. Net deflationary
  const deflYear = data.find(d => d.annualBurned > d.annualMinted);
  if (deflYear) {
    console.log(`  [1] NET DEFLATIONARY CROSSOVER: Year ${deflYear.year}`);
    console.log(`      Burn: ${fmtCLD(deflYear.annualBurned)} > Mint: ${fmtCLD(deflYear.annualMinted)}`);
    console.log(`      Burn/Mint ratio: ${deflYear.burnPctOfMinted.toFixed(1)}%`);
    const deflYears = data.filter(d => d.annualBurned > d.annualMinted);
    const inflYears = data.filter(d => d.annualBurned <= d.annualMinted);
    if (inflYears.length > 0 && inflYears.some(d => d.year > deflYear.year)) {
      console.log(`      Deflationary in years: ${deflYears.map(d => `Y${d.year}`).join(', ')}`);
      console.log(`      Inflationary in years: ${inflYears.map(d => `Y${d.year}`).join(', ')}`);
    } else {
      console.log(`      System remains net-deflationary from Y${deflYear.year} through Y10.`);
    }
  } else {
    console.log('  [1] NET DEFLATIONARY: Not reached within 10 years.');
    const best = data.reduce((a, b) => b.burnPctOfMinted > a.burnPctOfMinted ? b : a);
    console.log(`      Closest: Y${best.year} at ${best.burnPctOfMinted.toFixed(1)}% burn/mint.`);
  }
  console.log('');

  // 2. Peak supply
  let peakSupply = 0, peakYear = 0;
  for (const d of data) {
    if (d.circulatingSupply > peakSupply) {
      peakSupply = d.circulatingSupply;
      peakYear = d.year;
    }
  }
  const finalSupply = data[data.length - 1].circulatingSupply;
  console.log(`  [2] PEAK CIRCULATING SUPPLY: ${fmtCLD(peakSupply)} at Year ${peakYear}`);
  if (peakYear < YEARS) {
    console.log(`      Supply peaked then DECLINED. Y10 supply: ${fmtCLD(finalSupply)}`);
    console.log(`      Reduction from peak: ${((1 - finalSupply / peakSupply) * 100).toFixed(1)}%`);
  } else {
    console.log(`      Supply still growing at Y10: ${fmtCLD(finalSupply)}`);
  }
  console.log('');

  // 3. Provider income
  console.log('  [3] PROVIDER INCOME TRAJECTORY:');
  const belowThreshold = data.filter(d => d.providerTotalMonthlyUSD < 100);
  if (belowThreshold.length === 0) {
    console.log('      Providers ALWAYS above $100/mo hardware cost threshold.');
  } else {
    console.log(`      Below $100/mo in: ${belowThreshold.map(d => `Y${d.year} (${fmtUSD(d.providerTotalMonthlyUSD)})`).join(', ')}`);
  }
  console.log(`      Y1:  ${fmtUSD(data[0].providerTotalMonthlyUSD)}/mo  (${fmtNum(data[0].providerCount)} providers)`);
  console.log(`      Y5:  ${fmtUSD(data[4].providerTotalMonthlyUSD)}/mo  (${fmtNum(data[4].providerCount)} providers)`);
  console.log(`      Y10: ${fmtUSD(data[9].providerTotalMonthlyUSD)}/mo  (${fmtNum(data[9].providerCount)} providers)`);
  console.log('');

  // 4. Dual revenue vs mining-only
  console.log('  [4] DUAL REVENUE (MINING + JOBS) vs MINING-ONLY:');
  console.log('');
  console.log('      Year | Dual Revenue  | Mining Only   | Job Fee Uplift | Mining-Only >$100?');
  console.log('      -----|---------------|---------------|----------------|-------------------');
  for (const d of data) {
    const miningOnlyUSD = d.providerMonthlyMining * d.cldPrice;
    const upliftPct = miningOnlyUSD > 0.01 ? ((d.providerTotalMonthlyUSD / miningOnlyUSD - 1) * 100) : 0;
    const miningOk = miningOnlyUSD >= 100 ? 'YES' : 'NO';
    console.log(
      `       Y${d.year.toString().padEnd(2)} ` +
      `| ${pad(fmtUSD(d.providerTotalMonthlyUSD), 13)} ` +
      `| ${pad(fmtUSD(miningOnlyUSD), 13)} ` +
      `| ${pad(`+${fmtNum(upliftPct, 0)}%`, 14)} ` +
      `| ${miningOk}`
    );
  }
  console.log('');

  const crossover = data.find(d => d.providerMonthlyJobFees > d.providerMonthlyMining);
  if (crossover) {
    const jobPct = (crossover.providerMonthlyJobFees / crossover.providerTotalMonthlyCLD * 100).toFixed(0);
    console.log(`      JOB FEES EXCEED MINING: Year ${crossover.year} (jobs = ${jobPct}% of CLD income)`);
    console.log('      The network transitions from inflation-funded to usage-funded.');
  }
  console.log('');

  // 5. Key metrics
  const totalMinted = data.reduce((s, d) => s + d.annualMinted, 0);
  const totalBurned = data.reduce((s, d) => s + d.annualBurned, 0);
  const totalFees = data.reduce((s, d) => s + d.annualFeeVolumeUSD, 0);
  const totalTreasury = data.reduce((s, d) => s + d.treasuryUSD, 0);
  const y1 = data[0], y10 = data[9];

  console.log('  [5] KEY METRICS:');
  console.log(`      Total CLD minted (10Y):    ${fmtCLD(totalMinted)}`);
  console.log(`      Total CLD burned (10Y):    ${fmtCLD(totalBurned)}`);
  console.log(`      Net tokens created (10Y):  ${fmtCLD(totalMinted - totalBurned)}`);
  console.log(`      Total fee volume (10Y):    ${fmtUSD(totalFees)}`);
  console.log(`      CLD price:                 $${y1.cldPrice.toFixed(4)} (Y1) -> $${y10.cldPrice.toFixed(4)} (Y10)`);
  const priceChange = ((y10.cldPrice / y1.cldPrice - 1) * 100);
  console.log(`      Price change:              ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(0)}%`);
  console.log(`      Cumulative treasury (USD): ${fmtUSD(totalTreasury)}`);
  console.log('');

  // 6. Narrative
  console.log('  [6] NARRATIVE:');
  console.log('');
  if (deflYear) {
    console.log(`      The 20% fee burn is powerful. By Year ${deflYear.year}, annual burn exceeds annual`);
    console.log('      minting, making the token net-deflationary. This constrains supply growth');
    console.log('      and creates sustained upward price pressure as the network scales.');
  }
  console.log('');
  if (belowThreshold.length === 0) {
    console.log('      Provider economics are healthy from day one: dual revenue (mining + job');
    console.log('      fees) ensures providers always earn above the $100/mo hardware threshold.');
  } else {
    console.log(`      Early providers in ${belowThreshold.map(d => `Y${d.year}`).join(', ')} earn below $100/mo, acceptable for`);
    console.log('      early adopters who benefit from later price appreciation on holdings.');
  }
  console.log('');

  // Find when mining alone drops below $100
  const miningDrop = data.find(d => d.providerMonthlyMining * d.cldPrice < 100);
  if (miningDrop) {
    console.log(`      WITHOUT job fees, mining-only income drops below $100/mo by Year ${miningDrop.year}.`);
    console.log('      This proves dual revenue is not optional -- it is structurally necessary');
    console.log('      for long-term provider viability as block rewards halve.');
  }
  console.log('');
  console.log('      The halving schedule (100 -> 50 -> 25 CLD/block) forces the network to');
  console.log('      transition from subsidy-driven to usage-driven. Job fees fill the gap,');
  console.log('      making this a genuine utility token backed by real compute demand.');
  console.log('');
  console.log('='.repeat(100));
}

// -- Run -----------------------------------------------------------------------
const results = run();
printResults(results);
