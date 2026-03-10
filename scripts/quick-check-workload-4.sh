#!/bin/bash
echo "🔍 Quick Diagnostic for Workload 4"
echo "=================================="
echo ""

echo "1. Checking orchestrator status poller registration:"
grep -i "workload 4" /root/.cursor/projects/home-akash-repo/terminals/2.txt | tail -5
echo ""

echo "2. Attempting to get status from orchestrator API:"
curl -s http://localhost:7002/v1/workload-status/4/1 2>&1 | head -20
echo ""

echo "3. Checking if orchestrator API is running:"
curl -s http://localhost:7002/health 2>&1 | head -5
echo ""

echo "=================================="
echo "📋 Next Steps:"
echo "=================================="
echo ""
echo "If you see 'not registered for polling':"
echo "  → Run: tsx scripts/register-workload-for-polling.ts 4 1 http://YOUR_PROVIDER_IP:8080"
echo ""
echo "If provider IP is wrong or provider is offline:"
echo "  → Check provider at: http://localhost:5173/providers"
echo "  → Verify provider is running: ssh to provider and run 'pm2 status'"
echo ""
echo "To re-deploy workload 4:"
echo "  → Go to: http://localhost:5173/orchestrator"
echo "  → Click 'Execute Placement' for workload 4"
echo ""
