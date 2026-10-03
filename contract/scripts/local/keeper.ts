/**
 * LOCAL ONLY epoch keeper:  close -> build tree -> (dev) back escrow -> post -> wait veto -> finalize -> claimFor -> report.
 *   INTERNAL_API_KEY=... npx hardhat run scripts/local/keeper.ts --network localhost
 * Env: API (default http://127.0.0.1:8790), INTERNAL_API_KEY, KEEPER_ONCE=1 (single pass, for checks).
 * Trees live in memory: `/admin/epochs/close` returns an epoch's leaves only once, so the keeper must run
 * continuously between post and settle. If it restarts mid-epoch, that epoch must be re-closed by hand.
 * Vetoed epochs stay tracked: when the API re-closes one with a different root, the keeper re-posts it
 * (the contract allows re-posting a vetoed epoch); the same root again is logged and not re-posted.
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

const API = (process.env.API ?? "http://127.0.0.1:8790").replace(/\/$/, "");
const KEY = process.env.INTERNAL_API_KEY ?? "";
const ONCE = process.env.KEEPER_ONCE === "1";
const INTERVAL_MS = 10_000;
const UCLD_TO_WEI = 10n ** 12n;
const addrs = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../shared/addresses.local.json"), "utf8"));

type Leaf = { address: string; amountUcld: number | string };
type ClosedEpoch = { id: number; feesBurnedUcld: number | string; mintAUcld: number | string; mintBUcld: number | string; leaves: Leaf[] };
type Tracked = {
  tree: StandardMerkleTree<any[]>; mintA: bigint; mintB: bigint; fees: bigint; txHash: string;
  phase: "closed" | "posted-unreported" | "posted" | "settled-unreported" | "vetoed";
};

const tracked = new Map<number, Tracked>();
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);
const wei = (ucld: number | string) => BigInt(ucld) * UCLD_TO_WEI;

async function api(p: string, body: unknown = {}) {
  let res: Response;
  try {
    res = await fetch(`${API}/v1${p}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Key": KEY },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    throw new Error(`API unreachable at ${API} (${e.cause?.code ?? e.message})`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`API ${res.status} on POST /v1${p}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function main() {
  const [poster, treasury] = await ethers.getSigners();
  const token = await ethers.getContractAt("CLDToken", addrs.CLDToken);
  const settlement = await ethers.getContractAt("CloudanaSettlement", addrs.CloudanaSettlement);
  log(`keeper up: api=${API} settlement=${addrs.CloudanaSettlement} poster=${poster.address} veto=${addrs.vetoDelaySeconds}s${KEY ? "" : " (WARNING: INTERNAL_API_KEY unset)"}`);

  async function closeEpochs() {
    const { epochs = [] } = (await api("/admin/epochs/close")) as { epochs?: ClosedEpoch[] };
    for (const ep of epochs) {
      if (!ep.leaves?.length) { log(`epoch ${ep.id}: closed with no leaves, skipping`); continue; }
      const id = BigInt(ep.id);
      const tree = StandardMerkleTree.of(ep.leaves.map((l) => [id, l.address, wei(l.amountUcld)]), ["uint256", "address", "uint256"]);
      const [mintA, mintB, fees] = [wei(ep.mintAUcld), wei(ep.mintBUcld), wei(ep.feesBurnedUcld)];
      const prev = tracked.get(ep.id);
      if (prev?.phase === "vetoed") {
        if (prev.tree.root === tree.root) { log(`vetoed epoch ${ep.id} awaiting corrected close (API returned the vetoed root again)`); continue; }
        log(`vetoed epoch ${ep.id}: corrected close received, re-posting root=${tree.root} (vetoed root was ${prev.tree.root})`);
      } else if (prev) {
        log(`epoch ${ep.id}: already tracked (${prev.phase}), ignoring duplicate close`);
        continue;
      }
      const leafSum = ep.leaves.reduce((s, l) => s + wei(l.amountUcld), 0n);
      if (leafSum > mintA + mintB) log(`epoch ${ep.id}: WARNING leaves sum ${leafSum} > mintA+mintB ${mintA + mintB} (claims will hit the mint cap)`);
      log(`epoch ${ep.id}: tree built, ${ep.leaves.length} leaves, root=${tree.root}`);
      tracked.set(ep.id, { tree, mintA, mintB, fees, txHash: "", phase: "closed" });
    }
  }

  async function post(id: number, t: Tracked) {
    const available = (await settlement.totalEscrow()) - (await settlement.pendingBurn());
    if (t.fees > available) {
      const shortfall = t.fees - available;
      log(`epoch ${id}: DEV BACKING - treasury ${treasury.address} deposits ${ethers.formatEther(shortfall)} CLD into escrow (off-chain credits are not on-chain yet)`);
      await (await token.connect(treasury).approve(addrs.CloudanaSettlement, shortfall)).wait();
      await (await settlement.connect(treasury).depositFor(treasury.address, shortfall)).wait();
    }
    const tx = await settlement.postEpoch(id, t.tree.root, t.mintA, t.mintB, t.fees);
    await tx.wait();
    t.txHash = tx.hash;
    t.phase = "posted-unreported";
    log(`epoch ${id}: posted mintA=${ethers.formatEther(t.mintA)} mintB=${ethers.formatEther(t.mintB)} fees=${ethers.formatEther(t.fees)} tx=${tx.hash}`);
  }

  async function advance() {
    const now = Math.floor(Date.now() / 1000);
    for (const [id, t] of tracked) {
      if (t.phase === "closed") await post(id, t);
      if (t.phase === "posted-unreported") {
        await api(`/admin/epochs/${id}/posted`, { root: t.tree.root, txHash: t.txHash });
        t.phase = "posted";
        log(`epoch ${id}: reported posted`);
      }
      if (t.phase === "posted") {
        const e = await settlement.epochs(id);
        if (now < Number(e.postedAt) + addrs.vetoDelaySeconds) continue;
        if (e.status === 1n) {
          await (await settlement.finalize(id)).wait();
          log(`epoch ${id}: finalized, burned ${ethers.formatEther(e.feesBurned)} CLD`);
        } else if (e.status === 2n) {
          t.phase = "vetoed";
          log(`vetoed epoch ${id} awaiting corrected close (root ${t.tree.root} vetoed on-chain; not reported settled)`);
          continue;
        }
        const accounts: string[] = [], amounts: bigint[] = [], proofs: string[][] = [];
        for (const [i, v] of t.tree.entries()) {
          if (await settlement.claimed(await settlement.leafOf(v[0], v[1], v[2]))) continue;
          accounts.push(v[1]); amounts.push(v[2]); proofs.push(t.tree.getProof(i));
        }
        if (accounts.length) {
          const tx = await settlement.claimFor(id, accounts, amounts, proofs);
          await tx.wait();
          t.txHash = tx.hash;
          log(`epoch ${id}: claimFor minted to ${accounts.length} accounts tx=${tx.hash}`);
        }
        t.phase = "settled-unreported";
      }
      if (t.phase === "settled-unreported") {
        await api(`/admin/epochs/${id}/settled`, { txHash: t.txHash });
        tracked.delete(id);
        log(`epoch ${id}: reported settled`);
      }
    }
  }

  for (;;) {
    for (const step of [closeEpochs, advance]) {
      try { await step(); } catch (e: any) { log(`${step.name}: ${e.shortMessage ?? e.message}`); }
    }
    if (ONCE) return;
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
