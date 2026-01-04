// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./CLDToken.sol";
import "./ProviderRegistry.sol";

/**
 * @title JobEscrow
 * @dev Escrow contract for job payments with usage reporting via EIP-712 signatures
 */
contract JobEscrow is AccessControl, ReentrancyGuard, EIP712 {
    CLDToken public immutable cldToken;
    ProviderRegistry public immutable providerRegistry;

    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");

    bytes32 private constant USAGE_REPORT_TYPEHASH =
        keccak256(
            "UsageReport(uint256 jobId,address user,bytes32 providerkey,uint256 grossCost,uint256 providerEarn,uint256 nonce,uint256 deadline)"
        );

    enum JobStatus {
        OPEN,
        CLOSED
    }

    struct Job {
        address user;
        bytes32 providerkey;
        uint256 deposited;
        uint256 spent;
        uint256 nonce;
        JobStatus status;
        uint64 createdAt;
        uint64 closedAt;
    }

    struct UsageReport {
        uint256 jobId;
        address user;
        bytes32 providerkey;
        uint256 grossCost;
        uint256 providerEarn;
        uint256 nonce;
        uint256 deadline;
    }

    mapping(uint256 => Job) public jobs;
    mapping(address => uint256) public providerCredit;
    mapping(address => uint256) public userRefundCredit;

    uint256 public nextJobId;

    error ProviderNotActive(bytes32 providerkey);
    error JobNotFound(uint256 jobId);
    error JobNotOpen(uint256 jobId);
    error InvalidSignature();
    error InvalidNonce(uint256 expected, uint256 provided);
    error InvalidUser(address expected, address provided);
    error InvalidProvider(bytes32 expected, bytes32 provided);
    error DeadlineExceeded(uint256 deadline, uint256 current);
    error InsufficientDeposit(uint256 required, uint256 available);
    error InvalidProviderEarn(uint256 grossCost, uint256 providerEarn);
    error NoCreditToWithdraw(address account);
    error UnauthorizedCloser(address caller, address user, bytes32 providerkey);

    event JobCreated(
        uint256 indexed jobId,
        address indexed user,
        bytes32 indexed providerkey,
        uint256 budgetAmount
    );
    event JobDeposited(uint256 indexed jobId, uint256 amount);
    event UsageSubmitted(
        uint256 indexed jobId,
        uint256 grossCost,
        uint256 providerEarn,
        uint256 refund,
        uint256 nonceAfter
    );
    event JobClosed(uint256 indexed jobId, uint256 remaining);
    event ProviderWithdrawn(address indexed provider, uint256 amount);
    event UserRefundWithdrawn(address indexed user, uint256 amount);

    constructor(
        address _cldToken,
        address _providerRegistry
    ) EIP712("CloudanaJobEscrow", "1") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        cldToken = CLDToken(_cldToken);
        providerRegistry = ProviderRegistry(_providerRegistry);
    }

    /**
     * @dev Create a new job with initial budget
     * @param providerkey Provider key (must be registered and active)
     * @param budgetAmount Initial CLD deposit amount
     * @return jobId The created job ID
     */
    function createJob(
        bytes32 providerkey,
        uint256 budgetAmount
    ) external returns (uint256 jobId) {
        ProviderRegistry.Provider memory providerInfo = providerRegistry.getProvider(
            providerkey
        );
        if (providerInfo.owner == address(0) || providerInfo.status != ProviderRegistry.ProviderStatus.Active) {
            revert ProviderNotActive(providerkey);
        }

        if (budgetAmount > 0) {
            bool success = cldToken.transferFrom(
                msg.sender,
                address(this),
                budgetAmount
            );
            require(success, "Transfer failed");
        }

        jobId = nextJobId++;
        jobs[jobId] = Job({
            user: msg.sender,
            providerkey: providerkey,
            deposited: budgetAmount,
            spent: 0,
            nonce: 0,
            status: JobStatus.OPEN,
            createdAt: uint64(block.timestamp),
            closedAt: 0
        });

        emit JobCreated(jobId, msg.sender, providerkey, budgetAmount);
        return jobId;
    }

    /**
     * @dev Deposit additional funds to an open job
     * @param jobId Job ID
     * @param amount Amount to deposit
     */
    function deposit(uint256 jobId, uint256 amount) external {
        Job storage job = jobs[jobId];
        if (job.user == address(0)) {
            revert JobNotFound(jobId);
        }
        if (job.user != msg.sender) {
            revert UnauthorizedCloser(msg.sender, job.user, job.providerkey);
        }
        if (job.status != JobStatus.OPEN) {
            revert JobNotOpen(jobId);
        }

        bool success = cldToken.transferFrom(
            msg.sender,
            address(this),
            amount
        );
        require(success, "Transfer failed");

        job.deposited += amount;
        emit JobDeposited(jobId, amount);
    }

    /**
     * @dev Submit a usage report with validator signature
     * @param r UsageReport struct
     * @param sig EIP-712 signature from validator
     */
    function submitUsageReport(
        UsageReport calldata r,
        bytes calldata sig
    ) external {
        Job storage job = jobs[r.jobId];
        if (job.user == address(0)) {
            revert JobNotFound(r.jobId);
        }
        if (job.status != JobStatus.OPEN) {
            revert JobNotOpen(r.jobId);
        }
        if (job.user != r.user) {
            revert InvalidUser(job.user, r.user);
        }
        if (job.providerkey != r.providerkey) {
            revert InvalidProvider(job.providerkey, r.providerkey);
        }
        if (job.nonce != r.nonce) {
            revert InvalidNonce(job.nonce, r.nonce);
        }
        if (r.deadline > 0 && block.timestamp > r.deadline) {
            revert DeadlineExceeded(r.deadline, block.timestamp);
        }
        if (job.spent + r.grossCost > job.deposited) {
            revert InsufficientDeposit(
                job.spent + r.grossCost,
                job.deposited
            );
        }
        if (r.providerEarn > r.grossCost) {
            revert InvalidProviderEarn(r.grossCost, r.providerEarn);
        }

        // Verify EIP-712 signature
        bytes32 structHash = keccak256(
            abi.encode(
                USAGE_REPORT_TYPEHASH,
                r.jobId,
                r.user,
                r.providerkey,
                r.grossCost,
                r.providerEarn,
                r.nonce,
                r.deadline
            )
        );
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(hash, sig);

        if (!hasRole(VALIDATOR_ROLE, signer)) {
            revert InvalidSignature();
        }

        // Update state (checks-effects-interactions)
        job.spent += r.grossCost;
        // Get provider owner for credit tracking
        ProviderRegistry.Provider memory providerInfo = providerRegistry.getProvider(r.providerkey);
        providerCredit[providerInfo.owner] += r.providerEarn;
        uint256 refund = r.grossCost - r.providerEarn;
        userRefundCredit[r.user] += refund;
        job.nonce++;

        emit UsageSubmitted(
            r.jobId,
            r.grossCost,
            r.providerEarn,
            refund,
            job.nonce
        );
    }

    /**
     * @dev Close a job and refund remaining deposit
     * @param jobId Job ID
     */
    function closeJob(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (job.user == address(0)) {
            revert JobNotFound(jobId);
        }
        if (job.status != JobStatus.OPEN) {
            revert JobNotOpen(jobId);
        }

        // Get provider info to check owner
        ProviderRegistry.Provider memory providerInfo = providerRegistry.getProvider(job.providerkey);
        
        // Only user, provider owner, or admin can close
        bool canClose =
            msg.sender == job.user ||
            msg.sender == providerInfo.owner ||
            hasRole(DEFAULT_ADMIN_ROLE, msg.sender);

        if (!canClose) {
            revert UnauthorizedCloser(msg.sender, job.user, job.providerkey);
        }

        uint256 remaining = job.deposited - job.spent;
        if (remaining > 0) {
            userRefundCredit[job.user] += remaining;
        }

        job.status = JobStatus.CLOSED;
        job.closedAt = uint64(block.timestamp);

        emit JobClosed(jobId, remaining);
    }

    /**
     * @dev Withdraw accumulated provider credits
     */
    function withdrawProvider() external nonReentrant {
        uint256 amount = providerCredit[msg.sender];
        if (amount == 0) {
            revert NoCreditToWithdraw(msg.sender);
        }

        providerCredit[msg.sender] = 0;
        bool success = cldToken.transfer(msg.sender, amount);
        require(success, "Transfer failed");

        emit ProviderWithdrawn(msg.sender, amount);
    }

    /**
     * @dev Withdraw accumulated user refund credits
     */
    function withdrawUserRefund() external nonReentrant {
        uint256 amount = userRefundCredit[msg.sender];
        if (amount == 0) {
            revert NoCreditToWithdraw(msg.sender);
        }

        userRefundCredit[msg.sender] = 0;
        bool success = cldToken.transfer(msg.sender, amount);
        require(success, "Transfer failed");

        emit UserRefundWithdrawn(msg.sender, amount);
    }
}

