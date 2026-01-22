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
    return [
      { name: "active", value: active, fill: activeColor },
      { name: "available", value: available, fill: availableColor },
    ];
  }, [active, total, activeColor, availableColor]);

  const percentage = total > 0 ? Math.round((active / total) * 100) : 0;
  const activeFormatted = formatValue(active);
  const totalFormatted = formatValue(total);

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold tracking-tight">{title}</p>
      <p className="text-muted-foreground text-xs">
        {activeFormatted} / {totalFormatted}
      </p>
      <ChartContainer
        config={{
          active: { label: "Active", color: activeColor },
          available: { label: "Available", color: availableColor },
        }}
        className="h-[120px] w-full"
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
            <Label
              value={`${percentage}%`}
              position="center"
              className="fill-foreground text-lg font-bold"
              style={{ fontSize: "18px", fontWeight: "bold" }}
            />
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
  const formatCPU = (val: number) => `${Math.round(val)} CPU`;
  const formatGPU = (val: number) => `${Math.round(val)} GPU`;
  const formatMemory = (val: number) => {
    const mem = bytesToShrink(val);
    return `${roundDecimal(mem.value, 2)} ${mem.unit}`;
  };
  const formatStorage = (val: number) => {
    const store = bytesToShrink(val);
    return `${roundDecimal(store.value, 2)} ${store.unit}`;
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
        title="Memory"
        active={activeMemory}
        total={totalMemory}
        activeColor={COLORS.memory.active}
        availableColor={COLORS.memory.available}
        formatValue={formatMemory}
      />
      <DonutChartCard
        title="Storage"
        active={activeStorage}
        total={totalStorage}
        activeColor={COLORS.storage.active}
        availableColor={COLORS.storage.available}
        formatValue={formatStorage}
      />
    </div>
  );
}
