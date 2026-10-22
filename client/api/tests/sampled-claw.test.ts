/**
 * The claw of a failed sampled check (ENGINEERING_BACKLOG B-6), its edges: it commits atomically with the result, a
 * submit that lost a race never re-runs it, its scope follows how the node was bound, and an operator can reverse it.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { buildApp } from "../src/app.js";
import { getD1, getKV, initStorage } from "../src/lib/storage.js";
import { creditUcld } from "../src/services/balance.service.js";
import { getNode } from "../src/services/nodes.service.js";
import { getWorkJob, submitWork } from "../src/services/jobs.service.js";
import { clawEntry, epochOf } from "../src/services/ledger.service.js";
import { ENV, entryStates, freshNode, nextJob, setEnv, user } from "./helpers/sampled.js";

const KEY = "internal-key-for-claw-tests";

/** A forged job of `node`, submitted with every job sampled (K = 1). */
async function caughtSubmit(node: string, now = Date.now()) {
  setEnv({ VERIFY_SAMPLE_K: "1" });
  try {
    const s = await nextJob(node, true);
    return { s, r: await submitWork(node, s, now) };
  } finally {
    setEnv({ VERIFY_SAMPLE_K: "10" });
  }
}

/** An honest, held job of `node`; returns its id. */
async function heldJob(node: string): Promise<string> {
  const s = await nextJob(node);
  expect(await submitWork(node, s)).toMatchObject({ ok: true });
  return s.jobId;
}

/**
 * Run `f` with the D1 binding wrapped. `beforeBatch(n)` runs before the n-th batch (n ≥ 2) executes; the first one runs
 * at once — the SQLite binding executes a batch synchronously inside the call, so batch n − 1 has committed by then.
 * `failAfterBatch`: every statement prepared after the first batch fails, as a transient D1 error would.
 */
