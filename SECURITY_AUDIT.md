# Security audit — 2026-10-19

Scope: the code at `main` (`4bef305`) and the fixes made in this pass (commit hashes below). Method: read every
trust boundary in the shipped paths (browser → API, API → node, node → API, gateway/relay → node, keeper → API →
chain), re-check each finding of the October review panel (`docs/REVIEW_PANEL_2026-10.md` C.5) against the code,
and prove each still-open finding with a test before patching it. The live system could not be reached from this
environment (`ENGINEERING_BASELINE.md` §3), so every "verified" below means verified in code and in the package's
own tests, not against production.

Threat model (unchanged from `docs/DECISIONS_CONSENSUS.md`): malicious tenants, malicious providers, Sybil providers,
a compromised API Worker or D1, a MITM on the API, and (for the contracts) a malicious or compromised poster.

Severity: **Critical** = fleet-wide code execution, unbounded mint or theft of another tenant's secrets; **High** =
money or data loss for one party, or a check that can be dodged for profit; **Medium** = bounded abuse, DoS,
information leak; **Low** = hygiene, defence in depth.

## 1. Findings fixed in this pass

### F1 — Sealed secrets were not bound to their deployment — High — FIXED (`622f3c7`)

**Where.** `shared/sealed.ts` (format v1), `node-agent/src/deployments.ts` `openSealed`.
**Problem.** The browser sealed a container's secrets to the node's public key with no associated data. The ciphertext
sat in `deployments.sealed_env` and was forwarded verbatim in heartbeat instructions. Anyone able to write that column
(a compromised Worker or D1, or the operator of a rogue orchestrator a node is pointed at) could copy deployment X's
blob onto deployment Y on the same node; the node opened it and injected X's secrets into Y's container. The heartbeat
signature does not help: the API is the signer.
**Proof.** `node-agent/src/sealed.selftest.ts` "payload sealed for deployment A opened under deployment B" fails on
the old format (the test was written against the new one and the old `open` has no aad to check).
**Fix.** Format v2: `0x02 ‖ ephPub ‖ nonce ‖ ct`, with `cloudana-deployment:<id>` as XChaCha20-Poly1305 associated
data and in the HKDF info. The agent (1.5.0) opens secrets only under the aad of the deployment it is starting and
refuses v1 payloads with a clear message. The API accepts only v2 payloads on `PATCH /deployments/{id}/secrets` and
places deployments that carry secrets only on agents ≥ 1.5.0 (`SEALED_V2_MIN_AGENT`, assignment and preemption).
**Tests.** Agent sealed selftest, 26 checks (cross-deployment, unbound, tampered byte in every region, wrong key, v1
refused, garbage refused). API: `deployments.test.ts` "refuses a legacy (v1) or malformed sealedEnv", "a container
with secrets waits for an agent that opens bound secrets". Suite 334/334.
**Residual.** A compromised API can still *withhold* or *delay* secrets, and still sees which deployment carries
secrets (not their content). Endpoint replicas: the console does not yet seal per replica (backlog B-12), so GPU
endpoints with secrets cannot start from the console today; the API path is correct.

### F2 — The console sealed to whatever key the API returned — High — FIXED (`622f3c7`)

**Where.** `client/src/pages/console/deploy/deployments.tsx` `sealNow`.
**Problem.** `GET /deployments/{id}` returns `nodePubkey`; the console sealed to it without checking that it derives
to the assigned node's address. A compromised or spoofed API could return its own key and read every tenant secret.
The API does check `pubkeyMatchesAddress` at announce, but that protects the API's own table, not the browser.
**Fix.** The console computes `publicKeyToAddress(nodePubkey)` and refuses to seal unless it equals the deployment's
`node`. The node address is what the owner can see and what the API would also have to lie about consistently; it is
the same identity that signs the node's requests.
**Residual.** The API still chooses the node. A rogue API can assign the deployment to a node it controls; the owner
sees the node address before secrets are sealed (the "Seal secrets now" path) but automatic sealing seals to whichever
node is assigned. Mitigation for sensitive workloads: fleet pinning (backlog B-9) or confidential compute (planned).

### F3 — No timeout on `assigned` deployments — High (reliability, billing) — FIXED (`f8e0d1d`)

