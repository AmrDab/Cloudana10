# Logging System

Production-grade structured logging for Cloudana Provider Node using Pino.

## Quick Start

```bash
# Install dependencies
npm install

# Test the logging system
npm run test-logging              # Pretty logs
npm run test-logging:json         # JSON logs (production format)
npm run test-logging:debug        # Verbose debug logs

# Run with custom log level
LOG_LEVEL=debug npm run dev       # Development
LOG_LEVEL=info npm start          # Production
LOG_LEVEL=warn npm start          # Quiet mode
```

## Features

✅ **High Performance** - Pino is one of the fastest Node.js loggers  
✅ **Structured JSON** - Machine-readable logs in production  
✅ **Pretty Console** - Human-readable logs in development  
✅ **Request Tracing** - Correlation IDs for end-to-end tracking  
✅ **Auto HTTP Logging** - All requests/responses logged automatically  
✅ **Multiple Modules** - Separate loggers for different components  
✅ **Performance Tracking** - Execution duration for all operations  
✅ **Error Context** - Stack traces and contextual metadata  

## Log Levels

| Level | When to Use |
|-------|-------------|
| `trace` | Very detailed debugging (function entry/exit) |
| `debug` | Debugging information (variable values, flow) |
| `info` | Normal operation (workload started, completed) |
| `warn` | Warning conditions (retry, fallback, deprecation) |
| `error` | Error conditions (failed operations) |
| `fatal` | Critical errors (service cannot continue) |

## Environment Variables

```bash
# Log level (default: info in prod, debug in dev)
LOG_LEVEL=debug|info|warn|error

# Environment (affects log format)
NODE_ENV=development|production

# Custom hostname for logs
HOSTNAME=provider-node-1
```

## Module Loggers

Different modules for different concerns:

```typescript
import { loggers } from "./logger.js";

loggers.server.info("Server started");      // General server logs
loggers.workload.info("Workload deployed"); // Workload execution
loggers.k8s.info("K8s resource created");   // Kubernetes operations
loggers.docker.info("Container started");   // Docker operations
loggers.http.info("Request received");      // HTTP requests/responses
loggers.device.info("Device info queried"); // Device/hardware info
```

## Structured Logging

All logs include structured data:

```typescript
import { loggers } from "./logger.js";

// Good - includes context
loggers.workload.info(
  { 
    workloadId: "123",
    instanceId: "456",
    duration: "1234ms"
  },
  "Workload deployed successfully"
);

// Bad - just a string
console.log("Workload deployed");
```

## Request Correlation

Every HTTP request gets a unique ID for tracing:

```typescript
import { getRequestId } from "./middleware.js";

app.post("/deploy", async (c) => {
  const requestId = getRequestId(c);
  
  // All logs include this ID
  loggers.server.info({ requestId }, "Processing deploy request");
  
  // Response includes ID
  return c.json({ status: "success", requestId });
});
```

**Example trace:**
```
[http] POST /deploy (requestId: abc123)
[workload] Starting workload 123/456 (requestId: abc123)
[k8s] Created namespace (requestId: abc123)
[http] POST /deploy 200 1234ms (requestId: abc123)
```

## Helper Functions

Use logging utilities for common patterns:

```typescript
import { 
  logExecutionTime,
  logWithContext,
  sanitizeForLog,
  TimingContext
} from "./logger-utils.js";

// Measure execution time
const result = await logExecutionTime(
  "deploy-workload",
  async () => {
    // ... your code
  },
  { workloadId: "123" }
);

// Complex operation with checkpoints
const timing = new TimingContext("deploy-workload");
await fetchManifest();
timing.checkpoint("manifest-fetched");
await applyK8s();
timing.checkpoint("k8s-applied");
timing.complete(true, { workloadId: "123" });
```

## Log Output Examples

### Development (Pretty)

```
14:32:15 INFO [server]: Provider node started on port 4040
  deviceId: "0x1234567890abcd..."
  k8sAvailable: true

14:32:20 INFO [http]: POST /deploy
  method: "POST"
  path: "/deploy"
  requestId: "abc123"

14:32:21 INFO [workload]: Starting workload execution: 123/456
  workloadId: "123"
  instanceId: "456"
  k8sResourceCount: 3

14:32:23 INFO [k8s]: Created Deployment nginx in workload-123-456
  resource: "Deployment"
  name: "nginx"
  success: true

14:32:24 INFO [http]: POST /deploy 200 1234ms
  status: 200
  duration: "1234ms"
```

### Production (JSON)

```json
{"level":30,"time":"2026-02-10T14:32:15.123Z","pid":12345,"hostname":"provider-1","service":"cloudana-provider-node","module":"server","port":4040,"deviceId":"0x1234567890abcd...","k8sAvailable":true,"msg":"Provider node started on port 4040"}

{"level":30,"time":"2026-02-10T14:32:20.456Z","pid":12345,"hostname":"provider-1","service":"cloudana-provider-node","module":"http","method":"POST","path":"/deploy","requestId":"abc123","msg":"POST /deploy"}

{"level":30,"time":"2026-02-10T14:32:21.789Z","pid":12345,"hostname":"provider-1","service":"cloudana-provider-node","module":"workload","workloadId":"123","instanceId":"456","k8sResourceCount":3,"msg":"Starting workload execution: 123/456"}
```

## Log Aggregation

For production deployments, ship logs to a centralized system:

### Option 1: Loki (Grafana)
- Install Promtail to scrape logs
- Ship to Loki server
- Query in Grafana

### Option 2: CloudWatch (AWS)
- Install CloudWatch agent
- Configure systemd log shipping
- View in CloudWatch console

### Option 3: Elasticsearch
- Install Filebeat
- Ship to Elasticsearch
- Visualize in Kibana

## Best Practices

**DO:**
- ✅ Use appropriate log levels
- ✅ Include contextual metadata
- ✅ Log operation start and completion
- ✅ Include duration for operations
- ✅ Use requestId for correlation
- ✅ Sanitize sensitive data

**DON'T:**
- ❌ Log passwords or tokens
- ❌ Use only console.log
- ❌ Log too verbosely in production
- ❌ Log full request bodies (can be huge)
- ❌ Forget error stack traces

## Performance

Pino is extremely fast:
- **Development**: Pretty printing adds ~20ms overhead
- **Production**: JSON logging adds <1ms overhead
- **Async logging**: Available for even lower latency
- **Zero dependencies**: Minimal bundle size

## Testing

Run the test suite to see all logging features:

```bash
npm run test-logging
```

This demonstrates:
- Server startup logs
- HTTP request/response logs
- Workload execution logs
- K8s operations
- Docker operations
- Error logging
- Device info
- System metrics
- Different log levels
- Multiple modules
