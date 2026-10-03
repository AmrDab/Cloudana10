/**
 * Cloudana CLD — 20-year simulation of the CURRENT two-lane tokenomics.
 *
 *   npx tsx scripts/sim/tokenomics-20y.ts
 *
 * Writes docs/TOKENOMICS_SIM_20Y.md and client/src/data/tokenomics-sim.json.
 *
 * Model under test (docs/CLD_ISSUANCE_DESIGN.md §4–§6, client/api/src/services/ledger.service.ts,
 * contract/contracts/CloudanaSettlement.sol):
 *   per job with fee F (CLD):  burn F · mint 0.975F to the provider (lane A) · mint 0.005F to treasury
 *   lane B subsidy = min(ρ·F, remaining epoch budget), only for σ-assigned work whose eligible set
 *   passes the cluster test (largest payout wallet ≤ s_cap). Hosting earns lane A only.
 *   Settlement contract caps lane B per epoch at supply × rate(t) / 365, rate 8 % → ×0.85/yr → 1.5 % floor.
 *   Browser verifiers earn credits (points) — never CLD.
 *
 * This is a SIMULATION, not a forecast. CLD/USD is an exogenous input per scenario.
 * Monthly steps (240); epochs (24 h, the design's mainnet epoch) are aggregated inside a month
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
const EPOCHS_PER_MONTH = 365 / 12; // 24 h epochs (design §6)

/** Protocol constants — from ledger.service.ts / env.ts / CloudanaSettlement.sol. */
const PROTOCOL = {
  laneA: 0.975, // LANE_A_PER_MILLE
  treasury: 0.005, // TREASURY_PER_MILLE
  rho: 0.25, // SUBSIDY_RHO
  clusterSCap: 0.5, // CLUSTER_S_CAP
  clusterNMin: 1, // CLUSTER_N_MIN
  /** CloudanaSettlement.allowance: supply × rate / 365 per day. */
  chainRateInitial: 0.08,
  chainRateDecay: 0.85,
  chainRateFloor: 0.015,
  /** env EPOCH_SUBSIDY_BUDGET_UCLD = 300 000 µCLD per 120 s epoch on a 1M supply = 216 CLD/day = 7.884 %/yr of supply. */
  envBudgetAnnualFractionOfSupply: (0.3 * (86_400 / 120) * 365) / 1_000_000,
  /** Lane B vests 7 d (design §6); the ledger closes an epoch only after its last vest, then a 24 h veto. */
  settlementLagDays: 7 + 1,
  /** Config value today; shown only to contrast with the market-clearing price. */
  configPriceUcldPerMmac: 1000,
};

