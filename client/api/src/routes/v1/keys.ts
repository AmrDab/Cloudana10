/**
 * Developer API keys (ENGINEERING_BACKLOG B-7).
 *
 * POST   /v1/keys       — mint one (the token is in this answer only)
 * GET    /v1/keys       — list (prefix, scopes, last use; never the token)
 * DELETE /v1/keys/{id}  — revoke
 *
 * Wallet session only: a key cannot reach these routes (middleware/auth.ts → services/api-keys.service.ts scopeFor).
 */
import { createRoute, z } from "@hono/zod-openapi";
import { fail, ok } from "../../lib/http.js";
import { createApiKey, listApiKeys, MAX_KEYS_PER_ACCOUNT, revokeApiKey, SCOPES } from "../../services/api-keys.service.js";
import { BEARER_AUTH, createRouter, json, responses } from "./_openapi.js";

export const keysRouter = createRouter();
const TAGS = ["API keys"];

const KeySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string().openapi({ description: "The 8 characters after cld_sk_, to tell keys apart" }),
  scopes: z.array(z.enum(SCOPES)),
  createdAt: z.number(),
  lastUsedAt: z.number().nullable(),
  expiresAt: z.number().nullable(),
  revokedAt: z.number().nullable(),
});

const createKeyRoute = createRoute({
  method: "post",
  path: "/keys",
  tags: TAGS,
  description:
    `Mint an API key for scripts, CI and SDKs. Send it as \`Authorization: Bearer cld_sk_…\`. Scopes: read = GET on what ` +
    `you own; jobs = queue and cancel jobs; deployments = create, change and stop deployments and pins. A key can never ` +
    `manage keys, buy credits, touch payments or provider state. At most ${MAX_KEYS_PER_ACCOUNT} live keys; the token is ` +
    `shown once, only its hash is stored. Wallet session only.`,
  security: BEARER_AUTH,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().trim().min(1).max(60),
            scopes: z.array(z.enum(SCOPES)).min(1).max(SCOPES.length),
            expiresInDays: z.number().int().min(1).max(365).optional(),
          }),
        },
      },
    },
  },
  responses: responses(
    { 201: json(z.object({ status: z.literal("success"), key: KeySchema.extend({ token: z.string() }) }), "The new key, token included (once)") },
    400,
    401,
    403,
    409,
    429,
  ),
});

keysRouter.openapi(createKeyRoute, async (c) => {
  const { name, scopes, expiresInDays } = c.req.valid("json");
  const r = await createApiKey(c.get("jwtPayload").sub, name, scopes, expiresInDays);
  if (!r.ok) return fail(c, r.code, r.message);
  return ok(c, { key: r.key }, 201);
});

const listKeysRoute = createRoute({
  method: "get",
  path: "/keys",
  tags: TAGS,
  security: BEARER_AUTH,
  responses: responses({ 200: json(z.object({ status: z.literal("success"), keys: z.array(KeySchema) }), "Your keys, newest first, revoked ones included") }, 401, 403, 429),
});

keysRouter.openapi(listKeysRoute, async (c) => ok(c, { keys: await listApiKeys(c.get("jwtPayload").sub) }));

const revokeKeyRoute = createRoute({
  method: "delete",
  path: "/keys/{id}",
  tags: TAGS,
  description: "Revoke a key. Refused from now on here; within API_KEY_CACHE_SECONDS (30 s) everywhere.",
  security: BEARER_AUTH,
  request: { params: z.object({ id: z.string().uuid("Invalid key id") }) },
  responses: responses({ 200: json(z.object({ status: z.literal("success"), id: z.string(), revokedAt: z.number() }), "Revoked") }, 400, 401, 403, 404, 429),
});

keysRouter.openapi(revokeKeyRoute, async (c) => {
  const { id } = c.req.valid("param");
  const now = Date.now();
  if (!(await revokeApiKey(c.get("jwtPayload").sub, id, now))) return fail(c, "not_found", "key not found or already revoked");
  return ok(c, { id, revokedAt: now });
});
