// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title StakingManager
 * @dev CLD token staking with tier-based access control and slashing.
 *
 * Tiers determine which workload types a provider can accept:
 *   Tier 1 (1,000 CLD)  — Standard workloads (web hosting, APIs, DBs)
 *   Tier 2 (10,000 CLD) — Optimistic workloads (data processing, transcoding)
 *   Tier 3 (50,000 CLD) — POUW-verified workloads (AI/ML, scientific compute)
 *
 * Economic security model: slashing cost must exceed fraud profit.
 * 50% slash on fraud + challenger reward creates strong deterrent.
 */
contract StakingManager is ReentrancyGuard, AccessControl {

    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant TIER1_MIN_STAKE = 1_000 ether;  // 1,000 CLD (post-MVP)
    uint256 public constant TIER2_MIN_STAKE = 10_000 ether; // 10,000 CLD (post-MVP)
    uint256 public constant TIER3_MIN_STAKE = 50_000 ether; // 50,000 CLD (post-MVP)

    uint256 public constant UNSTAKE_COOLDOWN = 7 days;

    /// @dev MVP mode: staking is optional, no minimum required. Disabled post-launch.
    bool public mvpMode = true;
    uint256 public constant SLASH_PERCENTAGE = 50;          // 50% of stake
    uint256 public constant CHALLENGER_REWARD_PCT = 25;     // 25% of slashed goes to challenger
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // ─── Storage ──────────────────────────────────────────────────────────────

    IERC20 public immutable cldToken;

    struct StakeInfo {
        uint256 amount;
        uint256 unstakeRequestedAt; // 0 if no pending unstake
        uint256 pendingUnstakeAmount;
        uint256 activeChallengeCnt;
        uint256 totalSlashed;
    }

    mapping(address => StakeInfo) public stakes;
    address[] public stakedProviders;
    mapping(address => bool) public isStaked;

    // ─── Events ───────────────────────────────────────────────────────────────

    event Staked(address indexed provider, uint256 amount, uint8 tier);
    event UnstakeRequested(address indexed provider, uint256 amount, uint256 unlockAt);
    event Unstaked(address indexed provider, uint256 amount);
    event Slashed(address indexed provider, uint256 slashAmount, address indexed challenger, uint256 challengerReward);
    event ChallengeCountUpdated(address indexed provider, uint256 count);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _cldToken) {
        cldToken = IERC20(_cldToken);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ─── Staking ──────────────────────────────────────────────────────────────

    /**
     * @notice Stake CLD tokens to register as a provider.
     * @param amount Amount of CLD to stake (must be >= TIER1_MIN_STAKE)
     */
    /// @notice Admin can disable MVP mode to enforce staking minimums
    function disableMvpMode() external onlyRole(DEFAULT_ADMIN_ROLE) {
        mvpMode = false;
    }

    function stake(uint256 amount) external nonReentrant {
        require(mvpMode || amount >= TIER1_MIN_STAKE, "StakingManager: below minimum stake");
        require(cldToken.transferFrom(msg.sender, address(this), amount), "StakingManager: transfer failed");

        stakes[msg.sender].amount += amount;

        if (!isStaked[msg.sender]) {
            isStaked[msg.sender] = true;
            stakedProviders.push(msg.sender);
        }

        emit Staked(msg.sender, amount, getTier(msg.sender));
    }

    /**
     * @notice Request to unstake CLD. Subject to 7-day cooldown.
     *         Cannot unstake while active challenges exist.
     * @param amount Amount to unstake
     */
    function requestUnstake(uint256 amount) external {
        StakeInfo storage s = stakes[msg.sender];
        require(s.amount >= amount, "StakingManager: insufficient stake");
        require(s.activeChallengeCnt == 0, "StakingManager: active challenges exist");
        require(s.unstakeRequestedAt == 0, "StakingManager: unstake already pending");

        s.unstakeRequestedAt = block.timestamp;
        s.pendingUnstakeAmount = amount;

        emit UnstakeRequested(msg.sender, amount, block.timestamp + UNSTAKE_COOLDOWN);
    }

    /**
     * @notice Complete unstake after cooldown period.
     */
    function unstake() external nonReentrant {
        StakeInfo storage s = stakes[msg.sender];
        require(s.unstakeRequestedAt > 0, "StakingManager: no pending unstake");
        require(block.timestamp >= s.unstakeRequestedAt + UNSTAKE_COOLDOWN, "StakingManager: cooldown not elapsed");
        require(s.activeChallengeCnt == 0, "StakingManager: active challenges exist");

        uint256 amount = s.pendingUnstakeAmount;
        s.amount -= amount;
        s.unstakeRequestedAt = 0;
        s.pendingUnstakeAmount = 0;

        require(cldToken.transfer(msg.sender, amount), "StakingManager: transfer failed");

        emit Unstaked(msg.sender, amount);
    }

    // ─── Slashing ─────────────────────────────────────────────────────────────

    /**
     * @notice Slash a provider's stake for fraud.
     *         25% of slashed amount goes to challenger, 75% burned.
     * @param provider   The fraudulent provider
     * @param amount     Amount to slash (capped at actual stake)
     * @param challenger Address that detected the fraud
     */
    function slash(
        address provider,
        uint256 amount,
        address challenger
    ) external onlyRole(SLASHER_ROLE) nonReentrant {
        StakeInfo storage s = stakes[provider];
        require(s.amount > 0, "StakingManager: no stake to slash");

        // Cap slash at actual stake
        uint256 slashAmount = amount > s.amount ? s.amount : amount;
        uint256 challengerReward = (slashAmount * CHALLENGER_REWARD_PCT) / 100;
        uint256 burnAmount = slashAmount - challengerReward;

        s.amount -= slashAmount;
        s.totalSlashed += slashAmount;

        // Transfer reward to challenger
        if (challenger != address(0) && challengerReward > 0) {
            require(cldToken.transfer(challenger, challengerReward), "StakingManager: reward transfer failed");
        }

        // Burn the rest
        if (burnAmount > 0) {
            require(cldToken.transfer(BURN_ADDRESS, burnAmount), "StakingManager: burn failed");
        }

        emit Slashed(provider, slashAmount, challenger, challengerReward);
    }

    // ─── Challenge Tracking ───────────────────────────────────────────────────

    function incrementChallengeCount(address provider) external onlyRole(SLASHER_ROLE) {
        stakes[provider].activeChallengeCnt++;
        emit ChallengeCountUpdated(provider, stakes[provider].activeChallengeCnt);
    }

    function decrementChallengeCount(address provider) external onlyRole(SLASHER_ROLE) {
        if (stakes[provider].activeChallengeCnt > 0) {
            stakes[provider].activeChallengeCnt--;
        }
        emit ChallengeCountUpdated(provider, stakes[provider].activeChallengeCnt);
    }

    // ─── View Functions ───────────────────────────────────────────────────────

    function getStake(address provider) external view returns (uint256) {
        return stakes[provider].amount;
    }

    /**
     * @notice Get the provider's tier based on stake amount.
     * @return tier 1, 2, or 3 (0 if not staked)
     */
    function getTier(address provider) public view returns (uint8) {
        // In MVP mode: everyone who registered gets Tier 1 regardless of stake
        if (mvpMode && isStaked[provider]) return 1;
        uint256 amount = stakes[provider].amount;
        if (amount >= TIER3_MIN_STAKE) return 3;
        if (amount >= TIER2_MIN_STAKE) return 2;
        if (amount >= TIER1_MIN_STAKE) return 1;
        return 0;
    }

    /**
     * @notice Revert if provider's stake is below the required tier.
     */
    function requireMinTier(address provider, uint8 tier) external view {
        require(getTier(provider) >= tier, "StakingManager: insufficient tier");
    }

    function getStakeInfo(address provider) external view returns (StakeInfo memory) {
        return stakes[provider];
    }

    function getAllStakedProviders() external view returns (address[] memory) {
        return stakedProviders;
    }
}
