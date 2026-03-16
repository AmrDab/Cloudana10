// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./libraries/ProviderLib.sol";

/**
 * @title ProviderRegistry
 * @dev Provider registration keyed by deviceId. On-chain we store only metadata URI (IPFS CID or URL);
 *      full device spec is on IPFS. One wallet can register multiple provider nodes (devices).
 */
contract ProviderRegistry {
    mapping(bytes32 => ProviderLib.Provider) public providersByDevice;
    mapping(address => bytes32[]) public ownerDeviceIds;
    bytes32[] public deviceIdList;
    mapping(bytes32 => uint256) public deviceIdListIndex;
    mapping(bytes32 => bool) public isDeviceRegistered;

    event ProviderRegistered(
        address indexed owner,
        bytes32 indexed deviceId,
        string metadataUri,
        uint256 timestamp
    );
    event ProviderUpdated(
        address indexed owner,
        bytes32 indexed deviceId,
        string metadataUri,
        uint256 timestamp
    );
    event ProviderDeregistered(address indexed owner, bytes32 indexed deviceId, uint256 timestamp);
    event ProviderActivated(address indexed owner, bytes32 indexed deviceId, uint256 timestamp);

    function registerProvider(bytes32 deviceId, string calldata metadataUri) external {
        require(!isDeviceRegistered[deviceId], "Device already registered");
        require(bytes(metadataUri).length > 0, "Metadata URI required");

        providersByDevice[deviceId] = ProviderLib.Provider({
            providerAddr: msg.sender,
            deviceId: deviceId,
            metadataUri: metadataUri,
            status: ProviderLib.ProviderStatus.Active,
            registeredAt: block.timestamp,
            updatedAt: block.timestamp
        });

        uint256 idx = deviceIdList.length;
        deviceIdList.push(deviceId);
        deviceIdListIndex[deviceId] = idx;
        isDeviceRegistered[deviceId] = true;
        ownerDeviceIds[msg.sender].push(deviceId);

        emit ProviderRegistered(msg.sender, deviceId, metadataUri, block.timestamp);
    }

    function updateProvider(bytes32 deviceId, string calldata newMetadataUri) external {
        ProviderLib.Provider storage p = providersByDevice[deviceId];
        require(p.providerAddr == msg.sender, "Not device owner");
        require(
            p.status != ProviderLib.ProviderStatus.Unregistered,
            "Not registered"
        );
        require(bytes(newMetadataUri).length > 0, "Metadata URI required");

        p.metadataUri = newMetadataUri;
        p.updatedAt = block.timestamp;

        emit ProviderUpdated(msg.sender, deviceId, newMetadataUri, block.timestamp);
    }

    function deregisterProvider(bytes32 deviceId) external {
        ProviderLib.Provider storage p = providersByDevice[deviceId];
        require(p.providerAddr == msg.sender, "Not device owner");
        p.status = ProviderLib.ProviderStatus.Inactive;
        p.updatedAt = block.timestamp;
        emit ProviderDeregistered(msg.sender, deviceId, block.timestamp);
    }

    function activateProvider(bytes32 deviceId) external {
        ProviderLib.Provider storage p = providersByDevice[deviceId];
        require(p.providerAddr == msg.sender, "Not device owner");
        require(
            p.status == ProviderLib.ProviderStatus.Inactive,
            "Provider must be inactive to activate"
        );
        p.status = ProviderLib.ProviderStatus.Active;
        p.updatedAt = block.timestamp;
        emit ProviderActivated(msg.sender, deviceId, block.timestamp);
    }

    function getProviderByDevice(bytes32 deviceId)
        external
        view
        returns (ProviderLib.Provider memory)
    {
        return providersByDevice[deviceId];
    }

    function getProvidersByOwner(address owner)
        external
        view
        returns (bytes32[] memory)
    {
        return ownerDeviceIds[owner];
    }

    function getAllProviders() external view returns (bytes32[] memory) {
        return deviceIdList;
    }

    function getActiveProviders() external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < deviceIdList.length; i++) {
            if (providersByDevice[deviceIdList[i]].status == ProviderLib.ProviderStatus.Active) {
                count++;
            }
        }
        bytes32[] memory active = new bytes32[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < deviceIdList.length; i++) {
            if (providersByDevice[deviceIdList[i]].status == ProviderLib.ProviderStatus.Active) {
                active[j++] = deviceIdList[i];
            }
        }
        return active;
    }

    function getDeviceOwner(bytes32 deviceId) external view returns (address) {
        return providersByDevice[deviceId].providerAddr;
    }
}
