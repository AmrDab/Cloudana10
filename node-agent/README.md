# Cloudana node agent

```
npm install
npm start
```

Runs a Cloudana provider node: creates (or loads) a wallet key, detects your
hardware, benchmarks it, registers with the API, then loops — heartbeating
every 15 s, solving any assigned matmul jobs, and submitting proofs for CLD.
It acts only on instructions signed by the network's instruction key (see
"Signed instructions" below) and will not start without a pinned signer.

First run prints a bind link; open it and connect your payout wallet, then
the agent starts earning automatically. Ctrl-C prints session totals and
exits.

## Flags

- `--api <url>` — API base URL (default `$CLOUDANA_API`, else `https://api.cloudana.io`);
  must be https except for `127.0.0.1` / `localhost`
- `--name <name>` — key name, so multiple local nodes can run side by side
  (default `default`); key stored at `node-agent/.data/<name>.json`
- `--site <url>` — website base URL, used for the bind link (default
  `$CLOUDANA_SITE`, else `https://cloudana.io`)
- `--public-host <host>` — host/IP put in deployment endpoints
  (`http://<host>:<port>`); `auto` looks up your public IPv4 once at boot and
  falls back to `127.0.0.1` (default `$CLOUDANA_PUBLIC_HOST`, else `127.0.0.1`)
- `--ports <lo-hi>` — port range for hosted sites and containers (default
  `$CLOUDANA_PORTS`, else `42000-42100`)

## Environment

- `CLOUDANA_API` — API base URL when `--api` is not given
- `CLOUDANA_INSTRUCTION_SIGNER` — address of the API's instruction-signing key
  (`GET /v1/nodes/instruction-key`). Required until a default is baked into
  `src/instructions.ts`; the agent exits without it.
- `CLOUDANA_FLEET_TOKEN` — datacenter fleet token (see below)
- `CLOUDANA_PUBLIC_HOST` — as `--public-host`
- `CLOUDANA_PORTS` — as `--ports`
- `CLOUDANA_ALLOW_CONTAINERS=1` — opt in to tenant containers / GPU workstations
  (fleet nodes only; needs Docker and the hardening self-check, see below)
- `CLOUDANA_IMAGE_ALLOWLIST` — comma-separated regexes of extra images this node
  may run besides the network's curated list
- `CLOUDANA_ANY_IMAGE=1` — run any image the network sends (announced as
  `any-image`; GPU endpoints bring their own image, so a GPU node needs this)
- `CLOUDANA_SITE` — as `--site`

## Signed instructions

Every heartbeat response that carries work (`assignment`, `deployments`) is
signed by the API: `sig = personal_sign(keccak256(canonicalJSON({ nodeAddress,
ts, nonce, body })))`. The agent verifies the signer against the pinned
address, requires `|ts − now| ≤ 60 s` and an unseen nonce, and otherwise
ignores the instruction (logged at most once a minute). A compromised DNS
entry, proxy or API cannot make this machine run anything.

Requests from the node carry `X-Node`, `X-Node-Timestamp`, `X-Nonce` (16 random
bytes) and `X-Node-Signature` over `"<METHOD> <path> <ts> <sha256(body)> <nonce>"`;
the API accepts each nonce once. If the machine's clock is off, the agent learns
the offset from the API's `Date` header and keeps going — only a bad signature is
fatal. The agent reports its version; the API refuses work below
`minAgentVersion` and the log says so.

## Relay (no open ports)

When the API runs a relay, the agent keeps one outbound WebSocket to it
(`wss://relay.cloudana.io/connect`, opened with a single-use ticket from
`POST /v1/nodes/relay/ticket`) and visitors' requests for this node's
deployments arrive over that socket. The agent forwards each one to the
deployment on `127.0.0.1`, so a relay node needs **no open ports and no public
IP**: static sites listen on `127.0.0.1`, container and workstation web ports
are published as `-p 127.0.0.1:<port>:<container port>`, and `running` reports
carry no endpoint (a workstation reports the path of its web URL as `webPath`).
The agent announces the `relay` capability, pings every 30 s (reconnecting
with a jittered 1–30 s backoff and a fresh ticket when a pong is missing) and
sends `relay: true` on heartbeats while the socket is healthy.

