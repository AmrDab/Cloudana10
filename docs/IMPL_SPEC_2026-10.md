# Implementation spec — testnet consensus build (October 2026)

Source of decisions: [DECISIONS_CONSENSUS.md](DECISIONS_CONSENSUS.md) (approved by the owner: "do all").
This file is the contract between workstreams. If you must deviate, write the deviation in your final report.

## Units
- Off-chain ledger: µCLD integers (1 CLD = 1e6 µCLD). On-chain: CLD wei (1 CLD = 1e18). Keeper converts µCLD × 1e12.
- Price: `PRICE_NCLD_PER_TMAC` (nano-CLD per tera-MAC, integer; launch 14000). Job fee in µCLD:
  `fee = BASE_FEE_UCLD + ceil(units_mac * PRICE_NCLD_PER_TMAC / 1e15)` where units_mac = n³ (matmul) — 1e15 = 1e12 (MAC per TMAC) × 1e3 (nCLD per µCLD). `BASE_FEE_UCLD` default 1000.
- Hosting/container/workstation hourly prices stay in µCLD/h env vars (unchanged), same fee split.
- `/v1/network` exposes `priceNcldPerTmac` and `baseFeeUcld` (drop `priceUcldPerMmac`), plus `lastSettledEpochAt` (ms or null).

## Fee split (per mille of fee F)
- `LANE_A_PER_MILLE=950` provider, `TREASURY_PER_MILLE=30` treasury, remainder 20‰ net burned. All of F is burned on-chain at finalize; provider and treasury are minted. Rounding: provider = floor(F·950/1000), treasury = floor(F·30/1000).
- Treasury is NOT a Merkle leaf anymore; it is posted as `treasuryAmount` and minted at finalize to the immutable treasury address.

## Price controller (API, hourly, testnet)
- Stored state: current price in KV/D1 (`price_state`). Step each hour: utilization u = served MAC / eligible capacity MAC over the last hour. If served = 0 → hold. Else p ← p·clamp(1 + (u − 0.7), 0.98, 1.02). Floor = 0.1 × 30-day EMA (until provider floors are reported), ceiling = 10 × EMA. Quote locked 5 min (quote returned with `expiresAt`).
- Env: `PRICE_CONTROLLER=on|off` (default on), `PRICE_NCLD_PER_TMAC` is the initial/reset value.

## Subsidy & cluster gate
- ρ `SUBSIDY_RHO=0.25`. `EPOCH_SUBSIDY_BUDGET_UCLD` testnet = 7,300,000 per 1 h epoch (80% of chain allowance at 1M supply, 8%/yr).
- `CLUSTER_N_MIN=3`, `CLUSTER_S_CAP=0.5`. Gate is PER OPERATOR: when an operator (cluster) exceeds S_CAP share of the epoch's eligible work, only that operator's lane-B is withheld; others still receive lane B. If the number of distinct clusters < N_MIN, lane B is withheld for all (no subsidy before a minimal decentralization).

## Epochs
- `EPOCH_SECONDS=3600`, `VEST_B_SECONDS=3600` on testnet (mainnet 86400 / 604800). `closeEpochs` must close lane A as soon as the epoch has ended (not wait for lane-B vest); lane B vests on-chain.
- Migration: existing `reward_entries.epoch` values were computed with 120 s epochs. Provide an idempotent migration that recomputes `epoch = floor(created_at_ms / (EPOCH_SECONDS*1000))` for unposted entries (or marks them void on testnet), run by `ensureSchema()` guarded by a `schema_meta` key `epoch_seconds`.

## Settlement contract v2 (fresh deploy; no migration)
- Leaf: `keccak256(bytes.concat(keccak256(abi.encode(epoch, account, laneA, laneB))))` (OZ double-hash), amounts in wei.
- `postEpoch(uint256 epoch, bytes32 root, uint256 totalLaneA, uint256 totalLaneB, uint256 treasuryAmount, uint256 feesBurned)` POSTER_ROLE. Requires: epoch ended; `treasuryAmount >= feesBurned * TREASURY_MIN_BPS / 10000` (300); `totalLaneA + treasuryAmount <= feesBurned * LANE_A_MAX_BPS / 10000` (9800); `totalLaneB <= allowance(epoch)`; `feesBurned <= escrow available`. Re-post allowed after veto (existing behaviour).
- `veto(epoch)` GUARDIAN_ROLE before `postedAt + vetoDelay`.
- `finalize(epoch)` after veto window: burns `feesBurned` from escrow, mints `treasuryAmount` to `treasury` (immutable).
- `claim(epoch, account, laneA, laneB, proof)` / `claimFor(...)` batch: lane A claimable after finalize; lane B claimable after `finalizedAt + vestBSeconds`. Claimed flags per (epoch, account, lane).
- `clawLaneB(epoch, account, laneA, laneB, proof)` GUARDIAN_ROLE before lane-B vest → marks lane B void (never minted).
- Escrow stays pooled (`deposit`, `depositFor` emitting `Deposited(from, user, amount)`); per-user withdrawal is a mainnet item (documented, not built).
- Constructor: `(token, treasury, admin, poster, guardian, epochSeconds, vetoDelaySeconds, vestBSeconds, genesisTimestamp)`. Keep annual subsidy schedule (8% → ×0.85/yr → 1.5% floor of live supply).
- CLDToken v2: OZ ERC20 + AccessControl, MINTER_ROLE only to Settlement after deploy, initial supply param (testnet 1,000,000 to treasury), and an on-token annual NET mint ceiling `MAX_MINT_BPS_PER_YEAR` (default 1000 = 10% of supply at year start; mints minus burns, since burn-and-mint re-mints ~98% of every fee) enforced in `mint`.
- Deploy script `contract/scripts/v2/deploy.ts` reading env: `TREASURY_SAFE`, `GUARDIAN_SAFE`, `POSTER_ADDRESS`, `ADMIN_SAFE`; grants and revokes so the deployer holds nothing afterwards; writes `shared/addresses.baseSepolia.json` (v2 section) and prints Basescan verify commands. The owner runs it; nothing is deployed by us.

