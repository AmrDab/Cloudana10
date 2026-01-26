import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Info, Trash2, ExternalLink, Plus } from "lucide-react";

export type StorageUnit = "Mi" | "Gi" | "Ti";

export interface GpuModel {
  id: string;
  vendor: string;
  model: string;
  memory: string;
  interface: string;
  count: number;
}

export interface PersistentStorageItem {
  id: string;
  size: number;
  unit: StorageUnit;
  name: string;
  readOnly: boolean;
  type: string;
  mount: string;
}

export interface RamStorageItem {
  id: string;
  size: number;
  unit: StorageUnit;
  name: string;
  type: string;
  mount: string;
}

export interface ExposeItem {
  port: number;
  as?: number;
  global: boolean;
  accept?: string;
}

export type BuildType = "build-deploy" | "container-vm" | "custom-container";

export interface DeploymentEditTemplate {
  id: string;
  name?: string;
  path?: string;
  logoUrl?: string | null;
  summary?: string;
  githubUrl?: string;
  deploy?: string;
  category?: string;
  persistentStorageEnabled?: boolean;
  buildType?: BuildType;
}

export type DeploySummary = {
  cpu: string;
  ram: string;
  gpu: string;
  disk: string;
  dockerImage: string;
  expose: string;
  env: string;
  commands: string;
};

export const defaultBuilderConfig = {
  image: "nginx:latest",
  imagePrivate: false,
  cpu: 1,
  gpu: 0,
  hasGpu: false,
  memory: 1,
  memoryUnit: "Gi" as StorageUnit,
  ephemeralStorage: 10,
  ephemeralUnit: "Gi" as StorageUnit,
  storage: 10,
  storageUnit: "Gi" as StorageUnit,
  persistentStorages: [] as PersistentStorageItem[],
  ramStorages: [] as RamStorageItem[],
  expose: [] as ExposeItem[],
  env: [] as { key: string; value: string }[],
  commands: [] as string[],
  gpuModels: [] as GpuModel[],
  serviceCount: 1,
  token: "CLD",
};

export type BuilderConfig = typeof defaultBuilderConfig;

