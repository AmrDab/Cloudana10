# Legacy features — what to revive (audit 2026-10-01)

Ranked by value for the new console. "Contradicts model" = marketplace/bidding or user-picks-provider framing.

| # | Feature | Code | Works today? | Effort | Where in the new console |
|---|---|---|---|---|---|
| 1 | Templates (awesome-akash + curated) | api services/template-*.ts | yes (store needs seeding) | M | Run → Deploy — **being revived now** |
| 2 | Faucet (test CLD on Base Sepolia) | api routes/v1/faucet.ts, pages/faucet.tsx | yes, needs minter key | S | already routed at /control/faucet; add "Get test CLD" to empty balance states |
| 3 | Node logs & health viewer | routes/v1/provider-logs.ts, pages/provider-logs.tsx, provider-node-server/src/log-buffer.ts | proxy + UI fine; swap lookup to nodes registry | M | Provide → per-node "Logs & health" drawer |
| 4 | Hardware scan via node URL (SSRF-guarded) | routes/v1/hardware-scan.ts | yes; agent must expose /hardware-scan | S–M | Provide → "Add a node" |
| 5 | Stripe credits (checkout, webhook, history) | routes/v1/payments.ts, services/stripe.service.ts | yes with STRIPE_* secrets | M | Earnings/Overview "Buy credits" — **owner policy decision** |
| 6 | Decentralization transparency page | pages/decentralization.tsx, data/decentralization.ts | static; content needs the datacenter framing | S | Docs → "Trust" |
| 7 | PoUW certificate viewer (from job-detail) | pages/job-detail.tsx (cherry-pick) | the certificate panel only | M | Run job drilldown / Verify |
| 8 | Workload status/logs/endpoints API shape | routes/v1/workload-status.ts | shape reusable; transport was k3s | M–L | Run → Deployments (shape reused by the new deployments API) |
| 9 | IPFS pin (Pinata, server-held JWT) | routes/v1/ipfs.ts | yes with PINATA_JWT | S | internal: pin job specs / receipts |
| 10 | Placement scoring (orchestration.ts, placement.service.ts) | api services | logic reusable; targets old daemon | M–L | Overview "what the orchestrator assigned and why" |
| 11 | Provider/usage calculators | pages/pricing/*-calculator.tsx | self-contained; GPU table scrapes Akash → drop | M | Provide estimate (rebuilt on live price) |
| 12 | SDL editor (new-deployment/*) | pages/new-deployment | Akash-specific, bid wording | L | drop; keep only form shell ideas |

Borrow into node-agent: provider-node-server/src/{ip-detection,log-buffer,health,hardware-detect(tier+deviceId)}.ts.
Retire: build-provider, k3s/akash services, provider-register*, provider-build-cluster, providers-explorer/list (browse-and-pick), GPU price table.
