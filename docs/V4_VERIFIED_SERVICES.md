# V4 — verified AI inference, honest service checks, and the fixes they need

Status: **spec v2 for owner approval — nothing built** · 2026-10-10 · lead: senior blockchain engineer (Claude).
v1 of this draft was dissected by the cloud engineer: [V4_REVIEW_CLOUD.md](V4_REVIEW_CLOUD.md) (18 findings, all
accepted). Owner brief: "make Cloudana ready for AI inference; study how hosting, containers, inference, GPU
workstations and storage are checked; fix everything we discussed; simple; no loose ends; every endpoint."

---

## 0. Five rules (the whole design)

1. **One price unit.** All compute is priced in nCLD per tera-multiply-add. A forward pass of a model with P active
   parameters is ≈ **P multiply-adds per token**, so inference uses the same unit as matmul.
2. **One check: replay the answer.** For a random 5 % of requests, a reference node feeds the prompt *and the
   provider's own output tokens* back through the same model and checks each token was a plausible choice
   (teacher forcing). No re-generation, no seeds, cheap (prefill only), immune to GPU numeric noise.
3. **One penalty: delayed earnings.** Inference earnings are booked 2 h after the request completes (same delay for
   everyone). A failed check removes the provider's still-pending entries (`clawEntry`, exists), refunds the user and
   bans the node. No staking, no veto, no contract change.
4. **One subsidy rule:** paying yourself must never return more than you paid, even owning every node:
   `0.95 + ρ < 1` → **ρ = 0.04** (today 0.25, gameable with three wallets).
5. **Honest labels.** *Proven* (matmul) · *spot-checked* (inference, when a checker exists) · *unchecked* (inference,
   no checker online) · *probed* (hosting, containers, workstations) · *challenged* (storage, later).
   Fees only unless proven or spot-checked.

## 1. Fixes first (small PR, independent)

| # | Found in the code | Fix |
|---|---|---|
| F1 | `SUBSIDY_RHO=0.25`; cluster = payout wallet → 3 wallets owning every node earn +20 % per self-paid job | ρ = 0.04; boot assert `0.95 + ρ < 1`; cluster gate kept for decentralization only |
| F2 | A job failing verification re-queues forever; the user's hold never releases (jobs.service.ts:319) | `attempts`; 3 failures → `failed`, hold released |
| F3 | `cupowVerify` re-runs O(n³) on every job | Low priority (n ≤ 256). Later: Freivalds every job, transcript 1 in 20 |
| F4 | "Secrets sealed to the node" — the operator can read them (decrypted into `docker run -e`) | Copy: "Encrypted in your browser so Cloudana can't read them. The node that runs your container can." |

## 2. Verified AI inference

### 2.1 For users
- **OpenAI-compatible**: base URL `https://api.cloudana.io/v1`, a Cloudana API key (`cld_sk_…`).
  `POST /v1/chat/completions` (stream or not), `POST /v1/completions`, `GET /v1/models`.
- Errors in OpenAI's shape and status codes; rate limits as `x-ratelimit-*` headers and 429.
- Every response has `x-cloudana-request`; the receipt shows tokens, fee and check status:
  `unchecked` · `unchecked_no_checker` · `checked_ok` · `checked_failed_refunded`.
- Users pick a model, never a node. Context capped at 8k tokens at launch.
- Shown on the API page: "Your prompt runs on a provider's machine; for about 1 in 20 requests a reference node
  re-reads the answer. Providers can read prompts. Don't send secrets."

### 2.2 Models (pinned allowlist)
`model_registry`: `id`, `hf_repo`, `commit`, `files[{path, sha256}]`, `active_params`, `context_len` (8192),
`license` (Apache-2.0 / MIT only), `engine_digest`, `min_vram_gb`, `status`.
Launch: **one** model — Qwen2.5-7B-Instruct (Apache-2.0; fits 8k × 8 slots on a 24 GB GPU). More models = rows.

### 2.3 Engine (pinned, separate from tenant containers)
- **vLLM** OpenAI server, pinned by image digest. Required capability: `prompt_logprobs` (teacher forcing).
- Runs in its own **engine profile**, not the tenant path: `-p 127.0.0.1:P:8000` (never public), `--gpus device=N`,
  `--cap-drop=ALL --security-opt=no-new-privileges --read-only --shm-size=2g`, weights mounted read-only,
  `HF_HUB_OFFLINE=1`. No tenant code runs, so no storage quota is needed — this works on WSL2 / Docker Desktop and
  plain ext4 Ubuntu.
