import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { creditUcld, getBalanceUcld } from "../src/services/balance.service.js";
import { enqueueWorkJob } from "../src/services/jobs.service.js";

const n = 16; // fee = 1000 base + ceil(16³ × 14000 / 1e15) = 1001 µCLD
const M = Array.from({ length: n * n }, (_, i) => (i % 7) - 3);
const user = "0x00000000000000000000000000000000000000c1";

describe("user price ceiling", () => {
  beforeAll(async () => {
    await setupV1Db();
    await creditUcld(user, 2000);
  });

  it("refuses a job priced above the ceiling and holds nothing", async () => {
    const r = await enqueueWorkJob({ owner: user, workType: "matmul", n, matrixA: M, matrixB: M, maxPriceUcld: 1000 });
    expect(r).toMatchObject({ ok: false, code: "unprocessable" });
    expect(await getBalanceUcld(user)).toEqual({ balanceUcld: 2000, heldUcld: 0 });
  });

  it("queues a job at or under the ceiling", async () => {
    const r = await enqueueWorkJob({ owner: user, workType: "matmul", n, matrixA: M, matrixB: M, maxPriceUcld: 1001 });
    expect(r).toMatchObject({ ok: true, priceUcld: 1001 });
  });
});
