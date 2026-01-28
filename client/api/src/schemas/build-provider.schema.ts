import { z } from "zod";

// Node Schema
export const NodeSchema = z.object({
  hostname: z.string().min(1, "Hostname is required"),
  username: z.string().min(1, "Username is required"),
  port: z.number().int().min(1).max(65535).default(22),
  password: z.string().nullable().optional(),
  keyfile: z.string().nullable().optional(), // Base64 encoded keyfile with data: prefix
  passphrase: z.string().nullable().optional(),
  install_gpu_drivers: z.boolean().default(false),
}).refine(
  (data) => data.password || data.keyfile,
  {
    message: "Either password or keyfile must be provided",
    path: ["password"],
  }
).refine(
  (data) => !(data.password && data.keyfile),
  {
    message: "Cannot provide both password and keyfile",
    path: ["password"],
  }
);

export type Node = z.infer<typeof NodeSchema>;

// Attribute Schema
export const AttributeSchema = z.object({
  key: z.string().min(1, "Attribute key is required"),
  value: z.string().min(1, "Attribute value is required"),
});

export type Attribute = z.infer<typeof AttributeSchema>;

// Pricing Schema
export const PricingSchema = z.object({
  cpu: z.number().nullable().optional(),
  memory: z.number().nullable().optional(),
  storage: z.number().nullable().optional(),
  gpu: z.number().nullable().optional(),
  persistentStorage: z.number().nullable().optional(),
  ipScalePrice: z.number().nullable().optional(),
  endpointBidPrice: z.number().nullable().optional(),
});

export type Pricing = z.infer<typeof PricingSchema>;

// Config Schema
export const ConfigSchema = z.object({
  domain: z.string().nullable().optional(),
  organization: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

// Provider Schema
export const ProviderSchema = z.object({
  attributes: z.array(AttributeSchema).min(1, "At least one attribute is required"),
  pricing: PricingSchema,
  config: ConfigSchema,
});

export type Provider = z.infer<typeof ProviderSchema>;

// Wallet (required for prepare provider config / install akash provider)
export const WalletSchema = z.object({
  address: z.string().min(1, "Wallet address is required"),
  key_password: z.string().min(1, "Key password is required"),
});

export type Wallet = z.infer<typeof WalletSchema>;

// Build Provider Request Schema
export const BuildProviderRequestSchema = z.object({
  action_id: z.string().uuid().optional(),
  nodes: z.array(NodeSchema).min(1, "At least one node is required"),
  provider: ProviderSchema,
  wallet: WalletSchema.optional(), // Required for full provider build (prepare config + install provider)
});

export type BuildProviderRequest = z.infer<typeof BuildProviderRequestSchema>;

// Build Provider Response Schema
export const BuildProviderResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
  action_id: z.string().uuid(),
});

export type BuildProviderResponse = z.infer<typeof BuildProviderResponseSchema>;

// Update Provider Attributes Request Schema
export const UpdateProviderAttributesRequestSchema = z.object({
  control_machine: z.object({
    hostname: z.string().min(1, "Hostname is required"),
    port: z.number().int().min(1).max(65535).default(22),
    username: z.string().min(1, "Username is required"),
    password: z.string().nullable().optional(),
    keyfile: z.string().nullable().optional(), // Base64 encoded keyfile with data: prefix
    passphrase: z.string().nullable().optional(),
  }).refine(
    (data) => data.password || data.keyfile,
    {
      message: "Either password or keyfile must be provided",
      path: ["password"],
    }
  ).refine(
    (data) => !(data.password && data.keyfile),
    {
      message: "Cannot provide both password and keyfile",
      path: ["password"],
    }
  ),
  attributes: z.array(z.object({
    key: z.string().min(1, "Attribute key is required"),
    value: z.string().min(1, "Attribute value is required"),
  })).min(1, "At least one attribute is required"),
});

export type UpdateProviderAttributesRequest = z.infer<typeof UpdateProviderAttributesRequestSchema>;

// Update Provider Attributes Response Schema
export const UpdateProviderAttributesResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
  action_id: z.string().uuid().optional(),
});

export type UpdateProviderAttributesResponse = z.infer<typeof UpdateProviderAttributesResponseSchema>;

// Task Status Schema (moved from build-cluster.schema.ts)
export const TaskStatusSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  start_time: z.string().nullable().optional(),
  end_time: z.string().nullable().optional(),
});

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

// Build Provider Status Response Schema (moved from build-cluster.schema.ts)
export const BuildProviderStatusResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  start_time: z.string().nullable().optional(),
  end_time: z.string().nullable().optional(),
  tasks: z.array(TaskStatusSchema),
});

export type BuildProviderStatusResponse = z.infer<typeof BuildProviderStatusResponseSchema>;

// Build Provider Logs Response Schema
export const BuildProviderLogsResponseSchema = z.object({
  logs: z.array(z.string()),
});

export type BuildProviderLogsResponse = z.infer<typeof BuildProviderLogsResponseSchema>;
