import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, ChevronRight, Loader2 } from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { useAccount } from "wagmi";
import { useToast } from "@/hooks/use-toast";
import { uploadWorkloadManifestToIPFS } from "@/lib/api";
import { sendDeployment, type Deployment } from "@/lib/deployment";
import { parseDeployToJson, validateSDL } from "@/lib/sdl";
import {
  useRegisterWorkload,
  type ResourceRequirements,
} from "@/lib/contracts";
import { devLoggers } from "@/lib/logger";
import {
  type BuildType,
  type DeploymentEditTemplate,
  type DeploySummary,
  type ExposeItem,
  type StorageUnit,
  defaultBuilderConfig,
  deployToBuilderConfig,
  extractDeploySummary,
} from "./deployment-edit-shared";
import { TemplateEdit } from "./template-edit";
import { BuildDeployEdit } from "./build-deploy-edit";
import { LaunchContainerVm } from "./launch-container-vm";
import { RunCustomContainerEdit } from "./run-custom-container-edit";

export type { BuildType, DeploymentEditTemplate };

interface DeploymentEditProps {
  template: DeploymentEditTemplate;
  onBack: () => void;
  onDeploy: (updated: DeploymentEditTemplate & { name?: string; deploy?: string }) => void;
  /** Called after workload is registered so parent can refetch list and show deployments table */
  onRegistrationSuccess?: () => void;
}

// Helper function to convert storage size to bytes
function storageToBytes(size: number | undefined | null, unit: StorageUnit | undefined | null): bigint {
  const multipliers: Record<StorageUnit, number> = {
    Mi: 1024 * 1024,
    Gi: 1024 * 1024 * 1024,
    Ti: 1024 * 1024 * 1024 * 1024,
  };
  
  // Ensure size is a valid number
  const numSize = size != null && !isNaN(Number(size)) ? Number(size) : 0;
  if (numSize < 0 || !isFinite(numSize)) {
    devLoggers.deploy.warn("Invalid size value:", size, "using default 0");
    return BigInt(0);
  }
  
  // Ensure unit is valid
  const safeUnit = (unit && unit in multipliers) ? unit : "Gi";
  const multiplier = multipliers[safeUnit];
  
  // Calculate result and ensure it's a valid number
  const result = numSize * multiplier;
  if (!isFinite(result) || isNaN(result)) {
    devLoggers.deploy.warn("Invalid calculation result:", result, "using default 0");
    return BigInt(0);
  }
  
  return BigInt(Math.floor(result));
}

// Helper function to convert deployment config to ResourceRequirements
function convertToResourceRequirements(
  deployJson: string,
  builderConfig: ReturnType<typeof deployToBuilderConfig> & { cpu?: number; memory?: number; memoryUnit?: StorageUnit; ephemeralStorage?: number; ephemeralUnit?: StorageUnit; persistentStorages?: Array<{ size: number; unit: StorageUnit; type?: string }>; hasGpu?: boolean; gpuModels?: Array<{ vendor?: string; model?: string; memory?: string; interface?: string; count?: number }> }
): ResourceRequirements {
  // Convert CPU (units to millicores - assuming 1 unit = 1000 millicores)
  const cpuValue = builderConfig.cpu ?? 1;
  const cpuNum = typeof cpuValue === "number" && !isNaN(cpuValue) && isFinite(cpuValue) ? cpuValue : 1;
  const cpuMillicores = cpuNum * 1000;
  
  // Convert memory to bytes - ensure we have valid values
  const memoryValue = builderConfig.memory ?? 1;
  const memoryUnitValue = builderConfig.memoryUnit || "Gi";
  const memoryBytes = storageToBytes(memoryValue, memoryUnitValue);
  
  // Calculate total storage (ephemeral + persistent)
  const ephemeralStorageValue = builderConfig.ephemeralStorage ?? 10;
  const ephemeralUnitValue = builderConfig.ephemeralUnit || "Gi";
  const ephemeralBytes = storageToBytes(ephemeralStorageValue, ephemeralUnitValue);
  
  const persistentBytes = (builderConfig.persistentStorages || []).reduce(
    (sum, p) => {
      const pSize = p.size ?? 0;
      const pUnit = p.unit || "Gi";
      return sum + storageToBytes(pSize, pUnit);
    },
    BigInt(0)
  );
  const totalStorageBytes = ephemeralBytes + persistentBytes;
  
  // Extract storage classes from persistent storages
  const storageClasses = (builderConfig.persistentStorages || [])
    .map((p) => p.type || "NVMe")
    .filter((value, index, self) => self.indexOf(value) === index); // unique
  
  // GPU info
  const requiresGPU = builderConfig.hasGpu || false;
  const gpuCountValue = builderConfig.gpuModels?.reduce((sum, g) => {
    const count = typeof g.count === "number" && !isNaN(g.count) ? g.count : 1;
    return sum + Math.max(1, count);
  }, 0) || 0;
  const gpuCount = typeof gpuCountValue === "number" && !isNaN(gpuCountValue) && isFinite(gpuCountValue) ? gpuCountValue : 0;
  
  const gpuAttributes = (builderConfig.gpuModels || []).map((g) => {
    const attrs: string[] = [];
    if (g.vendor) attrs.push(`vendor:${g.vendor}`);
    if (g.model) attrs.push(`model:${g.model}`);
    if (g.memory) attrs.push(`memory:${g.memory}`);
    if (g.interface) attrs.push(`interface:${g.interface}`);
    return attrs.join(",");
  });
  
  // Ensure all BigInt conversions have valid numbers
  return {
    cpu: BigInt(Math.max(0, cpuMillicores)),
    memory: memoryBytes,
    storage: totalStorageBytes,
    storageClasses: storageClasses.length > 0 ? storageClasses : ["NVMe"],
    requiresGPU,
    gpuCount: BigInt(Math.max(0, gpuCount)),
    gpuAttributes: gpuAttributes.length > 0 ? gpuAttributes : [],
    requiresEdge: false, // Default to false, can be enhanced later
    regions: [], // Default empty, can be enhanced later
    maxLatency: BigInt(100), // Default 100ms, can be enhanced later
  };
}

