#!/usr/bin/env bash
# Phase 2 (docs/POUW_SIMULATION_PLAN.md §5): every cheat strategy against the running local stack.
#   bash scripts/sim/testnet/phase2.sh
# Part A runs the verification cheats with the honest agents stopped, so the adversary receives every job (fast);
# part B restarts them for the strategy that needs other operators' jobs. Each run uses a fresh node key and payout
# wallet (a suspended node is never reused). Jobs left queued when a run ends roll over to the next run — the adversary
# records the work type of every assignment and cheats only where its strategy applies, so the records stay readable.
set -uo pipefail
cd "$(dirname "$0")/../../.."
ROOT=$(pwd)
RUN=$ROOT/.dev-run-sim
API=http://127.0.0.1:8791
ADV="node --import tsx scripts/sim/testnet/adversary.ts"
USER="node --import tsx scripts/sim/testnet/user.ts"
SIGNER=$(curl -s $API/v1/nodes/instruction-key | grep -oE '"signer":"0x[0-9a-fA-F]+"' | cut -d'"' -f4)

agents() { # start|stop
  for p in a b c; do
    if [ "$1" = stop ]; then
      pid=$(grep "^agent-$p " "$RUN/pids" | awk '{print $2}')
      [ -n "$pid" ] && taskkill //PID "$pid" //F >/dev/null 2>&1
      sed -i "/^agent-$p /d" "$RUN/pids"
    else
      (cd "$ROOT/node-agent" && CLOUDANA_INSTRUCTION_SIGNER=$SIGNER nohup node --import tsx src/index.ts --api $API --name sim-$p --site http://127.0.0.1:7003 >> "$RUN/agent-$p.log" 2>&1 & echo "agent-$p $!" >> "$RUN/pids")
    fi
  done
}
run() { # cheat jobs mix [extra adversary args]
  local cheat=$1 jobs=$2 mix=$3; shift 3
  echo "=== $cheat ==="
  $USER --jobs $((jobs + 2)) --rate 60 --mix "$mix" --user adversary-user --out "phase2-$cheat.jsonl" > "$RUN/user-phase2-$cheat.log" 2>&1 &
  local load=$!
  $ADV --cheat "$cheat" --jobs "$jobs" --name "adv-$cheat-$RANDOM" --payout "adv-$cheat" --out "adversary-$cheat.jsonl" "$@" 2>&1 | tail -30
  kill $load 2>/dev/null
}

echo "--- part A: honest agents stopped, the adversary takes every job"
agents stop
run none               6  matmul:64,int8-mlp:64,int8-model:2:64
run wrong-result       6  matmul:64,int8-mlp:64
run lazy-transcript    12 matmul:64
run partial-transcript 12 matmul:64
run replay             4  matmul:64
run wrong-segment      3  int8-mlp:64,int8-model:2:64
run lazy-commit        3  int8-mlp:64
run late-answer        3  int8-mlp:64
run double-commit      3  int8-mlp:64
# The rational cheater: honest pay accrues first, then a sampled catch claws the wallet's held pay (K = 10).
run rational           60 matmul:64 --rate 0.5

echo "--- part B: honest agents back"
agents start
sleep 30
run steal              4  matmul:64,int8-mlp:64
echo "done: records in $RUN/adversary-*.jsonl, user side in $RUN/phase2-*.jsonl"
