#!/usr/bin/env bash
# Phase 3 (docs/POUW_SIMULATION_PLAN.md §6): a long honest run with the keeper live, plus two faults on the way:
# a guardian veto of a posted epoch (the API must re-close and re-post a corrected root) and a keeper restart mid-epoch.
#   bash scripts/sim/testnet/phase3.sh [minutes=120]
set -uo pipefail
cd "$(dirname "$0")/../../.."
RUN=.dev-run-sim
MIN=${1:-120}
RATE=7
JOBS=$((MIN * RATE))
echo "phase 3: $JOBS jobs over ~$MIN min"
node --import tsx scripts/sim/testnet/user.ts --jobs "$JOBS" --rate $RATE --out jobs-phase3.jsonl --seed 3 \
  --mix matmul:64,matmul:128,matmul:256,int8-mlp:64,int8-mlp:256,int8-model:2:64,int8-model:8:128,int8-model:2:256 > "$RUN/user-phase3.log" 2>&1 &
LOAD=$!

sleep 600
echo "--- fault 1: guardian veto"
node --import tsx scripts/sim/testnet/veto.ts 2>&1 | grep -v Warning

sleep 300
echo "--- fault 2: keeper restart mid-epoch"
pid=$(grep '^keeper ' $RUN/pids | awk '{print $2}'); [ -n "$pid" ] && taskkill //PID "$pid" //F >/dev/null 2>&1; sed -i '/^keeper /d' $RUN/pids
sleep 20
nohup node --import tsx scripts/sim/testnet/keeper-local.ts >> "$RUN/keeper.log" 2>&1 &
echo "keeper $!" >> $RUN/pids
echo "keeper restarted"

wait $LOAD
echo "--- load finished; letting the keeper settle the last epochs"
sleep 420
node --import tsx scripts/sim/testnet/report.ts --jobs "$RUN/jobs-phase3.jsonl" > "$RUN/report-phase3.md" 2>/dev/null
echo "done: $RUN/report-phase3.md"
