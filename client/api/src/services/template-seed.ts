/**
 * Static seed templates — returned as fallback when MongoDB has no templates.
 * Each template has a minimal Docker compose-style deploy YAML for Cloudana.
 */
import type { TemplateCategory } from "../types/template.js";

function makeId(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function tmpl(
  name: string,
  summary: string,
  image: string,
  cpu: string,
  mem: string,
  storage: string,
  ports: string[],
  category: string,
  logoUrl?: string
) {
  const id = makeId(name);
  const portLines = ports.map((p) => `          - port: ${p}\n            as: ${p}\n            to:\n              - global: true`).join("\n");
  const deploy = `---
version: "2.0"
services:
  ${id}:
    image: ${image}
    expose:
${portLines}
profiles:
  compute:
    ${id}:
      resources:
        cpu:
          units: ${cpu}
        memory:
          size: ${mem}
        storage:
          size: ${storage}
  placement:
    default:
      pricing:
        ${id}:
          denom: ucld
          amount: 1000
deployment:
  ${id}:
    default:
      profile: ${id}
      count: 1`;

  return {
    id,
    name,
    path: id,
    readme: `# ${name}\n\n${summary}`,
    summary,
    logoUrl: logoUrl || null,
    deploy,
    githubUrl: `https://github.com/cloudana-io/templates/tree/main/${id}`,
    persistentStorageEnabled: false,
    config: {},
  };
}

export const SEED_TEMPLATES: TemplateCategory[] = [
  {
    title: "Web & CMS",
    description: "Web servers, CMS platforms, and static sites",
    templates: [
      tmpl("Nginx", "Lightweight HTTP server and reverse proxy", "nginx:alpine", "0.5", "512Mi", "1Gi", ["80"], "web"),
      tmpl("WordPress", "Popular open-source content management system", "wordpress:latest", "1", "1Gi", "5Gi", ["80"], "web"),
      tmpl("Ghost Blog", "Modern publishing platform for professional bloggers", "ghost:5-alpine", "0.5", "512Mi", "2Gi", ["2368"], "web"),
    ],
  },
  {
    title: "Databases",
    description: "Relational and NoSQL databases",
    templates: [
      tmpl("PostgreSQL", "Advanced open-source relational database", "postgres:16-alpine", "1", "1Gi", "10Gi", ["5432"], "db"),
      tmpl("MongoDB", "Document-oriented NoSQL database", "mongo:7", "1", "1Gi", "10Gi", ["27017"], "db"),
      tmpl("Redis", "In-memory data structure store for caching", "redis:7-alpine", "0.5", "256Mi", "1Gi", ["6379"], "db"),
    ],
  },
  {
    title: "Gaming",
    description: "Game servers and multiplayer backends",
    templates: [
      tmpl("Minecraft Java", "Minecraft Java Edition server with configurable world", "itzg/minecraft-server:latest", "2", "2Gi", "5Gi", ["25565"], "gaming"),
      tmpl("Minecraft Bedrock", "Minecraft Bedrock Edition server for cross-platform play", "itzg/minecraft-bedrock-server:latest", "2", "2Gi", "5Gi", ["19132"], "gaming"),
    ],
  },
  {
    title: "DevOps & Tools",
    description: "Developer tools and infrastructure services",
    templates: [
      tmpl("Grafana", "Observability and data visualization dashboards", "grafana/grafana:latest", "0.5", "512Mi", "2Gi", ["3000"], "devops"),
      tmpl("Uptime Kuma", "Self-hosted monitoring tool like Uptime Robot", "louislam/uptime-kuma:1", "0.5", "512Mi", "1Gi", ["3001"], "devops"),
      tmpl("Code Server", "VS Code in the browser — full IDE anywhere", "codercom/code-server:latest", "1", "1Gi", "5Gi", ["8080"], "devops"),
    ],
  },
  {
    title: "AI & Machine Learning",
    description: "AI inference, model serving, and ML tools",
    templates: [
      tmpl("Ollama", "Run LLMs locally — supports Llama, Mistral, and more", "ollama/ollama:latest", "4", "8Gi", "20Gi", ["11434"], "ai"),
      tmpl("Open WebUI", "ChatGPT-style interface for local LLMs via Ollama", "ghcr.io/open-webui/open-webui:main", "1", "1Gi", "2Gi", ["8080"], "ai"),
    ],
  },
];
