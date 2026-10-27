/**
 * Phase 0 exit test (docs/POUW_SIMULATION_PLAN.md §3): one job of each work type goes
 *   deposit on-chain → credited → queued → assigned → verified → reward entries → epoch closed → root posted →
 *   finalized → claimFor
 * and each provider's ERC-20 balance on the local chain rises by exactly the µCLD the API booked (× 1e12).
 *   npx tsx scripts/sim/testnet/smoke.ts      (stack from up.ts must be running)
 */
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseEther, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { settlementAbi } from "../../../keeper/src/abi";
import { CHAIN_ID, PROVIDERS, RPC, TREASURY_KEY, addresses, api, log, signIn, sleep, until, wallet } from "./common.ts";

const chain = defineChain({ id: CHAIN_ID, name: "local", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function transfer(address, uint256) returns (bool)",
  "function approve(address, uint256) returns (bool)",
]);
const settleAbi = parseAbi(["function deposit(uint256)"]);
const a = addresses();
const CLD = 10n ** 18n;
const WEI_PER_UCLD = 10n ** 12n;
const treasury = privateKeyToAccount(TREASURY_KEY);
const user = wallet("user");
const payouts = PROVIDERS.map((p) => wallet(`provider-${p}`).address);

async function tx(acct: PrivateKeyAccount, args: Parameters<ReturnType<typeof createWalletClient>["writeContract"]>[0]): Promise<Hex> {
  const hash = await createWalletClient({ chain, transport: http(RPC), account: acct }).writeContract({ ...args, account: acct, chain } as any);
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}
const mine = async (n: number) => {
  for (let i = 0; i < n; i++) await pub.request({ method: "evm_mine" as any, params: [] as any });
};
const balanceOf = (addr: `0x${string}`) => pub.readContract({ address: a.CLDTokenV2, abi: erc20, functionName: "balanceOf", args: [addr] });
const totalSupply = () => pub.readContract({ address: a.CLDTokenV2, abi: erc20, functionName: "totalSupply" });

const rnd = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
const ints = (len: number, lo: number, hi: number) => Array.from({ length: len }, () => rnd(lo, hi));
const block = (d: number, h: number) => ({ W1: ints(d * h, -128, 127), b1: ints(h, -1000, 1000), W2: ints(h * d, -128, 127), b2: ints(d, -1000, 1000), m1: 1, s1: 8, m2: 1, s2: 8 });
const jobs = () => {
  const n = 64, b = 16, d = 64, h = 64;
  return [
    { workType: "matmul", n, matrixA: ints(n * n, -127, 127), matrixB: ints(n * n, -127, 127) },
    { workType: "int8-mlp", input: { b, d, h, X: ints(b * d, -128, 127), ...block(d, h) } },
    { workType: "int8-model", input: { b, d, h, X: ints(b * d, -128, 127), blocks: [block(d, h), block(d, h)] } },
  ];
};

// ── 1. The user buys CLD and escrows it; the deposit watcher credits the account ───────────────────────────────
const supply0 = await totalSupply();
const bal0 = Object.fromEntries(await Promise.all(payouts.map(async (p) => [p, await balanceOf(p)])));
log("smoke", `supply ${supply0 / CLD} CLD; provider balances ${payouts.map((p) => bal0[p] / CLD).join(", ")} CLD`);

const ethHash = await createWalletClient({ chain, transport: http(RPC), account: treasury }).sendTransaction({ to: user.address, value: parseEther("1") });
await pub.waitForTransactionReceipt({ hash: ethHash });
await tx(treasury, { address: a.CLDTokenV2, abi: erc20, functionName: "transfer", args: [user.address, 1000n * CLD] });
await tx(user, { address: a.CLDTokenV2, abi: erc20, functionName: "approve", args: [a.CloudanaSettlementV2, 100n * CLD] });
const depositAt = Date.now();
await tx(user, { address: a.CloudanaSettlementV2, abi: settleAbi, functionName: "deposit", args: [100n * CLD] });
await mine(2);
log("smoke", `user ${user.address} deposited 100 CLD into escrow`);

const token = await signIn(user);
const account = await until(async () => {
  const r = await api<{ balanceUcld: number }>("/v1/account", { token });
  return r.body?.balanceUcld >= 100_000_000 ? r.body : null;
}, "the deposit to be credited (deposit watcher, 60 s cron)", 180_000, 2000);
log("smoke", `credited ${account.balanceUcld / 1e6} CLD after ${((Date.now() - depositAt) / 1000).toFixed(0)} s`);

