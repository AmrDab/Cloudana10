import {
  providers,
  jobs,
  usageReports,
  userCredits,
  events,
  type Provider,
  type InsertProvider,
  type Job,
  type InsertJob,
  type UsageReport,
  type InsertUsageReport,
  type UserCredit,
  type Event,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";

export interface IStorage {
  // Providers
  getProvider(id: string): Promise<Provider | undefined>;
  getProviderByProviderkey(providerkey: string): Promise<Provider | undefined>;
  getProvidersByOwner(ownerAddress: string): Promise<Provider[]>;
  getAllProviders(): Promise<Provider[]>;
  getActiveProviders(): Promise<Provider[]>;
  createProvider(provider: InsertProvider): Promise<Provider>;
  updateProviderStatus(id: string, status: "Pending" | "Registered" | "Active" | "Inactive"): Promise<void>;
  getPendingProviderByProviderkey(providerkey: string): Promise<Provider | undefined>;
  updateProviderStatusByProviderkey(providerkey: string, status: "Pending" | "Registered" | "Active" | "Inactive"): Promise<void>;
  updateProviderRegisteredAt(providerkey: string, registeredAt: Date): Promise<void>;
  updateProviderEarnings(id: string, amount: string): Promise<void>;

  // Jobs
  getJob(id: string): Promise<Job | undefined>;
  getJobByNumber(jobNumber: string): Promise<Job | undefined>;
  getJobsByCreator(creator: string): Promise<Job[]>;
  getJobsByProvider(providerId: string): Promise<Job[]>;
  createJob(job: InsertJob): Promise<Job>;
  updateJobUsage(jobId: string, spent: string, remaining: string): Promise<void>;
  closeJob(jobId: string): Promise<void>;
  incrementJobNonce(jobId: string): Promise<void>;

  // Usage Reports
  getUsageReport(id: string): Promise<UsageReport | undefined>;
  getUsageReportsByJob(jobId: string): Promise<UsageReport[]>;
  createUsageReport(report: InsertUsageReport): Promise<UsageReport>;
  updateUsageReportSignature(id: string, signature: string): Promise<void>;
  confirmUsageReport(id: string, txHash: string): Promise<void>;

  // User Credits
  getUserCredit(userAddress: string): Promise<UserCredit | undefined>;
  updateUserRefundBalance(userAddress: string, amount: string): Promise<void>;

  // Events
  createEvent(event: Omit<Event, "id" | "timestamp">): Promise<Event>;
  getEventsByJob(jobId: string): Promise<Event[]>;
  getEventsByUser(userAddress: string): Promise<Event[]>;
}

export class DatabaseStorage implements IStorage {
  // Providers
  async getProvider(id: string): Promise<Provider | undefined> {
    const [provider] = await db.select().from(providers).where(eq(providers.id, id));
    return provider || undefined;
  }

  async getProviderByProviderkey(providerkey: string): Promise<Provider | undefined> {
    const [provider] = await db.select().from(providers).where(eq(providers.providerkey, providerkey));
    return provider || undefined;
  }

  async getProvidersByOwner(ownerAddress: string): Promise<Provider[]> {
    return await db.select().from(providers).where(eq(providers.ownerAddress, ownerAddress)).orderBy(desc(providers.createdAt));
  }

  async getAllProviders(): Promise<Provider[]> {
    return await db.select().from(providers).orderBy(desc(providers.createdAt));
  }

  async getActiveProviders(): Promise<Provider[]> {
    return await db.select().from(providers).where(eq(providers.status, "Active"));
  }

  async createProvider(insertProvider: InsertProvider): Promise<Provider> {
    const [provider] = await db.insert(providers).values(insertProvider).returning();
    return provider;
  }

  async updateProviderStatus(id: string, status: "Pending" | "Registered" | "Active" | "Inactive"): Promise<void> {
    await db.update(providers).set({ status, updatedAt: new Date() }).where(eq(providers.id, id));
  }

  async getPendingProviderByProviderkey(providerkey: string): Promise<Provider | undefined> {
    const [provider] = await db
      .select()
      .from(providers)
      .where(and(eq(providers.providerkey, providerkey), eq(providers.status, "Pending")));
    return provider || undefined;
  }

  async updateProviderStatusByProviderkey(
    providerkey: string,
    status: "Pending" | "Registered" | "Active" | "Inactive"
  ): Promise<void> {
    await db
      .update(providers)
      .set({ status, updatedAt: new Date() })
      .where(eq(providers.providerkey, providerkey));
  }

  async updateProviderRegisteredAt(providerkey: string, registeredAt: Date): Promise<void> {
    await db
      .update(providers)
      .set({ registeredAt, updatedAt: new Date() })
      .where(eq(providers.providerkey, providerkey));
  }

  async updateProviderEarnings(id: string, amount: string): Promise<void> {
    await db
      .update(providers)
      .set({
        earningsBalance: sql`${providers.earningsBalance} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(providers.id, id));
  }

  // Jobs
  async getJob(id: string): Promise<Job | undefined> {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    return job || undefined;
  }

  async getJobByNumber(jobNumber: string): Promise<Job | undefined> {
    const [job] = await db.select().from(jobs).where(eq(jobs.jobNumber, jobNumber));
    return job || undefined;
  }

  async getJobsByCreator(creator: string): Promise<Job[]> {
    return await db.select().from(jobs).where(eq(jobs.creator, creator)).orderBy(desc(jobs.createdAt));
  }

  async getJobsByProvider(providerId: string): Promise<Job[]> {
    return await db.select().from(jobs).where(eq(jobs.providerId, providerId)).orderBy(desc(jobs.createdAt));
  }

  async createJob(insertJob: InsertJob): Promise<Job> {
    // Generate job number
    const jobCount = await db.select({ count: sql<number>`count(*)` }).from(jobs);
    const jobNumber = `job-${1000 + Number(jobCount[0].count) + 1}`;
    
    const [job] = await db
      .insert(jobs)
      .values({
        ...insertJob,
        jobNumber,
        remaining: insertJob.deposit,
      })
      .returning();
    return job;
  }

  async updateJobUsage(jobId: string, spent: string, remaining: string): Promise<void> {
    await db
      .update(jobs)
      .set({
        spent,
        remaining,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
  }

  async closeJob(jobId: string): Promise<void> {
    await db.update(jobs).set({ status: "CLOSED", updatedAt: new Date() }).where(eq(jobs.id, jobId));
  }

  async incrementJobNonce(jobId: string): Promise<void> {
    await db
      .update(jobs)
      .set({
        nonce: sql`${jobs.nonce} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
  }

  // Usage Reports
  async getUsageReport(id: string): Promise<UsageReport | undefined> {
    const [report] = await db.select().from(usageReports).where(eq(usageReports.id, id));
    return report || undefined;
  }

  async getUsageReportsByJob(jobId: string): Promise<UsageReport[]> {
    return await db.select().from(usageReports).where(eq(usageReports.jobId, jobId)).orderBy(desc(usageReports.createdAt));
  }

  async createUsageReport(insertReport: InsertUsageReport): Promise<UsageReport> {
    const [report] = await db.insert(usageReports).values(insertReport).returning();
    return report;
  }

  async updateUsageReportSignature(id: string, signature: string): Promise<void> {
    await db.update(usageReports).set({ backendSignature: signature, status: "signed" }).where(eq(usageReports.id, id));
  }

  async confirmUsageReport(id: string, txHash: string): Promise<void> {
    await db.update(usageReports).set({ txHash, status: "confirmed" }).where(eq(usageReports.id, id));
  }

  // User Credits
  async getUserCredit(userAddress: string): Promise<UserCredit | undefined> {
    const [credit] = await db.select().from(userCredits).where(eq(userCredits.userAddress, userAddress));
    return credit || undefined;
  }

  async updateUserRefundBalance(userAddress: string, amount: string): Promise<void> {
    const existing = await this.getUserCredit(userAddress);
    
    if (existing) {
      await db
        .update(userCredits)
        .set({
          refundBalance: sql`${userCredits.refundBalance} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(userCredits.userAddress, userAddress));
    } else {
      await db.insert(userCredits).values({
        userAddress,
        refundBalance: amount,
      });
    }
  }

  // Events
  async createEvent(insertEvent: Omit<Event, "id" | "timestamp">): Promise<Event> {
    const [event] = await db.insert(events).values(insertEvent as any).returning();
    return event;
  }

  async getEventsByJob(jobId: string): Promise<Event[]> {
    return await db.select().from(events).where(eq(events.jobId, jobId)).orderBy(desc(events.timestamp));
  }

  async getEventsByUser(userAddress: string): Promise<Event[]> {
    return await db.select().from(events).where(eq(events.userAddress, userAddress)).orderBy(desc(events.timestamp));
  }
}

export const storage = new DatabaseStorage();
