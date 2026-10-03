#!/usr/bin/env bash
# Stop everything scripts/dev/up.sh started: local chain (:8545), API (:8790),
# keeper and node agents. Leaves the Vite dev server (:7003) alone.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

if command -v powershell >/dev/null 2>&1; then
  # Windows: npx/wrangler/hardhat spawn child processes that outlive their parent
  # shell, so match the actual workers by port and by command line and kill each tree.
  powershell -NoProfile -Command '
    $ids = @()
    foreach ($port in 8545, 8790) {
      $ids += (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess
    }
    $pattern = "wrangler(\.js)?`"?\s+dev\s+--port\s+8790|workerd-windows|hardhat.*\snode(\s|$)|scripts[\\/]local[\\/]keeper|node-agent[\\/]"
    $ids += (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match $pattern -and $_.CommandLine -notmatch "vite" }).ProcessId
    $ids = $ids | Where-Object { $_ } | Sort-Object -Unique
    foreach ($id in $ids) { taskkill /F /T /PID $id 2>$null | Out-Null }
    "stopped $($ids.Count) process(es)"
  '
else
  for port in 8545 8790; do
    pid=$(lsof -ti tcp:$port 2>/dev/null) && kill $pid 2>/dev/null
  done
  pkill -f "wrangler dev --port 8790" 2>/dev/null
  pkill -f "hardhat node" 2>/dev/null
  pkill -f "scripts/local/keeper" 2>/dev/null
  pkill -f "node-agent/" 2>/dev/null
  echo "stopped"
fi
: > "$ROOT/.dev-run/pids" 2>/dev/null || true
