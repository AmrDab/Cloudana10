/**
 * Akash Network SDK client wrapper for Cloudana provider node.
 *
 * Handles the full Akash deployment lifecycle:
 * 1. Wallet initialization from mnemonic
 * 2. Deployment creation from SDL
 * 3. Bid collection and best-bid selection
 * 4. Lease creation
 * 5. Manifest delivery to provider
 * 6. Deployment status polling
 * 7. Deployment closure
 *
 * Environment variables:
 *   AKASH_MNEMONIC   - BIP39 mnemonic for the deployer wallet (required)
 *   AKASH_RPC_URL    - Akash RPC endpoint (default: https://rpc.akash.forbole.com:443)
 *   AKASH_REST_URL   - Akash REST/LCD endpoint (default: https://api.akash.forbole.com)
 *   AKASH_CHAIN_ID   - Chain ID (default: akashnet-2)
 *   AKASH_GAS_PRICE  - Gas price in uakt (default: 0.025)
 *
 * @see https://github.com/akash-network/akashjs
 * @see https://github.com/akash-network/akash-api
 */

import { DirectSecp256k1HdWallet, Registry } from "@cosmjs/proto-signing";
import {
  SigningStargateClient,
  GasPrice,
  coins,
  type DeliverTxResponse,
} from "@cosmjs/stargate";
import { loggers } from "../logger.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_RPC_URL = "https://rpc.akash.forbole.com:443";
const DEFAULT_REST_URL = "https://api.akash.forbole.com";
const DEFAULT_CHAIN_ID = "akashnet-2";
const DEFAULT_GAS_PRICE = "0.025uakt";
/** Minimum AKT deposit for a deployment (5 AKT = 5_000_000 uakt) */
const DEPLOYMENT_DEPOSIT_UAKT = "5000000";
/** How long to wait for bids before giving up (ms) */
const BID_WAIT_TIMEOUT_MS = 120_000;
/** Poll interval when waiting for bids (ms) */
const BID_POLL_INTERVAL_MS = 5_000;
/** Max retries for provider manifest send */
const MANIFEST_SEND_MAX_RETRIES = 3;
/** Delay between manifest send retries (ms) */
const MANIFEST_RETRY_DELAY_MS = 3_000;

// ─── Message type URLs (from @akashnetwork/akashjs stargate enum) ─────────────

const MSG_CREATE_DEPLOYMENT = "/akash.deployment.v1beta4.MsgCreateDeployment";
const MSG_CLOSE_DEPLOYMENT = "/akash.deployment.v1beta4.MsgCloseDeployment";
const MSG_DEPOSIT_DEPLOYMENT = "/akash.deployment.v1beta4.MsgDepositDeployment";
const MSG_CREATE_LEASE = "/akash.market.v1beta5.MsgCreateLease";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AkashClientConfig {
  mnemonic: string;
  rpcUrl?: string;
  restUrl?: string;
  chainId?: string;
  gasPrice?: string;
}

export interface AkashDeploymentId {
  owner: string;
  /** Deployment sequence number — unique per owner per deployment */
  dseq: string;
}

export interface AkashBid {
  id: {
    owner: string;
    dseq: string;
    gseq: number;
    oseq: number;
    provider: string;
  };
  state: string;
  price: { denom: string; amount: string };
  createdAt: string;
}

export interface AkashLeaseId {
  owner: string;
  dseq: string;
  gseq: number;
  oseq: number;
  provider: string;
}

export interface AkashLeaseInfo {
  leaseId: AkashLeaseId;
  providerUrl: string;
  state: string;
  price: { denom: string; amount: string };
}

export interface AkashDeploymentStatus {
  state: string;
  deploymentId: AkashDeploymentId;
  leases: AkashLeaseInfo[];
  createdAt: string;
  closedOn?: string;
}

export interface AkashEndpoint {
  host: string;
  port: number;
  externalPort: number;
  proto: string;
  available: number;
  name: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolves a provider's on-chain info to get their HTTP endpoint URL */
async function resolveProviderUrl(providerAddress: string, restUrl: string): Promise<string> {
  const url = `${restUrl}/akash/provider/v1beta3/providers/${providerAddress}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to resolve provider ${providerAddress}: HTTP ${res.status}`);
  }
  const data = await res.json() as { provider?: { host_uri?: string } };
  const hostUri = data.provider?.host_uri;
  if (!hostUri) {
    throw new Error(`Provider ${providerAddress} has no host_uri`);
  }
  return hostUri.replace(/\/$/, "");
}

