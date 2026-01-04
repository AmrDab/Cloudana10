import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertProviderSchema } from "../shared/schema";
import { fromZodError } from "zod-validation-error";
import { getproviderRegistryContract, stringToBytes32, isValidProviderKey } from "./contracts";
import { ethers } from "ethers";
import { z } from "zod";
import { CONTRACT_ADDRESSES } from "../shared/contracts";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ============== PROVIDERS ==============
  
  // Get bond information
  app.get("/api/bond-info", async (_req, res) => {
    try {
      const providerRegistry = getproviderRegistryContract();
      const bondInfo = await providerRegistry.getBondInfo();
      res.json({
        bondAmount: bondInfo[0].toString(),
        teamWallet: bondInfo[1],
        treasuryWallet: bondInfo[2],
        deadAddress: bondInfo[3],
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Validate provider and prepare unsigned transaction
  app.post("/api/providers/validate-and-prepare", async (req, res) => {
    try {
      // Accept full provider info for validation
      const schema = z.object({
        ownerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address"),
        providerkey: z.string().refine((val) => isValidProviderKey(val), {
          message: "Invalid providerkey format (must be 64-char hex string starting with 0x)",
        }),
        region: z.enum(["Helsinki", "EU", "Global"]),
        hardwareTier: z.number().int().min(0).max(2),
        capacity: z.number().int().min(1).max(10),
        name: z.string().min(1, "Provider name is required"),
        // Optional fields for validation
        description: z.string().optional(),
        cpuModel: z.string().optional(),
        cpuCores: z.number().optional(),
        cpuThreads: z.number().optional(),
        cpuClockSpeed: z.string().optional(),
        gpuModel: z.string().optional(),
        gpuCount: z.number().optional(),
        gpuMemory: z.string().optional(),
        gpuCudaCores: z.string().optional(),
        ramTotal: z.string().optional(),
        ramType: z.string().optional(),
        storageTotal: z.string().optional(),
        storageType: z.string().optional(),
        storageSpeed: z.string().optional(),
        bandwidth: z.string().optional(),
        networkType: z.string().optional(),
        location: z.string().optional(),
        country: z.string().optional(),
        city: z.string().optional(),
      });

      const result = schema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: fromZodError(result.error).toString() });
      }

      const data = result.data;
      const { providerkey, region, hardwareTier, capacity, ownerAddress } = data;

      // Check if provider already exists in DB
      const existingDB = await storage.getProviderByProviderkey(providerkey);
      if (existingDB) {
        return res.status(409).json({ error: "Provider with this providerkey already registered in database" });
      }

      // Check if provider already exists on-chain
      const providerRegistry = getproviderRegistryContract();
      let provider: any;
      try {
        provider = await providerRegistry.getProvider(stringToBytes32(providerkey));
        if (provider.owner !== ethers.ZeroAddress) {
          return res.status(409).json({ error: "Provider with this providerkey already exists on-chain" });
        }
      } catch (error: any) {
        // Provider doesn't exist, which is fine
      }

      // Check owner quota
      const ownerProviders = await providerRegistry.getMyProviders(ownerAddress);
      if (ownerProviders.length >= 10) {
        return res.status(400).json({ error: "Maximum 10 providers per wallet address" });
      }

      // Get bond info
      const bondInfo = await providerRegistry.getBondInfo();
      const totalBond = bondInfo[0].toString();
      const bondAmount = BigInt(totalBond);

      // Check token balance and allowance (using CLDToken contract)
      const { CLDTokenAbi } = await import("../shared/contracts");
      const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
      const rpcProvider = new ethers.JsonRpcProvider(RPC_URL);
      const cldTokenAddress = CONTRACT_ADDRESSES.contracts.CLDToken;
      const cldToken = new ethers.Contract(cldTokenAddress, CLDTokenAbi as any, rpcProvider);
      
      const balance = await cldToken.balanceOf(ownerAddress);
      const allowance = await cldToken.allowance(ownerAddress, providerRegistry.target);

      if (balance < bondAmount) {
        return res.status(400).json({
          error: "Insufficient balance",
          required: totalBond,
          available: balance.toString(),
        });
      }

      if (allowance < bondAmount) {
        return res.status(400).json({
          error: "Insufficient allowance",
          required: totalBond,
          current: allowance.toString(),
        });
      }

      // Prepare transaction parameters for wagmi/viem
      // Note: args should contain the raw values, not converted bytes32
      // The frontend will handle the conversion
      const transactionParams = {
        to: providerRegistry.target as string,
        functionName: "registerProvider" as const,
        args: [
          providerkey, // Frontend will convert to bytes32
          region,
          hardwareTier,
          capacity,
        ],
      };

      // Estimate gas
      let gasEstimate = "200000"; // Default estimate
      try {
        const estimatedGas = await providerRegistry.registerProvider.estimateGas(
          stringToBytes32(providerkey),
          region,
          hardwareTier,
          capacity,
          { from: ownerAddress }
        );
        gasEstimate = estimatedGas.toString();
      } catch (error: any) {
        // Gas estimation failed, use default
        console.warn("Gas estimation failed:", error.message);
      }

      // Store provider as "Pending" in DB - will be updated to "Registered" when event is received
      const pendingProvider = await storage.createProvider({
        ownerAddress,
        providerkey,
        region,
        hardwareTier,
        capacity,
        bondAmount: totalBond,
        status: "Pending",
        name: data.name,
        description: data.description || undefined,
        cpuModel: data.cpuModel || undefined,
        cpuCores: data.cpuCores || undefined,
        cpuThreads: data.cpuThreads || undefined,
        cpuClockSpeed: data.cpuClockSpeed || undefined,
        gpuModel: data.gpuModel || undefined,
        gpuCount: data.gpuCount || undefined,
        gpuMemory: data.gpuMemory || undefined,
        gpuCudaCores: data.gpuCudaCores || undefined,
        ramTotal: data.ramTotal || undefined,
        ramType: data.ramType || undefined,
        storageTotal: data.storageTotal || undefined,
        storageType: data.storageType || undefined,
        storageSpeed: data.storageSpeed || undefined,
        bandwidth: data.bandwidth || undefined,
        networkType: data.networkType || undefined,
        location: data.location || undefined,
        country: data.country || undefined,
        city: data.city || undefined,
      });

      res.json({
        success: true,
        validated: {
          providerkey,
          region,
          hardwareTier,
          capacity,
          name: data.name,
          ownerAddress,
        },
        transaction: transactionParams,
        bondInfo: {
          totalBond,
          required: totalBond,
          available: balance.toString(),
          allowance: allowance.toString(),
        },
        gasEstimate,
        pendingProviderId: pendingProvider.id,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get providers by owner address (on-chain data)
  app.get("/api/providers/:owner", async (req, res) => {
    try {
      const { owner } = req.params;
      if (!/^0x[a-fA-F0-9]{40}$/.test(owner)) {
        return res.status(400).json({ error: "Invalid address format" });
      }

      const providerRegistry = getproviderRegistryContract();
      const providerkeys = await providerRegistry.getMyProviders(owner);

      const providers = await Promise.all(
        providerkeys.map(async (providerkey: string) => {
          try {
            const provider = await providerRegistry.getProvider(providerkey);
            // Also get full details from DB if available
            const dbProvider = await storage.getProviderByProviderkey(providerkey);
            return {
              providerkey,
              region: provider.region,
              hardwareTier: Number(provider.hardwareTier),
              capacity: Number(provider.capacity),
              bondAmount: provider.bondAmount.toString(),
              registeredAt: Number(provider.registeredAt) * 1000, // Convert to milliseconds
              status: Number(provider.status), // 0=Registered, 1=Active, 2=Inactive
              // Include DB details if available
              ...(dbProvider ? {
                name: dbProvider.name,
                description: dbProvider.description,
                cpuModel: dbProvider.cpuModel,
                gpuModel: dbProvider.gpuModel,
                ramTotal: dbProvider.ramTotal,
                storageTotal: dbProvider.storageTotal,
                bandwidth: dbProvider.bandwidth,
              } : {}),
            };
          } catch (error) {
            return null;
          }
        })
      );

      res.json(providers.filter((p) => p !== null));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Agent heartbeat endpoint (future-ready, minimal validation for MVP)
  app.post("/api/providers/heartbeat", async (req, res) => {
    try {
      const schema = z.object({
        providerkey: z.string(),
        uptime: z.number().optional(),
        timestamp: z.number().optional(),
        signature: z.string().optional(),
      });

      const result = schema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: fromZodError(result.error).toString() });
      }

      // For MVP: Just acknowledge the heartbeat
      // Future: Validate signature, update uptime tracking, etc.
      res.json({
        success: true,
        message: "Heartbeat received (agent validation disabled for MVP)",
        timestamp: Date.now(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all providers
  app.get("/api/providers", async (_req, res) => {
    try {
      const providers = await storage.getAllProviders();
      res.json(providers);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get active providers only
  app.get("/api/providers/active", async (_req, res) => {
    try {
      const providers = await storage.getActiveProviders();
      res.json(providers);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get provider by providerkey
  app.get("/api/providers/key/:providerkey", async (req, res) => {
    try {
      const provider = await storage.getProviderByProviderkey(req.params.providerkey);
      if (!provider) {
        return res.status(404).json({ error: "Provider not found" });
      }
      res.json(provider);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get providers by owner address
  app.get("/api/providers/owner/:ownerAddress", async (req, res) => {
    try {
      const { ownerAddress } = req.params;
      if (!/^0x[a-fA-F0-9]{40}$/.test(ownerAddress)) {
        return res.status(400).json({ error: "Invalid address format" });
      }

      const providers = await storage.getProvidersByOwner(ownerAddress);
      res.json(providers);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Register a new provider (stores full device info in DB, minimal data on-chain)
  app.post("/api/providers/register", async (req, res) => {
    try {
      // Validate full provider data
      const result = insertProviderSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: fromZodError(result.error).toString() });
      }

      const data = result.data;

      // Check if provider already exists by providerkey
      const existing = await storage.getProviderByProviderkey(data.providerkey);
      if (existing) {
        return res.status(409).json({ error: "Provider with this providerkey already registered" });
      }

      // Store full provider details in DB
      // registeredAt will be set automatically by the database default
      const provider = await storage.createProvider(data);

      res.status(201).json(provider);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update provider status
  app.patch("/api/providers/:id/status", async (req, res) => {
    try {
      const { status } = req.body;
      if (!status || !["Pending", "Registered", "Active", "Inactive"].includes(status)) {
        return res.status(400).json({ error: "Invalid status. Must be Pending, Registered, Active, or Inactive" });
      }

      await storage.updateProviderStatus(req.params.id, status);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });


  return httpServer;
}
