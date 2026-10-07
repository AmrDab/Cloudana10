/**
 * One keeper pass (IMPL_SPEC_2026-10 "Keeper"). Stateless: every decision is taken from the API payloads and the
 * on-chain epoch status read in this pass, so a re-run after any failure continues where it stopped.
 *
 *   close -> for each closed|posted epoch:
 *     rebuild tree, require root == payload.root (else skip + log)
 *     None/Vetoed  : postEpoch (not a vetoed root again), then API /posted
 *     Posted       : (API still "closed" -> /posted) ; after the veto window finalize
 *     Finalized    : claimFor lane A (+ lane B once vested) in chunks; when every lane is paid or void -> API /settled
 *
 * /settled is only sent once lane B is vested and claimed (or void / zero): the API has no state between
 * "finalized, lane A paid" and "lane B paid", and a settled epoch is no longer listed, so settling earlier would
 * orphan lane B. On testnet (vest 1 h) that is one extra cron cycle.
 */
import { zeroHash, type Address, type Hex } from "viem";
import type { Api, EpochPayload } from "./api";
import type { Chain, ClaimEntry } from "./chain";
import { EpochStatus, FLAG_A_CLAIMED, FLAG_B_CLAIMED, FLAG_B_VOID } from "./abi";
import { buildTree, sumLanes, toWei } from "./tree";

/** EIP-7825 caps a tx at 2^24 gas; a cold lane-A leaf costs ~62k, so 250 leaves (~15.5M) fit with margin. */
export const DEFAULT_CLAIM_CHUNK = 250;

export type Logger = (msg: string, data?: Record<string, unknown>) => void;

export type Deps = {
  api: Api;
  chain: Chain;
  log: Logger;
  claimChunk?: number;
};

export type EpochOutcome =
  | { epoch: number; action: "posted"; txHash: Hex }
  | { epoch: number; action: "finalized"; txHash: Hex; claims: number; settled: boolean }
  | { epoch: number; action: "claimed"; claims: number; settled: boolean; txHash?: Hex }
  | { epoch: number; action: "settled"; txHash: Hex }
  | { epoch: number; action: "marked-posted" | "marked-vetoed" }
  | { epoch: number; action: "waiting"; reason: string }
  | { epoch: number; action: "skipped"; reason: string }
  | { epoch: number; action: "error"; error: string };

export type RunSummary = {
  startedAt: string;
  finishedAt: string;
  closedNow: number;
  epochs: EpochOutcome[];
};

const chunk = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

export async function runOnce(deps: Deps): Promise<RunSummary> {
  const startedAt = new Date().toISOString();
  const { api, log } = deps;
  const closedNow = await api.close();
  log("closed epochs", { count: closedNow.length, epochs: closedNow.map((e) => e.epoch) });

  // Re-read everything the API still considers open (stateless; `close` output is a subset of `closed`).
  const [closed, posted] = await Promise.all([api.list("closed"), api.list("posted")]);
  const byEpoch = new Map<number, EpochPayload>();
  for (const p of [...closedNow, ...closed, ...posted]) byEpoch.set(p.epoch, p);
  const payloads = [...byEpoch.values()].sort((a, b) => a.epoch - b.epoch);

  const epochs: EpochOutcome[] = [];
  for (const p of payloads) {
    try {
      const out = await processEpoch(deps, p);
      epochs.push(out);
      log(`epoch ${p.epoch}: ${out.action}`, out as unknown as Record<string, unknown>);
    } catch (e: any) {
      const error = e?.shortMessage ?? e?.message ?? String(e);
      epochs.push({ epoch: p.epoch, action: "error", error });
      log(`epoch ${p.epoch}: error`, { error });
    }
  }
  return { startedAt, finishedAt: new Date().toISOString(), closedNow: closedNow.length, epochs };
}

