import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
import { ApplicationError } from "../types/k3s.js";
import { K3sService } from "./k3s.service.js";
import { Ssh2K3sAdapter } from "./ssh2-k3s-adapter.js";
import { loadBuildStatusStore, saveBuildToStore, saveDeviceMappingToStore } from "./build-status-store.js";

type TaskStatus = "pending" | "running" | "completed" | "failed";

const inMemoryActions: Record<string, BuildProviderStatusResponse> = {};
const inMemoryLogs: Record<string, string[]> = {};
/** Persist control node per action_id for provider-node start/stop. */
const controlNodeByActionId: Record<string, Node> = {};
/** Map device_id → action_id so owner can start/stop by device_id after registration. */
const deviceIdToActionId: Record<string, string> = {};

/** Load persisted build status and device_id → action_id from MongoDB; call before serving. */
export async function initBuildProviderStore(): Promise<void> {
  try {
    const stored = await loadBuildStatusStore();
    for (const [id, build] of Object.entries(stored.builds)) inMemoryActions[id] = build;
    Object.assign(deviceIdToActionId, stored.deviceIdToActionId);
  } catch (e) {
    console.warn("[BuildProviderService] initBuildProviderStore failed:", e);
  }
}

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
  if (anyFailed || allCompleted) {
    saveBuildToStore(actionId, action, deviceIdToActionId).catch(() => {});
  }
}

/** Resolve provider-node-server package path (relative to this package). */
function getProviderNodeServerPath(): string | null {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const candidates = [
    resolve(dir, "..", "..", "..", "..", "provider-node-server"),
    resolve(process.cwd(), "provider-node-server"),
    resolve(process.cwd(), "..", "provider-node-server"),
  ];
  for (const p of candidates) {
    if (existsSync(join(p, "package.json"))) return p;
  }
  return null;
}

