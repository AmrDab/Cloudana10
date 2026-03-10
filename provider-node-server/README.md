# Cloudana Provider Node Server

The provider node server runs on each provider's infrastructure and is responsible for:
- Accepting workload deployment requests from the orchestrator
- Executing workloads on Kubernetes clusters
- Reporting workload status back to the orchestrator
- Providing hardware specs for provider registration

## Architecture Overview

```
┌─────────────────────────────────────────┐
│   Blockchain (Base Sepolia)            │
│   • WorkloadRegistry                    │
│   • ProviderRegistry                    │
└──────────────┬──────────────────────────┘
               │ Events & state
    ┌──────────┴───────────┐
    │                      │
    ↓                      ↓
┌─────────────────┐  ┌─────────────────────────────┐
│  Orchestrator   │  │  Provider Node (THIS)       │
│  (centralized)  │  │  • Device identity          │
│  (event-driven) │  │  • Workload execution       │
└─────────────────┘  │  • Status reporting         │
                     └────────────┬────────────────┘
                                  │ kubectl/K8s API
                                  ↓
                     ┌──────────────────────────────┐
                     │  Kubernetes Cluster(s)       │
                     │  • Tenant workloads          │
                     │  • Isolated by namespace     │
                     └──────────────────────────────┘
```

## Deployment Model

### ✅ Required: External Deployment Only

**Provider nodes MUST run OUTSIDE of Kubernetes** (enforced by design, similar to Akash providers).

```bash
# Run on provider's management server (VM, bare metal, etc.)
Provider Infrastructure:
├── Management Server
│   ├── Provider Node Service ← YOU ARE HERE
│   ├── kubectl configured
│   └── Provider identity/keys
└── Kubernetes Cluster(s)
    └── Tenant Workloads (isolated)
```

**Why external?**
- 🔐 **Security**: Provider control plane isolated from tenant workloads
- 🌍 **Multi-cluster**: One provider node can manage multiple K8s clusters
- 💰 **Economic model**: Provider owns infrastructure, node manages their business
- 🛡️ **Trust boundary**: Clear separation between provider and tenant compute
- 📈 **Scalability**: Can manage hybrid environments (K8s + Docker + VMs)

### 🧪 Development: External Mode Only

The provider node is configured to **only use external kubeconfig** (no in-cluster detection):
- **Local dev**: Uses `~/.kube/config` (minikube, kind, etc.)
- **Production**: Uses `~/.kube/config` or `KUBECONFIG` env var
- **No in-cluster mode**: Will warn and use external config if deployed inside K8s

## Production Deployment Guide

### Prerequisites

1. **Kubernetes Cluster**: One or more K8s clusters for running tenant workloads
2. **kubectl Access**: Configured on the management server
3. **Node.js 18+**: For running the provider node service

### Step 1: Set Up Management Server

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
```

### Step 2: Configure Kubernetes Access

```bash
# Option 1: Copy kubeconfig from your K8s cluster
mkdir -p ~/.kube
scp user@k8s-master:/etc/kubernetes/admin.conf ~/.kube/config

# Option 2: Use cloud provider CLI (GKE, EKS, AKS, etc.)
gcloud container clusters get-credentials my-cluster --region us-central1
# or
aws eks update-kubeconfig --name my-cluster --region us-east-1
# or
az aks get-credentials --resource-group my-rg --name my-cluster

# Verify access
kubectl get nodes
kubectl get namespaces
```

### Step 3: Install Provider Node

```bash
cd provider-node-server
npm install
```

### Step 4: Configure Environment

```bash
# Create .env file (optional)
cat > .env << EOF
PROVIDER_NODE_PORT=4040
# KUBECONFIG=/path/to/custom/kubeconfig  # Optional: override default
EOF
```

### Step 5: Run Provider Node

#### Development Mode (with auto-reload)
```bash
npm run dev
```

#### Production Mode (with PM2)
```bash
npm run start:pm2