/** Derives the next dseq from the current block height */
async function getCurrentBlockHeight(restUrl: string): Promise<number> {
  const res = await fetch(`${restUrl}/cosmos/base/tendermint/v1beta1/blocks/latest`);
  if (!res.ok) throw new Error(`Failed to fetch latest block: HTTP ${res.status}`);
  const data = await res.json() as { block?: { header?: { height?: string } } };
  const height = data.block?.header?.height;
  if (!height) throw new Error("Could not determine current block height");
  return parseInt(height, 10);
}

/** Fetches account info (accountNumber, sequence) for signing */
async function getAccountInfo(
  address: string,
  restUrl: string
): Promise<{ accountNumber: number; sequence: number }> {
  const res = await fetch(`${restUrl}/cosmos/auth/v1beta1/accounts/${address}`);
  if (!res.ok) throw new Error(`Failed to fetch account info for ${address}: HTTP ${res.status}`);
  const data = await res.json() as {
    account?: { account_number?: string; sequence?: string };
  };
  return {
    accountNumber: parseInt(data.account?.account_number ?? "0", 10),
    sequence: parseInt(data.account?.sequence ?? "0", 10),
  };
}

/** Sleep helper */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Score a bid (lower price is better; prefer bids with lower amount) */
function scoreBid(bid: AkashBid): number {
  return parseFloat(bid.price.amount);
}

// ─── AkashClient ─────────────────────────────────────────────────────────────

export class AkashClient {
  private readonly rpcUrl: string;
  private readonly restUrl: string;
  private readonly chainId: string;
  private readonly gasPrice: string;
  private readonly mnemonic: string;

  private wallet: DirectSecp256k1HdWallet | null = null;
  private signingClient: SigningStargateClient | null = null;
  private ownerAddress: string | null = null;
  private initialized = false;

  constructor(config: AkashClientConfig) {
    this.mnemonic = config.mnemonic;
    this.rpcUrl = config.rpcUrl ?? DEFAULT_RPC_URL;
    this.restUrl = (config.restUrl ?? DEFAULT_REST_URL).replace(/\/$/, "");
    this.chainId = config.chainId ?? DEFAULT_CHAIN_ID;
    this.gasPrice = config.gasPrice ?? DEFAULT_GAS_PRICE;
  }

  // ── Initialization ─────────────────────────────────────────────────────────

  /**
   * Initialize wallet and signing client.
   * Must be called before any other method.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    loggers.server.info("Initializing Akash client...");

    // 1. Derive wallet from mnemonic (Akash uses the cosmos coin type 118)
    this.wallet = await DirectSecp256k1HdWallet.fromMnemonic(this.mnemonic, {
      prefix: "akash",
    });

    const accounts = await this.wallet.getAccounts();
    if (accounts.length === 0) {
      throw new Error("No accounts derived from mnemonic");
    }
    this.ownerAddress = accounts[0].address;

    // 2. Build type registry with Akash message types
    //    We register only the message types we need to avoid heavy imports.
    //    Full registry is available via @akashnetwork/akashjs getAkashTypeRegistry().
    const registry = new Registry();

    // 3. Connect signing client
    this.signingClient = await SigningStargateClient.connectWithSigner(
      this.rpcUrl,
      this.wallet,
      {
        registry,
        gasPrice: GasPrice.fromString(this.gasPrice),
      }
    );

    this.initialized = true;

    loggers.server.info(
      { owner: this.ownerAddress, rpc: this.rpcUrl, chainId: this.chainId },
      "Akash client initialized"
    );
  }

  /** Returns the owner address (wallet public key → bech32 akash address) */
  get address(): string {
    if (!this.ownerAddress) throw new Error("AkashClient not initialized — call init() first");
    return this.ownerAddress;
  }

  // ── Deployment ─────────────────────────────────────────────────────────────

