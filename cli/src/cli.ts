#!/usr/bin/env node
/**
 * cloudana — deploy a folder as a static site on the Cloudana network, list, inspect and stop deployments.
 *
 *   cloudana login --key cld_sk_…  [--api https://api.cloudana.io]
 *   cloudana deploy ./dist [--name my-site] [--no-wait]
 *   cloudana list
 *   cloudana get <id>
 *   cloudana stop <id>
 *
 * The key comes from the console (Keys → New key, scope "deployments"); it is stored in ~/.cloudana/config.json or
 * read from CLOUDANA_API_KEY. Exit codes: 0 ok, 1 the API or the site refused, 2 usage.
 */
import { parseArgs } from "node:util";
import path from "node:path";
import { ApiError, client, type Client, type Deployment } from "./api.js";
import { resolve, saveConfig } from "./config.js";
import { readSite } from "./site.js";

export interface Io {
  log: (line: string) => void;
  error: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

const USAGE = `usage: cloudana <command>
  login --key <cld_sk_…> [--api <url>]   store the API key (or set CLOUDANA_API_KEY)
  deploy <dir> [--name <name>] [--no-wait] deploy a folder as a static site (index.html required, ≤ 2 MB)
  list                                     your deployments
  get <id>                                 one deployment and its latest events
  stop <id>                                stop and remove a deployment`;

const line = (d: Deployment) => `${d.id}  ${d.status.padEnd(11)} ${d.kind.padEnd(11)} ${d.name}${d.url ? `  ${d.url}` : ""}`;

/** Runs one command; returns the exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { key: { type: "string" }, api: { type: "string" }, name: { type: "string" }, "no-wait": { type: "boolean" } },
  });
  const [cmd, arg] = positionals;
  const env = io.env ?? process.env;

  if (cmd === "login") {
    if (!values.key) return usage(io, "login needs --key");
    const file = await saveConfig({ apiKey: values.key, ...(values.api && { api: values.api }) });
    io.log(`saved to ${file}`);
    return 0;
  }
  if (!cmd || !["deploy", "list", "get", "stop"].includes(cmd)) return usage(io);

  const { api, apiKey } = await resolve(env);
  if (!apiKey) {
    io.error("no API key: run `cloudana login --key cld_sk_…` (console → Keys) or set CLOUDANA_API_KEY");
    return 1;
  }
  const c = client(values.api ?? api, apiKey, io.fetch);
  try {
    switch (cmd) {
      case "deploy":
        return arg ? await deploy(c, arg, values.name, !values["no-wait"], io) : usage(io, "deploy needs a folder");
      case "list": {
        const all = await c.list();
        if (!all.length) io.log("no deployments");
        for (const d of all) io.log(line(d));
        return 0;
      }
      case "get": {
        if (!arg) return usage(io, "get needs an id");
        const { deployment, events } = await c.get(arg);
        io.log(line(deployment));
        for (const e of events.slice(-10)) io.log(`  ${new Date(e.at).toISOString()} ${e.level} ${e.message}`);
        if (deployment.logs) io.log(`  logs:\n${deployment.logs}`);
        return 0;
      }
      case "stop":
        if (!arg) return usage(io, "stop needs an id");
        await c.stop(arg);
        io.log(`stopped ${arg}`);
        return 0;
    }
  } catch (err) {
    if (err instanceof ApiError) io.error(`${err.code}: ${err.message}`);
    else io.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  return usage(io);
}

async function deploy(c: Client, dir: string, name: string | undefined, wait: boolean, io: Io): Promise<number> {
  const site = await readSite(dir);
  io.log(`${site.files.length} files, ${(site.bytes / 1024).toFixed(0)} KB`);
  const created = await c.create({ name: name ?? path.basename(path.resolve(dir)), kind: "static", spec: { files: site.files } });
  io.log(`deployment ${created.id} queued, $${created.priceUsdPerHour.toFixed(4)}/h`);
  if (!wait) return 0;
  const sleep = io.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  for (let i = 0; i < 40; i++) {
    const { deployment } = await c.get(created.id);
    if (deployment.status === "running") {
      io.log(`live at ${deployment.url}`);
      return 0;
    }
    if (deployment.status === "failed" || deployment.status === "stopped") {
      io.error(`deployment ${deployment.status}${deployment.logs ? `:\n${deployment.logs}` : ""}`);
      return 1;
    }
    await sleep(3000);
  }
  io.log(`still ${(await c.get(created.id)).deployment.status}; check later with: cloudana get ${created.id}`);
  return 0;
}

function usage(io: Io, why?: string): number {
  if (why) io.error(why);
  io.error(USAGE);
  return 2;
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) {
  run(process.argv.slice(2), { log: console.log, error: console.error }).then((code) => process.exit(code));
}
