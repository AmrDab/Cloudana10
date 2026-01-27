import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { VerifyService } from "../../services/verify.service.js";
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

const verifyService = new VerifyService();

export const verifyRouter = new OpenAPIHono();

// Security: No authentication required for these endpoints (can be added later)
type SecurityRequirement = Record<string, string[]>;
const SECURITY_NONE: SecurityRequirement[] = [];

// POST /v1/verify/control-machine
const verifyControlMachineRoute = createRoute({
  method: "post",
  path: "/verify/control-machine",
  tags: ["Verify"],
  security: SECURITY_NONE,
  request: {
    body: {
      content: {
        "application/json": {
          schema: ControlMachineInputSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Successfully verified control machine SSH connection",
      content: {
        "application/json": {
          schema: VerifyControlMachineResponseSchema,
        },
      },
    },
    400: {
      description: "Bad request - invalid input or SSH connection failed",
    },
    500: {
      description: "Internal server error",
    },
  },
});

verifyRouter.openapi(verifyControlMachineRoute, async (c) => {
  try {
    const input = c.req.valid("json");
    const result = await verifyService.verifyControlMachine(input);
    
    return c.json({
      status: "success",
      ...result,
    }, 200);
  } catch (error) {
    console.error("Error verifying control machine:", error);
    return c.json(
      {
        status: "error",
        error: {
          message: error instanceof Error ? error.message : "Failed to verify control machine",
          error_code: "VER_001",
        },
      },
      400
    );
  }
});

// POST /v1/verify/control-and-worker
const verifyControlAndWorkerRoute = createRoute({
  method: "post",
  path: "/verify/control-and-worker",
  tags: ["Verify"],
  security: SECURITY_NONE,
  request: {
    body: {
      content: {
        "application/json": {
          schema: ControlAndWorkerRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Successfully verified control machine and worker node SSH connections",
      content: {
        "application/json": {
          schema: VerifyControlAndWorkerResponseSchema,
        },
      },
    },
    400: {
      description: "Bad request - invalid input or SSH connection failed",
    },
    500: {
      description: "Internal server error",
    },
  },
});

verifyRouter.openapi(verifyControlAndWorkerRoute, async (c) => {
  try {
    const data = c.req.valid("json");
    const result = await verifyService.verifyControlAndWorker(
      data.control_machine,
      data.worker_node
    );
    
    return c.json({
      status: "success",
      ...result,
    }, 200);
  } catch (error) {
    console.error("Error verifying control and worker:", error);
    return c.json(
      {
        status: "error",
        error: {
          message: error instanceof Error ? error.message : "Failed to verify control and worker",
          error_code: "VER_002",
        },
      },
      400
    );
  }
});

// POST /v1/verify/open-ports
const verifyOpenPortsRoute = createRoute({
  method: "post",
  path: "/verify/open-ports",
  tags: ["Verify"],
  security: SECURITY_NONE,
  request: {
    body: {
      content: {
        "application/json": {
          schema: OpenPortsRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Returns list of open and closed ports",
      content: {
        "application/json": {
          schema: OpenPortsResponseSchema,
        },
      },
    },
    400: {
      description: "Bad request - invalid input",
    },
  },
});

verifyRouter.openapi(verifyOpenPortsRoute, async (c) => {
  try {
    const { public_ip, ports } = c.req.valid("json");
    const result = await verifyService.checkPorts(public_ip, ports);
    
    return c.json(result, 200);
  } catch (error) {
    console.error("Error checking ports:", error);
    return c.json(
      {
        status: "error",
        error: {
          message: error instanceof Error ? error.message : "Failed to check ports",
          error_code: "VER_003",
        },
      },
      400
    );
  }
});

// POST /v1/verify/dns
const verifyDNSRoute = createRoute({
  method: "post",
  path: "/verify/dns",
  tags: ["Verify"],
  security: SECURITY_NONE,
  request: {
    body: {
      content: {
        "application/json": {
          schema: DNSRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Returns resolved IP addresses for domains",
      content: {
        "application/json": {
          schema: DNSResponseSchema,
        },
      },
    },
    400: {
      description: "Bad request - invalid input",
    },
  },
});

verifyRouter.openapi(verifyDNSRoute, async (c) => {
  try {
    const { domains } = c.req.valid("json");
    const result = await verifyService.resolveDomains(domains);
    
    return c.json(result, 200);
  } catch (error) {
    console.error("Error resolving DNS:", error);
    return c.json(
      {
        status: "error",
        error: {
          message: error instanceof Error ? error.message : "Failed to resolve DNS",
          error_code: "VER_004",
        },
      },
      400
    );
  }
});