# Monitor
pm2 status
pm2 logs cloudana-provider-node
pm2 monit
```

#### Production Mode (with systemd)
```bash
# Create systemd service
sudo tee /etc/systemd/system/cloudana-provider.service > /dev/null << EOF
[Unit]
Description=Cloudana Provider Node
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=$(which node) --loader tsx src/index.ts
Restart=always
Environment="PROVIDER_NODE_PORT=4040"

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable cloudana-provider
sudo systemctl start cloudana-provider

# Check status
sudo systemctl status cloudana-provider
sudo journalctl -u cloudana-provider -f
```

### Step 6: Verify Provider Node

```bash
# Check endpoints
curl http://localhost:4040/device-info
curl http://localhost:4040/status

# Should return:
# /device-info → Device ID, hostname, and hardware specs
# /status → List of running workload instances
```

### Step 7: Register Provider On-Chain

Once the provider node is running, register it on the blockchain:

1. Go to the Cloudana frontend
2. Navigate to Provider Registration
3. Use the device ID from `/device-info`
4. Set your provider node endpoint (e.g., `http://your-server-ip:4040`)
5. Approve CLD bond and register

The orchestrator will now be able to send workload deployments to your provider node.

## API Endpoints

### `GET /device-info`
Returns unique device identifier and hardware specifications for provider registration.

**Response:**
```json
{
  "deviceId": "0x...",
  "hostname": "provider-node-1",
  "spec": {
    "cpuModel": "Intel(R) Xeon(R) CPU @ 2.50GHz",
    "cpuCores": 8,
    "memoryTotalBytes": 16777216000,
    "memoryFreeBytes": 8388608000,
    "diskTotalBytes": 107374182400,
    "diskFreeBytes": 53687091200
  }
}
```

### `POST /deploy`
Accepts workload deployment requests from the orchestrator.

**Request:**
```json
{
  "workloadId": "123",
  "instanceId": "456",
  "manifest": { ... },
  "k8sManifest": {
    "namespace": "workload-123-456",
    "resources": [...]
  }
}
```

**Response:**
```json
{
  "status": "success",
  "message": "Deploy accepted; workload execution started",
  "workloadId": "123",
  "instanceId": "456",
  "instanceStatus": "pending"
}
```

### `GET /status`
Returns status of all running workload instances.

**Response:**
```json
{
  "status": "ok",
  "instances": [
    {
      "key": "123-456",
      "workloadId": "123",
      "instanceId": "456",
      "status": "running"
    }
  ]
}
```

## Workload Execution Modes

The provider node supports multiple execution backends:

1. **Kubernetes API** (Preferred): Applies K8s manifests via client-node library
   - Requires K8s cluster access
   - Supports Deployments, Services, PVCs, ConfigMaps
   - Automatic namespace isolation

2. **kubectl** (Fallback): Executes raw YAML via kubectl CLI
   - Useful for complex manifests
   - Requires kubectl binary installed

3. **Docker** (Alternative): Runs containers via `docker run`
   - For providers without K8s
   - Simpler setup, less orchestration features

4. **Placeholder** (MVP): Dummy execution for testing
   - Marks workload as executed without actual compute
   - Development/testing only

## Multi-Cluster Management

A single provider node can manage multiple Kubernetes clusters:

```bash
# Configure multiple contexts in kubeconfig
kubectl config get-contexts

# Provider node can route workloads to different clusters based on:
# - Resource requirements (GPU vs CPU)
# - Geographic location
# - Pricing tiers
# - Provider's business logic
```

**Future enhancement**: Add cluster selection logic in `executeWorkload()`.

## Security Considerations

### Provider Node Security
- Run provider node in a trusted network (VPN, private subnet)
- Use firewall rules to restrict `/deploy` endpoint access to orchestrator only
- Rotate provider keys regularly
- Monitor for unauthorized deployment attempts

### Kubernetes RBAC
Provider node service account needs these permissions:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: cloudana-provider
rules:
  - apiGroups: [""]
    resources: ["namespaces", "pods", "services", "persistentvolumeclaims", "configmaps"]
    verbs: ["get", "list", "create", "update", "delete"]
  - apiGroups: ["apps"]
    resources: ["deployments", "statefulsets"]
    verbs: ["get", "list", "create", "update", "delete"]
