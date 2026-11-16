# Cloud workstations and GPU rentals — build contract

Status: build contract · 2026-10-02 · extends docs/V3_CONTRACT.md (deployments). Owner ask: "cloud workstation rentals
along with features available on vast.ai".

## 0. How vast.ai features map onto an orchestrator (no marketplace)

| vast.ai | Cloudana equivalent | Rule |
|---|---|---|
| Browse hosts, filter by GPU, pick an offer | **Describe a spec**; the orchestrator assigns a node that satisfies it | users never see or pick a node |
| Host-set price per GPU-hour, bidding for interruptible | **Protocol price per GPU class per hour**; `interruptible` tier at a fixed discount | no bids; a provider may set a floor (stored, enforced later) |
| On-demand vs interruptible instances | `tier: "on-demand" \| "interruptible"` — interruptible can be preempted by on-demand work on the same node | preempted workstations stop cleanly; volume kept |
| DLPerf / reliability scores | node's **verified throughput** (MMAC/s from proven jobs) and **uptime %** (heartbeats + probes) shown as capacity, never as a picker | |
| Templates (PyTorch, Jupyter, SD WebUI…) | **Environment templates** with `kind: "workstation"` | |
| SSH + Jupyter + web UI access | `access`: `web` (port + token) and/or `ssh` (public key injected) | key is public → plain env; tokens sealed |
| Persistent storage, volumes | `volume`: node-local volume kept `keepDays` after stop; resume on the same node | |
| Max duration / auto-stop, budget | `maxHours`; auto-stop when reached or when credits run out | |
| Earnings dashboard for hosts | Provide → node cards (exists) + workstation-hours | |
| CLI, autoscaler, serverless, team accounts, cloud sync | **Planned** (catalog "coming up") | |

## 1. Spec (extends ContainerSpec in V3_CONTRACT §3)

```ts
type WorkstationSpec = ContainerSpec & {
  gpu?: { count: number; minVramGb?: number; class?: "any" | "consumer" | "datacenter" }; // count 0 = CPU workstation
  tier: "on-demand" | "interruptible";
  maxHours: number;                   // 1–720; auto-stop
  access: { web?: { port: number; path?: string }; ssh?: { publicKey: string } };
  volume?: { sizeGb: number; keepDays: number };   // 1–500 GB, 0–30 days
};
```
`kind: "workstation"` is a deployment kind alongside `static` and `container`. Everything else (events, probes,
billing by the hour, stop confirmation, sealed secrets, dead-node requeue) is inherited from deployments.

## 2. Pricing (protocol-set, env-configurable; µCLD per hour)

`PRICE_GPU_CONSUMER_UCLD_PER_HOUR` (default 2 000 per GPU), `PRICE_GPU_DATACENTER_UCLD_PER_HOUR` (default 6 000 per GPU),
plus the container formula for cpu/mem/storage and `PRICE_VOLUME_UCLD_PER_GB_HOUR` (default 2) while the volume is kept.
`INTERRUPTIBLE_DISCOUNT` default 0.5. Fees only (lane A + treasury), no subsidy: a workstation is rented time, not a
proof. Minimum 50 µCLD/h as before.

## 3. Capabilities and assignment

- Node manifest already carries `gpus: [{name, vramGB}]`. Agent adds capability `"gpu"` when Docker is present AND
  `nvidia-smi` works (NVIDIA container toolkit assumed; document it).
- Assignment filter: `container` capability, `gpu` capability if `gpu.count > 0`, enough free GPUs (node.gpus −
  GPUs used by its running workstations), `minVramGb`, `class` (datacenter = name matches A100|H100|L40|A10|T4|V100|RTX 6000 Ada…,
  consumer = everything else), max 5 containers per node (existing).
- **Preemption:** when an on-demand workstation/container is queued and no node can take it, the orchestrator stops
  the youngest `interruptible` workstation on a node that would then fit, event "preempted by on-demand work",
  owner is charged only for elapsed time, volume kept. Never preempt on-demand.
- **Auto-stop:** on heartbeat, `running` workstations whose `startedAt + maxHours` has passed → `stopped`, reason
  `max hours reached`. Owner may extend (`PATCH /deployments/{id} {maxHours}`) while running.

## 4. API additions (JWT)

- `POST /deployments` accepts `kind: "workstation"` with the spec above (validation: access.web or access.ssh required;
  ssh publicKey must be `ssh-ed25519|ssh-rsa|ecdsa-sha2-… <base64> [comment]`).
