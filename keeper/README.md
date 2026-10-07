# cloudana-keeper

Cloudflare Worker that settles `CloudanaSettlementV2` epochs. Cron every 5 minutes; the only HTTP route is `GET /health`.
Spec: `docs/IMPL_SPEC_2026-10.md` ("Keeper", "Admin epochs API", "Settlement contract v2").

## What one pass does

1. `POST {API_URL}/v1/admin/epochs/close` (header `x-internal-key`), then `GET /v1/admin/epochs?status=closed` and `?status=posted`.
2. For each epoch (oldest first):
   - rebuild the Merkle tree from `leaves` (µCLD × 1e12, OZ double-hash leaf `keccak256(bytes.concat(keccak256(abi.encode(epoch, account, laneA, laneB))))`, sorted leaves, sorted pairs) and require `root == payload.root` and leaf sums == totals — otherwise **skip and log** (nothing is sent on-chain);
   - read the epoch on-chain and act on that state only:
     - not posted / vetoed → pre-check free escrow and `allowance(epoch)`, `postEpoch`, then `POST .../posted`. A root that was vetoed on-chain is never re-posted; a `posted` API epoch that is vetoed on-chain gets `POST .../vetoed` so the API re-closes it;
     - posted → after `postedAt + vetoDelaySeconds`: `finalize`;
     - finalized → `claimFor` for every leaf with unclaimed lane A, plus lane B once `finalizedAt + vestBSeconds` has passed (clawed/void lane B is skipped), in chunks of `CLAIM_CHUNK` (default 250);
     - when every lane is paid or void → `POST .../settled`.
3. Everything is re-derived from the API + chain each pass, so a crash or a failed API callback is repaired on the next run (e.g. "posted on-chain but API still `closed`" → it re-sends `/posted` with the tx hash found in the `EpochPosted` logs).

`/settled` is sent only after lane B is claimed (or void / zero), because a settled epoch is no longer returned by the admin API and lane B would otherwise be orphaned. On testnet (1 h vest) that is one extra cron cycle after finalize.

`CLAIM_CHUNK=250`: a cold lane-A claim costs ~62k gas, and EIP-7825 caps one transaction at 2^24 = 16,777,216 gas (≈270 leaves). 250 leaves ≈ 15.5M.

## `GET /health`

```json
{
  "ok": true,
  "settlement": "0x…", "chainId": 84532,
  "posterBalanceEth": "0.0421",
  "unsettledEpochs": 1, "oldestUnsettledEpoch": 497812, "oldestUnsettledAgeSeconds": 1320,
  "lastRun": { "startedAt": "…", "finishedAt": "…", "closedNow": 1, "epochs": [{ "epoch": 497812, "action": "posted", "txHash": "0x…" }] },
  "lastError": null
}
```
`lastRun` is in-isolate memory (best effort); balance and oldest-unsettled age are computed live. 503 when the API or RPC is unreachable.

## Deploy (owner)

Prerequisites: `contract/scripts/v2/deploy.ts` has been run and `shared/addresses.baseSepolia.json` has a `v2` section; a **fresh** poster key (never the leaked 0xF292… key) funded with a little Base Sepolia ETH; `INTERNAL_API_KEY` equal to the API Worker's secret.

```sh
cd keeper
npm install
npm test                      # vitest: tree vector + orchestration

# vars (wrangler.toml [vars]; edit SETTLEMENT_ADDRESS to v2.CloudanaSettlementV2, or override per deploy):
#   API_URL=https://api.cloudana.io  RPC_URL=https://sepolia.base.org  SETTLEMENT_ADDRESS=0x…  CHAIN_ID=84532  CLAIM_CHUNK=250
npx wrangler secret put POSTER_PRIVATE_KEY   # 0x-prefixed secp256k1 key of POSTER_ADDRESS (holds POSTER_ROLE on the settlement)
npx wrangler secret put INTERNAL_API_KEY
npx wrangler deploy
curl https://cloudana-keeper.<account>.workers.dev/health
```

Local: `npx wrangler dev --test-scheduled` then `curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"` triggers one pass (needs `.dev.vars` with the two secrets).

Operations:
- Rotate the poster: admin Safe `grantRole(POSTER_ROLE, new)` / `revokeRole(POSTER_ROLE, old)` on the settlement, then `wrangler secret put POSTER_PRIVATE_KEY`.
- A skipped epoch with `root mismatch` means the API's persisted leaves no longer hash to the root it stored: nothing was posted; fix the ledger, `POST /vetoed` is not needed (it was never on-chain).
- After a guardian `veto(epoch)` on-chain the keeper calls `/vetoed`; the API re-closes the epoch. The same root is not re-posted — claw the offending entries (`/entries/:id/claw`) so the next close yields a corrected root.
- Low `posterBalanceEth` in `/health` → top up the poster.

## Layout

- `src/tree.ts` — Merkle (pure); tested against `test/fixtures/tree-vector.json`, which `contract/test/v2/gas-and-vector.test.ts` writes from Solidity `leafOf`, and against `@openzeppelin/merkle-tree`.
- `src/run.ts` — one pass (`runOnce`), dependency-injected (`Api`, `Chain`) so it is unit-tested with mocks.
- `src/chain.ts` — viem reads/writes (simulate → write → wait receipt). `src/api.ts` — admin API client. `src/index.ts` — Worker entry.
