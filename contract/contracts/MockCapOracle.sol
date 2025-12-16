// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./CLDToken.sol";

/**
 * @title MockCapOracle
 * @dev Mock oracle for testnet that allows admin to finalize cap with random value R
 * On mainnet, this would be replaced with a VRF-backed oracle
 */
contract MockCapOracle is AccessControl {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    
    CLDToken public immutable token;
    uint256 public constant TEMPORARY_CAP = 64_000_000 * 10**18; // 64M CLD
    uint256 public constant BASE_CAP = 21_000_000 * 10**18; // 21M CLD
    uint256 public constant MAX_RANDOM = 43_000_000 * 10**18; // 43M CLD
    
    bool public capFinalized;
    uint256 public finalCap;
    
    event CapFinalized(uint256 randomValue, uint256 finalCap);
    
    constructor(address _token) {
        require(_token != address(0), "MockCapOracle: Invalid token address");
        token = CLDToken(_token);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_ROLE, msg.sender);
    }
    
    /**
     * @dev Finalize cap with random value R (for testnet MVP)
     * @param randomValue R ∈ [0, 43M] in wei
     * Final cap = 21M + R
     */
    function finalizeCap(uint256 randomValue) external onlyRole(ORACLE_ROLE) {
        require(!capFinalized, "MockCapOracle: Cap already finalized");
        require(randomValue <= MAX_RANDOM, "MockCapOracle: Random value exceeds max");
        
        finalCap = BASE_CAP + randomValue;
        capFinalized = true;
        
        // Set final cap on token
        token.setFinalCap(finalCap);
        
        emit CapFinalized(randomValue, finalCap);
    }
    
    /**
     * @dev Get the final cap (if finalized)
     */
    function getFinalCap() external view returns (uint256) {
        require(capFinalized, "MockCapOracle: Cap not yet finalized");
        return finalCap;
    }
}

