/**
 * Authentication routes - wallet-based JWT login.
 * Users sign a message with their wallet, we verify and issue a JWT.
 */
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { verifyMessage } from "viem";
import { generateToken } from "../../middleware/auth.js";

export const authRouter = new OpenAPIHono();

const loginSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address"),
  message: z.string().min(1),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/, "Invalid signature"),
});

const loginRoute = createRoute({
  method: "post",
  path: "/auth/login",
  request: {
    body: {
      content: {
        "application/json": {
          schema: loginSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "JWT token",
      content: {
        "application/json": {
          schema: z.object({
            token: z.string(),
            expiresIn: z.number(),
          }),
        },
      },
    },
    401: {
      description: "Invalid signature",
    },
  },
});

authRouter.openapi(loginRoute, async (c) => {
  const { address, message, signature } = c.req.valid("json");

  // Verify the wallet signature
  try {
    const valid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });

    if (!valid) {
      return c.json({ status: "error", message: "Invalid signature" }, 401);
    }
  } catch {
    return c.json({ status: "error", message: "Signature verification failed" }, 401);
  }

  // Determine role (could check on-chain roles here)
  const role = "user";
  const token = await generateToken(address, role);

  return c.json({
    token,
    expiresIn: 86400, // 24 hours
  });
});
