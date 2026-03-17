/**
 * Akash Network Bridge — bootstrap compute backend.
 *
 * Converts Cloudana ParsedManifest → Akash SDL YAML, then deploys via Akash
 * REST API (LCD). This gives Cloudana operational servers immediately by
 * piggybacking on Akash's 100+ existing providers.
 *
 * Enable with: AKASH_BRIDGE_ENABLED=true
 * Requires:    AKASH_MNEMONIC, AKASH_RPC_URL
 */
import { log } from "../lib/logger.js";
import type { ParsedManifest, ParsedService } from "./sdl-parser.service.js";

const L = log.orchestratorEvent;

// ─── Config ─────────────────────────────────────────────────────────────────
const AKASH_ENABLED = process.env.AKASH_BRIDGE_ENABLED === "true";
const AKASH_RPC = process.env.AKASH_RPC_URL ?? "https://rpc.akashnet.net:443";
const AKASH_LCD = process.env.AKASH_LCD_URL ?? "https://rest.cosmos.directory/akash";
const AKASH_CHAIN_ID = process.env.AKASH_CHAIN_ID ?? "akashnet-2";
const AKASH_MNEMONIC = process.env.AKASH_MNEMONIC ?? "";
const AKASH_GAS_PRICE = process.env.AKASH_GAS_PRICE ?? "0.025uakt";
const AKASH_DSEQ_STORE = new Map<string, AkashLease>(); // workloadId → lease info

// ─── Types ──────────────────────────────────────────────────────────────────
export interface AkashLease {
  dseq: string;
  gseq: number;
  oseq: number;
  provider: string;
  status: "open" | "active" | "closed";
  createdAt: number;
  forwardedPorts?: Array<{ host: number; externalPort: number; proto: string }>;
}

interface AkashDeploymentResult {
  success: boolean;
  lease?: AkashLease;
  error?: string;
}

// ─── SDL Builder ────────────────────────────────────────────────────────────

/**
 * Convert a Cloudana ParsedManifest back into Akash SDL YAML.
 */
export function buildAkashSDL(parsed: ParsedManifest): string {
  const services: Record<string, any> = {};
  const profiles: { compute: Record<string, any>; placement: Record<string, any> } = {
    compute: {},
    placement: {
      "cloudana-deploy": {
        pricing: {} as Record<string, any>,
      },
    },
  };
  const deployment: Record<string, any> = {};

  for (const svc of parsed.services) {
    // Service definition
    services[svc.name] = {
      image: svc.image,
      ...(svc.command && { command: svc.command }),
      ...(svc.args && { args: svc.args }),
      ...(svc.env && svc.env.length > 0 && { env: svc.env }),
      expose: svc.expose.map((e) => ({
        port: e.port,
        as: e.as,
        to: [{ global: e.global ?? true }],
      })),
    };

    // Compute profile
    const profileName = svc.name;
    profiles.compute[profileName] = {
      resources: {
        cpu: { units: svc.resources.cpu.units / 1000 }, // Akash uses whole cores
        memory: { size: svc.resources.memory.size },
        storage: svc.resources.storage.map((s) => ({
          size: s.size,
          ...(s.class && { class: s.class }),
        })),
        ...(svc.resources.gpu &&
          svc.resources.gpu.units > 0 && {
            gpu: {
              units: svc.resources.gpu.units,
              attributes: {
                vendor: { nvidia: [{ model: "*" }] },
              },
            },
          }),
      },
    };

    // Placement pricing (minimum bid)
    profiles.placement["cloudana-deploy"].pricing[profileName] = {
      denom: "uakt",
      amount: 1000, // ~$0.10/month minimum
    };

    // Deployment section
    deployment[svc.name] = {
      "cloudana-deploy": {
        profile: profileName,
        count: 1,
      },
    };
  }

  const sdl = {
    version: "2.0",
    services,
    profiles,
    deployment,
  };

  // Serialize to YAML-like JSON (Akash accepts JSON SDL)
  return JSON.stringify(sdl, null, 2);
}

// ─── Akash Deployment Flow ──────────────────────────────────────────────────

/**
 * Full Akash deployment pipeline:
 * 1. Create deployment tx → broadcast
 * 2. Wait for bids (~15-30s)
 * 3. Accept best bid → create lease
 * 4. Send manifest to winning provider
 */
