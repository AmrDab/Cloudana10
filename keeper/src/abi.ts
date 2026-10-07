/** Subset of CloudanaSettlementV2's ABI used by the keeper (see contract/contracts/v2/CloudanaSettlementV2.sol). */
export const settlementAbi = [
  {
    type: "function", name: "epochs", stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "root", type: "bytes32" },
      { name: "totalLaneA", type: "uint256" },
      { name: "totalLaneB", type: "uint256" },
      { name: "treasuryAmount", type: "uint256" },
      { name: "feesBurned", type: "uint256" },
      { name: "mintedA", type: "uint256" },
      { name: "mintedB", type: "uint256" },
      { name: "postedAt", type: "uint64" },
      { name: "finalizedAt", type: "uint64" },
      { name: "status", type: "uint8" },
    ],
  },
  { type: "function", name: "laneFlags", stateMutability: "view", inputs: [{ name: "", type: "uint256" }, { name: "", type: "address" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "totalEscrow", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pendingBurn", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "epoch", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "epochSeconds", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "genesisEpoch", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "vetoDelaySeconds", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "vestBSeconds", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function", name: "postEpoch", stateMutability: "nonpayable",
    inputs: [
      { name: "epoch", type: "uint256" }, { name: "root", type: "bytes32" }, { name: "totalLaneA", type: "uint256" },
      { name: "totalLaneB", type: "uint256" }, { name: "treasuryAmount", type: "uint256" }, { name: "feesBurned", type: "uint256" },
    ],
    outputs: [],
  },
  { type: "function", name: "finalize", stateMutability: "nonpayable", inputs: [{ name: "epoch", type: "uint256" }], outputs: [] },
  {
    type: "function", name: "claimFor", stateMutability: "nonpayable",
    inputs: [
      { name: "epoch", type: "uint256" }, { name: "accounts", type: "address[]" }, { name: "laneAs", type: "uint256[]" },
      { name: "laneBs", type: "uint256[]" }, { name: "proofs", type: "bytes32[][]" },
    ],
    outputs: [],
  },
  {
    type: "event", name: "EpochPosted",
    inputs: [
      { name: "epoch", type: "uint256", indexed: true }, { name: "root", type: "bytes32", indexed: false },
      { name: "totalLaneA", type: "uint256", indexed: false }, { name: "totalLaneB", type: "uint256", indexed: false },
      { name: "treasuryAmount", type: "uint256", indexed: false }, { name: "feesBurned", type: "uint256", indexed: false },
    ],
  },
  { type: "error", name: "AlreadyPosted", inputs: [{ name: "epoch", type: "uint256" }] },
  { type: "error", name: "TreasuryBelowMin", inputs: [{ name: "treasuryAmount", type: "uint256" }, { name: "feesBurned", type: "uint256" }] },
  { type: "error", name: "LaneAExceedsFees", inputs: [{ name: "laneAPlusTreasury", type: "uint256" }, { name: "feesBurned", type: "uint256" }] },
  { type: "error", name: "LaneBExceedsAllowance", inputs: [{ name: "totalLaneB", type: "uint256" }, { name: "allowance", type: "uint256" }] },
  { type: "error", name: "FeesExceedEscrow", inputs: [{ name: "feesBurned", type: "uint256" }, { name: "available", type: "uint256" }] },
  { type: "error", name: "NotPosted", inputs: [{ name: "epoch", type: "uint256" }] },
  { type: "error", name: "VetoWindowOpen", inputs: [{ name: "epoch", type: "uint256" }] },
  { type: "error", name: "NotFinalized", inputs: [{ name: "epoch", type: "uint256" }] },
  { type: "error", name: "InvalidProof", inputs: [{ name: "epoch", type: "uint256" }, { name: "account", type: "address" }] },
  { type: "error", name: "NothingToClaim", inputs: [{ name: "epoch", type: "uint256" }, { name: "account", type: "address" }] },
  { type: "error", name: "MintCapExceeded", inputs: [{ name: "epoch", type: "uint256" }] },
  { type: "error", name: "EpochNotElapsed", inputs: [{ name: "epoch", type: "uint256" }, { name: "endsAt", type: "uint256" }] },
  { type: "error", name: "EpochBeforeGenesis", inputs: [{ name: "epoch", type: "uint256" }, { name: "genesisEpoch", type: "uint256" }] },
] as const;

export const FLAG_A_CLAIMED = 1;
export const FLAG_B_CLAIMED = 2;
export const FLAG_B_VOID = 4;

export enum EpochStatus { None = 0, Posted = 1, Vetoed = 2, Finalized = 3 }
