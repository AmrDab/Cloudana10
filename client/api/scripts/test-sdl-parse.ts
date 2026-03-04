/**
 * Test script: parse ElizaOS SDL and build K8s manifest.
 * Run: npx tsx scripts/test-sdl-parse.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSDL, extractResources } from "../src/services/sdl-parser.service.js";
import { buildK8sManifest } from "../src/services/k8s-builder.service.js";

const elizaPath = join(process.cwd(), "..", "..", "..", "awesome-akash", "Elizaos-ai_Agents", "deploy.yml");

function main() {
  console.log("Testing SDL parser with ElizaOS template...\n");

  const yaml = readFileSync(elizaPath, "utf8");
  console.log("1. Parsing SDL...");
  const parsed = parseSDL(yaml);
  console.log("   Parsed:", parsed.services.length, "service(s)");
  parsed.services.forEach((s) => {
    console.log("   -", s.name, "image:", s.image);
    console.log("     CPU:", s.resources.cpu.units, "Memory:", s.resources.memory.size);
    console.log("     Storage:", s.resources.storage.map((st) => st.size).join(", "));
    console.log("     Ports:", s.expose.map((e) => e.port).join(", "));
  });

  console.log("\n2. Extracting requirements...");
  const req = extractResources(parsed);
  console.log("   CPU:", req.cpu.toString());
  console.log("   Memory:", req.memoryBytes.toString(), "bytes");
  console.log("   Storage:", req.storageBytes.toString(), "bytes");
  console.log("   GPU:", req.gpuCount.toString());

  console.log("\n3. Building K8s manifest...");
  const k8s = buildK8sManifest(parsed, {
    namespace: "workload-1-1",
    workloadId: "1",
    instanceId: "1",
  });
  console.log("   Namespace:", k8s.namespace);
  console.log("   Resources:", k8s.resources.length);
  k8s.resources.forEach((r) => {
    console.log("   -", r.kind, r.metadata?.name);
  });

  console.log("\n✅ SDL parse and K8s build test passed.");
}

main();
