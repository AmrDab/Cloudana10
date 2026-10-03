// Workstation selftest: pure argv/env/report/volume functions, plus the manager's stop/purge volume bookkeeping.
// Needs neither Docker nor a GPU.
import os from "node:os";
import path from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { parseNvidiaSmi } from "./hardware.ts";
import { parseDeviceRequests, type DockerOps } from "./container.ts";
import { DeploymentManager, type StatusBody } from "./deployments.ts";
import {
  dueVolumes,
  keepDaysOf,
  newWebToken,
  pickGpus,
  workTypes,
  workstationEnv,
  workstationReport,
  workstationRunArgs,
  type WorkstationSpec,
} from "./workstation.ts";

let passed = 0;
function check(cond: unknown, msg: string) {
  if (!cond) {
    console.error(`✗ workstation selftest failed: ${msg}`);
    process.exit(1);
  }
  passed++;
}
function throws(fn: () => unknown, re: RegExp, msg: string) {
  try {
    fn();
  } catch (err) {
    return check(re.test((err as Error).message), `${msg} (got "${(err as Error).message}")`);
  }
  check(false, `${msg} (did not throw)`);
}
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
const allAfter = (args: string[], flag: string) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));

const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq0 me@laptop";
const base: WorkstationSpec = {
  image: "jupyter/pytorch-notebook",
  ports: [],
  cpu: 4000,
  memMb: 16384,
  storageMb: 51200,
  tier: "on-demand",
  maxHours: 4,
  gpu: { count: 1 },
  access: { web: { port: 8888 } },
  volume: { sizeGb: 50, keepDays: 7 },
  tokenEnv: "JUPYTER_TOKEN",
};

