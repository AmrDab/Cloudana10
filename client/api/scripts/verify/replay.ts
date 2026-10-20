/**
 * Check what the orchestrator published without trusting it (DECENTRALIZATION_ROADMAP.md phase 1).
 *
 *   npx tsx scripts/verify/replay.ts --api https://api.cloudana.io --job <jobId>
 *   npx tsx scripts/verify/replay.ts --api https://api.cloudana.io --epoch <n>
 *   npx tsx scripts/verify/replay.ts --api https://api.cloudana.io --epoch <n> --job <jobId>
 *   … [--signer 0x… | published] [--rpc https://sepolia.base.org] [--seed-window 60]
 *
 * Signatures are checked against a PINNED signer (the node agents' default, node-agent/src/instructions.ts), never
 * against a key the server being checked hands out; `--signer 0x…` pins another address, `--signer published`
 * trusts the server's /v1/nodes/instruction-key (local stacks only — that is not a proof). With --rpc, a seed that
 * claims to be a block hash is looked up on that chain (eth_getBlockByHash) and its timestamp must fall within
 * --seed-window seconds (60) before the assignment: a block from long before could have been picked for its hash.
 * What this still cannot see: an assignment that expired and was re-drawn (the earlier draw is not kept) — B-17.
 *
 * For a job: recompute drawSeed = sha256(seedSource ‖ jobId), the eligible-set hash, and the weighted draw; report
 * whether seedSource is a chain block hash (a third party can check that on Base) or the flagged local fallback.
 * For an epoch: recompute the Merkle root from the published leaves (what the keeper posts and the contract keeps),
 * check lane totals against the leaves, the fee split against the contract's bounds, that the public job list's fees
 * add up to feesBurned and its lanes to the leaves, and that the signature is by the published instruction key.
 * Exit code 0 only when every check passes. Needs only the public API; nothing here signs or writes.
 */
import { eligibleHash, replayDraw, sha256, weightedDraw, type PublicCandidate } from "../../src/services/jobs.service.js";
import { DEFAULT_INSTRUCTION_SIGNER } from "../../../../node-agent/src/instructions.ts";
import { epochRoot } from "../../src/services/epoch-merkle.js";
import { verifyPublic, type PublicSignature } from "../../src/services/public-signing.service.js";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) args.set(a.slice(2), process.argv[i + 1]?.startsWith("--") ? "true" : (process.argv[++i] ?? "true"));
}
const API = (args.get("api") ?? process.env.API ?? "https://api.cloudana.io").replace(/\/+$/, "");
const RPC = args.get("rpc");
const SIGNER_ARG = args.get("signer");
const SEED_WINDOW_SEC = Number(args.get("seed-window") ?? 60);
/** Slack after assignedAt: the server stamps it before fetching the latest block (Base mints one every 2 s). */
const SEED_SKEW_SEC = 10;
if (SIGNER_ARG === "true" || (SIGNER_ARG !== undefined && SIGNER_ARG !== "published" && !/^0x[0-9a-fA-F]{40}$/.test(SIGNER_ARG))) {
  console.error("--signer takes an address (0x…) or the literal `published`; a bare --signer would silently trust the server's key");
  process.exit(2);
}
const JOB = args.get("job");
const EPOCH = args.get("epoch");
if ((!JOB && !EPOCH) || JOB === "true" || EPOCH === "true" || (EPOCH !== undefined && !/^\d+$/.test(EPOCH))) {
  console.error("usage: replay.ts --api <url> [--job <jobId>] [--epoch <n>] [--signer <0x…|published>] [--rpc <url>]");
  process.exit(2);
}

let failures = 0;
const check = (ok: boolean, label: string, detail?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && detail !== undefined ? ` ${JSON.stringify(detail)}` : ""}`);
};
async function get(path: string): Promise<any> {
  const res = await fetch(`${API}${path}`, { headers: { accept: "application/json" } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status} ${JSON.stringify(body)}`);
  return body;
}
const signedBody = ({ status: _s, signature: _g, ...body }: Record<string, unknown>) => body;

