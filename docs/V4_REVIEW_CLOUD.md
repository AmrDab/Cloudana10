# V4 review — cloud / serving (2026-10-10)

Reviewer: cloud engineer (Claude). Reviews docs/V4_VERIFIED_SERVICES.md against the code.

## Findings

1. **BLOCKER: the penalty can't land in time.** The only lever is a whole-epoch `veto` by a 2-of-3 Safe, within 3,600 s of the post (CloudanaSettlementV2.sol:229-232, deploy.ts:100). The keeper posts about 5 minutes after the epoch ends (keeper run.ts:154). A check, a tie-break and a multisig signature won't fit in about an hour, and every veto delays all providers.
   - **Fix:** book inference reward entries into `epochOf(completed_at + CHECK_WINDOW)` (2 h). The delay is the same for everyone, so it leaks nothing.
   - A failed check then claws the still-pending entries in D1 (`clawEntry`, ledger.service.ts:479). No veto is needed.
   - The refund follows: clawed requests drop out of `fees_burned` (ledger.service.ts:358-360; extend that query to the inference table).

2. **BLOCKER: comparing a re-run will flag honest nodes.** vLLM isn't reproducible online across batch compositions (https://docs.vllm.ai/en/latest/usage/reproducibility.html). One measurement got 80 distinct outputs in 1,000 runs at T=0 (https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/). Once two runs diverge, the rest of the outputs can't be compared, so the "top-2 margin" rule rescues only one token.
   - **Fix: teacher forcing.** The checker submits prompt + the provider's output token IDs with `prompt_logprobs=k` and `max_tokens=1` (a vLLM extra parameter).
   - Greedy positions: the provider's token must be within δ of the checker's argmax. Sampled positions: within the top-k, plus a mean-logprob test.
   - No seeds are needed, and the cost is prefill only. Tolerance checks work: https://arxiv.org/html/2501.16007.

3. **HIGH: collusion is free.** Payout wallets cost nothing to create, a 3-node majority falls to Sybil wallets, and canaries are replays a node can recognise by hash: it answers repeats honestly and cheats on new prompts.
   - **v1 fix:** checks run only on a **reference pool** (owner or partner fleet nodes, `nodes.reference=1`). Their verdict is final, with an admin appeal.
   - Drop the third node and canaries until there are ≥3 independent fleets.

4. **HIGH: cold start.** With one node nothing can be checked, so the "spot-checked" label would be false. **Fix:** a receipt status `unchecked_no_checker` and an honest label. Lane B is already zero below `CLUSTER_N_MIN=3` wallets (jobs.service.ts `clusterTest`).

