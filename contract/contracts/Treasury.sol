// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./CLDToken.sol";

/**
 * @title Treasury
 * @dev Treasury contract that receives emissions and holds ETH for gas funding
 */
contract Treasury is AccessControl {
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");
    
    CLDToken public immutable token;
    
    event ETHDeposited(address indexed from, uint256 amount);
    event ETHWithdrawn(address indexed to, uint256 amount);
    event TokenWithdrawn(address indexed token, address indexed to, uint256 amount);
    
    constructor(address _token) {
        require(_token != address(0), "Treasury: Invalid token address");
        token = CLDToken(_token);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(TREASURY_ROLE, msg.sender);
    }
    
    /**
     * @dev Receive ETH
     */
    receive() external payable {
        emit ETHDeposited(msg.sender, msg.value);
    }
    
    /**
     * @dev Deposit ETH
     */
    function depositETH() external payable {
        emit ETHDeposited(msg.sender, msg.value);
    }
    
    /**
     * @dev Withdraw ETH (only treasury role)
     */
    function withdrawETH(address payable to, uint256 amount) external onlyRole(TREASURY_ROLE) {
        require(to != address(0), "Treasury: Invalid recipient");
        require(address(this).balance >= amount, "Treasury: Insufficient balance");
        
        (bool success, ) = to.call{value: amount}("");
        require(success, "Treasury: ETH transfer failed");
        
        emit ETHWithdrawn(to, amount);
    }
    
    /**
     * @dev Withdraw tokens (only treasury role)
     */
    function withdrawToken(address tokenAddress, address to, uint256 amount) external onlyRole(TREASURY_ROLE) {
        require(to != address(0), "Treasury: Invalid recipient");
        require(tokenAddress != address(0), "Treasury: Invalid token address");
        
        IERC20(tokenAddress).transfer(to, amount);
        
        emit TokenWithdrawn(tokenAddress, to, amount);
    }
    
    /**
     * @dev Get ETH balance
     */
    function getETHBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    /**
     * @dev Get token balance
     */
    function getTokenBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }
}

