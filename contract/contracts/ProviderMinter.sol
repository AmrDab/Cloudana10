// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./CLDToken.sol";
import "./ProviderRegistry.sol";

/**
 * @title ProviderMinter
 * @dev Mints CLD tokens to providers when they register a new server.
 *      Reward amount depends on hardware tier. Rewards halve every
 *      HALVING_INTERVAL claims (Bitcoin-style decay). One claim per device.
 */
contract ProviderMinter {
    enum NodeTier {
        CPU_ONLY,     // 0
        EDGE_RELAY,   // 1
        STORAGE,      // 2
        GPU_MID,      // 3
        GPU_HIGH      // 4
    }

    CLDToken public immutable cldToken;
    ProviderRegistry public immutable providerRegistry;

    uint256 public constant HALVING_INTERVAL = 10_000;

    // Base rewards per tier (in whole CLD, scaled to 18 decimals at mint time)
    mapping(NodeTier => uint256) public baseRewards;

    // Anti-sybil: one mint per device
    mapping(bytes32 => bool) public hasClaimed;

    // Track total claims for halving epoch
    uint256 public totalClaims;

    event RegistrationRewardClaimed(
        address indexed provider,
        bytes32 indexed deviceId,
        NodeTier tier,
        uint256 amount,
        uint256 epoch,
        uint256 totalClaimsAfter
    );

    error DeviceNotRegistered(bytes32 deviceId);
    error NotDeviceOwner(bytes32 deviceId, address caller);
    error AlreadyClaimed(bytes32 deviceId);
    error InvalidTier(uint8 tier);

    constructor(address _cldToken, address _providerRegistry) {
        cldToken = CLDToken(_cldToken);
        providerRegistry = ProviderRegistry(_providerRegistry);

        // Base rewards in whole CLD (scaled at mint)
        baseRewards[NodeTier.CPU_ONLY]   = 500;
        baseRewards[NodeTier.EDGE_RELAY] = 750;
        baseRewards[NodeTier.STORAGE]    = 1_000;
        baseRewards[NodeTier.GPU_MID]    = 2_000;
        baseRewards[NodeTier.GPU_HIGH]   = 5_000;
    }

    /**
     * @dev Claim the one-time registration reward for a device.
     * @param deviceId The bytes32 device identifier from ProviderRegistry.
     * @param tier The hardware tier of the device.
     */
    function claimRegistrationReward(bytes32 deviceId, NodeTier tier) external {
        // Verify device is registered
        if (!providerRegistry.isDeviceRegistered(deviceId)) {
            revert DeviceNotRegistered(deviceId);
        }

        // Verify caller owns the device
        address deviceOwner = providerRegistry.getDeviceOwner(deviceId);
        if (deviceOwner != msg.sender) {
            revert NotDeviceOwner(deviceId, msg.sender);
        }

        // Anti-sybil: one claim per device
        if (hasClaimed[deviceId]) {
            revert AlreadyClaimed(deviceId);
        }

        // Calculate reward with halving
        uint256 reward = _calculateReward(tier);

        // Mark as claimed and increment counter
        hasClaimed[deviceId] = true;
        totalClaims++;

        // Mint CLD to the provider
        cldToken.mint(msg.sender, reward);

        emit RegistrationRewardClaimed(
            msg.sender,
            deviceId,
            tier,
            reward,
            currentEpoch(),
            totalClaims
        );
    }

    /**
     * @dev Preview the current reward for a tier at the current epoch.
     * @param tier The hardware tier.
     * @return The reward amount in wei (18 decimals).
     */
    function previewReward(NodeTier tier) external view returns (uint256) {
        return _calculateReward(tier);
    }

    /**
     * @dev Current halving epoch (0-based).
     */
    function currentEpoch() public view returns (uint256) {
        return totalClaims / HALVING_INTERVAL;
    }

    /**
     * @dev Calculate reward with halving applied.
     *      Uses bit-shift for efficient halving: baseReward >> epoch.
     *      After epoch 20 (~200K claims), rewards are effectively 0.
     */
    function _calculateReward(NodeTier tier) internal view returns (uint256) {
        uint256 base = baseRewards[tier] * 10**18; // Scale to 18 decimals
        uint256 epoch = currentEpoch();

        // Cap epoch to prevent shifting to zero too aggressively
        if (epoch >= 20) return 0;

        return base >> epoch;
    }
}
