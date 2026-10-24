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

Build contract: [V4_RELAY_CONTRACT.md](V4_RELAY_CONTRACT.md); reviewed in [V4_REVIEW_RELAY.md](V4_REVIEW_RELAY.md).
- Each node keeps **one outbound WebSocket** to `wss://relay.cloudana.io/connect`, opened with a single-use 60 s
  ticket from `POST /v1/nodes/relay/ticket` (the existing signed node request; HMAC shared by API and relay).
- **One `RelayNode` Durable Object per node** (`idFromName(nodeAddress)`) in a separate, rarely deployed Worker
  (`cloudana-relay`). The gateway and the API reach it through a `script_name` binding: the gateway to proxy visitor
  traffic, the API to probe. API deploys never drop a socket.
- Framing: JSON control (`req/res/end/err/cancel/ack`), binary body frames ≤ 64 KiB tagged with a stream id, 512 KiB
  window per stream, ≤ 64 streams per node, head timeout 30 s (sites) / 300 s (endpoints), retry on another node
  only for GET/HEAD that never reached an app.
- The database decides who serves what: the gateway's route lookup (now internal, `X-Internal-Key`) names the node;
  a node answers only for deployments it runs. The public route no longer leaks node IPs.
- Nodes announce the `relay` capability; a relay node takes new work only while its `relay: true` heartbeat is fresh
  and needs **no public IP**. Containers publish on `127.0.0.1` only. Legacy direct nodes keep working unchanged.
- **User content moves to its own domain** (e.g. `<id>.cloudana.run`): free one-level wildcard certificate, cookies
  and phishing reputation kept off `cloudana.io`. Path-based routing was rejected (shared origin).

## 3. GPU endpoints (the AI product)

### 3.1 What the user deploys
A deployment of kind **`endpoint`**: the user's image (vLLM, Ollama, TGI, ComfyUI, their own server…), env and sealed
secrets (their model source, tokens), a GPU spec (count, min VRAM, class — as workstations), `port`, `health` path,
`replicas` (1–N, fixed in v1), and `auth: "public" | "key"`.
They get `https://<id>.<user-content domain>`. Requests are spread over the running replicas by the gateway.

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
| int8 MLP block (`int8-mlp`, user's weights) | §5a: commit to 4 segments, 2 opened per job (Freivalds per GEMM, recompute per elementwise step) | **proven per segment, sampled 2 of 4**, lanes A+B |
| Static hosting | content-hash probe (through the relay) | **probed**, fees only |
| Containers / GPU endpoints | health probe through the relay; you pay for time a probe saw it working: an outage (since the last passing probe) is not charged; **Report a problem** probes now and, if that fails, leaves the time since the last passing probe uncharged; ≤ 5 reports/account/day | **probed**, fees only |
| Verified endpoints | §4 | **spot-checked**, lanes A+B |
| GPU workstations | reachability probe; report rule as above | **probed · GPU reported by node** |
| Storage | separate spec; chunk challenges prove retrievability, never replication | **challenged** (later) |
| Secrets | encrypted in the browser to the node; the node can read them (F4) | TEE tier planned |

## 5a. Segment verification (ENGINEERING_BACKLOG B-26, Phase 0)

One interface for every deterministic job (`shared/verification.ts`). The work type fixes a plan of segments — each a
`gemm` (Out = A·B + bias), an `elementwise` step or an `opaque` one — and the node never chooses kinds, ops or wiring.
The node commits to the hash of every segment's output, folded with σ, the hash of the job's own inputs and the plan
into one chain root. Only after that commitment is stored does the API draw which segments to open (HMAC keyed from a
secret the node does not hold, over job, σ and chain root; one commitment per assignment, so no grinding). The node
then serves the tensors each drawn segment reads and writes; every one must have its exact dtype and shape and hash to
the commitment; a gemm is checked by Freivalds (O(n²), with every entry bounded so the mod-p check is exact), an
elementwise step is recomputed; job inputs always come from the job. A wrong, mismatched or late opening is a failed
check: the job fails, the owner pays nothing, all held pay of the wallet bound at commit time is clawed and the node is
suspended (the B-6 mechanism, unchanged). matmul is the degenerate case: one gemm checked on every job, its cuPOW
transcript an opaque segment opened 1 in `VERIFY_SAMPLE_K`.

What each label claims:

| Label | Means | Where |
|---|---|---|
| **proven** | the answer is checked on every job, and the work behind it is re-executed on a sample with a claw | matmul |
| **proven per segment, sampled s of m** | every opened segment is checked exactly; a single wrong segment is caught with probability s/m per job (int8-mlp: ½), with the claw over 24 h of held pay making cheating negative-EV | int8-mlp |
| **spot-checked** | a statistical comparison against a reference (tolerances), not an exact check | verified endpoints (§4) |
| **attested** | the node or its hardware says so; nothing re-checks it | GPU model reported by the node; a TEE tier later |
| **probed** | a probe saw it working at that moment; time is charged only between passing probes | hosting, containers, workstations |

"Proven" covers the integer kernel only (int8 weights and activations, int32 accumulation, fixed requantization) — not
float engines (B-19) and not containers. Cloudana picks no model: the job carries the user's weights, scales and table.

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
3. ~~**GPU endpoints:** kind `endpoint`, replicas, endpoint keys, health probes, per-replica-hour billing~~ — built
   ([V4_ENDPOINTS_CONTRACT.md](V4_ENDPOINTS_CONTRACT.md)); served at `https://<id>.<user-content domain>` like
   everything else (§8.2), not `*.run.cloudana.io`.
4. **Verified mode:** pinned open models, sampling, reference pool, teacher-forced checker, receipts, flag-only.
5. **Calibration** on two GPUs (~1,000 honest requests + substitution tests; false positives < 0.1 %) → enable
   claw + ban.
6. ~~**Report a problem** + epoch job list~~ — built (`POST /v1/deployments/{id}/report`: an immediate probe through
   the relay; a failed probe leaves the time since the last passing probe uncharged — failing a check on purpose
   gains about a minute, not the hour; `GET /v1/epochs/{n}/jobs`). Recovering from unreachable now bills the time
   served before the outage (it used to forgive the whole partial hour). The check counters in `GET /v1/network` come with verified mode (step 4).
7. ~~**Console:** Run → **Endpoints** tab (deploy, keys, URL, health, logs, cost); Services labels; docs~~ — live
   2026-10-14.
8. **Storage** (own spec).

## 8. Owner decisions
1. **Workers Paid** (~$5/mo) — needed before ~17 nodes (free plan: 100k requests/day; heartbeats alone use 5,760 per
   node). Durable Objects themselves run on the free plan.
2. **A user-content domain** (e.g. `cloudana.run`, ~$10/yr) as a second free Cloudflare zone; every deployment is
   served at `https://<id>.<domain>`. Until then nothing user-facing is publicly reachable through the relay.
3. **Secrets you set yourself:** `RELAY_TICKET_SECRET` (same value on `cloudana-api` and `cloudana-relay`) and
   `INTERNAL_API_KEY` on `cloudana-gateway` (same value as the API's).
4. **First GPU node:** Ubuntu, or WSL2 with Docker Engine inside the distro (not Docker Desktop), Docker ≥ 28,
   Docker's data root on an xfs image with `pquota`; the agent runs as root on the host network
   ([V4_REVIEW_RELAY.md](V4_REVIEW_RELAY.md) §5). No quota exceptions for owner nodes.
5. Verified mode needs a **second reference GPU node** before checks run; until then endpoints are honestly *probed*.
