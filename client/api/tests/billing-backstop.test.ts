/**
 * bill()'s out-of-credits end against a concurrent heartbeat's backstop (review of PR #52): heartbeat A charges a due
 * hour and fails to hold the next; meanwhile heartbeat B found the hour claimed (held 0) and its backstop put an hour's
 * hold back on the row. Ending from A's snapshot (held 0) left that hold on a stopped row for ever.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";

// Runs once, inside heartbeat A's first hold(): heartbeat B lands exactly between A's charge and A's re-hold.
const trap = vi.hoisted(() => ({ fn: null as null | (() => Promise<void>) }));
vi.mock("../src/services/balance.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/balance.service.js")>();
  return {
    ...actual,
    hold: async (address: string, ucld: number) => {
      const t = trap.fn;
      trap.fn = null;
      if (t) await t();
      return actual.hold(address, ucld);
    },
  };
});

import { setupV1Db } from "./helpers/v1-db.js";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { setRelay } from "../src/lib/relay.js";
import { generateToken } from "../src/middleware/auth.js";
import { nodeSigningMessage } from "../src/middleware/node-auth.js";
import { creditUcld, getBalanceUcld } from "../src/services/balance.service.js";

const SECRET = "r".repeat(40);
let app: ReturnType<typeof buildApp>;
let seq = 0;
const call = (path: string, init: RequestInit = {}) => {
  const h = new Headers(init.headers);
  h.set("cf-connecting-ip", `198.51.100.${++seq % 250}`);
  return app.request(path, { ...init, headers: h });
};
async function signed(n: PrivateKeyAccount, path: string, payload: unknown = {}) {
  const body = JSON.stringify(payload);
  const ts = String(Date.now());
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const signature = await n.signMessage({ message: nodeSigningMessage("POST", path, ts, body, nonce) });
  return call(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Node": n.address, "X-Node-Timestamp": ts, "X-Nonce": nonce, "X-Node-Signature": signature }, body });
}
const GPUS = [{ name: "NVIDIA GeForce RTX 4090", vramGB: 24 }];
const ENDPOINT = { image: "vllm/vllm-openai:v0.6.3", command: ["--model", "x"], port: 8000, health: { path: "/health", startupGraceSec: 900 }, gpu: { count: 1, minVramGb: 16 }, cpu: 4000, memMb: 16384, storageMb: 51200, replicas: 1 };
const row = (id: string) => getD1().prepare("SELECT * FROM deployments WHERE id = ?").bind(id).first<{ status: string; held_ucld: number; price_ucld_per_hour: number }>();
const beat = async (n: PrivateKeyAccount) => expect((await signed(n, "/v1/nodes/heartbeat", { relay: true, agentVersion: "1.6.0" })).status).toBe(200);

beforeAll(async () => {
  await setupV1Db({ DEV_MODE: "true", RELAY_TICKET_SECRET: SECRET, INTERNAL_API_KEY: "k".repeat(32), SITES_DOMAIN: "example.run" });
  app = buildApp({ runtime: "node" });
  setRelay(async () => new Response('{"ok":true}', { status: 200 })); // probes pass: only billing is exercised
});

describe("bill(): out of credits while a concurrent backstop re-holds", () => {
  it("ends the row from a fresh read, so the backstop's hold comes back to the owner", async () => {
    const owner = "0x" + "b".repeat(40);
    await creditUcld(owner, 100_000);
    const jwt = await generateToken(owner);
    const res = await call("/v1/deployments", { method: "POST", headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: "llm", kind: "endpoint", spec: ENDPOINT }) });
    const id = (await res.json()).id as string;
    const node = privateKeyToAccount(generatePrivateKey());
    const announced = await signed(node, "/v1/nodes/announce", { manifest: { cpuThreads: 16, ramGB: 64, gpus: GPUS, os: "linux" }, benchmarkMmacPerSec: 100, workTypes: ["matmul", "hosting", "container", "gpu", "relay", "any-image"], pubkey: node.publicKey.slice(2), publicHost: "127.0.0.1", agentVersion: "1.6.0" });
    expect(announced.status).toBe(200);
    await getD1().prepare("UPDATE nodes SET payout = ?, fleet_id = 'flt_test' WHERE address = ?").bind("0x" + "e".repeat(40), node.address.toLowerCase()).run();
    await beat(node);
    const replica = (await getD1().prepare("SELECT id FROM deployments WHERE parent_id = ?").bind(id).first<{ id: string }>())!.id;
    expect((await signed(node, `/v1/nodes/deployments/${replica}/status`, { status: "running" })).status).toBe(200);
    const fee = (await row(replica))!.price_ucld_per_hour;
    // Two hours due; the owner can cover one more hour but not two.
    await getD1().prepare("UPDATE deployments SET last_billed_at = last_billed_at - ? WHERE id = ?").bind(2 * 3_600_000 + 60_000, replica).run();
    await getD1().prepare("UPDATE balances SET balance_ucld = ? WHERE address = ?").bind(Math.floor(fee * 1.5), owner).run();
    trap.fn = () => beat(node); // heartbeat B, between A's charge and A's re-hold
    await beat(node); // heartbeat A
    const end = (await row(replica))!;
    expect(end.status).toBe("stopped");
    expect(end.held_ucld).toBe(0);
    expect((await getBalanceUcld(owner)).heldUcld).toBe(0); // nothing stranded
  });
});
