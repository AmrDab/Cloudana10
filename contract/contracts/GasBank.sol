// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./Config.sol";

/**
 * @title GasBank
 * @dev Holds ETH for gas funding of relayed transactions
 * Supports daily limits and relayer whitelist
 */
contract GasBank is AccessControl {
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant FUNDER_ROLE = keccak256("FUNDER_ROLE");
    
    Config public immutable config;
    
    mapping(address => bool) public whitelistedRelayers;
    uint256 public spentToday;
    uint256 public lastResetDay;
    
    event ETHDeposited(address indexed from, uint256 amount);
    event ETHWithdrawn(address indexed to, uint256 amount, address indexed relayer);
    event RelayerWhitelisted(address indexed relayer, bool whitelisted);
    event DailyLimitReset(uint256 day, uint256 newLimit);
    
    constructor(address _config) {
        require(_config != address(0), "GasBank: Invalid config address");
        config = Config(_config);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(FUNDER_ROLE, msg.sender);
        _grantRole(RELAYER_ROLE, msg.sender);
        
        lastResetDay = block.timestamp / 1 days;
    }
    
    /**
     * @dev Receive ETH
     */
    receive() external payable {
        emit ETHDeposited(msg.sender, msg.value);
    }
    
    /**
     * @dev Deposit ETH (anyone can deposit)
     */
    function depositETH() external payable {
        emit ETHDeposited(msg.sender, msg.value);
    }
    
    /**
     * @dev Withdraw ETH to relayer (only whitelisted relayers)
     */
    function withdrawForRelay(address payable to, uint256 amount) external onlyRole(RELAYER_ROLE) {
        require(to != address(0), "GasBank: Invalid recipient");
        require(whitelistedRelayers[to] || hasRole(RELAYER_ROLE, to), "GasBank: Relayer not whitelisted");
        
        _resetDailyLimitIfNeeded();
        
        uint256 dailyLimit = config.gasBankDailyLimit();
        require(spentToday + amount <= dailyLimit, "GasBank: Daily limit exceeded");
        require(address(this).balance >= amount, "GasBank: Insufficient balance");
        
        spentToday += amount;
        
        (bool success, ) = to.call{value: amount}("");
        require(success, "GasBank: ETH transfer failed");
        
        emit ETHWithdrawn(to, amount, msg.sender);
    }
    
    /**
     * @dev Whitelist a relayer (only admin)
     */
    function whitelistRelayer(address relayer, bool whitelisted) external onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistedRelayers[relayer] = whitelisted;
        emit RelayerWhitelisted(relayer, whitelisted);
    }
    
    /**
     * @dev Reset daily limit if needed
     */
    function _resetDailyLimitIfNeeded() internal {
        uint256 currentDay = block.timestamp / 1 days;
        if (currentDay > lastResetDay) {
            spentToday = 0;
            lastResetDay = currentDay;
            emit DailyLimitReset(currentDay, config.gasBankDailyLimit());
        }
    }
    
    /**
     * @dev Get ETH balance
     */
    function getETHBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    /**
     * @dev Get remaining daily limit
     */
    function getRemainingDailyLimit() external view returns (uint256) {
        uint256 currentDay = block.timestamp / 1 days;
        if (currentDay > lastResetDay) {
            return config.gasBankDailyLimit();
        }
        uint256 dailyLimit = config.gasBankDailyLimit();
        return dailyLimit > spentToday ? dailyLimit - spentToday : 0;
    }
}

