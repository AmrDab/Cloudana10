/**
 * Deploy CLDTokenV2 + CloudanaSettlementV2 (IMPL_SPEC_2026-10 "Settlement contract v2").
 *   npx hardhat run scripts/v2/deploy.ts --network baseSepolia
 *
 * Env (required): TREASURY_SAFE, GUARDIAN_SAFE, ADMIN_SAFE, POSTER_ADDRESS, PRIVATE_KEY (deployer, from hardhat.config.ts)
 * Env (optional): EPOCH_SECONDS=3600, VETO_DELAY=3600, VEST_B=3600, INITIAL_SUPPLY=1000000 (CLD),
 *                 MAX_MINT_BPS_PER_YEAR=1000, GENESIS_TIMESTAMP (default: latest block)
 *
 * After it runs the deployer holds no role on either contract:
 *   token:      MINTER_ROLE -> settlement only; DEFAULT_ADMIN_ROLE -> ADMIN_SAFE
 *   settlement: DEFAULT_ADMIN_ROLE -> ADMIN_SAFE, POSTER_ROLE -> POSTER_ADDRESS, GUARDIAN_ROLE -> GUARDIAN_SAFE
 * Writes a "v2" section into shared/addresses.<network>.json (existing keys kept) and prints Basescan verify commands.
 * The owner runs this; it is never run by the build.
 */
import { ethers, network } from "hardhat";
import type { Signer } from "ethers";
import * as fs from "fs";
import * as path from "path";

export const SHARED = path.join(__dirname, "../../../shared");

export type DeployParams = {
  treasury: string;
  guardian: string;
  admin: string;
  poster: string;
  epochSeconds: number;
  vetoDelaySeconds: number;
  vestBSeconds: number;
  initialSupplyWei: bigint;
  maxMintBpsPerYear: number;
  genesisTimestamp: number;
};

export type DeployResult = {
  token: string;
  settlement: string;
  genesisEpoch: number;
  tokenArgs: (string | bigint | number)[];
  settlementArgs: (string | bigint | number)[];
};

/** Deploy both contracts from `deployer`, wire the roles, and leave the deployer with none. */
export async function deployV2(deployer: Signer, p: DeployParams, log: (s: string) => void = () => {}): Promise<DeployResult> {
  const deployerAddr = await deployer.getAddress();
  const tokenArgs = [p.treasury, p.initialSupplyWei, p.maxMintBpsPerYear, deployerAddr];
  const token = await (await ethers.getContractFactory("CLDTokenV2", deployer)).deploy(
    p.treasury, p.initialSupplyWei, p.maxMintBpsPerYear, deployerAddr,
  );
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  log(`CLDTokenV2            ${tokenAddr}`);

  const settlementArgs = [
    tokenAddr, p.treasury, p.admin, p.poster, p.guardian, p.epochSeconds, p.vetoDelaySeconds, p.vestBSeconds, p.genesisTimestamp,
  ];
  const settlement = await (await ethers.getContractFactory("CloudanaSettlementV2", deployer)).deploy(
    tokenAddr, p.treasury, p.admin, p.poster, p.guardian, p.epochSeconds, p.vetoDelaySeconds, p.vestBSeconds, p.genesisTimestamp,
  );
  await settlement.waitForDeployment();
  const settlementAddr = await settlement.getAddress();
  const genesisEpoch = Number(await settlement.genesisEpoch());
  log(`CloudanaSettlementV2  ${settlementAddr}  (genesisEpoch ${genesisEpoch})`);

  const MINTER_ROLE = await token.MINTER_ROLE();
  const ADMIN_ROLE = await token.DEFAULT_ADMIN_ROLE();
  await (await token.grantRole(MINTER_ROLE, settlementAddr)).wait();
  await (await token.grantRole(ADMIN_ROLE, p.admin)).wait();
  // Last: the deployer gives up token admin (nothing else to do afterwards).
  await (await token.renounceRole(ADMIN_ROLE, deployerAddr)).wait();
  log(`token roles: minter=settlement admin=${p.admin} deployer=none`);

  if (await token.hasRole(ADMIN_ROLE, deployerAddr) || await token.hasRole(MINTER_ROLE, deployerAddr)) {
    throw new Error("deployer still holds a token role");
  }
  for (const role of [ADMIN_ROLE, await settlement.POSTER_ROLE(), await settlement.GUARDIAN_ROLE()]) {
    if (await settlement.hasRole(role, deployerAddr)) throw new Error("deployer still holds a settlement role");
  }
  return { token: tokenAddr, settlement: settlementAddr, genesisEpoch, tokenArgs, settlementArgs };
}

