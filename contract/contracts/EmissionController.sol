// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./CLDToken.sol";
import "./Treasury.sol";
import "./MerkleRewardsPoUW.sol";

/**
 * @title EmissionController
 * @dev Controls daily emissions with exponential decay
 * E(t) = E0 * exp(-k * t)
 */
contract EmissionController is AccessControl {
    bytes32 public constant EMITTER_ROLE = keccak256("EMITTER_ROLE");
    
    CLDToken public immutable token;
    Treasury public immutable treasury;
    MerkleRewardsPoUW public merkleRewards; // Mutable to allow setting after deployment
    address public governanceIncentives; // Address for governance incentives (7%)
    
    uint256 public startTimestamp;
    uint256 public epochDuration; // Duration of one epoch in seconds
    bool public emissionsStarted;
    
    // Emission parameters
    uint256 public E0; // Initial daily emission (scaled by 1e18)
    uint256 public k; // Decay constant (scaled by 1e18, e.g., 0.003 = 3e15)
    
    // Bucket percentages (basis points)
    uint256 public constant VALIDATORS_BPS = 3500; // 35%
    uint256 public constant POUW_BPS = 4000; // 40%
    uint256 public constant TREASURY_BPS = 1800; // 18%
    uint256 public constant GOVERNANCE_BPS = 700; // 7%
    
    // Epoch tracking
    mapping(uint256 => bool) public epochProcessed;
    mapping(uint256 => uint256) public pouwBudget; // Budget for PoUW per epoch
    
    event EmissionsStarted(uint256 startTimestamp, uint256 E0, uint256 k);
    event EpochProcessed(uint256 epoch, uint256 totalEmission, uint256 validatorsAmount, uint256 pouwBudget, uint256 treasuryAmount, uint256 governanceAmount);
    event GovernanceIncentivesUpdated(address oldAddress, address newAddress);
    event MerkleRewardsUpdated(address oldAddress, address newAddress);
    
    constructor(
        address _token,
        address _treasury,
        address _merkleRewards,
        uint256 _epochDuration
    ) {
        require(_token != address(0), "EmissionController: Invalid token");
        require(_treasury != address(0), "EmissionController: Invalid treasury");
        require(_epochDuration > 0, "EmissionController: Invalid epoch duration");
        
        token = CLDToken(_token);
        treasury = Treasury(payable(_treasury));
        epochDuration = _epochDuration;
        
        // Allow setting merkleRewards after deployment to resolve circular dependency
        if (_merkleRewards != address(0)) {
            merkleRewards = MerkleRewardsPoUW(_merkleRewards);
        }
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(EMITTER_ROLE, msg.sender);
        
        // Default decay: k = 0.003 (3e15 in wei)
        k = 3e15;
    }
    
    /**
     * @dev Start emissions
     * @param _E0 Initial daily emission (in wei)
     */
    function startEmissions(uint256 _E0) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(!emissionsStarted, "EmissionController: Already started");
        require(_E0 > 0, "EmissionController: E0 must be greater than zero");
        
        E0 = _E0;
        startTimestamp = block.timestamp;
        emissionsStarted = true;
        
        emit EmissionsStarted(startTimestamp, E0, k);
    }
    
    /**
     * @dev Set decay constant k
     */
    function setDecayConstant(uint256 _k) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(!emissionsStarted, "EmissionController: Cannot change k after start");
        k = _k;
    }
    
    /**
     * @dev Set governance incentives address
     */
    function setGovernanceIncentives(address _governanceIncentives) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address oldAddress = governanceIncentives;
        governanceIncentives = _governanceIncentives;
        emit GovernanceIncentivesUpdated(oldAddress, _governanceIncentives);
    }
    
    /**
     * @dev Set merkle rewards address (can only be set once)
     */
    function setMerkleRewards(address _merkleRewards) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_merkleRewards != address(0), "EmissionController: Invalid merkleRewards");
        require(address(merkleRewards) == address(0), "EmissionController: MerkleRewards already set");
        
        address oldAddress = address(merkleRewards);
        merkleRewards = MerkleRewardsPoUW(_merkleRewards);
        emit MerkleRewardsUpdated(oldAddress, _merkleRewards);
    }
    
    /**
     * @dev Get current epoch index
     */
    function getCurrentEpoch() public view returns (uint256) {
        require(emissionsStarted, "EmissionController: Not started");
        return (block.timestamp - startTimestamp) / epochDuration;
    }
    
    /**
     * @dev Calculate emission for a specific epoch
     * E(t) = E0 * exp(-k * t)
     * where t = epoch (days since start)
     */
    function calculateEmission(uint256 epoch) public view returns (uint256) {
        require(emissionsStarted, "EmissionController: Not started");
        
        // Convert epoch to days (assuming epochDuration is in seconds)
        uint256 daysSinceStart = (epoch * epochDuration) / 1 days;
        
        // Calculate exp(-k * t) using approximation
        // For small k*t, we can use: exp(-k*t) ≈ 1 - k*t + (k*t)^2/2 - ...
        // For better precision, we use: exp(-k*t) = (1 - k*t/1e18)^(1e18) for small values
        // Or use a more accurate approximation
        
        // Simplified: exp(-k * daysSinceStart)
        // Using fixed-point math: result = E0 * (1e18 - k * daysSinceStart) / 1e18
        // For better accuracy, we'll use a Taylor series approximation
        
        if (daysSinceStart == 0) {
            return E0;
        }
        
        // More accurate: use exp(-k*t) approximation
        // For k*t << 1: exp(-k*t) ≈ 1 - k*t
        // We scale everything by 1e18
        uint256 kt = (k * daysSinceStart) / 1e18;
        
        // Prevent underflow
        if (kt >= 1e18) {
            return 0;
        }
        
        // exp(-k*t) ≈ (1e18 - kt) for small kt
        // For better accuracy, we can use: (1e18 - kt + (kt^2)/2) / 1e18
        uint256 expValue = 1e18 - kt;
        if (kt > 0) {
            uint256 kt2 = (kt * kt) / 1e18;
            expValue = expValue + (kt2 / 2);
        }
        
        return (E0 * expValue) / 1e18;
    }
    
    /**
     * @dev Process epoch emissions
     * Mints tokens to validators, treasury, governance
     * Sets PoUW budget (does not mint, mint-on-claim)
     */
    function processEpoch(uint256 epoch) public onlyRole(EMITTER_ROLE) {
        require(emissionsStarted, "EmissionController: Not started");
        require(!epochProcessed[epoch], "EmissionController: Epoch already processed");
        
        uint256 totalEmission = calculateEmission(epoch);
        require(totalEmission > 0, "EmissionController: Zero emission");
        
        // Calculate bucket amounts
        uint256 validatorsAmount = (totalEmission * VALIDATORS_BPS) / 10000;
        uint256 pouwAmount = (totalEmission * POUW_BPS) / 10000;
        uint256 treasuryAmount = (totalEmission * TREASURY_BPS) / 10000;
        uint256 governanceAmount = (totalEmission * GOVERNANCE_BPS) / 10000;
        
        // Mint to validators (placeholder - would go to staking contract)
        // For MVP, we'll mint to treasury as placeholder
        token.mint(address(treasury), validatorsAmount);
        
        // Set PoUW budget (mint-on-claim)
        pouwBudget[epoch] = pouwAmount;
        
        // Mint to treasury
        token.mint(address(treasury), treasuryAmount);
        
        // Mint to governance incentives
        if (governanceIncentives != address(0)) {
            token.mint(governanceIncentives, governanceAmount);
        } else {
            // If not set, send to treasury
            token.mint(address(treasury), governanceAmount);
        }
        
        epochProcessed[epoch] = true;
        
        emit EpochProcessed(epoch, totalEmission, validatorsAmount, pouwAmount, treasuryAmount, governanceAmount);
    }
    
    /**
     * @dev Process current epoch
     */
    function processCurrentEpoch() external onlyRole(EMITTER_ROLE) {
        uint256 currentEpoch = getCurrentEpoch();
        processEpoch(currentEpoch);
    }
    
    /**
     * @dev Get PoUW budget for epoch
     */
    function getPouwBudget(uint256 epoch) external view returns (uint256) {
        return pouwBudget[epoch];
    }
}

