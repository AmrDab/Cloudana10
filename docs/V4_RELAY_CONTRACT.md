# V4 relay — build contract (step 2)

Source: [V4_VERIFIED_SERVICES.md](V4_VERIFIED_SERVICES.md) §2, reviewed in [V4_REVIEW_RELAY.md](V4_REVIEW_RELAY.md).
Code that both sides import: `shared/relay-protocol.ts` (frames, messages, limits) and `shared/relay-ticket.ts`.
If you must deviate, write it in your final report.

## Topology
- `cloudana-relay` Worker on `relay.cloudana.io`, Durable Object class `RelayNode`, one object per node
  (`idFromName(nodeAddress)`), holding that node's one WebSocket.
- The gateway and the API reach a node's object through a `script_name` binding (`RELAY`) and call
  `stub.fetch("https://relay/proxy", …)` (see "Hub HTTP surface").

## Connecting (agent)
1. `POST /v1/nodes/relay/ticket` with the usual signed node request (body `{}`) →
   `{ status: "success", ticket, url, expiresAt }`; `url` defaults to `wss://relay.cloudana.io/connect`.
   **404 → the API has no relay: run in legacy mode** (today's behaviour: listen on 0.0.0.0, report
   `http://publicHost:port`). 503 `not_configured` → legacy mode too, retry the ticket every 5 min.
2. Open `new WebSocket(url + "?ticket=" + encodeURIComponent(ticket))`, `binaryType = "arraybuffer"`.
   A ticket is single use; every (re)connect fetches a fresh one. A new socket replaces the node's old one.
3. Keepalive: send the text `"ping"` every 30 s; if `"pong"` doesn't arrive within 10 s, close and reconnect.
   Reconnect with jittered backoff 1 s → 30 s (reset after 60 s connected).
4. Heartbeat body gains `relay: true` while the socket is open and the last pong is < 45 s old; else `relay: false`.
5. **Announce** includes the capability `"relay"` in `workTypes` while in relay mode (and re-announces without it if
   the ticket route answers 404/503, i.e. legacy mode). The API keeps `"relay"` only when it has
   `RELAY_TICKET_SECRET`; a node that kept it is placed hosting work without a public IP, and its deployments are
   relayed. New work goes to it only while its `relay: true` heartbeat is fresh (`RELAY_FRESH_SECONDS`, 45 s).

## Streams (one per HTTP request)
Hub → node: `req {s, dep, m, path, h}`, then binary body frames, then `end` (or `err`/`cancel`).
Node → hub: `res {s, status, h}`, then binary body frames, then `end` (or `err {code, message?}`).
- `dep` is a deployment id. The agent serves it only if it has a running record for it; otherwise
  `err not_serving` (the gateway tries the next replica). Forward to `http://127.0.0.1:<record port><path>` with
  `http.request` (not fetch — undici decompresses), method `m`, headers `forwardableHeaders(h)`.
- Flow control, both directions: at most `WINDOW_BYTES` (512 KiB) sent and not yet acked per stream. The receiver
  sends `ack {s, n}` with the number of payload bytes it has consumed since its previous ack (cumulative per ack
  message, not total). The agent acks request bytes after they are written to the upstream request; the hub acks
  response bytes after they are written into the client's stream.
- Batch response bytes for up to 50 ms or 64 KiB, whichever first (WebSocket messages are billed).
- Request bodies above `BODY_CAP_BYTES[class]` → `err too_large`. Upstream connect error / socket error →
  `err upstream`. More than `MAX_STREAMS` open → `err busy`. `cancel` → abort the upstream request, no reply.
- Streams die with the socket; nothing resumes after a reconnect.

## Agent changes
- Static sites listen on `127.0.0.1` (hosting.ts). Containers/workstation web ports publish `-p 127.0.0.1:P:C`
  (container.ts, workstation.ts). Workstation SSH keeps `-p P:22` and is reported as `sshEndpoint` **only** when the
  node's public host is a public IP; otherwise SSH is unavailable on that node (say so in the report message).
- In relay mode, `running` reports carry **no** `endpoint` for static, container and workstation web
  (`sshEndpoint` and `webToken` as today).
- Hardening (B1): replace `INPUT -s <tenant subnet> -j DROP` with
  `INPUT -s <tenant subnet> -m conntrack ! --ctstate ESTABLISHED,RELATED -j DROP`; delete the old rule if present;
  the boot self-check refuses containers on Docker < 28. Update security.selftest.
- `@types/node` → ^22. The agent must run on the host network (document in node-agent/README.md and Dockerfile
  notes).

## API changes (lead)
- `POST /v1/nodes/relay/ticket` (requireNode): needs secret `RELAY_TICKET_SECRET` (≥ 32 chars, same value on the relay)
  and var `RELAY_URL`; 503 `not_configured` without the secret.
- Heartbeat stores `nodes.relay_at` when `relay: true`. Deployments assigned to a relay node are `relayed = 1`;
  their `running` report is accepted without an endpoint; probes go through `RELAY`; placement prefers relay nodes.
- `GET /v1/deployments/{id}/route` requires `X-Internal-Key` and returns
  `{ kind, state, relayed, targets: [{ node, dep }], endpoint }` (`endpoint` only for legacy direct nodes; one target per
  running replica for a GPU endpoint, docs/V4_ENDPOINTS_CONTRACT.md).

## Hub HTTP surface (relay Worker / Durable Object)
- `GET /connect?ticket=…` (WebSocket upgrade, public): ticket checked, nonce single-use, old socket closed.
- `POST|GET|… https://relay/proxy` (binding only): headers `x-relay-node`, `x-relay-dep`, `x-relay-class`
  (`site|endpoint`), `x-relay-path`; method and body are the client's. Returns the node's response, or
  502/503/504 with `x-relay-error: offline|not_serving|busy|timeout|upstream|too_large`.
- `POST https://relay/kick` (binding only, header `x-relay-node`): closes the node's socket (unbind / ban).
- `GET https://relay/status` (binding only, header `x-relay-node`): `{ connected, since }`.

## Reserved deployment ids (served by the agent itself)

Two `dep` values in a `req` frame are not deployments; the agent's relay client answers them in-process, on loopback
servers the hub cannot tell from an app:

| dep | Served by | What | Who may ask |
|---|---|---|---|
| `storage` | `node-agent/src/storage.ts` | leaf proofs for storage checks (docs/V4_STORAGE_PHASE1_CONTRACT.md) | the API (checks) |
| `agent` | `node-agent/src/ops.ts` (agents ≥ 1.6.0) | `GET /logs/<deploymentId>?tail=N` → text/plain, the last N (1…1000, default 200) lines of `docker logs`, ≤ 64 KiB, 404 for anything this node does not run | the API (`GET /v1/deployments/{id}/logs`, owner-authenticated, rate-limited per deployment) |

Only the API and the gateway hold the `RelayNode` binding, and the gateway sets `x-relay-dep` from the API's route
lookup (a real deployment id) after stripping every `x-relay-*` header a visitor sent — a visitor cannot address
either reserved id. Both ride on the probe slots (`x-relay-probe: 1`), so visitor load never starves them. Nothing is
stored on the relay or the API: a logs answer is read from Docker when asked and forgotten.
