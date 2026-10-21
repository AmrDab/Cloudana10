// Runbook step 8: one RELAY_TICKET_SECRET shared by cloudana-api and cloudana-relay, and one INTERNAL_API_KEY shared by
// cloudana-api, cloudana-gateway and (once it exists) cloudana-keeper. Each value is generated here and handed straight
// to wrangler — never printed, never typed. Re-running issues fresh values to every Worker at once (that is also how
// the keeper gets the key when it is deployed: run this again).
//
//   node scripts/set-relay-secrets.mjs
//   DRY_RUN=1 node scripts/set-relay-secrets.mjs      shows what would be set, changes nothing
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const cached = path.join(process.env.LOCALAPPDATA ?? "", "npm-cache", "_npx", "32026684e21afda6", "node_modules", "wrangler", "bin", "wrangler.js");
const wrangler = existsSync(cached)
  ? { cmd: process.execPath, args: [cached] }
  : { cmd: process.platform === "win32" ? "npx.cmd" : "npx", args: ["wrangler"] };
const run = (args, opts = {}) => ({ cmd: wrangler.cmd, args: [...wrangler.args, ...args], opts: { cwd: root, shell: wrangler.cmd.endsWith(".cmd"), ...opts } });

/** Whether a Worker exists (wrangler secret list fails for one that doesn't). */
function workerExists(name) {
  const r = run(["secret", "list", "--name", name]);
  return spawnSync(r.cmd, r.args, { ...r.opts, stdio: "ignore" }).status === 0;
}

const PLAN = [
  { name: "RELAY_TICKET_SECRET", workers: ["cloudana-api", "cloudana-relay"] },
  { name: "INTERNAL_API_KEY", workers: ["cloudana-api", "cloudana-gateway", "cloudana-keeper"], optional: ["cloudana-keeper"] },
];

for (const { name, workers, optional = [] } of PLAN) {
  const value = randomBytes(32).toString("hex"); // 64 characters, the same value for every Worker that shares it
  for (const worker of workers) {
    if (optional.includes(worker) && !workerExists(worker)) {
      console.log(`\n${name} → ${worker}: not deployed yet, skipped (run this script again once it is).`);
      continue;
    }
    if (process.env.DRY_RUN) {
      console.log(`[dry run] ${name} → ${worker}: would send ${value.length} characters`);
      continue;
    }
    console.log(`\nSetting ${name} on ${worker}…`);
    const r = run(["secret", "put", name, "--name", worker], { input: value, stdio: ["pipe", "inherit", "inherit"] });
    execFileSync(r.cmd, r.args, r.opts);
  }
}

if (!process.env.DRY_RUN) console.log("\nDone. Tell Claude the script finished.");
