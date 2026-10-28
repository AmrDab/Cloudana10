/**
 * Where the CLI keeps its API key: CLOUDANA_API_KEY in the environment, else ~/.cloudana/config.json (mode 0600,
 * written by `cloudana login`). CLOUDANA_API overrides the API origin the same way.
 */
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const DEFAULT_API = "https://api.cloudana.io";

export interface Config {
  apiKey?: string;
  api?: string;
}

export function configPath(home = process.env.CLOUDANA_HOME ?? homedir()): string {
  return path.join(home, ".cloudana", "config.json");
}

export async function loadConfig(): Promise<Config> {
  try {
    return JSON.parse(await readFile(configPath(), "utf8")) as Config;
  } catch {
    return {};
  }
}

export async function saveConfig(c: Config): Promise<string> {
  const file = configPath();
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(c, null, 2) + "\n", { mode: 0o600 });
  await chmod(file, 0o600).catch(() => undefined); // Windows ignores modes; harmless
  return file;
}

export async function resolve(env: NodeJS.ProcessEnv = process.env): Promise<{ api: string; apiKey: string | null }> {
  const c = await loadConfig();
  return { api: (env.CLOUDANA_API ?? c.api ?? DEFAULT_API).replace(/\/$/, ""), apiKey: env.CLOUDANA_API_KEY ?? c.apiKey ?? null };
}
