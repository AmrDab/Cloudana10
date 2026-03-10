# Game Templates - Pre-Built Manifests

This directory contains pre-built Kubernetes manifests for various game workloads, ready for testing on provider nodes.

## Available Game Templates

### 1. Super Mario 🍄
- **File**: `supermario.json`
- **Workload ID**: 1
- **Image**: `pengbai/docker-supermario`
- **Port**: 8080 → 80 (HTTP)
- **Resources**: 1 vCPU, 512Mi RAM, 512Mi storage
- **Description**: Classic Super Mario game in browser

### 2. Tetris 🧱
- **File**: `tetris.json`
- **Workload ID**: 2
- **Image**: `bsord/tetris`
- **Port**: 80 (HTTP)
- **Resources**: 1 vCPU, 512Mi RAM, 512Mi storage
- **Description**: Classic Tetris game

### 3. Pac-Man 👻
- **File**: `pacman.json`
- **Workload ID**: 3
- **Image**: `yuravorobei/pacman-web`
- **Port**: 80 (HTTP)
- **Resources**: 1 vCPU, 512Mi RAM, 512Mi storage
- **Description**: Classic Pac-Man arcade game

### 4. Minesweeper 💣
- **File**: `minesweeper.json`
- **Workload ID**: 4
- **Image**: `creepto/minesweeper`
- **Port**: 3000 → 80 (HTTP)
- **Resources**: 0.1 vCPU, 512Mi RAM, 512Mi storage
- **Description**: Classic Minesweeper puzzle game

### 5. Memory Game 🎴
- **File**: `memory-game.json`
- **Workload ID**: 5
- **Image**: `jungpilyu/memorygame`
- **Port**: 80 (HTTP)
- **Resources**: 1 vCPU, 512Mi RAM, 2Gi storage
- **Description**: Memory matching card game

### 6. Snake Game 🐍
- **File**: `snake-game.json`
- **Workload ID**: 6
- **Images**: 
  - `harish1551/snake-game:latest` (frontend)
  - `library/mongo:latest` (database)
- **Port**: 8000 → 80 (HTTP)
- **Resources**: 0.5 vCPU, 1Gi RAM, 1Gi storage
- **Description**: Snake game with MongoDB backend (multi-service workload)
- **Services**: 2 (snake + mongo)

## Manifest Structure

Each manifest JSON file contains:

```json
{
  "buildTimestamp": "ISO timestamp",
  "sdlSource": "original SDL filename",
  "workloadId": "unique workload ID",
  "instanceId": "instance ID",
  "namespace": "k8s namespace",
  "resourceRequirements": {
    "cpu": "millicores",
    "memoryBytes": "bytes",
    "storageBytes": "bytes",
    "gpuCount": "0"
  },
  "parsedSDL": { ... },
  "k8sManifest": {
    "namespace": "workload-X-1",
    "resources": [
      // Array of K8s resources (Deployment, Service, etc.)
    ]
  }
}
```

## Testing on Provider Node

### Quick Start

1. **Copy manifest to provider node**:
   ```bash
   scp game-manifests/supermario.json provider-node:/tmp/
   ```

2. **Apply manifest programmatically**:
   ```typescript
   import { readFileSync } from 'fs';
   
   const manifest = JSON.parse(readFileSync('/tmp/supermario.json', 'utf8'));
   
   // Apply each K8s resource
   for (const resource of manifest.k8sManifest.resources) {
     await k8sClient.apply(resource);
   }
   ```

3. **Verify deployment**:
   ```bash
   kubectl -n workload-1-1 get pods
   kubectl -n workload-1-1 get svc
   ```

### Testing Order (Recommended)

For progressive testing, deploy in this order:

1. **Minesweeper** (simplest, lowest CPU)
2. **Tetris** (simple single-service)
3. **Super Mario** (classic, popular)
4. **Pac-Man** (arcade game)
5. **Memory Game** (higher storage)
6. **Snake Game** (multi-service with database)

## Building New Game Manifests

To build additional game manifests:

```bash
cd client/api

# Build from any awesome-akash template
npm run build-manifest -- ../../../awesome-akash/<game>/deploy.yaml \
  --workload <id> \
  --instance 1 \
  --output ../../game-manifests/<game>.json
```

## Characteristics

### Single-Service Games
- Super Mario, Tetris, Pac-Man, Minesweeper, Memory Game
- Simple deployment, single container
- Good for basic provider testing

### Multi-Service Games
- Snake Game (with MongoDB)
- Tests service discovery and inter-service communication
- More complex networking requirements

## Resource Summary

| Game | vCPU | Memory | Storage | Services |
|------|------|--------|---------|----------|
| Minesweeper | 0.1 | 512Mi | 512Mi | 1 |
| Tetris | 1.0 | 512Mi | 512Mi | 1 |
| Super Mario | 1.0 | 512Mi | 512Mi | 1 |
| Pac-Man | 1.0 | 512Mi | 512Mi | 1 |
| Memory Game | 1.0 | 512Mi | 2Gi | 1 |
| Snake Game | 0.5 | 1Gi | 1Gi | 2 |

## Notes

- All games expose HTTP ports for web browser access
- NodePort services allow external access
- Manifests use `cloudana.workload` and `cloudana.instance` labels
- Namespace format: `workload-{workloadId}-{instanceId}`