/** Run npm run build && npm pack in provider-node-server; return tarball buffer or null. */
function createProviderNodeTarball(): Promise<Buffer | null> {
  return new Promise((resolvePromise) => {
    const pkgDir = getProviderNodeServerPath();
    if (!pkgDir) {
      console.warn("[BuildProvider] provider-node-server path not found; skipping tarball.");
      resolvePromise(null);
      return;
    }
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(npm, ["run", "build", "--if-present"], {
      cwd: pkgDir,
      stdio: "pipe",
      shell: process.platform === "win32",
    });
    let stderr = "";
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code !== 0) {
        console.warn("[BuildProvider] npm run build in provider-node-server failed:", stderr);
        resolvePromise(null);
        return;
      }
      const pack = spawn(npm, ["pack"], { cwd: pkgDir, stdio: "pipe", shell: process.platform === "win32" });
      let packOut = "";
      pack.stdout?.on("data", (d) => { packOut += d.toString(); });
      pack.on("close", (packCode) => {
        if (packCode !== 0) {
          resolvePromise(null);
          return;
        }
        const tgzName = packOut.trim().split("\n").pop()?.trim() || "cloudana-provider-node-server-1.0.0.tgz";
        const tgzPath = join(pkgDir, tgzName);
        if (!existsSync(tgzPath)) {
          resolvePromise(null);
          return;
        }
        try {
          resolvePromise(readFileSync(tgzPath));
        } catch {
          resolvePromise(null);
        }
      });
    });
  });
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
    add("configure_firewall", "Configure firewall ports", "Open required ports for provider node (4040) and workloads (30000-32767)");
    add("install_calico", "Install Calico CNI", "Install Calico CNI");
    add("update_kubeconfig", "Update kubeconfig with external IP", "Update kubeconfig with external IP");
    add("update_coredns_config", "Update CoreDNS configuration", "Update CoreDNS configuration");
    add("create_and_label_namespaces", "Create and label Cloudana namespaces", "Create cloudana-services and workloads namespaces");
    add("install_provider_node_server", "Install Cloudana Provider Node", "Install and start Provider Node service for workload execution");

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

    // Prevent duplicate: block if a build is already running for the same control node
    const controlHostname = nodes[0].hostname;
    for (const [aid, act] of Object.entries(inMemoryActions)) {
      if (act.status !== "running") continue;
      const existingNode = controlNodeByActionId[aid];
      if (existingNode && existingNode.hostname === controlHostname) {
        throw new ApplicationError({
          statusCode: 409,
          errorCode: "PRV_BUILD_IN_PROGRESS",
          payload: {
            message: `A build is already in progress for this node (${controlHostname}). Wait for it to complete or use a different node.`,
            error: "PRV_BUILD_IN_PROGRESS",
          },
        });
      }
    }

    const startTime = now();
    const controlNodeEndpoint = `http://${nodes[0].hostname}:4040`;
    const action: BuildProviderStatusResponse = {
      id: actionId,
      name: "Build Cloudana Provider",
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
      control_node_endpoint: controlNodeEndpoint,
    };
    inMemoryActions[actionId] = action;
    controlNodeByActionId[actionId] = nodes[0];
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
        saveBuildToStore(actionId, a, deviceIdToActionId).catch(() => {});
      }
      return;
    }

    // Prevent duplicate install: check all steps of provider install (K3s, namespaces, provider-node)
    const runCmd = (adapter as { runCommand: (c: unknown, cmd: string) => Promise<{ stdout: string }> }).runCommand;
    const failBuild = (message: string) => {
      const taskId = tasks[0]?.id;
      if (taskId) {
        updateTask(actionId, taskId, "failed", now(), now());
        appendLog(taskId, `[${taskId}] ${message}`);
      }
      const a = inMemoryActions[actionId];
      if (a) {
        a.status = "failed";
        a.end_time = now();
      }
      adapter.closeClient(sshClient).catch(() => {});
    };

    try {
      // Step 7: Provider-node already running → treat as already installed; complete build with device_id so UI can go to step 5
      const { stdout: deviceInfoOut } = await runCmd(sshClient, "curl -s --connect-timeout 3 http://127.0.0.1:4040/device-info 2>/dev/null || echo '{}'");
      const deviceInfo = JSON.parse(deviceInfoOut || "{}") as {
        deviceId?: string;
        spec?: {
          cpuModel?: string;
          cpuCores?: number;
          memoryTotalBytes?: number;
          memoryFreeBytes?: number;
          diskTotalBytes?: number | null;
          diskFreeBytes?: number | null;
        };
      };
      if (deviceInfo.deviceId && typeof deviceInfo.deviceId === "string" && deviceInfo.deviceId.startsWith("0x")) {
        const a = inMemoryActions[actionId];
        if (a) {
          a.device_id = deviceInfo.deviceId;
          deviceIdToActionId[deviceInfo.deviceId] = actionId;
          saveDeviceMappingToStore(deviceInfo.deviceId, actionId).catch(() => {});
          if (deviceInfo.spec && typeof deviceInfo.spec === "object") {
            a.device_spec = {
              cpuModel: deviceInfo.spec.cpuModel ?? "Unknown",
              cpuCores: typeof deviceInfo.spec.cpuCores === "number" ? deviceInfo.spec.cpuCores : 0,
              memoryTotalBytes: typeof deviceInfo.spec.memoryTotalBytes === "number" ? deviceInfo.spec.memoryTotalBytes : 0,
              memoryFreeBytes: typeof deviceInfo.spec.memoryFreeBytes === "number" ? deviceInfo.spec.memoryFreeBytes : undefined,
              diskTotalBytes: typeof deviceInfo.spec.diskTotalBytes === "number" ? deviceInfo.spec.diskTotalBytes : null,
              diskFreeBytes: typeof deviceInfo.spec.diskFreeBytes === "number" ? deviceInfo.spec.diskFreeBytes : null,
            };
          }
          a.status = "completed";
          a.end_time = now();
          saveBuildToStore(actionId, a, deviceIdToActionId).catch(() => {});
          for (const t of a.tasks) {
            t.status = "completed";
            t.end_time = now();
          }
        }
        await adapter.closeClient(sshClient).catch(() => {});
        return;
      }

      // Env already installed (K3s/namespaces present) but provider not on-chain: allow build again; skip to provider-node step so user can get device_id and register
      let envAlreadyInstalled = false;
      const { stdout: k3sStatus } = await runCmd(sshClient, "systemctl is-active k3s 2>/dev/null || echo inactive");
      if (k3sStatus.trim().toLowerCase() === "active") envAlreadyInstalled = true;
      if (!envAlreadyInstalled) {
        const { stdout: nsOut } = await runCmd(sshClient, "kubectl get ns cloudana-services 2>/dev/null | grep -q cloudana-services && echo exists || echo missing");
        if (nsOut.trim().toLowerCase().includes("exists")) envAlreadyInstalled = true;
      }
      if (!envAlreadyInstalled) {
        const { stdout: k3sBin } = await runCmd(sshClient, "command -v k3s 2>/dev/null || true");
        if (k3sBin.trim().length > 0) envAlreadyInstalled = true;
      }
    } catch {
      // Any check failed (parse/SSH): assume node is clean, proceed with build
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

      const t1b = taskIds.get("configure_firewall");
      if (t1b && !(await runTask(t1b, "configure_firewall", (onLog) =>
        k3s.configureFirewall(sshClient!, t1b, onLog)))) return;

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

      const tProviderNode = taskIds.get("install_provider_node_server");
      if (tProviderNode) {
        // Auto-check: if provider-node is already running (e.g. after env installed), skip install and capture device_id
        let deviceIdCaptured = false;
        try {
          const { stdout: existingOut } = await runCmd(sshClient!, "curl -s --connect-timeout 3 http://127.0.0.1:4040/device-info 2>/dev/null || echo '{}'");
          const existing = JSON.parse(existingOut || "{}") as {
            deviceId?: string;
            spec?: {
              cpuModel?: string;
              cpuCores?: number;
              memoryTotalBytes?: number;
              memoryFreeBytes?: number;
              diskTotalBytes?: number | null;
              diskFreeBytes?: number | null;
            };
          };
          if (existing.deviceId && typeof existing.deviceId === "string" && existing.deviceId.startsWith("0x")) {
            const a = inMemoryActions[actionId];
            if (a) {
              a.device_id = existing.deviceId;
              deviceIdToActionId[existing.deviceId] = actionId;
              saveDeviceMappingToStore(existing.deviceId, actionId).catch(() => {});
              if (existing.spec && typeof existing.spec === "object") {
                a.device_spec = {
                  cpuModel: existing.spec.cpuModel ?? "Unknown",
                  cpuCores: typeof existing.spec.cpuCores === "number" ? existing.spec.cpuCores : 0,
                  memoryTotalBytes: typeof existing.spec.memoryTotalBytes === "number" ? existing.spec.memoryTotalBytes : 0,
                  memoryFreeBytes: typeof existing.spec.memoryFreeBytes === "number" ? existing.spec.memoryFreeBytes : undefined,
                  diskTotalBytes: typeof existing.spec.diskTotalBytes === "number" ? existing.spec.diskTotalBytes : null,
                  diskFreeBytes: typeof existing.spec.diskFreeBytes === "number" ? existing.spec.diskFreeBytes : null,
                };
              }
            }
            updateTask(actionId, tProviderNode, "completed", now(), now());
            appendLog(tProviderNode, `[${tProviderNode}] Provider node already running; device_id captured. Skipping install.`);
            deviceIdCaptured = true;
          }
        } catch {
          // proceed to install
        }

        if (!deviceIdCaptured) {
          const tarballBuffer = await createProviderNodeTarball();
          const ok = await runTask(tProviderNode, "install_provider_node_server", (onLog) =>
            k3s.installProviderNodeServer(sshClient!, tProviderNode, onLog, tarballBuffer ?? undefined));
          if (!ok) return;
          // Capture unique device id from installed provider node. Retry a few times in case node is still starting.
          const maxAttempts = 4;
          const delaysMs = [3000, 5000, 5000, 5000];
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
              await new Promise((r) => setTimeout(r, delaysMs[attempt]));
              const { stdout } = await runCmd(sshClient!, "curl -s --connect-timeout 5 http://127.0.0.1:4040/device-info 2>/dev/null || echo '{}'");
              const parsed = JSON.parse(stdout || "{}") as {
                deviceId?: string;
                spec?: {
                  cpuModel?: string;
                  cpuCores?: number;
                  memoryTotalBytes?: number;
                  memoryFreeBytes?: number;
                  diskTotalBytes?: number | null;
                  diskFreeBytes?: number | null;
                };
              };
              if (parsed.deviceId && typeof parsed.deviceId === "string" && parsed.deviceId.startsWith("0x")) {
                const a = inMemoryActions[actionId];
                if (a) {
                  a.device_id = parsed.deviceId;
                  deviceIdToActionId[parsed.deviceId] = actionId;
                  saveDeviceMappingToStore(parsed.deviceId, actionId).catch(() => {});
                  if (parsed.spec && typeof parsed.spec === "object") {
                    a.device_spec = {
                      cpuModel: parsed.spec.cpuModel ?? "Unknown",
                      cpuCores: typeof parsed.spec.cpuCores === "number" ? parsed.spec.cpuCores : 0,
                      memoryTotalBytes: typeof parsed.spec.memoryTotalBytes === "number" ? parsed.spec.memoryTotalBytes : 0,
                      memoryFreeBytes: typeof parsed.spec.memoryFreeBytes === "number" ? parsed.spec.memoryFreeBytes : undefined,
                      diskTotalBytes: typeof parsed.spec.diskTotalBytes === "number" ? parsed.spec.diskTotalBytes : null,
                      diskFreeBytes: typeof parsed.spec.diskFreeBytes === "number" ? parsed.spec.diskFreeBytes : null,
                    };
                  }
                }
                break;
              }
            } catch {
              // retry on next attempt
            }
          }
        }
      }

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
      // Final chance to capture device_id if not set yet (provider-node may have started after join tasks)
      if (a && !a.device_id) {
        try {
          await new Promise((r) => setTimeout(r, 15000));
          const { stdout } = await runCmd(sshClient!, "curl -s --connect-timeout 10 http://127.0.0.1:4040/device-info 2>/dev/null || echo '{}'");
          const parsed = JSON.parse(stdout || "{}") as {
            deviceId?: string;
            spec?: {
              cpuModel?: string;
              cpuCores?: number;
              memoryTotalBytes?: number;
              memoryFreeBytes?: number;
              diskTotalBytes?: number | null;
              diskFreeBytes?: number | null;
            };
          };
          if (parsed.deviceId && typeof parsed.deviceId === "string" && parsed.deviceId.startsWith("0x")) {
            a.device_id = parsed.deviceId;
            deviceIdToActionId[parsed.deviceId] = actionId;
            saveDeviceMappingToStore(parsed.deviceId, actionId).catch(() => {});
            if (parsed.spec && typeof parsed.spec === "object") {
              a.device_spec = {
                cpuModel: parsed.spec.cpuModel ?? "Unknown",
                cpuCores: typeof parsed.spec.cpuCores === "number" ? parsed.spec.cpuCores : 0,
                memoryTotalBytes: typeof parsed.spec.memoryTotalBytes === "number" ? parsed.spec.memoryTotalBytes : 0,
                memoryFreeBytes: typeof parsed.spec.memoryFreeBytes === "number" ? parsed.spec.memoryFreeBytes : undefined,
                diskTotalBytes: typeof parsed.spec.diskTotalBytes === "number" ? parsed.spec.diskTotalBytes : null,
                diskFreeBytes: typeof parsed.spec.diskFreeBytes === "number" ? parsed.spec.diskFreeBytes : null,
              };
            }
          }
        } catch {
          // ignore
        }
      }

      if (a) {
        a.status = "completed";
        a.end_time = now();
        saveBuildToStore(actionId, a, deviceIdToActionId).catch(() => {});
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const a = inMemoryActions[actionId];
      if (a) {
        a.status = "failed";
        a.end_time = now();
        saveBuildToStore(actionId, a, deviceIdToActionId).catch(() => {});
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

  /** Get Provider Node service status (active/inactive) for a build action. Uses pm2 jlist for accurate state. */
  async getProviderNodeServiceStatus(actionId: string): Promise<{ status: string; message?: string; pid?: number; pm2Status?: string }> {
    const node = controlNodeByActionId[actionId];
    if (!node) {
      const build = inMemoryActions[actionId];
      if (build?.status === "completed" || build?.status === "failed") {
        return { status: "unknown", message: "Build completed; node control unavailable (server was restarted)." };
      }
      return { status: "unknown", message: "Control node not found for this action." };
    }
    const adapter = new Ssh2K3sAdapter();
    const control = nodeToMachineInput(node);
    let client: unknown = null;
    try {
      client = await adapter.getClient(control);
      // Get PM2 process list (JSON); empty array if pm2 not running or jlist fails
      const { stdout } = await (adapter as { runCommand: (c: unknown, cmd: string) => Promise<{ stdout: string }> }).runCommand(
        client,
        "sudo pm2 jlist 2>/dev/null || echo '[]'"
      );
      let list: Array<{ pid: number; name?: string; pm2_env?: { status: string; pm_id?: number } }> = [];
      try {
        const raw = stdout.trim();
        if (raw && raw !== "[]") list = JSON.parse(raw) as typeof list;
      } catch {
        // Fallback: try pid-only check
        const { stdout: pidOut } = await (adapter as { runCommand: (c: unknown, cmd: string) => Promise<{ stdout: string }> }).runCommand(
          client,
          "sudo pm2 pid cloudana-provider-node 2>/dev/null || true"
        );
        const pid = pidOut.trim();
        if (pid && /^\d+$/.test(pid)) {
          return { status: "active", message: `Running (PID ${pid})`, pid: parseInt(pid, 10), pm2Status: "online" };
        }
        return { status: "inactive", message: "Stopped or not in PM2 list." };
      }
      const app = list.find((p) => p.name === "cloudana-provider-node");
      if (!app) {
        return { status: "inactive", message: "Not installed (Provider Node not in PM2 list).", pm2Status: undefined };
      }
      const pm2Status = app.pm2_env?.status ?? "unknown";
      const isOnline = pm2Status === "online";
      const pid = typeof app.pid === "number" && app.pid > 0 ? app.pid : undefined;
      const message = isOnline
        ? (pid ? `Running (PID ${pid})` : "Running")
        : pm2Status === "stopped"
          ? "Stopped"
          : pm2Status === "errored"
            ? "Errored (check logs)"
            : `PM2 status: ${pm2Status}`;
      return {
        status: isOnline ? "active" : "inactive",
        message,
        pid,
        pm2Status,
      };
    } catch (e) {
      return { status: "error", message: e instanceof Error ? e.message : String(e) };
    } finally {
      if (client) await adapter.closeClient(client);
    }
  }

  /** Start Provider Node service on the control node for a build action. */
  async startProviderNodeService(actionId: string): Promise<{ status: string; message?: string }> {
    const node = controlNodeByActionId[actionId];
    if (!node) {
      return { status: "error", message: "Control node not found for this action." };
    }
    const adapter = new Ssh2K3sAdapter();
    const control = nodeToMachineInput(node);
    let client: unknown = null;
    try {
      client = await adapter.getClient(control);
      // Use restart so a stopped process is brought back up; fallback to start from config if not in PM2 list
      await (adapter as { runCommand: (c: unknown, cmd: string) => Promise<unknown> }).runCommand(
        client,
        "sudo pm2 restart cloudana-provider-node 2>/dev/null || (cd /opt/cloudana-provider-node && sudo pm2 start ecosystem.config.cjs)"
      );
      return { status: "success", message: "Provider Node service started." };
    } catch (e) {
      return { status: "error", message: e instanceof Error ? e.message : String(e) };
    } finally {
      if (client) await adapter.closeClient(client);
    }
  }

  /** Stop Provider Node service on the control node for a build action. */
  async stopProviderNodeService(actionId: string): Promise<{ status: string; message?: string }> {
    const node = controlNodeByActionId[actionId];
    if (!node) {
      return { status: "error", message: "Control node not found for this action." };
    }
    const adapter = new Ssh2K3sAdapter();
    const control = nodeToMachineInput(node);
    let client: unknown = null;
    try {
      client = await adapter.getClient(control);
      await (adapter as { runCommand: (c: unknown, cmd: string) => Promise<unknown> }).runCommand(
        client,
        "sudo pm2 stop cloudana-provider-node"
      );
      return { status: "success", message: "Provider Node service stopped." };
    } catch (e) {
      return { status: "error", message: e instanceof Error ? e.message : String(e) };
    } finally {
      if (client) await adapter.closeClient(client);
    }
  }

  /** Resolve action_id from device_id (for owner control after registration). */
  getActionIdByDeviceId(deviceId: string): string | null {
    return deviceIdToActionId[deviceId] ?? null;
  }

  /** Get device_id and real device spec for registration confirm modal (cap offered spec). */
  getPrepareRegistration(deviceId: string): {
    device_id: string;
    real_spec: {
      cpuModel: string;
      cpuCores: number;
      memoryTotalBytes: number;
      memoryFreeBytes?: number;
      diskTotalBytes?: number | null;
      diskFreeBytes?: number | null;
    } | null;
  } | null {
    const actionId = deviceIdToActionId[deviceId];
    if (!actionId) return null;
    const action = inMemoryActions[actionId];
    if (!action || !action.device_id) return null;
    return {
      device_id: action.device_id,
      real_spec: action.device_spec ?? null,
    };
  }

  /** Get Provider Node service status by device_id (for owner dashboard). */
  async getProviderNodeServiceStatusByDeviceId(deviceId: string): Promise<{ status: string; message?: string; pid?: number; pm2Status?: string }> {
    const actionId = deviceIdToActionId[deviceId];
    if (!actionId) return { status: "unknown", message: "No build found for this device. Register from the build flow first." };
    return this.getProviderNodeServiceStatus(actionId);
  }

  /** Start Provider Node service by device_id. */
  async startProviderNodeServiceByDeviceId(deviceId: string): Promise<{ status: string; message?: string }> {
    const actionId = deviceIdToActionId[deviceId];
    if (!actionId) return { status: "error", message: "No build found for this device." };
    return this.startProviderNodeService(actionId);
  }

  /** Stop Provider Node service by device_id. */
  async stopProviderNodeServiceByDeviceId(deviceId: string): Promise<{ status: string; message?: string }> {
    const actionId = deviceIdToActionId[deviceId];
    if (!actionId) return { status: "error", message: "No build found for this device." };
    return this.stopProviderNodeService(actionId);
  }
}
