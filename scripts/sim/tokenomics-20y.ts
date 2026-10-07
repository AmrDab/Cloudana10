/**
 * Cloudana CLD — 20-year simulation of the two-lane tokenomics on the DECIDED parameters
 * (docs/DECISIONS_CONSENSUS.md, docs/IMPL_SPEC_2026-10.md — October 2026).
 *
 *   npx tsx scripts/sim/tokenomics-20y.ts
 *
 * Writes docs/TOKENOMICS_SIM_20Y.md and client/src/data/tokenomics-sim.json.
 *
 * Model under test:
 *   per job with fee F (CLD):  burn F · mint 0.95F to the provider (lane A) · mint 0.03F (rounded up per job) to
 *   treasury · 0.02F is destroyed for good.
 *   lane B subsidy = min(ρ·F, remaining epoch budget), only for σ-assigned work; per-operator cluster gate: an
 *   operator above S_CAP of eligible work loses its own lane B, everyone else keeps theirs; fewer than N_MIN
 *   clusters → no lane B for anyone. Hosting earns lane A only.
 *   Lane-B budget = min(chain allowance [8 % → ×0.85/yr → 1.5 % floor of live supply], 4 % of genesis per year),
 *   halving every 4 years, never below 1 % of current supply per year.
 *   Price controller (hourly): hold when nothing was served; else ±2 %/h toward utilization 0.6–0.8;
 *   floor 0.1 × 30-day EMA, ceiling 10 × EMA.
 *   24 h mainnet epochs: lane A, treasury and the burn post at T+24 h; lane B vests 7 d.
 *   Browser verifiers earn credits (points) — never CLD.
 *
 * This is a SIMULATION, not a forecast. CLD/USD is an exogenous input per scenario.
 * Monthly steps (240) for demand, fleet and settlement; the price controller runs hourly inside each month
 * (demand is uniform within a month, so per-epoch caps scale linearly).
 * No dependencies beyond node.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ═══════════════════════════════════════════════════════════════════════════
// PARAMETERS
// ═══════════════════════════════════════════════════════════════════════════

const YEARS = 20;
const MONTHS = YEARS * 12;
const SEC_PER_MONTH = (365 / 12) * 86_400;
const HOURS_PER_MONTH = (365 / 12) * 24;
const HOURS = Math.round(HOURS_PER_MONTH); // controller steps per month
const EPOCHS_PER_MONTH = 365 / 12; // 24 h mainnet epochs
const DAYS_PER_MONTH = 365 / 12;

/** Protocol constants — DECISIONS_CONSENSUS.md "Before mainnet" column, IMPL_SPEC_2026-10.md. */
const PROTOCOL = {
  laneA: 0.95, // LANE_A_PER_MILLE = 950
  treasury: 0.03, // TREASURY_PER_MILLE = 30, rounded UP per job (on-chain: treasury ≥ 3 %)
  treasuryRoundUpUcldPerJob: 1, // worst case of the per-job round-up
  rho: 0.25, // SUBSIDY_RHO
  clusterSCap: 0.34, // CLUSTER_S_CAP mainnet (testnet 0.5)
  clusterNMin: 5, // CLUSTER_N_MIN mainnet (testnet 3)
  /** CloudanaSettlement.allowance: supply × rate / 365 per day. */
  chainRateInitial: 0.08,
  chainRateDecay: 0.85,
  chainRateFloor: 0.015,
  /** Policy budget: min(chain allowance, this × genesis) per year, halving every 4 yr, floor of current supply. */
  budgetGenesisFraction: 0.04,
  budgetHalvingYears: 4,
  budgetFloorOfSupply: 0.01,
  /** Price controller (hourly). */
  ctrl: { uLow: 0.6, uHigh: 0.8, gain: 1.0, maxStep: 0.02, emaHours: 30 * 24, floorOfEma: 0.1, ceilingOfEma: 10 },
  /** Launch price: 14 000 nCLD/TMAC (= 1.4e-5 µCLD/MMAC). */
  launchPriceNcldPerTmac: 14_000,
  /** Lane A, treasury and the burn post after the 24 h epoch + 24 h veto; lane B additionally vests 7 d. */
  laneALagDays: 2,
  laneBLagDays: 2 + 7,
  /** Protocol work on idle capacity (design §5): paid at 0.5·p, ≤ 25 % of the chain allowance, from the lane-B budget.
   *  NOT in the ledger — off by default, shown as a sensitivity. */
  protocolWorkPriceFactor: 0.5,
  protocolWorkAllowanceShare: 0.25,
};

/** Simulation assumptions (NOT protocol constants). */
const ASSUME = {
  genesisSupply: 100_000_000, // mainnet genesis (owner decision #3)
  cldUsd0: 0.1, // $ per CLD at t=0 — sensitivity input only
  /** Paid work demanded at the reference price, month 1, in USD. */
  demandUsd0PerMonth: 25_000,
  /** Reference market price of GPU matmul: H100 ≈ $2/h at ≈ 4e14 MAC/s → $/MMAC. */
  refUsdPerMmac: 2 / (4e8 * 3600),
  demandElasticity: 0.7, // Q ∝ (price / ref)^-ε
  hostingShare: 0.15, // share of demand that is hosting (lane A only — never σ-proven)
  /** Providers: grow when margin > entryMargin, shrink after `exitAfter` months of margin < 0. */
  entryMargin: 0.15,
  entryGain: 0.5,
  exitAfter: 3,
  exitRate: 0.15,
  /** Largest single operator's capacity share in a "decentralised" network; also the typical size of the others. */
  normalLargestShare: 0.12,
  /** Max annual fee turnover per circulating CLD. If an exogenous CLD/USD path implies more, the
   *  path is lifted to the level that keeps velocity at this cap (burn needs CLD that exists). */
  velocityCap: 10,
  /** Job size: MMAC per job (≈ one verifier check and one treasury round-up per job). */
  mmacPerJob: 1e9,
};

interface ProviderClass {
  id: string;
  label: string;
  mmacPerSec: number; // effective verified matmul throughput
  busyW: number;
  idleW: number; // incremental power while online but idle
  usdPerKwh: number;
  fixedUsdMonth: number; // amortization / hosting; 0-ish for already-owned home hardware
  n0: number;
  nFloor: number; // hobbyists that stay regardless
  maxGrowth: number; // per month
}

const PROVIDERS: ProviderClass[] = [
  { id: "homeGpu", label: "Home GPU (RTX 4090 class)", mmacPerSec: 4e7, busyW: 350, idleW: 20, usdPerKwh: 0.15, fixedUsdMonth: 5, n0: 50, nFloor: 5, maxGrowth: 0.1 },
  { id: "dcGpu", label: "Datacenter GPU (H100 class)", mmacPerSec: 4e8, busyW: 910, idleW: 150, usdPerKwh: 0.08, fixedUsdMonth: 900, n0: 5, nFloor: 1, maxGrowth: 0.15 },
  { id: "cpu", label: "Home CPU", mmacPerSec: 5e5, busyW: 120, idleW: 15, usdPerKwh: 0.15, fixedUsdMonth: 0, n0: 200, nFloor: 10, maxGrowth: 0.1 },
];

type BudgetMode = "decided" | "chainCap" | "noFloor";

