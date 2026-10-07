// Security selftest: signed-instruction verification, hardening self-check (fake docker/iptables), hardened
// docker argv (flags, NVIDIA stripping, user, image allowlist), multi-port bookkeeping and the rejected-report
// release path. Needs neither Docker nor a network.
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { canonicalJSON, instructionDigest, NonceLru, verifyInstruction } from "./instructions.ts";
import { BLOCKED_RANGES, egressRules, hardeningSelfCheck, preStartCheck, storageQuotaSupported, type Exec } from "./hardening.ts";
import { DEFAULT_USER, dockerRunArgs, imageAllowed, imageAllowedLocally, PIDS_LIMIT, sanitizeTenantEnv, TENANT_NETWORK, type DockerOps } from "./container.ts";
import { workstationRunArgs, type WorkstationSpec } from "./workstation.ts";
import { DeploymentManager, NODE_CANNOT_SERVE, type StatusBody } from "./deployments.ts";
import { learnClockOffset, serverNow, signRequest } from "./signing.ts";
import { INSTRUCTION_WINDOW_MS } from "./instructions.ts";

let passed = 0;
function check(cond: unknown, msg: string) {
  if (!cond) {
    console.error(`✗ security selftest failed: ${msg}`);
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
const envOf = (args: string[]) => Object.fromEntries(args.flatMap((a, i) => (a === "-e" ? [args[i + 1].split(/=(.*)/s).slice(0, 2)] : [])));

async function main() {
  // ── Signed instructions ───────────────────────────────────────────────────────────────────────────────
  check(canonicalJSON({ b: 1, a: [{ z: 1, y: undefined, x: null }], c: "s" }) === '{"a":[{"x":null,"z":1}],"b":1,"c":"s"}', "canonical JSON sorts keys, drops undefined");
  const signer = privateKeyToAccount(generatePrivateKey());
  const node = privateKeyToAccount(generatePrivateKey());
  const body = { assignment: null, deployments: [{ id: "d1", action: "start", kind: "static", spec: { files: [] } }] };
  const sign = async (ts: number, nonce: string, b: unknown = body, who = signer) => ({
    ts,
    nonce,
    sig: await who.signMessage({ message: { raw: instructionDigest(node.address, ts, nonce, b) } }),
  });
  const now = Date.now();
  const seen = new NonceLru();
  const good = await sign(now, "a".repeat(32));
  check((await verifyInstruction(good, node.address, body, signer.address, seen, now)).ok, "valid signature accepted");
  // The API serialises the body in its own key order; verification must not depend on it.
  const reordered = { deployments: [{ spec: { files: [] }, kind: "static", action: "start", id: "d1" }], assignment: null };
  check((await verifyInstruction(await sign(now, "b".repeat(32)), node.address, reordered, signer.address, seen, now)).ok, "key order irrelevant");
  let r = await verifyInstruction(good, node.address, body, signer.address, seen, now);
  check(!r.ok && r.reason === "replayed nonce", "replayed nonce refused");
  r = await verifyInstruction(await sign(now - 61_000, "c".repeat(32)), node.address, body, signer.address, seen, now);
  check(!r.ok && r.reason === "stale timestamp", "61 s old refused");
  r = await verifyInstruction(await sign(now + 61_000, "d".repeat(32)), node.address, body, signer.address, seen, now);
  check(!r.ok && r.reason === "stale timestamp", "61 s in the future refused");
  check((await verifyInstruction(await sign(now - 59_000, "e".repeat(32)), node.address, body, signer.address, seen, now)).ok, "59 s old accepted");
  r = await verifyInstruction(await sign(now, "f".repeat(32), body, node), node.address, body, signer.address, seen, now);
  check(!r.ok && r.reason === "wrong signer", "another key refused");
  r = await verifyInstruction(await sign(now, "1".repeat(32), { ...body, deployments: [] }), node.address, body, signer.address, seen, now);
  check(!r.ok && r.reason === "wrong signer", "signature over a different body refused");
  r = await verifyInstruction(await sign(now, "2".repeat(32)), "0x" + "9".repeat(40), body, signer.address, seen, now);
  check(!r.ok && r.reason === "wrong signer", "signature for another node refused");
  r = await verifyInstruction({ assignment: null, deployments: [] } as never, node.address, body, signer.address, seen, now);
  check(!r.ok && r.reason === "unsigned", "unsigned response ignored");
  r = await verifyInstruction({ ...good, sig: "0xdead" }, node.address, body, signer.address, seen, now);
  check(!r.ok && r.reason === "malformed signature", "malformed signature");
  const lru = new NonceLru(2);
  check(lru.add("1") && lru.add("2") && lru.add("3") && !lru.add("3") && lru.add("1"), "LRU evicts the oldest");

  // ── Node→API signing: nonce header + clock offset ─────────────────────────────────────────────────────
  const h1 = await signRequest(node, "POST", "/v1/nodes/heartbeat", "{}");
  const h2 = await signRequest(node, "POST", "/v1/nodes/heartbeat", "{}");
  check(/^[0-9a-f]{32}$/.test(h1["X-Nonce"]) && h1["X-Nonce"] !== h2["X-Nonce"], "fresh 16-byte nonce per request");
  check(h1["X-Node-Signature"] !== h2["X-Node-Signature"], "identical requests never share a signature");
  const local = Date.now();
  const off = learnClockOffset(new Date(local + 90_000).toUTCString(), local);
  check(Math.abs(off - 90_000) < 1000 && Math.abs(serverNow() - (Date.now() + 90_000)) < 1000, "offset learned from the Date header");
  learnClockOffset("not a date");
  check(Math.abs(serverNow() - (Date.now() + 90_000)) < 1000, "garbage Date header keeps the previous offset");
  // Instruction freshness uses the same learned clock (index.ts passes serverNow()): a server 90 s ahead of this
  // machine signs ts ≈ its now; judged by Date.now() that would be "stale", by serverNow() it is fresh.
  const serverTs = Date.now() + 90_000;
  const aheadEnv = await sign(serverTs, "7".repeat(32));
  check((await verifyInstruction(aheadEnv, node.address, body, signer.address, new NonceLru(), serverNow())).ok, "instruction ts judged against serverNow()");
  r = await verifyInstruction(aheadEnv, node.address, body, signer.address, new NonceLru(), Date.now());
  check(!r.ok && r.reason === "stale timestamp" && INSTRUCTION_WINDOW_MS === 60_000, "the same instruction is stale by the unadjusted local clock");
  learnClockOffset(new Date(Date.now()).toUTCString());

  // ── Hardening self-check with a fake docker/iptables ──────────────────────────────────────────────────
  const calls: string[] = [];
  const fake = (opts: { network: boolean; rulesPresent: boolean; iptablesOk: boolean; icc?: string; info?: string; mount?: string }): Exec => {
    let created = opts.network;
    return async (cmd, args) => {
      calls.push([cmd, ...args].join(" "));
      if (cmd === "docker" && args[0] === "info" && args[1] === "--format") return opts.info ?? "overlay2|/var/lib/docker|Backing Filesystem=xfs;Supports d_type=true;";
      if (cmd === "docker" && args[0] === "info") return "ok";
      if (cmd === "findmnt") return opts.mount ?? "rw,relatime,attr2,inode64,prjquota";
      if (cmd === "docker" && args[1] === "inspect") {
        if (!created) throw new Error("No such network");
        return `172.31.0.0/16 |${opts.icc ?? "false"}`;
      }
      if (cmd === "docker" && args[1] === "create") {
        created = true;
        return "id";
      }
      if (cmd === "iptables") {
        if (!opts.iptablesOk) throw new Error("Permission denied (you must be root)");
        if (args[0] === "-C" && !opts.rulesPresent) throw new Error("Bad rule");
        return "";
      }
      throw new Error(`unexpected ${cmd} ${args.join(" ")}`);
    };
  };
  let res = await hardeningSelfCheck(fake({ network: false, rulesPresent: false, iptablesOk: true }));
  check(res.ok, `creates the network and installs rules (${res.reason})`);
  check(calls.some((c) => c.startsWith(`docker network create --driver bridge --opt com.docker.network.bridge.enable_icc=false ${TENANT_NETWORK}`)), "network created with icc off");
  for (const dst of BLOCKED_RANGES) check(calls.includes(`iptables -I DOCKER-USER -s 172.31.0.0/16 -d ${dst} -j DROP`), `DROP to ${dst} installed`);
  check(calls.includes("iptables -I INPUT -s 172.31.0.0/16 -j DROP"), "DROP to the host itself installed");
  check(egressRules("10.9.0.0/16").length === BLOCKED_RANGES.length + 1, "one rule per range + host");
  calls.length = 0;
  res = await hardeningSelfCheck(fake({ network: true, rulesPresent: true, iptablesOk: true }));
  check(res.ok && !calls.some((c) => c.includes(" -I ")), "present rules are only checked, not re-added");
  res = await hardeningSelfCheck(fake({ network: true, rulesPresent: false, iptablesOk: false }));
  check(!res.ok && /cannot install egress DROP rule/.test(res.reason ?? ""), "no iptables rights → containers refused");
  res = await hardeningSelfCheck(async (cmd) => {
    if (cmd === "docker") throw new Error("Cannot connect to the Docker daemon");
    return "";
  });
  check(!res.ok && /docker is not reachable/.test(res.reason ?? ""), "no docker → containers refused");
  // Storage quota: the disk cap needs a driver that enforces --storage-opt size.
  res = await hardeningSelfCheck(fake({ network: true, rulesPresent: true, iptablesOk: true, info: "overlay2|/var/lib/docker|Backing Filesystem=extfs;" }));
  check(!res.ok && /overlay2 on extfs/.test(res.reason ?? ""), "overlay2 on ext4 → containers refused");
  res = await hardeningSelfCheck(fake({ network: true, rulesPresent: true, iptablesOk: true, mount: "rw,relatime" }));
  check(!res.ok && /without project quotas/.test(res.reason ?? ""), "xfs without pquota → containers refused");
  res = await hardeningSelfCheck(fake({ network: true, rulesPresent: true, iptablesOk: true, info: "btrfs|/var/lib/docker|" }));
  check(res.ok && res.notes.some((n) => /btrfs/.test(n)), "btrfs → quotas native");
  check(!(await storageQuotaSupported(async () => "vfs|/var/lib/docker|")).ok, "vfs driver refused");
  // An existing network with icc on is refused, at boot and before a start.
  res = await hardeningSelfCheck(fake({ network: true, rulesPresent: true, iptablesOk: true, icc: "true" }));
  check(!res.ok && /inter-container/.test(res.reason ?? ""), "existing network with icc on → refused");
  res = await preStartCheck(fake({ network: true, rulesPresent: true, iptablesOk: true }));
  check(res.ok, `pre-start check passes with rules + icc off (${res.reason})`);
  calls.length = 0;
  res = await preStartCheck(fake({ network: true, rulesPresent: false, iptablesOk: true }));
  check(!res.ok && /egress rule missing/.test(res.reason ?? "") && !calls.some((c) => c.includes(" -I ")), "pre-start: a flushed rule refuses the start and installs nothing");
  res = await preStartCheck(fake({ network: true, rulesPresent: true, iptablesOk: true, icc: "" }));
  check(!res.ok && /inter-container/.test(res.reason ?? ""), "pre-start: icc not off → refused");
  res = await preStartCheck(fake({ network: false, rulesPresent: true, iptablesOk: true }));
  check(!res.ok && /tenant network/.test(res.reason ?? ""), "pre-start: missing network → refused");

  // ── Hardened docker run argv ──────────────────────────────────────────────────────────────────────────
  const spec = { image: "nginx:alpine", ports: [{ container: 80 }, { container: 443 }], cpu: 500, memMb: 512, storageMb: 1024 };
  const tenantEnv = { A: "1", NVIDIA_VISIBLE_DEVICES: "all", NVIDIA_DRIVER_CAPABILITIES: "all", CUDA_VISIBLE_DEVICES: "0,1", nvidia_x: "kept-lowercase-is-not-the-prefix" };
  let a = dockerRunArgs("c1", spec, tenantEnv, [42000, 42001]);
  for (const f of ["--cap-drop=ALL", "--security-opt=no-new-privileges", `--pids-limit=${PIDS_LIMIT}`]) check(a.includes(f), `${f} present`);
  check(after(a, "--memory") === "512m" && after(a, "--memory-swap") === "512m", "memory-swap == memory (no swap)");
  check(after(a, "--network") === TENANT_NETWORK, "joins the tenant network");
  check(after(a, "--storage-opt") === "size=1024m", "writable layer capped at storageMb");
  check(after(a, "--user") === DEFAULT_USER, "non-root by default");
  check(!a.includes("--privileged") && !a.some((x) => x.startsWith("--cap-add")), "no privilege flags");
  let env = envOf(a);
  check(env.A === "1" && env.nvidia_x !== undefined, "ordinary env kept");
  check(env.NVIDIA_VISIBLE_DEVICES === "none" && !("NVIDIA_DRIVER_CAPABILITIES" in env) && !("CUDA_VISIBLE_DEVICES" in env), "NVIDIA_*/CUDA_VISIBLE_DEVICES stripped; devices=none");
  check(a.filter((x) => x === "-p").length === 2 && a.includes("42000:80") && a.includes("42001:443"), "both ports mapped");
  a = dockerRunArgs("c1", { ...spec, user: "65534:65534" }, {}, [1, 2]);
  check(after(a, "--user") === "65534:65534", "spec user honoured");
  throws(() => dockerRunArgs("c1", { ...spec, user: "root" }, {}, [1, 2]), /invalid user/, "non-numeric user refused");
  throws(() => dockerRunArgs("c1", { ...spec, user: "0:0 --privileged" }, {}, [1, 2]), /invalid user/, "user injection refused");
  for (const u of ["0", "0:0", "0:1000"]) throws(() => dockerRunArgs("c1", { ...spec, user: u }, {}, [1, 2]), /cannot run as root/, `uid 0 refused (${u})`);
  throws(() => dockerRunArgs("c1", { ...spec, storageMb: 0 }, {}, [1, 2]), /storageMb/, "missing storage cap refused");
  check(sanitizeTenantEnv({ NVIDIA_VISIBLE_DEVICES: "all" }, [1, 3]).NVIDIA_VISIBLE_DEVICES === "1,3", "workstation devices listed explicitly");

  const ws: WorkstationSpec = { ...spec, image: "quay.io/jupyter/pytorch-notebook:cuda12-latest", ports: [], gpu: { count: 1 }, access: { web: { port: 8888 } }, tokenEnv: "JUPYTER_TOKEN" };
  a = workstationRunArgs("w1", ws, { NVIDIA_VISIBLE_DEVICES: "all", JUPYTER_TOKEN: "t" }, { web: 42002 }, [2]);
  for (const f of ["--cap-drop=ALL", "--security-opt=no-new-privileges", `--pids-limit=${PIDS_LIMIT}`]) check(a.includes(f), `workstation ${f}`);
  check(after(a, "--memory-swap") === "512m" && after(a, "--network") === TENANT_NETWORK, "workstation memory-swap + network");
  check(after(a, "--storage-opt") === "size=1024m", "workstation writable layer capped too");
  check(!a.includes("--user"), "workstation keeps the image's user");
  env = envOf(a);
  check(env.NVIDIA_VISIBLE_DEVICES === "2" && env.JUPYTER_TOKEN === "t" && after(a, "--gpus") === '"device=2"', "workstation: tenant NVIDIA_VISIBLE_DEVICES=all replaced by the allocated device");
  a = workstationRunArgs("w1", { ...ws, user: "1000" }, {}, { web: 42002 }, [0]);
  check(after(a, "--user") === "1000", "workstation spec user honoured");

  // ── Image allowlist ───────────────────────────────────────────────────────────────────────────────────
  check(imageAllowedLocally("nginx:alpine", undefined) === null && imageAllowedLocally("nginx:alpine", " , ") === null, "unset allowlist → null");
  check(imageAllowedLocally("nginx:alpine", "nginx:.*,redis:7") === true && imageAllowedLocally("evil/nginx:alpine", "nginx:.*") === false, "regex anchored to the whole reference");
  check(imageAllowedLocally("x", "[") === false, "bad regex never allows");
  check(imageAllowed("x", true, undefined) && !imageAllowed("x", false, undefined) && !imageAllowed("x", "true", undefined) && imageAllowed("x", false, "x"), "API flag or local list");

  // ── Manager: multi-port bookkeeping and the rejected-report release ───────────────────────────────────
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "cld-sec-selftest-"));
  const runs: string[][] = [];
  const dk: DockerOps = {
    run: async (args) => (runs.push(args), ""),
    remove: async () => {},
    running: async () => true,
    volumeEnsure: async () => "created",
    volumeRemove: async () => true,
    gpuDevices: async () => null,
  };
  const reports: { id: string; body: StatusBody }[] = [];
  let reject: string | null = null;
  let hardeningOk = true;
  const m = new DeploymentManager({
    dataDir,
    publicHost: "127.0.0.1",
    ports: [43000, 43010],
    privateKey: "0x" + "11".repeat(32),
    containersReady: true,
    hardening: async () => (hardeningOk ? { ok: true, notes: [] } : { ok: false, reason: "egress rule missing: iptables -C INPUT …", notes: [] }),
    docker: dk,
    log: () => {},
    report: async (id, body) => {
      reports.push({ id, body });
      return reject && body.status === "running" ? { rejected: reject } : true;
    },
  });
  try {
    await m.handle({ id: "two", action: "start", kind: "container", spec: spec, imageAllowed: true });
    check(reports.at(-1)?.body.status === "running", "two-port container runs");
    const first = runs[0].filter((x, i) => runs[0][i - 1] === "-p");
    check(first.join() === "43000:80,43001:443", `two host ports taken (${first.join()})`);
    await m.handle({ id: "one", action: "start", kind: "container", spec: { ...spec, ports: [{ container: 80 }] }, imageAllowed: true });
    const second = runs[1].filter((x, i) => runs[1][i - 1] === "-p");
    check(second.join() === "43002:80", `second container skips both ports of the first (${second.join()})`);
    // Image not allowed by the API and no local allowlist → failed, docker never called.
    const before = runs.length;
    await m.handle({ id: "bad", action: "start", kind: "container", spec: { ...spec, image: "evil/miner:latest" } });
    check(reports.at(-1)?.id === "bad" && reports.at(-1)?.body.status === "failed" && /not on the curated list/.test(reports.at(-1)?.body.message ?? ""), "disallowed image refused");
    check(runs.length === before, "docker not invoked for a refused image");
    // Hardening regressed since boot (rules flushed): the start is refused as unservable, docker never called.
    hardeningOk = false;
    await m.handle({ id: "flushed", action: "start", kind: "container", spec, imageAllowed: true });
    const fl = reports.at(-1);
    check(fl?.id === "flushed" && fl.body.status === "failed" && fl.body.message!.startsWith(NODE_CANNOT_SERVE) && /hardening check failed/.test(fl.body.message!), "pre-start hardening failure → cannot-serve");
    check(runs.length === before, "docker not invoked when the pre-start check fails");
    hardeningOk = true;
    // A node that never opted in (containersReady false) refuses container and workstation starts the same way.
    const off = new DeploymentManager({ dataDir, publicHost: "127.0.0.1", ports: [43020, 43030], privateKey: "0x" + "11".repeat(32), docker: dk, log: () => {}, report: async (id, body) => (reports.push({ id, body }), true) });
    await off.handle({ id: "nc", action: "start", kind: "container", spec, imageAllowed: true });
    check(reports.at(-1)?.id === "nc" && reports.at(-1)?.body.status === "failed" && reports.at(-1)!.body.message!.startsWith(NODE_CANNOT_SERVE), "containersReady=false → container start is cannot-serve");
    await off.handle({ id: "nw", action: "start", kind: "workstation", spec: ws, imageAllowed: true });
    check(reports.at(-1)?.id === "nw" && reports.at(-1)!.body.message!.startsWith(NODE_CANNOT_SERVE), "containersReady=false → workstation start is cannot-serve");
    check(runs.length === before, "docker not invoked without containersReady");
    await off.handle({ id: "st", action: "start", kind: "static", spec: { files: [{ path: "index.html", contentBase64: "PGgxPnk8L2gxPg==" }] } });
    check(reports.at(-1)?.id === "st" && reports.at(-1)?.body.status === "running", "static sites still run without containersReady");
    await off.closeAll();
    // Rejected running report → deployment released, failed report queued with the cannot-serve prefix.
    reject = "endpoint host must be the node's announced public host";
    await m.handle({ id: "site", action: "start", kind: "static", spec: { files: [{ path: "index.html", contentBase64: Buffer.from("<h1>x</h1>").toString("base64") }] } });
    await m.flush();
    const failed = reports.filter((r) => r.id === "site" && r.body.status === "failed").at(-1);
    check(!!failed && failed.body.message!.startsWith(NODE_CANNOT_SERVE) && failed.body.message!.includes("announced public host"), "rejected running → failed report with the cannot-serve prefix");
    await m.handle({ id: "site", action: "start", kind: "static", spec: { files: [{ path: "index.html", contentBase64: "PGgxPnk8L2gxPg==" }] } });
    check(reports.filter((r) => r.id === "site" && r.body.status === "running").length === 2, "record released: a later start is a fresh start, not a re-report");
    reject = null;
  } finally {
    await m.closeAll();
    rmSync(dataDir, { recursive: true, force: true });
  }

  console.log(`✓ security selftest passed — ${passed} checks`);
}

main().catch((err) => {
  console.error(`✗ security selftest failed: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
