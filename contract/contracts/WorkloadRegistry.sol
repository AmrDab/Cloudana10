// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./libraries/WorkloadLib.sol";

/**
 * @title WorkloadRegistry
 * @dev Workload registration keyed by workloadId. On-chain we store only metadataUri (IPFS CID or URL);
 *      full manifest and requirements are on IPFS. Mirror of ProviderRegistry for consistent register/update/deregister/activate UX.
 */
contract WorkloadRegistry is AccessControl {
    bytes32 public constant ORCHESTRATOR_ROLE = keccak256("ORCHESTRATOR_ROLE");

    mapping(uint256 => WorkloadLib.Workload) public workloads;
    mapping(address => uint256[]) public ownerWorkloadIds;
    uint256[] public workloadIdList;
    mapping(uint256 => uint256) public workloadIdListIndex;
    uint256 public nextWorkloadId;

    event WorkloadRegistered(
        uint256 indexed workloadId,
        address indexed owner,
        string metadataUri,
        uint256 timestamp
    );
    event WorkloadUpdated(
        uint256 indexed workloadId,
        string metadataUri,
        uint256 timestamp
    );
    event WorkloadDeregistered(uint256 indexed workloadId, address indexed owner, uint256 timestamp);
    event WorkloadActivated(uint256 indexed workloadId, address indexed owner, uint256 timestamp);
    event WorkloadDeleted(uint256 indexed workloadId, address indexed owner, uint256 timestamp);
    event WorkloadPlaced(
        uint256 indexed workloadId,
        address indexed provider,
        uint256 instanceId,
        uint256 timestamp
    );

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /** Register a new workload. Full manifest/requirements at metadataUri (IPFS or URL). */
    function registerWorkload(string calldata metadataUri) external returns (uint256 workloadId) {
        require(bytes(metadataUri).length > 0, "Metadata URI required");

        workloadId = nextWorkloadId++;
        workloads[workloadId] = WorkloadLib.Workload({
            id: workloadId,
            owner: msg.sender,
            metadataUri: metadataUri,
            status: WorkloadLib.WorkloadStatus.Active,
            registeredAt: block.timestamp,
            updatedAt: block.timestamp,
            placementProvider: address(0),
            placementInstanceId: 0
        });

        ownerWorkloadIds[msg.sender].push(workloadId);
        workloadIdList.push(workloadId);
        workloadIdListIndex[workloadId] = workloadIdList.length - 1;

        emit WorkloadRegistered(workloadId, msg.sender, metadataUri, block.timestamp);
        return workloadId;
    }

    /** Update workload metadata URI (owner only). */
    function updateWorkload(uint256 workloadId, string calldata newMetadataUri) external {
        WorkloadLib.Workload storage w = workloads[workloadId];
        require(w.owner == msg.sender, "Not workload owner");
        require(w.status != WorkloadLib.WorkloadStatus.Inactive, "Workload is deregistered");
        require(bytes(newMetadataUri).length > 0, "Metadata URI required");

        w.metadataUri = newMetadataUri;
        w.updatedAt = block.timestamp;
        emit WorkloadUpdated(workloadId, newMetadataUri, block.timestamp);
    }

    /** Deregister workload (set inactive). Owner can activate again later. */
    function deregisterWorkload(uint256 workloadId) external {
        WorkloadLib.Workload storage w = workloads[workloadId];
        require(w.owner == msg.sender, "Not workload owner");
        w.status = WorkloadLib.WorkloadStatus.Inactive;
        w.updatedAt = block.timestamp;
        emit WorkloadDeregistered(workloadId, msg.sender, block.timestamp);
    }

    /** Reactivate a deregistered workload. */
    function activateWorkload(uint256 workloadId) external {
        WorkloadLib.Workload storage w = workloads[workloadId];
        require(w.owner == msg.sender, "Not workload owner");
        require(w.status == WorkloadLib.WorkloadStatus.Inactive, "Workload must be inactive to activate");
        w.status = WorkloadLib.WorkloadStatus.Active;
        w.updatedAt = block.timestamp;
        emit WorkloadActivated(workloadId, msg.sender, block.timestamp);
    }

    /** Permanently delete workload (only inactive workloads can be deleted). */
    function deleteWorkload(uint256 workloadId) external {
        WorkloadLib.Workload storage w = workloads[workloadId];
        require(w.owner == msg.sender, "Not workload owner");
        require(w.status == WorkloadLib.WorkloadStatus.Inactive, "Workload must be inactive to delete");
        
        // Remove from workloadIdList
        uint256 index = workloadIdListIndex[workloadId];
        uint256 lastIndex = workloadIdList.length - 1;
        if (index != lastIndex) {
            uint256 lastWorkloadId = workloadIdList[lastIndex];
            workloadIdList[index] = lastWorkloadId;
            workloadIdListIndex[lastWorkloadId] = index;
        }
        workloadIdList.pop();
        delete workloadIdListIndex[workloadId];
        
        // Remove from ownerWorkloadIds
        uint256[] storage ownerIds = ownerWorkloadIds[msg.sender];
        for (uint256 i = 0; i < ownerIds.length; i++) {
            if (ownerIds[i] == workloadId) {
                ownerIds[i] = ownerIds[ownerIds.length - 1];
                ownerIds.pop();
                break;
            }
        }
        
        // Delete workload data
        delete workloads[workloadId];
        
        emit WorkloadDeleted(workloadId, msg.sender, block.timestamp);
    }

    /** Called by orchestrator to record placement (one provider/instance per workload). */
    function recordPlacement(
        uint256 workloadId,
        address provider,
        uint256 instanceId
    ) external onlyRole(ORCHESTRATOR_ROLE) {
        WorkloadLib.Workload storage w = workloads[workloadId];
        require(w.owner != address(0), "Workload does not exist");
        require(w.status == WorkloadLib.WorkloadStatus.Active, "Workload must be active");
        require(provider != address(0), "Invalid provider");

        w.placementProvider = provider;
        w.placementInstanceId = instanceId;
        w.updatedAt = block.timestamp;
        emit WorkloadPlaced(workloadId, provider, instanceId, block.timestamp);
    }

    function getWorkload(uint256 workloadId) external view returns (WorkloadLib.Workload memory) {
        return workloads[workloadId];
    }

    function getWorkloadsByOwner(address owner) external view returns (uint256[] memory) {
        return ownerWorkloadIds[owner];
    }

    /** Alias for UI compatibility. */
    function getUserWorkloads(address user) external view returns (uint256[] memory) {
        return ownerWorkloadIds[user];
    }

    function getWorkloadCount() external view returns (uint256) {
        return nextWorkloadId;
    }

    function getActiveWorkloadIds() external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < workloadIdList.length; i++) {
            if (workloads[workloadIdList[i]].status == WorkloadLib.WorkloadStatus.Active) {
                count++;
            }
        }
        uint256[] memory active = new uint256[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < workloadIdList.length; i++) {
            uint256 wid = workloadIdList[i];
            if (workloads[wid].status == WorkloadLib.WorkloadStatus.Active) {
                active[j++] = wid;
            }
        }
        return active;
    }

    /** Batch get workloads by IDs (for placement/orchestrator). */
    function getWorkloadsBatch(uint256[] calldata workloadIds)
        external
        view
        returns (WorkloadLib.Workload[] memory)
    {
        WorkloadLib.Workload[] memory result = new WorkloadLib.Workload[](workloadIds.length);
        for (uint256 i = 0; i < workloadIds.length; i++) {
            result[i] = workloads[workloadIds[i]];
        }
        return result;
    }

    function workloadExists(uint256 workloadId) external view returns (bool) {
        return workloads[workloadId].owner != address(0);
    }
}
