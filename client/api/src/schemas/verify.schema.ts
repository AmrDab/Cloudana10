import { z } from "zod";

// Control Machine Input Schema
export const ControlMachineInputSchema = z.object({
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
);

export type ControlMachineInput = z.infer<typeof ControlMachineInputSchema>;

// Worker Node Input Schema
export const WorkerNodeInputSchema = z.object({
  hostname: z.string().min(1, "Hostname is required"),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().min(1, "Username is required"),
  password: z.string().nullable().optional(),
  keyfile: z.string().nullable().optional(),
  passphrase: z.string().nullable().optional(),
  is_control_plane: z.boolean().optional(),
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

export type WorkerNodeInput = z.infer<typeof WorkerNodeInputSchema>;

// Control and Worker Request Schema
export const ControlAndWorkerRequestSchema = z.object({
  control_machine: ControlMachineInputSchema,
  worker_node: WorkerNodeInputSchema,
});

export type ControlAndWorkerRequest = z.infer<typeof ControlAndWorkerRequestSchema>;

// Open Ports Request Schema
export const OpenPortsRequestSchema = z.object({
  public_ip: z.string().min(1, "Public IP is required"),
  ports: z.array(z.number().int().min(1).max(65535)),
});

export type OpenPortsRequest = z.infer<typeof OpenPortsRequestSchema>;

// DNS Request Schema
export const DNSRequestSchema = z.object({
  domains: z.array(z.string().min(1, "Domain is required")),
});

export type DNSRequest = z.infer<typeof DNSRequestSchema>;

// System Info Response Schema
export const SystemInfoSchema = z.object({
  cpu: z.number(),
  memory: z.string(),
  storage: z.array(z.object({
    path: z.string(),
    size: z.string(),
    available: z.string(),
  })),
  os: z.string(),
  gpu: z.object({
    count: z.number(),
    vendor: z.string().nullable(),
    name: z.string().nullable(),
    memory_size: z.string().nullable(),
    interface: z.string().nullable(),
  }).optional(),
  public_key: z.string().optional(),
  key_id: z.string().optional(),
  has_sudo: z.boolean().optional(),
});

export type SystemInfo = z.infer<typeof SystemInfoSchema>;

// Verify Control Machine Response Schema
export const VerifyControlMachineResponseSchema = z.object({
  status: z.string(),
  system_info: SystemInfoSchema,
});

export type VerifyControlMachineResponse = z.infer<typeof VerifyControlMachineResponseSchema>;

// Verify Control and Worker Response Schema
export const VerifyControlAndWorkerResponseSchema = z.object({
  status: z.string(),
  system_info: SystemInfoSchema,
});

export type VerifyControlAndWorkerResponse = z.infer<typeof VerifyControlAndWorkerResponseSchema>;

// Open Ports Response Schema
export const OpenPortsResponseSchema = z.object({
  open_ports: z.array(z.number()),
  closed_ports: z.array(z.number()),
});

export type OpenPortsResponse = z.infer<typeof OpenPortsResponseSchema>;

// DNS Response Schema (format: [{ domain: ip }])
export const DNSResponseSchema = z.object({
  public_ips: z.array(z.record(z.string(), z.string())),
});

export type DNSResponse = z.infer<typeof DNSResponseSchema>;
