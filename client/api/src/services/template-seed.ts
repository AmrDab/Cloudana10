/**
 * Cloudana's curated templates (V3 §4): static starters first, then containers.
 * Served when the store is empty, merged ahead of awesome-akash on POST /v1/admin/templates/refresh,
 * and resolvable by id via GET /v1/templates/{id} either way.
 * Resources: cpu in millicores, memory/storage in MB. logoUrl uses Simple Icons where a slug exists.
 */
import type { Template, TemplateCategory } from "../types/template.js";
import { STATIC_STARTERS } from "./template-starters.js";
import { WORKSTATION_TEMPLATES, WORKSTATIONS_TITLE } from "./template-workstations.js";

const icon = (slug: string | null) => (slug ? `https://cdn.simpleicons.org/${slug}` : null);

interface C {
  name: string;
  summary: string;
  image: string;
  ports: number[];
  cpu: number;
  memMb: number;
  storageMb: number;
  logo: string | null;
  command?: string[];
  secretEnv?: string[];
  env?: Record<string, string>;
  id?: string;
}

function makeId(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** A minimal SDL, kept for clients that still read `deploy`. */
function sdl(id: string, c: C): string {
  const expose = c.ports.map((p) => `      - port: ${p}\n        as: ${p}\n        to:\n          - global: true`).join("\n");
  return `---
version: "2.0"
services:
  ${id}:
    image: ${c.image}
    expose:
${expose}
profiles:
  compute:
    ${id}:
      resources:
        cpu:
          units: ${c.cpu / 1000}
        memory:
          size: ${c.memMb}Mi
        storage:
          size: ${c.storageMb}Mi
deployment:
  ${id}:
    default:
      profile: ${id}
      count: 1`;
}

function container(category: string, c: C): Template {
  const id = c.id ?? makeId(c.name);
  return {
    id,
    name: c.name,
    path: id,
    readme: `# ${c.name}\n\n${c.summary}\n\nImage: \`${c.image}\` · ports ${c.ports.join(", ")}` +
      (c.secretEnv?.length ? `\n\nRequired secrets: ${c.secretEnv.map((k) => `\`${k}\``).join(", ")} (sealed to the node).` : ""),
    summary: c.summary,
    logoUrl: icon(c.logo),
    deploy: sdl(id, c),
    githubUrl: "",
    persistentStorageEnabled: false,
    config: {},
    kind: "container",
    category,
    curated: true,
    image: c.image,
    command: c.command ?? [],
    ports: c.ports,
    cpu: c.cpu,
    memMb: c.memMb,
    storageMb: c.storageMb,
    secretEnv: c.secretEnv ?? [],
    env: c.env ?? {},
    files: [],
  };
}

const STATIC_TITLE = "Static sites";
const staticTemplates: Template[] = STATIC_STARTERS.map((s) => ({
  id: s.id,
  name: s.name,
  path: s.id,
  readme: `# ${s.name}\n\n${s.summary}\n\nServed as static files by a hosting node. Edit index.html (or upload a folder) and deploy.`,
  summary: s.summary,
  logoUrl: null,
  deploy: "",
  githubUrl: "",
  persistentStorageEnabled: false,
  config: {},
  kind: "static",
  category: STATIC_TITLE,
  curated: true,
  image: null,
  command: [],
  ports: [],
  cpu: 0,
  memMb: 0,
  storageMb: 0,
  secretEnv: [],
  env: {},
  files: s.files,
}));

const hello = (lang: string) => `Hello from ${lang} on Cloudana`;

