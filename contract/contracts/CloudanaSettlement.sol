// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface ICLD is IERC20 {
    function mint(address to, uint256 amount) external;
    function burn(uint256 amount) external;
}

/**
 * @title CloudanaSettlement
 * @notice Per-epoch settlement: escrowed user fees are burned, providers are lazily
 *         minted from a Merkle root. Lane A (fee-backed) <= 98% of fees burned;
 *         lane B (subsidy) <= the emission schedule. The only minter on CLDToken.
 */
contract CloudanaSettlement is AccessControl, ReentrancyGuard {
    using SafeERC20 for ICLD;

    bytes32 public constant POSTER_ROLE = keccak256("POSTER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    // Schedule constants mirror EmissionController.sol.
    uint256 public constant INITIAL_RATE_BPS = 800;
    uint256 public constant TERMINAL_RATE_BPS = 150;
    uint256 public constant DECAY_NUM = 85;
    uint256 public constant DECAY_DEN = 100;
    uint256 public constant YEAR = 365 days;
    uint256 public constant LANE_A_MAX_BPS = 9800;

    enum Status { None, Posted, Vetoed, Finalized }

    struct Epoch {
        bytes32 root;
        uint256 mintA;
        uint256 mintB;
        uint256 feesBurned;
        uint256 minted;
        uint64 postedAt;
        Status status;
    }

    ICLD public immutable cld;
    uint256 public immutable epochSeconds;
    uint256 public immutable vetoDelaySeconds;
    uint256 public immutable genesisTimestamp;
    /// @notice First postable epoch: the epoch containing genesisTimestamp.
    uint256 public immutable genesisEpoch;

    /// @notice Informational per-user deposits (not decremented on burn).
    mapping(address => uint256) public escrowOf;
    /// @notice CLD held by this contract that is not yet burned.
    uint256 public totalEscrow;
    /// @notice Fees committed by posted-but-not-finalized epochs.
    uint256 public pendingBurn;

    mapping(uint256 => Epoch) public epochs;
    /// @notice Leaf hash => claimed (the leaf includes the epoch).
    mapping(bytes32 => bool) public claimed;
    /// @notice Lane-B committed by live (posted or finalized) epochs; minted lazily on claim, released on veto.
    uint256 public totalSubsidyMinted;
    /// @notice Lane-B committed per schedule year (year of the epoch's start); capped by annualSubsidyCap.
    mapping(uint256 => uint256) public subsidyByYear;

    event Deposited(address indexed from, address indexed user, uint256 amount);
    event EpochPosted(uint256 indexed epoch, bytes32 root, uint256 mintA, uint256 mintB, uint256 feesBurned);
    event EpochVetoed(uint256 indexed epoch, address guardian);
    event EpochFinalized(uint256 indexed epoch, uint256 feesBurned);
    event Claimed(uint256 indexed epoch, address indexed account, uint256 amount);

    error AlreadyPosted(uint256 epoch);
    error LaneAExceedsFees(uint256 mintA, uint256 feesBurned);
    error LaneBExceedsAllowance(uint256 mintB, uint256 allowance);
    error FeesExceedEscrow(uint256 feesBurned, uint256 available);
    error NotPosted(uint256 epoch);
    error VetoWindowClosed(uint256 epoch);
    error VetoWindowOpen(uint256 epoch);
    error NotFinalized(uint256 epoch);
    error AlreadyClaimed(uint256 epoch, address account);
    error InvalidProof(uint256 epoch, address account);
    error MintCapExceeded(uint256 epoch);
    error LengthMismatch();
    error ZeroAmount();
    error EpochBeforeGenesis(uint256 epoch, uint256 genesisEpoch);
    error EpochNotElapsed(uint256 epoch, uint256 endsAt);

    constructor(
        address _cld,
        address admin,
        address poster,
        address guardian,
        uint256 _epochSeconds,
        uint256 _vetoDelaySeconds,
        uint256 _genesisTimestamp
    ) {
        require(_epochSeconds > 0, "epochSeconds=0");
        cld = ICLD(_cld);
        epochSeconds = _epochSeconds;
        vetoDelaySeconds = _vetoDelaySeconds;
        genesisTimestamp = _genesisTimestamp;
        genesisEpoch = _genesisTimestamp / _epochSeconds;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(POSTER_ROLE, poster);
        _grantRole(GUARDIAN_ROLE, guardian);
    }

    // ---- Escrow ----

    /// @notice Escrow CLD backing the caller's credits.
    function deposit(uint256 amount) external {
        depositFor(msg.sender, amount);
    }

    /// @notice Escrow CLD (pulled from the caller) backing `user`'s credits.
    function depositFor(address user, uint256 amount) public nonReentrant {
        if (amount == 0) revert ZeroAmount();
        cld.safeTransferFrom(msg.sender, address(this), amount);
        escrowOf[user] += amount;
        totalEscrow += amount;
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

    /// @notice Lane-B cap for `epoch` (epoch start = epoch * epochSeconds), at current supply:
    ///         the epoch's pro-rata share of the annual total, limited to what is left of its year's total.
    function allowance(uint256 epoch) public view returns (uint256) {
        uint256 annual = annualSubsidyCap(epoch);
        uint256 perEpoch = (annual * epochSeconds) / YEAR;
        uint256 used = subsidyByYear[yearOf(epoch)];
        uint256 left = annual > used ? annual - used : 0;
        return perEpoch < left ? perEpoch : left;
    }

    // ---- Epoch lifecycle ----

    /// @notice Post a fully elapsed epoch's reward root (genesisEpoch onward). One live post per epoch; a vetoed
    ///         epoch may be re-posted with a corrected root (it was never finalized, so nothing was burned or claimed).
    function postEpoch(uint256 epoch, bytes32 root, uint256 mintA, uint256 mintB, uint256 feesBurned)
        external
        onlyRole(POSTER_ROLE)
    {
        Epoch storage e = epochs[epoch];
        if (e.status != Status.None && e.status != Status.Vetoed) revert AlreadyPosted(epoch);
        if (epoch < genesisEpoch) revert EpochBeforeGenesis(epoch, genesisEpoch);
        uint256 endsAt = (epoch + 1) * epochSeconds;
        if (endsAt > block.timestamp) revert EpochNotElapsed(epoch, endsAt);
        if (mintA * 10_000 > feesBurned * LANE_A_MAX_BPS) revert LaneAExceedsFees(mintA, feesBurned);
        uint256 cap = allowance(epoch);
        if (mintB > cap) revert LaneBExceedsAllowance(mintB, cap);
        uint256 available = totalEscrow - pendingBurn;
        if (feesBurned > available) revert FeesExceedEscrow(feesBurned, available);

        pendingBurn += feesBurned;
        subsidyByYear[yearOf(epoch)] += mintB;
        totalSubsidyMinted += mintB;
        e.root = root;
        e.mintA = mintA;
        e.mintB = mintB;
        e.feesBurned = feesBurned;
        e.postedAt = uint64(block.timestamp);
        e.status = Status.Posted;
        emit EpochPosted(epoch, root, mintA, mintB, feesBurned);
    }

    /// @notice Guardian cancels a posted epoch within the veto window.
    function veto(uint256 epoch) external onlyRole(GUARDIAN_ROLE) {
        Epoch storage e = epochs[epoch];
        if (e.status != Status.Posted) revert NotPosted(epoch);
        if (block.timestamp >= e.postedAt + vetoDelaySeconds) revert VetoWindowClosed(epoch);
        pendingBurn -= e.feesBurned;
        subsidyByYear[yearOf(epoch)] -= e.mintB;
        totalSubsidyMinted -= e.mintB;
        e.status = Status.Vetoed;
        emit EpochVetoed(epoch, msg.sender);
    }

    /// @notice Anyone, after the veto window: burn the epoch's fees and open claims.
    function finalize(uint256 epoch) external nonReentrant {
        Epoch storage e = epochs[epoch];
        if (e.status != Status.Posted) revert NotPosted(epoch);
        if (block.timestamp < e.postedAt + vetoDelaySeconds) revert VetoWindowOpen(epoch);
        uint256 fees = e.feesBurned;
        pendingBurn -= fees;
        totalEscrow -= fees;
        e.status = Status.Finalized;
        if (fees > 0) cld.burn(fees);
        emit EpochFinalized(epoch, fees);
    }

    // ---- Claims (lazy mint) ----

    /// @notice Mint `amount` to `account` for `epoch` against the posted root. Once per leaf.
    function claim(uint256 epoch, address account, uint256 amount, bytes32[] calldata proof) external nonReentrant {
        _claim(epoch, account, amount, proof);
    }

    /// @notice Batch claim on behalf of many accounts (keeper).
    function claimFor(
        uint256 epoch,
        address[] calldata accounts,
        uint256[] calldata amounts,
        bytes32[][] calldata proofs
    ) external nonReentrant {
        if (accounts.length != amounts.length || accounts.length != proofs.length) revert LengthMismatch();
        for (uint256 i = 0; i < accounts.length; i++) {
            _claim(epoch, accounts[i], amounts[i], proofs[i]);
        }
    }

    /// @notice OZ StandardMerkleTree leaf for (epoch, account, amount).
    function leafOf(uint256 epoch, address account, uint256 amount) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(epoch, account, amount))));
    }

    function _claim(uint256 epoch, address account, uint256 amount, bytes32[] calldata proof) internal {
        Epoch storage e = epochs[epoch];
        if (e.status != Status.Finalized) revert NotFinalized(epoch);
        bytes32 leaf = leafOf(epoch, account, amount);
        if (claimed[leaf]) revert AlreadyClaimed(epoch, account);
        if (!MerkleProof.verifyCalldata(proof, e.root, leaf)) revert InvalidProof(epoch, account);
        claimed[leaf] = true;
        e.minted += amount;
        if (e.minted > e.mintA + e.mintB) revert MintCapExceeded(epoch);
        cld.mint(account, amount);
        emit Claimed(epoch, account, amount);
    }
}
