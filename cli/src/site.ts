/**
 * A folder as a StaticSpec (client/api deployment-spec.ts): every file, path relative with forward slashes, content
 * base64; index.html at the root is required and the decoded total is capped like the API's.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export const MAX_SITE_BYTES = 2 * 1024 * 1024;

export interface SiteFile {
  path: string;
  contentBase64: string;
}

export async function readSite(dir: string): Promise<{ files: SiteFile[]; bytes: number }> {
  const root = path.resolve(dir);
  if (!(await stat(root).catch(() => null))?.isDirectory()) throw new Error(`${dir} is not a directory`);
  const files: SiteFile[] = [];
  let bytes = 0;
  async function walk(rel: string): Promise<void> {
    for (const e of await readdir(path.join(root, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) {
        const body = await readFile(path.join(root, p));
        bytes += body.byteLength;
        if (bytes > MAX_SITE_BYTES) throw new Error(`site is over ${MAX_SITE_BYTES / 1024 / 1024} MB (decoded); a static site must fit the cap, use a container for more`);
        files.push({ path: p, contentBase64: body.toString("base64") });
      }
    }
  }
  await walk("");
  if (!files.some((f) => f.path === "index.html")) throw new Error(`${dir} has no index.html at its root`);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, bytes };
}
