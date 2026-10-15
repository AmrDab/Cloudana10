# Storage — object storage on provider disks, in three phases

Status: **v2, approved 2026-10-15** (owner: "go with what you recommend" — the four decisions below, as recommended) · 2026-10-13. v1 was dissected in [V4_REVIEW_STORAGE.md](V4_REVIEW_STORAGE.md)
(17 findings, all accepted; finding 5 was a live hole in hosting probes and is already fixed and deployed).
Build order step 8 of [V4_VERIFIED_SERVICES.md](V4_VERIFIED_SERVICES.md).

## Why phases
The review's core point: durable storage on home disks needs things the network doesn't have yet — enough independent
operators to spread copies, and checks cheap enough to run on every node every day. Promising durability before that
would be dishonest; refusing storage until then would hide a product users want. So storage ships in three phases,
each honest about what holds the data.

| Phase | Users get | Who holds the durable copy | Providers do | Label |
|---|---|---|---|---|
| **1. Network artifacts** | nothing new (internal) | Cloudana's R2 | hold job inputs/outputs; prove the chunk store, checks and repair | — |
| **2. Buckets, early access** | S3-compatible buckets | Cloudflare R2 (one copy) | hold 2 more copies, serve reads, earn for bytes held and served | **early access · durable copy on Cloudflare R2** |
| **3. Provider durability** | same buckets | provider disks (erasure-coded) | the R2 copy is dropped per object once its pieces pass checks | **challenged** |

Phase 3 starts only when the network has **≥ 14 independent operators** (distinct /24 or /48 and ASN, see below) and
phase 1–2 checks have run clean for 60 days.

## The design, finding by finding
**Data path (findings 7, 8, 9, 10)**
- Uploads stream into R2 first (no buffering in a Worker; the S3 `200` means the R2 copy is durable). A Queue consumer
  then chunks, encrypts and places copies on providers, so a slow home uplink never fails an upload.
- AWS CLI / boto3 checksum trailers (`aws-chunked`, CRC64NVME, CRC32) are decoded; MD5 ETags use `DigestStream`;
  documented rclone settings (`--s3-upload-cutoff 64M --s3-chunk-size 64M`).
- Encryption per 64 KiB leaf (STREAM construction) with a random 96-bit nonce per chunk — no nonce reuse on retried
  parts, and a range read fetches only its leaves. The chunk id is its Merkle root (one hash pass).
- Objects under 64 KiB are packed into shared 4 MiB segments; billing has a 64 KiB minimum per object.
- Metadata lives in **one Durable Object per bucket** (SQLite), not the shared `cloudana-db`: per-bucket ordering gives
  read-after-write, listing with prefixes and delimiters stays local, and a 10,000-part upload commits as parts arrive.

**Copies and Sybil resistance (findings 3, 13)**
- Each provider copy is encrypted under its **own** subkey (HKDF from the object key and the copy index), so three
  copies are three different ciphertexts with three roots: one disk cannot answer for three identities.
- Placement spreads copies by network (/24 for IPv4, /48 for IPv6) and ASN, never by wallet alone. New nodes get at most
  5 % of new copies until they have passed 30 days of checks; no node or ASN holds more than one copy of a chunk.

**Checks (findings 1, 4, 5, 6)**
- **Per node, not per replica:** the node's RelayNode Durable Object keeps that node's chunk → root index in its own
  SQLite and, once a day at a random time, samples ~20 chunks, asking for 3 random leaves each with their Merkle paths.
  One D1 row per node-day. A node missing 10 % of its data fails a day with probability ≈ 0.88; a failed day triggers a
  full audit, holds back that day's pay and starts repair.
- Deadline 15 s per sample, measured at the hub (spun-down NAS disks wake in 5–10 s); no 1 % full rehash.
- Checks use the reserved probe slots (deployed with the hosting fix), so `busy` is a failure, never a pass.
- A `storage` traffic class with its own stream budget; proofs are small control frames that go ahead of bulk data.
- Reads double as checks: a copy that fails to serve a read within 5 s is hedged to the next and counted.

