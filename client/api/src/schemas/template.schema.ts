import { z } from "@hono/zod-openapi";
import { successSchema } from "./common.schema.js";

export const TemplateConfigSchema = z.object({
  ssh: z.boolean().optional(),
  logoUrl: z.string().optional()
});

export const TemplateSchema = z.object({
  id: z.string().openapi({ example: "web-server-1" }),
  name: z.string().openapi({ example: "Nginx Web Server" }),
  path: z.string().openapi({ example: "/templates/web/nginx" }),
  readme: z.string().openapi({ example: "# Nginx Web Server\nA simple Nginx web server template." }),
  summary: z.string().openapi({ example: "High-performance web server with Nginx" }),
  logoUrl: z.string().nullable().openapi({ example: null }),
  deploy: z.string().openapi({ example: "docker run nginx" }),
  guide: z.string().optional().openapi({ example: "https://example.com/guides/nginx" }),
  githubUrl: z.string().openapi({ example: "https://github.com/example/nginx-template" }),
  persistentStorageEnabled: z.boolean().openapi({ example: false }),
  config: TemplateConfigSchema,
  // V3 run fields — curated templates set all of them; imported ones kind/category/curated/image.
  kind: z.enum(["static", "container", "workstation"]).optional(),
  category: z.string().optional(),
  curated: z.boolean().optional(),
  image: z.string().nullable().optional(),
  command: z.array(z.string()).optional(),
  ports: z.array(z.number().int()).optional(),
  cpu: z.number().int().optional().openapi({ description: "millicores" }),
  memMb: z.number().int().optional(),
  storageMb: z.number().int().optional(),
  secretEnv: z.array(z.string()).optional().openapi({ description: "env keys to supply sealed" }),
  env: z.record(z.string()).optional(),
  files: z.array(z.object({ path: z.string(), contentBase64: z.string() })).optional(),
  // Workstation templates only (docs/WORKSTATIONS.md §6)
  gpu: z
    .object({ count: z.number().int(), minVramGb: z.number().optional(), class: z.enum(["any", "consumer", "datacenter"]).optional() })
    .optional(),
  access: z.object({ web: z.object({ port: z.number().int(), path: z.string().optional() }).optional(), ssh: z.boolean() }).optional(),
  workdir: z.string().optional(),
  sshPort: z.number().int().optional(),
  tokenEnv: z.string().optional(),
  tokenQuery: z.string().optional()
});

export const TemplateCategorySchema = z.object({
  title: z.string().openapi({ example: "Web" }),
  description: z.string().optional().openapi({ example: "Web server templates" }),
  templates: z.array(TemplateSchema)
});

export const GetTemplatesFullResponseSchema = successSchema({
  data: z.array(TemplateCategorySchema)
});
export type GetTemplatesFullResponse = z.infer<typeof GetTemplatesFullResponseSchema>;

export const GetTemplatesListResponseSchema = successSchema({
  data: z.array(TemplateCategorySchema)
});
export type GetTemplatesListResponse = z.infer<typeof GetTemplatesListResponseSchema>;

export const GetTemplateByIdParamsSchema = z.object({
  id: z.string().openapi({
    description: "Template ID",
    example: "web-server-1"
  })
});

export const GetTemplateByIdResponseSchema = successSchema({
  data: TemplateSchema
});
export type GetTemplateByIdResponse = z.infer<typeof GetTemplateByIdResponseSchema>;
