#!/usr/bin/env bash
# Bring up the whole Cloudana stack locally. Nothing here touches a public network.
#
#   bash scripts/dev/up.sh        # start everything
#   bash scripts/dev/down.sh      # stop everything
#
# Services: local chain :8545 · API :8790 · keeper · one provider node agent.
# The website is served by the Vite dev server at http://localhost:7003/app/
# (start it with `npm run dev` at the repo root if it isn't already running).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RUN="$ROOT/.dev-run"
mkdir -p "$RUN"
: > "$RUN/pids"

start() { # name, dir, command…
  local name=$1 dir=$2; shift 2
  (cd "$dir" && nohup "$@" < /dev/null > "$RUN/$name.log" 2>&1 & echo $! >> "$RUN/pids")
  echo "  started $name  (log: .dev-run/$name.log)"
}

wait_for() { # url, label
  for _ in $(seq 1 60); do
    curl -sf -m 2 -X POST -H 'content-type: application/json' \
      --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$1" >/dev/null 2>&1 && return 0
    curl -sf -m 2 "$1" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "  ✗ $2 did not come up — see .dev-run/*.log"; exit 1
}

echo "Cloudana · local stack"

echo "1/5 local chain"
start chain "$ROOT/contract" npx hardhat node
wait_for http://127.0.0.1:8545 "local chain"

echo "2/5 contracts"
(cd "$ROOT/contract" && npx hardhat run --network localhost scripts/local/deploy.ts > "$RUN/deploy.log" 2>&1) \
  || { echo "  ✗ deploy failed — see .dev-run/deploy.log"; exit 1; }
echo "  deployed (addresses: shared/addresses.local.json)"

echo "3/5 API"
(cd "$ROOT/client/api" && npx wrangler d1 execute cloudana-db --local --file=./schema.sql > "$RUN/schema.log" 2>&1)
start api "$ROOT/client/api" npx wrangler dev --port 8790 --local
wait_for http://127.0.0.1:8790/health "API"

# The keeper authenticates to the API with the same internal key the API reads from .dev.vars.
export INTERNAL_API_KEY="$(grep -E '^INTERNAL_API_KEY=' "$ROOT/client/api/.dev.vars" | cut -d= -f2-)"
[ -n "$INTERNAL_API_KEY" ] || { echo "  ✗ INTERNAL_API_KEY missing from client/api/.dev.vars"; exit 1; }

echo "4/5 keeper"
start keeper "$ROOT/contract" npx hardhat run --network localhost scripts/local/keeper.ts

echo "5/5 provider node"
start node "$ROOT/node-agent" npm start -- --name local-1

cat <<EOF

Ready.
  Website   http://localhost:7003/  (console: /control)
  API       http://127.0.0.1:8790/health   ·   docs http://127.0.0.1:8790/v1/swagger
  Chain     http://127.0.0.1:8545 (chainId 1337)

Bind the provider node once: open the link printed in .dev-run/node.log
Stop everything: bash scripts/dev/down.sh
EOF
