// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title CLDToken
 * @dev Cloudana DePIN token with capped supply and VRF-based mystery cap
 */
contract CLDToken is ERC20, ERC20Capped, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant CAP_SETTER_ROLE = keccak256("CAP_SETTER_ROLE");
    
    uint256 private _finalCap;
    bool private _capFinalized;
    
    event CapFinalized(uint256 finalCap);
    event CapSet(uint256 newCap);
    
    constructor(
        string memory name,
        string memory symbol,
        uint256 temporaryCap
    ) ERC20(name, symbol) ERC20Capped(temporaryCap) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(CAP_SETTER_ROLE, msg.sender);
        // Temporary cap is set via ERC20Capped constructor
        _finalCap = 0; // Unset initially
        _capFinalized = false;
    }
    
    /**
     * @dev Set the final cap (only by oracle with CAP_SETTER_ROLE)
     * @param newCap The final cap amount (must be <= current cap)
     */
    function setFinalCap(uint256 newCap) external onlyRole(CAP_SETTER_ROLE) {
        require(!_capFinalized, "CLDToken: Cap already finalized");
        require(newCap > 0, "CLDToken: Cap must be greater than zero");
        require(newCap <= cap(), "CLDToken: Final cap cannot exceed temporary cap");
        
        _finalCap = newCap;
        _capFinalized = true;
        
        emit CapFinalized(newCap);
    }
    
    /**
     * @dev Get the final cap
     */
    function finalCap() external view returns (uint256) {
        return _finalCap;
    }
    
    /**
     * @dev Check if cap is finalized
     */
    function capFinalized() external view returns (bool) {
        return _capFinalized;
    }
    
    /**
     * @dev Override cap() to return finalCap if finalized, otherwise temporary cap
     */
    function cap() public view override returns (uint256) {
        if (_capFinalized) {
            return _finalCap;
        }
        return super.cap();
    }
    
    /**
     * @dev Mint tokens (only by addresses with MINTER_ROLE)
     * @param to Address to mint to
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        require(totalSupply() + amount <= cap(), "CLDToken: Cap exceeded");
        _mint(to, amount);
    }
    
    /**
     * @dev Batch mint tokens to multiple addresses (gas optimized)
     * @param recipients Array of recipient addresses
     * @param amounts Array of amounts to mint (must match recipients length)
     */
    function batchMint(address[] calldata recipients, uint256[] calldata amounts) 
        external onlyRole(MINTER_ROLE) 
    {
        require(recipients.length == amounts.length, "CLDToken: Array length mismatch");
        
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalAmount += amounts[i];
        }
        
        require(totalSupply() + totalAmount <= cap(), "CLDToken: Cap exceeded");
        
        for (uint256 i = 0; i < recipients.length; i++) {
            _mint(recipients[i], amounts[i]);
        }
    }
    
    /**
     * @dev Override _update to enforce cap
     */
    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Capped) {
        super._update(from, to, value);
    }
}

