import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect } from "vitest";
import { getD1 } from "../src/lib/storage.js";
import { migrateEpochs } from "../src/lib/schema.js";
import { resetEnv } from "../src/config/env.js";

const T = 1000 * 3_600_000 + 5; // epoch 1000 at 3600 s; epoch 30_000_000 at 120 s
const insert = (id: string, epoch: number, status: string) =>
  getD1()
    .prepare("INSERT INTO reward_entries (id, job_id, epoch, address, lane, work_type, amount_ucld, vests_at, status, created_at) VALUES (?, 'j', ?, 'a', 'A', 'matmul', 1, ?, ?, ?)")
    .bind(id, epoch, T, status, T)
    .run();
const epochs = async () => {
  const r = await getD1().prepare("SELECT id, epoch FROM reward_entries ORDER BY id").all<{ id: string; epoch: number }>();
  return Object.fromEntries(r.results!.map((e) => [e.id, e.epoch]));
};
const meta = async () => (await getD1().prepare("SELECT value FROM schema_meta WHERE key = 'epoch_seconds'").first<{ value: string }>())?.value;

describe("reward_entries.epoch migration", () => {
  it("voids unsettled settlement entries once when EPOCH_SECONDS changes, guarded by schema_meta", async () => {
    await setupV1Db({ EPOCH_SECONDS: "120" });
    expect(await meta()).toBe("120");
    await insert("pending", 30_000_000, "pending");
    await insert("posted", 30_000_000, "posted");

    process.env.EPOCH_SECONDS = "3600";
    resetEnv();
    await migrateEpochs();
    const status = async (id: string) => (await getD1().prepare("SELECT status FROM reward_entries WHERE id = ?").bind(id).first<{ status: string }>())?.status;
    expect(await status("pending")).toBe("clawed"); // old split/budget: the v2 Settlement would reject it
    expect(await status("posted")).toBe("posted"); // its epoch is not closed/posted here: untouched
    expect(await meta()).toBe("3600");

    // Same setting again: nothing runs (a deliberately wrong epoch proves it).
    await insert("later", 123, "pending");
    await migrateEpochs();
    expect((await epochs()).later).toBe(123);
  });
});