If the API has no relay (the ticket request answers 404 or 503
`not_configured`), the agent re-announces without `relay` and runs in
**legacy mode**: everything below about public ports applies. It asks for a
ticket again every 5 min and switches over when the API gains a relay. A
deployment keeps the mode it started in until it stops, across agent restarts.

Workstation SSH is not relayed: its port stays public and, for relayed
workstations, is reported only when `--public-host` is a public IP; otherwise
the report says "SSH needs a node with a public IP".

**Host network.** Run in a container, the agent must share the host's network
(`docker run --network host`; the Kubernetes DaemonSet sets `hostNetwork`): it
reaches tenant containers on the host's `127.0.0.1`.

## Hosting and containers

Every node announces `matmul` and `hosting` (static sites). `container` (and
`gpu`) are announced only when `CLOUDANA_ALLOW_CONTAINERS=1` is set, `docker
info` answers within 3 s **and** the hardening self-check passes; the network
places containers only on fleet nodes anyway. Home nodes do compute + static
hosting. Deployments arrive on the heartbeat:

- **static** — files are written to `.data/sites/<id>/` (paths with `..` or an
  absolute prefix are rejected) and served by a built-in HTTP server on a free
  port from the range: `/` → `index.html`, correct MIME types, no directory
  listings, a 404 page (`404.html` if the site ships one), `Cache-Control:
  public, max-age=60`, `X-Content-Type-Options: nosniff`.
- **container** — `docker run -d --name cld-<id> --restart unless-stopped
  --cap-drop=ALL --security-opt=no-new-privileges --pids-limit=512
  --memory <memMb>m --memory-swap <memMb>m --storage-opt size=<storageMb>m
  --network cld-tenant --cpus <cpu/1000>
  --user <spec.user|1000:1000> -p <hostport>:<port> -e … <image> [command…]`
  (a `user` of uid 0 is refused — plain containers never run as root),
  one free host port per container port (every port is tracked, so two
  containers never collide). Stop is `docker rm -f cld-<id>`.
  A spec with `gpu.count` gets `--gpus "device=<i>,…" --shm-size=1g` (explicit
  indices reserved like a workstation's, of the requested tier — standard, large or h100,
  shared/gpu-tier.ts — so a mixed node never hands an H100 to a standard request); a spec with `health` is reported
  `running` only once `GET http://127.0.0.1:<port><health.path>` answers 2xx/3xx
  (polled every 3 s for `health.startupGraceSec`, default 600 s). If it exits or
  the grace runs out, the report is `failed` with the last 100 lines of
  `docker logs` as `logs`. That is how **GPU endpoint replicas** arrive
  (docs/V4_ENDPOINTS_CONTRACT.md): relayed containers with `gpu` + `health`.