/** Export for dashboard: derive ResourceRequirements from deploy JSON (one contract interaction). */
export function getResourceRequirementsFromDeployJson(deployJson: string): ResourceRequirements {
  const parsed = JSON.parse(deployJson) as Record<string, unknown>;
  const config = deployToBuilderConfig(parsed) as Parameters<typeof convertToResourceRequirements>[1];
  return convertToResourceRequirements(deployJson, config);
}

export default function DeploymentEdit({ template, onBack, onDeploy, onRegistrationSuccess }: DeploymentEditProps) {
  const [, setLocation] = useLocation();
  const { address, isConnected } = useAccount();
  const { toast } = useToast();
  const { register, hash, isPending: isCreatingWorkload, isSuccess, error, reset } = useRegisterWorkload();
  const [editableTitle, setEditableTitle] = useState(template.name || "");
  const [editableDeployConfig, setEditableDeployConfig] = useState(template.deploy || "");
  const [editMode, setEditMode] = useState<"builder" | "yaml">("yaml");
  const [editingExpose, setEditingExpose] = useState(false);
  const [editingEnv, setEditingEnv] = useState(false);
  const [editingCommands, setEditingCommands] = useState(false);
  const [builderConfig, setBuilderConfig] = useState(() => ({ ...defaultBuilderConfig }));
  const [sdlError, setSdlError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDeploy, setPendingDeploy] = useState<{
    payload: DeploymentEditTemplate & { name?: string; deploy?: string };
    summary: DeploySummary;
  } | null>(null);

  useEffect(() => {
    setEditableTitle(template.name || "");
    setEditableDeployConfig(template.deploy || "");
    if (template.deploy) {
      try {
        const parsed = JSON.parse(template.deploy) as Record<string, unknown>;
        setBuilderConfig((prev) => ({ ...prev, ...deployToBuilderConfig(parsed) }));
      } catch {
        /* keep defaults */
      }
    } else if (template.buildType) {
      const bt = template.buildType;
      const isContainerVm = bt === "container-vm";
      const isCustomContainer = bt === "custom-container";
      setBuilderConfig((prev) => ({
        ...prev,
        ...(isContainerVm
          ? {
              image: "ubuntu:24.04",
              cpu: 1,
              memory: 512,
              memoryUnit: "Mi" as StorageUnit,
              ephemeralStorage: 1,
              ephemeralUnit: "Gi" as StorageUnit,
            }
          : isCustomContainer
            ? {
                image: "",
                cpu: 0.1,
                memory: 512,
                memoryUnit: "Mi" as StorageUnit,
                ephemeralStorage: 1,
                ephemeralUnit: "Gi" as StorageUnit,
                expose: [{ port: 80, as: 80, global: true }] as ExposeItem[],
              }
            : {
                cpu: 2,
                memory: 6,
                memoryUnit: "Gi" as StorageUnit,
                ephemeralStorage: 10,
                ephemeralUnit: "Gi" as StorageUnit,
              }),
      }));
      setEditMode("builder");
    }
  }, [template]);

  useEffect(() => {
    setSdlError(null);
  }, [editableDeployConfig]);

  const generateYamlFromBuilder = useCallback(() => {
    const storage: {
      size: string;
      name?: string;
      mount?: string;
      attributes?: { persistent?: boolean; class?: string };
    }[] = [{ size: `${builderConfig.ephemeralStorage}${builderConfig.ephemeralUnit}` }];
    builderConfig.persistentStorages.forEach((p) => {
      storage.push({
        size: `${p.size}${p.unit}`,
        name: p.name,
        mount: p.mount,
        attributes: { persistent: true, class: p.type },
      });
    });
    builderConfig.ramStorages.forEach((r) => {
      storage.push({
        size: `${r.size}${r.unit}`,
        name: r.name,
        mount: r.mount,
        attributes: { class: "ram" },
      });
    });

    const resources: Record<string, unknown> = {
      cpu: { units: builderConfig.cpu },
      memory: { size: `${builderConfig.memory}${builderConfig.memoryUnit}` },
      storage,
    };
    if (builderConfig.hasGpu && builderConfig.gpuModels.length > 0) {
      const totalUnits = builderConfig.gpuModels.reduce((s, g) => s + Math.max(1, g.count || 1), 0);
      const first = builderConfig.gpuModels[0];
      const v = first.vendor;
      const m = first.model;
      const att: Record<string, unknown> = { model: m };
      if (first.memory) att.memory = first.memory;
      if (first.interface) att.interface = first.interface;
      resources.gpu = {
        units: totalUnits,
        attributes: { vendor: { [v]: Object.keys(att).length > 1 ? att : { model: m } } },
      };
    }

    const svc: Record<string, unknown> = {
      image: builderConfig.image,
      expose: (builderConfig.expose.length ? builderConfig.expose : [{ port: 80, as: 80, global: true }]).map((e) => ({
        port: e.port,
        as: e.as ?? e.port,
        to: [{ global: e.global, ...(e.accept ? { accept: e.accept } : {}) }],
      })),
    };
    if (builderConfig.env.length) svc.env = builderConfig.env.map((e) => ({ key: e.key, value: e.value }));
    if (builderConfig.commands.length) svc.command = builderConfig.commands;

    return JSON.stringify(
      {
        version: "2.0",
        services: { web: svc },
        profiles: {
          compute: { web: { resources } },
          placement: { akash: { pricing: { web: { denom: "uakt", amount: 1000 } } } },
        },
      },
      null,
      2
    );
  }, [builderConfig]);

  const parseYamlToBuilder = useCallback((yamlString: string) => {
    try {
      const parsed = JSON.parse(yamlString) as Record<string, unknown>;
      setBuilderConfig((prev) => ({ ...prev, ...deployToBuilderConfig(parsed) }));
    } catch (e) {
      devLoggers.deploy.warn("Failed to parse YAML to builder config:", e);
    }
  }, []);

  useEffect(() => {
    if (editMode === "builder") {
      setEditableDeployConfig(generateYamlFromBuilder());
    }
  }, [builderConfig, editMode, generateYamlFromBuilder]);

  useEffect(() => {
    if (editMode === "builder" && editableDeployConfig) {
      parseYamlToBuilder(editableDeployConfig);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode]);

  // Handle successful workload creation: toast, notify parent (refetch + show table), then redirect
  useEffect(() => {
    if (isSuccess && hash && pendingDeploy) {
      toast({
        title: "Deployment created",
        description: "Your workload is registered. The orchestrator will assign a provider when one is available.",
      });
      const deployment: Deployment = {
        ...pendingDeploy.payload,
        id: "new deployment",
      };
      sendDeployment(deployment);
      onDeploy(pendingDeploy.payload);
      setConfirmOpen(false);
      setPendingDeploy(null);
      reset();
      onRegistrationSuccess?.();
      setLocation("/user#deployments");
    }
  }, [isSuccess, hash, pendingDeploy, toast, reset, onDeploy, onRegistrationSuccess, setLocation]);

  // Handle errors
  useEffect(() => {
    if (error) {
      toast({
        title: "Transaction failed",
        description: error.message || "Failed to register workload on-chain",
        variant: "destructive",
      });
      reset();
    }
  }, [error, toast, reset]);

  // Step 1: Validate and open confirm modal (no contract yet)
  const handleCreateDeploy = useCallback(() => {
    console.log('[Deployment Edit] ═══════════════════════════════════════');
    console.log('[Deployment Edit] STARTING DEPLOYMENT CREATION');
    console.log('[Deployment Edit] ═══════════════════════════════════════');
    
    const deploy = editableDeployConfig || template.deploy || "";
    console.log('[Deployment Edit] Deploy config length:', deploy.length);
    console.log('[Deployment Edit] Deploy config preview:', deploy.slice(0, 200));
    
    let parsed: Record<string, unknown>;
    try {
      console.log('[Deployment Edit] ─── Step 1: Parse YAML/JSON ───');
      parsed = parseDeployToJson(deploy);
      console.log('[Deployment Edit] ✓ Parsed successfully');
      console.log('[Deployment Edit] Structure keys:', Object.keys(parsed));
      devLoggers.deploy.debug("Deploy configuration info:", parsed);
    } catch (e) {
      console.error('[Deployment Edit] ✗ Parse failed:', e);
      setSdlError(e instanceof Error ? e.message : "Failed to parse deploy config.");
      return;
    }
    
    console.log('[Deployment Edit] ─── Step 2: Validate SDL ───');
    if (!validateSDL(parsed)) {
      console.error('[Deployment Edit] ✗ Validation failed');
      setSdlError("Invalid deploy configuration. Check browser console for details.");
      return;
    }
    console.log('[Deployment Edit] ✓ Validation passed');
    
    setSdlError(null);
    const deployJson = JSON.stringify(parsed, null, 2);
    
    console.log('[Deployment Edit] ─── Step 3: Extract Summary ───');
    const summary = extractDeploySummary(deployJson);
    if (!summary) {
      console.error('[Deployment Edit] ✗ Failed to extract deployment summary');
      setSdlError("Could not read deployment summary. Check browser console for details. The SDL structure may be missing required fields (image, cpu, memory, etc).");
      return;
    }
    console.log('[Deployment Edit] ✓ Summary extracted:', summary);
    if (!isConnected || !address) {
      toast({
        title: "Wallet not connected",
        description: "Please connect your wallet to continue",
        variant: "destructive",
      });
      return;
    }
    const payload = {
      ...template,
      name: editableTitle || template.name,
      deploy: deployJson,
    };
    setPendingDeploy({ payload, summary });
    setConfirmOpen(true);
  }, [editableDeployConfig, editableTitle, template, isConnected, address, toast]);

  // Step 2: Confirm in modal → interact with contract (one middle step)
  const handleConfirmAndRegister = useCallback(async () => {
    if (!pendingDeploy || isCreatingWorkload || !isConnected || !address) return;
    try {
      const deployConfig = pendingDeploy.payload.deploy || "";
      if (!deployConfig) throw new Error("Deployment config is empty");
      const parsed = JSON.parse(deployConfig) as Record<string, unknown>;
      const config = deployToBuilderConfig(parsed);
      if (!config || typeof config !== "object") throw new Error("Invalid deployment configuration");
      const requirements = getResourceRequirementsFromDeployJson(deployConfig);
      const requirementsSerializable = {
        cpu: String(requirements.cpu),
        memory: String(requirements.memory),
        storage: String(requirements.storage),
        storageClasses: requirements.storageClasses,
        requiresGPU: requirements.requiresGPU,
        gpuCount: String(requirements.gpuCount),
        gpuAttributes: requirements.gpuAttributes,
        requiresEdge: requirements.requiresEdge,
        regions: requirements.regions,
        maxLatency: String(requirements.maxLatency),
      };
      const payload = {
        name: pendingDeploy.payload.name ?? template.name,
        manifest: deployConfig,
        requirements: requirementsSerializable,
        updatedAt: new Date().toISOString(),
      };
      const metadataUri = await uploadWorkloadManifestToIPFS(payload);
      devLoggers.deploy.log("Registering workload with metadataUri:", metadataUri.slice(0, 30) + "...");
      register(metadataUri);
    } catch (err) {
      devLoggers.deploy.error("Error creating workload:", err);
      setPendingDeploy(null);
      setConfirmOpen(false);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to register workload",
        variant: "destructive",
      });
    }
  }, [pendingDeploy, isCreatingWorkload, isConnected, address, register, toast]);

  const isCreateDeploymentLayout = Boolean(template.buildType);
  const buildType = template.buildType;

  const sharedProps = {
    editableTitle,
    setEditableTitle,
    builderConfig,
    setBuilderConfig,
    editingExpose,
    setEditingExpose,
    editingEnv,
    setEditingEnv,
    editingCommands,
    setEditingCommands,
    sdlError,
    onBack,
    onCreateDeploy: handleCreateDeploy,
    isCreatingWorkload,
  };

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-center gap-1 w-full">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 rounded-lg px-1 py-0.5 -ml-1 hover:bg-white/5 transition-colors text-left"
        >
          <div className="h-8 w-8 rounded-full bg-foreground flex items-center justify-center">
            <Check className="h-4 w-4 text-background" />
          </div>
          <span className="text-sm font-semibold">Choose Template</span>
        </button>
        <ChevronRight className="h-5 w-5 text-muted-foreground/60 mx-1" />
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full border-2 border-foreground flex items-center justify-center bg-background">
            <span className="text-sm font-bold">2</span>
          </div>
          <span className="text-sm font-semibold">Register workload</span>
        </div>
      </div>

      {!isCreateDeploymentLayout && (
        <TemplateEdit
          template={template}
          {...sharedProps}
          editableDeployConfig={editableDeployConfig}
          setEditableDeployConfig={setEditableDeployConfig}
          editMode={editMode}
          setEditMode={setEditMode}
        />
      )}

      {buildType === "build-deploy" && (
        <BuildDeployEdit {...sharedProps} templateName={template.name} />
      )}

      {buildType === "container-vm" && (
        <LaunchContainerVm {...sharedProps} templateName={template.name} />
      )}

      {buildType === "custom-container" && (
        <RunCustomContainerEdit
          {...sharedProps}
          templateName={template.name}
          editMode={editMode}
          setEditMode={setEditMode}
          editableDeployConfig={editableDeployConfig}
          setEditableDeployConfig={setEditableDeployConfig}
        />
      )}

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setPendingDeploy(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm and register</DialogTitle>
            <DialogDescription>
              Review your deployment. One contract interaction will register this workload; the orchestrator will match a provider.
            </DialogDescription>
          </DialogHeader>
          {pendingDeploy && (
            <dl className="grid grid-cols-1 gap-3 text-sm">
              <div>
                <dt className="font-medium text-muted-foreground">Docker image</dt>
                <dd className="mt-0.5 font-mono">{pendingDeploy.summary.dockerImage}</dd>
              </div>
              <div>
                <dt className="font-medium text-muted-foreground">CPU</dt>
                <dd className="mt-0.5">{pendingDeploy.summary.cpu}</dd>
              </div>
              <div>
                <dt className="font-medium text-muted-foreground">RAM</dt>
                <dd className="mt-0.5">{pendingDeploy.summary.ram}</dd>
              </div>
              <div>
                <dt className="font-medium text-muted-foreground">GPU</dt>
                <dd className="mt-0.5">{pendingDeploy.summary.gpu}</dd>
              </div>
              <div>
                <dt className="font-medium text-muted-foreground">Disk</dt>
                <dd className="mt-0.5">{pendingDeploy.summary.disk}</dd>
              </div>
              <div>
                <dt className="font-medium text-muted-foreground">Expose</dt>
                <dd className="mt-0.5">{pendingDeploy.summary.expose}</dd>
              </div>
              <div>
                <dt className="font-medium text-muted-foreground">Environment</dt>
                <dd className="mt-0.5">{pendingDeploy.summary.env}</dd>
              </div>
              <div>
                <dt className="font-medium text-muted-foreground">Commands</dt>
                <dd className="mt-0.5 break-all">{pendingDeploy.summary.commands}</dd>
              </div>
            </dl>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setConfirmOpen(false);
                setPendingDeploy(null);
              }}
            >
              Cancel
            </Button>
            <Button
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              disabled={isCreatingWorkload || !isConnected}
              onClick={() => handleConfirmAndRegister()}
            >
              {isCreatingWorkload ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Registering...
                </>
              ) : (
                "Confirm and register"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
