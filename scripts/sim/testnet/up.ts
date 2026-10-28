/**
 * Bring up the testnet-in-a-box (docs/POUW_SIMULATION_PLAN.md §3) on 127.0.0.1:
 *   API (client/api Node runtime, SQLite, :8791) · 3 real node agents, each bound to its own payout wallet ·
 *   the keeper pass on a 10 s timer. The hardhat chain must already run on :8545 with the v2 contracts deployed
 *   (contract/scripts/v2/deploy.ts --network localhost → shared/addresses.localhost.json).
 *   npx tsx scripts/sim/testnet/up.ts        stop: npx tsx scripts/sim/testnet/down.ts
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import {
  API, API_PORT, EPOCH_SECONDS, INSTRUCTION_KEY, INTERNAL_KEY, JWT_SECRET, PROVIDERS, ROOT, RPC, RUN,
  addresses, api, log, sleep, until, wallet,
} from "./common.ts";

/** Exactly what POST /v1/nodes/bind verifies (client/api/src/services/nodes.service.ts bindingMessage). */
const bindingMessage = (node: string, payout: string, issuedIso: string) =>
  `Cloudana node binding\nNode: ${node.toLowerCase()}\nPayout: ${payout.toLowerCase()}\nIssued: ${issuedIso}`;

const PIDS = path.join(RUN, "pids");
if (existsSync(PIDS)) throw new Error(`${PIDS} exists: run down.ts first`);
if (await fetch(`${API}/health`).then(() => true, () => false)) throw new Error(`${API} already answers: stop it first`);
writeFileSync(PIDS, "");

function start(name: string, args: string[], cwd: string, env: Record<string, string>): void {
  const out = openSync(path.join(RUN, `${name}.log`), "a");
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", out, out] });
  appendFileSync(PIDS, `${name} ${child.pid}\n`);
  child.unref();
  log("up", `started ${name} (pid ${child.pid}, log .dev-run-sim/${name}.log)`);
}

const a = addresses();
const signer = privateKeyToAccount(INSTRUCTION_KEY).address;

// ── API ─────────────────────────────────────────────────────────────────────────────────────────────────────────
start("api", ["--import", "tsx", "src/index.ts"], path.join(ROOT, "client/api"), {
  PORT: String(API_PORT),
  JWT_SECRET,
  INTERNAL_API_KEY: INTERNAL_KEY,
  INSTRUCTION_SIGNING_KEY: INSTRUCTION_KEY,
  DEV_MODE: "true",
  EPOCH_SECONDS: String(EPOCH_SECONDS),
  VEST_B_SECONDS: "60",
  PAY_HOLD_SECONDS: String(EPOCH_SECONDS),
  VERIFY_SAMPLE_K: process.env.VERIFY_SAMPLE_K ?? "10",
  VERIFY_WARMUP_JOBS: process.env.VERIFY_WARMUP_JOBS ?? "10",
  PROTOCOL_WORK: process.env.PROTOCOL_WORK ?? "off",
  SUBSIDY_RHO: "0.04",
  CLUSTER_N_MIN: "3",
  USD_PER_CLD: "0.1",
  CHAIN_RPC_URL: RPC,
  SETTLEMENT_ADDRESS: a.CloudanaSettlementV2,
  DEPOSIT_CONFIRMATIONS: "1",
  DEPOSIT_WATCHER_START_BLOCK: "0",
  NODE_ACTIVE_SECONDS: "45",
  CLOUDANA_DB_PATH: path.join(RUN, "sim.sqlite"),
});
await until(() => fetch(`${API}/health`).then((r) => r.ok, () => false), "the API", 90_000);
const key = await api<{ signer?: string }>("/v1/nodes/instruction-key");
if (key.status !== 200 || key.body?.signer?.toLowerCase() !== signer.toLowerCase()) {
  throw new Error(`instruction key: ${key.status} ${JSON.stringify(key.body)} (expected ${signer})`);
}
log("up", `API ready, instruction signer ${signer}`);

// ── Node agents ─────────────────────────────────────────────────────────────────────────────────────────────────
for (const p of PROVIDERS) {
  start(`agent-${p}`, ["--import", "tsx", "src/index.ts", "--api", API, "--name", `sim-${p}`, "--site", "http://127.0.0.1:7003"], path.join(ROOT, "node-agent"), {
    CLOUDANA_INSTRUCTION_SIGNER: signer,
  });
}

// Bind each agent to its own payout wallet (the console's /control/provide flow, done with the wallet's signature).
for (const p of PROVIDERS) {
  const logFile = path.join(RUN, `agent-${p}.log`);
  const m = await until(() => {
    const text = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
    return /node=(0x[0-9a-fA-F]{40})&code=([0-9a-f]{16})/.exec(text) ?? (/Joined fleet|earnings go to|bound to/.test(text) ? ["", "", ""] : null);
  }, `agent-${p}'s bind link`, 120_000);
  if (!m[1]) {
    log("up", `agent-${p} is already bound`);
    continue;
  }
  const [, node, code] = m;
  const payout = wallet(`provider-${p}`);
  const message = bindingMessage(node, payout.address, new Date().toISOString());
  const signature = await payout.signMessage({ message });
  const r = await api("/v1/nodes/bind", { json: { node, payout: payout.address, message, signature, code } });
  if (r.status !== 200) throw new Error(`bind agent-${p}: ${r.status} ${JSON.stringify(r.body)}`);
  log("up", `agent-${p} ${node} → payout ${payout.address}`);
}

// ── Keeper ──────────────────────────────────────────────────────────────────────────────────────────────────────
start("keeper", ["--import", "tsx", "scripts/sim/testnet/keeper-local.ts"], ROOT, {});

await sleep(1000);
const net = await api<any>("/v1/network");
log("up", `network: ${JSON.stringify(net.body?.data ?? net.body).slice(0, 300)}`);
log("up", "ready");