**Container hardening** (`CLOUDANA_ALLOW_CONTAINERS=1`). At boot the agent
first requires **Docker ≥ 28** (`docker version`): older engines let LAN hosts
reach ports published on `127.0.0.1`, which is how relayed containers are
published. It then checks that Docker's storage driver can enforce the per-container disk
cap (`--storage-opt size=`): **overlay2 on xfs mounted with project quotas**
(`pquota`/`prjquota` in the Docker root's mount options), or **btrfs** / **zfs**.
overlay2 on ext4 (the Ubuntu default) and Docker Desktop cannot cap a tenant's
writable layer, so the node refuses containers and says why; reformat
`/var/lib/docker` as xfs with `-o pquota` or use btrfs/zfs. It then
creates the user-defined bridge `cld-tenant` (inter-container communication
off — an existing network with icc on is refused) and installs iptables `DROP`
rules from its subnet to `10.0.0.0/8`,
`172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (cloud metadata) and
`100.64.0.0/10`, in `DOCKER-USER` (forwarded traffic), plus a `DROP` of new
connections from its subnet to this host (`INPUT -s <subnet> -m conntrack !
--ctstate ESTABLISHED,RELATED -j DROP`: replies to connections the host opened,
such as the relay forwarding to a container, still pass; the older rule without
the conntrack match is deleted).
Rules already present are only checked, so an operator may pre-install them;
if they are missing and cannot be installed (no root / `NET_ADMIN`, Docker
Desktop without iptables) the node refuses containers and logs why. The same
network and rule checks run again right before every container start (check
only, nothing installed): a flushed firewall or recreated network refuses the
start with `node cannot serve:` so the API places it elsewhere. Tenant env
keys `NVIDIA_*` and `CUDA_VISIBLE_DEVICES` are always stripped and
`NVIDIA_VISIBLE_DEVICES` is set to exactly the GPUs allocated (or `none`), so
a tenant cannot ask for `all`. Images must be on the network's curated list
(the API sends `imageAllowed`) or match `CLOUDANA_IMAGE_ALLOWLIST`; anything
else fails before Docker is called.

If the API refuses the node's `running` report (for example the endpoint is not
on the host the node announced), the agent tears the deployment down and
reports `failed` with the prefix `node cannot serve:`, so the network re-queues
it on another node instead of leaving it stuck.

In legacy mode the endpoint reported is `http://<public-host>:<first port>`. Running
deployments are recorded in `.data/deployments.json`; on restart the agent
re-serves static sites (same port when free), checks containers with
`docker ps`, and re-reports their status.

**Firewall.** Mining, heartbeats and the relay are outbound-only, so a relay
node needs no open ports at all. In legacy mode hosting is different: visitors
connect *to* your node, so the port range must be reachable — allow it in your firewall and forward it on
your router (or set `--public-host` to a host that routes to the node). Until
then the network's probes fail and the deployment shows as unreachable.

**Sealed secrets.** Secret env vars are encrypted in the browser to this
node's public key (ECIES over secp256k1 → HKDF-SHA256 → XChaCha20-Poly1305,
`shared/sealed.ts`) before they leave the user's machine. The API stores and
forwards only ciphertext; only this node's private key (`.data/<name>.json`)
can open it, and any tampering makes decryption fail. They are decrypted in
memory just before `docker run` — note they are then visible to anyone with
Docker access on this machine (e.g. `docker inspect`).

## GPU workstations

Nodes announce `gpu` when Docker answers **and** `nvidia-smi
--query-gpu=name,memory.total --format=csv,noheader` succeeds within 3 s with at
least one GPU (the names and vRAM also go into the manifest). The boot log
shows it: `capabilities: matmul, hosting, container, gpu`. Requirements on the
host: the NVIDIA driver and the
[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/)
(`nvidia-ctk runtime configure --runtime=docker`, then restart Docker), so that
`docker run --gpus all … nvidia-smi` works. Without either, no `gpu` is
announced and the node never receives GPU workstations.

A `kind: "workstation"` deployment runs:

```
docker volume create cld-<id>          # or reuse it if it exists
docker run -d --name cld-<id> --restart unless-stopped --cap-drop=ALL --security-opt=no-new-privileges \
  --pids-limit=512 --memory <memMb>m --memory-swap <memMb>m --network cld-tenant --cpus <cpu/1000> --shm-size=1g \
  [--user <spec.user>] [--gpus "device=<i>,<j>"] -v cld-<id>:<workdir> -p <hostport>:<webport> [-p <hostport>:<sshPort|22>] \
  -e NVIDIA_VISIBLE_DEVICES=<i>,<j>|none -e … <image> [command…]
```

- **`--gpus`** — the agent hands out explicit device indices (lowest free
  first) and passes `--gpus "device=0,1"`, never `count=N` (Docker would give
  every workstation GPU 0). Indices are saved per workstation in
  `.data/deployments.json` (`gpus`), released on stop / purge / failed start,
  and on boot re-read from `docker inspect` (`HostConfig.DeviceRequests`) so a
  stale record cannot block a GPU. A start that needs more GPUs than are free
  fails with "not enough free GPUs"; on a node without GPUs, "this node has no
  usable GPU". CPU workstations (`gpu.count` 0) get no `--gpus`.