- `PATCH /deployments/{id}` `{ maxHours? }` (extend), only while running/assigned.
- `GET /deployments/{id}` adds `connect: { web?: string (full URL incl. token path if the template uses one), ssh?: string ("ssh -p <port> user@host") }`,
  `hoursUsed`, `hoursLeft`, `gpu: {count, names[]}` once assigned.
- `GET /network` adds `gpusOnline` (sum over online nodes) and `workstationsRunning`.
- Node heartbeat `start` for workstations carries the spec; the agent reports `endpoint` (web) and `sshEndpoint`
  (`host:port`) on `POST /nodes/deployments/{id}/status` (new optional field `sshEndpoint`).

## 5. Node agent

- `docker run … --gpus "count=<n>"` (or `all` if n ≥ node GPUs) when `gpu.count > 0`; `--shm-size=1g` for ML images.
- SSH: if the image supports `PUBLIC_KEY`/`SSH_PUBLIC_KEY` env (linuxserver/openssh-server convention, vast/runpod
  images), inject `access.ssh.publicKey` as both; map container port 22 (or template `sshPort`) to a host port and report
  `sshEndpoint`. Images without sshd: web access only (template says so).
- Volume: `docker volume create cld-<id>` mounted at the template's `workdir` (default `/workspace`); on stop keep the
  volume; delete after `keepDays` (agent housekeeping on boot + hourly) or on an explicit purge command.
- Web token: for Jupyter/code-server templates, generate a random token, pass as env, and include it in the reported
  endpoint path/query so `connect.web` works with one click. Tokens travel inside the signed status report only.

## 6. Environment templates (`kind: "workstation"`, curated)

| id | image | access | notes |
|---|---|---|---|
| ws-jupyter-cuda | `jupyter/pytorch-notebook` (or `pytorch/pytorch` + jupyterlab) | web 8888 (token) | default for GPU |
| ws-code-server | `codercom/code-server` | web 8080 (password env) | VS Code in the browser |
| ws-linux-desktop | `lscr.io/linuxserver/webtop:ubuntu-kde` | web 3000 | a full desktop |
| ws-pytorch-ssh | `pytorch/pytorch` + sshd variant (document the image) | ssh 22 | |
| ws-comfyui | `yanwk/comfyui-boot` | web 8188 | |
| ws-sd-webui | `universonic/stable-diffusion-webui` (verify) | web 7860 | |
| ws-ollama-webui | `ollama/ollama` + `ghcr.io/open-webui/open-webui` (two containers → mark single-container variant) | web 3000 | |
| ws-blender | `lscr.io/linuxserver/blender` | web 3000 | |

Each template declares `kind: "workstation"`, `gpu` default, `access`, `workdir`, `sshPort?`, `tokenEnv?`.

## 7. Console (Run → **Workstations** tab)

- Spec picker, not a host list: GPU count (0–8), vRAM (any/≥8/≥16/≥24/≥48/≥80 GB), class (any/consumer/datacenter),
  CPU/RAM/disk presets, duration (1 h–30 d), tier toggle with the live price difference, environment template cards,
  access: SSH public key textarea (optional) and/or web, volume size + keep days. Price/hour shown live; total for the
  duration; "The orchestrator assigns a node that fits. You never pick one."
- Capacity hint from `/network`: "N GPUs online now" — if 0, say the workstation will wait for a GPU node (honest).
- List/detail: status chip, GPU names, hours used/left with a bar, Connect buttons (Open web · Copy SSH command),
  Extend (+1 h / +6 h / +24 h), Stop. Interruptible shows "may be preempted by on-demand work".
- Vocabulary: "rent a workstation" is fine; never "bid", "choose a host", "offer".

## 8. Catalog

Add to lib/services.ts group `compute`: `workstations` — "GPU workstations & rentals" — line "Jupyter, VS Code or a desktop on an assigned GPU." — status `early` (built; needs Docker + GPU nodes) — proof "Rented time, uptime probed; no subsidy." Add roadmap items: CLI, autoscaling, team accounts, cloud sync.

## 9. Connecting through the relay (agents ≥ 1.11.0, 2026-11-16)

A workstation placed on a node whose agent announces `relay-streams` is **relayed**: the node publishes no port at
all (web and sshd listen on 127.0.0.1), and the API needs no public host for it. Everything reaches it through the
node's own outbound relay socket (`docs/V4_RELAY_CONTRACT.md` "Byte streams"):