const GROUPS: { title: string; description: string; items: C[] }[] = [
  {
    title: "Web servers",
    description: "Serve sites and proxy traffic",
    items: [
      { name: "Nginx", summary: "Lightweight HTTP server and reverse proxy.", image: "nginx:alpine", ports: [80], cpu: 250, memMb: 256, storageMb: 512, logo: "nginx" },
      { name: "Caddy", summary: "Web server with automatic HTTPS and a one-line config.", image: "caddy:2-alpine", ports: [80], cpu: 250, memMb: 256, storageMb: 512, logo: "caddy" },
      { name: "Apache httpd", summary: "The classic Apache HTTP server.", image: "httpd:2.4-alpine", ports: [80], cpu: 250, memMb: 256, storageMb: 512, logo: "apache" },
      { name: "Whoami", summary: "Tiny echo server — check that a container deploy works end to end.", image: "traefik/whoami:latest", ports: [80], cpu: 100, memMb: 64, storageMb: 64, logo: "traefikproxy" },
    ],
  },
  {
    title: "Runtimes",
    description: "Start from a language runtime",
    items: [
      { name: "Node.js", summary: "Node 22 with a hello-world HTTP server; replace the command with your app.", image: "node:22-alpine", ports: [3000], cpu: 500, memMb: 512, storageMb: 1024, logo: "nodedotjs", command: ["node", "-e", `require("http").createServer((q,s)=>s.end("${hello("Node.js")}")).listen(3000)`] },
      { name: "Python", summary: "Python 3.12 serving the working directory over HTTP.", image: "python:3.12-slim", ports: [8000], cpu: 500, memMb: 512, storageMb: 1024, logo: "python", command: ["python", "-m", "http.server", "8000"] },
      { name: "Bun", summary: "Bun runtime with a hello-world server.", image: "oven/bun:1-alpine", ports: [3000], cpu: 500, memMb: 512, storageMb: 1024, logo: "bun", command: ["bun", "-e", `Bun.serve({port:3000,fetch(){return new Response("${hello("Bun")}")}})`] },
      { name: "Deno", summary: "Deno runtime with a hello-world server.", image: "denoland/deno:alpine", ports: [8000], cpu: 500, memMb: 512, storageMb: 1024, logo: "deno", command: ["deno", "eval", `Deno.serve({port:8000},()=>new Response("${hello("Deno")}"))`] },
      { name: "Go", summary: "Go toolchain image for building and running a Go service.", image: "golang:1.23-alpine", ports: [8080], cpu: 1000, memMb: 1024, storageMb: 2048, logo: "go" },
    ],
  },
  {
    title: "Databases",
    description: "Relational, document, key-value, object and vector stores",
    items: [
      { name: "PostgreSQL", summary: "Advanced open-source relational database.", image: "postgres:16-alpine", ports: [5432], cpu: 1000, memMb: 1024, storageMb: 10240, logo: "postgresql", secretEnv: ["POSTGRES_PASSWORD"] },
      { name: "MySQL", summary: "The world's most popular open-source relational database.", image: "mysql:8.4", ports: [3306], cpu: 1000, memMb: 1024, storageMb: 10240, logo: "mysql", secretEnv: ["MYSQL_ROOT_PASSWORD"] },
      { name: "MariaDB", summary: "Community-developed fork of MySQL.", image: "mariadb:11", ports: [3306], cpu: 1000, memMb: 1024, storageMb: 10240, logo: "mariadb", secretEnv: ["MARIADB_ROOT_PASSWORD"] },
      { name: "Redis", summary: "In-memory data store for caching, queues and pub/sub.", image: "redis:7-alpine", ports: [6379], cpu: 500, memMb: 256, storageMb: 1024, logo: "redis" },
      { name: "Valkey", summary: "Open-source, Redis-compatible key-value store.", image: "valkey/valkey:8-alpine", ports: [6379], cpu: 500, memMb: 256, storageMb: 1024, logo: null },
      { name: "MongoDB", summary: "Document-oriented NoSQL database.", image: "mongo:7", ports: [27017], cpu: 1000, memMb: 1024, storageMb: 10240, logo: "mongodb", secretEnv: ["MONGO_INITDB_ROOT_PASSWORD"], env: { MONGO_INITDB_ROOT_USERNAME: "admin" } },
      { name: "MinIO", summary: "S3-compatible object storage with a web console on port 9001.", image: "minio/minio:latest", ports: [9000, 9001], cpu: 500, memMb: 512, storageMb: 20480, logo: "minio", command: ["server", "/data", "--console-address", ":9001"], secretEnv: ["MINIO_ROOT_PASSWORD"], env: { MINIO_ROOT_USER: "admin" } },
      { name: "ClickHouse", summary: "Column-oriented database for real-time analytics.", image: "clickhouse/clickhouse-server:24-alpine", ports: [8123], cpu: 2000, memMb: 4096, storageMb: 20480, logo: "clickhouse" },
      { name: "Qdrant", summary: "Vector database for semantic search and RAG.", image: "qdrant/qdrant:latest", ports: [6333], cpu: 1000, memMb: 1024, storageMb: 10240, logo: null },
      { name: "Meilisearch", summary: "Fast, typo-tolerant search engine.", image: "getmeili/meilisearch:v1.11", ports: [7700], cpu: 500, memMb: 512, storageMb: 5120, logo: "meilisearch", secretEnv: ["MEILI_MASTER_KEY"] },
    ],
  },
  {
    title: "AI & ML",
    description: "Model serving, chat interfaces and notebooks",
    items: [
      { name: "Ollama", summary: "Run open LLMs (Llama, Mistral, Qwen…) behind a simple API.", image: "ollama/ollama:latest", ports: [11434], cpu: 4000, memMb: 8192, storageMb: 20480, logo: "ollama" },
      { name: "Open WebUI", summary: "Chat interface for local LLMs via Ollama or an OpenAI-compatible API.", image: "ghcr.io/open-webui/open-webui:main", ports: [8080], cpu: 1000, memMb: 2048, storageMb: 4096, logo: null },
      { name: "vLLM", summary: "High-throughput OpenAI-compatible LLM server (GPU node recommended).", image: "vllm/vllm-openai:latest", ports: [8000], cpu: 4000, memMb: 16384, storageMb: 30720, logo: null, command: ["--model", "Qwen/Qwen2.5-0.5B-Instruct"] },
      { name: "Stable Diffusion WebUI", summary: "AUTOMATIC1111 web UI for image generation (GPU node recommended).", image: "universonic/stable-diffusion-webui:latest", ports: [8080], cpu: 4000, memMb: 16384, storageMb: 30720, logo: null },
      { name: "Jupyter", summary: "JupyterLab with the scientific Python stack.", image: "quay.io/jupyter/scipy-notebook:latest", ports: [8888], cpu: 1000, memMb: 2048, storageMb: 5120, logo: "jupyter" },
      { name: "LocalAI", summary: "OpenAI-compatible API for local models on CPU.", image: "localai/localai:latest-cpu", ports: [8080], cpu: 4000, memMb: 8192, storageMb: 20480, logo: null },
    ],
  },
  {
    title: "Apps & tools",
    description: "Self-hosted apps for teams and developers",
    items: [
      { name: "Grafana", summary: "Dashboards and observability.", image: "grafana/grafana:latest", ports: [3000], cpu: 500, memMb: 512, storageMb: 2048, logo: "grafana" },
      { name: "Prometheus", summary: "Metrics collection and alerting.", image: "prom/prometheus:latest", ports: [9090], cpu: 500, memMb: 1024, storageMb: 10240, logo: "prometheus" },
      { name: "Uptime Kuma", summary: "Self-hosted uptime monitoring with status pages.", image: "louislam/uptime-kuma:1", ports: [3001], cpu: 500, memMb: 512, storageMb: 1024, logo: "uptimekuma" },
      { name: "Gitea", summary: "Lightweight self-hosted Git service.", image: "gitea/gitea:latest", ports: [3000], cpu: 500, memMb: 512, storageMb: 10240, logo: "gitea" },
      { name: "n8n", summary: "Workflow automation with 400+ integrations.", image: "n8nio/n8n:latest", ports: [5678], cpu: 1000, memMb: 1024, storageMb: 2048, logo: "n8n" },
      { name: "Ghost", summary: "Publishing platform for blogs and newsletters.", image: "ghost:5-alpine", ports: [2368], cpu: 500, memMb: 1024, storageMb: 2048, logo: "ghost" },
      { name: "WordPress", summary: "The most popular content management system.", image: "wordpress:latest", ports: [80], cpu: 1000, memMb: 1024, storageMb: 5120, logo: "wordpress" },
      { name: "Plausible", summary: "Privacy-friendly web analytics (needs Postgres + ClickHouse).", image: "ghcr.io/plausible/community-edition:v2", ports: [8000], cpu: 1000, memMb: 1024, storageMb: 2048, logo: "plausibleanalytics", secretEnv: ["SECRET_KEY_BASE"] },
      { name: "Umami", summary: "Simple, privacy-focused web analytics (needs Postgres).", image: "ghcr.io/umami-software/umami:postgresql-latest", ports: [3000], cpu: 500, memMb: 512, storageMb: 1024, logo: null, secretEnv: ["DATABASE_URL", "APP_SECRET"] },
      { name: "Vaultwarden", summary: "Bitwarden-compatible password manager server.", image: "vaultwarden/server:latest", ports: [80], cpu: 250, memMb: 256, storageMb: 1024, logo: "vaultwarden" },
      { name: "Nextcloud", summary: "Files, calendar and collaboration suite.", image: "nextcloud:latest", ports: [80], cpu: 1000, memMb: 2048, storageMb: 20480, logo: "nextcloud" },
      { name: "Mastodon", summary: "Decentralized social network server (needs Postgres + Redis).", image: "ghcr.io/mastodon/mastodon:latest", ports: [3000], cpu: 2000, memMb: 4096, storageMb: 20480, logo: "mastodon", secretEnv: ["SECRET_KEY_BASE", "OTP_SECRET"] },
      { name: "Matrix Synapse", summary: "Matrix homeserver for secure, decentralized chat.", image: "matrixdotorg/synapse:latest", ports: [8008], cpu: 1000, memMb: 1024, storageMb: 10240, logo: "matrix" },
      { name: "Mattermost", summary: "Open-source team messaging.", image: "mattermost/mattermost-team-edition:latest", ports: [8065], cpu: 1000, memMb: 2048, storageMb: 10240, logo: "mattermost" },
      { name: "code-server", summary: "VS Code in the browser.", image: "codercom/code-server:latest", ports: [8080], cpu: 1000, memMb: 2048, storageMb: 5120, logo: "coder", secretEnv: ["PASSWORD"] },
      { name: "Excalidraw", summary: "Collaborative hand-drawn style whiteboard.", image: "excalidraw/excalidraw:latest", ports: [80], cpu: 250, memMb: 256, storageMb: 512, logo: "excalidraw" },
      { name: "Metabase", summary: "Business intelligence and dashboards for any database.", image: "metabase/metabase:latest", ports: [3000], cpu: 1000, memMb: 2048, storageMb: 2048, logo: "metabase" },
      { name: "Headscale", summary: "Self-hosted Tailscale control server.", image: "headscale/headscale:latest", ports: [8080], cpu: 250, memMb: 256, storageMb: 1024, logo: null, command: ["serve"] },
      { name: "Directus", summary: "Headless CMS and data platform for any SQL database.", image: "directus/directus:latest", ports: [8055], cpu: 500, memMb: 1024, storageMb: 2048, logo: "directus", secretEnv: ["SECRET", "ADMIN_PASSWORD"] },
      { name: "Jellyfin", summary: "Free software media server.", image: "jellyfin/jellyfin:latest", ports: [8096], cpu: 2000, memMb: 2048, storageMb: 20480, logo: "jellyfin" },
      { name: "Adminer", summary: "Database management in a single page.", image: "adminer:latest", ports: [8080], cpu: 250, memMb: 128, storageMb: 256, logo: null },
      { name: "Minecraft Java", summary: "Minecraft Java Edition server.", image: "itzg/minecraft-server:latest", ports: [25565], cpu: 2000, memMb: 4096, storageMb: 5120, logo: null, env: { EULA: "TRUE" } },
    ],
  },
];

export const SEED_TEMPLATES: TemplateCategory[] = [
  { title: STATIC_TITLE, description: "Static sites served by hosting nodes — no container needed", templates: staticTemplates },
  { title: WORKSTATIONS_TITLE, description: "Jupyter, VS Code or a desktop on an assigned GPU, billed by the hour", templates: WORKSTATION_TEMPLATES },
  ...GROUPS.map((g) => ({ title: g.title, description: g.description, templates: g.items.map((c) => container(g.title, c)) })),
];

const BY_ID = new Map(SEED_TEMPLATES.flatMap((c) => c.templates).map((t) => [t.id, t]));

export function seedTemplateById(id: string): Template | null {
  return BY_ID.get(id) ?? null;
}
