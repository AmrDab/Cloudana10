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

## 9. Honesty

This machine has no Docker and no NVIDIA GPU, so the workstation path can be unit-tested and the UI exercised up to
"waiting for a GPU node", not run end to end. Status stays **Early access** until a GPU node proves it.
