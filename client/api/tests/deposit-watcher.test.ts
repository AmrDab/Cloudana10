import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { getD1, getKV } from "../src/lib/storage.js";
import { resetEnv } from "../src/config/env.js";
import { getBalanceUcld, getTransactionHistory } from "../src/services/balance.service.js";
import {
  DEPOSIT_CURSOR_KEY,
  creditDeposit,
  runDepositWatcher,
  runDepositWatcherCron,
  type DepositLog,
  type DepositSource,
} from "../src/services/deposit-watcher.service.js";

const user = "0x00000000000000000000000000000000000000aa";
const from = "0x00000000000000000000000000000000000000bb";
const tx = "0x" + "11".repeat(32);

/** 2.5 CLD in wei → 2_500_000 µCLD. */
const dep = (over: Partial<DepositLog> = {}): DepositLog => ({
  txHash: tx,
  logIndex: 0,
  from,
  user,
  amountWei: 2_500_000n * 10n ** 12n,
  blockNumber: 101n,
  ...over,
});

function source(latest: bigint, logs: DepositLog[]): DepositSource & { calls: [bigint, bigint][] } {
  const calls: [bigint, bigint][] = [];
  return {
    calls,
    latestBlock: async () => latest,
    deposits: async (a, b) => {
      calls.push([a, b]);
      return logs.filter((l) => l.blockNumber >= a && l.blockNumber <= b);
    },
  };
}

describe("Settlement Deposited watcher", () => {
  beforeAll(async () => {
    // Confirmations off here so block arithmetic reads plainly; the reorg test sets them explicitly.
    await setupV1Db({ DEPOSIT_CONFIRMATIONS: "0" });
  });

  it("is inactive without SETTLEMENT_ADDRESS + CHAIN_RPC_URL", async () => {
    expect(await runDepositWatcherCron({})).toEqual({ active: false, credited: 0, cursor: null });
    expect(await runDepositWatcherCron({ SETTLEMENT_ADDRESS: "0x" + "a".repeat(40) })).toMatchObject({ active: false });
  });

  it("starts at the head on the first run (no backfill) and only scans new blocks afterwards", async () => {
    const s = source(100n, [dep({ blockNumber: 50n })]);
    const first = await runDepositWatcher(s);
    expect(first).toEqual({ active: true, credited: 0, cursor: "100" });
    expect(s.calls).toEqual([]);
    expect((await getBalanceUcld(user)).balanceUcld).toBe(0);
  });

  it("credits amount / 1e12 µCLD to `user`, idempotent by txHash+logIndex, and advances the cursor", async () => {
    const logs = [dep(), dep({ logIndex: 1, user: from, amountWei: 10n ** 18n }), dep({ txHash: "0x" + "22".repeat(32), blockNumber: 102n })];
    const s = source(105n, logs);
    const run = await runDepositWatcher(s);
    expect(s.calls).toEqual([[101n, 105n]]);
    expect(run).toEqual({ active: true, credited: 3, cursor: "105" });
    expect((await getBalanceUcld(user)).balanceUcld).toBe(5_000_000);
    expect((await getBalanceUcld(from)).balanceUcld).toBe(1_000_000);
    expect(await getKV().get(DEPOSIT_CURSOR_KEY)).toBe("105");

    const { transactions } = await getTransactionHistory(user);
    expect(transactions).toHaveLength(2);
    expect(transactions[0]?.source).toBe("crypto");

    // Re-delivering the same logs (e.g. a reorg-safe overlap or a reset cursor) credits nothing.
    await getKV().put(DEPOSIT_CURSOR_KEY, "100");
    const again = await runDepositWatcher(source(105n, logs));
    expect(again.credited).toBe(0);
    expect((await getBalanceUcld(user)).balanceUcld).toBe(5_000_000);
  });

  it("ignores deposits that round to zero µCLD", async () => {
    const s = source(106n, [dep({ txHash: "0x" + "33".repeat(32), blockNumber: 106n, amountWei: 999n })]);
    expect((await runDepositWatcher(s)).credited).toBe(0);
  });

  it("stays DEPOSIT_CONFIRMATIONS behind the head, so a log in a still-reorgable block is not credited yet", async () => {
    process.env.DEPOSIT_CONFIRMATIONS = "10";
    resetEnv();
    try {
      await getKV().put(DEPOSIT_CURSOR_KEY, "200");
      const fresh = dep({ txHash: "0x" + "55".repeat(32), blockNumber: 215n, user: "0x" + "cc".repeat(20) });
      const s = source(220n, [fresh]);
      const run = await runDepositWatcher(s);
      expect(s.calls).toEqual([[201n, 210n]]);
      expect(run).toEqual({ active: true, credited: 0, cursor: "210" });
      expect((await getBalanceUcld(fresh.user)).balanceUcld).toBe(0);
      // Ten blocks later the same log is final and gets credited.
      const s2 = source(225n, [fresh]);
      expect((await runDepositWatcher(s2)).credited).toBe(1);
      expect(s2.calls).toEqual([[211n, 215n]]);
      expect((await getBalanceUcld(fresh.user)).balanceUcld).toBe(2_500_000);
    } finally {
      process.env.DEPOSIT_CONFIRMATIONS = "0";
      resetEnv();
    }
  });

  it("credits all-or-nothing: when the balance write fails, no processed_tx marker and no transaction row remain", async () => {
    const bad = dep({ txHash: "0x" + "66".repeat(32), blockNumber: 300n, user: "0x" + "dd".repeat(20) });
    // A CHECK that the transactions insert violates makes the batch roll back after the marker and balance rows.
    await getD1().prepare(`CREATE TRIGGER fail_once BEFORE INSERT ON transactions WHEN NEW.address = '${bad.user}' BEGIN SELECT RAISE(ABORT, 'boom'); END`).run();
    try {
      await expect(creditDeposit(bad)).rejects.toThrow(/boom/);
    } finally {
      await getD1().prepare("DROP TRIGGER fail_once").run();
    }
    expect(await getD1().prepare("SELECT tx_hash FROM processed_tx WHERE tx_hash = ?").bind(`${bad.txHash}:0`).first()).toBeNull();
    expect((await getBalanceUcld(bad.user)).balanceUcld).toBe(0);
    // Nothing was marked processed, so the next pass credits it.
    expect(await creditDeposit(bad)).toBe(true);
    expect((await getBalanceUcld(bad.user)).balanceUcld).toBe(2_500_000);
    expect((await getTransactionHistory(bad.user)).total).toBe(1);
  });

  it("honours a configured start block on a fresh cursor", async () => {
    await getKV().delete(DEPOSIT_CURSOR_KEY);
    const s = source(110n, [dep({ txHash: "0x" + "44".repeat(32), blockNumber: 108n })]);
    const run = await runDepositWatcher(s, 108n);
    expect(s.calls).toEqual([[108n, 110n]]);
    expect(run.credited).toBe(1);
  });
});
