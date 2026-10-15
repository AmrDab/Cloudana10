/**
 * Job artifacts (docs/V4_STORAGE_PHASE1_CONTRACT.md §A): the R2 bucket `cloudana-artifacts` on Workers (binding
 * ARTIFACTS), or an in-memory store under tests. Unset → finished jobs keep their matrices in D1.
 */
export interface ArtifactStore {
  put(key: string, body: string | Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

let store: ArtifactStore | null = null;

export function setArtifactStore(s: ArtifactStore | null): void {
  store = s;
}

export function getArtifactStore(): ArtifactStore | null {
  return store;
}

export function r2Artifacts(bucket: R2Bucket): ArtifactStore {
  return {
    async put(key, body) {
      await bucket.put(key, body);
    },
    async get(key) {
      const obj = await bucket.get(key);
      return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}

export function memoryArtifacts(): ArtifactStore & { keys(): string[] } {
  const m = new Map<string, Uint8Array>();
  return {
    async put(key, body) {
      m.set(key, typeof body === "string" ? new TextEncoder().encode(body) : body);
    },
    async get(key) {
      return m.get(key) ?? null;
    },
    async delete(key) {
      m.delete(key);
    },
    keys: () => [...m.keys()],
  };
}
