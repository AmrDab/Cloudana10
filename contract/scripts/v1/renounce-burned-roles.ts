/**
 * Strip every role the burned wallet (0xF292…c61A, private key public since 2025–2026) holds on the legacy v1
 * contracts on Base Sepolia, so that key can no longer mint v1 CLD or administer them. It renounces only: it never
 * grants a role to anyone (a clean admin on a contract the leaked key also controls could be revoked by whoever holds
 * that key). The v1 contracts stay retired either way; v2 deploys fresh under the Safe (docs/OWNER_RUNBOOK.md step 4).
 *
 * Owner-run. Dry run (default) lists what would be renounced; EXECUTE=1 sends one renounceRole per role, other roles
 * before DEFAULT_ADMIN on each contract. Needs a little Base Sepolia ETH on the burned wallet (it has some).
 *
 *   cd contract
 *   $env:PRIVATE_KEY = "<the leaked key>"; npx hardhat run scripts/v1/renounce-burned-roles.ts --network baseSepolia
 *   $env:EXECUTE = "1"; npx hardhat run scripts/v1/renounce-burned-roles.ts --network baseSepolia
 *   Remove-Item Env:PRIVATE_KEY, Env:EXECUTE
 */
import { ethers, network } from "hardhat";
import { BURNED_WALLETS } from "../v2/deploy";

const V1 = {
  CLDToken: "0xcfd19DF5a3f963Dabf52aC7B46d4780Cc0E599e2",
  WorkloadRegistry: "0x71a36e548a884019b4A60947551efB8229e2016a",
  ProviderRegistry: "0x1e7b0039bdC27cB6B1e83d96D5Ad839fD15Af94a",
  RewardContract: "0x427830A20C4752eb30C47e0d2572A457ebF4A8AD",
  POUWVerifier: "0xE2791574413d2bdE5B84848A99Aeb3B9f4d80682",
  StakingManager: "0xeEE91E1209995Fc9fE9183330b1872AfAb7C8661",
  ChallengeManager: "0x54CA56081e358f89dafFd587F0241eA33BaEC597",
  // Deployed by the burned wallet on 2026-03-07 and granted it a role; not in shared/addresses.baseSepolia.json.
  Unlisted_0xc15c: "0xc15c61E35D6d73dEf14460a1C7010fd169eD2e7F",
};
const ROLE_NAMES = ["MINTER_ROLE", "ORCHESTRATOR_ROLE", "GOVERNANCE_ROLE", "GUARDIAN_ROLE", "POSTER_ROLE", "SCHEDULER_ROLE", "SLASHER_ROLE", "VALIDATOR_ROLE", "PAUSER_ROLE", "CHALLENGER_ROLE"];
const ABI = ["function hasRole(bytes32,address) view returns (bool)", "function renounceRole(bytes32,address)"];

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 84532n) throw new Error(`Base Sepolia only (chainId 84532), got ${chainId} on ${network.name}`);
  const [signer] = await ethers.getSigners();
  if (!signer || !BURNED_WALLETS.includes(signer.address.toLowerCase())) {
    throw new Error(`run with the burned wallet's key in PRIVATE_KEY; signer is ${signer?.address ?? "none"}`);
  }
  const execute = process.env.EXECUTE === "1";
  // DEFAULT_ADMIN last: renouncing it first would not stop the other roles, but keeps the order readable.
  const roles = [...ROLE_NAMES.map((n) => [n, ethers.id(n)] as const), ["DEFAULT_ADMIN_ROLE", ethers.ZeroHash] as const];
  let pending = 0;
  for (const [name, addr] of Object.entries(V1)) {
    const c = new ethers.Contract(addr, ABI, signer);
    for (const [roleName, role] of roles) {
      let held = false;
      try {
        held = await c.hasRole(role, signer.address);
      } catch {
        console.log(`${name.padEnd(17)} ${addr}  not an AccessControl contract; skipped`);
        break;
      }
      if (!held) continue;
      pending++;
      if (!execute) {
        console.log(`${name.padEnd(17)} ${addr}  would renounce ${roleName}`);
        continue;
      }
      const tx = await c.renounceRole(role, signer.address);
      await tx.wait();
      console.log(`${name.padEnd(17)} ${addr}  renounced ${roleName}  tx ${tx.hash}`);
    }
  }
  console.log(pending === 0 ? "the burned wallet holds no role on the v1 contracts" : execute ? `done: ${pending} roles renounced` : `${pending} roles held; run again with EXECUTE=1`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
