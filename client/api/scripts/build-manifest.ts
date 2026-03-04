/**
 * Build K8s manifest from SDL file.
 * Usage: npm run build-manifest -- <sdl-file-path> [options]
 * Example: npm run build-manifest -- ../../../awesome-akash/redis/deploy.yaml --workload 1 --instance 1
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseSDL, validateSDL, extractResources } from "../src/services/sdl-parser.service.js";
import { buildK8sManifest } from "../src/services/k8s-builder.service.js";

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error("Usage: npm run build-manifest -- <sdl-file-path> [--workload <id>] [--instance <id>] [--namespace <ns>] [--output <file>]");
    console.error("\nExample:");
    console.error("  npm run build-manifest -- ../../../awesome-akash/redis/deploy.yaml");
    console.error("  npm run build-manifest -- ../../../awesome-akash/redis/deploy.yaml --workload 42 --instance 1 --output redis.json");
    process.exit(1);
  }

  const sdlPath = args[0];
  const workloadId = args.includes("--workload") ? args[args.indexOf("--workload") + 1] : "1";
  const instanceId = args.includes("--instance") ? args[args.indexOf("--instance") + 1] : "1";
  const namespace = args.includes("--namespace") ? args[args.indexOf("--namespace") + 1] : `workload-${workloadId}-${instanceId}`;
  const outputFile = args.includes("--output") ? args[args.indexOf("--output") + 1] : `manifest-${workloadId}-${instanceId}.json`;

  console.log(`📄 Building manifest from: ${sdlPath}`);
  console.log(`   Workload ID: ${workloadId}`);
  console.log(`   Instance ID: ${instanceId}`);
  console.log(`   Namespace: ${namespace}`);
  console.log(`   Output: ${outputFile}\n`);

  // 1. Read SDL file
  let sdlContent: string;
  try {
    sdlContent = readFileSync(sdlPath, "utf8");
  } catch (error) {
    console.error(`❌ Failed to read SDL file: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  
  // 2. Parse SDL
  console.log("🔍 Parsing SDL...");
  let parsed;
  try {
    parsed = parseSDL(sdlContent);
  } catch (error) {
    console.error(`❌ Failed to parse SDL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  console.log(`   ✓ Found ${parsed.services.length} service(s):`);
  parsed.services.forEach((s) => {
    console.log(`     - ${s.name} (${s.image})`);
    console.log(`       CPU: ${s.resources.cpu.units}m, Memory: ${s.resources.memory.size}`);
    if (s.resources.storage && s.resources.storage.length > 0) {
      console.log(`       Storage: ${s.resources.storage.map(st => st.size).join(", ")}`);
    }
    if (s.resources.gpu && s.resources.gpu.units > 0) {
      console.log(`       GPU: ${s.resources.gpu.units}`);
    }
  });

  // 3. Validate SDL
  console.log("\n✅ Validating SDL...");
  const validation = validateSDL(parsed);
  if (!validation.valid) {
    console.error("❌ SDL validation failed:");
    validation.errors.forEach((err) => console.error(`   - ${err}`));
    process.exit(1);
  }
  console.log("   ✓ SDL is valid");

  // 4. Extract resource requirements
  console.log("\n📊 Resource requirements:");
  const requirements = extractResources(parsed);
  console.log(`   CPU: ${requirements.cpu.toString()} millicores`);
  console.log(`   Memory: ${requirements.memoryBytes.toString()} bytes (${(Number(requirements.memoryBytes) / (1024 * 1024 * 1024)).toFixed(2)} GB)`);
  console.log(`   Storage: ${requirements.storageBytes.toString()} bytes (${(Number(requirements.storageBytes) / (1024 * 1024 * 1024)).toFixed(2)} GB)`);
  console.log(`   GPU: ${requirements.gpuCount.toString()}`);

  // 5. Build K8s manifest
  console.log("\n🔨 Building Kubernetes manifest...");
  let k8sManifest;
  try {
    k8sManifest = buildK8sManifest(parsed, {
      namespace,
      workloadId,
      instanceId,
    });
  } catch (error) {
    console.error(`❌ Failed to build K8s manifest: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  console.log(`   ✓ Generated ${k8sManifest.resources.length} Kubernetes resource(s):`);
  const resourcesByKind = k8sManifest.resources.reduce((acc, r) => {
    acc[r.kind] = (acc[r.kind] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  Object.entries(resourcesByKind).forEach(([kind, count]) => {
    console.log(`     - ${count}x ${kind}`);
  });

  // 6. Prepare output with metadata
  const output = {
    buildTimestamp: new Date().toISOString(),
    sdlSource: basename(sdlPath),
    workloadId,
    instanceId,
    namespace,
    resourceRequirements: {
      cpu: requirements.cpu.toString(),
      memoryBytes: requirements.memoryBytes.toString(),
      storageBytes: requirements.storageBytes.toString(),
      gpuCount: requirements.gpuCount.toString(),
    },
    parsedSDL: parsed,
    k8sManifest,
  };

  // 7. Write output file
  try {
    writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf8");
  } catch (error) {
    console.error(`❌ Failed to write output file: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  console.log(`\n✅ Manifest built successfully!`);
  console.log(`   📦 Output saved to: ${outputFile}`);
  console.log(`   📏 File size: ${(JSON.stringify(output).length / 1024).toFixed(2)} KB`);
  console.log(`\n💡 You can now use this manifest on the provider node.`);
  console.log(`   The k8sManifest.resources array contains all K8s resources ready to apply.`);
}

main();
