# Trust tiers — who can see what, on every Cloudana workload

Status: **direction decided 2026-11-16** (owner: "go"). The build steps are in `tasks/todo.md` ("Trust tiers and
machines"). This file is the decision record and the source for the user-facing disclosure (§6).

## 1. The problem, in one paragraph

Cloudana runs people's work on hardware that other people own. That raises two questions on every product, not only
on rented machines: **how is the provider protected from the tenant** (their IP address, their home network, their
legal exposure for what the tenant does online, their machine) and **how is the tenant protected from the provider**
(their data on disk, in transit and in memory). Every decentralized compute network has the same problem (vast.ai,
Akash, io.net). fly.io and the hyperscalers avoid it by owning their servers; we cannot.

## 2. Where each product stands today (2026-11-16)

| Product | Provider IP hidden (inbound) | Tenant traffic leaves from provider's IP | Provider can read tenant data |
|---|---|---|---|
| Static sites | yes, relay | no code runs | public anyway |
| Compute jobs (matmul, int8) | yes, relay | no network | yes: inputs are visible; results are verified, not private |
| Storage | yes | no network | **no**: AES-GCM, Cloudana holds the keys (`V4_STORAGE_PHASE1_CONTRACT.md`) |
| Containers, web apps | yes, relay | yes | yes (env secrets are sealed to the node) |
| AI endpoints | yes, relay | yes | **yes: every prompt and answer** |
| Workstations | **no: SSH is published on the node's public IP** (`SECURITY_AUDIT.md` O11) | yes | yes |

Already in place for every container: `--cap-drop=ALL`, `no-new-privileges`, PID/memory/disk caps, a tenant bridge
with no inter-container traffic, and no route to the provider's LAN (`BLOCKED_RANGES` in `node-agent/src/hardening.ts`).
Not in place: a kernel-level sandbox (`SECURITY_AUDIT.md` §5), any limit on outbound ports or volume, encryption of
volumes on the provider's disk, and a way to reach SSH or WebSockets through the relay.

Today any wallet can create a fleet (`POST /v1/fleets`, up to 10), and containers already run only on fleet nodes.
A fleet is a group of nodes with one owner, not a vetted provider: nobody checks who is behind it.

## 3. The decision: three trust tiers, the same for every workload

| Tier | Who hosts | Protects the tenant against | Does not protect against | Fit for |
|---|---|---|---|---|
| **Community** | anyone whose node passes the agent's checks | other tenants; casual access to files at rest; anyone on the network path | a provider who deliberately reads the box's memory or disk while it runs | public code, tests, batch work, anything you would put on a public server |
| **Verified** | fleets Cloudana has approved: a named, identity-checked operator who signed the provider agreement | the same, plus an operator who is known and contractually bound | a verified operator who breaks the agreement (legal recourse, not a technical guarantee) | business data that is not regulated |
| **Confidential** *(later)* | nodes with hardware memory encryption and remote attestation (AMD SEV-SNP, Intel TDX, NVIDIA H100 confidential computing) | the provider too: memory and disk are encrypted by the CPU, and the attestation proves the code that runs | side channels and hardware flaws in the CPU vendor's design | private prompts, regulated data |

Rules:
1. **Every deployment states a minimum tier** (`trust` in the spec). The scheduler places it only on nodes of that tier
   or higher. Compute jobs stay community: their results are verified, and their inputs are not private by design.
2. **Default: verified** for containers, endpoints and machines until community hosting opens (rule 5). A tenant can
   choose community explicitly once it opens; the console shows §6 at the point of choice.
3. **Verified is granted by the owner** per fleet (an admin flag on the fleet, revocable). The criteria: identity
   checked, provider agreement signed, a contact for abuse reports. Revoking it requeues the fleet's verified
   deployments elsewhere, as fleet revocation does today.
4. **Confidential is not built.** It is listed so nobody sells verified as private. It needs attestation verification
   in the API and hardware we do not have.
5. **Community hosting of containers, endpoints and machines opens** only when the kernel sandbox (gVisor), the
   egress policy (§4) and relay-only access (§5) are live and tested. Until then those run on verified fleets only.

As built in the scheduler (phase 1, 2026-11-16), where it is more precise than the rules above:
- Rule 5 is a switch: while the API's `COMMUNITY_HOSTING` is `off` (the default), `trust: "community"` is refused at
  create (400). The owner turns it `on` when community hosting opens.
- A spec with no `trust` (every deployment made before tiers) counts as verified: once re-queued for any reason it
  waits for a verified fleet. Running ones are not moved at deploy time.
- Community placement needs the node to advertise both `sandbox` and `egress-v2`, on any fleet. A verified fleet's
  node without them does not take community work: "or higher" holds for the operator, not for the sandbox.
- The sandbox covers non-GPU containers only, so **GPU work is verified-only**: `trust: "community"` with a GPU is
  refused at create (400).
- Un-verifying a fleet re-queues its live verified work for other verified fleets; work *pinned* to that fleet waits
  in the queue until it is verified again (un-verifying can be undone; revoking cannot, and fails pinned work).
- Machines (phase 4, docs/WORKSTATIONS.md §10): the tenant logs in as **root** of the box by key, not as a user with
  sudo — under gVisor a setuid binary does not raise privileges, and no-new-privileges stays on. Root inside the box is
  root inside gVisor with a short list of capabilities (`MACHINE_CAPS`), only on `sandbox` nodes.
- Disk (§6): only a machine's volume (`/root`) is encrypted; its root filesystem (installed packages, `/tmp`) is the
  container's writable layer, not encrypted. The API makes each volume key and keeps only a copy sealed to the node, so
  Cloudana sees the plaintext once, at creation. Placement needs `encrypted-volumes` (and `sandbox`) on any tier.
- Admin routes: `POST`/`DELETE /v1/admin/fleets/{id}/verified`; the abuse switch is
  `POST /v1/admin/deployments/{id}/abuse` (lifted with `DELETE /v1/admin/accounts/{address}/suspend`).

## 4. Protecting the provider: outbound traffic (every tier, every container)

Tenant traffic to the internet leaves from the provider's connection. Sites see the provider's IP, and abuse is traced
to the provider. The policy:
- **Kept:** no route to private ranges (the provider's LAN, cloud metadata, carrier NAT).
- **New:** outbound mail ports blocked (25, 465, 587). Spam is the most common abuse of rented boxes and gets
  home IPs blocklisted.
- **New:** one abuse switch: a report against a deployment can stop it and suspend the tenant account (admin action),
  and the provider sees why in the console.
- **Later:** per-container bandwidth caps; then **exit relays**: tenant traffic leaves through Cloudana's own exit
  servers, so the provider's IP is never seen at all. That costs bandwidth, so it waits for revenue.

The provider is told plainly when they enable containers: tenants' traffic leaves from their connection, within these limits.

## 5. Protecting the provider: inbound traffic and the machine

- **Inbound: the relay only.** The node opens one outbound connection to the relay and publishes nothing. The relay
  gains raw byte streams (for SSH) and WebSocket passthrough (for web UIs like Jupyter). Then:
  - SSH goes `cloudana ssh <id>`, or `ssh` with the CLI as `ProxyCommand`, to the gateway, then the relay, then the box;
  - direct (public-IP) mode is retired, as decided on 2026-10-21 (B-13).
- **The machine: gVisor** (`runsc`) for every tenant container. It is a user-space kernel between the tenant and the
  host kernel. It works on any Linux host (no KVM needed), and an escape needs a gVisor bug plus a host bug. The
  agent advertises it as a capability, and the scheduler requires it for community placement.
- **Later: Firecracker microVMs** as a stronger tier for KVM-capable providers: a full guest kernel, and Docker inside works.

## 6. Protecting the tenant: data (and the disclosure text)

| Data | How it is protected | By tier |
|---|---|---|
| In transit, SSH | end to end between the tenant and the box's sshd; the relay and Cloudflare carry ciphertext | all |
| In transit, web | TLS to Cloudflare's edge; the gateway and relay carry it inside Cloudana's infrastructure to the node | all (Cloudana's edge sees the plaintext, as with any CDN) |
| Secrets (env) | sealed to the assigned node; never stored in the clear | all |
| Disk (volumes) | **new:** encrypted per deployment with a key held in the agent's memory only; wiped on purge, or after `keepDays` | all; a deliberate provider can still read it while the box runs |
| Memory, while running | nothing in software; only hardware memory encryption | confidential only |
| Other tenants | separate sandboxes, no inter-container network, separate volumes | all |

**Disclosure** (console, at deploy time; docs; Terms):
> **Community:** runs on a stranger's computer. Your traffic is encrypted, and your disk is encrypted at rest and
> wiped when you're done, but the person who owns the machine could read what it's doing while it runs. Use it for
> code and data you'd put on a public server.
> **Verified:** runs only on providers Cloudana has identity-checked who signed our provider agreement. Fit for
> business data that is not regulated. It is a contractual guarantee, not a technical one.
> **Confidential** (coming later): hardware-encrypted memory that even the machine's owner can't read. For private
> prompts and regulated data.

## 7. What stays with the owner

- Approving verified fleets (the criteria in §3 rule 3).
- The provider agreement, the Terms and the acceptable-use policy. Claude can draft them; a lawyer should review them.
- When community hosting opens (§3 rule 5), and when exit relays and the confidential tier are funded.
