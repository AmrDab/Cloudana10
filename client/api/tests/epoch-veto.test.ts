import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { recordHostingRewards, type EpochPayload } from "../src/services/ledger.service.js";
import { epochRoot } from "../src/services/epoch-merkle.js";

const KEY = "k".repeat(32);
const P1 = "0x00000000000000000000000000000000000000a1";
const P2 = "0x00000000000000000000000000000000000000a2";
const EPOCH = 2000;
const T0 = EPOCH * 120_000;
const HEX = (c: string) => "0x" + c.repeat(64);
let app: ReturnType<typeof buildApp>;
let ip = 0;

function admin(path: string, body: unknown = {}, method = "POST") {
  return app.request(`/v1/admin/epochs${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Internal-Key": KEY, "cf-connecting-ip": `10.7.0.${ip++ % 250}` },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}

async function close() {
  const res = await admin("/close");
  expect(res.status).toBe(200);
  return ((await res.json()).epochs as EpochPayload[]).find((e) => e.epoch === EPOCH);
}

async function list(status: string) {
  const res = await admin(`?status=${status}`, undefined, "GET");
  expect(res.status).toBe(200);
  return (await res.json()).epochs as EpochPayload[];
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
const network = async () => (await app.request("/v1/network", { headers: { "cf-connecting-ip": "10.7.1.1" } })).json();

beforeAll(async () => {
  await setupV1Db({ INTERNAL_API_KEY: KEY, EPOCH_SECONDS: "120" });
  app = buildApp({ runtime: "node" });
});

describe("vetoed epochs", () => {
  it("veto → entries pending → claw → re-close under the same id without the clawed entries", async () => {
    await bill("bill-1", P1);
    await bill("bill-2", P2);
    const first = await close();
    const leaves1 = [
      { account: P1, laneAUcld: 950, laneBUcld: 0 },
      { account: P2, laneAUcld: 950, laneBUcld: 0 },
    ];
    expect(first).toEqual({
      epoch: EPOCH,
      root: epochRoot(EPOCH, leaves1),
      feesBurnedUcld: 2000,
      totalLaneAUcld: 1900,
      totalLaneBUcld: 0,
      treasuryUcld: 60, // 3 % of each 1000 µCLD bill, posted as an amount (no treasury leaf)
      leaves: leaves1,
      status: "closed",
    });
    // A stateless keeper re-reads the same payload with its persisted leaves.
    expect(await list("closed")).toEqual([first]);
    expect(await list("posted")).toEqual([]);

    // Only the root computed at close may be reported as posted.
    expect((await admin(`/${EPOCH}/posted`, { root: HEX("a"), txHash: HEX("b") })).status).toBe(409);
    expect((await admin(`/${EPOCH}/posted`, { root: first!.root, txHash: HEX("b") })).status).toBe(200);
    expect((await list("posted")).map((e) => e.status)).toEqual(["posted"]);

    // A posted epoch is not closed again, even with a late pending entry in it.
    await getD1()
      .prepare("INSERT INTO reward_entries (id, job_id, epoch, address, lane, work_type, amount_ucld, vests_at, status, created_at) VALUES ('late', 'late', ?, ?, 'A', 'hosting', 7, ?, 'pending', ?)")
      .bind(EPOCH, P1, T0, T0)
      .run();
    expect(await close()).toBeUndefined();
    // …it moves to the open epoch instead of staying pending forever; claw it there.
    const late = await getD1().prepare("SELECT epoch FROM reward_entries WHERE id = 'late'").first<{ epoch: number }>();
    expect(late!.epoch).toBeGreaterThan(EPOCH);
    expect((await admin(`/${late!.epoch}/entries/late/claw`)).status).toBe(200);

    // Posted entries are on-chain: veto first.
    const bill2 = (await entries("bill-2")).results!;
    expect((await admin(`/${EPOCH}/entries/${bill2[0].id}/claw`)).status).toBe(409);

    const veto = await admin(`/${EPOCH}/vetoed`, { txHash: HEX("c"), reason: "bad provider" });
    expect(await veto.json()).toEqual({ status: "success", entriesReopened: 4 });
    expect(await epochRow()).toMatchObject({ status: "vetoed", root: null, fees_burned_ucld: null });
    expect((await entries("bill-1")).results!.map((e) => e.status)).toEqual(["pending", "pending"]);
    expect(await (await admin(`/${EPOCH}/vetoed`, {})).json()).toEqual({ status: "success", entriesReopened: 0 });

    const mintedBefore = (await network()).mintedUcld;
    // The provider's share is clawed; the treasury share stays (the fee stays burned, so the
    // contract's treasury ≥ 3% bound must keep holding).
    const [billA, billT] = [bill2.find((e) => e.lane === "A")!, bill2.find((e) => e.lane === "treasury")!];
    expect((await admin(`/${EPOCH}/entries/${billA.id}/claw`)).status).toBe(200);
    expect((await admin(`/${EPOCH}/entries/${billA.id}/claw`)).status).toBe(200); // idempotent
    expect((await admin(`/${EPOCH}/entries/${billT.id}/claw`)).status).toBe(409);
    expect((await admin(`/${EPOCH}/entries/nope/claw`)).status).toBe(404);
    expect((await admin(`/${EPOCH + 1}/entries/${billA.id}/claw`)).status).toBe(404);
    expect(mintedBefore - (await network()).mintedUcld).toBe(950); // lane A only

    const second = await close();
    const leaves2 = [{ account: P1, laneAUcld: 950, laneBUcld: 0 }];
    expect(second).toEqual({
      epoch: EPOCH,
      root: epochRoot(EPOCH, leaves2),
      feesBurnedUcld: 2000,
      totalLaneAUcld: 950,
      totalLaneBUcld: 0,
      treasuryUcld: 60,
      leaves: leaves2,
      status: "closed",
    });
    expect(second!.root).not.toEqual(first!.root);
    expect(await epochRow()).toMatchObject({ status: "closed", root: second!.root, tx_hash: null, fees_burned_ucld: 2000, treasury_ucld: 60 });
    expect(await close()).toBeUndefined();

    expect((await network()).lastSettledEpochAt).toBeNull();
    expect((await admin(`/${EPOCH}/posted`, { root: second!.root, txHash: HEX("e") })).status).toBe(200);
    expect((await admin(`/${EPOCH}/settled`, { txHash: HEX("f") })).status).toBe(200);
    expect((await entries("bill-2")).results!.map((e) => [e.lane, e.status])).toEqual([["A", "clawed"], ["treasury", "settled"]]);
    expect((await admin(`/${EPOCH}/vetoed`, {})).status).toBe(409);
    expect((await list("settled")).map((e) => e.epoch)).toEqual([EPOCH]);
    expect((await network()).lastSettledEpochAt).toEqual(expect.any(Number));
  });

  it("vetoing an unknown epoch is 404 and needs the internal key", async () => {
    expect((await admin("/999999/vetoed", {})).status).toBe(404);
    const res = await app.request(`/v1/admin/epochs/${EPOCH}/vetoed`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Key": "wrong" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    expect((await app.request("/v1/admin/epochs?status=closed", { headers: { "X-Internal-Key": "wrong" } })).status).toBe(401);
    expect((await admin("?status=bogus", undefined, "GET")).status).toBe(400);
  });
});
