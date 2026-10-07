import type http from "node:http";
import path from "node:path";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { open } from "../../shared/sealed.ts";
import { findFreePort, serveSite, writeSite, type StaticSpec } from "./hosting.ts";
import { dockerRunArgs, imageAllowed, realDocker, type ContainerSpec, type DockerOps } from "./container.ts";
import { preStartCheck, type HardeningResult } from "./hardening.ts";
import {
  dueVolumes,
  gpuCountOf,
  keepDaysOf,
  keepUntil,
  newWebToken,
  pickGpus,
  validateWorkstation,
  workstationEnv,
  workstationReport,
  workstationRunArgs,
  type KeptVolume,
  type WorkstationPorts,
  type WorkstationSpec,
} from "./workstation.ts";

export type Kind = "static" | "container" | "workstation";

export interface DeploymentCommand {
  id: string;
  action: "start" | "stop" | "purge"; // purge: workstation only — remove container and volume now
  kind: Kind;
  spec: unknown;
  sealedEnv?: string;
  /** API: the image is on the curated list. Containers/workstations without it (or a CLOUDANA_IMAGE_ALLOWLIST match) are refused. */
  imageAllowed?: boolean;
}

/** Prefix of the `failed` message when this node cannot serve a deployment at all (the API re-queues it elsewhere). */
export const NODE_CANNOT_SERVE = "node cannot serve:";

/** Body of POST /v1/nodes/deployments/{id}/status. */
export interface StatusBody {
  status: "running" | "failed" | "stopped";
  endpoint?: string;
  sshEndpoint?: string; // workstation with ssh access: "host:port"
  webToken?: string; // workstation whose app cannot take its token in the URL (e.g. code-server's PASSWORD)
  message?: string;
}

/** One entry of .data/deployments.json. */
export interface DeploymentRecord {
  id: string;
  kind: Kind;
  port: number | null; // host port of the first exposed port (null: container with no ports)
  ports?: number[]; // every host port it holds (absent on records written by agents < 1.1.0: then [port])
  specHash: string; // sha256 hex of JSON.stringify(spec)
  startedAt: number; // ms epoch
  keepDays?: number; // workstation: days to keep the volume after stop
  gpus?: number[]; // workstation: GPU device indices handed to it
  report?: StatusBody; // workstation: the running report (endpoint with token, sshEndpoint), re-sent on resume
}

/**
 * Sends a status report. true = delivered; false = API unreachable, retry later; { rejected } = the API refused it
 * for good (a rejected `running` makes the manager tear the deployment down and report it as unservable).
 */
export type ReportOutcome = boolean | { rejected: string };
export type Reporter = (id: string, body: StatusBody) => Promise<ReportOutcome>;

