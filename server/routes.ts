import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertProviderSchema, insertJobSchema, insertUsageReportSchema } from "@shared/schema";
import { fromZodError } from "zod-validation-error";
import { signUsageReport } from "./eip712";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ============== PROVIDERS ==============
  
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

  // Get provider by address
  app.get("/api/providers/address/:address", async (req, res) => {
    try {
      const provider = await storage.getProviderByAddress(req.params.address);
      if (!provider) {
        return res.status(404).json({ error: "Provider not found" });
      }
      res.json(provider);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Register a new provider
  app.post("/api/providers", async (req, res) => {
    try {
      const result = insertProviderSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: fromZodError(result.error).toString() });
      }

      // Check if provider already exists
      const existing = await storage.getProviderByAddress(result.data.address);
      if (existing) {
        return res.status(409).json({ error: "Provider already registered" });
      }

      const provider = await storage.createProvider(result.data);
      
      // Log event
      await storage.createEvent({
        eventType: "ProviderRegistered",
        providerId: provider.id,
        jobId: null,
        userAddress: provider.address,
        amount: null,
        txHash: null,
        metadata: JSON.stringify({ name: provider.name }),
      });

      res.status(201).json(provider);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update provider status
  app.patch("/api/providers/:id/status", async (req, res) => {
    try {
      const { status } = req.body;
      if (!status || !["active", "inactive"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      await storage.updateProviderStatus(req.params.id, status);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============== JOBS ==============

  // Get jobs by creator
  app.get("/api/jobs/user/:address", async (req, res) => {
    try {
      const jobs = await storage.getJobsByCreator(req.params.address);
      res.json(jobs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get jobs by provider
  app.get("/api/jobs/provider/:providerId", async (req, res) => {
    try {
      const jobs = await storage.getJobsByProvider(req.params.providerId);
      res.json(jobs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get single job
  app.get("/api/jobs/:id", async (req, res) => {
    try {
      const job = await storage.getJob(req.params.id);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }
      res.json(job);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get job by job number
  app.get("/api/jobs/number/:jobNumber", async (req, res) => {
    try {
      const job = await storage.getJobByNumber(req.params.jobNumber);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }
      res.json(job);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create a new job
  app.post("/api/jobs", async (req, res) => {
    try {
      const result = insertJobSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: fromZodError(result.error).toString() });
      }

      // Validate provider exists
      const provider = await storage.getProvider(result.data.providerId);
      if (!provider) {
        return res.status(404).json({ error: "Provider not found" });
      }

      const job = await storage.createJob(result.data);

      // Log event
      await storage.createEvent({
        eventType: "JobCreated",
        jobId: job.id,
        providerId: job.providerId,
        userAddress: job.creator,
        amount: job.deposit,
        txHash: null,
        metadata: JSON.stringify({ jobNumber: job.jobNumber }),
      });

      res.status(201).json(job);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Close a job
  app.post("/api/jobs/:id/close", async (req, res) => {
    try {
      const job = await storage.getJob(req.params.id);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }

      if (job.status !== "OPEN") {
        return res.status(400).json({ error: "Job is not open" });
      }

      // Add remaining balance to user's refund credits
      if (parseFloat(job.remaining) > 0) {
        await storage.updateUserRefundBalance(job.creator, job.remaining);
      }

      await storage.closeJob(job.id);

      // Log event
      await storage.createEvent({
        eventType: "JobClosed",
        jobId: job.id,
        providerId: null,
        userAddress: job.creator,
        amount: job.remaining,
        txHash: null,
        metadata: JSON.stringify({ refundAmount: job.remaining }),
      });

      res.json({ success: true, refundAmount: job.remaining });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============== USAGE REPORTS ==============

  // Get usage reports for a job
  app.get("/api/usage-reports/job/:jobId", async (req, res) => {
    try {
      const reports = await storage.getUsageReportsByJob(req.params.jobId);
      res.json(reports);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Request backend signature for usage report
  app.post("/api/usage-reports/request-signature", async (req, res) => {
    try {
      const result = insertUsageReportSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: fromZodError(result.error).toString() });
      }

      // Validate job exists and is open
      const job = await storage.getJob(result.data.jobId);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }

      if (job.status !== "OPEN") {
        return res.status(400).json({ error: "Job is not open" });
      }

      // Validate amounts
      const grossCost = parseFloat(result.data.grossCost);
      const providerEarn = parseFloat(result.data.providerEarn);
      const userRefund = parseFloat(result.data.userRefund || "0");
      const remaining = parseFloat(job.remaining);

      if (grossCost > remaining) {
        return res.status(400).json({ error: "Gross cost exceeds remaining budget" });
      }

      if (providerEarn + userRefund !== grossCost) {
        return res.status(400).json({
          error: "Provider earn + user refund must equal gross cost",
        });
      }

      // Get provider to get address
      const provider = await storage.getProvider(job.providerId);
      if (!provider) {
        return res.status(404).json({ error: "Provider not found" });
      }

      // Require on-chain job ID (job must be created on-chain first)
      if (!job.onChainJobId) {
        return res.status(400).json({ error: "Job does not have an on-chain job ID. Please create the job on-chain first." });
      }

      // Create usage report
      const report = await storage.createUsageReport(result.data);

      // Sign usage report with EIP-712
      const signature = await signUsageReport({
        jobId: job.onChainJobId,
        user: job.creator,
        provider: provider.address,
        grossCost: result.data.grossCost,
        providerEarn: result.data.providerEarn,
        nonce: job.nonce.toString(),
        deadline: "0", // No deadline for MVP
      });

      await storage.updateUsageReportSignature(report.id, signature);

      res.json({
        reportId: report.id,
        signature,
        jobNonce: job.nonce,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Confirm usage report (simulate on-chain submission)
  app.post("/api/usage-reports/:id/confirm", async (req, res) => {
    try {
      const { txHash } = req.body;
      if (!txHash) {
        return res.status(400).json({ error: "Transaction hash required" });
      }

      const report = await storage.getUsageReport(req.params.id);
      if (!report) {
        return res.status(404).json({ error: "Usage report not found" });
      }

      if (report.status !== "signed") {
        return res.status(400).json({ error: "Report not signed" });
      }

      const job = await storage.getJob(report.jobId);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }

      // Update job balances
      const newSpent = (parseFloat(job.spent) + parseFloat(report.grossCost)).toFixed(2);
      const newRemaining = (parseFloat(job.remaining) - parseFloat(report.grossCost)).toFixed(2);
      
      await storage.updateJobUsage(job.id, newSpent, newRemaining);
      await storage.incrementJobNonce(job.id);

      // Update provider earnings
      await storage.updateProviderEarnings(job.providerId, report.providerEarn);

      // Add user refund if applicable
      if (parseFloat(report.userRefund) > 0) {
        await storage.updateUserRefundBalance(job.creator, report.userRefund);
      }

      // Confirm the report
      await storage.confirmUsageReport(report.id, txHash);

      // Log event
      await storage.createEvent({
        eventType: "UsageSubmitted",
        jobId: job.id,
        providerId: job.providerId,
        userAddress: job.creator,
        amount: report.grossCost,
        txHash,
        metadata: JSON.stringify({
          providerEarn: report.providerEarn,
          userRefund: report.userRefund,
        }),
      });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============== USER CREDITS ==============

  // Get user credits
  app.get("/api/credits/:address", async (req, res) => {
    try {
      const credit = await storage.getUserCredit(req.params.address);
      res.json(credit || { userAddress: req.params.address, refundBalance: "0" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============== EVENTS ==============

  // Get events for a job
  app.get("/api/events/job/:jobId", async (req, res) => {
    try {
      const events = await storage.getEventsByJob(req.params.jobId);
      res.json(events);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get events for a user
  app.get("/api/events/user/:address", async (req, res) => {
    try {
      const events = await storage.getEventsByUser(req.params.address);
      res.json(events);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