- **Web** (Jupyter, code-server, desktops): `https://<id>.cloudana.run` as before; their WebSockets (kernels,
  terminals) are passed through to the app.
- **SSH**: with the CLI (`cli/`) and an API key with the `deployments` scope (console → Keys):
  ```sh
  cloudana login --key cld_sk_…
  cloudana ssh <id>                    # runs your ssh with the CLI as ProxyCommand; -l <user>, -- <ssh options>
  cloudana ssh <id> --print            # the plain ssh line instead:
  ssh -o 'ProxyCommand=cloudana ssh --proxy %h' -o ServerAliveInterval=30 root@<id>.cloudana.run
  ```
  `connect.ssh` (console: Copy SSH command) is `cloudana ssh <id>`. SSH stays end to end: the gateway and the relay
  carry ciphertext, and your key is still what opens the shell. The API checks, on every connect, that the caller
  owns the workstation. An idle connection closes after 15 minutes without traffic; the `ServerAliveInterval` keeps a
  quiet shell open.

On nodes with older agents a workstation stays **direct** (public host:port, `ssh -p <port> user@host`) until they
upgrade; direct mode then retires (B-13).

## 10. Honesty

This machine has no Docker and no NVIDIA GPU, so the workstation path can be unit-tested and the UI exercised up to
"waiting for a GPU node", not run end to end. Status stays **Early access** until a GPU node proves it.

## 11. Machines (2026-11-16, phase 4 of docs/TRUST_TIERS.md)

A **machine** is a CPU workstation running Cloudana's own image: a Linux box you reach over SSH, like a small VPS.
Console: Run → **Machines** (`/run?tab=machines`); GPU boxes stay under Workstations. Template `machine-ubuntu`
(`client/api/src/services/template-workstations.ts`); `isMachine` / `machineProblem` in `deployment-spec.ts`.

### 11.1 What you get
- **Image** `ghcr.io/amrdab/cloudana-machine:<images/machine/VERSION>` (`images/machine`): Ubuntu 24.04, openssh-server,
  sudo, curl, ca-certificates, tini as PID 1 and sshd in the foreground. Host keys are made on the container's first
  start. Built, smoke-tested under runc and gVisor, signed and published by `.github/workflows/machine-image.yml` (main
  only; pull requests build and test).
- **Login: root, by key only** (`PermitRootLogin prohibit-password`, no passwords, no PAM). Root of the box is root
  inside the gVisor sandbox, not on the provider's kernel (TRUST_TIERS §5), with no-new-privileges on and seven
  capabilities added back (SETUID, SETGID, SYS_CHROOT, CHOWN, FOWNER, DAC_OVERRIDE, AUDIT_WRITE; §11.2). `cloudana` (uid 1000)
  is the unprivileged account, same key. The key is the workstation's `access.ssh.publicKey`, passed as
  `SSH_PUBLIC_KEY`/`PUBLIC_KEY` (§5). **Decision** (owner, accepted 2026-11-16): root login by key instead of a user
  with passwordless sudo, which cannot work under gVisor (§11.2).
- **Sizes** (console): S 1 vCPU / 2 GB, M 2 / 4, L 4 / 8; a 10 GB root disk; an **encrypted volume of 10–100 GB
  mounted at `/root`**. Only the volume is encrypted: the root filesystem (installed packages, `/tmp`, `/etc`) is the
  container's writable layer on the provider's disk.
- **Price**: the existing CPU, RAM, container-disk and volume rates (docs/PRICES_USD.md "Machines"). Beta: paid from the
  balance, which free test credits fill (`POST /v1/dev/credits`, the same button as Run → Compute).
- **Trust**: `verified` by default, as every container; community is refused while `COMMUNITY_HOSTING` is off.
- **Connect**: only `cloudana ssh <id>` through the relay (§9): sshd is published on the node's 127.0.0.1, never on
  the provider's public IP. A machine is placed only on a node with `sandbox`, `encrypted-volumes`, `relay` and
  `relay-streams` (`requiredCapabilities` in `fits()`, placement and preemption), so it is always relayed; the agent
  also refuses a machine start that is not relayed.

The API refuses a machine spec with GPUs, web access, no volume, a volume outside 10–100 GB, `volume.encrypted: false`,
a `user`, or an SSH login other than root / cloudana; it stores `volume.encrypted: true` and `access.ssh.user` (root by
default, the user `cloudana ssh` logs in as).

