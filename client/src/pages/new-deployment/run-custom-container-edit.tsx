import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowLeft, ChevronRight, ChevronDown, Info, Upload } from "lucide-react";
import { useState, useRef } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  type BuilderConfig,
  DeploymentEditBuilder,
} from "./deployment-edit-shared";

export interface RunCustomContainerEditProps {
  editableTitle: string;
  setEditableTitle: (v: string) => void;
  builderConfig: BuilderConfig;
  setBuilderConfig: React.Dispatch<React.SetStateAction<BuilderConfig>>;
  editingExpose: boolean;
  setEditingExpose: (v: boolean) => void;
  editingEnv: boolean;
  setEditingEnv: (v: boolean) => void;
  editingCommands: boolean;
  setEditingCommands: (v: boolean) => void;
  editMode: "builder" | "yaml";
  setEditMode: (v: "builder" | "yaml") => void;
  editableDeployConfig: string;
  setEditableDeployConfig: (v: string) => void;
  sdlError: string | null;
  onBack: () => void;
  onCreateDeploy: () => void;
  templateName?: string;
}

export function RunCustomContainerEdit({
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
  editMode,
  setEditMode,
  editableDeployConfig,
  setEditableDeployConfig,
  sdlError,
  onBack,
  onCreateDeploy,
  templateName,
}: RunCustomContainerEditProps) {
  const uploadSdlInputRef = useRef<HTMLInputElement>(null);
  const [serviceName, setServiceName] = useState("service-1");

  const specsSummary = `${builderConfig.cpu} CPU · ${builderConfig.memory} ${builderConfig.memoryUnit} RAM · ${builderConfig.ephemeralStorage} ${builderConfig.ephemeralUnit} Disk`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px] space-y-2">
          <Label htmlFor="create-deploy-name" className="text-sm font-medium">
            Name your deployment (optional)
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="create-deploy-name"
              value={editableTitle}
              onChange={(e) => setEditableTitle(e.target.value)}
              placeholder={templateName || "e.g. My Deployment"}
              className="bg-background/50 border-white/10"
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    tabIndex={-1}
                    className="rounded-full w-8 h-8 flex items-center justify-center border border-white/10 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-0"
                    aria-label="Deployment name info"
                  >
                    <Info className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  Choose a name to identify this deployment.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        <Button
          onClick={onCreateDeploy}
          className="bg-foreground text-background hover:bg-foreground/90 shrink-0"
        >
          Create Deployment <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      {sdlError && (
        <p className="text-sm text-destructive font-medium" role="alert">
          {sdlError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={editMode === "builder" ? "default" : "outline"}
          size="sm"
          onClick={() => setEditMode("builder")}
          className={editMode === "builder" ? "bg-foreground text-background hover:bg-foreground/90" : "border-white/10"}
        >
          Builder
        </Button>
        <Button
          type="button"
          variant={editMode === "yaml" ? "default" : "outline"}
          size="sm"
          onClick={() => setEditMode("yaml")}
          className={editMode === "yaml" ? "bg-foreground text-background hover:bg-foreground/90" : "border-white/10"}
        >
          YAML
        </Button>
        <input
          ref={uploadSdlInputRef}
          type="file"
          accept=".yaml,.yml,.json,.sdl,application/x-yaml,text/yaml,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              const r = new FileReader();
              r.onload = () => {
                const raw = (r.result as string) || "";
                setEditableDeployConfig(raw);
                setEditMode("yaml");
              };
              r.readAsText(f);
            }
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-white/10"
          onClick={() => uploadSdlInputRef.current?.click()}
        >
          <Upload className="mr-2 h-4 w-4" />
          Upload your SDL
        </Button>
      </div>

      {editMode === "yaml" ? (
        <Textarea
          value={editableDeployConfig}
          onChange={(e) => setEditableDeployConfig(e.target.value)}
          placeholder="Paste or upload YAML/JSON deploy configuration..."
          className="min-h-[300px] font-mono text-sm bg-background/50 border-white/10"
        />
      ) : (
        <div className="space-y-4">
          <Collapsible defaultOpen={true} className="rounded-lg border border-white/10 bg-card/40">
            <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors">
              <div className="flex items-center gap-4 text-sm">
                <span className="font-medium">Build Server Specs</span>
                <span className="text-muted-foreground">{specsSummary}</span>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-4 pb-4 pt-0 border-t border-white/5 mt-0 pt-4 space-y-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Service Name</Label>
                    <Input
                      value={serviceName}
                      onChange={(e) => setServiceName(e.target.value)}
                      placeholder="service-1"
                      className="bg-background/50 border-white/10 max-w-xs"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Service Count</Label>
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
                  </div>
                </div>
                <DeploymentEditBuilder
                  builderConfig={builderConfig}
                  setBuilderConfig={setBuilderConfig}
                  editingExpose={editingExpose}
                  setEditingExpose={setEditingExpose}
                  editingEnv={editingEnv}
                  setEditingEnv={setEditingEnv}
                  editingCommands={editingCommands}
                  setEditingCommands={setEditingCommands}
                  hideDockerImage={false}
                  hideExposeEnvCommands={false}
                  hidePersistentRamStorage={true}
                  useDockerImagePreset={false}
                  hideCommands={false}
                  hideServiceCount={true}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}
    </div>
  );
}