- The agent downloads `hf_repo@commit`, verifies every file's sha256, starts the engine, reports
  `models[{id, commit, state: downloading|ready|failed}]` and `inferenceSlots` (default 8) in announce.
- Pin changes arrive as signed `pin` messages (existing instruction envelope).

### 2.4 Relay (nodes behind home routers)
- Nodes keep **one outbound WebSocket** to `GET /v1/nodes/relay`. No port forwarding, no public IP.
- A single **`RelayHub` Durable Object** in a **separate, rarely deployed Worker** holds every socket (hibernation),
  the online set and free slots in memory, runs the draw, and proxies the stream. API deploys don't drop streams.
  (Soft limit ~1,000 req/s per object; shard by model later.)
- Auth: challenge-response hello (hub sends a nonce; node signs `RELAY <nonce> <ts>`); accept only bound, unbanned
  nodes at or above `minAgentVersion`. Prompts aren't signed (TLS + nothing executable); the node signs one final
  `{requestId, sha256(outputIds), usage}`.
- Token chunks are batched (~50 ms) to keep WebSocket message billing low.

### 2.5 Assignment
In the hub: weighted random over nodes with the model `ready` and a free slot (weight = free slots), seeded by
`sha256(block hash cached in KV by the minute cron ‖ request id)`; the eligible-set hash is recorded so the draw is
replayable. (The matmul draw stays as is.)

### 2.6 Request lifecycle
- No free slot → **503** + `Retry-After` immediately (no queue).
- No first token within 20 s → retry **once** on another node, only if zero bytes reached the client.
- Node drops mid-stream → SSE `error`, **no charge**.
- Client disconnects → `cancel` to the node; bill the tokens actually generated.
- Billing write: `INSERT OR IGNORE` keyed by request id (under-bill rather than double-bill).
- Holds released in the hub's `finally`; a cron sweeper releases any hold older than 15 min.
- Request body ≤ 1 MB.

### 2.7 Price and billing
- `fee = INFERENCE_BASE_FEE_UCLD (10) + ceil(active_params · (prompt + completion tokens) · price / 1e15)`.
  At launch the inference price is frozen at the matmul launch price (the controller learns it later).
- Token counts from the engine's usage report, bounded (prompt ≤ UTF-8 bytes + template overhead; completion = IDs
  streamed ≤ max_tokens). The check recomputes the prompt count exactly.
- Hold = fee for (prompt bound + (max_tokens ?? min(4096, 8192 − prompt))); capture actual, release the rest.
- Split as every job: 95 % provider, 3 % treasury, 2 % destroyed; lane B (ρ = 0.04) only when `checked_ok` or
  sampled-and-pending. Entries are booked into `epochOf(completed_at + CHECK_WINDOW)`, CHECK_WINDOW = 2 h.

### 2.8 The check
- Drawn at completion: p = **5 %**, raised to **100 %** for a node's first 20 requests and for any request a user
  reports. Only sampled/reported prompts are stored (D1 `check_payloads`, deleted on verdict or after 24 h);
  everything else keeps hashes only.
- Checkers are a **reference pool** (`nodes.reference = 1`: owner and partner fleet nodes), never the provider
  itself. With no other reference node online → `unchecked_no_checker` (honest label, no lane B).
- The checker runs prompt + provider output IDs with `prompt_logprobs = k`, `max_tokens = 1`.
  Greedy positions: the provider's token within δ of the checker's argmax logprob. Sampled positions: within top-k,
  plus a mean-logprob floor. δ, k and the floor are calibrated (§6) before bans are enabled.
- Pass → `checked_ok`. Fail → claw the provider's pending entries for the window, refund the user, ban the node,
  record it in `GET /v1/admin/inference/checks` (admin can unban on appeal). Until calibration is done, a fail only
  **flags**; no claw, no ban.
- Checks run unpaid on reference nodes in v1 (≈1–3 % extra load); no surcharge.
- Third-node majority and canaries are deferred until ≥ 3 independent fleets exist (cheap Sybil wallets defeat them
  today).