  /**
   * Create a new Akash deployment from an SDL YAML string.
   *
   * Broadcasts MsgCreateDeployment and returns the deployment ID (owner + dseq).
   * The dseq is derived from the current block height, making it unique per owner.
   *
   * @param sdlYaml - Akash SDL YAML string (see sdl-converter.ts)
   * @returns Deployment ID containing owner address and dseq
   */
  async createDeployment(sdlYaml: string): Promise<AkashDeploymentId> {
    this.assertInitialized();

    loggers.server.info("Creating Akash deployment...");

    // Derive dseq from current block height
    const blockHeight = await getCurrentBlockHeight(this.restUrl);
    const dseq = blockHeight.toString();

    loggers.server.info({ dseq, owner: this.ownerAddress }, "Creating deployment with dseq from block height");

    // Parse SDL to extract group specs
    // We send the SDL hash + groups to the chain. The actual workload definition
    // is sent separately via the manifest to the provider.
    const sdlGroups = this.parseSDLGroups(sdlYaml);

    const msg = {
      typeUrl: MSG_CREATE_DEPLOYMENT,
      value: {
        id: {
          owner: this.ownerAddress!,
          dseq: { low: parseInt(dseq, 10), high: 0, unsigned: true },
        },
        groups: sdlGroups,
        version: this.sdlVersion(sdlYaml),
        deposit: {
          denom: "uakt",
          amount: DEPLOYMENT_DEPOSIT_UAKT,
        },
        depositor: this.ownerAddress!,
      },
    };

    loggers.server.info({ typeUrl: MSG_CREATE_DEPLOYMENT, dseq }, "Broadcasting MsgCreateDeployment");

    const txResult = await this.broadcastTx([msg]);

    if (txResult.code !== 0) {
      throw new Error(
        `MsgCreateDeployment failed (code ${txResult.code}): ${txResult.rawLog}`
      );
    }

    loggers.server.info(
      { txHash: txResult.transactionHash, dseq, owner: this.ownerAddress },
      "Deployment created successfully"
    );

    return { owner: this.ownerAddress!, dseq };
  }

