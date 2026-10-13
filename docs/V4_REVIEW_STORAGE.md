# V4 review — storage (2026-10-13)

Reviewer: cloud/storage engineer (Claude). Reviews [V4_STORAGE_SPEC.md](V4_STORAGE_SPEC.md) against the code and
Cloudflare's published Workers, D1 and Durable Object limits and pricing (read 2026-10-13).

## Verdict

**Not buildable as written; every problem below has a fix.** Four are at the root:
- Per-replica daily checks write to the orchestrator's own D1, which costs more than storage earns from about 2 TB onward.
- Durability rests on "three distinct operators". Wallets are free, so the rule proves nothing, and it can't be met on day one.
- The relay gives storage 16 streams per node with no priority. Honest busy nodes fail the 2 s check; cheaters answer `busy`.
- The ledger doesn't count storage fees as burned, so every epoch with storage in it is rejected on-chain.

Ship first: Cloudana's own artifacts, uploads staged in R2, sampled per-node challenges, per-replica keys, and metadata outside the main D1.

## Findings

1. **BLOCKER: checks cost more than storage earns.**
   - **Breaks:** a daily check writes `replicas.checked_at`: 1 row, or 2 with the index (D1 bills index writes as rows).
     - 1 TB of user data is about 0.7M replicas: 21–43M rows a month, most of the 50M a month Workers Paid includes for the whole API.
     - At the spec's 40M-replica ceiling: about $1,150–2,350 a month of D1 writes plus about $180 of Durable Object requests.
     - That ceiling holds about 56 TB of user data, not "160 TB" (40M × 4 MiB is replica bytes). Its revenue is about $335 a month.
     - It also means 463 writes/s, sustained, into a single-threaded DB that tops out near 1,000 queries/s.
   - **Fix:** challenge per node, not per replica.
     - The RelayNode Durable Object's alarm samples about 20 replicas a day in one request.
     - It keeps the node's chunk → root index in its own SQLite and writes one D1 row per node-day.
     - A node missing 10 % of its chunks fails a day with probability 0.88. A failure means a full audit and a claw-back.

2. **BLOCKER (easy fix): storage fees never reach `fees_burned`.**
   - **Breaks:** `closeEpochs` sums only `work_jobs` and `deployment_bills` (ledger.service.ts:345-351).
     - Lane-A entries for `storage_bills` would break the contract's A + treasury ≤ 98 % rule, and the whole epoch's post reverts.
     - Per-replica bills are dust: a replica-day is about 2.8 µCLD.
   - **Fix:** book storage as `deployment_bills` rows: one charge per owner-day, one payout per node-day.
     - Hold one day ahead.
     - Define what happens when credits run out: read-only, then a grace period, then the keys are destroyed.

3. **BLOCKER: "three distinct operators" is Sybil-able and can't be met at launch.**
   - **Breaks:** wallets are free (ledger.service.ts:40-43). One person can run three agents on one disk, store one copy and be paid for three.
     - "Fleet distinct" adds nothing: a fleet binding sets payout = fleet owner (nodes.service.ts:104-111).
     - With 1–2 operators every PUT fails, and the spec doesn't say so.
   - **Fix:**
     - Encrypt each replica under its own HKDF subkey: three different ciphertexts with three roots, so one disk can't stand in for three. Repair re-encrypts in the Worker.
     - Place by /24 or /48 and ASN, not by wallet.
     - On testnet: a 10 GB per-account quota, an "early access — not durable" label, an R2 backstop copy (about $15/TB-month) until ≥ 3 independent operators, and the replica diversity shown on each object.

4. **HIGH: the relay starves storage.**
   - **Breaks:** all chunk traffic shares one `dep`, so `MAX_STREAMS_PER_DEP` = 16 applies (relay-protocol.ts:14, hub.ts:100-102), each stream with a 512 KiB window on one TCP socket.
     - One parallel `aws s3 cp` fills it. A proof then waits behind up to 8 MiB of frames: 6.7 s on a 10 Mbit uplink.
     - A 4 MiB PUT fits the endpoint cap (16 MiB), not the site cap (1 MiB). The agent sets the cap by deployment kind and only forwards to a 127.0.0.1 port (relay.ts:297-310), so storage needs a new in-process kind.
     - A dead replica stalls a GET for the full 300 s head timeout. (Per-stream speed, about 5 MiB/s at 100 ms, is fine.)
   - **Fix:** a `storage` traffic class with its own stream budget and 2 reserved control slots. Proof frames go ahead of bulk, with the Merkle path in a header. The gateway gives each chunk 5 s to first byte, then hedges to the next replica.

