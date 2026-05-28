/**
 * Split akash-templates-seed.sql into <~700KB chunks at statement boundaries
 * (statements start with "INSERT OR IGNORE"). wrangler d1 execute --file can't
 * handle the 4.7MB file in one shot (SQLITE_TOOBIG on the total), but small
 * chunks apply fine. Output: ./seed-chunks/chunk-000.sql ...
 */
const fs = require("node:fs");
const path = require("node:path");

const SRC = "akash-templates-seed.sql";
const OUT_DIR = "seed-chunks";
const MAX_BYTES = 700 * 1024;

const sql = fs.readFileSync(SRC, "utf8");
// Split before each statement start. Header comment lines (-- ...) ride with chunk 0.
const stmts = sql.split(/\n(?=INSERT OR IGNORE )/g);

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

let chunk = [];
let bytes = 0;
let idx = 0;
const flush = () => {
  if (!chunk.length) return;
  const name = path.join(OUT_DIR, `chunk-${String(idx).padStart(3, "0")}.sql`);
  fs.writeFileSync(name, chunk.join("\n") + "\n", "utf8");
  idx++;
  chunk = [];
  bytes = 0;
};

for (const s of stmts) {
  const len = Buffer.byteLength(s, "utf8");
  if (bytes + len > MAX_BYTES && chunk.length) flush();
  chunk.push(s);
  bytes += len;
}
flush();

console.log(`Wrote ${idx} chunks to ${OUT_DIR}/ from ${stmts.length} statements.`);