/** Simulation assumptions (NOT protocol constants). */
const ASSUME = {
  genesisSupply: 250_000_000, // whitepaper v2 §6.3 (~250M). CLDToken today mints 1M — owner decision #16.
  cldUsd0: 0.1, // $ per CLD at t=0 — sensitivity input only
  /** Paid work demanded at the reference price, month 1, in USD. */
  demandUsd0PerMonth: 25_000,
  /** Reference market price of GPU matmul: H100 ≈ $2/h at ≈ 4e14 MAC/s → $/MMAC. */
  refUsdPerMmac: 2 / (4e8 * 3600),
  demandElasticity: 0.7, // Q ∝ (price / ref)^-ε
  hostingShare: 0.15, // share of demand that is hosting (lane A only — never σ-proven)
  /** Price controller: multiplicative step toward a utilization band. */
  ctrl: { uLow: 0.6, uHigh: 0.8, gain: 1.0, maxStep: 0.125 },
  /** Providers: grow when margin > entryMargin, shrink after `exitAfter` months of margin < 0. */
  entryMargin: 0.15,
  entryGain: 0.5,
  exitAfter: 3,
  exitRate: 0.15,
  /** Largest single operator's capacity share in a "decentralised" network. */
  normalLargestShare: 0.12,
  /** Max annual fee turnover per circulating CLD. If an exogenous CLD/USD path implies more, the
   *  path is lifted to the level that keeps velocity at this cap (burn needs CLD that exists). */
  velocityCap: 10,
  /** Proposed lane-B budget: env value scaled to genesis supply, halving every 4 years, never above the chain cap. */
  budgetHalvingYears: 4,
  /** Verifier credits (points, not CLD): one credit per this many MMAC served (≈ one check per job). */
  mmacPerVerifierCredit: 1e9,
  /** Protocol work on idle capacity (design §5 / UNIVERSAL_POUW §5): paid at 0.5·p, ≤ 50 % of the budget.
   *  NOT implemented in ledger.service.ts — off by default, shown as a sensitivity. */
  protocolWorkPriceFactor: 0.5,
  protocolWorkBudgetShare: 0.5,
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

type BudgetMode = "proposal" | "chainCap";

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
  { key: "base_chaincap", label: "Base, budget = chain cap only (no halving policy)", demandGrowth: baseGrowth, cldUsd: flat, budgetMode: "chainCap" },
  { key: "base_rho100_chaincap", label: "Base, ρ = 1.0 and chain cap only", demandGrowth: baseGrowth, cldUsd: flat, rho: 1.0, budgetMode: "chainCap" },
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
  p: number; // µCLD / MMAC
  cldUsd: number;
  velocityFloorBinding: boolean;
  fee: number; // CLD burned (accrued)
  laneA: number;
  treasury: number;
  laneB: number;
  protocol: number; // protocol-work mint (lane B budget)
  budget: number; // lane B budget for the month
  clusterOk: boolean;
  laneBLostToGate: number; // what lane B would have paid with a per-operator gate instead of all-or-nothing
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
  treasury: number;
  providerMarginPct: number;
  subsidySharePct: number;
  price: number;
  cldUsd: number;
  utilization: number;
  feesUsd: number;
  velocity: number;
  budgetUsedPct: number;
  laneBLostToGate: number;
  verifierCredits: number;
  washProfitPerFee: number;
  washBound: number;
  velocityFloorMonths: number;
}

function chainRate(y: number): number {
  return Math.max(PROTOCOL.chainRateFloor, PROTOCOL.chainRateInitial * PROTOCOL.chainRateDecay ** y);
}

const EPS = 1e-6;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`SANITY CHECK FAILED: ${msg}`);
}

