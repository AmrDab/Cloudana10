/**
 * K3sService – TypeScript port of provider-console-api K3sService.
 * Depends on an SSH adapter for remote command execution. Use StubK3sSSHAdapter
 * for tests or when SSH is not available; provide a real adapter (e.g. ssh2-based)
 * for production.
 */

import type {
  ControlMachineInput,
  WorkerNodeInput,
  CheckInstallationsResponse,
  InitK3sResponse,
  JoinNodeResponse,
  RemoveNodeResponse,
  GpuInstallResponse,
  ListNodesResponse,
} from "../types/k3s.js";
import { ApplicationError } from "../types/k3s.js";

const HTTP_400 = 400;
const HTTP_500 = 500;
/** K3s creates this file on install; use when ~/.kube/config does not exist yet. */
const K3S_KUBECONFIG_PATH = "/etc/rancher/k3s/k3s.yaml";

/** Env-based defaults for Akash/Provider (mirror provider-console-api Config). */
const DEFAULT_CHAIN_ID = process.env.CHAIN_ID ?? "akashnet-2";
const DEFAULT_PROVIDER_SERVICES_VERSION = (process.env.PROVIDER_SERVICES_VERSION ?? "v0.10.1").replace(/^v/, "");
const DEFAULT_AKASH_VERSION = (process.env.AKASH_VERSION ?? "v1.0.0").replace(/^v/, "");
const DEFAULT_INGRESS_NGINX_VERSION = process.env.INGRESS_NGINX_VERSION ?? "4.11.3";
const PROVIDER_PRICE_SCRIPT_URL =
  process.env.PROVIDER_PRICE_SCRIPT_URL ??
  "https://raw.githubusercontent.com/akash-network/helm-charts/main/charts/akash-provider/scripts/price_script_generic.sh";
const AKASH_NODE_STATUS_CHECK = process.env.AKASH_NODE_STATUS_CHECK ?? "";
const SCHEDULER_CONFIG = `
cat > /var/lib/rancher/k3s/server/etc/scheduler-config.yaml << EOF
apiVersion: kubescheduler.config.k8s.io/v1
kind: KubeSchedulerConfiguration
clientConnection:
  kubeconfig: "/var/lib/rancher/k3s/server/cred/scheduler.kubeconfig"
leaderElection:
  leaderElect: true
profiles:
- schedulerName: default-scheduler
  plugins:
    score:
      enabled:
      - name: NodeResourcesFit
  pluginConfig:
  - name: NodeResourcesFit
    args:
      scoringStrategy:
        type: MostAllocated
        resources:
        - name: nvidia.com/gpu
          weight: 10
        - name: memory
          weight: 1
        - name: cpu
          weight: 1
        - name: ephemeral-storage
          weight: 1
EOF
`;

