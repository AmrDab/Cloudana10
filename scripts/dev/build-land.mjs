// Precompute the coastline sketch for the homepage globe from world-atlas (Natural Earth, public domain).
// Output: client/src/components/cld/globe/land.json — line strips of [lon, lat] in deci-degrees (Int16 range),
// decimated so the lazy chunk stays small. Run: node scripts/dev/build-land.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { mesh } from "topojson-client";

const topo = JSON.parse(readFileSync(new URL("../../node_modules/world-atlas/land-50m.json", import.meta.url)));
const lines = mesh(topo, topo.objects.land).coordinates;

const MIN_DEG = 0.35; // drop vertices closer than this to the last kept one
const strips = [];
let kept = 0, total = 0;
for (const line of lines) {
  const out = [];
  let last = null;
  for (const [lon, lat] of line) {
    total++;
    if (last && Math.hypot(lon - last[0], lat - last[1]) < MIN_DEG) continue;
    out.push(Math.round(lon * 10), Math.round(lat * 10));
    last = [lon, lat];
    kept++;
  }
  if (out.length >= 6) strips.push(out);
}
const json = JSON.stringify(strips);
writeFileSync(new URL("../../client/src/components/cld/globe/land.json", import.meta.url), json);
console.log(`${strips.length} strips · ${kept}/${total} vertices · ${(json.length / 1024).toFixed(0)} KB`);