```

### Network Isolation
- Use K8s NetworkPolicies to isolate tenant workloads
- Each workload gets its own namespace
- Prevent cross-tenant communication

## Monitoring & Logging

### Advanced Structured Logging

The provider node uses **Pino** for high-performance structured logging with:

**Features:**
- ✅ **Structured JSON logs** in production (machine-readable)
- ✅ **Pretty console logs** in development (human-readable)
- ✅ **Request correlation IDs** for tracing requests through the system
- ✅ **Performance tracking** with execution duration
- ✅ **Log levels**: trace, debug, info, warn, error, fatal
- ✅ **Contextual metadata** for all log entries
- ✅ **Automatic HTTP request/response logging**

**Log Levels:**
```bash
# Set log level via environment variable
LOG_LEVEL=debug npm run dev     # Development (verbose)
LOG_LEVEL=info npm start         # Production (default)
LOG_LEVEL=warn npm start         # Production (quiet)
```

**Development Logs (Pretty):**
```
[2026-02-10 14:32:15.123] INFO [http]: POST /deploy
  workloadId: "123"
  instanceId: "456"
  requestId: "a1b2c3d4e5f6"

[2026-02-10 14:32:15.234] INFO [workload]: Starting workload execution: 123/456
  hasManifest: true
  hasK8sManifest: true
  k8sResourceCount: 3
  namespace: "workload-123-456"

[2026-02-10 14:32:16.789] INFO [k8s]: Created Deployment nginx in workload-123-456
  action: "create"
  resource: "Deployment"
  namespace: "workload-123-456"
  name: "nginx"
  success: true

[2026-02-10 14:32:17.012] INFO [http]: POST /deploy 200 1889ms
  status: 200
  duration: "1889ms"
  requestId: "a1b2c3d4e5f6"
```

**Production Logs (JSON):**
```json
{"level":30,"time":"2026-02-10T14:32:15.123Z","module":"http","method":"POST","path":"/deploy","requestId":"a1b2c3d4e5f6","msg":"POST /deploy"}
{"level":30,"time":"2026-02-10T14:32:15.234Z","module":"workload","workloadId":"123","instanceId":"456","hasK8sManifest":true,"k8sResourceCount":3,"msg":"Starting workload execution: 123/456"}
{"level":30,"time":"2026-02-10T14:32:16.789Z","module":"k8s","action":"create","resource":"Deployment","namespace":"workload-123-456","name":"nginx","success":true,"msg":"Created Deployment nginx in workload-123-456"}
{"level":30,"time":"2026-02-10T14:32:17.012Z","module":"http","status":200,"duration":"1889ms","requestId":"a1b2c3d4e5f6","msg":"POST /deploy 200 1889ms"}
```

### What Gets Logged

**HTTP Requests:**
- Method, path, query parameters
- Request ID (correlation)
- User agent
- Response status and duration

**Workload Execution:**
- Workload ID and instance ID
- Execution mode (K8s API, kubectl, Docker, placeholder)
- Start/success/error events
- Duration and details
- Error messages with stack traces

**Kubernetes Operations:**
- Resource creation (Namespace, Deployment, Service, PVC, ConfigMap)
- Success/failure status
- Resource names and namespaces

**Docker Operations:**
- Container run/stop/remove actions
- Image and command
- Container ID
- Success/failure status

**Device Information:**
- Device ID, hostname
- CPU cores, memory
- Disk space

**System Startup:**
- Port, environment, log level
- K8s availability
- PID and hostname

### Viewing Logs

```bash
# Development (pretty logs)
npm run dev

# PM2 (production)
pm2 logs cloudana-provider-node
pm2 logs cloudana-provider-node --json  # JSON output

# systemd
sudo journalctl -u cloudana-provider -f
sudo journalctl -u cloudana-provider -f -o json  # JSON output

# Docker (if containerized)
docker logs cloudana-provider
docker logs cloudana-provider --follow
```

### Log Aggregation

For production, ship logs to a centralized logging system:

**Loki (Grafana):**
```bash
# Install Promtail to ship logs
curl -O -L "https://github.com/grafana/loki/releases/download/v2.9.0/promtail-linux-amd64.zip"
unzip promtail-linux-amd64.zip
sudo mv promtail-linux-amd64 /usr/local/bin/promtail

