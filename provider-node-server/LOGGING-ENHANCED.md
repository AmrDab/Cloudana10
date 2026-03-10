# Enhanced Provider Node Logging System

The provider node server now features comprehensive, detailed logging that tracks the entire lifecycle of workload deployment from manifest receipt through execution.

## Overview

The enhanced logging system provides:
- **Detailed manifest inspection** when receiving deploy requests
- **Step-by-step execution tracking** for each execution mode (K8s, kubectl, Docker, placeholder)
- **Resource-level visibility** for Kubernetes deployments
- **Comprehensive error reporting** with command output and stderr
- **Performance metrics** including duration tracking for each phase

## Logging Flow

### 1. Deploy Request Receipt (`POST /deploy`)

When the orchestrator sends a deploy request, the provider logs:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📥 RECEIVED DEPLOY REQUEST FROM ORCHESTRATOR
   Request ID: req-abc123
   Workload ID: 42
   Instance ID: 1

📄 Step 1/3: Analyzing received manifest...
   Manifest keys: name, summary, sdl, services
   Manifest name: nginx-deployment
   Summary: Simple nginx web server

📦 Step 2/3: Kubernetes manifest received from orchestrator
   Target namespace: cloudana-42-1
   Resources count: 3
   Resource types:
     1. Deployment/nginx
        - Container: nginx
          Image: nginx:latest
          Requests: CPU=100m, Memory=128Mi
          Limits: CPU=500m, Memory=512Mi
     2. Service/nginx-service
        - Ports: 80:80

💾 Step 3/3: Storing instance data in memory
   Instance key: 42-1
   Namespace: cloudana-42-1
   Status: pending

✅ Deploy request validated and accepted
🚀 Handing off to workload executor...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 2. Workload Execution

The provider logs the execution mode and detailed steps:

#### Mode 1: Kubernetes API (Preferred)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 PROVIDER RECEIVED WORKLOAD DEPLOYMENT
   Workload ID: 42
   Instance ID: 1
   Has K8s Manifest: true
   Namespace: cloudana-42-1
   Resources: 3
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 Phase 1/4: Preparing Kubernetes deployment...
   Target namespace: cloudana-42-1
   Resources to create: 3

🔍 Phase 2/4: Checking Kubernetes availability...
   ✅ Kubernetes API is available

🔨 Phase 3/4: Creating Kubernetes resources (with retry logic)...
   [K8s client logs detailed resource creation - see below]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Phase 4/4: WORKLOAD DEPLOYED SUCCESSFULLY!
   Resources applied: 3
   Namespace: cloudana-42-1
   Apply time: 1234ms
   Total time: 1456ms
   ⏳ Kubernetes will now pull images and start containers...
   📊 Monitor with: kubectl get all -n cloudana-42-1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**K8s Client Detailed Logs:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔨 APPLYING KUBERNETES MANIFEST
   Namespace: cloudana-42-1
   Total Resources: 3
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 Step 1/5: Creating namespace "cloudana-42-1"...
   ✅ Namespace created successfully

📊 Step 2/5: Analyzing resources...
   ConfigMaps: 0
   PVCs: 0
   Deployments: 1
   Services: 1

🚀 Step 4/5: Creating Deployments (1)...
   Creating Deployment: nginx
     Image: nginx:latest
     CPU: 100m, Memory: 128Mi
   ✅ Deployment "nginx" created
     ⏳ Kubernetes will now pull image and start containers...

🌐 Step 5/5: Creating Services (1)...
   Creating Service: nginx-service (ClusterIP)
     Ports: 80:80
   ✅ Service "nginx-service" created

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ KUBERNETES MANIFEST APPLIED SUCCESSFULLY!
   Namespace: cloudana-42-1
   Resources Created: 3
     ConfigMaps: 0
     PVCs: 0
     Deployments: 1
     Services: 1
   Time Taken: 1234ms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 NEXT STEPS:
   1. Kubernetes will now schedule pods
   2. Container images will be pulled from registry
   3. Pods will start and containers will run
   4. Monitor with: kubectl get all -n cloudana-42-1
   5. Check logs: kubectl logs -n cloudana-42-1 -l app.kubernetes.io/managed-by=cloudana
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### Mode 2: kubectl CLI (Fallback)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📜 MODE 2: KUBECTL CLI EXECUTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 Step 1/3: Writing YAML to temporary file
   File path: /tmp/workload-42-1.yaml
   YAML lines: 45
   YAML size: 1234 bytes
   ✅ File written successfully

