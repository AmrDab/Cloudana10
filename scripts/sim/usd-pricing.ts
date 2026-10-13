/**
 * Cloudana CLD — pricing-model comparison under CLD/USD shocks (docs/TOKENOMICS_USD_PRICING.md).
 *
 *   npx tsx scripts/sim/usd-pricing.ts [--months 24] [--shock 6] [--twap 1] [--step 0.10] [--breaker 0.20]
 *
 * Three ways to QUOTE the same work, all SETTLED identically (fee F in CLD is burned; 0.95F is minted to the
 * provider, 0.03F to the treasury, 0.02F is destroyed; lane B = min(0.04·F, daily budget) for proven work only):
 *   cld     today: matmul priced in CLD by the hourly utilization controller; hourly services fixed in CLD (env vars).
 *   usd     prices in USD; the controller moves the USD matmul price; each quote converts at a bounded TWAP.
 *   hybrid  matmul as `cld`, hourly services (hosting, containers, workstations, endpoints) as `usd`.
 * CLD/USD paths are exogenous: flat, ×10 over 90 days, ÷10 over 30 days, volatile (OU, daily σ 8 %), a 6-hour ×3 flash.
 *
 * Mint, split, subsidy cap, controller and provider assumptions follow scripts/sim/tokenomics-20y.ts (constants are
 * copied: that script simulates and writes files at import time). Hourly steps. Simulation, not a forecast.
 */

const H_MONTH = (365 / 12) * 24; // 730 h

function opt(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}
const MONTHS = opt("months", 24);
const SHOCK_MONTH = opt("shock", 6);
const TWAP_H = Math.max(1, Math.round(opt("twap", 1)));
const QUOTE_STEP = opt("step", 0.1); // max change of the quote rate per hour
const BREAKER = opt("breaker", 0.2); // spot vs previous TWAP deviation that pauses USD quotes
const HOURS = Math.round(MONTHS * H_MONTH);
const SHOCK_H = Math.round(SHOCK_MONTH * H_MONTH);

/** Protocol constants (ledger.service.ts, pricing.service.ts, CloudanaSettlementV2, DECISIONS "before mainnet"). */
const PROTOCOL = {
  laneA: 0.95,
  treasury: 0.03,
  rho: 0.04, // RHO_MAX
  chainRate: 0.08, // allowance year 1
  budgetGenesisFraction: 0.04, // policy budget min(chain, 4 % of genesis)/yr
  ctrl: { target: 0.7, maxStep: 0.02, emaHours: 720, floorOfEma: 0.1, ceilingOfEma: 10 }, // stepPrice()
  laneALagH: 48, // 24 h epoch + 24 h veto before lane A is claimable
  laneBLagH: 9 * 24, // + 7 d vest
};

/** Scenario assumptions (not protocol). Reference prices: H100 ≈ $2/h for proven matmul; $2.50 per datacenter GPU-hour. */
const ASSUME = {
  genesis: 100e6,
  x0: 0.1, // $ per CLD at t = 0
  matmul: { ref: 2 / (4e8 * 3600), demandUsdMonth: 25_000, eps: 0.7 }, // $/MMAC
  hourly: { ref: 2.5, demandUsdMonth: 50_000, eps: 0.7 }, // $/GPU-h
  entryMargin: 0.15,
  entryGain: 0.5,
  exitAfter: 3,
  exitRate: 0.15,
};

interface Fleet {
  label: string;
  unitsPerH: number; // capacity per node per hour, in the market's unit
  busyW: number;
  idleW: number;
  usdPerKwh: number;
  fixedUsdMonth: number;
  n0: number;
  nFloor: number;
  maxGrowth: number;
}
interface Market {
  key: "matmul" | "hourly";
  ref: number;
  demandRefPerH: number;
  eps: number;
  fleet: Fleet;
  controlled: boolean; // the utilization controller moves this price
  laneB: boolean; // proven work → subsidy
}
const MARKETS: Market[] = [
  {
    key: "matmul",
    ref: ASSUME.matmul.ref,
    demandRefPerH: ASSUME.matmul.demandUsdMonth / ASSUME.matmul.ref / H_MONTH,
    eps: ASSUME.matmul.eps,
    fleet: { label: "home GPU", unitsPerH: 4e7 * 3600, busyW: 350, idleW: 20, usdPerKwh: 0.15, fixedUsdMonth: 5, n0: 250, nFloor: 25, maxGrowth: 0.1 },
    controlled: true,
    laneB: true,
  },
  {
    key: "hourly",
    ref: ASSUME.hourly.ref,
    demandRefPerH: ASSUME.hourly.demandUsdMonth / ASSUME.hourly.ref / H_MONTH,
    eps: ASSUME.hourly.eps,
    fleet: { label: "datacenter GPU", unitsPerH: 1, busyW: 910, idleW: 150, usdPerKwh: 0.08, fixedUsdMonth: 900, n0: 50, nFloor: 5, maxGrowth: 0.15 },
    controlled: false,
    laneB: false,
  },
];

