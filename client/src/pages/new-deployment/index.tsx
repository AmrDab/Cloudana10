import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FileText, ArrowLeft, Loader2, LayoutGrid, Github, GitBranch, Box, Server, Package, Upload } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useAllTemplates, type Template, type TemplateCategory } from "../templates";
import DeploymentEdit, { type DeploymentEditTemplate, type BuildType } from "./deployment-edit";
import { devLoggers } from "@/lib/logger";

function buildTypeToTemplate(bt: BuildType): DeploymentEditTemplate {
  const map: Record<BuildType, { name: string; summary: string }> = {
    "build-deploy": { name: "Build and Deploy", summary: "Build & Deploy directly from a code repository (VCS)" },
    "container-vm": { name: "Launch Container-VM", summary: "Deploy and work with a plain-linux vm-like container" },
    "custom-container": { name: "Run Custom Container", summary: "Run your own docker container stored in a private or public container registry" },
  };
  const { name, summary } = map[bt];
  return { id: `build-type-${bt}`, name, summary, deploy: "", buildType: bt };
}

interface NewDeploymentProps {
  isConnected: boolean;
  onBack: () => void;
  onRegistrationSuccess?: () => void;
}

export default function NewDeployment({
  isConnected,
  onBack,
  onRegistrationSuccess,
}: NewDeploymentProps) {
  const { data: templates, isLoading: templatesLoading } = useAllTemplates();
  const [showAllTemplates, setShowAllTemplates] = useState(false);
  const [searchTerms, setSearchTerms] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const uploadSdlInputRef = useRef<HTMLInputElement>(null);
  const [selectedTemplateForEdit, setSelectedTemplateForEdit] = useState<DeploymentEditTemplate | null>(null);

  const goToEdit = useCallback((template: DeploymentEditTemplate) => {
    const url = typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search}${window.location.hash || "#deployments"}`
      : "#deployments";
    window.history.pushState({ deploymentEdit: true }, "", url);
    setSelectedTemplateForEdit(template);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setSelectedTemplateForEdit(null);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const allTemplatesFlat = templates?.flatMap(category =>
    category.templates.map(template => ({ ...template, category: category.title }))
  ) ?? [];
  const templateCategories = (templates || []).sort((a, b) => a.title.localeCompare(b.title));
  const filteredTemplates = allTemplatesFlat.filter(template => {
    const matchesCategory = !selectedCategory || template.category === selectedCategory;
    const matchesSearch = !searchTerms ||
      template.name.toLowerCase().includes(searchTerms.toLowerCase()) ||
      (template.summary && template.summary.toLowerCase().includes(searchTerms.toLowerCase()));
    return matchesCategory && matchesSearch;
  });
  const displayTemplates = showAllTemplates ? filteredTemplates : allTemplatesFlat.slice(0, 10);
  const hasMoreTemplates = allTemplatesFlat.length > 10;

  // Single process: edit → register (one step). No separate "Selected Template" card.
  if (selectedTemplateForEdit) {
    return (
      <DeploymentEdit
        template={selectedTemplateForEdit}
        onBack={() => setSelectedTemplateForEdit(null)}
        onDeploy={() => {
          setSelectedTemplateForEdit(null);
        }}
        onRegistrationSuccess={onRegistrationSuccess}
      />
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
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>

      {/* Build Your Own */}
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">Build Your Own</h3>
          </div>
          <input
            ref={uploadSdlInputRef}
            type="file"
            accept=".yaml,.yml,.sdl,application/x-yaml,text/yaml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                const r = new FileReader();
                r.onload = () => devLoggers.deploy.debug("SDL uploaded:", f.name, (r.result as string)?.slice(0, 200));
                r.readAsText(f);
              }
              e.target.value = "";
            }}
          />
          <Button
            variant="default"
            className="bg-foreground text-background hover:bg-foreground/90"
            onClick={() => uploadSdlInputRef.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" />
            Upload SDL
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card
            className="border-white/5 bg-card/40 hover:border-primary/20 transition-colors cursor-pointer"
            onClick={() => goToEdit(buildTypeToTemplate("build-deploy"))}
          >
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex gap-1.5">
                  <div className="h-9 w-9 rounded-lg bg-[#24292e] flex items-center justify-center">
                    <Github className="h-4 w-4 text-white" />
                  </div>
                  <div className="h-9 w-9 rounded-lg bg-[#fc6d26] flex items-center justify-center">
                    <GitBranch className="h-4 w-4 text-white" />
                  </div>
                  <div className="h-9 w-9 rounded-lg bg-primary/20 flex items-center justify-center">
                    <Box className="h-4 w-4 text-primary" />
                  </div>
                </div>
                <CardTitle className="text-base">Build and Deploy</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <CardDescription>
                Build & Deploy directly from a code repository (VCS)
              </CardDescription>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {["Node.js", "Vue", "Python"].map((t) => (
                  <Badge key={t} variant="secondary" className="text-xs font-normal">
                    {t}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card
            className="border-white/5 bg-card/40 hover:border-primary/20 transition-colors cursor-pointer"
            onClick={() => setSelectedTemplateForEdit(buildTypeToTemplate("container-vm"))}
          >
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex gap-1.5">
                  <div className="h-9 w-9 rounded-lg bg-primary/20 flex items-center justify-center">
                    <Package className="h-4 w-4 text-primary" />
                  </div>
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20">
                    <span className="text-[10px] font-mono font-semibold text-primary">VM</span>
                  </div>
                </div>
                <CardTitle className="text-base">Launch Container-VM</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <CardDescription>
                Deploy and work with a plain-linux vm-like container
              </CardDescription>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {["Ubuntu", "Fedora", "Debian"].map((t) => (
                  <Badge key={t} variant="secondary" className="text-xs font-normal">
                    {t}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card
            className="border-white/5 bg-card/40 hover:border-primary/20 transition-colors cursor-pointer"
            onClick={() => goToEdit(buildTypeToTemplate("custom-container"))}
          >
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Package className="h-4 w-4 text-primary" />
                </div>
                <CardTitle className="text-base">Run Custom Container</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <CardDescription>
                Run your own docker container stored in a private or public container registry
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Explorer Templates: when "View all" active, same layout as user#templates (sidebar + search + filtered grid) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold tracking-tight">Explorer Templates</h3>
          {!templatesLoading && hasMoreTemplates && (
            <Button
              variant="outline"
              onClick={() => setShowAllTemplates((v) => !v)}
              className="border-white/10"
            >
              <LayoutGrid className="mr-2 h-4 w-4" />
              {showAllTemplates ? "Show less" : "View all"}
            </Button>
          )}
        </div>
      </div>

      {templatesLoading ? (
        <div className="rounded-lg border border-white/5 bg-card/20 p-12 min-h-[320px] flex flex-col items-center justify-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <p className="text-lg font-medium">Loading templates...</p>
          <p className="text-sm text-muted-foreground">Templates are loaded from the server database.</p>
        </div>
      ) : allTemplatesFlat.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 bg-muted/20 p-12 min-h-[320px] flex flex-col items-center justify-center gap-4">
          <FileText className="h-12 w-12 text-muted-foreground" />
          <p className="text-lg font-medium">No templates yet</p>
          <p className="text-sm text-muted-foreground text-center max-w-sm">Templates are served from the server database. Run the fetch-templates script to populate.</p>
        </div>
      ) : showAllTemplates ? (
        /* Same layout as user#templates: sidebar filters + main content */
        <div className="flex gap-6">
          <div className="hidden md:block w-[222px] flex-shrink-0">
            <p className="mb-4 font-bold">Filter Templates</p>
            <div className="mb-6">
              <Input
                value={searchTerms}
                onChange={(e) => setSearchTerms(e.target.value)}
                placeholder="Search templates..."
                className="w-full"
              />
            </div>
            <div className="space-y-1">
              <Button
                variant={selectedCategory === null ? "secondary" : "ghost"}
                className="w-full justify-start h-8"
                onClick={() => setSelectedCategory(null)}
              >
                All <span className="ml-2 text-xs text-muted-foreground">({allTemplatesFlat.length})</span>
              </Button>
              {templateCategories.map((category) => {
                const count = category.templates?.length || 0;
                return (
                  <Button
                    key={category.title}
                    variant={selectedCategory === category.title ? "secondary" : "ghost"}
                    className="w-full justify-start h-8"
                    onClick={() => setSelectedCategory(category.title)}
                  >
                    {category.title} <span className="ml-2 text-xs text-muted-foreground">({count})</span>
                  </Button>
                );
              })}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            {searchTerms && (
              <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/5">
                <p className="text-muted-foreground">
                  Searching for: &quot;{searchTerms}&quot; — {filteredTemplates.length} results
                </p>
                <Button variant="ghost" size="sm" onClick={() => setSearchTerms("")}>
                  Clear
                </Button>
              </div>
            )}
            {selectedCategory && !searchTerms && (
              <p className="mb-4 font-bold">{selectedCategory}</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredTemplates.map((template) => (
                <Card
                  key={template.id}
                  className="border-white/5 bg-card/40 hover:border-primary/20 transition-colors cursor-pointer"
                  onClick={() => goToEdit(template)}
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
                              e.currentTarget.style.display = "none";
                              const fallback = e.currentTarget.parentElement?.querySelector(".fallback-icon");
                              if (fallback) fallback.classList.remove("hidden");
                            }}
                          />
                        ) : null}
                        <FileText className={`h-5 w-5 text-primary fallback-icon ${template.logoUrl ? "hidden" : ""}`} />
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
            {filteredTemplates.length === 0 && !templatesLoading && (
              <div className="flex h-[200px] flex-col items-center justify-center border border-white/10 rounded-lg mt-6">
                <FileText className="mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-muted-foreground">No templates found. Try adjusting your filters.</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {displayTemplates.map((template) => (
            <Card
              key={template.id}
              className="border-white/5 bg-card/40 hover:border-primary/20 transition-colors cursor-pointer"
              onClick={() => goToEdit(template)}
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
                          e.currentTarget.style.display = "none";
                          const fallback = e.currentTarget.parentElement?.querySelector(".fallback-icon");
                          if (fallback) fallback.classList.remove("hidden");
                        }}
                      />
                    ) : null}
                    <FileText className={`h-5 w-5 text-primary fallback-icon ${template.logoUrl ? "hidden" : ""}`} />
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
    </div>
  );
}
