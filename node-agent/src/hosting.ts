import http from "node:http";
import net from "node:net";
import path from "node:path";
import { createReadStream, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";

export type StaticSpec = { files: { path: string; contentBase64: string }[] };

const MAX_SITE_BYTES = 2 * 1024 * 1024;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

/** Relative, forward-slash path with no "..", no absolute/drive prefix, no empty segments. Throws otherwise. */
export function safeRelPath(p: string): string {
  const norm = p.replace(/\\/g, "/");
  if (!norm || norm.startsWith("/") || /^[a-zA-Z]:/.test(norm) || norm.includes("\0")) {
    throw new Error(`invalid file path: ${JSON.stringify(p)}`);
  }
  const segs = norm.split("/");
  if (segs.some((s) => s === "" || s === "." || s === "..")) throw new Error(`invalid file path: ${JSON.stringify(p)}`);
  return segs.join("/");
}

/** Validate and write a static site into `dir` (replacing anything there). */
export function writeSite(dir: string, spec: StaticSpec): void {
  if (!spec || !Array.isArray(spec.files)) throw new Error("static spec has no files");
  const files = spec.files.map((f) => ({ rel: safeRelPath(f.path), data: Buffer.from(f.contentBase64 ?? "", "base64") }));
  if (!files.some((f) => f.rel === "index.html")) throw new Error("static spec has no index.html");
  const total = files.reduce((n, f) => n + f.data.length, 0);
  if (total > MAX_SITE_BYTES) throw new Error(`static site is ${total} bytes (max ${MAX_SITE_BYTES})`);

  rmSync(dir, { recursive: true, force: true });
  for (const f of files) {
    const target = path.join(dir, f.rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, f.data);
  }
}

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "SAMEORIGIN",
};

function notFound(res: http.ServerResponse, root: string, head: boolean) {
  const custom = path.join(root, "404.html");
  if (isFile(custom)) return sendFile(res, custom, 404, head);
  res.writeHead(404, { ...BASE_HEADERS, "Content-Type": "text/html; charset=utf-8" });
  res.end(head ? undefined : "<!doctype html><title>404</title><h1>404 — not found</h1>");
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function sendFile(res: http.ServerResponse, file: string, status: number, head: boolean) {
  res.writeHead(status, {
    ...BASE_HEADERS,
    "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": statSync(file).size,
    "Cache-Control": "public, max-age=60",
  });
  if (head) return res.end();
  createReadStream(file).pipe(res);
}

/** Serve `root` on 0.0.0.0:`port`. Resolves once listening. */
export function serveSite(root: string, port: number): Promise<http.Server> {
  const absRoot = path.resolve(root);
  const server = http.createServer((req, res) => {
    const head = req.method === "HEAD";
    if (req.method !== "GET" && !head) {
      res.writeHead(405, { ...BASE_HEADERS, Allow: "GET, HEAD" });
      return res.end();
    }
    let rel: string;
    try {
      rel = decodeURIComponent((req.url ?? "/").split("?")[0].split("#")[0]);
    } catch {
      res.writeHead(400, BASE_HEADERS);
      return res.end();
    }
    if (rel.includes("\0") || rel.replace(/\\/g, "/").split("/").includes("..")) {
      res.writeHead(400, BASE_HEADERS);
      return res.end();
    }
    let file = path.resolve(absRoot, "." + (rel.startsWith("/") ? rel : "/" + rel));
    if (file !== absRoot && !file.startsWith(absRoot + path.sep)) {
      res.writeHead(400, BASE_HEADERS);
      return res.end();
    }
    if (rel.endsWith("/") || (!isFile(file) && isFile(path.join(file, "index.html")))) {
      file = path.join(file, "index.html"); // "/" and directories → their index.html, never a listing
    }
    if (!isFile(file)) return notFound(res, absRoot, head);
    sendFile(res, file, 200, head);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "0.0.0.0", () => s.close(() => resolve(true)));
  });
}

/** First port in [lo, hi] that is bindable and not in `taken`. */
export async function findFreePort([lo, hi]: [number, number], taken: Set<number>): Promise<number> {
  for (let p = lo; p <= hi; p++) {
    if (!taken.has(p) && (await portFree(p))) return p;
  }
  throw new Error(`no free port in ${lo}-${hi}`);
}
