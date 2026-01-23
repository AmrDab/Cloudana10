import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, ArrowLeft, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { getAllTemplates, type Template, type TemplateCategory } from "./templates";

interface NewDeploymentProps {
  providers: any[];
  providersLoading: boolean;
  selectedProvider: string;
  setSelectedProvider: (v: string) => void;
  budget: string;
  setBudget: (v: string) => void;
  isConnected: boolean;
  handleCreateJob: () => void;
  isCreating: boolean;
  isApproving: boolean;
  needsApproval: boolean;
  onBack: () => void;
}

export default function NewDeployment({
  providers,
  providersLoading,
  selectedProvider,
  setSelectedProvider,
  budget,
  setBudget,
  isConnected,
  handleCreateJob,
  isCreating,
  isApproving,
  needsApproval,
  onBack,
}: NewDeploymentProps) {
  const [templates, setTemplates] = useState<Awaited<ReturnType<typeof getAllTemplates>>>(undefined);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplateForDeployment, setSelectedTemplateForDeployment] = useState<any>(null);
  const [selectedTemplateForEdit, setSelectedTemplateForEdit] = useState<any>(null);
  const [editableTitle, setEditableTitle] = useState<string>("");
  const [editableDeployConfig, setEditableDeployConfig] = useState<string>("");
  const [editMode, setEditMode] = useState<"builder" | "yaml">("yaml");
  
  // Builder state
  const [builderConfig, setBuilderConfig] = useState({
    cpu: 1,
    gpu: 0,
    hasGpu: false,
    memory: 1,
    memoryUnit: "Gi" as "Mi" | "Gi" | "Ti",
    storage: 10,
    storageUnit: "Gi" as "Mi" | "Gi" | "Ti",
  });

  // Fetch templates when component mounts
  useEffect(() => {
    if (!templates) {
      const fetchTemplates = async () => {
        try {
          setTemplatesLoading(true);
          const fetchedTemplates = await getAllTemplates();
          setTemplates(fetchedTemplates);
        } catch (error) {
          console.error("Failed to fetch templates:", error);
        } finally {
          setTemplatesLoading(false);
        }
      };
      fetchTemplates();
    }
  }, [templates]);

  const allTemplatesFlat = templates?.flatMap(category => 
    category.templates.map(template => ({ ...template, category: category.title }))
  ) || [];
  const displayTemplates = allTemplatesFlat.slice(0, 10);

  // Initialize editable fields when template is selected
  useEffect(() => {
    if (selectedTemplateForEdit) {
      setEditableTitle(selectedTemplateForEdit.name || "");
      setEditableDeployConfig(selectedTemplateForEdit.deploy || "");
      // Try to parse existing deploy config to populate builder
      if (selectedTemplateForEdit.deploy) {
        try {
          const parsed = JSON.parse(selectedTemplateForEdit.deploy);
          if (parsed.profiles?.compute) {
            const compute = Object.values(parsed.profiles.compute)[0] as any;
            if (compute?.resources) {
              const resources = compute.resources;
              setBuilderConfig({
                cpu: resources.cpu?.units || 1,
                gpu: resources.gpu?.units || 0,
                hasGpu: !!resources.gpu,
                memory: parseFloat(resources.memory?.size?.replace(/[^0-9.]/g, "") || "1"),
                memoryUnit: resources.memory?.size?.includes("Gi") ? "Gi" : resources.memory?.size?.includes("Ti") ? "Ti" : "Mi",
                storage: parseFloat(resources.storage?.[0]?.size?.replace(/[^0-9.]/g, "") || "10"),
                storageUnit: resources.storage?.[0]?.size?.includes("Gi") ? "Gi" : resources.storage?.[0]?.size?.includes("Ti") ? "Ti" : "Mi",
              });
            }
          }
        } catch (e) {
          // If parsing fails, use defaults
        }
      }
    }
  }, [selectedTemplateForEdit]);

  // Generate YAML from builder config
  const generateYamlFromBuilder = () => {
    const resources: any = {
      cpu: {
        units: builderConfig.cpu
      },
      memory: {
        size: `${builderConfig.memory}${builderConfig.memoryUnit}`
      },
      storage: [
        {
          size: `${builderConfig.storage}${builderConfig.storageUnit}`
        }
      ]
    };

    if (builderConfig.hasGpu && builderConfig.gpu > 0) {
      resources.gpu = {
        units: builderConfig.gpu,
        attributes: {
          vendor: {
            nvidia: {
              model: "A100"
            }
          }
        }
      };
    }

    const sdl = {
      version: "2.0",
      services: {
        web: {
          image: "nginx:latest",
          expose: [
            {
              port: 80,
              as: 80,
              to: [
                {
                  global: true
                }
              ]
            }
          ]
        }
      },
      profiles: {
        compute: {
          web: {
            resources
          }
        },
        placement: {
          akash: {
            pricing: {
              web: {
                denom: "uakt",
                amount: 1000
              }
            }
          }
        }
      }
    };

    return JSON.stringify(sdl, null, 2);
  };

  // Parse YAML and update builder config
  const parseYamlToBuilder = (yamlString: string) => {
    try {
      const parsed = JSON.parse(yamlString);
      if (parsed.profiles?.compute) {
        const compute = Object.values(parsed.profiles.compute)[0] as any;
        if (compute?.resources) {
          const resources = compute.resources;
          const newBuilderConfig = {
            cpu: resources.cpu?.units || 1,
            gpu: resources.gpu?.units || 0,
            hasGpu: !!resources.gpu,
            memory: parseFloat(resources.memory?.size?.replace(/[^0-9.]/g, "") || "1"),
            memoryUnit: (resources.memory?.size?.includes("Gi") ? "Gi" : resources.memory?.size?.includes("Ti") ? "Ti" : "Mi") as "Mi" | "Gi" | "Ti",
            storage: parseFloat(resources.storage?.[0]?.size?.replace(/[^0-9.]/g, "") || "10"),
            storageUnit: (resources.storage?.[0]?.size?.includes("Gi") ? "Gi" : resources.storage?.[0]?.size?.includes("Ti") ? "Ti" : "Mi") as "Mi" | "Gi" | "Ti",
          };
          setBuilderConfig(newBuilderConfig);
        }
      }
    } catch (e) {
      // If parsing fails, don't update builder config
      console.warn("Failed to parse YAML to builder config:", e);
    }
  };

  // Update YAML when builder config changes (only in builder mode)
  useEffect(() => {
    if (editMode === "builder" && selectedTemplateForEdit) {
      const generatedYaml = generateYamlFromBuilder();
      setEditableDeployConfig(generatedYaml);
    }
  }, [builderConfig, editMode, selectedTemplateForEdit]);

  // Parse YAML and update builder when switching to builder mode
  useEffect(() => {
    if (editMode === "builder" && editableDeployConfig && selectedTemplateForEdit) {
      // Only parse if we're switching to builder mode and have YAML content
      parseYamlToBuilder(editableDeployConfig);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, selectedTemplateForEdit]); // Sync when mode changes or template changes

  // Show template edit page if a template is selected for editing
  if (selectedTemplateForEdit) {
    return (
      <div className="space-y-6 w-full">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <FileText className="h-6 w-6 text-primary" />
              Template Details
            </h2>
            <p className="text-muted-foreground">Edit template configuration</p>
          </div>
          <Button 
            variant="ghost"
            onClick={() => {
              setSelectedTemplateForEdit(null);
              setEditableTitle("");
              setEditableDeployConfig("");
            }}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Templates
          </Button>
        </div>

        <Card className="border-white/5 bg-card/40">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
                  {selectedTemplateForEdit.logoUrl ? (
                    <img 
                      src={selectedTemplateForEdit.logoUrl} 
                      alt={editableTitle || selectedTemplateForEdit.name}
                      className="h-full w-full object-contain p-1"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const fallback = e.currentTarget.parentElement?.querySelector('.fallback-icon');
                        if (fallback) fallback.classList.remove('hidden');
                      }}
                    />
                  ) : null}
                  <FileText className={`h-8 w-8 text-primary fallback-icon ${selectedTemplateForEdit.logoUrl ? 'hidden' : ''}`} />
                </div>
                <div className="flex-1">
                  <Label htmlFor="template-title" className="text-sm font-medium mb-2 block">Template Title</Label>
                  <Input
                    id="template-title"
                    value={editableTitle}
                    onChange={(e) => setEditableTitle(e.target.value)}
                    className="text-2xl font-bold bg-background/50 border-white/10"
                    placeholder="Enter template title"
                  />
                  <CardDescription className="text-base mt-2">
                    Category: {selectedTemplateForEdit.category}
                  </CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {selectedTemplateForEdit.summary && (
              <div>
                <h3 className="text-lg font-semibold mb-2">Summary</h3>
                <p className="text-muted-foreground whitespace-pre-line">
                  {selectedTemplateForEdit.summary}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-white/10">
              <div>
                <p className="text-sm font-medium mb-1">Template Path</p>
                <p className="text-sm text-muted-foreground font-mono break-all">
                  {selectedTemplateForEdit.path}
                </p>
              </div>
              {selectedTemplateForEdit.githubUrl && (
                <div>
                  <p className="text-sm font-medium mb-1">GitHub Repository</p>
                  <a
                    href={selectedTemplateForEdit.githubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-primary underline underline-offset-2 hover:text-primary/80 break-all"
                  >
                    {selectedTemplateForEdit.githubUrl}
                  </a>
                </div>
              )}
              {selectedTemplateForEdit.logoUrl && (
                <div>
                  <p className="text-sm font-medium mb-1">Logo</p>
                  <img 
                    src={selectedTemplateForEdit.logoUrl} 
                    alt={editableTitle || selectedTemplateForEdit.name}
                    className="h-16 w-16 object-contain"
                  />
                </div>
              )}
              {selectedTemplateForEdit.persistentStorageEnabled !== undefined && (
                <div>
                  <p className="text-sm font-medium mb-1">Persistent Storage</p>
                  <Badge variant={selectedTemplateForEdit.persistentStorageEnabled ? "default" : "secondary"}>
                    {selectedTemplateForEdit.persistentStorageEnabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-white/10">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-lg font-semibold">Deploy Configuration</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={editMode === "builder" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setEditMode("builder")}
                    >
                      Builder
                    </Button>
                    <Button
                      type="button"
                      variant={editMode === "yaml" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setEditMode("yaml")}
                    >
                      YAML
                    </Button>
                  </div>
                </div>

                {editMode === "yaml" ? (
                  <Textarea
                    id="deploy-config"
                    value={editableDeployConfig}
                    onChange={(e) => {
                      setEditableDeployConfig(e.target.value);
                      // Optionally parse and update builder in background (but don't force sync)
                    }}
                    className="min-h-[300px] font-mono text-xs bg-background/50 border-white/10"
                    placeholder="Enter deploy configuration..."
                  />
                ) : (
                  <div className="space-y-6 p-4 border border-white/10 rounded-md bg-background/30">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="builder-cpu">CPU (units)</Label>
                        <Input
                          id="builder-cpu"
                          type="number"
                          min="0.1"
                          step="0.1"
                          value={builderConfig.cpu}
                          onChange={(e) => setBuilderConfig({ ...builderConfig, cpu: parseFloat(e.target.value) || 0 })}
                          className="bg-background/50 border-white/10"
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="builder-has-gpu"
                            checked={builderConfig.hasGpu}
                            onChange={(e) => setBuilderConfig({ ...builderConfig, hasGpu: e.target.checked, gpu: e.target.checked ? builderConfig.gpu || 1 : 0 })}
                            className="rounded"
                          />
                          <Label htmlFor="builder-has-gpu" className="cursor-pointer">Enable GPU</Label>
                        </div>
                        {builderConfig.hasGpu && (
                          <Input
                            id="builder-gpu"
                            type="number"
                            min="0"
                            step="1"
                            value={builderConfig.gpu}
                            onChange={(e) => setBuilderConfig({ ...builderConfig, gpu: parseInt(e.target.value) || 0 })}
                            className="bg-background/50 border-white/10"
                            placeholder="GPU units"
                          />
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="builder-memory">Memory</Label>
                        <div className="flex gap-2">
                          <Input
                            id="builder-memory"
                            type="number"
                            min="0.1"
                            step="0.1"
                            value={builderConfig.memory}
                            onChange={(e) => setBuilderConfig({ ...builderConfig, memory: parseFloat(e.target.value) || 0 })}
                            className="bg-background/50 border-white/10"
                          />
                          <Select
                            value={builderConfig.memoryUnit}
                            onValueChange={(value: "Mi" | "Gi" | "Ti") => setBuilderConfig({ ...builderConfig, memoryUnit: value })}
                          >
                            <SelectTrigger className="w-20 bg-background/50 border-white/10">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Mi">Mi</SelectItem>
                              <SelectItem value="Gi">Gi</SelectItem>
                              <SelectItem value="Ti">Ti</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="builder-storage">Storage</Label>
                        <div className="flex gap-2">
                          <Input
                            id="builder-storage"
                            type="number"
                            min="0.1"
                            step="0.1"
                            value={builderConfig.storage}
                            onChange={(e) => setBuilderConfig({ ...builderConfig, storage: parseFloat(e.target.value) || 0 })}
                            className="bg-background/50 border-white/10"
                          />
                          <Select
                            value={builderConfig.storageUnit}
                            onValueChange={(value: "Mi" | "Gi" | "Ti") => setBuilderConfig({ ...builderConfig, storageUnit: value })}
                          >
                            <SelectTrigger className="w-20 bg-background/50 border-white/10">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Mi">Mi</SelectItem>
                              <SelectItem value="Gi">Gi</SelectItem>
                              <SelectItem value="Ti">Ti</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-white/10">
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-sm font-medium">Generated Configuration (Preview)</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            parseYamlToBuilder(editableDeployConfig);
                          }}
                          className="text-xs"
                        >
                          Sync from YAML
                        </Button>
                      </div>
                      <div className="rounded-md border border-white/10 bg-background/60 p-4 max-h-64 overflow-y-auto">
                        <pre className="text-xs text-muted-foreground whitespace-pre-wrap">
                          {editableDeployConfig}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button 
              variant="outline"
              onClick={() => {
                setSelectedTemplateForEdit(null);
                setEditableTitle("");
                setEditableDeployConfig("");
              }}
            >
              Cancel
            </Button>
            <Button 
              onClick={() => {
                // Update template with edited values
                const updatedTemplate = {
                  ...selectedTemplateForEdit,
                  name: editableTitle || selectedTemplateForEdit.name,
                  deploy: editableDeployConfig || selectedTemplateForEdit.deploy,
                };
                setSelectedTemplateForDeployment(updatedTemplate);
                setSelectedTemplateForEdit(null);
                setEditableTitle("");
                setEditableDeployConfig("");
              }}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              Deploy This Template
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            Create New Deployment
          </h2>
          <p className="text-muted-foreground">Select a template to get started</p>
        </div>
        <Button 
          variant="ghost"
          onClick={onBack}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>

      {templatesLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="border-white/5 bg-card/40">
              <CardHeader>
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="h-4 w-3/4 mt-2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {displayTemplates.map((template) => (
            <Card 
              key={template.id} 
              className={`border-white/5 bg-card/40 hover:border-primary/20 transition-colors cursor-pointer ${
                selectedTemplateForDeployment?.id === template.id ? 'border-primary/50 bg-primary/5' : ''
              }`}
              onClick={() => setSelectedTemplateForEdit(template)}
            >
              <CardHeader>
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
                    {template.logoUrl ? (
                      <img 
                        src={template.logoUrl} 
                        alt={template.name}
                        className="h-full w-full object-contain p-1"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const fallback = e.currentTarget.parentElement?.querySelector('.fallback-icon');
                          if (fallback) fallback.classList.remove('hidden');
                        }}
                      />
                    ) : null}
                    <FileText className={`h-5 w-5 text-primary fallback-icon ${template.logoUrl ? 'hidden' : ''}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="truncate">{template.name}</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <CardDescription className="line-clamp-2 mb-4">
                  {template.summary || "No description available"}
                </CardDescription>
                <div className="text-xs text-muted-foreground">
                  Category: {template.category}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedTemplateForDeployment && (
        <Card className="border-primary/20 bg-card/60">
          <CardHeader>
            <CardTitle>Selected Template: {selectedTemplateForDeployment.name}</CardTitle>
            <CardDescription>{selectedTemplateForDeployment.summary}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="deployment-provider">Select Provider</Label>
                <Select value={selectedProvider} onValueChange={setSelectedProvider} disabled={!isConnected}>
                  <SelectTrigger id="deployment-provider" className="bg-background/50 border-white/10" disabled={!isConnected}>
                    <SelectValue placeholder={isConnected ? "Choose a provider..." : "Connect wallet to select provider"} />
                  </SelectTrigger>
                  <SelectContent>
                    {providers
                      .filter(p => p.status === 1)
                      .map(p => (
                        <SelectItem key={p.pubKeyHash} value={p.pubKeyHash}>
                          {p.name || `Provider ${p.pubKeyHash.slice(0, 8)}...`}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="deployment-budget">Budget (CLD)</Label>
                <div className="relative">
                  <Input 
                    id="deployment-budget" 
                    placeholder={isConnected ? "e.g. 100" : "Connect wallet to enter budget"} 
                    type="number" 
                    className="bg-background/50 border-white/10 pr-12"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    disabled={!isConnected}
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-muted-foreground font-mono">CLD</span>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button 
              variant="outline"
              onClick={() => setSelectedTemplateForDeployment(null)}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleCreateJob} 
              disabled={!isConnected || isCreating || isApproving || providersLoading || !selectedProvider || !budget} 
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {isApproving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Approving...
                </>
              ) : isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...
                </>
              ) : needsApproval && budget ? (
                "Approve & Create"
              ) : (
                "Create Deployment"
              )}
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
