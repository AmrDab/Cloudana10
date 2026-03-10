# Quick Start - Testing Game Workloads

Get started with pre-built game manifests in under 2 minutes!

## Prerequisites

- kubectl configured with access to your Kubernetes cluster
- jq installed (`apt install jq` or `brew install jq`)

## 🚀 Quick Deploy

### 1. Deploy Super Mario (Simplest Test)

```bash
cd /home/akash-repo/cloudana-mvp/game-manifests

# Apply the manifest
./apply-manifest.sh supermario.json

# Check status
kubectl -n workload-1-1 get pods -w

# Get service endpoint
kubectl -n workload-1-1 get svc
```

Once the pod is running, access Super Mario via the NodePort shown in the service.

### 2. Deploy All Games (Full Test Suite)

```bash
# Deploy all games
./apply-manifest.sh supermario.json
./apply-manifest.sh tetris.json
./apply-manifest.sh pacman.json
./apply-manifest.sh minesweeper.json
./apply-manifest.sh memory-game.json
./apply-manifest.sh snake-game.json

# List all workloads
./list-workloads.sh
```

### 3. Clean Up

```bash
# Delete specific workload
./delete-workload.sh workload-1-1

# Or delete by workload ID
./delete-workload.sh 1

# Delete all game workloads
kubectl delete namespace -l app.kubernetes.io/managed-by=cloudana
```

## 📋 Manual Apply (Without Scripts)

If you prefer manual application or don't have jq:

```bash
# Create namespace
kubectl create namespace workload-1-1

# Extract and apply resources using jq
jq -c '.k8sManifest.resources[]' supermario.json | while read -r resource; do
  echo "$resource" | kubectl apply -f -
done

# Or apply directly with kubectl
kubectl apply -f <(jq -r '.k8sManifest.resources[] | @json' supermario.json)
```

## 🎮 Testing Progression

Recommended order for progressive testing:

1. **Minesweeper** - Simplest, lowest resources (0.1 vCPU)
2. **Tetris** - Simple single-service
3. **Super Mario** - Most popular, easy to verify
4. **Pac-Man** - Another classic game
5. **Memory Game** - Tests higher storage (2Gi)
6. **Snake Game** - Multi-service (app + database)

## 🔍 Verification Steps

### Check Pod Status
```bash
kubectl -n workload-1-1 get pods
```

Expected output:
```
NAME                         READY   STATUS    RESTARTS   AGE
supermario-xxxxxxxxx-xxxxx   1/1     Running   0          30s
```

### Check Service
```bash
kubectl -n workload-1-1 get svc
```

Expected output:
```
NAME         TYPE       CLUSTER-IP      EXTERNAL-IP   PORT(S)        AGE
supermario   NodePort   10.43.xxx.xxx   <none>        80:30XXX/TCP   30s
```

### Access the Game
- **Local/Direct Access**: `http://<node-ip>:<nodeport>`
- **Port Forward**: `kubectl -n workload-1-1 port-forward svc/supermario 8080:80`
  - Then open `http://localhost:8080`

### View Logs
```bash
kubectl -n workload-1-1 logs -f deployment/supermario
```

## 📊 Resource Monitoring

### Check Resource Usage
```bash
kubectl -n workload-1-1 top pods
kubectl -n workload-1-1 top nodes
```

### Get Events
```bash
kubectl -n workload-1-1 get events --sort-by='.lastTimestamp'
```

## 🐛 Troubleshooting

### Pod Not Starting
```bash
# Check pod details
kubectl -n workload-1-1 describe pod <pod-name>

# Check logs
kubectl -n workload-1-1 logs <pod-name>

# Check events
kubectl -n workload-1-1 get events
```

### Image Pull Issues
```bash
# Check if image exists
docker pull pengbai/docker-supermario

# Force image pull
kubectl -n workload-1-1 delete pod <pod-name>
```

### Service Not Accessible
```bash
# Verify service endpoints
kubectl -n workload-1-1 get endpoints

# Test from within cluster
kubectl run -n workload-1-1 -it --rm debug --image=busybox --restart=Never -- wget -O- http://supermario:80
```

## 🎯 Success Criteria

A successful deployment should show:
- ✅ Pod status: `Running`
- ✅ Pod ready: `1/1`
- ✅ Service has ClusterIP assigned
- ✅ Service has NodePort assigned
- ✅ Game is accessible via HTTP
- ✅ Game loads and is playable in browser

## 🔄 Testing Workflow Automation

For continuous testing, you can use this workflow:

```bash
#!/bin/bash
# test-all-games.sh

GAMES=("supermario" "tetris" "pacman" "minesweeper" "memory-game" "snake-game")

for game in "${GAMES[@]}"; do
  echo "🎮 Testing $game..."
  
  # Apply manifest
  ./apply-manifest.sh "${game}.json"
  
  # Wait for pod to be ready
  NAMESPACE=$(jq -r '.k8sManifest.namespace' "${game}.json")
  kubectl -n "$NAMESPACE" wait --for=condition=ready pod --all --timeout=120s
  
  # Check status
  kubectl -n "$NAMESPACE" get pods
  
  # Optional: Run health check
  # curl http://<node-ip>:<nodeport>
  
  echo "✅ $game deployed and running"
  echo ""
done

echo "🎉 All games deployed successfully!"
./list-workloads.sh
```

## 📚 Next Steps

1. Test workload lifecycle (deploy → running → delete)
2. Test resource scaling
3. Test multi-service communication (Snake Game)
4. Test persistent storage (if using PVCs)
5. Monitor resource usage over time
6. Test workload updates/upgrades

## 🆘 Support

For issues or questions:
- Check logs: `kubectl -n <namespace> logs <pod-name>`
- Describe resources: `kubectl -n <namespace> describe <resource-type> <name>`
- Review manifests: Check the JSON files in this directory
- Rebuild manifests: Use `npm run build-manifest` in `client/api`