async function main() {
  // Capabilities + nvidia-smi parsing
  const gpus = parseNvidiaSmi("NVIDIA GeForce RTX 4090, 24564 MiB\nNVIDIA A100-SXM4-80GB, 81920 MiB\n\n");
  check(gpus.length === 2 && gpus[0].name === "NVIDIA GeForce RTX 4090" && gpus[0].vramGB === 24, "parse nvidia-smi");
  check(gpus[1].vramGB === 80, "parse vram GB");
  check(parseNvidiaSmi("Tesla T4, [N/A]")[0].vramGB === 0, "unparseable vram → 0");
  check(workTypes(false, []).join() === "matmul,hosting", "no docker, no gpu");
  check(workTypes(true, []).join() === "matmul,hosting,container", "docker, no gpu");
  check(workTypes(false, gpus).join() === "matmul,hosting", "gpu without docker is not advertised");
  check(workTypes(true, gpus).join() === "matmul,hosting,container,gpu", "docker + gpu");

  // Token
  const token = newWebToken();
  check(/^[A-Za-z0-9_-]{32}$/.test(token) && token !== newWebToken(), "24-byte base64url token");

  // GPU / no-GPU command
  const env = workstationEnv(base, {}, token);
  check(env.JUPYTER_TOKEN === token, "token env set under tokenEnv");
  let a = workstationRunArgs("ws1", base, env, { web: 42001 }, [1]);
  check(a.slice(0, 6).join(" ") === "run -d --name cld-ws1 --restart unless-stopped", "name + restart");
  check(after(a, "--memory") === "16384m" && after(a, "--cpus") === "4" && a.includes("--shm-size=1g"), "limits + shm");
  check(after(a, "--gpus") === '"device=1"' && !a.some((x) => /count=|^all$/.test(x)), "--gpus device=<i>, never count/all");
  check(after(a, "-v") === "cld-ws1:/workspace", "volume cld-<id> at default workdir");
  check(allAfter(a, "-p").join() === "42001:8888", "web port mapping");
  check(a[a.length - 1] === "jupyter/pytorch-notebook", "image last when no command");
  a = workstationRunArgs("ws1", { ...base, gpu: { count: 2 } }, env, { web: 42001 }, [0, 2]);
  check(after(a, "--gpus") === '"device=0,2"', "--gpus \"device=0,2\" for two GPUs");
  throws(() => workstationRunArgs("ws1", { ...base, gpu: { count: 2 } }, env, { web: 1 }, [0]), /do not match/, "device count must match");
  a = workstationRunArgs("ws1", { ...base, gpu: { count: 0 } }, env, { web: 42001 }, []);
  check(!a.includes("--gpus"), "CPU workstation has no --gpus");
  check(!workstationRunArgs("ws1", { ...base, gpu: undefined }, env, { web: 42001 }, []).includes("--gpus"), "no gpu field");
  check(pickGpus(2, 4, new Set([0, 2])).join() === "1,3" && pickGpus(0, 0, new Set()).length === 0, "lowest free indices");
  throws(() => pickGpus(1, 0, new Set()), /no usable GPU/, "GPU spec on a GPU-less node");
  throws(() => pickGpus(2, 2, new Set([1])), /not enough free GPUs/, "over-subscription refused");
  a = workstationRunArgs("ws1", { ...base, workdir: "/home/coder/project" }, env, { web: 42001 }, [0]);
  check(after(a, "-v") === "cld-ws1:/home/coder/project", "template workdir");
  for (const w of ["relative", "/a:/b", "/a,b", "/../etc", "/x y"])
    throws(() => workstationRunArgs("ws1", { ...base, workdir: w }, env, { web: 1 }, [0]), /workdir/, `workdir ${w} rejected`);

  // SSH
  const ssh: WorkstationSpec = { ...base, image: "pytorch-sshd", access: { ssh: { publicKey: KEY } }, tokenEnv: undefined };
  const sshEnv = workstationEnv(ssh, {}, undefined);
  check(sshEnv.PUBLIC_KEY === KEY && sshEnv.SSH_PUBLIC_KEY === KEY, "public key injected as PUBLIC_KEY + SSH_PUBLIC_KEY");
  a = workstationRunArgs("ws2", ssh, sshEnv, { ssh: 42005 }, [0]);
  check(allAfter(a, "-p").join() === "42005:22", "ssh → container port 22");
  a = workstationRunArgs("ws2", { ...ssh, sshPort: 2222 }, sshEnv, { ssh: 42005 }, [0]);
  check(allAfter(a, "-p").join() === "42005:2222", "template sshPort");
  a = workstationRunArgs("ws2", { ...base, access: { web: { port: 8888 }, ssh: { publicKey: KEY } } }, env, { web: 42001, ssh: 42002 }, [0]);
  check(allAfter(a, "-p").join() === "42001:8888,42002:22", "web + ssh mappings");
  throws(() => workstationRunArgs("ws2", ssh, sshEnv, {}, [0]), /host port for ssh/, "ssh without a host port");
  for (const k of ["ssh-ed25519 AAAA\nssh-rsa BBBB evil", "command=\"sh\" ssh-ed25519 AAAA", "not a key"])
    throws(() => workstationRunArgs("ws2", { ...ssh, access: { ssh: { publicKey: k } } }, {}, { ssh: 1 }, [0]), /ssh public key/, "bad key rejected");
  throws(() => workstationRunArgs("ws3", { ...base, access: {} }, {}, {}, [0]), /access\.web or access\.ssh/, "access required");

  // Env key validation
  throws(() => workstationRunArgs("ws1", base, { "BAD KEY": "x" }, { web: 1 }, [0]), /invalid env key/, "env key with space");
  throws(() => workstationRunArgs("ws1", base, { "A=B": "x" }, { web: 1 }, [0]), /invalid env key/, "env key with =");
  throws(() => workstationRunArgs("ws1", base, { "--privileged": "x" }, { web: 1 }, [0]), /invalid env key/, "env key as flag");
  throws(() => workstationRunArgs("ws1", { ...base, tokenEnv: "X;rm" }, {}, { web: 1 }, [0]), /tokenEnv/, "bad tokenEnv");

  // No shell injection: hostile strings stay single argv elements; flag-like images are rejected.
  const evil = "$(rm -rf /); `id` && echo pwned | sh";
  a = workstationRunArgs("ws1", { ...base, command: ["bash", "-c", evil] }, { X: evil }, { web: 42001 }, [0]);
  check(a.slice(-3).join("\u0000") === ["bash", "-c", evil].join("\u0000"), "command passed verbatim, after image");
  check(a.includes(`X=${evil}`) && a[a.indexOf(`X=${evil}`) - 1] === "-e", "env value is one argv element");
  throws(() => workstationRunArgs("ws1", { ...base, image: "--privileged" }, {}, { web: 1 }, [0]), /invalid image/, "flag image");
  throws(() => workstationRunArgs("ws1", { ...base, command: "rm -rf /" as unknown as string[] }, {}, { web: 1 }, [0]), /array of strings/, "string command");

  // Reports
  let r = workstationReport("203.0.113.5", base, { web: 42001 }, token);
  check(r.endpoint === `http://203.0.113.5:42001/?token=${token}` && !r.webToken, "Jupyter: token in the URL");
  const code: WorkstationSpec = { ...base, image: "codercom/code-server", access: { web: { port: 8080 } }, tokenEnv: "PASSWORD" };
  r = workstationReport("203.0.113.5", code, { web: 42003 }, token);
  check(r.endpoint === "http://203.0.113.5:42003" && r.webToken === token, "code-server: plain endpoint + webToken");
  r = workstationReport("h", { ...code, tokenQuery: "tkn", access: { web: { port: 1, path: "/lab" } } }, { web: 9 }, token);
  check(r.endpoint === `http://h:9/lab?tkn=${token}`, "explicit tokenQuery + path");
  r = workstationReport("h", { ...base, tokenEnv: undefined, access: { web: { port: 3000 }, ssh: { publicKey: KEY } } }, { web: 1, ssh: 2 });
  check(r.endpoint === "http://h:1" && r.sshEndpoint === "h:2" && r.webToken === undefined, "no token + sshEndpoint");

  // Volume schedule
  check(keepDaysOf(base) === 7 && keepDaysOf({ volume: { keepDays: 0 } }) === 0 && keepDaysOf({}) === 30, "keepDays");
  const now = Date.now();
  const kept = [{ id: "old", keepUntil: now - 1 }, { id: "new", keepUntil: now + 1e6 }, { id: "busy", keepUntil: now - 1 }];
  check(dueVolumes(kept, now, new Set(["busy"])).join() === "old", "only expired, unused volumes are due");

  // Manager: stop keeps the volume for keepDays; purge drops it (or leaves it due for housekeeping without Docker).
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "cld-ws-selftest-"));
  const reports: StatusBody[] = [];
  const logs: string[] = [];
  const m = new DeploymentManager({
    dataDir,
    publicHost: "127.0.0.1",
    ports: [42000, 42100],
    privateKey: "0x" + "11".repeat(32),
    log: (s) => logs.push(s),
    report: async (_id, body) => (reports.push(body), true),
  });
  await m.handle({ id: "wsA", action: "stop", kind: "workstation", spec: base });
  const file = JSON.parse(readFileSync(path.join(dataDir, "volumes.json"), "utf8"));
  check(file.length === 1 && file[0].id === "wsA" && Math.abs(file[0].keepUntil - (Date.now() + 7 * 86_400_000)) < 60_000, "volumes.json entry");
  check(reports.at(-1)?.status === "stopped", "stop reported");
  await m.handle({ id: "wsA", action: "purge", kind: "workstation", spec: null });
  const left = m.keptVolumes().find((v) => v.id === "wsA");
  check(!left || left.keepUntil <= Date.now(), "purge removes now (or marks due when Docker is absent)");
  // A start that cannot run (no GPU on this node) fails cleanly and never leaks the token into logs or messages.
  await m.handle({ id: "wsB", action: "start", kind: "workstation", spec: base });
  check(reports.at(-1)?.status === "failed" && /no usable GPU/.test(reports.at(-1)?.message ?? ""), "GPU start on GPU-less node fails");
  check(!JSON.stringify({ logs, reports }).match(/JUPYTER_TOKEN=|\?token=/), "no token in logs or failure reports");
  check(logs.every((l) => !l.includes(KEY)), "no ssh key in logs");
  rmSync(dataDir, { recursive: true, force: true });

  // GPU device allocation with a fake Docker (2-GPU node).
  check(parseDeviceRequests('[{"Driver":"","Count":0,"DeviceIDs":["1","0"],"Capabilities":[["gpu"]]}]')?.join() === "0,1", "inspect DeviceIDs");
  check(parseDeviceRequests("null")?.length === 0, "inspect: no device requests");
  check(parseDeviceRequests('[{"Count":-1}]') === null && parseDeviceRequests('[{"DeviceIDs":["GPU-ab12"]}]') === null, "inspect: all/UUID → unknown");
  const gpuDir = mkdtempSync(path.join(os.tmpdir(), "cld-ws-gpu-"));
  const runs = new Map<string, string[]>();
  const live = new Map<string, number[] | null>(); // container id → devices docker reports
  const fake: DockerOps = {
    run: async (args) => {
      const id = args[args.indexOf("--name") + 1].slice(4);
      runs.set(id, args);
      const g = args.includes("--gpus") ? args[args.indexOf("--gpus") + 1].replace(/"/g, "").slice(7).split(",").map(Number) : [];
      live.set(id, g);
      return "cid";
    },
    remove: async (id) => void live.delete(id),
    running: async (id) => live.has(id),
    volumeEnsure: async () => "created",
    volumeRemove: async () => true,
    gpuDevices: async (id) => live.get(id) ?? null,
  };
  const gopts = { dataDir: gpuDir, publicHost: "h", ports: [42200, 42300] as [number, number], privateKey: "0x" + "11".repeat(32), gpuCount: 2, docker: fake, log: () => {} };
  const g1 = new DeploymentManager({ ...gopts, report: async (_i, b) => (reports.push(b), true) });
  const one = { ...base, gpu: { count: 1 } };
  await g1.handle({ id: "g1", action: "start", kind: "workstation", spec: one });
  await g1.handle({ id: "g2", action: "start", kind: "workstation", spec: one });
  check(after(runs.get("g1")!, "--gpus") === '"device=0"' && after(runs.get("g2")!, "--gpus") === '"device=1"', "two 1-GPU starts → device=0, device=1");
  await g1.handle({ id: "g3", action: "start", kind: "workstation", spec: one });
  check(reports.at(-1)?.status === "failed" && reports.at(-1)?.message === "not enough free GPUs" && !runs.has("g3"), "third start: not enough free GPUs");
  check(g1.allocatedGpus().g3 === undefined, "failed start releases its reservation");
  await g1.handle({ id: "g1", action: "stop", kind: "workstation", spec: one });
  check(g1.allocatedGpus().g1 === undefined, "stop frees device 0");
  await g1.handle({ id: "g3", action: "start", kind: "workstation", spec: one });
  check(after(runs.get("g3")!, "--gpus") === '"device=0"', "freed device is reused");
  const saved = JSON.parse(readFileSync(path.join(gpuDir, "deployments.json"), "utf8")) as { id: string; gpus?: number[] }[];
  check(saved.find((r) => r.id === "g2")?.gpus?.join() === "1", "gpus persisted in deployments.json");
  // Boot: g2's record says GPU 1 but Docker says it holds GPU 0 → trust Docker; g3 is gone → its GPU is released.
  live.set("g2", [0]);
  live.delete("g3");
  const g2 = new DeploymentManager({ ...gopts, report: async (_i, b) => (reports.push(b), true) });
  await g2.resume();
  const alloc = g2.allocatedGpus();
  check(alloc.g2?.join() === "0" && alloc.g3 === undefined, "boot reconciles GPU map with docker inspect");
  await g2.handle({ id: "g4", action: "start", kind: "workstation", spec: one });
  check(after(runs.get("g4")!, "--gpus") === '"device=1"', "after reconcile the stale index is free again");
  rmSync(gpuDir, { recursive: true, force: true });

  console.log(`✓ workstation selftest passed — ${passed} checks`);
}

main();
