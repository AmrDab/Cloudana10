#!/usr/bin/env bash
# Phase 2, challenge-type strategies only (docs/POUW_SIMULATION_PLAN.md §5 A6–A8): run with the queue drained and the
# honest agents stopped, on an int8-only load, so every assignment the adversary gets is one its strategy applies to.
#   bash scripts/sim/testnet/phase2b.sh
set -uo pipefail
cd "$(dirname "$0")/../../.."
RUN=$(pwd)/.dev-run-sim
API=http://127.0.0.1:8791
SIGNER=$(curl -s $API/v1/nodes/instruction-key | grep -oE '"signer":"0x[0-9a-fA-F]+"' | cut -d'"' -f4)
stop_agents() { powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.Name -eq 'node.exe' -and \$_.CommandLine -match 'src/index.ts --api' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }"; sed -i "/^agent-/d" "$RUN/pids"; }
start_agents() { for p in a b c; do (cd node-agent && CLOUDANA_INSTRUCTION_SIGNER=$SIGNER nohup node --import tsx src/index.ts --api $API --name sim-$p --site http://127.0.0.1:7003 >> "$RUN/agent-$p.log" 2>&1 &); done; }
queued() { curl -s $API/v1/network | grep -oE '"jobsQueued":[0-9]+' | cut -d: -f2; }

echo "--- draining the queue with the honest agents"
until [ "$(queued)" = "0" ]; do sleep 10; done
stop_agents
for cheat in wrong-segment lazy-commit late-answer double-commit; do
  echo "=== $cheat ==="
  node --import tsx scripts/sim/testnet/user.ts --jobs 5 --rate 60 --mix int8-mlp:64,int8-model:2:64 --user adversary-user --out "phase2-$cheat.jsonl" > "$RUN/user-phase2-$cheat.log" 2>&1 &
  load=$!
  node --import tsx scripts/sim/testnet/adversary.ts --cheat "$cheat" --jobs 3 --name "adv-$cheat-$RANDOM" --payout "adv-$cheat-b" --out "adversary-$cheat.jsonl" 2>&1 | tail -12
  kill $load 2>/dev/null
done
start_agents
echo "done"
