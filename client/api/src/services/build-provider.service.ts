import type {
  BuildProviderRequest,
  BuildProviderResponse,
  UpdateProviderAttributesRequest,
  UpdateProviderAttributesResponse,
  BuildProviderStatusResponse,
  BuildProviderLogsResponse,
} from "../schemas/build-provider.schema.js";

// NOTE:
// We no longer call the Python provider-console-api at all.
// All methods below return synthetic data so the UI can function
// without an external backend.

// Simple in-memory store for actions and logs (per Node process)
const inMemoryActions: Record<string, BuildProviderStatusResponse> = {};
const inMemoryLogs: Record<string, string[]> = {};

export class BuildProviderService {
  async buildProvider(
    input: BuildProviderRequest,
    _authToken?: string
  ): Promise<BuildProviderResponse> {
    console.log("[BuildProviderService] buildProvider handled locally with input:", JSON.stringify(input, null, 2));

    const action_id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `local-action-${Date.now()}`;

    // Create a synthetic action with a single "local_build" task
    const now = new Date().toISOString();
    const action: BuildProviderStatusResponse = {
      id: action_id,
      name: "Build Provider (local)",
      status: "completed",
      start_time: now,
      end_time: now,
      tasks: [
        {
          id: `${action_id}-task-1`,
          title: "Initialize local build",
          description: "Simulated provider build handled entirely in cloudana-mvp.",
          status: "completed",
          start_time: now,
          end_time: now,
        },
      ],
    };

    inMemoryActions[action_id] = action;
    inMemoryLogs[`${action_id}-task-1`] = [
      "[local] Starting provider build...",
      "[local] Using node configuration:",
      JSON.stringify(input.nodes, null, 2),
      "[local] Using provider configuration:",
      JSON.stringify(input.provider, null, 2),
      "[local] Build completed successfully (simulated).",
    ];

    return {
      status: "success",
      message: "Provider build process started (handled locally in cloudana-mvp)",
      action_id,
    };
  }

  async getBuildProviderStatus(
    actionId: string,
    _authToken?: string
  ): Promise<BuildProviderStatusResponse> {
    const existing = inMemoryActions[actionId];
    if (!existing) {
      // If we don't know this action id, return a pending stub
      const now = new Date().toISOString();
      return {
        id: actionId,
        name: "Build Provider (unknown)",
        status: "pending",
        start_time: now,
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
    console.log(
      "[BuildProviderService] updateProviderAttributes handled locally with input:",
      JSON.stringify(input, null, 2)
    );

    const action_id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `local-attrs-${Date.now()}`;

    return {
      status: "success",
      message: "Provider attributes update process started (handled locally in cloudana-mvp)",
      action_id,
    };
  }

  async getTaskLogs(
    taskId: string,
    _authToken?: string
  ): Promise<BuildProviderLogsResponse> {
    const logs = inMemoryLogs[taskId] || [
      `[local] No logs found for task ${taskId}.`,
    ];

    return { logs };
  }

  private mapTaskStatus(status: string): "pending" | "running" | "completed" | "failed" {
    const normalized = (status || "").toLowerCase();
    if (normalized === "completed" || normalized === "success") {
      return "completed";
    }
    if (normalized === "running" || normalized === "in_progress" || normalized === "in progress") {
      return "running";
    }
    if (normalized === "failed" || normalized === "error") {
      return "failed";
    }
    return "pending";
  }
}
