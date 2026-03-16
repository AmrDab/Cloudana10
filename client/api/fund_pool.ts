import { createPublicClient, createWalletClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const PK = "3b2e9fc2e5caf8d505fccbd93cc7783a126ac60a4a343df098366515482283c3";
const RPC = "https://base-sepolia.drpc.org";
const CLD = "0xcfd19DF5a3f963Dabf52aC7B46d4780Cc0E599e2" as const;
const REWARD = "0x427830A20C4752eb30C47e0d2572A457ebF4A8AD" as const;
const POOL_ID = 999n;
const AMOUNT = parseUnits("1000000", 18);

const ERC20 = [
  { name: "balanceOf", type: "function", inputs: [{name:"account",type:"address"}], outputs: [{type:"uint256"}], stateMutability: "view" },
  { name: "approve", type: "function", inputs: [{name:"spender",type:"address"},{name:"amount",type:"uint256"}], outputs: [{type:"bool"}], stateMutability: "nonpayable" },
  { name: "mint", type: "function", inputs: [{name:"to",type:"address"},{name:"amount",type:"uint256"}], outputs: [], stateMutability: "nonpayable" },
] as const;

const REWARD_ABI = [
  { name: "fundWorkload", type: "function", inputs: [{name:"workloadId",type:"uint256"},{name:"amount",type:"uint256"}], outputs: [], stateMutability: "nonpayable" },
  { name: "workloadDeposits", type: "function", inputs: [{name:"workloadId",type:"uint256"}], outputs: [{type:"uint256"}], stateMutability: "view" },
] as const;

const account = privateKeyToAccount(`0x${PK}`);
const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const wallet = createWalletClient({ chain: baseSepolia, transport: http(RPC), account });

const bal = await pub.readContract({ address: CLD, abi: ERC20, functionName: "balanceOf", args: [account.address] });
console.log("CLD balance:", bal.toString());

if (bal < AMOUNT) {
  const tx = await wallet.writeContract({ address: CLD, abi: ERC20, functionName: "mint", args: [account.address, AMOUNT] });
  console.log("Minted:", tx);
  await pub.waitForTransactionReceipt({ hash: tx });
}

const approveTx = await wallet.writeContract({ address: CLD, abi: ERC20, functionName: "approve", args: [REWARD, AMOUNT] });
console.log("Approved:", approveTx);
await pub.waitForTransactionReceipt({ hash: approveTx });

const fundTx = await wallet.writeContract({ address: REWARD, abi: REWARD_ABI, functionName: "fundWorkload", args: [POOL_ID, AMOUNT] });
console.log("Funded:", fundTx);
await pub.waitForTransactionReceipt({ hash: fundTx });

const deposit = await pub.readContract({ address: REWARD, abi: REWARD_ABI, functionName: "workloadDeposits", args: [POOL_ID] });
console.log("Mining pool balance:", deposit.toString(), "wei =", Number(deposit) / 1e18, "CLD");
