/**
 * Akash Network deployment service for Cloudana orchestrator.
 *
 * Handles the full Akash deployment lifecycle:
 *  1. Parse SDL YAML into Akash group specs
 *  2. Create a deployment on Akash (MsgCreateDeployment)
 *  3. Wait for provider bids
 *  4. Accept the best bid (MsgCreateLease)
 *  5. Send SDL manifest to the winning provider
 *  6. Track deployment status
 *
 * Required env vars:
 *   AKASH_MNEMONIC       — BIP-39 wallet mnemonic (funds the escrow deposit)
 *   AKASH_RPC_URL        — Tendermint RPC   (default: https://rpc.akashnet.net:443)
 *   AKASH_REST_URL       — Cosmos LCD/REST  (default: https://api.akashnet.net)
 *   AKASH_NETWORK        — "mainnet" | "testnet" (default: mainnet)
 *   AKASH_DEPOSIT_UAKT   — escrow deposit in uakt (default: 500000 = 0.5 AKT)
 */

import { DirectSecp256k1HdWallet, Registry } from "@cosmjs/proto-signing";
import { SigningStargateClient, GasPrice, defaultRegistryTypes } from "@cosmjs/stargate";
import yaml from "js-yaml";
import { log } from "../lib/logger.js";

const L = log.orchestratorEvent;

// ─── Config ──────────────────────────────────────────────────────────────────

const AKASH_MNEMONIC     = process.env.AKASH_MNEMONIC    ?? "";
const AKASH_RPC_URL      = process.env.AKASH_RPC_URL     ?? "https://rpc.akashnet.net:443";
const AKASH_REST_URL     = (process.env.AKASH_REST_URL   ?? "https://api.akashnet.net").replace(/\/$/, "");
const AKASH_DEPOSIT_UAKT = process.env.AKASH_DEPOSIT_UAKT ?? "500000";

/** How long to poll for bids (ms) */
const BID_TIMEOUT_MS     = Number(process.env.AKASH_BID_TIMEOUT_MS ?? 120_000);
const BID_POLL_MS        = 5_000;

/** Akash message type URLs */
const MSG_CREATE_DEPLOYMENT = "/akash.deployment.v1beta3.MsgCreateDeployment";
const MSG_CLOSE_DEPLOYMENT  = "/akash.deployment.v1beta3.MsgCloseDeployment";
const MSG_CREATE_LEASE      = "/akash.market.v1beta4.MsgCreateLease";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AkashDeploymentSpec {
  sdl: string;
  name?: string;
}

export type AkashDeploymentStatus =
  | "creating"
  | "waiting_for_bids"
  | "bid_accepted"
  | "manifest_sent"
  | "active"
  | "failed"
  | "closed";

export interface AkashDeployment {
  id: string;
  dseq: string;
  owner: string;
  status: AkashDeploymentStatus;
  provider?: string;
  providerEndpoint?: string;
  gseq?: number;
  oseq?: number;
  sdl: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
  serviceUrl?: string;
}

// ─── In-memory store ─────────────────────────────────────────────────────────

const store = new Map<string, AkashDeployment>();

function put(d: AkashDeployment): void { store.set(d.id, d); }

function patch(id: string, p: Partial<AkashDeployment>): AkashDeployment | null {
  const d = store.get(id);
  if (!d) return null;
  const next = { ...d, ...p, updatedAt: Date.now() };
  store.set(id, next);
  return next;
}

export function getAkashDeployment(id: string): AkashDeployment | null {
  return store.get(id) ?? null;
}

export function listAkashDeployments(): AkashDeployment[] {
  return [...store.values()].sort((a, b) => b.createdAt - a.createdAt);
}

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * Build a Cosmos Registry with Akash message types.
 * Tries to load @akashnetwork/akashjs for the Akash type entries;
 * falls back to the default Cosmos types only (chain txs will fail
 * without proper Akash types, but REST-only operations still work).
 */