export function deployToBuilderConfig(parsed: Record<string, unknown>): Partial<BuilderConfig> {
  const svc =
    parsed?.services && typeof parsed.services === "object"
      ? (Object.values(parsed.services)[0] as Record<string, unknown>)
      : undefined;
  const image = (svc?.image as string) || "nginx:latest";
  const envArr = Array.isArray(svc?.env) ? (svc.env as { key?: string; value?: string }[]) : [];
  const env = envArr.map((e) => ({ key: e.key || "", value: e.value || "" }));
  const commands = Array.isArray(svc?.command) ? (svc.command as string[]) : [];
  const exposeArr = Array.isArray(svc?.expose)
    ? (svc.expose as { port?: number; as?: number; to?: { global?: boolean; accept?: string }[] }[])
    : [];
  const expose: ExposeItem[] = exposeArr.map((e) => ({
    port: e.port ?? 80,
    as: e.as ?? e.port,
    global: e.to?.[0]?.global ?? true,
    accept: e.to?.[0]?.accept,
  }));

  const compute =
    parsed?.profiles && (parsed.profiles as Record<string, unknown>).compute
      ? (Object.values((parsed.profiles as Record<string, unknown>).compute as Record<string, unknown>)[0] as Record<string, unknown>)
      : undefined;
  const resources = (compute?.resources as Record<string, unknown>) || {};
  const cpu = (resources.cpu as { units?: number })?.units ?? 1;
  const gpuRes = resources.gpu as
    | { units?: number; attributes?: { vendor?: Record<string, { model?: string }> } }
    | undefined;
  const gpu = gpuRes?.units ?? 0;
  const hasGpu = !!gpuRes && gpu > 0;
  const memSize = (resources.memory as { size?: string })?.size ?? "1Gi";
  const memory = parseFloat(String(memSize).replace(/[^0-9.]/g, "") || "1");
  const memoryUnit = (memSize.includes("Gi") ? "Gi" : memSize.includes("Ti") ? "Ti" : "Mi") as StorageUnit;
  const stor = (resources.storage as { size?: string; name?: string; mount?: string; attributes?: { persistent?: boolean } }[]) ?? [];
  const ephemeral = stor.find((s) => !s.name && !s.attributes?.persistent) ?? stor[0];
  const epSize = ephemeral?.size ?? "10Gi";
  const ephemeralStorage = parseFloat(String(epSize).replace(/[^0-9.]/g, "") || "10") || 10;
  const ephemeralUnit = (String(epSize).includes("Gi") ? "Gi" : String(epSize).includes("Ti") ? "Ti" : "Mi") as StorageUnit;
  const persistentStorages: PersistentStorageItem[] = stor
    .filter((s) => s.attributes?.persistent || s.name)
    .map((s, i) => ({
      id: `pers-${i}-${Math.random().toString(36).slice(2)}`,
      size: parseFloat(String(s.size ?? "10").replace(/[^0-9.]/g, "") || "10"),
      unit: (String(s.size ?? "").includes("Gi") ? "Gi" : String(s.size ?? "").includes("Ti") ? "Ti" : "Mi") as StorageUnit,
      name: (s as { name?: string }).name ?? "data",
      readOnly: false,
      type: "NVMe",
      mount: (s as { mount?: string }).mount ?? "/data",
    }));
  const gpuModels: GpuModel[] = [];
  if (gpuRes?.attributes?.vendor) {
    const v = gpuRes.attributes.vendor as Record<string, { model?: string; memory?: string; interface?: string }>;
    Object.entries(v).forEach(([vendor, att], idx) => {
      const model = att.model ?? "A100";
      gpuModels.push({
        id: `gpu-${idx}-${vendor}-${model}`,
        vendor,
        model,
        memory: att.memory ?? "",
        interface: att.interface ?? "",
        count: 1,
      });
    });
  }
  if (hasGpu && gpuModels.length === 0) {
    gpuModels.push({
      id: "gpu-default",
      vendor: "nvidia",
      model: "A100",
      memory: "",
      interface: "",
      count: gpu > 0 ? gpu : 1,
    });
  }

  return {
    image,
    imagePrivate: false,
    cpu,
    gpu,
    hasGpu,
    memory,
    memoryUnit,
    ephemeralStorage,
    ephemeralUnit,
    storage: ephemeralStorage,
    storageUnit: ephemeralUnit,
    persistentStorages,
    ramStorages: [] as RamStorageItem[],
    expose: expose.length ? expose : [{ port: 80, as: 80, global: true }],
    env,
    commands,
    gpuModels,
  };
}

export function extractDeploySummary(config: string): DeploySummary | null {
  try {
    const parsed = JSON.parse(config.trim()) as Record<string, unknown>;
    const b = deployToBuilderConfig(parsed) as BuilderConfig;
    const gpuStr =
      !b.hasGpu || b.gpuModels.length === 0
        ? "None"
        : `${b.gpuModels.reduce((s, g) => s + Math.max(1, g.count), 0)} (${b.gpuModels.map((g) => `${g.vendor} ${g.model}`).join(", ")})`;
    const diskEphemeral = `${b.ephemeralStorage} ${b.ephemeralUnit}`;
    const diskPersistent =
      b.persistentStorages.length === 0
        ? "None"
        : b.persistentStorages.map((p) => `${p.name}: ${p.size} ${p.unit}`).join("; ");
    const disk = diskPersistent === "None" ? diskEphemeral : `Ephemeral: ${diskEphemeral}; Persistent: ${diskPersistent}`;
    const exposeStr =
      b.expose.length === 0 ? "None" : b.expose.map((e) => `${e.port}${e.as !== e.port ? ` → ${e.as}` : ""}`).join(", ");
    return {
      cpu: `${b.cpu} units`,
      ram: `${b.memory} ${b.memoryUnit}`,
      gpu: gpuStr,
      disk,
      dockerImage: b.image,
      expose: exposeStr,
      env: b.env.length === 0 ? "None" : `${b.env.length} variable(s)`,
      commands: b.commands.length === 0 ? "None" : b.commands.join("; "),
    };
  } catch {
    return null;
  }
}

