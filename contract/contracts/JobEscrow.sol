// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./CLDToken.sol";
import "./Config.sol";
import "./ProviderRegistry.sol";

/**
 * @title JobEscrow
 * @dev Manages user job deposits and provider rewards from escrow
 */
contract JobEscrow is AccessControl, ReentrancyGuard {
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    
    CLDToken public immutable token;
    Config public immutable config;
    ProviderRegistry public immutable providerRegistry;
    
    struct Job {
        address user;
        address provider;
        uint256 depositAmount;
        uint256 remainingBalance;
        uint256 createdAt;
        bool isActive;
        bool isCompleted;
    }
    
    mapping(bytes32 => Job) public jobs;
    mapping(address => bytes32[]) public userJobs;
    mapping(address => bytes32[]) public providerJobs;
    
    // Job ID counter (or use hash of user+provider+timestamp)
    uint256 public jobCounter;
    
    event JobCreated(
        bytes32 indexed jobId,
        address indexed user,
        address indexed provider,
        uint256 depositAmount
    );
    event JobCompleted(bytes32 indexed jobId, address indexed user, address indexed provider);
    event JobCancelled(bytes32 indexed jobId, address indexed user, address indexed provider);
    event BalanceRefunded(
        bytes32 indexed jobId,
        address indexed user,
        uint256 refundAmount,
        uint256 fee
    );
    event ProviderRewardPaid(
        bytes32 indexed jobId,
        address indexed provider,
        uint256 rewardAmount
    );
    event BalanceDeducted(
        bytes32 indexed jobId,
        uint256 amount,
        uint256 newBalance
    );
    
    constructor(
        address _token,
        address _config,
        address _providerRegistry
    ) {
        require(_token != address(0), "JobEscrow: Invalid token");
        require(_config != address(0), "JobEscrow: Invalid config");
        require(_providerRegistry != address(0), "JobEscrow: Invalid provider registry");
        
        token = CLDToken(_token);
        config = Config(_config);
        providerRegistry = ProviderRegistry(_providerRegistry);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VALIDATOR_ROLE, msg.sender);
        _grantRole(RELAYER_ROLE, msg.sender);
    }
    
    /**
     * @dev Create a job with CLD deposit
     * @param provider Provider address
     * @param depositAmount Amount of CLD to deposit
     */
    function createJob(address provider, uint256 depositAmount) external nonReentrant {
        require(provider != address(0), "JobEscrow: Invalid provider");
        require(
            providerRegistry.isProviderActive(provider),
            "JobEscrow: Provider not active"
        );
        require(depositAmount >= config.minJobDeposit(), "JobEscrow: Insufficient deposit");
        
        // Transfer CLD from user
        require(
            token.transferFrom(msg.sender, address(this), depositAmount),
            "JobEscrow: Transfer failed"
        );
        
        bytes32 jobId = keccak256(
            abi.encodePacked(msg.sender, provider, block.timestamp, jobCounter++)
        );
        
        jobs[jobId] = Job({
            user: msg.sender,
            provider: provider,
            depositAmount: depositAmount,
            remainingBalance: depositAmount,
            createdAt: block.timestamp,
            isActive: true,
            isCompleted: false
        });
        
        userJobs[msg.sender].push(jobId);
        providerJobs[provider].push(jobId);
        
        emit JobCreated(jobId, msg.sender, provider, depositAmount);
    }
    
    /**
     * @dev Complete job and pay provider reward
     * @param jobId Job ID
     * @param rewardAmount Amount to pay provider (from remaining balance)
     */
    function completeJob(bytes32 jobId, uint256 rewardAmount) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.isActive, "JobEscrow: Job not active");
        require(job.user == msg.sender || hasRole(VALIDATOR_ROLE, msg.sender), "JobEscrow: Unauthorized");
        require(rewardAmount <= job.remainingBalance, "JobEscrow: Reward exceeds balance");
        
        job.isActive = false;
        job.isCompleted = true;
        
        uint256 refundAmount = job.remainingBalance - rewardAmount;
        
        // Pay provider reward
        if (rewardAmount > 0) {
            require(
                token.transfer(job.provider, rewardAmount),
                "JobEscrow: Provider transfer failed"
            );
            
            // Track reward in provider registry
            providerRegistry.addReward(job.provider, 0, rewardAmount);
            
            emit ProviderRewardPaid(jobId, job.provider, rewardAmount);
        }
        
        // Refund remaining balance to user (with fee)
        if (refundAmount > 0) {
            uint256 fee = (refundAmount * config.jobRefundFeeBps()) / 10000;
            uint256 refundAfterFee = refundAmount - fee;
            
            require(
                token.transfer(job.user, refundAfterFee),
                "JobEscrow: Refund transfer failed"
            );
            
            emit BalanceRefunded(jobId, job.user, refundAfterFee, fee);
        }
        
        emit JobCompleted(jobId, job.user, job.provider);
    }
    
    /**
     * @dev Cancel job and refund (only validator or user)
     * @param jobId Job ID
     */
    function cancelJob(bytes32 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.isActive, "JobEscrow: Job not active");
        require(
            job.user == msg.sender || hasRole(VALIDATOR_ROLE, msg.sender),
            "JobEscrow: Unauthorized"
        );
        
        job.isActive = false;
        job.isCompleted = false;
        
        // Refund with fee
        uint256 refundAmount = job.remainingBalance;
        if (refundAmount > 0) {
            uint256 fee = (refundAmount * config.jobRefundFeeBps()) / 10000;
            uint256 refundAfterFee = refundAmount - fee;
            
            require(
                token.transfer(job.user, refundAfterFee),
                "JobEscrow: Refund transfer failed"
            );
            
            emit BalanceRefunded(jobId, job.user, refundAfterFee, fee);
        }
        
        emit JobCancelled(jobId, job.user, job.provider);
    }
    
    /**
     * @dev Deduct balance from job (called by validator/backend when balance insufficient)
     * @param jobId Job ID
     * @param amount Amount to deduct
     */
    function deductBalance(bytes32 jobId, uint256 amount) external onlyRole(VALIDATOR_ROLE) {
        Job storage job = jobs[jobId];
        require(job.isActive, "JobEscrow: Job not active");
        require(amount <= job.remainingBalance, "JobEscrow: Amount exceeds balance");
        
        job.remainingBalance -= amount;
        
        emit BalanceDeducted(jobId, amount, job.remainingBalance);
        
        // Auto-cancel if balance too low
        if (job.remainingBalance < config.minJobDeposit()) {
            job.isActive = false;
            emit JobCancelled(jobId, job.user, job.provider);
        }
    }
    
    /**
     * @dev Get job info
     */
    function getJob(bytes32 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }
    
    /**
     * @dev Get user's jobs
     */
    function getUserJobs(address user) external view returns (bytes32[] memory) {
        return userJobs[user];
    }
    
    /**
     * @dev Get provider's jobs
     */
    function getProviderJobs(address provider) external view returns (bytes32[] memory) {
        return providerJobs[provider];
    }
}

