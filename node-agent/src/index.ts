import os from "node:os";
import { readFileSync } from "node:fs";
import type { PrivateKeyAccount } from "viem";
import { fileURLToPath } from "node:url";
import { loadOrCreateKey, loadOrCreatePrivateKey } from "./key.ts";
import { detectHardware, benchmarkMmacPerSec, type Manifest } from "./hardware.ts";
import { signRequest, sha256hex, learnClockOffset, clockOffset, serverNow } from "./signing.ts";
import { solveAssignedJob } from "../../pouw/src/index.ts";
import { publicKeyOf } from "../../shared/sealed.ts";
import { dockerAvailable } from "./container.ts";
import { hardeningSelfCheck } from "./hardening.ts";
import { detectPublicIp } from "./public-ip.ts";
import { DeploymentManager, type DeploymentCommand, type ReportOutcome } from "./deployments.ts";
import { workTypes as capabilities } from "./workstation.ts";
import { DEFAULT_INSTRUCTION_SIGNER, NonceLru, verifyInstruction } from "./instructions.ts";

interface Args {
  api: string;
  name: string;
  site: string;
  publicHost: string;
  ports: [number, number];
}

/** Heartbeat period (spec: 15 s; the API counts a node online for NODE_ACTIVE_SECONDS = 45 s). */
const HEARTBEAT_MS = 15_000;

/** This agent's version, from package.json (../package.json next to src/ — the Dockerfile copies it next to dist/ too). */
export function agentVersion(): string {
  try {
    const v = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
    return typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v) ? v : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function parsePorts(s: string): [number, number] {
  const m = /^(\d+)-(\d+)$/.exec(s.trim());
  const lo = m ? Number(m[1]) : NaN;
  const hi = m ? Number(m[2]) : NaN;
  if (!(lo >= 1 && hi <= 65535 && lo <= hi)) throw new Error(`invalid port range ${JSON.stringify(s)} (want e.g. 42000-42100)`);
  return [lo, hi];
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = "true";
      }
    }
  }
  return {
    api: (opts.api ?? process.env.CLOUDANA_API ?? "https://api.cloudana.io").replace(/\/+$/, ""),
    name: opts.name ?? "default",
    site: opts.site ?? process.env.CLOUDANA_SITE ?? "https://cloudana.io",
    publicHost: opts["public-host"] ?? process.env.CLOUDANA_PUBLIC_HOST ?? "127.0.0.1",
    ports: parsePorts(opts.ports ?? process.env.CLOUDANA_PORTS ?? "42000-42100"),
  };
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** API is unreachable at the network level (down, wrong port, etc). */
class Unreachable extends Error {}
/** Unrecoverable — the agent should stop (e.g. bad signature). */
class Fatal extends Error {}

const { api, name, site, publicHost: publicHostArg, ports } = parseArgs();
/** Datacenter fleet token: binds this node to the fleet owner's wallet on announce, no bind link. */
const fleetToken = process.env.CLOUDANA_FLEET_TOKEN?.trim() || undefined;
const allowContainers = /^(1|true|yes)$/i.test(process.env.CLOUDANA_ALLOW_CONTAINERS ?? "");
const instructionSigner = (process.env.CLOUDANA_INSTRUCTION_SIGNER?.trim() || DEFAULT_INSTRUCTION_SIGNER) ?? null;
const VERSION = agentVersion();

if (!/^https:\/\//i.test(api) && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(api)) {
  log(`fatal: CLOUDANA_API must be https (got ${api}); plain http is allowed only for 127.0.0.1 / localhost`);
  process.exit(1);
}
// The zero address is what an unset/garbage key recovers to in some paths: never a valid pin.
if (!instructionSigner || !/^0x[0-9a-fA-F]{40}$/.test(instructionSigner) || /^0x0{40}$/.test(instructionSigner)) {
  log("fatal: no instruction signer pinned — set CLOUDANA_INSTRUCTION_SIGNER to the address shown by GET /v1/nodes/instruction-key");
  process.exit(1);
}

