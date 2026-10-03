import { z } from "@hono/zod-openapi";
import { successSchema } from "./common.schema.js";

export const PinRequestSchema = z.object({
  content: z.record(z.unknown()).openapi({ description: "JSON object to pin" }),
  name: z.string().trim().min(1).max(200).optional(),
});

export const PinResponseSchema = successSchema({
  cid: z.string(),
  url: z.string(),
});
