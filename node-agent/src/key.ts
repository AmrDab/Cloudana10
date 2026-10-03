import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem";

/** Load this node's key from node-agent/.data/<name>.json, creating it on first run. */
export function loadOrCreateKey(name: string): PrivateKeyAccount {
  return privateKeyToAccount(loadOrCreatePrivateKey(name));
}

/** The raw private key behind loadOrCreateKey (needed to open sealed secrets). */
export function loadOrCreatePrivateKey(name: string): `0x${string}` {
  const dataDir = fileURLToPath(new URL("../.data/", import.meta.url));
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const file = `${dataDir}${name}.json`;

  let privateKey: `0x${string}`;
  if (existsSync(file)) {
    privateKey = JSON.parse(readFileSync(file, "utf8")).privateKey;
  } else {
    privateKey = generatePrivateKey();
    writeFileSync(file, JSON.stringify({ privateKey }, null, 2), { mode: 0o600 });
    try {
      chmodSync(file, 0o600); // best-effort; no-op on filesystems that don't support unix perms
    } catch {}
  }
  return privateKey;
}