**Where.** `client/api/src/services/deployment-duties.service.ts`.
**Problem.** A node that kept heartbeating but never reported `running`/`failed` held the deployment and the owner's
first-hour hold indefinitely. Only a *silent* node (G1) triggered a re-queue. A wedged agent or an endless image pull
stranded the workload and the money; the owner's only recourse was to stop it.
**Fix.** Cron duty G4 `requeueStuckAssigned`: after `DEPLOY_START_TIMEOUT_SECONDS` (3600; static sites 600) the
deployment goes back to the queue with the node marked as having refused it and owed a stop; after
`DEPLOY_START_ATTEMPTS` (3) timeouts it fails and the hold is released. Rows waiting for the owner's secrets are not
counted. New column `start_attempts`.
**Tests.** `deployments.test.ts` "start timeout" (two cases: three timeouts → failed, hold back; secrets-waiting rows
and the container timeout).

### F4 — Assignment seeds were not replayable in production — Medium (transparency) — FIXED (`61daf87`)

The Worker had no `CHAIN_RPC_URL`, so `fetchSeedSource` fell back to `local:<ms>` and no third party could replay a
draw from `seed_source` + job id, contradicting roadmap phase 1. `wrangler.toml` now sets the public Base Sepolia RPC.
Residual: the orchestrator still *chooses when* to run the draw (and thus which block hash); replay proves the draw
was honest given the seed, not that the seed was not selected. Pull-based assignment (roadmap phase 2) closes that.

### F5 — Local Wrangler state committed — Low — FIXED (`61daf87`)

`relay/.wrangler/state/**` (Miniflare SQLite, including a Durable Object store) was tracked. Removed and ignored. No
secret was found in it, but local state must never be reviewable or deployable by accident.

### F6 — Login errors outside the envelope — Low — FIXED (`61daf87`)

`/v1/auth/login` returned `{ status:"error", message }` instead of `{ status:"error", error:{ code, message } }`.
Clients branching on `error.code` would treat an auth failure as a parse failure.

## 2. Findings from the October review re-checked and confirmed fixed before this pass

