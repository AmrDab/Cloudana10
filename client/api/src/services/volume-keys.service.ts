/**
 * Volume keys of encrypted workstation volumes (docs/WORKSTATIONS.md §10.3, docs/TRUST_TIERS.md §6 "Disk").
 *
 * One key per deployment per node — a volume lives on one node, and a re-queued machine starts a new volume on its new
 * node. The first start instruction to a node makes 32 random bytes, seals them to that node's public key bound to the
 * deployment (lib/sealed.ts sealV2 with volumeKeyAad), stores only the sealed payload and forgets the plaintext. Every
 * later start to that node carries the same payload, so a restart on the same node reopens the same volume. Only that
 * node's private key opens it; the node keeps no copy (node-agent/src/volumes.ts).
 */
import { getD1 } from "../lib/storage.js";
import { newVolumeKey, sealV2, volumeKeyAad } from "../lib/sealed.js";
import { nodePubkey } from "./deployments.service.js";

const read = (id: string, node: string) =>
  getD1().prepare("SELECT sealed FROM deployment_volume_keys WHERE deployment_id = ? AND node = ?").bind(id, node).first<{ sealed: string }>();

/** The sealed volume key for deployment `id` on `node`, made on first use; null when the node has no public key. */
export async function volumeKeyFor(id: string, node: string, now = Date.now()): Promise<string | null> {
  const stored = await read(id, node);
  if (stored) return stored.sealed;
  const pubkey = await nodePubkey(node);
  if (!pubkey) return null;
  const sealed = sealV2(pubkey, newVolumeKey(), volumeKeyAad(id));
  await getD1()
    .prepare("INSERT OR IGNORE INTO deployment_volume_keys (deployment_id, node, sealed, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, node, sealed, now)
    .run();
  // Two heartbeats may race to make one: whichever row landed is the key, for both.
  return (await read(id, node))?.sealed ?? null;
}
