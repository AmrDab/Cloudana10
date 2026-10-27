/**
 * Phase 3 (docs/POUW_SIMULATION_PLAN.md §6): the guardian vetoes the most recently posted, not yet finalized epoch on
 * the local chain. The keeper must then tell the API (/vetoed), the API re-closes the epoch, and a corrected root is
 * posted. Guardian = hardhat account #5 (the local deploy's GUARDIAN_SAFE).
 *   npx tsx scripts/sim/testnet/veto.ts
 */
import { createPublicClient, createWalletClient, defineChain, http, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { settlementAbi } from "../../../keeper/src/abi";
import { CHAIN_ID, RPC, addresses, log } from "./common.ts";

const GUARDIAN_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" as const; // hardhat #5, local only
const chain = defineChain({ id: CHAIN_ID, name: "local", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const a = addresses();
const posted = await pub.getLogs({
  address: a.CloudanaSettlementV2,
  event: parseAbiItem("event EpochPosted(uint256 indexed epoch, bytes32 root, uint256 totalLaneA, uint256 totalLaneB, uint256 treasuryAmount, uint256 feesBurned)"),
  fromBlock: 0n,
  toBlock: "latest",
});
let target: bigint | null = null;
for (const l of posted.reverse()) {
  const e = (await pub.readContract({ address: a.CloudanaSettlementV2, abi: settlementAbi, functionName: "epochs", args: [l.args.epoch!] })) as any;
  if (Number(e[9]) === 1) {
    target = l.args.epoch!;
    break;
  }
}
if (target === null) {
  log("veto", "no epoch is in the posted (veto-able) state right now");
  process.exit(2);
}
const guardian = privateKeyToAccount(GUARDIAN_KEY);
const hash = await createWalletClient({ chain, transport: http(RPC), account: guardian }).writeContract({ address: a.CloudanaSettlementV2, abi: settlementAbi, functionName: "veto", args: [target] });
await pub.waitForTransactionReceipt({ hash });
log("veto", `guardian vetoed epoch ${target} (tx ${hash})`);
