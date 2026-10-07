// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface ICLDV2 is IERC20 {
    function mint(address to, uint256 amount) external;
    function burn(uint256 amount) external;
}

/**
 * @title CloudanaSettlementV2
 * @notice Per-epoch settlement (IMPL_SPEC_2026-10 "Settlement contract v2").
 *         Escrowed user fees are burned at finalize; the treasury share is minted at finalize to the immutable
 *         `treasury`; providers are lazily minted from a lane-aware Merkle root:
 *           leaf = keccak256(bytes.concat(keccak256(abi.encode(epoch, account, laneA, laneB))))
 *         Lane A (fee-backed) is claimable after finalize; lane B (subsidy) after `finalizedAt + vestBSeconds`,
 *         unless the guardian clawed it before the vest. Post-time invariants:
 *           treasuryAmount >= 3% of feesBurned; totalLaneA + treasuryAmount <= 98% of feesBurned;
 *           totalLaneB <= allowance(epoch) (8%/yr of supply, x0.85 per year, 1.5% floor); feesBurned <= free escrow.
 */
contract CloudanaSettlementV2 is AccessControl, ReentrancyGuard {
    using SafeERC20 for ICLDV2;

    bytes32 public constant POSTER_ROLE = keccak256("POSTER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    // Emission schedule (unchanged from v1 / EmissionController.sol).
    uint256 public constant INITIAL_RATE_BPS = 800;
    uint256 public constant TERMINAL_RATE_BPS = 150;
    uint256 public constant DECAY_NUM = 85;
    uint256 public constant DECAY_DEN = 100;
    uint256 public constant YEAR = 365 days;
    // Fee-split enforcement.
    uint256 public constant LANE_A_MAX_BPS = 9800;
    uint256 public constant TREASURY_MIN_BPS = 300;

    // Per (epoch, account) lane flags.
    uint8 public constant FLAG_A_CLAIMED = 1;
    uint8 public constant FLAG_B_CLAIMED = 2;
    uint8 public constant FLAG_B_VOID = 4;

    enum Status { None, Posted, Vetoed, Finalized }

    struct Epoch {
        bytes32 root;
        uint256 totalLaneA;
        uint256 totalLaneB;
        uint256 treasuryAmount;
        uint256 feesBurned;
        uint256 mintedA;
        uint256 mintedB;
        uint64 postedAt;
        uint64 finalizedAt;
        Status status;
    }

    ICLDV2 public immutable cld;
    address public immutable treasury;
    uint256 public immutable epochSeconds;
    uint256 public immutable vetoDelaySeconds;
    uint256 public immutable vestBSeconds;
    uint256 public immutable genesisTimestamp;
    /// @notice First postable epoch: the epoch containing genesisTimestamp.
    uint256 public immutable genesisEpoch;

    /// @notice Informational per-user deposits (pooled escrow; not decremented on burn).
    mapping(address => uint256) public escrowOf;
    /// @notice CLD held by this contract that is not yet burned.
    uint256 public totalEscrow;
    /// @notice Fees committed by posted-but-not-finalized epochs.
    uint256 public pendingBurn;

    mapping(uint256 => Epoch) public epochs;
    /// @notice epoch => account => FLAG_* bitmask.
    mapping(uint256 => mapping(address => uint8)) public laneFlags;
    /// @notice Lane-B committed by live (posted or finalized) epochs; released on veto.
    uint256 public totalSubsidyCommitted;
    /// @notice Lane-B committed per schedule year (year of the epoch's start); capped by annualSubsidyCap.
    mapping(uint256 => uint256) public subsidyByYear;

    event Deposited(address indexed from, address indexed user, uint256 amount);
    event EpochPosted(
        uint256 indexed epoch, bytes32 root, uint256 totalLaneA, uint256 totalLaneB, uint256 treasuryAmount, uint256 feesBurned
    );
    event EpochVetoed(uint256 indexed epoch, address guardian);
    event EpochFinalized(uint256 indexed epoch, uint256 feesBurned, uint256 treasuryAmount);
    /// @notice Amounts minted by this claim (a lane already claimed, not yet vested, or void contributes 0).
    event Claimed(uint256 indexed epoch, address indexed account, uint256 laneA, uint256 laneB);
    event LaneBClawed(uint256 indexed epoch, address indexed account, uint256 laneB, address guardian);

    error AlreadyPosted(uint256 epoch);
    error TreasuryBelowMin(uint256 treasuryAmount, uint256 feesBurned);
    error LaneAExceedsFees(uint256 laneAPlusTreasury, uint256 feesBurned);
    error LaneBExceedsAllowance(uint256 totalLaneB, uint256 allowance);
    error FeesExceedEscrow(uint256 feesBurned, uint256 available);
    error NotPosted(uint256 epoch);
    error VetoWindowClosed(uint256 epoch);
    error VetoWindowOpen(uint256 epoch);
    error NotFinalized(uint256 epoch);
    error InvalidProof(uint256 epoch, address account);
    error NothingToClaim(uint256 epoch, address account);
    error MintCapExceeded(uint256 epoch);
    error LaneBVested(uint256 epoch);
    error LaneBAlreadySettled(uint256 epoch, address account);
    error LengthMismatch();
    error ZeroAmount();
    error ZeroAddress();
    error EpochBeforeGenesis(uint256 epoch, uint256 genesisEpoch);
    error EpochNotElapsed(uint256 epoch, uint256 endsAt);

    constructor(
        address _cld,
        address _treasury,
        address admin,
        address poster,
        address guardian,
        uint256 _epochSeconds,
        uint256 _vetoDelaySeconds,
        uint256 _vestBSeconds,
        uint256 _genesisTimestamp
    ) {
        require(_epochSeconds > 0, "epochSeconds=0");
        if (_cld == address(0) || _treasury == address(0) || admin == address(0)) revert ZeroAddress();
        cld = ICLDV2(_cld);
        treasury = _treasury;
        epochSeconds = _epochSeconds;
        vetoDelaySeconds = _vetoDelaySeconds;
        vestBSeconds = _vestBSeconds;
        genesisTimestamp = _genesisTimestamp;
        genesisEpoch = _genesisTimestamp / _epochSeconds;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(POSTER_ROLE, poster);
        _grantRole(GUARDIAN_ROLE, guardian);
    }

    // ---- Escrow (pooled; per-user withdrawal is a mainnet item) ----

    /// @notice Escrow CLD backing the caller's credits.
    function deposit(uint256 amount) external {
        depositFor(msg.sender, amount);
    }

    /// @notice Escrow CLD (pulled from the caller) backing `user`'s credits.
    function depositFor(address user, uint256 amount) public nonReentrant {
        if (amount == 0) revert ZeroAmount();
        escrowOf[user] += amount;
        totalEscrow += amount;
        cld.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, user, amount);
    }

    // ---- Schedule ----

    /// @notice Annual rate (bps) at timestamp `t`: 8%, x0.85 per full year since genesis, 1.5% floor.
    function rateBpsAt(uint256 t) public view returns (uint256) {
        uint256 yearsElapsed = t > genesisTimestamp ? (t - genesisTimestamp) / YEAR : 0;
        uint256 rate = INITIAL_RATE_BPS;
        for (uint256 i = 0; i < yearsElapsed; i++) {
            rate = (rate * DECAY_NUM) / DECAY_DEN;
            if (rate <= TERMINAL_RATE_BPS) return TERMINAL_RATE_BPS;
        }
        return rate;
    }

    /// @notice Schedule year of `epoch` (by its start), as counted by rateBpsAt.
    function yearOf(uint256 epoch) public view returns (uint256) {
        uint256 t = epoch * epochSeconds;
        return t > genesisTimestamp ? (t - genesisTimestamp) / YEAR : 0;
    }

    /// @notice The schedule's annual lane-B total for `epoch`'s year, at current supply.
    function annualSubsidyCap(uint256 epoch) public view returns (uint256) {
        return (cld.totalSupply() * rateBpsAt(epoch * epochSeconds)) / 10_000;
    }

    /// @notice Lane-B cap for `epoch`: its pro-rata share of the annual total, limited to what is left of its year.
    function allowance(uint256 epoch) public view returns (uint256) {
        uint256 annual = annualSubsidyCap(epoch);
        uint256 perEpoch = (annual * epochSeconds) / YEAR;
        uint256 used = subsidyByYear[yearOf(epoch)];
        uint256 left = annual > used ? annual - used : 0;
        return perEpoch < left ? perEpoch : left;
    }

    // ---- Epoch lifecycle ----

    /// @notice Post a fully elapsed epoch (genesisEpoch onward). A vetoed epoch may be re-posted with a corrected root.
    function postEpoch(
        uint256 epoch,
        bytes32 root,
        uint256 totalLaneA,
        uint256 totalLaneB,
        uint256 treasuryAmount,
        uint256 feesBurned
    ) external onlyRole(POSTER_ROLE) {
        Epoch storage e = epochs[epoch];
        if (e.status != Status.None && e.status != Status.Vetoed) revert AlreadyPosted(epoch);
        if (epoch < genesisEpoch) revert EpochBeforeGenesis(epoch, genesisEpoch);
        uint256 endsAt = (epoch + 1) * epochSeconds;
        if (endsAt > block.timestamp) revert EpochNotElapsed(epoch, endsAt);
        if (treasuryAmount * 10_000 < feesBurned * TREASURY_MIN_BPS) revert TreasuryBelowMin(treasuryAmount, feesBurned);
        if ((totalLaneA + treasuryAmount) * 10_000 > feesBurned * LANE_A_MAX_BPS) {
            revert LaneAExceedsFees(totalLaneA + treasuryAmount, feesBurned);
        }
        uint256 cap = allowance(epoch);
        if (totalLaneB > cap) revert LaneBExceedsAllowance(totalLaneB, cap);
        uint256 available = totalEscrow - pendingBurn;
        if (feesBurned > available) revert FeesExceedEscrow(feesBurned, available);

        pendingBurn += feesBurned;
        subsidyByYear[yearOf(epoch)] += totalLaneB;
        totalSubsidyCommitted += totalLaneB;
        e.root = root;
        e.totalLaneA = totalLaneA;
        e.totalLaneB = totalLaneB;
        e.treasuryAmount = treasuryAmount;
        e.feesBurned = feesBurned;
        e.postedAt = uint64(block.timestamp);
        e.status = Status.Posted;
        emit EpochPosted(epoch, root, totalLaneA, totalLaneB, treasuryAmount, feesBurned);
    }

    /// @notice Guardian cancels a posted epoch within the veto window; its commitments are released.
    function veto(uint256 epoch) external onlyRole(GUARDIAN_ROLE) {
        Epoch storage e = epochs[epoch];
        if (e.status != Status.Posted) revert NotPosted(epoch);
        if (block.timestamp >= e.postedAt + vetoDelaySeconds) revert VetoWindowClosed(epoch);
        pendingBurn -= e.feesBurned;
        subsidyByYear[yearOf(epoch)] -= e.totalLaneB;
        totalSubsidyCommitted -= e.totalLaneB;
        e.status = Status.Vetoed;
        emit EpochVetoed(epoch, msg.sender);
    }

    /// @notice Anyone, after the veto window: burn the epoch's fees, mint the treasury share, open lane-A claims.
    function finalize(uint256 epoch) external nonReentrant {
        Epoch storage e = epochs[epoch];
        if (e.status != Status.Posted) revert NotPosted(epoch);
        if (block.timestamp < e.postedAt + vetoDelaySeconds) revert VetoWindowOpen(epoch);
        uint256 fees = e.feesBurned;
        uint256 toTreasury = e.treasuryAmount;
        pendingBurn -= fees;
        totalEscrow -= fees;
        e.finalizedAt = uint64(block.timestamp);
        e.status = Status.Finalized;
        if (fees > 0) cld.burn(fees);
        if (toTreasury > 0) cld.mint(treasury, toTreasury);
        emit EpochFinalized(epoch, fees, toTreasury);
    }

    /// @notice Timestamp from which `epoch`'s lane B is claimable (0 if not finalized).
    function laneBVestsAt(uint256 epoch) public view returns (uint256) {
        uint64 f = epochs[epoch].finalizedAt;
        return f == 0 ? 0 : uint256(f) + vestBSeconds;
    }

    // ---- Claims (lazy mint) ----

    /// @notice OZ StandardMerkleTree leaf for (epoch, account, laneA, laneB).
    function leafOf(uint256 epoch, address account, uint256 laneA, uint256 laneB) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(epoch, account, laneA, laneB))));
    }

    /// @notice Mint what is currently claimable for `account` in `epoch` (lane A after finalize, lane B after vest).
    ///         Reverts if neither lane is claimable right now.
    function claim(uint256 epoch, address account, uint256 laneA, uint256 laneB, bytes32[] calldata proof)
        external
        nonReentrant
    {
        _claim(epoch, account, laneA, laneB, proof);
    }

    /// @notice Batch claim on behalf of many accounts (keeper). Every entry must have something claimable.
    function claimFor(
        uint256 epoch,
        address[] calldata accounts,
        uint256[] calldata laneAs,
        uint256[] calldata laneBs,
        bytes32[][] calldata proofs
    ) external nonReentrant {
        uint256 n = accounts.length;
        if (n != laneAs.length || n != laneBs.length || n != proofs.length) revert LengthMismatch();
        for (uint256 i = 0; i < n; i++) {
            _claim(epoch, accounts[i], laneAs[i], laneBs[i], proofs[i]);
        }
    }

    /// @notice Guardian voids `account`'s lane B for a finalized epoch before it vests. Never minted afterwards.
    function clawLaneB(uint256 epoch, address account, uint256 laneA, uint256 laneB, bytes32[] calldata proof)
        external
        onlyRole(GUARDIAN_ROLE)
    {
        Epoch storage e = epochs[epoch];
        if (e.status != Status.Finalized) revert NotFinalized(epoch);
        if (block.timestamp >= uint256(e.finalizedAt) + vestBSeconds) revert LaneBVested(epoch);
        if (!MerkleProof.verifyCalldata(proof, e.root, leafOf(epoch, account, laneA, laneB))) {
            revert InvalidProof(epoch, account);
        }
        uint8 flags = laneFlags[epoch][account];
        if (flags & (FLAG_B_CLAIMED | FLAG_B_VOID) != 0) revert LaneBAlreadySettled(epoch, account);
        laneFlags[epoch][account] = flags | FLAG_B_VOID;
        emit LaneBClawed(epoch, account, laneB, msg.sender);
    }

    function _claim(uint256 epoch, address account, uint256 laneA, uint256 laneB, bytes32[] calldata proof) internal {
        Epoch storage e = epochs[epoch];
        if (e.status != Status.Finalized) revert NotFinalized(epoch);
        if (!MerkleProof.verifyCalldata(proof, e.root, leafOf(epoch, account, laneA, laneB))) {
            revert InvalidProof(epoch, account);
        }
        uint8 flags = laneFlags[epoch][account];
        uint256 payA = 0;
        uint256 payB = 0;
        if (laneA > 0 && flags & FLAG_A_CLAIMED == 0) {
            payA = laneA;
            flags |= FLAG_A_CLAIMED;
        }
        if (
            laneB > 0 && flags & (FLAG_B_CLAIMED | FLAG_B_VOID) == 0
                && block.timestamp >= uint256(e.finalizedAt) + vestBSeconds
        ) {
            payB = laneB;
            flags |= FLAG_B_CLAIMED;
        }
        if (payA == 0 && payB == 0) revert NothingToClaim(epoch, account);
        laneFlags[epoch][account] = flags;
        if (payA > 0) {
            e.mintedA += payA;
            if (e.mintedA > e.totalLaneA) revert MintCapExceeded(epoch);
        }
        if (payB > 0) {
            e.mintedB += payB;
            if (e.mintedB > e.totalLaneB) revert MintCapExceeded(epoch);
        }
        cld.mint(account, payA + payB);
        emit Claimed(epoch, account, payA, payB);
    }
}
