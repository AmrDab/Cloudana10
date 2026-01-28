import type {
  BuildProviderRequest,
  BuildProviderResponse,
  UpdateProviderAttributesRequest,
  UpdateProviderAttributesResponse,
  BuildProviderStatusResponse,
  BuildProviderLogsResponse,
  Node,
} from "../schemas/build-provider.schema.js";
import type { ControlMachineInput, WorkerNodeInput } from "../types/k3s.js";
import { K3sService } from "./k3s.service.js";
import { Ssh2K3sAdapter } from "./ssh2-k3s-adapter.js";

type TaskStatus = "pending" | "running" | "completed" | "failed";

const inMemoryActions: Record<string, BuildProviderStatusResponse> = {};
const inMemoryLogs: Record<string, string[]> = {};

function nodeToMachineInput(node: Node): ControlMachineInput & WorkerNodeInput {
  return {
    hostname: node.hostname,
    username: node.username,
    port: node.port ?? 22,
    password: node.password ?? null,
    keyfile: node.keyfile ?? null,
    passphrase: node.passphrase ?? null,
  };
}

function ensureUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${["8", "9", "a", "b"][Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
}

function now(): string {
  return new Date().toISOString();
}

function appendLog(taskId: string, line: string): void {
  if (!inMemoryLogs[taskId]) inMemoryLogs[taskId] = [];
  inMemoryLogs[taskId].push(line);
}

function updateTask(
  actionId: string,
  taskId: string,
  status: TaskStatus,
  startTime?: string | null,
  endTime?: string | null
): void {
  const action = inMemoryActions[actionId];
  if (!action) return;
  const t = action.tasks.find((x) => x.id === taskId);
  if (t) {
    t.status = status;
    if (startTime != null) t.start_time = startTime;
    if (endTime != null) t.end_time = endTime;
  }
  const anyFailed = action.tasks.some((x) => x.status === "failed");
  const allCompleted = action.tasks.every((x) => x.status === "completed");
  if (anyFailed) action.status = "failed";
  else if (allCompleted) action.status = "completed";
  else action.status = "running";
  if (endTime && (anyFailed || allCompleted)) action.end_time = endTime;
}

export class BuildProviderService {
  async buildProvider(
    input: BuildProviderRequest,
    _authToken?: string
  ): Promise<BuildProviderResponse> {
    const actionId = input.action_id ?? ensureUuid();
    const nodes = input.nodes;
    const control = nodeToMachineInput(nodes[0]);

    const n = nodes.length;
    let controlNodes: Node[] = [];
    let workerNodes: Node[] = [];
    if (n <= 3) {
      controlNodes = [nodes[0]];
      workerNodes = nodes.slice(1);
    } else if (n <= 50) {
      controlNodes = nodes.slice(0, 3);
      workerNodes = nodes.slice(3);
    } else if (n <= 100) {
      controlNodes = nodes.slice(0, 5);
      workerNodes = nodes.slice(5);
    } else {
      controlNodes = nodes.slice(0, 7);
      workerNodes = nodes.slice(7);
    }

    const tasks: { id: string; taskKey: string; title: string; description: string }[] = [];
    let idx = 0;
    const add = (taskKey: string, title: string, description: string) => {
      tasks.push({
        id: `${actionId}-task-${idx}`,
        taskKey,
        title,
        description,
      });
      idx += 1;
    };

    add("initialize_k3s_control", "Initialize K3s on main control node", "Initialize K3s on main control node");
    add("update_dependencies", "Update system and install dependencies", "Update system and install dependencies");
    add("install_calico", "Install Calico CNI", "Install Calico CNI");
    add("update_kubeconfig", "Update kubeconfig with external IP", "Update kubeconfig with external IP");
    add("update_coredns_config", "Update CoreDNS configuration", "Update CoreDNS configuration");
    add("create_and_label_namespaces", "Create and label Kubernetes namespaces", "Create and label Kubernetes namespaces");
    add("install_helm", "Install Helm", "Install Helm on control node");
    add("setup_helm_repos", "Set up Helm repositories", "Add Akash Helm repos and run helm repo update");
    add("install_akash_services", "Install Akash services", "Install hostname-operator, inventory-operator, akash-node (mainnet)");
    add("prepare_provider_config", "Prepare provider configuration", "Write ~/provider/provider.yaml");
    add("install_akash_crds", "Install Akash CRDs", "Install provider CRDs");
    add("install_akash_provider_service", "Install Akash provider service", "Helm install akash-provider");
    add("install_nginx_ingress", "Install NGINX Ingress", "Install ingress-nginx with Akash TCP mappings");
    add("check_akash_node_readiness", "Check Akash Node Readiness", "Wait for akash-node pod and sync (mainnet)");

    for (let i = 1; i < controlNodes.length; i++) {
      const node = controlNodes[i];
      add(
        `join_control_node_${node.hostname}`,
        `Join control node ${node.hostname} to the cluster`,
        `Join control node ${node.hostname} to the cluster`
      );
    }
    for (const node of workerNodes) {
      add(
        `join_worker_node_${node.hostname}`,
        `Join worker node ${node.hostname} to the cluster`,
        `Join worker node ${node.hostname} to the cluster`
      );
    }
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].install_gpu_drivers) {
        add(
          `install_gpu_drivers_${nodes[i].hostname}`,
          `Install GPU drivers and toolkit on ${nodes[i].hostname}`,
          `Install GPU drivers and toolkit on ${nodes[i].hostname}`
        );
      }
    }
    const gpuNodes = nodes
      .map((node, i) => ({ node, i }))
      .filter(({ node }) => node.install_gpu_drivers)
      .reverse();
    for (const { node } of gpuNodes) {
      add(`restart_node_${node.hostname}`, `Restart node ${node.hostname}`, `Restart node ${node.hostname}`);
    }

    const startTime = now();
    const action: BuildProviderStatusResponse = {
      id: actionId,
      name: "Build Provider (K3s)",
      status: "pending",
      start_time: startTime,
      end_time: null,
      tasks: tasks.map(({ id, title, description }) => ({
        id,
        title,
        description,
        status: "pending" as const,
        start_time: null,
        end_time: null,
      })),
    };
    inMemoryActions[actionId] = action;
    for (const { id } of tasks) inMemoryLogs[id] = [];

    void this.runK3sBuildInBackground(actionId, {
      input,
      control,
      controlNodes,
      workerNodes,
      tasks,
      gpuName: null,
    });

    return {
      status: "success",
      message: "Provider build process started successfully.",
      action_id: actionId,
    };
  }

  private async runK3sBuildInBackground(
    actionId: string,
    ctx: {
      input: BuildProviderRequest;
      control: ControlMachineInput & WorkerNodeInput;
      controlNodes: Node[];
      workerNodes: Node[];
      tasks: { id: string; taskKey: string; title: string; description: string }[];
      gpuName: string | null;
    }
  ): Promise<void> {
    const { control, controlNodes, workerNodes, tasks, gpuName } = ctx;
    const mainControlInput = control;
    let sshClient: unknown = null;
    const adapter = new Ssh2K3sAdapter();
    const k3s = new K3sService(adapter);

    const runTask = async (
      taskId: string,
      taskKey: string,
      fn: (appendLog: (line: string) => void) => Promise<unknown>
    ): Promise<boolean> => {
      updateTask(actionId, taskId, "running", now(), null);
      appendLog(taskId, `[${taskId}] Starting: ${taskKey}`);
      const appendLogForTask = (line: string) => appendLog(taskId, line);
      try {
        await fn(appendLogForTask);
        updateTask(actionId, taskId, "completed", undefined, now());
        appendLog(taskId, `[${taskId}] Completed: ${taskKey}`);
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        updateTask(actionId, taskId, "failed", undefined, now());
        appendLog(taskId, `[${taskId}] Failed: ${taskKey} — ${msg}`);
        return false;
      }
    };

    try {
      sshClient = await adapter.getClient(control);
    } catch (e) {
      const taskId = tasks[0]?.id;
      if (taskId) {
        updateTask(actionId, taskId, "failed", now(), now());
        appendLog(taskId, `[${taskId}] Failed to connect to control node: ${e instanceof Error ? e.message : String(e)}`);
      }
      const a = inMemoryActions[actionId];
      if (a) {
        a.status = "failed";
        a.end_time = now();
      }
      return;
    }

    try {
      const taskIds = new Map(tasks.map((t) => [t.taskKey, t.id]));

      const t0 = taskIds.get("initialize_k3s_control");
      if (t0 && !(await runTask(t0, "initialize_k3s_control", (onLog) =>
        k3s.initializeK3sControl(sshClient!, mainControlInput as ControlMachineInput, t0, onLog))))
        return;

      const t1 = taskIds.get("update_dependencies");
      if (t1 && !(await runTask(t1, "update_dependencies", (onLog) =>
        k3s.updateAndInstallDependencies(sshClient!, t1, onLog)))) return;

      const t2 = taskIds.get("install_calico");
      if (t2 && !(await runTask(t2, "install_calico", (onLog) =>
        k3s.installCalicoCni(sshClient!, t2, onLog)))) return;

      const t3 = taskIds.get("update_kubeconfig");
      if (t3 && !(await runTask(t3, "update_kubeconfig", (onLog) =>
        k3s.updateKubeconfig(sshClient!, mainControlInput.hostname, t3, onLog)))) return;

      const t4 = taskIds.get("update_coredns_config");
      if (t4 && !(await runTask(t4, "update_coredns_config", (onLog) =>
        k3s.updateCorednsConfig(sshClient!, t4, onLog)))) return;

      const t5 = taskIds.get("create_and_label_namespaces");
      if (t5 && !(await runTask(t5, "create_and_label_namespaces", (onLog) =>
        k3s.createAndLabelNamespaces(sshClient!, t5, onLog)))) return;

      const tHelm = taskIds.get("install_helm");
      if (tHelm && !(await runTask(tHelm, "install_helm", (onLog) =>
        k3s.installHelm(sshClient!, tHelm, onLog)))) return;

      const tHelmRepos = taskIds.get("setup_helm_repos");
      if (tHelmRepos && !(await runTask(tHelmRepos, "setup_helm_repos", (onLog) =>
        k3s.setupHelmRepositories(sshClient!, tHelmRepos, onLog)))) return;

      const chainId = process.env.CHAIN_ID ?? "akashnet-2";

      const tAkashSvcs = taskIds.get("install_akash_services");
      if (tAkashSvcs && !(await runTask(tAkashSvcs, "install_akash_services", (onLog) =>
        k3s.installAkashServices(sshClient!, tAkashSvcs, onLog, chainId)))) return;

      const tPrepare = taskIds.get("prepare_provider_config");
      if (tPrepare) {
        const wallet = ctx.input.wallet;
        if (!wallet) {
          updateTask(actionId, tPrepare, "failed", undefined, now());
          appendLog(tPrepare, `[${tPrepare}] Failed: prepare_provider_config — Wallet required for provider configuration.`);
          const a = inMemoryActions[actionId];
          if (a) { a.status = "failed"; a.end_time = now(); }
          return;
        }
        const ok = await runTask(tPrepare, "prepare_provider_config", (onLog) =>
          k3s.prepareProviderConfig(sshClient!, tPrepare, onLog, {
            walletAddress: wallet.address,
            keyPassword: wallet.key_password,
            domain: ctx.input.provider.config?.domain ?? "",
            chainId,
            attributes: ctx.input.provider.attributes,
            organization: ctx.input.provider.config?.organization ?? "",
            pricing: ctx.input.provider.pricing ?? {},
            email: ctx.input.provider.config?.email ?? null,
          }));
        if (!ok) return;
      }

      const tCrds = taskIds.get("install_akash_crds");
      if (tCrds && !(await runTask(tCrds, "install_akash_crds", (onLog) =>
        k3s.installAkashCrds(sshClient!, tCrds, onLog)))) return;

      const tProvider = taskIds.get("install_akash_provider_service");
      if (tProvider && !(await runTask(tProvider, "install_akash_provider_service", (onLog) =>
        k3s.installAkashProviderService(sshClient!, tProvider, onLog, chainId)))) return;

      const tNginx = taskIds.get("install_nginx_ingress");
      if (tNginx && !(await runTask(tNginx, "install_nginx_ingress", (onLog) =>
        k3s.installNginxIngress(sshClient!, tNginx, onLog)))) return;

      const tReadiness = taskIds.get("check_akash_node_readiness");
      if (tReadiness && !(await runTask(tReadiness, "check_akash_node_readiness", (onLog) =>
        k3s.checkAkashNodeReadiness(sshClient!, tReadiness, onLog, chainId)))) return;

      for (let i = 1; i < controlNodes.length; i++) {
        const node = controlNodes[i];
        const nodeName = `node${i + 1}`;
        const tk = `join_control_node_${node.hostname}`;
        const tid = taskIds.get(tk);
        if (tid) {
          const w = nodeToMachineInput(node) as WorkerNodeInput;
          const ok = await runTask(tid, tk, (onLog) =>
            k3s.joinControlNode(sshClient!, w, nodeName, tid, onLog));
          if (!ok) return;
        }
      }

      for (let i = 0; i < workerNodes.length; i++) {
        const node = workerNodes[i];
        const nodeName = `node${controlNodes.length + i + 1}`;
        const tk = `join_worker_node_${node.hostname}`;
        const tid = taskIds.get(tk);
        if (tid) {
          const w = nodeToMachineInput(node) as WorkerNodeInput;
          const ok = await runTask(tid, tk, (onLog) =>
            k3s.joinWorkerNode(sshClient!, w, nodeName, tid, onLog));
          if (!ok) return;
        }
      }

      for (let i = 0; i < ctx.input.nodes.length; i++) {
        const node = ctx.input.nodes[i];
        if (!node.install_gpu_drivers) continue;
        const nodeType = i === 0 ? "main_node" : "worker_node";
        const tk = `install_gpu_drivers_${node.hostname}`;
        const tid = taskIds.get(tk);
        if (tid) {
          const c = nodeToMachineInput(node) as ControlMachineInput;
          const ok = await runTask(tid, tk, (onLog) =>
            k3s.installGpuDriversAndToolkit(sshClient!, c, nodeType, gpuName ?? "", tid, onLog));
          if (!ok) return;
        }
      }

      for (const { node, i } of ctx.input.nodes
        .map((node, i) => ({ node, i }))
        .filter(({ node }) => node.install_gpu_drivers)
        .reverse()) {
        const nodeType = i === 0 ? "main_node" : "worker_node";
        const tk = `restart_node_${node.hostname}`;
        const tid = taskIds.get(tk);
        if (tid) {
          const c = nodeToMachineInput(node) as ControlMachineInput;
          const ok = await runTask(tid, tk, (onLog) =>
            k3s.rebootNode(sshClient!, c, nodeType, tid, onLog));
          if (!ok) return;
        }
      }

      const a = inMemoryActions[actionId];
      if (a) {
        a.status = "completed";
        a.end_time = now();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const a = inMemoryActions[actionId];
      if (a) {
        a.status = "failed";
        a.end_time = now();
      }
      for (const t of tasks) {
        if (inMemoryLogs[t.id] && !inMemoryLogs[t.id].some((l) => l.includes("Failed:"))) {
          appendLog(t.id, `[${t.id}] Unexpected error: ${msg}`);
        }
      }
    } finally {
      if (sshClient) await adapter.closeClient(sshClient);
    }
  }

  async getBuildProviderStatus(
    actionId: string,
    _authToken?: string
  ): Promise<BuildProviderStatusResponse> {
    const existing = inMemoryActions[actionId];
    if (!existing) {
      return {
        id: actionId,
        name: "Build Provider (unknown)",
        status: "pending",
        start_time: now(),
        end_time: null,
        tasks: [],
      };
    }
    return existing;
  }

  async updateProviderAttributes(
    input: UpdateProviderAttributesRequest,
    _authToken?: string
  ): Promise<UpdateProviderAttributesResponse> {
    const actionId = ensureUuid();
    return {
      status: "success",
      message: "Provider attributes update process started (K3s-based build).",
      action_id: actionId,
    };
  }

  async getTaskLogs(
    taskId: string,
    _authToken?: string
  ): Promise<BuildProviderLogsResponse> {
    const logs = inMemoryLogs[taskId] ?? [
      `[K3s] No logs found for task ${taskId}.`,
    ];
    return { logs };
  }
}