## Admin epochs API (consumed by the keeper)
All with header `x-internal-key: INTERNAL_API_KEY`.
- `POST /v1/admin/epochs/close` → closes due epochs, returns `{ epochs: EpochPayload[] }`.
- `GET /v1/admin/epochs?status=closed|posted` → `{ epochs: EpochPayload[] }` (stateless keeper re-reads; leaves come from persisted `leaves_json`).
- `EpochPayload = { epoch, root, feesBurnedUcld, totalLaneAUcld, totalLaneBUcld, treasuryUcld, leaves: [{ account, laneAUcld, laneBUcld }], status }`. Root computed by the API with the exact leaf encoding above after ×1e12 conversion (keeper re-verifies the root before posting).
- Existing `/posted`, `/settled`, `/vetoed`, `/entries/:id/claw` keep working.

## Keeper (new `keeper/` Cloudflare Worker, separate from the API)
- Cron `*/5 * * * *`. No public routes except `GET /health`. Secrets: `POSTER_PRIVATE_KEY`, `INTERNAL_API_KEY`; vars: `API_URL`, `RPC_URL`, `SETTLEMENT_ADDRESS`, `CHAIN_ID`.
- Each run: close → for each closed epoch rebuild tree, check root, `postEpoch` if not on-chain, mark posted; for posted epochs past veto window `finalize`, mark settled; `claimFor` in chunks ≤ 300 leaves for lane A (and lane B once vested). Idempotent by reading on-chain state first. Logs to Workers Logs; `/health` reports last run, poster balance, oldest unsettled epoch age.

## Node instruction signing
- New Worker secret `INSTRUCTION_SIGNING_KEY` (secp256k1 private key, NOT a chain key; never holds funds). Its address is published at `GET /v1/nodes/instruction-key` and baked into the agent as default `CLOUDANA_INSTRUCTION_SIGNER` (overridable by env).
- Every API response to a node that contains work or deployment instructions (heartbeat `deployments`, work assignment) includes `sig = personal_sign(keccak256(canonicalJSON({ nodeAddress, ts, nonce, body })))` and `ts`, `nonce`. Agent verifies signer == pinned address and |ts−now| ≤ 60 s and nonce unseen (LRU), else ignores the instruction.
- Node→API requests add `X-Nonce` (random 16 bytes hex); API rejects reused nonces within 120 s (KV TTL).

## Node capabilities & hardening
- Agent announces only `matmul` and `static` by default. `container` / `gpu` require `CLOUDANA_ALLOW_CONTAINERS=1` (fleet/owner nodes) AND passing hardening self-check. API places containers/workstations only on nodes that announced them AND belong to a fleet (`fleet_id` not null) on testnet.
- docker run adds: `--cap-drop=ALL --security-opt=no-new-privileges --pids-limit=512 --read-only=false --memory-swap=<same as memory> --network=cld-tenant` (user-defined bridge; agent creates it and installs iptables DROP rules for RFC1918, 169.254.0.0/16, 100.64.0.0/10 when root/able, otherwise refuses containers), `--user` from spec or 1000:1000 for non-workstation containers, strips any `NVIDIA_*`/`CUDA_VISIBLE_DEVICES` keys from tenant env and sets `NVIDIA_VISIBLE_DEVICES=<allocated indices or none>`. Image allowlist: images from the curated templates list (API sends `imageAllowed` flag; agent also checks `CLOUDANA_IMAGE_ALLOWLIST` regexes).
- Agent: default API `https://api.cloudana.io`; heartbeat 15 s; reports `agentVersion`; API returns `minAgentVersion` and refuses work below it.

## Hosting gateway
- New Worker `gateway/` on route `*.sites.cloudana.io/*`: subdomain = deployment slug/id → `GET {API}/v1/deployments/{id}/route` (public, cached 30 s) → `{ endpoint, status }` → proxy fetch to the node endpoint, add security headers (CSP sandbox for html, X-Content-Type-Options, no Set-Cookie passthrough). 404 page if not running.
- Content-hash probe: at upload the API stores sha256 of a probe file (index.html or first file) as `probe_hash`; the 60 s probe fetches that path from the node endpoint and requires the hash to match. Endpoint host must equal the node's announced public host.
- Admin stop: `POST /v1/admin/deployments/{id}/stop` (internal key) → status `stopped`, reason `admin`.

## Testnet credits & faucet
- Delete the on-chain faucet route and page (redirect `/control/faucet` → `/control/earnings`). Disable all legacy chain writes (POUW verifier recorder, mining reward, workload registry placement, CLD mint) — the API Worker holds no chain key.
- `/v1/dev/credits`: 10 CLD per wallet per 24 h AND per IP per 24 h (CF-Connecting-IP; also cap 20/day per ASN via `request.cf.asn`).
- Payments: crypto deposit path that credits transfers to RewardContract is removed; replaced by a `Deposited`-event watcher for the v2 Settlement (cron, `SETTLEMENT_ADDRESS` + `CHAIN_RPC_URL`; inactive when unset). Stripe routes return 503 `payments_disabled` unless `STRIPE_ENABLED=true` (default false).
