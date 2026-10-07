/** Admin epochs API client (IMPL_SPEC_2026-10 "Admin epochs API"). All calls send `x-internal-key`. */
import type { Hex } from "viem";
import type { ApiLeaf } from "./tree";

export type EpochPayload = {
  epoch: number;
  root: Hex;
  feesBurnedUcld: string | number;
  totalLaneAUcld: string | number;
  totalLaneBUcld: string | number;
  treasuryUcld: string | number;
  leaves: ApiLeaf[];
  status: "closed" | "posted" | string;
};

export interface Api {
  /** POST /v1/admin/epochs/close -> newly closed epochs. */
  close(): Promise<EpochPayload[]>;
  /** GET /v1/admin/epochs?status=... */
  list(status: "closed" | "posted"): Promise<EpochPayload[]>;
  posted(epoch: number, root: Hex, txHash: Hex): Promise<void>;
  settled(epoch: number, txHash: Hex): Promise<void>;
  vetoed(epoch: number, reason: string, txHash?: Hex): Promise<void>;
}

export function createApi(baseUrl: string, internalKey: string, fetchFn: typeof fetch = fetch): Api {
  const base = baseUrl.replace(/\/$/, "");
  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetchFn(`${base}/v1${path}`, {
      method,
      headers: { "content-type": "application/json", "x-internal-key": internalKey },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`API ${res.status} ${method} /v1${path}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }
  return {
    async close() {
      const r = await call<{ epochs?: EpochPayload[] }>("POST", "/admin/epochs/close", {});
      return r.epochs ?? [];
    },
    async list(status) {
      const r = await call<{ epochs?: EpochPayload[] }>("GET", `/admin/epochs?status=${status}`);
      return r.epochs ?? [];
    },
    async posted(epoch, root, txHash) {
      await call("POST", `/admin/epochs/${epoch}/posted`, { root, txHash });
    },
    async settled(epoch, txHash) {
      await call("POST", `/admin/epochs/${epoch}/settled`, { txHash });
    },
    async vetoed(epoch, reason, txHash) {
      await call("POST", `/admin/epochs/${epoch}/vetoed`, txHash ? { reason, txHash } : { reason });
    },
  };
}
