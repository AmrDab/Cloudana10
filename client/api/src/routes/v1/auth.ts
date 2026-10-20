/**
 * Authentication routes — wallet-based JWT login.
 *
 * GET  /v1/auth/nonce?address=0x…  — issue a single-use sign-in message
 * POST /v1/auth/login              — verify the signature over that message, return a JWT
 */
import { createRoute, z } from "@hono/zod-openapi";
import { verifyMessage } from "viem";
import { consumeNonce, generateToken, issueNonce, revokeToken } from "../../middleware/auth.js";
import { normalizeAddress } from "../../lib/eth.js";
import { fail, ok } from "../../lib/http.js";
import { getEnv } from "../../config/env.js";
import { BEARER_AUTH, createRouter, json, responses } from "./_openapi.js";

export const authRouter = createRouter();

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
    return fail(c, "unauthorized", "Unknown, expired or already-used sign-in message");
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
  if (!valid) return fail(c, "unauthorized", "Invalid signature");

  const token = await generateToken(address, "user");
  return c.json({ token, expiresIn: getEnv().JWT_TTL_SECONDS, address: normalizeAddress(address) }, 200);
});

const logoutRoute = createRoute({
  method: "post",
  path: "/auth/logout",
  tags: ["Auth"],
  description:
    "End this session token now: it is refused from then on (everywhere within about a minute). " +
    "API keys are revoked with DELETE /v1/keys/{id}, not here.",
  security: BEARER_AUTH,
  responses: responses(
    { 200: json(z.object({ status: z.literal("success"), revoked: z.boolean().openapi({ description: "false for a token minted before revocation existed (it still expires on time), or when the shared revocation list could not be written — then only this process refuses it until it expires" }) }), "Session ended") },
    401,
    403,
    429,
  ),
});

authRouter.openapi(logoutRoute, async (c) => {
  const payload = c.get("jwtPayload");
  if (payload.auth === "key") return fail(c, "forbidden", "API keys are revoked with DELETE /v1/keys/{id}");
  return ok(c, { revoked: await revokeToken(payload) });
});
