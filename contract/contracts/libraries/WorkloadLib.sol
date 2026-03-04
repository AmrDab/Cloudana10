// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title WorkloadLib
 * @dev Minimal on-chain workload state. Full manifest/requirements live on IPFS; chain stores only metadataUri (like ProviderRegistry).
 */
library WorkloadLib {
    struct Workload {
        uint256 id;
        address owner;
        string metadataUri;   // IPFS CID or gateway URL (workload manifest + requirements)
        WorkloadStatus status;
        uint256 registeredAt;
        uint256 updatedAt;
        // Optional: one placement per workload (orchestrator records after matching)
        address placementProvider;
        uint256 placementInstanceId;
    }

    enum WorkloadStatus {
        Inactive,
        Active
    }
}