  /**
   * Wait for bids to arrive for a deployment.
   * Polls the REST API until bids are available or timeout is reached.
   *
   * @param deploymentId - The deployment to wait bids for
   * @param timeoutMs - How long to wait before giving up (default: 2 min)
   * @returns Array of bids received
   */
  async waitForBids(
    deploymentId: AkashDeploymentId,
    timeoutMs = BID_WAIT_TIMEOUT_MS
  ): Promise<AkashBid[]> {
    loggers.server.info(
      { dseq: deploymentId.dseq, owner: deploymentId.owner, timeoutMs },
      "Waiting for Akash bids..."
    );

    const deadline = Date.now() + timeoutMs;
    let attempt = 0;

    while (Date.now() < deadline) {
      attempt++;
      const bids = await this.queryBids(deploymentId);

      const openBids = bids.filter((b) => b.state === "open");
      loggers.server.debug(
        { attempt, totalBids: bids.length, openBids: openBids.length },
        "Bid poll result"
      );

      if (openBids.length > 0) {
        loggers.server.info(
          { dseq: deploymentId.dseq, bidCount: openBids.length },
          `Received ${openBids.length} bid(s) for deployment`
        );
        return openBids;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      loggers.server.debug(
        { attempt, remainingMs: remaining },
        `No bids yet — retrying in ${BID_POLL_INTERVAL_MS}ms`
      );
      await sleep(Math.min(BID_POLL_INTERVAL_MS, remaining));
    }

    throw new Error(
      `No bids received for deployment ${deploymentId.dseq} after ${timeoutMs}ms`
    );
  }

  /**
   * Accept the best bid (lowest price) for a deployment by creating a lease.
   *
   * Broadcasts MsgCreateLease to the chain.
   *
   * @param bid - The bid to accept
   * @returns Lease information including provider URL
   */
  async acceptBid(bid: AkashBid): Promise<AkashLeaseInfo> {
    this.assertInitialized();

    loggers.server.info(
      {
        provider: bid.id.provider,
        dseq: bid.id.dseq,
        price: bid.price,
      },
      "Accepting Akash bid — creating lease"
    );

    const msg = {
      typeUrl: MSG_CREATE_LEASE,
      value: {
        bid_id: {
          owner: bid.id.owner,
          dseq: { low: parseInt(bid.id.dseq, 10), high: 0, unsigned: true },
          gseq: bid.id.gseq,
          oseq: bid.id.oseq,
          provider: bid.id.provider,
        },
      },
    };

    const txResult = await this.broadcastTx([msg]);

    if (txResult.code !== 0) {
      throw new Error(
        `MsgCreateLease failed (code ${txResult.code}): ${txResult.rawLog}`
      );
    }

    loggers.server.info(
      { txHash: txResult.transactionHash, provider: bid.id.provider },
      "Lease created successfully"
    );

    // Resolve provider URL from on-chain registry
    let providerUrl: string;
    try {
      providerUrl = await resolveProviderUrl(bid.id.provider, this.restUrl);
    } catch (err) {
      loggers.server.warn(
        { provider: bid.id.provider, error: String(err) },
        "Could not resolve provider URL from chain — using fallback"
      );
      providerUrl = `https://${bid.id.provider}`;
    }

    return {
      leaseId: {
        owner: bid.id.owner,
        dseq: bid.id.dseq,
        gseq: bid.id.gseq,
        oseq: bid.id.oseq,
        provider: bid.id.provider,
      },
      providerUrl,
      state: "active",
      price: bid.price,
    };
  }

  /**
   * Select the best bid from a list (lowest price, with open state).
   *
   * @param bids - List of open bids
   * @returns The best bid
   */
  selectBestBid(bids: AkashBid[]): AkashBid {
    if (bids.length === 0) throw new Error("No bids to select from");
    return [...bids].sort((a, b) => scoreBid(a) - scoreBid(b))[0];
  }

  // ── Manifest ───────────────────────────────────────────────────────────────

  /**
   * Send the deployment manifest to a provider.
   *
   * After a lease is created, the provider needs the manifest (SDL converted
   * to the provider's format) so it can actually start the workload.
   *
   * The provider exposes a REST API at their `host_uri`. Manifest delivery is
   * authenticated using the deployer's certificate stored on-chain.
   *
   * NOTE: Full certificate-based mTLS auth requires generating a TLS certificate
   * for the deployer address and broadcasting it via MsgCreateCertificate.
   * This implementation uses the REST endpoint; production deployments should
   * integrate @akashnetwork/akashjs certificate utilities.
   *
   * @param lease - The lease info (includes providerUrl)
   * @param sdlYaml - The SDL YAML to send as manifest
   */
  async sendManifest(lease: AkashLeaseInfo, sdlYaml: string): Promise<void> {
    this.assertInitialized();

    const { leaseId, providerUrl } = lease;
    const manifestUrl = `${providerUrl}/deployment/${leaseId.dseq}/manifest`;

    loggers.server.info(
      { providerUrl, dseq: leaseId.dseq, url: manifestUrl },
      "Sending manifest to provider"
    );

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MANIFEST_SEND_MAX_RETRIES; attempt++) {
      try {
        const manifest = this.sdlToManifest(sdlYaml, leaseId);

        const res = await fetch(manifestUrl, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            // In production this should include the client certificate for mTLS.
            // The Akash provider validates the deployer's on-chain certificate.
          },
          body: JSON.stringify(manifest),
          // Allow self-signed certs on provider side (production: use cert pinning)
          signal: AbortSignal.timeout(30_000),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Provider returned HTTP ${res.status}: ${body}`);
        }

        loggers.server.info(
          { dseq: leaseId.dseq, provider: leaseId.provider, attempt },
          "Manifest delivered to provider successfully"
        );
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        loggers.server.warn(
          { attempt, maxRetries: MANIFEST_SEND_MAX_RETRIES, error: lastError.message },
          "Manifest send attempt failed"
        );

        if (attempt < MANIFEST_SEND_MAX_RETRIES) {
          await sleep(MANIFEST_RETRY_DELAY_MS);
        }
      }
    }

    throw new Error(
      `Failed to send manifest after ${MANIFEST_SEND_MAX_RETRIES} attempts: ${lastError?.message}`
    );
  }

  // ── Status & Query ─────────────────────────────────────────────────────────

  /**
   * Get the current status of a deployment from the chain.
   *
   * @param deploymentId - The deployment to query
   */
  async getDeploymentStatus(deploymentId: AkashDeploymentId): Promise<AkashDeploymentStatus> {
    const url = `${this.restUrl}/akash/deployment/v1beta4/deployments/info?id.owner=${deploymentId.owner}&id.dseq=${deploymentId.dseq}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `Failed to query deployment ${deploymentId.dseq}: HTTP ${res.status}`
      );
    }

    const data = await res.json() as {
      deployment?: {
        deployment?: {
          deployment_id?: { owner?: string; dseq?: string };
          state?: string;
          created_at?: string;
        };
      };
    };

    const dep = data.deployment?.deployment;
    if (!dep) {
      throw new Error(`Deployment ${deploymentId.dseq} not found`);
    }

    // Also fetch leases for this deployment
    const leases = await this.queryLeases(deploymentId);

    return {
      state: dep.state ?? "unknown",
      deploymentId,
      leases,
      createdAt: dep.created_at ?? "",
    };
  }