async function withD1<T>(hooks: { beforeBatch?: (n: number) => Promise<void>; failAfterBatch?: boolean }, f: () => Promise<T>) {
  const real = getD1();
  const kv = getKV();
  let batches = 0;
  const broken = {
    bind: () => broken,
    run: () => Promise.reject(new Error("D1_ERROR: transient")),
    first: () => Promise.reject(new Error("D1_ERROR: transient")),
    all: () => Promise.reject(new Error("D1_ERROR: transient")),
    raw: () => Promise.reject(new Error("D1_ERROR: transient")),
  };
  const wrapped = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "prepare") return (sql: string) => (hooks.failAfterBatch && batches > 0 ? broken : target.prepare(sql));
      if (prop === "batch") {
        return async (stmts: D1PreparedStatement[]) => {
          const n = ++batches;
          if (n > 1 && hooks.beforeBatch) await hooks.beforeBatch(n);
          return target.batch(stmts);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  initStorage(wrapped as D1Database, kv);
  try {
    return { result: await f(), batches };
  } finally {
    initStorage(real, kv);
  }
}

beforeAll(async () => {
  await setupV1Db({ ...ENV, INTERNAL_API_KEY: KEY });
  await creditUcld(user, 10_000_000);
});

describe("the flag commits with the result", () => {
  it("a D1 error after the batch leaves the node suspended, its failure counted and its held pay clawed", async () => {
    const { node } = await freshNode();
    const held = await heldJob(node);
    setEnv({ VERIFY_SAMPLE_K: "1" });
    let s;
    try {
      s = await nextJob(node, true);
      // Every D1 call after the batch fails (the re-queue of the node's deployments, any bookkeeping).
      await withD1({ failAfterBatch: true }, () => submitWork(node, s!).catch((e: unknown) => e));
    } finally {
      setEnv({ VERIFY_SAMPLE_K: "10" });
    }
    expect(await getNode(node)).toMatchObject({ state: "suspended", state_reason: `sampled transcript check failed on job ${s!.jobId}`, jobs_failed: 1 });
    expect(await entryStates([held, s!.jobId])).toEqual({
      [held]: ["A:clawed", "B:clawed", "treasury:pending"],
      [s!.jobId]: ["A:clawed", "B:clawed", "treasury:pending"],
    });
  });
});

describe("a submit that lost the race changes nothing", () => {
  it("only the winning batch claws: held pay that arrives between the two batches stays pending", async () => {
    const { node, payout } = await freshNode();
    const late = crypto.randomUUID();
    setEnv({ VERIFY_SAMPLE_K: "1" });
    try {
      const s = await nextJob(node, true);
      const now = Date.now();
      const { result, batches } = await withD1(
        {
          // Between the winner's batch and the loser's: new held pay for the same wallet (another of its nodes, say).
          beforeBatch: async (n) => {
            if (n !== 2) return;
            await getD1()
              .prepare(
                "INSERT INTO reward_entries (id, job_id, epoch, address, lane, work_type, amount_ucld, vests_at, status, created_at) " +
                  "VALUES (?, 'late-job', ?, ?, 'A', 'matmul', 949, ?, 'pending', ?)",
              )
              .bind(late, epochOf(now) + 30, payout, now, now)
              .run();
          },
        },
        () => Promise.all([submitWork(node, s, now), submitWork(node, s, now)]),
      );
      expect(batches).toBe(2); // both submits reached their batch
      expect(result.map((r) => (r.ok ? "ok" : r.code)).sort()).toEqual(["conflict", "unprocessable"]);
    } finally {
      setEnv({ VERIFY_SAMPLE_K: "10" });
    }
    const row = await getD1().prepare("SELECT status FROM reward_entries WHERE id = ?").bind(late).first();
    expect(row).toEqual({ status: "pending" });
    const covered = await getD1().prepare("SELECT COUNT(*) AS c FROM reward_claws WHERE entry_id = ?").bind(late).first<{ c: number }>();
    expect(covered!.c).toBe(0);
    expect((await getNode(node))!.jobs_failed).toBe(1); // counted once
  });
});

describe("a fleet node's claw is wallet-wide too", () => {
  it("claws the fleet owner's held pay (fleet mates and the wallet's own nodes), names the fleet in the log, and can be reversed", async () => {
    const wallet = "0x" + randomBytes(20).toString("hex");
    const fleetId = "flt_" + randomBytes(6).toString("hex");
    await getD1()
      .prepare("INSERT INTO fleets (id, owner, name, token_hash, created_at) VALUES (?, ?, 'Acme racks', ?, ?)")
      .bind(fleetId, wallet, randomBytes(32).toString("hex"), Date.now())
      .run();
    const caught = await freshNode(wallet, fleetId);
    const fleetMate = await freshNode(wallet, fleetId);
    const own = await freshNode(wallet);
    const held = { caught: await heldJob(caught.node), fleetMate: await heldJob(fleetMate.node), own: await heldJob(own.node) };
    const warn = vi.spyOn(console, "warn");
    let s;
    let logged = "";
    try {
      ({ s } = await caughtSubmit(caught.node));
      logged = warn.mock.calls.flat().join(" ");
    } finally {
      warn.mockRestore();
    }
    const clawed = ["A:clawed", "B:clawed", "treasury:pending"];
    expect(await entryStates([held.caught, held.fleetMate, held.own, s.jobId])).toEqual({
      [held.caught]: clawed,
      [held.fleetMate]: clawed, // a modified agent on many fleet nodes keeps none of their held pay
      [held.own]: clawed,
      [s.jobId]: clawed,
    });
    expect((await getNode(caught.node))!.state).toBe("suspended");
    expect((await getNode(fleetMate.node))!.state).toBe("active"); // only the caught node is flagged
    // The fleet owner learns which fleet, and what to do if the node is not theirs (a leaked token).
    expect(logged).toContain(`fleet "Acme racks" (${fleetId})`);
    expect(logged).toContain(`if this node is not yours, revoke the fleet's token and ask an admin to reverse the claw (POST /v1/admin/claws/${s.jobId}/reverse)`);

    // The remedy for a leaked token: the claw is reversed, every held entry back to pending.
    const res = await buildApp({ runtime: "node" }).request(`/v1/admin/claws/${s.jobId}/reverse`, {
      method: "POST",
      headers: { "cf-connecting-ip": "10.67.0.2", "x-internal-key": KEY },
    });
    expect(await res.json()).toEqual({ status: "success", restored: 8 });
    const pending = ["A:pending", "B:pending", "treasury:pending"];
    expect(await entryStates([held.caught, held.fleetMate, held.own, s.jobId])).toEqual({
      [held.caught]: pending,
      [held.fleetMate]: pending,
      [held.own]: pending,
      [s.jobId]: pending,
    });
  });
});

describe("POST /v1/admin/claws/{jobId}/reverse", () => {
  const reverse = (jobId: string, key = KEY) =>
    buildApp({ runtime: "node" }).request(`/v1/admin/claws/${jobId}/reverse`, {
      method: "POST",
      headers: { "cf-connecting-ip": "10.67.0.1", ...(key ? { "x-internal-key": key } : {}) },
    });
  const claws = async (jobId: string) =>
    (await getD1().prepare("SELECT COUNT(*) AS c FROM reward_claws WHERE job_id = ?").bind(jobId).first<{ c: number }>())!.c;

  it("puts back what one failed check clawed, held entries only; needs the internal key; lifting the suspension is separate", async () => {
    const { node } = await freshNode();
    const held = await heldJob(node);
    const { s } = await caughtSubmit(node);
    expect(await claws(s.jobId)).toBe(4); // the held job's A/B and the failing job's own
    // One clawed entry has reached the open epoch: it may close any moment, so it stays clawed.
    const open = await getD1()
      .prepare("SELECT id FROM reward_entries WHERE job_id = ? AND lane = 'B'")
      .bind(held)
      .first<{ id: string }>();
    await getD1().prepare("UPDATE reward_entries SET epoch = ? WHERE id = ?").bind(epochOf(Date.now()), open!.id).run();

    expect((await reverse(s.jobId, "")).status).toBe(401); // no key
    expect((await reverse(s.jobId, "wrong")).status).toBe(401);
    expect(await (await reverse(s.jobId)).json()).toEqual({ status: "success", restored: 3 });
    expect(await entryStates([held, s.jobId])).toEqual({
      [held]: ["A:pending", "B:clawed", "treasury:pending"],
      [s.jobId]: ["A:pending", "B:pending", "treasury:pending"],
    });
    expect(await claws(s.jobId)).toBe(0);
    expect(await getWorkJob(s.jobId)).toMatchObject({ status: "done", sample_check: "reversed" });
    expect(await (await reverse(s.jobId)).json()).toEqual({ status: "success", restored: 0 }); // twice: a no-op
    expect((await getNode(node))!.state).toBe("suspended");
  });

  it("two failed checks covering the same pay: reversing one restores none of what the other still covers; reversing both restores it", async () => {
    const wallet = "0x" + randomBytes(20).toString("hex");
    const one = await freshNode(wallet);
    const two = await freshNode(wallet);
    const held = await heldJob(one.node);
    const x = (await caughtSubmit(one.node)).s.jobId; // claws `held` and X's own pay
    const y = (await caughtSubmit(two.node)).s.jobId; // covers all of that too, and Y's own pay
    const all = [held, x, y];
    const clawed = ["A:clawed", "B:clawed", "treasury:pending"];
    expect(await entryStates(all)).toEqual({ [held]: clawed, [x]: clawed, [y]: clawed });

    // X was a false positive, Y was not: everything X took, Y also holds back.
    expect(await (await reverse(x)).json()).toEqual({ status: "success", restored: 0 });
    expect(await entryStates(all)).toEqual({ [held]: clawed, [x]: clawed, [y]: clawed });
    // Both false positives: all of it comes back.
    expect(await (await reverse(y)).json()).toEqual({ status: "success", restored: 6 });
    const pending = ["A:pending", "B:pending", "treasury:pending"];
    expect(await entryStates(all)).toEqual({ [held]: pending, [x]: pending, [y]: pending });
  });

  it("never restores pay clawed another way (an operator's claw after a veto)", async () => {
    const { node } = await freshNode();
    const vetoed = await heldJob(node);
    const held = await heldJob(node);
    const entry = await getD1()
      .prepare("SELECT id, epoch FROM reward_entries WHERE job_id = ? AND lane = 'A'")
      .bind(vetoed)
      .first<{ id: string; epoch: number }>();
    expect(await clawEntry(entry!.epoch, entry!.id)).toEqual({ ok: true });
    const { s } = await caughtSubmit(node);
    expect(await (await reverse(s.jobId)).json()).toEqual({ status: "success", restored: 5 });
    expect(await entryStates([vetoed, held, s.jobId])).toEqual({
      [vetoed]: ["A:clawed", "B:pending", "treasury:pending"],
      [held]: ["A:pending", "B:pending", "treasury:pending"],
      [s.jobId]: ["A:pending", "B:pending", "treasury:pending"],
    });
  });
});