type Model = "cld" | "usd" | "hybrid";
const MODELS: Model[] = ["cld", "usd", "hybrid"];
const quoteRule = (model: Model, m: Market): "cld" | "usd" => (model === "hybrid" ? (m.key === "matmul" ? "cld" : "usd") : model);

// ── CLD/USD paths ──────────────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function ouPath(): number[] {
  const rnd = mulberry32(20261012);
  const theta = 1 / (30 * 24); // pull back to $0.10 over ~30 days
  const sigma = 0.08 / Math.sqrt(24); // daily σ 8 % (≈ 150 %/yr)
  const out = [Math.log(ASSUME.x0)];
  for (let h = 1; h < HOURS; h++) {
    const z = Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
    out.push(out[h - 1] + theta * (Math.log(ASSUME.x0) - out[h - 1]) + sigma * z);
  }
  return out.map(Math.exp);
}
interface Path {
  key: string;
  label: string;
  x: number[];
  rampEndH: number; // when the shock is fully in (recovery is measured from here)
}
const vol = ouPath();
const PATHS: Path[] = [
  { key: "flat", label: "Flat $0.10", x: Array.from({ length: HOURS }, () => ASSUME.x0), rampEndH: SHOCK_H },
  { key: "rise10", label: "Rise ×10 over 90 d", x: Array.from({ length: HOURS }, (_, h) => ASSUME.x0 * 10 ** Math.min(1, Math.max(0, (h - SHOCK_H) / (90 * 24)))), rampEndH: SHOCK_H + 90 * 24 },
  { key: "crash10", label: "Crash ÷10 over 30 d", x: Array.from({ length: HOURS }, (_, h) => ASSUME.x0 * 10 ** -Math.min(1, Math.max(0, (h - SHOCK_H) / (30 * 24)))), rampEndH: SHOCK_H + 30 * 24 },
  { key: "fastcrash", label: "Fast crash ÷3 over 48 h", x: Array.from({ length: HOURS }, (_, h) => ASSUME.x0 * 3 ** -Math.min(1, Math.max(0, (h - SHOCK_H) / 48))), rampEndH: SHOCK_H + 48 },
  { key: "volatile", label: "Volatile (OU, daily σ 8 %)", x: vol, rampEndH: SHOCK_H },
  { key: "flash", label: "Flash ×3 for 6 h", x: Array.from({ length: HOURS }, (_, h) => (h >= SHOCK_H && h < SHOCK_H + 6 ? 3 * ASSUME.x0 : ASSUME.x0)), rampEndH: SHOCK_H + 6 },
];

// ── Simulation ─────────────────────────────────────────────────────────────
interface MarketResult {
  meanAbsDev: number; // mean |user USD price / ref − 1| in the window
  peak: number;
  trough: number;
  mispricedH: number; // hours with |dev| > 20 %
  recoveryH: number | null; // hours after the ramp until |dev| < 20 % (null = never)
  served: number;
  servedFlat: number;
  feesUsd: number;
  feesCld: number;
  minMonthMargin: number;
  meanMargin: number;
  negMonths: number;
  nEnd: number;
  pausedH: number;
}
interface Result {
  markets: Record<string, MarketResult>;
  usdSeries: Record<string, number[]>; // user's true USD price per hour, per market (the reference for other paths)
  minted: number;
  burned: number;
  laneB: number;
  netSupply: number;
  budgetDays: number;
  maxMonthVelocity: number; // monthly CLD fees ÷ supply
  pausedH: number;
}

/**
 * `flat` = the same model on the flat path: the matmul controller finds its own level from utilization (the fleet
 * grows while margins are high), so "deviation" is measured against that path hour by hour — only the currency effect.
 */