function simulate(sc: Scenario): { months: Month[]; years: Year[] } {
  const rho = sc.rho ?? PROTOCOL.rho;
  assert(rho <= 1, `ρ must be ≤ 1 (got ${rho})`);
  const largest = sc.largestShare ?? ASSUME.normalLargestShare;
  const budgetMode = sc.budgetMode ?? "proposal";
  const lag = PROTOCOL.settlementLagDays / (365 / 12);

  const fleet: Record<string, number> = Object.fromEntries(PROVIDERS.map((c) => [c.id, c.n0]));
  const negStreak: Record<string, number> = Object.fromEntries(PROVIDERS.map((c) => [c.id, 0]));
  let p = (ASSUME.refUsdPerMmac / ASSUME.cldUsd0) * 1e6; // start at the market price, in µCLD/MMAC
  let supply = ASSUME.genesisSupply;
  let treasuryBal = 0;
  let demandAtRef = ASSUME.demandUsd0PerMonth / ASSUME.refUsdPerMmac; // MMAC / month
  let prevMint = 0;
  let prevBurn = 0;
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

    // Market clearing at the orchestrator's price p.
    const capByClass = PROVIDERS.map((c) => fleet[c.id] * c.mmacPerSec * SEC_PER_MONTH);
    const cap = capByClass.reduce((a, b) => a + b, 0);
    const usdPerMmac = (p / 1e6) * cldUsd;
    const demand = demandOn ? demandAtRef * (usdPerMmac / ASSUME.refUsdPerMmac) ** -ASSUME.demandElasticity : 0;
    const served = Math.min(demand, cap);
    const u = cap > 0 ? served / cap : 0;

    // Fees and lanes (accrued this month).
    const fee = (served * p) / 1e6;
    const laneA = fee * PROTOCOL.laneA;
    const treasury = fee * PROTOCOL.treasury;
    const policyAnnual = ASSUME.genesisSupply * PROTOCOL.envBudgetAnnualFractionOfSupply * 0.5 ** Math.floor(y / ASSUME.budgetHalvingYears);
    const chainAnnual = supply * chainRate(y);
    const budgetAnnual = budgetMode === "chainCap" ? chainAnnual : Math.min(policyAnnual, chainAnnual);
    const budget = (budgetAnnual / 365) * EPOCHS_PER_MONTH;
    // Cluster test (jobs.service.ts clusterTest): all-or-nothing on the eligible set's largest wallet.
    const clusterOk = largest <= PROTOCOL.clusterSCap && 1 / largest >= PROTOCOL.clusterNMin;
    const eligibleFee = fee * (1 - ASSUME.hostingShare);
    const wanted = clusterOk ? rho * eligibleFee : 0;
    const laneB = Math.min(wanted, budget);
    // Counterfactual: withhold subsidy only from the dominant cluster's own jobs.
    const laneBLostToGate = clusterOk ? 0 : Math.min(rho * eligibleFee * (1 - largest), budget);

    let protocol = 0;
    if (sc.protocolWork) {
      const idleUnits = Math.max(0, cap - served);
      const protoValue = (idleUnits * p * ASSUME.protocolWorkPriceFactor) / 1e6;
      protocol = Math.max(0, Math.min(protoValue, budget * ASSUME.protocolWorkBudgetShare, budget - laneB));
    }
    assert(laneB + protocol <= budget + EPS, `month ${m}: subsidy ${laneB + protocol} > budget ${budget}`);
    assert(laneA + treasury <= 0.98 * fee + EPS, `month ${m}: lane A exceeds 98 % of fees`);

    // Settlement: an epoch posts after its last lane-B vest + veto window → part of each month lands next month.
    const accruedMint = laneA + treasury + laneB + protocol;
    const settledMint = (1 - lag) * accruedMint + lag * prevMint;
    const settledBurn = (1 - lag) * fee + lag * prevBurn;
    prevMint = accruedMint;
    prevBurn = fee;
    supply += settledMint - settledBurn;
    cumMint += settledMint;
    cumBurn += settledBurn;
    treasuryBal += (1 - lag) * treasury + lag * (months[m - 1]?.treasury ?? 0);
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

    // Price controller (documented in the report): step toward the utilization band.
    const pUsed = p;
    const { uLow, uHigh, gain, maxStep } = ASSUME.ctrl;
    const err = u > uHigh ? u - uHigh : u < uLow ? u - uLow : 0;
    p *= Math.min(1 + maxStep, Math.max(1 - maxStep, 1 + gain * err));

    const washBound = 1 / (PROTOCOL.laneA + rho);
    const washProfitPerFee = largest * (PROTOCOL.laneA + (clusterOk ? rho : 0)) - 1;

    prevFeesUsd = fee * cldUsd;
    months.push({
      m, demandMmac: demand, servedMmac: served, capMmac: cap, u, p: pUsed,
      cldUsd, velocityFloorBinding: floor > path, fee, laneA, treasury, laneB, protocol, budget, clusterOk,
      laneBLostToGate, settledMint, settledBurn, supply, treasuryBal, revUsd, costUsd,
      verifierCredits: served / ASSUME.mmacPerVerifierCredit, washBound, washProfitPerFee, fleet: { ...fleet },
    });
  }

  // Stress check: no work → no mint.
  if (sc.demandStopsAtMonth !== undefined && !sc.protocolWork) {
    for (const mo of months) {
      if (mo.m >= sc.demandStopsAtMonth) assert(mo.laneA + mo.treasury + mo.laneB + mo.protocol === 0, `no-demand: accrued mint at month ${mo.m}`);
      if (mo.m > sc.demandStopsAtMonth) assert(mo.settledMint === 0, `no-demand: settled mint at month ${mo.m}`);
    }
  }

  const years: Year[] = [];
  let supplyStart = ASSUME.genesisSupply;
  for (let y = 0; y < YEARS; y++) {
    const ms = months.slice(y * 12, y * 12 + 12);
    const sum = (f: (x: Month) => number) => ms.reduce((a, x) => a + f(x), 0);
    // Settled split by lane: apply the same lag to each lane's accrued series.
    const settledLane = (f: (x: Month) => number) => ms.reduce((a, x) => a + (1 - lag) * f(x) + lag * (x.m > 0 ? f(months[x.m - 1]) : 0), 0);
    const mintedA = settledLane((x) => x.laneA);
    const mintedB = settledLane((x) => x.laneB + x.protocol);
    const mintedTreasury = settledLane((x) => x.treasury);
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
      treasury: ms[ms.length - 1].treasuryBal,
      providerMarginPct: rev > 0 ? Math.max(-100, ((rev - cost) / rev) * 100) : -100,
      subsidySharePct: minted > 0 ? (mintedB / minted) * 100 : 0,
      price: sum((x) => x.p) / 12,
      cldUsd: sum((x) => x.cldUsd) / 12,
      utilization: sum((x) => x.u) / 12,
      feesUsd: sum((x) => x.fee * x.cldUsd),
      velocity: feesCld / ((supplyStart + supplyEnd) / 2),
      budgetUsedPct: sum((x) => x.budget) > 0 ? (sum((x) => x.laneB + x.protocol) / sum((x) => x.budget)) * 100 : 0,
      laneBLostToGate: sum((x) => x.laneBLostToGate),
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

// ── JSON for charts ──
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
    clusterSCap: PROTOCOL.clusterSCap,
    clusterNMin: PROTOCOL.clusterNMin,
    chainRate: "8% ×0.85/yr, 1.5% floor, × current supply",
    budgetProposal: "7.88%/yr of genesis supply, halving every 4 yr, ≤ chain cap",
    settlementLagDays: PROTOCOL.settlementLagDays,
    demandUsd0PerMonth: ASSUME.demandUsd0PerMonth,
    demandElasticity: ASSUME.demandElasticity,
    hostingShare: ASSUME.hostingShare,
    targetUtilization: [ASSUME.ctrl.uLow, ASSUME.ctrl.uHigh],
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
          priceUcldPerMmac: ys.map((y) => sig(y.price)),
          cldUsd: ys.map((y) => sig(y.cldUsd)),
        },
      ];
    }),
  ),
};

