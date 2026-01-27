// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./libraries/WorkloadLib.sol";

/**
 * @title WorkloadRegistry
 * @dev Workload lifecycle management contract for Cloudana OS
 * Handles workload registration, updates, scaling, and termination
 */
contract WorkloadRegistry is AccessControl {
    using WorkloadLib for WorkloadLib.Workload;
    
    bytes32 public constant ORCHESTRATOR_ROLE = keccak256("ORCHESTRATOR_ROLE");
    
    // Workload storage (optimized for gas)
    mapping(uint256 => WorkloadLib.Workload) public workloads;
    mapping(address => uint256[]) public userWorkloads;
    mapping(address => mapping(uint256 => uint256)) public userWorkloadIndex; // O(1) deletion
    
    uint256 public nextWorkloadId;
    
    // Pagination support for large workloads
    uint256 public constant MAX_WORKLOADS_PER_QUERY = 50;
    
    // Workload lifecycle events
    event WorkloadCreated(
        uint256 indexed workloadId,
        address indexed owner,
        bytes32 manifestHash,
        WorkloadLib.ResourceRequirements requirements,
        uint256 timestamp
    );
    
    event WorkloadUpdated(
        uint256 indexed workloadId,
        bytes32 newManifestHash,
        uint256 timestamp
    );
    
    event WorkloadPlaced(
        uint256 indexed workloadId,
        address indexed provider,
        uint256 instanceId,
        uint256 timestamp
    );
    
    event WorkloadScaled(
        uint256 indexed workloadId,
        uint256 oldReplicas,
        uint256 newReplicas,
        uint256 timestamp
    );
    
    event WorkloadTerminated(
        uint256 indexed workloadId,
        uint256 timestamp
    );
    
    event InstanceStatusUpdated(
        uint256 indexed workloadId,
        uint256 indexed instanceId,
        address indexed provider,
        WorkloadLib.InstanceStatus newStatus,
        uint256 timestamp
    );
    
    event InstanceAdded(
        uint256 indexed workloadId,
        uint256 indexed instanceId,
        address indexed provider,
        uint256 timestamp
    );
    
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }
    
    /**
     * @dev Create new workload
     * @param manifestHash IPFS hash of the workload manifest
     * @param requirements Resource requirements for the workload
     * @return workloadId The created workload ID
     */
    function createWorkload(
        bytes32 manifestHash,
        WorkloadLib.ResourceRequirements calldata requirements
    ) external returns (uint256 workloadId) {
        require(manifestHash != bytes32(0), "Invalid manifest hash");
        require(requirements.cpu > 0, "CPU must be greater than 0");
        require(requirements.memoryBytes > 0, "Memory must be greater than 0");
        
        workloadId = nextWorkloadId++;
        
        // Initialize workload struct
        WorkloadLib.Workload storage workload = workloads[workloadId];
        workload.id = workloadId;
        workload.owner = msg.sender;
        workload.manifestHash = manifestHash;
        workload.requirements = requirements;
        workload.status = WorkloadLib.WorkloadStatus.Pending;
        workload.createdAt = block.timestamp;
        workload.updatedAt = block.timestamp;
        workload.replicas = 1;
        // instances array is automatically initialized as empty
        
        // Efficient O(1) indexing for deletion
        uint256 index = userWorkloads[msg.sender].length;
        userWorkloads[msg.sender].push(workloadId);
        userWorkloadIndex[msg.sender][workloadId] = index + 1; // +1 to distinguish from 0
        
        emit WorkloadCreated(
            workloadId,
            msg.sender,
            manifestHash,
            requirements,
            block.timestamp
        );
    }
    
    /**
     * @dev Update workload manifest
     * @param workloadId The workload ID to update
     * @param newManifestHash New IPFS hash of the workload manifest
     * @param newRequirements New resource requirements
     */
    function updateWorkload(
        uint256 workloadId,
        bytes32 newManifestHash,
        WorkloadLib.ResourceRequirements calldata newRequirements
    ) external {
        WorkloadLib.Workload storage workload = workloads[workloadId];
        require(workload.owner == msg.sender, "Not workload owner");
        require(workload.status != WorkloadLib.WorkloadStatus.Terminated, "Workload terminated");
        require(newManifestHash != bytes32(0), "Invalid manifest hash");
        
        workload.manifestHash = newManifestHash;
        workload.requirements = newRequirements;
        workload.updatedAt = block.timestamp;
        
        emit WorkloadUpdated(workloadId, newManifestHash, block.timestamp);
    }
    
    /**
     * @dev Scale workload
     * @param workloadId The workload ID to scale
     * @param newReplicas New number of replicas
     */
    function scaleWorkload(
        uint256 workloadId,
        uint256 newReplicas
    ) external {
        WorkloadLib.Workload storage workload = workloads[workloadId];
        require(workload.owner == msg.sender, "Not workload owner");
        require(workload.status != WorkloadLib.WorkloadStatus.Terminated, "Workload terminated");
        require(newReplicas > 0, "Invalid replica count");
        
        uint256 oldReplicas = workload.replicas;
        workload.replicas = newReplicas;
        workload.updatedAt = block.timestamp;
        
        if (oldReplicas != newReplicas) {
            workload.status = WorkloadLib.WorkloadStatus.Scaling;
        }
        
        emit WorkloadScaled(workloadId, oldReplicas, newReplicas, block.timestamp);
    }
    
    /**
     * @dev Terminate workload
     * @param workloadId The workload ID to terminate
     */
    function terminateWorkload(uint256 workloadId) external {
        WorkloadLib.Workload storage workload = workloads[workloadId];
        require(workload.owner == msg.sender, "Not workload owner");
        
        workload.status = WorkloadLib.WorkloadStatus.Terminated;
        workload.updatedAt = block.timestamp;
        
        emit WorkloadTerminated(workloadId, block.timestamp);
    }
    
    /**
     * @dev Placement hook (called by orchestrator)
     * @param workloadId The workload ID
     * @param provider The provider address
     * @param instanceId The instance ID
     */
    function recordPlacement(
        uint256 workloadId,
        address provider,
        uint256 instanceId
    ) external onlyRole(ORCHESTRATOR_ROLE) {
        WorkloadLib.Workload storage workload = workloads[workloadId];
        require(workload.status == WorkloadLib.WorkloadStatus.Pending, "Invalid status");
        require(provider != address(0), "Invalid provider");
        
        workload.instances.push(WorkloadLib.Instance({
            id: instanceId,
            provider: provider,
            status: WorkloadLib.InstanceStatus.Running,
            placedAt: block.timestamp
        }));
        
        workload.status = WorkloadLib.WorkloadStatus.Running;
        workload.updatedAt = block.timestamp;
        
        emit WorkloadPlaced(workloadId, provider, instanceId, block.timestamp);
    }
    
    /**
     * @dev Get workload by ID
     * @param workloadId The workload ID
     * @return The workload struct
     */
    function getWorkload(uint256 workloadId) 
        external view returns (WorkloadLib.Workload memory) {
        WorkloadLib.Workload storage workload = workloads[workloadId];
        require(workload.owner != address(0), "Workload does not exist");
        
        // Create memory struct and copy data
        WorkloadLib.Workload memory result = WorkloadLib.Workload({
            id: workload.id,
            owner: workload.owner,
            manifestHash: workload.manifestHash,
            requirements: workload.requirements,
            status: workload.status,
            createdAt: workload.createdAt,
            updatedAt: workload.updatedAt,
            replicas: workload.replicas,
            instances: new WorkloadLib.Instance[](workload.instances.length)
        });
        
        // Copy instances array
        for (uint256 i = 0; i < workload.instances.length; i++) {
            result.instances[i] = workload.instances[i];
        }
        
        return result;
    }
    
    /**
     * @dev Get all workload IDs for a user
     * @param user The user address
     * @return Array of workload IDs
     */
    function getUserWorkloads(address user) 
        external view returns (uint256[] memory) {
        return userWorkloads[user];
    }
    
    /**
     * @dev Paginated query for large workloads (gas efficient)
     * @param user The user address
     * @param offset Starting index
     * @param limit Maximum number of results
     * @return result Array of workload IDs
     * @return hasMore Whether there are more results
     */
    function getUserWorkloadsPaginated(
        address user,
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory result, bool hasMore) {
        uint256[] memory allWorkloads = userWorkloads[user];
        uint256 total = allWorkloads.length;
        
        if (offset >= total) {
            return (new uint256[](0), false);
        }
        
        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        
        result = new uint256[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = allWorkloads[i];
        }
        
        return (result, end < total);
    }
    
    /**
     * @dev Get total number of workloads
     * @return Total count
     */
    function getWorkloadCount() external view returns (uint256) {
        return nextWorkloadId;
    }
    
    /**
     * @dev Get instance by workload ID and instance ID
     * @param workloadId The workload ID
     * @param instanceId The instance ID
     * @return The instance struct
     */
    function getInstance(uint256 workloadId, uint256 instanceId) 
        external view returns (WorkloadLib.Instance memory) {
        WorkloadLib.Workload storage workload = workloads[workloadId];
        require(workload.owner != address(0), "Workload does not exist");
        
        for (uint256 i = 0; i < workload.instances.length; i++) {
            if (workload.instances[i].id == instanceId) {
                return workload.instances[i];
            }
        }
        
        revert("Instance not found");
    }
    
    /**
     * @dev Get all instances for a workload
     * @param workloadId The workload ID
     * @return Array of instances
     */
    function getWorkloadInstances(uint256 workloadId) 
        external view returns (WorkloadLib.Instance[] memory) {
        WorkloadLib.Workload storage workload = workloads[workloadId];
        require(workload.owner != address(0), "Workload does not exist");
        
        // Create memory array and copy instances
        WorkloadLib.Instance[] memory instances = new WorkloadLib.Instance[](workload.instances.length);
        for (uint256 i = 0; i < workload.instances.length; i++) {
            instances[i] = workload.instances[i];
        }
        return instances;
    }
    
    /**
     * @dev Update instance status (called by orchestrator or provider)
     * @param workloadId The workload ID
     * @param instanceId The instance ID
     * @param newStatus The new instance status
     */
    function updateInstanceStatus(
        uint256 workloadId,
        uint256 instanceId,
        WorkloadLib.InstanceStatus newStatus
    ) external {
        WorkloadLib.Workload storage workload = workloads[workloadId];
        require(workload.owner != address(0), "Workload does not exist");
        
        // Only orchestrator, workload owner, or instance provider can update
        bool isOrchestrator = hasRole(ORCHESTRATOR_ROLE, msg.sender);
        bool isOwner = workload.owner == msg.sender;
        
        // Find instance
        bool instanceFound = false;
        for (uint256 i = 0; i < workload.instances.length; i++) {
            if (workload.instances[i].id == instanceId) {
                bool isProvider = workload.instances[i].provider == msg.sender;
                require(isOrchestrator || isOwner || isProvider, "Not authorized");
                
                workload.instances[i].status = newStatus;
                instanceFound = true;
                
                emit InstanceStatusUpdated(
                    workloadId,
                    instanceId,
                    workload.instances[i].provider,
                    newStatus,
                    block.timestamp
                );
                break;
            }
        }
        
        require(instanceFound, "Instance not found");
        workload.updatedAt = block.timestamp;
        
        // Update workload status based on instance statuses
        _updateWorkloadStatus(workloadId);
    }
    
    /**
     * @dev Add instance to workload (called by orchestrator during scaling)
     * @param workloadId The workload ID
     * @param provider The provider address
     * @param instanceId The instance ID
     */
    function addInstance(
        uint256 workloadId,
        address provider,
        uint256 instanceId
    ) external onlyRole(ORCHESTRATOR_ROLE) {
        WorkloadLib.Workload storage workload = workloads[workloadId];
        require(workload.owner != address(0), "Workload does not exist");
        require(provider != address(0), "Invalid provider");
        require(
            workload.status == WorkloadLib.WorkloadStatus.Pending || 
            workload.status == WorkloadLib.WorkloadStatus.Scaling,
            "Invalid workload status"
        );
        
        // Check if instance already exists
        for (uint256 i = 0; i < workload.instances.length; i++) {
            require(workload.instances[i].id != instanceId, "Instance already exists");
        }
        
        workload.instances.push(WorkloadLib.Instance({
            id: instanceId,
            provider: provider,
            status: WorkloadLib.InstanceStatus.Pending,
            placedAt: block.timestamp
        }));
        
        workload.updatedAt = block.timestamp;
        
        emit InstanceAdded(workloadId, instanceId, provider, block.timestamp);
        
        // Update workload status
        _updateWorkloadStatus(workloadId);
    }
    
    /**
     * @dev Internal function to update workload status based on instance statuses
     * @param workloadId The workload ID
     */
    function _updateWorkloadStatus(uint256 workloadId) internal {
        WorkloadLib.Workload storage workload = workloads[workloadId];
        
        if (workload.instances.length == 0) {
            if (workload.status != WorkloadLib.WorkloadStatus.Terminated) {
                workload.status = WorkloadLib.WorkloadStatus.Pending;
            }
            return;
        }
        
        uint256 runningCount = 0;
        uint256 failedCount = 0;
        uint256 terminatedCount = 0;
        
        for (uint256 i = 0; i < workload.instances.length; i++) {
            if (workload.instances[i].status == WorkloadLib.InstanceStatus.Running) {
                runningCount++;
            } else if (workload.instances[i].status == WorkloadLib.InstanceStatus.Failed) {
                failedCount++;
            } else if (workload.instances[i].status == WorkloadLib.InstanceStatus.Terminated) {
                terminatedCount++;
            }
        }
        
        // Update workload status based on instance states
        if (terminatedCount == workload.instances.length) {
            workload.status = WorkloadLib.WorkloadStatus.Terminated;
        } else if (runningCount > 0) {
            workload.status = WorkloadLib.WorkloadStatus.Running;
        } else if (workload.instances.length < workload.replicas) {
            workload.status = WorkloadLib.WorkloadStatus.Scaling;
        } else if (failedCount > 0 && runningCount == 0) {
            // All instances failed, keep as pending for retry
            workload.status = WorkloadLib.WorkloadStatus.Pending;
        }
    }
    
    /**
     * @dev Batch get workloads by IDs (gas efficient for multiple queries)
     * @param workloadIds Array of workload IDs
     * @return Array of workload structs
     */
    function getWorkloadsBatch(uint256[] calldata workloadIds) 
        external view returns (WorkloadLib.Workload[] memory) {
        WorkloadLib.Workload[] memory result = new WorkloadLib.Workload[](workloadIds.length);
        for (uint256 i = 0; i < workloadIds.length; i++) {
            WorkloadLib.Workload storage workload = workloads[workloadIds[i]];
            result[i] = workload;
            
            // Copy instances array
            result[i].instances = new WorkloadLib.Instance[](workload.instances.length);
            for (uint256 j = 0; j < workload.instances.length; j++) {
                result[i].instances[j] = workload.instances[j];
            }
        }
        return result;
    }
    
    /**
     * @dev Check if workload exists
     * @param workloadId The workload ID
     * @return True if workload exists
     */
    function workloadExists(uint256 workloadId) external view returns (bool) {
        return workloads[workloadId].owner != address(0);
    }
}