interface Scenario {
  key: string;
  label: string;
  /** Annual demand multiplier for year index y (0-based). */
  demandGrowth: (y: number) => number;
  /** Exogenous CLD/USD at month m (before the velocity floor). */
  cldUsd: (m: number) => number;
  demandStopsAtMonth?: number;
  largestShare?: number;
  rho?: number;
  budgetMode?: BudgetMode;
  protocolWork?: boolean;
}

const flat = () => ASSUME.cldUsd0;
const baseGrowth = (y: number) => (y < 3 ? 2 : 1.4);

const SCENARIOS: Scenario[] = [
  { key: "bear", label: "Bear — demand +20 %/yr, CLD/USD −10 %/yr for 5 yr then flat", demandGrowth: () => 1.2, cldUsd: (m) => ASSUME.cldUsd0 * 0.9 ** Math.min(m / 12, 5) },
  { key: "base", label: "Base — demand 2×/yr for 3 yr then +40 %/yr, CLD/USD flat", demandGrowth: baseGrowth, cldUsd: flat },
  { key: "bull", label: "Bull — demand 3×/yr for 3 yr then +60 %/yr, CLD/USD +30 %/yr for 6 yr then flat", demandGrowth: (y) => (y < 3 ? 3 : 1.6), cldUsd: (m) => ASSUME.cldUsd0 * 1.3 ** Math.min(m / 12, 6) },
  { key: "noDemand", label: "Stress — base demand, then zero from month 25", demandGrowth: baseGrowth, cldUsd: flat, demandStopsAtMonth: 24 },
  { key: "dominance", label: "Stress — base, one operator holds 60 % of capacity", demandGrowth: baseGrowth, cldUsd: flat, largestShare: 0.6 },
];

const SENSITIVITIES: Scenario[] = [
  { key: "base_rho050", label: "Base, ρ = 0.5", demandGrowth: baseGrowth, cldUsd: flat, rho: 0.5 },
  { key: "base_rho100", label: "Base, ρ = 1.0", demandGrowth: baseGrowth, cldUsd: flat, rho: 1.0 },
  { key: "base_nofloor", label: "Base, no 1 % floor on the budget", demandGrowth: baseGrowth, cldUsd: flat, budgetMode: "noFloor" },
  { key: "base_chaincap", label: "Base, budget = chain allowance only (no 4 % cap, halving or floor)", demandGrowth: baseGrowth, cldUsd: flat, budgetMode: "chainCap" },
  { key: "base_rho100_chaincap", label: "Base, ρ = 1.0 and chain allowance only", demandGrowth: baseGrowth, cldUsd: flat, rho: 1.0, budgetMode: "chainCap" },
  { key: "noDemand_protocol", label: "No-demand + protocol work on idle capacity (design §5, not in ledger)", demandGrowth: baseGrowth, cldUsd: flat, demandStopsAtMonth: 24, protocolWork: true },
];

// ═══════════════════════════════════════════════════════════════════════════
// MODEL
// ═══════════════════════════════════════════════════════════════════════════

interface Month {
  m: number;
  demandMmac: number;
  servedMmac: number;
  capMmac: number;
  u: number;
  p: number; // µCLD / MMAC, hour-averaged
  cldUsd: number;
  velocityFloorBinding: boolean;
  fee: number; // CLD burned (accrued)
  laneA: number;
  treasury: number;
  laneB: number;
  protocol: number; // protocol-work mint (lane B budget)
  budget: number; // lane B budget for the month
  chainAllowance: number; // on-chain cap for the month
  nMinOk: boolean;
  dominantGated: boolean;
  laneBWithheld: number; // lane B the dominant operator did not receive because of the per-operator gate
  settledMint: number;
  settledBurn: number;
  supply: number;
  treasuryBal: number;
  revUsd: number;
  costUsd: number;
  verifierCredits: number;
  washBound: number;
  washProfitPerFee: number; // expected profit of the largest operator per 1 CLD of self-paid fee
  fleet: Record<string, number>;
}

interface Year {
  year: number;
  supply: number;
  minted: number; // settled A + B + treasury + protocol
  mintedA: number;
  mintedB: number;
  mintedTreasury: number;
  burned: number;
  netInflationPct: number;
  mintOverStartPct: number; // gross mint ÷ supply at year start (the token's annual mint ceiling is 10 %)
  roundUpSharePct: number; // treasury round-up ÷ fees; above 2 % the on-chain 98 % post check fails
  treasury: number;
  providerMarginPct: number;
  subsidySharePct: number;
  price: number;
  cldUsd: number;
  utilization: number;
  feesUsd: number;
  velocity: number;
  budgetUsedPct: number;
  laneBWithheld: number;
  verifierCredits: number;
  washProfitPerFee: number;
  washBound: number;
  velocityFloorMonths: number;
}

function chainRate(y: number): number {
  return Math.max(PROTOCOL.chainRateFloor, PROTOCOL.chainRateInitial * PROTOCOL.chainRateDecay ** y);
}

/** Annual lane-B budget for year index y at the current supply. */
function budgetAnnual(y: number, supply: number, mode: BudgetMode): number {
  const chain = supply * chainRate(y);
  if (mode === "chainCap") return chain;
  const policy = Math.min(chain, ASSUME.genesisSupply * PROTOCOL.budgetGenesisFraction) * 0.5 ** Math.floor(y / PROTOCOL.budgetHalvingYears);
  return mode === "noFloor" ? policy : Math.max(policy, supply * PROTOCOL.budgetFloorOfSupply);
}

/** Crude cluster count from the largest operator's share: one dominant operator plus typical-size others. */
function clusterCount(largest: number): number {
  return 1 + Math.ceil((1 - largest) / Math.min(largest, ASSUME.normalLargestShare));
}

const EPS = 1e-6;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`SANITY CHECK FAILED: ${msg}`);
}

const ucldPerMmacToNcldPerTmac = 1e9; // ×1e3 nCLD/µCLD × 1e6 MMAC/TMAC

