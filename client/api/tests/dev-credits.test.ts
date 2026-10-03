import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app.js";
import { generateToken } from "../src/middleware/auth.js";

const wallet = "0x00000000000000000000000000000000000000d7";
let app: ReturnType<typeof buildApp>;

const credit = (jwt: string, ip = "203.0.113.70") =>
  app.request("/v1/dev/credits", { method: "POST", headers: { Authorization: `Bearer ${jwt}`, "cf-connecting-ip": ip } });

describe("public testnet credits (TESTNET_CREDITS, DEV_MODE off)", () => {
  beforeAll(async () => {
    await setupV1Db({ DEV_MODE: "false", TESTNET_CREDITS: "true" });
    app = buildApp({ runtime: "node" });
  });

  it("credits 10 CLD once, then refuses for the day", async () => {
    const jwt = await generateToken(wallet);
    const first = await credit(jwt);
    expect(first.status).toBe(200);
    expect((await first.json()).balanceUcld).toBe(10_000_000);
    const again = await credit(jwt, "203.0.113.71");
    expect(again.status).toBe(429);
    expect((await again.json()).error.code).toBe("rate_limited");
  });

  it("requires a signed-in wallet", async () => {
    const res = await app.request("/v1/dev/credits", { method: "POST" });
    expect(res.status).toBe(401);
  });
});