### 2.9 Why it holds
A cheat (e.g. a smaller model) is caught with probability ≈ p per request (100 % while new), and loses 2 h of pending
earnings plus the node. A cheating node must therefore cheat less than it earns — i.e. not at all. Collusion needs a
reference node, which the owner or a named partner runs.

## 3. Other services — the simplest honest check

| Service | Today | V4 |
|---|---|---|
| Matmul | cuPOW + Freivalds | Unchanged (F3 later). **Proven.** Lanes A + B. |
| Static hosting | 60 s content-hash probe | Unchanged. **Probed.** Fees only. |
| Containers | reachability probe | + **Report a problem**: triggers a probe; refund the hour only if that probe fails or the hour's probes already failed; else log. Max 5 reports per account per day. **Probed.** Fees only. |
| GPU workstations | reachability probe; GPU self-reported | Same report rule. Label **probed · GPU reported by node** (the GPU can't be proven by the node's CPU matmul; a node's checked inference tokens/s can become GPU evidence later). Fees only. |
| Storage | none | Separate spec after inference. Chunk challenges prove retrievability, never replication. |
| Secrets | encrypted to the node | F4 wording; TEE tier stays planned. |

## 4. Endpoints (v1, complete)

| Endpoint | Auth |
|---|---|
| `POST /v1/chat/completions` (SSE + non-streaming), `POST /v1/completions` | API key |
| `GET /v1/models`, `GET /v1/models/{id}` (price, online capacity) | public |
| `GET /v1/inference/requests?from&to` (doubles as usage export), `GET /v1/inference/requests/{id}` | JWT or key |
| `POST /v1/inference/requests/{id}/report` (user re-sends the prompt; must match its hash; always checked) | JWT |
| `POST /v1/keys`, `GET /v1/keys`, `DELETE /v1/keys/{id}` (rotate = create + delete; shown once; SHA-256 stored; per-key RPM, concurrent streams, daily cap) | JWT |
| `POST /v1/deployments/{id}/report` (probe-gated) | JWT |
| `GET /v1/nodes/relay` (WebSocket: `challenge/hello, req, chunk, done, error, cancel, check, pin, ping`) | node (hello) |
| `POST /v1/nodes/announce` + `models[{id, commit, state}]`, `inferenceSlots` | node |
| `GET /v1/epochs/{n}/jobs`; check counters added to `GET /v1/network` | public |
| `POST /v1/admin/models`, `POST /v1/admin/nodes/{address}/ban` · `/unban`, `POST /v1/admin/keys/{id}/revoke`, `GET /v1/admin/inference/checks` | internal |

Later: `POST /v1/challenges` (outsiders can't check inference without the prompt; matmul certificates are public via
the epoch job list). Not needed: webhooks, key PATCH, CSV export.

## 5. Build order (each step shippable, tested, behind an env flag)
1. **Fixes F1, F2, F4.**
2. **Inference core:** model registry, API keys, pricing, `RelayHub` Worker, agent engine profile + relay client,
   non-streaming completions, billing with holds/sweeper. CI uses a fake engine that returns fixed tokens+logprobs.
3. **Streaming** (SSE), cancel, retry rule, rate limits.
4. **Checks:** sampling, reference pool, teacher-forced verifier, receipts, flag-only mode, admin checks list.
5. **Calibration** on two real GPUs (§6) → enable claw + ban.
6. **Report a problem** (containers, workstations) + epoch job list + network counters.
7. **Console:** Run → **Inference** (playground, keys, receipts, usage); Services labels; docs page.
8. **Storage** (own spec).

## 6. Calibration before bans (O2)
~1,000 honest requests across two GPUs, plus substitution tests (a 0.5B model; a quantized 7B; truncated output).
Choose δ, k and the logprob floor so honest false positives < 0.1 % and every substitution test fails. Publish the
numbers in docs.

## 7. Owner decisions
1. **Workers Paid** plan (~$5/mo) — the relay hub and the API need it.
2. **Launch model:** Qwen2.5-7B-Instruct (Apache-2.0) at 8k context.
3. **Reference pool:** your workstation is the first inference node; checks need a **second** reference GPU node
   (yours or a partner's). Until then receipts honestly say `unchecked_no_checker`.
4. **ρ = 0.04** (F1).
5. The privacy line in §2.1 goes on the API page and in the terms.
