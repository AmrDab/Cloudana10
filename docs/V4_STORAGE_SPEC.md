# Storage v1 — object storage on provider disks

Status: **draft for owner approval** · 2026-10-13. Build order step 8 of [V4_VERIFIED_SERVICES.md](V4_VERIFIED_SERVICES.md).
Builds on the relay ([V4_RELAY_CONTRACT.md](V4_RELAY_CONTRACT.md)), dollar pricing ([PRICES_USD.md](PRICES_USD.md)) and the
research in [UNIVERSAL_POUW.md](UNIVERSAL_POUW.md) §3 (capacity proofs attract fake capacity).

## What it is
- **For users:** buckets of files (model weights, datasets, job inputs and outputs, backups) behind an S3-compatible
  API, so existing tools work (`aws s3`, rclone, boto3). Address: `https://s3.<content domain>/<bucket>/<key>`.
- **For providers:** a machine can offer **storage only** (a NAS, a box of drives): `CLOUDANA_ROLES=storage` announces
  only `storage` (plus `relay`), runs no compute and no tenant code, and uses only the disk area and size the operator
  sets (`CLOUDANA_STORAGE_DIR`, `CLOUDANA_STORAGE_GB`). Home nodes need no public IP: everything goes through the relay.

## Five decisions
1. **Three replicas on three different operators** (payout wallet and fleet both distinct), not erasure coding, in v1.
   Simplest reads and repair; erasure coding (e.g. 10-of-14, 1.4× instead of 3×) is v2 once there are enough operators.
2. **Providers only ever see ciphertext.** The gateway splits an object into 4 MiB chunks and encrypts each with a
   per-object key (AES-256-GCM, WebCrypto); the object key is wrapped by a bucket key the API holds. Honest line:
   Cloudana could decrypt (same trust as today's orchestrator); users who need zero-knowledge encrypt before upload.
3. **Content-addressed chunks with a Merkle root.** Chunk id = sha256(ciphertext); the manifest keeps a Merkle root over
   64 KiB leaves. A node verifies the hash on every write.
4. **The check is retrievability, never "replication".** Once a day per replica (and at random times), the API asks the
   node through the relay for one random leaf plus its Merkle path and checks it against the root within 2 s; 1 % of
   checks fetch and rehash the whole chunk. This proves the node can produce the data quickly; it does not prove a
   separate physical copy, which is why the three replicas must sit with three different operators. Label: **challenged**.
5. **Fees only, paid for real data.** Users pay per GB-month stored and per GB downloaded; providers are paid per
   replica-GB-hour held, booked daily, only for replicas that passed that day's checks. No subsidy: empty disks earn
   nothing, so there is no reason to fake capacity (the Filecoin lesson).

## Flows
**Upload** (`PutObject` ≤ 100 MB — the Workers body limit — or multipart with parts ≤ 64 MiB, ≤ 10,000 parts):
1. The gateway authenticates the request (SigV4 with an access key the owner created; see Keys).
2. It asks the API for placement (internal): three relay-fresh `storage` nodes per chunk on distinct operators with
   free quota.
3. It streams each chunk, encrypted, to its three nodes through the relay (`PUT /chunks/<id>`); a node checks the hash
   and size against its quota before writing.
4. The object becomes visible once every chunk has **two** acknowledged replicas; the third is filled by repair if it
   failed. The ETag is the MD5 S3 clients expect (multipart: MD5 of part MD5s).

**Download** (`GetObject`, `HeadObject`, `Range`): the gateway reads the manifest, fetches the chunks covering the range
from the first replica that answers (the next on `offline` / `not_serving` / timeout), decrypts and streams them.

**Delete:** the manifest row is marked deleted at once (billing stops); nodes get `delete` instructions on their
heartbeats and confirm; space is reclaimed after confirmation.

**Repair** (API cron, small batches): a replica whose node has been offline for 6 h, or that failed two checks, is
copied from a healthy replica to a new node (read and write through the relay) and the old one is dropped. Chunks with
a single healthy replica go first; a chunk with none is reported lost to its owner (honest event, prorated refund).

## Node agent
A chunk store under `CLOUDANA_STORAGE_DIR` with a hard byte quota, served only through the relay:
`PUT /chunks/<id>` (sha256 checked), `GET /chunks/<id>` (with `Range`), `GET /chunks/<id>/leaf/<i>` (leaf + Merkle path),
`DELETE /chunks/<id>`. It announces `storage`, the bytes offered and the bytes used. No containers, no Docker.

## API surface
| Endpoint | Auth |
|---|---|
| `POST /v1/storage/buckets` · `GET` · `DELETE /v1/storage/buckets/{name}` (empty buckets only) | JWT |
| `POST /v1/storage/keys` (access key id + secret, secret shown once) · `GET` · `DELETE /v1/storage/keys/{id}` | JWT |
| `GET /v1/storage/usage` (bytes, objects, this month's cost in $ and CLD) | JWT |
| `POST /v1/storage/placements` · `POST /v1/storage/objects` (commit manifest) · `GET /v1/storage/objects/{bucket}/{key}` | internal (gateway) |
| `https://s3.<content domain>`: PutObject, GetObject, HeadObject, DeleteObject, ListObjectsV2, CreateMultipartUpload, UploadPart, CompleteMultipartUpload, AbortMultipartUpload | SigV4 |

SigV4 needs the secret to verify a signature, so access-key secrets are stored encrypted under a Worker secret
(`STORAGE_KEY_SECRET`), never in plain text and never returned after creation.

## Data (D1)
`buckets(id, owner, name, created_at, deleted_at)` · `storage_keys(id, owner, access_key_id, secret_enc, created_at, revoked_at)` ·
`objects(id, bucket_id, key, size, etag, key_wrapped, created_at, deleted_at)` · `chunks(object_id, idx, id, size, merkle_root)` ·
`replicas(chunk_id, node, state, stored_at, checked_at, fails)` · `storage_bills(id, owner, node, kind, bytes, fee_ucld, at)`.
Rough size: ~250 bytes per replica → 10 GB of D1 holds ~40M replicas (~160 TB of user data at 4 MiB chunks). Enough for
testnet; the chunk index moves to Durable Objects or R2 before that.

## Prices (owner decision)
| | Proposed | Market |
|---|---|---|
| Stored | **$0.006 per GB-month** | Backblaze B2 $0.006, Storj $0.004, S3 $0.023 |
| Downloaded | **$0.01 per GB** | Storj $0.007, S3 $0.09 |
| Uploads, requests | free in v1 | — |

Providers get 95 % of fees: about **$0.0019 per GB-month of disk held** (three replicas share the storage fee) plus
their share of downloads served. A 4 TB drive kept full earns about $7.60 a month; this is honest, not a sales pitch.

## Build order (each step tested; nothing user-facing before the content domain exists)
1. Agent: storage role, chunk store with quota, leaf proofs, selftests.
2. API: tables, placement on distinct operators, checks, repair, daily billing, buckets/keys/usage routes.
3. Gateway: S3 subset with SigV4, encryption, chunking, replica fallback; tested with `aws s3` and rclone.
4. Console: Storage tab (buckets, keys, usage); catalog flips Storage to early access.

## Owner decisions
1. The two prices above.
2. Three replicas in v1 (erasure coding later).
3. Bucket keys held by the API (providers see ciphertext; Cloudana could decrypt) — or client-side encryption only.
4. No free tier in v1.