**Repair (findings 11, 12)**
- The **destination** pulls: a node receives a signed heartbeat instruction, fetches from a healthy copy (or R2 while it
  exists), verifies the root, then reports; the old copy is kept until the new one verifies.
- Budgets: 1–2 repair streams per source node, a global cap, fewest-copies first. A home node is declared gone after
  48 h offline (at once if a chunk is down to one copy). Leaving providers drain gracefully.
- Fixed three-node placement groups, so a handful of failures can't each take a piece of many objects.
- In phase 2 nothing can be lost (R2 holds the object). In phase 3, a lost object refunds every fee it paid; "lost" and
  "temporarily unavailable" are shown differently; 50 % of a new node's storage earnings are held back for 6 months and
  forfeited if it abandons data.

**Money (findings 2, 16)**
- Storage is booked as `deployment_bills` rows — one charge per owner-day, one payout per node-day — so epoch fees
  burned include it and the contract's 98 % bound holds. Credits running out: read-only for 7 days, then the object keys
  are destroyed (the data becomes unreadable everywhere).
- Fees only; no subsidy. Empty disks earn nothing, so faking capacity pays nothing.

**Keys, abuse, law (findings 14, 15)**
- The key-encryption key lives only on the gateway (versioned); D1 / the bucket DO hold access-key secrets and object
  keys wrapped, with the id as associated data. Read-only and per-bucket access keys. Deleting an object destroys its
  key, which also makes copies on offline nodes unreadable (erasure on request).
- Chunk deletes reach nodes only as signed heartbeat instructions, never through a relay call.
- No anonymous reads or public buckets in phases 1–2; downloads are served from `s3.<content domain>` with
  `Content-Disposition: attachment`, `nosniff` and a sandbox CSP. Cloudana can decrypt, so it is the host: a takedown
  destroys the object's key; a DMCA agent and a notice-and-action contact are needed before phase 2 opens (counsel).

## Prices (owner decision)
| | Phase 2 (R2 copy + 2 provider copies) | Phase 3 (provider durability) | Market |
|---|---|---|---|
| Stored, per GB-month | **$0.02** | **$0.006** | S3 $0.023, Backblaze B2 $0.006, Storj $0.004 |
| Downloaded, per GB | **$0.01** | **$0.01** | Storj $0.007, S3 $0.09 |
| Minimum object | 64 KiB | 64 KiB | — |

Phase 2 costs more because R2 itself is $0.015 per GB-month; providers earn $0.004 per GB-month per copy held plus 95 %
of download fees. In phase 3 a TB held earns a provider about $1.90 a month — honest, and the same disk earns far more
as container or GPU disk.

## Build order
1. **Phase 1** — agent storage role (`CLOUDANA_ROLES=storage`, quota, chunk store, leaf proofs over the `storage`
   class), the RelayNode sampling alarm, destination-pull repair; used for Cloudana's own job artifacts.
2. **Phase 2** — S3 gateway (R2 staging, queue placement, checksums, per-bucket DO metadata), access keys, daily
   billing, console Storage tab; opens after the content domain and the DMCA/notice contacts exist.
3. **Phase 3** — erasure coding (10-of-14) and dropping the R2 copy object by object, once the operator threshold holds.

## Owner decisions (decided 2026-10-15)
1. **The phased plan with an R2 copy until the network can hold data itself.** ✔ (not provider-only storage that waits
   for 14 independent operators before anyone can store anything)
2. **Phase 2 prices:** $0.02 per GB-month and $0.01 per GB downloaded. ✔
3. **Cloudana holds the object keys** (providers see ciphertext; Cloudana could decrypt and is the legal host). ✔ S3
   clients work unchanged; users who want zero-knowledge encrypt before upload (e.g. rclone crypt) — documented, not
   enforced.
4. **A DMCA agent and an abuse contact** before phase 2 opens. ✔ Owner: register a DMCA designated agent with the US
   Copyright Office and set up abuse@ / dmca@ aliases (runbook step 7); a notice-and-action page ships with phase 2.
