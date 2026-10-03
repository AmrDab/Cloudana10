#!/usr/bin/env bash
# Full PoUW loop against a local Worker. Prereq: `npx wrangler dev --port 8790 --local` running.
# Seeds a fresh owner wallet with 5 CLD credits in the local D1, then runs e2e-loop.ts.
set -euo pipefail
cd "$(dirname "$0")/../.."

OWNER_PK=$(node --input-type=module -e 'import { generatePrivateKey } from "viem/accounts"; console.log(generatePrivateKey())')
OWNER=$(node --input-type=module -e "import { privateKeyToAccount } from 'viem/accounts'; console.log(privateKeyToAccount('$OWNER_PK').address.toLowerCase())")

npx wrangler d1 execute cloudana-db --local --command \
  "INSERT INTO balances (address, balance, updated_at) VALUES ('$OWNER', 5, '$(date -u +%FT%TZ)') ON CONFLICT(address) DO UPDATE SET balance = 5" >/dev/null

# wrangler dev reloads its local D1 after an external write — wait for it.
for _ in $(seq 1 30); do
  curl -sf -m 3 http://127.0.0.1:8790/health >/dev/null && break
  sleep 1
done

OWNER_PK="$OWNER_PK" npx tsx scripts/dev/e2e-loop.ts
