/** Stop every process up.ts started (pids in .dev-run-sim/pids). The hardhat chain is left running. */
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { RUN } from "./common.ts";

const file = path.join(RUN, "pids");
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const [name, pid] = line.split(" ");
    try {
      process.kill(Number(pid));
      console.log(`stopped ${name} (${pid})`);
    } catch {
      console.log(`${name} (${pid}) was not running`);
    }
  }
  unlinkSync(file);
}
