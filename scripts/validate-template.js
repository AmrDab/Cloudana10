#!/usr/bin/env node

// Template Validator for awesome-akash SDL templates
// 
// Usage:
//   node scripts/validate-template.js ../awesome-akash/tetris/deploy.yaml
//   node scripts/validate-template.js ../awesome-akash/*/deploy.yaml

import { readFileSync } from 'fs';
import { basename, dirname } from 'path';
import yaml from 'js-yaml';
import { glob } from 'glob';

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, ...args) {
  console.log(color + args.join(' ') + colors.reset);
}

function validateSDL(sdlPath) {
  const templateName = basename(dirname(sdlPath));
  const errors = [];
  const warnings = [];
  let data;

  log(colors.cyan, `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log(colors.bright, `📦 Template: ${templateName}`);
  log(colors.cyan, `   File: ${sdlPath}`);
  
  try {
    const content = readFileSync(sdlPath, 'utf8');
    
    // Check if file is empty
    if (!content.trim()) {
      errors.push('File is empty');
      return { errors, warnings };
    }

    // Parse YAML
    try {
      data = yaml.load(content);
    } catch (e) {
      errors.push(`YAML parse error: ${e.message}`);
      return { errors, warnings };
    }

    // Check if parsed data is an object
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      errors.push('SDL must be an object');
      return { errors, warnings };
    }

    // Validate version
    if (!data.version) {
      errors.push('Missing "version" field');
    } else if (data.version !== '2.0' && data.version !== '2.1') {
      errors.push(`Invalid version: ${data.version} (must be 2.0 or 2.1)`);
    }

    // Validate services
    if (!data.services) {
      errors.push('Missing "services" section');
    } else if (typeof data.services !== 'object') {
      errors.push('"services" must be an object');
    } else {
      const serviceNames = Object.keys(data.services);
      if (serviceNames.length === 0) {
        errors.push('No services defined');
      }

      // Check each service
      for (const [name, svc] of Object.entries(data.services)) {
        if (!svc || typeof svc !== 'object') {
          errors.push(`Service "${name}": invalid definition`);
          continue;
        }

        // Required: image
        if (!svc.image) {
          errors.push(`Service "${name}": missing "image"`);
        }

        // Required: expose (for web apps)
        if (!svc.expose || !Array.isArray(svc.expose) || svc.expose.length === 0) {
          warnings.push(`Service "${name}": no "expose" defined (workload won't be accessible)`);
        }

        // Check for environment variable placeholders
        if (svc.env && Array.isArray(svc.env)) {
          for (const envVar of svc.env) {
            if (typeof envVar === 'string') {
              if (envVar.includes('CHANGE_ME') || 
                  envVar.includes('YOUR_') || 
                  envVar.includes('YOURDOMAIN') ||
                  envVar.includes('SET_THIS')) {
                warnings.push(`Service "${name}": env var requires user modification: ${envVar}`);
              }
            }
          }
        }

        // Check for command with placeholders
        if (svc.command && Array.isArray(svc.command)) {
          const cmdStr = svc.command.join(' ');
          if (cmdStr.includes('FIRST_START=true')) {
            warnings.push(`Service "${name}": requires initial setup (FIRST_START=true)`);
          }
        }
      }
    }

    // Validate profiles
    if (!data.profiles) {
      errors.push('Missing "profiles" section');
    } else {
      // Check compute profiles
      if (!data.profiles.compute) {
        errors.push('Missing "profiles.compute" section');
      } else if (typeof data.profiles.compute !== 'object') {
        errors.push('"profiles.compute" must be an object');
      } else {
        for (const [profileName, profile] of Object.entries(data.profiles.compute)) {
          if (!profile || typeof profile !== 'object') {
            errors.push(`Compute profile "${profileName}": invalid definition`);
            continue;
          }

          if (!profile.resources) {
            errors.push(`Compute profile "${profileName}": missing "resources"`);
            continue;
          }

          const res = profile.resources;

          // Check CPU
          if (!res.cpu) {
            errors.push(`Compute profile "${profileName}": missing "cpu"`);
          } else if (typeof res.cpu === 'object') {
            const cpuValue = res.cpu.units;
            if (cpuValue === undefined || cpuValue === null) {
              errors.push(`Compute profile "${profileName}": missing CPU units`);
            } else {
              const cpuNum = Number(cpuValue);
              if (isNaN(cpuNum) || cpuNum <= 0) {
                errors.push(`Compute profile "${profileName}": invalid CPU units (must be positive number, got: ${cpuValue})`);
              }
            }
          } else if (typeof res.cpu === 'number' && res.cpu <= 0) {
            errors.push(`Compute profile "${profileName}": invalid CPU value`);
          }

          // Check memory
          if (!res.memory) {
            errors.push(`Compute profile "${profileName}": missing "memory"`);
          } else {
            const memSize = typeof res.memory === 'string' ? res.memory : res.memory.size;
            if (!memSize || typeof memSize !== 'string') {
              errors.push(`Compute profile "${profileName}": invalid memory size`);
            } else if (!/^\d+(\.\d+)?(Mi|Gi|Ti|Mb|Gb|Tb|Ki|Ki)?$/i.test(memSize)) {
              warnings.push(`Compute profile "${profileName}": unusual memory format: ${memSize}`);
            }
          }

          // Check storage
          if (!res.storage) {
            warnings.push(`Compute profile "${profileName}": no storage defined`);
          } else if (Array.isArray(res.storage) && res.storage.length === 0) {
            warnings.push(`Compute profile "${profileName}": empty storage array`);
          }
        }
      }

      // Check placement profiles
      if (!data.profiles.placement) {
        errors.push('Missing "profiles.placement" section');
      } else if (typeof data.profiles.placement !== 'object') {
        errors.push('"profiles.placement" must be an object');
      } else {
        for (const [placementName, placement] of Object.entries(data.profiles.placement)) {
          if (!placement || typeof placement !== 'object') {
            errors.push(`Placement profile "${placementName}": invalid definition`);
            continue;
          }

          if (!placement.pricing) {
            errors.push(`Placement profile "${placementName}": missing "pricing"`);
          }
        }
      }
    }

    // Validate deployment
    if (!data.deployment) {
      errors.push('Missing "deployment" section');
    } else if (typeof data.deployment !== 'object') {
      errors.push('"deployment" must be an object');
    } else {
      const deploymentNames = Object.keys(data.deployment);
      if (deploymentNames.length === 0) {
        errors.push('No deployments defined');
      }
    }

  } catch (e) {
    errors.push(`Unexpected error: ${e.message}`);
  }

  return { errors, warnings, data };
}

