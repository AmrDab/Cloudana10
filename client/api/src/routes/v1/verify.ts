import { createRoute } from "@hono/zod-openapi";
import { VerifyService } from "../../services/verify.service.js";
import { ok, fail } from "../../lib/http.js";
import {
  ControlMachineInputSchema,
  ControlAndWorkerRequestSchema,
  OpenPortsRequestSchema,
  DNSRequestSchema,
  VerifyControlMachineResponseSchema,
  VerifyControlAndWorkerResponseSchema,
  OpenPortsResponseSchema,
  DNSResponseSchema,
} from "../../schemas/verify.schema.js";
import { BEARER_AUTH, createRouter, json, responses } from "./_openapi.js";

const verifyService = new VerifyService();

export const verifyRouter = createRouter();

// requireAuth is applied to /v1/verify/* in middleware/security.ts.
const TAGS = ["Verify"];

// POST /v1/verify/control-machine
const verifyControlMachineRoute = createRoute({
  method: "post",
  path: "/verify/control-machine",
  tags: TAGS,
  security: BEARER_AUTH,
  request: { body: { required: true, content: { "application/json": { schema: ControlMachineInputSchema } } } },
  responses: responses(
    { 200: json(VerifyControlMachineResponseSchema, "Successfully verified control machine SSH connection") },
    400,
    401,
  ),
});

verifyRouter.openapi(verifyControlMachineRoute, async (c) => {
  try {
    const input = c.req.valid("json");
    const result = await verifyService.verifyControlMachine(input);
    return ok(c, { ...result });
  } catch (error) {
    console.error("Error verifying control machine:", error);
    return fail(c, "bad_request", error instanceof Error ? error.message : "Failed to verify control machine");
  }
});

// POST /v1/verify/control-and-worker
const verifyControlAndWorkerRoute = createRoute({
  method: "post",
  path: "/verify/control-and-worker",
  tags: TAGS,
  security: BEARER_AUTH,
  request: { body: { required: true, content: { "application/json": { schema: ControlAndWorkerRequestSchema } } } },
  responses: responses(
    { 200: json(VerifyControlAndWorkerResponseSchema, "Successfully verified control machine and worker node SSH connections") },
    400,
    401,
  ),
});

verifyRouter.openapi(verifyControlAndWorkerRoute, async (c) => {
  try {
    const data = c.req.valid("json");
    const result = await verifyService.verifyControlAndWorker(
      data.control_machine,
      data.worker_node
    );
    return ok(c, { ...result });
  } catch (error) {
    console.error("Error verifying control and worker:", error);
    return fail(c, "bad_request", error instanceof Error ? error.message : "Failed to verify control and worker");
  }
});

// POST /v1/verify/open-ports
const verifyOpenPortsRoute = createRoute({
  method: "post",
  path: "/verify/open-ports",
  tags: TAGS,
  security: BEARER_AUTH,
  request: { body: { required: true, content: { "application/json": { schema: OpenPortsRequestSchema } } } },
  responses: responses({ 200: json(OpenPortsResponseSchema, "Open and closed ports") }, 400, 401),
});

verifyRouter.openapi(verifyOpenPortsRoute, async (c) => {
  try {
    const { public_ip, ports } = c.req.valid("json");
    const result = await verifyService.checkPorts(public_ip, ports);
    return ok(c, result);
  } catch (error) {
    console.error("Error checking ports:", error);
    return fail(c, "bad_request", error instanceof Error ? error.message : "Failed to check ports");
  }
});

// POST /v1/verify/dns
const verifyDNSRoute = createRoute({
  method: "post",
  path: "/verify/dns",
  tags: TAGS,
  security: BEARER_AUTH,
  request: { body: { required: true, content: { "application/json": { schema: DNSRequestSchema } } } },
  responses: responses({ 200: json(DNSResponseSchema, "Resolved IP addresses for the domains") }, 400, 401),
});

verifyRouter.openapi(verifyDNSRoute, async (c) => {
  try {
    const { domains } = c.req.valid("json");
    const result = await verifyService.resolveDomains(domains);
    return ok(c, result);
  } catch (error) {
    console.error("Error resolving DNS:", error);
    return fail(c, "bad_request", error instanceof Error ? error.message : "Failed to resolve DNS");
  }
});
