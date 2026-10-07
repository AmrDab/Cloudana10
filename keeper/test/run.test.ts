/**
 * Orchestration tests: a mocked admin API + a mocked chain that models CloudanaSettlementV2's state machine.
 * Each `runOnce` must be idempotent and move every epoch forward by exactly what the on-chain state allows.
 */
import { describe, expect, it } from "vitest";
import { getAddress, keccak256, toHex, zeroHash, type Address, type Hex } from "viem";
import type { Api, EpochPayload } from "../src/api";
import type { Chain, ClaimEntry, OnChainEpoch, PostArgs } from "../src/chain";
import { EpochStatus, FLAG_A_CLAIMED, FLAG_B_CLAIMED, FLAG_B_VOID } from "../src/abi";
import { buildTree, UCLD_TO_WEI } from "../src/tree";
import { processEpoch, runOnce, type Deps } from "../src/run";

const addr = (tag: string) => getAddress("0x" + keccak256(toHex(tag)).slice(26));
const EPOCH_SECONDS = 3600n, VETO = 3600n, VEST = 3600n;

// ---- mock chain ----
class MockChain implements Chain {
  time: bigint;
  epochs = new Map<bigint, OnChainEpoch>();
  flags = new Map<string, number>();
  escrow = 10_000n * 10n ** 18n;
  pendingBurn = 0n;
  allowance = 100n * 10n ** 18n;
  txs: { fn: string; args: unknown }[] = [];
  postTxLookup = true;
  private n = 0;

  constructor(time: bigint) { this.time = time; }
  private tx(fn: string, args: unknown): Hex {
    this.txs.push({ fn, args });
    return `0x${(++this.n).toString(16).padStart(64, "0")}` as Hex;
  }
  async getEpoch(epoch: bigint) {
    return this.epochs.get(epoch) ?? {
      root: zeroHash, totalLaneA: 0n, totalLaneB: 0n, treasuryAmount: 0n, feesBurned: 0n, mintedA: 0n, mintedB: 0n,
      postedAt: 0n, finalizedAt: 0n, status: EpochStatus.None,
    };
  }
  async getParams() { return { epochSeconds: EPOCH_SECONDS, vetoDelaySeconds: VETO, vestBSeconds: VEST, genesisEpoch: 0n }; }
  async getEscrowAvailable() { return this.escrow - this.pendingBurn; }
  async getAllowance() { return this.allowance; }
  async getLaneFlags(epoch: bigint, accounts: Address[]) { return accounts.map((a) => this.flags.get(`${epoch}:${a}`) ?? 0); }
  async now() { return this.time; }
  async getPosterBalance() { return 10n ** 17n; }
  async findPostTx(epoch: bigint) { return this.postTxLookup && this.epochs.has(epoch) ? (`0xf${epoch.toString(16).padStart(63, "0")}` as Hex) : null; }
  async postEpoch(a: PostArgs) {
    const e = await this.getEpoch(a.epoch);
    if (e.status !== EpochStatus.None && e.status !== EpochStatus.Vetoed) throw new Error("AlreadyPosted");
    if (a.feesBurned > this.escrow - this.pendingBurn) throw new Error("FeesExceedEscrow");
    this.pendingBurn += a.feesBurned;
    this.epochs.set(a.epoch, { ...e, ...a, mintedA: 0n, mintedB: 0n, postedAt: this.time, finalizedAt: 0n, status: EpochStatus.Posted });
    return this.tx("postEpoch", a);
  }
  veto(epoch: bigint) {
    const e = this.epochs.get(epoch)!;
    this.pendingBurn -= e.feesBurned;
    e.status = EpochStatus.Vetoed;
  }
  async finalize(epoch: bigint) {
    const e = this.epochs.get(epoch)!;
    if (e.status !== EpochStatus.Posted) throw new Error("NotPosted");
    if (this.time < e.postedAt + VETO) throw new Error("VetoWindowOpen");
    this.pendingBurn -= e.feesBurned; this.escrow -= e.feesBurned;
    e.finalizedAt = this.time; e.status = EpochStatus.Finalized;
    return this.tx("finalize", epoch);
  }
  async claimFor(epoch: bigint, entries: ClaimEntry[]) {
    const e = this.epochs.get(epoch)!;
    if (e.status !== EpochStatus.Finalized) throw new Error("NotFinalized");
    const vested = this.time >= e.finalizedAt + VEST;
    for (const x of entries) {
      const k = `${epoch}:${x.account}`;
      let f = this.flags.get(k) ?? 0;
      let paid = false;
      if (x.laneA > 0n && !(f & FLAG_A_CLAIMED)) { f |= FLAG_A_CLAIMED; e.mintedA += x.laneA; paid = true; }
      if (x.laneB > 0n && vested && !(f & (FLAG_B_CLAIMED | FLAG_B_VOID))) { f |= FLAG_B_CLAIMED; e.mintedB += x.laneB; paid = true; }
      if (!paid) throw new Error(`NothingToClaim ${x.account}`);
      this.flags.set(k, f);
    }
    return this.tx("claimFor", { epoch, n: entries.length });
  }
}

