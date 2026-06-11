// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ICLDMintable {
    function mint(address to, uint256 amount) external;
    function totalSupply() external view returns (uint256);
}

/**
 * @title EmissionController
 * @notice Cloudana CLD emission envelope. Solana-style, NOT Bitcoin-style.
 *
 * DESIGN RATIONALE (Tokenomics v2):
 *   The old model (ProviderMinter halving to ZERO by epoch 20) had a fatal flaw:
 *   when emission stops, providers have no reason to keep powering the network.
 *   A pure hard cap kills a USEFUL-WORK chain because the work must keep happening.
 *
 *   Instead we use a DISINFLATIONARY schedule with a permanent TAIL:
 *     - Annual inflation starts at INITIAL_RATE_BPS (e.g. 8.00%)
 *     - Decays by DECAY_NUM/DECAY_DEN per year (e.g. 15%/yr) ...
 *     - ... but NEVER below TERMINAL_RATE_BPS (e.g. 1.50%).
 *   The tail guarantees providers are always paid to keep the network alive.
 *
 *   There is NO hard cap. The effective supply ceiling ("soft cap") is set by the
 *   market: equilibrium is reached where annual emission == annual burn (see
 *   RewardContract fee burn). High real usage => net deflationary. Low usage =>
 *   mild tail inflation keeps the lights on. The network self-regulates.
 *
 * THIS CONTRACT controls the macro envelope only. It mints a per-epoch budget into
 * the reward pool; per-certificate distribution stays in RewardContract /
 * ChallengeManager. By holding the ONLY active MINTER_ROLE, it makes total emission
 * provably bounded by the schedule — closing the "unbounded mint authority" finding.
 */
contract EmissionController is AccessControl, ReentrancyGuard {
    bytes32 public constant SCHEDULER_ROLE = keccak256("SCHEDULER_ROLE");

    ICLDMintable public immutable cld;
    address public rewardPool; // where minted mining emission is sent

    // ─── Schedule parameters (immutable for predictability) ──────────────────
    uint256 public constant INITIAL_RATE_BPS  = 800;   // 8.00% annual at genesis
    uint256 public constant TERMINAL_RATE_BPS = 150;   // 1.50% permanent tail floor
    uint256 public constant DECAY_NUM = 85;            // multiply rate by 85/100 each year
    uint256 public constant DECAY_DEN = 100;
    uint256 public constant YEAR = 365 days;
    uint256 public constant EPOCH = 1 days;            // emission cadence

    uint256 public immutable genesis;
    uint256 public lastEmissionAt;
    uint256 public totalEmitted;

    event EmissionMinted(uint256 indexed epochIndex, uint256 amount, uint256 rateBps, uint256 supplyBefore);
    event RewardPoolUpdated(address indexed newPool);

    constructor(address _cld, address _rewardPool) {
        require(_cld != address(0) && _rewardPool != address(0), "zero addr");
        cld = ICLDMintable(_cld);
        rewardPool = _rewardPool;
        genesis = block.timestamp;
        lastEmissionAt = block.timestamp;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SCHEDULER_ROLE, msg.sender);
    }

    /**
     * @notice Current annualized inflation rate in basis points, per the
     *         disinflationary-with-floor schedule. Pure integer math.
     */
    function currentRateBps() public view returns (uint256) {
        uint256 yearsElapsed = (block.timestamp - genesis) / YEAR;
        uint256 rate = INITIAL_RATE_BPS;
        for (uint256 i = 0; i < yearsElapsed; i++) {
            rate = (rate * DECAY_NUM) / DECAY_DEN;
            if (rate <= TERMINAL_RATE_BPS) return TERMINAL_RATE_BPS;
        }
        return rate < TERMINAL_RATE_BPS ? TERMINAL_RATE_BPS : rate;
    }

    /**
     * @notice The emission budget claimable for the elapsed (whole) epochs.
     *         budget = supply * rateBps/10000 * (epochsElapsed * EPOCH / YEAR)
     */
    function pendingEmission() public view returns (uint256 amount, uint256 epochsElapsed) {
        epochsElapsed = (block.timestamp - lastEmissionAt) / EPOCH;
        if (epochsElapsed == 0) return (0, 0);
        uint256 supply = cld.totalSupply();
        uint256 rateBps = currentRateBps();
        // annualEmission = supply * rateBps / 10000 ; pro-rate by epochs
        uint256 annual = (supply * rateBps) / 10_000;
        amount = (annual * (epochsElapsed * EPOCH)) / YEAR;
    }

    /**
     * @notice Mint the pending emission budget into the reward pool. Permissionless
     *         to call (anyone can advance emission), but amount is fully determined
     *         by the schedule — no caller discretion, no unbounded mint.
     */
    function emit_() external nonReentrant {
        (uint256 amount, uint256 epochsElapsed) = pendingEmission();
        require(epochsElapsed > 0, "no epoch elapsed");
        if (amount == 0) {
            lastEmissionAt += epochsElapsed * EPOCH;
            return;
        }
        uint256 supplyBefore = cld.totalSupply();
        lastEmissionAt += epochsElapsed * EPOCH;
        totalEmitted += amount;
        cld.mint(rewardPool, amount);
        emit EmissionMinted(
            (block.timestamp - genesis) / EPOCH,
            amount,
            currentRateBps(),
            supplyBefore
        );
    }

    function setRewardPool(address _pool) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_pool != address(0), "zero addr");
        rewardPool = _pool;
        emit RewardPoolUpdated(_pool);
    }
}
