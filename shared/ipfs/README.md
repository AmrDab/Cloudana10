# Cloudana IPFS Data Structures

This directory defines and documents IPFS-backed data for Cloudana. **On-chain we store only pointers (CID or gateway URL); full device spec and workload manifests live on IPFS** for scalability and flexibility.

## Design principles

- **On-chain**: Minimal protocol state only — identity (owner, deviceId), pointer to metadata (IPFS CID or URL), lifecycle status. No capacity or capability structs on-chain.
- **IPFS**: Single source of truth for provider device spec and workload manifest content. Versioned, extensible schemas.
- **Optional future**: Akash-style simple on-chain attributes (e.g. key-value filters) can be added later for indexer/filtering without fetching IPFS; not required for MVP.

---

## Provider metadata (device spec)

**Stored at**: IPFS; on-chain we store only the **metadata URI** (gateway URL or raw CID string) in `ProviderRegistry`.

**Used for**: Dashboard display, placement capacity checks, discovery. Orchestrator and frontend resolve the URI and use this JSON as the device spec.

### Schema (versioned, extensible)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemaVersion` | string | recommended | e.g. `"1.0"` for future evolution |
| `name` | string | yes | Display name |
| `description` | string | no | Short description |
| `createdAt` | string (ISO 8601) | recommended | Publish time |
| **Capacity** | | | |
| `cpuModel` | string | no | e.g. "Intel Xeon E5-2686 v4" |
| `cpuCores` | number | no | Logical cores |
| `cpuThreads` | number | no | |
| `ramTotal` | string | no | e.g. "256 GB", "1.5 TB" |
| `storageTotal` | string | no | e.g. "4 TB NVMe" |
| `gpuModel` | string | no | e.g. "NVIDIA A100" |
| `gpuCount` | number | no | 0 = CPU-only |
| `gpuMemory` | string | no | e.g. "40GB" |
| **Location / attributes** | | | |
| `region` | string | no | |
| `country` | string | no | |
| `city` | string | no | |
| **Contact / org** | | | |
| `website` | string | no | |
| `email` | string | no | |
| `organization` | string | no | |
| **Extensibility** | | | |
| `attributes` | object | no | Future key-value filters (e.g. `{"tier": "gpu", "arch": "x86"}`) |
| `*` | any | no | Additional fields allowed for forward compatibility |

Placement and UI derive **capacity** from: `cpuCores` → cpu units (×1000), `ramTotal`/`storageTotal` (parsed to bytes), `gpuCount`. All other fields are for display and filtering.

---

## Workload manifest

**Stored at**: IPFS; on-chain `WorkloadRegistry` stores **manifest CID** (bytes) plus **resource requirements** (struct) for fast placement without fetching every manifest.

- **manifestCID**: Points to IPFS document (deploy spec: services, profiles, etc.).
- **requirements**: Currently duplicated on-chain (cpu, memory, storage, gpu, regions, …) so the orchestrator can match pending workloads to providers without IPFS reads for requirements. Full deploy spec is on IPFS for execution and display.

**Future option**: Requirements could be derived only from manifest (single source of truth on IPFS); then placement would need to fetch manifest for each pending workload, trading off latency vs. consistency.

---

## Provider flow (IPFS-centric)

1. **Register**: Upload provider metadata JSON to IPFS → get CID → call `registerProvider(deviceId, metadataUri)`. Chain stores only `metadataUri` + status + owner.
2. **Resolve**: Any client (dashboard, orchestrator) reads `getProviderByDevice(deviceId)` → gets `metadataUri` → fetches JSON from IPFS (or gateway URL) → uses full device spec.
3. **Placement**: Orchestrator gets active device IDs from chain, for each device gets `metadataUri`, fetches capacity from IPFS, matches to workload requirements.

---

## Workload flow

1. **Create**: Upload workload manifest (deploy JSON) to IPFS → get CID → call `createWorkload(manifestCID, requirements)`. Chain stores CID + requirements.
2. **Placement**: Orchestrator reads pending workloads (requirements from chain), reads provider capacity from IPFS, records placement on-chain.
3. **Execution**: Provider fetches manifest from IPFS using `manifestCID` to run the workload.

---

## Workload: chain vs IPFS (review)

| Data | Where | Purpose |
|------|--------|---------|
| **manifestCID** | On-chain (WorkloadRegistry) | Pointer to full deploy spec on IPFS. |
| **requirements** | On-chain (WorkloadRegistry) | CPU, memory, storage, GPU, regions — used by orchestrator for placement without fetching every manifest. |
| **Manifest (deploy spec)** | IPFS | Full JSON (services, profiles, etc.) for execution and UI. |

Keeping requirements on-chain allows the orchestrator to match pending workloads to providers in one chain read + IPFS fetch per provider; moving requirements to IPFS only would require fetching every pending workload manifest for each placement cycle (higher latency, single source of truth).

---

## Orchestrator & placement (optimized)

- **Enough providers**: `getActiveProviders()` returns device IDs; early exit with `reason: "no_providers"` when length is 0.
- **Enough workload**: Pending workloads are batch-read via `readPendingWorkloadsWithRequirements()` (1–2 RPCs: getWorkloadCount + getWorkloadsBatch); early exit with `reason: "no_workloads"` when none pending.
- **Placement**:
  - Requirements come from the same batch (no per-workload `readWorkload`).
  - Provider capacity: one IPFS fetch per active provider per cycle (cached), then in-memory match; no W×P IPFS calls.
- **Summary**: `reason` is one of `no_workloads` | `no_providers` | `no_capacity` | `ok` so the orchestrator can log and act on enough vs not enough providers/workload and placement success.

---

## Provider node (SDK)

- **Input**: Receives placement (workloadId, instanceId, manifest) e.g. via POST /deploy or by watching `WorkloadPlaced` and resolving manifest from chain + IPFS.
- **Capacity**: Orchestrator already checked provider capacity (from IPFS) before placing. The node may optionally report usage/health for future available-capacity updates.