// ---- mock API ----
class MockApi implements Api {
  payloads = new Map<number, EpochPayload>();
  calls: string[] = [];
  closeQueue: EpochPayload[] = [];
  async close() { this.calls.push("close"); const out = this.closeQueue; this.closeQueue = []; for (const p of out) this.payloads.set(p.epoch, p); return out; }
  async list(status: "closed" | "posted") { this.calls.push(`list:${status}`); return [...this.payloads.values()].filter((p) => p.status === status); }
  async posted(epoch: number, root: Hex, txHash: Hex) {
    this.calls.push(`posted:${epoch}:${txHash}`);
    const p = this.payloads.get(epoch)!; if (p.root !== root) throw new Error("root mismatch"); p.status = "posted";
  }
  async settled(epoch: number, txHash: Hex) { this.calls.push(`settled:${epoch}:${txHash}`); this.payloads.get(epoch)!.status = "settled"; }
  async vetoed(epoch: number) { this.calls.push(`vetoed:${epoch}`); this.payloads.get(epoch)!.status = "closed"; }
}

function payload(epoch: number, leaves: { account: Address; laneAUcld: number; laneBUcld: number }[], status = "closed"): EpochPayload {
  const root = leaves.length ? buildTree(BigInt(epoch), leaves).root : zeroHash;
  const sumA = leaves.reduce((s, l) => s + l.laneAUcld, 0), sumB = leaves.reduce((s, l) => s + l.laneBUcld, 0);
  const fees = Math.ceil(sumA / 0.95);
  return { epoch, root, leaves, totalLaneAUcld: sumA, totalLaneBUcld: sumB, treasuryUcld: Math.ceil(fees * 0.03) + 1, feesBurnedUcld: fees, status };
}

function world(epoch = 1000) {
  const chain = new MockChain(BigInt(epoch + 1) * EPOCH_SECONDS + 10n);
  const api = new MockApi();
  const logs: string[] = [];
  const deps: Deps = { api, chain, log: (m) => logs.push(m), claimChunk: 3 };
  return { chain, api, deps, logs };
}

const A = addr("a"), B = addr("b"), C = addr("c"), D = addr("d");

