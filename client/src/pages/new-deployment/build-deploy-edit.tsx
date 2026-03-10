import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowLeft, ChevronRight, ChevronDown, Info, Plus, Trash2, Github, Gitlab, Code, Loader2 } from "lucide-react";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type BuilderConfig,
  DeploymentEditBuilder,
} from "./deployment-edit-shared";

export interface BuildDeployEditProps {
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

export function BuildDeployEdit({
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
}: BuildDeployEditProps) {
  const [installCommand, setInstallCommand] = useState("npm install");
  const [buildCommand, setBuildCommand] = useState("npm run build");
  const [nodeVersion, setNodeVersion] = useState("21");
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [buildDirectory, setBuildDirectory] = useState("dist");
  const [startCommand, setStartCommand] = useState("npm start");
  const [port, setPort] = useState("3000");

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
          <Card className="border-white/5 bg-card/40">
            <CardHeader>
              <CardTitle className="text-base">Import Repository</CardTitle>
              <CardDescription>Connect a git provider to access your repositories.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Tabs defaultValue="git-provider" className="w-full">
                <TabsList className="bg-muted/50 border border-white/10">
                  <TabsTrigger value="git-provider">Git Provider</TabsTrigger>
                  <TabsTrigger value="third-party">Third-Party Git Repository</TabsTrigger>
                </TabsList>
                <TabsContent value="git-provider" className="mt-4">
                  <p className="text-sm font-medium mb-1">Connect Account</p>
                  <p className="text-sm text-muted-foreground mb-4">Connect a git provider to access your repositories.</p>
                  <div className="flex flex-wrap gap-3">
                    <Button variant="outline" className="border-white/10" size="sm">
                      <Code className="mr-2 h-4 w-4" />
                      Bitbucket
                    </Button>
                    <Button variant="outline" className="border-white/10" size="sm">
                      <Gitlab className="mr-2 h-4 w-4" />
                      GitLab
                    </Button>
                    <Button variant="outline" className="border-white/10" size="sm">
                      <Github className="mr-2 h-4 w-4" />
                      Github
                    </Button>
                  </div>
                </TabsContent>
                <TabsContent value="third-party" className="mt-4">
                  <p className="text-sm text-muted-foreground">Add a third-party Git repository URL.</p>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <Collapsible defaultOpen={false} className="rounded-lg border border-white/10 bg-card/40">
            <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors">
              <span className="font-medium">Build &amp; Install Configurations</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-4 pb-4 pt-4 border-t border-white/5 grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="border-white/10 bg-card/40 rounded-lg p-4">
                  <Label className="text-sm font-medium mb-2 block">Install Command</Label>
                  <Input
                    value={installCommand}
                    onChange={(e) => setInstallCommand(e.target.value)}
                    placeholder="npm install"
                    className="bg-background/50 border-white/10"
                  />
                </Card>
                <Card className="border-white/10 bg-card/40 rounded-lg p-4">
                  <Label className="text-sm font-medium mb-2 block">Build Directory</Label>
                  <Input
                    value={buildDirectory}
                    onChange={(e) => setBuildDirectory(e.target.value)}
                    placeholder="dist"
                    className="bg-background/50 border-white/10"
                  />
                </Card>
                <Card className="border-white/10 bg-card/40 rounded-lg p-4">
                  <Label className="text-sm font-medium mb-2 block">Build Command</Label>
                  <Input
                    value={buildCommand}
                    onChange={(e) => setBuildCommand(e.target.value)}
                    placeholder="npm run build"
                    className="bg-background/50 border-white/10"
                  />
                </Card>
                <Card className="border-white/10 bg-card/40 rounded-lg p-4">
                  <Label className="text-sm font-medium mb-2 block">Start Command</Label>
                  <Input
                    value={startCommand}
                    onChange={(e) => setStartCommand(e.target.value)}
                    placeholder="npm start"
                    className="bg-background/50 border-white/10"
                  />
                </Card>
                <Card className="border-white/10 bg-card/40 rounded-lg p-4">
                  <Label className="text-sm font-medium mb-2 block">Node Version</Label>
                  <Input
                    value={nodeVersion}
                    onChange={(e) => setNodeVersion(e.target.value)}
                    placeholder="21"
                    className="bg-background/50 border-white/10"
                  />
                </Card>
                <Card className="border-white/10 bg-card/40 rounded-lg p-4">
                  <Label className="text-sm font-medium mb-2 block">Port</Label>
                  <Input
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    placeholder="3000"
                    className="bg-background/50 border-white/10"
                  />
                </Card>
                <Card className="border-white/10 bg-card/40 rounded-lg p-4 md:col-span-2">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="auto-deploy"
                      checked={autoDeploy}
                      onCheckedChange={(c) => setAutoDeploy(!!c)}
                      className="mt-0.5"
                    />
                    <div className="space-y-1">
                      <Label htmlFor="auto-deploy" className="text-sm font-medium cursor-pointer">
                        Auto Deploy
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        If checked, Console will automatically re-deploy your app on any code commits
                      </p>
                    </div>
                  </div>
                </Card>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Collapsible defaultOpen={false} className="rounded-lg border border-white/10 bg-card/40">
            <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors">
              <span className="font-medium">Environment Variables</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-4 pb-4 pt-4 border-t border-white/5 space-y-3">
                {builderConfig.env.map((e, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Input
                      placeholder="Key"
                      value={e.key}
                      onChange={(ev) =>
                        setBuilderConfig({
                          ...builderConfig,
                          env: builderConfig.env.map((x, j) => (j === i ? { ...x, key: ev.target.value } : x)),
                        })
                      }
                      className="flex-1 bg-background/50 border-white/10"
                    />
                    <Input
                      placeholder="Value"
                      value={e.value}
                      onChange={(ev) =>
                        setBuilderConfig({
                          ...builderConfig,
                          env: builderConfig.env.map((x, j) => (j === i ? { ...x, value: ev.target.value } : x)),
                        })
                      }
                      className="flex-1 bg-background/50 border-white/10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
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
                  <Plus className="mr-2 h-4 w-4" /> Add variable
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Collapsible defaultOpen={false} className="rounded-lg border border-white/10 bg-card/40">
            <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors">
              <div className="flex items-center gap-4 text-sm">
                <span className="font-medium">Build Server Specs</span>
                <span className="text-muted-foreground">{specsSummary}</span>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-4 pb-4 pt-0 border-t border-white/5 mt-0 pt-4 space-y-4">
                <DeploymentEditBuilder
                  builderConfig={builderConfig}
                  setBuilderConfig={setBuilderConfig}
                  editingExpose={editingExpose}
                  setEditingExpose={setEditingExpose}
                  editingEnv={editingEnv}
                  setEditingEnv={setEditingEnv}
                  editingCommands={editingCommands}
                  setEditingCommands={setEditingCommands}
                  hideDockerImage={true}
                  hideExposeEnvCommands={true}
                  hidePersistentRamStorage={true}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
      </div>
    </div>
  );
}