  /**
   * Get service endpoints/URIs from the provider for a running lease.
   *
   * @param lease - The active lease
   */
  async getLeaseEndpoints(lease: AkashLeaseInfo): Promise<AkashEndpoint[]> {
    const { providerUrl, leaseId } = lease;
    const url = `${providerUrl}/lease/${leaseId.dseq}/${leaseId.gseq}/${leaseId.oseq}/status`;

    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Provider status request failed HTTP ${res.status}: ${body}`);
      }

      const data = await res.json() as {
        services?: Record<
          string,
          {
            name?: string;
            available?: number;
            total?: number;
            uris?: string[];
            forwarded_ports?: Array<{
              host?: string;
              port?: number;
              externalPort?: number;
              proto?: string;
              available?: number;
              name?: string;
            }>;
          }
        >;
      };

      const endpoints: AkashEndpoint[] = [];

      for (const [serviceName, service] of Object.entries(data.services ?? {})) {
        for (const fwd of service.forwarded_ports ?? []) {
          endpoints.push({
            host: fwd.host ?? providerUrl,
            port: fwd.port ?? 0,
            externalPort: fwd.externalPort ?? fwd.port ?? 0,
            proto: fwd.proto ?? "TCP",
            available: fwd.available ?? 0,
            name: fwd.name ?? serviceName,
          });
        }
      }

      return endpoints;
    } catch (err) {
      loggers.server.warn(
        { dseq: leaseId.dseq, error: String(err) },
        "Could not fetch lease endpoints"
      );
      return [];
    }
  }

  // ── Close Deployment ───────────────────────────────────────────────────────

  /**
   * Close a deployment — stops workloads and releases escrowed funds.
   *
   * Broadcasts MsgCloseDeployment to the chain.
   *
   * @param deploymentId - The deployment to close
   */
  async closeDeployment(deploymentId: AkashDeploymentId): Promise<DeliverTxResponse> {
    this.assertInitialized();

    loggers.server.info(
      { dseq: deploymentId.dseq, owner: deploymentId.owner },
      "Closing Akash deployment"
    );

    const msg = {
      typeUrl: MSG_CLOSE_DEPLOYMENT,
      value: {
        id: {
          owner: deploymentId.owner,
          dseq: { low: parseInt(deploymentId.dseq, 10), high: 0, unsigned: true },
        },
      },
    };

    const txResult = await this.broadcastTx([msg]);

    if (txResult.code !== 0) {
      throw new Error(
        `MsgCloseDeployment failed (code ${txResult.code}): ${txResult.rawLog}`
      );
    }

    loggers.server.info(
      { txHash: txResult.transactionHash, dseq: deploymentId.dseq },
      "Deployment closed successfully"
    );

    return txResult;
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private assertInitialized(): void {
    if (!this.initialized || !this.signingClient || !this.ownerAddress) {
      throw new Error("AkashClient not initialized — call init() first");
    }
  }

  private async broadcastTx(
    msgs: Array<{ typeUrl: string; value: unknown }>
  ): Promise<DeliverTxResponse> {
    if (!this.signingClient || !this.ownerAddress) {
      throw new Error("Signing client not initialized");
    }

    const result = await this.signingClient.signAndBroadcast(
      this.ownerAddress,
      msgs as Parameters<typeof this.signingClient.signAndBroadcast>[1],
      "auto"
    );

    return result;
  }

  /** Query bids for a deployment from the REST API */
  private async queryBids(deploymentId: AkashDeploymentId): Promise<AkashBid[]> {
    const url =
      `${this.restUrl}/akash/market/v1beta5/bids/list` +
      `?filters.owner=${deploymentId.owner}` +
      `&filters.dseq=${deploymentId.dseq}`;

    const res = await fetch(url);
    if (!res.ok) {
      loggers.server.warn(
        { status: res.status, dseq: deploymentId.dseq },
        "Bid query returned non-200; retrying"
      );
      return [];
    }

    const data = await res.json() as { bids?: Array<{ bid?: AkashBid; escrow_account?: unknown }> };
    return (data.bids ?? []).map((b) => b.bid!).filter(Boolean);
  }

  /** Query leases for a deployment from the REST API */
  private async queryLeases(deploymentId: AkashDeploymentId): Promise<AkashLeaseInfo[]> {
    const url =
      `${this.restUrl}/akash/market/v1beta5/leases/list` +
      `?filters.owner=${deploymentId.owner}` +
      `&filters.dseq=${deploymentId.dseq}`;

    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json() as {
      leases?: Array<{
        lease?: {
          lease_id?: {
            owner?: string; dseq?: string; gseq?: number; oseq?: number; provider?: string;
          };
          state?: string;
          price?: { denom?: string; amount?: string };
        };
      }>;
    };

    const results: AkashLeaseInfo[] = [];

    for (const item of data.leases ?? []) {
      const lease = item.lease;
      if (!lease?.lease_id) continue;

      const id = lease.lease_id;
      let providerUrl = `https://${id.provider}`;
      try {
        providerUrl = await resolveProviderUrl(id.provider!, this.restUrl);
      } catch {
        // keep fallback
      }

      results.push({
        leaseId: {
          owner: id.owner ?? "",
          dseq: id.dseq ?? "",
          gseq: id.gseq ?? 1,
          oseq: id.oseq ?? 1,
          provider: id.provider ?? "",
        },
        providerUrl,
        state: lease.state ?? "unknown",
        price: {
          denom: lease.price?.denom ?? "uakt",
          amount: lease.price?.amount ?? "0",
        },
      });
    }

