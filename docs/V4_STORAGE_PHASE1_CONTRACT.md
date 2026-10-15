# Storage phase 1 — build contract

Status: **part A live; part B: relay live (storage class, 4 probe slots), API built (PR #41), agent 1.4.0 next** · 2026-10-15.
- This contract implements build-order step 1 of [V4_STORAGE_SPEC.md](V4_STORAGE_SPEC.md) v2, owner-approved
  2026-10-15.
- Users get nothing new. Cloudana's own job data moves out of D1 into R2, and providers start holding encrypted copies
  of it, with checks and repair, so the machinery is proven before phase 2 sells buckets.
- An independent review of the first draft found 7 issues; all are folded in below. Its finding #2 was also live in
  the hosting probes and is fixed separately (PR #39).
- Deviations from the spec are listed at the end, each with its reason.

## A. Job artifacts in R2 (API only) — live (PR #38)
- **Bucket.** R2 bucket **`cloudana-artifacts`**, bound to the API as `ARTIFACTS`. Under tests the binding is an
  in-memory store.
- **Cron.** Each run moves up to 20 finished jobs (`status = 'done'`, `artifact IS NULL`), oldest first:
  1. It writes `jobs/<id>.json` = `{n, matrixA, matrixB, matrixC}` to the bucket.
  2. Only then does it set `a_json = b_json = result_json = NULL` and record `artifact`.
  3. If the write fails, the row is left as it was for the next run.
- **Readers** go through `jobMatrices()`, which uses the inline columns if they are still set and the artifact
  otherwise. The readers are the owner's job view and the verify feed.
- **Still inline:** queued and assigned jobs.
- **Verify tasks** no longer copy matrices into D1.
- **Index (part B).** A partial index on `work_jobs(completed_at) WHERE status = 'done' AND artifact IS NULL`, so the
  cron never re-reads jobs it has already moved.

## B. Provider copies

**Objects and copies**
- **One artifact = one storage object.** Objects are ≤ 4 MiB (matmul at n = 256 is about 1.4 MB). Larger artifacts are
  not placed.
- **Copies.** Each object gets `STORAGE_COPIES` = 2 provider copies. R2 stays the durable copy for phases 1–2.
- **Retention.** Provider copies are dropped after `STORAGE_RETENTION_DAYS` = 30. The R2 artifact stays.
- **Encryption** happens in the API only; the node never decrypts:
  - object key = HKDF-SHA256(`STORAGE_KEK`, "cloudana/object/" + objectId)
  - copy key = HKDF(object key, "cloudana/copy/" + copyIdx)
  - AES-256-GCM over 64 KiB plaintext leaves:
    - IV = the copy's random 8-byte nonce ‖ u32 BE leaf index
    - AAD = copyId ‖ u8(last leaf ? 1 : 0)
- **Re-placement.** A re-placed copy gets a new copy id and a new nonce, so its ciphertext and root change.
- **Merkle root** (`shared/storage-proof.ts`, shared by the API and the agent):
  - leaf hash = SHA-256(0x00 ‖ leaf); inner = SHA-256(0x01 ‖ left ‖ right); an odd node is carried up unchanged.
  - The root does not bind the leaf count. The verifier always takes `n` from `storage_objects.leaves` and derives the
    path shape (which levels have a sibling) from (i, n). A path with a missing or extra sibling fails.
- **No `STORAGE_KEK`, or no instruction-signing key → no provider copies.** Artifacts still move to R2. In DEV_MODE a
  fixed development KEK is used.

**Tables (D1)**
- **`storage_objects(id, r2_key, size, leaves, created_at, next_attempt_at)`.** `next_attempt_at` is non-null while the
  object needs copies, with a partial index on it.
- **`storage_copies(id, object_id, copy_idx, node, nonce, root, state, fetches, assigned_at, held_at)`:**
  - `state`: `pending → held → (suspect) → dropping`.
  - The row is deleted once the node confirms the delete.
  - `UNIQUE(object_id, copy_idx) WHERE state <> 'dropping'`.
- **`storage_checks(node, day, samples, failures)`:** one row per node-day.
- **New `nodes` columns:**
  - `storage_quota_mb`, from announce.
  - `net_prefix` (/24 for IPv4, /48 for IPv6) and `asn` (`request.cf.asn`), set at announce and on every heartbeat.
  - `storage_next_check_at`, `storage_cooldown_until`, `storage_strikes`, `storage_backoff_until`.
  - `storage_passed_days`, counted at day close.

**Placement (cron)**
- **Budget per run:** up to 20 successful placements and 50 attempts, done one at a time (Worker memory).
- **Object order:** by `next_attempt_at`. An object that finds no eligible node moves to the back
  (`next_attempt_at` = now + 10 min).
- **Eligible node.** All of the following must hold:
  - it has the `storage` capability and runs agent ≥ 1.4.0;
  - its relay socket is fresh and it heartbeat within `NODE_ACTIVE_SECONDS`;
  - it is not in cooldown or backoff and has fewer than 8 pending copies;
  - its effective quota covers the object, where effective quota = min(declared, 1 GB × (1 + `storage_passed_days`)).
    New nodes grow into their quota;
  - it holds no other copy of the object;
  - it shares neither `net_prefix` nor `asn` with the object's other live copies;
  - its `asn` and `net_prefix` each hold under 50 % of all live copies, once at least 4 nodes hold copies.
- **Unknown prefix or ASN:** the node is eligible only in DEV_MODE.
- **Choice:** the least-filled eligible node wins.
- **Placing a copy:** the API reads the object from R2, encrypts the copy, and records `nonce`, `root` and
  `state = 'pending'`.

**Instructions (signed heartbeat)**
- **Signed body.** A node with the `storage` capability gets a third signed key, `storage: [...]`. Other nodes keep
  the exact `{assignment, deployments}` body, so 1.3.x agents still verify it. Agent 1.4.0 includes `storage` in the
  verified body only when the response carries it.
- **Fetch entries:** `{op: "fetch", copy, size, leaves, root}`, at most 4 per heartbeat, oldest first.
- **Delete entries:** `{op: "delete", copy}`, at most 50 per heartbeat. Deletes reach nodes only this way, never
  through a relay call.
- **Download.** The agent pulls its copy with `GET /v1/nodes/storage/copies/{copy}` (node-signed, only the assigned
  node, only while the copy is `pending`, at most 3 downloads, otherwise 409). The API encrypts from R2 on the fly.
  The agent checks size and root before keeping the copy.
  - A held copy can never be downloaded again, so a node cannot fetch it on demand to answer a check.
- **Report.** The agent reports with `POST /v1/nodes/storage/report {copies: [{id, state: "held" | "deleted" | "failed"}]}`:
  - `held`: `pending → held`, with the copy's first check due at once.
  - `deleted`: the row is removed.
  - `failed`: the copy is dropped and the node backs off placement for 1 h.
- **Stale pending.** A copy still `pending` after 1 h is dropped, and the node backs off for 1 h.

**Checks (cron, not heartbeats, so a node can't slow its own checks)**
- **Schedule.** A node is due when `storage_next_check_at ≤ now`. Each run claims at most 20 due nodes, each
  atomically (`UPDATE … WHERE storage_next_check_at ≤ ?`), and checks them in parallel, one sample per node.
  - Next check = now + (0.5 + random) × 72 min, about 20 a day.
  - Nodes with a stale relay socket are skipped; the 48 h rule handles them.
- **Sample.**
  - One held copy is chosen at random; a copy just reported held is checked first.
  - The check asks for min(3, leaves) random distinct leaves through the relay:
    - `x-relay-class: storage` and `x-relay-dep: storage`;
    - `x-relay-path: /proof?copy=<id>&i=<a>,<b>,<c>`;
    - `x-relay-probe: 1`;
    - a 15 s deadline.
  - The response is read as a stream, capped at 512 KiB.
- **Pass:** exactly the requested indices, each leaf of the expected length for (i, size), and each path of the shape
  derived from (i, leaves) hashing to the stored root.
- **Outcomes**, using the same rules as the fixed hosting probes:
  - Only the relay call itself throwing is inconclusive. Three of those in a row count as a failure.
  - A body that breaks off, a timeout, `busy`, not serving, or a wrong proof is a failure.
- **On a failure:**
  1. **Re-challenge at once:** the same copy with fresh leaves. If that passes, it was a flake: the miss is counted,
     nothing else happens.
  2. **Confirmed failure:**
     - the copy goes to `dropping`;
     - the node's other held copies become `suspect`;
     - `storage_strikes + 1` sets a cooldown of 24 h, then 72 h, then 7 days;
     - no new copies go to the node during cooldown.
  3. **Audit of suspect copies:** each run audits up to 20 suspect copies network-wide, one leaf each. Passing → back
     to `held`; failing → `dropping`. Suspect copies still count as live.
- **Day close.** A node-day with samples and no confirmed failure adds one to `storage_passed_days`.
- **Offline nodes.** A node offline for 48 h has all its copies moved to `dropping`; it deletes them if it returns.
- **Probe slots.** `PROBE_SLOTS` goes from 2 to 4, so hosting probes (2 at a time), a storage check and a report
  never meet `busy` from their own traffic. Hosting probes keep their own parallelism of 2.

**Relay**
- `TrafficClass` gains `storage`: head timeout 15 s, body cap 1 MiB.
- `RelayNode` recognises `x-relay-class: storage`.
- The relay deploys before the API sends storage checks.

**Agent 1.4.0**
- **Turning it on.** `CLOUDANA_STORAGE_GB=<n>` enables the role, with a quota of n GB. `CLOUDANA_STORAGE_DIR` is
  optional; the default is `.data/storage`.
- **Announce.** The agent announces the `storage` capability and `storageGb`. The API accepts both only from agents
  ≥ 1.4.0.
- **Proofs.** `dep = "storage"` requests are served in-process, before the deployment lookup. `/proof` reads the copy
  and returns `{proofs: [{i, leaf (base64), path (hex[])}]}`.
- **Fetching.** Fetches run one at a time into a temp file, which is renamed once its root is checked.

## Money
There are no charges and no payouts in phase 1. Pay arrives with phase 2 buckets, booked as `deployment_bills`; a
failed day then holds back that day's pay.

## Deviations from the spec, and why
1. **Checks run in the API cron, not a RelayNode alarm with its own SQLite index.**
   - Repair needs the global chunk → nodes view in D1 anyway.
   - The load is about 20 samples per node-day plus one row per node-day.
   - The checks share the hosting probes' rules and code.
   - They move into the relay when the node count makes that worth it.
2. **Repair always pulls from R2 through the API, and there are no Queues.**
   - R2 holds every object in phases 1–2.
   - Placement is a cron step.
3. **The new-node 5 % cap is replaced by quota that grows with days of passed checks, plus a 50 % cap per ASN and per
   /24.**
   - A network made entirely of new nodes would otherwise place nothing.
   - The two caps keep a cluster of Sybil identities from taking every copy.
4. **Derived keys, not stored wrapped random keys.** Erasure by key destruction is a phase-2 bucket feature. Phase 1
   deletes the R2 object and the copies.
5. **`CLOUDANA_STORAGE_GB` instead of `CLOUDANA_ROLES=storage`.** One variable opts in and sets the quota.

## Owner
- Set `STORAGE_KEK` on `cloudana-api` (runbook step 2, with the other two API secrets). Until then artifacts move to R2, but no provider copies are made.
