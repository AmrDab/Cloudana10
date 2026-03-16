// Provider economics calculations for the earn calculator page.
// All values are in CLD (testnet token). No external API calls.

import { NodeTier } from "@/lib/node-tier";

// ── Registration Mint ────────────────────────────────────────────────────────

/** Base registration mint per tier (mirrors ProviderMinter.sol) */
export const BASE_REGISTRATION_REWARDS: Record<NodeTier, number> = {
  [NodeTier.CPU_ONLY]: 500,
  [NodeTier.EDGE_RELAY]: 750,
  [NodeTier.STORAGE]: 1_000,
  [NodeTier.GPU_MID]: 2_000,
  [NodeTier.GPU_HIGH]: 5_000,
};

export const HALVING_INTERVAL = 10_000;

/** Calculate registration reward at a given epoch */
export function registrationRewardAtEpoch(tier: NodeTier, epoch: number): number {
  if (epoch >= 20) return 0;
  return BASE_REGISTRATION_REWARDS[tier] / Math.pow(2, epoch);
}

/** Calculate epoch from total claims */
export function epochFromClaims(totalClaims: number): number {
  return Math.floor(totalClaims / HALVING_INTERVAL);
}

// ── POUW Earnings ────────────────────────────────────────────────────────────

/**
 * Estimated CLD earned per hour of useful work per tier.
 * Based on projected network demand and resource pricing.
 * These are estimates for the calculator; actual earnings depend on workload demand.
 */
export const POUW_HOURLY_RATES: Record<NodeTier, number> = {
  [NodeTier.CPU_ONLY]: 0.5,
  [NodeTier.EDGE_RELAY]: 0.3,
  [NodeTier.STORAGE]: 0.8,
  [NodeTier.GPU_MID]: 2.5,
  [NodeTier.GPU_HIGH]: 6.0,
};

/** Assumed utilization percentage for projections */
export const DEFAULT_UTILIZATION = 0.6; // 60%

/** Hours per month (24 * 30) */
export const HOURS_PER_MONTH = 720;

// ── Staking Multipliers ──────────────────────────────────────────────────────

export interface StakingTier {
  name: string;
  stakeRequired: number;
  multiplier: number;
}

export const STAKING_TIERS: StakingTier[] = [
  { name: "None", stakeRequired: 0, multiplier: 1.0 },
  { name: "Tier 1", stakeRequired: 1_000, multiplier: 1.0 },
  { name: "Tier 2", stakeRequired: 10_000, multiplier: 1.5 },
  { name: "Tier 3", stakeRequired: 50_000, multiplier: 2.0 },
];

// ── Projections ──────────────────────────────────────────────────────────────

export interface EarningsProjection {
  /** One-time registration mint */
  registrationMint: number;
  /** Monthly POUW earnings (before staking multiplier) */
  basePouwMonthly: number;
  /** Staking multiplier applied */
  stakingMultiplier: number;
  /** Monthly POUW after staking multiplier */
  pouwMonthly: number;
  /** Total first month (registration + pouw) */
  firstMonthTotal: number;
  /** Monthly recurring (just pouw) */
  monthlyRecurring: number;
  /** Annual projection (registration + 12 months pouw) */
  annualProjection: number;
  /** Utilization rate used */
  utilization: number;
}

export function calculateProjection(options: {
  tier: NodeTier;
  epoch: number;
  stakingTierIndex: number;
  utilization?: number;
}): EarningsProjection {
  const { tier, epoch, stakingTierIndex, utilization = DEFAULT_UTILIZATION } = options;

  const registrationMint = registrationRewardAtEpoch(tier, epoch);
  const hourlyRate = POUW_HOURLY_RATES[tier];
  const basePouwMonthly = hourlyRate * HOURS_PER_MONTH * utilization;
  const stakingMultiplier = STAKING_TIERS[stakingTierIndex]?.multiplier ?? 1.0;
  const pouwMonthly = basePouwMonthly * stakingMultiplier;
  const firstMonthTotal = registrationMint + pouwMonthly;
  const monthlyRecurring = pouwMonthly;
  const annualProjection = registrationMint + pouwMonthly * 12;

  return {
    registrationMint,
    basePouwMonthly,
    stakingMultiplier,
    pouwMonthly,
    firstMonthTotal,
    monthlyRecurring,
    annualProjection,
    utilization,
  };
}

// ── Decay curve data for charts ──────────────────────────────────────────────

export interface DecayPoint {
  epoch: number;
  totalProviders: number;
  reward: number;
}

export function generateDecayCurve(tier: NodeTier, epochs: number = 10): DecayPoint[] {
  const points: DecayPoint[] = [];
  for (let e = 0; e <= epochs; e++) {
    points.push({
      epoch: e,
      totalProviders: e * HALVING_INTERVAL,
      reward: registrationRewardAtEpoch(tier, e),
    });
  }
  return points;
}
