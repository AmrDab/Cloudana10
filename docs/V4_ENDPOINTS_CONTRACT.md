# V4 GPU endpoints — build contract (step 3)

Source: [V4_VERIFIED_SERVICES.md](V4_VERIFIED_SERVICES.md) §3, §6, §7. Built on the relay (step 2,
[V4_RELAY_CONTRACT.md](V4_RELAY_CONTRACT.md)). Cloudana runs no model: the user brings the image.

## What an endpoint is
`POST /v1/deployments` with `kind: "endpoint"` and an `EndpointSpec`:

| field | meaning |
|---|---|
| `image`, `command?`, `env?`, `cpu`, `memMb`, `storageMb`, `user?`, `expectsSecrets?` | as a container |
| `gpu?: { count, minVramGb?, class? }` | GPUs per replica (as workstations) |
| `port` | the container port the server listens on |
| `health?: { path?, startupGraceSec? }` | GET `path` (default `/`) must answer 2xx/3xx before a replica is *running*; grace default 600 s, max 1800 s |
| `replicas` | 1–8, fixed for the endpoint's life |
| `auth` | `"key"` (default): visitors need `Authorization: Bearer cld_ek_…`; `"public"`: anyone |

**One endpoint = one parent row + `replicas` child rows.** Each child is an ordinary relayed container
(`deployments.parent_id` = the endpoint; the parent has `replicas > 0`), so placement, probes, billing, re-queueing
and the node protocol are the ones that already exist. The parent never reaches a node; its stored status is
`queued` while alive, else `stopped`/`failed`, and the status the API shows is derived from its replicas.

## Placement
A replica goes to a **relay** node (requests are POSTs; the direct path is GET/HEAD only) that announced `container`
(fleet), `gpu` when GPUs are asked for, and `any-image` when the image is not on the curated list; never to a node
already running a sibling replica. `any-image` is announced by agents started with `CLOUDANA_ANY_IMAGE=1`.

## Health, running, replacement
The agent reserves GPUs (`--gpus "device=…"`, `--shm-size=1g`), starts the container and polls the health path on
127.0.0.1 until it answers (then reports `running`; billing starts there — model loading is not billed) or the grace
expires / the container exits (then `failed`, with the last lines of `docker logs` as `logs`; shown on
`GET /v1/deployments/{id}` of the endpoint under each replica, and of the replica itself). A stop that arrives while
a replica is still waiting for its health path cancels the wait. The orchestrator probes the health path through
the relay every `DEPLOY_PROBE_SECONDS`; a probe the hub refused as `busy` (every stream of the replica in use) or that
never reached the node counts for nothing. After `DEPLOY_PROBE_FAILS` real misses a replica is **re-queued** at once
(replaced) instead of sitting *unreachable*: the failing node is owed a stop and skipped for that replica, and the
part of the hour it served is billed (so a health path that fails at minute 57 buys no free GPU time).
Nodes below agent 1.3.0 get no work: older agents ignore `gpu` and `health` (1.2.0) or pick GPUs without the tier (1.3.0, shared/gpu-tier.ts).

## Billing
Per replica-hour at the container price plus `gpu.count × PRICE_GPU_{CONSUMER|DATACENTER}_UCLD_PER_HOUR`.
`replicas × price` is held at create. Fees only (lane A + treasury).

## Keys
`POST /v1/deployments/{id}/keys {name}` → `{ id, name, key, prefix, createdAt }` — the key `cld_ek_<48 hex>` is shown
once; the API stores its SHA-256. `GET …/keys` lists `{ id, name, prefix, createdAt, revokedAt }`; `DELETE
…/keys/{keyId}` revokes. ≤ 20 keys per endpoint.

## The route the gateway reads (internal)
`GET /v1/deployments/{id}/route` → `{ id, state, kind: "static"|"container"|"endpoint", workstation, relayed,
targets: [{ node, dep }], endpoint, auth?, keys?: [sha256 hex] }`. `targets` are the running replicas (the gateway
sends `x-relay-dep: dep` to node `node`). Cached 30 s: a revoked key can work for up to 30 s more.

## Gateway behaviour for endpoints
- `auth: "key"`: no/unknown bearer → `401 {"error":{"code":"unauthorized"}}` with `WWW-Authenticate: Bearer`. The
  Cloudana key is stripped before forwarding (the app's own `Authorization`, if any, is the app's business under
  `auth: "public"`).
- Per-key rate limit through the Workers rate-limiting binding `KEY_LIMIT` (600 requests / 60 s per key, in
  `gateway/wrangler.toml`; absent in tests/local) → `429 {"error":{"code":"rate_limited"}}` + `Retry-After`.
- Load balancing: a random replica first, then the others. A request is retried on another replica only when the
  relay says it never reached an app (`offline` / `not_serving` / `busy`): always for GET/HEAD; for other methods
  when the body is ≤ 1 MB (buffered for the retry). Larger bodies stream to one replica, no retry. Timeouts are never
  retried (the app may have done the work).
- No running replica → `503 {"error":{"code":"unavailable","state":…}}` + `Retry-After: 30`. Errors are JSON for
  endpoints, HTML pages for sites.

## Deviations from the spec, on purpose
- Replicas are child rows, not a replica table: one lifecycle, no second state machine.
- Per-key custom limits and concurrent-stream limits: one global per-key limit; concurrency is bounded by the relay
  (`MAX_STREAMS_PER_DEP`). Custom limits later.
- No admin key revoke (`POST /v1/admin/deployments/{id}/stop` covers abuse). `GET …/requests`, `POST …/report`: steps 4
  and 6.
- Logs: a `failed` report carries the container's tail (kept on the row); `GET /v1/deployments/{replicaId}/logs?tail=N`
  reads the last lines live from the node through the relay (reserved dep `agent`, agents ≥ 1.6.0;
  docs/V4_RELAY_CONTRACT.md "Reserved deployment ids"). No streaming yet.
- Sealed secrets are per replica (each is sealed to its node's key): `PATCH /deployments/{replicaId}/secrets`. The
  detail view carries `awaitingSecrets` and, once a node with a key holds a replica, that replica's `nodePubkey`; the
  console seals every environment value this way (`expectsSecrets`, no plain path: the values never reach the API).
  Plain `env` stays in the API spec for clients that want it. A replica re-queued to another node has its payload
  cleared and waits (`awaitingSecrets`) until the owner seals again.
- One user-content domain for everything: `https://<id>.<SITES_DOMAIN>` (owner decision §8.2), not `*.run.cloudana.io`.
- No WebSockets through the relay yet (step 2 limitation): streaming responses (SSE, chunked) work; socket-based UIs do not.