function simulate(model: Model, path: Path, flat?: Result): Result {
  const { target, maxStep, emaHours, floorOfEma, ceilingOfEma } = PROTOCOL.ctrl;
  let supply = ASSUME.genesis;
  let xq = ASSUME.x0;
  let budgetLeft = 0;
  let budgetDays = 0;
  let pausedH = 0;
  let minted = 0;
  let burned = 0;
  let laneBTotal = 0;
  let monthFees = 0;
  let maxMonthVelocity = 0;

  const st = MARKETS.map((m) => {
    const rule = quoteRule(model, m);
    const p0 = rule === "cld" ? m.ref / ASSUME.x0 : m.ref;
    return {
      m, rule, p: p0, ema: p0, n: m.fleet.n0, negStreak: 0,
      aBuf: new Array<number>(PROTOCOL.laneALagH).fill(0), bBuf: new Array<number>(PROTOCOL.laneBLagH).fill(0),
      monthRev: 0, monthCost: 0, margins: [] as number[],
      absDev: 0, peak: 0, trough: Infinity, mispricedH: 0, recoveryH: null as number | null,
      served: 0, feesUsd: 0, feesCld: 0, paused: 0, usdSeries: new Array<number>(HOURS).fill(0),
    };
  });

  for (let h = 0; h < HOURS; h++) {
    const x = path.x[h];
    if (h % 24 === 0) {
      budgetLeft = Math.min(supply * PROTOCOL.chainRate, ASSUME.genesis * PROTOCOL.budgetGenesisFraction) / 365;
    }
    // USD quote rate: TWAP over the last TWAP_H hours, stepped at most ±QUOTE_STEP per hour; paused if spot has left
    // the previous TWAP by more than BREAKER (nothing new is quoted that hour).
    let paused = false;
    if (h > 0) {
      const prevTwap = path.x.slice(Math.max(0, h - TWAP_H), h).reduce((a, b) => a + b, 0) / Math.min(h, TWAP_H);
      paused = Math.abs(x / prevTwap - 1) > BREAKER;
      if (!paused) {
        const twap = path.x.slice(Math.max(0, h - TWAP_H + 1), h + 1).reduce((a, b) => a + b, 0) / Math.min(h + 1, TWAP_H);
        xq = Math.min(xq * (1 + QUOTE_STEP), Math.max(xq * (1 - QUOTE_STEP), twap));
      }
    }
    const inWindow = h >= SHOCK_H;
    let usesUsd = false;

    for (const s of st) {
      const { m } = s;
      const cap = s.n * m.fleet.unitsPerH;
      const priceCld = s.rule === "cld" ? s.p : s.p / xq;
      const userUsd = priceCld * x; // what the CLD amount really costs at the true rate
      s.usdSeries[h] = userUsd;
      const ref = flat ? flat.usdSeries[m.key][h] : userUsd;
      const dev = userUsd / ref - 1;
      const marketPaused = s.rule === "usd" && paused;
      if (s.rule === "usd") usesUsd = true;
      const demand = marketPaused ? 0 : m.demandRefPerH * (userUsd / m.ref) ** -m.eps;
      const served = Math.min(demand, cap);
      const u = cap > 0 ? served / cap : 0;
      const fee = served * priceCld;

      if (m.controlled && served > 0) {
        const factor = Math.min(1 + maxStep, Math.max(1 - maxStep, 1 + (u - target)));
        s.p = Math.min(ceilingOfEma * s.ema, Math.max(floorOfEma * s.ema, s.p * factor));
      }
      s.ema += (s.p - s.ema) / emaHours;

      const laneA = fee * PROTOCOL.laneA;
      const treas = fee * PROTOCOL.treasury;
      const laneB = m.laneB ? Math.min(PROTOCOL.rho * fee, budgetLeft) : 0;
      budgetLeft -= laneB;
      supply += laneA + treas + laneB - fee;
      minted += laneA + treas + laneB;
      burned += fee;
      laneBTotal += laneB;
      monthFees += fee;

      // Provider USD income lands when the CLD is claimable (lane A 2 d, lane B 9 d) at the rate of THAT hour.
      const aOut = s.aBuf[h % PROTOCOL.laneALagH];
      const bOut = s.bBuf[h % PROTOCOL.laneBLagH];
      s.aBuf[h % PROTOCOL.laneALagH] = laneA;
      s.bBuf[h % PROTOCOL.laneBLagH] = laneB;
      s.monthRev += (aOut + bOut) * x;
      s.monthCost += (s.n * (m.fleet.idleW + (m.fleet.busyW - m.fleet.idleW) * u)) / 1000 * m.fleet.usdPerKwh + (s.n * m.fleet.fixedUsdMonth) / H_MONTH;

      if (inWindow) {
        if (marketPaused) {
          s.paused++; // nobody is quoted in a paused hour: it is lost work, not a mispriced price
        } else {
          s.absDev += Math.abs(dev);
          s.peak = Math.max(s.peak, 1 + dev);
          s.trough = Math.min(s.trough, 1 + dev);
          if (Math.abs(dev) > 0.2) s.mispricedH++;
        }
        if (s.recoveryH === null && h >= path.rampEndH && !marketPaused && Math.abs(dev) <= 0.2) s.recoveryH = h - path.rampEndH;
        s.served += served;
        s.feesUsd += fee * x;
        s.feesCld += fee;
      }
    }
    if (paused && usesUsd) pausedH++;
    if (h % 24 === 23 && budgetLeft <= 1e-9) budgetDays++;

    if ((h + 1) % Math.round(H_MONTH) === 0) {
      maxMonthVelocity = Math.max(maxMonthVelocity, monthFees / supply);
      monthFees = 0;
      for (const s of st) {
        const margin = s.monthRev > 0 ? (s.monthRev - s.monthCost) / s.monthRev : -1;
        if (h >= SHOCK_H) s.margins.push(margin);
        const f = s.m.fleet;
        if (margin > ASSUME.entryMargin) s.n *= 1 + Math.min(f.maxGrowth, ASSUME.entryGain * margin);
        s.negStreak = margin < 0 ? s.negStreak + 1 : 0;
        if (s.negStreak >= ASSUME.exitAfter) s.n *= 1 - ASSUME.exitRate;
        s.n = Math.max(s.n, f.nFloor);
        s.monthRev = 0;
        s.monthCost = 0;
      }
    }
  }

  const windowH = HOURS - SHOCK_H;
  const markets: Record<string, MarketResult> = {};
  const usdSeries: Record<string, number[]> = {};
  for (const s of st) {
    usdSeries[s.m.key] = s.usdSeries;
    markets[s.m.key] = {
      meanAbsDev: s.absDev / (windowH - s.paused),
      peak: s.peak,
      trough: s.trough,
      mispricedH: s.mispricedH,
      recoveryH: s.recoveryH,
      served: s.served,
      servedFlat: flat ? flat.markets[s.m.key].served : s.served,
      feesUsd: s.feesUsd,
      feesCld: s.feesCld,
      minMonthMargin: Math.min(...s.margins),
      meanMargin: s.margins.reduce((a, b) => a + b, 0) / s.margins.length,
      negMonths: s.margins.filter((v) => v < 0).length,
      nEnd: s.n,
      pausedH: s.paused,
    };
  }
  return { markets, usdSeries, minted, burned, laneB: laneBTotal, netSupply: supply - ASSUME.genesis, budgetDays, maxMonthVelocity, pausedH };
}