// ── 2. One job per work type ───────────────────────────────────────────────────────────────────────────────────
const submitted: { id: string; workType: string; priceUcld: number; t0: number }[] = [];
for (const j of jobs()) {
  const r = await api<{ jobId: string; priceUcld: number }>("/v1/jobs", { token, json: { ...j, public: true } });
  if (r.status !== 200) throw new Error(`POST /v1/jobs ${j.workType}: ${r.status} ${JSON.stringify(r.body)}`);
  submitted.push({ id: r.body.jobId, workType: j.workType, priceUcld: r.body.priceUcld, t0: Date.now() });
  log("smoke", `queued ${j.workType} ${r.body.jobId} price ${r.body.priceUcld} µCLD`);
}
const finished: Record<string, any> = {};
for (const s of submitted) {
  const job = await until(async () => {
    const r = await api<{ job: any }>(`/v1/jobs/${s.id}`, { token });
    return ["done", "failed", "clawed"].includes(r.body?.job?.status) ? r.body.job : null;
  }, `${s.workType} ${s.id} to finish`, 300_000, 1000);
  finished[s.id] = job;
  log("smoke", `${s.workType} ${s.id}: ${job.status} by ${job.node} in ${((job.completedAt - s.t0) / 1000).toFixed(1)} s (assigned after ${((job.assignedAt - s.t0) / 1000).toFixed(1)} s)`);
  if (job.status !== "done") throw new Error(`${s.workType} ${s.id} ended ${job.status}`);
}

// ── 3. What the ledger booked for the providers ────────────────────────────────────────────────────────────────
const expected: Record<string, bigint> = {};
const epochs = new Set<number>();
for (const p of payouts) {
  const r = await api<{ entries: { jobId: string; lane: string; amountUcld: number; epoch: number; status: string }[] }>(`/v1/ledger/${p}`);
  const mine_ = r.body.entries.filter((e) => submitted.some((s) => s.id === e.jobId));
  for (const e of mine_) {
    log("smoke", `ledger ${p.slice(0, 10)}… job ${e.jobId.slice(0, 8)} lane ${e.lane} ${e.amountUcld} µCLD epoch ${e.epoch} ${e.status}`);
    expected[p] = (expected[p] ?? 0n) + BigInt(e.amountUcld) * WEI_PER_UCLD;
    epochs.add(e.epoch);
  }
}
const expectedTotal = Object.values(expected).reduce((s, v) => s + v, 0n);
if (expectedTotal === 0n) throw new Error("no reward entries for the three jobs");

// ── 4. Settlement: the keeper closes, posts, finalizes and claims; balances must match exactly ─────────────────
log("smoke", `waiting for ${expectedTotal / WEI_PER_UCLD} µCLD to land on-chain (epochs ${[...epochs].join(", ")}; hold ${a.epochSeconds} s + close + 30 s veto + claim)`);
const t1 = Date.now();
const landed = await until(async () => {
  const bal = Object.fromEntries(await Promise.all(payouts.map(async (p) => [p, (await balanceOf(p)) - bal0[p]])));
  const total = Object.values(bal).reduce((s, v) => s + v, 0n);
  return total >= expectedTotal ? bal : null;
}, "the providers' on-chain balances", 900_000, 5000);
log("smoke", `landed after ${((Date.now() - t1) / 1000).toFixed(0)} s`);

let ok = true;
for (const p of payouts) {
  const got = landed[p] ?? 0n;
  const want = expected[p] ?? 0n;
  const match = got === want;
  ok &&= match;
  log("smoke", `${match ? "✓" : "✗"} ${p} on-chain +${got / WEI_PER_UCLD} µCLD, booked ${want / WEI_PER_UCLD} µCLD`);
}
const supply1 = await totalSupply();
let minted = 0n, burned = 0n;
for (const e of epochs) {
  const r = await pub.readContract({ address: a.CloudanaSettlementV2, abi: settlementAbi, functionName: "epochs", args: [BigInt(e)] });
  const [, , , treasuryAmount, feesBurned, mintedA, mintedB, , , status] = r as any;
  minted += mintedA + mintedB + treasuryAmount;
  burned += feesBurned;
  log("smoke", `epoch ${e}: status ${status} mintedA ${mintedA / WEI_PER_UCLD} mintedB ${mintedB / WEI_PER_UCLD} treasury ${treasuryAmount / WEI_PER_UCLD} feesBurned ${feesBurned / WEI_PER_UCLD} µCLD`);
}
const delta = supply1 - supply0;
const invariant = delta === minted - burned;
ok &&= invariant;
log("smoke", `${invariant ? "✓" : "✗"} supply ${delta >= 0n ? "+" : ""}${delta / WEI_PER_UCLD} µCLD = minted (A + B + treasury) ${minted / WEI_PER_UCLD} − fees burned ${burned / WEI_PER_UCLD} (per the epochs above)`);
log("smoke", ok ? "PHASE 0 PASSED" : "PHASE 0 FAILED");
process.exit(ok ? 0 : 1);
