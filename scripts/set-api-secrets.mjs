// Runbook step 2: sets the API's three owner secrets (INSTRUCTION_SIGNING_KEY, JWT_SECRET, STORAGE_KEK) on cloudana-api.
// Each value is generated here and handed straight to wrangler — never printed, never typed, never pasted.
//
//   node scripts/set-api-secrets.mjs                  all three
//   node scripts/set-api-secrets.mjs STORAGE_KEK      just the ones named
//   DRY_RUN=1 node scripts/set-api-secrets.mjs        shows what would be sent (lengths only), changes nothing
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SECRETS = {
  INSTRUCTION_SIGNING_KEY: () => "0x" + randomBytes(32).toString("hex"), // 66 chars
  JWT_SECRET: () => randomBytes(48).toString("hex"), // 96 chars
  STORAGE_KEK: () => randomBytes(32).toString("base64"), // 44 chars
};

const apiDir = fileURLToPath(new URL("../client/api/", import.meta.url));
const cached = path.join(process.env.LOCALAPPDATA ?? "", "npm-cache", "_npx", "32026684e21afda6", "node_modules", "wrangler", "bin", "wrangler.js");
const wrangler = existsSync(cached)
  ? { cmd: process.execPath, args: [cached] }
  : { cmd: process.platform === "win32" ? "npx.cmd" : "npx", args: ["wrangler"] };

const asked = process.argv.slice(2);
const unknown = asked.filter((n) => !(n in SECRETS));
if (unknown.length) {
  console.error(`Unknown secret(s): ${unknown.join(", ")}. Known: ${Object.keys(SECRETS).join(", ")}`);
  process.exit(1);
}
const names = asked.length ? asked : Object.keys(SECRETS);

for (const name of names) {
  const value = SECRETS[name]();
  if (process.env.DRY_RUN) {
    console.log(`[dry run] ${name}: would send ${value.length} characters to wrangler`);
    continue;
  }
  console.log(`\nSetting ${name}…`);
  execFileSync(wrangler.cmd, [...wrangler.args, "secret", "put", name], {
    cwd: apiDir,
    input: value,
    stdio: ["pipe", "inherit", "inherit"],
    shell: wrangler.cmd.endsWith(".cmd"),
  });
}

if (!process.env.DRY_RUN && names.includes("INSTRUCTION_SIGNING_KEY")) {
  console.log("\nDone. Open https://api.cloudana.io/v1/nodes/instruction-key in a minute and send Claude the 0x address it shows.");
}