// ── Markdown report ──
const assumptionsRows: [string, string, string][] = [
  ["Fee F", "burned 100 %", "ledger.service.ts, CloudanaSettlement.finalize"],
  ["Lane A", "0.975·F to the provider", "LANE_A_PER_MILLE = 975"],
  ["Treasury", "0.005·F", "TREASURY_PER_MILLE = 5"],
  ["Lane B", `min(ρ·F, remaining epoch budget), ρ = ${PROTOCOL.rho}, only σ-assigned work with cluster test passing`, "splitFee / reserveSubsidy, SUBSIDY_RHO"],
  ["Hosting", `${ASSUME.hostingShare * 100}% of demand; lane A + treasury only`, "recordHostingRewards"],
  ["Cluster test", `largest payout wallet ≤ ${PROTOCOL.clusterSCap} of eligible capacity, ≥ ${PROTOCOL.clusterNMin} wallet; all-or-nothing per job`, "jobs.service.ts clusterTest"],
  ["Chain cap on lane B", "supply × rate/365 per day; 8 % ×0.85/yr, 1.5 % floor", "CloudanaSettlement.allowance"],
  ["Lane-B budget (PROPOSAL)", "7.88 %/yr of genesis (env value scaled to 24 h epochs), halving every 4 yr, never above the chain cap", "this report — not decided"],
  ["Settlement lag", `${PROTOCOL.settlementLagDays} d (7 d vest + 24 h veto); the ledger closes a whole epoch only after its last vest`, "closeEpochs, design §6"],
  ["Verifiers", "credits (points) only, never CLD", "recordVerifyCredit"],
  ["Genesis supply", `${M(ASSUME.genesisSupply)}M CLD (whitepaper); CLDToken today = 1M (+1M pool on Sepolia)`, "assumption — owner decision #16"],
  ["CLD/USD", `$${ASSUME.cldUsd0} at t = 0; path per scenario; lifted only if fees would exceed ${ASSUME.velocityCap}× supply per year`, "exogenous input"],
  ["Demand", `$${ASSUME.demandUsd0PerMonth.toLocaleString("en-US")}/month at the reference price in month 1; elasticity ${ASSUME.demandElasticity}`, "assumption"],
  ["Reference price", `${ASSUME.refUsdPerMmac.toExponential(2)} $/MMAC (H100 ≈ $2/h at 4·10¹⁴ MAC/s)`, "assumption"],
  ["Providers", PROVIDERS.map((c) => `${c.label}: ${c.mmacPerSec.toExponential(0)} MMAC/s, ${c.busyW} W, $${c.usdPerKwh}/kWh, $${c.fixedUsdMonth}/mo fixed, start ${c.n0}`).join("; "), "assumption"],
  ["Entry / exit", `grow ≤ class max/month when margin > ${ASSUME.entryMargin * 100}%; −${ASSUME.exitRate * 100}%/month after ${ASSUME.exitAfter} months of negative margin`, "assumption"],
  ["Largest operator", `${ASSUME.normalLargestShare * 100}% of capacity (60 % in the dominance stress)`, "assumption"],
];