### 11.2 Capabilities: what sshd needs under `--cap-drop=ALL`
Every workstation runs with `--cap-drop=ALL --security-opt=no-new-privileges` (`hardeningArgs`) and, on a `sandbox`
node, `--runtime=runsc`. With nothing added sshd cannot work: it starts and binds port 22 (Docker sets the container's
`ip_unprivileged_port_start` to 0), then every login fails at `chroot("/run/sshd"): Operation not permitted` (privilege
separation). So a machine — the machine image, no GPU, relayed, on a `sandbox` node, and nowhere else — gets the
hardening unchanged, no-new-privileges included, plus `MACHINE_CAPS` (`node-agent/src/workstation.ts machineArgs`):

```
docker run -d --name cld-<id> --restart unless-stopped --runtime=runsc --cap-drop=ALL --security-opt=no-new-privileges \
  --pids-limit=512 --memory <m> --memory-swap <m> --storage-opt size=<n>m --network cld-tenant \
  --cap-add=CHOWN --cap-add=DAC_OVERRIDE --cap-add=FOWNER --cap-add=SETGID --cap-add=SETUID --cap-add=SYS_CHROOT \
  --cap-add=AUDIT_WRITE \
  --cpus <c> --shm-size=1g --mount type=bind,source=<volume dir>/mnt/cld-<id>/data,target=/root -p 127.0.0.1:<port>:22 \
  -e PUBLIC_KEY=… -e SSH_PUBLIC_KEY=… -e NVIDIA_VISIBLE_DEVICES=none ghcr.io/amrdab/cloudana-machine:1.0.0
```

The set is the smallest that works on both runtimes: CI drops one capability at a time from Docker's default-like list
under runsc, and adds each left-out one to the set under runc and runsc, checking a key login, an interactive (pty)
login as root and as cloudana, and root's `apt-get install` (smoke runs on PR #109):

