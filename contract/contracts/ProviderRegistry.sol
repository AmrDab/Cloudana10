// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./libraries/ProviderLib.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title ProviderRegistry
 * @dev Provider registration keyed by deviceId. On-chain we store only metadata URI (IPFS CID or URL);
 *      full device spec is on IPFS. One wallet can register multiple provider nodes (devices).
 *
 * Anti-Sybil additions:
 *   - Hardware fingerprints: keccak256(CPU_ID + GPU_UUID + MAC_ADDR) bound to each device.
 *     Once a fingerprint is registered, no other wallet can register the same hardware.
 *   - Max 10 nodes per wallet: prevents single actor from dominating the network.
 *   - Fingerprint must be provider-signed to prevent spoofing.
 */
contract ProviderRegistry {
    using ECDSA for bytes32;

    mapping(bytes32 => ProviderLib.Provider) public providersByDevice;
    mapping(address => bytes32[]) public ownerDeviceIds;
    bytes32[] public deviceIdList;
    mapping(bytes32 => uint256) public deviceIdListIndex;
    mapping(bytes32 => bool) public isDeviceRegistered;

    // ─── Anti-Sybil Storage ───────────────────────────────────────────────────

    /// @dev Hardware fingerprint per device: keccak256(CPU_ID || GPU_UUID || MAC_ADDR)
    mapping(bytes32 => bytes32) public hardwareFingerprint;

    /// @dev Track which fingerprints are already used — prevents one machine re-registering
    mapping(bytes32 => bool) public usedFingerprints;

    /// @dev Track registered fingerprint => owning deviceId (for diagnostics)
    mapping(bytes32 => bytes32) public fingerprintToDevice;

    /// @dev Number of nodes per wallet (max MAX_NODES_PER_WALLET)
    mapping(address => uint256) public nodeCount;

    /// @dev Maximum nodes a single wallet can register
    uint256 public constant MAX_NODES_PER_WALLET = 10;

    /// @dev MVP mode: hardware fingerprint not required. Disable post-launch to enforce Sybil protection.
    bool public mvpMode = true;

    event ProviderRegistered(
        address indexed owner,
        bytes32 indexed deviceId,
        string metadataUri,
        uint256 timestamp
    );
    event HardwareFingerprintSet(bytes32 indexed deviceId, bytes32 fingerprint, address indexed owner);
    event SybilAttemptBlocked(bytes32 indexed fingerprint, address indexed attacker);
    event ProviderUpdated(
        address indexed owner,
        bytes32 indexed deviceId,
        string metadataUri,
        uint256 timestamp
    );
    event ProviderDeregistered(address indexed owner, bytes32 indexed deviceId, uint256 timestamp);
    event ProviderActivated(address indexed owner, bytes32 indexed deviceId, uint256 timestamp);

    /**
     * @notice Set a hardware fingerprint for a device. Must be called before registerProvider.
     *         The fingerprint is keccak256(CPU_ID || GPU_UUID || MAC_ADDR) signed by the provider.
     *         Prevents the same physical machine from registering under multiple wallets.
     *
     * @param deviceId    The device being registered
     * @param fingerprint keccak256 hash of hardware identifiers
     * @param sig         Provider's signature over keccak256(deviceId || fingerprint)
     */
    function setHardwareFingerprint(
        bytes32 deviceId,
        bytes32 fingerprint,
        bytes calldata sig
    ) external {
        require(!usedFingerprints[fingerprint], "Fingerprint already registered (Sybil detected)");
        require(hardwareFingerprint[deviceId] == bytes32(0), "Fingerprint already set for device");

        // Verify provider signed their own hardware fingerprint
        bytes32 message = keccak256(abi.encodePacked(deviceId, fingerprint));
        bytes32 ethSignedMessage = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", message));
        address signer = ethSignedMessage.recover(sig);
        require(signer == msg.sender, "Invalid fingerprint signature");

        hardwareFingerprint[deviceId] = fingerprint;
        usedFingerprints[fingerprint] = true;
        fingerprintToDevice[fingerprint] = deviceId;

        emit HardwareFingerprintSet(deviceId, fingerprint, msg.sender);
    }

    function registerProvider(bytes32 deviceId, string calldata metadataUri) external {
        require(!isDeviceRegistered[deviceId], "Device already registered");
        require(bytes(metadataUri).length > 0, "Metadata URI required");
        require(nodeCount[msg.sender] < MAX_NODES_PER_WALLET, "Max nodes per wallet reached");
        // Post-MVP: require hardware fingerprint to prevent Sybil attacks
        require(mvpMode || hardwareFingerprint[deviceId] != bytes32(0), "Hardware fingerprint required");

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
        nodeCount[msg.sender]++;

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
