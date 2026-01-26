import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { FileText, ArrowLeft } from "lucide-react";
import {
  type DeploymentEditTemplate,
  type BuilderConfig,
  DeploymentEditBuilder,
} from "./deployment-edit-shared";

export interface TemplateEditProps {
  template: DeploymentEditTemplate;
  editableTitle: string;
  setEditableTitle: (v: string) => void;
  editableDeployConfig: string;
  setEditableDeployConfig: (v: string) => void;
  editMode: "builder" | "yaml";
  setEditMode: (v: "builder" | "yaml") => void;
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
}

export function TemplateEdit({
  template,
  editableTitle,
  setEditableTitle,
  editableDeployConfig,
  setEditableDeployConfig,
  editMode,
  setEditMode,
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
}: TemplateEditProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            Template Details
          </h2>
          <p className="text-muted-foreground">Edit template configuration</p>
        </div>
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Templates
        </Button>
      </div>

      <Card className="border-white/5 bg-card/40">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
                {template.logoUrl ? (
                  <img
                    src={template.logoUrl}
                    alt={editableTitle || template.name || ""}
                    className="h-full w-full object-contain p-1"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                      const fallback = e.currentTarget.parentElement?.querySelector(".fallback-icon");
                      if (fallback) fallback.classList.remove("hidden");
                    }}
                  />
                ) : null}
                <FileText className={`h-8 w-8 text-primary fallback-icon ${template.logoUrl ? "hidden" : ""}`} />
              </div>
              <div className="flex-1">
                <Label htmlFor="template-title" className="text-sm font-medium mb-2 block">
                  Template Title
                </Label>
                <Input
                  id="template-title"
                  value={editableTitle}
                  onChange={(e) => setEditableTitle(e.target.value)}
                  className="text-2xl font-bold bg-background/50 border-white/10"
                  placeholder="Enter template title"
                />
                <CardDescription className="text-base mt-2">Category: {template.category}</CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {template.summary && (
            <div>
              <h3 className="text-lg font-semibold mb-2">Summary</h3>
              <p className="text-muted-foreground whitespace-pre-line">{template.summary}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-white/10">
            <div>
              <p className="text-sm font-medium mb-1">Template Path</p>
              <p className="text-sm text-muted-foreground font-mono break-all">{template.path}</p>
            </div>
            {template.githubUrl && (
              <div>
                <p className="text-sm font-medium mb-1">GitHub Repository</p>
                <a
                  href={template.githubUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-primary underline underline-offset-2 hover:text-primary/80 break-all"
                >
                  {template.githubUrl}
                </a>
              </div>
            )}
            {template.logoUrl && (
              <div>
                <p className="text-sm font-medium mb-1">Logo</p>
                <img src={template.logoUrl} alt={editableTitle || template.name || ""} className="h-16 w-16 object-contain" />
              </div>
            )}
            {template.persistentStorageEnabled !== undefined && (
              <div>
                <p className="text-sm font-medium mb-1">Persistent Storage</p>
                <Badge variant={template.persistentStorageEnabled ? "default" : "secondary"}>
                  {template.persistentStorageEnabled ? "Enabled" : "Disabled"}
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
                  onChange={(e) => setEditableDeployConfig(e.target.value)}
                  className="min-h-[300px] font-mono text-xs bg-background/50 border-white/10"
                  placeholder="Enter deploy configuration..."
                />
              ) : (
                <DeploymentEditBuilder
                  builderConfig={builderConfig}
                  setBuilderConfig={setBuilderConfig}
                  editingExpose={editingExpose}
                  setEditingExpose={setEditingExpose}
                  editingEnv={editingEnv}
                  setEditingEnv={setEditingEnv}
                  editingCommands={editingCommands}
                  setEditingCommands={setEditingCommands}
                />
              )}
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3 pt-4">
          {sdlError && (
            <p className="text-sm text-destructive font-medium" role="alert">
              {sdlError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onBack}>
              Cancel
            </Button>
            <Button onClick={onCreateDeploy} className="bg-primary hover:bg-primary/90 text-primary-foreground">
              Create Deployment
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