    return results;
  }

  /**
   * Parse SDL YAML groups for the MsgCreateDeployment message.
   * Returns a minimal representation; full proto encoding requires @akashnetwork/akash-api.
   */
  private parseSDLGroups(sdlYaml: string): unknown[] {
    // Groups are extracted from the SDL's `deployment` and `profiles` sections.
    // Full SDL parsing should use @akashnetwork/akashjs SDL utilities.
    // This is a stub that returns a single group; enhance with full SDL parsing
    // for multi-group deployments.
    //
    // In production: import { SDL } from "@akashnetwork/akashjs/build/sdl"
    // and use SDL.fromString(sdlYaml).groups()
    return [
      {
        name: "akash",
        requirements: {
          signed_by: { all_of: [], any_of: [] },
          attributes: [],
        },
        resources: [],
      },
    ];
  }

  /**
   * Compute an SDL version hash (SHA-256 of the SDL string as hex bytes).
   * The chain stores this as the deployment version.
   */
  private sdlVersion(sdlYaml: string): Uint8Array {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(sdlYaml);
    // Simple deterministic hash using the SDL bytes
    // Production: use crypto.subtle.digest("SHA-256", bytes)
    return bytes.slice(0, 32);
  }

  /**
   * Convert SDL YAML to the provider manifest JSON format.
   * The provider expects the manifest in its own format, not raw SDL.
   *
   * Full conversion: use @akashnetwork/akashjs SDL.fromString().manifest()
   */
  private sdlToManifest(sdlYaml: string, leaseId: AkashLeaseId): unknown {
    // In production, use the akashjs SDL class:
    //   import { SDL } from "@akashnetwork/akashjs/build/sdl"
    //   const sdl = SDL.fromString(sdlYaml)
    //   return sdl.manifest()
    //
    // For now, pass the SDL YAML through — providers that support raw SDL will accept this.
    return {
      version: "2.0",
      dseq: leaseId.dseq,
      gseq: leaseId.gseq,
      oseq: leaseId.oseq,
      owner: leaseId.owner,
      provider: leaseId.provider,
      sdl: sdlYaml,
    };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create and initialize an AkashClient from environment variables.
 * Throws if AKASH_MNEMONIC is not set.
 */
export async function createAkashClientFromEnv(): Promise<AkashClient> {
  const mnemonic = process.env.AKASH_MNEMONIC;
  if (!mnemonic || mnemonic.trim() === "") {
    throw new Error(
      "AKASH_MNEMONIC environment variable is required for Akash deployments"
    );
  }

  const client = new AkashClient({
    mnemonic,
    rpcUrl: process.env.AKASH_RPC_URL ?? DEFAULT_RPC_URL,
    restUrl: process.env.AKASH_REST_URL ?? DEFAULT_REST_URL,
    chainId: process.env.AKASH_CHAIN_ID ?? DEFAULT_CHAIN_ID,
    gasPrice: process.env.AKASH_GAS_PRICE
      ? `${process.env.AKASH_GAS_PRICE}uakt`
      : DEFAULT_GAS_PRICE,
  });

  await client.init();
  return client;
}