describe("runOnce lifecycle", () => {
  it("closed -> posted -> (veto window) -> finalized + lane A -> (vest) -> lane B -> settled; idempotent at every step", async () => {
    const { chain, api, deps } = world();
    api.closeQueue = [payload(1000, [
      { account: A, laneAUcld: 1_000_000, laneBUcld: 50_000 },
      { account: B, laneAUcld: 2_000_000, laneBUcld: 0 },
      { account: C, laneAUcld: 0, laneBUcld: 70_000 },
      { account: D, laneAUcld: 500_000, laneBUcld: 10_000 },
    ])];

    // pass 1: post
    let r = await runOnce(deps);
    expect(r.closedNow).toBe(1);
    expect(r.epochs).toEqual([{ epoch: 1000, action: "posted", txHash: expect.any(String) }]);
    const on = await chain.getEpoch(1000n);
    expect(on.status).toBe(EpochStatus.Posted);
    expect(on.totalLaneA).toBe(3_500_000n * UCLD_TO_WEI);
    expect(on.totalLaneB).toBe(130_000n * UCLD_TO_WEI);
    expect(api.payloads.get(1000)!.status).toBe("posted");
    expect(api.calls.filter((c) => c.startsWith("posted:1000"))).toHaveLength(1);

    // pass 2 (same time): nothing to do, veto window open
    r = await runOnce(deps);
    expect(r.epochs[0]).toMatchObject({ action: "waiting", reason: expect.stringMatching(/veto window/) });
    expect(chain.txs).toHaveLength(1);

    // pass 3: after the veto window -> finalize + lane A (3 leaves with laneA > 0, chunked by 3)
    chain.time += VETO;
    r = await runOnce(deps);
    expect(r.epochs[0]).toMatchObject({ action: "finalized", claims: 3, settled: false });
    expect(chain.txs.map((t) => t.fn)).toEqual(["postEpoch", "finalize", "claimFor"]);
    expect((await chain.getEpoch(1000n)).mintedA).toBe(3_500_000n * UCLD_TO_WEI);
    expect(api.payloads.get(1000)!.status).toBe("posted"); // not settled: lane B still vesting

    // pass 4 (same time): lane A paid, lane B vesting -> waiting, no tx
    r = await runOnce(deps);
    expect(r.epochs[0]).toMatchObject({ action: "waiting", reason: expect.stringMatching(/lane B vests/) });
    expect(chain.txs).toHaveLength(3);

    // pass 5: vested -> lane B for A, C, D (laneB > 0), settled
    chain.time += VEST;
    r = await runOnce(deps);
    expect(r.epochs[0]).toMatchObject({ action: "claimed", claims: 3, settled: true });
    expect((await chain.getEpoch(1000n)).mintedB).toBe(130_000n * UCLD_TO_WEI);
    expect(api.payloads.get(1000)!.status).toBe("settled");
    const settledCall = api.calls.find((c) => c.startsWith("settled:1000"))!;
    expect(settledCall.split(":")[2]).toBe(chain.txs[chain.txs.length - 1] && `0x${(chain.txs.length).toString(16).padStart(64, "0")}`);

    // pass 6: nothing listed any more
    r = await runOnce(deps);
    expect(r.epochs).toEqual([]);
  });

  it("chunks claimFor at claimChunk and only includes claimable leaves", async () => {
    const { chain, api, deps } = world();
    const leaves = Array.from({ length: 8 }, (_, i) => ({ account: addr(`p${i}`), laneAUcld: 1000 + i, laneBUcld: i % 2 ? 10 : 0 }));
    api.closeQueue = [payload(1000, leaves)];
    await runOnce(deps);
    chain.time += VETO;
    const r = await runOnce(deps);
    expect(r.epochs[0]).toMatchObject({ action: "finalized", claims: 8 });
    const claims = chain.txs.filter((t) => t.fn === "claimFor").map((t) => (t.args as any).n);
    expect(claims).toEqual([3, 3, 2]);
    chain.time += VEST;
    const r2 = await runOnce(deps);
    expect(r2.epochs[0]).toMatchObject({ action: "claimed", claims: 4, settled: true }); // only the 4 odd leaves have lane B
  });

  it("an epoch with zero lane B everywhere settles right after lane A", async () => {
    const { chain, api, deps } = world();
    api.closeQueue = [payload(1000, [{ account: A, laneAUcld: 10, laneBUcld: 0 }])];
    await runOnce(deps);
    chain.time += VETO;
    const r = await runOnce(deps);
    expect(r.epochs[0]).toMatchObject({ action: "finalized", claims: 1, settled: true });
    expect(api.payloads.get(1000)!.status).toBe("settled");
  });

  it("a clawed (void) lane B counts as settled and is never claimed", async () => {
    const { chain, api, deps } = world();
    api.closeQueue = [payload(1000, [{ account: A, laneAUcld: 10, laneBUcld: 5 }, { account: B, laneAUcld: 10, laneBUcld: 5 }])];
    await runOnce(deps);
    chain.time += VETO;
    await runOnce(deps);
    chain.flags.set(`1000:${A}`, FLAG_A_CLAIMED | FLAG_B_VOID); // guardian clawed A's lane B
    chain.time += VEST;
    const r = await runOnce(deps);
    expect(r.epochs[0]).toMatchObject({ action: "claimed", claims: 1, settled: true });
    expect(chain.flags.get(`1000:${A}`)).toBe(FLAG_A_CLAIMED | FLAG_B_VOID);
    expect(chain.flags.get(`1000:${B}`)).toBe(FLAG_A_CLAIMED | FLAG_B_CLAIMED);
  });
});

