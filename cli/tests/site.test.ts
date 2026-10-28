import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MAX_SITE_BYTES, readSite } from "../src/site.js";

async function site(files: Record<string, string | Buffer>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "cloudana-site-"));
  for (const [p, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, p)), { recursive: true });
    await writeFile(path.join(dir, p), body);
  }
  return dir;
}

describe("readSite", () => {
  it("lists every file with a forward-slash path and base64 content, sorted; dot-entries and node_modules are left out", async () => {
    const dir = await site({
      "index.html": "<h1>hi</h1>", "assets/app.js": "console.log(1)", "assets/img/a.png": Buffer.from([137, 80, 78, 71]),
      ".env": "SECRET=1", ".git/HEAD": "ref", "node_modules/x/index.js": "x", "assets/.DS_Store": "junk",
    });
    const s = await readSite(dir);
    expect(s.files.map((f) => f.path)).toEqual(["assets/app.js", "assets/img/a.png", "index.html"]);
    expect(s.skipped).toEqual([".env", ".git", "assets/.DS_Store", "node_modules"]);
    expect(Buffer.from(s.files[2].contentBase64, "base64").toString()).toBe("<h1>hi</h1>");
    expect(Buffer.from(s.files[1].contentBase64, "base64")).toEqual(Buffer.from([137, 80, 78, 71]));
    expect(s.bytes).toBe(11 + 14 + 4);
  });

  it("refuses a folder without index.html at the root, a file instead of a folder, and an oversize site", async () => {
    await expect(readSite(await site({ "sub/index.html": "x" }))).rejects.toThrow(/no index.html/);
    const dir = await site({ "index.html": "x" });
    await expect(readSite(path.join(dir, "index.html"))).rejects.toThrow(/not a directory/);
    await expect(readSite(await site({ "index.html": "x", "big.bin": Buffer.alloc(MAX_SITE_BYTES) }))).rejects.toThrow(/over 2 MB/);
  });
});
