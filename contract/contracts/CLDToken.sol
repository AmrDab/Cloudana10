// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title CLDToken
 * @dev ERC20 token with minting and burning capabilities for Cloudana MVP testnet
 * - Total supply tracking
 * - Mint to treasury and team wallet
 * - Governance address can mint (for MVP, use wallet address)
 */
contract CLDToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    // bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    uint256 public constant INITIAL_SUPPLY = 1_000_000 * 10**18;
    // Treasury and team wallet addresses (set in constructor)
    address public immutable treasuryWallet;
    address public immutable teamWallet;

    error InsufficientBalance(uint256 requested, uint256 available);
    error InsufficientAllowance(uint256 requested, uint256 allowance);

    constructor(
        address _treasuryWallet,
        address _teamWallet
        // address _governanceAddress
    ) ERC20("Cloudana Token", "CLD") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        // _grantRole(GOVERNANCE_ROLE, _governanceAddress);
        
        treasuryWallet = _treasuryWallet;
        teamWallet = _teamWallet;

        _mint(treasuryWallet, (INITIAL_SUPPLY * 80) / 100);
        _mint(teamWallet, (INITIAL_SUPPLY * 20) / 100);

    }

    /**
     * @dev Mint tokens to an address (only MINTER_ROLE)
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    // /**
    //  * @dev Mint tokens to treasury and team wallet (only GOVERNANCE_ROLE)
    //  * @param treasuryAmount Amount of tokens to mint to treasury
    //  * @param teamAmount Amount of tokens to mint to team wallet
    //  */
    // function mintToTreasuryAndTeam(
    //     uint256 treasuryAmount,
    //     uint256 teamAmount
    // ) external onlyRole(GOVERNANCE_ROLE) {
    //     if (treasuryAmount > 0) {
    //         _mint(treasuryWallet, treasuryAmount);
    //     }
    //     if (teamAmount > 0) {
    //         _mint(teamWallet, teamAmount);
    //     }
    // }

    /**
     * @dev Burn tokens from msg.sender
     * @param amount Amount of tokens to burn
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /**
     * @dev Burn tokens from a specified address (requires allowance)
     * @param from Address to burn tokens from
     * @param amount Amount of tokens to burn
     */
    function burnFrom(address from, uint256 amount) external {
        uint256 currentAllowance = allowance(from, msg.sender);
        if (currentAllowance < amount) {
            revert InsufficientAllowance(amount, currentAllowance);
        }
        _spendAllowance(from, msg.sender, amount);
        _burn(from, amount);
    }
}