// ── Run ────────────────────────────────────────────────────────────────────
const flatByModel = Object.fromEntries(MODELS.map((mo) => [mo, simulate(mo, PATHS[0])])) as Record<Model, Result>;
const results = PATHS.map((path) => ({ path, byModel: Object.fromEntries(MODELS.map((mo) => [mo, simulate(mo, path, flatByModel[mo])])) as Record<Model, Result> }));

const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;
const x_ = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + "×";
const usd = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${(v / 1e3).toFixed(0)}k`);
const cldM = (v: number) => `${(v / 1e6).toFixed(2)}M`;
const hrs = (v: number | null) => (v === null ? "never" : v < 48 ? `${v} h` : `${(v / 24).toFixed(0)} d`);
const row = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;

console.log(`# usd-pricing — ${MONTHS} months, shock at month ${SHOCK_MONTH}, TWAP ${TWAP_H} h, quote step ±${pct(QUOTE_STEP)}/h, breaker ${pct(BREAKER)}`);
console.log(`Window = from the shock to the end (${((HOURS - SHOCK_H) / H_MONTH).toFixed(0)} months). "dev" = the user's true USD price ÷ the same model's flat-path price that hour − 1 (currency effect only; paused hours excluded).\n`);

for (const { path, byModel } of results) {
  console.log(`## ${path.label}\n`);
  console.log(row(["Model", "Market", "Mean |dev|", "Peak", "Trough", "Mispriced h", "Recovery", "Served vs flat", "Fees $", "Fees CLD", "Min margin", "Mean margin", "Neg. months", "Fleet end", "Paused h"]));
  console.log(row(Array(15).fill("---")));
  for (const mo of MODELS) {
    const r = byModel[mo];
    for (const m of MARKETS) {
      const k = r.markets[m.key];
      console.log(row([
        mo, m.key, pct(k.meanAbsDev), x_(k.peak), x_(k.trough), String(k.mispricedH), hrs(k.recoveryH), pct(k.served / k.servedFlat),
        usd(k.feesUsd), cldM(k.feesCld), pct(k.minMonthMargin), pct(k.meanMargin), String(k.negMonths), `${k.nEnd.toFixed(0)} (from ${m.fleet.n0})`, String(k.pausedH),
      ]));
    }
  }
  console.log();
  console.log(row(["Model", "Minted CLD", "Burned CLD", "Lane B CLD", "Lane B ÷ burned", "Net supply Δ", "Budget-bound days", "Max monthly velocity"]));
  console.log(row(Array(8).fill("---")));
  for (const mo of MODELS) {
    const r = byModel[mo];
    console.log(row([mo, cldM(r.minted), cldM(r.burned), cldM(r.laneB), pct(r.laneB / r.burned, 2), `${r.netSupply >= 0 ? "+" : ""}${cldM(r.netSupply)} (${pct(r.netSupply / ASSUME.genesis, 3)})`, String(r.budgetDays), pct(r.maxMonthVelocity, 2)]));
  }
  console.log();
}

