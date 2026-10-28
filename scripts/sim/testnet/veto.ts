/**
 * Phase 3 (docs/POUW_SIMULATION_PLAN.md §6): the guardian vetoes the most recently posted, not yet finalized epoch on
 * the local chain. The keeper must then tell the API (/vetoed), the API re-closes the epoch, and a corrected root is
 * posted. Guardian = hardhat account #5 (the local deploy's GUARDIAN_SAFE).
 *   npx tsx scripts/sim/testnet/veto.ts
 */
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseAbiItem } from "viem";
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
// An epoch is veto-able only between the post and the finalize (30 s locally): watch the next posts until one is.
const seen = new Set(posted.map((l) => l.args.epoch!));
const t0 = Date.now();
let target: bigint | null = null;
while (target === null && Date.now() - t0 < 10 * 60_000) {
  const recent = await pub.getLogs({ address: a.CloudanaSettlementV2, event: parseAbiItem("event EpochPosted(uint256 indexed epoch, bytes32 root, uint256 totalLaneA, uint256 totalLaneB, uint256 treasuryAmount, uint256 feesBurned)"), fromBlock: 0n, toBlock: "latest" });
  for (const l of recent.reverse()) {
    const e = (await pub.readContract({ address: a.CloudanaSettlementV2, abi: settlementAbi, functionName: "epochs", args: [l.args.epoch!] })) as any;
    if (Number(e[9]) === 1) {
      target = l.args.epoch!;
      break;
    }
    seen.add(l.args.epoch!);
  }
  if (target === null) await new Promise((r) => setTimeout(r, 2000));
}
if (target === null) {
  log("veto", "no epoch entered the posted (veto-able) state in 10 minutes");
  process.exit(2);
}
const guardian = privateKeyToAccount(GUARDIAN_KEY);
// The keeper's ABI has no veto (it never vetoes): the guardian call is declared here.
const hash = await createWalletClient({ chain, transport: http(RPC), account: guardian }).writeContract({ address: a.CloudanaSettlementV2, abi: parseAbi(["function veto(uint256 epoch)"]), functionName: "veto", args: [target] });
await pub.waitForTransactionReceipt({ hash });
log("veto", `guardian vetoed epoch ${target} (tx ${hash})`);
