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
    const t = year / 10;
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
