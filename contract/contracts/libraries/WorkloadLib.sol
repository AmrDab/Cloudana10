// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library WorkloadLib {
    struct ResourceRequirements {
        uint256 cpu;              // CPU units (millicores)
        uint256 memoryBytes;      // Memory in bytes
        uint256 storageBytes;     // Storage in bytes
        string[] storageClasses;  // Required storage classes
        bool requiresGPU;         // GPU requirement flag
        uint256 gpuCount;         // Number of GPUs
        string[] gpuAttributes;   // GPU attributes (vendor, model)
        bool requiresEdge;        // Edge computing requirement
        string[] regions;         // Preferred regions
        uint256 maxLatency;       // Maximum latency in ms
    }
    
    struct Workload {
        uint256 id;
        address owner;
        bytes32 manifestHash; // IPFS hash of manifest
        ResourceRequirements requirements;
        WorkloadStatus status;
        uint256 createdAt;
        uint256 updatedAt;
        uint256 replicas;
        Instance[] instances;
    }
    
    struct Instance {
        uint256 id;
        address provider;
        InstanceStatus status;
        uint256 placedAt;
    }
    
    enum WorkloadStatus {
        Pending,
        Running,
        Scaling,
        Terminated
    }
    
    enum InstanceStatus {
        Pending,
        Running,
        Failed,
        Terminated
    }
}
