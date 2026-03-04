#!/bin/bash
# Helper script to apply game manifests to Kubernetes cluster
# Usage: ./apply-manifest.sh <manifest-file.json>

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <manifest-file.json>"
  echo ""
  echo "Available manifests:"
  ls -1 *.json 2>/dev/null || echo "  No manifest files found"
  echo ""
  echo "Example:"
  echo "  $0 supermario.json"
  exit 1
fi

MANIFEST_FILE="$1"

if [ ! -f "$MANIFEST_FILE" ]; then
  echo "Error: Manifest file '$MANIFEST_FILE' not found"
  exit 1
fi

echo "📄 Reading manifest from: $MANIFEST_FILE"

# Extract namespace from manifest
NAMESPACE=$(jq -r '.k8sManifest.namespace' "$MANIFEST_FILE")
WORKLOAD_ID=$(jq -r '.workloadId' "$MANIFEST_FILE")
INSTANCE_ID=$(jq -r '.instanceId' "$MANIFEST_FILE")
SDL_SOURCE=$(jq -r '.sdlSource' "$MANIFEST_FILE")
RESOURCE_COUNT=$(jq -r '.k8sManifest.resources | length' "$MANIFEST_FILE")

echo "   Namespace: $NAMESPACE"
echo "   Workload ID: $WORKLOAD_ID"
echo "   Instance ID: $INSTANCE_ID"
echo "   Source: $SDL_SOURCE"
echo "   Resources to apply: $RESOURCE_COUNT"
echo ""

# Create namespace if it doesn't exist
echo "📦 Creating namespace $NAMESPACE (if not exists)..."
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

# Extract and apply each resource
echo ""
echo "🚀 Applying resources..."
RESOURCES_APPLIED=0

jq -c '.k8sManifest.resources[]' "$MANIFEST_FILE" | while read -r resource; do
  KIND=$(echo "$resource" | jq -r '.kind')
  NAME=$(echo "$resource" | jq -r '.metadata.name')
  
  echo "   Applying $KIND: $NAME"
  echo "$resource" | kubectl apply -f -
  
  RESOURCES_APPLIED=$((RESOURCES_APPLIED + 1))
done

echo ""
echo "✅ Manifest applied successfully!"
echo ""
echo "📊 Check status:"
echo "   kubectl -n $NAMESPACE get all"
echo ""
echo "🔍 View pods:"
echo "   kubectl -n $NAMESPACE get pods -w"
echo ""
echo "🌐 Get service endpoint:"
echo "   kubectl -n $NAMESPACE get svc"
echo ""
echo "📝 View logs (replace <pod-name>):"
echo "   kubectl -n $NAMESPACE logs <pod-name>"
echo ""
echo "🗑️  Delete workload:"
echo "   kubectl delete namespace $NAMESPACE"
