/**
 * The fake user (docs/POUW_SIMULATION_PLAN.md §4): submits a scripted job mix at a steady rate and records every
 * job's lifecycle to .dev-run-sim/jobs.jsonl (one line per finished job). Credits come from the local chain: the
 * treasury hands the user CLD, the user escrows it, the deposit watcher credits the account.
 *   npx tsx scripts/sim/testnet/user.ts [--jobs 500] [--rate 6] [--mix matmul:64,matmul:128,matmul:256,int8-mlp,int8-model:1,int8-model:2]
 *   --rate = jobs per minute; --mix is cycled. --seed <s> makes the inputs reproducible.
 */
import { appendFileSync } from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN_ID, RPC, RUN, TREASURY_KEY, addresses, api, log, signIn, sleep, until, wallet } from "./common.ts";

const opt = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const JOBS = Number(opt("jobs", "500"));
const RATE = Number(opt("rate", "6"));
const MIX = opt("mix", "matmul:64,matmul:128,matmul:256,int8-mlp,int8-model:1,int8-model:2").split(",");
const USER = opt("user", "user");
const OUT = path.join(RUN, opt("out", "jobs.jsonl"));
let seed = Number(opt("seed", String(Date.now() % 1_000_000)));
const rnd = (lo: number, hi: number) => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31;
  return lo + (seed % (hi - lo + 1));
};
const ints = (len: number, lo: number, hi: number) => Array.from({ length: len }, () => rnd(lo, hi));
const block = (d: number, h: number) => ({ W1: ints(d * h, -128, 127), b1: ints(h, -1000, 1000), W2: ints(h * d, -128, 127), b2: ints(d, -1000, 1000), m1: 1, s1: 8, m2: 1, s2: 8 });

/** One job of the mix: "matmul:<n>", "int8-mlp[:<d>]", "int8-model:<L>[:<d>]". */
export function makeJob(spec: string): Record<string, unknown> & { workType: string; label: string } {
  const [type, p1, p2] = spec.split(":");
  if (type === "matmul") {
    const n = Number(p1 ?? 64);
    return { workType: "matmul", label: spec, n, matrixA: ints(n * n, -127, 127), matrixB: ints(n * n, -127, 127) };
  }
  if (type === "int8-mlp") {
    const d = Number(p1 ?? 64), h = d, b = 16;
    return { workType: "int8-mlp", label: spec, input: { b, d, h, X: ints(b * d, -128, 127), ...block(d, h) } };
  }
  if (type === "int8-model") {
    const L = Number(p1 ?? 2), d = Number(p2 ?? 64), h = d, b = 16;
    return { workType: "int8-model", label: spec, input: { b, d, h, X: ints(b * d, -128, 127), blocks: Array.from({ length: L }, () => block(d, h)) } };
  }
  throw new Error(`unknown job spec ${spec}`);
}

// ── Credits from the chain ──────────────────────────────────────────────────────────────────────────────────────
const chain = defineChain({ id: CHAIN_ID, name: "local", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const erc20 = parseAbi(["function transfer(address, uint256) returns (bool)", "function approve(address, uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const settleAbi = parseAbi(["function deposit(uint256)"]);
const a = addresses();
const CLD = 10n ** 18n;
const user = wallet(USER);

export async function fund(cld: bigint): Promise<void> {
  const treasury = privateKeyToAccount(TREASURY_KEY);
  const w = (acct: typeof user) => createWalletClient({ chain, transport: http(RPC), account: acct });
  const wait = (hash: `0x${string}`) => pub.waitForTransactionReceipt({ hash });
  if ((await pub.getBalance({ address: user.address })) < parseEther("0.5")) await wait(await w(treasury).sendTransaction({ to: user.address, value: parseEther("1") }));
  await wait(await w(treasury).writeContract({ address: a.CLDTokenV2, abi: erc20, functionName: "transfer", args: [user.address, cld * CLD] }));
  await wait(await w(user).writeContract({ address: a.CLDTokenV2, abi: erc20, functionName: "approve", args: [a.CloudanaSettlementV2, cld * CLD] }));
  await wait(await w(user).writeContract({ address: a.CloudanaSettlementV2, abi: settleAbi, functionName: "deposit", args: [cld * CLD] }));
  for (let i = 0; i < 2; i++) await pub.request({ method: "evm_mine" as any, params: [] as any });
}

if (process.argv[1]?.endsWith("user.ts")) {
  const token = await signIn(user);
  const balance = async () => (await api<{ balanceUcld: number }>("/v1/account", { token })).body.balanceUcld;
  const topUp = async (cld: bigint) => {
    const before = await balance();
    await fund(cld);
    await until(async () => (await balance()) >= before + Number(cld) * 1e6, "the deposit to be credited", 180_000, 2000);
    log("user", `balance ${(await balance()) / 1e6} CLD`);
  };
  if ((await balance()) < 50e6) await topUp(200n);

  const open = new Map<string, { label: string; workType: string; priceUcld: number; t0: number }>();
  let done = 0, failed = 0;
  const poll = async () => {
    for (const [id, j] of open) {
      const r = await api<{ job: any }>(`/v1/jobs/${id}`, { token });
      const job = r.body?.job;
      if (!job || !["done", "failed", "clawed"].includes(job.status)) continue;
      open.delete(id);
      job.status === "done" ? done++ : failed++;
      appendFileSync(OUT, JSON.stringify({
        id, label: j.label, workType: j.workType, n: job.n, priceUcld: j.priceUcld, status: job.status, node: job.node,
        submittedAt: j.t0, assignedAt: job.assignedAt, completedAt: job.completedAt,
        sampled: job.certificate?.z ? undefined : undefined, clusterOk: job.certificate?.clusterOk ?? null,
      }) + "\n");
      if (job.status !== "done") log("user", `${j.label} ${id} ${job.status} (node ${job.node})`);
    }
  };

  log("user", `submitting ${JOBS} jobs at ${RATE}/min, mix ${MIX.join(" ")}, seed ${seed} → ${OUT}`);
  const interval = 60_000 / RATE;
  for (let i = 0; i < JOBS; i++) {
    if ((await balance()) < 20e6) await topUp(200n);
    const j = makeJob(MIX[i % MIX.length]);
    const { label, ...body } = j;
    const r = await api<{ jobId: string; priceUcld: number }>("/v1/jobs", { token, json: { ...body, public: true } });
    if (r.status !== 200) {
      log("user", `POST /v1/jobs ${label}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
      await sleep(interval);
      continue;
    }
    open.set(r.body.jobId, { label, workType: j.workType, priceUcld: r.body.priceUcld, t0: Date.now() });
    if (i % 10 === 9) log("user", `${i + 1} submitted · ${done} done · ${failed} failed · ${open.size} open`);
    await poll();
    await sleep(interval);
  }
  const t = Date.now();
  while (open.size && Date.now() - t < 600_000) {
    await sleep(2000);
    await poll();
  }
  log("user", `finished: ${done} done, ${failed} failed, ${open.size} never finished`);
}
