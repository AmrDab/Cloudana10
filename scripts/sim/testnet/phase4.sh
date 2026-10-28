#!/usr/bin/env bash
# Phase 4 — the owner's decisions D1–D4 (docs/DECISIONS_CONSENSUS.md, 2026-10-28) on the testnet-in-a-box, from a
# fresh chain and database: (1) a zero-demand window — no user jobs — in which the orchestrator issues protocol work to
# the idle nodes and lane B is minted from the epoch budget alone; (2) a hit-and-run adversary with a lazy transcript,
# which the warm-up must catch on its first job; (3) a short user burst to read the cluster gate's pass rate with
# three operators. Then the keeper settles and the numbers are written.
#   bash scripts/sim/testnet/phase4.sh [idle-minutes=12] [burst-minutes=5]
set -uo pipefail
cd "$(dirname "$0")/../../.."
ROOT=$(pwd)
RUN=$ROOT/.dev-run-sim
IDLE=${1:-12}
BURST=${2:-5}
mkdir -p "$RUN"

echo "--- fresh chain"
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.Name -eq 'node.exe' -and \$_.CommandLine -match 'hardhat' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }"
(cd contract && nohup npx hardhat node > "$ROOT/.dev-run-sim-chain.log" 2>&1 &)
for i in $(seq 1 60); do curl -sf -m 2 -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8545 > /dev/null && break; sleep 1; done
(cd contract && TREASURY_SAFE=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 GUARDIAN_SAFE=0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc \
  ADMIN_SAFE=0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65 POSTER_ADDRESS=0xa0Ee7A142d267C1f36714E4a8F75612F20a79720 \
  EPOCH_SECONDS=120 VETO_DELAY=30 VEST_B=60 npx hardhat run scripts/v2/deploy.ts --network localhost 2>&1 | grep -vE "Warning|^$" | tail -4)

echo "--- fresh database (phase 0–3 data kept as sim-phase3.sqlite), stack up with protocol work on"
[ -f "$RUN/sim.sqlite" ] && { [ -f "$RUN/sim-phase3.sqlite" ] && rm -f "$RUN/sim.sqlite" || mv "$RUN/sim.sqlite" "$RUN/sim-phase3.sqlite"; }
PROTOCOL_WORK=on node --import tsx scripts/sim/testnet/up.ts 2>&1 | grep -v Warning | tail -5

echo "--- 1. zero demand for $IDLE min: protocol work only"
sleep $((IDLE * 60))
curl -s http://127.0.0.1:8791/v1/network | grep -oE '"jobs(Done|Queued)":[0-9]+' | tr '\n' ' '; echo

echo "--- 2. hit-and-run adversary (lazy transcript, 8 jobs planned): the warm-up should catch job 1"
node --import tsx scripts/sim/testnet/adversary.ts --cheat lazy-transcript --jobs 8 --name "adv-lazy-$RANDOM" --payout adv-phase4-lazy --out adversary-phase4-lazy.jsonl 2>&1 | grep -v Warning | tail -8

echo "--- 3. user burst: $BURST min at 7/min, three operators"
node --import tsx scripts/sim/testnet/user.ts --jobs $((BURST * 7)) --rate 7 --out jobs-phase4.jsonl --seed 4 \
  --mix matmul:64,matmul:128,int8-mlp:64,int8-model:2:64 > "$RUN/user-phase4.log" 2>&1

echo "--- settling (hold = one epoch, then close, post, finalize, vest)"
sleep 420
node --import tsx scripts/sim/testnet/phase4-stats.ts > "$RUN/report-phase4.md" 2>/dev/null
node --import tsx scripts/sim/testnet/report.ts --jobs "$RUN/jobs-phase4.jsonl" >> "$RUN/report-phase4.md" 2>/dev/null
echo "done: $RUN/report-phase4.md"