function yearTable(key: string, extra?: "gate"): string {
  const ys = results[key].years;
  const pick = ys.filter((y) => [1, 2, 3, 4, 5, 7, 10, 12, 15, 20].includes(y.year));
  const head = ["Yr", "Supply M", "Minted M", "Burned M", "Net infl.", "Treasury M", "Prov. margin", "Subsidy share", "Budget used", "p µCLD/MMAC", "CLD/USD", "Fees $/yr", "Util."];
  if (extra === "gate") head.push("Lane B lost to gate M");
  const rows = pick.map((y) => {
    const row = [
      String(y.year), fM(y.supply), fM(y.minted), fM(y.burned), fPct(y.netInflationPct), fM(y.treasury),
      `${y.providerMarginPct.toFixed(0)}%`, `${y.subsidySharePct.toFixed(1)}%`, `${y.budgetUsedPct.toFixed(0)}%`,
      y.price.toExponential(2), `${y.cldUsd.toFixed(3)}${y.velocityFloorMonths ? "*" : ""}`, fUsd(y.feesUsd), y.utilization.toFixed(2),
    ];
    if (extra === "gate") row.push(fM(y.laneBLostToGate));
    return `| ${row.join(" | ")} |`;
  });
  return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows].join("\n");
}

const Y = (key: string, year: number) => results[key].years[year - 1];
const firstYear = (key: string, f: (y: Year) => boolean) => results[key].years.find(f)?.year;
const sumYears = (key: string, f: (y: Year) => number) => results[key].years.reduce((a, y) => a + f(y), 0);

const base = results.base.years;
const deflationYearBase = firstYear("base", (y) => y.netInflationPct < 0);
const deflationYearBull = firstYear("bull", (y) => y.netInflationPct < 0);
const deflationYearBear = firstYear("bear", (y) => y.netInflationPct < 0);
const budgetBindsBase = firstYear("base", (y) => y.budgetUsedPct > 99);
const floorYearBase = firstYear("base", (y) => y.velocityFloorMonths > 0);
const floorYearBull = firstYear("bull", (y) => y.velocityFloorMonths > 0);
const mktP = (ASSUME.refUsdPerMmac / ASSUME.cldUsd0) * 1e6;
const configOverMarket = PROTOCOL.configPriceUcldPerMmac / mktP;
const domLost = sumYears("dominance", (y) => y.laneBLostToGate);
const domB = sumYears("dominance", (y) => y.mintedB);
const baseB = sumYears("base", (y) => y.mintedB);
const protoY3 = Y("noDemand_protocol", 3);
const protoCum = sumYears("noDemand_protocol", (y) => (y.year >= 3 ? y.mintedB : 0));
const protoCapY3 = (results.noDemand_protocol.months.slice(24, 36).reduce((a, x) => a + x.budget, 0)) * ASSUME.protocolWorkBudgetShare;
const pEndNoDemand = Y("noDemand", 20).price;
const monthsToRecover = Math.ceil(Math.log(mktP / pEndNoDemand) / Math.log(1 + ASSUME.ctrl.maxStep));

