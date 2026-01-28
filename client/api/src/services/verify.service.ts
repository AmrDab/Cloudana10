import { Client } from "ssh2";
import { createConnection } from "net";
import { promisify } from "util";
import { lookup } from "dns/promises";
import type { ControlMachineInput, WorkerNodeInput, SystemInfo } from "../schemas/verify.schema.js";

const SSH_TIMEOUT = 30000; // 30 seconds

// Decode base64 keyfile from data URI format
function decodeKeyfile(keyfileData: string): Buffer {
  if (!keyfileData) {
    throw new Error("Keyfile is required");
  }

  // Handle data URI format: data:mime/type;base64,<content>
  if (keyfileData.startsWith("data:")) {
    const base64Content = keyfileData.split(",")[1];
    if (!base64Content) {
      throw new Error("Invalid keyfile format: missing base64 content");
    }
    return Buffer.from(base64Content, "base64");
  }

  // If it's already base64 without prefix, decode it
  return Buffer.from(keyfileData, "base64");
}

// Create SSH connection
function createSSHConnection(input: ControlMachineInput | WorkerNodeInput): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const config: any = {
      host: input.hostname,
      port: input.port || 22,
      username: input.username,
      readyTimeout: SSH_TIMEOUT,
    };

    // Set authentication method
    if (input.keyfile) {
      try {
        const keyBuffer = decodeKeyfile(input.keyfile);
        config.privateKey = keyBuffer.toString("utf-8");
        if (input.passphrase) {
          config.passphrase = input.passphrase;
        }
      } catch (error) {
        reject(new Error(`Failed to decode keyfile: ${error instanceof Error ? error.message : String(error)}`));
        return;
      }
    } else if (input.password) {
      config.password = input.password;
    } else {
      reject(new Error("Either password or keyfile must be provided"));
      return;
    }

    conn.on("ready", () => {
      resolve(conn);
    });

    conn.on("error", (err) => {
      reject(err);
    });

    conn.connect(config);
  });
}

// Execute SSH command
function executeSSHCommand(conn: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }

      let stdout = "";
      let stderr = "";

      stream.on("close", (code: number) => {
        if (code !== 0) {
          reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
        } else {
          resolve(stdout);
        }
      });

      stream.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      stream.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
    });
  });
}

// Get system information script (matches Python implementation)
function getSystemInfoScript(): string {
  return `#!/bin/bash
set -e
cpu_info=$(lscpu | grep '^CPU(s):' | awk '{print $2}')
memory_total=$(free -h | grep Mem | awk '{print $2}')
gpu_count=$(lspci -nn | grep -Ei 'vga|3d' | sed -nE 's/.*\[(10de:[0-9a-f]+)\].*/\\1/p' | wc -l)
os_info=$(lsb_release -d 2>/dev/null | cut -f2 || echo "Unknown")
storage_data=$(df -h | awk 'NR>1 {print "{\\"path\\":\\""$6"\\",\\"size\\":\\""$2"\\",\\"available\\":\\""$4"\\"}"}' | paste -sd,)

echo "{\\"cpu\\":$cpu_info,\\"memory\\":\\"$memory_total\\",\\"storage_data\\":[$storage_data],\\"os\\":\\"$os_info\\",\\"gpus\\":$gpu_count}"`;
}

// Check if port is open (connection timeout: Node's createConnection ignores timeout option, so we use a timer)
const PORT_CHECK_TIMEOUT_MS = 10_000;

function checkPort(host: string, port: number, timeoutMs: number = PORT_CHECK_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (open: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(open);
    };

    const timer = setTimeout(() => done(false), timeoutMs);
    const socket = createConnection({ host, port }, () => {
      done(true);
    });

    socket.on("error", () => {
      done(false);
    });
  });
}

export class VerifyService {
  async verifyControlMachine(input: ControlMachineInput): Promise<{ system_info: SystemInfo }> {
    const conn = await createSSHConnection(input);

    try {
      // Execute system info script
      const script = getSystemInfoScript();
      const output = await executeSSHCommand(conn, script);
      
      // Parse system info
      const systemInfo = JSON.parse(output.trim());
      
      // Process storage data
      const storage = Array.isArray(systemInfo.storage_data) 
        ? systemInfo.storage_data 
        : [];

      const result: SystemInfo = {
        cpu: systemInfo.cpu || 0,
        memory: systemInfo.memory || "0",
        storage: storage,
        os: systemInfo.os || "Unknown",
        gpu: {
          count: systemInfo.gpus || 0,
          vendor: null,
          name: null,
          memory_size: null,
          interface: null,
        },
      };

      return { system_info: result };
    } finally {
      conn.end();
    }
  }

  async verifyControlAndWorker(
    controlInput: ControlMachineInput,
    workerInput: WorkerNodeInput
  ): Promise<{ system_info: SystemInfo }> {
    // First connect to control machine
    const controlConn = await createSSHConnection(controlInput);

    try {
      // For worker node, we need to connect through control machine
      // This is a simplified version - in production, you'd use SSH tunneling
      const workerConn = await createSSHConnection(workerInput);

      try {
        const script = getSystemInfoScript();
        const output = await executeSSHCommand(workerConn, script);
        const systemInfo = JSON.parse(output.trim());

        const storage = Array.isArray(systemInfo.storage_data) 
          ? systemInfo.storage_data 
          : [];

        const result: SystemInfo = {
          cpu: systemInfo.cpu || 0,
          memory: systemInfo.memory || "0",
          storage: storage,
          os: systemInfo.os || "Unknown",
          gpu: {
            count: systemInfo.gpus || 0,
            vendor: null,
            name: null,
            memory_size: null,
            interface: null,
          },
          has_sudo: true, // Would check this in production
        };

        return { system_info: result };
      } finally {
        workerConn.end();
      }
    } finally {
      controlConn.end();
    }
  }

  async checkPorts(publicIp: string, ports: number[]): Promise<{ open_ports: number[]; closed_ports: number[] }> {
    const results = await Promise.all(
      ports.map(async (port) => ({
        port,
        isOpen: await checkPort(publicIp, port),
      }))
    );

    const openPorts = results.filter((r) => r.isOpen).map((r) => r.port);
    const closedPorts = results.filter((r) => !r.isOpen).map((r) => r.port);

    return { open_ports: openPorts, closed_ports: closedPorts };
  }

  async resolveDomains(domains: string[]): Promise<{ public_ips: Array<Record<string, string>> }> {
    const results = await Promise.all(
      domains.map(async (domain) => {
        try {
          const addresses = await lookup(domain, { family: 4 });
          // Check if IP is public (not private/localhost)
          const ip = addresses.address;
          const isPrivate = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|169\.254\.)/.test(ip);
          
          if (isPrivate) {
            throw new Error(`Domain ${domain} resolves to private IP: ${ip}`);
          }
          
          // Return format: { domain: ip } to match Python implementation
          return { [domain]: ip };
        } catch (error) {
          throw new Error(`Failed to resolve domain ${domain}: ${error instanceof Error ? error.message : String(error)}`);
        }
      })
    );

    return { public_ips: results };
  }
}