async function publishedSigner(): Promise<string | null> {
  try {
    return ((await get("/v1/nodes/instruction-key")) as { signer: string }).signer.toLowerCase();
  } catch {
    return null;
  }
}

let expectedSigner: string | null | undefined;
/** The address every signature must come from: pinned, unless the caller chose to trust the server's own answer. */
async function pinnedSigner(): Promise<string | null> {
  if (expectedSigner !== undefined) return expectedSigner;
  const published = await publishedSigner();
  if (SIGNER_ARG === "published") {
    expectedSigner = published;
    console.log(`signer: trusting the server's published key ${published ?? "(none)"} (--signer published: fine for a local stack, not a proof)`);
  } else {
    expectedSigner = (SIGNER_ARG ?? DEFAULT_INSTRUCTION_SIGNER ?? "").toLowerCase() || null;
    console.log(`signer: pinned ${expectedSigner ?? "(none)"}; the server publishes ${published ?? "(none)"}${published && published !== expectedSigner ? " — DIFFERENT, its signatures will fail" : ""}`);
  }
  return expectedSigner;
}

async function checkSignature(label: string, json: Record<string, unknown>) {
  const signer = await pinnedSigner();
  const signature = json.signature as PublicSignature | null;
  if (!signature) {
    check(false, `${label}: unsigned (the API has no signing key) — cannot be proven later`);
    return;
  }
  check(await verifyPublic(signedBody(json), signature), `${label}: signature verifies over the published body`, signature);
  // No pin, no proof: a self-chosen signer must never pass when the expected key is unknown.
  check(signer !== null && signature.signer.toLowerCase() === signer, `${label}: signed by the pinned key ${signer ?? "(none)"}`, signature.signer);
}

async function rpcBlock(rpc: string, hash: string): Promise<{ number: string; timestamp: string } | null> {
  const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByHash", params: [hash, false] }) });
  const j = (await res.json()) as { result?: { number: string; timestamp: string } | null };
  return j.result ?? null;
}

async function replayJob(id: string) {
  const json = await get(`/v1/draws/${encodeURIComponent(id)}`);
  const { draw } = json;
  console.log(`job ${id}: ${draw.jobStatus}, node ${draw.node ?? "-"}, seed ${draw.seedSource ?? "-"}`);
  if (!draw.drawSeed) {
    check(false, "job has no draw yet (queued or failed)");
    return;
  }
  if (!draw.node) {
    // Jobs that failed before failed rows kept their node: the record says so (`replayable: false`), nothing to replay.
    // Only a failed job may lack its node, and the record must still be the orchestrator's (signed).
    check(draw.jobStatus === "failed" && draw.replayable === false, "no drawn node on record (failed before the record kept it): not replayable, and the record says so", draw.jobStatus);
    await checkSignature("draw", json);
    return;
  }
  const eligible = draw.eligible as PublicCandidate[] | null;
  check(!!eligible && eligible.length > 0, "eligible set published", eligible?.length);
  if (!eligible) return;
  const r = replayDraw({ jobId: draw.jobId, node: draw.node, seedSource: draw.seedSource, drawSeed: draw.drawSeed, eligibleHash: draw.eligibleHash, eligible });
  check(r.seedOk, `drawSeed = sha256(seedSource ‖ jobId) (${sha256(draw.seedSource + draw.jobId).slice(0, 12)}…)`);
  check(r.eligibleOk, `eligibleHash = sha256 of the sorted "address:weight" list (${eligibleHash(eligible).slice(0, 12)}…)`);
  check(r.drawOk, `node = weighted draw of drawSeed over the eligible set (${weightedDraw(draw.drawSeed, eligible)})`);
  const chainSeed = /^0x[0-9a-f]{64}$/i.test(draw.seedSource);
  check(chainSeed, chainSeed ? "seedSource is a block hash: confirm it on Base Sepolia (eth_getBlockByHash)" : "seedSource is the local fallback — the orchestrator could have chosen it", draw.seedSource);
  check(draw.replayable === (chainSeed && !!eligible), "record's own `replayable` flag agrees");
  if (chainSeed && RPC) {
    const block = await rpcBlock(RPC, draw.seedSource);
    check(!!block, block ? `seedSource is block ${parseInt(block.number, 16)} on the chain at --rpc` : "seedSource is not a block on the chain at --rpc", draw.seedSource);
    if (block && typeof draw.assignedAt === "number") {
      // The seed must be the chain's head at assignment, not a block chosen earlier for its hash. assignedAt is taken
      // before the seed is fetched, so a block minted in those few seconds is honest: SEED_SKEW_SEC of slack after it.
      const mintedAt = parseInt(block.timestamp, 16) * 1000;
      const lag = (draw.assignedAt - mintedAt) / 1000;
      check(lag >= -SEED_SKEW_SEC && lag <= SEED_WINDOW_SEC, `seed block minted ${lag.toFixed(0)} s before the assignment (within --seed-window ${SEED_WINDOW_SEC} s)`, { mintedAt: new Date(mintedAt).toISOString(), assignedAt: new Date(draw.assignedAt).toISOString() });
    }
  }
  // The record is signed: a mismatch here means the orchestrator did not publish this (what it does NOT prove: that
  // the eligible set was complete — it is attested, not committed before the seed).
  await checkSignature("draw", json);
}

