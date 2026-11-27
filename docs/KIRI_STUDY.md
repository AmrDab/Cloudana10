# Kiri as a container backend for Mac and Windows providers — feasibility study

Date: 2026-11-18. Source read only (nothing downloaded as a binary, nothing run).
Kiri: https://github.com/libracoder/kiri at commit `36923b2` (v0.2.1 + 3 days), Apache-2.0, Rust.
All Kiri paths below are relative to that repo at that commit. "Unverified" = could not be confirmed from source alone.

## 1. Verdict

**No, not as-is, and not worth building on.** Our boot self-check refuses Kiri at its first three steps (it reports
Docker 27.5.1, storage driver `overlayfs`, and has no `iptables`/`DOCKER-USER`), and Kiri has no gVisor, no per-container
disk cap, no dm-crypt in its Mac kernel and no GPUs, so a Kiri node could announce at most `container` — never
`sandbox`, `encrypted-volumes` or `gpu`. Without `sandbox` it can take no community work and no machines
(docs/TRUST_TIERS.md:59, node-agent/src/deployments.ts:502). The VM boundary is also weaker than it sounds for a provider:
on a Mac the whole Mac filesystem (`/`) is shared read-write into the VM, and any container can reach the Mac's
`127.0.0.1` services through `host.docker.internal`; on Windows there is no Kiri VM at all, it is Kiri's Linux mode
inside the shared WSL2 VM. Three settings we depend on are accepted and silently not enforced (`--runtime`,
`--storage-opt size=`, bridge `enable_icc=false`). A "VM-isolated host" mode on top of Kiri would cost roughly
12–18 days and still give the lowest tier; shipping our own small VM with real Docker + gVisor (Lima on Mac, a WSL2
distro on Windows) costs about the same, reuses the Linux agent unchanged, and keeps `sandbox`, encrypted volumes and
(on Windows) GPUs.

## 2. Compatibility table

Status: **supported** (enforced), **silently ignored** (accepted, not enforced — dangerous), **rejected** (explicit error),
**fails our check** (the agent refuses, honestly), **unknown**.

