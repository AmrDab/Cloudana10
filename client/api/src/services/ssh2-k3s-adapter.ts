/**
 * ssh2-based IK3sSSHAdapter for K3sService.
 * Supports getClient, runCommand, closeClient. connectToWorkerNode connects
 * directly to the worker (use when worker is reachable); jump-host via
 * control is not implemented.
 */

import { Client } from "ssh2";
import type { ControlMachineInput, WorkerNodeInput } from "../types/k3s.js";
import type { IK3sSSHAdapter, SSHClient, RunSSHOptions } from "./k3s.service.js";
import { ApplicationError } from "../types/k3s.js";

const SSH_TIMEOUT_MS = 30_000;

function decodeKeyfile(keyfile: string | { filename: string; content: Buffer } | null | undefined): Buffer {
  if (!keyfile) throw new Error("Keyfile is required");
  if (typeof keyfile === "object" && Buffer.isBuffer(keyfile.content)) return keyfile.content;
  const raw = typeof keyfile === "string" ? keyfile : "";
  if (raw.startsWith("data:")) {
    const b64 = raw.split(",")[1];
    if (!b64) throw new Error("Invalid keyfile data URI");
    return Buffer.from(b64, "base64");
  }
  return Buffer.from(raw, "base64");
}

function toSsh2Config(input: ControlMachineInput | WorkerNodeInput): Record<string, unknown> {
  const config: Record<string, unknown> = {
    host: input.hostname,
    port: input.port ?? 22,
    username: input.username,
    readyTimeout: SSH_TIMEOUT_MS,
  };
  if (input.keyfile) {
    try {
      const buf = decodeKeyfile(input.keyfile);
      (config as Record<string, string>).privateKey = buf.toString("utf8");
      if (input.passphrase) (config as Record<string, string>).passphrase = input.passphrase;
    } catch (e) {
      throw new ApplicationError({
        statusCode: 400,
        errorCode: "KEY_001",
        payload: {
          error: "Keyfile Error",
          message: `Failed to decode keyfile: ${e instanceof Error ? e.message : String(e)}`,
        },
      });
    }
  } else if (input.password) {
    (config as Record<string, string>).password = input.password;
  } else {
    throw new ApplicationError({
      statusCode: 400,
      errorCode: "AUTH_002",
      payload: {
        error: "Authentication Error",
        message: "Either keyfile or password must be provided",
      },
    });
  }
  return config;
}

function connect(input: ControlMachineInput | WorkerNodeInput): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on("ready", () => resolve(conn));
    conn.on("error", (err) => reject(err));
    conn.connect(toSsh2Config(input) as object);
  });
}

function runCommand(
  conn: Client,
  command: string,
  opts: RunSSHOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  const { checkExitStatus = true, onLine } = opts;
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      let stdout = "";
      let stderr = "";
      let outLineBuf = "";
      let errLineBuf = "";
      const flushLine = (buf: string, stream: "stdout" | "stderr") => {
        if (!onLine || !buf.trim()) return;
        onLine(buf, stream);
      };
      const push = (buf: Buffer, stream: "stdout" | "stderr") => {
        const s = buf.toString();
        if (stream === "stdout") {
          stdout += s;
          if (onLine) {
            const parts = (outLineBuf + s).split(/\r?\n/);
            outLineBuf = parts.pop() ?? "";
            for (const l of parts) flushLine(l, "stdout");
          }
        } else {
          stderr += s;
          if (onLine) {
            const parts = (errLineBuf + s).split(/\r?\n/);
            errLineBuf = parts.pop() ?? "";
            for (const l of parts) flushLine(l, "stderr");
          }
        }
      };
      stream.on("data", (data: Buffer) => push(data, "stdout"));
      stream.stderr.on("data", (data: Buffer) => push(data, "stderr"));
      stream.on("close", (code: number) => {
        if (onLine) {
          if (outLineBuf.trim()) onLine(outLineBuf, "stdout");
          if (errLineBuf.trim()) onLine(errLineBuf, "stderr");
        }
        if (checkExitStatus && code !== 0) {
          reject(
            new ApplicationError({
              statusCode: 500,
              errorCode: "SSH_004",
              payload: {
                error: "SSH Command Failed",
                message: `Command failed with exit code ${code}: ${stderr || stdout}`,
                exit_code: code,
              },
            })
          );
        } else {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        }
      });
    });
  });
}

export class Ssh2K3sAdapter implements IK3sSSHAdapter {
  async getClient(input: ControlMachineInput | WorkerNodeInput): Promise<SSHClient> {
    return connect(input) as Promise<SSHClient>;
  }

  async closeClient(client: SSHClient): Promise<void> {
    const c = client as Client;
    return new Promise((resolve) => {
      c.on("close", () => resolve());
      c.end();
    });
  }

  async runCommand(
    client: SSHClient,
    command: string,
    opts?: RunSSHOptions
  ): Promise<{ stdout: string; stderr: string }> {
    return runCommand(client as Client, command, opts ?? {});
  }

  async connectToWorkerNode(
    _controlClient: SSHClient,
    workerInput: WorkerNodeInput
  ): Promise<SSHClient> {
    // Connect directly to worker (worker must be reachable from this process).
    // Jump-host through control is not implemented.
    return connect(workerInput) as Promise<SSHClient>;
  }
}
