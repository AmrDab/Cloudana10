// Cloudana provider economics — POUW-only model.
// All CLD is generated exclusively through Proof of Useful Work.
// No registration mint. No staking. No halving to zero.
// Fee split: 75% provider / 20% burned / 5% treasury.

// -- POUW Reward Formula (Whitepaper Section 8) -------------------------------
// R = Base_Reward x Difficulty_Multiplier x (Matrix_Size / Reference_Size)^alpha

/** CLD minted per valid POUW block (initial rate; halves per HALVING_SCHEDULE) */
export const BASE_BLOCK_REWARD = 100;

/** Block reward schedule: halves every 4 years with permanent floor at 25 */
export const HALVING_SCHEDULE = [
  { fromYear: 0, toYear: 4, reward: 100 },
  { fromYear: 4, toYear: 8, reward: 50 },
  { fromYear: 8, toYear: Infinity, reward: 25 },
] as const;

/** Get block reward for a given network year */
export function blockRewardAtYear(year: number): number {
  for (const tier of HALVING_SCHEDULE) {
    if (year >= tier.fromYear && year < tier.toYear) return tier.reward;
  }
  return 25; // permanent floor
}

/** Target: 1 block per 60 seconds */
export const BLOCK_TIME_SECONDS = 60;

/** Reference matrix size for difficulty scaling */
export const REFERENCE_MATRIX_SIZE = 1024;

/** Scaling exponent (whitepaper range: 1.5-2.0, using midpoint) */
export const ALPHA = 1.75;

// -- Fee Split ----------------------------------------------------------------

export const FEE_SPLIT = {
  provider: 0.75,
  burn: 0.20,
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

// -- POUW Reward Calculation --------------------------------------------------

/** Calculate raw POUW block reward for a given matrix size and difficulty. */
export function pouwBlockReward(opts: {
  matrixSize?: number;
  difficultyMultiplier?: number;
}): number {
  const { matrixSize = REFERENCE_MATRIX_SIZE, difficultyMultiplier = 1.0 } = opts;
  return BASE_BLOCK_REWARD * difficultyMultiplier * Math.pow(matrixSize / REFERENCE_MATRIX_SIZE, ALPHA);
}

// -- Provider Earnings Formula ------------------------------------------------
// Earnings = Mining Income + Job Fee Income
//
// Mining Income = certs_found × BlockReward(year) × FEE_SPLIT.provider
//   Only GPU providers realistically earn here (POUW is matrix multiplication)
//
// Job Fee Income = Σ(job_fees) × FEE_SPLIT.provider
//   All provider types earn here (CPU, storage, GPU, edge)
//
// 20% of all job fees burned. 5% to treasury.

export interface EarningsProjection {
  /** Monthly mining income (CLD) */
  miningIncome: number;
  /** Monthly job fee income (CLD) */
  jobFeeIncome: number;
  /** Total monthly (CLD) */
  totalMonthly: number;
  /** Annual projection (CLD) */
  annualProjection: number;
}

/**
 * Project monthly earnings for a provider.
 *
 * @param certsPerMonth  - Expected POUW certificates found per month (0 for non-GPU)
 * @param jobRevenuePerMonth - Expected job fee revenue per month (CLD, before split)
 * @param networkYear    - Current network year (affects block reward via halving)
 */
export function calculateProjection(options: {
  certsPerMonth: number;
  jobRevenuePerMonth: number;
  networkYear?: number;
}): EarningsProjection {
  const { certsPerMonth, jobRevenuePerMonth, networkYear = 1 } = options;

  const reward = blockRewardAtYear(networkYear);
  const miningIncome = certsPerMonth * reward * FEE_SPLIT.provider;
  const jobFeeIncome = jobRevenuePerMonth * FEE_SPLIT.provider;
  const totalMonthly = miningIncome + jobFeeIncome;

  return {
    miningIncome,
    jobFeeIncome,
    totalMonthly,
    annualProjection: totalMonthly * 12,
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
 * - Block reward: 100 CLD/block Y1-4, 50 Y5-8, 25 Y9+ (permanent floor)
 * - CLD minted only through POUW (real work)
 * - 20% of all fees burned
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
    const t = year / 10;
    const logistic = 1 / (1 + Math.exp(-12 * (t - 0.4)));

    const providers = Math.round(initialProviders + (maxProviders - initialProviders) * logistic);
    const workloads = Math.round(initialWorkloadsPerDay + (maxWorkloadsPerDay - initialWorkloadsPerDay) * logistic);

    // Mining: blocks per year = 365.25 * 24 * 60 (one block per minute)
    const blocksPerYear = 365.25 * 24 * 60;
    const annualCldMinted = blockRewardAtYear(year) * blocksPerYear;

    // Burn: 20% of all job fee throughput
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
