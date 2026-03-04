#!/usr/bin/env node

// Test UI parsing logic with actual awesome-akash templates
// Simulates what happens in deployment-edit-shared.tsx

import { readFileSync } from 'fs';
import yaml from 'js-yaml';

// Simulated deployToBuilderConfig (simplified version from UI)
function deployToBuilderConfig(parsed) {
  console.log('\n[Test] ═══════════════════════════════════════');
  console.log('[Test] Testing deployToBuilderConfig');
  console.log('[Test] Parsed keys:', Object.keys(parsed));
  
  // Extract first service
  if (!parsed?.services || typeof parsed.services !== 'object') {
    console.error('[Test] ERROR: Missing or invalid services section');
    return null;
  }
  
  const serviceEntries = Object.entries(parsed.services);
  if (serviceEntries.length === 0) {
    console.error('[Test] ERROR: No services defined');
    return null;
  }
  
  const [serviceName, svc] = serviceEntries[0];
  console.log('[Test] Service name:', serviceName);
  console.log('[Test] Service keys:', Object.keys(svc));
  
  const image = svc?.image || "nginx:latest";
  console.log('[Test] Image:', image);
  
  // Handle env variables - awesome-akash uses strings like "KEY=value"
  const envArr = Array.isArray(svc?.env) ? svc.env : [];
  const env = envArr.map((e) => {
    if (typeof e === 'string') {
      const parts = e.split('=');
      return { key: parts[0] || "", value: parts.slice(1).join('=') || "" };
    } else if (typeof e === 'object' && e !== null) {
      return { key: e.key || "", value: e.value || "" };
    }
    return { key: "", value: "" };
  });
  console.log('[Test] Env vars:', env.length);
  
  // Extract resources from profiles
  if (!parsed?.profiles || typeof parsed.profiles !== 'object') {
    console.error('[Test] ERROR: Missing profiles section');
    return null;
  }
  
  const compute = parsed.profiles.compute 
    ? Object.values(parsed.profiles.compute)[0]
    : undefined;
    
  if (!compute) {
    console.error('[Test] ERROR: No compute profile found');
    return null;
  }
  
  const resources = compute?.resources || {};
  console.log('[Test] Resources keys:', Object.keys(resources));
  
  // Extract CPU
  const cpuRaw = resources.cpu;
  let cpu;
  if (typeof cpuRaw === 'number') {
    cpu = cpuRaw;
  } else if (cpuRaw && typeof cpuRaw === 'object') {
    cpu = cpuRaw.units ?? 1;
  } else {
    cpu = 1;
  }
  console.log('[Test] CPU:', cpu);
  
  // Extract Memory
  const memRaw = resources.memory;
  let memSize;
  if (typeof memRaw === 'string') {
    memSize = memRaw;
  } else if (memRaw && typeof memRaw === 'object') {
    memSize = memRaw.size ?? "1Gi";
  } else {
    memSize = "1Gi";
  }
  const memory = parseFloat(String(memSize).replace(/[^0-9.]/g, "") || "1");
  const memoryUnit = memSize.includes("Gi") ? "Gi" : memSize.includes("Ti") ? "Ti" : "Mi";
  console.log('[Test] Memory:', memory, memoryUnit);
  
  // Extract Storage
  let storageRaw = resources.storage;
  let stor;
  
  if (Array.isArray(storageRaw)) {
    stor = storageRaw.map(s => {
      if (typeof s === 'string') return { size: s };
      if (typeof s === 'object' && s !== null) return s;
      return { size: "10Gi" };
    });
  } else if (storageRaw && typeof storageRaw === 'object') {
    stor = [storageRaw];
  } else if (typeof storageRaw === 'string') {
    stor = [{ size: storageRaw }];
  } else {
    stor = [{ size: "10Gi" }];
  }
  
  console.log('[Test] Storage entries:', stor.length);
  const ephemeral = stor.find((s) => !s.name && !s.attributes?.persistent) || stor[0];
  console.log('[Test] Ephemeral storage:', ephemeral?.size);
  
  // Check if we can create summary
  if (!image || !cpu || !memory || !memoryUnit) {
    console.error('[Test] ERROR: Missing required fields for summary');
    console.error('[Test] image:', image, 'cpu:', cpu, 'memory:', memory, 'unit:', memoryUnit);
    return null;
  }
  
  console.log('[Test] ✓ Successfully extracted builder config');
  return {
    image,
    cpu,
    memory,
    memoryUnit,
    env: env.length,
  };
}

// Test a template
function testTemplate(templatePath) {
  const templateName = templatePath.split('/').slice(-2, -1)[0];
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📦 Testing: ${templateName}`);
  console.log(`   File: ${templatePath}`);
  
  try {
    const content = readFileSync(templatePath, 'utf8');
    const parsed = yaml.load(content);
    
    const config = deployToBuilderConfig(parsed);
    
    if (config) {
      console.log('[Test] ✅ SUCCESS - Would show confirmation modal in UI');
      return true;
    } else {
      console.log('[Test] ❌ FAIL - Would show "Could not read deployment summary"');
      return false;
    }
  } catch (e) {
    console.error('[Test] ❌ EXCEPTION:', e.message);
    return false;
  }
}

// Test multiple templates
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('Usage: node test-ui-parsing.js <template1.yaml> <template2.yaml> ...');
  process.exit(1);
}

let passed = 0;
let failed = 0;

for (const arg of args) {
  if (testTemplate(arg)) {
    passed++;
  } else {
    failed++;
  }
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📊 Results: ${passed} passed, ${failed} failed`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

process.exit(failed > 0 ? 1 : 0);