5. **HIGH: `busy` dodges every check (hosting too, today).**
   - **Breaks:** the agent can answer anything with `err busy` (relay.ts:296).
     - The API scores a busy probe "inconclusive" and keeps billing (deployment-duties.service.ts:428-430, 459-462).
     - Probes are recognisable: they carry no `x-forwarded-host`.
   - **Fix:** only the hub decides "busy" on control streams; busy or a timeout is a failed sample after one retry; a node-day without a pass is unpaid. Apply the same rule to hosting probes now.

6. **HIGH: the 2 s bound punishes the honest and stops nobody.**
   - **Breaks:** nodes can't reach other replicas, so outsourcing isn't the threat. The threat is one machine with many identities (#3), and it answers in milliseconds.
     - A spun-down NAS disk takes 5–10 s, and the relay hop already needed a 5 s probe timeout (deployment-duties.service.ts:48).
     - A node that drops 1 leaf in 64 passes 63/64 of single-leaf checks.
   - **Fix:** a deadline of about 15 s, timed at the hub, with several leaves per sample. Drop the 1 % rehash. Add retrieval probes on the read path (UNIVERSAL_POUW §4).

7. **HIGH: uploading through the gateway fails at the edges.**
   - **Breaks:**
     - Bodies are capped at 100 MB (Free/Pro zones) and memory at 128 MB per isolate, shared by concurrent requests.
     - WebCrypto is one-shot, so chunks are buffered, and `tee()` to three nodes buffers up to the slowest: one slow replica can OOM a 100 MB PUT.
     - Only 6 connections per invocation may wait for headers (whether Durable Object stubs count is undocumented; measure).
     - AWS CLI v2 and boto3 send CRC64NVME/CRC32 checksums by default as `aws-chunked` trailers. rclone's 200 MiB `upload_cutoff` turns 100–200 MiB files into 413s.
     - The gateway has no `limits.cpu_ms`: 30 s of CPU per GET.
   - **Fix:**
     - Stream uploads into R2 (no buffering; the 200 means durable; about $0.0005/GB-day). A Queue consumer then chunks, encrypts and places, and deletes the R2 copy after three confirmations.
     - Decode `aws-chunked` with trailers (CRC64 in WASM); compute MD5 with `crypto.DigestStream`.
     - Document rclone settings ≤ 64M. Raise `cpu_ms`. Don't re-hash on read.

8. **HIGH: GCM nonce reuse; a range read costs a whole chunk.**
   - **Breaks:** nonces derived from (part, chunk) repeat when a part is re-sent, which S3 allows and clients do on retry. Two plaintexts under one (key, nonce) expose the keystream and allow forged chunks.
     - One tag per 4 MiB means a 1-byte Range GET pulls 4 MiB from a home uplink (≥ 1.7 s) and bills about nothing, with requests free.
   - **Fix:** a random 96-bit nonce (or an HKDF subkey) for each chunk. Encrypt per 64 KiB leaf (STREAM-style) so a range reads only its leaves. Use the Merkle root as the chunk id (one hash pass). Bill on bytes fetched from nodes.

9. **HIGH: small objects multiply every cost.**
   - **Breaks:** 1M objects of 10 KB earn $0.06 a month but cost 5M D1 rows and about 90M check writes a month.
   - **Fix:** pack small objects into shared 4 MiB segments, compacted on delete. Bill a 64 KiB minimum. Rate-limit per key.

10. **HIGH: metadata in the shared D1.**
    - **Breaks:** `cloudana-db` also carries heartbeats and the ledger. It has a 10 GB cap that can't be raised and runs one query at a time, and every GET, HEAD and LIST would land on it.
      - Completing a 10,000-part upload means about 640k rows, beyond one batch (30 s, 1,000 queries per invocation).
      - Undefined: overwrites and garbage collection of old chunks, racing PUTs, and read-after-write (manifests must not be cached like routes).
      - A delimiter listing needs a skip-scan.
    - **Fix:** one Durable Object per bucket with SQLite (writes serialize per bucket, so read-after-write is free), or at least a separate D1. Write chunk rows at UploadPart so Complete flips one row; `UNIQUE(bucket_id, key) WHERE deleted_at IS NULL`; budget the skip-scan.

11. **HIGH: repair can't keep up and can cascade.**
    - **Breaks:** a 30 s-CPU cron every minute, at 20 chunks a minute, needs about 33 days to re-replicate a 4 TB node.
      - A 6 h outage is normal at home, and the node's copies are dropped when it returns.
      - Repair reads load uplinks that also answer checks; they fail, and that triggers more repair.
      - Each chunk's replicas are placed at random, so almost any three failing nodes lose some data.
    - **Fix:** the destination node pulls (signed heartbeat instruction; it verifies the hash); 1–2 repair streams per source, a global budget, fewest-replicas first; a home node fails after 24–72 h, or at once when a chunk is down to ≤ 1 replica; keep the old copy until the new one verifies; fixed three-node placement groups; a graceful drain before leaving.

12. **MEDIUM: loss and refunds.**
    - **Breaks:** one lost chunk ruins the whole object, and a prorated refund means nothing to the user.
      - The provider was already paid in settled epochs, which `clawEntry` refuses (ledger.service.ts:480).
    - **Fix:** refund every fee the object paid; tell "unavailable" from "lost"; hold back 50 % of a new node's earnings for 6 months, forfeited if it abandons its data (rule 3, longer).

13. **MEDIUM: fraud.**
    - **Fine:** self-dealing loses 5 %, as the spec says.
    - **Breaks:**
      - Fake capacity is free griefing: a node announces a huge quota, attracts placements and discards the data.
      - Testnet credits (10 CLD per IP per day, 20 IPs per ASN; dev.ts:4) keep about 5 TB stored per IP.
    - **Fix:** new nodes get ≤ 5 % of new replicas until vetted; cap one node's or ASN's share of an object; bill on manifest bytes only; a hard testnet quota.

14. **MEDIUM: keys.**
    - **Breaks:** SigV4 needs the secret at the gateway, but the spec keys it to the API. Either `INTERNAL_API_KEY` returns plaintext secrets, or both Workers hold the key.
      - Any holder of a relay binding can `DELETE /chunks`.
    - **Fix:**
      - The key-encryption key lives only on the gateway, versioned. D1 holds secrets and keys wrapped, with the id as AAD; isolates cache them ≤ 60 s.
      - Offer read-only and per-bucket keys.
      - Deleting an object destroys its key, so ciphertext on offline nodes is dead (this also covers GDPR erasure).
      - Deletes go only through signed heartbeat instructions.

15. **MEDIUM: legal and abuse.**
    - **Breaks:** Cloudana can decrypt and sits in front of every read, so it is the host: a DMCA agent, DSA notice-and-action and CSAM reporting.
      - Presigned URLs or public buckets make free file hosting, and HTML served next to tenant sites gets the domain blocklisted.
    - **Fix:** no anonymous reads in v1, on a separate hostname; force `attachment`, `nosniff` and a CSP sandbox; ignore `response-content-type`; takedown = destroy the key.

16. **MEDIUM: prices.**
    - **Fine:** $1.90/TB-month to the provider is in line with other storage networks.
    - **Breaks:**
      - An always-on home NAS (about $3–6 a month in power plus about $2 in drive wear) breaks even only when full.
      - The same disk earns 35× more as container disk (PRICES_USD.md).
      - The 3 % treasury share (about $0.18/TB-month) can't pay for checks or repair.
    - **Fix:** pay source nodes for repair traffic out of the held-back earnings (#12).

17. **Simpler (80 % of the value).**
    - First, Cloudana's own artifacts (UNIVERSAL_POUW §8.2): no SigV4, billing or abuse surface, and it exercises the store, checks and repair.
    - For users: an S3 API on R2 (zero egress), with provider disks as a weights cache next to GPUs.
    - Cold storage on home disks waits until #1, #3 and #11 hold.
