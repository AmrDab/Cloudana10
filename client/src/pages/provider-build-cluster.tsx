import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { CheckCircle, Circle, Loader2, ArrowRight, ArrowLeft, ChevronDown, ChevronUp, AlertCircle, Play, Square, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { nodeApiBase } from "@/lib/api-base";

type BuildStepStatus = "completed" | "running" | "pending" | "failed";

type BuildStep = {
  id: string;
  label: string;
  status: BuildStepStatus;
  duration?: string;
  taskId?: string; // Backend task ID for fetching logs
  startTime?: string | null;
  endTime?: string | null;
  logs?: string[];
};

const BUILD_STEPS: Omit<BuildStep, "status" | "duration">[] = [
  { id: "init-k3s", label: "Initialize K3s on main control node" },
  { id: "update-deps", label: "Update system and install dependencies" },
  { id: "calico-cni", label: "Install Calico CNI" },
  { id: "kubeconfig", label: "Update kubeconfig with external IP" },
  { id: "coredns", label: "Update CoreDNS configuration" },
  { id: "namespaces", label: "Create and label Cloudana namespaces" },
  { id: "provider-node-server", label: "Install Cloudana Provider Node" },
];

// Duration in seconds for computing step start/end (steps 1–7 from images)
const STEP_DURATION_SECONDS: Record<string, number> = {
  "init-k3s": 26,
  "update-deps": 29,
  "calico-cni": 9,
  "kubeconfig": 14,
  "coredns": 5,
  "namespaces": 2,
};

// Expandable log output per step (steps 1–7 from images)
const STEP_LOG_OUTPUT: Record<string, string> = {
  "init-k3s": `[INFO] Skipping /usr/local/bin/ctr symlink to k3s, command exists in PATH at /usr/local/bin/ctr
[INFO] Creating killall script /usr/local/bin/k3s-killall.sh
[INFO] Creating uninstall script /usr/local/bin/k3s-uninstall.sh
[INFO] env: Creating environment file /etc/systemd/system/k3s.service.env
[INFO] systemd: Creating service file /etc/systemd/system/k3s.service
[INFO] systemd: Enabling k3s unit
[INFO] systemd: Starting k3s
Created symlink /etc/systemd/system/multi-user.target.wants/k3s.service -> /etc/systemd/system/k3s.service.

NAME    STATUS   ROLES              AGE   VERSION
node1   Ready    control-plane,etcd   6s   v1.34.3+k3s1`,
  "update-deps": `Use 'apt autoremove' to remove them.
0 upgraded, 0 newly installed, 0 to remove and 1 not upgraded.

% Total    % Received % Xferd  Average Speed Dload  Upload  Time Total  Time Spent  Time Left  Current Speed
100  12.9M  100  12.9M    0     0  21.3M      0 --:--:-- --:--:-- --:--:-- 21.3M`,
  "calico-cni": `...hides previous definition of "FELIX_WIREGUARDENABLED", which may be dropped when using apply (indices 39, 41, 43, 45, 47 of spec.template.spec.containers[0].env)
...hides previous definition of "IP_AUTODETECTION_METHOD", which may be dropped when using apply (indices 40, 42, 44, 46, 48 of spec.template.spec.containers[0].env)`,
  "kubeconfig": `172.17.0.1`,
  "coredns": `configmap/coredns patched`,
  "namespaces": `namespace/cloudana-services created
namespace/workloads created
namespace/cloudana-services labeled
namespace/workloads labeled`,
};

// Initialize steps with pending status
function getInitialSteps(): BuildStep[] {
  return BUILD_STEPS.map((s) => ({
    ...s,
    status: "pending" as BuildStepStatus,
    duration: undefined,
  }));
}

function formatStartTime(date: Date): string {
  return date.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
}

// Map backend task names/descriptions to BUILD_STEPS ids
const TASK_TO_STEP_MAP: Record<string, string> = {
  "initialize_k3s_control": "init-k3s",
  "Initialize K3s on main control node": "init-k3s",
  "update_dependencies": "update-deps",
  "Update system and install dependencies": "update-deps",
  "install_calico": "calico-cni",
  "Install Calico CNI": "calico-cni",
  "update_kubeconfig": "kubeconfig",
  "Update kubeconfig with external IP": "kubeconfig",
  "update_coredns_config": "coredns",
  "Update CoreDNS configuration": "coredns",
  "create_and_label_namespaces": "namespaces",
  "Create and label Cloudana namespaces": "namespaces",
  "install_provider_node_server": "provider-node-server",
  "Install Cloudana Provider Node": "provider-node-server",
};

function mapTaskToStepId(taskName: string, taskDescription: string): string | null {
  return TASK_TO_STEP_MAP[taskName] || TASK_TO_STEP_MAP[taskDescription] || null;
}

function calculateDuration(startTime: string | null | undefined, endTime: string | null | undefined): string | undefined {
  if (!startTime) return undefined;
  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : new Date();
  const diffMs = end.getTime() - start.getTime();
  if (diffMs < 0) return undefined;
  
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  try {
    return new Date(dateStr);
  } catch {
    return null;
  }
}

export type ProviderBuildClusterProps = {
  /** When provided, use this instead of URL action_id (e.g. when embedded in register multistep) */
  actionId?: string | null;
  /** When true, hide Back button and do not redirect; used when rendered inside /provider/register */
  embedded?: boolean;
  /** Called when build completes; receives device_id for on-chain registration (enables auto flow to step 5) */
  onBuildComplete?: (deviceId: string | null) => void;
};

export default function ProviderBuildCluster(props: ProviderBuildClusterProps = {}) {
  const { actionId: propActionId = null, embedded = false, onBuildComplete } = props;
  const [, setLocation] = useLocation();
  
  const urlActionId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("action_id") : null;
  const actionId = propActionId != null ? propActionId : urlActionId;

  // When standalone on /register with no action_id, redirect to provider register form
  useEffect(() => {
    if (embedded) return;
    const q = new URLSearchParams(window.location.search);
    if (window.location.pathname === "/register" && !q.get("action_id")) {
      setLocation("/provider/register");
    }
  }, [embedded, setLocation]);
  
  const [buildId] = useState(() => actionId || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "752d71cf-45f6-447c-9808-1fd6ab37ed74"));
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [buildStatus, setBuildStatus] = useState<"pending" | "running" | "completed" | "failed">("pending");
  const [steps, setSteps] = useState<BuildStep[]>(getInitialSteps);
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const [stepLogs, setStepLogs] = useState<Record<string, string[]>>({});
  const [isLoadingLogs, setIsLoadingLogs] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [providerNodeStatus, setProviderNodeStatus] = useState<"active" | "inactive" | "unknown" | "error" | "loading" | null>(null);
  const [providerNodeMessage, setProviderNodeMessage] = useState<string | null>(null);
  const [providerNodeDetail, setProviderNodeDetail] = useState<string | null>(null);
  const [providerNodeAction, setProviderNodeAction] = useState<"idle" | "starting" | "stopping">("idle");
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isPollingRef = useRef(false);
  const runningLogPreRef = useRef<HTMLPreElement | null>(null);
  const onBuildCompleteFiredRef = useRef(false);

  const apiUrl = nodeApiBase();

  const fetchProviderNodeStatus = async () => {
    if (!actionId) return;
    setProviderNodeStatus("loading");
    setProviderNodeDetail(null);
    try {
      const res = await fetch(`${apiUrl}/build-provider/provider-node/status/${actionId}`);
      const data = await res.json();
      setProviderNodeStatus(
        data.status === "active" ? "active"
        : data.status === "inactive" ? "inactive"
        : data.status === "error" ? "error"
        : "unknown"
      );
      setProviderNodeMessage(data.message ?? null);
      // Show verifiable detail so user can confirm (e.g. "PID 1234" or "PM2: stopped")
      const parts: string[] = [];
      if (data.pid != null) parts.push(`PID ${data.pid}`);
      if (data.pm2Status) parts.push(`PM2: ${data.pm2Status}`);
      setProviderNodeDetail(parts.length ? parts.join(" · ") : null);
    } catch {
      setProviderNodeStatus("error");
      setProviderNodeMessage("Failed to fetch status");
      setProviderNodeDetail(null);
    }
  };

  const startProviderNode = async () => {
    if (!actionId || providerNodeAction !== "idle") return;
    setProviderNodeAction("starting");
    try {
      const res = await fetch(`${apiUrl}/build-provider/provider-node/start/${actionId}`, { method: "POST" });
      const data = await res.json();
      if (data.status === "success") await fetchProviderNodeStatus();
      else {
        setProviderNodeStatus("error");
        setProviderNodeMessage(data.message ?? "Start failed");
      }
    } catch {
      setProviderNodeStatus("error");
      setProviderNodeMessage("Failed to start");
    } finally {
      setProviderNodeAction("idle");
    }
  };

  const stopProviderNode = async () => {
    if (!actionId || providerNodeAction !== "idle") return;
    setProviderNodeAction("stopping");
    try {
      const res = await fetch(`${apiUrl}/build-provider/provider-node/stop/${actionId}`, { method: "POST" });
      const data = await res.json();
      if (data.status === "success") await fetchProviderNodeStatus();
      else {
        setProviderNodeStatus("error");
        setProviderNodeMessage(data.message ?? "Stop failed");
      }
    } catch {
      setProviderNodeStatus("error");
      setProviderNodeMessage("Failed to stop");
    } finally {
      setProviderNodeAction("idle");
    }
  };

  // Fetch build status
  const fetchBuildStatus = async () => {
    if (!actionId || isPollingRef.current) return;
    
    try {
      isPollingRef.current = true;
      const response = await fetch(`${apiUrl}/build-provider-status/${actionId}`);
      
      if (!response.ok) {
        if (response.status === 404) {
          setError("Build action not found. Please check the action ID.");
          return;
        }
        throw new Error(`HTTP ${response.status}: Failed to fetch build status`);
      }

      const data = await response.json();
      
      // Update build-level status and startedAt from backend
      if (data.status === "completed" || data.status === "failed" || data.status === "running" || data.status === "pending") {
        setBuildStatus(data.status);
      }
      if (data.start_time && !startedAt) {
        setStartedAt(parseDate(data.start_time));
      }

      // Map backend tasks to steps
      const updatedSteps: BuildStep[] = BUILD_STEPS.map((step) => {
        // Find matching task from backend
        const matchingTask = data.tasks?.find((task: any) => {
          const stepId = mapTaskToStepId(task.title || "", task.description || "");
          return stepId === step.id;
        });

        if (matchingTask) {
          const status = matchingTask.status === "completed" ? "completed" 
            : matchingTask.status === "running" ? "running"
            : matchingTask.status === "failed" ? "failed"
            : "pending";
          
          return {
            ...step,
            status: status as BuildStepStatus,
            taskId: matchingTask.id,
            startTime: matchingTask.start_time,
            endTime: matchingTask.end_time,
            duration: calculateDuration(matchingTask.start_time, matchingTask.end_time),
          };
        }

        // Return step with pending status if no matching task found
        return {
          ...step,
          status: "pending" as BuildStepStatus,
        };
      });

      setSteps(updatedSteps);
      setError(null);

      // Stop polling if build is completed or failed
      if (data.status === "completed" || data.status === "failed") {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        isPollingRef.current = false;
        if (data.status === "completed" && onBuildComplete && !onBuildCompleteFiredRef.current) {
          onBuildCompleteFiredRef.current = true;
          onBuildComplete(typeof data.device_id === "string" ? data.device_id : null);
        }
      }
    } catch (err) {
      console.error("Error fetching build status:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch build status");
    } finally {
      isPollingRef.current = false;
    }
  };

  // Fetch logs for a specific task (force = true skips cache for live-tailing running steps).
  // Only update state when logs actually change to avoid blink from unnecessary re-renders.
  const fetchTaskLogs = async (taskId: string, force = false) => {
    if (!force && (stepLogs[taskId]?.length || isLoadingLogs[taskId])) return;

    setIsLoadingLogs((prev) => ({ ...prev, [taskId]: true }));

    try {
      const response = await fetch(`${apiUrl}/build-provider/logs/${taskId}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Failed to fetch logs`);
      }

      const data = await response.json();
      const newLogs: string[] = data.logs || [];

      setStepLogs((prev) => {
        const prevLogs = prev[taskId] || [];
        if (prevLogs.length === newLogs.length && prevLogs[prevLogs.length - 1] === newLogs[newLogs.length - 1]) {
          return prev;
        }
        return { ...prev, [taskId]: newLogs };
      });
    } catch (err) {
      console.error("Error fetching task logs:", err);
      setStepLogs((prev) => ({
        ...prev,
        [taskId]: [`Error loading logs: ${err instanceof Error ? err.message : "Unknown error"}`],
      }));
    } finally {
      setIsLoadingLogs((prev) => ({ ...prev, [taskId]: false }));
    }
  };

  // Poll for status updates only while pending/running; once completed/failed, fetch once and stop (backend persists terminal state)
  useEffect(() => {
    if (!actionId) {
      setError("No action ID provided. Cannot fetch build status.");
      return;
    }

    fetchBuildStatus();
    if (buildStatus === "completed" || buildStatus === "failed") {
      return;
    }
    const intervalMs = buildStatus === "running" ? 1000 : 2000;
    pollingIntervalRef.current = setInterval(fetchBuildStatus, intervalMs);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [actionId, buildStatus]);

  // Fetch logs when step is expanded
  useEffect(() => {
    if (expandedStepId) {
      const step = steps.find((s) => s.id === expandedStepId);
      if (step?.taskId) {
        fetchTaskLogs(step.taskId);
      }
    }
  }, [expandedStepId, steps]);

  // Auto-expand the current running step so install log is visible in real time
  useEffect(() => {
    const runningStep = steps.find((s) => s.status === "running");
    if (runningStep && expandedStepId !== runningStep.id) {
      setExpandedStepId(runningStep.id);
    }
  }, [steps]);

  // Auto-fetch logs for any running step in real time: immediate first fetch, then poll every 1.2s to reduce blink
  useEffect(() => {
    const running = steps.filter((s) => s.status === "running" && s.taskId);
    if (running.length === 0) return;
    running.forEach((s) => s.taskId && fetchTaskLogs(s.taskId, true));
    const t = setInterval(() => {
      running.forEach((s) => s.taskId && fetchTaskLogs(s.taskId, true));
    }, 1200);
    return () => clearInterval(t);
  }, [steps]);

  // Auto-scroll running step log to bottom when new lines arrive (raf to avoid layout thrash)
  const runningStepTaskId = steps.find((s) => s.status === "running")?.taskId;
  const runningLogLength = runningStepTaskId ? (stepLogs[runningStepTaskId]?.length ?? 0) : 0;
  useEffect(() => {
    if (!runningStepTaskId || runningLogLength === 0) return;
    const pre = runningLogPreRef.current;
    if (pre) requestAnimationFrame(() => { pre.scrollTop = pre.scrollHeight; });
  }, [runningStepTaskId, runningLogLength]);

  // Fetch Provider Node status when build is completed
  useEffect(() => {
    if (buildStatus === "completed" && actionId && providerNodeStatus === null) {
      fetchProviderNodeStatus();
    }
  }, [buildStatus, actionId]);

  const toggleStep = (stepId: string) => {
    setExpandedStepId((prev) => (prev === stepId ? null : stepId));
  };

  return (
    <div className={embedded ? "space-y-4" : "max-w-3xl mx-auto py-10 px-4 space-y-4"}>
      {!embedded && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/provider/register")}
          title="Back to registration form"
          className="text-muted-foreground hover:text-foreground -ml-2"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to registration
        </Button>
      )}
      <div className="bg-card rounded-lg border p-6 space-y-4">
        <div className="flex items-center gap-2">
          {buildStatus === "completed" ? (
            <CheckCircle className="h-8 w-8 text-green-500 shrink-0" />
          ) : buildStatus === "failed" ? (
            <AlertCircle className="h-8 w-8 text-red-500 shrink-0" />
          ) : buildStatus === "running" ? (
            <div className="w-8 h-8 rounded-full border-2 border-primary flex items-center justify-center flex-shrink-0">
              <Loader2 className="h-4 w-4 text-primary animate-spin" />
            </div>
          ) : (
            <Circle className="h-8 w-8 text-muted-foreground shrink-0" />
          )}
          <h1 className="text-2xl font-bold">Build Cloudana Provider</h1>
        </div>
        <p className="font-mono text-sm text-muted-foreground break-all">{buildId}</p>
        {startedAt && (
          <p className="text-sm text-muted-foreground">
            Started: {formatStartTime(startedAt)}
          </p>
        )}
        {error && (
          <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3 flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        <ul className="space-y-0 pt-2">
          {steps.map((step) => {
            const isExpanded = expandedStepId === step.id;
            const startedDate = step.startTime ? parseDate(step.startTime) : null;
            const endedDate = step.endTime ? parseDate(step.endTime) : null;
            const logs = step.taskId ? stepLogs[step.taskId] : undefined;
            const isLoading = step.taskId ? isLoadingLogs[step.taskId] : false;
            const showLogTail =
              (step.status === "running" || step.status === "completed" || step.status === "failed") &&
              (logs?.length || isLoading);
            const tailN = step.status === "running" ? 24 : 6;
            const logTailLines = logs?.length ? logs.slice(-tailN) : [];

            return (
              <li
                key={step.id}
                className="border-b border-border/50 last:border-0"
              >
                <button
                  type="button"
                  onClick={() => toggleStep(step.id)}
                  className="flex w-full items-center justify-between gap-4 py-2 text-left hover:bg-muted/50 rounded px-1 -mx-1 cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm">{step.label}</span>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 ml-1" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 ml-1" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {step.duration && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {step.duration}
                      </span>
                    )}
                    {step.status === "completed" && (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    )}
                    {step.status === "running" && (
                      <div className="w-5 h-5 rounded-full border-2 border-primary flex items-center justify-center">
                        <Loader2 className="h-3 w-3 text-primary animate-spin" />
                      </div>
                    )}
                    {step.status === "failed" && (
                      <AlertCircle className="h-5 w-5 text-red-500" />
                    )}
                    {step.status === "pending" && (
                      <div className="w-5 h-5 rounded-full border-2 border-primary/50 bg-primary/10 flex items-center justify-center" aria-hidden />
                    )}
                  </div>
                </button>

                {showLogTail && !isExpanded && (
                  <div className="pl-6 pr-1 pb-2">
                    <pre className="bg-zinc-900 dark:bg-zinc-950 text-zinc-100 text-xs p-3 rounded border border-zinc-700/50 overflow-auto max-h-[140px] whitespace-pre-wrap font-mono">
                      {isLoading && !logs?.length ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Waiting for logs…
                        </span>
                      ) : (
                        logTailLines.join("\n") || "No output yet."
                      )}
                    </pre>
                  </div>
                )}

                {isExpanded && (
                  <div className="pb-4 pt-1 px-1">
                    <h3 className="text-base font-semibold mb-1">{step.label}</h3>
                    {startedDate && (
                      <p className="text-sm text-muted-foreground mb-1">
                        Started: {formatStartTime(startedDate)}
                      </p>
                    )}
                    {endedDate && (
                      <p className="text-sm text-muted-foreground mb-3">
                        Ended: {formatStartTime(endedDate)}
                      </p>
                    )}
                    {!startedDate && !endedDate && (
                      <p className="text-sm text-muted-foreground mb-3">
                        Not started yet
                      </p>
                    )}
                    <pre
                      key={`log-${step.id}`}
                      ref={(el) => {
                        if (isExpanded && step.status === "running") runningLogPreRef.current = el;
                      }}
                      className={`bg-zinc-900 dark:bg-zinc-950 text-zinc-100 text-xs p-4 rounded-lg overflow-auto whitespace-pre-wrap font-mono border border-zinc-700/50 min-h-[200px] ${
                        step.status === "running" ? "max-h-[420px]" : "max-h-[320px]"
                      }`}
                      style={{ contain: "layout" }}
                    >
                      {logs && logs.length > 0 ? (
                        logs.join("\n")
                      ) : isLoading && step.taskId ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading logs...
                        </span>
                      ) : step.taskId ? (
                        "No logs available yet."
                      ) : (
                        "No output yet."
                      )}
                    </pre>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {buildStatus === "completed" && actionId && (
          <>
            <div className="mt-6 pt-6 border-t border-border/50 space-y-3">
              <h2 className="text-lg font-semibold">Register on-chain</h2>
              <p className="text-sm text-muted-foreground">
                This build captured a unique device ID. Register this provider on-chain so it can receive workloads (one device = one registration).
              </p>
              <Button
                type="button"
                onClick={() => setLocation(`/provider/register/final?action_id=${actionId}`)}
                className="gap-2"
              >
                <Server className="h-4 w-4" />
                Register this provider on-chain
              </Button>
            </div>
            <div className="mt-6 pt-6 border-t border-border/50 space-y-3">
              <h2 className="text-lg font-semibold">Provider Node Service</h2>
            <p className="text-sm text-muted-foreground">
              Start or stop the Cloudana Provider Node service on your control node (workload execution).
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium">Status:</span>
              {providerNodeStatus === "loading" && (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking…
                </span>
              )}
              {providerNodeStatus === "active" && (
                <span className="text-sm text-green-600 dark:text-green-400 font-medium">
                  {providerNodeMessage ?? "Running"}
                </span>
              )}
              {providerNodeStatus === "inactive" && (
                <span className="text-sm text-muted-foreground font-medium">
                  {providerNodeMessage ?? "Stopped"}
                </span>
              )}
              {(providerNodeStatus === "unknown" || providerNodeStatus === "error") && (
                <span className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                  {providerNodeMessage || "Unknown"}
                </span>
              )}
              {providerNodeDetail && providerNodeStatus !== "loading" && (
                <span className="text-xs text-muted-foreground font-mono" title="Verifiable details from control node">
                  {providerNodeDetail}
                </span>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={startProviderNode}
                disabled={providerNodeAction !== "idle" || providerNodeStatus === "active"}
              >
                {providerNodeAction === "starting" ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <Play className="h-4 w-4 mr-1.5" />
                )}
                Start
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={stopProviderNode}
                disabled={providerNodeAction !== "idle" || providerNodeStatus === "inactive"}
              >
                {providerNodeAction === "stopping" ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <Square className="h-4 w-4 mr-1.5" />
                )}
                Stop
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={fetchProviderNodeStatus}
                disabled={providerNodeStatus === "loading"}
              >
                Refresh
              </Button>
            </div>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