const sensRows = ["base", ...SENSITIVITIES.filter((s) => s.key.startsWith("base_")).map((s) => s.key)].map((k) => {
  const y5 = Y(k, 5), y10 = Y(k, 10), y20 = Y(k, 20);
  const label = k === "base" ? "Base (ρ = 0.25, halving proposal)" : SENSITIVITIES.find((s) => s.key === k)!.label;
  return `| ${label} | ${fM(y5.supply)} / ${fM(y10.supply)} / ${fM(y20.supply)} | ${fPct(y5.netInflationPct)} / ${fPct(y10.netInflationPct)} / ${fPct(y20.netInflationPct)} | ${y5.subsidySharePct.toFixed(1)}% / ${y10.subsidySharePct.toFixed(1)}% | ${y5.providerMarginPct.toFixed(0)}% / ${y10.providerMarginPct.toFixed(0)}% | ${(y5.washBound * 100).toFixed(1)}% |`;
});

const md = `# CLD tokenomics — 20-year simulation of the current two-lane mint

Generated by \`npx tsx scripts/sim/tokenomics-20y.ts\` (${new Date().toISOString().slice(0, 10)}). Data for charts:
\`client/src/data/tokenomics-sim.json\`. Page: \`client/src/pages/console/economics.tsx\` (not routed).

> **Simulation, not a forecast. CLD/USD is an input, not an output.** Demand paths are scenarios, not predictions.
> The legacy sims in \`client/scripts-dev/\` model an obsolete block-reward/halving design; nothing here reuses their constants.

## 1. What is simulated

Monthly steps for 20 years (240), 24 h epochs aggregated inside each month. Users demand paid work (MMAC of verified
matmul, plus hosting); providers in three hardware classes join or leave on their margin; the orchestrator sets one
price p (µCLD per MMAC) with a utilization controller; every fee is burned and re-minted through lane A, the treasury
and (subsidy) lane B, exactly as \`ledger.service.ts\` splits it. Supply = genesis + Σminted − Σburned (asserted
every month).

### Assumptions

| Item | Value | Source |
|---|---|---|
${assumptionsRows.map((r) => `| ${r.join(" | ")} |`).join("\n")}

### The price controller

Each month the orchestrator compares utilization u = served ÷ capacity with a target band [${ASSUME.ctrl.uLow}, ${ASSUME.ctrl.uHigh}]:

    e = u − ${ASSUME.ctrl.uHigh} if u > ${ASSUME.ctrl.uHigh};  u − ${ASSUME.ctrl.uLow} if u < ${ASSUME.ctrl.uLow};  else 0
    p ← p · clamp(1 + ${ASSUME.ctrl.gain}·e, ${1 - ASSUME.ctrl.maxStep}, ${1 + ASSUME.ctrl.maxStep})

A dead band plus a bounded multiplicative step (EIP-1559 style, ±12.5 % per month at most). It cannot oscillate
faster than providers enter or exit, so it is stable here; inside the band it leaves p alone and provider entry/exit
does the rest. Demand reacts to the USD price p·(CLD/USD) with elasticity ${ASSUME.demandElasticity}.

Start price: the market-clearing value ${mktP.toExponential(2)} µCLD/MMAC (the reference GPU price at $${ASSUME.cldUsd0}/CLD).
**The configured \`PRICE_UCLD_PER_MMAC = 1000\` is ${configOverMarket.toExponential(1)}× that** — and as an integer
in µCLD per MMAC, the config cannot express any price below 1 µCLD/MMAC. See recommendation 1.

## 2. Results by scenario (selected years)

\`*\` on CLD/USD = the exogenous path was lifted that year because fees would otherwise have exceeded
${ASSUME.velocityCap}× circulating supply (the burn needs CLD that exists; in reality the price would have to rise).
"Budget used" = lane B ÷ lane-B budget. Margin = (provider revenue − power and fixed cost) ÷ revenue, fleet-wide.

${SCENARIOS.map((s) => `### ${s.label}\n\n${yearTable(s.key, s.key === "dominance" ? "gate" : undefined)}\n`).join("\n")}

### Sensitivities (base demand and price)

| Variant | Supply M (y5 / y10 / y20) | Net inflation (y5 / y10 / y20) | Subsidy share (y5 / y10) | Margin (y5 / y10) | Wash bound s* |
|---|---|---|---|---|---|
${sensRows.join("\n")}