async function replayEpoch(n: string) {
  const json = await get(`/v1/epochs/${n}`);
  const { epoch, root, leaves, feesBurnedUcld, totalLaneAUcld, totalLaneBUcld, treasuryUcld, epochStatus } = json;
  console.log(`epoch ${epoch}: ${epochStatus}, ${leaves.length} leaves, fees ${feesBurnedUcld} µCLD, A ${totalLaneAUcld}, B ${totalLaneBUcld}, treasury ${treasuryUcld}`);
  check(epochRoot(epoch, leaves).toLowerCase() === String(root).toLowerCase(), `Merkle root recomputed from the leaves = ${root}`);
  const sumA = leaves.reduce((t: number, l: any) => t + l.laneAUcld, 0);
  const sumB = leaves.reduce((t: number, l: any) => t + l.laneBUcld, 0);
  check(sumA === totalLaneAUcld && sumB === totalLaneBUcld, "lane totals equal the sum of the leaves", { sumA, sumB });
  check(treasuryUcld * 10_000 >= feesBurnedUcld * 300, "treasury ≥ 3 % of fees (contract TREASURY_MIN_BPS)");
  check((totalLaneAUcld + treasuryUcld) * 10_000 <= feesBurnedUcld * 9_800, "lane A + treasury ≤ 98 % of fees (contract LANE_A_MAX_BPS)");
  // The public job list must account for every µCLD of the epoch.
  let after: string | null = null;
  let fees = 0;
  const byProvider = new Map<string, { a: number; b: number }>();
  let pages = 0;
  do {
    const page = await get(`/v1/epochs/${n}/jobs?limit=500${after ? `&after=${encodeURIComponent(after)}` : ""}`);
    for (const j of page.jobs) {
      fees += j.feeUcld ?? 0;
      if (j.provider) {
        const p = byProvider.get(j.provider) ?? { a: 0, b: 0 };
        p.a += j.laneAUcld;
        p.b += j.laneBUcld;
        byProvider.set(j.provider, p);
      }
    }
    after = page.next;
    pages++;
  } while (after && pages < 1000);
  check(fees === feesBurnedUcld, `the public job list's fees (${fees}) add up to feesBurned`);
  const leafMap = new Map(leaves.map((l: any) => [l.account, l]));
  let leavesMatch = byProvider.size === leafMap.size;
  for (const [acct, p] of byProvider) {
    const l = leafMap.get(acct) as any;
    if (!l || l.laneAUcld !== p.a || l.laneBUcld !== p.b) leavesMatch = false;
  }
  check(leavesMatch, "per-provider lanes in the job list equal the leaves", { providers: byProvider.size, leaves: leafMap.size });
  await checkSignature("epoch", json);
}

(async () => {
  const network = await get("/v1/network");
  await checkSignature("network", network);
  if (JOB) await replayJob(JOB);
  if (EPOCH) await replayEpoch(EPOCH);
  console.log(failures === 0 ? "REPLAY PASSED" : `REPLAY FAILED (${failures} check${failures === 1 ? "" : "s"})`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