- **Volumes** — `cld-<id>` is mounted at the template's `workdir` (default
  `/workspace`). Stop (including preemption) removes the container and keeps the
  volume for `volume.keepDays` (0–30; 30 when unknown); it is listed in
  `.data/volumes.json` as `{ "id", "keepUntil" }` (ms epoch). Housekeeping on
  boot and hourly runs `docker volume rm cld-<id>` after `keepUntil`. A new
  `start` for the same id reuses the volume and cancels its removal. An
  `action: "purge"` command removes container and volume at once. The volume
  size is not enforced by Docker's default `local` driver.
- **SSH** — `access.ssh.publicKey` (`ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp* <base64>
  [comment]`, single line) is passed as both `PUBLIC_KEY` and `SSH_PUBLIC_KEY`
  (the linuxserver/openssh-server and vast/runpod convention); the image's
  sshd port (template `sshPort`, default 22) is mapped to a free host port and
  reported as `sshEndpoint: "<public-host>:<port>"` (relayed workstations: only
  when the public host is a public IP). Images without sshd only offer web access.
- **Web token** — if the template names a `tokenEnv` (`JUPYTER_TOKEN`,
  `PASSWORD`…), the agent generates a 24-byte base64url token and sets it. If
  the app accepts the token in the URL (template `tokenQuery`; Jupyter's
  `token` by default) the endpoint carries it (`http://host:port/?token=…`);
  otherwise the endpoint is plain and the token is reported as `webToken`.
  Relayed workstations report the same path and query as `webPath`
  (`/?token=…`, `/lab`, `/`) instead of an endpoint.

**Security.** The agent never logs tokens, SSH keys or env values. Tokens
travel only inside the signed status report, and are also stored in
`.data/deployments.json` (next to the node key) so a restart can re-report
them. As with containers, anyone with Docker access on the host can read them
(`docker inspect`).

## Datacenter fleet

Create a fleet in the Cloudana app (or `POST /v1/fleets`) and copy its token —
it is shown once. A node started with the token joins your wallet immediately:
no bind link, it logs `Joined fleet <id> — earnings go to <payout>`. Revoking
the fleet stops new nodes joining and unbinds every node of the fleet (their
deployments are re-queued elsewhere); `POST /v1/fleets/{id}/nodes/{address}/evict`
does the same for one node.

Docker (build from the repo root, or pull the signed image
`ghcr.io/amrdab/cloudana-node-agent:<version>` built by
`.github/workflows/build-node-agent.yml`; the key persists in the `cloudana-key` volume):

```
docker build -f node-agent/Dockerfile -t cloudana-node-agent .
docker run -d --restart unless-stopped -e CLOUDANA_FLEET_TOKEN=cft_... -e CLOUDANA_INSTRUCTION_SIGNER=0x... \
  -e CLOUDANA_PUBLIC_HOST=auto --network host -v cloudana-key:/app/dist/node-agent/.data cloudana-node-agent
```

`--network host` is required (see "Relay"); with it, legacy-mode sites listen on
the host's port range directly, so no `-p` is needed.

Containers on a fleet node additionally need Docker ≥ 28 on the host,
`-e CLOUDANA_ALLOW_CONTAINERS=1`,
`-v /var/run/docker.sock:/var/run/docker.sock`, `--user root --cap-add NET_ADMIN`
(for the iptables rules) and, for GPUs, `--gpus all` so nvidia-smi can see them.

Kubernetes (one agent per machine; edit the image in the manifest first):

```
kubectl create namespace cloudana
kubectl -n cloudana create secret generic cloudana-fleet --from-literal=CLOUDANA_FLEET_TOKEN=cft_...
kubectl apply -f node-agent/deploy/kubernetes-daemonset.yaml
```

## Selftest

`npm run selftest` — offline: signs and verifies a sample request; seals and
opens a secret (and checks tampering / a wrong key fail); serves a sample static
site on a free port, checks MIME, headers and path-traversal blocking, restarts
and resumes it, then stops it; builds workstation `docker run` argv (GPU/no-GPU,
SSH mapping, token env, env-key validation, hostile image/command/env kept as
single argv elements) and checks volume keep/purge bookkeeping; drives the relay
client against a local hub (the `ws` package viem installs) and a local upstream:
ticket/legacy handling, forwarding, flow control, batching, cancel, every error
code and reconnect, plus relay-mode listeners and reports — no Docker or GPU
needed.