| # | Our requirement | Where we use it | Kiri status | Evidence (Kiri) |
|---|---|---|---|---|
| 1 | `docker info` answers | hardening.ts:140, container.ts:29-36 | supported | `crates/kiri/src/daemon/api.rs:412-450` |
| 2 | Server version ≥ 28 (`docker version --format {{.Server.Version}}`) | hardening.ts:40, 146-152 | **fails our check**: reports `27.5.1`, API 1.47 | `api.rs:390` (`ENGINE_VERSION`), `daemon/http.rs:10`. The reason for the rule (LAN reaching `127.0.0.1` ports) is handled differently in Kiri (`crates/kiri-init/src/linux/netlink.rs:563-592`), but that is unverified live |
| 3 | Storage driver enforces disk quota: `Driver` = overlay2-on-xfs+pquota / btrfs / zfs, `DriverStatus`, `DockerRootDir` | hardening.ts:97-112 | **fails our check**: `Driver: "overlayfs"`, no `DriverStatus`, root `/var/lib/kiri` | `api.rs:425`, `api.rs:434`. Layers are overlayfs on one ext4 data disk (`docs/development.md` "Containers"); the Mac guest kernel has no `CONFIG_QUOTA`, no XFS, no btrfs (`guest/kernel/kiri.config`, absent) |
| 4 | `--storage-opt size=<n>m` (HostConfig.StorageOpt) | container.ts:65 | **silently ignored** | `StorageOpt` is read nowhere in `crates/` (grep); the create handler `api.rs:1510-1700` builds the spec without it. A tenant can fill the shared 64 GiB data disk (`crates/kiri/src/guest.rs:374`) |
| 5 | `--runtime=runsc` (HostConfig.Runtime) | container.ts:75-76 | **silently ignored** (Docker would answer "unknown runtime") | `Runtime` is read nowhere in the create handler; the container runs under Kiri's own runtime as real root in the VM kernel, no user namespace (`crates/kiri-init/src/linux/container.rs:1639-1641`) |
| 6 | `docker info --format {{json .Runtimes}}` lists `runsc` | hardening.ts:207-214, index.ts:184 | not available: `{"kiri": {...}}`, hard-coded, no runtime plug-in | `api.rs:437-438`. So we never pass #5 today; `sandbox` is never announced |
| 7 | `--cap-drop=ALL`, `--cap-add=<MACHINE_CAPS>` | container.ts:60, workstation.ts:100, 108-110 | supported (bounding set dropped; unknown names rejected) | `api.rs:1460-1482`; `container.rs:1434-1436`; test `tests/e2e.sh:1027` |
| 8 | `--security-opt=no-new-privileges` | container.ts:61 | supported (`prctl(PR_SET_NO_NEW_PRIVS)`) | `crates/kiri/src/daemon/engine.rs:338-339`; `container.rs:1440-1443`; `tests/e2e.sh:1041` |
| 9 | `--pids-limit=512` | container.ts:62 | supported (`pids.max`) | `api.rs:1504`; `crates/kiri-init/src/linux/cgroup.rs:22` |
| 10 | `--memory` | container.ts:63 | supported (`memory.max`) | `api.rs:1487`; `cgroup.rs:16`; `tests/e2e.sh:864` |
| 11 | `--memory-swap` = memory (no swap) | container.ts:64 | field ignored, effect equivalent: `memory.swap.max=0` always | `MemorySwap` not read; `cgroup.rs:17-18` |
| 12 | `--cpus` (NanoCpus) | container.ts:136, workstation.ts:220 | supported (`cpu.max`) | `api.rs:1490-1493`; `cgroup.rs:20` |
| 13 | `--user uid[:gid]`, `--restart unless-stopped`, `--shm-size`, `-e`, `--name`, `-d` | container.ts:135-146, workstation.ts:216-242 | supported | `api.rs:1643, 1647, 1687-1694` |
| 14 | `--network cld-tenant` (user-defined bridge) | container.ts:66 | supported (bridge driver only) | `api.rs:2199-2218` |
| 15 | Bridge option `com.docker.network.bridge.enable_icc=false`, and reading it back with `docker network inspect` | hardening.ts:66-91, 226-232 | **silently ignored, and echoed back**: `Options` is stored and returned verbatim; nothing reads it. Same-bridge traffic is switched and never filtered | `api.rs:2211` (stored), `api.rs:2170` (returned), no other reader of `.options` for networks; `netlink.rs:588-590` ("Traffic within a bridge is switched and never reaches this hook…"). **Our check would report "icc off" while containers on `cld-tenant` can talk to each other.** |
| 16 | `iptables -C/-I/-D` on `DOCKER-USER` and `INPUT` (BLOCKED_RANGES, tcp 25/465/587, conntrack INPUT rule) | hardening.ts:38-42, 115-135, 167-199, 233-241 | **fails our check**: no dockerd, no `DOCKER-USER` chain; Kiri writes its own nftables table `kiri` over raw netlink. On macOS and Windows the agent has no `iptables` binary to run | `netlink.rs:383-385, 563-610` (table `kiri`, chains forward/input/prerouting/postrouting). No egress-filter hook or setting exists. Netfilter itself is complete in the guest kernel (`guest/kernel/kiri.config:155-229`), so rules can be added from a privileged `--network host` container (`tests/kernel-features.sh:9`) |
| 17 | No route from tenants to the host / LAN | hardening.ts:117-119, TRUST_TIERS.md:83 | **not provided**: containers are masqueraded out of the VM's NAT uplink (LAN reachable), and `host.docker.internal` = `198.19.248.254` is relayed to **any port on the Mac's 127.0.0.1**. That address is not in our BLOCKED_RANGES | `crates/kiri-init/src/linux/net.rs:1-2, 13-17`; `crates/kiri/src/daemon/ports.rs:962-990` |
| 18 | `-p 127.0.0.1:<host>:<ctr>` (relayed publish) | container.ts:142, workstation.ts:233, 237 | supported | `docs/features.md` "Networking"; `ports.rs:1-16, 262-269` |
| 19 | `-v cld-<id>:<workdir>`; `docker volume inspect/create/rm` | workstation.ts:230, container.ts:174-192 | supported (local driver) | `api.rs:1262-1330` |
| 20 | `--mount type=bind,source=<host dir>,target=…` | workstation.ts:229 | supported, but the source is a **Mac path** seen through virtiofs (`/mnt/mac/...`); a Linux mount made by our agent cannot exist there | `api.rs:1013, 1068` |
| 21 | Bind propagation (`:rshared`, for the agent-in-a-container case) | volumes.ts:18-20, README.md:214-217 | **silently ignored**: always reported `rprivate` | `crates/kiri/src/daemon/volumes.rs:172-174, 187`; `api.rs:1131` |
| 22 | LUKS2 on a loop file: loop + dm-crypt + aes-xts in the kernel Docker uses; `cryptsetup`, `mkfs.ext4`, `mount` as root | volumes.ts:57-65, 123-144, 210-227, index.ts:190 | **Mac: impossible** — loop is there (`kiri.config:90`) but no `CONFIG_BLK_DEV_DM`, `CONFIG_DM_CRYPT`, `CONFIG_CRYPTO_XTS/AES`; the kernel is `allnoconfig` + this file and loads no modules (`guest/kernel/build.sh:2, 32`; `kiri.config:235`). Windows: uses WSL2's Microsoft kernel — dm-crypt there is **unverified** | as cited |
| 23 | `--gpus "device=i,j"` (DeviceRequests), NVIDIA runtime, `nvidia-smi` | container.ts:139, workstation.ts:227, hardware.ts:26-31 | **rejected** with a clear error ("Kiri does not support GPUs or other device requests") | `crates/kiri/src/daemon/hostopts.rs:62-71` |
| 24 | `docker inspect --format {{json .HostConfig.DeviceRequests}}` | container.ts:215-221 | field absent from inspect; we would read "unknown" (null) | `api.rs:2035-2062` (no `DeviceRequests`) |
| 25 | `docker ps --filter name=^…$`, `docker rm -f`, `docker logs --tail` | container.ts:155-168, 230-238 | supported | `docs/features.md` "Containers"; `daemon/filters.rs` |
| 26 | `--privileged` never used by tenants; agent may need it for itself | README.md:214 | supported; keeps only the vsock/io_uring boundary | `crates/kiri-init/src/linux/seccomp.rs:233-256` |

