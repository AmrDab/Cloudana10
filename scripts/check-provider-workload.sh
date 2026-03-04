#!/bin/bash
# Check workload status directly from provider node
# Usage: ./scripts/check-provider-workload.sh <provider-endpoint> <workloadId> <instanceId>

PROVIDER=${1:-"http://89.116.117.169:8080"}
WORKLOAD_ID=${2:-"4"}
INSTANCE_ID=${3:-"1"}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 Checking Workload Status from Provider"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Provider: $PROVIDER"
echo "Workload: $WORKLOAD_ID / Instance: $INSTANCE_ID"
echo ""

echo "1️⃣  Provider Health Check:"
curl -s "$PROVIDER/health" | jq '.' || echo "❌ Provider not responding"
echo ""

echo "2️⃣  Workload Status:"
curl -s "$PROVIDER/workload/$WORKLOAD_ID/$INSTANCE_ID/status" | jq '.' || echo "❌ Status not available"
echo ""

echo "3️⃣  Workload Logs (last 20 lines):"
curl -s "$PROVIDER/workload/$WORKLOAD_ID/$INSTANCE_ID/logs?tail=20" || echo "❌ Logs not available"
echo ""

echo "4️⃣  Workload Endpoints:"
curl -s "$PROVIDER/workload/$WORKLOAD_ID/$INSTANCE_ID/endpoints" | jq '.' || echo "❌ Endpoints not available"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
