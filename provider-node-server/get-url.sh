#!/bin/bash
# Get the live URL for a deployed workload

WORKLOAD_ID="${1}"

if [ -z "$WORKLOAD_ID" ]; then
    echo "Usage: $0 <workload-id>"
    echo ""
    echo "Examples:"
    echo "  $0 1    # Get URL for Super Mario"
    echo "  $0 4    # Get URL for Minesweeper"
    exit 1
fi

NAMESPACE="workload-${WORKLOAD_ID}-1"

# Check if namespace exists
if ! kubectl get namespace "$NAMESPACE" > /dev/null 2>&1; then
    echo "❌ Workload ${WORKLOAD_ID} is not deployed (namespace ${NAMESPACE} not found)"
    exit 1
fi

echo "🎮 Getting live URL for Workload ${WORKLOAD_ID}..."
echo ""

# Get pod status
echo "📦 Pod Status:"
kubectl -n "$NAMESPACE" get pods
echo ""

# Get service details
echo "🔧 Service Details:"
SVC_OUTPUT=$(kubectl -n "$NAMESPACE" get svc -o wide)
echo "$SVC_OUTPUT"
echo ""

# Extract NodePort
NODEPORT=$(kubectl -n "$NAMESPACE" get svc -o jsonpath='{.items[0].spec.ports[0].nodePort}')
SERVICE_NAME=$(kubectl -n "$NAMESPACE" get svc -o jsonpath='{.items[0].metadata.name}')

if [ -z "$NODEPORT" ]; then
    echo "❌ No NodePort found for this workload"
    exit 1
fi

# Get server IP
SERVER_IP=$(hostname -I | awk '{print $1}')

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🌐 LIVE SITE URLs:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ Local Access:"
echo "   http://localhost:${NODEPORT}"
echo "   http://127.0.0.1:${NODEPORT}"
echo ""
echo "✅ Remote Access:"
echo "   http://${SERVER_IP}:${NODEPORT}"
echo ""
echo "✅ Port Forward (alternative):"
echo "   kubectl -n ${NAMESPACE} port-forward svc/${SERVICE_NAME} 8080:80"
echo "   Then visit: http://localhost:8080"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "💡 Tip: Open one of the URLs above in your browser to play the game!"
