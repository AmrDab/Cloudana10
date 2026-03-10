// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title RewardContract
 * @dev MVP reward distribution (no validation). Orchestrator calls rewardProvider; providers withdraw.
 */
contract RewardContract is ReentrancyGuard, AccessControl {
    bytes32 public constant ORCHESTRATOR_ROLE = keccak256("ORCHESTRATOR_ROLE");

    IERC20 public immutable settlementToken;

    mapping(address => uint256) public providerPendingRewards;
    mapping(uint256 => uint256) public workloadDeposits;
    mapping(address => mapping(uint256 => uint256)) public providerWorkloadPayments;

    event WorkloadFunded(
        uint256 indexed workloadId,
        address indexed user,
        uint256 amount,
        uint256 timestamp
    );
    event ProviderRewarded(
        address indexed provider,
        uint256 amount,
        uint256 indexed workloadId,
        uint256 timestamp
    );
    event EarningsWithdrawn(
        address indexed provider,
        uint256 amount,
        uint256 timestamp
    );
    event WorkloadRefunded(
        uint256 indexed workloadId,
        address indexed user,
        uint256 amount,
        uint256 timestamp
    );

    constructor(address _settlementToken) {
        require(_settlementToken != address(0), "Invalid token");
        settlementToken = IERC20(_settlementToken);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function fundWorkload(uint256 workloadId, uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(
            settlementToken.transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );
        workloadDeposits[workloadId] += amount;
        emit WorkloadFunded(workloadId, msg.sender, amount, block.timestamp);
    }

    function rewardProvider(
        address provider,
        uint256 workloadId,
        uint256 amount
    ) external onlyRole(ORCHESTRATOR_ROLE) nonReentrant {
        require(provider != address(0), "Invalid provider");
        require(amount > 0, "Amount must be > 0");
        require(
            workloadDeposits[workloadId] >= amount,
            "Insufficient workload deposit"
        );

        workloadDeposits[workloadId] -= amount;
        providerPendingRewards[provider] += amount;
        providerWorkloadPayments[provider][workloadId] += amount;

        emit ProviderRewarded(provider, amount, workloadId, block.timestamp);
    }

    function batchRewardProviders(
        address[] calldata providersList,
        uint256[] calldata workloadIds,
        uint256[] calldata amounts
    ) external onlyRole(ORCHESTRATOR_ROLE) nonReentrant {
        require(
            providersList.length == workloadIds.length &&
                providersList.length == amounts.length,
            "Length mismatch"
        );

        uint256 totalReward = 0;
        for (uint256 i = 0; i < providersList.length; i++) {
            require(providersList[i] != address(0), "Invalid provider");
            require(amounts[i] > 0, "Amount must be > 0");
            require(
                workloadDeposits[workloadIds[i]] >= amounts[i],
                "Insufficient workload deposit"
            );

            workloadDeposits[workloadIds[i]] -= amounts[i];
            providerPendingRewards[providersList[i]] += amounts[i];
            providerWorkloadPayments[providersList[i]][workloadIds[i]] += amounts[i];
            totalReward += amounts[i];

            emit ProviderRewarded(
                providersList[i],
                amounts[i],
                workloadIds[i],
                block.timestamp
            );
        }
    }

    function withdrawEarnings() external nonReentrant {
        uint256 amount = providerPendingRewards[msg.sender];
        require(amount > 0, "No pending rewards");

        providerPendingRewards[msg.sender] = 0;
        require(
            settlementToken.transfer(msg.sender, amount),
            "Transfer failed"
        );
        emit EarningsWithdrawn(msg.sender, amount, block.timestamp);
    }

    function refundWorkload(uint256 workloadId, address user)
        external
        onlyRole(ORCHESTRATOR_ROLE)
        nonReentrant
    {
        uint256 remaining = workloadDeposits[workloadId];
        require(remaining > 0, "No refund available");
        require(user != address(0), "Invalid user");

        workloadDeposits[workloadId] = 0;
        require(
            settlementToken.transfer(user, remaining),
            "Transfer failed"
        );
        emit WorkloadRefunded(workloadId, user, remaining, block.timestamp);
    }
}