export const CONTAINER_VM_OS_OPTIONS = [
  { label: "Ubuntu 24.04", value: "ubuntu:24.04" },
  { label: "CentOS Stream 9", value: "quay.io/centos/centos:stream9" },
  { label: "Debian 11", value: "debian:11" },
  { label: "SuSE Leap 15.5", value: "opensuse/leap:15.5" },
] as const;

export interface BuilderProps {
  builderConfig: BuilderConfig;
  setBuilderConfig: React.Dispatch<React.SetStateAction<BuilderConfig>>;
  editingExpose: boolean;
  setEditingExpose: (v: boolean) => void;
  editingEnv: boolean;
  setEditingEnv: (v: boolean) => void;
  editingCommands: boolean;
  setEditingCommands: (v: boolean) => void;
  hideDockerImage?: boolean;
  hideExposeEnvCommands?: boolean;
  hidePersistentRamStorage?: boolean;
  useDockerImagePreset?: boolean;
  hideCommands?: boolean;
  hideServiceCount?: boolean;
}

export function DeploymentEditBuilder({
  builderConfig,
  setBuilderConfig,
  editingExpose,
  setEditingExpose,
  editingEnv,
  setEditingEnv,
  editingCommands,
  setEditingCommands,
  hideDockerImage = false,
  hideExposeEnvCommands = false,
  hidePersistentRamStorage = false,
  useDockerImagePreset = false,
  hideCommands = false,
  hideServiceCount = false,
}: BuilderProps) {
  return (
    <TooltipProvider>
      <div className="space-y-4">
        {!hideDockerImage && (
        <Card className="border-white/10 bg-card/40">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Docker Image / OS</CardTitle>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {useDockerImagePreset
                      ? "Select an OS image for your container VM"
                      : "Container image (e.g. nginx:latest or lmsysorg/sglang:v0.4.1)"}
                  </TooltipContent>
                </Tooltip>
              </div>
              {!useDockerImagePreset && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="image-private"
                    checked={builderConfig.imagePrivate}
                    onCheckedChange={(c) => setBuilderConfig({ ...builderConfig, imagePrivate: !!c })}
                  />
                  <Label htmlFor="image-private" className="text-sm cursor-pointer">
                    Private
                  </Label>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex gap-2">
            {useDockerImagePreset ? (
              <Select
                value={CONTAINER_VM_OS_OPTIONS.some((o) => o.value === builderConfig.image) ? builderConfig.image : "ubuntu:24.04"}
                onValueChange={(v) => setBuilderConfig({ ...builderConfig, image: v })}
              >
                <SelectTrigger className="bg-background/50 border-white/10 max-w-sm">
                  <SelectValue placeholder="Select OS" />
                </SelectTrigger>
                <SelectContent>
                  {CONTAINER_VM_OS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <>
                <Input
                  value={builderConfig.image}
                  onChange={(e) => setBuilderConfig({ ...builderConfig, image: e.target.value })}
                  placeholder="e.g. nginx:latest"
                  className="bg-background/50 border-white/10"
                />
                <Button type="button" variant="outline" size="icon" asChild>
                  <a
                    href={`https://hub.docker.com/search?q=${encodeURIComponent(builderConfig.image.split(":")[0] || "")}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Search on Docker Hub"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
        )}

        <Card className="border-white/10 bg-card/40">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">CPU</CardTitle>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    tabIndex={-1}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-0"
                    aria-label="CPU info"
                  >
                    <Info className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs text-sm">
                  <p>The amount of vCPU&apos;s required for this workload.</p>
                  <p className="mt-1">The maximum for a single instance is 384 vCPU&apos;s.</p>
                  <p className="mt-1">The maximum total multiplied by the count of instances is 512 vCPU&apos;s.</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              type="number"
              min={1}
              max={64}
              value={builderConfig.cpu}
              onChange={(e) => setBuilderConfig({ ...builderConfig, cpu: Math.max(1, parseInt(e.target.value) || 1) })}
              className="w-24 bg-background/50 border-white/10"
            />
            <Slider
              min={1}
              max={64}
              step={1}
              value={[builderConfig.cpu]}
              onValueChange={([v]) => setBuilderConfig({ ...builderConfig, cpu: v ?? 1 })}
            />
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-card/40">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">GPU</CardTitle>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>Vendor, model, memory, interface, and count per item</TooltipContent>
              </Tooltip>
              <div className="flex items-center gap-0">
                <Checkbox
                  id="has-gpu"
                  checked={builderConfig.hasGpu}
                  onCheckedChange={(c) => {
                    const enable = !!c;
                    setBuilderConfig({
                      ...builderConfig,
                      hasGpu: enable,
                      gpu: enable ? builderConfig.gpu || 1 : 0,
                      gpuModels: enable && builderConfig.gpuModels.length === 0
                        ? [{ id: `gpu-${Date.now()}`, vendor: "nvidia", model: "a100", memory: "", interface: "", count: 1 }]
                        : enable
                          ? builderConfig.gpuModels
                          : [],
                    });
                  }}
                />
                <Label htmlFor="has-gpu" className="text-sm cursor-pointer">
                  Enable
                </Label>
                {builderConfig.hasGpu && builderConfig.gpuModels.length > 0 && (
                  <Input
                    type="number"
                    readOnly
                    value={builderConfig.gpuModels.reduce((s, g) => s + Math.max(1, g.count), 0)}
                    className="w-16 h-8 bg-transparent border-0 shadow-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {builderConfig.hasGpu && (
              <>
                <p className="text-xs text-muted-foreground">
                  Picking specific GPU models below filters out providers that don&apos;t have those GPUs and may reduce the number of bids you receive.
                </p>
                <div className="space-y-2">
                  {builderConfig.gpuModels.map((g) => (
                    <div key={g.id} className="flex flex-wrap items-center gap-2 rounded border border-white/10 p-3">
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs">Vendor</Label>
                        <Select
                          value={g.vendor}
                          onValueChange={(v) =>
                            setBuilderConfig({
                              ...builderConfig,
                              gpuModels: builderConfig.gpuModels.map((x) => (x.id === g.id ? { ...x, vendor: v } : x)),
                            })
                          }
                        >
                          <SelectTrigger className="w-28 h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="nvidia">nvidia</SelectItem>
                            <SelectItem value="amd">amd</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs">Model</Label>
                        <Input
                          value={g.model}
                          onChange={(e) =>
                            setBuilderConfig({
                              ...builderConfig,
                              gpuModels: builderConfig.gpuModels.map((x) => (x.id === g.id ? { ...x, model: e.target.value } : x)),
                            })
                          }
                          placeholder="e.g. a100, h100"
                          className="w-24 h-8"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs">Memory</Label>
                        <Select
                          value={g.memory || "__none__"}
                          onValueChange={(v) =>
                            setBuilderConfig({
                              ...builderConfig,
                              gpuModels: builderConfig.gpuModels.map((x) =>
                                x.id === g.id ? { ...x, memory: v === "__none__" ? "" : v } : x
                              ),
                            })
                          }
                        >
                          <SelectTrigger className="w-24 h-8">
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">—</SelectItem>
                            <SelectItem value="24GB">24GB</SelectItem>
                            <SelectItem value="40GB">40GB</SelectItem>
                            <SelectItem value="80GB">80GB</SelectItem>
                            <SelectItem value="48GB">48GB</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs">Interface</Label>
                        <Select
                          value={g.interface || "__none__"}
                          onValueChange={(v) =>
                            setBuilderConfig({
                              ...builderConfig,
                              gpuModels: builderConfig.gpuModels.map((x) =>
                                x.id === g.id ? { ...x, interface: v === "__none__" ? "" : v } : x
                              ),
                            })
                          }
                        >
                          <SelectTrigger className="w-24 h-8">
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">—</SelectItem>
                            <SelectItem value="PCIe">PCIe</SelectItem>
                            <SelectItem value="SXM4">SXM4</SelectItem>
                            <SelectItem value="SXM5">SXM5</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 mt-5"
                        onClick={() => {
                          const next = builderConfig.gpuModels.filter((x) => x.id !== g.id);
                          setBuilderConfig({
                            ...builderConfig,
                            gpuModels: next,
                            hasGpu: next.length > 0,
                          });
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="default"
                    className="bg-foreground text-background hover:bg-foreground/90"
                    onClick={() =>
                      setBuilderConfig({
                        ...builderConfig,
                        gpuModels: [
                          ...builderConfig.gpuModels,
                          { id: `gpu-${Date.now()}`, vendor: "nvidia", model: "a100", memory: "", interface: "", count: 1 },
                        ],
                      })
                    }
                  >
                    <Plus className="mr-2 h-4 w-4" /> Add GPU
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-card/40">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Memory</CardTitle>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>RAM size</TooltipContent>
              </Tooltip>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2">
              <Input
                type="number"
                min={0.5}
                step={0.5}
                value={builderConfig.memory}
                onChange={(e) => setBuilderConfig({ ...builderConfig, memory: Math.max(0.5, parseFloat(e.target.value) || 0) })}
                className="w-24 bg-background/50 border-white/10"
              />
              <Select
                value={builderConfig.memoryUnit}
                onValueChange={(v: StorageUnit) => setBuilderConfig({ ...builderConfig, memoryUnit: v })}
              >
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Mi">Mi</SelectItem>
                  <SelectItem value="Gi">Gi</SelectItem>
                  <SelectItem value="Ti">Ti</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Slider
              min={0.5}
              max={256}
              step={0.5}
              value={[builderConfig.memory]}
              onValueChange={([v]) => setBuilderConfig({ ...builderConfig, memory: v ?? 1 })}
            />
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-card/40">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Ephemeral Storage</CardTitle>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>Non-persistent disk</TooltipContent>
              </Tooltip>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                value={builderConfig.ephemeralStorage}
                onChange={(e) => setBuilderConfig({ ...builderConfig, ephemeralStorage: Math.max(1, parseInt(e.target.value) || 0) })}
                className="w-24 bg-background/50 border-white/10"
              />
              <Select
                value={builderConfig.ephemeralUnit}
                onValueChange={(v: StorageUnit) => setBuilderConfig({ ...builderConfig, ephemeralUnit: v })}
              >
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Mi">Mi</SelectItem>
                  <SelectItem value="Gi">Gi</SelectItem>
                  <SelectItem value="Ti">Ti</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Slider
              min={1}
              max={500}
              step={1}
              value={[builderConfig.ephemeralStorage]}
              onValueChange={([v]) => setBuilderConfig({ ...builderConfig, ephemeralStorage: v ?? 10 })}
            />
          </CardContent>
        </Card>

        {!hideServiceCount && (
        <Card className="border-white/10 bg-card/40">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Service Count</CardTitle>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    tabIndex={-1}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-0"
                    aria-label="Service count info"
                  >
                    <Info className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Number of service instances to deploy</TooltipContent>
              </Tooltip>
            </div>
          </CardHeader>
          <CardContent>
            <Input
              type="number"
              min={1}
              value={builderConfig.serviceCount ?? 1}
              onChange={(e) =>
                setBuilderConfig({
                  ...builderConfig,
                  serviceCount: Math.max(1, parseInt(e.target.value) || 1),
                })
              }
              className="w-24 bg-background/50 border-white/10"
            />
          </CardContent>
        </Card>
        )}

        <Card className="border-white/10 bg-card/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Token</CardTitle>
          </CardHeader>
          <CardContent>
            <Select
              value={builderConfig.token ?? "CLD"}
              onValueChange={(v) => setBuilderConfig({ ...builderConfig, token: v })}
            >
              <SelectTrigger className="w-28 bg-background/50 border-white/10">
                <SelectValue placeholder="Select token" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CLD">CLD</SelectItem>
                <SelectItem value="USDC">USDC</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {!hidePersistentRamStorage && (
        <>
        <Card className="border-white/10 bg-card/40">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Persistent Storage</CardTitle>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>Persistent volumes (Name, Type, Mount)</TooltipContent>
              </Tooltip>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {builderConfig.persistentStorages.map((p) => (
              <div key={p.id} className="rounded border border-white/10 p-3 space-y-2">
                <div className="flex gap-2 items-center">
                  <Input
                    type="number"
                    min={1}
                    value={p.size}
                    onChange={(e) =>
                      setBuilderConfig({
                        ...builderConfig,
                        persistentStorages: builderConfig.persistentStorages.map((x) =>
                          x.id === p.id ? { ...x, size: Math.max(1, parseInt(e.target.value) || 0) } : x
                        ),
                      })
                    }
                    className="w-20 h-8"
                  />
                  <Select
                    value={p.unit}
                    onValueChange={(v: StorageUnit) =>
                      setBuilderConfig({
                        ...builderConfig,
                        persistentStorages: builderConfig.persistentStorages.map((x) => (x.id === p.id ? { ...x, unit: v } : x)),
                      })
                    }
                  >
                    <SelectTrigger className="w-16 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Gi">Gi</SelectItem>
                      <SelectItem value="Ti">Ti</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 ml-auto"
                    onClick={() =>
                      setBuilderConfig({
                        ...builderConfig,
                        persistentStorages: builderConfig.persistentStorages.filter((x) => x.id !== p.id),
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <Label className="text-xs">Name</Label>
                    <Input
                      value={p.name}
                      onChange={(e) =>
                        setBuilderConfig({
                          ...builderConfig,
                          persistentStorages: builderConfig.persistentStorages.map((x) =>
                            x.id === p.id ? { ...x, name: e.target.value } : x
                          ),
                        })
                      }
                      className="h-8"
                      placeholder="data"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={p.readOnly}
                      onCheckedChange={(c) =>
                        setBuilderConfig({
                          ...builderConfig,
                          persistentStorages: builderConfig.persistentStorages.map((x) =>
                            x.id === p.id ? { ...x, readOnly: !!c } : x
                          ),
                        })
                      }
                    />
                    <Label className="text-xs">Read only</Label>
                  </div>
                  <div>
                    <Label className="text-xs">Type</Label>
                    <Select
                      value={p.type}
                      onValueChange={(v) =>
                        setBuilderConfig({
                          ...builderConfig,
                          persistentStorages: builderConfig.persistentStorages.map((x) => (x.id === p.id ? { ...x, type: v } : x)),
                        })
                      }
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NVMe">NVMe</SelectItem>
                        <SelectItem value="HDD">HDD</SelectItem>
                        <SelectItem value="SSD">SSD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Mount</Label>
                    <Input
                      value={p.mount}
                      onChange={(e) =>
                        setBuilderConfig({
                          ...builderConfig,
                          persistentStorages: builderConfig.persistentStorages.map((x) =>
                            x.id === p.id ? { ...x, mount: e.target.value } : x
                          ),
                        })
                      }
                      className="h-8"
                      placeholder="/data"
                    />
                  </div>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setBuilderConfig({
                  ...builderConfig,
                  persistentStorages: [
                    ...builderConfig.persistentStorages,
                    {
                      id: `pers-${Date.now()}`,
                      size: 10,
                      unit: "Gi" as StorageUnit,
                      name: "data",
                      readOnly: false,
                      type: "NVMe",
                      mount: "/data",
                    },
                  ],
                })
              }
            >
              <Plus className="mr-2 h-4 w-4" /> Add persistent storage
            </Button>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-card/40">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">RAM Storage</CardTitle>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>tmpfs / shm-style volumes</TooltipContent>
              </Tooltip>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {builderConfig.ramStorages.map((r) => (
              <div key={r.id} className="flex gap-2 items-center rounded border border-white/10 p-2">
                <Input
                  type="number"
                  min={1}
                  value={r.size}
                  onChange={(e) =>
                    setBuilderConfig({
                      ...builderConfig,
                      ramStorages: builderConfig.ramStorages.map((x) =>
                        x.id === r.id ? { ...x, size: Math.max(1, parseInt(e.target.value) || 0) } : x
                      ),
                    })
                  }
                  className="w-20 h-8"
                />
                <Select
                  value={r.unit}
                  onValueChange={(v: StorageUnit) =>
                    setBuilderConfig({
                      ...builderConfig,
                      ramStorages: builderConfig.ramStorages.map((x) => (x.id === r.id ? { ...x, unit: v } : x)),
                    })
                  }
                >
                  <SelectTrigger className="w-16 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Gi">Gi</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={r.name}
                  onChange={(e) =>
                    setBuilderConfig({
                      ...builderConfig,
                      ramStorages: builderConfig.ramStorages.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)),
                    })
                  }
                  placeholder="Name"
                  className="flex-1 h-8"
                />
                <Input
                  value={r.mount}
                  onChange={(e) =>
                    setBuilderConfig({
                      ...builderConfig,
                      ramStorages: builderConfig.ramStorages.map((x) => (x.id === r.id ? { ...x, mount: e.target.value } : x)),
                    })
                  }
                  placeholder="Mount"
                  className="flex-1 h-8"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() =>
                    setBuilderConfig({
                      ...builderConfig,
                      ramStorages: builderConfig.ramStorages.filter((x) => x.id !== r.id),
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setBuilderConfig({
                  ...builderConfig,
                  ramStorages: [
                    ...builderConfig.ramStorages,
                    {
                      id: `ram-${Date.now()}`,
                      size: 1,
                      unit: "Gi" as StorageUnit,
                      name: "shm",
                      type: "RAM",
                      mount: "/dev/shm",
                    },
                  ],
                })
              }
            >
              <Plus className="mr-2 h-4 w-4" /> Add RAM storage
            </Button>
          </CardContent>
        </Card>
        </>
        )}

        {!hideExposeEnvCommands && (
        <>
        <Card className="border-white/10 bg-card/40">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Expose</CardTitle>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>Ports, global, accept</TooltipContent>
                </Tooltip>
              </div>
              <Button variant="outline" size="sm" onClick={() => setEditingExpose(!editingExpose)}>
                Edit
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {editingExpose ? (
              <div className="space-y-2">
                {builderConfig.expose.map((e, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Input
                      type="number"
                      placeholder="Port"
                      value={e.port}
                      onChange={(ev) => {
                        const v = parseInt(ev.target.value) || 0;
                        setBuilderConfig({
                          ...builderConfig,
                          expose: builderConfig.expose.map((x, j) => (j === i ? { ...x, port: v, as: x.as ?? v } : x)),
                        });
                      }}
                      className="w-24 h-8"
                    />
                    <Input
                      type="number"
                      placeholder="As"
                      value={e.as ?? e.port}
                      onChange={(ev) => {
                        const v = parseInt(ev.target.value) || 0;
                        setBuilderConfig({
                          ...builderConfig,
                          expose: builderConfig.expose.map((x, j) => (j === i ? { ...x, as: v } : x)),
                        });
                      }}
                      className="w-24 h-8"
                    />
                    <Checkbox
                      checked={e.global}
                      onCheckedChange={(c) =>
                        setBuilderConfig({
                          ...builderConfig,
                          expose: builderConfig.expose.map((x, j) => (j === i ? { ...x, global: !!c } : x)),
                        })
                      }
                    />
                    <Label className="text-xs">Global</Label>
                    <Input
                      placeholder="Accept"
                      value={e.accept ?? ""}
                      onChange={(ev) =>
                        setBuilderConfig({
                          ...builderConfig,
                          expose: builderConfig.expose.map((x, j) =>
                            j === i ? { ...x, accept: ev.target.value || undefined } : x
                          ),
                        })
                      }
                      className="flex-1 h-8"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() =>
                        setBuilderConfig({
                          ...builderConfig,
                          expose: builderConfig.expose.filter((_, j) => j !== i),
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setBuilderConfig({
                      ...builderConfig,
                      expose: [...builderConfig.expose, { port: 80, as: 80, global: true }],
                    })
                  }
                >
                  <Plus className="mr-2 h-4 w-4" /> Add
                </Button>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                {builderConfig.expose.length === 0
                  ? "None"
                  : builderConfig.expose.map((e, i) => (
                      <div key={i}>
                        Port {e.port} : {e.as ?? e.port} (http) · Global: {String(e.global)}
                      </div>
                    ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-card/40">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Environment Variables</CardTitle>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>Key-value env vars</TooltipContent>
                </Tooltip>
              </div>
              <Button variant="outline" size="sm" onClick={() => setEditingEnv(!editingEnv)}>
                Edit
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {editingEnv ? (
              <div className="space-y-2">
                {builderConfig.env.map((e, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      value={e.key}
                      onChange={(ev) =>
                        setBuilderConfig({
                          ...builderConfig,
                          env: builderConfig.env.map((x, j) => (j === i ? { ...x, key: ev.target.value } : x)),
                        })
                      }
                      placeholder="Key"
                      className="flex-1 h-8"
                    />
                    <Input
                      value={e.value}
                      onChange={(ev) =>
                        setBuilderConfig({
                          ...builderConfig,
                          env: builderConfig.env.map((x, j) => (j === i ? { ...x, value: ev.target.value } : x)),
                        })
                      }
                      placeholder="Value"
                      className="flex-1 h-8"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() =>
                        setBuilderConfig({
                          ...builderConfig,
                          env: builderConfig.env.filter((_, j) => j !== i),
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setBuilderConfig({
                      ...builderConfig,
                      env: [...builderConfig.env, { key: "", value: "" }],
                    })
                  }
                >
                  <Plus className="mr-2 h-4 w-4" /> Add
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {builderConfig.env.length === 0
                  ? "None"
                  : builderConfig.env.map((e) => `${e.key}=${e.value}`).join(", ")}
              </p>
            )}
          </CardContent>
        </Card>

        {!hideCommands && (
        <Card className="border-white/10 bg-card/40">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Commands</CardTitle>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>{`Override container command (e.g. bash -c "...")`}</TooltipContent>
                </Tooltip>
              </div>
              <Button variant="outline" size="sm" onClick={() => setEditingCommands(!editingCommands)}>
                Edit
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {editingCommands ? (
              <Textarea
                value={builderConfig.commands.join("\n")}
                onChange={(e) =>
                  setBuilderConfig({
                    ...builderConfig,
                    commands: e.target.value
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="One command per line"
                className="min-h-[80px] font-mono text-sm bg-background/50 border-white/10"
              />
            ) : (
              <pre className="text-sm text-muted-foreground whitespace-pre-wrap">
                {builderConfig.commands.length === 0 ? "None" : builderConfig.commands.join("\n")}
              </pre>
            )}
          </CardContent>
        </Card>
        )}
        </>
        )}
      </div>
    </TooltipProvider>
  );
}
