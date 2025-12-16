// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./CLDToken.sol";
import "./EmissionController.sol";

/**
 * @title MerkleRewardsPoUW
 * @dev PoUW rewards distribution via Merkle roots
 * Mint-on-claim mechanism for gas efficiency
 */
contract MerkleRewardsPoUW is AccessControl {
    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");
    
    CLDToken public immutable token;
    EmissionController public immutable emissionController;
    
    // Epoch -> Merkle root
    mapping(uint256 => bytes32) public merkleRoots;
    // Epoch -> Total amount in root
    mapping(uint256 => uint256) public rootTotalAmounts;
    // Epoch -> Claimed total
    mapping(uint256 => uint256) public claimedTotal;
    // Epoch -> Provider -> Claimed
    mapping(uint256 => mapping(address => bool)) public claimed;
    
    event RootPublished(uint256 indexed epoch, bytes32 root, uint256 totalAmount);
    event RewardClaimed(uint256 indexed epoch, address indexed provider, uint256 amount);
    
    constructor(address _token, address _emissionController) {
        require(_token != address(0), "MerkleRewardsPoUW: Invalid token");
        require(_emissionController != address(0), "MerkleRewardsPoUW: Invalid emission controller");
        
        token = CLDToken(_token);
        emissionController = EmissionController(_emissionController);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SETTLER_ROLE, msg.sender);
    }
    
    /**
     * @dev Publish merkle root for epoch (only settler/validator)
     * @param epoch Epoch index
     * @param root Merkle root
     * @param totalAmount Total amount of rewards in this root
     */
    function setRoot(uint256 epoch, bytes32 root, uint256 totalAmount) external onlyRole(SETTLER_ROLE) {
        require(root != bytes32(0), "MerkleRewardsPoUW: Invalid root");
        require(merkleRoots[epoch] == bytes32(0), "MerkleRewardsPoUW: Root already set");
        
        // Check budget constraint
        uint256 budget = emissionController.getPouwBudget(epoch);
        require(totalAmount <= budget, "MerkleRewardsPoUW: Total amount exceeds budget");
        
        merkleRoots[epoch] = root;
        rootTotalAmounts[epoch] = totalAmount;
        
        emit RootPublished(epoch, root, totalAmount);
    }
    
    /**
     * @dev Claim reward for provider
     * @param epoch Epoch index
     * @param amount Reward amount
     * @param proof Merkle proof
     */
    function claim(uint256 epoch, uint256 amount, bytes32[] calldata proof) external {
        require(merkleRoots[epoch] != bytes32(0), "MerkleRewardsPoUW: Root not set");
        require(!claimed[epoch][msg.sender], "MerkleRewardsPoUW: Already claimed");
        require(amount > 0, "MerkleRewardsPoUW: Invalid amount");
        
        // Verify merkle proof
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, amount));
        require(
            MerkleProof.verify(proof, merkleRoots[epoch], leaf),
            "MerkleRewardsPoUW: Invalid proof"
        );
        
        // Check budget constraint
        require(
            claimedTotal[epoch] + amount <= rootTotalAmounts[epoch],
            "MerkleRewardsPoUW: Claim exceeds root total"
        );
        
        // Mark as claimed
        claimed[epoch][msg.sender] = true;
        claimedTotal[epoch] += amount;
        
        // Mint tokens to provider (mint-on-claim)
        token.mint(msg.sender, amount);
        
        emit RewardClaimed(epoch, msg.sender, amount);
    }
    
    /**
     * @dev Check if provider has claimed for epoch
     */
    function hasClaimed(uint256 epoch, address provider) external view returns (bool) {
        return claimed[epoch][provider];
    }
    
    /**
     * @dev Get remaining claimable amount for epoch
     */
    function getRemainingClaimable(uint256 epoch) external view returns (uint256) {
        uint256 total = rootTotalAmounts[epoch];
        uint256 claimedAmount = claimedTotal[epoch];
        return total > claimedAmount ? total - claimedAmount : 0;
    }
}