No-demand with protocol work on idle capacity (design §5 / UNIVERSAL_POUW §5 — *not* in the ledger today): with
zero paid work it mints ${fM(protoY3.mintedB)}M CLD in year 3 and ${fM(protoCum)}M over years 3–20 (0 without it). It is small
here only because it is paid at 0.5·p and p decays while the network is idle; its cap (50 % of the lane-B budget)
would allow ${fM(protoCapY3)}M CLD in year 3 alone.

## 3. Findings

1. **The mint is a fee rebate, not a bootstrap.** Lane B is at most ρ·F, so with no fees there is no subsidy. Net
   supply change is (ρ − 0.02)·F whenever the budget is not binding — always inflationary at ρ = 0.25, and tiny early
   on: base year 1 adds ${fPct(Y("base", 1).netInflationPct)}. Providers' margin is set by fees and the price
   controller, not by emission; the subsidy only adds ${(PROTOCOL.rho * (1 - ASSUME.hostingShare) * 100).toFixed(0)} % to eligible revenue.
2. **Burn beats mint only once the budget binds hard.** Net = B − 0.02·F, so deflation needs annual fees above
   50× the lane-B budget (at the 1.5 % chain floor: fees > 75 % of supply per year). In base the budget first binds in
   year ${budgetBindsBase ?? "—"} and supply turns down in year ${deflationYearBase ?? "never"}; bull ${deflationYearBull ?? "never"}; bear ${deflationYearBear ?? "never"}.
   Base supply: ${fM(Y("base", 5).supply)}M (y5), ${fM(Y("base", 10).supply)}M (y10), ${fM(Y("base", 20).supply)}M (y20).
3. **A flat CLD price is inconsistent with strong growth.** With 2×→+40 %/yr demand and flat CLD/USD, fees reach
   ${ASSUME.velocityCap}× supply per year by year ${floorYearBase ?? "—"} (bull: ${floorYearBull ?? "—"}) and the sim must lift CLD/USD to keep the burn
   physical. Late-year base numbers are therefore driven by the velocity cap, not by the price path: once fees run
   at V× supply per year, supply shrinks by about 0.02·V − (budget rate) per year (≈ 18 % at V = ${ASSUME.velocityCap}). Deflation of
   that size is the mechanism's real implication only if velocity really stays that high.
4. **No work, no mint — holds as built.** After demand stops, minting goes to exactly 0 (asserted) and providers
   exit to the hobbyist floor. It would *not* hold with the design's protocol work on idle capacity: up to
   ${fM(protoCapY3)}M CLD/yr (50 % of the budget) could be minted with no paying user.
5. **The price controller has no floor.** With zero demand p falls 12.5 % a month for 18 years, to
   ${pEndNoDemand.toExponential(1)} µCLD/MMAC; if demand came back it would take ${monthsToRecover} months of maximum steps to return to the
   market price. Idle utilization carries no price information — the controller should hold p (or use provider floors).
   In growth scenarios it behaves: utilization stays in or near the band and fleet margin settles at ~15 %, the entry threshold.