function log(level: "info" | "warn" | "debug" | "error", msg: string): void {
  const prefix = `[K3sService] [${level}]`;
  if (level === "error") console.error(prefix, msg);
  else if (level === "warn") console.warn(prefix, msg);
  else console.log(prefix, msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Opaque SSH client handle. Adapter-specific. */
export type SSHClient = unknown;

export interface RunSSHOptions {
  checkExitStatus?: boolean;
  taskId?: string | null;
  /** Called for each stdout/stderr chunk during command run (for live step logs). */
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
}

function runOpts(taskId: string, onLog?: (line: string) => void, overrides?: Partial<RunSSHOptions>): RunSSHOptions {
  return {
    taskId,
    onLine: onLog ? (l, s) => onLog(s === "stderr" ? `[stderr] ${l}` : l) : undefined,
    ...overrides,
  };
}

export interface IK3sSSHAdapter {
  getClient(input: ControlMachineInput | WorkerNodeInput): Promise<SSHClient>;
  closeClient(client: SSHClient): Promise<void>;
  runCommand(
    client: SSHClient,
    command: string,
    opts?: RunSSHOptions
  ): Promise<{ stdout: string; stderr: string }>;
  connectToWorkerNode(
    controlClient: SSHClient,
    workerInput: WorkerNodeInput
  ): Promise<SSHClient>;
}

/** Stub adapter that throws on any SSH operation. Use for local/dev when no SSH. */
export class StubK3sSSHAdapter implements IK3sSSHAdapter {
  async getClient(_input: ControlMachineInput | WorkerNodeInput): Promise<SSHClient> {
    throw new ApplicationError({
      statusCode: HTTP_500,
      errorCode: "K3S_003",
      payload: {
        error: "SSH Not Configured",
        message: "K3sService requires a real SSH adapter. StubK3sSSHAdapter does not perform SSH.",
      },
    });
  }

  async closeClient(_client: SSHClient): Promise<void> {}

  async runCommand(
    _client: SSHClient,
    _command: string,
    _opts?: RunSSHOptions
  ): Promise<{ stdout: string; stderr: string }> {
    throw new ApplicationError({
      statusCode: HTTP_500,
      errorCode: "K3S_003",
      payload: {
        error: "SSH Not Configured",
        message: "K3sService requires a real SSH adapter. StubK3sSSHAdapter does not perform SSH.",
      },
    });
  }

  async connectToWorkerNode(
    _controlClient: SSHClient,
    _workerInput: WorkerNodeInput
  ): Promise<SSHClient> {
    throw new ApplicationError({
      statusCode: HTTP_500,
      errorCode: "K3S_003",
      payload: {
        error: "SSH Not Configured",
        message: "K3sService requires a real SSH adapter. StubK3sSSHAdapter does not perform SSH.",
      },
    });
  }
}

export class K3sService {
  static readonly INTERNAL_IP_CMD =
    `ip -4 -o a | while read -r line; do set -- $line; if echo "$4" | grep -qE '^(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.)'; then echo "\${4%/*}"; break; fi; done`;
   
  static readonly SSH_KEY_CMD = "cat ~/.ssh/id_ed25519";

  constructor(private readonly adapter: IK3sSSHAdapter) {}

  async checkExistingInstallations(
    controlInput: ControlMachineInput
  ): Promise<CheckInstallationsResponse> {
    log("info", `Checking for existing installations on ${controlInput.hostname}`);
    const client = await this.adapter.getClient(controlInput);
    try {
      await this.checkKubectl(client, controlInput.hostname);
      await this.checkKubelet(client, controlInput.hostname);
      log("info", `No existing Kubernetes installations found on ${controlInput.hostname}`);
      return {
        message:
          "No existing Kubernetes installations found. Ready to proceed with K3s installation.",
      };
    } catch (e) {
      if (e instanceof ApplicationError) throw e;
      this.handleUnexpectedError(e, "installation check");
    } finally {
      await this.adapter.closeClient(client);
    }
  }

  private async checkKubectl(client: SSHClient, hostname: string): Promise<void> {
    if (await this.checkCommandExists(client, "kubectl")) {
      log("warn", `kubectl found on ${hostname}`);
      throw new ApplicationError({
        statusCode: HTTP_400,
        errorCode: "K3S_001",
        payload: {
          error: "Existing Installation",
          message:
            "kubectl is already installed on the machine. K3s installation cannot proceed.",
        },
      });
    }
  }

  private async checkKubelet(client: SSHClient, hostname: string): Promise<void> {
    if (await this.checkCommandExists(client, "kubelet")) {
      log("warn", `kubelet found on ${hostname}`);
      throw new ApplicationError({
        statusCode: HTTP_400,
        errorCode: "K3S_002",
        payload: {
          error: "Existing Installation",
          message:
            "Kubernetes is already installed on the machine. K3s installation cannot proceed.",
        },
      });
    }
  }

  private async checkCommandExists(client: SSHClient, command: string): Promise<boolean> {
    log("debug", `Checking if command exists: ${command}`);
    const { stdout } = await this.adapter.runCommand(client, `which ${command}`, {
      checkExitStatus: false,
    });
    return Boolean(stdout.trim());
  }

  async initializeK3sControl(
    sshClient: SSHClient,
    controlInput: ControlMachineInput,
    taskId: string,
    onLog?: (line: string) => void
  ): Promise<InitK3sResponse> {
    log("info", `Starting K3s initialization on control node ${controlInput.hostname}`);
    const opts = (o?: Partial<RunSSHOptions>) => runOpts(taskId, onLog, o);
    try {
      const externalIp = controlInput.hostname;
      const disableComponents = "traefik";
      let installExec =
        `server --disable=${disableComponents} --flannel-backend=none --disable-network-policy --cluster-init`;
        // `--disable=${disableComponents} --flannel-backend=none --disable-network-policy --cluster-init`;

      const { stdout: internalIpOut } = await this.adapter.runCommand(
        sshClient,
        K3sService.INTERNAL_IP_CMD,
        opts()
      );
      const internalIp = internalIpOut.trim();

      
      if (externalIp) 
        installExec += ` --node-ip=${externalIp} --advertise-address=${externalIp} --kube-scheduler-arg=config=/var/lib/rancher/k3s/server/etc/scheduler-config.yaml`;
      else
        installExec += ` --node-ip=${internalIp} --advertise-address=${internalIp} --kube-scheduler-arg=config=/var/lib/rancher/k3s/server/etc/scheduler-config.yaml`;

      log("info", `Setting node IP to ${internalIp}`);

      if (externalIp) {
        installExec += ` --node-external-ip=${externalIp}`;
        log("info", `Setting external IP to ${externalIp}`);
      }

      installExec += ` --tls-san=${internalIp}`;
      if (externalIp) installExec += ` --tls-san=${externalIp}`;
      log("info", `Adding IPs to TLS SAN: ${internalIp}${externalIp ? ", " + externalIp : ""}`);

      await sleep(5000);

      const installCommand = `curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC='${installExec} --node-name node1' sh -`;

      await this.adapter.runCommand(
        sshClient,
        "mkdir -p /var/lib/rancher/k3s/server/etc",
        opts()
      );
      await this.adapter.runCommand(sshClient, SCHEDULER_CONFIG, opts());

      log("info", `Executing K3s initialization command: ${installCommand}`);
      await this.adapter.runCommand(sshClient, installCommand, opts());

      log("info", `K3s initialization completed, waiting for it to be ready on ${controlInput.hostname}`);
      await this.waitForK3sReady(sshClient, taskId, undefined, undefined, onLog);

      log("info", `K3s initialization and readiness check completed successfully on ${controlInput.hostname}`);
      return { message: "K3s initialization completed successfully and is ready" };
    } catch (e) {
      if (e instanceof ApplicationError) throw e;
      this.handleUnexpectedError(e, "K3s initialization");
    }
  }

  private async waitForK3sReady(
    sshClient: SSHClient,
    taskId: string,
    timeoutMs: number = 300_000,
    checkIntervalMs: number = 10_000,
    onLog?: (line: string) => void
  ): Promise<void> {
    log("info", `Waiting for K3s to be ready (timeout: ${timeoutMs / 1000}s, check interval: ${checkIntervalMs / 1000}s)`);
    const start = Date.now();
    await sleep(5000);
    while (Date.now() - start < timeoutMs) {
      const { stdout } = await this.adapter.runCommand(
        sshClient,
        `kubectl get nodes`,
        runOpts(taskId, onLog, { checkExitStatus: false })
      );
      if (stdout.includes("Ready")) {
        log("info", "K3s is ready");
        return;
      }
      log("debug", `K3s not ready yet, waiting ${checkIntervalMs / 1000} seconds before next check`);
      await sleep(checkIntervalMs);
    }
    log("error", `K3s did not become ready within ${timeoutMs / 1000} seconds`);
    throw new ApplicationError({
      statusCode: HTTP_500,
      errorCode: "K3S_009",
      payload: {
        error: "K3s Not Ready",
        message: `K3s did not become ready within ${timeoutMs / 1000} seconds`,
      },
    });
  }

  async updateAndInstallDependencies(sshClient: SSHClient, taskId: string, onLog?: (line: string) => void): Promise<void> {
    const opts = () => runOpts(taskId, onLog);
    try {
      log("info", "Updating system and installing dependencies");
      await this.adapter.runCommand(sshClient, "apt-get update", opts());
      await this.adapter.runCommand(
        sshClient,
        "DEBIAN_FRONTEND=noninteractive apt-get upgrade -qy",
        opts()
      );
      await sleep(5000);
      await this.adapter.runCommand(
        sshClient,
        "DEBIAN_FRONTEND=noninteractive apt-get install git wget unzip curl alsa-utils jq lvm2 -qy",
        opts()
      );
      log("info", "System update and dependency installation completed successfully");

      log("info", "Installing yq...");
      await this.adapter.runCommand(
        sshClient,
        "curl -L https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64 -o /usr/bin/yq && chmod +x /usr/bin/yq",
        opts()
      );
      log("info", "yq installation completed successfully");
    } catch (e) {
      log("error", `Error during system update and dependency installation: ${String(e)}`);
      throw new ApplicationError({
        statusCode: HTTP_500,
        errorCode: "K3S_010",
        payload: {
          error: "Dependency Installation Failed",
          message: `Error during system update and dependency installation: ${String(e)}`,
        },
      });
    }
  }

  async installCalicoCni(sshClient: SSHClient, taskId: string, onLog?: (line: string) => void): Promise<void> {
    const opts = () => runOpts(taskId, onLog);
    try {
      log("info", "Installing Calico CNI...");
      const commands = [
        "curl -O https://raw.githubusercontent.com/projectcalico/calico/v3.30.3/manifests/calico.yaml",
        `yq eval -i '(select(.kind=="DaemonSet" and .metadata.name=="calico-node").spec.template.spec.containers[] | select(.name=="calico-node").env[] | select(.name=="CALICO_IPV4POOL_VXLAN").value) = "Always"' calico.yaml`,
        `yq eval -i '(select(.kind=="DaemonSet" and .metadata.name=="calico-node").spec.template.spec.containers[] | select(.name=="calico-node").env[] | select(.name=="CALICO_IPV4POOL_IPIP").value) = "Never"' calico.yaml`,
        `yq eval-all '(select(.kind == "DaemonSet" and .metadata.name == "calico-node").spec.template.spec.containers[] | select(.name == "calico-node").env) += [{"name":"IP_AUTODETECTION_METHOD","value":"kubernetes-internal-ip"}, {"name":"FELIX_WIREGUARDENABLED","value":"false"}]' -i calico.yaml`,
        `yq eval -i '(select(.kind=="DaemonSet" and .metadata.name=="calico-node").spec.template.spec.containers[] | select(.name=="calico-node").readinessProbe.exec.command) = ["/bin/calico-node","-felix-ready"]' calico.yaml`,
        `kubectl apply -f calico.yaml`,
      ];
      await sleep(5000);
      for (const cmd of commands) {
        await this.adapter.runCommand(sshClient, cmd, opts());
      }
      log("info", "Calico CNI installation completed successfully");
    } catch (e) {
      if (e instanceof ApplicationError) throw e;
      this.handleUnexpectedError(e, "Calico CNI installation");
    }
  }

  /** Helm version to install (e.g. v3.11.0). Default from env HELM_VERSION. */
  private static readonly DEFAULT_HELM_VERSION = "v3.11.0";

  /**
   * Install Helm on the control node. Uses wget + tar + install to /usr/local/bin.
   * Run after the cluster is up (kubectl available) so future helm installs can target it.
   */
  async installHelm(
    sshClient: SSHClient,
    taskId: string,
    onLog?: (line: string) => void
  ): Promise<void> {
    const opts = () => runOpts(taskId, onLog);
    const helmVersion = process.env.HELM_VERSION ?? K3sService.DEFAULT_HELM_VERSION;
    try {
      log("info", "Installing Helm...");
      const commands = [
        `wget https://get.helm.sh/helm-${helmVersion}-linux-amd64.tar.gz`,
        `tar -zxvf helm-${helmVersion}-linux-amd64.tar.gz`,
        "sudo install linux-amd64/helm /usr/local/bin/helm",
        `rm -rf linux-amd64 helm-${helmVersion}-linux-amd64.tar.gz`,
      ];
      for (const cmd of commands) {
        await sleep(2000);
        await this.adapter.runCommand(sshClient, cmd, opts());
      }
      log("info", "Helm installation completed successfully.");
    } catch (e) {
      if (e instanceof ApplicationError) throw e;
      this.handleUnexpectedError(e, "Helm installation");
    }
  }

  /**
   * Set up Helm repositories for Akash (mainnet or dev). Adds akash/akash-dev repo and runs helm repo update.
   * @param chainId - "akashnet-2" for mainnet (repo "akash"), otherwise use "akash-dev" repo.
   */
  async setupHelmRepositories(
    sshClient: SSHClient,
    taskId: string,
    onLog?: (line: string) => void,
    chainId?: string
  ): Promise<void> {
    const opts = () => runOpts(taskId, onLog);
    const chain = chainId ?? process.env.CHAIN_ID ?? "akashnet-2";
    const repoName = chain === "akashnet-2" ? "akash" : "akash-dev";
    const repoUrl =
      repoName === "akash"
        ? "https://akash-network.github.io/helm-charts"
        : "https://akash-network.github.io/helm-charts/dev";
    try {
      log("info", "Setting up Helm repositories...");
      const commands: string[] = [
        `helm repo remove ${repoName} 2>/dev/null || true`,
        `helm repo add ${repoName} ${repoUrl}`,
      ];
      if (repoName === "akash-dev") {
        commands.push("helm search repo akash-dev --devel");
      }
      commands.push("helm repo update");
      for (const cmd of commands) {
        await sleep(2000);
        await this.adapter.runCommand(sshClient, cmd, opts());
      }
      log("info", "Helm and Akash repository setup completed.");
    } catch (e) {
      if (e instanceof ApplicationError) throw e;
      this.handleUnexpectedError(e, "Helm repository setup");
    }
  }

  async installAkashServices(
    sshClient: SSHClient,
    taskId: string,
    onLog?: (line: string) => void,
    chainId?: string
  ): Promise<void> {
    const opts = () => runOpts(taskId, onLog);
    const chain = chainId ?? DEFAULT_CHAIN_ID;
    const repoPrefix = chain === "akashnet-2" ? "akash" : "akash-dev";
    const develFlag = chain === "akashnet-2" ? "" : " --devel";
    const namespace = "-n akash-services";
    const versionTag = `--set image.tag=${DEFAULT_PROVIDER_SERVICES_VERSION}`;
    try {
      log("info", "Installing Akash services...");
      const commands: string[] = [
        `helm install akash-hostname-operator ${repoPrefix}/akash-hostname-operator ${namespace} ${versionTag}${develFlag}`,
        `helm install inventory-operator ${repoPrefix}/akash-inventory-operator ${namespace} ${versionTag}${develFlag}`,
      ];
      if (chain === "akashnet-2") {
        const nodeVersionTag = `--set image.tag=${DEFAULT_AKASH_VERSION}`;
        commands.push(`helm install akash-node akash/akash-node ${namespace} ${nodeVersionTag}`);
      }
      for (const cmd of commands) {
        await sleep(2000);
        await this.adapter.runCommand(sshClient, cmd, opts());
      }
      log("info", "Akash services installed.");
    } catch (e) {
      if (e instanceof ApplicationError) throw e;
      this.handleUnexpectedError(e, "Akash services installation");
    }
  }

  /** Writes ~/provider/provider.yaml. Key is read from node via cat ~/key.pem | base64. */
  async prepareProviderConfig(
    sshClient: SSHClient,
    taskId: string,
    onLog: (line: string) => void,
    opts: {
      walletAddress: string;
      keyPassword: string;
      domain: string;
      chainId: string;
      attributes: Array<{ key: string; value: string }>;
      organization: string;
      pricing: {
        cpu?: number | null;
        memory?: number | null;
        storage?: number | null;
        gpu?: number | null;
        persistentStorage?: number | null;
        ipScalePrice?: number | null;
        endpointBidPrice?: number | null;
      };
      email: string | null;
    }
  ): Promise<void> {
    const runOptsHere = () => runOpts(taskId, onLog);
    try {
      log("info", "Preparing provider configuration...");
      await sleep(2000);
      const { stdout: keyB64 } = await this.adapter.runCommand(
        sshClient,
        "cat ~/key.pem 2>/dev/null | openssl base64 -A || true",
        runOptsHere()
      );
      const keyContent = keyB64.trim() || "";
      if (!keyContent) {
        throw new ApplicationError({
          statusCode: HTTP_500,
          errorCode: "K3S_003",
          payload: {
            error: "Key Retrieval Failed",
            message: "~/key.pem not found or empty. Import wallet before building provider.",
          },
        });
      }
      const nodeUrl =
        opts.chainId === "akashnet-2" ? "http://akash-node-1:26657" : "https://rpc.sandbox-2.aksh.pw:443";
      const keySecretB64 = Buffer.from(opts.keyPassword, "utf8").toString("base64");
      const attrsYaml = opts.attributes.map((a) => `  - key: ${a.key}\n    value: ${a.value}`).join("\n");
      const p = opts.pricing;
      const configContent = `mkdir -p ~/provider && cat > ~/provider/provider.yaml << 'PROVEOF'
---
from: "${opts.walletAddress}"
key: "${keyContent}"
keysecret: "${keySecretB64}"
domain: "${opts.domain}"
node: "${nodeUrl}"
withdrawalperiod: 12h
chainid: "${opts.chainId}"
organization: "${opts.organization}"
email: "${opts.email ?? ""}"
attributes:
${attrsYaml}

price_target_cpu: ${p.cpu ?? 0}
price_target_memory: ${p.memory ?? 0}
price_target_hd_ephemeral: ${p.storage ?? 0}
price_target_gpu_mappings: '*=${p.gpu ?? 0}'
price_target_endpoint: ${p.endpointBidPrice ?? 0}
price_target_hd_pers_hdd: ${p.persistentStorage ?? 0}
price_target_hd_pers_nvme: ${p.persistentStorage ?? 0}
price_target_hd_pers_ssd: ${p.persistentStorage ?? 0}
price_target_ip: ${p.ipScalePrice ?? 0}
PROVEOF
`;
      await this.adapter.runCommand(sshClient, configContent, runOptsHere());
      log("info", "Provider configuration prepared.");
    } catch (e) {
      if (e instanceof ApplicationError) throw e;
      this.handleUnexpectedError(e, "provider configuration");
    }
  }

  async installAkashCrds(
    sshClient: SSHClient,
    taskId: string,
    onLog?: (line: string) => void
  ): Promise<void> {
    const opts = () => runOpts(taskId, onLog);
    try {
      log("info", "Installing CRDs for Akash provider...");
      await sleep(5000);
      await this.adapter.runCommand(
        sshClient,
        `kubectl apply -f https://raw.githubusercontent.com/akash-network/provider/v${DEFAULT_PROVIDER_SERVICES_VERSION}/pkg/apis/akash.network/crd.yaml`,
        opts()
      );
      log("info", "Akash provider CRDs installed.");
    } catch (e) {
      if (e instanceof ApplicationError) throw e;
      this.handleUnexpectedError(e, "Akash CRDs installation");
    }
  }

  async installAkashProviderService(
    sshClient: SSHClient,
    taskId: string,
    onLog?: (line: string) => void,
    chainId?: string
  ): Promise<void> {
    const opts = () => runOpts(taskId, onLog);
    const chain = chainId ?? DEFAULT_CHAIN_ID;
    const helmRepo = chain === "akashnet-2" ? "akash" : "akash-dev";
    const develFlag = chain === "akashnet-2" ? "" : "--devel";
    try {
      log("info", "Installing Akash provider...");
      await sleep(5000);
      let pricingScriptB64: string | null = null;
      const { stdout: testOut } = await this.adapter.runCommand(
        sshClient,
        "test -f ~/provider/price_script_generic.sh && echo exists || echo not",
        opts()
      );
      if (testOut.includes("exists")) {
        const { stdout: script } = await this.adapter.runCommand(
          sshClient,
          "cat ~/provider/price_script_generic.sh",
          opts()
        );
        pricingScriptB64 = Buffer.from(script, "utf8").toString("base64");
      } else if (PROVIDER_PRICE_SCRIPT_URL) {
        log("info", `Downloading pricing script from ${PROVIDER_PRICE_SCRIPT_URL}`);
        await this.adapter.runCommand(
          sshClient,
          `wget -q "${PROVIDER_PRICE_SCRIPT_URL}" -O ~/provider/price_script_generic.sh`,
          opts()
        );
        const { stdout: script } = await this.adapter.runCommand(
          sshClient,
          "cat ~/provider/price_script_generic.sh",
          opts()
        );
        pricingScriptB64 = Buffer.from(script, "utf8").toString("base64");
      }
      let installCmd = `helm install akash-provider ${helmRepo}/provider -n akash-services -f ~/provider/provider.yaml --set image.tag=${DEFAULT_PROVIDER_SERVICES_VERSION} ${develFlag}`.trim();
      if (pricingScriptB64) {
        installCmd += ` --set bidpricescript='${pricingScriptB64}'`;
      }
      await this.adapter.runCommand(sshClient, installCmd, opts());
      log("info", "Akash provider installation completed.");
    } catch (e) {
      if (e instanceof ApplicationError) throw e;
      this.handleUnexpectedError(e, "Akash provider installation");
    }
  }

  async installNginxIngress(
    sshClient: SSHClient,
    taskId: string,
    onLog?: (line: string) => void
  ): Promise<void> {
    const opts = () => runOpts(taskId, onLog);
    const ingressConfig = `
cat > ~/ingress-nginx-custom.yaml << 'INGEOF'
controller:
  service:
    type: ClusterIP
  ingressClassResource:
    name: "akash-ingress-class"
  kind: DaemonSet
  hostPort:
    enabled: true
  admissionWebhooks:
    port: 7443
  config:
    allow-snippet-annotations: false
    compute-full-forwarded-for: true
    proxy-buffer-size: "16k"
  metrics:
    enabled: true
  extraArgs:
    enable-ssl-passthrough: true
tcp:
  "8443": "akash-services/akash-provider:8443"
  "8444": "akash-services/akash-provider:8444"
INGEOF
`;
    try {
      log("info", "Installing NGINX Ingress Controller...");
      await sleep(2000);
      await this.adapter.runCommand(sshClient, ingressConfig, opts());
      const commands = [
        "helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx",
        `helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx --version ${DEFAULT_INGRESS_NGINX_VERSION} --namespace ingress-nginx --create-namespace -f ~/ingress-nginx-custom.yaml --set controller.admissionWebhooks.enabled=false`,
        "kubectl label ns ingress-nginx app.kubernetes.io/name=ingress-nginx app.kubernetes.io/instance=ingress-nginx --overwrite",
        "kubectl label ingressclass akash-ingress-class akash.network=true --overwrite",
      ];
      for (const cmd of commands) {
        await sleep(2000);
        await this.adapter.runCommand(sshClient, cmd, opts());
      }
      log("info", "NGINX Ingress Controller installation completed.");
    } catch (e) {
      if (e instanceof ApplicationError) throw e;
      this.handleUnexpectedError(e, "NGINX Ingress installation");
    }
  }

  /** Wait for akash-node pod Running; if mainnet and AKASH_NODE_STATUS_CHECK set, wait for sync. No-op for sandbox. */
  async checkAkashNodeReadiness(
    sshClient: SSHClient,
    taskId: string,
    onLog?: (line: string) => void,
    chainId?: string
  ): Promise<void> {
    const opts = () => runOpts(taskId, onLog);
    const chain = chainId ?? DEFAULT_CHAIN_ID;
    if (chain !== "akashnet-2") {
      log("info", "Akash node readiness check skipped (sandbox has no akash-node)");
      return;
    }
    const podTimeoutMs = 30 * 60 * 1000;
    const syncTimeoutMs = 100 * 60 * 1000;
    const checkIntervalMs = 10 * 1000;
    try {
      log("info", "Checking Akash node readiness");
      await sleep(5000);
      const start = Date.now();
      while (Date.now() - start < podTimeoutMs) {
        const { stdout } = await this.adapter.runCommand(
          sshClient,
          "kubectl get pod akash-node-1-0 -n akash-services -o json 2>/dev/null | jq -rc '.status.phase // empty'",
          opts()
        );
        const phase = stdout.trim();
        if (phase === "Running") {
          log("info", "Akash node pod is running, proceeding to sync check");
          break;
        }
        await sleep(checkIntervalMs);
      }
      const { stdout: phaseAgain } = await this.adapter.runCommand(
        sshClient,
        "kubectl get pod akash-node-1-0 -n akash-services -o json 2>/dev/null | jq -rc '.status.phase // empty'",
        opts()
      );
      if (phaseAgain.trim() !== "Running") {
        throw new ApplicationError({
          statusCode: HTTP_500,
          errorCode: "PROVIDER_006",
          payload: {
            error: "Akash Node Not Ready",
            message: `Akash node pod did not become ready within ${podTimeoutMs / 1000} seconds`,
          },
        });
      }
      if (chain !== "akashnet-2" || !AKASH_NODE_STATUS_CHECK) {
        log("info", "Akash node readiness check complete (sync check skipped)");
        return;
      }
      const syncStart = Date.now();
      while (Date.now() - syncStart < syncTimeoutMs) {
        const { stdout: statusStr } = await this.adapter.runCommand(
          sshClient,
          "kubectl exec akash-node-1-0 -n akash-services -c akash-node -- akash status 2>/dev/null || echo '{}'",
          opts()
        );
        let nodeStatus: { sync_info?: { catching_up?: boolean; latest_block_height?: string } } = {};
        try {
          nodeStatus = JSON.parse(statusStr) as typeof nodeStatus;
        } catch {
          await sleep(checkIntervalMs);
          continue;
        }
        const res = await fetch(`${AKASH_NODE_STATUS_CHECK.replace(/\/$/, "")}/status`, { signal: AbortSignal.timeout(10000) }).catch(
          () => null
        );
        if (!res?.ok) {
          await sleep(checkIntervalMs);
          continue;
        }
        const networkStatus = (await res.json()) as { result?: { sync_info?: { latest_block_height?: string } } };
        const nodeHeight = parseInt(String(nodeStatus.sync_info?.latest_block_height ?? "0"), 10);
        const networkHeight = parseInt(String(networkStatus.result?.sync_info?.latest_block_height ?? "0"), 10);
        if (nodeStatus.sync_info?.catching_up) {
          await sleep(checkIntervalMs);
          continue;
        }
        if (networkHeight - nodeHeight <= 5) {
          log("info", `Node is synced. Height: ${nodeHeight}, Network height: ${networkHeight}`);
          await sleep(20000);
          await this.adapter.runCommand(
            sshClient,
            "kubectl rollout restart deployment operator-inventory -n akash-services",
            opts()
          );
          return;
        }
        await sleep(checkIntervalMs);
      }
      throw new ApplicationError({
        statusCode: HTTP_500,
        errorCode: "PROVIDER_006",
        payload: {
          error: "Akash Node Not Synced",
          message: `Node did not sync within ${syncTimeoutMs / 1000} seconds`,
        },
      });
    } catch (e) {
      if (e instanceof ApplicationError) throw e;
      this.handleUnexpectedError(e, "Akash node readiness check");
    }
  }

  async updateKubeconfig(
    sshClient: SSHClient,
    externalIp: string,
    taskId: string,
    onLog?: (line: string) => void
  ): Promise<void> {
    const opts = () => runOpts(taskId, onLog);
    try {
      log("info", "Updating kubeconfig file to use internal IP address...");
      const kubeconfigPath = K3S_KUBECONFIG_PATH;

      const { stdout: internalIpOut } = await this.adapter.runCommand(
        sshClient,
        K3sService.INTERNAL_IP_CMD,
        opts()
      );
      const internalIp = internalIpOut.trim();

      await sleep(5000);
      const kubeconfigEnv = `KUBECONFIG=${kubeconfigPath}`;
      const { stdout: caDataOut } = await this.adapter.runCommand(
        sshClient,
        `${kubeconfigEnv} kubectl config view --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}'`,
        opts()
      );
      const caData = caDataOut.trim();

      const { stdout: clientCertOut } = await this.adapter.runCommand(
        sshClient,
        `${kubeconfigEnv} kubectl config view --raw -o jsonpath='{.users[0].user.client-certificate-data}'`,
        opts()
      );
      const clientCertData = clientCertOut.trim();

      const { stdout: clientKeyOut } = await this.adapter.runCommand(
        sshClient,
        `${kubeconfigEnv} kubectl config view --raw -o jsonpath='{.users[0].user.client-key-data}'`,
        opts()
      );
      const clientKeyData = clientKeyOut.trim();

      const newKubeconfig = `apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: ${caData}
    server: https://${internalIp}:6443
  name: k3s-cluster
contexts:
- context:
    cluster: k3s-cluster
    user: default
  name: default
current-context: default
kind: Config
preferences: {}
users:
- name: default
  user:
    client-certificate-data: ${clientCertData}
    client-key-data: ${clientKeyData}
`;

      const command = `sudo tee ${kubeconfigPath} > /dev/null << EOL\n${newKubeconfig}\nEOL`;
      await this.adapter.runCommand(sshClient, command, opts());

      await this.adapter.runCommand(sshClient, "mkdir -p ~/.kube", opts());
      await this.adapter.runCommand(sshClient, "rm -f ~/.kube/config", opts());
      await sleep(5000);
      await this.adapter.runCommand(
        sshClient,
        `sudo cp ${kubeconfigPath} ~/.kube/config`,
        opts()
      );
      await this.adapter.runCommand(sshClient, "chmod 600 ~/.kube/config", opts());
      await this.adapter.runCommand(
        sshClient,
        "sudo chown $(id -u):$(id -g) ~/.kube/config",
        opts()
      );
      await this.adapter.runCommand(sshClient, "chmod 644 ~/.kube/config", opts());

      log("info", "Copied k3s.yaml to ~/.kube/config with correct permissions.");
      log("info", "kubeconfig file updated to use internal IP address.");
    } catch (e) {
      log("error", `Error updating kubeconfig: ${String(e)}`);
      throw new ApplicationError({
        statusCode: HTTP_500,
        errorCode: "K3S_011",
        payload: {
          error: "Kubeconfig Update Failed",
          message: `Error updating kubeconfig: ${String(e)}`,
        },
      });
    }
  }

  async joinControlNode(
    controlSshClient: SSHClient,
    nodeInput: WorkerNodeInput,
    nodeName: string,
    taskId: string,
    onLog?: (line: string) => void
  ): Promise<JoinNodeResponse> {
    const opts = () => runOpts(taskId, onLog);
    log("info", `Starting K3s installation on control node ${nodeInput.hostname}`);
    try {
      const { stdout: token } = await this.adapter.runCommand(
        controlSshClient,
        "sudo cat /var/lib/rancher/k3s/server/node-token",
        opts()
      );
      const { stdout: masterIpOut } = await this.adapter.runCommand(
        controlSshClient,
        K3sService.INTERNAL_IP_CMD,
        opts()
      );
      const masterIp = masterIpOut.trim();

      const workerClient = await this.adapter.connectToWorkerNode(controlSshClient, nodeInput);
      try {
        const { stdout: internalIpOut } = await this.adapter.runCommand(
          workerClient,
          K3sService.INTERNAL_IP_CMD,
          opts()
        );
        const internalIp = internalIpOut.trim();

        let installExec = `--disable=traefik --flannel-backend=none --disable-network-policy --node-ip=${internalIp} --node-name ${nodeName} --kube-scheduler-arg=config=/var/lib/rancher/k3s/server/etc/scheduler-config.yaml`;
        if (nodeInput.hostname) installExec += ` --tls-san=${nodeInput.hostname}`;

        const installCommand = `curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server ${installExec}" K3S_URL="https://${masterIp}:6443" K3S_TOKEN="${token.trim()}" sh -`;

        await this.adapter.runCommand(
          workerClient,
          "mkdir -p /var/lib/rancher/k3s/server/etc",
          opts()
        );
        await this.adapter.runCommand(workerClient, SCHEDULER_CONFIG, opts());

        const { stdout, stderr } = await this.adapter.runCommand(workerClient, installCommand, opts());

        log("info", `Control-plane node ${nodeInput.hostname} added to the cluster.`);
        return {
          message: "Control-plane node added to the cluster successfully",
          stdout,
          stderr,
        };
      } finally {
        await this.adapter.closeClient(workerClient);
      }
    } catch (e) {
      if (e instanceof ApplicationError) throw e;
      this.handleUnexpectedError(e, "K3s installation on control");
    }
  }

  async joinWorkerNode(
    controlSshClient: SSHClient,
    nodeInput: WorkerNodeInput,
    nodeName: string,
    taskId: string,
    onLog?: (line: string) => void
  ): Promise<JoinNodeResponse> {
    const opts = () => runOpts(taskId, onLog);
    log("info", `Starting K3s installation on worker node ${nodeInput.hostname}`);
    try {
      const { stdout: token } = await this.adapter.runCommand(
        controlSshClient,
        "sudo cat /var/lib/rancher/k3s/server/node-token",
        opts()
      );
      const { stdout: masterIpOut } = await this.adapter.runCommand(
        controlSshClient,
        K3sService.INTERNAL_IP_CMD,
        opts()
      );
      const masterIp = masterIpOut.trim();

      const workerClient = await this.adapter.connectToWorkerNode(controlSshClient, nodeInput);
      try {
        const installCommand = `curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC='--node-name ${nodeName}' K3S_URL=https://${masterIp}:6443 K3S_TOKEN=${token.trim()} sh -`;
        const { stdout, stderr } = await this.adapter.runCommand(workerClient, installCommand, opts());
        log("info", `K3s installation completed successfully on worker node ${nodeInput.hostname}`);
        return {
          message: "K3s installation completed successfully",
          stdout,
          stderr,
        };
      } finally {
        await this.adapter.closeClient(workerClient);
      }
    } catch (e) {
      if (e instanceof ApplicationError) throw e;
      this.handleUnexpectedError(e, "K3s installation on worker");
    }
  }

  async removeNode(
    sshClient: SSHClient,
    nodeInternalIp: string,
    nodeName: string,
    nodeType: string,
    taskId: string
  ): Promise<RemoveNodeResponse> {
    log("info", `Removing ${nodeType} node ${nodeName} from the cluster`);
    try {
      const workerClient = await this.getWorkerSshClient(sshClient, nodeInternalIp);
      try {
        await this.adapter.runCommand(
          sshClient,
          `kubectl drain ${nodeName} --ignore-daemonsets --delete-emptydir-data --force`,
          { taskId }
        );
        await this.adapter.runCommand(sshClient, `kubectl delete node ${nodeName}`, { taskId });

        const uninstallCommand =
          nodeType === "control_plane_node"
            ? "/usr/local/bin/k3s-uninstall.sh"
            : "/usr/local/bin/k3s-agent-uninstall.sh";
        await this.adapter.runCommand(workerClient, uninstallCommand, { taskId });

        log("info", `Worker node ${nodeName} uninstalled from the cluster`);
        return { message: "Worker node removed from the cluster successfully" };
      } finally {
        await this.adapter.closeClient(workerClient);
      }
    } catch (e) {
      if (e instanceof ApplicationError) throw e;
      this.handleUnexpectedError(e, "K3s installation on worker");
    }
  }

  async installGpuDriversAndToolkit(
    sshClient: SSHClient,
    controlInput: ControlMachineInput,
    nodeType: string,
    gpuName: string,
    taskId: string,
    onLog?: (line: string) => void
  ): Promise<GpuInstallResponse> {
    log(
      "info",
      `Starting GPU host preparation, driver, and toolkit installation on ${controlInput.hostname}`
    );
    try {
      const conn =
        nodeType === "worker_node"
          ? await this.adapter.connectToWorkerNode(sshClient, controlInput as unknown as WorkerNodeInput)
          : sshClient;
      await this.updateSystem(conn, controlInput, taskId);
      await this.installNvidiaDrivers(conn, controlInput, gpuName, taskId);
      await this.installNvidiaContainerRuntime(conn, controlInput, taskId);
      await this.configureNvidiaRuntime(conn, controlInput, taskId);
      if (nodeType === "worker_node") await this.adapter.closeClient(conn);

      log(
        "info",
        `GPU drivers and toolkit installation completed successfully on ${controlInput.hostname}`
      );
      return { message: "GPU drivers and toolkit installation completed successfully" };
    } catch (e) {
      if (e instanceof ApplicationError) throw e;
      this.handleUnexpectedError(e, "GPU installation");
    }
  }

  private async updateSystem(
    sshClient: SSHClient,
    controlInput: ControlMachineInput,
    taskId: string
  ): Promise<void> {
    log("info", `Updating system on ${controlInput.hostname}`);
    await sleep(5000);
    await this.adapter.runCommand(sshClient, "apt update", { taskId });
    await this.adapter.runCommand(
      sshClient,
      'DEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" dist-upgrade',
      { taskId }
    );
    await this.adapter.runCommand(sshClient, "apt-get autoremove -y", { taskId });
  }

  private async getUbuntuVersion(sshClient: SSHClient, taskId: string): Promise<string> {
    const { stdout } = await this.adapter.runCommand(
      sshClient,
      "lsb_release -rs | grep -oE '[0-9]+\\.[0-9]+'",
      { taskId }
    );
    return stdout.trim();
  }

  private async installNvidiaDrivers(
    sshClient: SSHClient,
    controlInput: ControlMachineInput,
    gpuName: string,
    taskId: string
  ): Promise<void> {
    log("info", `Installing NVIDIA drivers on ${controlInput.hostname}`);
    await sleep(5000);
    const ubuntuVersion = await this.getUbuntuVersion(sshClient, taskId);
    const ubuntuCodename = `ubuntu${ubuntuVersion.replace(".", "")}`;

    const nvidia570Commands = [
      `wget https://developer.download.nvidia.com/compute/cuda/repos/${ubuntuCodename}/x86_64/3bf863cc.pub`,
      "apt-key add 3bf863cc.pub",
      `echo 'deb https://developer.download.nvidia.com/compute/cuda/repos/${ubuntuCodename}/x86_64/ /' | tee /etc/apt/sources.list.d/nvidia-official-repo.list`,
      "apt update",
      "apt-get install build-essential dkms linux-headers-$(uname -r) -y",
      "apt-get install nvidia-driver-570 -y",
    ];

    const nvidia5090Commands = [
      "apt install linux-headers-$(uname -r) -y",
      `wget https://developer.download.nvidia.com/compute/cuda/repos/${ubuntuCodename}/x86_64/cuda-keyring_1.1-1_all.deb`,
      "dpkg -i cuda-keyring_1.1-1_all.deb",
      "apt update",
      "apt install nvidia-open -y",
      "nvidia-smi",
    ];

    const commands = gpuName === "rtx5090" ? nvidia5090Commands : nvidia570Commands;
    for (const cmd of commands) {
      await this.adapter.runCommand(sshClient, cmd, { taskId });
    }
    log("info", `NVIDIA drivers installed successfully on ${controlInput.hostname}`);
  }

  private async installNvidiaContainerRuntime(
    sshClient: SSHClient,
    _controlInput: ControlMachineInput,
    taskId: string
  ): Promise<void> {
    log("info", "Installing NVIDIA container runtime");
    await sleep(5000);
    const commands = [
      "curl -s -L https://nvidia.github.io/libnvidia-container/gpgkey | apt-key add -",
      "curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/libnvidia-container.list | tee /etc/apt/sources.list.d/libnvidia-container.list",
      "apt-get update",
      "DEBIAN_FRONTEND=noninteractive apt-get install -y nvidia-container-toolkit nvidia-container-runtime",
    ];
    for (const cmd of commands) {
      await this.adapter.runCommand(sshClient, cmd, { taskId });
    }
  }

  async updateCorednsConfig(sshClient: SSHClient, taskId: string, onLog?: (line: string) => void): Promise<void> {
    const opts = () => runOpts(taskId, onLog);
    log("info", "Updating CoreDNS configuration");
    try {
      await sleep(5000);
      await this.adapter.runCommand(
        sshClient,
        "while ! kubectl -n kube-system get cm coredns >/dev/null 2>&1; do echo waiting for the coredns configmap resource ...; sleep 2; done",
        opts()
      );
      const patchCommand = `kubectl patch configmap coredns -n kube-system --type merge -p '{"data":{"Corefile":".:53 {\\n        errors\\n        health\\n        ready\\n        kubernetes cluster.local in-addr.arpa ip6.arpa {\\n          pods insecure\\n          fallthrough in-addr.arpa ip6.arpa\\n        }\\n        hosts /etc/coredns/NodeHosts {\\n          ttl 60\\n          reload 15s\\n          fallthrough\\n        }\\n        prometheus :9153\\n        forward . 8.8.8.8 1.1.1.1\\n        cache 30\\n        loop\\n        reload\\n        loadbalance\\n        import /etc/coredns/custom/*.override\\n    }\\n    import /etc/coredns/custom/*.server"}}'`;
      await this.adapter.runCommand(sshClient, patchCommand, opts());
      log("info", "CoreDNS configuration updated successfully");
    } catch (e) {
      log("error", `Error updating CoreDNS configuration: ${String(e)}`);
      throw new ApplicationError({
        statusCode: HTTP_500,
        errorCode: "K3S_012",
        payload: {
          error: "CoreDNS Update Failed",
          message: `Error updating CoreDNS configuration: ${String(e)}`,
        },
      });
    }
  }

  async createAndLabelNamespaces(sshClient: SSHClient, taskId: string, onLog?: (line: string) => void): Promise<void> {
    const opts = () => runOpts(taskId, onLog);
    log("info", "Creating and labeling Kubernetes namespaces");
    try {
      const namespaces = ["akash-services", "lease"];
      for (const ns of namespaces) {
        await this.adapter.runCommand(
          sshClient,
          `kubectl get ns ${ns} > /dev/null 2>&1 || kubectl create ns ${ns}`,
          opts()
        );
      }
      const labelCommands = [
        "kubectl label ns akash-services akash.network/name=akash-services akash.network=true --overwrite",
        "kubectl label ns lease akash.network=true --overwrite",
      ];
      for (const cmd of labelCommands) {
        await this.adapter.runCommand(sshClient, cmd, opts());
      }
      log("info", "Kubernetes namespaces created and labeled successfully");
    } catch (e) {
      log("error", `Error creating and labeling Kubernetes namespaces: ${String(e)}`);
      throw new ApplicationError({
        statusCode: HTTP_500,
        errorCode: "K3S_013",
        payload: {
          error: "Namespace Creation Failed",
          message: `Error creating and labeling Kubernetes namespaces: ${String(e)}`,
        },
      });
    }
  }

  private async configureNvidiaRuntime(
    sshClient: SSHClient,
    controlInput: ControlMachineInput,
    taskId: string
  ): Promise<void> {
    log("info", `Configuring NVIDIA runtime on ${controlInput.hostname}`);
    const configFile = "/etc/nvidia-container-runtime/config.toml";
    const { stdout } = await this.adapter.runCommand(
      sshClient,
      `sh -c '[ -f ${configFile} ] && echo exists || echo not found'`,
      { taskId }
    );
    if (stdout.includes("exists")) {
      await this.adapter.runCommand(
        sshClient,
        `sed -i 's/#accept-nvidia-visible-devices-as-volume-mounts = false/accept-nvidia-visible-devices-as-volume-mounts = true/' ${configFile}`,
        { taskId }
      );
      await this.adapter.runCommand(
        sshClient,
        `sed -i 's/#accept-nvidia-visible-devices-envvar-when-unprivileged = true/accept-nvidia-visible-devices-envvar-when-unprivileged = false/' ${configFile}`,
        { taskId }
      );
    } else {
      log("warn", `NVIDIA runtime configuration file not found on ${controlInput.hostname}`);
    }
  }

  async rebootNode(
    sshClient: SSHClient,
    controlInput: ControlMachineInput,
    nodeType: string,
    taskId: string,
    onLog?: (line: string) => void
  ): Promise<void> {
    const opts = () => runOpts(taskId, onLog);
    log("info", `Initiating reboot for node ${controlInput.hostname}`);
    const conn =
      nodeType === "worker_node"
        ? await this.adapter.connectToWorkerNode(sshClient, controlInput as unknown as WorkerNodeInput)
        : sshClient;
    try {
      await this.adapter.runCommand(conn, "reboot", opts());
      if (nodeType === "worker_node") await this.adapter.closeClient(conn);
      await sleep(60_000);

      const maxAttempts = 30;
      const retryIntervalMs = 10_000;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const next =
            nodeType === "worker_node"
              ? await this.adapter.connectToWorkerNode(sshClient, controlInput as unknown as WorkerNodeInput)
              : await this.adapter.getClient(controlInput);
          try {
            await this.adapter.runCommand(next, "uptime", opts());
            log("info", `Node ${controlInput.hostname} is back online`);
            return;
          } finally {
            await this.adapter.closeClient(next);
          }
        } catch {
          if (attempt < maxAttempts - 1) {
            log("info", `Waiting for node ${controlInput.hostname} to come back online... (attempt ${attempt + 1}/${maxAttempts})`);
            await sleep(retryIntervalMs);
          } else {
            throw new Error(
              `Node ${controlInput.hostname} did not come back online after reboot`
            );
          }
        }
      }
    } catch (e) {
      log("error", `Error during reboot process for node ${controlInput.hostname}: ${String(e)}`);
      throw new ApplicationError({
        statusCode: HTTP_500,
        errorCode: "K3S_014",
        payload: {
          error: "Reboot Failed",
          message: `Error during reboot process for node ${controlInput.hostname}: ${String(e)}`,
        },
      });
    }
  }

  async listNodes(sshClient: SSHClient): Promise<ListNodesResponse> {
    try {
      log("info", "Listing nodes");
      const command = `kubectl get nodes -o json | jq '{
                    nodes: [.items[] | {
                        name: .metadata.name,
                        status: (
                        (.status.conditions // [] | map(select(.type == "Ready")) | .[0]?.status) // "Unknown"
                        ),
                        roles: (
                        [.metadata.labels | to_entries[]
                            | select(.key | startswith("node-role.kubernetes.io/"))
                            | .key
                            | sub("node-role.kubernetes.io/"; "")
                        ] | join(",")
                        ),
                        age: .metadata.creationTimestamp,
                        version: .status.nodeInfo.kubeletVersion,
                        internalIP: (
                        (.status.addresses[]? | select(.type == "InternalIP") | .address) // "N/A"
                        ),
                        externalIP: (
                        (.status.addresses[]? | select(.type == "ExternalIP") | .address) // "N/A"
                        ),
                        osImage: .status.nodeInfo.osImage,
                        kernelVersion: .status.nodeInfo.kernelVersion,
                        containerRuntime: .status.nodeInfo.containerRuntimeVersion
                    }]}'`;
      const { stdout } = await this.adapter.runCommand(sshClient, command);
      return JSON.parse(stdout) as ListNodesResponse;
    } catch (e) {
      log("error", `Error listing nodes: ${String(e)}`);
      throw new ApplicationError({
        statusCode: HTTP_500,
        errorCode: "K3S_015",
        payload: {
          error: "Node Listing Failed",
          message: `Error listing nodes: ${String(e)}`,
        },
      });
    }
  }

  private async getWorkerSshClient(
    controlSshClient: SSHClient,
    nodeInternalIp: string
  ): Promise<SSHClient> {
    const { stdout: keyContent } = await this.adapter.runCommand(
      controlSshClient,
      K3sService.SSH_KEY_CMD,
      { checkExitStatus: true }
    );
    const workerInput: WorkerNodeInput = {
      hostname: nodeInternalIp,
      username: "root",
      port: 22,
      keyfile: { filename: "keyfile", content: Buffer.from(keyContent, "utf8") },
    };
    return this.adapter.connectToWorkerNode(controlSshClient, workerInput);
  }

  private handleUnexpectedError(e: unknown, operation: string): never {
    log("error", `Unexpected error during ${operation}: ${String(e)}`);
    throw new ApplicationError({
      statusCode: HTTP_500,
      errorCode: "K3S_003",
      payload: {
        error: "Unexpected Error",
        message: `Unexpected error during ${operation}: ${String(e)}`,
      },
    });
  }
}