export interface ManagerOptions {
  dataDir: string;
  publicHost: string;
  ports: [number, number];
  privateKey: string;
  gpuCount?: number; // GPUs nvidia-smi reported (0 or absent: no gpu capability)
  /** Operator opted in AND the boot hardening self-check passed. Absent/false: container and workstation starts are refused. */
  containersReady?: boolean;
  docker?: DockerOps; // default: the real docker CLI (selftests inject a fake)
  /** Re-checks the egress rules and tenant network before each container start (default: the real iptables/docker). */
  hardening?: () => Promise<HardeningResult>;
  report: Reporter;
  log: (msg: string) => void;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export class DeploymentManager {
  private records = new Map<string, DeploymentRecord>();
  private servers = new Map<string, http.Server>();
  private busy = new Set<string>();
  private pending = new Map<string, StatusBody>();
  private flushing = false;
  private readonly file: string;
  private readonly volumesFile: string;
  private kept = new Map<string, KeptVolume>();
  /** GPU indices per workstation id: reserved synchronously at start, released on stop/purge/failure. */
  private gpuAlloc = new Map<string, number[]>();
  private readonly dk: DockerOps;

  constructor(private o: ManagerOptions) {
    mkdirSync(o.dataDir, { recursive: true });
    this.file = path.join(o.dataDir, "deployments.json");
    this.volumesFile = path.join(o.dataDir, "volumes.json");
    this.dk = o.docker ?? realDocker;
    if (existsSync(this.volumesFile)) {
      try {
        for (const v of JSON.parse(readFileSync(this.volumesFile, "utf8")) as KeptVolume[]) this.kept.set(v.id, v);
      } catch (err) {
        o.log(`volumes.json unreadable, ignoring: ${(err as Error).message}`);
      }
    }
  }

  private siteDir(id: string) {
    return path.join(this.o.dataDir, "sites", id);
  }

  private endpoint(port: number | null) {
    return port === null ? undefined : `http://${this.o.publicHost}:${port}`;
  }

  private save() {
    writeFileSync(this.file, JSON.stringify([...this.records.values()], null, 2));
  }

  private saveVolumes() {
    writeFileSync(this.volumesFile, JSON.stringify([...this.kept.values()], null, 2));
  }

  /** GPU indices currently handed out, by workstation id (tests / inspection). */
  allocatedGpus(): Record<string, number[]> {
    return Object.fromEntries(this.gpuAlloc);
  }

  /** Volumes kept after stop, waiting for keepUntil (tests / inspection). */
  keptVolumes(): KeptVolume[] {
    return [...this.kept.values()];
  }

  /** Every host port held by a known deployment (all ports of multi-port containers, not just the first). */
  private takenPorts() {
    return new Set([...this.records.values()].flatMap((r) => r.ports ?? (r.port === null ? [] : [r.port])));
  }

  /** Queue a report and try to deliver it now; undelivered reports retry on flush(). */
  private async send(id: string, body: StatusBody) {
    this.pending.set(id, body);
    await this.flush();
  }

  /** Retry undelivered status reports (call once per heartbeat). */
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      await this.flushOnce();
    } finally {
      this.flushing = false;
    }
  }

  private async flushOnce(): Promise<void> {
    for (const [id, body] of [...this.pending]) {
      if (this.pending.get(id) !== body) continue;
      let outcome: ReportOutcome = false;
      try {
        outcome = await this.o.report(id, body);
      } catch (err) {
        this.o.log(`deployment ${id}: status report error: ${(err as Error).message}`);
      }
      if (outcome === false) continue;
      if (this.pending.get(id) === body) this.pending.delete(id);
      if (typeof outcome === "object" && body.status === "running") await this.refuse(id, outcome.rejected);
    }
  }

  /**
   * The API refused our `running` report (e.g. the endpoint host is not the one we announced): keeping the
   * deployment up would leave it stuck in "assigned" forever. Tear it down and report it as unservable so the
   * API can place it on another node.
   */
  private async refuse(id: string, why: string) {
    // Usually reached from the start() that just reported, so this id is still marked busy: no extra guard here.
    const rec = this.records.get(id);
    if (!rec) return;
    this.o.log(`deployment ${id}: running report rejected (${why}) — releasing it`);
    this.records.delete(id);
    this.save();
    await this.cleanup(id, rec.kind, rec.keepDays);
    this.pending.set(id, { status: "failed", message: `${NODE_CANNOT_SERVE} ${why}`.slice(0, 500) });
  }

  /** Re-serve persisted static sites and re-check containers after a restart. */
  async resume(): Promise<void> {
    if (!existsSync(this.file)) return;
    let saved: DeploymentRecord[] = [];
    try {
      saved = JSON.parse(readFileSync(this.file, "utf8"));
    } catch (err) {
      this.o.log(`deployments.json unreadable, ignoring: ${(err as Error).message}`);
    }
    for (const r of saved) this.records.set(r.id, r);
    for (const r of saved) {
      try {
        if (r.kind === "static") {
          let port = r.port ?? 0;
          let server: http.Server;
          try {
            server = await serveSite(this.siteDir(r.id), port);
          } catch {
            const taken = this.takenPorts();
            port = await findFreePort(this.o.ports, taken);
            server = await serveSite(this.siteDir(r.id), port);
          }
          this.servers.set(r.id, server);
          this.records.set(r.id, { ...r, port, ports: [port] });
          this.o.log(`deployment ${r.id}: resumed static site on :${port}`);
          await this.send(r.id, { status: "running", endpoint: this.endpoint(port) });
        } else if (await this.dk.running(r.id)) {
          this.o.log(`deployment ${r.id}: container still running`);
          if (r.kind === "workstation") {
            // Docker is the truth for which GPUs the container holds; the saved record may be stale.
            const actual = (await this.dk.gpuDevices(r.id)) ?? r.gpus ?? [];
            this.gpuAlloc.set(r.id, actual);
            this.records.set(r.id, { ...r, gpus: actual });
          }
          await this.send(r.id, r.report ?? { status: "running", endpoint: this.endpoint(r.port) });
        } else {
          throw new Error("container not running after agent restart");
        }
      } catch (err) {
        this.o.log(`deployment ${r.id}: resume failed: ${(err as Error).message}`);
        this.records.delete(r.id);
        await this.cleanup(r.id, r.kind, r.keepDays);
        await this.send(r.id, { status: "failed", message: (err as Error).message });
      }
    }
    this.save();
  }

  /** Handle one heartbeat command. Never throws; one command per id at a time. */
  async handle(cmd: DeploymentCommand): Promise<void> {
    const id = String(cmd?.id ?? "");
    if (!ID.test(id)) {
      this.o.log(`ignoring deployment command with invalid id ${JSON.stringify(cmd?.id)}`);
      return;
    }
    if (this.busy.has(id)) return; // still working on the previous command for this id
    this.busy.add(id);
    try {
      if (cmd.action === "stop") await this.stop(id, cmd.kind, cmd.spec);
      else if (cmd.action === "purge") await this.purge(id);
      else if (cmd.action === "start") await this.start(cmd);
      else this.o.log(`deployment ${id}: unknown action ${JSON.stringify(cmd.action)}`);
    } catch (err) {
      const message = (err as Error).message;
      this.o.log(`deployment ${id}: ${cmd.action} failed: ${message}`);
      await this.send(id, { status: "failed", message });
    } finally {
      this.busy.delete(id);
    }
  }

  private async start(cmd: DeploymentCommand) {
    const { id, kind } = cmd;
    const existing = this.records.get(id);
    if (existing) {
      // Idempotent: already running — just re-report.
      await this.send(id, existing.report ?? { status: "running", endpoint: this.endpoint(existing.port) });
      return;
    }
    const specHash = createHash("sha256").update(JSON.stringify(cmd.spec)).digest("hex");
    let ports: number[];
    let extra: Pick<DeploymentRecord, "keepDays" | "report" | "gpus"> = {};
    try {
      if (kind === "container" || kind === "workstation") {
        // Not opted in / hardening failed at boot: the API should not have sent this; hand it back for re-placement.
        if (!this.o.containersReady) throw new Error(`${NODE_CANNOT_SERVE} this node does not run containers`);
        const image = (cmd.spec as ContainerSpec | undefined)?.image;
        if (typeof image !== "string" || !imageAllowed(image, cmd.imageAllowed)) {
          throw new Error("image is not on the curated list (set CLOUDANA_IMAGE_ALLOWLIST to allow it on this node)");
        }
        // Rules can be flushed and networks recreated while the agent runs: verify again right before each start.
        const h = await (this.o.hardening ?? preStartCheck)();
        if (!h.ok) throw new Error(`${NODE_CANNOT_SERVE} hardening check failed: ${h.reason}`);
      }
      if (kind === "static") ports = [await this.startStatic(id, cmd.spec as StaticSpec)];
      else if (kind === "container") ports = await this.startContainer(id, cmd.spec as ContainerSpec, cmd.sealedEnv);
      else if (kind === "workstation") ({ ports, ...extra } = await this.startWorkstation(id, cmd.spec as WorkstationSpec, cmd.sealedEnv));
      else throw new Error(`unknown kind ${JSON.stringify(kind)}`);
    } catch (err) {
      await this.cleanup(id, kind, keepDaysOf(cmd.spec));
      throw err;
    }
    const port = ports[0] ?? null;
    this.records.set(id, { id, kind, port, ports, specHash, startedAt: Date.now(), ...extra });
    this.save();
    this.o.log(`deployment ${id}: ${kind} running${port === null ? "" : ` on :${ports.join(",")}`}`);
    await this.send(id, extra.report ?? { status: "running", endpoint: this.endpoint(port) });
  }

  private async startStatic(id: string, spec: StaticSpec): Promise<number> {
    writeSite(this.siteDir(id), spec);
    const port = await findFreePort(this.o.ports, this.takenPorts());
    this.servers.set(id, await serveSite(this.siteDir(id), port));
    return port;
  }

  private async startContainer(id: string, spec: ContainerSpec, sealedEnv?: string): Promise<number[]> {
    if (!spec || !Array.isArray(spec.ports)) throw new Error("container spec has no ports array");
    const env: Record<string, string> = { ...(spec.env ?? {}), ...this.openSealed(sealedEnv) };
    const taken = this.takenPorts();
    const hostPorts: number[] = [];
    for (let i = 0; i < spec.ports.length; i++) {
      const p = await findFreePort(this.o.ports, taken);
      taken.add(p);
      hostPorts.push(p);
    }
    await this.dk.remove(id); // a stale container with this name would make `docker run` fail
    await this.dk.run(dockerRunArgs(id, spec, env, hostPorts));
    return hostPorts;
  }

  private openSealed(sealedEnv?: string): Record<string, string> {
    if (!sealedEnv) return {};
    let secret: unknown;
    try {
      secret = JSON.parse(open(this.o.privateKey, sealedEnv));
    } catch {
      throw new Error("could not open sealed env (wrong node key or tampered)");
    }
    if (!secret || typeof secret !== "object" || Array.isArray(secret)) throw new Error("sealed env is not an object");
    return secret as Record<string, string>;
  }

  /** Volume first (reused when it exists), then `docker run`. Tokens and keys never reach the log. */
  private async startWorkstation(
    id: string,
    spec: WorkstationSpec,
    sealedEnv?: string,
  ): Promise<{ ports: number[]; keepDays: number; report: StatusBody; gpus: number[] }> {
    validateWorkstation(spec);
    // Reserve GPUs before the first await so concurrent starts cannot pick the same device.
    const used = new Set([...this.gpuAlloc.values()].flat());
    const gpus = pickGpus(gpuCountOf(spec), this.o.gpuCount ?? 0, used);
    this.gpuAlloc.set(id, gpus);
    const token = spec.tokenEnv && spec.access.web ? newWebToken() : undefined;
    const env = workstationEnv(spec, this.openSealed(sealedEnv), token);
    const taken = this.takenPorts();
    const ports: WorkstationPorts = {};
    for (const k of ["web", "ssh"] as const) {
      if (!spec.access[k]) continue;
      const p = await findFreePort(this.o.ports, taken);
      taken.add(p);
      ports[k] = p;
    }
    const args = workstationRunArgs(id, spec, env, ports, gpus); // validates before touching Docker
    const vol = await this.dk.volumeEnsure(id);
    if (this.kept.delete(id)) this.saveVolumes(); // restarted: no longer scheduled for removal
    this.o.log(`deployment ${id}: volume cld-${id} ${vol}`);
    await this.dk.remove(id); // a stale container with this name would make `docker run` fail
    await this.dk.run(args);
    if (gpus.length) this.o.log(`deployment ${id}: GPU device(s) ${gpus.join(",")}`);
    return {
      gpus,
      ports: [ports.web, ports.ssh].filter((p): p is number => p !== undefined),
      keepDays: keepDaysOf(spec),
      report: workstationReport(this.o.publicHost, spec, ports, token),
    };
  }

  /** Keep a stopped workstation's volume until now + keepDays (0: remove now; housekeeping retries if that fails). */
  private async retainVolume(id: string, keepDays: number) {
    if (keepDays <= 0 && (await this.dk.volumeRemove(id))) {
      if (this.kept.delete(id)) this.saveVolumes();
      return;
    }
    this.kept.set(id, { id, keepUntil: keepUntil(Date.now(), keepDays) });
    this.saveVolumes();
    if (keepDays > 0) this.o.log(`deployment ${id}: volume cld-${id} kept ${keepDays} day(s)`);
  }

  /** Remove kept volumes whose keep period is over. Run on boot and hourly. Volumes that will not go stay listed. */
  async housekeep(): Promise<void> {
    const inUse = new Set([...this.records.keys(), ...this.busy]);
    for (const id of dueVolumes([...this.kept.values()], Date.now(), inUse)) {
      if (this.busy.has(id) || this.records.has(id)) continue; // a start arrived meanwhile
      this.busy.add(id);
      try {
        if (await this.dk.volumeRemove(id)) {
          this.kept.delete(id);
          this.saveVolumes();
          this.o.log(`deployment ${id}: volume cld-${id} removed (keep period over)`);
        }
      } finally {
        this.busy.delete(id);
      }
    }
  }

  /** Workstation purge: container and volume go now. */
  private async purge(id: string) {
    const rec = this.records.get(id);
    await this.dk.remove(id);
    this.gpuAlloc.delete(id);
    if (rec) {
      this.records.delete(id);
      this.save();
    }
    await this.retainVolume(id, 0);
    this.o.log(`deployment ${id}: purged`);
    if (rec) await this.send(id, { status: "stopped" });
  }

  private async stop(id: string, kind: Kind, spec?: unknown) {
    const rec = this.records.get(id);
    await this.cleanup(id, rec?.kind ?? kind, rec?.keepDays ?? keepDaysOf(spec));
    if (rec) {
      this.records.delete(id);
      this.save();
    }
    this.o.log(`deployment ${id}: stopped`);
    await this.send(id, { status: "stopped" });
  }

  /** Close the server / remove the container (a workstation's volume is kept) and delete site files. Best-effort. */
  private async cleanup(id: string, kind: Kind, keepDays?: number) {
    const server = this.servers.get(id);
    if (server) {
      this.servers.delete(id);
      await new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      });
    }
    if (kind === "container") await this.dk.remove(id);
    if (kind === "workstation") {
      await this.dk.remove(id);
      this.gpuAlloc.delete(id);
      await this.retainVolume(id, keepDays ?? keepDaysOf(undefined));
    }
    rmSync(this.siteDir(id), { recursive: true, force: true });
  }

  /** Close every static server (tests / shutdown). Containers keep running under Docker. */
  async closeAll(): Promise<void> {
    await Promise.all(
      [...this.servers.values()].map(
        (s) =>
          new Promise<void>((r) => {
            s.close(() => r());
            s.closeAllConnections();
          }),
      ),
    );
    this.servers.clear();
  }
}
