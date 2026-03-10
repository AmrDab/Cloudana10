import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowLeft, ChevronRight, ChevronDown, Info, Loader2 } from "lucide-react";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { generateSshEd25519KeyPair } from "@/lib/sshKey";
import JSZip from "jszip";
import {
  type BuilderConfig,
  DeploymentEditBuilder,
} from "./deployment-edit-shared";

export interface LaunchContainerVmProps {
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
  sdlError: string | null;
  onBack: () => void;
  onCreateDeploy: () => void;
  isCreatingWorkload?: boolean;
  templateName?: string;
}

export function LaunchContainerVm({
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
  onCreateDeploy,
  isCreatingWorkload = false,
  templateName,
}: LaunchContainerVmProps) {
  const [serviceName, setServiceName] = useState("service-1");
  const [sshPublicKey, setSshPublicKey] = useState("");
  const [sshGenerating, setSshGenerating] = useState(false);
  const [sshError, setSshError] = useState<string | null>(null);

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
          disabled={isCreatingWorkload}
          className="bg-foreground text-background hover:bg-foreground/90 shrink-0"
        >
          {isCreatingWorkload ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Registering...
            </>
          ) : (
            <>Register workload <ChevronRight className="ml-2 h-4 w-4" /></>
          )}
        </Button>
      </div>

      {sdlError && (
        <p className="text-sm text-destructive font-medium" role="alert">
          {sdlError}
        </p>
      )}

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
                    <div className="flex items-center gap-2">
                      <Label className="text-sm font-medium">SSH Public Key</Label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              tabIndex={-1}
                              className="rounded p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-0"
                              aria-label="SSH key info"
                            >
                              <Info className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            Optional. Add your SSH public key for container access.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <div className="space-y-2">
                      <Input
                        value={sshPublicKey}
                        onChange={(e) => setSshPublicKey(e.target.value)}
                        placeholder="Enter your own pub key: ssh-... or click Generate new key"
                        className="bg-background/50 border-white/10 font-mono text-sm"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-white/10 shrink-0"
                        disabled={sshGenerating}
                        onClick={async () => {
                          setSshGenerating(true);
                          setSshError(null);
                          try {
                            const { publicKey, privateKeyPem } = await generateSshEd25519KeyPair();
                            setSshPublicKey(publicKey);
                            const zip = new JSZip();
                            zip.file("id_ed25519.pub", publicKey);
                            zip.file("id_ed25519", privateKeyPem);
                            const blob = await zip.generateAsync({ type: "blob" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = "ssh-keys.zip";
                            a.click();
                            URL.revokeObjectURL(url);
                          } catch (e) {
                            const msg = e instanceof Error ? e.message : "Failed to generate key";
                            setSshError(msg);
                          } finally {
                            setSshGenerating(false);
                          }
                        }}
                      >
                        {sshGenerating ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Generating…
                          </>
                        ) : (
                          "Generate new key"
                        )}
                      </Button>
                      {sshError && (
                        <p className="text-sm text-destructive" role="alert">
                          {sshError}
                        </p>
                      )}
                    </div>
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
                  useDockerImagePreset={true}
                  hideCommands={true}
                  hideServiceCount={true}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
      </div>
    </div>
  );
}