function simulate(sc: Scenario): { months: Month[]; years: Year[] } {
  const rho = sc.rho ?? PROTOCOL.rho;
  assert(rho <= 1, `ρ must be ≤ 1 (got ${rho})`);
  const largest = sc.largestShare ?? ASSUME.normalLargestShare;
  const budgetMode = sc.budgetMode ?? "decided";
  const lagA = PROTOCOL.laneALagDays / DAYS_PER_MONTH;
  const lagB = PROTOCOL.laneBLagDays / DAYS_PER_MONTH;
  const { uLow, uHigh, gain, maxStep, emaHours, floorOfEma, ceilingOfEma } = PROTOCOL.ctrl;

  const fleet: Record<string, number> = Object.fromEntries(PROVIDERS.map((c) => [c.id, c.n0]));
  const negStreak: Record<string, number> = Object.fromEntries(PROVIDERS.map((c) => [c.id, 0]));
  let p = PROTOCOL.launchPriceNcldPerTmac / ucldPerMmacToNcldPerTmac; // µCLD/MMAC
  let ema = p;
  let supply = ASSUME.genesisSupply;
  let treasuryBal = 0;
  let demandAtRef = ASSUME.demandUsd0PerMonth / ASSUME.refUsdPerMmac; // MMAC / month
  let prevA = 0; // previous month's accrued lane A + treasury (post with the burn at T+24 h)
  let prevB = 0; // previous month's accrued lane B + protocol (7 d vest)
  let prevBurn = 0;
  let prevTreasury = 0;
  let prevFeesUsd = 0;
  let cumMint = 0;
  let cumBurn = 0;
  const months: Month[] = [];

  for (let m = 0; m < MONTHS; m++) {
    const y = Math.floor(m / 12);
    if (m > 0) demandAtRef *= sc.demandGrowth(y) ** (1 / 12);
    const demandOn = sc.demandStopsAtMonth === undefined || m < sc.demandStopsAtMonth;

    // CLD/USD: exogenous path, lifted only if the burn would need more CLD than can circulate.
    const path = sc.cldUsd(m);
    const floor = (12 * prevFeesUsd) / (ASSUME.velocityCap * supply);
    const cldUsd = Math.max(path, floor);

    // Market clearing hour by hour at the controller's price p (demand and capacity uniform within the month).
    const capByClass = PROVIDERS.map((c) => fleet[c.id] * c.mmacPerSec * SEC_PER_MONTH);
    const cap = capByClass.reduce((a, b) => a + b, 0);
    const capHour = cap / HOURS;
    const demandRefHour = demandOn ? demandAtRef / HOURS : 0;
    let demand = 0;
    let served = 0;
    let fee = 0;
    let pSum = 0;
    for (let h = 0; h < HOURS; h++) {
      const usdPerMmac = (p / 1e6) * cldUsd;
      const dem = demandOn ? demandRefHour * (usdPerMmac / ASSUME.refUsdPerMmac) ** -ASSUME.demandElasticity : 0;
      const srv = Math.min(dem, capHour);
      demand += dem;
      served += srv;
      fee += (srv * p) / 1e6;
      pSum += p;
      // Controller: hold when nothing was served; else a bounded step toward the utilization band; EMA bounds.
      if (srv > 0) {
        const uH = capHour > 0 ? srv / capHour : 0;
        const err = uH > uHigh ? uH - uHigh : uH < uLow ? uH - uLow : 0;
        p *= Math.min(1 + maxStep, Math.max(1 - maxStep, 1 + gain * err));
        p = Math.min(ceilingOfEma * ema, Math.max(floorOfEma * ema, p));
      }
      ema += (p - ema) / emaHours;
    }
    const u = cap > 0 ? served / cap : 0;
    const pAvg = pSum / HOURS;

    // Fees and lanes (accrued this month).
    const jobs = served / ASSUME.mmacPerJob;
    const laneA = fee * PROTOCOL.laneA;
    const treasury = fee * PROTOCOL.treasury + (jobs * PROTOCOL.treasuryRoundUpUcldPerJob) / 1e6;
    const chainAllowance = (supply * chainRate(y) / 365) * EPOCHS_PER_MONTH;
    const budget = (budgetAnnual(y, supply, budgetMode) / 365) * EPOCHS_PER_MONTH;
    assert(budget <= chainAllowance + EPS, `month ${m}: policy budget ${budget} > chain allowance ${chainAllowance}`);
    // Per-operator cluster gate (IMPL_SPEC §Subsidy): < N_MIN clusters → no lane B at all; an operator above S_CAP
    // loses only its own lane B.
    const nMinOk = clusterCount(largest) >= PROTOCOL.clusterNMin;
    const dominantGated = largest > PROTOCOL.clusterSCap;
    const eligibleFee = fee * (1 - ASSUME.hostingShare);
    const eligibleShare = nMinOk ? (dominantGated ? 1 - largest : 1) : 0;
    const laneB = Math.min(rho * eligibleFee * eligibleShare, budget);
    const laneBWithheld = nMinOk && dominantGated ? Math.min(rho * eligibleFee, budget) - laneB : 0;

    let protocol = 0;
    if (sc.protocolWork) {
      const idleUnits = Math.max(0, cap - served);
      const protoValue = (idleUnits * pAvg * PROTOCOL.protocolWorkPriceFactor) / 1e6;
      protocol = Math.max(0, Math.min(protoValue, chainAllowance * PROTOCOL.protocolWorkAllowanceShare, budget - laneB));
    }
    assert(laneB + protocol <= budget + EPS, `month ${m}: subsidy ${laneB + protocol} > budget ${budget}`);
    // On-chain: totalLaneA + treasuryAmount ≤ 98 % of feesBurned — the per-job round-up can exceed it by ≤ 1 µCLD/job.
    assert(laneA + treasury <= 0.98 * fee + (jobs * PROTOCOL.treasuryRoundUpUcldPerJob) / 1e6 + EPS, `month ${m}: lane A + treasury exceeds 98 % of fees beyond the round-up`);
    assert(treasury >= 0.03 * fee - EPS, `month ${m}: treasury below 3 % of fees`);

    // Settlement: lane A, treasury and the burn post at T+24 h; lane B after its 7 d vest → part of each month lands next month.
    const accruedA = laneA + treasury;
    const accruedB = laneB + protocol;
    const settledMint = (1 - lagA) * accruedA + lagA * prevA + (1 - lagB) * accruedB + lagB * prevB;
    const settledBurn = (1 - lagA) * fee + lagA * prevBurn;
    treasuryBal += (1 - lagA) * treasury + lagA * prevTreasury;
    prevA = accruedA;
    prevB = accruedB;
    prevBurn = fee;
    prevTreasury = treasury;
    supply += settledMint - settledBurn;
    cumMint += settledMint;
    cumBurn += settledBurn;
    assert(supply > 0, `month ${m}: supply went non-positive`);
    assert(Math.abs(supply - (ASSUME.genesisSupply + cumMint - cumBurn)) <= 1e-6 * supply, `month ${m}: supply ≠ genesis + Σminted − Σburned`);

    // Provider economics (capacity-weighted draw → same utilization in every class).
    const subsidyRate = fee > 0 ? (laneB + protocol) / fee : 0; // protocol work counted with lane B
    let revUsd = 0;
    let costUsd = 0;
    PROVIDERS.forEach((c, i) => {
      const n = fleet[c.id];
      const share = cap > 0 ? capByClass[i] / cap : 0;
      const rev = fee * (PROTOCOL.laneA + subsidyRate) * share * cldUsd + (fee === 0 ? protocol * share * cldUsd : 0);
      const watts = c.idleW + (c.busyW - c.idleW) * (sc.protocolWork && protocol > 0 ? Math.min(1, u + (1 - u) * 0.5) : u);
      const cost = n * ((watts * HOURS_PER_MONTH) / 1000 * c.usdPerKwh + c.fixedUsdMonth);
      revUsd += rev;
      costUsd += cost;
      const margin = rev > 0 ? (rev - cost) / rev : -1;
      if (margin > ASSUME.entryMargin) fleet[c.id] = n * (1 + Math.min(c.maxGrowth, ASSUME.entryGain * margin));
      negStreak[c.id] = margin < 0 ? negStreak[c.id] + 1 : 0;
      if (negStreak[c.id] >= ASSUME.exitAfter) fleet[c.id] = n * (1 - ASSUME.exitRate);
      fleet[c.id] = Math.max(fleet[c.id], c.nFloor);
    });

    // Wash trading: an operator with share s that self-pays 1 CLD gets back s·(laneA + ρ) if it still receives lane B.
    const washBound = 1 / (PROTOCOL.laneA + rho);
    const washProfitPerFee = largest * (PROTOCOL.laneA + (nMinOk && !dominantGated ? rho : 0)) - 1;

    prevFeesUsd = fee * cldUsd;
    months.push({
      m, demandMmac: demand, servedMmac: served, capMmac: cap, u, p: pAvg,
      cldUsd, velocityFloorBinding: floor > path, fee, laneA, treasury, laneB, protocol, budget, chainAllowance,
      nMinOk, dominantGated, laneBWithheld, settledMint, settledBurn, supply, treasuryBal, revUsd, costUsd,
      verifierCredits: jobs, washBound, washProfitPerFee, fleet: { ...fleet },
    });
  }

  // Stress checks on the no-demand path: no work → no mint, and the controller holds the price.
  if (sc.demandStopsAtMonth !== undefined && !sc.protocolWork) {
    const pAtStop = months[sc.demandStopsAtMonth].p;
    for (const mo of months) {
      if (mo.m >= sc.demandStopsAtMonth) assert(mo.laneA + mo.treasury + mo.laneB + mo.protocol === 0, `no-demand: accrued mint at month ${mo.m}`);
      if (mo.m > sc.demandStopsAtMonth) assert(mo.settledMint === 0, `no-demand: settled mint at month ${mo.m}`);
      if (mo.m > sc.demandStopsAtMonth) assert(Math.abs(mo.p - pAtStop) <= EPS * pAtStop, `no-demand: price moved while idle at month ${mo.m}`);
    }
  }

  const years: Year[] = [];
  let supplyStart = ASSUME.genesisSupply;
  for (let y = 0; y < YEARS; y++) {
    const ms = months.slice(y * 12, y * 12 + 12);
    const sum = (f: (x: Month) => number) => ms.reduce((a, x) => a + f(x), 0);
    // Settled split by lane: apply each lane's lag to its accrued series.
    const settledLane = (f: (x: Month) => number, lag: number) => ms.reduce((a, x) => a + (1 - lag) * f(x) + lag * (x.m > 0 ? f(months[x.m - 1]) : 0), 0);
    const mintedA = settledLane((x) => x.laneA, lagA);
    const mintedB = settledLane((x) => x.laneB + x.protocol, lagB);
    const mintedTreasury = settledLane((x) => x.treasury, lagA);
    const minted = sum((x) => x.settledMint);
    const burned = sum((x) => x.settledBurn);
    const supplyEnd = ms[ms.length - 1].supply;
    const rev = sum((x) => x.revUsd);
    const cost = sum((x) => x.costUsd);
    const feesCld = sum((x) => x.fee);
    years.push({
      year: y + 1,
      supply: supplyEnd,
      minted,
      mintedA,
      mintedB,
      mintedTreasury,
      burned,
      netInflationPct: ((supplyEnd - supplyStart) / supplyStart) * 100,
      mintOverStartPct: (minted / supplyStart) * 100,
      roundUpSharePct: feesCld > 0 ? (sum((x) => x.treasury - PROTOCOL.treasury * x.fee) / feesCld) * 100 : 0,
      treasury: ms[ms.length - 1].treasuryBal,
      providerMarginPct: rev > 0 ? Math.max(-100, ((rev - cost) / rev) * 100) : -100,
      subsidySharePct: minted > 0 ? (mintedB / minted) * 100 : 0,
      price: sum((x) => x.p) / 12,
      cldUsd: sum((x) => x.cldUsd) / 12,
      utilization: sum((x) => x.u) / 12,
      feesUsd: sum((x) => x.fee * x.cldUsd),
      velocity: feesCld / ((supplyStart + supplyEnd) / 2),
      budgetUsedPct: sum((x) => x.budget) > 0 ? (sum((x) => x.laneB + x.protocol) / sum((x) => x.budget)) * 100 : 0,
      laneBWithheld: sum((x) => x.laneBWithheld),
      verifierCredits: sum((x) => x.verifierCredits),
      washProfitPerFee: Math.max(...ms.map((x) => x.washProfitPerFee)),
      washBound: ms[0].washBound,
      velocityFloorMonths: ms.filter((x) => x.velocityFloorBinding).length,
    });
    supplyStart = supplyEnd;
  }
  return { months, years };
}

