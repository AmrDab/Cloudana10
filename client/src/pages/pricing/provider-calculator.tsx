import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

const MAX_VALUE = {
  leasePercentInput: 100,
  cpuInput: 100,
  cpuPricing: 5,
  memoryInput: 1024,
  memoryPricing: 5,
  storageInput: 10240,
  storagePricing: 1,
  persistentStorageInput: 10240,
  persistentStoragePricing: 1,
  gpuInput: 100,
  gpuPricing: 1000,
  ipInput: 100,
  ipPricing: 10,
  endpointInput: 100,
  endpointPricing: 1,
};

const STEP = {
  leasePercentInput: 0.5,
  cpuInput: 1,
  cpuPricing: 0.1,
  memoryInput: 1,
  memoryPricing: 0.1,
  storageInput: 1,
  storagePricing: 0.001,
  persistentStorageInput: 1,
  persistentStoragePricing: 0.001,
  gpuInput: 1,
  gpuPricing: 1,
  ipInput: 1,
  ipPricing: 0.1,
  endpointInput: 1,
  endpointPricing: 0.01,
};

export default function ProviderCalculatorPage() {
  const [leasePercentInput, setLeasePercentInput] = useState(100);
  const [cpuInput, setCpuInput] = useState(10);
  const [cpuPricing, setCpuPricing] = useState(1.6);
  const [memoryInput, setMemoryInput] = useState(256);
  const [memoryPricing, setMemoryPricing] = useState(0.8);
  const [storageInput, setStorageInput] = useState(1024);
  const [storagePricing, setStoragePricing] = useState(0.02);
  const [persistentStorageInput, setPersistentStorageInput] = useState(1024);
  const [persistentStoragePricing, setPersistentStoragePricing] = useState(0.04);
  const [gpuInput, setGPUInput] = useState(1);
  const [gpuPricing, setGPUPricing] = useState(100);
  const [ipInput, setIpInput] = useState(1);
  const [ipPricing, setIpPricing] = useState(1);
  const [endpointInput, setEndpointInput] = useState(1);
  const [endpointPricing, setEndpointPricing] = useState(1);

  const [CLDAverage, setCLDAverage] = useState(true);
  const [usdPrice, setUsdPrice] = useState(0);
  const [monthlyAverage, setMonthlyAverage] = useState(0);

  const [usdPrices, setUsdPrices] = useState({
    cpuTotalPrice: 0,
    memoryTotalPrice: 0,
    storageTotalPrice: 0,
    persistenStorageTotalPrice: 0,
    gpuTotalPrice: 0,
    ipTotalPrice: 0,
    endpointTotalPrice: 0,
    totalPrice: 0,
  });

  // Fetch CLD price
  const { isLoading: loadingPrice } = useQuery({
    queryKey: ["CLD_PRICE"],
    queryFn: async () => {
      const response = await fetch("https://api.coingecko.com/api/v3/coins/akash-network/tickers");
      const data = await response.json();
      for (let i = 0; i < data.tickers.length; i += 1) {
        if (data.tickers[i].market.name === "Coinbase Exchange") {
          setUsdPrice(data.tickers[i].converted_last.usd);
          return data.tickers[i].converted_last.usd;
        }
      }
      return 0;
    },
  });

  // Fetch 30-day average
  const { isLoading: loadingDaily } = useQuery({
    queryKey: ["CLD_AVERAGE"],
    queryFn: async () => {
      const response = await fetch(
        "https://api.coingecko.com/api/v3/coins/akash-network/market_chart?vs_currency=usd&days=30&interval=daily"
      );
      const data = await response.json();
      const mean = data.prices.reduce((acc: number, [_, price]: [number, number]) => acc + price, 0) / data.prices.length;
      setMonthlyAverage(mean);
      if (usdPrice > mean) {
        setCLDAverage(false);
      }
      return mean;
    },
  });

  useEffect(() => {
    const cpuTotalPrice = (cpuInput * cpuPricing) / (100 / leasePercentInput);
    const memoryTotalPrice = (memoryInput * memoryPricing) / (100 / leasePercentInput);
    const storageTotalPrice = (storageInput * storagePricing) / (100 / leasePercentInput);
    const persistenStorageTotalPrice = (persistentStorageInput * persistentStoragePricing) / (100 / leasePercentInput);
    const gpuTotalPrice = (gpuPricing * gpuInput) / (100 / leasePercentInput);
    const ipTotalPrice = (ipPricing * ipInput) / (100 / leasePercentInput);
    const endpointTotalPrice = (endpointInput * endpointPricing) / (100 / leasePercentInput);

    const totalPrice =
      cpuTotalPrice +
      memoryTotalPrice +
      storageTotalPrice +
      persistenStorageTotalPrice +
      gpuTotalPrice +
      ipTotalPrice +
      endpointTotalPrice;

    setUsdPrices({
      cpuTotalPrice,
      memoryTotalPrice,
      storageTotalPrice,
      persistenStorageTotalPrice,
      gpuTotalPrice,
      ipTotalPrice,
      endpointTotalPrice,
      totalPrice,
    });
  }, [
    cpuInput,
    cpuPricing,
    memoryInput,
    memoryPricing,
    storageInput,
    storagePricing,
    persistentStorageInput,
    persistentStoragePricing,
    gpuInput,
    gpuPricing,
    ipInput,
    ipPricing,
    endpointInput,
    endpointPricing,
    leasePercentInput,
  ]);

  const calculateCLDPrice = (usdValue: number) => {
    return (CLDAverage ? usdValue / monthlyAverage : usdValue / usdPrice).toFixed(2);
  };

  const convertPricing = (value: number) => {
    return value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Provider Earn Calculator</h1>
        <p className="text-muted-foreground">
          Calculate your potential earnings by providing resources to the Cloudana OS.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Earnings Summary */}
        <div className="lg:col-span-1 space-y-6">
          <Card className="p-6">
            <h2 className="font-semibold mb-6">Estimated Earnings</h2>
            <div className="space-y-6">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Total Monthly Earnings (USD)</p>
                <p className="text-2xl font-semibold">
                  {loadingPrice || loadingDaily ? "Loading..." : `$${convertPricing(usdPrices.totalPrice)}`}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Total Monthly Earnings (CLD)</p>
                <p className="text-2xl font-semibold">
                  {loadingPrice || loadingDaily ? "Loading..." : `${convertPricing(+calculateCLDPrice(usdPrices.totalPrice))} CLD`}
                </p>
              </div>
              <div className="flex items-center justify-between gap-4 pt-4 border-t">
                <div>
                  <p className="text-sm">Use 30-Day Average Price</p>
                  <p className="text-xs text-muted-foreground">
                    Avg: ${monthlyAverage.toFixed(2)} USD
                  </p>
                </div>
                <Switch
                  checked={CLDAverage}
                  onCheckedChange={setCLDAverage}
                />
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="font-semibold mb-6">Estimated Breakdown</h2>
            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-sm">CPU Earnings</span>
                <span className="font-semibold">${usdPrices.cpuTotalPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Memory Earnings</span>
                <span className="font-semibold">${usdPrices.memoryTotalPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Storage Earnings</span>
                <span className="font-semibold">${usdPrices.storageTotalPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Persistent Storage</span>
                <span className="font-semibold">${usdPrices.persistenStorageTotalPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">GPU Earnings</span>
                <span className="font-semibold">${usdPrices.gpuTotalPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">IP Earnings</span>
                <span className="font-semibold">${usdPrices.ipTotalPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Endpoint Earnings</span>
                <span className="font-semibold">${usdPrices.endpointTotalPrice.toFixed(2)}</span>
              </div>
            </div>
          </Card>
        </div>

        {/* Resource Configuration */}
        <div className="lg:col-span-2">
          <Card className="p-6">
            <h2 className="font-semibold mb-6">Provider Earn Calculator</h2>
            <div className="space-y-8">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="leasePercent">Provider Utilization</Label>
                  <span className="text-sm font-medium">{leasePercentInput}%</span>
                </div>
                <Slider
                  id="leasePercent"
                  min={0}
                  max={MAX_VALUE.leasePercentInput}
                  step={STEP.leasePercentInput}
                  value={[leasePercentInput]}
                  onValueChange={(value) => setLeasePercentInput(value[0])}
                />
                <p className="text-xs text-muted-foreground">Usage % in your provider</p>
              </div>

              <div className="space-y-6 border-t pt-6">
                <h3 className="font-semibold">Resources Pricing</h3>
                
                <div className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="cpu">CPU</Label>
                      <span className="text-sm font-medium">{cpuInput} vCPU</span>
                    </div>
                    <Slider
                      id="cpu"
                      min={1}
                      max={MAX_VALUE.cpuInput}
                      step={STEP.cpuInput}
                      value={[cpuInput]}
                      onValueChange={(value) => setCpuInput(value[0])}
                    />
                    <div className="flex justify-between items-center mt-2">
                      <Label htmlFor="cpuPricing" className="text-sm">CPU Pricing</Label>
                      <span className="text-sm font-medium">${cpuPricing.toFixed(2)} / thread-month</span>
                    </div>
                    <Slider
                      id="cpuPricing"
                      min={0.1}
                      max={MAX_VALUE.cpuPricing}
                      step={STEP.cpuPricing}
                      value={[cpuPricing]}
                      onValueChange={(value) => setCpuPricing(value[0])}
                    />
                  </div>

                  <div className="space-y-2 border-t pt-4">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="memory">Memory</Label>
                      <span className="text-sm font-medium">{memoryInput} GB</span>
                    </div>
                    <Slider
                      id="memory"
                      min={1}
                      max={MAX_VALUE.memoryInput}
                      step={STEP.memoryInput}
                      value={[memoryInput]}
                      onValueChange={(value) => setMemoryInput(value[0])}
                    />
                    <div className="flex justify-between items-center mt-2">
                      <Label htmlFor="memoryPricing" className="text-sm">Memory Pricing</Label>
                      <span className="text-sm font-medium">${memoryPricing.toFixed(2)} / GB-month</span>
                    </div>
                    <Slider
                      id="memoryPricing"
                      min={0.1}
                      max={MAX_VALUE.memoryPricing}
                      step={STEP.memoryPricing}
                      value={[memoryPricing]}
                      onValueChange={(value) => setMemoryPricing(value[0])}
                    />
                  </div>

                  <div className="space-y-2 border-t pt-4">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="storage">Ephemeral Storage</Label>
                      <span className="text-sm font-medium">{storageInput} GB</span>
                    </div>
                    <Slider
                      id="storage"
                      min={1}
                      max={MAX_VALUE.storageInput}
                      step={STEP.storageInput}
                      value={[storageInput]}
                      onValueChange={(value) => setStorageInput(value[0])}
                    />
                    <div className="flex justify-between items-center mt-2">
                      <Label htmlFor="storagePricing" className="text-sm">Storage Pricing</Label>
                      <span className="text-sm font-medium">${storagePricing.toFixed(3)} / GB-month</span>
                    </div>
                    <Slider
                      id="storagePricing"
                      min={0.001}
                      max={MAX_VALUE.storagePricing}
                      step={STEP.storagePricing}
                      value={[storagePricing]}
                      onValueChange={(value) => setStoragePricing(value[0])}
                    />
                  </div>

                  <div className="space-y-2 border-t pt-4">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="persistentStorage">Persistent Storage</Label>
                      <span className="text-sm font-medium">{persistentStorageInput} GB</span>
                    </div>
                    <Slider
                      id="persistentStorage"
                      min={1}
                      max={MAX_VALUE.persistentStorageInput}
                      step={STEP.persistentStorageInput}
                      value={[persistentStorageInput]}
                      onValueChange={(value) => setPersistentStorageInput(value[0])}
                    />
                    <div className="flex justify-between items-center mt-2">
                      <Label htmlFor="persistentStoragePricing" className="text-sm">Storage Pricing</Label>
                      <span className="text-sm font-medium">${persistentStoragePricing.toFixed(3)} / GB-month</span>
                    </div>
                    <Slider
                      id="persistentStoragePricing"
                      min={0.001}
                      max={MAX_VALUE.persistentStoragePricing}
                      step={STEP.persistentStoragePricing}
                      value={[persistentStoragePricing]}
                      onValueChange={(value) => setPersistentStoragePricing(value[0])}
                    />
                  </div>

                  <div className="space-y-2 border-t pt-4">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="gpu">GPUs</Label>
                      <span className="text-sm font-medium">{gpuInput} Unit</span>
                    </div>
                    <Slider
                      id="gpu"
                      min={1}
                      max={MAX_VALUE.gpuInput}
                      step={STEP.gpuInput}
                      value={[gpuInput]}
                      onValueChange={(value) => setGPUInput(value[0])}
                    />
                    <div className="flex justify-between items-center mt-2">
                      <Label htmlFor="gpuPricing" className="text-sm">GPU Pricing</Label>
                      <span className="text-sm font-medium">${gpuPricing.toFixed(2)} / unit-month</span>
                    </div>
                    <Slider
                      id="gpuPricing"
                      min={1}
                      max={MAX_VALUE.gpuPricing}
                      step={STEP.gpuPricing}
                      value={[gpuPricing]}
                      onValueChange={(value) => setGPUPricing(value[0])}
                    />
                  </div>

                  <div className="space-y-2 border-t pt-4">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="ip">IPs</Label>
                      <span className="text-sm font-medium">{ipInput} Unit</span>
                    </div>
                    <Slider
                      id="ip"
                      min={1}
                      max={MAX_VALUE.ipInput}
                      step={STEP.ipInput}
                      value={[ipInput]}
                      onValueChange={(value) => setIpInput(value[0])}
                    />
                    <div className="flex justify-between items-center mt-2">
                      <Label htmlFor="ipPricing" className="text-sm">IP Pricing</Label>
                      <span className="text-sm font-medium">${ipPricing.toFixed(2)} / unit-month</span>
                    </div>
                    <Slider
                      id="ipPricing"
                      min={0.1}
                      max={MAX_VALUE.ipPricing}
                      step={STEP.ipPricing}
                      value={[ipPricing]}
                      onValueChange={(value) => setIpPricing(value[0])}
                    />
                  </div>

                  <div className="space-y-2 border-t pt-4">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="endpoint">Endpoints</Label>
                      <span className="text-sm font-medium">{endpointInput} Unit</span>
                    </div>
                    <Slider
                      id="endpoint"
                      min={1}
                      max={MAX_VALUE.endpointInput}
                      step={STEP.endpointInput}
                      value={[endpointInput]}
                      onValueChange={(value) => setEndpointInput(value[0])}
                    />
                    <div className="flex justify-between items-center mt-2">
                      <Label htmlFor="endpointPricing" className="text-sm">Endpoint Pricing</Label>
                      <span className="text-sm font-medium">${endpointPricing.toFixed(2)} / port-month</span>
                    </div>
                    <Slider
                      id="endpointPricing"
                      min={0.01}
                      max={MAX_VALUE.endpointPricing}
                      step={STEP.endpointPricing}
                      value={[endpointPricing]}
                      onValueChange={(value) => setEndpointPricing(value[0])}
                    />
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
