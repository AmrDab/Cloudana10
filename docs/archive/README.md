# Archive — superseded design documents

Kept for the audit trail, not as a description of the system. Everything here predates the orchestrator model
(`docs/DECISIONS_CONSENSUS.md`, 2026-10) and most of it describes subsystems that were removed on 2026-10-19 because
they were never deployed (`ENGINEERING_BASELINE.md` §5): the Akash bridge, the k3s/ssh2 provider builder, the
Kubernetes provider node, on-chain `WorkloadRegistry` placement and the mining-pool PoUW.

| File | What it was | Superseded by |
|---|---|---|
| `MVP_intro.md` | The original marketplace-era MVP description (bids, provider bonds, Akash) | `README.md`, `ARCHITECTURE.md` |
| `SYSTEM_FLOWCHART.md` | Flows of the Akash/k8s orchestrator | `ARCHITECTURE.md` |
| `UX_PROPOSAL.md` | Console proposal for the marketplace era | `client/src/pages/console/*`, `docs/HOMEPAGE.md` |
| `POUW_TESTNET_PLAN.md` | Mining-pool PoUW plan (lottery difficulty, pool funding) | `docs/POUW_REVIEW.md`, `docs/UNIVERSAL_POUW.md` |
| `DEPLOYMENT.md` | Deployment notes for the two-runtime API including the Akash image | `DEPLOYMENT_RUNBOOK.md`, `docs/OWNER_RUNBOOK.md` |

The current capability status is `CAPABILITY_MATRIX.md`; nothing in this folder should be quoted as the product.