Summary of the dangerous rows: **4, 5, 15, 21** are accepted without effect; **17** is a host-reachability path our rules do not cover.

## 3. Security assessment

**What our Linux stack gives today.** Tenant → gVisor (user-space kernel) → host kernel, with caps dropped, no-new-privileges,
cgroup limits, a disk quota, an icc-off bridge and egress DROP rules, each verified at boot and before every start. An escape
needs a gVisor bug and a host bug (TRUST_TIERS.md:97-100).

**What Kiri's boundary gives a provider on a Mac.**
- Tenant code runs on a real Linux kernel (6.18.x, custom, built from allnoconfig) inside one Virtualization.framework VM.
  Containers are real root in that kernel when they have uid 0 — no user namespace (`container.rs:1639`). Kiri applies
  Docker's default seccomp filter, masks `/proc` paths, and denies `AF_VSOCK` and io_uring to every container, privileged
  ones included (`seccomp.rs:233-256`). That is ordinary runc-level isolation plus a VM around all tenants together.
- A guest-kernel exploit gives root in the VM. From there the Mac is **not** sealed off: the VM is started with the Mac's
  `/` shared read-write over virtiofs as `/mnt/mac` (`crates/kiri/src/guest.rs:163-164`; `crates/kiri-vmm/src/apple.rs:519`,
  `readOnly: false`), with the access rights of the user running Kiri. How far macOS privacy controls (TCC) limit that is
  unverified. The vsock control channel and host relay are also open to guest root.
- So: the Mac's kernel is protected by a hypervisor; the provider's files are protected only by the Linux kernel's own
  container isolation — one layer, where our Linux nodes have two (gVisor + kernel) and no host share at all.
- Network: every container can open TCP connections to any port on the Mac's loopback (row 17) and to the LAN. Nothing in
  Kiri filters egress.

**On Windows there is no Kiri VM.** `kiri-win.exe` runs the Linux build inside a WSL2 distro on Microsoft's kernel
(`docs/features.md` "Windows"; `contrib/wsl/install.sh`). Containers share that kernel, and the WSL2 utility VM, with every
other WSL distro the user has. Kiri's distro turns interop off but does not turn off drive automount
(`contrib/wsl/kiri-linux/wsl.conf`), and root in a WSL distro can generally mount Windows drives itself (general WSL
behaviour, unverified here). The boundary is "runc-level isolation in the user's WSL VM".

**Tenant vs tenant inside one Kiri VM.** Separate namespaces and cgroups on one shared kernel; no sandbox per tenant.
Containers on the same bridge reach each other (row 15); containers on *different* networks are kept apart by Kiri's forward
filter (`netlink.rs:581-585`). One shared ext4 data disk with no quota (row 4): one tenant can fill it and stop the others.
No encrypted volumes on a Mac (row 22), so "separate sandboxes, no inter-container network, separate volumes"
(TRUST_TIERS.md:112) holds only for "separate volumes".