describe("safety and recovery", () => {
  it("skips and logs on root mismatch, never touching the chain", async () => {
    const { chain, api, deps, logs } = world();
    const p = payload(1000, [{ account: A, laneAUcld: 10, laneBUcld: 0 }]);
    p.root = `0x${"ab".repeat(32)}` as Hex;
    api.closeQueue = [p];
    const r = await runOnce(deps);
    expect(r.epochs[0]).toMatchObject({ action: "skipped", reason: expect.stringMatching(/root mismatch/) });
    expect(chain.txs).toEqual([]);
    expect(logs.some((l) => /ROOT MISMATCH/.test(l))).toBe(true);
  });

  it("skips when leaf sums do not match the payload totals", async () => {
    const { chain, api, deps } = world();
    const p = payload(1000, [{ account: A, laneAUcld: 10, laneBUcld: 0 }]);
    p.totalLaneAUcld = 11;
    api.closeQueue = [p];
    const r = await runOnce(deps);
    expect(r.epochs[0]).toMatchObject({ action: "skipped", reason: expect.stringMatching(/leaf sums/) });
    expect(chain.txs).toEqual([]);
  });

  it("skips (no tx) when fees exceed free escrow or lane B exceeds the allowance", async () => {
    const { chain, api, deps } = world();
    api.closeQueue = [payload(1000, [{ account: A, laneAUcld: 10, laneBUcld: 5 }])];
    chain.escrow = 1n;
    let r = await runOnce(deps);
    expect(r.epochs[0]).toMatchObject({ action: "skipped", reason: expect.stringMatching(/free escrow/) });
    chain.escrow = 10n ** 24n;
    chain.allowance = 1n;
    r = await runOnce(deps);
    expect(r.epochs[0]).toMatchObject({ action: "skipped", reason: expect.stringMatching(/allowance/) });
    expect(chain.txs).toEqual([]);
  });

  it("waits for an epoch that has not ended on-chain yet", async () => {
    const { chain, api, deps } = world();
    api.closeQueue = [payload(1000, [{ account: A, laneAUcld: 10, laneBUcld: 0 }])];
    chain.time = 1000n * EPOCH_SECONDS + 5n;
    const r = await runOnce(deps);
    expect(r.epochs[0]).toMatchObject({ action: "waiting", reason: expect.stringMatching(/epoch ends at/) });
  });

  it("recovers when the chain was posted but the API was not told (marks posted with the found tx)", async () => {
    const { chain, api, deps } = world();
    const p = payload(1000, [{ account: A, laneAUcld: 10, laneBUcld: 0 }]);
    api.closeQueue = [p];
    const t = buildTree(1000n, p.leaves);
    await chain.postEpoch({ epoch: 1000n, root: t.root, totalLaneA: 10n * UCLD_TO_WEI, totalLaneB: 0n, treasuryAmount: 1n, feesBurned: 11n * UCLD_TO_WEI });
    const r = await runOnce(deps);
    expect(r.epochs[0]).toMatchObject({ action: "waiting" });
    expect(api.calls.find((c) => c.startsWith("posted:1000"))).toBe(`posted:1000:0xf${(1000).toString(16).padStart(63, "0")}`);
    expect(api.payloads.get(1000)!.status).toBe("posted");
    expect(chain.txs.filter((x) => x.fn === "postEpoch")).toHaveLength(1);
  });

  it("falls back to the zero tx hash when the post log cannot be found", async () => {
    const { chain, api, deps } = world();
    chain.postTxLookup = false;
    const p = payload(1000, [{ account: A, laneAUcld: 10, laneBUcld: 0 }]);
    api.closeQueue = [p];
    await chain.postEpoch({ epoch: 1000n, root: buildTree(1000n, p.leaves).root, totalLaneA: 10n * UCLD_TO_WEI, totalLaneB: 0n, treasuryAmount: 1n, feesBurned: 11n * UCLD_TO_WEI });
    await runOnce(deps);
    expect(api.calls).toContain(`posted:1000:${zeroHash}`);
  });

  it("on-chain veto: tells the API /vetoed (also when it still says closed), never re-posts the vetoed root, posts a corrected root", async () => {
    const { chain, api, deps } = world();
    const bad = payload(1000, [{ account: A, laneAUcld: 10, laneBUcld: 0 }]);
    api.closeQueue = [bad];
    await runOnce(deps);
    chain.veto(1000n);
    let r = await runOnce(deps);
    expect(r.epochs[0]).toMatchObject({ action: "marked-vetoed" });
    expect(api.payloads.get(1000)!.status).toBe("closed");
    // API re-closes with the same (vetoed) root -> report the veto again, never re-post it
    r = await runOnce(deps);
    expect(r.epochs[0]).toMatchObject({ action: "marked-vetoed" });
    expect(chain.txs.filter((x) => x.fn === "postEpoch")).toHaveLength(1);
    // corrected close -> re-post allowed
    const good = payload(1000, [{ account: B, laneAUcld: 10, laneBUcld: 0 }]);
    api.payloads.set(1000, good);
    r = await runOnce(deps);
    expect(r.epochs[0]).toMatchObject({ action: "posted" });
    expect((await chain.getEpoch(1000n)).root).toBe(good.root);
    expect(api.payloads.get(1000)!.status).toBe("posted");
  });

  it("refuses to act when the API's leaves disagree with the root that is live on-chain", async () => {
    const { chain, api, deps } = world();
    const p = payload(1000, [{ account: A, laneAUcld: 10, laneBUcld: 0 }]);
    api.closeQueue = [p];
    await runOnce(deps);
    api.payloads.set(1000, payload(1000, [{ account: B, laneAUcld: 10, laneBUcld: 0 }], "posted"));
    chain.time += VETO;
    const r = await runOnce(deps);
    expect(r.epochs[0]).toMatchObject({ action: "skipped", reason: expect.stringMatching(/on-chain root/) });
    expect(chain.txs.filter((x) => x.fn === "finalize")).toHaveLength(0);
  });

  it("API says posted but nothing is on-chain -> skipped with a clear reason", async () => {
    const { api, deps } = world();
    api.payloads.set(1000, payload(1000, [{ account: A, laneAUcld: 10, laneBUcld: 0 }], "posted"));
    const r = await runOnce(deps);
    expect(r.epochs[0]).toMatchObject({ action: "skipped", reason: expect.stringMatching(/nothing is on-chain/) });
  });

  it("an error in one epoch does not stop the others; empty-leaf epochs are skipped", async () => {
    const { chain, api, deps } = world(1000);
    api.closeQueue = [payload(1000, [{ account: A, laneAUcld: 10, laneBUcld: 0 }]), payload(1001, []), payload(1002, [{ account: B, laneAUcld: 10, laneBUcld: 0 }])];
    chain.time = 1003n * EPOCH_SECONDS + 1n;
    const orig = chain.postEpoch.bind(chain);
    chain.postEpoch = async (a) => { if (a.epoch === 1000n) throw new Error("rpc down"); return orig(a); };
    const r = await runOnce(deps);
    expect(r.epochs.map((e) => e.action)).toEqual(["error", "skipped", "posted"]);
    expect(r.epochs[0]).toMatchObject({ error: "rpc down" });
  });

  it("processEpoch handles payload amounts given as strings", async () => {
    const { chain, deps, api } = world();
    const p = payload(1000, [{ account: A, laneAUcld: 10, laneBUcld: 0 }]);
    const asStrings = { ...p, totalLaneAUcld: "10", totalLaneBUcld: "0", treasuryUcld: String(p.treasuryUcld), feesBurnedUcld: String(p.feesBurnedUcld),
      leaves: [{ account: A, laneAUcld: "10", laneBUcld: "0" }] };
    api.payloads.set(1000, asStrings);
    const r = await processEpoch(deps, asStrings);
    expect(r).toMatchObject({ action: "posted" });
    expect((await chain.getEpoch(1000n)).totalLaneA).toBe(10n * UCLD_TO_WEI);
  });
});
