/**
 * Logging system test and demonstration
 * 
 * Run this to see the logging system in action:
 * NODE_ENV=development npm run dev
 * 
 * Or to see JSON logs:
 * NODE_ENV=production tsx src/test-logging.ts
 */
import {
  loggers,
  logRequest,
  logResponse,
  logWorkloadStart,
  logWorkloadSuccess,
  logWorkloadError,
  logK8sResource,
  logDockerOperation,
  logDeviceInfo,
  logStartup,
  logMetrics,
} from "./logger.js";

console.log("\n=== Testing Cloudana Provider Node Logging System ===\n");

// Test 1: Server startup
console.log("1. Server Startup Log:");
logStartup({
  port: 4040,
  deviceId: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  hostname: "provider-node-test",
  nodeEnv: process.env.NODE_ENV || "development",
  logLevel: process.env.LOG_LEVEL || "info",
  k8sAvailable: true,
});

setTimeout(() => {
  // Test 2: HTTP Request/Response
  console.log("\n2. HTTP Request/Response Logs:");
  logRequest({
    method: "POST",
    path: "/deploy",
    query: "debug=true",
    headers: { "user-agent": "orchestrator/1.0" },
    requestId: "req-abc123",
  });

  logResponse({
    method: "POST",
    path: "/deploy",
    status: 200,
    duration: 1234,
    requestId: "req-abc123",
  });
}, 100);

setTimeout(() => {
  // Test 3: Workload Execution
  console.log("\n3. Workload Execution Logs:");
  logWorkloadStart({
    workloadId: "123",
    instanceId: "456",
    manifest: { image: "nginx:latest" },
    k8sManifest: {
      namespace: "workload-123-456",
      resources: [{}, {}, {}], // 3 resources
    },
  });

  setTimeout(() => {
    logWorkloadSuccess({
      workloadId: "123",
      instanceId: "456",
      executionMode: "k8s-api",
      duration: 2345,
      details: "Applied 3 resources in namespace workload-123-456",
    });
  }, 50);
}, 200);

setTimeout(() => {
  // Test 4: K8s Operations
  console.log("\n4. Kubernetes Operations:");
  logK8sResource({
    action: "create",
    resource: "Namespace",
    namespace: "workload-123-456",
    success: true,
  });

  logK8sResource({
    action: "create",
    resource: "Deployment",
    namespace: "workload-123-456",
    name: "nginx",
    success: true,
  });

  logK8sResource({
    action: "create",
    resource: "Service",
    namespace: "workload-123-456",
    name: "nginx-service",
    success: true,
  });
}, 300);

setTimeout(() => {
  // Test 5: Docker Operations
  console.log("\n5. Docker Operations:");
  logDockerOperation({
    action: "run",
    workloadId: "789",
    instanceId: "101",
    image: "nginx:alpine",
    command: "/bin/sh -c 'nginx -g daemon off;'",
    containerId: "abc123def456",
    success: true,
  });
}, 400);

setTimeout(() => {
  // Test 6: Error Logging
  console.log("\n6. Error Logs:");
  logWorkloadError({
    workloadId: "999",
    instanceId: "888",
    error: new Error("K8s API connection failed"),
    executionMode: "k8s-api",
    phase: "apply",
  });

  logK8sResource({
    action: "create",
    resource: "Deployment",
    namespace: "workload-999-888",
    name: "failed-deployment",
    success: false,
    error: "ImagePullBackOff: cannot pull image nginx:nonexistent",
  });
}, 500);

setTimeout(() => {
  // Test 7: Device Info
  console.log("\n7. Device Info Query:");
  logDeviceInfo({
    deviceId: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    hostname: "provider-node-test",
    cpuCores: 8,
    memoryTotalGB: 16,
    requestId: "req-device-001",
  });
}, 600);

setTimeout(() => {
  // Test 8: Metrics
  console.log("\n8. System Metrics:");
  logMetrics({
    activeWorkloads: 5,
    totalWorkloadsProcessed: 42,
    avgExecutionTime: 1850,
    successRate: 0.95,
  });
}, 700);

setTimeout(() => {
  // Test 9: Different log levels
  console.log("\n9. Different Log Levels:");
  loggers.server.trace({ detail: "Very detailed info" }, "Trace level log");
  loggers.server.debug({ detail: "Debug info" }, "Debug level log");
  loggers.server.info({ detail: "Info message" }, "Info level log");
  loggers.server.warn({ detail: "Warning message" }, "Warning level log");
  loggers.server.error({ detail: "Error message" }, "Error level log");
}, 800);

setTimeout(() => {
  // Test 10: Multiple modules
  console.log("\n10. Multi-Module Logs:");
  loggers.server.info("Server module log");
  loggers.workload.info("Workload module log");
  loggers.k8s.info("Kubernetes module log");
  loggers.docker.info("Docker module log");
  loggers.http.info("HTTP module log");
  loggers.device.info("Device module log");
}, 900);

setTimeout(() => {
  console.log("\n=== Logging Test Complete ===\n");
  console.log("Tips:");
  console.log("- Run with LOG_LEVEL=debug for verbose output");
  console.log("- Run with LOG_LEVEL=error to see only errors");
  console.log("- Run with NODE_ENV=production for JSON logs");
  console.log("- Run with NODE_ENV=development for pretty logs");
  console.log();
  process.exit(0);
}, 1000);
