#!/bin/bash
# List all running game workloads
# Usage: ./list-workloads.sh

echo "🎮 Game Workloads Status"
echo "========================"
echo ""

# List all cloudana-managed namespaces
NAMESPACES=$(kubectl get namespaces -l app.kubernetes.io/managed-by=cloudana -o jsonpath='{.items[*].metadata.name}' 2>/dev/null)

if [ -z "$NAMESPACES" ]; then
  echo "No active game workloads found."
  echo ""
  echo "💡 To deploy a game, run:"
  echo "   ./apply-manifest.sh <game>.json"
  exit 0
fi

for ns in $NAMESPACES; do
  echo "📦 Namespace: $ns"
  
  # Get workload ID from labels
  WORKLOAD_ID=$(kubectl get namespace "$ns" -o jsonpath='{.metadata.labels.cloudana\.workload}' 2>/dev/null || echo "unknown")
  echo "   Workload ID: $WORKLOAD_ID"
  
  # Get pods
  PODS=$(kubectl -n "$ns" get pods --no-headers 2>/dev/null)
  if [ -n "$PODS" ]; then
    echo "   Pods:"
    echo "$PODS" | while read -r line; do
      echo "      $line"
    done
  fi
  
  # Get services
  SERVICES=$(kubectl -n "$ns" get svc --no-headers 2>/dev/null)
  if [ -n "$SERVICES" ]; then
    echo "   Services:"
    echo "$SERVICES" | while read -r line; do
      echo "      $line"
    done
    # Show access URL (NodePort — no port-forward needed if firewall allows it)
    NODEPORT=$(kubectl -n "$ns" get svc -o jsonpath='{.items[0].spec.ports[0].nodePort}' 2>/dev/null)
    if [ -n "$NODEPORT" ]; then
      SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
      [ -z "$SERVER_IP" ] && SERVER_IP="<node-ip>"
      echo "   Access URL: http://${SERVER_IP}:${NODEPORT}"
    fi
  fi

  echo ""
done

echo "📊 Summary:"
echo "   Total workloads: $(echo $NAMESPACES | wc -w)"
echo ""
echo "🌐 Access: NodePort exposes the service on the node IP. No kubectl port-forward needed."
echo "   If the URL does not open, allow inbound TCP on the NodePort (e.g. 30000-32767) in the server firewall."
echo ""
echo "🗑️  To delete a workload:"
echo "   kubectl delete namespace <namespace-name>"
