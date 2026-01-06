// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./CLDToken.sol";
/**
 * @title ProviderRegistry
 * @dev Minimal DePIN provider registry - stores only essential on-chain data
 * - Static bond: 1000 tokens total per registration
 * - Fee split: 80% treasury, 20% team
 * - Max 10 providers per wallet address
 * - Minimal on-chain data: owner, pubkeyhash, CID, bond, status
 * - All detailed metadata stored off-chain in IPFS
 */
contract ProviderRegistry is AccessControl {
    CLDToken public immutable cldToken;
    
    // Static bond amount: 1000 tokens (1000e18)
    uint256 public constant STATIC_BOND = 1000 * 10**18;
    
    // Fee split percentages (basis points: 10000 = 100%)
    uint256 public constant TREASURY_PERCENT = 8000;      // 80%
    uint256 public constant TEAM_PERCENT = 2000;       // 20%
    
    // Team and treasury wallets (set in constructor)
    address public immutable teamWallet;
    address public immutable treasuryWallet;
    
    // Max providers per owner
    uint8 public constant MAX_PROVIDERS_PER_OWNER = 10;
    
    // Provider status enum
    enum ProviderStatus {
        Registered,  // 0
        Active,      // 1
        Inactive     // 2
    }
    
    // Minimal Provider struct - only essential on-chain data
    struct Provider {
        address owner;           // Owner wallet address
        bytes32 pubKeyHash;      // Public key hash of the node
        string ipfsCID;          // IPFS CID containing full node metadata
        uint96 bondAmount;       // Bond amount (always 1000e18)
        uint64 registeredAt;     // Registration timestamp
        ProviderStatus status;   // Current status
    }
    
    // Mappings
    mapping(bytes32 => Provider) public providers;  // pubKeyHash => Provider
    mapping(address => bytes32[]) public ownerNodes;  // owner => pubKeyHashes[]
    bytes32[] public allProviderKeys;  // Array of all registered provider pubKeyHashes
    
    // Events
    event ProviderRegistered(
        address indexed owner,
        bytes32 indexed pubKeyHash,
        string ipfsCID,
        uint256 bondAmount
    );
    
    event ProviderStatusUpdated(
        bytes32 indexed pubKeyHash,
        ProviderStatus status
    );
    
    // Errors
    error ProviderAlreadyExists(bytes32 pubKeyHash);
    error MaxProvidersReached(address owner);
    error InsufficientBalance(uint256 required, uint256 available);
    error InsufficientAllowance(uint256 required, uint256 allowance);
    error InvalidPubKeyHash();
    error InvalidIPFSCID();
    error ProviderNotFound(bytes32 pubKeyHash);
    error NotProviderOwner(address caller, address owner);
    
    constructor(
        address _cldToken,
        address _teamWallet,
        address _treasuryWallet
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        cldToken = CLDToken(_cldToken);
        teamWallet = _teamWallet;
        treasuryWallet = _treasuryWallet;
    }
    
    /**
     * @dev Register a new provider with minimal on-chain data
     * @param pubKeyHash Public key hash of the node (unique identifier)
     * @param ipfsCID IPFS CID containing full node metadata (hardware specs, location, etc.)
     */
    function registerProvider(
        bytes32 pubKeyHash,
        string calldata ipfsCID
    ) external {
        // Validate pubKeyHash
        if (pubKeyHash == bytes32(0)) {
            revert InvalidPubKeyHash();
        }
        
        // Check if provider already exists
        if (providers[pubKeyHash].owner != address(0)) {
            revert ProviderAlreadyExists(pubKeyHash);
        }
        
        // Check owner quota
        if (ownerNodes[msg.sender].length >= MAX_PROVIDERS_PER_OWNER) {
            revert MaxProvidersReached(msg.sender);
        }
        
        // Validate IPFS CID (basic check)
        if (bytes(ipfsCID).length == 0) {
            revert InvalidIPFSCID();
        }
        
        // Check balance and allowance
        uint256 balance = cldToken.balanceOf(msg.sender);
        if (balance < STATIC_BOND) {
            revert InsufficientBalance(STATIC_BOND, balance);
        }
        
        uint256 allowance = cldToken.allowance(msg.sender, address(this));
        if (allowance < STATIC_BOND) {
            revert InsufficientAllowance(STATIC_BOND, allowance);
        }
        
        // Transfer tokens and split fees
        cldToken.transferFrom(msg.sender, address(this), STATIC_BOND);
        
        // Calculate fee split
        uint256 teamAmount = (STATIC_BOND * TEAM_PERCENT) / 10000;      // 200 tokens (20%)
        uint256 treasuryAmount = (STATIC_BOND * TREASURY_PERCENT) / 10000; // 800 tokens (80%)
        
        // Send 20% to team wallet
        cldToken.transfer(teamWallet, teamAmount);
        
        // Send 80% to treasury wallet
        cldToken.transfer(treasuryWallet, treasuryAmount);
        
        // Create provider with minimal data
        providers[pubKeyHash] = Provider({
            owner: msg.sender,
            pubKeyHash: pubKeyHash,
            ipfsCID: ipfsCID,
            bondAmount: uint96(STATIC_BOND),
            registeredAt: uint64(block.timestamp),
            status: ProviderStatus.Registered
        });
        
        // Track owner's nodes
        ownerNodes[msg.sender].push(pubKeyHash);
        
        // Track all providers
        allProviderKeys.push(pubKeyHash);
        
        emit ProviderRegistered(
            msg.sender,
            pubKeyHash,
            ipfsCID,
            STATIC_BOND
        );
    }
    
    /**
     * @dev Get provider information by pubKeyHash
     * @param pubKeyHash Provider public key hash
     * @return Provider struct
     */
    function getProvider(bytes32 pubKeyHash) external view returns (Provider memory) {
        if (providers[pubKeyHash].owner == address(0)) {
            revert ProviderNotFound(pubKeyHash);
        }
        return providers[pubKeyHash];
    }
    
    /**
     * @dev Get all providers for an owner
     * @param owner Provider owner address
     * @return pubKeyHashes Array of public key hashes owned by the address
     */
    function getMyProviders(address owner) external view returns (bytes32[] memory) {
        return ownerNodes[owner];
    }
    
    /**
     * @dev Get all registered provider keys
     * @return pubKeyHashes Array of all provider public key hashes
     */
    function getAllProviderKeys() external view returns (bytes32[] memory) {
        return allProviderKeys;
    }
    
    /**
     * @dev Get the total number of registered providers
     * @return Total count of providers
     */
    function getProviderCount() external view returns (uint256) {
        return allProviderKeys.length;
    }
    
    /**
     * @dev Update provider status (only owner or admin)
     * @param pubKeyHash Provider public key hash
     * @param status New status
     */
    function updateProviderStatus(bytes32 pubKeyHash, ProviderStatus status) external {
        Provider storage provider = providers[pubKeyHash];
        if (provider.owner == address(0)) {
            revert ProviderNotFound(pubKeyHash);
        }
        
        // Only owner or admin can update status
        if (msg.sender != provider.owner && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotProviderOwner(msg.sender, provider.owner);
        }
        
        provider.status = status;
        emit ProviderStatusUpdated(pubKeyHash, status);
    }

    /**
     * @dev Get bond amount required for registration
     * @return Bond amount in wei
     */
    function getBondInfo() external pure returns (uint256) {
        return STATIC_BOND;
    }
}