export async function deployToAkash(
  workloadId: string,
  instanceId: string,
  parsed: ParsedManifest,
): Promise<AkashDeploymentResult> {
  if (!AKASH_ENABLED) {
    return { success: false, error: "Akash bridge disabled (set AKASH_BRIDGE_ENABLED=true)" };
  }

  if (!AKASH_MNEMONIC) {
    return { success: false, error: "AKASH_MNEMONIC not configured" };
  }

  const sdlJson = buildAkashSDL(parsed);
  L.info(`[Akash Bridge] Deploying workload ${workloadId}/${instanceId}`);
  L.info(`[Akash Bridge] SDL: ${sdlJson.slice(0, 200)}...`);

  try {
    // Step 1: Create deployment
    L.info(`[Akash Bridge] Step 1/4: Creating deployment on Akash chain...`);
    const deployResult = await createAkashDeployment(sdlJson, parsed);
    if (!deployResult.dseq) {
      return { success: false, error: "Failed to create Akash deployment" };
    }
    L.info(`[Akash Bridge] Deployment created: dseq=${deployResult.dseq}`);

    // Step 2: Wait for bids
    L.info(`[Akash Bridge] Step 2/4: Waiting for bids (30s)...`);
    const bids = await waitForBids(deployResult.dseq, deployResult.owner);
    if (bids.length === 0) {
      L.error(`[Akash Bridge] No bids received for dseq=${deployResult.dseq}`);
      await closeAkashDeployment(deployResult.dseq, deployResult.owner);
      return { success: false, error: "No Akash providers bid on this workload" };
    }
    L.info(`[Akash Bridge] Received ${bids.length} bid(s)`);

    // Step 3: Accept best bid (lowest price)
    const bestBid = bids.sort((a, b) => a.price - b.price)[0];
    L.info(`[Akash Bridge] Step 3/4: Accepting bid from ${bestBid.provider} (${bestBid.price} uakt/block)`);
    const lease = await acceptBid(deployResult.dseq, deployResult.owner, bestBid);
    if (!lease) {
      return { success: false, error: "Failed to accept bid / create lease" };
    }

    // Step 4: Send manifest to provider
    L.info(`[Akash Bridge] Step 4/4: Sending manifest to provider ${bestBid.provider}...`);
    const sent = await sendManifestToProvider(
      deployResult.dseq,
      deployResult.owner,
      bestBid.provider,
      parsed,
    );
    if (!sent) {
      return { success: false, error: "Failed to send manifest to Akash provider" };
    }

    const akashLease: AkashLease = {
      dseq: deployResult.dseq,
      gseq: 1,
      oseq: 1,
      provider: bestBid.provider,
      status: "active",
      createdAt: Date.now(),
    };

    // Store lease for status polling
    AKASH_DSEQ_STORE.set(`${workloadId}-${instanceId}`, akashLease);

    L.success(`[Akash Bridge] ✅ Workload ${workloadId}/${instanceId} deployed on Akash!`);
    L.success(`[Akash Bridge]    dseq=${akashLease.dseq} provider=${akashLease.provider}`);

    return { success: true, lease: akashLease };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    L.error(`[Akash Bridge] ❌ Deployment failed: ${msg}`);
    return { success: false, error: msg };
  }
}

// ─── Akash Chain Interactions (via LCD REST API) ────────────────────────────

interface DeploymentCreateResult {
  dseq: string;
  owner: string;
}

interface AkashBid {
  provider: string;
  price: number;
  gseq: number;
  oseq: number;
}

/**
 * Create a deployment on Akash chain.
 * Uses the LCD (REST) endpoint to broadcast a MsgCreateDeployment tx.
 */
