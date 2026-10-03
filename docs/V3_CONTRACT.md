# V3 — hosting, templates, provider depth, security, 20-year economics

Status: build contract · 2026-10-01 · owner ask: "functional end to end, not an MVP; bring back the templates;
add what Cloudflare does; a coming-up list; mention security and encryption; reuse legacy; prove the chain and
tokenomics over 20 years."

Vocabulary rules still apply (docs/V2_BRIEF.md §6, tasks/lessons.md): orchestrator not marketplace; users never pick a
provider; minted per verified job, settled in batches; "proven" only for compute; status chips are the truth.

---

## 1. What becomes real this sprint

| Capability | Today | After | How it is checked | Pays |
|---|---|---|---|---|
| Static hosting | planned | **Live · testnet** — node agents serve sites; orchestrator probes uptime | HTTP probe every 60 s (orchestrator now; browser witnesses later) | fees only (lane A) |
| Containers (templates) | early | **Early access** — full path built; runs on Docker-capable nodes (none on this dev machine) | uptime probe | fees only |
| Templates catalog | empty store | 500+ from awesome-akash + curated Cloudana starters | — | — |
| Sealed secrets | — | env vars encrypted in the browser to the assigned node's key; orchestrator stores ciphertext | unit-tested round trip | — |

No subsidy (lane B) for hosting until witness probes exist — say "probed", never "proven".

## 2. Data model (client/api/schema.sql + lib/schema.ts ensureSchema)

```sql
CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, template_id TEXT, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('static','container')),
  spec_json TEXT NOT NULL,            -- see §3; ≤ 2 MB for static, ≤ 32 KB for container
  sealed_env TEXT,                    -- ciphertext (base64), container only, optional
  price_ucld_per_hour INTEGER NOT NULL,
  status TEXT NOT NULL,               -- queued | assigned | running | unreachable | stopped | failed
  status_reason TEXT,
  node TEXT, endpoint TEXT,
  assigned_at INTEGER, started_at INTEGER, stopped_at INTEGER,
  last_billed_at INTEGER, last_probe_at INTEGER, probe_fail INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deployments_owner ON deployments(owner, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployments_node ON deployments(node, status);
CREATE TABLE IF NOT EXISTS deployment_events (
  id TEXT PRIMARY KEY, deployment_id TEXT NOT NULL, at INTEGER NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deployment_events ON deployment_events(deployment_id, at DESC);
```
`nodes` gains `pubkey TEXT` (uncompressed secp256k1 hex, sent on announce). `work_types` on nodes already lists
capabilities: add `"hosting"` (static) and `"container"` (Docker present).

## 3. Specs

```ts
type StaticSpec = { files: { path: string; contentBase64: string }[] };     // index.html required; total ≤ 2 MB
type ContainerSpec = {
  image: string; command?: string[]; env?: Record<string,string>;           // env is plain; secrets go in sealedEnv
  ports: { container: number; protocol?: "tcp" }[]; cpu: number /* millicores */; memMb: number; storageMb: number;
};
```
Price (protocol-set, env-configurable): `PRICE_HOSTING_UCLD_PER_HOUR` default 50; container =
`cpu/1000 × PRICE_CPU_UCLD_PER_HOUR (200) + memMb/1024 × PRICE_MEM_UCLD_PER_GB_HOUR (100) + storageMb/1024 × 20`, min 50.

## 4. API (all under /v1, envelope as everywhere)

User (JWT):
- `POST /deployments` `{ templateId?, name, kind, spec }` → 201 `{ id, priceUcldPerHour, status:"queued" }`.
  Holds the first hour from the balance (422 if short). Validates spec; for static, `index.html` must exist.
- `GET /deployments` → `{ deployments: Deployment[] }` (mine, newest first).
- `GET /deployments/{id}` → `{ deployment, events: Event[] (≤ 50) , nodePubkey?: string }`.
- `PATCH /deployments/{id}/secrets` `{ sealedEnv }` → 200. Only while status ∈ queued|assigned.
- `DELETE /deployments/{id}` → `{ status:"stopped" }` (requests stop; node confirms).
- `Deployment = { id, templateId, name, kind, status, statusReason, node, endpoint, priceUcldPerHour, createdAt,
  assignedAt, startedAt, stoppedAt, lastProbeAt, probeOk: boolean|null, spec (container env redacted to keys) }`

Public:
- `GET /templates` (exists) — must be populated. `GET /templates/{id}` (exists).
- `GET /network` gains `deploymentsRunning`.

Internal (X-Internal-Key): `POST /admin/templates/refresh` → fetch awesome-akash (template.service) + curated list
(`template-seed.ts`, extend to ≥ 40 entries: static starters, Nginx, Node, Python, Postgres, Redis, MinIO, Ollama,
vLLM, Stable Diffusion, Jupyter, Grafana, Uptime Kuma, Ghost, WordPress, Gitea, n8n, Matrix, Mastodon…) → store.

Node (node-signed, like heartbeat):
- `POST /nodes/announce` body gains `pubkey`, and `workTypes` may include `hosting` / `container`.
- `POST /nodes/heartbeat` response gains `deployments: { id, action:"start"|"stop", kind, spec, sealedEnv? }[]`
  (queued deployments assigned to this node by capability + capacity; stop requests).
- `POST /nodes/deployments/{id}/status` `{ status:"running"|"failed"|"stopped", endpoint?, message? }`.

