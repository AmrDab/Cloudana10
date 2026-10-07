/**
 * Deposit watcher — credits escrow deposits made to the v2 Settlement contract.
 *
 * The Settlement emits `Deposited(address indexed from, address indexed user, uint256 amount)`
 * for `deposit()` / `depositFor()`. On each cron run this reads the logs since a
 * stored block cursor, credits `user` with amount / 1e12 µCLD (1 CLD = 1e18 wei =
 * 1e6 µCLD), and advances the cursor. Each log is credited at most once: a
 * `processed_tx` row keyed `${txHash}:${logIndex}` lands in the same transactional
 * batch as the credit. Only blocks DEPOSIT_CONFIRMATIONS behind the head are scanned.
 *
 * Inactive unless SETTLEMENT_ADDRESS and CHAIN_RPC_URL are set. The cursor
 * starts at the chain head on first run (no backfill) unless
 * DEPOSIT_WATCHER_START_BLOCK is given. Storage (D1 + KV) must be initialised
 * by the caller — the Worker's scheduled handler, which integration wires.
 */
import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { log } from "../lib/logger.js";
import { getD1, getKV } from "../lib/storage.js";
import { getEnv, resetEnv } from "../config/env.js";
import { creditBalanceStatements, UCLD_PER_CLD } from "./balance.service.js";

const L = log.api;

export const DEPOSITED_EVENT = parseAbiItem("event Deposited(address indexed from, address indexed user, uint256 amount)");
export const DEPOSIT_CURSOR_KEY = "deposit-watcher:cursor";
/** Public RPCs cap eth_getLogs ranges; stay well under and catch up over several runs. */
export const MAX_BLOCKS_PER_RUN = 2000n;
const WEI_PER_UCLD = 10n ** 12n;

export interface DepositLog {
  txHash: string;
  logIndex: number;
  from: string;
  user: string;
  amountWei: bigint;
  blockNumber: bigint;
}

/** The two chain reads the watcher needs; injectable so tests run without an RPC. */
export interface DepositSource {
  latestBlock(): Promise<bigint>;
  deposits(fromBlock: bigint, toBlock: bigint): Promise<DepositLog[]>;
}

export interface DepositWatcherEnv {
  SETTLEMENT_ADDRESS?: string;
  CHAIN_RPC_URL?: string;
  /** Optional first block to scan on the very first run (otherwise: the current head). */
  DEPOSIT_WATCHER_START_BLOCK?: string;
}

export interface DepositWatcherResult {
  active: boolean;
  credited: number;
  /** Last scanned block, or null when inactive. */
  cursor: string | null;
}

export function viemDepositSource(rpcUrl: string, settlement: Address): DepositSource {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return {
    latestBlock: () => client.getBlockNumber(),
    async deposits(fromBlock, toBlock) {
      const logs = await client.getLogs({ address: settlement, event: DEPOSITED_EVENT, fromBlock, toBlock });
      return logs
        .filter((l) => l.transactionHash && l.logIndex !== null && l.blockNumber !== null)
        .map((l) => ({
          txHash: l.transactionHash as string,
          logIndex: l.logIndex as number,
          from: l.args.from as string,
          user: l.args.user as string,
          amountWei: l.args.amount as bigint,
          blockNumber: l.blockNumber as bigint,
        }));
    },
  };
}

/**
 * Credit one Deposited log. Returns true when a credit was made, false when
 * the log was already processed or rounds to zero µCLD. Throws on storage
 * failure so the caller does not advance the cursor past it.
 */
