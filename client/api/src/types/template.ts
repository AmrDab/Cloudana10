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
} & Partial<TemplateRun>;

/** What Cloudana needs to run a template (V3): curated entries set all of it, imported ones what can be derived. */
export type TemplateRun = {
  kind: "static" | "container" | "workstation";
  category: string;
  /** True for Cloudana's curated list (shown first). */
  curated: boolean;
  image: string | null;
  command: string[];
  ports: number[];
  cpu: number; // millicores
  memMb: number;
  storageMb: number;
  /** Env keys the user must supply (send them sealed). */
  secretEnv: string[];
  /** Plain env defaults. */
  env: Record<string, string>;
  /** Static starters: the default site. */
  files: { path: string; contentBase64: string }[];
  // Workstation templates (docs/WORKSTATIONS.md §6) — copied into the spec at create.
  /** Default GPU request (count 0 = CPU workstation). */
  gpu?: { count: number; minVramGb?: number; class?: "any" | "consumer" | "datacenter" };
  /** How the user reaches it: web port (+ path) and/or whether the image runs sshd. */
  access?: { web?: { port: number; path?: string }; ssh: boolean };
  workdir?: string;
  sshPort?: number;
  tokenEnv?: string;
  tokenQuery?: string;
};

export type TemplateCategory = {
  title: string;
  description?: string;
  templates: Template[];
};
