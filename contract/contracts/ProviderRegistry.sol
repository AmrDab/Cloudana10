// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./CLDToken.sol";
/**
 * @title ProviderRegistry
 * @dev Registry for DePIN providers with static bond mechanism
 * - Static bond: 1000 tokens total per registration
 * - Fee split: 80% burn (800), 15% team (150), 5% treasury (50)
 * - Max 10 providers per wallet address
 * - Provider metadata: providerkey, region, hardwareTier, capacity
 */
contract ProviderRegistry is AccessControl {
    CLDToken public immutable cldToken;
    
    // Static bond amount: 1000 tokens (1000e18)
    uint256 public constant STATIC_BOND = 1000 * 10**18;
    
    // Fee split percentages (basis points: 10000 = 100%)
    uint256 public constant TREASURY_PERCENT = 8000;      // 80%
    uint256 public constant TEAM_PERCENT = 2000;       // 20%
    
    // Dead address for burning tokens
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    
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
    
    // Provider struct
    struct Provider {
        address owner;
        bytes32 providerkey;
        string region;
        uint8 hardwareTier;  // 0=CPU, 1=GPU-T1, 2=GPU-T2
        uint8 capacity;     // 1-10 servers
        uint96 bondAmount;   // Always 1000e18
        uint64 registeredAt;
        ProviderStatus status;
    }
    
    // Mappings
    mapping(bytes32 => Provider) public providers;  // providerkey => Provider
    mapping(address => bytes32[]) public ownerNodes;  // owner => providerkeys[]
    mapping(bytes32 => uint64) public agentHeartbeats;  // Future: agent uptime tracking
    
    // Events
    event ProviderRegistered(
        address indexed owner,
        bytes32 indexed providerkey,
        string region,
        uint8 hardwareTier,
        uint8 capacity,
        uint256 bondAmount
    );
    
    event ProviderStatusUpdated(
        bytes32 indexed providerkey,
        ProviderStatus status
    );
    
    event AgentHeartbeat(
        bytes32 indexed providerkey,
        uint64 timestamp
    );
    
    // Errors
    error ProviderAlreadyExists(bytes32 providerkey);
    error MaxProvidersReached(address owner);
    error InsufficientBalance(uint256 required, uint256 available);
    error InsufficientAllowance(uint256 required, uint256 allowance);
    error Invalidproviderkey();
    error InvalidRegion();
    error InvalidHardwareTier();
    error InvalidCapacity();
    error ProviderNotFound(bytes32 providerkey);
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
     * @dev Register a new provider with static bond
     * @param providerkey Unique 32-byte node identifier
     * @param region Provider region (Helsinki, EU, Global)
     * @param hardwareTier Hardware tier (0=CPU, 1=GPU-T1, 2=GPU-T2)
     * @param capacity Number of servers (1-10)
     */
    function registerProvider(
        bytes32 providerkey,
        string calldata region,
        uint8 hardwareTier,
        uint8 capacity
    ) external {
        // Validate providerkey
        if (providerkey == bytes32(0)) {
            revert Invalidproviderkey();
        }
        
        // Check if provider already exists
        if (providers[providerkey].owner != address(0)) {
            revert ProviderAlreadyExists(providerkey);
        }
        
        // Check owner quota
        if (ownerNodes[msg.sender].length >= MAX_PROVIDERS_PER_OWNER) {
            revert MaxProvidersReached(msg.sender);
        }
        
        // Validate region (basic check - can be extended)
        if (bytes(region).length == 0) {
            revert InvalidRegion();
        }
        
        // Validate hardware tier (0-2)
        if (hardwareTier > 2) {
            revert InvalidHardwareTier();
        }
        
        // Validate capacity (1-10)
        if (capacity == 0 || capacity > 10) {
            revert InvalidCapacity();
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
        uint256 teamAmount = (STATIC_BOND * TEAM_PERCENT) / 10000;      // 150 tokens
        uint256 treasuryAmount = (STATIC_BOND * TREASURY_PERCENT) / 10000; // 50 tokens
        
        // Send 20% to team wallet
        cldToken.transfer(teamWallet, teamAmount);
        
        // Send 80% to treasury wallet
        cldToken.transfer(treasuryWallet, treasuryAmount);
        
        // Create provider
        providers[providerkey] = Provider({
            owner: msg.sender,
            providerkey: providerkey,
            region: region,
            hardwareTier: hardwareTier,
            capacity: capacity,
            bondAmount: uint96(STATIC_BOND),
            registeredAt: uint64(block.timestamp),
            status: ProviderStatus.Registered
        });
        
        // Track owner's nodes
        ownerNodes[msg.sender].push(providerkey);
        
        emit ProviderRegistered(
            msg.sender,
            providerkey,
            region,
            hardwareTier,
            capacity,
            STATIC_BOND
        );
    }
    
    /**
     * @dev Get provider information by providerkey
     * @param providerkey Provider node key
     * @return Provider struct
     */
    function getProvider(bytes32 providerkey) external view returns (Provider memory) {
        if (providers[providerkey].owner == address(0)) {
            revert ProviderNotFound(providerkey);
        }
        return providers[providerkey];
    }
    
    /**
     * @dev Get all providers for an owner
     * @param owner Provider owner address
     * @return providerkeys Array of node keys owned by the address
     */
    function getMyProviders(address owner) external view returns (bytes32[] memory) {
        return ownerNodes[owner];
    }
    
    /**
     * @dev Update provider status (only owner or admin)
     * @param providerkey Provider node key
     * @param status New status
     */
    function updateProviderStatus(bytes32 providerkey, ProviderStatus status) external {
        Provider storage provider = providers[providerkey];
        if (provider.owner == address(0)) {
            revert ProviderNotFound(providerkey);
        }
        
        // Only owner or admin can update status
        if (msg.sender != provider.owner && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotProviderOwner(msg.sender, provider.owner);
        }
        
        provider.status = status;
        emit ProviderStatusUpdated(providerkey, status);
    }
}