| Review item (C.5) | State in code | Where |
|---|---|---|
| Heartbeat instructions unsigned → fleet-wide RCE | **Fixed.** `personal_sign(keccak256(canonicalJSON({nodeAddress, ts, nonce, body})))`; agent pins the signer (`0x90ec…a247` baked in, overridable), ±60 s window, nonce LRU; unsigned/foreign instructions ignored; plain-http API refused | `instruction-signing.service.ts`, `node-agent/src/instructions.ts`, `index.ts` |
| No nonce on node requests (60 s replay) | **Fixed.** `X-Nonce` mandatory, atomic `INSERT … ON CONFLICT DO NOTHING` into `node_nonces` (120 s), signature covers the nonce; keying on the signature was rejected (ECDSA malleability) | `middleware/node-auth.ts` |
| Hosting billing fraud (any URL, 2xx probe) | **Fixed.** Content-hash probe of a stored file; relayed deployments are probed through the node's own socket (it can only answer for what it serves); direct endpoints must sit on the node's verified public host, which must equal the announcing IP outside DEV_MODE; `busy`/abort/over-cap all fail | `deployment-duties.service.ts` `probeRelayed`, `reportDeploymentStatus`, `routes/v1/nodes.ts` announce |
| docker.sock + any image | **Fixed on the agent.** `--cap-drop=ALL`, `no-new-privileges`, pids/memory/swap caps, `--storage-opt size` (xfs pquota / btrfs / zfs required), user-defined bridge with icc off, egress DROP to RFC1918/169.254/100.64 (DOCKER-USER + conntrack-aware INPUT), re-checked before every start, non-root default user, NVIDIA env stripped and devices allocated explicitly, image allowlist unless `any-image` opted in, Docker ≥ 28 for 127.0.0.1 publishing | `node-agent/src/container.ts`, `hardening.ts`; API only places containers on fleet nodes that announced `container` |
| Sealed env lacks AAD; pubkey unverified client-side | **Fixed in this pass** (F1, F2) | |
| Port collision on 2nd port | **Fixed.** `takenPorts()` covers every port of every record | `node-agent/src/deployments.ts` |
| No resource-fit check | **Fixed.** CPU/RAM/GPU fit against the manifest minus a host reserve; ≤ 5 containers / 20 sites per node | `deployment-duties.service.ts` `fits` |
| Stuck in `assigned` with publicHost 127.0.0.1 | **Fixed** (host must be public or the node has no hosting capability) and now bounded by F3 | |
| Heartbeat ran global duties (DoS by Sybil keys) | **Fixed.** Global duties on the cron; per-node duties only on the heartbeat; per-node limits key on the verified address | `security.ts`, `nodes.ts` |
| DNS SSRF in probes | **Fixed for direct probes** (`endpointAllowed`: literal IP ranges refused, `.local`/`.internal`/`localhost` refused). Hostnames are not resolved before the fetch, so a public name resolving to a private address is possible for *direct* nodes only; relayed deployments never fetch an operator-supplied URL. Direct nodes are legacy; backlog B-13 resolves and pins | `deployment-spec.ts` `endpointAllowed` |
| Bind code in printed URL, first-bind-wins, no unbind | **Partly.** Code is issued only to the node (announce is node-signed) and checked atomically; brute force limited to 10/min per IP on a 64-bit code. No unbind for home nodes (fleet evict exists) — backlog B-10 | `nodes.service.ts` |
| Revoked fleets keep nodes | **Fixed.** Revoke/evict clears payout and fleet; live deployments re-queued | `fleets.service.ts`, `requeueNodeDeployments` |
| Self-reported hardware (Sybil) | **Bounded.** Assignment weight moves only with verified work (EMA from 1); the manifest is used for container *fit* only; a lie leads to a failed start that is re-placed and never billed. Lane B is capped at ρ ≤ 0.04 so self-dealing always loses | `nodes.service.ts`, `ledger.service.ts` |
| Leaked EOA is admin+minter on the live CLDToken; faucet mints with it | **Code side fixed; owner step open.** No chain key in the Worker; faucet and legacy chain writes deleted; `shared/addresses.baseSepolia.json` marks every legacy address compromised. The fresh v2 deploy under a Safe is owner step 4 and has not happened | `docs/OWNER_RUNBOOK.md` |

## 3. Open findings (not fixed here), with severity and proposed correction

| # | Severity | Finding | Why it is open | Correction |
|---|---|---|---|---|
| O1 | Critical (launch-blocking, owner) | Legacy CLDToken minter/admin is the leaked key; v2 contracts not deployed; keeper not running | Needs the owner's Safe, poster key and deploy (runbook steps 3–6) | Run `contract/scripts/v2/deploy.ts`; keep legacy addresses listed as compromised; never reuse 0xF292… |
| O2 | High | A compromised API can route a deployment with secrets to a node it controls | Inherent to orchestrator-chosen placement | Fleet pinning for sensitive deployments (owner chooses a fleet, not a node); TEE tier later |
| O3 | High | JWT: HS256, 24 h, no revocation, one secret for both runtimes | Design | Short-lived access token + rotating refresh, `kid` for secret rotation, server-side revocation list in KV; scope claims for API keys |
| O4 | High (scale) | ~12 D1 statements per heartbeat per node; single-writer D1 | Architecture | Batch the per-node duties into one `db.batch`, skip duties for nodes with nothing live, move `relay_at`/`last_seen` to KV with a 15 s write coalescing; measure before and after (B-5) |
| O5 | Medium | Agent nonce LRU is in-memory: an instruction captured and replayed within 60 s of an agent restart is accepted | Window is 60 s and requires a captured signed instruction | Persist the last nonces to `.data`, or include the agent's boot id in the signed body (API echoes it) |
| O6 | Medium | `submitWork` records provider rewards even if the fee capture fails (hold missing) | Practically unreachable today (hold taken at enqueue, released only on give-up) | Make capture and reward one conditional step; skip rewards and log when capture fails (B-11) |
| O7 | Medium | Rate limits are KV-backed and eventually consistent (an abuse stop, not a quota) | Documented | Durable Object or the Workers rate-limit binding (already used by the gateway) for the write buckets |
| O8 | Medium | Direct (legacy) nodes: hostnames not resolved before probing (DNS rebinding to private ranges) | Direct mode is legacy; relayed mode never fetches operator URLs | Resolve + check + pin the IP, or retire direct mode once the relay is live (B-13) |
| O9 | Medium | Testnet credits keyed per wallet/IP/ASN — cheap Sybil for free credits | Testnet only, no value | Remove before value (decided) |
| O10 | Medium | Relay DO `/kick` and `/status` are reachable to anyone with the binding; the gateway binding could kick nodes | Bindings are trusted scripts | Restrict `/kick` to the API via a shared header, or split the stub interface |
| O11 | Low | Workstation SSH is published on the node's public IP (direct mode only) | WebSockets over the relay not built | Relay WebSocket tunnelling (planned) |
| O12 | Low | `MIN_AGENT_VERSION` defaults to 1.3.0 while the agent is 1.5.0; sealed-v2 gating is per-deployment, not a hard minimum | Deliberate: do not cut off compute/hosting nodes | Raise the minimum once the owner's node runs 1.5.0 |

