# V4 — infrastructure for AI: GPU endpoints, opt-in verification, honest service checks

Status: **spec v3 for owner approval** · 2026-10-11 · lead: senior blockchain engineer (Claude).
v1 was dissected by the cloud engineer ([V4_REVIEW_CLOUD.md](V4_REVIEW_CLOUD.md), 18 findings, all accepted).
v3 follows the owner's correction: **Cloudana doesn't run AI models; it provides the infrastructure that powers AI.**
Users bring their own model, engine and image. Cloudana schedules it on GPUs, gives it an address, checks it and
bills it. Step 1 (fixes F1, F2, F4) is merged (PR #18).

---

## 0. Five rules

1. **Bring your own AI.** Cloudana never picks, hosts-as-a-product or brands a model. A user's model runs in the
   user's container on an assigned GPU node — like any cloud, minus the marketplace.
2. **One way in.** Every deployment — static site, container, workstation, GPU endpoint — is reachable through one
   relay, so home nodes need no public IP, no port forwarding and no open ports.
3. **One penalty: delayed earnings.** Where work is checked, earnings are booked 2 h after the work (same delay for
   everyone); a failed check removes the still-pending entries (`clawEntry`, exists), refunds the user and bans the
   node. No staking, no veto, no contract change.
4. **One subsidy rule:** `0.95 + ρ < 1` → ρ capped at 0.04 (**done**, F1).
5. **Honest labels.** *Proven* (matmul) · *spot-checked* (verified endpoints) · *probed* (everything else) ·
   *challenged* (storage, later). Fees only unless proven or spot-checked.

## 1. Fixes (step 1 — merged)
F1 subsidy cap · F2 failed jobs release their hold after 3 attempts · F4 honest secrets copy. F3 (Freivalds on every
job, full transcript 1 in 20) stays low priority.

## 2. The relay — one way in for every deployment

- Each node keeps **one outbound WebSocket** to `GET /v1/nodes/relay`.
- A single **`RelayHub` Durable Object**, in a separate, rarely deployed Worker, holds every socket (hibernation),
  tracks which deployments each node serves, and carries HTTP requests and responses (including SSE streaming) over
  the socket. API deploys don't drop connections.
- The gateway (`*.sites.cloudana.io`, plus a new `*.run.cloudana.io` for endpoints) sends traffic **through the hub**
  instead of to `http://<node-ip>:<port>`. The agent forwards to the container's port on localhost.
- Auth: challenge-response hello (hub nonce; node signs `RELAY <nonce> <ts>`); only bound, unbanned nodes at or
  above `minAgentVersion`. Pins and stop/start orders keep the existing signed-instruction envelope.
- Limits: 1 MB request body (raise per plan later), chunks batched ~50 ms, soft cap ~1,000 req/s per hub (shard by
  region later).
- Side effect: static hosting and containers on home nodes stop needing a public host, and the "endpoint host must
  equal the announced IP" rule becomes unnecessary.

## 3. GPU endpoints (the AI product)

### 3.1 What the user deploys
A deployment of kind **`endpoint`**: the user's image (vLLM, Ollama, TGI, ComfyUI, their own server…), env and sealed
secrets (their model source, tokens), a GPU spec (count, min VRAM, class — as workstations), `port`, `health` path,
`replicas` (1–N, fixed in v1), and `auth: "public" | "key"`.
They get `https://<id>.run.cloudana.io`. Requests are load-balanced across replicas by the hub.

### 3.2 Keys for the user's endpoint
`auth: "key"` → the gateway requires `Authorization: Bearer cld_ek_…` (keys the owner creates per endpoint; stored as
SHA-256; per-key requests/min and concurrent streams; `x-ratelimit-*` headers, 429). Cloudana never sees the model's
own keys unless the user seals them in.

### 3.3 Placement, isolation, billing
- Tenant code → the **hardened container path** (fleet nodes, cap-drop, no-new-privileges, tenant network, image
  allowlist relaxed to the user's image only on fleet nodes that opt in). Ports are published to **127.0.0.1** only;
  traffic arrives through the relay.
- Billing: **per replica GPU-hour** at the existing workstation prices (consumer / datacenter GPU classes, CPU/RAM,
  interruptible discount). Health probes go through the relay; failing replicas stop billing and are replaced.
- Fees only (lane A + treasury) unless verified (§4).
- Privacy line on the deploy form: "Your container runs on a provider's machine; providers can see what it
  processes. Use verified mode or confidential compute (planned) for sensitive data."

### 3.4 Request lifecycle (through the hub)
No healthy replica → 503 + `Retry-After`. No first byte in 20 s → retry once on another replica if nothing reached
the client. Replica drops mid-stream → error to client. Client disconnects → cancel forwarded. Request bodies ≤ 1 MB
in v1.

## 4. Verified mode (opt-in, for open models)

For users who want proof their endpoint really ran *their* model:
- The endpoint declares `verify: { hfRepo, commit, files: [{path, sha256}] }` and uses an OpenAI-compatible engine
  with prompt log-probs (vLLM). The node verifies the weight hashes before starting.
- The hub samples **5 %** of requests (100 % for a node's first 20) and stores only those prompts + responses
  (D1 `check_payloads`, deleted on verdict or after 24 h).
- A **reference node** (owner/partner fleet, `nodes.reference = 1`, never the provider) replays prompt + returned
  tokens through the same pinned model with `prompt_logprobs` (teacher forcing, prefill only). Greedy tokens must be
  within δ of the argmax; sampled tokens within top-k plus a mean-logprob floor.
- Pass → `checked_ok`. Fail → claw the provider's pending entries for the window, refund, ban; until calibration
  (§7) a fail only **flags**. No reference node online → `unchecked_no_checker` (honest label).
- Verified hours are booked 2 h late and qualify for lane B (ρ ≤ 0.04). No surcharge in v1.
- Third-node majority and canaries wait for ≥ 3 independent fleets.

## 5. Other services — the simplest honest check

| Service | Check | Label |
|---|---|---|
| Matmul | cuPOW + Freivalds | **proven**, lanes A+B |
| Static hosting | content-hash probe (through the relay) | **probed**, fees only |
| Containers / GPU endpoints | health probe through the relay; **Report a problem** refunds the hour only if a probe it triggers fails (or the hour's probes already failed); ≤ 5 reports/account/day | **probed**, fees only |
| Verified endpoints | §4 | **spot-checked**, lanes A+B |
| GPU workstations | reachability probe; report rule as above | **probed · GPU reported by node** |
| Storage | separate spec; chunk challenges prove retrievability, never replication | **challenged** (later) |
| Secrets | encrypted in the browser to the node; the node can read them (F4) | TEE tier planned |

## 6. Endpoints (complete for v1)

| Endpoint | Auth |
|---|---|
| `POST /v1/deployments` (+ kind `endpoint`, `replicas`, `auth`, `health`, optional `verify`) · existing GET/PATCH/DELETE | JWT |
| `POST /v1/deployments/{id}/keys` · `GET …/keys` · `DELETE …/keys/{keyId}` (endpoint keys, shown once) | JWT |
| `GET /v1/deployments/{id}/requests` (verified mode: sampled requests + check status) | JWT |
| `POST /v1/deployments/{id}/report` (probe-gated refund) | JWT |
| `https://<id>.run.cloudana.io/*` · `https://<id>.sites.cloudana.io/*` (through the hub) | endpoint key or public |
| `GET /v1/nodes/relay` (WebSocket: `challenge/hello, open, req, chunk, end, error, cancel, check, pin, ping`) | node hello |
| `POST /v1/nodes/announce` + `relay: true`, `models[{hfRepo, commit, state}]` for verified mode | node |
| `GET /v1/epochs/{n}/jobs`; check counters in `GET /v1/network` | public |
| `POST /v1/admin/nodes/{address}/ban` · `/unban` · `/reference`, `POST /v1/admin/deployments/{id}/keys/{keyId}/revoke`, `GET /v1/admin/checks` | internal |

Later: `POST /v1/challenges`; autoscaling and scale-to-zero; per-request billing; webhooks.

## 7. Build order (each step shippable, tested, behind a flag)
1. ~~Fixes F1, F2, F4~~ — merged.
2. **Relay hub + agent relay client + gateway through the hub** — first proven with static sites and containers
   (works on home nodes with no public IP).
3. **GPU endpoints:** kind `endpoint`, replicas, endpoint keys, health probes, per-replica-hour billing,
   `*.run.cloudana.io`.
4. **Verified mode:** pinned open models, sampling, reference pool, teacher-forced checker, receipts, flag-only.
5. **Calibration** on two GPUs (~1,000 honest requests + substitution tests; false positives < 0.1 %) → enable
   claw + ban.
6. **Report a problem** + epoch job list + network counters.
7. **Console:** Run → **Endpoints** tab (deploy, keys, URL, health, logs, cost); Services labels; docs.
8. **Storage** (own spec).

## 8. Owner decisions
1. **Workers Paid** (~$5/mo) for the relay hub (Durable Objects) and API CPU.
2. Two new hostnames on the existing zone: `*.run.cloudana.io` (endpoints) — DNS + route, done by you in Cloudflare.
3. **First GPU node:** your workstation (in your own fleet). Open item: WSL2/ext4 hosts fail today's storage-quota
   check for tenant containers; options are an xfs data disk, or allowing owner-fleet nodes to run without the quota.
4. Verified mode needs a **second reference GPU node** before checks run; until then endpoints are honestly *probed*.
