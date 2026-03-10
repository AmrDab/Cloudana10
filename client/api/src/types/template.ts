export type TemplateConfig = {
  ssh?: boolean;
  logoUrl?: string;
};

export type Template = {
  id: string;
  name: string;
  path: string;
  readme: string;
  summary: string;
  logoUrl: string | null;
  deploy: string;
  guide?: string;
  githubUrl: string;
  persistentStorageEnabled: boolean;
  config: TemplateConfig;
};

export type TemplateCategory = {
  title: string;
  description?: string;
  templates: Template[];
};