// ═══════════════════════════════════════════════════════════════════════════
// RUN
// ═══════════════════════════════════════════════════════════════════════════

const t0 = Date.now();
const results = Object.fromEntries([...SCENARIOS, ...SENSITIVITIES].map((s) => [s.key, simulate(s)]));
const elapsed = Date.now() - t0;

// ── Formatting helpers ──
const M = (x: number) => x / 1e6;
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const sig = (x: number, d = 3) => (x === 0 ? 0 : Number(x.toPrecision(d)));
const fM = (x: number) => (Math.abs(M(x)) >= 100 ? M(x).toFixed(0) : Math.abs(M(x)) >= 1 ? M(x).toFixed(1) : M(x).toFixed(3));
const fPct = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
const fUsd = (x: number) => (x >= 1e9 ? `$${(x / 1e9).toFixed(1)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : `$${(x / 1e3).toFixed(0)}k`);
const fPrice = (ucldPerMmac: number) => Math.round(ucldPerMmac * ucldPerMmacToNcldPerTmac).toLocaleString("en-US");

// ── JSON for charts ──
const budgetText = `min(chain allowance, ${PROTOCOL.budgetGenesisFraction * 100} % of genesis)/yr, halving every ${PROTOCOL.budgetHalvingYears} yr, floor ${PROTOCOL.budgetFloorOfSupply * 100} % of supply/yr`;
const json = {
  generatedAt: new Date().toISOString(),
  note: "Simulation, not a forecast. CLD/USD is an input, not an output.",
  params: {
    genesisSupplyM: M(ASSUME.genesisSupply),
    cldUsd0: ASSUME.cldUsd0,
    rho: PROTOCOL.rho,
    laneA: PROTOCOL.laneA,
    treasury: PROTOCOL.treasury,
    burn: 1,
    netBurn: 1 - PROTOCOL.laneA - PROTOCOL.treasury,
    clusterSCap: PROTOCOL.clusterSCap,
    clusterNMin: PROTOCOL.clusterNMin,
    chainRate: "8% ×0.85/yr, 1.5% floor, × current supply",
    budget: budgetText,
    laneALagDays: PROTOCOL.laneALagDays,
    laneBLagDays: PROTOCOL.laneBLagDays,
    launchPriceNcldPerTmac: PROTOCOL.launchPriceNcldPerTmac,
    demandUsd0PerMonth: ASSUME.demandUsd0PerMonth,
    demandElasticity: ASSUME.demandElasticity,
    hostingShare: ASSUME.hostingShare,
    targetUtilization: [PROTOCOL.ctrl.uLow, PROTOCOL.ctrl.uHigh],
    ctrlMaxStepPerHour: PROTOCOL.ctrl.maxStep,
    velocityCap: ASSUME.velocityCap,
  },
  scenarios: Object.fromEntries(
    SCENARIOS.map((s) => {
      const ys = results[s.key].years;
      return [
        s.key,
        {
          label: s.label,
          years: ys.map((y) => y.year),
          supplyM: ys.map((y) => r1(M(y.supply))),
          mintedM: ys.map((y) => sig(M(y.minted))),
          burnedM: ys.map((y) => sig(M(y.burned))),
          subsidyM: ys.map((y) => sig(M(y.mintedB))),
          netInflationPct: ys.map((y) => r2(y.netInflationPct)),
          treasuryM: ys.map((y) => sig(M(y.treasury))),
          providerMarginPct: ys.map((y) => r1(y.providerMarginPct)),
          subsidySharePct: ys.map((y) => r1(y.subsidySharePct)),
          priceNcldPerTmac: ys.map((y) => sig(y.price * ucldPerMmacToNcldPerTmac)),
          cldUsd: ys.map((y) => sig(y.cldUsd)),
        },
      ];
    }),
  ),
};

// ── Markdown report ──
const assumptionsRows: [string, string, string][] = [
  ["Fee F", "burned 100 %; 2 % of it is never re-minted", "IMPL_SPEC §Fee split, Settlement v2 finalize"],
  ["Lane A", `${PROTOCOL.laneA}·F to the provider`, "LANE_A_PER_MILLE = 950"],
  ["Treasury", `${PROTOCOL.treasury}·F, rounded up per job (≤ ${PROTOCOL.treasuryRoundUpUcldPerJob} µCLD/job; jobs ≈ ${ASSUME.mmacPerJob.toExponential(0)} MMAC)`, "TREASURY_PER_MILLE = 30; on-chain treasury ≥ 3 %"],
  ["Lane B", `min(ρ·F, remaining epoch budget), ρ = ${PROTOCOL.rho}, only σ-assigned work; hosting excluded`, "SUBSIDY_RHO"],
  ["Hosting", `${ASSUME.hostingShare * 100}% of demand; lane A + treasury only`, "recordHostingRewards"],
  ["Cluster gate", `per operator: an operator above S_CAP = ${PROTOCOL.clusterSCap} of eligible work loses only its own lane B; fewer than N_MIN = ${PROTOCOL.clusterNMin} clusters → no lane B for anyone (mainnet values; testnet 0.5 / 3)`, "IMPL_SPEC §Subsidy & cluster gate, DECISIONS table"],
  ["Chain allowance", "supply × rate/365 per day; 8 % ×0.85/yr, 1.5 % floor", "CloudanaSettlement.allowance"],
  ["Lane-B budget", budgetText, "DECISIONS table — Subsidy (before mainnet)"],
  ["Price controller", `hourly; hold when served = 0; else p·clamp(1 + e, ${1 - PROTOCOL.ctrl.maxStep}, ${1 + PROTOCOL.ctrl.maxStep}) toward utilization [${PROTOCOL.ctrl.uLow}, ${PROTOCOL.ctrl.uHigh}]; floor ${PROTOCOL.ctrl.floorOfEma}× and ceiling ${PROTOCOL.ctrl.ceilingOfEma}× the 30-day EMA`, "IMPL_SPEC §Price controller"],
  ["Launch price", `${PROTOCOL.launchPriceNcldPerTmac.toLocaleString("en-US")} nCLD/TMAC (≈ the H100 reference at $${ASSUME.cldUsd0}/CLD)`, "DECISIONS table — Price unit"],
  ["Epochs / settlement", `24 h epochs + 24 h veto: lane A, treasury and the burn post ${PROTOCOL.laneALagDays} d after accrual; lane B vests 7 d (${PROTOCOL.laneBLagDays} d)`, "DECISIONS table — Epochs"],
  ["Verifiers", "credits (points) only, never CLD", "recordVerifyCredit"],
  ["Genesis supply", `${M(ASSUME.genesisSupply)}M CLD at mainnet (allocations and vesting not modelled)`, "owner decision #3"],
  ["CLD/USD", `$${ASSUME.cldUsd0} at t = 0; path per scenario; lifted only if fees would exceed ${ASSUME.velocityCap}× supply per year`, "exogenous input"],
  ["Demand", `$${ASSUME.demandUsd0PerMonth.toLocaleString("en-US")}/month at the reference price in month 1; elasticity ${ASSUME.demandElasticity}`, "assumption"],
  ["Reference price", `${ASSUME.refUsdPerMmac.toExponential(2)} $/MMAC (H100 ≈ $2/h at 4·10¹⁴ MAC/s)`, "assumption"],
  ["Providers", PROVIDERS.map((c) => `${c.label}: ${c.mmacPerSec.toExponential(0)} MMAC/s, ${c.busyW} W, $${c.usdPerKwh}/kWh, $${c.fixedUsdMonth}/mo fixed, start ${c.n0}`).join("; "), "assumption"],
  ["Entry / exit", `grow ≤ class max/month when margin > ${ASSUME.entryMargin * 100}%; −${ASSUME.exitRate * 100}%/month after ${ASSUME.exitAfter} months of negative margin`, "assumption"],
  ["Largest operator", `${ASSUME.normalLargestShare * 100}% of capacity (60 % in the dominance stress); cluster count ≈ 1 + (1 − largest) ÷ ${ASSUME.normalLargestShare}`, "assumption"],
];

function yearTable(key: string, extra?: "gate"): string {
  const ys = results[key].years;
  const pick = ys.filter((y) => [1, 2, 3, 4, 5, 7, 10, 12, 15, 20].includes(y.year));
  const head = ["Yr", "Supply M", "Minted M", "Burned M", "Net infl.", "Mint ÷ supply", "Treasury cum. M", "Prov. margin", "Subsidy share", "Budget used", "p nCLD/TMAC", "CLD/USD", "Fees $/yr", "Util."];
  if (extra === "gate") head.push("Lane B withheld from the 60 % operator M");
  const rows = pick.map((y) => {
    const row = [
      String(y.year), fM(y.supply), fM(y.minted), fM(y.burned), `${fPct(y.netInflationPct)}${y.roundUpSharePct > 2 ? "†" : ""}`, `${y.mintOverStartPct.toFixed(0)}%`, fM(y.treasury),
      `${y.providerMarginPct.toFixed(0)}%`, `${y.subsidySharePct.toFixed(1)}%`, `${y.budgetUsedPct.toFixed(0)}%`,
      fPrice(y.price), `${y.cldUsd.toFixed(3)}${y.velocityFloorMonths ? "*" : ""}`, fUsd(y.feesUsd), y.utilization.toFixed(2),
    ];
    if (extra === "gate") row.push(fM(y.laneBWithheld));
    return `| ${row.join(" | ")} |`;
  });
  return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows].join("\n");
}

const Y = (key: string, year: number) => results[key].years[year - 1];
const firstYear = (key: string, f: (y: Year) => boolean) => results[key].years.find(f)?.year;
const sumYears = (key: string, f: (y: Year) => number) => results[key].years.reduce((a, y) => a + f(y), 0);

const deflationYearBase = firstYear("base", (y) => y.netInflationPct < 0);
const deflationYearBull = firstYear("bull", (y) => y.netInflationPct < 0);
const deflationYearBear = firstYear("bear", (y) => y.netInflationPct < 0);
const budgetBindsBase = firstYear("base", (y) => y.budgetUsedPct > 99);
const floorYearBase = firstYear("base", (y) => y.velocityFloorMonths > 0);
const floorYearBull = firstYear("bull", (y) => y.velocityFloorMonths > 0);
const floorYearBear = firstYear("bear", (y) => y.velocityFloorMonths > 0);
const mintCapYearBase = firstYear("base", (y) => y.mintOverStartPct > 10);
const mintCapYearBull = firstYear("bull", (y) => y.mintOverStartPct > 10);
const mintCapYearBear = firstYear("bear", (y) => y.mintOverStartPct > 10);
const roundUpYearBase = firstYear("base", (y) => y.roundUpSharePct > 2);
const roundUpYearBull = firstYear("bull", (y) => y.roundUpSharePct > 2);
const roundUpYearBear = firstYear("bear", (y) => y.roundUpSharePct > 2);
const domWithheld = sumYears("dominance", (y) => y.laneBWithheld);
const domB = sumYears("dominance", (y) => y.mintedB);
const baseB = sumYears("base", (y) => y.mintedB);
const protoY3 = Y("noDemand_protocol", 3);
const protoCum = sumYears("noDemand_protocol", (y) => (y.year >= 3 ? y.mintedB : 0));
const protoCapY3 = results.noDemand_protocol.months.slice(24, 36).reduce((a, x) => a + x.chainAllowance, 0) * PROTOCOL.protocolWorkAllowanceShare;
const pAtStop = results.noDemand.months[24].p;
const minSupply = (key: string) => Math.min(...results[key].years.map((y) => y.supply));

const sensRows = ["base", ...SENSITIVITIES.filter((s) => s.key.startsWith("base_")).map((s) => s.key)].map((k) => {
  const y5 = Y(k, 5), y10 = Y(k, 10), y20 = Y(k, 20);
  const label = k === "base" ? "Base (decided: ρ = 0.25, min(chain, 4 %) halving, 1 % floor)" : SENSITIVITIES.find((s) => s.key === k)!.label;
  return `| ${label} | ${fM(y5.supply)} / ${fM(y10.supply)} / ${fM(y20.supply)} | ${fPct(y5.netInflationPct)} / ${fPct(y10.netInflationPct)} / ${fPct(y20.netInflationPct)} | ${y5.subsidySharePct.toFixed(1)}% / ${y10.subsidySharePct.toFixed(1)}% | ${y5.providerMarginPct.toFixed(0)}% / ${y10.providerMarginPct.toFixed(0)}% | ${(y5.washBound * 100).toFixed(1)}% |`;
});

const headlineRows = (["base", "bull", "bear"] as const).flatMap((k) =>
  [1, 5, 10, 20].map((yr) => {
    const y = Y(k, yr);
    return `| ${k} | ${yr} | ${fM(y.supply)} | ${fPct(y.netInflationPct)}${y.roundUpSharePct > 2 ? "†" : ""} | ${fM(y.treasury)} | ${y.providerMarginPct.toFixed(0)}% | ${y.subsidySharePct.toFixed(1)}% | ${y.mintOverStartPct.toFixed(0)}% | ${y.cldUsd.toFixed(3)}${y.velocityFloorMonths ? "*" : ""} |`;
  }),
);

const today = new Date().toISOString().slice(0, 10);

const md = `# CLD tokenomics — 20-year simulation of the two-lane mint (decided parameters)

Generated by \`npx tsx scripts/sim/tokenomics-20y.ts\` (${today}). Data for charts:
\`client/src/data/tokenomics-sim.json\`. Page: \`client/src/pages/console/economics.tsx\`.

Parameters are the owner-approved values of [DECISIONS_CONSENSUS.md](DECISIONS_CONSENSUS.md) ("before mainnet"
column) and [IMPL_SPEC_2026-10.md](IMPL_SPEC_2026-10.md): 95 / 3 / 2 fee split, 100M genesis, ρ = 0.25,
budget min(chain allowance, 4 % of genesis) halving every 4 yr with a 1 % floor, per-operator cluster gate
(N_MIN 5, S_CAP 0.34), hourly ±2 % price controller that holds when idle, 24 h epochs. The 2026-10-01 run on the
pre-decision values (97.5 / 0.5, 250M, all-or-nothing gate, monthly ±12.5 % controller without a floor) is
superseded by this file; section 7 summarises what changed.

> **Simulation, not a forecast. CLD/USD is an input, not an output.** Demand paths are scenarios, not predictions.
> The legacy sims in \`client/scripts-dev/\` model an obsolete block-reward/halving design; nothing here reuses their constants.

## 1. What is simulated

Monthly steps for 20 years (240) for demand, fleet and settlement; the price controller runs hourly inside each
month. Users demand paid work (MMAC of verified matmul, plus hosting); providers in three hardware classes join or
leave on their margin; the orchestrator sets one price p with the utilization controller; every fee is burned and
re-minted through lane A (95 %), the treasury (3 %, rounded up per job) and (subsidy) lane B; 2 % of every fee is
destroyed. Supply = genesis + Σminted − Σburned (asserted every month).

### Assumptions

| Item | Value | Source |
|---|---|---|
${assumptionsRows.map((r) => `| ${r.join(" | ")} |`).join("\n")}

### The price controller

Each hour the orchestrator compares utilization u = served ÷ capacity with the band [${PROTOCOL.ctrl.uLow}, ${PROTOCOL.ctrl.uHigh}]:

    if served = 0: hold p
    else: e = u − ${PROTOCOL.ctrl.uHigh} if u > ${PROTOCOL.ctrl.uHigh};  u − ${PROTOCOL.ctrl.uLow} if u < ${PROTOCOL.ctrl.uLow};  else 0
          p ← clamp(p · clamp(1 + e, ${1 - PROTOCOL.ctrl.maxStep}, ${1 + PROTOCOL.ctrl.maxStep}), ${PROTOCOL.ctrl.floorOfEma}·EMA₃₀d, ${PROTOCOL.ctrl.ceilingOfEma}·EMA₃₀d)

At ±2 %/h the controller can move p by ~10× in a few days, so within a month it finds the price that keeps
utilization in the band whenever one exists; the EMA bounds limit how far it can run from its 30-day average.
Demand reacts to the USD price p·(CLD/USD) with elasticity ${ASSUME.demandElasticity}. The tables show the hour-averaged p.

## 2. Results by scenario (selected years)

\`*\` on CLD/USD = the exogenous path was lifted that year because fees would otherwise have exceeded
${ASSUME.velocityCap}× circulating supply (the burn needs CLD that exists; in reality the price would have to rise).
\`†\` on net inflation = the per-job treasury round-up exceeded 2 % of fees that year (per-job fees had fallen below
~50 µCLD), so the on-chain 98 % post check would have rejected those epochs — the number is the arithmetic of the
rule, not something the contract would let happen (finding 8). "Budget used" = lane B ÷ lane-B budget.
"Mint ÷ supply" = gross CLD minted in the year ÷ supply at the start of the year (CLDToken v2 caps this at 10 % —
see finding 3). "Treasury cum." = cumulative treasury income; it is never spent in the sim, and fees are drawn from
total supply, so it can exceed circulating supply late in bull. Margin = (provider revenue − power and fixed cost) ÷
revenue, fleet-wide.

${SCENARIOS.map((s) => `### ${s.label}\n\n${yearTable(s.key, s.key === "dominance" ? "gate" : undefined)}\n`).join("\n")}

### Sensitivities (base demand and price)

| Variant | Supply M (y5 / y10 / y20) | Net inflation (y5 / y10 / y20) | Subsidy share (y5 / y10) | Margin (y5 / y10) | Wash bound s* |
|---|---|---|---|---|---|
${sensRows.join("\n")}

No-demand with protocol work on idle capacity (design §5 / UNIVERSAL_POUW §5 — *not* in the ledger): with
zero paid work it mints ${fM(protoY3.mintedB)}M CLD in year 3 (its cap, 25 % of the chain allowance, is ${fM(protoCapY3)}M; the rest is
lane B from month 24 landing after its vest) and ${fM(protoCum)}M over years 3–20 (0 without it). Because the controller now holds p
when idle, protocol work is priced at the last live price and fills its cap, unlike the pre-decision run where p decayed to nothing.

## 3. Findings

1. **The mint is a fee rebate, not a bootstrap.** Lane B is at most ρ·F, so with no fees there is no subsidy. Net
   supply change is (ρ·eligible − 0.02)·F whenever the budget is not binding, i.e. about +${((PROTOCOL.rho * (1 - ASSUME.hostingShare) - 0.02) * 100).toFixed(1)} % of fees; base
   year 1 adds ${fPct(Y("base", 1).netInflationPct)} to supply. Providers' margin is set by fees and the price controller, not by
   emission; the subsidy adds ${(PROTOCOL.rho * (1 - ASSUME.hostingShare) * 100).toFixed(0)} % to eligible revenue while the budget lasts.
2. **The 2 % net burn beats the subsidy once the budget binds.** Net = B − 0.02·F; with the budget at 4 % of genesis
   the budget binds in base from year ${budgetBindsBase ?? "—"} and supply turns down in year ${deflationYearBase ?? "never"} (bull ${deflationYearBull ?? "never"}, bear ${deflationYearBear ?? "never"}).
   Base supply: ${fM(Y("base", 5).supply)}M (y5), ${fM(Y("base", 10).supply)}M (y10), ${fM(Y("base", 20).supply)}M (y20); the 1 % floor keeps the late budget at
   ≈ 1 % of supply, so the long-run net rate is ≈ 1 % − 0.02·V where V is fee velocity.
3. **The on-token 10 % annual mint ceiling is incompatible with burn-and-remint at any real volume.** Gross mint is
   ≈ 0.98·F + B, so the ceiling (\`MAX_MINT_BPS_PER_YEAR = 1000\`, IMPL_SPEC §Settlement v2) is hit as soon as annual
   fees exceed ~10 % of supply: base year ${mintCapYearBase ?? "—"}, bull year ${mintCapYearBull ?? "—"}, bear year ${mintCapYearBear ?? "—"}. The sim does not
   enforce it (it would stop lane A payouts, not just the subsidy). Either the ceiling must exclude fee-backed mint
   (count only lane B, or mint − burn) or it must be raised far above 10 %.
4. **100M genesis makes the velocity cap bind earlier.** The same USD demand now turns over a 2.5× smaller supply:
   fees reach ${ASSUME.velocityCap}× supply per year in base year ${floorYearBase ?? "—"} (bull ${floorYearBull ?? "—"}, bear ${floorYearBear ?? "—"}) and the sim lifts CLD/USD to keep
   the burn physical. Late-year supply figures in base and bull are therefore driven by the velocity cap, not by the
   price path: at V = ${ASSUME.velocityCap} the net burn is 20 % of supply a year against a 1 % floor budget. Minimum supply over
   the 20 years: base ${fM(minSupply("base"))}M, bull ${fM(minSupply("bull"))}M, bear ${fM(minSupply("bear"))}M.
5. **No work, no mint — and the price now holds.** After demand stops, minting is exactly 0 (asserted) and p stays at
   ${fPrice(pAtStop)} nCLD/TMAC for 18 years (asserted) instead of decaying to nothing. The cost is
   that a *trickle* of demand still walks the price down: below the band the controller steps −2 %/h and the EMA
   floor follows it with a 30-day lag, so months of low utilization can cut p ~10× per month until provider
   floors are reported.
6. **The per-operator gate works as intended.** With one operator at 60 %, only that operator loses lane B: the other
   40 % still received ${fM(domB)}M CLD over 20 years (base pays ${fM(baseB)}M; the dominant operator forwent ${fM(domWithheld)}M). Wash trading is
   unprofitable for it (it gets back 0.95 of each self-paid CLD); for an operator *below* S_CAP the bound is
   s* = ${(Y("base", 1).washBound * 100).toFixed(1)} % of eligible work, well above the 34 % cap — so with N_MIN 5 / S_CAP 0.34 no single operator can wash-trade
   lane B at a profit. The crude cluster count (1 + others of 12 %) passes N_MIN = 5 in every scenario here.
7. **Treasury is meaningful now.** 3 % of fees (plus the per-job round-up, ${Y("base", 1).roundUpSharePct.toFixed(3)} % of fees in base year 1 at ${ASSUME.mmacPerJob.toExponential(0)} MMAC/job)
   accrues ${fM(Y("base", 5).treasury)}M CLD by year 5 and ${fM(Y("base", 10).treasury)}M by year 10 in base (${fM(Y("bull", 10).treasury)}M in bull) — a real budget for the free tier,
   verifier rewards and audits, and the "overfunds if CLD prices well above $0.10" dissent is visible in bull.
8. **Per-job integer rounding is not scale-free.** floor(0.95F) + ceil(0.03F) exceeds 0.98F by up to 1 µCLD on most
   jobs (F = 1001 µCLD → 950 + 31 = 981 > 980.98), and \`postEpoch\` requires totalLaneA + treasuryAmount ≤ feesBurned × 9800 / 10000.
   At launch that is ${Y("base", 1).roundUpSharePct.toFixed(3)} % of fees — a tolerance problem. But the round-up is fixed in µCLD while the fee per job falls as
   CLD/USD rises: once a ${ASSUME.mmacPerJob.toExponential(0)} MMAC job costs under 50 µCLD the round-up alone exceeds the 2 % net burn (bull year
   ${roundUpYearBull ?? "never"}, base ${roundUpYearBase ?? "never"}, bear ${roundUpYearBear ?? "never"}; marked † in the tables), the treasury takes > 5 % of fees, no epoch can
   pass the 98 % check, and the arithmetic turns net-inflationary (bull year 20: ${fPct(Y("bull", 20).netInflationPct)}). The 1 000 µCLD base
   fee has the same shape, 1 000× larger. The sim asserts the 98 % bound only with the round-up tolerance.

## 4. Risks

- Mint ceiling: \`MAX_MINT_BPS_PER_YEAR = 10 %\` would freeze provider payouts in base year ${mintCapYearBase ?? "—"} (finding 3).
- Velocity: a flat CLD/USD is inconsistent with the demand paths from year ${floorYearBase ?? "—"} in base; every late-year supply number
  depends on the price rising, which the sim imposes rather than explains (finding 4).
- Deflation spiral: at high velocity the 2 % net burn removes up to 20 % of supply a year; the 1 % floor budget only
  offsets a twentieth of that. The dissent note ("unnecessary emission if velocity stays low") cuts the other way at high velocity.
- Low-utilization price slide: hold-when-idle protects against *zero* demand, not against *thin* demand (finding 5).
- Lane B pays nothing when the network needs it most (thin demand) and is a fixed 21 % rebate on eligible fees when it doesn't.
- Fixed µCLD amounts per job (treasury round-up, base fee) dominate the fee once CLD appreciates ~100× at the
  decided job price; the round-up alone breaks the 98 % post check by ≤ 1 µCLD per leaf at launch and by > 2 % of
  fees in bull year ${roundUpYearBull ?? "—"} (finding 8).
- Protocol work on idle capacity, if ever enabled, mints up to 25 % of the chain allowance with no paying user.
- Exogenous CLD/USD: every USD-denominated conclusion (provider margin, entry) moves with it one-for-one.
- The cluster count is a crude function of the largest share; real sybil structure is not modelled.

## 5. Recommendations for the owner

1. **Fix the mint ceiling before the contract is written:** apply \`MAX_MINT_BPS_PER_YEAR\` to lane B (or to mint − burn),
   not to the fee-backed re-mint, or the first busy year on mainnet stops paying providers.
2. **Settle the rounding rule and make it scale-free:** either floor the treasury with an on-chain
   \`treasury ≥ 3 % − 1 µCLD/leaf\` tolerance, or round up and relax the 98 % check by the same amount — and give the
   ledger a plan (re-denominate µCLD → nCLD, or re-base the job size) for the day a job costs < 1 000 µCLD, since the
   base fee and the round-up are fixed amounts. Document it in IMPL_SPEC.
3. **ρ schedule:** keep ρ = 0.25 until ≥ 10 clusters with the largest ≤ 30 % (as decided). Raising ρ adds inflation
   without changing who joins (y5 margin ${Y("base", 5).providerMarginPct.toFixed(0)} % → ${Y("base_rho050", 5).providerMarginPct.toFixed(0)} % at ρ = 0.5, identical once the budget binds).
4. **Revisit the 1 % floor with data, not now:** at low velocity it is ≈ 1 %/yr of emission for nothing (sensitivity
   "no floor": y20 supply ${fM(Y("base_nofloor", 20).supply)}M vs ${fM(Y("base", 20).supply)}M); at high velocity it does not stop deflation. Governance can zero it.
5. **Provider price floors** should replace the 0.1×EMA floor as soon as nodes report them, so thin demand cannot
   walk the price below cost.

## 6. What this simulation does NOT capture

- CLD/USD formation (exogenous by design), market depth, speculation, staking, sell pressure from providers.
- Genesis allocations and vesting (Treasury 40 / Ecosystem 25 / Team 20 / Liquidity 10 / Testnet retro 5), the
  Ecosystem-funded datacenter bootstrap, the treasury-funded free tier.
- The base fee of 1 000 µCLD per job (job-size dependent; at ${ASSUME.mmacPerJob.toExponential(0)} MMAC/job it would add ~7 % to fees).
- The on-token 10 % mint ceiling (reported, not enforced — finding 3).
- Individual operators, sybils, or the actual wash-trade attack (only the bound and the expected profit).
- Per-epoch variance (demand is uniform within a month), the budget carry, queueing, latency, outages.
- Multiple work types with separate prices (storage, bandwidth, RAM); hosting is one MMAC-equivalent share.
- Crypto swaps at pay time, slippage pauses, chargebacks, oracle risk; gas costs; the guardian veto or clawbacks.
- Hardware price changes, new GPU generations, electricity price changes; provider fixed costs beyond one number.
- Protocol work and the verifier slice (not in the ledger) except the one no-demand sensitivity.

## 7. October 2026 rerun on decided parameters (${today})

Changes from the 2026-10-01 run: fee split 97.5 / 0.5 → 95 / 3 / 2 net burn with the treasury rounded up per job;
genesis 250M → 100M; lane-B budget 7.88 % of genesis halving → min(chain, 4 % of genesis) halving every 4 yr with a
1 % of supply floor; cluster gate all-or-nothing with N_MIN 1 → per operator with N_MIN 5 / S_CAP 0.34; price
controller monthly ±12.5 % with no floor → hourly ±2 % that holds when idle, bounded by 0.1× / 10× the 30-day EMA;
settlement lag 8 d for everything → 2 d for lane A / treasury / burn and 9 d for lane B; protocol-work sensitivity
capped at 25 % of the chain allowance. Demand, provider and CLD/USD assumptions are unchanged.

| Scenario | Year | Supply M | Net inflation | Treasury cum. M | Provider margin | Subsidy share of mint | Mint ÷ supply | CLD/USD |
|---|---|---|---|---|---|---|---|---|
${headlineRows.join("\n")}

\`*\` = CLD/USD lifted by the velocity cap that year. \`†\` = per-job treasury round-up > 2 % of fees; the on-chain
98 % check would reject those epochs, so the figure is the rule's arithmetic, not an outcome the contract allows.
Treasury is cumulative income, never spent in the sim.

Main risks, in order: (1) the 10 % on-token mint ceiling is hit in base year ${mintCapYearBase ?? "—"} and would stop lane A payouts,
not just the subsidy; (2) with 100M genesis the velocity cap binds from base year ${floorYearBase ?? "—"}, so the late-year supply
path assumes CLD/USD rises ${(Y("base", 20).cldUsd / ASSUME.cldUsd0).toFixed(0)}× in base and ${(Y("bull", 20).cldUsd / ASSUME.cldUsd0).toFixed(0)}× in bull — the deflation shown
(${fPct(Y("base", 20).netInflationPct)} in base year 20) is the 2 % net burn at V = ${ASSUME.velocityCap}, not a property of the mechanism at ordinary velocity;
(3) fixed µCLD amounts per job are not scale-free: the treasury round-up contradicts the on-chain 98 % check by
≤ 1 µCLD per leaf at launch and exceeds the whole 2 % net burn from bull year ${roundUpYearBull ?? "—"}, which is what turns bull
year 20 inflationary (${fPct(Y("bull", 20).netInflationPct)}†); the 1 000 µCLD base fee (not modelled) has the same shape; (4) hold-when-idle
does not protect the price against thin demand; (5) the subsidy is small (${Y("base", 5).subsidySharePct.toFixed(1)} % of mint in base year 5) and
cannot bootstrap supply — only paid work does.

Invariants asserted every month in every scenario: lane B + protocol ≤ budget ≤ chain allowance; lane A + treasury
≤ 98 % of fees (+ round-up); treasury ≥ 3 % of fees; supply = genesis + Σmint − Σburn; no-demand → zero mint and
a held price. All passed.
`;

// ── Write outputs ──
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const jsonPath = resolve(root, "client/src/data/tokenomics-sim.json");
const mdPath = resolve(root, "docs/TOKENOMICS_SIM_20Y.md");
mkdirSync(dirname(jsonPath), { recursive: true });
const jsonText = JSON.stringify(json);
writeFileSync(jsonPath, jsonText + "\n");
writeFileSync(mdPath, md);
assert(jsonText.length <= 60_000, `JSON is ${jsonText.length} bytes (> 60 KB)`);

// ── One-screen summary ──
console.log(`CLD 20-year simulation — ${SCENARIOS.length} scenarios + ${SENSITIVITIES.length} sensitivities in ${elapsed} ms`);
console.log("Simulation, not a forecast. CLD/USD is an input, not an output.\n");
console.log("scenario    year  supply M   net infl   minted M   burned M  treasury M  margin  subsidy%  mint/supply  CLD/USD");
for (const s of SCENARIOS) {
  for (const yr of [1, 5, 10, 20]) {
    const y = Y(s.key, yr);
    console.log(
      `${s.key.padEnd(11)} ${String(yr).padStart(4)}  ${fM(y.supply).padStart(8)}  ${fPct(y.netInflationPct).padStart(9)}  ${fM(y.minted).padStart(9)}  ${fM(y.burned).padStart(9)}  ${fM(y.treasury).padStart(10)}  ${(y.providerMarginPct.toFixed(0) + "%").padStart(6)}  ${y.subsidySharePct.toFixed(1).padStart(7)}  ${(y.mintOverStartPct.toFixed(0) + "%").padStart(11)}  ${y.cldUsd.toFixed(3)}${y.velocityFloorMonths ? "*" : ""}`,
    );
  }
}
console.log(`\nchecks passed: subsidy ≤ budget ≤ chain allowance, lane A + treasury ≤ 98 % of fees (+ round-up), treasury ≥ 3 %, supply = genesis + Σmint − Σburn, no-demand mints 0 and holds p`);
console.log(`wrote ${mdPath}\nwrote ${jsonPath} (${(jsonText.length / 1024).toFixed(1)} KB)`);
