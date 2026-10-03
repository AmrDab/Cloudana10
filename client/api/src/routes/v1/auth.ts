/**
 * Authentication routes — wallet-based JWT login.
 *
 * GET  /v1/auth/nonce?address=0x…  — issue a single-use sign-in message
 * POST /v1/auth/login              — verify the signature over that message, return a JWT
 */
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { verifyMessage } from "viem";
import { consumeNonce, generateToken, issueNonce } from "../../middleware/auth.js";
import { normalizeAddress } from "../../lib/eth.js";

export const authRouter = new OpenAPIHono();

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address");

const nonceRoute = createRoute({
  method: "get",
  path: "/auth/nonce",
  request: { query: z.object({ address: addressSchema }) },
  responses: {
    200: {
      description: "Message to sign. Valid for five minutes, single use.",
      content: {
        "application/json": {
          schema: z.object({ nonce: z.string(), message: z.string(), expiresAt: z.string() }),
        },
      },
    },
  },
});

authRouter.openapi(nonceRoute, async (c) => {
  const { address } = c.req.valid("query");
  return c.json(await issueNonce(address), 200);
});

const loginSchema = z.object({
  address: addressSchema,
  message: z.string().min(1).max(512),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/, "Invalid signature"),
});

const loginRoute = createRoute({
  method: "post",
  path: "/auth/login",
  request: { body: { content: { "application/json": { schema: loginSchema } } } },
  responses: {
    200: {
      description: "JWT token",
      content: {
        "application/json": {
          schema: z.object({ token: z.string(), expiresIn: z.number(), address: z.string() }),
        },
      },
    },
    401: { description: "Invalid signature or nonce" },
  },
});

authRouter.openapi(loginRoute, async (c) => {
  const { address, message, signature } = c.req.valid("json");

  // The nonce is consumed before signature verification so a failed attempt
  // cannot be retried against the same message.
  if (!(await consumeNonce(address, message))) {
    return c.json({ status: "error", message: "Unknown, expired or already-used sign-in message" }, 401);
  }

  let valid = false;
  try {
    valid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    valid = false;
  }
  if (!valid) {
    return c.json({ status: "error", message: "Invalid signature" }, 401);
  }

  const token = await generateToken(address, "user");
  return c.json({ token, expiresIn: 86400, address: normalizeAddress(address) }, 200);
});
