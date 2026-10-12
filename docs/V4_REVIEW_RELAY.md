# V4 review — relay and GPU endpoints (spec v3 §2, §3, §6)

Cloud engineer (Claude), 2026-10-12. Reviews only what is new in v3, checked against `v4-step2`.

## Verdict

v3 is buildable after two blocker fixes and one topology change:

- **B1 (blocker):** the hardened path drops container replies to the agent (§4).
- **B2 (blocker):** §3.4's "no first byte in 20 s → retry" runs every `stream:false` completion over 20 s twice. vLLM sends headers only when generation ends.
- **Change:** one Durable Object **per node**, not one hub. My F6 single hub served a shared inference pool; user endpoints are pinned to replicas, and the route lookup already names the node.

## 1. Plan and topology

**Facts:**
- Free plan: SQLite-backed Durable Objects with hibernation; 100k DO requests/day, 13,000 GB-s/day, 5 GB ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)); Workers 100k requests/day per account, 10 ms CPU ([limits](https://developers.cloudflare.com/workers/platform/limits/)).
- Hibernation clears memory, and a class deploy drops every socket ([websockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)).
- `script_name` binds a class from another Worker ([wrangler](https://developers.cloudflare.com/workers/wrangler/configuration/)).

**Paid is mandatory.** Heartbeats alone use 5,760 requests per node per day, which exhausts Free at about 17 nodes.

**Recommendation:**
- **New script `cloudana-relay`.** It exports `RelayNode` (`new_sqlite_classes`) on custom domain `relay.cloudana.io`. Nodes connect directly, so API deploys never touch a socket.
- **One object per node, `idFromName(nodeAddress)`, holding one socket.** No routing table, nothing to rebuild after hibernation, no global 1,000 req/s ceiling, and failures stay per node.
- **Bindings.** The gateway and the API bind it with `script_name`. The API uses it for probes and to `kick` a node on unbind or ban.
- **Ticket auth.**
  - The node calls `POST /v1/nodes/relay/ticket`. `requireNode` already checks signature, nonce, binding and version.
  - The API returns `HMAC(secret, node‖exp60s‖nonce)`.
  - The node opens `wss://relay.cloudana.io/connect?ticket=…`.
  - Each ticket is accepted once and replaces the node's previous socket.

## 2. Hostnames and TLS

Universal SSL covers only the apex and first-level names. Deeper names need Advanced Certificate Manager, about $10/month ([limitations](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/), [ACM](https://developers.cloudflare.com/ssl/edge-certificates/advanced-certificate-manager/)).

**Recommendation: a separate user-content domain**, e.g. `cloudana.run`, as a second Free zone.
- Every kind is served at `https://<id>.cloudana.run`, under a free wildcard, one route and one gateway.
- Phishing reputation and cookies stay off `cloudana.io`, which hosts the console and API.
- Skip ACM, `*.sites` and `*.run`.
- Submit the domain to the Public Suffix List later.

**Path-based routing: reject.**
- On one origin, any tenant's JS reads every tenant's storage and cookies, and one service worker can hijack all tenants.
- The only fix is `sandbox` without `allow-same-origin`, which breaks Open WebUI and ComfyUI. Both also assume they are served at `/`.
- If forced: sandbox everything, strip `Set-Cookie` and `Service-Worker-Allowed`, and return 403 for `Service-Worker: script`.

**Gateway on the new domain:**
- Static sites keep the sandbox (gateway/src/index.ts:183).
- Containers and endpoints run unsandboxed, since each one is its own origin.
  - Allow all methods (`:122` allows GET/HEAD only).
  - Forward `content-type`, `cookie` and `authorization`, minus a `cld_ek_` key.
  - Strip `Domain` from `Set-Cookie`.

## 3. Relay protocol

**Frames.** JSON control travels as text frames. Body data travels as binary frames of the form `u32 stream ‖ ≤64 KiB`.

**Messages:**
- `req` (hub→node): `s, dep, m, path, h[]`; body frames follow, then `end`.
- `res` (node→hub): `s, status, h[]`.
- `end` and `err` (both directions): `s, code`, where code is `not_serving`, `upstream`, `too_large` or `timeout`.
- `cancel` (hub→node): `s`.
- `ack` (both directions): `s, n`.
- `ping`: answered by `setWebSocketAutoResponse`, which doesn't wake the object.

**Rules:**
- **Streams.** The hub assigns stream ids. Each node gets at most 64 open streams, then 503.
- **Backpressure.** At most 512 KiB may be unacknowledged per stream and direction. The object acks when `write()` into the gateway's `TransformStream` resolves, so slow clients can't exhaust its 128 MB.
- **Batching.** The node batches for 50 ms or 64 KiB, because incoming messages are billed.
- **Body caps.** Bodies stream, capped at 1 MB for sites and 16 MB for endpoints.
- **Routing.** The gateway's route, cached 30 s, returns `nodes[]`. The agent maps `dep` to its own port. An unknown `dep` returns `not_serving`, and the gateway tries the next replica.
- **Socket loss.** Streams die with their socket; nothing resumes after a reconnect. GET/HEAD without a `res` yet are retried on the next replica. Everything else gets 502 or an aborted body.
- **Timeouts.** The response head must arrive within 30 s for sites and 300 s for endpoints. The idle limit is 300 s. Retry only before the node accepted the request (B2).

## 4. Agent and code dependencies

**Agent:**
- **WebSocket.** Node 22 has a global `WebSocket`: unflagged in 22.0, stable in 22.4 ([globals](https://nodejs.org/docs/latest-v22.x/api/globals.html)). The image runs 22.12; bump `@types/node` from ^20.
- **Keepalive.** It can't send headers or ping frames, so the ticket rides in the URL and the agent pings every 30 s, reconnecting (1–30 s jittered backoff, fresh ticket) if no pong arrives within 10 s.
- **Forwarding.** Use `http.request` to `127.0.0.1:<record port>`. Don't use `fetch`, because undici decompresses bodies.
- **Network.** The agent needs the host network namespace (`--network host`; the DaemonSet already sets `hostNetwork`).

**B1.** `INPUT -s <tenant subnet> -j DROP` (hardening.ts:100) is inserted first, so it drops container replies to the host. Both docker-proxy on `127.0.0.1:P` and container-IP connections hang.
- Use `-m conntrack ! --ctstate ESTABLISHED,RELATED -j DROP`.
- Delete the old rule on upgrade and fix security.selftest.
- Require Docker ≥ 28: older versions expose 127.0.0.1-published ports to the LAN ([Docker](https://www.docker.com/blog/docker-engine-28-hardening-container-networking-by-default/)).

**Code to change:**
- **Agent:** hosting.ts:120, :131 listen on `127.0.0.1`; container.ts:117 and workstation.ts:163 publish `-p 127.0.0.1:P:C`; workstation.ts:167 SSH stays public on public-IP nodes only; deployments.ts:117-119, :298 and workstation.ts:182-192 report no `publicHost:port` endpoint for relayed kinds.
- **Status reports** (deployment-duties.service.ts:589-606): apply the public and `public_host` checks to `sshEndpoint` only. At :608, accept `running` without an endpoint.
- **Probes** (deployment-duties.service.ts:311-365): probe through the node's object and drop the :359 filter.
- **Assignment** (deployment-duties.service.ts:195 and :217, nodes.ts:104-108): require a connected relay, sent as a `relay` heartbeat flag, instead of `publicHost == client IP`. Otherwise a broken socket strands work as `unreachable`, because G1 re-queues only dead nodes.
- **Host lock** (nodes.ts:112-118): applies to SSH nodes only.
- **Route** (deployments.service.ts:77 and :455-469, routes/v1/deployments.ts:254-286): the public route leaks the node's IP and port. Return `{kind, state, nodes[], auth, keyHashes[]}` behind `X-Internal-Key`.
- **Worker bindings** (worker.ts:24-35 and :57): pass the DO binding through; only string bindings are bridged today.
- **Gateway:** gateway/src/index.ts:43, :122 and :137-168, plus wrangler.toml.

## 5. First GPU node

**Setup.** Ubuntu, or WSL2 running **Docker Engine inside the distro** (not Docker Desktop):
- Put `data-root` on a preallocated xfs image, loop-mounted with `pquota`.
- Run the agent as root on the host network.
- WSL's 6.6 kernel builds in `XFS_FS`, `XFS_QUOTA` and loop ([config-wsl](https://raw.githubusercontent.com/microsoft/WSL2-Linux-Kernel/linux-msft-wsl-6.6.y/arch/x86/configs/config-wsl)).
- No code change is needed.

**Don't let owner-fleet nodes skip the quota.** A tenant could fill Windows' C: drive through `ext4.vhdx`.

**No named volumes for endpoints.** `--storage-opt` caps only the writable layer, and volumes are created uncapped (container.ts:154).

## 6. §6 table

- **Replace** `GET /v1/nodes/relay` with `POST /v1/nodes/relay/ticket` plus `wss://relay…/connect`. Drop `challenge/hello` and `open`.
- **Cut** from steps 2–3: `check`, `pin`, `…/requests`, `…/report`, `epochs/{n}/jobs`, `/reference`, `/admin/checks`.
- **Add** `GET /v1/deployments/{id}/logs?tail=200`. Images users bring can't be debugged without it.
- **Add** `health.startupGraceSec` (default 900). Otherwise model loading fails probes and the replicas thrash.
- **Replicas:** one deployments row each (shared `group_id`), run on the workstation GPU path, since GPU accounting keys off `workstation` (deployment-duties.service.ts:151; agent deployments.ts:286-288). A replaced replica waits for a re-seal. Key limits are per replica at limit ÷ replicas.
