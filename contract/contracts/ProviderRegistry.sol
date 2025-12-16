// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Config.sol";

/**
 * @title ProviderRegistry
 * @dev Registry for providers with deposit requirement
 */
contract ProviderRegistry is AccessControl, ReentrancyGuard {
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    
    Config public immutable config;
    
    struct Provider {
        address providerAddress;
        uint256 depositAmount;
        uint256 registeredAt;
        bool isActive;
        bool autoRewardEnabled; // If true, provider has deposited gas for auto-rewards
        uint256 autoRewardGasDeposit; // Gas deposit for auto-rewards
    }
    
    mapping(address => Provider) public providers;
    address[] public providerList;
    
    // Provider rewards tracking (off-chain calculated, on-chain claimed)
    mapping(address => uint256) public pendingRewards; // Epoch-based rewards
    mapping(address => uint256) public jobRewards; // Job completion rewards
    
    event ProviderRegistered(address indexed provider, uint256 depositAmount);
    event ProviderDeposited(address indexed provider, uint256 amount);
    event ProviderWithdrawn(address indexed provider, uint256 amount);
    event ProviderDeactivated(address indexed provider);
    event AutoRewardEnabled(address indexed provider, uint256 gasDeposit);
    event AutoRewardDisabled(address indexed provider);
    event RewardAdded(address indexed provider, uint256 epochReward, uint256 jobReward);
    event RewardClaimed(address indexed provider, uint256 amount);
    
    constructor(address _config) {
        require(_config != address(0), "ProviderRegistry: Invalid config");
        config = Config(_config);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VALIDATOR_ROLE, msg.sender);
    }
    
    /**
     * @dev Register as provider with deposit
     */
    function register() external payable nonReentrant {
        require(!providers[msg.sender].isActive, "ProviderRegistry: Already registered");
        
        uint256 requiredDeposit = config.providerDepositAmount();
        require(msg.value >= requiredDeposit, "ProviderRegistry: Insufficient deposit");
        
        providers[msg.sender] = Provider({
            providerAddress: msg.sender,
            depositAmount: requiredDeposit,
            registeredAt: block.timestamp,
            isActive: true,
            autoRewardEnabled: false,
            autoRewardGasDeposit: 0
        });
        
        providerList.push(msg.sender);
        
        // Refund excess if any
        if (msg.value > requiredDeposit) {
            payable(msg.sender).transfer(msg.value - requiredDeposit);
        }
        
        emit ProviderRegistered(msg.sender, requiredDeposit);
    }
    
    /**
     * @dev Enable auto-reward with gas deposit
     */
    function enableAutoReward() external payable nonReentrant {
        require(providers[msg.sender].isActive, "ProviderRegistry: Not registered");
        require(!providers[msg.sender].autoRewardEnabled, "ProviderRegistry: Already enabled");
        require(msg.value > 0, "ProviderRegistry: Gas deposit required");
        
        providers[msg.sender].autoRewardEnabled = true;
        providers[msg.sender].autoRewardGasDeposit += msg.value;
        
        emit AutoRewardEnabled(msg.sender, msg.value);
    }
    
    /**
     * @dev Disable auto-reward and withdraw gas deposit
     */
    function disableAutoReward() external nonReentrant {
        require(providers[msg.sender].isActive, "ProviderRegistry: Not registered");
        require(providers[msg.sender].autoRewardEnabled, "ProviderRegistry: Not enabled");
        
        uint256 gasDeposit = providers[msg.sender].autoRewardGasDeposit;
        providers[msg.sender].autoRewardEnabled = false;
        providers[msg.sender].autoRewardGasDeposit = 0;
        
        if (gasDeposit > 0) {
            payable(msg.sender).transfer(gasDeposit);
        }
        
        emit AutoRewardDisabled(msg.sender);
    }
    
    /**
     * @dev Add reward to provider (only validator/backend)
     */
    function addReward(
        address provider,
        uint256 epochReward,
        uint256 jobReward
    ) external onlyRole(VALIDATOR_ROLE) {
        require(providers[provider].isActive, "ProviderRegistry: Provider not active");
        
        if (epochReward > 0) {
            pendingRewards[provider] += epochReward;
        }
        if (jobReward > 0) {
            jobRewards[provider] += jobReward;
        }
        
        emit RewardAdded(provider, epochReward, jobReward);
    }
    
    /**
     * @dev Claim rewards (for manual claim)
     * Note: Actual CLD rewards are distributed via MerkleRewardsPoUW
     * This is for tracking purposes
     */
    function claimRewards() external nonReentrant {
        require(providers[msg.sender].isActive, "ProviderRegistry: Not registered");
        
        uint256 totalReward = pendingRewards[msg.sender] + jobRewards[msg.sender];
        require(totalReward > 0, "ProviderRegistry: No rewards to claim");
        
        // Reset rewards (actual claiming happens via MerkleRewardsPoUW)
        pendingRewards[msg.sender] = 0;
        jobRewards[msg.sender] = 0;
        
        emit RewardClaimed(msg.sender, totalReward);
    }
    
    /**
     * @dev Deactivate provider (only admin)
     */
    function deactivateProvider(address provider) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(providers[provider].isActive, "ProviderRegistry: Not active");
        providers[provider].isActive = false;
        emit ProviderDeactivated(provider);
    }
    
    /**
     * @dev Get provider info
     */
    function getProvider(address provider) external view returns (Provider memory) {
        return providers[provider];
    }
    
    /**
     * @dev Get total provider count
     */
    function getProviderCount() external view returns (uint256) {
        return providerList.length;
    }
    
    /**
     * @dev Check if provider is registered and active
     */
    function isProviderActive(address provider) external view returns (bool) {
        return providers[provider].isActive;
    }
    
    /**
     * @dev Get total rewards for provider
     */
    function getTotalRewards(address provider) external view returns (uint256) {
        return pendingRewards[provider] + jobRewards[provider];
    }
}

