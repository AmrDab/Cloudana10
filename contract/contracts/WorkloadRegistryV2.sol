// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./CLDToken.sol";

contract WorkloadRegistryV2 is Initializable, OwnableUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable {
    CLDToken public cldToken;
    
    // Platform fee (basis points, 250 = 2.5%)
    uint256 public platformFeeBps;
    address public feeCollector;
    
    enum WorkloadStatus {
        Pending,    // 0: Job submitted, waiting for provider
        Running,    // 1: Provider accepted and executing
        Complete,   // 2: Successfully completed
        Failed      // 3: Execution failed
    }
    
    struct Workload {
        address user;           // User who submitted the job
        address provider;       // Provider executing the job
        bytes32 specHash;       // IPFS hash of workload specification
        uint256 payment;        // Total payment in CLD
        WorkloadStatus status;  // Current status
        bytes32 resultHash;     // IPFS hash of execution results
        uint256 createdAt;      // Block timestamp when created
        uint256 startedAt;      // Block timestamp when execution started
        uint256 completedAt;    // Block timestamp when completed
    }
    
    mapping(uint256 => Workload) public workloads;
    uint256 public workloadCounter;
    
    // Provider reputation tracking
    mapping(address => uint256) public providerJobsCompleted;
    mapping(address => uint256) public providerJobsFailed;
    mapping(address => uint256) public providerTotalEarnings;
    
    // User spending tracking
    mapping(address => uint256) public userTotalSpent;
    
    // Events
    event WorkloadCreated(
        uint256 indexed workloadId,
        address indexed user,
        bytes32 specHash,
        uint256 payment
    );
    
    event WorkloadStarted(
        uint256 indexed workloadId,
        address indexed provider
    );
    
    event WorkloadCompleted(
        uint256 indexed workloadId,
        address indexed provider,
        bytes32 resultHash
    );
    
    event WorkloadFailed(
        uint256 indexed workloadId,
        address indexed provider,
        string reason
    );
    
    event PaymentClaimed(
        uint256 indexed workloadId,
        address indexed provider,
        uint256 amount,
        uint256 platformFee
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _cldToken,
        uint256 _platformFeeBps,
        address _feeCollector
    ) public initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();
        __ReentrancyGuard_init();
        
        cldToken = CLDToken(_cldToken);
        platformFeeBps = _platformFeeBps;
        feeCollector = _feeCollector;
    }

    /**
     * @notice Create a new workload
     * @param specHash IPFS hash of the workload specification
     * @param payment Payment amount in CLD tokens
     */
    function createWorkload(
        bytes32 specHash,
        uint256 payment
    ) external whenNotPaused nonReentrant returns (uint256) {
        require(specHash != bytes32(0), "Invalid spec hash");
        require(payment > 0, "Payment must be greater than 0");
        
        // Transfer payment from user to contract
        require(
            cldToken.transferFrom(msg.sender, address(this), payment),
            "Payment transfer failed"
        );
        
        uint256 workloadId = workloadCounter++;
        
        workloads[workloadId] = Workload({
            user: msg.sender,
            provider: address(0),
            specHash: specHash,
            payment: payment,
            status: WorkloadStatus.Pending,
            resultHash: bytes32(0),
            createdAt: block.timestamp,
            startedAt: 0,
            completedAt: 0
        });
        
        userTotalSpent[msg.sender] += payment;
        
        emit WorkloadCreated(workloadId, msg.sender, specHash, payment);
        
        return workloadId;
    }

    /**
     * @notice Accept a workload for execution (provider only)
     * @param workloadId ID of the workload to accept
     */
    function acceptWorkload(uint256 workloadId) external whenNotPaused {
        Workload storage workload = workloads[workloadId];
        require(workload.status == WorkloadStatus.Pending, "Workload not pending");
        require(workload.user != address(0), "Workload does not exist");
        
        workload.provider = msg.sender;
        workload.status = WorkloadStatus.Running;
        workload.startedAt = block.timestamp;
        
        emit WorkloadStarted(workloadId, msg.sender);
    }

    /**
     * @notice Submit workload execution result
     * @param workloadId ID of the workload
     * @param resultHash IPFS hash of execution results
     */
    function executeWorkload(
        uint256 workloadId,
        bytes32 resultHash
    ) external whenNotPaused {
        Workload storage workload = workloads[workloadId];
        require(workload.status == WorkloadStatus.Running, "Workload not running");
        require(workload.provider == msg.sender, "Not the assigned provider");
        require(resultHash != bytes32(0), "Invalid result hash");
        
        workload.status = WorkloadStatus.Complete;
        workload.resultHash = resultHash;
        workload.completedAt = block.timestamp;
        
        providerJobsCompleted[msg.sender]++;
        
        emit WorkloadCompleted(workloadId, msg.sender, resultHash);
    }

    /**
     * @notice Mark workload as failed
     * @param workloadId ID of the workload
     * @param reason Reason for failure
     */
    function markWorkloadFailed(
        uint256 workloadId,
        string calldata reason
    ) external whenNotPaused {
        Workload storage workload = workloads[workloadId];
        require(workload.status == WorkloadStatus.Running, "Workload not running");
        require(workload.provider == msg.sender, "Not the assigned provider");
        
        workload.status = WorkloadStatus.Failed;
        workload.completedAt = block.timestamp;
        
        providerJobsFailed[msg.sender]++;
        
        emit WorkloadFailed(workloadId, msg.sender, reason);
    }

    /**
     * @notice Claim payment after successful execution
     * @param workloadId ID of the completed workload
     */
    function claimPayment(uint256 workloadId) external nonReentrant {
        Workload storage workload = workloads[workloadId];
        require(workload.status == WorkloadStatus.Complete, "Workload not completed");
        require(workload.provider == msg.sender, "Not the provider");
        
        uint256 totalPayment = workload.payment;
        uint256 platformFee = (totalPayment * platformFeeBps) / 10000;
        uint256 providerPayment = totalPayment - platformFee;
        
        // Mark as claimed by setting payment to 0
        workload.payment = 0;
        
        // Update provider stats
        providerTotalEarnings[msg.sender] += providerPayment;
        
        // Transfer payments
        if (platformFee > 0) {
            require(cldToken.transfer(feeCollector, platformFee), "Platform fee transfer failed");
        }
        require(cldToken.transfer(msg.sender, providerPayment), "Provider payment failed");
        
        emit PaymentClaimed(workloadId, msg.sender, providerPayment, platformFee);
    }

    /**
     * @notice Request refund for failed workload (user only)
     * @param workloadId ID of the failed workload
     */
    function requestRefund(uint256 workloadId) external nonReentrant {
        Workload storage workload = workloads[workloadId];
        require(workload.user == msg.sender, "Not the workload owner");
        require(workload.status == WorkloadStatus.Failed, "Workload not failed");
        require(workload.payment > 0, "Already refunded");
        
        uint256 refundAmount = workload.payment;
        workload.payment = 0;
        
        require(cldToken.transfer(msg.sender, refundAmount), "Refund transfer failed");
    }

    /**
     * @notice Get workload details
     */
    function getWorkload(uint256 workloadId) external view returns (
        address user,
        address provider,
        bytes32 specHash,
        uint256 payment,
        WorkloadStatus status,
        bytes32 resultHash,
        uint256 createdAt,
        uint256 startedAt,
        uint256 completedAt
    ) {
        Workload memory workload = workloads[workloadId];
        return (
            workload.user,
            workload.provider,
            workload.specHash,
            workload.payment,
            workload.status,
            workload.resultHash,
            workload.createdAt,
            workload.startedAt,
            workload.completedAt
        );
    }

    /**
     * @notice Get all pending workloads (for providers)
     */
    function getPendingWorkloads() external view returns (uint256[] memory) {
        uint256 pendingCount = 0;
        
        // Count pending workloads
        for (uint256 i = 0; i < workloadCounter; i++) {
            if (workloads[i].status == WorkloadStatus.Pending) {
                pendingCount++;
            }
        }
        
        uint256[] memory pendingIds = new uint256[](pendingCount);
        uint256 index = 0;
        
        // Collect pending workload IDs
        for (uint256 i = 0; i < workloadCounter; i++) {
            if (workloads[i].status == WorkloadStatus.Pending) {
                pendingIds[index] = i;
                index++;
            }
        }
        
        return pendingIds;
    }

    /**
     * @notice Get provider reputation metrics
     */
    function getProviderStats(address provider) external view returns (
        uint256 jobsCompleted,
        uint256 jobsFailed,
        uint256 totalEarnings,
        uint256 successRate
    ) {
        uint256 completed = providerJobsCompleted[provider];
        uint256 failed = providerJobsFailed[provider];
        uint256 total = completed + failed;
        uint256 rate = total > 0 ? (completed * 10000) / total : 0; // Basis points
        
        return (completed, failed, providerTotalEarnings[provider], rate);
    }

    /**
     * @notice Get user spending metrics
     */
    function getUserStats(address user) external view returns (uint256 totalSpent) {
        return userTotalSpent[user];
    }

    /**
     * @notice Get total workload count
     */
    function getJobCount() external view returns (uint256) {
        return workloadCounter;
    }

    // Admin functions
    function setPlatformFee(uint256 _platformFeeBps) external onlyOwner {
        require(_platformFeeBps <= 1000, "Fee too high (max 10%)");
        platformFeeBps = _platformFeeBps;
    }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        require(_feeCollector != address(0), "Invalid address");
        feeCollector = _feeCollector;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // Emergency functions
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            payable(owner()).transfer(amount);
        } else {
            IERC20(token).transfer(owner(), amount);
        }
    }
}