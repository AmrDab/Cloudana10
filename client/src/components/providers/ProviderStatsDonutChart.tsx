import { useMemo } from "react";
import { Pie, PieChart, Cell, Label } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { bytesToShrink, roundDecimal } from "@/lib/provider-utils";

export interface ProviderStatsDonutChartProps {
  activeCPU: number;
  totalCPU: number;
  activeGPU: number;
  totalGPU: number;
  activeMemory: number;
  totalMemory: number;
  activeStorage: number;
  totalStorage: number;
}

const COLORS = {
  cpu: { active: "hsl(182 91% 45%)", available: "hsl(182 91% 45% / 0.2)" },
  gpu: { active: "hsl(262 83% 58%)", available: "hsl(262 83% 58% / 0.2)" },
  memory: { active: "hsl(47 96% 53%)", available: "hsl(47 96% 53% / 0.2)" },
  storage: { active: "hsl(142 76% 36%)", available: "hsl(142 76% 36% / 0.2)" },
};

function DonutChartCard({
  title,
  active,
  total,
  activeColor,
  availableColor,
  formatValue,
}: {
  title: string;
  active: number;
  total: number;
  activeColor: string;
  availableColor: string;
  formatValue: (val: number) => string;
}) {
  const data = useMemo(() => {
    const available = Math.max(0, total - active);
    const hasAny = total > 0 || active > 0;
    if (hasAny) {
      return [
        { name: "active", value: active, fill: activeColor },
        { name: "available", value: available, fill: availableColor },
      ];
    }
    // Empty state: show full ring so the circle is visible (100% "available")
    return [
      { name: "active", value: 0, fill: activeColor },
      { name: "available", value: 1, fill: availableColor },
    ];
  }, [active, total, activeColor, availableColor]);

  const percentage = total > 0 ? Math.round((active / total) * 100) : 0;
  const activeFormatted = formatValue(active);
  const totalFormatted = formatValue(total);

  const renderCenterLabel = (props: { viewBox?: { cx?: number; cy?: number; x?: number; y?: number; width?: number; height?: number } }) => {
    const v = props?.viewBox;
    const cx = v?.cx ?? (v && "width" in v ? (v.x ?? 0) + (v.width ?? 0) / 2 : 0);
    const cy = v?.cy ?? (v && "height" in v ? (v.y ?? 0) + (v.height ?? 0) / 2 : 0);
    return (
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" className="fill-foreground">
        <tspan x={cx} dy="-0.4em" style={{ fontSize: "12px", fontWeight: 600 }}>{title}</tspan>
        <tspan x={cx} dy="1.2em" style={{ fontSize: "14px", fontWeight: "bold" }}>{percentage}%</tspan>
      </text>
    );
  };

  return (
    <div className="space-y-2 flex flex-col items-center w-full">
      <p className="text-muted-foreground text-xs text-center w-full">
        {activeFormatted} / {totalFormatted}
      </p>
      <ChartContainer
        config={{
          active: { label: "Active", color: activeColor },
          available: { label: "Available", color: availableColor },
        }}
        className="h-[120px] w-full max-w-[140px] mx-auto"
      >
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={35}
            outerRadius={50}
            paddingAngle={2}
            dataKey="value"
            startAngle={90}
            endAngle={-270}
            label={false}
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.fill} />
            ))}
            <Label position="center" content={renderCenterLabel} />
          </Pie>
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, name) => [
                  `${formatValue(Number(value))} (${name === "active" ? percentage : 100 - percentage}%)`,
                  name === "active" ? "Active" : "Available",
                ]}
                hideLabel
              />
            }
          />
        </PieChart>
      </ChartContainer>
    </div>
  );
}

export function ProviderStatsDonutChart({
  activeCPU,
  totalCPU,
  activeGPU,
  totalGPU,
  activeMemory,
  totalMemory,
  activeStorage,
  totalStorage,
}: ProviderStatsDonutChartProps) {
  const formatCPU = (val: number) => `${Math.round(val)} cores`;
  const formatGPU = (val: number) => `${Math.round(val)} GPUs`;
  const formatMemory = (val: number) => {
    const mem = bytesToShrink(val);
    const decimals = mem.unit === "GB" || mem.unit === "TB" ? 1 : 2;
    return `${roundDecimal(mem.value, decimals)} ${mem.unit}`;
  };
  const formatStorage = (val: number) => {
    const store = bytesToShrink(val);
    const decimals = store.unit === "GB" || store.unit === "TB" ? 1 : 2;
    return `${roundDecimal(store.value, decimals)} ${store.unit}`;
  };

  return (
    <div className="grid grid-cols-2 gap-4">
      <DonutChartCard
        title="CPU"
        active={activeCPU}
        total={totalCPU}
        activeColor={COLORS.cpu.active}
        availableColor={COLORS.cpu.available}
        formatValue={formatCPU}
      />
      <DonutChartCard
        title="GPU"
        active={activeGPU}
        total={totalGPU}
        activeColor={COLORS.gpu.active}
        availableColor={COLORS.gpu.available}
        formatValue={formatGPU}
      />
      <DonutChartCard
        title="RAM"
        active={activeMemory}
        total={totalMemory}
        activeColor={COLORS.memory.active}
        availableColor={COLORS.memory.available}
        formatValue={formatMemory}
      />
      <DonutChartCard
        title="Disk"
        active={activeStorage}
        total={totalStorage}
        activeColor={COLORS.storage.active}
        availableColor={COLORS.storage.available}
        formatValue={formatStorage}
      />
    </div>
  );
}
