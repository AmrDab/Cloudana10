/** viem-backed access to CloudanaSettlementV2 (reads, poster writes). `Chain` is the interface run.ts depends on. */
import {
  createPublicClient, createWalletClient, defineChain, http, zeroHash,
  type Address, type Hex, type PublicClient, type WalletClient, type Chain as ViemChain, type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { EpochStatus, settlementAbi } from "./abi";

export type OnChainEpoch = {
  root: Hex;
  totalLaneA: bigint;
  totalLaneB: bigint;
  treasuryAmount: bigint;
  feesBurned: bigint;
  mintedA: bigint;
  mintedB: bigint;
  postedAt: bigint;
  finalizedAt: bigint;
  status: EpochStatus;
};

export type ClaimEntry = { account: Address; laneA: bigint; laneB: bigint; proof: Hex[] };
export type PostArgs = { epoch: bigint; root: Hex; totalLaneA: bigint; totalLaneB: bigint; treasuryAmount: bigint; feesBurned: bigint };

export interface Chain {
  getEpoch(epoch: bigint): Promise<OnChainEpoch>;
  getParams(): Promise<{ epochSeconds: bigint; vetoDelaySeconds: bigint; vestBSeconds: bigint; genesisEpoch: bigint }>;
  getEscrowAvailable(): Promise<bigint>;
  getAllowance(epoch: bigint): Promise<bigint>;
  getLaneFlags(epoch: bigint, accounts: Address[]): Promise<number[]>;
  /** Latest block timestamp (the contract's notion of "now"). */
  now(): Promise<bigint>;
  getPosterBalance(): Promise<bigint>;
  /** Transaction hash of the live EpochPosted log for `epoch`, if it can be found in recent blocks. */
  findPostTx(epoch: bigint): Promise<Hex | null>;
  postEpoch(a: PostArgs): Promise<Hex>;
  finalize(epoch: bigint): Promise<Hex>;
  claimFor(epoch: bigint, entries: ClaimEntry[]): Promise<Hex>;
}

export function chainFor(chainId: number, rpcUrl: string): ViemChain {
  if (chainId === baseSepolia.id) return { ...baseSepolia, rpcUrls: { default: { http: [rpcUrl] } } };
  return defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

const LOG_LOOKBACK_BLOCKS = 100_000n;

export function createChain(opts: { rpcUrl: string; chainId: number; settlement: Address; posterKey: Hex }): Chain {
  const chain = chainFor(opts.chainId, opts.rpcUrl);
  const transport = http(opts.rpcUrl);
  const pub: PublicClient = createPublicClient({ chain, transport });
  const account: Account = privateKeyToAccount(opts.posterKey);
  const wallet: WalletClient = createWalletClient({ chain, transport, account });
  const address = opts.settlement;
  let params: { epochSeconds: bigint; vetoDelaySeconds: bigint; vestBSeconds: bigint; genesisEpoch: bigint } | null = null;

  async function write(functionName: "postEpoch" | "finalize" | "claimFor", args: readonly unknown[]): Promise<Hex> {
    // simulate first: a revert surfaces as a decoded custom error instead of a burned tx
    const { request } = await pub.simulateContract({ address, abi: settlementAbi, functionName, args: args as any, account });
    const hash = await wallet.writeContract(request as any);
    const receipt = await pub.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== "success") throw new Error(`${functionName} tx ${hash} reverted on-chain`);
    return hash;
  }

  return {
    async getEpoch(epoch) {
      const r = await pub.readContract({ address, abi: settlementAbi, functionName: "epochs", args: [epoch] });
      const [root, totalLaneA, totalLaneB, treasuryAmount, feesBurned, mintedA, mintedB, postedAt, finalizedAt, status] = r;
      return { root, totalLaneA, totalLaneB, treasuryAmount, feesBurned, mintedA, mintedB, postedAt, finalizedAt, status: Number(status) as EpochStatus };
    },
    async getParams() {
      if (!params) {
        const [epochSeconds, vetoDelaySeconds, vestBSeconds, genesisEpoch] = await Promise.all([
          pub.readContract({ address, abi: settlementAbi, functionName: "epochSeconds" }),
          pub.readContract({ address, abi: settlementAbi, functionName: "vetoDelaySeconds" }),
          pub.readContract({ address, abi: settlementAbi, functionName: "vestBSeconds" }),
          pub.readContract({ address, abi: settlementAbi, functionName: "genesisEpoch" }),
        ]);
        params = { epochSeconds, vetoDelaySeconds, vestBSeconds, genesisEpoch };
      }
      return params;
    },
    async getEscrowAvailable() {
      const [total, pending] = await Promise.all([
        pub.readContract({ address, abi: settlementAbi, functionName: "totalEscrow" }),
        pub.readContract({ address, abi: settlementAbi, functionName: "pendingBurn" }),
      ]);
      return total - pending;
    },
    getAllowance: (epoch) => pub.readContract({ address, abi: settlementAbi, functionName: "allowance", args: [epoch] }),
    async getLaneFlags(epoch, accounts) {
      if (accounts.length === 0) return [];
      const contracts = accounts.map((a) => ({ address, abi: settlementAbi, functionName: "laneFlags" as const, args: [epoch, a] as const }));
      if (chain.contracts?.multicall3) {
        const res = await pub.multicall({ contracts, allowFailure: false });
        return res.map(Number);
      }
      const out: number[] = [];
      for (let i = 0; i < contracts.length; i += 25) {
        const part = await Promise.all(contracts.slice(i, i + 25).map((c) => pub.readContract(c)));
        out.push(...part.map(Number));
      }
      return out;
    },
    async now() {
      return (await pub.getBlock({ blockTag: "latest" })).timestamp;
    },
    getPosterBalance: () => pub.getBalance({ address: account.address }),
    async findPostTx(epoch) {
      try {
        const latest = await pub.getBlockNumber();
        const logs = await pub.getLogs({
          address,
          event: settlementAbi.find((x) => x.type === "event" && x.name === "EpochPosted") as any,
          args: { epoch },
          fromBlock: latest > LOG_LOOKBACK_BLOCKS ? latest - LOG_LOOKBACK_BLOCKS : 0n,
          toBlock: latest,
        });
        return logs.length ? (logs[logs.length - 1].transactionHash as Hex) : null;
      } catch {
        return null;
      }
    },
    postEpoch: (a) => write("postEpoch", [a.epoch, a.root, a.totalLaneA, a.totalLaneB, a.treasuryAmount, a.feesBurned]),
    finalize: (epoch) => write("finalize", [epoch]),
    claimFor: (epoch, entries) =>
      write("claimFor", [epoch, entries.map((e) => e.account), entries.map((e) => e.laneA), entries.map((e) => e.laneB), entries.map((e) => e.proof)]),
  };
}

export const ZERO_TX: Hex = zeroHash;
