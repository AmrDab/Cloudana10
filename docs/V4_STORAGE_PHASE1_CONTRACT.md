# Storage phase 1 — build contract

Status: **building** · 2026-10-15. Implements build-order step 1 of [V4_STORAGE_SPEC.md](V4_STORAGE_SPEC.md) v2
(owner-approved 2026-10-15). Users get nothing new; Cloudana's own job data moves out of D1 into R2, and providers
start holding encrypted copies of it, with daily checks and repair, so the machinery is proven before phase 2 sells
buckets. Deviations from the spec are listed at the end with the reason.

## A. Job artifacts in R2 (API only)
- New R2 bucket **`cloudana-artifacts`**, bound to the API as `ARTIFACTS`. Under tests (Node runtime) an in-memory
  store with the same `put/get/delete` interface.
- A cron step moves every finished job (`work_jobs.status = 'done'`, `artifact IS NULL`), at most 20 a minute:
  1. Put `jobs/<id>.json` = `{n, matrixA, matrixB, matrixC}`.
  2. Then `a_json = b_json = result_json = NULL`, `artifact = 'jobs/<id>.json'`. If the put fails, nothing changes
     and the next minute retries.
- Readers fall back to the artifact when the columns are null:
  - the owner's `GET /v1/jobs/{id}` (result);
  - the public verify feed (`nextVerifyTask`).
- Queued and assigned jobs keep their inputs inline: nodes still receive them in the signed heartbeat.
- `verify_tasks` stops storing matrices. Grading only reads `expected`; the matrices were write-only copies of up
  to ~1.4 MB per check.

## B. Provider copies (shared + API + relay + agent)

**Objects and copies**
- One artifact = one storage object. Artifacts are ≤ 4 MiB (matmul at n = 256 ≈ 1.4 MB); larger artifacts are not
  placed.
- Each object gets **`STORAGE_COPIES` = 2** provider copies; R2 stays the durable copy for all of phase 1–2.
- Copy encryption (API only; the node never decrypts):
  - object key = HKDF-SHA256(`STORAGE_KEK`, "cloudana/object/" + objectId);
  - copy key = HKDF(object key, "cloudana/copy/" + copyIdx);
  - AES-256-GCM over 64 KiB plaintext leaves; IV = the copy's random 8-byte nonce ‖ u32 BE leaf index;
  - each ciphertext leaf is 64 KiB + 16 bytes, the last one shorter.

  The two copies are different ciphertexts with different roots, so one disk can't answer for two identities.
- **Merkle root** over the ciphertext leaves (`shared/storage-proof.ts`, used by the API and the agent):
  - leaf hash = SHA-256(0x00 ‖ leaf), inner = SHA-256(0x01 ‖ left ‖ right);
  - an odd node is carried up unchanged.

  The root is computed when the copy is placed and stored with it.
- **No STORAGE_KEK → no provider copies.** Artifacts still move to R2. `STORAGE_KEK` is an owner secret (32 random
  bytes, base64); DEV_MODE falls back to a fixed development key.

**Tables (D1)**
- `storage_objects(id, r2_key, size, leaves, created_at)`
- `storage_copies(id, object_id, copy_idx, node, nonce, root, state, assigned_at, held_at)`. `state` is
  `pending → held → dropping`; a copy row is deleted once the node confirms the delete.
- `storage_checks(node, day, samples, failures)`: one row per node-day.
- New `nodes` columns:
  - `storage_quota_mb` (from announce);
  - `net_prefix` (/24 for IPv4, /48 for IPv6) and `asn` (`request.cf.asn`), set at announce and heartbeat;
  - `storage_next_check_at`, `storage_cooldown_until`.

**Placement (cron, ≤ 20 placements a minute)**
- For each object with fewer than `STORAGE_COPIES` live (pending or held) copies, pick a node that:
  - has the `storage` capability, from agent ≥ 1.4.0;
  - is relay-connected (`relay_at` recent) and has heartbeat within `NODE_ACTIVE_SECONDS`;
  - is not in cooldown and has quota left for the object;
  - holds no other copy of the object;
  - shares neither `net_prefix` nor `asn` with the object's other live copies.

  A node with an unknown prefix or ASN is eligible only in DEV_MODE. Among eligible nodes, the least-filled wins.