export async function processEpoch(deps: Deps, p: EpochPayload): Promise<EpochOutcome> {
  const { api, chain, log } = deps;
  const epoch = BigInt(p.epoch);
  if (!p.leaves?.length) return { epoch: p.epoch, action: "skipped", reason: "no leaves" };

  const tree = buildTree(epoch, p.leaves);
  if (tree.root.toLowerCase() !== String(p.root).toLowerCase()) {
    log(`epoch ${p.epoch}: ROOT MISMATCH, not posting`, { apiRoot: p.root, rebuilt: tree.root, leaves: p.leaves.length });
    return { epoch: p.epoch, action: "skipped", reason: `root mismatch (api ${p.root}, rebuilt ${tree.root})` };
  }
  const totals = {
    totalLaneA: toWei(p.totalLaneAUcld),
    totalLaneB: toWei(p.totalLaneBUcld),
    treasuryAmount: toWei(p.treasuryUcld),
    feesBurned: toWei(p.feesBurnedUcld),
  };
  const sums = sumLanes(tree.leaves);
  if (sums.laneA !== totals.totalLaneA || sums.laneB !== totals.totalLaneB) {
    return {
      epoch: p.epoch, action: "skipped",
      reason: `leaf sums (${sums.laneA}/${sums.laneB}) != totals (${totals.totalLaneA}/${totals.totalLaneB})`,
    };
  }

  let on = await chain.getEpoch(epoch);
  const params = await chain.getParams();
  const now = await chain.now();

  // ---- not live on-chain: post ----
  if (on.status === EpochStatus.None || on.status === EpochStatus.Vetoed) {
    // Vetoed on-chain with this root: tell the API whatever it thinks (a missed /posted leaves it
    // 'closed'), so it re-closes with a corrected root. Never re-post the identical vetoed root.
    if (on.status === EpochStatus.Vetoed && on.root.toLowerCase() === tree.root.toLowerCase()) {
      await api.vetoed(p.epoch, "vetoed on-chain; re-close with a corrected root");
      return { epoch: p.epoch, action: "marked-vetoed" };
    }
    if (p.status === "posted") {
      return { epoch: p.epoch, action: "skipped", reason: "API says posted but nothing is on-chain (wrong contract or chain?)" };
    }
    if (epoch < params.genesisEpoch) {
      return { epoch: p.epoch, action: "skipped", reason: `epoch is before the contract's genesis epoch ${params.genesisEpoch} (set GENESIS_TIMESTAMP earlier at deploy)` };
    }
    const endsAt = (epoch + 1n) * params.epochSeconds;
    if (now < endsAt) return { epoch: p.epoch, action: "waiting", reason: `epoch ends at ${endsAt}, chain time ${now}` };
    const available = await chain.getEscrowAvailable();
    if (totals.feesBurned > available) {
      return { epoch: p.epoch, action: "skipped", reason: `fees ${totals.feesBurned} exceed free escrow ${available}` };
    }
    const allowance = await chain.getAllowance(epoch);
    if (totals.totalLaneB > allowance) {
      return { epoch: p.epoch, action: "skipped", reason: `lane B ${totals.totalLaneB} exceeds allowance ${allowance}` };
    }
    const txHash = await chain.postEpoch({ epoch, root: tree.root, ...totals });
    await api.posted(p.epoch, tree.root, txHash);
    return { epoch: p.epoch, action: "posted", txHash };
  }

  // ---- live on-chain: the API must agree on the root ----
  if (on.root.toLowerCase() !== tree.root.toLowerCase()) {
    log(`epoch ${p.epoch}: on-chain root differs from the API's leaves`, { onChain: on.root, api: tree.root });
    return { epoch: p.epoch, action: "skipped", reason: `on-chain root ${on.root} != api root ${tree.root}` };
  }
  if (p.status === "closed") {
    // the previous pass posted but failed to tell the API
    const tx = (await chain.findPostTx(epoch)) ?? zeroHash;
    await api.posted(p.epoch, tree.root, tx);
    log(`epoch ${p.epoch}: marked posted after the fact`, { tx });
  }

  let finalizeTx: Hex | undefined;
  if (on.status === EpochStatus.Posted) {
    const opensAt = on.postedAt + params.vetoDelaySeconds;
    if (now < opensAt) return { epoch: p.epoch, action: "waiting", reason: `veto window open until ${opensAt}, chain time ${now}` };
    finalizeTx = await chain.finalize(epoch);
    on = await chain.getEpoch(epoch);
  }

  // ---- finalized: claims ----
  const claimed = await claimAll(deps, epoch, tree, on.finalizedAt + params.vestBSeconds);
  if (claimed.done) {
    const tx = claimed.lastTx ?? finalizeTx ?? (await chain.findPostTx(epoch)) ?? zeroHash;
    await api.settled(p.epoch, tx);
  }
  if (finalizeTx) return { epoch: p.epoch, action: "finalized", txHash: finalizeTx, claims: claimed.count, settled: claimed.done };
  if (claimed.count === 0 && !claimed.done) {
    return { epoch: p.epoch, action: "waiting", reason: `lane A paid; lane B vests at ${on.finalizedAt + params.vestBSeconds}` };
  }
  return { epoch: p.epoch, action: "claimed", claims: claimed.count, settled: claimed.done, txHash: claimed.lastTx };
}

async function claimAll(deps: Deps, epoch: bigint, tree: ReturnType<typeof buildTree>, vestsAt: bigint) {
  const { chain, log } = deps;
  const now = await chain.now();
  const vested = now >= vestsAt;
  const accounts = tree.leaves.map((l) => l.account) as Address[];
  const flags = await chain.getLaneFlags(epoch, accounts);

  const entries: ClaimEntry[] = [];
  let stillVesting = 0;
  tree.leaves.forEach((l, i) => {
    const f = flags[i];
    const needA = l.laneA > 0n && (f & FLAG_A_CLAIMED) === 0;
    const bOpen = l.laneB > 0n && (f & (FLAG_B_CLAIMED | FLAG_B_VOID)) === 0;
    if (needA || (bOpen && vested)) entries.push({ account: l.account, laneA: l.laneA, laneB: l.laneB, proof: tree.proofs[i] });
    if (bOpen && !vested) stillVesting++;
  });

  let lastTx: Hex | undefined;
  let count = 0;
  for (const part of chunk(entries, deps.claimChunk ?? DEFAULT_CLAIM_CHUNK)) {
    lastTx = await chain.claimFor(epoch, part);
    count += part.length;
    log(`epoch ${epoch}: claimFor ${part.length} leaves`, { tx: lastTx, vested });
  }
  // After this pass every lane is paid or void, unless some lane B is still vesting.
  const done = stillVesting === 0;
  return { count, lastTx, done };
}
