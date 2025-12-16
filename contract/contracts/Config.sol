// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title Config
 * @dev Configuration contract for Cloudana system parameters
 * Can be updated by governance in the future
 */
contract Config is AccessControl {
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    
    // Provider registry config
    uint256 public providerDepositAmount;
    
    // Job escrow config
    uint256 public minJobDeposit;
    uint256 public jobRefundFeeBps; // Basis points (100 = 1%)
    
    // Reward thresholds
    uint256 public epochRewardThreshold; // Minimum reward to trigger auto-claim per epoch
    uint256 public jobRewardThreshold; // Minimum reward to trigger auto-claim per job
    
    // Epoch settings
    uint256 public epochDuration; // Duration of one epoch in seconds (e.g., 5-10 minutes)
    
    // Gas bank config
    uint256 public gasBankDailyLimit;
    
    event ProviderDepositAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event MinJobDepositUpdated(uint256 oldAmount, uint256 newAmount);
    event JobRefundFeeBpsUpdated(uint256 oldBps, uint256 newBps);
    event EpochRewardThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event JobRewardThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event EpochDurationUpdated(uint256 oldDuration, uint256 newDuration);
    event GasBankDailyLimitUpdated(uint256 oldLimit, uint256 newLimit);
    
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(GOVERNANCE_ROLE, msg.sender);
        
        // Default values
        providerDepositAmount = 1 ether; // 1 ETH deposit for providers
        minJobDeposit = 0.01 ether; // Minimum 0.01 ETH for job deposit
        jobRefundFeeBps = 50; // 0.5% fee on refunds
        epochRewardThreshold = 100 * 10**18; // 100 CLD minimum for auto-claim
        jobRewardThreshold = 10 * 10**18; // 10 CLD minimum for auto-claim
        epochDuration = 300; // 5 minutes default
        gasBankDailyLimit = 10 ether; // 10 ETH per day limit
    }
    
    function setProviderDepositAmount(uint256 _amount) external onlyRole(GOVERNANCE_ROLE) {
        uint256 oldAmount = providerDepositAmount;
        providerDepositAmount = _amount;
        emit ProviderDepositAmountUpdated(oldAmount, _amount);
    }
    
    function setMinJobDeposit(uint256 _amount) external onlyRole(GOVERNANCE_ROLE) {
        uint256 oldAmount = minJobDeposit;
        minJobDeposit = _amount;
        emit MinJobDepositUpdated(oldAmount, _amount);
    }
    
    function setJobRefundFeeBps(uint256 _bps) external onlyRole(GOVERNANCE_ROLE) {
        require(_bps <= 10000, "Config: BPS cannot exceed 10000");
        uint256 oldBps = jobRefundFeeBps;
        jobRefundFeeBps = _bps;
        emit JobRefundFeeBpsUpdated(oldBps, _bps);
    }
    
    function setEpochRewardThreshold(uint256 _threshold) external onlyRole(GOVERNANCE_ROLE) {
        uint256 oldThreshold = epochRewardThreshold;
        epochRewardThreshold = _threshold;
        emit EpochRewardThresholdUpdated(oldThreshold, _threshold);
    }
    
    function setJobRewardThreshold(uint256 _threshold) external onlyRole(GOVERNANCE_ROLE) {
        uint256 oldThreshold = jobRewardThreshold;
        jobRewardThreshold = _threshold;
        emit JobRewardThresholdUpdated(oldThreshold, _threshold);
    }
    
    function setEpochDuration(uint256 _duration) external onlyRole(GOVERNANCE_ROLE) {
        require(_duration > 0, "Config: Duration must be greater than zero");
        uint256 oldDuration = epochDuration;
        epochDuration = _duration;
        emit EpochDurationUpdated(oldDuration, _duration);
    }
    
    function setGasBankDailyLimit(uint256 _limit) external onlyRole(GOVERNANCE_ROLE) {
        uint256 oldLimit = gasBankDailyLimit;
        gasBankDailyLimit = _limit;
        emit GasBankDailyLimitUpdated(oldLimit, _limit);
    }
}