- The API fetches the object from R2, encrypts the copy, records `nonce` and `root`, and sets `state = 'pending'`.

**Instructions (signed heartbeat)**
- A node with the `storage` capability gets a third signed key, `storage: [...]`. Other nodes keep the exact
  `{assignment, deployments}` body, so agents 1.3.x still verify. Entries:
  - `{op: "fetch", copy, size, root}`: at most 4 per heartbeat, oldest first;
  - `{op: "delete", copy}`: for every `dropping` copy. Deletes reach nodes only this way, never through a relay call.
- The agent pulls with `GET /v1/nodes/storage/copies/{copy}` (node-signed, only the assigned node). The API encrypts
  from R2 on the fly; the agent checks the size and the Merkle root before keeping it.
- The agent reports with `POST /v1/nodes/storage/report {copies: [{id, state: "held" | "deleted" | "failed"}]}`:
  - `held` → `pending → held`;
  - `deleted` → the row is removed;
  - `failed` → the copy is dropped and placed elsewhere.

  A copy still `pending` after an hour is dropped and placed elsewhere.

**Checks (per node, in the heartbeat duties like hosting probes)**
- About 20 samples per node-day, spread out: next check = now + (0.5 + random) × 72 min.
- Each sample:
  - picks one random held copy and 3 random distinct leaves;
  - goes through the relay with `x-relay-class: storage`, `x-relay-dep: storage`,
    `x-relay-path: /proof?copy=<id>&i=<a>,<b>,<c>`, and `x-relay-probe: 1` (reserved probe slots);
  - has a 15 s deadline.
- The node answers `{proofs: [{i, leaf (base64), path (hex[])}]}`; every proof must hash to the stored root.
- Outcomes:
  - **Pass:** samples + 1.
  - **Fail** (bad or missing proof, timeout, `busy`, not serving): failures + 1. The copy goes to `dropping` and is
    placed elsewhere, and the node gets no new copies for 24 h. A node missing 10 % of its data fails a day with
    p ≈ 0.88.
  - **Inconclusive** (the relay binding itself failed): counts nothing and retries at the next heartbeat.
- A node offline for 48 h: its copies go to `dropping` (it deletes them if it returns) and are placed elsewhere.

**Relay**
- `TrafficClass` gains `storage`: head timeout 15 s, body cap 1 MiB.
- `RelayNode` maps `x-relay-class: storage`.
- Checks are probes, so they use the reserved slots and skip the per-deployment cap.

**Agent 1.4.0**
- `CLOUDANA_STORAGE_GB=<n>` turns the role on, with a quota of n GB. `CLOUDANA_STORAGE_DIR` is optional; the default
  is `.data/storage`.
- Announces the `storage` capability and `storageGb`.
- Serves `dep = "storage"` requests in-process, before the deployment lookup: `/proof` reads the copy and returns the
  leaves with their paths.
- Fetches are one at a time; files are written to a temp name and renamed once the root checks out.

## Money
None in phase 1: no charges, no payouts. Holding Cloudana's own data proves the machinery. Pay comes with phase 2
buckets: charges and payouts booked as `deployment_bills`, and a failed day holds back that day's pay.

## Deviations from the spec, and why
1. **Checks run in the API's per-node heartbeat duties, not a RelayNode alarm with its own SQLite index.** The global
   chunk → nodes view lives in D1 anyway (repair needs it), the D1 load is one sample per node per ~72 min plus one
   row per node-day, and the code matches the hosting probes. It moves into the relay when node counts make it worth it.
2. **Repair always pulls from R2 through the API, and there are no Queues.** R2 holds every object in phases 1–2, so a
   healthy provider copy is never needed as a source. Placement is a cron step.
3. **No new-node 5 % cap.** It protects durability when providers are the only copy (phase 3). With R2 holding
   everything and a network of new nodes, it would block every placement.
4. **Derived keys instead of stored, wrapped random keys.** Erasure by key destruction is a phase-2 bucket feature;
   phase 1 deletes the R2 object and the copies.
5. **`CLOUDANA_STORAGE_GB` instead of `CLOUDANA_ROLES=storage`.** One variable both opts in and sets the quota.

## Owner
- Set `STORAGE_KEK` on `cloudana-api`. Until then, artifacts move to R2 but no provider copies are made.