async function createAkashDeployment(
  sdlJson: string,
  parsed: ParsedManifest,
): Promise<DeploymentCreateResult> {
  // For the bootstrap phase, use the Akash CLI or Console API
  // to create deployments. This is a simplified version that
  // calls the Akash REST API directly.

  const { DirectSecp256k1HdWallet } = await import("@cosmjs/proto-signing");
  const { SigningStargateClient } = await import("@cosmjs/stargate");

  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(AKASH_MNEMONIC, {
    prefix: "akash",
  });
  const [account] = await wallet.getAccounts();
  const owner = account.address;

  const client = await SigningStargateClient.connectWithSigner(AKASH_RPC, wallet, {
    gasPrice: { amount: "0.025", denom: "uakt" } as any,
  });

  // Get next dseq from account sequence
  const accountInfo = await client.getAccount(owner);
  const dseq = String(Date.now()); // Unique deployment sequence

  // Build deposit (minimum 5 AKT = 5000000 uakt)
  const deposit = { denom: "uakt", amount: "5000000" };

  // Build the deployment message
  // Note: In production, use @akashnetwork/akash-api for proper message types
  const msg = {
    typeUrl: "/akash.deployment.v1beta3.MsgCreateDeployment",
    value: {
      id: { owner, dseq },
      groups: buildDeploymentGroups(parsed),
      deposit,
      depositor: owner,
    },
  };

  L.info(`[Akash Chain] Broadcasting MsgCreateDeployment from ${owner}`);

  const result = await client.signAndBroadcast(owner, [msg], "auto");

  if (result.code !== 0) {
    throw new Error(`Deployment tx failed: code=${result.code} log=${result.rawLog}`);
  }

  L.success(`[Akash Chain] Deployment tx confirmed: hash=${result.transactionHash}`);

  return { dseq, owner };
}

/**
 * Build Akash deployment groups from ParsedManifest.
 */
function buildDeploymentGroups(parsed: ParsedManifest): any[] {
  const resources = parsed.services.map((svc) => ({
    resource: {
      id: 1,
      cpu: { units: { val: String(svc.resources.cpu.units) } },
      memory: { quantity: { val: String(parseSize(svc.resources.memory.size)) } },
      storage: svc.resources.storage.map((s) => ({
        quantity: { val: String(parseSize(s.size)) },
        name: "default",
        attributes: [],
      })),
      gpu: svc.resources.gpu ? { units: { val: String(svc.resources.gpu.units) } } : undefined,
      endpoints: svc.expose.map((e) => ({
        kind: e.global ? 1 : 0, // SHARED_HTTP = 1
        sequence_number: 0,
      })),
    },
    count: 1,
    price: { denom: "uakt", amount: "1000" },
  }));

  return [
    {
      name: "cloudana",
      requirements: {
        signed_by: { all_of: [], any_of: [] },
        attributes: [],
      },
      resources,
    },
  ];
}

/** Parse size strings like "512Mi", "1Gi" to bytes */
function parseSize(size: string): number {
  const match = size.match(/^(\d+(?:\.\d+)?)\s*(gi?b?|mi?b?|ti?b?|ki?b?)?$/i);
  if (!match) return 512 * 1024 * 1024;
  const n = parseFloat(match[1]);
  const u = (match[2] || "mi").toLowerCase();
  if (u.startsWith("t")) return Math.floor(n * 1024 ** 4);
  if (u.startsWith("g")) return Math.floor(n * 1024 ** 3);
  if (u.startsWith("m")) return Math.floor(n * 1024 ** 2);
  if (u.startsWith("k")) return Math.floor(n * 1024);
  return Math.floor(n);
}

/**
 * Poll for bids on a deployment (waits up to 30 seconds).
 */
async function waitForBids(dseq: string, owner: string): Promise<AkashBid[]> {
  const maxWait = 30_000;
  const pollInterval = 5_000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    try {
      const url = `${AKASH_LCD}/akash/market/v1beta4/bids/list?filters.owner=${owner}&filters.dseq=${dseq}&filters.state=open`;
      const res = await fetch(url);
      if (!res.ok) {
        L.warn(`[Akash Bridge] Bid query failed: ${res.status}`);
        await sleep(pollInterval);
        continue;
      }

      const data = (await res.json()) as { bids?: Array<{ bid: { bid_id: { provider: string; dseq: string; gseq: number; oseq: number }; price: { amount: string } } }> };
      const bids = (data.bids ?? []).map((b) => ({
        provider: b.bid.bid_id.provider,
        price: parseInt(b.bid.price.amount, 10),
        gseq: b.bid.bid_id.gseq,
        oseq: b.bid.bid_id.oseq,
      }));

      if (bids.length > 0) return bids;
    } catch (e) {
      L.warn(`[Akash Bridge] Bid poll error: ${e instanceof Error ? e.message : e}`);
    }

    await sleep(pollInterval);
  }

  return [];
}

/**
 * Accept a bid and create a lease.
 */