## 4. Verification and settlement (what the proofs do and do not establish)

- **Matmul (cuPOW).** The orchestrator issues σ bound to (job, node, nonce, seed). The node computes the noisy block
  product with transcript hash; the API re-executes the transcript over *its own* copy of A and B (not the node's,
  so int32 wrap cannot bind a different matrix), checks `z`, and Freivalds-checks the answer (2 rounds, exact over the
  integers because results are bounded to ±n·bound²). The transcript proves **the node did the n³ work for this σ**;
  Freivalds proves **the answer is A·B**. Neither proves who ran it, on what hardware, or that anything was kept
  confidential. Verification costs the orchestrator the same n³ as the work (full re-execution) — the planned
  "Freivalds every job, transcript 1-in-k with delayed earnings" (`docs/POUW_REVIEW.md` §7) is the cost fix and is not
  built. Replay: σ is single-use per assignment and `cert_z` is stored; a certificate for another σ fails.
- **Hosting / containers / endpoints.** *Probed*, not proven: a content hash (sites) or a health path (endpoints)
  fetched through the node's own relay socket every 60 s. Billing is for time a probe saw working. A node can serve
  the probe path correctly and other paths badly; nothing checks that, by design (fees only, no subsidy).
- **Storage phase 1.** Merkle leaf challenges prove a copy is *retrievable now*, never that it is replicated; R2 is the
  durable copy. Correct labelling: `challenged`, not `replicated`.
- **Contracts (v2, not deployed).** 224 Hardhat tests pass offline. Invariants enforced on post: treasury ≥ 3 % of
  fees, lane A + treasury ≤ 98 % of fees, lane B ≤ epoch allowance (8 % → ×0.85/yr → 1.5 % floor), fees ≤ free
  escrow; per-(epoch, account, lane) claim flags; `mintedA ≤ totalLaneA`, `mintedB ≤ totalLaneB`; token-level annual
  net mint ceiling; veto window; lane-B claw before vest. What is *not* enforced: that the leaves are correct (the
  poster chooses the root; the guardian veto and the published leaves are the check), per-user escrow withdrawal
  (mainnet item), k-of-n posters. Reorgs: the keeper waits one confirmation and re-reads on-chain state each pass; the
  deposit watcher trails the head by `DEPOSIT_CONFIRMATIONS` (10).
- **Ledger.** Integer µCLD; holds moved with conditional updates (`WHERE balance_ucld >= ?`, `WHERE held_ucld = ?`);
  the hour is claimed (`held_ucld → 0` conditional) before it is charged, so concurrent heartbeats cannot bill twice;
  epochs close once (vetoed ones re-close under the same id); clawed entries drop out of the next close and of
  `fees_burned`. The e2e run in `TEST_EVIDENCE.md` shows two fees captured once each, a refused answer leaving its fee
  held, and the posted treasury within the contract's bounds.

## 5. What the audit did not cover

Container escapes beyond the Docker flags (no kernel-level testing; gVisor is a listed option), GPU isolation under a
real NVIDIA runtime, the relay under load, Cloudflare account/DNS security, the console's supply chain
(the `ConsoleApp` bundle is 4.4 MB with wallet SDKs), and anything in production configuration (secrets, bindings,
D1 contents), which this environment could not reach.
