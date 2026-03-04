/**
 * Build status persistence using MongoDB (shared connection via lib/mongo).
 */
import type { Collection } from "mongodb";
import { getDb, closeMongo } from "../lib/mongo.js";
import type { BuildProviderStatusResponse } from "../schemas/build-provider.schema.js";

export interface BuildStatusStoreData {
  version: number;
  builds: Record<string, BuildProviderStatusResponse>;
  deviceIdToActionId: Record<string, string>;
}

const BUILD_STATUSES_COLLECTION = "build_statuses";
const DEVICE_ACTION_MAPPINGS_COLLECTION = "device_action_mappings";

async function buildStatusesCollection(): Promise<Collection<BuildProviderStatusResponse & { _id: string }>> {
  const d = await getDb();
  return d.collection(BUILD_STATUSES_COLLECTION) as Collection<BuildProviderStatusResponse & { _id: string }>;
}

async function deviceMappingsCollection(): Promise<Collection<{ _id: string; actionId: string }>> {
  const d = await getDb();
  return d.collection(DEVICE_ACTION_MAPPINGS_COLLECTION);
}

/** Load persisted build status and device_id → action_id mapping from MongoDB. */
export async function loadBuildStatusStore(): Promise<BuildStatusStoreData> {
  try {
    const [buildsColl, mappingsColl] = await Promise.all([
      buildStatusesCollection(),
      deviceMappingsCollection(),
    ]);
    const [buildDocs, mappingDocs] = await Promise.all([
      buildsColl.find({}).toArray(),
      mappingsColl.find({}).toArray(),
    ]);
    const builds: Record<string, BuildProviderStatusResponse> = {};
    for (const doc of buildDocs) {
      const { _id, ...rest } = doc;
      if (_id && rest.status) builds[_id] = { ...rest, id: _id } as BuildProviderStatusResponse;
    }
    const deviceIdToActionId: Record<string, string> = {};
    for (const doc of mappingDocs) {
      if (doc._id && doc.actionId) deviceIdToActionId[doc._id] = doc.actionId;
    }
    return { version: 1, builds, deviceIdToActionId };
  } catch (e) {
    console.warn("[build-status-store] MongoDB load failed, returning empty store:", e);
    return { version: 1, builds: {}, deviceIdToActionId: {} };
  }
}

/** Persist one terminal build (completed/failed) and related device_id mapping to MongoDB. */
export async function saveBuildToStore(
  actionId: string,
  action: BuildProviderStatusResponse,
  currentDeviceIdToActionId: Record<string, string>
): Promise<void> {
  if (action.status !== "completed" && action.status !== "failed") return;
  try {
    const buildsColl = await buildStatusesCollection();
    const doc = { _id: actionId, ...action };
    await buildsColl.replaceOne({ _id: actionId }, doc, { upsert: true });
    if (action.device_id) {
      const mappingsColl = await deviceMappingsCollection();
      await mappingsColl.updateOne(
        { _id: action.device_id },
        { $set: { actionId } },
        { upsert: true }
      );
    }
    // Optionally persist any extra mappings from current map (e.g. from same build)
    const mappingsColl = await deviceMappingsCollection();
    const toUpsert = Object.entries(currentDeviceIdToActionId).filter(([, aid]) => aid === actionId);
    if (toUpsert.length > 0) {
      await Promise.all(
        toUpsert.map(([deviceId, aid]) =>
          mappingsColl.updateOne({ _id: deviceId }, { $set: { actionId: aid } }, { upsert: true })
        )
      );
    }
  } catch (e) {
    console.warn("[build-status-store] MongoDB saveBuildToStore failed:", e);
    throw e;
  }
}

/** Persist only device_id → action_id mapping to MongoDB. */
export async function saveDeviceMappingToStore(deviceId: string, actionId: string): Promise<void> {
  try {
    const mappingsColl = await deviceMappingsCollection();
    await mappingsColl.updateOne(
      { _id: deviceId },
      { $set: { actionId } },
      { upsert: true }
    );
  } catch (e) {
    console.warn("[build-status-store] MongoDB saveDeviceMappingToStore failed:", e);
    throw e;
  }
}

/** Close MongoDB connection (e.g. for graceful shutdown). */
export async function closeBuildStatusStore(): Promise<void> {
  await closeMongo();
}
