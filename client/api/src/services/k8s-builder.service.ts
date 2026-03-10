/**
 * Kubernetes manifest builder.
 * Converts parsed SDL (awesome-akash format) to Kubernetes resource manifests.
 * Supports: Deployment, Service, PVC, Ingress (optional).
 */
import type { ParsedManifest, ParsedService } from "./sdl-parser.service.js";
import { log } from "../lib/logger.js";

const L = log.orchestratorEvent;

/** Builder options for K8s manifest generation */
export interface K8sBuilderOptions {
  namespace: string;
  workloadId: string;
  instanceId: string;
  /** Optional: base domain for Ingress (e.g., "provider.com" -> "workload-4-1.provider.com") */
  ingressBaseDomain?: string;
  /** Optional: TLS secret name for HTTPS */
  ingressTlsSecret?: string;
}

/** Kubernetes resource definition (generic) */
export interface K8sResource {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: Record<string, unknown>;
  data?: Record<string, string>;
}

/** Complete K8s manifest to send to provider */
export interface K8sManifest {
  namespace: string;
  resources: K8sResource[];
}

/** Parse memory/storage size to Kubernetes quantity format */
function toK8sQuantity(size: string): string {
  const sizeString = String(size || "512Mi").trim();
  // If it's just a number, add Mi unit
  if (/^\d+$/.test(sizeString)) return `${sizeString}Mi`;
  // Validate format matches K8s quantity regex
  if (!/^[0-9.]+[EPTGMK]i?$/.test(sizeString)) {
    L.warn(`Invalid quantity format: ${sizeString}, using default 512Mi`);
    return "512Mi";
  }
  return sizeString;
}

/** Parse CPU units to Kubernetes CPU quantity format (millicores) */
function toCpuQuantity(units: number): string {
  // Ensure it's a valid number
  const cpuMillicores = Number(units);
  if (isNaN(cpuMillicores) || cpuMillicores <= 0) {
    return "100m"; // Default to 100 millicores if invalid
  }
  // CPU units are in millicores, ensure integer
  return `${Math.max(1, Math.floor(cpuMillicores))}m`;
}

/**
 * Build Kubernetes manifest from parsed SDL.
 */
export function buildK8sManifest(
  parsed: ParsedManifest,
  options: K8sBuilderOptions
): K8sManifest {
  const { namespace, workloadId, instanceId, ingressBaseDomain, ingressTlsSecret } = options;
  L.info(`🔨 Building K8s manifest for workload ${workloadId}/${instanceId}`);
  L.info(`   Namespace: ${namespace}`);
  L.info(`   Services to process: ${parsed.services.length}`);
  
  const labels: Record<string, string> = {
    "cloudana.workload": workloadId,
    "cloudana.instance": instanceId,
    "app.kubernetes.io/managed-by": "cloudana",
  };

  const resources: K8sResource[] = [];

  for (const service of parsed.services) {
    L.info(`   📦 Processing service: ${service.name}`);
    const serviceResources = buildServiceResources(service, namespace, labels, {
      ingressBaseDomain,
      ingressTlsSecret,
      workloadId,
      instanceId,
    });
    L.info(`      Generated ${serviceResources.length} resource(s):`);
    serviceResources.forEach(resource => {
      L.info(`        - ${resource.kind}: ${resource.metadata.name}`);
    });
    resources.push(...serviceResources);
  }

  L.success(`✅ K8s manifest built successfully`);
  L.info(`   Total resources: ${resources.length}`);
  L.info(`   Resource types: ${[...new Set(resources.map(r => r.kind))].join(', ')}`);

  return {
    namespace,
    resources,
  };
}

