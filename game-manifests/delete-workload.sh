#!/bin/bash
# Delete a game workload by namespace or workload ID
# Usage: ./delete-workload.sh <namespace|workload-id>

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <namespace|workload-id>"
  echo ""
  echo "Examples:"
  echo "  $0 workload-1-1        # Delete by namespace"
  echo "  $0 1                   # Delete by workload ID"
  echo ""
  echo "Available workloads:"
  kubectl get namespaces -l app.kubernetes.io/managed-by=cloudana --no-headers 2>/dev/null | awk '{print "  " $1}' || echo "  No active workloads"
  exit 1
fi

INPUT="$1"

# Check if input is a workload ID (just a number)
if [[ "$INPUT" =~ ^[0-9]+$ ]]; then
  # Try to find namespace by workload ID
  NAMESPACE=$(kubectl get namespaces -l "cloudana.workload=$INPUT" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
  
  if [ -z "$NAMESPACE" ]; then
    # Try with pattern workload-X-1
    NAMESPACE="workload-$INPUT-1"
  fi
else
  NAMESPACE="$INPUT"
fi

echo "🗑️  Deleting workload: $NAMESPACE"
echo ""

# Check if namespace exists
if ! kubectl get namespace "$NAMESPACE" &>/dev/null; then
  echo "❌ Error: Namespace '$NAMESPACE' not found"
  exit 1
fi

# Show what will be deleted
echo "📦 Resources to be deleted:"
kubectl -n "$NAMESPACE" get all 2>/dev/null || echo "   (no resources found)"
echo ""

# Confirm deletion
read -p "⚠️  Are you sure you want to delete namespace '$NAMESPACE'? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "Deletion cancelled."
  exit 0
fi

echo ""
echo "🧹 Deleting namespace and all resources..."
kubectl delete namespace "$NAMESPACE"

echo ""
echo "✅ Workload deleted successfully!"
echo ""
echo "📊 Remaining workloads:"
kubectl get namespaces -l app.kubernetes.io/managed-by=cloudana --no-headers 2>/dev/null | awk '{print "  " $1}' || echo "  No active workloads"
