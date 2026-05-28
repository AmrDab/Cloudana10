/**
 * Build status persistence using local SQLite (node:sqlite via lib/sqlite).
 * Two tables: build_statuses (one row per terminal build) and device_action_mappings
 * (device_id → action_id). Previously MongoDB; moved to embedded SQLite so the
 * orchestrator has no external DB dependency and runs anywhere (incl. Akash).
 */
import { getSqlite, closeSqlite } from "../lib/sqlite.js";
import type { BuildProviderStatusResponse } from "../schemas/build-provider.schema.js";

export interface BuildStatusStoreData {
  version: number;
  builds: Record<string, BuildProviderStatusResponse>;
  deviceIdToActionId: Record<string, string>;
}

let initialized = false;

function db() {
  const d = getSqlite();
  if (!initialized) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS build_statuses (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS device_action_mappings (
        device_id TEXT PRIMARY KEY,
        action_id TEXT NOT NULL
      );
    `);
    initialized = true;
  }
  return d;
}

/** Load persisted build status and device_id → action_id mapping. */
export async function loadBuildStatusStore(): Promise<BuildStatusStoreData> {
  try {
    const d = db();
    const builds: Record<string, BuildProviderStatusResponse> = {};
    for (const row of d.prepare("SELECT id, data FROM build_statuses").all() as { id: string; data: string }[]) {
      try {
        builds[row.id] = { ...JSON.parse(row.data), id: row.id } as BuildProviderStatusResponse;
      } catch {
        // skip malformed row
      }
    }
    const deviceIdToActionId: Record<string, string> = {};
    for (const row of d.prepare("SELECT device_id, action_id FROM device_action_mappings").all() as { device_id: string; action_id: string }[]) {
      deviceIdToActionId[row.device_id] = row.action_id;
    }
    return { version: 1, builds, deviceIdToActionId };
  } catch (e) {
    console.warn("[build-status-store] SQLite load failed, returning empty store:", e);
    return { version: 1, builds: {}, deviceIdToActionId: {} };
  }
}

/** Persist one terminal build (completed/failed) and related device_id mapping. */
export async function saveBuildToStore(
  actionId: string,
  action: BuildProviderStatusResponse,
  currentDeviceIdToActionId: Record<string, string>
): Promise<void> {
  if (action.status !== "completed" && action.status !== "failed") return;
  try {
    const d = db();
    d.prepare(
      `INSERT INTO build_statuses (id, data) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`
    ).run(actionId, JSON.stringify(action));

    if (action.device_id) {
      saveDeviceMapping(d, action.device_id, actionId);
    }
    // Persist any extra mappings that point at this build.
    for (const [deviceId, aid] of Object.entries(currentDeviceIdToActionId)) {
      if (aid === actionId) saveDeviceMapping(d, deviceId, aid);
    }
  } catch (e) {
    console.warn("[build-status-store] SQLite saveBuildToStore failed:", e);
    throw e;
  }
}

/** Persist only device_id → action_id mapping. */
export async function saveDeviceMappingToStore(deviceId: string, actionId: string): Promise<void> {
  try {
    saveDeviceMapping(db(), deviceId, actionId);
  } catch (e) {
    console.warn("[build-status-store] SQLite saveDeviceMappingToStore failed:", e);
    throw e;
  }
}

function saveDeviceMapping(d: ReturnType<typeof getSqlite>, deviceId: string, actionId: string): void {
  d.prepare(
    `INSERT INTO device_action_mappings (device_id, action_id) VALUES (?, ?)
     ON CONFLICT(device_id) DO UPDATE SET action_id = excluded.action_id`
  ).run(deviceId, actionId);
}

/** Close the SQLite connection (e.g. for graceful shutdown). */
export async function closeBuildStatusStore(): Promise<void> {
  closeSqlite();
}