function requireAddr(name: string): string {
  const v = process.env[name];
  if (!v || !ethers.isAddress(v)) throw new Error(`${name} must be set to an address`);
  return ethers.getAddress(v);
}

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (network.name === "hardhat") throw new Error("use --network baseSepolia (or localhost for a dry run)");
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("no deployer: set PRIVATE_KEY");

  const params: DeployParams = {
    treasury: requireAddr("TREASURY_SAFE"),
    guardian: requireAddr("GUARDIAN_SAFE"),
    admin: requireAddr("ADMIN_SAFE"),
    poster: requireAddr("POSTER_ADDRESS"),
    epochSeconds: Number(process.env.EPOCH_SECONDS ?? 3600),
    vetoDelaySeconds: Number(process.env.VETO_DELAY ?? 3600),
    vestBSeconds: Number(process.env.VEST_B ?? 3600),
    initialSupplyWei: ethers.parseEther(process.env.INITIAL_SUPPLY ?? "1000000"),
    maxMintBpsPerYear: Number(process.env.MAX_MINT_BPS_PER_YEAR ?? 1000),
    genesisTimestamp: Number(process.env.GENESIS_TIMESTAMP ?? (await ethers.provider.getBlock("latest"))!.timestamp),
  };
  console.log(`network=${network.name} chainId=${chainId} deployer=${deployer.address}`);
  console.log(JSON.stringify({ ...params, initialSupplyWei: params.initialSupplyWei.toString() }, null, 2));

  const r = await deployV2(deployer, params, console.log);

  const file = path.join(SHARED, `addresses.${network.name}.json`);
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { chainId: Number(chainId), network: network.name };
  const oldContracts: Record<string, string> = existing.contracts ?? {};
  const oldRoles: Record<string, string> = existing.roles ?? {};
  const deprecated = [
    ...Object.entries(oldContracts).filter(([, a]) => a && a !== ethers.ZeroAddress).map(([name, address]) => ({ name, address })),
    ...Object.entries(oldRoles).map(([name, address]) => ({ name: `role:${name}`, address })),
  ].map((d) => ({ ...d, note: "compromised key — do not use" }));
  const out = {
    ...existing,
    v2: {
      CLDTokenV2: r.token,
      CloudanaSettlementV2: r.settlement,
      treasury: params.treasury,
      guardian: params.guardian,
      admin: params.admin,
      poster: params.poster,
      epochSeconds: params.epochSeconds,
      vetoDelaySeconds: params.vetoDelaySeconds,
      vestBSeconds: params.vestBSeconds,
      genesisTimestamp: params.genesisTimestamp,
      genesisEpoch: r.genesisEpoch,
      maxMintBpsPerYear: params.maxMintBpsPerYear,
      initialSupplyWei: params.initialSupplyWei.toString(),
      deployedAt: new Date().toISOString(),
    },
    deprecated: existing.deprecated ?? deprecated,
  };
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${path.relative(process.cwd(), file)} (v2 section; ${deprecated.length} legacy entries marked deprecated)`);

  const argList = (xs: (string | bigint | number)[]) => xs.map((x) => `"${x.toString()}"`).join(" ");
  console.log("\nVerify on Basescan:");
  console.log(`  npx hardhat verify --network ${network.name} ${r.token} ${argList(r.tokenArgs)}`);
  console.log(`  npx hardhat verify --network ${network.name} ${r.settlement} ${argList(r.settlementArgs)}`);
  console.log("\nKeeper vars: SETTLEMENT_ADDRESS=" + r.settlement + ` CHAIN_ID=${chainId}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