export async function creditDeposit(d: DepositLog): Promise<boolean> {
  const ucld = Number(d.amountWei / WEI_PER_UCLD);
  if (ucld <= 0) return false;

  const db = getD1();
  const key = `${d.txHash.toLowerCase()}:${d.logIndex}`;
  const seen = await db.prepare("SELECT tx_hash FROM processed_tx WHERE tx_hash = ?").bind(key).first();
  if (seen) return false;

  const user = d.user.toLowerCase();
  const cld = ucld / UCLD_PER_CLD;
  const now = new Date();
  const { statements } = creditBalanceStatements(user, cld, "crypto", now, {
    txHash: d.txHash,
    logIndex: d.logIndex,
    from: d.from.toLowerCase(),
    amountWei: d.amountWei.toString(),
    blockNumber: d.blockNumber.toString(),
    source: "settlement_deposit",
  });
  // Marker, balance credit and transaction row in one transactional batch: either all land or none does. A
  // concurrent run that already inserted the marker fails the primary key here, which rolls the whole batch back.
  await db.batch([
    db.prepare("INSERT INTO processed_tx (tx_hash, sender, amount, processed_at) VALUES (?, ?, ?, ?)").bind(key, user, cld, now.toISOString()),
    ...statements,
  ]);
  L.info(`[Deposits] Credited ${cld} CLD to ${user} (tx ${d.txHash} log ${d.logIndex})`);
  return true;
}

/**
 * One watcher pass against an injected source. The cursor is the last scanned block. Only blocks at least
 * DEPOSIT_CONFIRMATIONS behind the head are scanned, so a log in a block that is later reorged out is never credited.
 */
export async function runDepositWatcher(source: DepositSource, startBlock?: bigint): Promise<DepositWatcherResult> {
  const kv = getKV();
  const head = await source.latestBlock();
  const confirmations = BigInt(getEnv().DEPOSIT_CONFIRMATIONS);
  const latest = head > confirmations ? head - confirmations : 0n;
  const stored = await kv.get(DEPOSIT_CURSOR_KEY);

  let cursor: bigint;
  if (stored) {
    cursor = BigInt(stored);
  } else {
    // First run: no backfill unless a start block was configured.
    cursor = startBlock !== undefined ? startBlock - 1n : latest;
    await kv.put(DEPOSIT_CURSOR_KEY, cursor.toString());
  }

  const from = cursor + 1n;
  if (from > latest) return { active: true, credited: 0, cursor: cursor.toString() };
  const to = latest - from + 1n > MAX_BLOCKS_PER_RUN ? from + MAX_BLOCKS_PER_RUN - 1n : latest;

  const logs = await source.deposits(from, to);
  let credited = 0;
  for (const d of logs) if (await creditDeposit(d)) credited++;

  await kv.put(DEPOSIT_CURSOR_KEY, to.toString());
  if (logs.length) L.info(`[Deposits] blocks ${from}-${to}: ${logs.length} log(s), ${credited} credited`);
  return { active: true, credited, cursor: to.toString() };
}

/**
 * Cron entry point. Inactive (no chain call) unless SETTLEMENT_ADDRESS and
 * CHAIN_RPC_URL are set. Reads the Worker env when given (and copies its strings into process.env so getEnv()
 * sees DEPOSIT_CONFIRMATIONS in a fresh isolate), else process.env.
 */
export async function runDepositWatcherCron(env?: DepositWatcherEnv): Promise<DepositWatcherResult> {
  const e = env ?? (process.env as DepositWatcherEnv);
  if (env) {
    let changed = false;
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string" && process.env[key] !== value) {
        process.env[key] = value;
        changed = true;
      }
    }
    if (changed) resetEnv();
  }
  const settlement = e.SETTLEMENT_ADDRESS?.trim();
  const rpcUrl = e.CHAIN_RPC_URL?.trim();
  if (!settlement || !rpcUrl || !/^0x[0-9a-fA-F]{40}$/.test(settlement)) {
    return { active: false, credited: 0, cursor: null };
  }
  const start = e.DEPOSIT_WATCHER_START_BLOCK ? BigInt(e.DEPOSIT_WATCHER_START_BLOCK) : undefined;
  return runDepositWatcher(viemDepositSource(rpcUrl, settlement as Address), start);
}