# Configure Promtail to read systemd logs
sudo tee /etc/promtail-config.yaml > /dev/null << EOF
server:
  http_listen_port: 9080

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki-server:3100/loki/api/v1/push

scrape_configs:
  - job_name: cloudana-provider
    journal:
      labels:
        job: cloudana-provider
      path: /var/log/journal
EOF
```

**CloudWatch (AWS):**
```bash
# Install CloudWatch agent
wget https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
sudo dpkg -i amazon-cloudwatch-agent.deb

# Configure to ship systemd logs
# See AWS CloudWatch documentation
```

**Elasticsearch:**
```bash
# Use Filebeat to ship logs
curl -L -O https://artifacts.elastic.co/downloads/beats/filebeat/filebeat-8.x-amd64.deb
sudo dpkg -i filebeat-8.x-amd64.deb

# Configure Filebeat for systemd logs
# See Elastic documentation
```

### Request Tracing

Every HTTP request gets a unique `x-request-id` header for correlation:

```bash
# Make request with custom ID
curl -H "x-request-id: my-test-123" http://localhost:4040/status

# Response includes same ID
# Logs show: requestId: "my-test-123"
```

This allows you to trace a single request through the entire system:
1. Orchestrator sends deploy request with ID
2. Provider node logs all operations with that ID
3. K8s operations tagged with same ID
4. Response includes ID for confirmation

### Metrics (Future)

Future enhancement: Integrate Prometheus metrics for:
- Workload execution latency (histogram)
- K8s API call success rate (counter)
- Resource utilization (gauge)
- Active workload count (gauge)
- HTTP request duration (histogram)
- Error rate by endpoint (counter)

## Troubleshooting

### Provider node can't connect to K8s
```bash
# Check kubeconfig
kubectl config view
kubectl get nodes

# Test K8s API access
kubectl auth can-i create deployments --all-namespaces

# Check provider node logs
pm2 logs cloudana-provider-node
```

### Workload deployment fails
```bash
# Check K8s resources
kubectl get all -n workload-<workloadId>-<instanceId>

# Check events
kubectl get events -n workload-<workloadId>-<instanceId> --sort-by='.lastTimestamp'

# Check pod logs
kubectl logs -n workload-<workloadId>-<instanceId> <pod-name>
```

### Provider not receiving workloads
1. Check provider registration on-chain
2. Verify provider endpoint is accessible by orchestrator
3. Check provider status (active/inactive)
4. Verify provider has sufficient capacity in metadata
5. Check orchestrator logs for placement decisions

## Development

### Local Development Setup
```bash
# Install dependencies
npm install

# Run with auto-reload
npm run dev

# Use local K8s cluster
minikube start
# or
kind create cluster

# Verify provider node can access K8s
curl http://localhost:4040/device-info
```

### Testing K8s Integration
```bash
# Deploy a test workload
curl -X POST http://localhost:4040/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "workloadId": "test-123",
    "instanceId": "1",
    "k8sManifest": {
      "namespace": "test-workload",
      "resources": [{
        "apiVersion": "v1",
        "kind": "Pod",
        "metadata": { "name": "test-pod" },
        "spec": {
          "containers": [{
            "name": "nginx",
            "image": "nginx:alpine"
          }]
        }
      }]
    }
  }'

# Check deployment
kubectl get pods -n test-workload
```

## Contributing

When modifying the provider node:
1. Maintain backward compatibility with orchestrator API
2. Add tests for new execution modes
3. Update this README with configuration changes
4. Follow the external deployment model (no assumptions about running in-cluster)

## References

- [Akash Provider Architecture](https://github.com/akash-network/provider) - Similar design patterns
- [Kubernetes Client Node](https://github.com/kubernetes-client/javascript) - K8s API library
- [Cloudana Smart Contracts](../contract/) - On-chain provider registry
- [Orchestrator Service](../client/api/) - Workload placement logic