async function acceptBid(
  dseq: string,
  owner: string,
  bid: AkashBid,
): Promise<boolean> {
  const { DirectSecp256k1HdWallet } = await import("@cosmjs/proto-signing");
  const { SigningStargateClient } = await import("@cosmjs/stargate");

  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(AKASH_MNEMONIC, {
    prefix: "akash",
  });

  const client = await SigningStargateClient.connectWithSigner(AKASH_RPC, wallet);

  const msg = {
    typeUrl: "/akash.market.v1beta4.MsgCreateLease",
    value: {
      bid_id: {
        owner,
        dseq,
        gseq: bid.gseq,
        oseq: bid.oseq,
        provider: bid.provider,
      },
    },
  };

  const result = await client.signAndBroadcast(owner, [msg], "auto");
  if (result.code !== 0) {
    L.error(`[Akash Chain] CreateLease failed: ${result.rawLog}`);
    return false;
  }

  L.success(`[Akash Chain] Lease created: hash=${result.transactionHash}`);
  return true;
}

/**
 * Send manifest to the winning Akash provider.
 */
async function sendManifestToProvider(
  dseq: string,
  owner: string,
  providerUrl: string,
  parsed: ParsedManifest,
): Promise<boolean> {
  // Akash providers expose a REST API for manifest submission
  // The URL format is: https://{provider}/deployment/{dseq}/manifest
  const manifestUrl = `${providerUrl}/deployment/${dseq}/manifest`;

  const manifest = parsed.services.map((svc) => ({
    name: svc.name,
    image: svc.image,
    command: svc.command,
    args: svc.args,
    env: svc.env?.map((e) => {
      const [key, ...rest] = e.split("=");
      return { key, value: rest.join("=") };
    }),
    resources: {
      cpu: { units: svc.resources.cpu.units },
      memory: { size: parseSize(svc.resources.memory.size).toString() },
      storage: svc.resources.storage.map((s) => ({
        size: parseSize(s.size).toString(),
      })),
    },
    expose: svc.expose.map((e) => ({
      port: e.port,
      externalPort: e.as,
      proto: "TCP",
      service: svc.name,
      global: e.global ?? true,
      hosts: null,
    })),
    count: 1,
  }));

  try {
    const res = await fetch(manifestUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(manifest),
    });

    if (!res.ok) {
      const text = await res.text();
      L.error(`[Akash Bridge] Manifest send failed: ${res.status} ${text}`);
      return false;
    }

    L.success(`[Akash Bridge] Manifest sent to provider successfully`);
    return true;
  } catch (e) {
    L.error(`[Akash Bridge] Manifest send error: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

/**
 * Close an Akash deployment (cleanup on failure).
 */
async function closeAkashDeployment(dseq: string, owner: string): Promise<void> {
  try {
    const { DirectSecp256k1HdWallet } = await import("@cosmjs/proto-signing");
    const { SigningStargateClient } = await import("@cosmjs/stargate");

    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(AKASH_MNEMONIC, {
      prefix: "akash",
    });
    const client = await SigningStargateClient.connectWithSigner(AKASH_RPC, wallet);

    const msg = {
      typeUrl: "/akash.deployment.v1beta3.MsgCloseDeployment",
      value: { id: { owner, dseq } },
    };

    await client.signAndBroadcast(owner, [msg], "auto");
    L.info(`[Akash Bridge] Deployment ${dseq} closed`);
  } catch (e) {
    L.warn(`[Akash Bridge] Failed to close deployment ${dseq}: ${e}`);
  }
}

// ─── Status / Helpers ───────────────────────────────────────────────────────

/** Check if Akash bridge is enabled and configured */
export function isAkashBridgeReady(): boolean {
  return AKASH_ENABLED && !!AKASH_MNEMONIC;
}

/** Get stored lease info for a workload */
export function getAkashLease(workloadId: string, instanceId: string): AkashLease | undefined {
  return AKASH_DSEQ_STORE.get(`${workloadId}-${instanceId}`);
}

/** Query lease status from Akash LCD */
export async function queryLeaseStatus(lease: AkashLease): Promise<string> {
  try {
    const url = `${AKASH_LCD}/akash/market/v1beta4/leases/list?filters.dseq=${lease.dseq}&filters.provider=${lease.provider}&filters.state=active`;
    const res = await fetch(url);
    if (!res.ok) return "unknown";
    const data = (await res.json()) as { leases?: Array<{ lease: { state: string } }> };
    return data.leases?.[0]?.lease?.state ?? "closed";
  } catch {
    return "unknown";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
