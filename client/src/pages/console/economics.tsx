// Console · Economics — 20-year simulation of the two-lane CLD mint (docs/TOKENOMICS_SIM_20Y.md).
// Data: client/src/data/tokenomics-sim.json, written by `npx tsx scripts/sim/tokenomics-20y.ts`.
// Not routed here; the lead wires it into the console router.
import { useState, type ReactElement, type ReactNode } from "react";
import {
  Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { MonoLabel, PageHeader, Panel, PanelHeader, Tile } from "@/components/console/primitives";
import sim from "@/data/tokenomics-sim.json";

type ScenarioKey = "bear" | "base" | "bull" | "noDemand" | "dominance";
type Series = (typeof sim.scenarios)["base"];

const TABS: { key: "bear" | "base" | "bull" | "stress"; label: string }[] = [
  { key: "bear", label: "Bear" },
  { key: "base", label: "Base" },
  { key: "bull", label: "Bull" },
  { key: "stress", label: "Stress" },
];
const STRESS: { key: ScenarioKey; label: string }[] = [
  { key: "noDemand", label: "No demand after year 2" },
  { key: "dominance", label: "One operator at 60 %" },
];

const C = { ok: "var(--c-ok)", burn: "var(--c-burn)", work: "var(--c-work)", chain: "var(--c-chain)", text: "var(--c-text)", faint: "var(--c-faint)", line: "var(--c-line)" };
const AXIS = { stroke: C.faint, fontSize: 11, tickLine: false, axisLine: false } as const;
const TOOLTIP = {
  contentStyle: { background: "var(--c-panel-2)", border: "1px solid var(--c-line-2)", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: C.text },
  labelFormatter: (y: number) => `Year ${y}`,
};

function rows(s: Series) {
  return s.years.map((year, i) => ({
    year,
    supplyM: s.supplyM[i],
    netInflationPct: s.netInflationPct[i],
    mintedM: s.mintedM[i],
    burnedM: s.burnedM[i],
    subsidyM: s.subsidyM[i],
    treasuryM: s.treasuryM[i],
    providerMarginPct: s.providerMarginPct[i],
    subsidySharePct: s.subsidySharePct[i],
  }));
}

function ChartPanel({ kicker, title, children }: { kicker: string; title: string; children: ReactElement }) {
  return (
    <Panel>
      <PanelHeader kicker={kicker} title={title} />
      <div className="h-64 px-2 py-4">
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </Panel>
  );
}

export default function EconomicsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("base");
  const [stress, setStress] = useState<ScenarioKey>("noDemand");
  const key: ScenarioKey = tab === "stress" ? stress : tab;
  const s = sim.scenarios[key];
  const data = rows(s);
  const last = data.length - 1;
  const p = sim.params;

  return (
    <>
      <PageHeader
        kicker="Economics"
        title="Twenty years of the two-lane mint, simulated."
        lede="Every fee is burned; providers are minted 97.5 % of it, the treasury 0.5 %, and a capped subsidy on top. Pick a scenario to see where supply goes."
      />

      <div role="note" className="mb-6 rounded-lg border border-work/60 bg-work/[.06] px-4 py-3 text-sm text-text">
        <strong className="font-medium">Simulation, not a forecast. CLD/USD is an input, not an output. </strong>
        <span className="ml-1 text-muted-foreground">Demand paths are scenarios; the CLD price path is chosen per scenario.</span>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Scenario" className="inline-flex rounded-lg border border-line-2 bg-panel p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "h-8 rounded-md px-3 text-sm transition-colors duration-150",
                tab === t.key ? "bg-panel-2 text-text" : "text-muted-foreground hover:text-text",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === "stress" && (
          <div role="radiogroup" aria-label="Stress test" className="flex flex-wrap gap-2">
            {STRESS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="radio"
                aria-checked={stress === t.key}
                onClick={() => setStress(t.key)}
                className={cn(
                  "h-8 rounded-full border px-3 font-mono text-[11px] transition-colors duration-150",
                  stress === t.key ? "border-burn/60 text-burn" : "border-line-2 text-muted-foreground hover:text-text",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="mb-6 text-sm text-muted-foreground">{s.label}</p>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Supply, year 20" value={data[last].supplyM} caption={`M CLD · genesis ${p.genesisSupplyM}M`} tone="ok" />
        <Tile label="Net change, year 20" value={data[last].netInflationPct} caption="% of supply that year" tone={data[last].netInflationPct < 0 ? "burn" : "ok"} />
        <Tile label="Treasury, year 20" value={data[last].treasuryM} caption="M CLD from the 0.5 % stream" tone="chain" />
        <Tile label="Subsidy share, year 5" value={data[4].subsidySharePct} caption="% of CLD minted that year" tone="work" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartPanel kicker="Supply" title="Total supply and net inflation">
          <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={C.line} vertical={false} />
            <XAxis dataKey="year" {...AXIS} />
            <YAxis yAxisId="l" {...AXIS} width={48} unit="M" />
            <YAxis yAxisId="r" orientation="right" {...AXIS} width={44} unit="%" />
            <Tooltip {...TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine yAxisId="r" y={0} stroke={C.faint} strokeDasharray="3 3" />
            <Area yAxisId="l" dataKey="supplyM" name="Supply (M CLD)" stroke={C.ok} fill={C.ok} fillOpacity={0.12} />
            <Line yAxisId="r" dataKey="netInflationPct" name="Net inflation (%)" stroke={C.text} dot={false} strokeWidth={1.5} />
          </ComposedChart>
        </ChartPanel>

        <ChartPanel kicker="Flows" title="Minted vs burned per year">
          <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={C.line} vertical={false} />
            <XAxis dataKey="year" {...AXIS} />
            <YAxis {...AXIS} width={48} unit="M" />
            <Tooltip {...TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="mintedM" name="Minted (M CLD)" fill={C.ok} />
            <Bar dataKey="burnedM" name="Burned (M CLD)" fill={C.burn} />
            <Line dataKey="subsidyM" name="of which subsidy (M CLD)" stroke={C.work} dot={false} strokeWidth={1.5} />
          </ComposedChart>
        </ChartPanel>

        <ChartPanel kicker="Providers" title="Fleet margin after power and fixed cost">
          <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={C.line} vertical={false} />
            <XAxis dataKey="year" {...AXIS} />
            <YAxis {...AXIS} width={48} unit="%" domain={[-100, 100]} />
            <Tooltip {...TOOLTIP} />
            <ReferenceLine y={0} stroke={C.burn} strokeDasharray="3 3" />
            <Line dataKey="providerMarginPct" name="Margin (%)" stroke={C.ok} dot={false} strokeWidth={1.5} />
          </ComposedChart>
        </ChartPanel>

        <ChartPanel kicker="Subsidy" title="Subsidy share of emission, and treasury">
          <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={C.line} vertical={false} />
            <XAxis dataKey="year" {...AXIS} />
            <YAxis yAxisId="l" {...AXIS} width={48} unit="%" />
            <YAxis yAxisId="r" orientation="right" {...AXIS} width={44} unit="M" />
            <Tooltip {...TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area yAxisId="l" dataKey="subsidySharePct" name="Subsidy share (%)" stroke={C.work} fill={C.work} fillOpacity={0.12} />
            <Line yAxisId="r" dataKey="treasuryM" name="Treasury (M CLD)" stroke={C.chain} dot={false} strokeWidth={1.5} />
          </ComposedChart>
        </ChartPanel>
      </div>

      <Panel className="mt-6">
        <PanelHeader kicker="Assumptions" title="What the simulation takes as given" />
        <ul className="grid gap-x-8 gap-y-2 px-5 py-4 text-sm text-muted-foreground md:grid-cols-2">
          <Assumption k="Fee split">burn 100 % of F · mint {p.laneA * 100} % provider + {p.treasury * 100} % treasury</Assumption>
          <Assumption k="Subsidy">min(ρ·F, epoch budget), ρ = {p.rho}; cluster test: largest wallet ≤ {p.clusterSCap * 100} %</Assumption>
          <Assumption k="Chain cap">{p.chainRate}</Assumption>
          <Assumption k="Budget (proposal)">{p.budgetProposal}</Assumption>
          <Assumption k="Settlement lag">{p.settlementLagDays} days (vest + veto)</Assumption>
          <Assumption k="Genesis">{p.genesisSupplyM}M CLD at ${p.cldUsd0} (whitepaper; open decision)</Assumption>
          <Assumption k="Demand">${p.demandUsd0PerMonth.toLocaleString("en-US")}/month at start, elasticity {p.demandElasticity}, hosting {p.hostingShare * 100} % (no subsidy)</Assumption>
          <Assumption k="Price controller">target utilization {p.targetUtilization[0]}–{p.targetUtilization[1]}, ±12.5 %/month</Assumption>
          <Assumption k="Velocity cap">fees ≤ {p.velocityCap}× supply per year, else CLD/USD is lifted</Assumption>
          <Assumption k="Verifiers">credits only, never CLD</Assumption>
        </ul>
        <div className="border-t border-line px-5 py-3 text-[12px] text-faint">
          Generated {new Date(sim.generatedAt).toISOString().slice(0, 10)} · full report in docs/TOKENOMICS_SIM_20Y.md
        </div>
      </Panel>
    </>
  );
}

function Assumption({ k, children }: { k: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <MonoLabel className="w-32 shrink-0 pt-0.5">{k}</MonoLabel>
      <span>{children}</span>
    </li>
  );
}