Orchestrator duties (run inside the heartbeat handler, no new process):
- Assign queued deployments to an online node with the right capability (`hosting` for static, `container` for
  container); if none online → stays queued, event "waiting for a capable node".
- Probe running deployments ≥ 60 s since last probe: `GET endpoint` 3 s timeout; ok → probe_fail=0; fail → +1;
  3 fails → `unreachable` (billing pauses); success again → `running`.
- Bill: for running deployments ≥ 1 h since last_billed_at: debit owner (capture hold, re-hold next hour), credit
  provider lane A `0.975 × fee` + treasury `0.005 × fee` via ledger.service (fee burned at settlement like jobs).
  Insufficient balance → `stopped` reason `out of credits`, stop request to node.

## 5. Node agent (node-agent/src)

- `--public-host` / `CLOUDANA_PUBLIC_HOST` (default `127.0.0.1`), `--ports 42000-42100`.
- Capabilities: always `matmul`; `hosting` always (static server built in); `container` only if `docker info` succeeds.
- `hosting`: write files to `.data/sites/<id>/`, serve with Node `http` (static, correct MIME, no directory listing,
  path traversal blocked, `index.html` fallback for `/`), report `endpoint = http://<host>:<port>`.
- `container`: `docker run -d --name cld-<id> --memory --cpus -p <hostport>:<containerport> -e … image`; report
  endpoint of the first port; `stop` → `docker rm -f`. Sealed env: decrypt with the node key (see §6).
- Persist running deployments in `.data/deployments.json` and resume serving after restart.
- Stop on `action:"stop"`; report `stopped`.

## 6. Sealed secrets (E2E)

ECIES over secp256k1: ephemeral key → ECDH with node pubkey → HKDF-SHA256 (info `cloudana-sealed-env-v1`) →
XChaCha20-Poly1305 (`@noble/ciphers`, `@noble/curves`, `@noble/hashes` — already in node_modules via viem).
Payload `base64(ephemeralPubkey(65) ‖ nonce(24) ‖ ciphertext)`. Shared implementation in
`shared/sealed.ts` used by browser (`client/src/lib/sealed.ts` re-export) and agent. Unit test: round trip + tamper fails.

## 7. Console (client/src)

Run page → two tabs: **Compute job** (existing) · **Deploy** (new):
- Templates browser: categories sidebar, search, cards with logo/name/summary/category, status "Static" / "Container";
  curated starters first. Detail drawer: README, resources, price/hour estimate, `Deploy`.
- Deploy form: name, (static) upload folder / paste HTML with a working default `index.html`; (container) image, env
  (plain + secret toggle → sealed after assignment), ports, size presets (S/M/L).
- Deployments table: name, kind, status chip (queued muted · assigned amber · running teal · unreachable red ·
  stopped), node, endpoint (link), price/h, probe "ok 12 s ago"; detail: events log, Stop.
Provide page: node cards show capabilities (Compute · Hosting · Containers) from `workTypes`, running deployments
per node, per-node earnings; Earnings estimate = live price × benchmark × chosen utilization (clearly "estimate").
Services page + homepage Services: the catalog in §8; new homepage sections **Security** (§9) and **Coming up** (§10).

## 8. Service catalog (lib/services.ts) — honest statuses

Live · testnet: GPU / CPU compute · **Static hosting** (after §1 verified).
Early access: Containers · AI inference · Storage.
Planned: CDN & edge cache · DNS · TLS certificates · DDoS shielding · WAF · Edge functions · Object storage ·
KV & queues · Tunnels (reach home nodes behind NAT) · Zero-trust access · Databases & apps · Confidential VMs ·
Website builder · AI gateway · Remote desktops for agents.
Group in the UI: Compute · Hosting & delivery · Storage & data · Security & access · Coming up.

## 9. Security & encryption — say exactly this much

Live today: wallet sign-in by server nonce + EIP-191 signature, short-lived JWT kept in the tab only · every node
message signed with the node's secp256k1 key · one-time bind codes · fleet tokens stored as SHA-256 hashes, shown
once · σ-bound cuPOW transcripts, Freivalds re-check, planted verifier tasks · rate limits and CORS allow-list ·
settlement by Merkle root on Base with a veto window and guardian · TLS in transit (production).
Building (this sprint): sealed secrets — container env encrypted in your browser to the assigned node's key; the
orchestrator never sees plaintext.
Planned: encrypted job inputs/results at rest with user keys · confidential VMs (TEE) · browser witness probes.
Never say "military-grade", "unhackable", "zero-knowledge" (zk verifier is in development), "audited".

## 10. Coming up (roadmap list, no dates)

Website builder · Tunnels for home nodes · Managed Postgres · Confidential VMs & agent desktops · Browser witness
network (uptime probes) · Object storage · Edge functions · Fiat on-ramp · Mainnet.

## 11. Economics proof

- `scripts/sim/tokenomics-20y.ts`: current model only (burn F; mint 0.975F provider + 0.005F treasury; lane B
  subsidy min(ρF, budget) with ρ schedule; vesting; verifier credits; demand/supply scenarios; provider power cost);
  outputs `docs/TOKENOMICS_SIM_20Y.md` + `client/src/data/tokenomics-sim.json` (yearly series per scenario).
- `contract/test/long-run-settlement.test.ts`: 20 years at weekly epochs (1040) × 60 providers: post → finalize →
  claim; invariants (supply = Σ minted − Σ burned, caps respected, no double claim, vetoed epoch handling); gas table.