| Capability | Without it | So |
|---|---|---|
| SETUID, SETGID, SYS_CHROOT | nobody logs in | needed: sshd privilege separation and the login |
| CHOWN | key login works, an interactive login gets no pty | needed: sshd hands the pty to the user |
| FOWNER | under runsc, cloudana's interactive login gets no pty (sshd sets the mode of a pty it has given away) | needed |
| AUDIT_WRITE | under runc, an interactive login gets no pty (sshd's audit record); under runsc no difference (gVisor has no audit subsystem) | kept, so the set does not depend on gVisor's audit gap |
| DAC_OVERRIDE | root's `apt-get install` fails | needed: apt/dpkg as root |
| FSETID, KILL, NET_BIND_SERVICE | everything above still works | left out |

So root of a machine cannot, for example, `kill` another user's process; those capabilities can be added to
`MACHINE_CAPS` if tenants need them (they stay inside gVisor). Review asked for five capabilities; FOWNER and
AUDIT_WRITE are the two the tests showed sshd needs beyond them.

These are capabilities of root inside the gVisor sandbox. `images/machine/smoke-test.sh` runs exactly these flags in CI
(runc and runsc): root and cloudana log in (with a pty), root installs a package with apt, `/root` is the bind mount,
`dmesg` says gVisor, passwords are refused; with the plain workstation flags nobody logs in.

**Why root and not a user with passwordless sudo** (the first design): sudo is a setuid binary. no-new-privileges
forbids raising privileges on exec, and under gVisor a setuid exec does not raise them even without no-new-privileges
(smoke runs on PR #109: `sudo: effective uid is not 0` with SETUID in the bounding set and NoNewPrivs 0). Logging in as
root needs no setuid binary, so no-new-privileges stays on.

### 11.3 Encrypted volumes (TRUST_TIERS §6 "Disk") — design note
Goal: a machine's volume is ciphertext on the provider's disk, its key is per deployment, delivered sealed to the node
(the sealed-env format, `shared/sealed.ts`), held only in memory there, and destroying it (purge, or `keepDays` over)
makes the data unrecoverable. Constraints: the agent already runs as root (iptables needs it), tenant containers run
under gVisor, Docker volumes have no encryption of their own, and the agent's tests run without root or Docker.

| Option | At rest on the provider's disk | Privileges / parts | Wipe | Verdict |
|---|---|---|---|---|
| **LUKS2 on a loop file** (cryptsetup, dm-crypt, ext4) | the whole volume at block level: contents, names, sizes; also caps the volume at its size | root (loop, device-mapper, mount); cryptsetup + e2fsprogs | `cryptsetup erase` destroys the keyslots (the master key is gone even if blocks survive on an SSD), then delete the file | **chosen** |
| gocryptfs (FUSE, per file) | file contents and names; sizes, counts and tree shape visible | /dev/fuse, `allow_other` so Docker sees it, a daemon per volume that dies with the agent; no size cap | delete the cipher dir and its config | more moving parts, leaks more |
| fscrypt (ext4/xfs native) | per directory | a filesystem with the feature, keyring handling per container | remove key + files | depends on the provider's filesystem and kernel |

**How it works** (`node-agent/src/volumes.ts`, agent ≥ 1.12.0, capability `encrypted-volumes`):
1. The operator sets `CLOUDANA_ENCRYPTED_VOLUMES=1` (and optionally `CLOUDANA_VOLUME_DIR`, default
   `/var/lib/cloudana/volumes`). At boot, with containers on, the agent checks it is root and does a real round trip on a
   64 MiB scratch volume (format, mount, write, close, reopen with the key, read, erase). Only then does it announce
   `encrypted-volumes`. Nodes without it behave as before.
2. The API places a spec with `volume.encrypted` only on nodes with `encrypted-volumes` (a machine also needs `sandbox`,
   `relay` and `relay-streams`): `requiredCapabilities` in `fits()`, shared by placement and preemption.
3. On the first start instruction to a node, the API makes 32 random bytes, seals them to the node's public key bound to
   the deployment (`sealV2`, aad `volumeKeyAad(id)` = `cloudana-volume-key:<id>`, so it can never be opened as env, nor
   env as a key), stores only the sealed payload (`deployment_volume_keys`, one per deployment per node) and carries it
   on every start to that node (`volumeKey`). The plaintext is not stored. A re-queued machine starts a new volume, with
   a new key, on its new node. (The API keeps its own copy of the v2 seal in `client/api/src/lib/sealed.ts` because
   `shared/sealed.ts` resolves its crypto from the repo root; one golden payload is checked by both sides.)
4. The agent opens the key with its node key under that aad, hands it to cryptsetup **on stdin** (never argv, never a
   file) and keeps no copy. First use: sparse file `cld-<id>.img.new` of the volume's size → `cryptsetup luksFormat`
   (LUKS2, aes-xts-plain64 512-bit; PBKDF2 at its minimum, since the passphrase is already a random 256-bit key) → open →
   `mkfs.ext4` → close → rename to `cld-<id>.img` (an interrupted create never leaves a half-made volume under the real
   name). Every start: `cryptsetup open` → mount `nosuid,nodev` at `mnt/cld-<id>` → bind-mount `mnt/cld-<id>/data` into
   the container. A wrong key fails in `cryptsetup open` and nothing is mounted. `data` exists only inside the
   filesystem, so a container Docker restarts on its own while the volume is closed (after a reboot) fails to start
   instead of writing to the plain disk.
5. Stop: the container goes, then umount and `cryptsetup close` (the kernel forgets the key); the encrypted file stays
   for `keepDays`. Purge or keep period over: close, `cryptsetup erase`, delete the file.

What the design protects is the disk at rest — a stolen or decommissioned disk carries ciphertext, and the sealed key
lives only in the API — and erasure that holds on SSDs. While the volume is open the kernel holds its master key: a
provider with root can read the running box (TRUST_TIERS §6 says so for every tier); the node's private key sits on the
node's disk, so the provider can also open a key the API sends. The file is sparse, so which blocks were written is
visible.

### 11.4 Known limitations
- **Node reboot → the machine fails.** After a reboot the volume is closed and the agent holds no key (none is ever
  written on the node), so the machine fails rather than starting on an unencrypted disk. Reopening it needs the API to
  resend the key on resume; not built. Volumes are not reopened after a stop either (there is no resume), so `keepDays`
  only delays the erase.
- **The root filesystem is not encrypted.** Only the volume (`/root`) is; installed packages, `/tmp` and `/etc` are the
  container's writable layer on the provider's disk.
- **The API sees each key once, at creation.** It makes the key, seals it to the node and keeps only the sealed copy;
  the plaintext is not stored, but Cloudana could have kept it.
- **A containerized agent needs more privilege.** In a container (`docker run`, `deploy/kubernetes-daemonset.yaml`) the
  agent needs `--privileged` (loop and device-mapper devices) and the volume directory bind-mounted at the same path with
  `rshared` propagation, so the host's Docker daemon sees the mounts (node-agent/README.md "Encrypted volumes"). The
  daemonset is not changed in this PR. A native (systemd) agent needs only root.
