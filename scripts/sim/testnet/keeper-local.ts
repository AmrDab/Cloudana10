/**
 * The production keeper's pass (keeper/src/run.ts), on a 10 s timer against the local API and chain instead of a
 * Worker cron. Same code path: close → post root → finalize after the veto window → claimFor → settled.
 *   npx tsx scripts/sim/testnet/keeper-local.ts
 */
import { createApi } from "../../../keeper/src/api";
import { createChain } from "../../../keeper/src/chain";
import { runOnce } from "../../../keeper/src/run";
import { API, CHAIN_ID, INTERNAL_KEY, POSTER_KEY, RPC, addresses, nowIso, sleep } from "./common.ts";

const INTERVAL_MS = Number(process.env.KEEPER_INTERVAL_MS ?? 10_000);
const a = addresses();
const api = createApi(API, INTERNAL_KEY);
const chain = createChain({ rpcUrl: RPC, chainId: CHAIN_ID, settlement: a.CloudanaSettlementV2, posterKey: POSTER_KEY });
const log = (msg: string, data?: Record<string, unknown>) =>
  console.log(JSON.stringify({ ts: nowIso(), msg, ...(data ?? {}) }, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

log("keeper up", { api: API, settlement: a.CloudanaSettlementV2, genesisEpoch: a.genesisEpoch });
for (;;) {
  try {
    // Hardhat mines only on transactions; the veto and vest windows are judged by block time, so stand in for block
    // production: one empty block per pass (a real chain advances on its own).
    await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "evm_mine", params: [] }) });
    const r = await runOnce({ api, chain, log });
    for (const e of r.epochs) if (e.action !== "waiting") log("epoch", e as unknown as Record<string, unknown>);
  } catch (e: any) {
    log("run failed", { error: e?.message ?? String(e) });
  }
  await sleep(INTERVAL_MS);
}
