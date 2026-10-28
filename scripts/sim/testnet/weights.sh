#!/usr/bin/env bash
# Draw weights after the delivery-to-submit change: three identical CPU agents, one matmul shape, equal load; the
# nodes' throughput_mmac_s should end close together (phase 1 ended at 0.09 / 0.25 / 0.66 MMAC/s on the same machine).
#   bash scripts/sim/testnet/weights.sh [jobs=60]
set -uo pipefail
cd "$(dirname "$0")/../../.."
ROOT=$(pwd)
RUN=$ROOT/.dev-run-sim
JOBS=${1:-60}
mkdir -p "$RUN"

echo "--- fresh chain"
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.Name -eq 'node.exe' -and \$_.CommandLine -match 'hardhat' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }"
(cd contract && nohup npx hardhat node > "$ROOT/.dev-run-sim-chain.log" 2>&1 &)
for i in $(seq 1 60); do curl -sf -m 2 -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8545 > /dev/null && break; sleep 1; done
(cd contract && TREASURY_SAFE=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 GUARDIAN_SAFE=0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc \
  ADMIN_SAFE=0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65 POSTER_ADDRESS=0xa0Ee7A142d267C1f36714E4a8F75612F20a79720 \
  EPOCH_SECONDS=120 VETO_DELAY=30 VEST_B=60 npx hardhat run scripts/v2/deploy.ts --network localhost 2>&1 | grep -E "Keeper vars")

echo "--- fresh database, stack up"
rm -f "$RUN/sim.sqlite"
node --import tsx scripts/sim/testnet/up.ts 2>&1 | grep -E "\[up\] (agent|ready)|Error"

echo "--- $JOBS × matmul:128 at 8/min"
node --import tsx scripts/sim/testnet/user.ts --jobs "$JOBS" --rate 8 --out jobs-weights.jsonl --seed 5 --mix matmul:128 > "$RUN/user-weights.log" 2>&1

echo "--- weights (MMAC/s) and jobs per node"
node -e "
const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('.dev-run-sim/sim.sqlite',{readOnly:true}); // relative: a Git Bash /c/... path does not open on Windows
for (const r of d.prepare('SELECT substr(address,1,10) node, round(throughput_mmac_s,3) weight, jobs_done FROM nodes ORDER BY address').all()) console.log(r.node, r.weight, r.jobs_done);
const t=d.prepare(\"SELECT round(avg((completed_at-delivered_at)/1000.0),2) compute_s, round(avg((delivered_at-assigned_at)/1000.0),2) wait_s FROM work_jobs WHERE status='done' AND delivered_at IS NOT NULL\").get();
console.log('mean delivered→done s', t.compute_s, 'mean assigned→delivered s', t.wait_s);
" 2>&1 | grep -vi warning
node --import tsx scripts/sim/testnet/down.ts > /dev/null 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.Name -eq 'node.exe' -and (\$_.CommandLine -match 'sim/testnet|src/index.ts --api|hardhat') } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }"
echo "done"
