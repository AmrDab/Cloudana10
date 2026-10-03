import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { recordHostingRewards } from "../src/services/ledger.service.js";

const KEY = "k".repeat(32);
const TREASURY = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const P1 = "0x00000000000000000000000000000000000000a1";
const P2 = "0x00000000000000000000000000000000000000a2";
const EPOCH = 2000;
const T0 = EPOCH * 120_000;
const HEX = (c: string) => "0x" + c.repeat(64);
let app: ReturnType<typeof buildApp>;
let ip = 0;

function admin(path: string, body: unknown = {}) {
  return app.request(`/v1/admin/epochs${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Key": KEY, "cf-connecting-ip": `10.7.0.${ip++ % 250}` },
    body: JSON.stringify(body),
  });
}

async function close() {
  const res = await admin("/close");
  expect(res.status).toBe(200);
  return ((await res.json()).epochs as { id: number; feesBurnedUcld: number; mintAUcld: number; leaves: unknown[] }[]).find(
    (e) => e.id === EPOCH,
  );
}

async function bill(id: string, provider: string) {
  await getD1()
    .prepare("INSERT INTO deployment_bills (id, deployment_id, owner, node, provider, fee_ucld, billed_at) VALUES (?, 'd', 'o', 'n', ?, 1000, ?)")
    .bind(id, provider, T0)
    .run();
  await recordHostingRewards({ billId: id, workType: "hosting", provider, feeUcld: 1000, now: T0 });
}

const entries = (jobId: string) =>
  getD1().prepare("SELECT id, lane, status FROM reward_entries WHERE job_id = ? ORDER BY lane").bind(jobId).all<{ id: string; lane: string; status: string }>();
const epochRow = () => getD1().prepare("SELECT * FROM epochs WHERE id = ?").bind(EPOCH).first<Record<string, unknown>>();
const minted = async () => (await (await app.request("/v1/network", { headers: { "cf-connecting-ip": "10.7.1.1" } })).json()).mintedUcld as number;

beforeAll(async () => {
  await setupV1Db({ INTERNAL_API_KEY: KEY, TREASURY_ADDRESS: TREASURY, EPOCH_SECONDS: "120" });
  app = buildApp({ runtime: "node" });
});

describe("vetoed epochs", () => {
  it("veto → entries pending → claw → re-close under the same id without the clawed entries", async () => {
    await bill("bill-1", P1);
    await bill("bill-2", P2);
    const first = await close();
    expect(first).toEqual({
      id: EPOCH,
      feesBurnedUcld: 2000,
      mintAUcld: 1960,
      mintBUcld: 0,
      leaves: [
        { address: P1, amountUcld: 975 },
        { address: P2, amountUcld: 975 },
        { address: TREASURY, amountUcld: 10 },
      ],
    });
    expect((await admin(`/${EPOCH}/posted`, { root: HEX("a"), txHash: HEX("b") })).status).toBe(200);

    // A posted epoch is not closed again, even with a late pending entry in it.
    await getD1()
      .prepare("INSERT INTO reward_entries (id, job_id, epoch, address, lane, work_type, amount_ucld, vests_at, status, created_at) VALUES ('late', 'late', ?, ?, 'A', 'hosting', 7, ?, 'pending', ?)")
      .bind(EPOCH, P1, T0, T0)
      .run();
    expect(await close()).toBeUndefined();
    expect((await admin(`/${EPOCH}/entries/late/claw`)).status).toBe(200);

    // Posted entries are on-chain: veto first.
    const bill2 = (await entries("bill-2")).results!;
    expect((await admin(`/${EPOCH}/entries/${bill2[0].id}/claw`)).status).toBe(409);

    const veto = await admin(`/${EPOCH}/vetoed`, { txHash: HEX("c"), reason: "bad provider" });
    expect(await veto.json()).toEqual({ status: "success", entriesReopened: 4 });
    expect(await epochRow()).toMatchObject({ status: "vetoed", root: null, fees_burned_ucld: null });
    expect((await entries("bill-1")).results!.map((e) => e.status)).toEqual(["pending", "pending"]);
    expect(await (await admin(`/${EPOCH}/vetoed`, {})).json()).toEqual({ status: "success", entriesReopened: 0 });

    const mintedBefore = await minted();
    for (const e of bill2) expect((await admin(`/${EPOCH}/entries/${e.id}/claw`)).status).toBe(200);
    expect((await admin(`/${EPOCH}/entries/${bill2[0].id}/claw`)).status).toBe(200); // idempotent
    expect((await admin(`/${EPOCH}/entries/nope/claw`)).status).toBe(404);
    expect((await admin(`/${EPOCH + 1}/entries/${bill2[0].id}/claw`)).status).toBe(404);
    expect(mintedBefore - (await minted())).toBe(980);

    const second = await close();
    expect(second).toEqual({
      id: EPOCH,
      feesBurnedUcld: 1000,
      mintAUcld: 980,
      mintBUcld: 0,
      leaves: [
        { address: P1, amountUcld: 975 },
        { address: TREASURY, amountUcld: 5 },
      ],
    });
    expect(second!.leaves).not.toEqual(first!.leaves);
    expect(await epochRow()).toMatchObject({ status: "closed", root: null, tx_hash: null, fees_burned_ucld: 1000 });
    expect(await close()).toBeUndefined();

    expect((await admin(`/${EPOCH}/posted`, { root: HEX("d"), txHash: HEX("e") })).status).toBe(200);
    expect((await admin(`/${EPOCH}/settled`, { txHash: HEX("f") })).status).toBe(200);
    expect((await entries("bill-2")).results!.map((e) => e.status)).toEqual(["clawed", "clawed"]);
    expect((await admin(`/${EPOCH}/vetoed`, {})).status).toBe(409);
  });

  it("vetoing an unknown epoch is 404 and needs the internal key", async () => {
    expect((await admin("/999999/vetoed", {})).status).toBe(404);
    const res = await app.request(`/v1/admin/epochs/${EPOCH}/vetoed`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Key": "wrong" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });
});
