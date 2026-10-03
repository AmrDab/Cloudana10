import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { z } from "zod";
import { ok, fail, failValidation, parseJson, type ErrorCode } from "../src/lib/http.js";

describe("ok", () => {
  it("returns success envelope with given status", async () => {
    const app = new Hono();
    app.get("/", (c) => ok(c, { foo: "bar" }, 201));
    const res = await app.request("/");
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ status: "success", foo: "bar" });
  });

  it("defaults to status 200", async () => {
    const app = new Hono();
    app.get("/", (c) => ok(c, { a: 1 }));
    const res = await app.request("/");
    expect(res.status).toBe(200);
  });
});

describe("fail", () => {
  const cases: Array<[ErrorCode, number]> = [
    ["bad_request", 400],
    ["validation_failed", 400],
    ["unauthorized", 401],
    ["forbidden", 403],
    ["not_found", 404],
    ["conflict", 409],
    ["rate_limited", 429],
    ["payload_too_large", 413],
    ["unprocessable", 422],
    ["upstream_failed", 502],
    ["not_configured", 503],
    ["internal", 500],
  ];

  it.each(cases)("maps %s to status %d", async (code, status) => {
    const app = new Hono();
    app.get("/", (c) => fail(c, code, "oops"));
    const res = await app.request("/");
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ status: "error", error: { code, message: "oops" } });
  });

  it("includes details when provided", async () => {
    const app = new Hono();
    app.get("/", (c) => fail(c, "internal", "oops", { extra: true }));
    const res = await app.request("/");
    expect(await res.json()).toEqual({
      status: "error",
      error: { code: "internal", message: "oops", details: { extra: true } },
    });
  });
});

describe("failValidation", () => {
  it("builds a path: message string", async () => {
    const schema = z.object({ name: z.string() });
    const app = new Hono();
    app.get("/", (c) => {
      const parsed = schema.safeParse({ name: 123 });
      if (!parsed.success) return failValidation(c, parsed.error);
      return ok(c, {});
    });
    const res = await app.request("/");
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.message).toMatch(/^name: /);
  });
});

describe("parseJson", () => {
  const schema = z.object({ name: z.string() });

  it("returns bad_request on invalid JSON", async () => {
    const app = new Hono();
    app.post("/", async (c) => {
      const result = await parseJson(c, schema);
      if (!result.ok) return result.response;
      return ok(c, { data: result.data });
    });
    const res = await app.request("/", { method: "POST", body: "not json", headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
  });

  it("returns validation_failed on schema miss", async () => {
    const app = new Hono();
    app.post("/", async (c) => {
      const result = await parseJson(c, schema);
      if (!result.ok) return result.response;
      return ok(c, { data: result.data });
    });
    const res = await app.request("/", {
      method: "POST",
      body: JSON.stringify({ name: 123 }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
  });

  it("returns data on success", async () => {
    const app = new Hono();
    app.post("/", async (c) => {
      const result = await parseJson(c, schema);
      if (!result.ok) return result.response;
      return ok(c, { data: result.data });
    });
    const res = await app.request("/", {
      method: "POST",
      body: JSON.stringify({ name: "alice" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ name: "alice" });
  });
});
