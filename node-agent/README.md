# Cloudana node agent

```
npm install
npm start
```

Runs a Cloudana provider node: creates (or loads) a wallet key, detects your
hardware, benchmarks it, registers with the API, then loops — heartbeating
every 3s, solving any assigned matmul jobs, and submitting proofs for CLD.

First run prints a bind link; open it and connect your payout wallet, then
the agent starts earning automatically. Ctrl-C prints session totals and
exits.

## Flags

- `--api <url>` — API base URL (default `$CLOUDANA_API`, else `http://127.0.0.1:8790`)
- `--name <name>` — key name, so multiple local nodes can run side by side
  (default `default`); key stored at `node-agent/.data/<name>.json`
- `--site <url>` — website base URL, used for the bind link (default
  `http://localhost:7003`)
- `--public-host <host>` — host/IP put in deployment endpoints
  (`http://<host>:<port>`); `auto` looks up your public IPv4 once at boot and
  falls back to `127.0.0.1` (default `$CLOUDANA_PUBLIC_HOST`, else `127.0.0.1`)
- `--ports <lo-hi>` — port range for hosted sites and containers (default
  `$CLOUDANA_PORTS`, else `42000-42100`)

## Environment

- `CLOUDANA_API` — API base URL when `--api` is not given
- `CLOUDANA_FLEET_TOKEN` — datacenter fleet token (see below)
- `CLOUDANA_PUBLIC_HOST` — as `--public-host`
- `CLOUDANA_PORTS` — as `--ports`

## Hosting and containers

Every node announces `hosting`; nodes where `docker info` answers within 3 s
also announce `container`. Deployments arrive on the heartbeat:

- **static** — files are written to `.data/sites/<id>/` (paths with `..` or an
  absolute prefix are rejected) and served by a built-in HTTP server on a free
  port from the range: `/` → `index.html`, correct MIME types, no directory
  listings, a 404 page (`404.html` if the site ships one), `Cache-Control:
  public, max-age=60`, `X-Content-Type-Options: nosniff`.
- **container** — `docker run -d --name cld-<id> --restart unless-stopped
  --memory <memMb>m --cpus <cpu/1000> -p <hostport>:<port> -e … <image> [command…]`,
  one free host port per container port. Stop is `docker rm -f cld-<id>`.

The endpoint reported is `http://<public-host>:<first port>`. Running
deployments are recorded in `.data/deployments.json`; on restart the agent
re-serves static sites (same port when free), checks containers with
`docker ps`, and re-reports their status.

**Firewall.** Mining and heartbeats are outbound-only, so a home node needs no
open ports for them. Hosting is different: visitors connect *to* your node, so
the port range must be reachable — allow it in your firewall and forward it on
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
docker run -d --name cld-<id> --restart unless-stopped --memory <memMb>m --cpus <cpu/1000> --shm-size=1g \
  [--gpus "device=<i>,<j>"] -v cld-<id>:<workdir> -p <hostport>:<webport> [-p <hostport>:<sshPort|22>] \
  -e … <image> [command…]
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
  reported as `sshEndpoint: "<public-host>:<port>"`. Images without sshd only
  offer web access.
- **Web token** — if the template names a `tokenEnv` (`JUPYTER_TOKEN`,
  `PASSWORD`…), the agent generates a 24-byte base64url token and sets it. If
  the app accepts the token in the URL (template `tokenQuery`; Jupyter's
  `token` by default) the endpoint carries it (`http://host:port/?token=…`);
  otherwise the endpoint is plain and the token is reported as `webToken`.

**Security.** The agent never logs tokens, SSH keys or env values. Tokens
travel only inside the signed status report, and are also stored in
`.data/deployments.json` (next to the node key) so a restart can re-report
them. As with containers, anyone with Docker access on the host can read them
(`docker inspect`).

## Datacenter fleet

Create a fleet in the Cloudana app (or `POST /v1/fleets`) and copy its token —
it is shown once. A node started with the token joins your wallet immediately:
no bind link, it logs `Joined fleet <id> — earnings go to <payout>`. Revoking
the fleet stops new nodes joining; nodes already joined stay bound.

Docker (build from the repo root; the key persists in the `cloudana-key` volume):

```
docker build -f node-agent/Dockerfile -t cloudana-node-agent .
docker run -d --restart unless-stopped -e CLOUDANA_FLEET_TOKEN=cft_... -v cloudana-key:/app/node-agent/.data cloudana-node-agent
```

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
single argv elements) and checks volume keep/purge bookkeeping — no Docker or
GPU needed.