5. **HIGH: the engine can't run on the hardened tenant path.** Containers are refused unless the host uses xfs with project quotas and can install iptables rules as root (hardening.ts:92,143). That excludes WSL/Docker Desktop and ext4 Ubuntu, which is likely the owner's machine. Separately, `-p host:container` binds 0.0.0.0 (container.ts:117), and Docker bypasses ufw, so the engine would become a free public endpoint.
   - **Fix: a separate engine profile.** Pinned digest, `-p 127.0.0.1:P:8000 --gpus device=N --cap-drop=ALL --security-opt=no-new-privileges --read-only --shm-size=2g`, weights mounted `:ro`, `HF_HUB_OFFLINE=1`.
   - No storage quota is needed because no tenant code runs.
   - Allow WSL2: NVIDIA supports Docker Desktop with the Windows driver (https://docs.nvidia.com/cuda/wsl-user-guide/index.html), and vLLM runs on Windows only through WSL.

6. **HIGH: the relay design is fragile.** "Code updates disconnect all WebSockets" (https://developers.cloudflare.com/durable-objects/best-practices/websockets/), so every API deploy would kill every stream. A Durable Object per node also needs a D1 liveness and free-slot registry on every request.
   - **Fix:** one `RelayHub` Durable Object in a **separate, rarely deployed Worker script** (`script_name` binding). It uses WebSocket hibernation and keeps the online set and free slots in memory.
   - The hub runs the draw and proxies the stream.
   - The soft limit is 1,000 requests/s per object (https://developers.cloudflare.com/durable-objects/platform/limits/). Shard by model later.

7. **HIGH: the matmul assignment doesn't fit inference.** It allows one job per node (jobs.service.ts:253), makes a blocking 2 s RPC call for the seed (jobs.service.ts:107), and weights nodes by matmul throughput (jobs.service.ts:240).
   - **Fix:** the hub draws over nodes with a free slot, weighted by slots.
   - Seed = sha256(block hash cached in KV by the minute cron ‖ request id), recorded with the eligible-set hash.

8. **HIGH: the request lifecycle is unspecified.** Proposed rules:
   - **No free slot:** 503 with `Retry-After` right away; no queue.
   - **No first token within 20 s:** retry once on another node, but only if zero bytes have reached the client.
   - **Node drops mid-stream:** send an SSE `error` and charge nothing.
   - **Client disconnects:** `cancel` goes to the node; bill the tokens it actually generated.
   - **Billing record:** an `INSERT OR IGNORE` keyed by request id. Prefer under-billing to double billing.
   - **Holds:** released in the hub's `finally`, with a cron sweeper after 15 minutes.
   - **Body limit:** 1 MB.

9. **MEDIUM: the pricing is off.**
   - A forward pass is about 2P FLOP, which is **P MAC**, not the spec's "2·P MAC" (line 15). As written, inference is double-priced against matmul.
   - `BASE_FEE_UCLD=1000` versus about 0.107 µCLD/token (7.61B at 14,000) means a 1k-token request is about 90% base fee.
   - The price controller counts only matmul (pricing.service.ts:96).
   - Attention adds about 22% to the MAC count at 8k context and about 87% at 32k.
   - **Fix:** units = active_params × tokens, an `INFERENCE_BASE_FEE_UCLD` of about 10, an 8k context cap, and a frozen inference price at launch.

10. **MEDIUM: drop re-tokenization in the Worker.** It would mean a ~7 MB tokenizer in a 128 MB isolate.
    - **Fix:** take the counts from the engine's usage report, with bounds: prompt ≤ UTF-8 bytes + template overhead, and completion = the number of streamed IDs ≤ max_tokens.
    - The check recomputes the prompt count exactly.
    - Hold = fee(prompt bound + (max_tokens ?? min(4096, ctx − prompt))).

11. **MEDIUM: the check surcharge has no accounting.** Nothing says who pays the checker or what gets burned. **Fix:** no surcharge in v1. Teacher-forced checks cost about 1–3% and run on the reference nodes unpaid.

12. **MEDIUM: prompt retention.** The check draw happens at completion, so store only the sampled ~5% and the user-reported requests.
    - Keep them in a D1 `check_payloads` table (rows ≤ 2 MB, https://developers.cloudflare.com/d1/platform/limits/).
    - Delete each one on its verdict, or after 24 h at the latest.
    - All other requests keep hashes only. No R2.

13. **MEDIUM: relay authentication.** Node's built-in WebSocket can't set headers, so the current signed headers don't carry over.
    - **Fix:** a challenge-response hello. The hub sends a nonce, and the node signs `RELAY <nonce> <ts>`. Accept only nodes that are bound, not banned, and at or above `minAgentVersion`.
    - Don't sign every prompt: TLS already authenticates the API, and a prompt can't execute anything. Sign only `pin` messages (model and engine pins) using the existing envelope (instructions.ts).
    - The node signs one final `{requestId, sha256(outputIds), usage}`.

14. **MEDIUM: one `weights_url` and one `sha256` can't describe a Hugging Face model.** A model is several files: config, tokenizer, chat template and shards. **Fix:** pin `hf_repo@commit` plus a per-file sha256 manifest. The agent reports `models[].state` (downloading, ready or failed) in announce.

15. **MEDIUM: API keys need limits.**
    - Per-key requests per minute and concurrent streams, enforced in the hub, plus a per-account daily cap, with 429 responses.
    - Key prefix `cld_sk_` and last-4 display.
    - OpenAI status codes and error shape. Today `fail()` returns `{status, error:{code,message}}` (lib/http.ts:52).
    - An acceptable use policy and admin revoke.

16. **MEDIUM: "Report a problem" gives away compute.** A cap of 3 per deployment allows unlimited refunds across unlimited deployments. **Fix:** a report triggers a probe. Refund only if that probe fails or the hour's probes already failed; otherwise log it. Cap reports per account.

17. **MEDIUM: the workstation GPU check can't be built as written.** The agent's matmul is CPU JavaScript (node-agent/src/index.ts:267; pouw has no CUDA code), and `nvidia-smi` can be faked. **Fix:** cut it from V4 and label "GPU reported by node". A node's verified inference tokens/s can serve as the GPU evidence later.

18. **LOW:**
    - Storage challenges prove retrievability, not local copies or replicas. Never claim replication.
    - F1 and F2 are correct (wrangler.toml `SUBSIDY_RHO="0.25"`; jobs.service.ts:319). F3 isn't urgent at n ≤ 256.
    - Durable Objects run on the Free plan (SQLite-backed), but the API needs Paid for CPU anyway (https://developers.cloudflare.com/workers/platform/limits/).
    - Incoming WebSocket messages are billed 20:1, so batch token chunks about every 50 ms.
    - Launch model: Qwen2.5-7B (Apache-2.0) is 15.2 GB in bf16 + 56 KiB of KV cache per token, which fits 8k × 8 slots on 24 GB.

## (a) Endpoints for v1

| Endpoint | Auth |
|---|---|
| `POST /v1/chat/completions` (SSE and non-streaming), `POST /v1/completions` | key |
| `GET /v1/models`, `GET /v1/models/{id}` (price, online) | public |
| `GET /v1/inference/requests?from&to` (this is the usage export), `GET /v1/inference/requests/{id}` | JWT/key |
| `POST /v1/inference/requests/{id}/report` (re-sent prompt must match its hash; always checked) | JWT |
| `POST/GET /v1/keys`, `DELETE /v1/keys/{id}` (rotate = create + delete) | JWT |
| `POST /v1/deployments/{id}/report` (probe-gated) | JWT |
| `GET /v1/nodes/relay` (WebSocket; messages `challenge/hello, req, chunk, done, error, cancel, check, pin, ping`) | node |
| `POST /v1/nodes/announce` + `models[{id, revision, state}]`, `inferenceSlots` | node |
| `GET /v1/epochs/{n}/jobs`; check counters inside `GET /v1/network` (replaces `/verification/stats`) | public |
| `POST /v1/admin/models`, `/admin/nodes/{a}/ban\|unban`, `/admin/keys/{id}/revoke`, `GET /v1/admin/inference/checks` | internal |

- **Later:** `POST /v1/challenges` and its resolve endpoint. Outsiders can't check inference without the prompt.
- **Not needed:** webhooks, `PATCH /keys`, a separate CSV export.
- Rate limits need no endpoint: return `x-ratelimit-*` headers and 429.

## (b) Recommended decisions for O1–O4

- **O1:** vLLM, pinned by digest, with prompt log-probs required in v1. llama.cpp documents token probabilities only for generated tokens (https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md). Don't rely on `VLLM_BATCH_INVARIANT` (beta, slower).
- **O2:** the teacher-forced δ/top-k rule. Calibrate it on two GPUs with about 1,000 honest requests plus substitution tests (a 0.5B model and a quantized 7B). Bans stay off until the false-positive rate is below 0.1%.
- **O3:**
  - One hub in a separate script.
  - Messages up to 32 MiB and 30 s CPU each.
  - No wall-clock limit on streams.
  - 1 MB request body and 8 slots per node.
- **O4:** the bond is CHECK_WINDOW (2 h) of pending earnings. p = 5%, but 100% for a node's first 20 requests and for every reported request.

## (c) What the lead got wrong

The findings above cover each one in detail:
- "2·P MAC" (#9)
- exact-match / top-2 agreement (#2)
- veto as the routine penalty (#1)
- separate payout wallets and canaries as the guard against collusion (#3)
- re-tokenizing (#10)
- storing every prompt (#12)
- signing every relay message (#13)
- a single-file `weights_url` (#14)
- the engine on the tenant hardening path (#5)
- a GPU check built on CPU matmul (#17)

Missing from the spec: concurrency per node, time-to-first-token and cancel rules, a context cap, rate limits, and the base fee dominating small requests.