**What would make our self-check lie.** As shipped it does not lie — it stops at the version check (row 2), then the storage
driver (row 3), then `iptables` (row 16). If those were relaxed for a Kiri mode without more work, three statements would be
false: "network cld-tenant created (icc off)" (row 15: echoed, not enforced), the disk cap (row 4), and `--runtime=runsc`
if we ever forced it (row 5: the container starts, unsandboxed, with no error). Any Kiri mode must test behaviour, not read
settings back.

**Maturity.** The repository has been public since 2026-11-02 (16 days). One maintainer wrote nearly all of it; 6 tagged
releases in 13 days (v0.1.14 → v0.2.1); 188 open issues; ~10k stars. There is a SECURITY.md with private reporting and VM/container
escape in scope, CodeQL on PRs, cargo-deny, and no published advisories yet. Tests: ~650 unit tests and a 1,171-line
`tests/e2e.sh` driven through the real `docker` CLI (caps, no-new-privileges, memory/pids limits are covered); public CI
runs CodeQL, perf and UI tests only — the e2e suite needs a real VM and runs on the maintainer's machines. Releases are
built in a private repository from the public tag (`RELEASES.md`), and the app **updates itself**, so the engine under a
provider's node would change without us. It is built as a fast developer tool (Docker Desktop replacement), and its
choices (share `/`, relay to host loopback, accept-and-ignore unknown options for compatibility) follow from that.

## 4. Options

### (a) Use Kiri as-is — 0 days, does not work
The agent refuses containers at boot (rows 2, 3, 16). Nothing to ship.

### (b) Agent "VM-isolated host" mode on top of Kiri — about 12–18 days, lowest tier only
What would change in `node-agent`:
- `hardening.ts`: detect Kiri (`KiriVersion` in `docker info`), a second self-check path: skip the ≥ 28 rule and the storage
  check; replace the icc option with **one network per deployment** (Kiri isolates networks from each other) or a bridge-family
  nft rule; install egress rules as our own nft table from a pinned, privileged, `--network host` helper container, adding
  `198.19.248.254` and the VM's gateway to the blocked list; verify by **probe containers**, not by reading rules. ~5–7 days.
- `container.ts` / `workstation.ts`: no `--storage-opt`; cap disk another way (`--read-only` + sized `--tmpfs` + a loop-file
  volume per deployment) or accept "no disk cap" and say so. No `--restart unless-stopped`: Kiri restarts such containers
  after a VM crash before our rules are back, so the agent must restart them itself. ~3–4 days.
- `volumes.ts`: no LUKS on Mac; `encrypted-volumes` not announced. `sandbox` not announced; machines refused. GPU refused. 0 days, but it is the product gap.
- New capability name for the API/scheduler ("vm-host" or similar) and a decision on which trust tier may use it. ~1–2 days.
- Installer, pinning a Kiri version and stopping its self-update, live testing on Mac and Windows. ~3–5 days.

Result: a Mac/Windows node that can run verified-tier plain containers only, isolated by one kernel layer, with the Mac's
filesystem one guest-kernel bug away, on a 16-day-old dependency we do not control. Getting gVisor in (running `runsc`
ourselves inside a privileged Kiri container) would be a second runtime of our own: 10+ more days, fragile, not recommended.

### (c) Skip Kiri; ship our own VM with real Docker + gVisor — about 10–15 days, full Linux feature set
- **Windows:** a Cloudana WSL2 distro (`wsl --import` of our tarball): Ubuntu, Docker ≥ 28, `runsc`, cryptsetup, an xfs
  disk with `pquota` for `/var/lib/docker`, `wsl.conf` with automount and interop off, the existing agent started by
  systemd. ~5–7 days including the installer. GPUs keep working through WSL2's NVIDIA support with the normal container
  toolkit (unverified on our image; Kiri cannot do this at all).
- **Mac:** a Lima VM (Apache-2.0, Virtualization.framework driver) from our template: same guest contents, **no host
  mounts**, relay-only networking. ~5–8 days including a launchd wrapper. No GPU on Mac either way.
