import { z } from "@hono/zod-openapi";

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
  config: TemplateConfigSchema
});

export const TemplateCategorySchema = z.object({
  title: z.string().openapi({ example: "Web" }),
  description: z.string().optional().openapi({ example: "Web server templates" }),
  templates: z.array(TemplateSchema)
});

export const GetTemplatesFullResponseSchema = z.array(TemplateCategorySchema);
export type GetTemplatesFullResponse = z.infer<typeof GetTemplatesFullResponseSchema>;

export const GetTemplatesListResponseSchema = z.object({
  data: z.array(TemplateCategorySchema)
});
export type GetTemplatesListResponse = z.infer<typeof GetTemplatesListResponseSchema>;

export const GetTemplateByIdParamsSchema = z.object({
  id: z.string().openapi({
    description: "Template ID",
    example: "web-server-1"
  })
});

export const GetTemplateByIdResponseSchema = z.object({
  data: TemplateSchema
});
export type GetTemplateByIdResponse = z.infer<typeof GetTemplateByIdResponseSchema>;