6. **The cluster test is all-or-nothing.** With one operator at 60 %, every eligible set fails, so lane B is 0 for
   everyone, including the 40 % who are independent. Under a per-operator gate they would have received ${fM(domLost)}M CLD
   over 20 years (base, no dominant operator, pays ${fM(baseB)}M in total; dominance pays ${fM(domB)}M). Wash trading stays unprofitable for the 60 % operator
   (bound s* = ${(Y("base", 1).washBound * 100).toFixed(1)} %), but with \`CLUSTER_N_MIN = 1\` a *sole* wallet passes the test, so a lone
   operator has s = 1 and earns 0.225 CLD per CLD it self-pays, limited only by the budget.
7. **Treasury is small.** 0.5 % of fees accrues ${fM(Y("base", 10).treasury)}M CLD by year 10 in base — far below genesis allocations; it
   cannot fund much on its own.

## 4. Risks

- Price drift: no floor on p during idle periods (finding 5).
- Unit mismatch: the integer price unit makes real GPU work either free (rounded to 1 µCLD/job minimum) or 10⁸× overpriced.
- Lane B pays nothing when the network needs it most (thin demand) and is a fixed 25 % fee rebate when it doesn't.
- Supply-proportional chain cap: in a deflationary phase the cap shrinks with supply; with a 1.5 % perpetual floor
  the "soft cap" equilibrium is supply ≈ 0.02·F ÷ 0.015 only if the budget is always fully spent.
- The ledger posts lane A only after the lane-B vest (7 d in the design), contradicting the design's "lane A at T+24 h".
- One dominant operator silently switches the subsidy off for everyone (and wash-trade risk at N_MIN = 1).
- Exogenous CLD/USD: every USD-denominated conclusion (provider margin, entry) moves with it one-for-one.

## 5. Recommendations for the owner

1. **Re-denominate the price** to µCLD per TMAC (10¹² MAC) or a fixed-point price with a 10⁹ denominator, and start
   it from a market reference (≈ ${(mktP * 1e6).toFixed(0)} µCLD/TMAC at $${ASSUME.cldUsd0}/CLD), not 1000 µCLD/MMAC. Give the controller a
   floor (hold p when utilization is 0, or the median provider floor).
2. **ρ schedule:** keep ρ = 0.25 until there are ≥ 10 independent clusters, then step to 0.5; never above 0.5 while
   any cluster can exceed ${((1 / (PROTOCOL.laneA + 0.5)) * 100).toFixed(0)} % of capacity (wash bound). Raising ρ adds inflation without changing who
   joins (y5 margin 22 % → 26 %, identical once the budget binds) — the lever that bootstraps supply is protocol
   work, and that one breaks "no work, no mint" unless it is capped hard.
3. **Budget schedule:** adopt the halving proposal (7.88 %/yr of genesis, ×½ every 4 yr, capped by the chain
   allowance) or lower; with ρ = 0.25 it rarely binds before the demand is large, and it bounds the worst case.
   Set \`CLUSTER_N_MIN ≥ 3\` and make the cluster gate **per operator** (withhold only the dominant cluster's subsidy).
4. **Vesting:** keep 7 d for lane B but post lane A and the burn at T+24 h (split the epoch close by lane).
5. **Treasury:** treat the 0.5 % stream as a buffer for verifier rewards and audits, not as a runway; if browser
   verifiers ever earn CLD, pay them from lane-B budget, not from the treasury stream.

## 6. What this simulation does NOT capture

- CLD/USD formation (exogenous by design), market depth, speculation, staking, sell pressure from providers.
- Genesis allocations, team/treasury vesting, the 1M pre-funded Sepolia pool.
- Individual operators, sybils, or the actual wash-trade attack (only the bound and the expected profit).
- Per-epoch variance (demand is uniform within a month), the 7-epoch budget carry, queueing, latency, outages.
- Multiple work types with separate prices (storage, bandwidth, RAM); hosting is one MMAC-equivalent share.
- Fiat / Stripe flows, chargebacks, oracle risk; gas costs; the guardian veto or clawbacks.
- Hardware price changes, new GPU generations, electricity price changes; provider fixed costs beyond one number.
- Protocol work and the verifier 15 % slice (not in the ledger) except the one no-demand sensitivity.
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
console.log("scenario    year  supply M   net infl   minted M   burned M  treasury M  margin  subsidy%  CLD/USD");
for (const s of SCENARIOS) {
  for (const yr of [5, 10, 20]) {
    const y = Y(s.key, yr);
    console.log(
      `${s.key.padEnd(11)} ${String(yr).padStart(4)}  ${fM(y.supply).padStart(8)}  ${fPct(y.netInflationPct).padStart(9)}  ${fM(y.minted).padStart(9)}  ${fM(y.burned).padStart(9)}  ${fM(y.treasury).padStart(10)}  ${(y.providerMarginPct.toFixed(0) + "%").padStart(6)}  ${y.subsidySharePct.toFixed(1).padStart(7)}  ${y.cldUsd.toFixed(3)}${y.velocityFloorMonths ? "*" : ""}`,
    );
  }
}
console.log(`\nchecks passed: subsidy ≤ budget, lane A ≤ 98 % of fees, supply = genesis + Σmint − Σburn, no-demand mints 0`);
console.log(`wrote ${mdPath}\nwrote ${jsonPath} (${(jsonText.length / 1024).toFixed(1)} KB)`);