function buildServiceResources(
  svc: ParsedService,
  namespace: string,
  baseLabels: Record<string, string>,
  options?: {
    ingressBaseDomain?: string;
    ingressTlsSecret?: string;
    workloadId?: string;
    instanceId?: string;
  }
): K8sResource[] {
  const resources: K8sResource[] = [];
  const labels = { ...baseLabels, "cloudana.service": svc.name };

  // PersistentVolumeClaims for persistent storage
  const storageMounts: Array<{ name: string; mountPath: string; subPath: string }> = [];
  let storageIndex = 0;
  for (const st of svc.resources.storage ?? []) {
    if (st.persistent) {
      const pvcName = `${svc.name}-storage-${storageIndex}`;
      resources.push({
        apiVersion: "v1",
        kind: "PersistentVolumeClaim",
        metadata: { name: pvcName, namespace, labels },
        spec: {
          accessModes: ["ReadWriteOnce"],
          resources: {
            requests: {
              storage: toK8sQuantity(st.size),
            },
          },
          ...(st.class && { storageClassName: st.class }),
        },
      });
      storageMounts.push({
        name: pvcName,
        mountPath: `/data/storage-${storageIndex}`,
        subPath: svc.name,
      });
      storageIndex++;
    }
  }

  // Deployment
  const cpuQuantity = toCpuQuantity(svc.resources.cpu.units);
  const memoryQuantity = toK8sQuantity(svc.resources.memory.size);
  
  L.info(`      Container resources:`);
  L.info(`        CPU request/limit: ${cpuQuantity}`);
  L.info(`        Memory request/limit: ${memoryQuantity}`);
  L.info(`        Image: ${svc.image}`);
  
  const container: Record<string, unknown> = {
    name: svc.name,
    image: svc.image,
    imagePullPolicy: "IfNotPresent" as const,
    resources: {
      requests: {
        cpu: cpuQuantity,
        memory: memoryQuantity,
      },
      limits: {
        cpu: cpuQuantity,
        memory: memoryQuantity,
      },
    },
    ports: svc.expose.map((e) => ({
      containerPort: e.port,
      protocol: "TCP",
    })),
    securityContext: {
      runAsNonRoot: false,
      allowPrivilegeEscalation: false,
    },
  };

  if (svc.command && svc.command.length > 0) {
    container.command = svc.command;
  }
  if (svc.args && svc.args.length > 0) {
    container.args = svc.args;
  }

  // Env vars (inline)
  const envVars: Array<{ name: string; value: string }> = [];
  if (svc.env && svc.env.length > 0) {
    for (const e of svc.env) {
      const idx = e.indexOf("=");
      if (idx > 0) {
        envVars.push({
          name: e.slice(0, idx).trim(),
          value: e.slice(idx + 1).trim(),
        });
      }
    }
  }
  if (envVars.length > 0) {
    container.env = envVars;
  }

  // Volume mounts for PVCs
  if (storageMounts.length > 0) {
    container.volumeMounts = storageMounts.map((m) => ({
      name: m.name,
      mountPath: m.mountPath,
      subPath: m.subPath,
    }));
  }

  const volumes: Array<{ name: string; persistentVolumeClaim?: { claimName: string } }> = [];
  for (const m of storageMounts) {
    volumes.push({ name: m.name, persistentVolumeClaim: { claimName: m.name } });
  }

  resources.push({
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: svc.name, namespace, labels },
    spec: {
      replicas: 1,
      selector: { matchLabels: { "cloudana.service": svc.name } },
      template: {
        metadata: { labels: { ...labels, "cloudana.service": svc.name } },
        spec: {
          containers: [container],
          volumes: volumes.length > 0 ? volumes : undefined,
          restartPolicy: "Always",
        },
      },
      strategy: { type: "RollingUpdate" },
    },
  });

  // Service (expose ports)
  if (svc.expose.length > 0) {
    const ports = svc.expose.map((e) => ({
      name: `port-${e.port}`,
      port: e.as,
      targetPort: e.port,
      protocol: "TCP",
    }));

    // If Ingress is requested, use ClusterIP; otherwise use NodePort
    const serviceType = options?.ingressBaseDomain ? "ClusterIP" : "NodePort";

    resources.push({
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: svc.name, namespace, labels },
      spec: {
        type: serviceType,
        selector: { "cloudana.service": svc.name },
        ports,
      },
    });

    // Add Ingress if baseDomain is provided
    if (options?.ingressBaseDomain && svc.expose.some(e => e.global)) {
      const { ingressBaseDomain, ingressTlsSecret, workloadId, instanceId } = options;
      const subdomain = `workload-${workloadId}-${instanceId}`;
      const host = `${subdomain}.${ingressBaseDomain}`;
      
      const ingressRules = [{
        host,
        http: {
          paths: svc.expose
            .filter(e => e.global)
            .map((e) => ({
              path: "/",
              pathType: "Prefix",
              backend: {
                service: {
                  name: svc.name,
                  port: { number: e.as },
                },
              },
            })),
        },
      }];

      const ingressResource: K8sResource = {
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: { 
          name: `${svc.name}-ingress`, 
          namespace, 
          labels,
          annotations: {
            "kubernetes.io/ingress.class": "nginx",
          },
        },
        spec: {
          rules: ingressRules,
        },
      };

      // Add TLS if secret provided
      if (ingressTlsSecret) {
        ingressResource.spec!.tls = [{
          hosts: [host],
          secretName: ingressTlsSecret,
        }];
      }

      resources.push(ingressResource);
      L.info(`      🌐 Ingress created: ${host}`);
    }
  }

  return resources;
}
