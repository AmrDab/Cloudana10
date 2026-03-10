import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";

const DEFAULT_USAGE = {
  cpu: 20,
  memory: 128,
  ephemeralStorage: 256,
  persistentStorage: 256,
};

const MAX_VALUE = {
  cpu: 100,
  memory: 1024,
  ephemeralStorage: 10240,
  persistentStorage: 10240,
};

const AKASH_DEFAULT_PRICE = {
  cpu: 1.6,
  memory: 0.8,
  ephemeralStorage: 0.02,
  persistentStorage: 0.04,
};

const AWS_DEFAULT_PRICE = {
  cpu: 2.5,
  memory: 1.2,
  ephemeralStorage: 0.03,
  persistentStorage: 0.04,
};

const GCP_DEFAULT_PRICE = {
  cpu: 2,
  memory: 1,
  ephemeralStorage: 0.025,
  persistentStorage: 0.04,
};

const AZURE_DEFAULT_PRICE = {
  cpu: 2.1,
  memory: 1.1,
  ephemeralStorage: 0.02,
  persistentStorage: 0.044,
};

export default function UsageCalculatorPage() {
  const [cpu, setCpu] = useState<number>(DEFAULT_USAGE.cpu);
  const [memory, setMemory] = useState<number>(DEFAULT_USAGE.memory);
  const [ephemeralStorage, setEphemeralStorage] = useState<number>(DEFAULT_USAGE.ephemeralStorage);
  const [persistentStorage, setPersistentStorage] = useState<number>(DEFAULT_USAGE.persistentStorage);

  const [akashCost, setAkashCost] = useState<number>(0);
  const [awsCost, setAwsCost] = useState<number>(0);
  const [gcpCost, setGcpCost] = useState<number>(0);
  const [azureCost, setAzureCost] = useState<number>(0);
  const [savingPercent, setSavingPercent] = useState<number>(0);

  useEffect(() => {
    const akash = 
      cpu * AKASH_DEFAULT_PRICE.cpu +
      memory * AKASH_DEFAULT_PRICE.memory +
      ephemeralStorage * AKASH_DEFAULT_PRICE.ephemeralStorage +
      persistentStorage * AKASH_DEFAULT_PRICE.persistentStorage;
    
    const aws = 
      cpu * AWS_DEFAULT_PRICE.cpu +
      memory * AWS_DEFAULT_PRICE.memory +
      ephemeralStorage * AWS_DEFAULT_PRICE.ephemeralStorage +
      persistentStorage * AWS_DEFAULT_PRICE.persistentStorage;
    
    const gcp = 
      cpu * GCP_DEFAULT_PRICE.cpu +
      memory * GCP_DEFAULT_PRICE.memory +
      ephemeralStorage * GCP_DEFAULT_PRICE.ephemeralStorage +
      persistentStorage * GCP_DEFAULT_PRICE.persistentStorage;
    
    const azure = 
      cpu * AZURE_DEFAULT_PRICE.cpu +
      memory * AZURE_DEFAULT_PRICE.memory +
      ephemeralStorage * AZURE_DEFAULT_PRICE.ephemeralStorage +
      persistentStorage * AZURE_DEFAULT_PRICE.persistentStorage;

    setAkashCost(akash);
    setAwsCost(aws);
    setGcpCost(gcp);
    setAzureCost(azure);
  }, [cpu, memory, ephemeralStorage, persistentStorage]);

  useEffect(() => {
    const maxCost = Math.max(...[awsCost, gcpCost, azureCost]);
    setSavingPercent(maxCost > 0 ? ((maxCost - akashCost) * 100) / maxCost : 0);
  }, [akashCost, awsCost, gcpCost, azureCost]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Usage Pricing Calculator</h1>
        <p className="text-muted-foreground">
          Estimate your costs by selecting the resources you need. Adjust CPU, memory, storage, and other parameters to get a detailed cost breakdown.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Cost Summary */}
        <div className="lg:col-span-1 space-y-6">
          <Card className="p-6">
            <h2 className="font-semibold mb-4">Price Estimate (USD per month)</h2>
            <div className="space-y-4">
              <div className="border-b pb-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-6 w-6 rounded bg-primary" />
                  <span className="font-semibold">Cloudana OS</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Estimated Cost:</span>
                  <span className="text-2xl font-semibold">${akashCost.toFixed(2)}</span>
                </div>
                <div className="mt-2 flex justify-end">
                  <span className="rounded-full bg-green-100 dark:bg-green-900 px-2.5 py-1 text-sm font-medium text-green-800 dark:text-green-200">
                    Save {savingPercent.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="font-semibold mb-4">Price Compare</h2>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm">AWS</span>
                <span className="font-semibold">${awsCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">GCP</span>
                <span className="font-semibold">${gcpCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Azure</span>
                <span className="font-semibold">${azureCost.toFixed(2)}</span>
              </div>
            </div>
          </Card>
        </div>

        {/* Resource Sliders */}
        <div className="lg:col-span-2">
          <Card className="p-6">
            <h2 className="font-semibold mb-6">Usage Estimate</h2>
            <div className="space-y-8">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="cpu">CPU</Label>
                  <span className="text-sm font-medium">{cpu} vCPUs</span>
                </div>
                <Slider
                  id="cpu"
                  min={1}
                  max={MAX_VALUE.cpu}
                  step={1}
                  value={[cpu]}
                  onValueChange={(value) => setCpu(value[0])}
                />
                <p className="text-xs text-muted-foreground">Amount of vCPUs</p>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="memory">Memory</Label>
                  <span className="text-sm font-medium">{memory} GB</span>
                </div>
                <Slider
                  id="memory"
                  min={1}
                  max={MAX_VALUE.memory}
                  step={1}
                  value={[memory]}
                  onValueChange={(value) => setMemory(value[0])}
                />
                <p className="text-xs text-muted-foreground">Amount of memory</p>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="ephemeral">Ephemeral Storage</Label>
                  <span className="text-sm font-medium">{ephemeralStorage} GB</span>
                </div>
                <Slider
                  id="ephemeral"
                  min={1}
                  max={MAX_VALUE.ephemeralStorage}
                  step={1}
                  value={[ephemeralStorage]}
                  onValueChange={(value) => setEphemeralStorage(value[0])}
                />
                <p className="text-xs text-muted-foreground">Amount of ephemeral disk storage</p>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="persistent">Persistent Storage</Label>
                  <span className="text-sm font-medium">{persistentStorage} GB</span>
                </div>
                <Slider
                  id="persistent"
                  min={1}
                  max={MAX_VALUE.persistentStorage}
                  step={1}
                  value={[persistentStorage]}
                  onValueChange={(value) => setPersistentStorage(value[0])}
                />
                <p className="text-xs text-muted-foreground">Amount of persistent disk storage</p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
