/**
 * K3s-related types ported from provider-console-api.
 * ControlMachineInput: public IP hostname; WorkerNodeInput: private IP hostname.
 */

export interface ControlMachineInput {
  hostname: string;
  username: string;
  port?: number;
  password?: string | null;
  keyfile?: { filename: string; content: Buffer } | string | null;
  passphrase?: string | null;
}

export interface WorkerNodeInput {
  hostname: string;
  username: string;
  port?: number;
  password?: string | null;
  keyfile?: { filename: string; content: Buffer } | string | null;
  passphrase?: string | null;
}

export interface ApplicationErrorPayload {
  error: string;
  message: string;
  exit_code?: number;
}

export class ApplicationError extends Error {
  statusCode: number = 200;
  errorCode: string = "A0000";
  payload: ApplicationErrorPayload & Record<string, unknown>;

  constructor(
    opts: {
      statusCode?: number;
      errorCode?: string;
      payload?: ApplicationErrorPayload & Record<string, unknown>;
    } = {}
  ) {
    super(opts.payload?.message ?? "Application error");
    this.name = "ApplicationError";
    if (opts.statusCode != null) this.statusCode = opts.statusCode;
    if (opts.errorCode != null) this.errorCode = opts.errorCode;
    this.payload = opts.payload ?? { error: "Error", message: "Application error" };
    Object.setPrototypeOf(this, ApplicationError.prototype);
  }

  toDict(): Record<string, unknown> {
    return { ...this.payload };
  }
}

export interface K3sNodeInfo {
  name: string;
  status: string;
  roles: string;
  age: string;
  version: string;
  internalIP: string;
  externalIP: string;
  osImage: string;
  kernelVersion: string;
  containerRuntime: string;
}

export interface ListNodesResponse {
  nodes: K3sNodeInfo[];
}

export interface CheckInstallationsResponse {
  message: string;
}

export interface InitK3sResponse {
  message: string;
}

export interface JoinNodeResponse {
  message: string;
  stdout?: string;
  stderr?: string;
}

export interface RemoveNodeResponse {
  message: string;
}

export interface GpuInstallResponse {
  message: string;
}