async function request(account: PrivateKeyAccount, method: "POST", path: string, body: unknown, retry = true): Promise<any> {
  const bodyStr = body === undefined ? "{}" : JSON.stringify(body);
  const headers = await signRequest(account, method, path, bodyStr);

  let res: Response;
  try {
    res = await fetch(`${api}${path}`, {
      method,
      headers: { ...headers, "content-type": "application/json" },
      body: bodyStr,
    });
  } catch {
    throw new Unreachable();
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {}

  if (res.status === 401) {
    const message = json?.error?.message ?? "unauthorized — bad signature";
    // A stale timestamp (clock skew, or the machine slept between signing and sending) is not fatal:
    // learn the server's clock from its Date header and sign again. Only a bad signature is fatal.
    if (/timestamp/i.test(message)) {
      const before = clockOffset();
      const offset = learnClockOffset(res.headers.get("date"));
      if (retry) {
        if (offset !== before) log(`clock skew: using server time (offset ${Math.round(offset / 1000)} s)`);
        return request(account, method, path, body, false);
      }
      throw new Error(`${message} (clock offset ${Math.round(offset / 1000)} s) — will retry`);
    }
    if (/replay|nonce/i.test(message)) throw new Error(message); // transient: a retried request reused its nonce
    throw new Fatal(message);
  }
  if (!res.ok || !json || json.status !== "success") {
    throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  }
  return json;
}

async function main() {
  const account = loadOrCreateKey(name);
  const privateKey = loadOrCreatePrivateKey(name);
  log(`cloudana node agent ${VERSION} · node address: ${account.address} · api ${api}`);
  log(`instruction signer pinned: ${instructionSigner}`);

  let publicHost = publicHostArg;
  if (publicHost === "auto") {
    const ip = await detectPublicIp();
    publicHost = ip ?? "127.0.0.1";
    log(ip ? `public host (auto): ${ip}` : "public host (auto): lookup failed, using 127.0.0.1");
  }

  // Containers only when the operator opted in AND the hardening self-check passes (tenant network + egress rules).
  const hasDocker = await dockerAvailable();
  let containersReady = false;
  if (allowContainers) {
    if (!hasDocker) log("containers: CLOUDANA_ALLOW_CONTAINERS is set but Docker does not answer — not announcing `container`");
    else {
      const check = await hardeningSelfCheck();
      for (const n of check.notes) log(`hardening: ${n}`);
      if (check.ok) containersReady = true;
      else log(`containers refused: ${check.reason}`);
    }
  } else if (hasDocker) {
    log("containers: Docker found but CLOUDANA_ALLOW_CONTAINERS is not set — this node does compute + static hosting only");
  }
  const manifest: Manifest = detectHardware(); // gpus come from nvidia-smi (3 s timeout; [] without it)
  const workTypes = capabilities(containersReady, manifest.gpus);
  log(`capabilities: ${workTypes.join(", ")} · serving on ${publicHost}:${ports[0]}-${ports[1]}`);

  const deployments = new DeploymentManager({
    dataDir: fileURLToPath(new URL("../.data/", import.meta.url)),
    publicHost,
    ports,
    privateKey,
    containersReady,
    gpuCount: workTypes.includes("gpu") ? manifest.gpus.length : 0,
    log,
    // true = delivered; false = API unreachable, retry next heartbeat; { rejected } = refused for good.
    report: async (id, body): Promise<ReportOutcome> => {
      try {
        await request(account, "POST", `/v1/nodes/deployments/${encodeURIComponent(id)}/status`, body);
        return true;
      } catch (err) {
        if (err instanceof Unreachable) return false;
        if (err instanceof Fatal) throw err;
        log(`deployment ${id}: status ${body.status} rejected: ${(err as Error).message}`);
        return { rejected: (err as Error).message };
      }
    },
  });
  await deployments.resume();
  // Workstation volumes past their keep period: on boot, then hourly.
  if (hasDocker) {
    const housekeep = () => deployments.housekeep().catch((err) => log(`volume housekeeping: ${(err as Error).message}`));
    await housekeep();
    setInterval(housekeep, 60 * 60_000).unref();
  }

  const gpuStr = manifest.gpus.length ? `, GPUs: ${manifest.gpus.map((g) => g.name).join(", ")}` : "";
  log(`hardware: ${manifest.cpuThreads} threads, ${manifest.ramGB} GB RAM, ${manifest.os}${gpuStr}`);

  const mmacPerSec = benchmarkMmacPerSec();
  log(`benchmark: ${mmacPerSec.toFixed(1)} MMAC/s`);

  const deviceId = ("0x" + sha256hex(account.address + os.hostname())) as `0x${string}`;
  const seenNonces = new NonceLru();

  let bound = false;
  let lastBindUrl = "";
  let jobsDone = 0;
  let earnedUcld = 0;
  let lastUnreachableLog = 0;
  let lastIgnoredLog = 0;
  let upgradeWarned = false;

  function noteUnreachable() {
    const now = Date.now();
    if (now - lastUnreachableLog >= 30_000) {
      log("waiting for API…");
      lastUnreachableLog = now;
    }
  }

  // SIGTERM too: in a container the agent is PID 1, where an unhandled SIGTERM is ignored.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      log(`session totals: ${jobsDone} job(s), ${(earnedUcld / 1e6).toFixed(6)} CLD earned`);
      process.exit(0);
    });
  }

  async function announce(): Promise<void> {
    const res = await request(account, "POST", "/v1/nodes/announce", {
      manifest,
      benchmarkMmacPerSec: mmacPerSec,
      workTypes,
      pubkey: publicKeyOf(privateKey),
      publicHost,
      agentVersion: VERSION,
      ...(fleetToken && { fleetToken }),
    });
    const wasBound = bound;
    bound = !!res.bound;
    if (bound && !wasBound && res.fleetId) {
      log(`Joined fleet ${res.fleetId} — earnings go to ${res.payout}`);
    } else if (!bound) {
      const url = `${site}/app/provide.html?node=${account.address}&code=${res.bindCode}`;
      if (url === lastBindUrl) return; // print the link once, not on every re-announce
      lastBindUrl = url;
      const line = `Bind this node to your wallet: ${url}`;
      const border = "─".repeat(line.length + 2);
      log(`┌${border}┐`);
      log(`│ ${line} │`);
      log(`└${border}┘`);
    } else if (!wasBound) {
      log(`bound — payout wallet: ${res.payout}`);
    }
  }

  async function handleAssignment(a: any): Promise<void> {
    log(`job ${a.jobId} n=${a.n}`);
    const start = performance.now();
    const { certificate, result } = solveAssignedJob(a.sigma, a.matrixA, a.matrixB, a.n, account.address, deviceId);
    const elapsedSec = (performance.now() - start) / 1000;
    try {
      const res = await request(account, "POST", "/v1/work/submit", { jobId: a.jobId, certificate, result });
      const laneA = res.earned?.laneAUcld ?? 0;
      const laneB = res.earned?.laneBUcld ?? 0;
      const total = laneA + laneB;
      jobsDone++;
      earnedUcld += total;
      log(`✓ verified · earned ${laneA} + ${laneB} µCLD (≈ ${(total / 1e6).toFixed(6)} CLD) [${elapsedSec.toFixed(2)}s]`);
    } catch (err) {
      if (err instanceof Fatal) throw err;
      log(`✗ job ${a.jobId} failed: ${(err as Error).message}`);
    }
  }

  // Register once, retrying through outages.
  while (true) {
    try {
      await announce();
      break;
    } catch (err) {
      if (err instanceof Fatal) {
        log(`fatal: ${err.message}`);
        process.exit(1);
      }
      if (err instanceof Unreachable) noteUnreachable();
      else log(`announce failed: ${(err as Error).message}`);
      await sleep(HEARTBEAT_MS);
    }
  }

  // Heartbeat loop. Re-announce occasionally while unbound to pick up the bind.
  let ticksSinceAnnounce = 0;
  while (true) {
    await sleep(HEARTBEAT_MS);
    try {
      const res = await request(account, "POST", "/v1/nodes/heartbeat", { agentVersion: VERSION });
      if (res.upgradeRequired && !upgradeWarned) {
        upgradeWarned = true;
        log(`⚠ this agent (${VERSION}) is below the network minimum ${res.minAgentVersion}: no work until it is upgraded`);
      }
      // Only instructions signed by the pinned key, fresh and unseen, are acted on. Everything else is ignored.
      // Freshness is judged against the learned server clock, like our own request timestamps.
      const body = { assignment: res.assignment ?? null, deployments: Array.isArray(res.deployments) ? res.deployments : [] };
      const verdict = await verifyInstruction(res, account.address, body, instructionSigner!, seenNonces, serverNow());
      if (!verdict.ok) {
        if (body.assignment || body.deployments.length) {
          const now = Date.now();
          if (now - lastIgnoredLog >= 60_000) {
            lastIgnoredLog = now;
            log(`ignoring heartbeat instructions: ${verdict.reason} (signer ${instructionSigner})`);
          }
        }
      } else {
        // Deployment commands run in the background so slow image pulls never stall heartbeats.
        for (const cmd of body.deployments as DeploymentCommand[]) void deployments.handle(cmd);
        if (body.assignment) await handleAssignment(body.assignment);
      }
      void deployments.flush();

      ticksSinceAnnounce++;
      if (!bound && ticksSinceAnnounce >= 5) {
        ticksSinceAnnounce = 0;
        await announce();
      }
    } catch (err) {
      if (err instanceof Fatal) {
        log(`fatal: ${err.message}`);
        process.exit(1);
      }
      if (err instanceof Unreachable) noteUnreachable();
      else log(`heartbeat error: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  log(`fatal: ${(err as Error).message}`);
  process.exit(1);
});