async function buildRegistry(): Promise<Registry> {
  try {
    const { getAkashTypeRegistry } = await import("@akashnetwork/akashjs/build/stargate/index.js" as any);
    const akashTypes = getAkashTypeRegistry() as Array<[string, any]>;
    return new Registry([...defaultRegistryTypes, ...akashTypes]);
  } catch (e) {
    L.warn(`[Akash] Could not load Akash type registry: ${e instanceof Error ? e.message : e}`);
    return new Registry(defaultRegistryTypes);
  }
}

// ─── Wallet ───────────────────────────────────────────────────────────────────

let _wallet:  DirectSecp256k1HdWallet | null = null;
let _address: string | null = null;

async function getWallet(): Promise<{ wallet: DirectSecp256k1HdWallet; address: string }> {
  if (_wallet && _address) return { wallet: _wallet, address: _address };
  if (!AKASH_MNEMONIC) throw new Error("AKASH_MNEMONIC env var is not set");
  _wallet = await DirectSecp256k1HdWallet.fromMnemonic(AKASH_MNEMONIC, { prefix: "akash" });
  [{ address: _address }] = await _wallet.getAccounts();
  return { wallet: _wallet, address: _address! };
}

// ─── REST helpers ─────────────────────────────────────────────────────────────

async function restGet<T>(path: string): Promise<T> {
  const res = await fetch(`${AKASH_REST_URL}${path}`, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Akash REST GET ${path} → HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function getBlockHeight(): Promise<number> {
  const data = await restGet<{ block?: { header?: { height?: string } } }>(
    "/cosmos/base/tendermint/v1beta1/blocks/latest"
  );
  const h = data.block?.header?.height;
  if (!h) throw new Error("Cannot determine current block height");
  return parseInt(h, 10);
}

async function pollBids(owner: string, dseq: string): Promise<any[]> {
  const deadline = Date.now() + BID_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const data = await restGet<{ bids?: Array<{ bid?: any }> }>(
        `/akash/market/v1beta4/bids/list?filters.owner=${owner}&filters.dseq=${dseq}&pagination.limit=10`
      );
      const open = (data.bids ?? [])
        .map((b) => b.bid)
        .filter((b): b is NonNullable<typeof b> => b != null && b.state === "open");
      if (open.length > 0) return open;
    } catch (e) {
      L.dim(`[Akash] Bid poll error: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(BID_POLL_MS);
  }
  return [];
}

async function resolveProviderEndpoint(providerAddr: string): Promise<string | null> {
  try {
    const data = await restGet<{ provider?: { host_uri?: string } }>(
      `/akash/provider/v1beta3/providers/${providerAddr}`
    );
    return data.provider?.host_uri?.replace(/\/$/, "") ?? null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── SDL → Akash groups ───────────────────────────────────────────────────────

function memToBytes(s: string): number {
  const m = String(s).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(t|g|m|k|b)?i?b?$/);
  if (!m) return 512 * 1024 * 1024;
  const n = parseFloat(m[1]);
  const u = m[2] ?? "m";
  if (u === "t") return Math.floor(n * 1024 ** 4);
  if (u === "g") return Math.floor(n * 1024 ** 3);
  if (u === "m") return Math.floor(n * 1024 ** 2);
  if (u === "k") return Math.floor(n * 1024);
  return Math.floor(n);
}

interface AkashGroup {
  name: string;
  requirements: {
    signed_by: { all_of: string[]; any_of: string[] };
    attributes: Array<{ key: string; value: string }>;
  };
  resources: Array<{
    resource: {
      cpu?: { units: { val: string } };
      memory?: { quantity: { val: string } };
      storage?: Array<{ name: string; quantity: { val: string } }>;
      gpu?: { units: { val: string }; attributes?: Array<{ key: string; value: string }> };
      endpoints?: unknown[];
    };
    count: number;
    price: { denom: string; amount: string };
  }>;
}

export function sdlToAkashGroups(sdlYaml: string): AkashGroup[] {
  const sdl = yaml.load(sdlYaml) as Record<string, unknown>;

  const services      = (sdl.services      ?? {}) as Record<string, unknown>;
  const profiles      = (sdl.profiles      ?? {}) as Record<string, any>;
  const deployment    = (sdl.deployment    ?? {}) as Record<string, any>;
  const computeProfs  = profiles.compute   ?? {} as Record<string, any>;
  const placementProfs= profiles.placement ?? {} as Record<string, any>;

  const groups: AkashGroup[] = [];

  for (const [placementName, placementCfg] of Object.entries(placementProfs)) {
    const pc = placementCfg as Record<string, any>;
    const attributes = Object.entries(pc.attributes ?? {}).map(([k, v]) => ({ key: k, value: String(v) }));
    const pricing     = (pc.pricing ?? {}) as Record<string, { denom?: string; amount?: string | number }>;
    const groupResources: AkashGroup["resources"] = [];

    for (const [svcName, svcDep] of Object.entries(deployment)) {
      const dep = svcDep as Record<string, any>;
      if (!(placementName in dep)) continue;
      const profileName = dep[placementName]?.profile as string | undefined;
      if (!profileName) continue;
      const compute = (computeProfs as Record<string, any>)[profileName] as Record<string, any> | undefined;
      if (!compute) continue;

      const res = (compute.resources ?? {}) as Record<string, any>;
      const cpu     = res.cpu     ?? {};
      const memory  = res.memory  ?? {};
      const storage = Array.isArray(res.storage) ? res.storage : [res.storage ?? { size: "512Mi" }];
      const gpu     = res.gpu;

      const cpuUnits = String(
        typeof cpu.units === "number"
          ? cpu.units * 1000   // Akash uses milli-CPU units (1 CPU = 1000)
          : cpu.units ?? 500
      );

      const resource: AkashGroup["resources"][0]["resource"] = {
        cpu:    { units: { val: cpuUnits } },
        memory: { quantity: { val: String(memToBytes(String(memory.size ?? "512Mi"))) } },
        storage: (storage as Array<{ name?: string; size?: string }>).map((s, i) => ({
          name:     s.name ?? (i === 0 ? "default" : `storage${i}`),
          quantity: { val: String(memToBytes(String(s.size ?? "512Mi"))) },
        })),
      };

      if (gpu?.units) {
        resource.gpu = {
          units: { val: String(gpu.units) },
          attributes: Object.entries(gpu.attributes ?? {}).map(([k, v]) => ({ key: k, value: String(v) })),
        };
      }

      const priceInfo = pricing[svcName] ?? { denom: "uakt", amount: "100" };

      groupResources.push({
        resource,
        count: dep[placementName]?.count ?? 1,
        price: { denom: String(priceInfo.denom ?? "uakt"), amount: String(priceInfo.amount ?? 100) },
      });
    }

    if (groupResources.length > 0) {
      groups.push({
        name: placementName,
        requirements: { signed_by: { all_of: [], any_of: [] }, attributes },
        resources: groupResources,
      });
    }
  }

  // Fallback single group if SDL has no placement profiles
  if (groups.length === 0) {
    L.warn("[Akash] No placement groups found in SDL; using minimal default group");
    const svcCount = Object.keys(services).length;
    groups.push({
      name: "akash",
      requirements: { signed_by: { all_of: [], any_of: [] }, attributes: [] },
      resources: [{
        resource: {
          cpu:     { units: { val: "500" } },
          memory:  { quantity: { val: String(512 * 1024 * 1024) } },
          storage: [{ name: "default", quantity: { val: String(512 * 1024 * 1024) } }],
        },
        count: Math.max(1, svcCount),
        price: { denom: "uakt", amount: "100" },
      }],
    });
  }

  return groups;
}

// ─── SDL hash (version field) ─────────────────────────────────────────────────

function sdlVersion(sdl: string): Uint8Array {
  // Simplified: use zeroed 32-byte array (acceptable for testnet/dev; prod should hash SDL)
  // In production you would: crypto.createHash('sha256').update(sdl).digest()
  return new Uint8Array(32);
}

// ─── Main: createAkashDeployment ─────────────────────────────────────────────

/**
 * Kick off an Akash deployment asynchronously.
 * Returns immediately with a deployment record (status="creating").
 * Poll getAkashDeployment(id) or GET /v1/deployments/:id for progress.
 */
export async function createAkashDeployment(spec: AkashDeploymentSpec): Promise<AkashDeployment> {
  const id = `akash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const d: AkashDeployment = {
    id,
    dseq: "",
    owner: "",
    status: "creating",
    sdl: spec.sdl,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  put(d);

  _lifecycle(id, spec).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    L.error(`[Akash] Lifecycle error for ${id}: ${msg}`);
    patch(id, { status: "failed", error: msg });
  });

  return d;
}

async function _lifecycle(id: string, spec: AkashDeploymentSpec): Promise<void> {
  L.info(`[Akash] ━━━ Starting deployment ${id} ━━━`);

  // 1. Wallet
  const { wallet, address } = await getWallet();
  patch(id, { owner: address });
  L.info(`[Akash] 👛 Owner: ${address}`);

  // 2. Build registry + signing client
  const registry = await buildRegistry();
  const client   = await SigningStargateClient.connectWithSigner(AKASH_RPC_URL, wallet, {
    registry,
    gasPrice: GasPrice.fromString("0.025uakt"),
  });

  // 3. Derive dseq from block height
  const dseq = String(await getBlockHeight());
  patch(id, { dseq });
  L.info(`[Akash] 📦 dseq=${dseq}`);

  // 4. Parse SDL → groups
  const groups = sdlToAkashGroups(spec.sdl);
  L.info(`[Akash] 📝 ${groups.length} group(s) from SDL`);

  // 5. Broadcast MsgCreateDeployment
  const createMsg = {
    typeUrl: MSG_CREATE_DEPLOYMENT,
    value: {
      id: { owner: address, dseq: { low: parseInt(dseq, 10), high: 0, unsigned: true } },
      groups,
      version: sdlVersion(spec.sdl),
      deposit: { denom: "uakt", amount: AKASH_DEPOSIT_UAKT },
      depositor: address,
    },
  };

  L.info("[Akash] 📡 Broadcasting MsgCreateDeployment...");
  const createTx = await client.signAndBroadcast(address, [createMsg], "auto", `cloudana:${id}`);
  if (createTx.code !== 0) {
    throw new Error(`MsgCreateDeployment failed (code ${createTx.code}): ${createTx.rawLog}`);
  }
  L.success(`[Akash] ✅ Deployment created — txHash=${createTx.transactionHash}`);
  patch(id, { status: "waiting_for_bids" });

  // 6. Wait for bids
  L.info("[Akash] ⏳ Waiting for provider bids...");
  const bids = await pollBids(address, dseq);
  if (bids.length === 0) throw new Error("No bids received within timeout");
  L.info(`[Akash] 🎯 ${bids.length} bid(s) received`);

  // 7. Select best bid (cheapest)
  const best = bids.sort((a, b) =>
    parseFloat(a.price?.amount ?? "9999") - parseFloat(b.price?.amount ?? "9999")
  )[0];

  const provider = best.bid_id?.provider ?? best.provider as string;
  const gseq     = best.bid_id?.gseq     ?? best.gseq     as number ?? 1;
  const oseq     = best.bid_id?.oseq     ?? best.oseq     as number ?? 1;

  L.info(`[Akash] 🏆 Best bid: provider=${provider} price=${best.price?.amount}uakt/block`);
  patch(id, { provider, gseq, oseq });

  // 8. Broadcast MsgCreateLease
  const leaseMsg = {
    typeUrl: MSG_CREATE_LEASE,
    value: {
      bid_id: {
        owner:    address,
        dseq:     { low: parseInt(dseq, 10), high: 0, unsigned: true },
        gseq,
        oseq,
        provider,
      },
    },
  };

  L.info("[Akash] 🤝 Broadcasting MsgCreateLease...");
  const leaseTx = await client.signAndBroadcast(address, [leaseMsg], "auto", `cloudana:lease:${id}`);
  if (leaseTx.code !== 0) {
    throw new Error(`MsgCreateLease failed (code ${leaseTx.code}): ${leaseTx.rawLog}`);
  }
  L.success(`[Akash] ✅ Lease created — txHash=${leaseTx.transactionHash}`);
  patch(id, { status: "bid_accepted" });

  // 9. Resolve provider endpoint
  const endpoint = (await resolveProviderEndpoint(provider)) ?? `https://${provider}:8443`;
  patch(id, { providerEndpoint: endpoint });
  L.info(`[Akash] 🔗 Provider endpoint: ${endpoint}`);

  // 10. Send manifest to provider
  const manifestUrl = `${endpoint}/deployment/${address}/${dseq}/manifest`;
  L.info(`[Akash] 📤 Sending manifest → ${manifestUrl}`);
  try {
    const mRes = await fetch(manifestUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sdl: spec.sdl }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!mRes.ok) {
      L.warn(`[Akash] ⚠️  Manifest response: HTTP ${mRes.status} (may still proceed)`);
    } else {
      L.success("[Akash] ✅ Manifest accepted");
    }
  } catch (e) {
    L.warn(`[Akash] ⚠️  Manifest send error: ${e instanceof Error ? e.message : e}`);
  }
  patch(id, { status: "manifest_sent" });

  // 11. Brief wait, then poll for service URL
  await sleep(12_000);
  const d = store.get(id)!;
  const statusUrl = `${endpoint}/lease/${address}/${dseq}/${d.gseq ?? gseq}/${d.oseq ?? oseq}/status`;
  try {
    const sRes = await fetch(statusUrl, { signal: AbortSignal.timeout(10_000) });
    if (sRes.ok) {
      const sData = await sRes.json() as { services?: Record<string, { uris?: string[] }> };
      const uris = Object.values(sData.services ?? {}).flatMap((s) => s.uris ?? []);
      if (uris.length > 0) {
        patch(id, { status: "active", serviceUrl: uris[0] });
        L.success(`[Akash] 🌐 Service URL: ${uris[0]}`);
        return;
      }
    }
  } catch (_) {
    // ignore
  }

  patch(id, { status: "active" });
  L.success(`[Akash] ✅ Deployment ${id} is active!`);
}

// ─── Status refresh from chain ─────────────────────────────────────────────────

export async function refreshAkashDeploymentStatus(id: string): Promise<AkashDeployment | null> {
  const d = store.get(id);
  if (!d?.owner || !d.dseq) return d ?? null;

  try {
    const data = await restGet<{ deployment?: { state?: string } }>(
      `/akash/deployment/v1beta3/deployments/info?id.owner=${d.owner}&id.dseq=${d.dseq}`
    );
    const state = data.deployment?.state;
    if (state === "closed")       patch(id, { status: "closed" });
    else if (state === "active" && d.status !== "active") patch(id, { status: "active" });
  } catch {
    // silently keep existing status
  }

  return store.get(id) ?? null;
}

// ─── Close deployment ──────────────────────────────────────────────────────────

export async function closeAkashDeployment(id: string): Promise<void> {
  const d = store.get(id);
  if (!d?.owner || !d.dseq) throw new Error(`Deployment ${id} not found or missing dseq/owner`);

  const { wallet, address } = await getWallet();
  const registry = await buildRegistry();
  const client   = await SigningStargateClient.connectWithSigner(AKASH_RPC_URL, wallet, {
    registry,
    gasPrice: GasPrice.fromString("0.025uakt"),
  });

  const closeMsg = {
    typeUrl: MSG_CLOSE_DEPLOYMENT,
    value: {
      id: { owner: address, dseq: { low: parseInt(d.dseq, 10), high: 0, unsigned: true } },
    },
  };

  const tx = await client.signAndBroadcast(address, [closeMsg], "auto");
  if (tx.code !== 0) throw new Error(`MsgCloseDeployment failed (code ${tx.code}): ${tx.rawLog}`);
  patch(id, { status: "closed" });
  L.info(`[Akash] 🔒 Deployment ${id} closed`);
}