// ── Analytics that need no path ────────────────────────────────────────────
console.log("## Per $1 of fees (any quoting model — settlement is identical)\n");
console.log(row(["Flow", "Budget not binding", "Budget binding"]));
console.log(row(["---", "---", "---"]));
console.log(row(["User buys CLD", "+$1.00", "+$1.00"]));
console.log(row(["Provider minted (lane A)", "−$0.95", "−$0.95"]));
console.log(row(["Treasury minted", "−$0.03", "−$0.03"]));
console.log(row(["Subsidy minted (ρ 0.04 × proven share)", `−$${(PROTOCOL.rho * (1 - 0.15)).toFixed(3)} at 85 % proven · −$0.000 if nothing is proven`, "fixed CLD/yr (≤ 4 % of genesis, later 1 % of supply)"]));
console.log(row(["Net demand for CLD if every minted CLD is sold", `−$${(PROTOCOL.rho * 0.85 - 0.02).toFixed(3)} … +$0.020`, "+$0.020 − subsidy"]));
console.log();

console.log("## Oracle manipulation (USD model): attacker's gain vs the pool it must move\n");
console.log("Gain ≤ δ × fees quoted in the window; depth = 30 × daily fees (DECISIONS: pool ≥ 30× daily fees). δ = 10 %.\n");
console.log(row(["Window", "Gain ÷ pool depth", "Gain at $1M/yr fees", "Gain at $10M/yr", "Gain at $100M/yr"]));
console.log(row(Array(5).fill("---")));
for (const [label, hours] of [["5 min (quote lock)", 1 / 12], ["1 h TWAP", 1], ["24 h TWAP", 24]] as const) {
  const share = 0.1 * (hours / 8760);
  const ratio = share / (30 / 365);
  console.log(row([label, pct(ratio, 4), `$${(1e6 * share).toFixed(0)}`, `$${(1e7 * share).toFixed(0)}`, `$${(1e8 * share).toFixed(0)}`]));
}
console.log();

console.log("## What the fee loop itself does for the price (20-year base-case fee levels, $0.10/CLD, 100M supply)\n");
console.log(row(["Fees $/yr", "Net burn (2 %)", "Subsidy at ρ 0.04 × 85 %", "Budget cap (4M CLD)", "Net holder flow", "Float (3-day loop)", "Price floor at V = 10"]));
console.log(row(Array(7).fill("---")));
for (const fees of [545e3, 2.9e6, 15.5e6, 100e6]) {
  const burn = 0.02 * fees;
  const sub = Math.min(PROTOCOL.rho * 0.85 * fees, 4e6 * ASSUME.x0);
  console.log(row([usd(fees), usd(burn), usd(sub), usd(4e6 * ASSUME.x0), `${burn - sub >= 0 ? "+" : "−"}${usd(Math.abs(burn - sub))}`, usd((fees * 3) / 365), `$${(fees / (10 * ASSUME.genesis)).toFixed(4)}`]));
}
console.log();
console.log("## Controller lag (CLD model, analytic)\n");
console.log(`- ±${pct(PROTOCOL.ctrl.maxStep)}/h → a 10× move needs ${Math.ceil(Math.log(10) / Math.log(1 + PROTOCOL.ctrl.maxStep))} saturated steps ≈ ${(Math.log(10) / Math.log(1 + PROTOCOL.ctrl.maxStep) / 24).toFixed(1)} days, and only while utilization stays saturated.`);
console.log(`- The EMA floor/ceiling (${PROTOCOL.ctrl.floorOfEma}× / ${PROTOCOL.ctrl.ceilingOfEma}×, α = 1/${PROTOCOL.ctrl.emaHours}) caps a single move at 10× until the 30-day EMA follows; a 20× currency move cannot be absorbed within a month.`);
console.log(`- Hourly services have no controller at all: a currency move is a permanent mispricing until an env var is edited.`);