- `node-agent` changes: essentially none in `hardening.ts`, `container.ts`, `workstation.ts`, `volumes.ts` — the agent runs
  inside the guest as on any Linux host and every existing check stays true. Small additions: report the host kind
  (`hardware.ts`), and packaging.
- Honest costs: a bigger download and slower start than Kiri (hundreds of MB, seconds not milliseconds); we own the image
  and its updates; gVisor on arm64 Lima and on the WSL2 kernel must be confirmed (both unverified here); the WSL2 VM is
  still shared with the user's other distros.

| | (a) Kiri as-is | (b) mode on Kiri | (c) own VM |
|---|---|---|---|
| Effort | 0 | 12–18 d | 10–15 d |
| `container` / `egress-v2` | no | yes, new code path | yes, existing code |
| `sandbox` (gVisor), machines, community tier | no | no | yes |
| `encrypted-volumes` | no | no (Mac) | yes |
| Disk cap per tenant | no | workaround | yes |
| GPU on Windows | no | no | likely (unverified) |
| Host files exposed to guest root | Mac `/` read-write | Mac `/` read-write | none (Mac); WSL caveat (Windows) |
| New agent code to keep correct | — | a second hardening path | packaging only |

## 5. Recommendation

Do not adopt Kiri. Build option (c), Windows first (GPU providers are there), Mac second. Revisit Kiri only if it gains
pluggable runtimes, a way to not share the host filesystem, and an egress hook — and has a year of releases behind it.

### Live probes to run later (Mac, and Windows + WSL2), on whichever backend is tested
Each line is one check; the expected result for our Linux stack is in brackets.

1. `docker version --format '{{.Server.Version}}'` and `docker info --format '{{.Driver}}|{{json .Runtimes}}'` [≥ 28; overlay2; has `runsc`]
2. `docker run --rm --runtime=runsc alpine dmesg | head -1` ["Starting gVisor..."; on Kiri expect it to run *without* gVisor — confirms row 5]
3. `docker run --rm --runtime=does-not-exist alpine true` [must fail]
4. `docker run --rm --storage-opt size=100m alpine sh -c 'dd if=/dev/zero of=/big bs=1M count=300'` [must fail at ~100 MB]
5. `docker run --rm --cap-drop=ALL alpine grep Cap /proc/self/status` [all zero]; with `--cap-add=CHOWN …MACHINE_CAPS` [exactly those bits]
6. `docker run --rm --security-opt=no-new-privileges alpine grep NoNewPrivs /proc/self/status` [1]
7. `docker run --rm --pids-limit=512 --memory 64m --memory-swap 64m --cpus 0.5 alpine sh -c 'cat /sys/fs/cgroup/pids.max /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max'` [512, 67108864, 0, "50000 100000"]; then `tail /dev/zero` [exit 137]
8. icc: `docker network create --opt com.docker.network.bridge.enable_icc=false t`; start `nginx` on `t`; from a second container on `t`, `wget -T3 http://<first ip>` [must time out]
9. Egress: from a container on the tenant network, `nc -zw3` to a LAN host, to the default gateway, to `169.254.169.254:80`, to `host.docker.internal:22` and `:445`, to `198.19.248.254:<an open Mac port>`, and to `smtp.gmail.com:25/465/587` [all must fail]; `wget https://example.com` [must work]
10. Host share: `docker run --rm --privileged --pid=host alpine sh -c 'ls /proc/1/root/mnt'` [no host filesystem visible; on Kiri/Mac expect `/mnt/mac`]
11. Loopback publish: `docker run -d -p 127.0.0.1:18080:80 nginx`, then connect to `<provider LAN ip>:18080` from another machine [must fail]
12. LUKS: as root where the agent runs, the `encryptedVolumesSelfCheck` round trip (`cryptsetup luksFormat/open`, `mkfs.ext4`, `mount`), then `docker run --mount type=bind,source=<mnt>/data,target=/w alpine touch /w/x` [works; data file on disk is ciphertext]
13. GPU (Windows): `nvidia-smi` in the guest and `docker run --rm --gpus '"device=0"' nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi` [lists GPU 0 only]
14. Restart race: stop/kill the VM while a `--restart unless-stopped` container runs; on recovery check whether the container is up *before* the egress rules are [rules must be back first, or the start refused]
15. The agent's own boot log with `CLOUDANA_ALLOW_CONTAINERS=1 CLOUDANA_ENCRYPTED_VOLUMES=1` [announces `container`, `egress-v2`, `sandbox`, `encrypted-volumes`]
