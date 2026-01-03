import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const providers = pgTable("providers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  address: text("address").notNull().unique(),
  name: text("name").notNull(),
  metaHash: text("meta_hash").notNull(),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  pricing: numeric("pricing", { precision: 10, scale: 2 }).notNull().default("0"),
  earningsBalance: numeric("earnings_balance", { precision: 18, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const jobs = pgTable("jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobNumber: text("job_number").notNull().unique(),
  onChainJobId: text("on_chain_job_id"), // uint256 jobId from JobEscrow contract
  creator: text("creator").notNull(),
  providerId: varchar("provider_id").notNull().references(() => providers.id),
  deposit: numeric("deposit", { precision: 18, scale: 2 }).notNull(),
  spent: numeric("spent", { precision: 18, scale: 2 }).notNull().default("0"),
  remaining: numeric("remaining", { precision: 18, scale: 2 }).notNull(),
  status: text("status", { enum: ["OPEN", "CLOSED", "DISPUTED"] }).notNull().default("OPEN"),
  nonce: integer("nonce").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const usageReports = pgTable("usage_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull().references(() => jobs.id),
  grossCost: numeric("gross_cost", { precision: 18, scale: 2 }).notNull(),
  providerEarn: numeric("provider_earn", { precision: 18, scale: 2 }).notNull(),
  userRefund: numeric("user_refund", { precision: 18, scale: 2 }).notNull().default("0"),
  backendSignature: text("backend_signature"),
  txHash: text("tx_hash"),
  status: text("status", { enum: ["pending", "signed", "confirmed", "failed"] }).notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const userCredits = pgTable("user_credits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userAddress: text("user_address").notNull().unique(),
  refundBalance: numeric("refund_balance", { precision: 18, scale: 2 }).notNull().default("0"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const events = pgTable("events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventType: text("event_type").notNull(),
  jobId: varchar("job_id").references(() => jobs.id),
  providerId: varchar("provider_id").references(() => providers.id),
  userAddress: text("user_address"),
  amount: numeric("amount", { precision: 18, scale: 2 }),
  txHash: text("tx_hash"),
  metadata: text("metadata"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

// Insert Schemas
export const insertProviderSchema = createInsertSchema(providers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  earningsBalance: true,
});

export const insertJobSchema = createInsertSchema(jobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  spent: true,
  remaining: true,
  nonce: true,
  jobNumber: true,
});

export const insertUsageReportSchema = createInsertSchema(usageReports).omit({
  id: true,
  createdAt: true,
  backendSignature: true,
  txHash: true,
  status: true,
});

// Types
export type Provider = typeof providers.$inferSelect;
export type InsertProvider = z.infer<typeof insertProviderSchema>;

export type Job = typeof jobs.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;

export type UsageReport = typeof usageReports.$inferSelect;
export type InsertUsageReport = z.infer<typeof insertUsageReportSchema>;

export type UserCredit = typeof userCredits.$inferSelect;
export type Event = typeof events.$inferSelect;