function printResults(results) {
  const { errors, warnings } = results;
  
  if (errors.length === 0 && warnings.length === 0) {
    log(colors.green, '   ✓ Template is valid and ready to deploy');
    return true;
  }

  if (errors.length > 0) {
    log(colors.red, `   ✗ ${errors.length} ERROR(S):`);
    errors.forEach((err, i) => {
      log(colors.red, `     ${i + 1}. ${err}`);
    });
  }

  if (warnings.length > 0) {
    log(colors.yellow, `   ⚠ ${warnings.length} WARNING(S):`);
    warnings.forEach((warn, i) => {
      log(colors.yellow, `     ${i + 1}. ${warn}`);
    });
  }

  return errors.length === 0;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node validate-template.js <path-to-template.yaml> [...]');
    console.log('');
    console.log('Examples:');
    console.log('  node scripts/validate-template.js ../awesome-akash/tetris/deploy.yaml');
    console.log('  node scripts/validate-template.js ../awesome-akash/*/deploy.yaml');
    console.log('  node scripts/validate-template.js ../awesome-akash/*/deploy.yml');
    process.exit(1);
  }

  // Expand glob patterns
  let files = [];
  for (const arg of args) {
    const matches = await glob(arg);
    files.push(...matches);
  }

  if (files.length === 0) {
    log(colors.red, 'No template files found');
    process.exit(1);
  }

  log(colors.cyan, `\n${'═'.repeat(58)}`);
  log(colors.bright, `📋 TEMPLATE VALIDATION REPORT`);
  log(colors.cyan, `   Found ${files.length} template(s)`);
  log(colors.cyan, `${'═'.repeat(58)}`);

  let validCount = 0;
  let invalidCount = 0;
  const invalidTemplates = [];

  for (const file of files) {
    const results = validateSDL(file);
    const isValid = printResults(results);
    
    if (isValid) {
      validCount++;
    } else {
      invalidCount++;
      invalidTemplates.push({
        file,
        errors: results.errors,
        warnings: results.warnings,
      });
    }
  }

  log(colors.cyan, `\n${'═'.repeat(58)}`);
  log(colors.bright, `📊 SUMMARY`);
  log(colors.green, `   ✓ Valid:   ${validCount}`);
  if (invalidCount > 0) {
    log(colors.red, `   ✗ Invalid: ${invalidCount}`);
  }
  log(colors.cyan, `${'═'.repeat(58)}\n`);

  if (invalidTemplates.length > 0) {
    log(colors.yellow, '❌ Templates with issues:');
    invalidTemplates.forEach(({ file, errors }) => {
      log(colors.yellow, `   - ${basename(dirname(file))}: ${errors.length} error(s)`);
    });
    console.log('');
  }

  process.exit(invalidCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
