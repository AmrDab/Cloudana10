import { serve } from "@hono/node-server";
import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import { templatesRouter } from "./routes/v1/templates.js";
import { config } from "dotenv";

config();

const PORT = Number(process.env.PORT);
console.log("port", PORT);
console.log("api_url", process.env.API_URL);
const app = new OpenAPIHono();

// Enable CORS for all routes
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

// OpenAPI configuration
app.openAPIRegistry.registerComponent("securitySchemes", "BearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT"
});

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// API v1 routes
app.route("/v1", templatesRouter);

// OpenAPI JSON endpoint
app.get("/v1/doc", (c) => {
  return c.json(app.getOpenAPIDocument({
    openapi: "3.0.0",
    info: {
      title: "Cloudana API",
      description: "Cloudana backend API for templates",
      version: "1.0.0"
    },
    servers: [
      { 
        url: `http://localhost:${PORT}`,
        description: "API Server"
      }
    ]
  }));
});

// Swagger UI endpoint
app.get("/v1/swagger", swaggerUI({ url: "/v1/doc" }));

const port = PORT;

console.log(`Server is running on port ${port}`);
console.log(`Swagger UI available at http://localhost:${port}/v1/swagger`);
console.log(`OpenAPI JSON available at http://localhost:${port}/v1/doc`);

serve({
  fetch: app.fetch,
  port,
});
