# ABI Export Scripts Structure

## Overview
The ABI export functionality has been separated into individual scripts for each smart contract, following the same organizational pattern as deploy and verify scripts.

## File Structure

```
contract/
├── scripts/
│   ├── cld-token/
│   │   ├── deploy.ts
│   │   ├── verify.ts
│   │   └── export-abi.ts      ← CLDToken ABI export
│   ├── workload-registry/
│   │   ├── deploy.ts
│   │   ├── verify.ts
│   │   └── export-abi.ts      ← WorkloadRegistry ABI export
│   └── utils/
│       └── export-abi.ts       ← Main script (exports all ABIs)
```

## Usage

### Export Individual Contract ABIs

#### Export CLDToken ABI only:
```bash
npm run export-abi:cld
```

#### Export WorkloadRegistry ABI only:
```bash
npm run export-abi:work
```

### Export All ABIs

#### Export all contract ABIs:
```bash
npm run export-abi
```

This runs the main script in `scripts/utils/export-abi.ts` which calls both individual export scripts.

### Build (Compile + Export All)

```bash
npm run build
```

This compiles all contracts and then exports all ABIs.

## Scripts Available

| Script | Description |
|--------|-------------|
| `npm run export-abi` | Export all contract ABIs |
| `npm run export-abi:cld` | Export CLDToken ABI only |
| `npm run export-abi:work` | Export WorkloadRegistry ABI only |
| `npm run build` | Compile contracts + export all ABIs |

## Output Location

All ABIs are exported to:
```
shared/abi/
├── CLDToken.json
└── WorkloadRegistry.json
```

## Benefits of This Structure

1. **Modularity**: Each contract has its own export script, making it easy to export just what you need
2. **Consistency**: Follows the same pattern as deploy/verify scripts
3. **Maintainability**: Easy to add new contracts - just create a new directory with its export script
4. **Flexibility**: Can export individual contracts or all at once
5. **Error Handling**: Each script handles its own errors independently

## Adding New Contracts

To add a new contract's ABI export:

1. Create a new directory: `scripts/[contract-name]/`
2. Create `export-abi.ts` following the pattern:
   ```typescript
   import * as fs from "fs";
   import * as path from "path";

   async function export[ContractName]ABI() {
     const artifactsPath = path.join(__dirname, "../../artifacts/contracts");
     const sharedAbiPath = path.join(__dirname, "../../../shared/abi");
     
     if (!fs.existsSync(sharedAbiPath)) {
       fs.mkdirSync(sharedAbiPath, { recursive: true });
     }
     
     const artifactPath = path.join(
       artifactsPath,
       "[ContractName].sol/[ContractName].json"
     );
     
     if (fs.existsSync(artifactPath)) {
       const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
       const abiPath = path.join(sharedAbiPath, "[ContractName].json");
       fs.writeFileSync(abiPath, JSON.stringify(artifact.abi, null, 2));
       console.log(`✓ Exported [ContractName] ABI to ${abiPath}`);
     } else {
       console.error(`✗ [ContractName] artifact not found`);
       process.exit(1);
     }
   }

   export[ContractName]ABI()
     .then(() => process.exit(0))
     .catch((error) => {
       console.error(error);
       process.exit(1);
     });
   ```

3. Add script to `package.json`:
   ```json
   "export-abi:[contract-name]": "ts-node scripts/[contract-name]/export-abi.ts"
   ```

4. Update `scripts/utils/export-abi.ts` to include the new contract in the export-all script

## Example Workflow

```bash
# 1. Compile contracts
npm run compile

# 2. Export specific contract ABI
npm run export-abi:work

# OR export all ABIs
npm run export-abi

# OR compile and export in one command
npm run build
```