🔨 Step 2/3: Executing kubectl command
   Command: kubectl apply -f /tmp/workload-42-1.yaml

✅ Step 3/3: kubectl execution successful
   Duration: 890ms
   kubectl output:
     namespace/workload-42-1 created
     deployment.apps/nginx created
     service/nginx-service created

🗑️  Cleaned up temporary YAML file: /tmp/workload-42-1.yaml

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ WORKLOAD DEPLOYED VIA KUBECTL
   Total time: 1000ms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### Mode 3: Docker (Fallback)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🐳 MODE 3: DOCKER CONTAINER EXECUTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Step 1/4: Preparing Docker container
   Image: nginx:alpine
   Container name: workload-42-1
   Command: /bin/sh -c 'nginx -g daemon off;'

🔍 Step 2/4: Checking for image locally
   ⚠️  Image not found locally, Docker will pull it

🚀 Step 3/4: Starting container
   Executing: docker run -d --name workload-42-1 nginx:alpine /bin/sh -c 'nginx -g daemon off;'

✅ Step 4/4: Container started successfully
   Container ID: abc123def456789...
   Short ID: abc123def456
   Start time: 2345ms
   Status: running

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ WORKLOAD DEPLOYED VIA DOCKER
   Container ID: abc123def456
   Total time: 2345ms
   📊 Monitor: docker logs abc123def456
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### Mode 4: Placeholder (Testing)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧪 MODE 4: PLACEHOLDER EXECUTION (MVP TESTING)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  No K8s manifest, kubectl YAML, or Docker image found
⚠️  Using placeholder execution for testing purposes

🎯 Step 1/2: Running placeholder shell command
   Platform: linux
   Command: echo 'Cloudana workload executed' && sleep 1 && exit 0
   Shell output: Cloudana workload executed

✅ Step 2/2: Placeholder execution completed
   Duration: 1005ms

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ WORKLOAD "DEPLOYED" VIA PLACEHOLDER
   Total time: 1005ms
   ⚠️  This is for testing only - no actual workload running
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 3. Error Handling

Errors are logged with detailed context:

```
❌ KUBERNETES DEPLOYMENT FAILED!
   Error: Unable to connect to Kubernetes API
   Duration: 234ms
   Failed resources: 1
     - Deployment/nginx: ImagePullBackOff: Failed to pull image

❌ Docker container start failed
   Error: Container already exists
   Docker stderr:
     Error response from daemon: Conflict. The container name "/workload-42-1" is already in use
```

## Configuration

### Log Levels

Set via `LOG_LEVEL` environment variable:
- `trace` - Most verbose, includes all debug info
- `debug` - Detailed operational information
- `info` - Standard operational messages (default)
- `warn` - Warning messages and fallback operations
- `error` - Error messages only
- `fatal` - Critical errors only

### Output Format

Set via `NODE_ENV` environment variable:
- `development` - Pretty, colorized output for humans (default)
- `production` - JSON structured logs for machine parsing

## Testing the Logging System

Run the logging test script:

```bash
# Pretty development logs
npm run test-logging

# JSON production logs
npm run test-logging:json

# Debug level logs
npm run test-logging:debug
```

## Viewing Logs

### Development Mode
```bash
npm run dev
# Logs are pretty-printed to console with colors
```

### Production Mode (PM2)
```bash
npm run start:pm2
# Logs are in JSON format
pm2 logs cloudana-provider-node
```

### Check Recent Logs via API
```bash
curl http://localhost:4040/logs?limit=50&level=info
```

## Benefits

1. **Complete Visibility**: See every step from manifest receipt to execution
2. **Performance Tracking**: Duration metrics for each phase help identify bottlenecks
3. **Debugging**: Detailed error messages with command output and stderr
4. **Resource Tracking**: See exactly which K8s resources are created and their status
5. **Audit Trail**: Full record of what the provider did with each workload
6. **Monitoring**: Logs feed into the in-memory buffer accessible via `/logs` endpoint

## Log Categories

- `http` - HTTP request/response logging
- `server` - Server lifecycle events
- `workload` - Workload execution flow
- `k8s` - Kubernetes operations and resource management
- `docker` - Docker container operations
- `device` - Device info queries

Each log entry includes:
- ISO timestamp
- Log level
- Module/category
- Request ID (for correlation)
- Structured metadata (JSON in production)
- Human-readable message
