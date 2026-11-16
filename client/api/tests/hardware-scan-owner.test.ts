import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { generateToken } from "../src/middleware/auth.js";

let app: ReturnType<typeof buildApp>;
let ipSeq = 0;

const alice = "0x" + "a1".repeat(20);
const bob = "0x" + "b2".repeat(20);
const aliceNode = "0x" + "c3".repeat(20);

/** The provider endpoint (a literal public IP, so no DNS lookup) answers /hardware-scan with this body. */
function serve(body: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } })));
}

async function scan(wallet: string, endpoint: string) {
  return app.request("/v1/providers/scan", {
    method: "POST",
    headers: { Authorization: `Bearer ${await generateToken(wallet)}`, "Content-Type": "application/json", "cf-connecting-ip": `10.9.0.${ipSeq++}` },
    body: JSON.stringify({ endpoint }),
  });
}

const stored = async (deviceId: string) => (await app.request(`/v1/providers/${deviceId}/hardware`)).json();

beforeAll(async () => {
  await setupV1Db();
  app = buildApp({ runtime: "node" });
  await getD1().prepare("INSERT INTO nodes (address, payout) VALUES (?, ?)").bind(aliceNode, alice).run();
});

afterEach(() => vi.unstubAllGlobals());

describe("hardware scan records are bound to the node's payout wallet", () => {
  it("the owner's scan is stored, unverified; another wallet cannot overwrite it", async () => {
    serve({ deviceId: aliceNode, computeScore: 10, gpus: [], tier: "T1", signature: "0xabc" });
    expect((await scan(alice, "http://203.0.113.5:4040")).status).toBe(200);
    // Nothing checks the provider's signature, so the record does not claim to be verified.
    expect(await stored(aliceNode)).toMatchObject({ computeScore: 10, endpoint: "http://203.0.113.5:4040/", verifiedAt: null });

    serve({ deviceId: aliceNode, computeScore: 999999, gpus: [], tier: "T9", signature: "forged" });
    const res = await scan(bob, "http://198.51.100.7:4040");
    expect(res.status).toBe(403);
    expect(await stored(aliceNode)).toMatchObject({ computeScore: 10, tier: "T1", endpoint: "http://203.0.113.5:4040/" });
  });

  it("a deviceId that is not a node bound to the caller is refused, and nothing is stored", async () => {
    const unknown = "0x" + "d4".repeat(20);
    serve({ deviceId: unknown, computeScore: 5, gpus: [] });
    expect((await scan(bob, "http://198.51.100.7:4040")).status).toBe(403);
    serve({ deviceId: "some-hw-id", computeScore: 5, gpus: [] });
    expect((await scan(bob, "http://198.51.100.7:4040")).status).toBe(403);
    expect((await app.request(`/v1/providers/${unknown}/hardware`)).status).toBe(404);
    expect((await app.request("/v1/providers/some-hw-id/hardware")).status).toBe(404);
  });
});
